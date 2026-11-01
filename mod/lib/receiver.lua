-- The mod's receive side: reassembly of chunked snapshots and the answer the
-- mod sends, as defined in initiatives/in-game-viewer/protocol.md ("The mod",
-- "Signals"). Plain Lua: the game is reached only through the functions given
-- to M.new, and time only through the ticks the caller passes in.
--
-- The caller (control.lua, a later change) does this:
--   * on each packet event:       receiver:on_datagram(packet_bytes, game.tick)
--   * at tick % POLL_TICKS == FLUSH_OFFSET:   send receiver:take_answer(), if any
--   * every tick it draws the indicator:      receiver:indicator(game.tick, game.speed)
local C = require("lib.constants")
local datagram = require("lib.datagram")
local snapshot_lib = require("lib.snapshot")

local M = {}
M.__index = M

-- opts:
--   decode_json(text) -> table | nil   helpers.json_to_table; nil on invalid JSON
--   count_unknown(snapshot) -> number  ids of the snapshot the running game lacks
--   stored = { id, unknown_ids, snapshot } | nil
--                                      what `storage` holds; the receiver keeps
--                                      this table and replaces it on accept
--   on_store(stored)                   called when `stored` is replaced or its
--                                      count recomputed, to write it to `storage`
function M.new(opts)
  return setmetatable({
    decode_json = opts.decode_json,
    count_unknown = opts.count_unknown,
    on_store = opts.on_store or function() end,
    stored = opts.stored,
    -- Reassembly: nil (Empty) or { id, count, bytes, chunks, held }.
    assembling = nil,
    slot = nil,
    newest = nil,
    mismatch = false,
    last_heard_tick = nil,
  }, M)
end

-- ---------------------------------------------------------------------------
-- The answer slot

-- Every answer replaces what is there.
function M:set_answer(text)
  self.slot = text
end

-- A hello only fills an empty slot.
function M:set_hello()
  if self.slot == nil then
    self.slot = datagram.hello(
      self.stored and self.stored.id,
      self.stored and self.stored.unknown_ids or 0,
      self.assembling and self.assembling.id
    )
  end
end

-- Returns the datagram to send and empties the slot; nil when there is none.
function M:take_answer()
  local text = self.slot
  self.slot = nil
  return text
end

-- ---------------------------------------------------------------------------
-- Handlers

local function stored_id(self)
  return self.stored and self.stored.id
end

local function ack(self)
  self:set_answer(datagram.ack(self.stored.id, self.stored.unknown_ids))
end

local function finish(self)
  local a = self.assembling
  self.assembling = nil

  local parts = {}
  for i = 0, a.count - 1 do
    parts[i + 1] = a.chunks[i]
  end
  local text = table.concat(parts)

  local function refuse(reason)
    self:set_answer(datagram.nack(a.id, reason))
  end

  if #text ~= a.bytes then
    return refuse("length")
  end
  local decoded = self.decode_json(text)
  if decoded == nil then
    return refuse("json")
  end
  local ok, reason = snapshot_lib.validate(decoded)
  if not ok then
    return refuse(reason)
  end

  local unknown = self.count_unknown(decoded)
  if unknown > C.MAX_UNKNOWN_IDS then
    unknown = C.MAX_UNKNOWN_IDS
  end
  self.stored = { id = a.id, unknown_ids = unknown, snapshot = decoded }
  self.on_store(self.stored)
  ack(self)
end

local function on_probe(self, d)
  if d.id == stored_id(self) then
    self.assembling = nil
    ack(self)
  elseif self.assembling and self.assembling.id == d.id then
    self:set_answer(datagram.ready(d.id))
  else
    self.assembling = { id = d.id, count = d.count, bytes = d.bytes, chunks = {}, held = 0 }
    self:set_answer(datagram.ready(d.id))
  end
end

local function on_chunk(self, d)
  local a = self.assembling
  if not a or a.id ~= d.id then
    return
  end
  if a.count ~= d.count or a.bytes ~= d.bytes then
    return
  end
  if a.chunks[d.index] ~= nil then
    return
  end
  a.chunks[d.index] = d.payload
  a.held = a.held + 1
  if a.held == a.count then
    finish(self)
  end
end

local function on_end_of_window(self, d)
  if d.id == stored_id(self) then
    ack(self)
    return
  end
  local a = self.assembling
  if not a or a.id ~= d.id or d.upto > a.count then
    return
  end
  self:set_answer(datagram.missing(a.id, d.round, datagram.missing_ranges(a.chunks, d.upto)))
end

-- Handles one packet. `tick` is the game tick it is handled at. Anything that is
-- not a valid datagram changes nothing, including the last-heard tick.
function M:on_datagram(data, tick)
  local d = datagram.decode(data)
  if d == nil then
    return
  end
  self.last_heard_tick = tick

  if d.type == "other_version" then
    self.mismatch = true
    self:set_hello()
    return
  end
  self.mismatch = false

  if d.type == "ping" then
    self.newest = d.newest
    self:set_hello()
  elseif d.type == "probe" then
    on_probe(self, d)
  elseif d.type == "chunk" then
    on_chunk(self, d)
  elseif d.type == "eow" then
    on_end_of_window(self, d)
  end
end

-- ---------------------------------------------------------------------------
-- Signals

-- The unknown-id count depends on the running mod set, so control.lua calls this
-- from on_configuration_changed.
function M:recompute_unknown()
  if self.stored and self.stored.snapshot then
    local n = self.count_unknown(self.stored.snapshot)
    self.stored.unknown_ids = math.min(n, C.MAX_UNKNOWN_IDS)
    self.on_store(self.stored)
  end
end

-- True when the stored snapshot differs from the planner's newest: the mod
-- stores one, the last ping named an id, and it is not the stored one.
function M:is_stale()
  return self.stored ~= nil and self.newest ~= nil and self.newest ~= self.stored.id
end

-- Disconnected before the first datagram after a load, and once more than
-- DISCONNECT_TICKS x speed ticks have passed since the last valid one. The
-- threshold scales with the game speed so it stays 18 s of wall-clock time.
function M:is_disconnected(tick, speed)
  if self.last_heard_tick == nil then
    return true
  end
  return (tick - self.last_heard_tick) > C.DISCONNECT_TICKS * (speed or 1)
end

-- The one indicator to show: "disconnected", else "mismatch", else "stale", else nil.
function M:indicator(tick, speed)
  if self:is_disconnected(tick, speed) then
    return "disconnected"
  elseif self.mismatch then
    return "mismatch"
  elseif self:is_stale() then
    return "stale"
  end
  return nil
end

-- A plain view of the state, in the shape the shared fixtures compare:
-- stored id, unknown-id count, id being assembled, sorted indices held, flags.
function M:state()
  local have = {}
  if self.assembling then
    for index in pairs(self.assembling.chunks) do
      have[#have + 1] = index
    end
    table.sort(have)
  end
  return {
    stored = self.stored and self.stored.id or nil,
    unknownIds = self.stored and self.stored.unknown_ids or 0,
    assembling = self.assembling and self.assembling.id or nil,
    have = have,
    stale = self:is_stale(),
    mismatch = self.mismatch,
  }
end

return M
