# In-game viewer mod

The Factorio mod of the [in-game viewer](../initiatives/archive/in-game-viewer/plan.md), for **Factorio 2.0.77** (`info.json` pins the 2.0 series). It is two layers. The **pure Lua modules** in `lib/` are plain Lua 5.2 with no `game`, `script` or `storage` access, so they run under busted. The **glue** (`control.lua`, `scripts/` (`gui.lua`), `settings.lua`, `locale/`) touches the game API and stays thin on top of them; CI cannot run it in Factorio, so [CHECKLIST.md](CHECKLIST.md) covers it by hand, and `glue_spec.lua` runs it against a fake runtime to catch plain Lua mistakes.

| Path | What it does |
|---|---|
| `lib/constants.lua` | Protocol constants (`CHUNK_PAYLOAD`, `MAX_CHUNKS`, `DISCONNECT_TICKS`, ...), named as in [the protocol](../spec/in-game-viewer-protocol.md#constants) |
| `lib/datagram.lua` | Decodes the bridge's datagrams (ping, probe, chunk, end of window; anything else is dropped) and encodes the mod's answers (`hello`, `ready`, missing report, ack, refusal) |
| `lib/snapshot.lua` | Validates a decoded snapshot (`version` or `invalid` reasons) and counts the ids the running game lacks, through functions the caller passes in |
| `lib/receiver.lua` | The receive-side state machine: answer slot, reassembly, finishing, the Stale, Disconnected and protocol-mismatch signals. The caller feeds it packets and ticks and sends what `take_answer` returns |
| `lib/viewmodel.lua` | Turns a validated snapshot into what the GUI draws; total, so a dangling reference or a synthetic row with no product shows as unknown instead of raising |
| `lib/format.lua` | Number, rate and power text, rich-text colour, GUI element names and the locale keys that depend on the data (warning codes, synthetic kinds, indicators) |
| `control.lua` | The runtime entry point: `recv_udp` every 10 ticks inside `pcall`, packets into the receiver, the single answer sent on tick 2 of the cycle inside `pcall`, the accepted snapshot in `storage`, GUI refresh when the snapshot or the indicator changes (inside `pcall`, logged once; the selected block is kept by name through a new snapshot). Everything else (reassembly, answer slot, last-heard tick) is plain state that a load leaves empty |
| `scripts/` | `gui.lua`: the top-bar button and the per-player read-only window: block list on the left, the selected block on the right (products, recipe rows, imports, connections, warnings), the Disconnected / Protocol mismatch / Stale line, and the list of ids the running game lacks. Holds no state; `control.lua` passes in the view-model |
| `settings.lua` | Runtime-global settings: the bridge's UDP port (default 34199) and a debug switch that logs how long each `send_udp` takes |
| `locale/en/` | English texts. Ids are shown as rich text and the prototype's own localised name, so game data is never translated here |
| `info.json` | Mod name `factorio-planner-viewer`, `factorio_version` `2.0`, `base` dependency. The version is the release version |
| `CHECKLIST.md` | The manual test checklist, run on Factorio 2.0.77 |
| `tools/udp_sender.py` | A stand-in for the bridge for the checklist: sends pings, probes and chunks to the game and prints the mod's answers |
| `spec/` | busted specs; `*_fixtures_spec.lua` and parts of the others read the shared fixtures in [contract/](../contract/) |
| `.busted`, `.luacheckrc` | Test and lint configuration; the Factorio globals are declared per file in `.luacheckrc` |
| `setup-lua.sh` | Builds the private Lua toolchain below |

## Running the tests

Everything runs under Lua 5.2, Factorio's version, from a private tree in `mod/.lua/` (gitignored). Nothing is installed system-wide. You need `python3`, a C compiler and `make`.

```sh
mod/setup-lua.sh                  # once: Lua 5.2.4, LuaRocks, busted and luacheck into mod/.lua/
cd mod
.lua/bin/busted                   # the specs (they read ../contract/, so run them from mod/)
.lua/bin/luacheck .               # lint
```

The versions are pinned at the top of `setup-lua.sh`, and the `Mod (Lua)` job in `.github/workflows/mod.yml` runs the same script, so local and CI use the same toolchain. If you change `src/snapshot/` or the datagram generator, run `npm run contract` first: the specs read the checked-in `contract/` files.
