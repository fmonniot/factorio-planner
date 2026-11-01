-- Protocol constants of the in-game viewer. The names and values follow the
-- "Constants" table of initiatives/in-game-viewer/protocol.md. Plain Lua, no
-- game API.
local M = {}

M.PROTOCOL_VERSION = 1
-- The 6 bytes every datagram of this version starts with: "FP01 ".
M.PREFIX = string.format("FP%02d ", M.PROTOCOL_VERSION)

-- The snapshot's own `v`, separate from the protocol version.
M.SNAPSHOT_VERSION = 1

M.CHUNK_PAYLOAD = 8000
M.CHUNK_HEADER = 42
M.PROBE_HEADER = 37
M.PING_BYTES = 23
M.EOW_BYTES = 33
M.MAX_CHUNKS = 1000
M.MAX_SNAPSHOT_BYTES = 8000000
M.MAX_REPORT_RANGES = 12
M.MAX_UNKNOWN_IDS = 9999

-- The ports of protocol.md "Ports": the bridge's default (the setting's default
-- is a literal in settings.lua, checked against this) and the game's own, which
-- `--enable-lua-udp` sets and the Disconnected text names.
M.DEFAULT_BRIDGE_PORT = 34199
M.GAME_PORT = 34198

M.POLL_TICKS = 10
M.FLUSH_OFFSET = 2
M.GAME_UPS = 60
M.DISCONNECT_TICKS = 1080

-- The "no id" value: sixteen dashes, the width of an id.
M.NO_ID = string.rep("-", 16)

return M
