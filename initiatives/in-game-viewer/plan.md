# Initiative: In-game plan viewer (mod and bridge)

Status: Active

Design notes for a read-only Factorio mod that shows the planner's blocks and plans in the game, and the bridge that carries them there. Phase 0, a spike, is closed and the rest is being implemented: its UDP measurements confirm chunked UDP as the transport ([Step 2 and 3 results](#step-2-and-3-results-2026-10-31)), the supported browsers are Chrome and Firefox ([Step 1 results](#step-1-results-2026-10-31)), and multiplayer stays open (see [Open questions](#open-questions)). External facts are listed with their sources in [Sources and verification](#sources-and-verification).

---

## Goal

While playing, the player sees the plan they made in the planner: each block with its products, recipes, machine counts, power and imports, without alt-tabbing. The mod only **displays**; it never changes the game world and never sends edits back to the planner.

**Non-goals**:

- Editing a plan from the game, or any game-to-planner data flow beyond a handshake.
- Placing entities or blueprints, or checking what the player has built against the plan.
- Live production statistics compared with the plan.
- Multiplayer support (see [Open questions](#open-questions)); the first version targets single-player and a host who is the only player.
- Safari, which blocks the connection to the bridge (see [Later](#later)).

## Architecture

```
planner (browser)  ──WebSocket, localhost──▶  bridge (Rust)  ──UDP, localhost──▶  mod (Lua, in Factorio)
                                                 ▲                                      │
                                                 └───────── hello / ack (UDP) ──────────┘
```

- **Planner → bridge: WebSocket on localhost.** A browser cannot send UDP, so the bridge exposes a local WebSocket (or HTTP) endpoint that the planner connects to. The planner stays a static, client-side site: the connection is optional and only opened when the user asks for it. It uses plain `ws://`, with no local certificate, and works in Chrome and Firefox after the browser's permission prompt.
- **Bridge → mod: UDP**, using Factorio's opt-in `--enable-lua-udp` option, which sets the local port the game listens on and enables `helpers.send_udp()` and `helpers.recv_udp()` ([S4](#sources-and-verification)). The game must be launched with the flag. The bridge never launches the game: setting the flag (a Steam launch option or a shortcut) is documented in the README.
- **Mod → bridge: UDP**, limited to a handshake (`hello` with the protocol version and the id of the stored snapshot) and acknowledgements. The mod wraps `send_udp` and `recv_udp` in `pcall`, so a game launched without the flag cannot break. The mod sends no plan data, and it only answers the bridge, at most once per poll, because each `send_udp` call appears to block the game for about 20 ms ([results](#step-2-and-3-results-2026-10-31)).
- **The bridge is a Rust application** that builds to a single binary, so a player downloads one file. It is also the piece that could later be hosted by Tauri alongside the planner itself (see [Later](#later)); keeping the bridge a library crate plus a thin `main` makes that possible without a rewrite.
- **The planner solves, the mod displays.** The solve stays in the browser (`src/solver/`); the bridge relays results and never interprets them. This keeps one implementation of the solver.

## Supported Factorio version

**Factorio 2.0.77 only**, the maintainer's version, not the 2.1.x series. The mod pins the 2.0 series in `info.json` (`factorio_version` takes only `major.minor`, so `"2.0"`, plus a `base` dependency, [S8](#sources-and-verification)); 2.0.77 itself is what the tests and the manual checklist run against. Nothing in the 2.1 documentation is relied on, so the 2.1.9 `recv_udp` crash ([S6](#sources-and-verification)) is not our concern. Supporting 2.1 is a separate decision once it is the version the maintainer plays.

## What is sent

A **snapshot** is a projection of the planner's state, not the stored plan: only what the viewer needs, with ids that the game already knows. Sending ids, not names or icons, is the main simplification: the mod renders `[item=iron-plate]`, `[recipe=...]`, `[entity=...]` rich text and `item/<name>`, `fluid/<name>`, `recipe/<name>` and `entity/<name>` sprites, so locale and icons come from the game, in the player's language, and no image data crosses the wire ([S7](#sources-and-verification)).

Per block, taken from the plan and its `SolverResult` ([spec/data-model.md](../../spec/data-model.md#solver-state-transient)):

- Name, colour, products with their rates. Every item id carries its `type` (`item` or `fluid`), which picks the sprite prefix.
- Recipe rows: recipe id, machine id, exact and rounded-up machine count, throughput, power; the area each row belongs to when the block has areas.
- Imports (the `unsatisfied` list, in its order) and the block's warnings, reduced to a code and the ids it names.
- Connections: source block, item, available rate.

Snapshots are versioned (`v`) and carry the plan's data-set stamp ([`PlanDataSetStamp`](../../spec/data-model.md#plandatasetstamp)). On receipt the mod checks that every item, recipe and machine id exists in the running game. Ids that do not exist are listed, not hidden, so a player running a different mod set from the plan's sees why rows are blank. The stamp's id (`nullius`, `kompetenz-seablock`, `custom:...`) cannot be derived by a running mod, so the id check is the only data-set test: after validating a snapshot, the mod reports how many of its ids do not exist in the running game, and that count drives the planner's data-set mismatch badge.

The projection is defined once, as a Zod schema in the planner (the same rule as `src/data/schema.ts`, which is the source of truth for all plan types). A JSON Schema generated from it (Zod 4 has an export for this, [S12](#sources-and-verification)) validates the shared fixtures, and the Lua fixtures are checked against it in tests. The bridge treats the snapshot as opaque bytes and reads only a small envelope, so it has no `serde` types for the snapshot.

## The mod

A `mod/` folder holding a normal Factorio mod (`info.json`, `control.lua`, `locale/`, `migrations/`).

- **Receive.** A thin adapter calls `helpers.recv_udp()` (inside `pcall`) every 10 ticks, which dispatches `on_udp_packet_received` for the packets that arrived since the last call ([S1](#sources-and-verification)). All of them are raised together, one tick after the call ([results](#step-2-and-3-results-2026-10-31)). The event handler reassembles chunked snapshots (the chunk format comes from the wire protocol document produced in Phase 1), validates them, and swaps the new snapshot in atomically. A snapshot that fails validation or is incomplete leaves the previous one on screen. Decoding runs in one tick: `helpers.json_to_table` on a full snapshot takes 7 to 14 ms of the tick's 16.7 ms and happens only when a snapshot arrives.
- **Encoding.** The wire format is raw JSON, with no base64 and no compression. The mod receives `payload` as a Lua string, which is binary-safe ([results](#step-2-and-3-results-2026-10-31)), joins the chunks byte for byte, so a multi-byte character in a block name can straddle two chunks, and decodes the result with `helpers.json_to_table` ([S10](#sources-and-verification)). Everything the mod sends goes through `send_udp`, whose `data` is a `LocalisedString` with its own limits ([S11](#sources-and-verification)), so the mod's messages stay short.
- **Bridge port.** `send_udp(port, …)` needs the bridge's port, and `--enable-lua-udp` only sets the game's own listening port. The mod reads the bridge's port from a runtime-global mod setting (default shared with the bridge's default), so the player never edits Lua.
- **Store.** The accepted snapshot is kept in `storage`, so it survives save and load and shows after reloading a save without the bridge running. This is measured, and it adds about the snapshot's own size to `script.dat` (273 KB for the full-size test).
- **Display.** A top-bar button opens a window per player: a block list on the left (block colour, name), and the selected block on the right with products, recipe rows (icon, machine, count, power), imports and warnings. Read-only: no input except selecting a block, collapsing sections and closing. A `Disconnected` / `Stale` indicator shows when the bridge has not sent for a while or the snapshot is older than the one in the planner. Silence is counted in game ticks, not wall-clock time, because no handler runs while the game is paused and the single-player Esc menu pauses it ([M1](#sources-and-verification)). If the game could not bind its UDP port, `send_udp` and `recv_udp` do nothing and raise no error, so the mod cannot tell that case from a missing bridge; the `Disconnected` text points at the launch option and `factorio-current.log`.
- **Pure logic split.** Decoding, validation, reassembly and view-model building are plain Lua modules with no `game` / `script` / `storage` access, so they run under busted. Event handlers and GUI code stay thin.
- **No effect on gameplay.** The mod changes no prototypes and no entities. Whether the mod, or `--enable-lua-udp`, disables achievements is not stated in the sources below ([U4](#sources-and-verification)).
- **Packaging.** The release workflow builds the mod as a zip and attaches it to the GitHub release, next to the bridge binaries. The zip must be named `<mod name>_<version>.zip` and hold one folder; the folder's own name is unrestricted, though we name it `<mod name>_<version>` by convention ([S9](#sources-and-verification)). The version in `info.json` is the release version.

## The bridge

A `bridge/` Cargo workspace with a library crate (protocol, chunking, session state, implementing the wire protocol document) and a binary crate (CLI, sockets).

- Listens on a localhost WebSocket for the planner; sends UDP datagrams to the mod's port.
- **Chunking and reliability.** A snapshot is split into datagrams of at most 8,000 B of payload, each with `snapshotId`, `index`, `count` and the total byte length, so a full Seablock snapshot (about 229 KB) is 29 chunks. macOS refuses to send UDP datagrams above 9,216 bytes by default (`net.inet.udp.maxdgram`) and we do not ask players to change system settings, so that is the hard cap, and 8,000 B plus a short header stays under it. Only macOS is tested; Linux and Windows are best effort. Chunks carry no checksum: datagrams are dropped whole, never truncated, and a checksum in Lua cost more than the JSON decode (14 to 48 ms against 7 to 14 ms for the whole snapshot), so the mod checks the byte length and the result of `json_to_table`. Paced traffic saw no loss, reordering or duplicates on loopback, so the only losses to recover from are a full buffer and the growth step below; the mod reports missing chunks and the bridge resends them. Only the newest snapshot matters, so an older one is dropped when a newer one arrives.
- **Warm-up.** Factorio's socket starts with a small buffer and loses the first datagram that does not fit, once per doubling (8,192 B, then 16,384 B), and the socket is reopened on every save load. Before each snapshot, the bridge therefore sends a chunk-sized probe and repeats it until the mod answers. Those losses are not counted as snapshot loss.
- **Pacing.** The game's receive buffer holds about 262 KB, each datagram costs about 92 B on top of its payload, and anything beyond that is dropped whole and silently between two `recv_udp` calls, including while the game is paused or saving ([S1](#sources-and-verification), [results](#step-2-and-3-results-2026-10-31)). The bridge sends a window of at most 24 chunks (about 195 KB of buffer) at the spike's rate of 4 chunks per 20 ms, then a short end-of-window datagram, and sends nothing more until the mod answers with what is missing. It never resends on a timeout alone, so a paused game stalls a transfer instead of overflowing the buffer, and the transfer continues when the game resumes.
- **Handshake and status.** The bridge sends a small ping every few seconds, and the mod answers with `hello`, so the mod never calls `send_udp` when no bridge is running. If the stored snapshot id in `hello` is not the newest one, the bridge sends it, which also covers a save loaded after the last send. The bridge reports to the planner whether a mod is connected, which protocol version it announced and how many snapshot ids it did not find in the running game, so the planner can warn on a mismatch. A paused game stops answering, so a mod that goes quiet may be paused or closed, and the bridge cannot tell which. Pings pile up during a pause, which is why the mod answers at most once per poll.
- **Configuration.** Ports and the allowed web origin via flags with defaults (game `34198`, bridge `34199`, as in the spike); fails with a clear error if its own port is taken; binds to `127.0.0.1` only, and checks the `Origin` of WebSocket connections so a random web page cannot push snapshots. Nothing is persisted.
- **Single binary.** `cargo build --release` per platform in CI, attached to the GitHub release next to the mod zip.

## The planner side

- A connection control in the top bar (off by default) with the bridge address, a status badge (no bridge, bridge but no game, connected, data-set mismatch when the mod reports snapshot ids missing from the running game), and a **Send to Factorio** action; optionally resend automatically after a solve.
- A pure projection function (plan + `MultiBlockSolve` to snapshot) with unit tests in the `node` project, plus a Playwright spec against a fake bridge.
- Doc changes when this ships: [spec/ui.md](../../spec/ui.md) for the control, a new section in [spec/data-model.md](../../spec/data-model.md) or a new spec file for the snapshot and protocol, [spec/tech-stack.md](../../spec/tech-stack.md) for Rust and the CI jobs, and the README repository map.

## Testing

| Layer | What | Tool |
|---|---|---|
| Contract | Snapshot schema, shared fixtures, shared datagram fixtures, JSON Schema | Vitest; the same fixtures are read by the Lua and Rust tests, and the JSON Schema validates the snapshot fixtures |
| Planner | Projection, connection state, UI | Vitest, Playwright with a fake bridge |
| Bridge | Chunking, resend, reordering, `Origin` check, status | `cargo test` with loopback UDP and WebSocket clients |
| Mod logic | Decode, validate, reassemble, view-model | busted on plain Lua modules |
| Static | Types and globals | LuaLS with the Factorio definitions, `luacheck`, `clippy`, `cargo fmt --check` |
| End to end (local) | Real game, real bridge, a snapshot appears | A script the maintainer runs against their own Factorio 2.0.77 install, with a test save; **not in CI** |
| Manual | The GUI itself, in a real session | A checklist kept next to the mod |

`busted` and `luacheck` run under Lua 5.2, Factorio's Lua version, pinned in CI. Locally they run from a gitignored Lua tree, with nothing installed system-wide.

**CI never runs Factorio**, because the game cannot be made available there for licensing reasons. CI covers every layer above the two bottom rows (contract, planner, bridge, mod logic under busted, static checks), which is why the mod's logic is split from the game API. The two bottom rows are run by hand before a release; the checklist is part of the release process.

A Factorio-free test of the transport is still possible: the bridge tests talk to a fake mod (a UDP socket that plays the mod's part, including the two measured kinds of loss, a full buffer and the first oversized datagram on a fresh socket, plus reordered datagrams, which the spike never saw but cost little to cover), and the mod's reassembly is tested in busted on the same datagram fixtures.

## Phases

### Phase 0 — spike

Throwaway code, deleted when the phase closed; the results stay in this document, each with its date and the Factorio build. The phase answers the [open questions](#open-questions) that decide the design, in three steps.

**Step 0 — read and measure, no spike code.**

- Read the pages behind S2 (the fields of `on_udp_packet_received`), U1, U5, U6, U7 and U8, and move each to an **S** entry with its source. Done: they are now S7 to S11 (see [Step 0 results](#step-0-results-2026-10-27)).
- Measure the size of a realistic snapshot on the planner side, using the [share-by-url](../share-by-url/plan.md) sample plan scaled to ten times its size. That sample is a 10 % mid-game Seablock export, so the scaled plan approximates a complete Seablock run. A hand-built JSON of the fields listed in [What is sent](#what-is-sent) is enough; the real projection comes in Phase 1. This sets the range the Factorio probes need to cover.

**Step 1 — browser to localhost (no Factorio).** A small page served from the GitHub Pages deployment opens `ws://127.0.0.1:<port>` against a throwaway WebSocket listener. Try current Chrome, Firefox and Safari, and record whether the connection is allowed, blocked, or behind a permission prompt ([M2](#sources-and-verification)). If it is blocked somewhere, decide between `wss` with a local certificate, a supported-browser list, or moving the [Tauri host](#later) up.

**Step 2 — UDP in Factorio 2.0.77.** A spike mod and a few-line Rust UDP echo, run by hand on a minimal save with only the spike mod enabled (Seablock adds startup time and noise). The bridge→mod direction matters most, because that is where plan data flows; the mod→bridge direction only has to carry short messages. Fill in the table:

| Measurement | Method | Feeds |
|---|---|---|
| Largest single datagram, bridge→mod and mod→bridge | Probe 1, 16, 60 and 64+ KB (UDP's ceiling is about 65,507 bytes) | Whether chunking exists; chunk size |
| Binary safety of `payload` | Send NUL bytes and non-ASCII; compare byte for byte | Raw JSON or base64 |
| Loss and reordering | Sequence-numbered datagrams, about 10,000 of them, at several send rates | Resend logic |
| Behaviour at the 256 KB buffer limit | Send more than 256 KB between two `recv_udp` calls | Whether datagrams are dropped whole or truncated; the pacing bound |
| Behaviour while paused | Send while the game is paused and while the main menu is open; see what arrives after resuming | Staleness indicator; resend timing |
| Poll cost | UPS with `recv_udp` every tick, 10 ticks and 60 ticks | Poll interval |
| Latency | Send to `on_udp_packet_received`, in single-player | Whether acks can be time-bound |
| Decode cost | `helpers.json_to_table` on a payload as large as the snapshot size from Step 0 | Whether decoding needs spreading across ticks |
| Full-size delivery | Send a payload the size of the Step 0 snapshot from the echo to the mod, with the chunk size and pacing found above; the mod reassembles, decodes and acknowledges it, and the echo compares what it sent with what the mod read back | Whether the chunking and pacing design works end to end |
| `for_player` | `send_udp` with and without it, in single-player | The mod's send call |
| Port already in use | Repeat the [S5](#sources-and-verification) case | The bridge's port check |
| Multiplayer (optional) | Host a game, receive a snapshot, check `storage` stays in sync | Whether multiplayer can ever be supported |
| Achievements (optional) | Play with the spike mod and `--enable-lua-udp`, check whether achievements stay enabled | A README note if affected |

**Step 3 — coexistence.** Load the spike mod in the maintainer's Seablock save and repeat the round trip once.

Exit criteria: every non-optional row is filled in this document, the transport decision is recorded (chunked UDP, single datagram, or a [fallback](#if-the-udp-transport-does-not-work)), the browser-to-localhost outcome is recorded, and the U entries read in Step 0 are converted to S entries.

#### Step 0 results (2026-10-27)

Pages read: S2, S7 to S11 (now in [Sources and verification](#sources-and-verification)). Two findings change the design notes: `factorio_version` takes only `major.minor`, so the mod pins the 2.0 series and 2.0.77 is enforced by tests only; and the zip's inner folder name is unrestricted. `helpers.encode_string` / `decode_string` (S10) are a candidate for compressed snapshots, to be probed in step 2.

Snapshot size. Method: the [share-by-url](../share-by-url/plan.md) sample plan (4 blocks) was migrated with `AppStateSchema`, solved with `solveAll` on the bundled Seablock data (no solver errors), and projected to the fields in [What is sent](#what-is-sent) as compact JSON with rows `{recipe, machine, exact, ceil, perMin, kw, area}`, rates rounded to three decimals, and block ids cut to 8 characters. Machine ids are the node's, or `assembling-machine-2` when the node has none, so machine-id lengths are approximate. The 10× plan repeats the four blocks 10 times with renamed ids and names. The two spike files (the 1× snapshot and the scaling script) stay in git history at commit a166164.

| Plan | Blocks | Recipe rows | JSON | Largest block | base64 of the JSON |
|---|---|---|---|---|---|
| Sample (1×) | 4 | 136 | 22,871 B | 7,778 B (Sciences: 45 rows, 17 imports, 18 connections) | 30,496 B |
| Scaled 10× | 40 | 1,360 | 228,548 B | 7,778 B | 304,732 B |

Deflate takes the 1× snapshot to 3,838 B (brotli 3,214 B), so a 10× snapshot with no repetition between copies would be about 38 KB deflated. The 10× deflate figure printed by the script (8,016 B) is not usable, because the copies are identical. Consequences for the Factorio probes:

- A full Seablock snapshot as raw JSON (about 229 KB) is just under the 256 KB receive buffer (S1), and its base64 form (about 305 KB) is over it. One datagram cannot carry it (UDP's ceiling is about 65,507 bytes), so chunking and pacing are needed unless compression brings it under that ceiling. Probes up to 64 KB cover the range.
- A single block is at most about 8 KB, and no datagram limit below that is documented, so sending one block per datagram is a candidate design to compare with generic chunking. The full-size delivery row should use the 229 KB payload.
- The decode-cost row should use 229 KB of JSON.

#### Step 1 results (2026-10-31)

```
Browser → localhost WebSocket probe
Run node ws-listener.mjs, then press Run. Page origin: https://francois.monniot.eu

Port 
8787
 Run
URL	Result	Detail
ws://127.0.0.1:8787	ALLOWED	received "hello from listener" (2196 ms)
ws://localhost:8787	ALLOWED	received "hello from listener" (2206 ms)
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36
```

Note: had to disable uBlock for this to work. Otherwise the call simply show as blocked. Behind permission prompt.

```
Browser → localhost WebSocket probe

Run node ws-listener.mjs, then press Run. Page origin: https://francois.monniot.eu

Port  Run
URL	Result	Detail
ws://127.0.0.1:8787	TIMEOUT (permission prompt?)	no event in 15 s (15001 ms)
ws://localhost:8787	TIMEOUT (permission prompt?)	no event in 15 s (15001 ms)
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15
```

Note: no permission was prompted, mixed content warning in the console

```
Browser → localhost WebSocket probe

Run node ws-listener.mjs, then press Run. Page origin: https://francois.monniot.eu
Port Run
URL	Result	Detail
ws://127.0.0.1:8787	ALLOWED	received "hello from listener" (2251 ms)
ws://localhost:8787	ALLOWED	received "hello from listener" (2255 ms)

Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0
```

Note: Behind permission prompt.

**Decision: the supported browsers are Chrome and Firefox, over plain `ws://`.** Safari is out of scope until it allows what they allow, so there is no `wss` with a local certificate, and the Tauri host stays under [Later](#later).

#### Step 2 and 3 results (2026-10-31)

Factorio 2.0.77 (build 84539, mac-arm64) on macOS 27. Step 2 ran on a minimal save with only the spike mod enabled and no Space Age; step 3 ran on the maintainer's Seablock save (5.6 MB, `script.dat` 11.8 MB). "Poll N" means `recv_udp` every N ticks. Raw output and log excerpts were in the udp-spike README, which stays in git history at commit a166164.

**Transport decision: chunked UDP.** A full-size snapshot arrived intact on the first attempt in both steps, at poll 1 and poll 10, so no [fallback](#if-the-udp-transport-does-not-work) is needed.

| Measurement | Result | Decision |
|---|---|---|
| Largest datagram, bridge→mod | 9,000 B arrives. macOS refuses sends of 16,000 B and up ("Message too long"), so Factorio's own ceiling is unmeasured. | Chunking stays; the OS cap of 9,216 B is the limit that matters |
| Largest datagram, mod→bridge | 1,000, 8,000 and 9,000 B arrive at full length | The mod's short messages are safe |
| Buffer growth (not a planned row) | Fresh socket: 100, 1,000 and 4,000 B pass, the first 8,000 B is lost, and the log shows growth to 8,192. The first 9,000 B is then lost and the log shows 16,384; later ones pass. From a fresh socket in step 3, two 9,000 B datagrams were lost, one per doubling. The only trace is an `Info` log line. The socket closes and reopens on every save load, and growth starts over. | [Warm-up](#the-bridge) before each snapshot |
| Binary safety of `payload` | All six cases match in length and checksum, including NUL, invalid UTF-8, all 256 byte values and 8 KB of random bytes. Step 2 compared by hand because of a spike bug; step 3 compared in the echo. | Raw JSON, no base64 |
| Loss and reordering | 10,000 × 100 B at 100/s and 1,000/s, at poll 1, 10 and 60: 0 lost, 0 out of order, 0 duplicates. Unthrottled (10,000 in 60 ms): 1,465 lost at poll 1 and 8,634 at poll 10 and 60, still in order. | All loss is buffer overflow, so resend exists for that, not for random loss |
| Behaviour at the buffer limit | 100 × 8,000 B between two `recv_udp` calls: exactly 32 arrived, 256,000 B, all whole. No log line. The two bursts fit a buffer of 262,144 B with about 92 B of overhead per datagram. That figure is inferred and approximate: 1,366 × 192 B overshoots by 128 B. | Window of 24 chunks |
| Behaviour while paused | Esc menu held for about 11 s and 30 s: ticks stopped, and 41 of 41 pings stayed buffered and were all delivered one tick after resuming. The title screen and saving were not tested. | Staleness counted in ticks; the bridge waits for the mod instead of timing out |
| Poll cost | No measurable cost at poll 1, 10 or 60, with or without Seablock: all near 60 UPS. Dips to about 53 appear with and without polling, so they are noise. Idle polling only, and a 60 UPS cap hides anything that fits in the tick. | The poll interval is chosen for latency, not cost |
| Latency | Round trip at poll 1: median 49 ms (43 to 51), and median 43 ms (37 to 65) with Seablock. At poll 10: median 128 ms (44 to 198). Events are raised exactly one tick after the `recv_udp` call, all in the same tick. | Poll 10: a round trip stays under 200 ms, enough for a window ack |
| Decode cost | `json_to_table` on 229 KB: 6.9 to 13.5 ms across all runs, Seablock included. `encode_string` and `decode_string` take under 3 ms, but on data with ten identical copies, so that is not representative. | Decode in one tick; no compression |
| Full-size delivery | 229 KB in 29 chunks of 8,000 B, 4 chunks per 20 ms: byte-exact with no resend, 40 blocks and 1,360 rows, four runs out of four (poll 1 and 10, both steps). Ack after 758 to 833 ms, which includes the echo's fixed 500 ms wait, so about 300 ms in practice. Only this one pacing was tried. | Generic chunking, not one block per datagram: the largest block (7.8 KB) leaves no margin under 8,000 B |
| `for_player` | `send_udp(port, data, 1)` and `recv_udp(1)` work, with the same round trip (42 to 48 ms) | The mod omits the argument |
| Port already in use | No crash on 2.0.77 ([S5](#sources-and-verification) does not reproduce). The log has `Opening Lua UDP Socket failed: ... Address already in use`, and the game runs with `send_udp` and `recv_udp` doing nothing, with no error. It happened by accident in step 3, with a stale echo holding the port. | Document the log line; `Disconnected` text points at it |
| `send_udp` cost (not a planned row) | Inferred, not measured directly: three sends in one command logged 20 ms apart, while logging alone takes under 1 ms. The 41 replies to a backlog, sent in a single tick, came out 16 to 29 ms apart (median 20). So one send costs about a tick, and a batch of replies stalls the game for that batch's total. | The mod sends rarely: one ack per window, at most one send per poll, nothing without a bridge |
| Sprite paths | `recipe/<name>` is valid, as are `item/`, `entity/` and `fluid/`, on vanilla and Seablock ids (`recipe/angels-plate-iron-2`, `fluid/angels-gas-nitrogen`) | Use these forms; snapshots carry the item `type` |
| `storage` | The 229 KB snapshot survives save and load; `script.dat` grows from 1,222 B to 273,000 B | As designed |
| Coexistence (step 3) | No error names the spike mod, `/probe` is free, the save loads in about 1.9 s and runs at 60 UPS. Size, binary-safety and full-size results match step 2. | No Seablock-specific handling |
| Multiplayer, achievements (optional) | Skipped: multiplayer is out of scope and nothing depends on achievements | [Open questions](#open-questions), [U4](#sources-and-verification) |

Not covered, to check while building Phases 2 and 3 (listed under [Open questions](#open-questions)): what happens without `--enable-lua-udp`, non-ASCII block names, the resend path, a full snapshot on a fresh socket, and a direct measurement of `send_udp`.

Exit criteria: every non-optional row is filled, and the transport and browser decisions are recorded, so all the exit criteria are met. The spike folder was deleted when the phase closed, so nothing is left to do for Phase 0.

### Phase 1 — snapshot contract

Snapshot schema in the planner, projection function and tests, generated JSON Schema, shared fixtures (small, a Seablock block with areas, a Seablock plan with connections and a loop). A final step produces the wire protocol document at `initiatives/in-game-viewer/protocol.md` (it moves to `spec/` when the code ships), designed from the Phase 0 measurements: chunk header, datagram size, pacing, handshake. It comes with shared datagram fixtures, because the Phase 2 mod needs the chunk format to reassemble snapshots.

### Phase 2 — mod

Receive (reassembling chunks as the wire protocol document defines them, with `send_udp` and `recv_udp` wrapped in `pcall`), validate, store, display; busted tests on the shared datagram fixtures and the manual checklist. `busted` and `luacheck` run under Lua 5.2 pinned in CI, and locally from a gitignored Lua tree.

### Phase 3 — bridge

Rust workspace implementing the wire protocol document from Phase 1, warm-up, pacing, resend logic, WebSocket endpoint, handshake and status; tests and release builds.

### Phase 4 — planner integration

Top-bar control, status, send. Update the spec and the README.

### Phase 5 — end to end and release

The local end-to-end script and the manual checklist, a release workflow that attaches the mod zip and the bridge binaries to the GitHub release, and a short "In-game viewer" section in the README that includes the supported browsers, the permission prompt and uBlock's blocking of the connection, how to set the launch option, and what the `Address already in use` line in `factorio-current.log` means. The bridge binary is unsigned, so macOS Gatekeeper blocks it after download, and the README explains how to allow it.

## If the UDP transport does not work

Phase 0 chose chunked UDP ([results](#step-2-and-3-results-2026-10-31)), so these are kept only as a record. They would come back if a later Factorio version changes the transport. The candidates were:

- **Exported mod data.** The planner exports a small mod (or a Lua data file inside one) that the player drops into the mods folder. No bridge and no launch flag, but the game must be restarted to load a new plan, and the mod would carry the plan in its own files.
- **RCON.** The bridge pushes snapshots through RCON commands. This only exists for a hosted multiplayer game, which the first version does not target.

No loss or cost thresholds were needed: paced traffic lost nothing, polling had no measurable cost, and a full-size snapshot arrived intact.

## Later

- **Safari.** Support it once it allows an HTTPS page to reach `ws://127.0.0.1`, as Chrome and Firefox do.
- **Tauri host.** A desktop app that bundles the planner and the bridge, removing the browser-to-localhost hop and the extra download. The library/binary split above keeps this open.
- **Multiplayer.** Once the behaviour is understood, show the same snapshot to every player.
- **Richer display.** Highlight a recipe's machines in the world, a mini-HUD for the block being built, progress against production statistics.

## Open questions

- **Multiplayer and determinism.** The API page says received packets are introduced into the game state through input actions and distributed to every client ([S1](#sources-and-verification)), which suggests storing a snapshot in `storage` is deterministic. This is a reading of the documentation, not a test, and the spike skipped it; multiplayer stays out of v1.
- **Game launched without the flag.** Every spike run had `--enable-lua-udp`, so what `send_udp` and `recv_udp` do without it is unknown. S1 says they need it; the mod wraps both calls in `pcall` from the start, so the design does not wait on the answer. The real behaviour is still to be confirmed in-game during Phase 2.
- **Non-ASCII block names.** The spike's snapshot was ASCII only, and the echo refused anything else. `payload` is binary-safe, but `json_to_table` on UTF-8 text is untested. Add a fixture and a line in the manual checklist.
- **Resend and fresh-socket delivery.** Every full-size run finished in round 0 on a socket that had already grown, so neither the resend path nor the warm-up has run against the real game. The end-to-end script covers both: a full snapshot right after a save load, and a transfer started while paused.
- **`send_udp` cost.** The 20 ms figure is inferred from log and reply timing ([results](#step-2-and-3-results-2026-10-31)). Time it with `game.create_profiler` in Phase 2; if it is wrong, the mod can answer more often, but the design does not depend on that.

## Sources and verification

Every external fact in this document is listed here. Entries marked **S** were read on the page named (fetched 2026-10-27; S7 to S11 were U1, U5 to U8 until Phase 0 step 0, and S12 was U2 until Phase 1); entries marked **M** were measured in the spike, on the versions named with the results; entries marked **U** are unverified (from memory or a search snippet) and must be checked before the design depends on them. Add the source of any new claim here.

| Id | Claim | Source |
|---|---|---|
| S1 | In 2.0.77, `helpers.send_udp(port, data, for_player?)` sends to a localhost UDP port (`data` is a `LocalisedString`); `helpers.recv_udp(for_player?)` dispatches `on_udp_packet_received` for packets received since the last call; both need `--enable-lua-udp`. The receive buffer is 256 KB and data is lost beyond it between two calls, including while the game is paused or saving. Events are not raised immediately because packets are introduced into the game state through input actions; the page asks to keep incoming traffic small because, in multiplayer, it goes through the server and is distributed to all clients. No send-size or rate limit is documented. | [LuaHelpers, 2.0.77](https://lua-api.factorio.com/2.0.77/classes/LuaHelpers.html) |
| S2 | `on_udp_packet_received` ("Called when new packets are processed by LuaHelpers::recv_udp") has the fields `payload` (`string`, "The packet data"), `source_port` (`uint16`, "The source port the packet was received from"), `player_index` (`uint32`, "The player index whose instance received this packet, or 0 if received on the server"), `name` and `tick`. There is no sender address field. The page says nothing about binary safety, encoding or a maximum size; the spike found `payload` binary-safe. | [Events, 2.0.77](https://lua-api.factorio.com/2.0.77/events.html) |
| S3 | `send_udp` and `recv_udp` are unchanged in the latest docs (2.1.24), apart from a note about the main chunk of the runtime stage. | [LuaHelpers, latest](https://lua-api.factorio.com/latest/classes/LuaHelpers.html) |
| S4 | `--enable-lua-udp <arg>`: "Set local port and enable helpers.send_udp() and helpers.recv_udp()". | [Command line parameters](https://wiki.factorio.com/Command_line_parameters) |
| S5 | Crash in 2.0.60 when `--enable-lua-udp` names a port already in use and a mod calls `send_udp`; staff (Rseding91): "This is now fixed for the next release." The fixed version is not named. Thread is in Resolved Problems and Bugs. The crash does not reproduce on 2.0.77. | [forums.factorio.com/129992](https://forums.factorio.com/129992) |
| S6 | Crash in 2.1.9 on `helpers.recv_udp(0)` on a headless server. A forum member replied "i posted a fix for this, pending review fixed for next release". Out of scope: we support 2.0.77 only. | [forums.factorio.com, p=697983](https://forums.factorio.com/viewtopic.php?p=697983) |
| S7 | `[item=<name>]`, `[recipe=<name>]` and `[entity=<name>]` rich text take the prototype's internal name. A `SpritePath` of the form `type/name` (or `type.name`) is valid for `item` (example `item/iron-plate`) and `entity` (example `entity/small-biter`); `recipe` is in the list of types but has no example, so `recipe/<name>` is the generic form, not a documented one; the spike confirmed it with `LuaHelpers::is_valid_sprite_path`, on modded recipes too. The 2.0.77 page lives under `concepts/`, not `types/`. | [Rich text](https://wiki.factorio.com/Rich_text), [SpritePath, 2.0.77](https://lua-api.factorio.com/2.0.77/concepts/SpritePath.html) |
| S8 | `info.json` `factorio_version` is a string `"number.number"` (for example `"2.0"`); a third number is rejected by the mod portal, and the field is "effectively mandatory". `dependencies` defaults to `["base"]` and entries read `"<prefix> name <op> <version>"` with prefixes `!`, `?`, `(?)`, `~` or none and operators `<`, `<=`, `=`, `>=`, `>`. The page has no `base >= 2.0.0` example, only the syntax. `name`, `version` (`number.number.number`, each 0 to 65535), `title` and `author` are mandatory. | [Mod structure, 2.0.77](https://lua-api.factorio.com/2.0.77/auxiliary/mod-structure.html) |
| S9 | The zip "must be named in the pattern of `{mod-name}_{version-number}`" and must contain a folder; "the folder inside the zip file does not have any naming restrictions". An unzipped mod folder is named `{mod-name}_{version-number}` or `{mod-name}`. `locale/` holds one subfolder per language code with at least one `*.cfg`; `migrations/` holds migration files. `info.json` is the only mandatory file. The wiki page [Tutorial:Mod structure](https://wiki.factorio.com/Tutorial:Mod_structure) is a stub pointing here. | [Mod structure, 2.0.77](https://lua-api.factorio.com/2.0.77/auxiliary/mod-structure.html) |
| S10 | `helpers.table_to_json(data) → string` and `helpers.json_to_table(json) → AnyBasic?` exist in 2.0.77; the latter returns `nil` for an invalid JSON string. The page states no size limit and does not say how JSON `null` is handled, so snapshots avoid `null`. The same page has `helpers.encode_string` ("Deflates and base64 encodes the given string") and `helpers.decode_string` ("Base64 decodes and inflates the given string"), which could carry a compressed snapshot. | [LuaHelpers, 2.0.77](https://lua-api.factorio.com/2.0.77/classes/LuaHelpers.html) |
| S11 | A `LocalisedString` is "an array where the first element is the key and the remaining elements are parameters"; it "can not be recursed deeper than 20 levels and can not have more than 20 parameters". No string length limit is documented. An API function that expects a `LocalisedString` also accepts a plain string, which is not translated. `send_udp`'s `data` is typed `LocalisedString`; neither page says how it is encoded on the wire; the spike found a plain string arrives at its full length, up to 9,000 B. | [LocalisedString, 2.0.77](https://lua-api.factorio.com/2.0.77/concepts/LocalisedString.html), [LuaHelpers, 2.0.77](https://lua-api.factorio.com/2.0.77/classes/LuaHelpers.html) |
| S12 | `z.toJSONSchema(schema, { target, io })` exists in the installed `zod` 4.6.7 (`^4.6.7` in `package.json`) and turns a Zod schema into a JSON Schema; with `target: 'draft-2020-12'` and `io: 'output'` it emits `$schema`, `const` for `z.literal`, `enum`, `pattern`, `minimum` and `minLength`, leaves optional keys out of `required`, and gives `z.strictObject` `additionalProperties: false`. Run in Phase 1 (`npm run contract`); the output is checked in as `contract/snapshot.schema.json`. | Installed `zod` 4.6.7, run in this repository; was U2 |
| M1 | In single-player the Esc menu pauses the game: ticks stop and no handler runs until it is closed. Packets sent meanwhile stay in the buffer. | Phase 0 step 2, probe 6 ([results](#step-2-and-3-results-2026-10-31)); was U9 |
| M2 | A page served over HTTPS can open `ws://127.0.0.1` and `ws://localhost` in Chrome 153 (with uBlock disabled, which otherwise blocks it) and Firefox 159, both behind a permission prompt. In Safari 27 the connection times out, with no prompt and a mixed-content warning in the console. | Phase 0 step 1 ([results](#step-1-results-2026-10-31)); was U3 |
| U4 | Whether the mod or `--enable-lua-udp` disables achievements. | Not stated in S1 to S6; the optional spike row was skipped |
