# In-game viewer mod

The Factorio mod of the [in-game viewer](../initiatives/in-game-viewer/plan.md). This folder holds, so far, its **pure Lua modules**: plain Lua 5.2 with no `game`, `script` or `storage` access, so they run under busted. The event handlers, the GUI, settings and locale come in a later change and stay thin on top of these.

| Path | What it does |
|---|---|
| `lib/constants.lua` | Protocol constants (`CHUNK_PAYLOAD`, `MAX_CHUNKS`, `DISCONNECT_TICKS`, ...), named as in [protocol.md](../initiatives/in-game-viewer/protocol.md#constants) |
| `lib/datagram.lua` | Decodes the bridge's datagrams (ping, probe, chunk, end of window; anything else is dropped) and encodes the mod's answers (`hello`, `ready`, missing report, ack, refusal) |
| `lib/snapshot.lua` | Validates a decoded snapshot (`version` or `invalid` reasons) and counts the ids the running game lacks, through functions the caller passes in |
| `lib/receiver.lua` | The receive-side state machine: answer slot, reassembly, finishing, the Stale, Disconnected and protocol-mismatch signals. The caller feeds it packets and ticks and sends what `take_answer` returns |
| `lib/viewmodel.lua` | Turns a validated snapshot into what the GUI draws; total, so a dangling reference or a synthetic row with no product shows as unknown instead of raising |
| `spec/` | busted specs; `*_fixtures_spec.lua` and parts of the others read the shared fixtures in [contract/](../contract/) |
| `.busted`, `.luacheckrc` | Test and lint configuration |
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
