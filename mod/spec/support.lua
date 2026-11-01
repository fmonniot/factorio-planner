-- Helpers shared by the specs. Not a spec itself (the file name has no _spec).
-- The specs run from mod/ (see the README), so the shared contract is at ../contract.
local json = require("dkjson")

local M = {}

M.CONTRACT = "../contract"

function M.read_file(path)
  local f = assert(io.open(path, "rb"))
  local text = f:read("*a")
  f:close()
  return text
end

function M.read_json(path)
  local value, _, err = json.decode(M.read_file(path))
  assert(err == nil, err)
  return value
end

-- Hexadecimal is the truth in the shared fixtures.
function M.from_hex(hex)
  return (string.gsub(hex, "%x%x", function(pair)
    return string.char(tonumber(pair, 16))
  end))
end

function M.to_hex(bytes)
  return (string.gsub(bytes, ".", function(c)
    return string.format("%02x", string.byte(c))
  end))
end

-- The stand-in for helpers.json_to_table: nil on invalid JSON.
function M.json_to_table(text)
  local value, _, err = json.decode(text)
  if err ~= nil then
    return nil
  end
  return value
end

function M.list_cases()
  local names = {}
  local p = assert(io.popen('ls "' .. M.CONTRACT .. '/datagrams"'))
  for name in p:lines() do
    local case = string.match(name, "^case%-(.+)%.json$")
    if case then
      names[#names + 1] = case
    end
  end
  p:close()
  table.sort(names)
  return names
end

function M.list_snapshot_fixtures()
  local names = {}
  local p = assert(io.popen('ls "' .. M.CONTRACT .. '/fixtures"'))
  for name in p:lines() do
    local fixture = string.match(name, "^(.+)%.json$")
    if fixture then
      names[#names + 1] = fixture
    end
  end
  p:close()
  table.sort(names)
  return names
end

-- A fixed id check for tests: an id exists unless it is in `lacking`.
function M.exists_except(lacking)
  local function exists(id)
    return not lacking[id]
  end
  return { item = exists, fluid = exists, recipe = exists, machine = exists }
end

-- A deep copy, so a test can break one field of a decoded fixture.
function M.copy(value)
  if type(value) ~= "table" then
    return value
  end
  local out = {}
  for k, v in pairs(value) do
    out[k] = M.copy(v)
  end
  return out
end

-- ---------------------------------------------------------------------------
-- Datagram builders for the specs that write their own scenarios, in the
-- bridge-to-mod layout of protocol.md.

M.NO_ID = string.rep("-", 16)

function M.ping(newest)
  return "FP01 P " .. (newest or M.NO_ID)
end

function M.probe(id, count, bytes)
  return string.format("FP01 W %s %04d %07d ", id, count, bytes) .. string.rep(".", 8005)
end

function M.chunk(id, index, count, bytes, payload)
  return string.format("FP01 C %s %04d %04d %07d ", id, index, count, bytes) .. payload
end

function M.eow(id, round, upto)
  return string.format("FP01 E %s %04d %04d", id, round, upto)
end

-- Cuts `text` into chunks of `size` bytes, the way the bridge does.
function M.split(text, size)
  local parts = {}
  for i = 1, #text, size do
    parts[#parts + 1] = string.sub(text, i, i + size - 1)
  end
  return parts
end

return M
