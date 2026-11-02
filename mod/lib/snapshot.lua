-- Snapshot validation and the unknown-id count. Plain Lua: the game's id tables
-- are passed in as functions, never read here.
--
-- The shape is the one in contract/snapshot.schema.json (generated from
-- src/snapshot/schema.ts). Differences from the JSON Schema, on purpose:
--   * Unknown keys are ignored, not refused. `v` is what covers a change a
--     reader would misread; a key added within version 1 must not make an
--     older mod refuse the whole snapshot (a snapshot that still carries the
--     retired `warnings`, `connections`, `areas`, `area` or `powerKw` is read).
--   * A `group` or `parent` index that leads nowhere is accepted: the view-model
--     puts such a row at the root rather than raising.
--   * `json_to_table` turns both `[]` and `{}` into an empty table, so an
--     array is any table whose keys are 1..n.
local C = require("lib.constants")

local M = {}

local ITEM_TYPES = { item = true, fluid = true, virtual = true }
local SYNTHETIC_KINDS = { mining = true, offshore = true, power = true }

local function is_number(x)
  -- NaN is the only value not equal to itself; infinity is not a rate either.
  return type(x) == "number" and x == x and x ~= math.huge and x ~= -math.huge
end

local function is_rate(x)
  return is_number(x) and x >= 0
end

local function is_index(x)
  return is_rate(x) and x % 1 == 0
end

local function is_text(x)
  return type(x) == "string" and #x > 0
end

local function is_array(t)
  if type(t) ~= "table" then
    return false
  end
  local n = 0
  for _ in pairs(t) do
    n = n + 1
  end
  for i = 1, n do
    if t[i] == nil then
      return false
    end
  end
  return true
end

-- Each check returns nil when the value is fine, else a short path message.

local function check_item_ref(x, path, with_rate)
  if type(x) ~= "table" then
    return path .. " is not an object"
  end
  if not is_text(x.id) then
    return path .. ".id is not a non-empty string"
  end
  if not ITEM_TYPES[x.type] then
    return path .. ".type is not item, fluid or virtual"
  end
  if with_rate and not is_rate(x.rate) then
    return path .. ".rate is not a non-negative number"
  end
  return nil
end

local function check_list(list, path, check)
  if not is_array(list) then
    return path .. " is not an array"
  end
  for i = 1, #list do
    local problem = check(list[i], path .. "[" .. i .. "]")
    if problem then
      return problem
    end
  end
  return nil
end

local function check_optional(x, path, name, test, what)
  if x ~= nil and not test(x) then
    return path .. "." .. name .. " is not " .. what
  end
  return nil
end

local function check_item_rates(list, path)
  return check_list(list, path, function(x, p)
    return check_item_ref(x, p, true)
  end)
end

local function check_module(x, path)
  if type(x) ~= "table" then
    return path .. " is not an object"
  end
  if not is_text(x.id) then
    return path .. ".id is not a non-empty string"
  end
  if not is_index(x.count) then
    return path .. ".count is not a non-negative integer"
  end
  return nil
end

local function check_beacon(x, path)
  if type(x) ~= "table" then
    return path .. " is not an object"
  end
  if not is_text(x.id) then
    return path .. ".id is not a non-empty string"
  end
  if not is_index(x.count) then
    return path .. ".count is not a non-negative integer"
  end
  if not is_text(x.module) then
    return path .. ".module is not a non-empty string"
  end
  if not is_index(x.modules) then
    return path .. ".modules is not a non-negative integer"
  end
  return nil
end

local function check_row(row, path)
  if type(row) ~= "table" then
    return path .. " is not an object"
  end
  if row.recipe ~= nil then
    if not is_text(row.recipe) then
      return path .. ".recipe is not a non-empty string"
    end
  else
    if not SYNTHETIC_KINDS[row.kind] then
      return path .. " has neither a recipe nor a kind of mining, offshore or power"
    end
    if row.product ~= nil then
      local problem = check_item_ref(row.product, path .. ".product", false)
      if problem then
        return problem
      end
    end
  end
  if row.inputs ~= nil then
    local problem = check_item_rates(row.inputs, path .. ".inputs")
    if problem then
      return problem
    end
  end
  if row.outputs ~= nil then
    local problem = check_item_rates(row.outputs, path .. ".outputs")
    if problem then
      return problem
    end
  end
  if row.modules ~= nil then
    local problem = check_list(row.modules, path .. ".modules", check_module)
    if problem then
      return problem
    end
  end
  if row.beacon ~= nil then
    local problem = check_beacon(row.beacon, path .. ".beacon")
    if problem then
      return problem
    end
  end
  return check_optional(row.machine, path, "machine", is_text, "a non-empty string")
    or check_optional(row.group, path, "group", is_index, "a non-negative integer")
    or check_optional(row.machines, path, "machines", is_rate, "a non-negative number")
    or check_optional(row.machinesCeil, path, "machinesCeil", is_index, "a non-negative integer")
    or check_optional(row.throughput, path, "throughput", is_rate, "a non-negative number")
end

