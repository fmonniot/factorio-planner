# Initiative: In-game plan viewer (mod and bridge)

Status: Future

Design notes for a read-only Factorio mod that shows the planner's blocks and plans in the game, and the bridge that carries them there. Nothing is implemented yet, and the first phase is a spike because some transport details (datagram size, loss in practice, behaviour while paused, browser-to-localhost access, multiplayer) are not yet measured (see [Open questions](#open-questions)). External facts are listed with their sources in [Sources and verification](#sources-and-verification).

---

## Goal

While playing, the player sees the plan they made in the planner: each block with its products, recipes, machine counts, power and imports, without alt-tabbing. The mod only **displays**; it never changes the game world and never sends edits back to the planner.

**Non-goals**:

- Editing a plan from the game, or any game-to-planner data flow beyond a handshake.
- Placing entities or blueprints, or checking what the player has built against the plan.
- Live production statistics compared with the plan.
- Multiplayer support (see [Open questions](#open-questions)); the first version targets single-player and a host who is the only player.

## Architecture

```
planner (browser)  ──WebSocket, localhost──▶  bridge (Rust)  ──UDP, localhost──▶  mod (Lua, in Factorio)
                                                 ▲                                      │
                                                 └───────── hello / ack (UDP) ──────────┘
```

- **Planner → bridge: WebSocket on localhost.** A browser cannot send UDP, so the bridge exposes a local WebSocket (or HTTP) endpoint that the planner connects to. The planner stays a static, client-side site: the connection is optional and only opened when the user asks for it.
- **Bridge → mod: UDP**, using Factorio's opt-in `--enable-lua-udp` option, which sets the local port the game listens on and enables `helpers.send_udp()` and `helpers.recv_udp()` ([S4](#sources-and-verification)). The game must be launched with the flag. The bridge never launches the game: setting the flag (a Steam launch option or a shortcut) is documented in the README.
- **Mod → bridge: UDP**, limited to a handshake (`hello` with protocol version and the data-set fingerprint) and acknowledgements. The mod sends no plan data.
- **The bridge is a Rust application** that builds to a single binary, so a player downloads one file. It is also the piece that could later be hosted by Tauri alongside the planner itself (see [Later](#later)); keeping the bridge a library crate plus a thin `main` makes that possible without a rewrite.
- **The planner solves, the mod displays.** The solve stays in the browser (`src/solver/`); the bridge relays results and never interprets them. This keeps one implementation of the solver.

## Supported Factorio version

**Factorio 2.0.77 only**, the maintainer's version, not the 2.1.x series. The mod pins it in `info.json` (a `base` dependency and the `2.0` game version, [U5](#sources-and-verification)), and the tests and the manual checklist run against it. Nothing in the 2.1 documentation is relied on, so the 2.1.9 `recv_udp` crash ([S6](#sources-and-verification)) is not our concern. Supporting 2.1 is a separate decision once it is the version the maintainer plays.

## What is sent

A **snapshot** is a projection of the planner's state, not the stored plan: only what the viewer needs, with ids that the game already knows. Sending ids, not names or icons, is the main simplification: the mod renders `[item=iron-plate]`, `[recipe=...]`, `[entity=...]` rich text and `item/<name>` sprites, so locale and icons come from the game, in the player's language, and no image data crosses the wire ([U1](#sources-and-verification)).

Per block, taken from the plan and its `SolverResult` ([spec/data-model.md](../../spec/data-model.md#solver-state-transient)):

- Name, colour, products with their rates.
- Recipe rows: recipe id, machine id, exact and rounded-up machine count, throughput, power; the area each row belongs to when the block has areas.
- Imports (the `unsatisfied` list, in its order) and the block's warnings, reduced to a code and the ids it names.
- Connections: source block, item, available rate.

Snapshots are versioned (`v`) and carry the plan's data-set stamp ([`PlanDataSetStamp`](../../spec/data-model.md#plandatasetstamp)). On receipt the mod checks that every item, recipe and machine id exists in the running game. Ids that do not exist are listed, not hidden, so a player running a different mod set from the plan's sees why rows are blank.

The projection is defined once, as a Zod schema in the planner (the same rule as `src/data/schema.ts`, which is the source of truth for all plan types). A JSON Schema generated from it (Zod 4 has an export for this, [U2](#sources-and-verification)) validates the Rust side's `serde` types and the Lua fixtures in tests.

## The mod

A `mod/` folder holding a normal Factorio mod (`info.json`, `control.lua`, `locale/`, `migrations/`).

- **Receive.** A thin adapter calls `helpers.recv_udp()` on a timer (for example every few ticks), which dispatches `on_udp_packet_received` for the packets that arrived since the last call ([S1](#sources-and-verification)); the event handler reassembles chunked snapshots, validates them, and swaps the new snapshot in atomically. A snapshot that fails validation or is incomplete leaves the previous one on screen.
- **Encoding.** The mod receives `payload` as a Lua string and decodes it with `helpers.json_to_table` ([U7](#sources-and-verification)). Snapshots carry ids, which are ASCII; whether the wire format is raw JSON or base64 depends on whether `payload` is binary-safe, measured in [Phase 0](#phase-0--spike). Everything the mod sends goes through `send_udp`, whose `data` is a `LocalisedString` with its own limits ([U8](#sources-and-verification)), so the mod's messages stay short.
- **Bridge port.** `send_udp(port, …)` needs the bridge's port, and `--enable-lua-udp` only sets the game's own listening port. The mod reads the bridge's port from a runtime-global mod setting (default shared with the bridge's default), so the player never edits Lua.
- **Store.** The accepted snapshot is kept in `storage`, so it survives save and load and shows after reloading a save without the bridge running.
- **Display.** A top-bar button opens a window per player: a block list on the left (block colour, name), and the selected block on the right with products, recipe rows (icon, machine, count, power), imports and warnings. Read-only: no input except selecting a block, collapsing sections and closing. A `Disconnected` / `Stale` indicator shows when the bridge has not sent for a while or the snapshot is older than the one in the planner. Silence is counted in game ticks, not wall-clock time, because no handler runs while the game is paused and the single-player main menu pauses it ([U9](#sources-and-verification)).
- **Pure logic split.** Decoding, validation, reassembly and view-model building are plain Lua modules with no `game` / `script` / `storage` access, so they run under busted. Event handlers and GUI code stay thin.
- **No effect on gameplay.** The mod changes no prototypes and no entities. Whether the mod, or `--enable-lua-udp`, disables achievements is not stated in the sources below ([U4](#sources-and-verification)).
- **Packaging.** The release workflow builds the mod as a zip and attaches it to the GitHub release, next to the bridge binaries. Factorio expects the zip to be named `<mod name>_<version>.zip` with a folder of the same name at its root; confirm against the mod structure page ([U6](#sources-and-verification)) when writing the workflow. The version in `info.json` is the release version.

## The bridge

A `bridge/` Cargo workspace with a library crate (protocol, chunking, session state) and a binary crate (CLI, sockets).

- Listens on a localhost WebSocket for the planner; sends UDP datagrams to the mod's port.
- **Chunking and reliability.** A snapshot is split into datagrams under a size cap, each with `snapshotId`, `index`, `count` and a checksum. UDP can drop and reorder even on loopback, so the mod acknowledges a complete snapshot and the bridge resends missing chunks. Only the newest snapshot matters, so an older one is dropped when a newer one arrives. The chunk size, and whether a snapshot is chunked at all, follow from the maximum datagram size measured in [Phase 0](#phase-0--spike).
- **Pacing.** The game's receive buffer is 256 KB and data beyond it is lost between two `recv_udp` calls, including while the game is paused or saving ([S1](#sources-and-verification)). The bridge therefore sends at most a bounded number of bytes per poll interval and waits for acknowledgements before sending more; the bound is set from the buffer-limit measurement in Phase 0.
- **Status.** Reports to the planner whether a mod is connected, and which protocol version and data-set it announced, so the planner can warn on a mismatch.
- **Configuration.** Ports and the allowed web origin via flags with defaults; binds to `127.0.0.1` only, and checks the `Origin` of WebSocket connections so a random web page cannot push snapshots. Nothing is persisted.
- **Single binary.** `cargo build --release` per platform in CI, attached to the GitHub release next to the mod zip.

## The planner side

- A connection control in the top bar (off by default) with the bridge address, a status badge (no bridge, bridge but no game, connected, data-set mismatch), and a **Send to Factorio** action; optionally resend automatically after a solve.
- A pure projection function (plan + `MultiBlockSolve` to snapshot) with unit tests in the `node` project, plus a Playwright spec against a fake bridge.
- Doc changes when this ships: [spec/ui.md](../../spec/ui.md) for the control, a new section in [spec/data-model.md](../../spec/data-model.md) or a new spec file for the snapshot and protocol, [spec/tech-stack.md](../../spec/tech-stack.md) for Rust and the CI jobs, and the README repository map.

## Testing

| Layer | What | Tool |
|---|---|---|
| Contract | Snapshot schema, shared fixtures, JSON Schema | Vitest; the same fixtures are read by the Lua and Rust tests |
| Planner | Projection, connection state, UI | Vitest, Playwright with a fake bridge |
| Bridge | Chunking, resend, reordering, `Origin` check, status | `cargo test` with loopback UDP and WebSocket clients |
| Mod logic | Decode, validate, reassemble, view-model | busted on plain Lua modules |
| Static | Types and globals | LuaLS with the Factorio definitions, `luacheck`, `clippy`, `cargo fmt --check` |
| End to end (local) | Real game, real bridge, a snapshot appears | A script the maintainer runs against their own Factorio 2.0.77 install, with a test save; **not in CI** |
| Manual | The GUI itself, in a real session | A checklist kept next to the mod |

**CI never runs Factorio**, because the game cannot be made available there for licensing reasons. CI covers every layer above the two bottom rows (contract, planner, bridge, mod logic under busted, static checks), which is why the mod's logic is split from the game API. The two bottom rows are run by hand before a release; the checklist is part of the release process.

A Factorio-free test of the transport is still possible: the bridge tests talk to a fake mod (a UDP socket that plays the mod's part, including dropped and reordered datagrams), and the mod's reassembly is tested in busted on the same datagram fixtures.

## Phases

### Phase 0 — spike

Throwaway code, kept under `initiatives/in-game-viewer/spike/` while the phase runs and deleted when it closes; the results stay in this document, each with its date and the Factorio build. The phase answers the [open questions](#open-questions) that decide the design, in three steps.

**Step 0 — read and measure, no spike code.**

- Read the pages behind S2 (the fields of `on_udp_packet_received`), U1, U5, U6, U7 and U8, and move each to an **S** entry with its source.
- Measure the size of a realistic snapshot on the planner side, using the [share-by-url](../share-by-url/plan.md) sample plan scaled to ten times its size. That sample is a 10 % mid-game Seablock export, so the scaled plan approximates a complete Seablock run. A hand-built JSON of the fields listed in [What is sent](#what-is-sent) is enough; the real projection comes in Phase 1. This sets the range the Factorio probes need to cover.

**Step 1 — browser to localhost (no Factorio).** A small page served from the GitHub Pages deployment opens `ws://127.0.0.1:<port>` against a throwaway WebSocket listener. Try current Chrome, Firefox and Safari, and record whether the connection is allowed, blocked, or behind a permission prompt ([U3](#sources-and-verification)). If it is blocked somewhere, decide between `wss` with a local certificate, a supported-browser list, or moving the [Tauri host](#later) up.

**Step 2 — UDP in Factorio 2.0.77.** A spike mod and a few-line Rust UDP echo, run by hand on a minimal save with only the spike mod enabled (Nullius adds startup time and noise). The bridge→mod direction matters most, because that is where plan data flows; the mod→bridge direction only has to carry short messages. Fill in the table:

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

**Step 3 — coexistence.** Load the spike mod in the maintainer's Nullius save and repeat the round trip once.

Exit criteria: every non-optional row is filled in this document, the transport decision is recorded (chunked UDP, single datagram, or a [fallback](#if-the-udp-transport-does-not-work)), the browser-to-localhost outcome is recorded, and the U entries read in Step 0 are converted to S entries.

### Phase 1 — snapshot contract

Transport-independent, so it can start before Phase 0 closes. Snapshot schema in the planner, projection function and tests, generated JSON Schema, shared fixtures (small, a Seablock block with areas, a Nullius plan with connections and a loop). The wire protocol (chunk header, datagram size, pacing) belongs to Phase 3 and is designed from the Phase 0 measurements.

### Phase 2 — mod

Receive, validate, store, display; busted tests and the manual checklist.

### Phase 3 — bridge

Rust workspace, wire protocol (from the Phase 0 measurements), pacing, resend logic, WebSocket endpoint, status; tests and release builds.

### Phase 4 — planner integration

Top-bar control, status, send. Update the spec and the README.

### Phase 5 — end to end and release

The local end-to-end script and the manual checklist, a release workflow that attaches the mod zip and the bridge binaries to the GitHub release, and a short "In-game viewer" section in the README that includes how to set the launch option.

## If the UDP transport does not work

Phase 0 decides whether UDP is used. If loss on loopback stays unacceptable after resend, `recv_udp` costs too much to poll, or the datagram limits make a snapshot undeliverable, the candidates are:

- **Exported mod data.** The planner exports a small mod (or a Lua data file inside one) that the player drops into the mods folder. No bridge and no launch flag, but the game must be restarted to load a new plan, and the mod would carry the plan in its own files.
- **RCON.** The bridge pushes snapshots through RCON commands. This only exists for a hosted multiplayer game, which the first version does not target.

The loss and cost thresholds that select a fallback are recorded with the Phase 0 results.

## Later

- **Tauri host.** A desktop app that bundles the planner and the bridge, removing the browser-to-localhost hop and the extra download. The library/binary split above keeps this open.
- **Multiplayer.** Once the behaviour is understood, show the same snapshot to every player.
- **Richer display.** Highlight a recipe's machines in the world, a mini-HUD for the block being built, progress against production statistics.

## Open questions

- **Datagram size and fields.** The API page documents a 256 KB receive buffer and no send-size or rate limit ([S1](#sources-and-verification)); the event's fields (`on_udp_packet_received`) are not read yet ([S2](#sources-and-verification)). Reading them is Phase 0 step 0; the practical datagram size is measured in step 2.
- **Port already in use.** A 2.0.60 report describes a crash when the UDP port is held by another process and a mod calls `send_udp`; staff replied it is "fixed for the next release" without naming a version ([S5](#sources-and-verification)). We target 2.0.77, which is later, but the spike should repeat the case, and the bridge should check that its own port is free and report a clear error.
- **Multiplayer and determinism.** The API page says received packets are introduced into the game state through input actions and distributed to every client ([S1](#sources-and-verification)), which suggests storing a snapshot in `storage` is deterministic. This is a reading of the documentation, not a test; multiplayer stays out of v1 until the spike checks it.
- **Browser to localhost.** A page served over HTTPS opening `ws://127.0.0.1` may be allowed or blocked depending on the browser's mixed-content and local-network access rules ([U3](#sources-and-verification)). Tested on the GitHub Pages deployment in Phase 0 step 1, which decides between `wss` with a local certificate and a documented browser list.
- **Size.** How big is a snapshot for a large plan? Measured before the Factorio probes (Phase 0 step 0) with the [share-by-url](../share-by-url/plan.md) sample plan scaled to ten times its size (a complete Seablock run); it decides whether chunking, and compression, are needed at all.
- **Pause behaviour.** What the mod receives after the game was paused or the main menu was open ([S1](#sources-and-verification), [U9](#sources-and-verification)); it shapes the staleness indicator and the resend timing.
- **Staleness.** Whether the mod should ask for a refresh on load, or only react to pushes.

## Sources and verification

Every external fact in this document is listed here. Entries marked **S** were read on the page named (fetched 2026-10-27); entries marked **U** are unverified (from memory or a search snippet) and must be checked before the design depends on them. Add the source of any new claim here.

| Id | Claim | Source |
|---|---|---|
| S1 | In 2.0.77, `helpers.send_udp(port, data, for_player?)` sends to a localhost UDP port (`data` is a `LocalisedString`); `helpers.recv_udp(for_player?)` dispatches `on_udp_packet_received` for packets received since the last call; both need `--enable-lua-udp`. The receive buffer is 256 KB and data is lost beyond it between two calls, including while the game is paused or saving. Events are not raised immediately because packets are introduced into the game state through input actions; the page asks to keep incoming traffic small because, in multiplayer, it goes through the server and is distributed to all clients. No send-size or rate limit is documented. | [LuaHelpers, 2.0.77](https://lua-api.factorio.com/2.0.77/classes/LuaHelpers.html) |
| S2 | `on_udp_packet_received` is in the 2.0.77 event index ("Called when new packets are processed by LuaHelpers::recv_udp"). Its fields were not read. | [Events, 2.0.77](https://lua-api.factorio.com/2.0.77/events.html) |
| S3 | `send_udp` and `recv_udp` are unchanged in the latest docs (2.1.24), apart from a note about the main chunk of the runtime stage. | [LuaHelpers, latest](https://lua-api.factorio.com/latest/classes/LuaHelpers.html) |
| S4 | `--enable-lua-udp <arg>`: "Set local port and enable helpers.send_udp() and helpers.recv_udp()". | [Command line parameters](https://wiki.factorio.com/Command_line_parameters) |
| S5 | Crash in 2.0.60 when `--enable-lua-udp` names a port already in use and a mod calls `send_udp`; staff (Rseding91): "This is now fixed for the next release." The fixed version is not named. Thread is in Resolved Problems and Bugs. | [forums.factorio.com/129992](https://forums.factorio.com/129992) |
| S6 | Crash in 2.1.9 on `helpers.recv_udp(0)` on a headless server. A forum member replied "i posted a fix for this, pending review fixed for next release". Out of scope: we support 2.0.77 only. | [forums.factorio.com, p=697983](https://forums.factorio.com/viewtopic.php?p=697983) |
| U1 | A mod can render items, recipes and entities with `[item=…]`, `[recipe=…]`, `[entity=…]` rich text and `item/<name>` sprites, so no names or icons need to be sent. | From memory; check the rich text and sprite path docs |
| U2 | Zod 4 can export a JSON Schema. | From memory; check against the installed `zod` version (`^4.6.7` in `package.json`) |
| U3 | A page served over HTTPS may open `ws://127.0.0.1` in current Chromium and Firefox; Safari differs, and Chromium's local-network-access rules may add a permission prompt. | From memory; test on the GitHub Pages deployment (Phase 0 step 1) |
| U4 | Whether the mod or `--enable-lua-udp` disables achievements. | Not stated in S1 to S6 |
| U5 | The mod's `info.json` can pin the game version (`factorio_version`, a `base` dependency). | From memory; check the `info.json` documentation |
| U6 | Mod zip layout and name: `<name>_<version>.zip` with a `<name>_<version>/` folder at the root. | From memory; check [Tutorial:Mod structure](https://wiki.factorio.com/Tutorial:Mod_structure) (not fetched) |
| U7 | `helpers.json_to_table` (and `helpers.table_to_json`) exist in 2.0.77 and decode a JSON string in the runtime stage. | From memory; check the LuaHelpers page (S1) |
| U8 | `LocalisedString` limits (number of parameters, string length) apply to the `data` argument of `send_udp`. | From memory; check the LocalisedString page, then the spike |
| U9 | In single-player the main menu pauses the game, so no tick handlers run until it is closed. | From memory; observe in the Phase 0 pause test |
