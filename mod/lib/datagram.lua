-- Datagram decoding (bridge to mod) and encoding (mod to bridge), as defined in
-- initiatives/in-game-viewer/protocol.md ("Bridge and mod: UDP"). Plain Lua:
-- every function takes and returns strings and tables.
--
-- The decoder follows the protocol's reading rules. It cuts the header at a
-- fixed width, checks it with one anchored pattern, and takes the payload with
-- one more string.sub. Nothing ever searches a payload. Digits are checked with
-- patterns, never converted first, because tonumber accepts "0x10", " 12" and
-- "1e3".
local C = require("lib.constants")

local M = {}

local ID = string.rep("[0-9a-f]", 16)

local PING_ID = "^" .. C.PREFIX .. "P (" .. ID .. ")$"
local PING_HEAD = "^" .. C.PREFIX .. "P (.+)$"
local PROBE = "^" .. C.PREFIX .. "W (" .. ID .. ") (%d%d%d%d) (%d%d%d%d%d%d%d) $"
local CHUNK = "^" .. C.PREFIX .. "C (" .. ID .. ") (%d%d%d%d) (%d%d%d%d) (%d%d%d%d%d%d%d) $"
local EOW = "^" .. C.PREFIX .. "E (" .. ID .. ") (%d%d%d%d) (%d%d%d%d)$"

-- True when `count` chunks of at most CHUNK_PAYLOAD bytes can add up to
-- `bytes`, and all three are inside their bounds.
local function header_ok(count, bytes)
  return count >= 1
    and count <= C.MAX_CHUNKS
    and bytes >= 1
    and bytes <= C.MAX_SNAPSHOT_BYTES
    and count <= bytes
    and bytes <= count * C.CHUNK_PAYLOAD
end

-- Decodes one datagram. Returns a table, or nil when the datagram must be
-- dropped (it changes no state, gets no answer and does not count as hearing
-- from the bridge).
--
--   { type = "ping",  newest = id | nil }
--   { type = "probe", id, count, bytes }
--   { type = "chunk", id, index, count, bytes, payload }
--   { type = "eow",   id, round (the four digits, as received), upto }
--   { type = "other_version", version }   -- only the first 6 bytes were read
function M.decode(data)
  if type(data) ~= "string" or #data < 6 then
    return nil
  end

  local version, letter = string.match(string.sub(data, 1, 6), "^FP(%d%d) (%u)$")
  if not version then
    return nil
  end
  if tonumber(version) ~= C.PROTOCOL_VERSION then
    return { type = "other_version", version = tonumber(version) }
  end

  if letter == "P" then
    if #data ~= C.PING_BYTES then
      return nil
    end
    local id = string.match(data, PING_ID)
    if id then
      return { type = "ping", newest = id }
    end
    -- The tail is compared as plain text: the dashes of NO_ID are a quantifier in a pattern.
    if string.match(data, PING_HEAD) == C.NO_ID then
      return { type = "ping" }
    end
    return nil
  elseif letter == "W" then
    if #data < C.PROBE_HEADER then
      return nil
    end
    local id, count, bytes = string.match(string.sub(data, 1, C.PROBE_HEADER), PROBE)
    if not id then
      return nil
    end
    count, bytes = tonumber(count), tonumber(bytes)
    if not header_ok(count, bytes) then
      return nil
    end
    return { type = "probe", id = id, count = count, bytes = bytes }
  elseif letter == "C" then
    if #data <= C.CHUNK_HEADER or #data > C.CHUNK_HEADER + C.CHUNK_PAYLOAD then
      return nil
    end
    local id, index, count, bytes = string.match(string.sub(data, 1, C.CHUNK_HEADER), CHUNK)
    if not id then
      return nil
    end
    index, count, bytes = tonumber(index), tonumber(count), tonumber(bytes)
    if not header_ok(count, bytes) or index >= count then
      return nil
    end
    return {
      type = "chunk",
      id = id,
      index = index,
      count = count,
      bytes = bytes,
      payload = string.sub(data, C.CHUNK_HEADER + 1),
    }
  elseif letter == "E" then
    if #data ~= C.EOW_BYTES then
      return nil
    end
    local id, round, upto = string.match(data, EOW)
    if not id then
      return nil
    end
    upto = tonumber(upto)
    if upto < 1 or upto > C.MAX_CHUNKS then
      return nil
    end
    return { type = "eow", id = id, round = round, upto = upto }
  end

  return nil
end

-- ---------------------------------------------------------------------------
-- Encoding: what the mod sends. Numbers are decimal and not padded.

local function id_or_none(id)
  return id or C.NO_ID
end

local function clamp_unknown(n)
  n = math.floor(n or 0)
  if n < 0 then
    return 0
  end
  if n > C.MAX_UNKNOWN_IDS then
    return C.MAX_UNKNOWN_IDS
  end
  return n
end

-- `stored` and `assembling` are ids or nil.
function M.hello(stored, unknown_ids, assembling)
  return string.format(
    "%sH %s %d %s",
    C.PREFIX,
    id_or_none(stored),
    stored and clamp_unknown(unknown_ids) or 0,
    id_or_none(assembling)
  )
end

function M.ready(id)
  return C.PREFIX .. "R " .. id
end

-- `ranges` is the report string from M.missing_ranges.
function M.missing(id, round, ranges)
  return string.format("%sM %s %s %s", C.PREFIX, id, round, ranges)
end

function M.ack(id, unknown_ids)
  return string.format("%sA %s %d", C.PREFIX, id, clamp_unknown(unknown_ids))
end

function M.nack(id, reason)
  return string.format("%sN %s %s", C.PREFIX, id, reason)
end

-- The ranges field of a missing report: the indices below `upto` that are not
-- in `held` (a table index -> truthy), lowest first, as comma-joined entries
-- (`7` or `3-5`), at most MAX_REPORT_RANGES of them. "-" when nothing is
-- missing. The loop runs over at most `upto` indices.
function M.missing_ranges(held, upto)
  local entries = {}
  local i = 0
  while i < upto and #entries < C.MAX_REPORT_RANGES do
    if held[i] then
      i = i + 1
    else
      local first = i
      while i + 1 < upto and not held[i + 1] do
        i = i + 1
      end
      entries[#entries + 1] = (first == i) and tostring(first) or (first .. "-" .. i)
      i = i + 1
    end
  end
  if #entries == 0 then
    return "-"
  end
  return table.concat(entries, ",")
end

return M
