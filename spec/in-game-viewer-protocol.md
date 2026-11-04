# In-game viewer: wire protocol

This document defines how a snapshot gets from the planner to the mod: the WebSocket link from planner to bridge and the UDP link between bridge and mod. The bridge and the mod are built from it. If a behaviour is not written here, it is not part of the protocol, and [contract/datagrams/](../contract/datagrams/) settles any doubt about bytes. The reasons and the measurements behind the design are in [plan.md](../initiatives/archive/in-game-viewer/plan.md), mainly its [Step 2 and 3 results](../initiatives/archive/in-game-viewer/plan.md#step-2-and-3-results-2026-10-31).

---

## Decisions at a glance

1. **All recovery goes through the ping.** The bridge sends a ping on a schedule, the mod answers with `hello`, and `hello` says what the mod stores and what it is assembling. A lost end-of-window, a lost report, a save load and a game restart are all repaired by what the next `hello` shows. Apart from a short burst of probes, no timer resends anything, so a paused game cannot be flooded.
2. **The planner computes the snapshot id, as a content hash.** An id says *which* snapshot, never *which is newer*. "Older than the planner's newest" therefore means "different from the planner's newest", and the planner's newest travels in every ping.
3. **A probe starts every transfer and names the snapshot.** The mod only takes chunks of the snapshot named by the last probe. This gives supersession one simple rule, and it also carries the warm-up.
4. **Probes repeat in bursts of three, not without limit.** Repeating a chunk-sized probe every 250 ms until the mod answers would fill the buffer of a paused game in about 8 s. A burst of three covers the measured losses, and the next `hello` starts another burst, so against a running game probes still repeat until the mod answers.
5. **Pings back off while the mod is silent, and snap back when it speaks.** A fixed 5 s ping would overflow the buffer after 48 minutes of pause with a window in it. With the back-off that takes 12.7 hours on the most pessimistic numbers ([Buffer budget](#buffer-budget)). Hearing the mod pulls the next ping back to 5 s, and sending a snapshot pings at once (the nudge), so a game started long after the bridge is found as soon as the player presses Send.
6. **The planner can announce an id without sending the snapshot.** Otherwise `Stale` could only appear during the second or so a transfer takes, and a plan edited but not sent would never show as stale.
7. **Bridge-to-mod headers are fixed-width ASCII.** The mod cuts fields at fixed offsets, checks the header with one anchored pattern on the header bytes only, and never scans a payload.

---

## Shared values

### Snapshot bytes

The snapshot is compact JSON (`JSON.stringify` of the projection) in UTF-8. The bytes are sent as they are: no base64, no compression, no checksum. Only the planner and the mod look inside them. To the bridge they are opaque.

Every rate in a snapshot is in items per minute, and a row's `throughput` is in executions per minute. The snapshot carries no unit: it is fixed by this document. A mod that shows rates per second (its `/min` and `/s` toggle) converts for display only, by dividing by 60; nothing is sent back and the snapshot is unchanged.

### Snapshot id

The planner computes it: the **first 16 lowercase hexadecimal characters of the SHA-256 of the snapshot bytes**, using `crypto.subtle.digest`, which both the HTTPS site and `http://localhost` can reach. For the `small` fixture that is `b50eac1dfa0cae79`.

- Equal content gets an equal id, across a bridge restart too, so sending identical content again costs no datagram.
- An id has no order. The word "older" in this protocol always means "different from the newest". Going A, B, then back to A works with no special case, which an ordered id would get wrong.
- 64 bits are ample: a collision needs billions of snapshots, and the worst result is one snapshot not being delivered.
- Neither the bridge nor the mod recomputes the hash. The mod cannot afford it (a Lua checksum took 14 to 48 ms in the spike), and the bridge has nothing to protect against: a wrong id can only come from a planner bug.
- A bridge-side counter or random id was rejected. Either one changes on every bridge restart, so identical content would be sent again, and a counter restarting at 1 would make its order meaningless.

### No id

Where a field has no snapshot to name, it holds sixteen dashes: `----------------`. It is the same width as an id, so fixed offsets still hold.

### Protocol version

`PROTOCOL_VERSION` is `1`, written `FP01` on the wire. It is separate from the snapshot's `v`: the protocol version covers this document, and `v` covers the JSON inside. Two versions are compatible only if they are equal; there is no range and no negotiation. Any change an older reader would misread bumps the version; adding a `status` field that a reader ignores when it does not know it is not such a change.

### Ports

| What | Default | Set by |
|---|---|---|
| Game UDP port | `34198` | `--enable-lua-udp` on the game; a flag on the bridge, which reports its value in `status` |
| Bridge UDP port | `34199` | A flag on the bridge; the mod's runtime-global setting |
| Bridge WebSocket port | `34199`, TCP | The same bridge flag: one number for both |

The bridge sends and receives on one UDP socket bound to `127.0.0.1` and the bridge port. A UDP error caused by the game's port being closed (Windows reports one on the next receive) means nothing: the bridge ignores it and carries on.

---

## Constants

| Name | Value | Where it comes from |
|---|---|---|
| `CHUNK_PAYLOAD` | 8,000 B | Plan: measured. The largest payload of a chunk |
| `CHUNK_HEADER` | 42 B | This document |
| `MAX_DATAGRAM` | 8,042 B | Header plus payload. 1,174 B under the 9,216 B macOS cap |
| `PROBE_HEADER` | 37 B | This document |
| `PING_BYTES` | 23 B | This document |
| `EOW_BYTES` | 33 B | This document |
| `WS_ENVELOPE` | 32 B | This document |
| `WINDOW_CHUNKS` | 24 chunks | Plan: 24 × 8,134 B = 195,216 B of the 262,144 B buffer |
| `PACE_CHUNKS` | 4 chunks | Plan: the only pacing the spike tried |
| `PACE_INTERVAL` | 20 ms | Plan: the same |
| `MAX_CHUNKS` | 1,000 chunks | Chosen: about 35 times a full Seablock snapshot |
| `MAX_SNAPSHOT_BYTES` | 8,000,000 B | `MAX_CHUNKS` × `CHUNK_PAYLOAD`. A guard, not a target. The planner enforces it before sending |
| `MAX_FRAME_BYTES` | 10,000,031 B | `WS_ENVELOPE` plus 9,999,999, the largest length the 7-digit envelope field can state. The bridge's frame limit, above the guard so that `too-large` can always be sent |
| `MAX_REPORT_RANGES` | 12 ranges | A window has at most 12 separate gaps |
| `MAX_REPORT_BYTES` | 124 B | 29 B prefix plus 12 ranges of up to 7 characters and 11 commas |
| `MAX_UNKNOWN_IDS` | 9,999 ids | Chosen: the count saturates here |
| `POLL_TICKS` | 10 ticks | Plan: measured. A round trip stays under 200 ms |
| `FLUSH_OFFSET` | 2 ticks | Packets are raised 1 tick after `recv_udp`, all in one tick (measured), so all are handled by tick 2 |
| `PROBE_INTERVAL` | 250 ms | Slowest measured round trip at poll 10 (198 ms), plus the flush tick, rounded up |
| `PROBE_BURST` | 3 probes | Two measured losses, one per doubling, plus one that arrives |
| `PROBE_REFILL_AFTER` | 1,000 ms | Long enough that a `hello` this late cannot have crossed the probes in flight |
| `PING_INTERVAL` | 5 s | Chosen. Plan says "every few seconds"; each `hello` stalls the game about 20 ms, so 0.4 % |
| `PING_INTERVAL_MAX` | 300 s | Chosen from the [Buffer budget](#buffer-budget) |
| `PING_BACKOFF_DIVISOR` | 16 | Chosen from the [Buffer budget](#buffer-budget) |
| `QUIET_AFTER` | 15 s | 3 × `PING_INTERVAL` |
| `GAME_UPS` | 60 ticks per s | The game's speed at `game.speed` 1 |
| `DISCONNECT_TICKS` | 1,080 ticks | 18 s at `GAME_UPS`: 3 × `PING_INTERVAL` plus 3 s, so one late ping does not flicker the indicator. The mod multiplies it by `game.speed` |
| `NO_PROGRESS_LIMIT` | 8 reports | Chosen. Paced traffic lost nothing, so eight fruitless reports in a row is a bug, not bad luck |
| `PLANNER_RETRY` | 5 s | Chosen |

Sizes in the [Buffer budget](#buffer-budget) use 92 B of overhead per datagram, from the plan.

---

## Planner and bridge: WebSocket

### Connection

The planner opens `ws://127.0.0.1:34199/` when the user turns the connection on. The bridge checks `Origin` during the handshake and answers HTTP 403 to an origin it does not allow. A handshake with no `Origin` header is accepted, on purpose: the bridge only listens on the loopback interface, and a browser always sends `Origin`, so a request without one comes from a non-browser process on the same machine. Such a process can send any `Origin` it likes, so rejecting the missing header would add no security. The check exists to stop other web pages from reaching the bridge. No WebSocket subprotocol is used, because a browser reports a failed one with no detail, and the planner must be able to say what is wrong.

Any number of planners may connect at once. All receive every `status`, and the last snapshot received wins, whoever sent it.

There are four messages, and one frame carries one message.

| Direction | Message | Frame |
|---|---|---|
| Planner to bridge | `snapshot` | Binary |
| Planner to bridge | `announce` | Text, JSON |
| Bridge to planner | `status` | Text, JSON |
| Bridge to planner | `error` | Text, JSON |

### `snapshot`: the envelope

A binary frame: a 32-byte ASCII envelope, then the snapshot bytes. This envelope is all the bridge reads; it never parses what follows.

| Offset | Length | Content |
|---|---|---|
| 0 | 4 | `FP01` |
| 4 | 1 | space |
| 5 | 1 | `S` |
| 6 | 1 | space |
| 7 | 16 | Snapshot id |
| 23 | 1 | space |
| 24 | 7 | Snapshot length in bytes, decimal, zero-padded |
| 31 | 1 | space |
| 32 | rest | The snapshot bytes |

The `small` fixture, 752 B, in a frame of 784 B:

```
FP01 S b50eac1dfa0cae79 0000752 {"v":1,"dataSet":{"id":"kompetenz-seablock",...
```

The frame length must equal 32 plus the length field. The length must be between 1 and `MAX_SNAPSHOT_BYTES`. A frame that breaks these is answered with `error` and changes nothing. The bridge decides from the envelope alone, in this order: another protocol version (`protocol-mismatch`); an envelope that is not as laid out above, or a length of 0 (`bad-envelope`); a length above `MAX_SNAPSHOT_BYTES` (`too-large`); a frame length other than 32 plus the field (`bad-envelope`). `too-large` therefore never depends on the body.

**The limits agree.** The 7-digit field can state up to 9,999,999 B, above `MAX_SNAPSHOT_BYTES`, so every snapshot the planner could build has an envelope that can be written. The bridge's WebSocket library must accept frames up to `MAX_FRAME_BYTES`, which is above 32 B plus `MAX_SNAPSHOT_BYTES`; otherwise the library would close the connection on an oversized frame before the bridge could answer. A frame above `MAX_FRAME_BYTES` is closed by the library (code 1009). A planner never sends one, because it refuses a snapshot above `MAX_SNAPSHOT_BYTES` before sending ([What the planner does](#what-the-planner-does)).

### `announce`

```
{"type":"announce","protocol":1,"id":"8a7dc7be68ce742c"}
```

"This is the id of the planner's current plan, which I have not sent." It sets the bridge's `newest` and nothing else: it does not start a transfer and does not touch the snapshot the bridge holds. See [The Stale signal](#the-stale-signal).

### `status`

The bridge's whole state, as one object. It is sent once on connection, before anything else, and again whenever a field changes. A planner only ever needs the latest one.

```
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"newest":"8a7dc7be68ce742c","mod":{"link":"connected","protocol":1,"stored":"b50eac1dfa0cae79","unknownIds":0},"transfer":{"id":"8a7dc7be68ce742c","state":"sending","sent":24,"count":29}}
```

| Field | Presence | Meaning |
|---|---|---|
| `type` | always | `status` |
| `protocol` | always | The bridge's `PROTOCOL_VERSION`, as a number |
| `bridge` | always | The bridge's release version, for display |
| `gamePort` | always (a planner tolerates its absence) | The UDP port the bridge sends to; the planner shows it as the game's launch option, `--enable-lua-udp <port>` |
| `newest` | when known | The id set by the last `snapshot` or `announce` |
| `mod.link` | always | See below |
| `mod.protocol` | once heard | The version in the last `hello` |
| `mod.stored` | once heard, if the mod stores a snapshot | The id the mod holds |
| `mod.unknownIds` | once heard, if the mod stores a snapshot | [Ids the running game lacks](#the-unknown-id-count), for the data-set badge |
| `transfer` | when the bridge holds a snapshot | The delivery of that snapshot |
| `transfer.id` | with `transfer` | Its id |
| `transfer.state` | with `transfer` | See below |
| `transfer.sent` | with `transfer` | Chunks sent at least once; changes when a window ends |
| `transfer.count` | with `transfer` | Its chunk count |
| `transfer.reason` | when `rejected` or `failed` | The mod's reason word, or `no-progress` |

`gamePort` was added without a protocol version bump: a planner ignores fields it does not know, so an older planner keeps showing `34198`, and a planner that reads a `status` without `gamePort` (an older bridge) treats it as `34198`. A planner also ignores a `gamePort` that is not a port number, and keeps showing the last valid one it was given (across a reconnect) rather than the default.

`mod.link` is one of:

- `none`: no mod has been heard since the bridge started.
- `connected`: the mod spoke within `QUIET_AFTER`.
- `quiet`: the mod spoke before but not within `QUIET_AFTER`. The game is paused, saving, at the title screen or closed; the bridge cannot tell which.
- `mismatch`: the last `hello` had another protocol version.

`transfer.state` is one of:

- `waiting`: the bridge holds the snapshot and no mod is reachable to take it.
- `sending`: probing, sending a window or waiting for a report, with the mod speaking.
- `stalled`: the same, with `mod.link` `quiet`. It resumes on its own.
- `delivered`: the mod stores this id.
- `rejected`: the mod refused it, and `reason` says why.
- `failed`: the bridge gave up after `NO_PROGRESS_LIMIT` attempts.

Examples: no game yet; no game yet, on a bridge started with another `--game-port`; a delivered snapshot with two unknown ids; a transfer stalled by a pause; a refused snapshot; a bridge and a mod of different versions.

```
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"mod":{"link":"none"}}
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":40000,"mod":{"link":"none"}}
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"newest":"b50eac1dfa0cae79","mod":{"link":"connected","protocol":1,"stored":"b50eac1dfa0cae79","unknownIds":2},"transfer":{"id":"b50eac1dfa0cae79","state":"delivered","sent":1,"count":1}}
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"newest":"8a7dc7be68ce742c","mod":{"link":"quiet","protocol":1,"stored":"b50eac1dfa0cae79","unknownIds":0},"transfer":{"id":"8a7dc7be68ce742c","state":"stalled","sent":24,"count":29}}
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"newest":"8a7dc7be68ce742c","mod":{"link":"connected","protocol":1,"stored":"b50eac1dfa0cae79","unknownIds":0},"transfer":{"id":"8a7dc7be68ce742c","state":"rejected","sent":29,"count":29,"reason":"json"}}
{"type":"status","protocol":1,"bridge":"0.1.0","gamePort":34198,"mod":{"link":"mismatch","protocol":2}}
```

### `error`

```
{"type":"error","code":"too-large"}
```

| Code | Sent for |
|---|---|
| `bad-envelope` | A binary frame whose envelope is malformed or whose length disagrees |
| `too-large` | A well-formed envelope above `MAX_SNAPSHOT_BYTES` |
| `protocol-mismatch` | A binary frame or an `announce` of another protocol version |
| `bad-message` | A text frame that is not JSON, has an unknown `type`, or has a bad id |

An `error` goes only to the connection that sent the offending frame. The bridge keeps the connection open after it and its state does not change.

### What the planner does

1. On open, it waits for the first `status` and compares `protocol` with its own. If they differ it shows that the bridge and the planner must be updated together, sends nothing, and keeps the socket open. The launch option it shows for the game (`--enable-lua-udp <port>`) takes its port from `gamePort`, and is `34198` before the first `status` or when the field is missing.
2. **Restore, but only onto an empty bridge.** If it has sent a snapshot since the page loaded and the first `status` shows that the bridge holds nothing (no `transfer` and no `newest`), it sends those same bytes again. It keeps the last bytes it sent for this purpose. This restores a restarted bridge. If the first `status` shows anything held, it sends nothing: with two planners connected, the bridge may hold a newer snapshot sent from the other one, and an older one must not replace it unasked. Only the first `status` after a connection decides this; later ones never trigger a restore.
3. It sends `announce` with the current plan's id, unless the bridge now holds exactly that plan: the restore in step 2 just sent those bytes, or the first `status` already reports that id as `newest`. A bridge that holds something else (for example a plan another planner sent) is therefore told which plan is current. A plan from before the connection was switched off is not announced; the planner builds a fresh one after switching on.
4. After each solve it computes the id of the new snapshot and sends either `snapshot` (auto-send, or the Send action) or `announce`. **Before sending a `snapshot` it checks the size.** Above `MAX_SNAPSHOT_BYTES` it sends no `snapshot`, tells the player that the plan is too large for the in-game viewer, and sends `announce` instead, so the mod still shows `Stale`.
5. **On `error`,** it shows the code in plain words and resends nothing automatically. An `error` answers the planner's most recent frame; if that was a `snapshot`, the planner forgets those bytes, so step 2 can never send a refused snapshot again. Only the player's Send, after the plan has changed or the cause is fixed, tries again.
6. If the socket closes while the connection is switched on, it retries every `PLANNER_RETRY`, and repeats from step 1. Because of steps 2 and 5, a reconnect loop never resends bytes the bridge refused.

The planner always sends the bytes for a Send, even when `mod.stored` already equals the id, so that the bridge can repair a later load of an older save.

---

## Bridge and mod: UDP

### Rules for every datagram

- Every datagram begins with the same 6 bytes: `FP`, two decimal digits of protocol version, a space, and a type letter. **These 6 bytes never change between versions.** The letters are unique across both directions.
- Bridge-to-mod datagrams are fixed-width. Numbers are decimal and zero-padded.
- Mod-to-bridge datagrams are short ASCII strings, split on single spaces, each with an exact number of fields. Numbers are decimal and not padded, except `round`, which is echoed as it came. A number with a leading zero (`0002`, `01`) is dropped, and so is one above its bound (`unknownIds` above `MAX_UNKNOWN_IDS`, a chunk index above `MAX_CHUNKS` - 1).
- Ids are exactly 16 characters of `0-9a-f`, or the no-id value where a field allows it.
- A reader drops silently anything that breaks these rules. A dropped datagram changes no state, gets no answer and does not count as hearing from the other side.

Lua's `tonumber` accepts `0x10`, ` 12` and `1e3`, so the mod checks digits with a pattern, not by converting.

### Bridge to mod

| Letter | Message | Size |
|---|---|---|
| `P` | ping | 23 B |
| `W` | probe (warm-up) | 8,042 B |
| `C` | chunk | 43 to 8,042 B |
| `E` | end of window | 33 B |

#### `P`: ping

| Offset | Length | Content |
|---|---|---|
| 0 | 6 | `FP01 P` |
| 6 | 1 | space |
| 7 | 16 | `newest`: the planner's newest id, or the no-id value |

Exactly 23 B. The bridge knows of a newer plan, and the mod is sitting on an older one:

```
FP01 P 8a7dc7be68ce742c
```

A fresh bridge that knows nothing:

```
FP01 P ----------------
```

#### `W`: probe

| Offset | Length | Content |
|---|---|---|
| 0 | 6 | `FP01 W` |
| 6 | 1 | space |
| 7 | 16 | Snapshot id. Never the no-id value |
| 23 | 1 | space |
| 24 | 4 | `count`: number of chunks, 1 to `MAX_CHUNKS` |
| 28 | 1 | space |
| 29 | 7 | `bytes`: snapshot length, 1 to `MAX_SNAPSHOT_BYTES` |
| 36 | 1 | space |
| 37 | 8,005 | Padding: `.` (0x2E) |

The bridge always sends exactly `MAX_DATAGRAM` bytes, even for a small snapshot, so that a probe that arrives proves a full chunk fits. The mod reads the first 37 B and ignores the rest, whatever its length. It drops a probe unless `count` ≤ `bytes` ≤ `count` × `CHUNK_PAYLOAD`.

```
FP01 W b50eac1dfa0cae79 0006 0000752 ......(8,005 dots)
```

#### `C`: chunk

| Offset | Length | Content |
|---|---|---|
| 0 | 6 | `FP01 C` |
| 6 | 1 | space |
| 7 | 16 | Snapshot id |
| 23 | 1 | space |
| 24 | 4 | `index`, from 0, below `count` |
| 28 | 1 | space |
| 29 | 4 | `count`, as in the probe |
| 33 | 1 | space |
| 34 | 7 | `bytes`, as in the probe |
| 41 | 1 | space |
| 42 | 1 to 8,000 | Payload: raw snapshot bytes |

The bridge cuts the snapshot every `CHUNK_PAYLOAD` bytes, with no regard for characters, so the last chunk is the only short one. The format allows smaller chunks, and the fixtures use them, so the mod must not assume a size: any payload of 1 to 8,000 B is valid, and the chunks need only add up to `bytes`. Payload bytes may be any value, including NUL. The header holds no payload length: it is the datagram's length minus 42.

The third chunk of the `small` fixture cut at 128 B, 170 B in all:

```
FP01 C b50eac1dfa0cae79 0002 0006 0000752 -assembling-machine-6","machines":0.143,"machinesCeil":1,"throughput":60,"inputs":[{"id":"iron-plate","type":"item","rate":120}]
```

To parse it, the mod takes the first 42 B with `string.sub`, matches them with one anchored pattern, and takes the payload with one more `string.sub`. No bit operation is involved, and no search touches the payload, so the cost does not depend on what the payload holds. A whole window arriving in one tick is 24 such parses.

#### `E`: end of window

| Offset | Length | Content |
|---|---|---|
| 0 | 6 | `FP01 E` |
| 6 | 1 | space |
| 7 | 16 | Snapshot id |
| 23 | 1 | space |
| 24 | 4 | `round`, from 0 |
| 28 | 1 | space |
| 29 | 4 | `upto`: every chunk with an index below this has been sent at least once, 1 to `MAX_CHUNKS` |

Exactly 33 B. Round 1 of a transfer whose seven chunks have all been sent:

```
FP01 E b50eac1dfa0cae79 0001 0006
```

It asks the mod for a report. Asking again is harmless: the answer describes the current state.

### Mod to bridge

These all go through `send_udp` as plain strings, never as a localised table.

| Letter | Message | Fields after the letter | Largest size |
|---|---|---|---|
| `H` | hello | `stored` `unknownIds` `assembling` | 45 B |
| `R` | ready | `id` | 23 B |
| `M` | missing report | `id` `round` `ranges` | 124 B |
| `A` | final ack | `id` `unknownIds` | 28 B |
| `N` | refusal | `id` `reason` | 31 B |

#### `H`: hello

The mod's whole state, in reply to a ping.

- `stored`: the id of the stored snapshot, or the no-id value.
- `unknownIds`: [how many of its ids the game lacks](#the-unknown-id-count), 0 to `MAX_UNKNOWN_IDS`; 0 when nothing is stored.
- `assembling`: the id being reassembled, or the no-id value.

```
FP01 H b50eac1dfa0cae79 2 ----------------
FP01 H ---------------- 0 ----------------
FP01 H b50eac1dfa0cae79 2 8a7dc7be68ce742c
```

#### `R`: ready

The mod has taken this snapshot as its reassembly target. The answer to a probe.

```
FP01 R b50eac1dfa0cae79
```

#### `M`: missing report

The answer to an end-of-window for a snapshot still incomplete. `round` is the four digits of the end-of-window, echoed. `ranges` lists the chunks not yet held with an index below `upto`, lowest first, and is `-` when there are none, which means "send the next window".

- `ranges` is entries joined by commas. An entry is an index, or `first-last` for two or more in a row. Indices are not padded.
- Entries are strictly ascending and do not touch or overlap. An index is 0 to 999 (`MAX_CHUNKS` - 1), unpadded.
- There are at most `MAX_REPORT_RANGES` entries. If there are more gaps, the mod stops at twelve. The rest are reported in a later round.

```
FP01 M b50eac1dfa0cae79 0000 -
FP01 M b50eac1dfa0cae79 0001 1,3-5,9
```

**The worst case stays short.** The report can never exceed 124 B, whatever the snapshot size: 12 entries of at most `999-999` with 11 commas. With two-digit indices, as in a 29-chunk snapshot, it stays under 100 B; the `report-capped` fixture, 41 chunks with every other one lost, comes to 59 B. Losing a whole window is one range, `0-23`. Building a report loops over at most `upto` chunks, and happens at most once per poll.

#### `A`: final ack

The mod stores this id. `unknownIds` is as in `hello`.

```
FP01 A b50eac1dfa0cae79 2
```

#### `N`: refusal

The mod finished reassembling this id and refused it. The previous snapshot stays on screen. `reason` is a lowercase word.

| Reason | Meaning |
|---|---|
| `length` | The chunks do not add up to `bytes` |
| `json` | `json_to_table` returned `nil` |
| `version` | The snapshot's `v` is not one this mod reads |
| `invalid` | The JSON is not a snapshot |

```
FP01 N b50eac1dfa0cae79 json
FP01 N b50eac1dfa0cae79 length
```

---

## Version handshake

There is no separate handshake message. The ping and the `hello` carry the version in their first 6 bytes, and each side compares it with its own.

**Bridge and mod.**

- The mod reads bytes 2 and 3 of any datagram that begins `FP`, two digits, a space and a letter. If they are not its version, it reads nothing further, whatever the type. It sets its mismatch flag, shows a `Protocol mismatch` indicator telling the player to update the mod or the bridge, keeps the stored snapshot on screen, and answers with a `hello` in its own version.
- A datagram of the mod's own version clears the flag.
- The bridge reads bytes 2 and 3 of any datagram it hears. A datagram whose first 6 bytes are `FP`, two digits other than its own version, a space and `H` is a `hello` of another version. It sets `mod.link` to `mismatch` and `mod.protocol` to that version, and **reads nothing after those 6 bytes**, because another version may lay out its hello differently. It counts as hearing the mod. It sends no probe and no chunk, and any transfer goes back to `Waiting`. It keeps pinging on the usual schedule, so a mod updated later is picked up. Every other message of another version is dropped.

```
FP02 H 5 any other layout, never read
```
- This is why the 6-byte prefix can never change: it is what two different versions still have in common.

**Planner and bridge.** The first `status` gives the bridge's version, and the planner stops there on a mismatch ([What the planner does](#what-the-planner-does)). The bridge also answers a `snapshot` or an `announce` of another version with `protocol-mismatch`, in case the planner sends one anyway.

**Planner and mod.** The snapshot's `v` is checked by the mod after decoding. A mismatch is refused with `version` and reaches the planner as `transfer.state` `rejected`.

Bump `PROTOCOL_VERSION` for any change an old reader would misread. The bridge and the mod ship together in one release, so this should only appear when one of them is left behind.

---

## Signals

### Disconnected

The mod counts ticks since it last received a valid datagram of any protocol version. Above `DISCONNECT_TICKS` × `game.speed`, or before the first datagram after a load, it shows `Disconnected`. The bridge's pings follow wall-clock time, and a faster game runs more ticks in the same time (`GAME_UPS` × `game.speed` per second), so the threshold scales with the speed: at speed 8 it is 8,640 ticks, still 18 s of wall-clock time, and the indicator does not flicker between healthy pings. The mod reads `game.speed` each time it checks. Ticks stop during a pause, so a pause does not trip it. The `Disconnected` text points at the launch option (`--enable-lua-udp <port>`, with `<port>` the bridge's `--game-port`, 34198 by default: the mod cannot learn the game's port, so the text does not claim a number) and `factorio-current.log`, because the mod cannot tell a missing bridge from a game whose socket failed.

The indicator shows one thing at a time: `Disconnected`, else `Protocol mismatch`, else `Stale`.

### The Stale signal

The mod keeps the `newest` of the last ping it received. `Stale` shows when all of these hold:

- the mod stores a snapshot,
- `newest` is not the no-id value,
- `newest` differs from the stored id.

The check runs when a ping arrives and again when a snapshot is accepted. The bridge sets its `newest` from each `snapshot` and `announce`. The next ping carries it: within `PING_INTERVAL` while the mod answers, and at once for a `snapshot`, by the nudge ([Pings](#pings)). So:

- The plan is edited and not sent: `announce` changes `newest`, and the mod shows `Stale` until the player sends it. This is the case the signal exists for.
- The plan is sent: `Stale` may show for the moment the transfer takes, which is accurate.
- The player undoes the edit: the id returns to the stored one, `announce` says so, and `Stale` clears.
- The bridge restarted: `newest` is the no-id value, so `Stale` clears until the planner reconnects. The mod does not claim what it does not know.

### The unknown-id count

After validating a snapshot, the mod counts the distinct item, fluid, recipe and machine ids in it that the running game does not have. `virtual` ids are exempt. The count saturates at `MAX_UNKNOWN_IDS`. It is stored in `storage` next to the snapshot and sent in `A` and in every `H`. The count in `H` means a restarted bridge, or a save loaded later, still reports it. The mod recomputes it in `on_configuration_changed`, because a changed mod set changes the answer. The bridge passes it on as `mod.unknownIds`, and it drives the planner's data-set mismatch badge.

---

## The bridge

### Pings

The bridge sends the first ping when it starts. Each following one is due `clamp(silence / PING_BACKOFF_DIVISOR, PING_INTERVAL, PING_INTERVAL_MAX)` after the previous one. `silence` is measured when the previous ping leaves: the time since the last valid datagram from a mod, or since the bridge started. A datagram counts when it is of this version, or is a `hello` of another version. So while the mod answers, a ping goes out every 5 s; the back-off begins at 80 s of silence; and it reaches one ping every 5 minutes at 80 minutes.

**Hearing the mod.** The due time is fixed when a ping leaves, from the silence at that moment, so after a long pause it can lie minutes ahead although the mod is back. Therefore, on every valid datagram from a mod, the bridge sets the next ping's due time to `min(due, now + PING_INTERVAL)`. A mod coming back from a pause answers the pings it finds buffered, and the first answer brings the schedule down to 5 s. Without this, the planner would show `quiet` and the mod `Disconnected` for up to 5 minutes after the game returned, and everything that moves only on a `hello` would wait just as long: a `Waiting` transfer, a lost end-of-window, a refilled probe budget. The rule never makes a ping later, so it adds nothing to the [Buffer budget](#buffer-budget) while the mod is silent.

**Nudge.** When the bridge receives a `snapshot` message, it sends one ping at once, carrying the new `newest`, unless it has already nudged within the last `PING_INTERVAL`. This holds in every phase and even for the same snapshot sent again, so that pressing Send always wakes a slow schedule: a game started long after the bridge was found answers within a poll, instead of up to 5 minutes later. The nudge does not change the schedule, but its answer pulls the schedule down by the rule above. When a probe follows, the ping goes first, so if both arrive in one poll the probe's answer replaces the hello. `announce` does not nudge, and neither does a planner connecting: the next scheduled ping carries the news, and a Send nudges anyway.

Pings continue during a transfer. The bridge's only timers are the pacing, the probe interval and this schedule. **No timer resends a chunk or an end-of-window.**

### Transfer state

The bridge holds one snapshot, the `target`: the bytes of the last `snapshot` message. Holding it, and only it, is what "only the newest matters" means here. It also holds `newest`, a pending window, the current `round` and `upto`, and what it last heard from the mod. Nothing is persisted.

The chunk count is `ceil(bytes / CHUNK_PAYLOAD)`.

```
                    ┌───────────── hello shows the mod lost it ──────────────┐
                    ▼                                                        │
Waiting ─ hello ─▶ Probing ─ ready ─▶ Sending ─ end of window ─▶ Awaiting ───┤
                    │                    ▲                          │        │
                    │                    └───────── report ─────────┘        │
                    └───────── ack ─▶ Delivered ◀───────── ack ──────────────┘

Delivered goes back to Probing when a hello shows another snapshot.
A refusal leads to Rejected, and no progress to Failed. Both wait for a new snapshot,
or for a hello that shows the mod stores the target, which leads to Delivered.
```

`Idle` is the phase before the first snapshot. The table is the definition and the diagram is a map. `target` in the table means the id of the target. An event not listed for a phase is ignored.

| Phase | Event | Action | Next phase |
|---|---|---|---|
| any | `snapshot`, see [Receiving a snapshot](#receiving-a-snapshot) | | |
| any | valid datagram from the mod | Record it for the ping schedule, and set the next ping's due time to `min(due, now + PING_INTERVAL)`. A datagram of this version sets the link to `connected`. Update `stored` and `unknownIds` from `H`, or from `A` on the target | |
| `Waiting`, `Probing`, `Sending`, `Awaiting` | `hello` of another version | Link becomes `mismatch` | `Waiting` |
| `Idle`, `Delivered`, `Rejected`, `Failed` | `hello` of another version | Link becomes `mismatch` | Unchanged |
| `Waiting` | `H`, `stored` = target | | `Delivered` |
| `Waiting` | `H`, `stored` ≠ target | | `Probing` |
| `Probing` | entering | Round 0, `upto` 0, nothing to retry. Send a probe under the [probe rules](#probes) | |
| `Probing` | `R` on target | Build the first window | `Sending` |
| `Probing` | `A` on target | | `Delivered` |
| `Probing` | `N` on target | | `Rejected` |
| `Probing` | `H`, `stored` = target | | `Delivered` |
| `Sending` | pacing slot, every `PACE_INTERVAL` | Send up to `PACE_CHUNKS` chunks of the window. After the last, send the end-of-window | `Awaiting` after the last |
| `Sending`, `Awaiting` | `A` on target | | `Delivered` |
| `Sending`, `Awaiting` | `N` on target | | `Rejected` |
| `Sending`, `Awaiting` | `H`, `stored` = target | | `Delivered` |
| `Sending`, `Awaiting` | `H`, `stored` ≠ target, `assembling` ≠ target | The mod lost the transfer (a load or a restart). Drop the window | `Probing` |
| `Awaiting` | `H`, `assembling` = target | Send the same end-of-window again. This is how a lost end-of-window or a lost report is repaired | `Awaiting` |
| `Awaiting` | `M` on target, this `round`, the run reaches `NO_PROGRESS_LIMIT` | Stop, with reason `no-progress`. Send nothing | `Failed` |
| `Awaiting` | `M` on target, this `round`, otherwise | Update the run, then build the next window | `Sending` |
| `Delivered` | `H`, `stored` ≠ target | A save with another snapshot was loaded | `Probing` |
| `Rejected`, `Failed` | `H`, `stored` = target | The mod holds it after all (a save that stores it was loaded, or a late window completed). Clear the reason | `Delivered` |
| `Rejected`, `Failed` | `H`, `stored` ≠ target, or any other answer | Nothing is sent. Only a new `snapshot` message tries again | Unchanged |

A report with another `round`, or any answer naming another id, is stale and ignored.

**Building a window.** Take the indices from the report's ranges, lowest first, at most `WINDOW_CHUNKS`. A report naming an index at or above `upto` is dropped. Then, while the window is below `WINDOW_CHUNKS`, add unsent chunks from `upto` upward. `upto` becomes the highest index ever sent, plus one. `round` goes up by one, except on the first window, which is round 0. The window is sent in the order built. If it comes out empty, which a correct mod never causes, the bridge stays in `Awaiting`.

**No progress.** A report is *fruitless* when its ranges are the same as the previous report's **and** its `upto` did not advance: `upto` here is that of the window the report answers, compared with the previous window's. The bridge counts the run of consecutive fruitless reports, counting the first report of the run, and the run starts again at 1 on any report that is not fruitless. When the run reaches `NO_PROGRESS_LIMIT` it stops and moves to `Failed` with reason `no-progress`. The run also starts again when the bridge enters `Probing`. Two things matter here. First, comparing only the ranges would fail a healthy transfer of more than 8 windows, since every report is `-` while `upto` climbs. Second, the comparison cannot be of the whole message, because `round` differs every time and nothing would ever repeat. The reason `no-progress` is also given after `NO_PROGRESS_LIMIT` probe bursts in a row with no `R`. Warm-up losses are not counted against a transfer in any other way: they are lost probes and nothing else, and the status shows no error for them.

### Probes

A probe is chunk-sized, so unlimited repeats would fill the buffer of a paused game. The rules:

1. The bridge starts probing only with the link `connected`. Otherwise the transfer is in `Waiting`.
2. It may send `PROBE_BURST` probes, `PROBE_INTERVAL` apart, and stops there. This budget is shared by all transfers and is **not** refilled by a new snapshot.
3. The budget is refilled by any `M`, `A` or `N`, and by a `hello` heard more than `PROBE_REFILL_AFTER` after the last probe. Each of these proves the mod has drained what came before. `R` does not refill it, because it may answer an early probe while later ones still sit in the buffer. A `hello` sooner than that may have been sent before the probe arrived.
4. Probing continues when the budget refills, so in practice: three probes at 250 ms intervals, then three more after the next `hello`, for as long as the game runs.

The rule "the bridge never resends on a timeout alone" holds. A repeated probe is the only thing sent again on a timer, and only within a budget that no timer refills.

### Receiving a snapshot

For a `snapshot` message with id `X`:

1. `newest` becomes `X`. The [nudge](#pings) goes out, if it is due.
2. If `X` is the target and the phase is `Waiting`, `Probing`, `Sending`, `Awaiting` or `Delivered`, stop. This is the no-op.
3. The target becomes these bytes. Any window in progress is dropped at once, with no end-of-window. The bytes of the old target are released.
4. If the link is not `mismatch` and the mod's last known `stored` is `X`, go to `Delivered`. No datagram is sent.
5. If the link is `connected`, go to `Probing`.
6. Otherwise go to `Waiting`.

Step 2 does not apply to `Rejected` or `Failed`, so sending a refused snapshot again is an explicit retry.

An `announce` sets `newest` and does nothing else.

---

## The mod

### Polling and answering

The mod does this on a fixed cycle of `POLL_TICKS` ticks:

- at `tick % POLL_TICKS == 0`, it calls `recv_udp` inside `pcall`;
- at `tick % POLL_TICKS == FLUSH_OFFSET`, it sends what is in the answer slot, if anything, inside `pcall`, and empties the slot.

The packet handler never calls `send_udp`. It only fills the slot:

- **There is one slot.** Every answer replaces what is there, **except `hello`, which only fills an empty slot**.
- The slot is filled only when a datagram arrives, so the mod never sends without having heard from a bridge. With no bridge running, `send_udp` is never called.

So the mod sends at most once per poll, whatever arrives. Another mod's `recv_udp` can raise our handler at any time, and the rule still holds, since only the flush sends. The flush tick also needs no assumption about where packet events fall relative to `on_tick`.

Replacing means the latest word wins, which is what the bridge wants. In a batch holding a window of A and then a probe of B, the mod ends up with `R` for B. An ack lost to this is harmless, because the next `hello` carries the same fact.

### Where the state lives

| State | Where | After a load |
|---|---|---|
| Stored snapshot, its id, its unknown-id count | `storage` | Kept. This is what a save holds |
| Reassembly: target id, `count`, `bytes`, chunks held | Plain Lua state, outside `storage` | **Lost.** Next `hello` has `assembling` empty, and the bridge starts again with a probe |
| Answer slot | Plain Lua state | Lost. The bridge's question is repeated by the next ping |
| `newest` | Plain Lua state | Lost. The next ping restores it |
| Last-heard tick | Plain Lua state | Lost, so `Disconnected` shows until the next ping |
| Mismatch flag | Plain Lua state | Lost. The next ping restores it |

Reassembly stays out of `storage` so a half-received snapshot is never written into a save, and because a load also closes the socket, so whatever was in flight is gone anyway. Nothing has to run on load: this state simply starts empty.

### Reassembly

The state is `Empty`, or `Assembling` of one target. Only the handler changes it, and storing happens in one step, inside it.

On a **probe** with id `X`:

| Condition | Action | Slot |
|---|---|---|
| `X` is the stored id | Reassembly becomes `Empty` | `A` |
| `Assembling` `X` | Nothing, what has arrived is kept | `R` |
| Anything else | Discard any reassembly, start `Assembling` `X` with this `count` and `bytes` | `R` |

On a **chunk** with id `X`:

| Condition | Action | Slot |
|---|---|---|
| Not `Assembling` `X` | Drop | unchanged |
| `count` or `bytes` differ from the probe's | Drop | unchanged |
| This index is already held | Drop: the first copy wins | unchanged |
| Otherwise | Hold the payload. If all `count` chunks are held, [finish](#finishing) | unchanged, or as finish sets it |

On an **end of window** with id `X`:

| Condition | Action | Slot |
|---|---|---|
| `X` is the stored id | Nothing | `A` |
| `Assembling` `X`, `upto` above `count` | Drop | unchanged |
| `Assembling` `X` | Build the report for chunks below `upto` | `M` |
| Otherwise | Drop | unchanged |

On a **ping**: keep its `newest`, recheck `Stale`, and fill the slot with `H` if it is empty.

On **any valid datagram** of this version: record the tick and clear the mismatch flag. On one of another version: record the tick, set the flag, and fill the slot with `H` if it is empty.

So a transfer can be replaced at any moment by a probe, and the replaced chunks are dropped at the first check. Chunks with no probe before them, which is what arrives after a load, are dropped the same way.

### Finishing

When the last chunk is held, in that same handler call, the mod:

1. joins the chunks in index order with `table.concat`, byte for byte;
2. checks the total length against `bytes`, or refuses with `length`;
3. decodes with `helpers.json_to_table`, or refuses with `json`;
4. checks `v`, or refuses with `version`;
5. validates the shape, or refuses with `invalid`;
6. counts unknown ids, and swaps the new snapshot into `storage` with its id and count;
7. fills the slot with `A`.

A refusal fills the slot with `N`. Either way the reassembly becomes `Empty` and the previous snapshot is untouched until step 6. A multi-byte character split across two chunks needs no handling, because nothing looks at the bytes before step 3. The decode takes 7 to 14 ms and happens only here, in one tick.

An end-of-window that arrives after a finish gets `A` if the snapshot was accepted, and is dropped if it was refused, by which time `N` has already gone out.

If the bridge goes away during a reassembly, the mod keeps it until the next probe or load. It is one snapshot's worth of memory, and `assembling` in `hello` shows it to the next bridge.

---

## Buffer budget

The game's buffer is 262,144 B, and each datagram costs about 92 B more than its size. A full-size datagram costs 8,134 B.

**The worst case in the buffer** is a paused game holding a whole window, its end-of-window, and a full probe burst for a newer snapshot: 27 × 8,134 B + 125 B = **219,743 B**, which leaves **42,401 B**. Without the newer snapshot, the window and end-of-window take 195,341 B and leave 66,803 B. No more can be sent while the mod is silent: the next window needs a report, and the probe budget needs an answer.

**Pings.** A ping is 23 B, so it nominally costs 115 B. That is not safe to rely on: the only small-datagram measurement is 1,366 datagrams of 100 B filling the buffer, or 192 B each. A smaller datagram may cost the same as that one, so the table also shows 192 B.

| Pings sent during a pause lasting | Count | Nominal, 115 B | Pessimistic, 192 B |
|---|---|---|---|
| 80 s | 17 | 2 KB | 3 KB |
| 10 minutes | 50 | 6 KB | 10 KB |
| 1 hour | 79 | 9 KB | 15 KB |
| 8 hours | 164 | 19 KB | 31 KB |
| 24 hours | 356 | 41 KB | 68 KB |

**Result.** With back-off, pings fit under these pauses:

| Already in the buffer | Room | Lasts, at 115 B | Lasts, at 192 B |
|---|---|---|---|
| Window, end-of-window and a probe burst | 42,401 B | 25.0 hours | 12.7 hours |
| Window and end-of-window | 66,803 B | 42.7 hours | 23.3 hours |
| Nothing | 262,144 B | 7.7 days | 4.5 days |

Without back-off, a fixed 5 s ping would fill the room after a window in 48 minutes, and an empty buffer in 3.2 hours, which is why the back-off exists.

These tables count scheduled pings. **Nudges** come on top: one per `snapshot` message, at most one per `PING_INTERVAL`, so at most 720 an hour: 83 KB at 115 B, or 138 KB at 192 B. A hundred sends in one pause, which at that rate takes at least 8 minutes, cost 12 KB nominal or 19 KB pessimistic. The limit is reached only by sending a snapshot every 5 s into a paused game, as auto-send during continuous editing would. Nudges alone then fill the 42,401 B left by a window, its end-of-window and a probe burst after 18 minutes at 192 B, or 31 minutes at 115 B (the scheduled pings of the tables above add to that). The hearing rule of [Pings](#pings) adds nothing here: it only moves a due time earlier once the mod is answering.

Past those limits the buffer overflows, in principle only by the pings themselves: by then nothing else is being sent, the datagrams already held arrived earlier, and the dropped ones carry no information a later ping does not repeat. That the kernel drops the newest arrivals rather than the oldest is standard behaviour, but the spike did not record which ones arrived.

The cost of the back-off is rediscovery. If the game was closed, pings are not buffering at all, but the bridge cannot know that, so a game started after a long absence waits for the next ping: up to `silence` / 16, and never more than 5 minutes. A Send nudges a ping at once, so a player who starts the game and presses Send is found within a poll; nothing else needs the mod yet, so an `announce` or a connecting planner leaves the wait as it is.

---

## Walkthroughs

Message lines are shortened: the `FP01` prefix is left out, `X` and `Y` stand for ids, `-` for the no-id value, and each line is one direction. Chunks are written `C X 0000`.

### Normal delivery

The planner sends a full Seablock snapshot of 228,548 B, which is 29 chunks. The mod has answered a recent ping, so the link is `connected`.

```
planner → bridge   snapshot X
bridge  → planner  status: transfer sending, sent 0 of 29
bridge  → mod      W X 0029 0228548
mod     → bridge   R X                        (flushed 2 ticks after the next poll)
bridge  → mod      C X 0000 ... C X 0023      (4 chunks every 20 ms, about 120 ms)
bridge  → mod      E X 0000 0024
mod     → bridge   M X 0000 -
bridge  → planner  status: sent 24 of 29
bridge  → mod      C X 0024 ... C X 0028
bridge  → mod      E X 0001 0029
                   mod joins, decodes, validates, stores
mod     → bridge   A X 0
bridge  → planner  status: delivered, mod.stored X, unknownIds 0
```

Three round trips at poll 10 plus sending time is under a second. The mod sends three times, so about 60 ms spread across separate ticks.

### Warm-up: a fresh socket after a save load

The save holds the snapshot `X` and the bridge holds `Y`. The load reopened the socket, so its buffer starts small.

```
bridge  → mod      P Y                        (a small ping passes)
mod     → bridge   H X 0 -                    (stored X, not the target)
bridge  → mod      W Y ...                    lost: socket grows to 8,192 B
         250 ms later
bridge  → mod      W Y ...                    fits, or is lost once more: grows to 16,384 B
         250 ms later
bridge  → mod      W Y ...                    arrives
mod     → bridge   R Y
                   window as in normal delivery
```

The spike never tried an 8,042 B datagram on a socket that had just grown to 8,192 B, so the second probe may or may not pass. Three probes cover both. If all three were somehow lost, the next `hello` would refill the budget. Lost probes appear nowhere in the status; the transfer is `sending` throughout.

### A lost chunk

```
bridge  → mod      C X 0000, 0002, 0004       (0001 and 0003 never arrive)
bridge  → mod      E X 0000 0005
mod     → bridge   M X 0000 1,3
bridge  → mod      C X 0001, C X 0003
bridge  → mod      E X 0001 0005
mod     → bridge   A X 0
```

If new chunks remained, they would fill the rest of the resend window. If the report itself or the end-of-window were lost, the bridge would wait; at the next ping, `H` shows `assembling` X, and the bridge sends the end-of-window again (the `lost-end-of-window` fixture).

### The game paused mid-transfer

The Esc menu stops ticks, so the mod stops polling, and the bridge is not told.

```
bridge  → mod      C X ... up to C X 0023, E X 0000 0024     (all buffered)
                   no answer comes; the bridge waits and resends nothing
bridge  → mod      P X, P X, P X ...          (buffered; 5 s apart, slowing after 80 s)
         15 s after the mod last spoke
bridge  → planner  status: link quiet, transfer stalled
                   ... any length of pause ...
                   player resumes
mod                drains in one poll: chunks, end-of-window, every ping
mod     → bridge   M X 0000 -                 (one answer, whatever arrived)
bridge  → planner  status: link connected, transfer sending
bridge  → mod      next window
                   the bridge heard the mod: the next ping is due in 5 s, not at the old back-off time
```

The transfer simply continues. No timeout fired, and nothing was resent. If the pause was long, the next scheduled ping may have been minutes away; hearing the mod pulls it back to `PING_INTERVAL`, so `quiet` clears and the `hello`-driven repairs resume within seconds. A pause begun during `Probing` is the same, except that at most three probes are buffered.

### A newer snapshot arrives mid-transfer

The bridge is sending `A`, and the planner sends `B`.

```
bridge  → mod      C A 0000 ... C A 0009
planner → bridge   snapshot B
                   A is dropped at once: no more chunks, no end-of-window
bridge  → mod      W B ...
                   mod discards the chunks of A, starts assembling B
mod     → bridge   R B
                   window of B as usual
```

If a chunk of `A` arrives after the probe, the mod drops it, since it is not the target. If the mod answers about `A` in the meantime, the bridge ignores it because the id is not the target. If the planner goes back to `A` later, `A` is treated like any other snapshot and sent from the start.

If the game is paused when this happens, the probes join the buffered window, which is the worst case in the [Buffer budget](#buffer-budget). At resume the batch holds chunks of A, then a probe of B, and the answer slot ends up holding `R B`.

### A bridge restart

The bridge loses everything, since nothing is persisted. The mod keeps its stored snapshot, and may have a reassembly in progress.

```
                   mod keeps displaying; pings stop
         after DISCONNECT_TICKS
mod                shows Disconnected
                   bridge starts
bridge  → mod      P ----------------
mod     → bridge   H X 0 -
planner            WebSocket closed, retrying every 5 s; reconnects
bridge  → planner  status: link connected, mod.stored X, no transfer, no newest
                   the bridge holds nothing, so the planner restores
planner → bridge   snapshot X                 (the bytes it last sent)
bridge  → mod      P X                        (the nudge, if one is due)
bridge  → planner  status: delivered          (no datagram for the snapshot: X is already stored)
planner → bridge   announce Y                 (only if the plan changed since)
bridge  → mod      P Y                        (Stale, if Y differs from X)
```

With a reassembly in progress, `H` shows `assembling`. If the planner's snapshot is that same id, the bridge goes to `Probing`, the mod answers `R` and keeps what it has, and the chunks it already holds are dropped as duplicates.

### Two planners

Two tabs are open on one bridge. The first sent `B`, which the second has never seen. The bridge restarts, and both reconnect.

```
tab 1   → bridge   (connects first)  first status: nothing held
tab 1   → bridge   snapshot B                 (restore: the bridge held nothing)
tab 2   → bridge   (connects)        first status: transfer B, newest B
                   tab 2 holds older bytes A and sends nothing: restoring would overwrite B
tab 2   → bridge   announce Y                 (only if its plan differs from the bytes it holds)
```

A bridge that is not restarted shows a transfer in the first `status` of any tab, so a tab that reloads never overwrites what is held. A tab that wants A delivered uses Send, which is the player's explicit decision.

### A snapshot above the limit

The plan has grown past `MAX_SNAPSHOT_BYTES`.

```
planner            computes 8,400,000 B; above the guard: no snapshot is sent
planner → bridge   announce Z                 (the mod shows Stale)
planner            tells the player the plan is too large for the in-game viewer
```

A client without the guard that sends the frame anyway gets `error too-large` from the envelope alone, because the frame limit is `MAX_FRAME_BYTES`. The planner shows it, forgets the bytes and resends nothing. A reconnect after that has nothing to restore.

### A game restart

```
                   game closes; pings go nowhere
         15 s after the mod last spoke
bridge  → planner  status: link quiet (transfer stalled, if one was running)
                   pings slow down with the silence
                   game starts, save loads, mod polls
bridge  → mod      P Y                        (within silence / 16, at most 5 minutes)
mod     → bridge   H X 0 -
```

If the player presses Send in the planner once the game is up, the bridge does not wait for that ping: the nudge sends `P Y` at once, and the `hello` that answers it brings the schedule back to 5 s.

From here it is the [warm-up walkthrough](#warm-up-a-fresh-socket-after-a-save-load) if `X` differs from the target, and nothing at all if it matches. A transfer that was in flight restarts from a probe, because `H` shows nothing assembling. Nothing else needs doing: to the protocol, a game restart is a long silence followed by a load.

### A loaded save with an older snapshot

The player loads an old save, whose snapshot is `X`. The bridge's target is `Y`, which it delivered earlier, so it is in `Delivered`.

```
bridge  → mod      P Y
                   mod shows Stale
mod     → bridge   H X 0 -
bridge  → mod      W Y ...                    (Delivered, stored ≠ target: back to Probing)
                   warm-up, then delivery as usual
mod     → bridge   A Y 0
                   mod stops showing Stale
```

The load also reverted the mod's stored snapshot, and the delivered `Y` goes into the new game's `storage`. If the bridge holds no snapshot, as after a restart with no planner, nothing is sent. `newest` is then whatever the planner announced, and the mod shows `Stale` if it knows of a difference.

### No bridge running

The mod polls every 10 ticks inside `pcall`, hears nothing, shows the stored snapshot and `Disconnected`, and **never calls `send_udp`**, because its answer slot only fills when a datagram arrives. Polling has no measurable cost. A game launched without `--enable-lua-udp` looks the same to the mod. The planner's WebSocket fails to open, and it shows no bridge and retries every `PLANNER_RETRY` while the connection is switched on.

---

## Fixtures

[contract/datagrams/](../contract/datagrams/) holds the shared fixtures, generated by `npm run contract`. Hexadecimal is the truth everywhere: a `text` field only makes a file readable. The Lua and Rust tests read them; a Vitest test replays them through a reader built from this document, and fails if the files drift from their generator.

**`messages.json`** is every message in both directions and on both links. `hex` is the message; `fields` is what a parser must return; `frame` is `text` or `binary` for WebSocket; `from` and `to` name the sides. A parser must decode `hex` into `fields`, and an encoder must turn `fields` into `hex`. In `fields`, `null` stands for the no-id value. In a `missing` field, each range is `[first, last]`.

**`malformed.json`** lists inputs that a reader must drop: `reader` says which (`mod`, `bridge-udp`, or `bridge-ws`, which also gives the `error` code to answer with). A `hello` of another version is not in this file: it is a valid message, in `messages.json`, and the reader takes only its first 6 bytes.

**`case-*.json`** is one scenario for the mod's reassembly, and for many of them, the bridge's windows too.

| Field | Meaning |
|---|---|
| `case`, `summary` | Name and description |
| `snapshot` | When present: `fixture` it came from, `id`, `bytes`, `chunkSize`, and `hex`, the bytes the accepted chunks must join to |
| `start.stored` | What the mod's `storage` holds at the start: `{id, unknownIds}` or `null` |
| `idCheck.unknownIds` | What the test's stand-in for the game's id check returns on an accepted snapshot |
| `polls[]` | One poll each, in order |
| `polls[].arrive[]` | The datagrams in order of arrival: `type`, `text`, `hex` |
| `polls[].answer` | What the flush sends after this poll, or `null` for nothing. `state`, when present, is the bridge's phase after hearing it: `delivered`, `rejected` or `failed` |
| `polls[].after` | The mod's state after the poll: `stored`, `unknownIds`, `assembling`, `have` (sorted chunk indices held), `stale`, `mismatch` |
| `bridge[]` | When present: `hears` is a mod answer, and `sends` is what must follow: a window (`round`, `indices` in send order, `upto`), `{endOfWindow: {round, upto}}` for the same end-of-window again, `{probe: true}` for a new probe, or `null` for nothing. `state`, when present, is the bridge's phase after hearing it: `delivered`, `rejected` or `failed` |

To run a case on the mod: set up `start`, hand each datagram of a poll to the packet handler in order, run the flush once, then compare the answer and the state. The Lua tests need a stand-in for `json_to_table` that returns `nil` on invalid JSON.

To run a case on the bridge: give it the snapshot and `chunkSize`, and move it to `Probing`. Then for each entry, deliver `hears` and compare what it sends. `chunkSize` is a parameter of the chunker for tests; the release bridge always uses `CHUNK_PAYLOAD`.