local function check_group(g, path)
  if type(g) ~= "table" then
    return path .. " is not an object"
  end
  if type(g.name) ~= "string" then
    return path .. ".name is not a string"
  end
  return check_optional(g.parent, path, "parent", is_index, "a non-negative integer")
    or check_optional(g.area, path, "area", function(x)
      return type(x) == "boolean"
    end, "a boolean")
end

local function check_block(b, path)
  if type(b) ~= "table" then
    return path .. " is not an object"
  end
  if type(b.name) ~= "string" then
    return path .. ".name is not a string"
  end
  if type(b.color) ~= "string" or not string.match(b.color, "^#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]$") then
    return path .. ".color is not #rrggbb"
  end
  if b.groups ~= nil then
    local problem = check_list(b.groups, path .. ".groups", check_group)
    if problem then
      return problem
    end
  end
  if b.error ~= nil and type(b.error) ~= "string" then
    return path .. ".error is not a string"
  end
  return check_item_rates(b.products, path .. ".products")
    or check_list(b.rows, path .. ".rows", check_row)
    or check_item_rates(b.imports, path .. ".imports")
end

-- Validates a decoded snapshot. Returns true, or nil plus a reason and a
-- detail:
--   "version"  the snapshot's `v` is a number this mod does not read
--   "invalid"  anything else that is not a snapshot (detail says what)
-- A missing or non-numeric `v` is "invalid": the value is not a snapshot at all.
function M.validate(snapshot)
  if type(snapshot) ~= "table" then
    return nil, "invalid", "not an object"
  end
  if type(snapshot.v) ~= "number" then
    return nil, "invalid", "v is not a number"
  end
  if snapshot.v ~= C.SNAPSHOT_VERSION then
    return nil, "version", "v is " .. tostring(snapshot.v)
  end
  local ds = snapshot.dataSet
  if type(ds) ~= "table" or not is_text(ds.id) then
    return nil, "invalid", "dataSet.id is not a non-empty string"
  end
  if ds.name ~= nil and type(ds.name) ~= "string" then
    return nil, "invalid", "dataSet.name is not a string"
  end
  if ds.factorioVersion ~= nil and type(ds.factorioVersion) ~= "string" then
    return nil, "invalid", "dataSet.factorioVersion is not a string"
  end
  local problem = check_list(snapshot.blocks, "blocks", check_block)
  if problem then
    return nil, "invalid", problem
  end
  return true
end

-- ---------------------------------------------------------------------------
-- Ids the snapshot names, and which of them the running game lacks.

local function add(seen, list, kind, id)
  local key = kind .. ":" .. id
  if not seen[key] then
    seen[key] = true
    list[#list + 1] = { kind = kind, id = id }
  end
end

local function add_ref(seen, list, ref)
  -- `virtual` ids (the electricity and heat pseudo-items) are not game prototypes.
  if ref.type == "item" or ref.type == "fluid" then
    add(seen, list, ref.type, ref.id)
  end
end

-- The distinct item, fluid, recipe and machine ids of a validated snapshot
-- (products, imports, and each row's recipe or product, machine, item rates,
-- module ids as items and beacon id as a machine), as a list of
-- { kind = "item" | "fluid" | "recipe" | "machine", id = string } in order of
-- first appearance. `virtual` ids are left out.
function M.collect_ids(snapshot)
  local seen, list = {}, {}
  for _, block in ipairs(snapshot.blocks) do
    for _, p in ipairs(block.products) do
      add_ref(seen, list, p)
    end
    for _, p in ipairs(block.imports) do
      add_ref(seen, list, p)
    end
    for _, row in ipairs(block.rows) do
      if row.recipe then
        add(seen, list, "recipe", row.recipe)
      elseif row.product then
        add_ref(seen, list, row.product)
      end
      if row.machine then
        add(seen, list, "machine", row.machine)
      end
      for _, ref in ipairs(row.inputs or {}) do
        add_ref(seen, list, ref)
      end
      for _, ref in ipairs(row.outputs or {}) do
        add_ref(seen, list, ref)
      end
      for _, module in ipairs(row.modules or {}) do
        add(seen, list, "item", module.id)
      end
      if row.beacon then
        add(seen, list, "machine", row.beacon.id)
        add(seen, list, "item", row.beacon.module)
      end
    end
  end
  return list
end

-- `exists` has one function per kind: exists.item(id), exists.fluid(id),
-- exists.recipe(id), exists.machine(id), each returning true when the running
-- game has that prototype. Returns the number of ids that it lacks, saturating
-- at MAX_UNKNOWN_IDS, and a set of them keyed `kind .. ":" .. id` for the
-- view-model.
function M.find_missing(snapshot, exists)
  local missing, count = {}, 0
  for _, entry in ipairs(M.collect_ids(snapshot)) do
    if not exists[entry.kind](entry.id) then
      missing[entry.kind .. ":" .. entry.id] = true
      count = count + 1
    end
  end
  if count > C.MAX_UNKNOWN_IDS then
    count = C.MAX_UNKNOWN_IDS
  end
  return count, missing
end

return M
