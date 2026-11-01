# In-game viewer mod

The Factorio mod of the [in-game viewer](../initiatives/archive/in-game-viewer/plan.md), for **Factorio 2.0.77** (`info.json` pins the 2.0 series). It is two layers. The **pure Lua modules** in `lib/` are plain Lua 5.2 with no `game`, `script` or `storage` access, so they run under busted. The **glue** (`control.lua`, `scripts/` (`gui.lua`, `cursor.lua`), `settings.lua`, `locale/`) touches the game API and stays thin on top of them; CI cannot run it in Factorio, so [CHECKLIST.md](CHECKLIST.md) covers it by hand, and `glue_spec.lua` runs it against a fake runtime to catch plain Lua mistakes.

| Path | What it does |
|---|---|
| `lib/constants.lua` | Protocol constants (`CHUNK_PAYLOAD`, `MAX_CHUNKS`, `DISCONNECT_TICKS`, ...), named as in [the protocol](../spec/in-game-viewer-protocol.md#constants) |
| `lib/datagram.lua` | Decodes the bridge's datagrams (ping, probe, chunk, end of window; anything else is dropped) and encodes the mod's answers (`hello`, `ready`, missing report, ack, refusal) |
| `lib/snapshot.lua` | Validates a decoded snapshot (`version` or `invalid` reasons) and counts the ids the running game lacks, through functions the caller passes in |
| `lib/receiver.lua` | The receive-side state machine: answer slot, reassembly, finishing, the Stale, Disconnected and protocol-mismatch signals. The caller feeds it packets and ticks and sends what `take_answer` returns |
| `lib/viewmodel.lua` | Turns a validated snapshot into what the GUI draws: per block, the production table as a flat list of rows and sub-factory headers (with their depth, their rows' keys and their net products and ingredients), a key per row and per block for the "built" ticks, and each row's modules and beacon. Total, so a dangling reference or a synthetic row with no product shows as unknown instead of raising |
| `lib/format.lua` | Number text, rich-text colour, the drop-down's element name, the tags of checkboxes and building buttons, and the locale keys that depend on the data (synthetic kinds, indicators) |
| `lib/progress.lua` | The "built" ticks as a plain table, `done[block_key][row_key]`: tick one row or a list of them, and whether every row of a list is ticked (a sub-factory's checkbox, derived, never stored) |
| `lib/layout.lua` | The window's size and place as a share of the screen, how many item buttons fit on a line, and how they are shared between products (three columns at most) and ingredients (five at most) |
| `lib/blueprint.lua` | Decides what a click on a machine or a beacon puts in the cursor, from the row and what the game says of the entity: a one-entity blueprint (recipe and modules), a ghost of the item that places it, or a refusal reason |
| `control.lua` | The runtime entry point: `recv_udp` every 10 ticks inside `pcall`, packets into the receiver, the single answer sent on tick 2 of the cycle inside `pcall`, the accepted snapshot in `storage`, GUI refresh when the snapshot or the indicator changes (inside `pcall`, logged once; the selected block is kept by name through a new snapshot). The GUI events: the block drop-down, the "built" checkboxes (kept in `storage` for the save, through new snapshots) and a click on a machine or a beacon. Everything else (reassembly, answer slot, last-heard tick) is plain state that a load leaves empty |
| `scripts/` | `gui.lua`: the top-bar button and the per-player window: the Disconnected / Protocol mismatch / Stale line and the list of ids the running game lacks when there is something to say, a block drop-down with each block's colour (the data set in its tooltip), the solver's message of a failed block, and the block's production table in the look of Factory Planner's compact view (one line per recipe and per sub-factory, a "built" checkbox on each; built rows in grayscale). It opens at the top left at 26 % of the screen's width, and is reopened when the screen changes. It uses flib's slot styles when flib is loaded, and the base game's otherwise. It is not `player.opened`, so it stays open beside the game. `cursor.lua`: a click on a machine or a beacon, carried out: reads the entity prototype for `lib/blueprint.lua`, then pastes the blueprint through a script inventory and the clipboard, sets a cursor ghost, or shows a flying text. Neither holds state; `control.lua` passes in the view-model and the ticks |
| `settings.lua` | Runtime-global settings: the bridge's UDP port (default 34199) and a debug switch that logs how long each `send_udp` takes |
| `locale/en/` | English texts. Ids are shown as rich text and the prototype's own localised name, so game data is never translated here |
| `info.json` | Mod name `factorio-planner-viewer`, `factorio_version` `2.0`, `base` dependency and an optional one on `flib`, for its slot styles. The version is the release version |
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
