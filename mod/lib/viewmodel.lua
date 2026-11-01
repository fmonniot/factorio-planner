-- Builds what the GUI draws from a validated snapshot. Plain Lua and total: a
-- validated snapshot never makes it raise, and a reference that leads nowhere (an
-- area index out of range, a block that is gone, a synthetic row whose recipe
-- left the data set) becomes an absent field or an "unknown" flag, not an error.
--
-- Indices in a snapshot are 0-based and refer to arrays; the view-model uses
-- Lua's 1-based indices throughout (`area_index`, `from_index`, `blocks`).
local snapshot_lib = require("lib.snapshot")

local M = {}

-- opts.missing: the set returned by snapshot.find_missing (keys `kind:id`), for
-- flagging ids the running game lacks. Without it nothing is flagged.
function M.build(snapshot, opts)
  local missing = (opts and opts.missing) or {}

  local function is_missing(kind, id)
    return missing[kind .. ":" .. id] == true
  end

  -- An item, fluid or virtual reference. `sprite` and `rich` are what the GUI
  -- gives the game; virtual items have neither (the GUI draws electricity itself).
  local function ref(r)
    local out = { id = r.id, type = r.type, rate = r.rate }
    if r.type == "virtual" then
      out.virtual = true
    else
      out.sprite = r.type .. "/" .. r.id
      out.rich = "[" .. r.type .. "=" .. r.id .. "]"
      out.missing = is_missing(r.type, r.id)
    end
    return out
  end

  local function refs(list)
    local out = {}
    for i, r in ipairs(list) do
      out[i] = ref(r)
    end
    return out
  end

  local function block_name(index)
    local b = snapshot.blocks[index + 1]
    return b and b.name or nil
  end

  local function row(r, areas)
    local out = {
      machine = r.machine,
      machine_missing = r.machine ~= nil and is_missing("machine", r.machine) or false,
      machine_sprite = r.machine and ("entity/" .. r.machine) or nil,
      machine_rich = r.machine and ("[entity=" .. r.machine .. "]") or nil,
      area_index = r.area ~= nil and (r.area + 1) or nil,
      area_name = (r.area ~= nil and areas) and areas[r.area + 1] or nil,
      machines = r.machines,
      machines_ceil = r.machinesCeil,
      throughput = r.throughput,
      power_kw = r.powerKw,
      -- A row the solve did not value carries none of the numbers.
      solved = r.machines ~= nil or r.machinesCeil ~= nil or r.throughput ~= nil or r.powerKw ~= nil,
    }
    if r.recipe then
      out.kind = "recipe"
      out.recipe = r.recipe
      out.recipe_missing = is_missing("recipe", r.recipe)
      out.sprite = "recipe/" .. r.recipe
      out.rich = "[recipe=" .. r.recipe .. "]"
    else
      out.kind = "synthetic"
      out.synthetic_kind = r.kind
      -- No `product`: the recipe left the data set, so the row cannot say what it makes.
      out.product = r.product and ref(r.product) or nil
      out.unknown = r.product == nil
    end
    return out
  end

  local function warning(w)
    local blocks = {}
    for i, index in ipairs(w.blocks or {}) do
      blocks[i] = { index = index + 1, name = block_name(index) }
    end
    local recipes = {}
    for i, id in ipairs(w.recipes or {}) do
      recipes[i] = { id = id, rich = "[recipe=" .. id .. "]", missing = is_missing("recipe", id) }
    end
    return {
      code = w.code,
      items = refs(w.items or {}),
      recipes = recipes,
      blocks = blocks,
      areas = w.areas or {},
    }
  end

  local function connection(c)
    local out = ref(c)
    out.available = c.available
    out.from_index = c.from + 1
    out.from_name = block_name(c.from)
    return out
  end

  local function color(hex)
    return {
      r = tonumber(string.sub(hex, 2, 3), 16) / 255,
      g = tonumber(string.sub(hex, 4, 5), 16) / 255,
      b = tonumber(string.sub(hex, 6, 7), 16) / 255,
      hex = hex,
    }
  end

  local blocks = {}
  for i, b in ipairs(snapshot.blocks) do
    local rows = {}
    local power_kw, machines_ceil = 0, 0
    for j, r in ipairs(b.rows) do
      rows[j] = row(r, b.areas)
      power_kw = power_kw + (r.powerKw or 0)
      machines_ceil = machines_ceil + (r.machinesCeil or 0)
    end
    local warnings = {}
    for j, w in ipairs(b.warnings) do
      warnings[j] = warning(w)
    end
    local connections = {}
    for j, c in ipairs(b.connections) do
      connections[j] = connection(c)
    end
    blocks[i] = {
      index = i,
      name = b.name,
      color = color(b.color),
      products = refs(b.products),
      areas = b.areas or {},
      rows = rows,
      imports = refs(b.imports),
      warnings = warnings,
      connections = connections,
      error = b.error,
      totals = { power_kw = power_kw, machines_ceil = machines_ceil },
    }
  end

  -- The ids the game lacks, listed rather than hidden, so a player on another
  -- mod set sees why rows are blank. Sorted so the list is stable.
  local missing_list = {}
  for _, entry in ipairs(snapshot_lib.collect_ids(snapshot)) do
    if is_missing(entry.kind, entry.id) then
      missing_list[#missing_list + 1] = entry
    end
  end
  table.sort(missing_list, function(a, b)
    if a.kind ~= b.kind then
      return a.kind < b.kind
    end
    return a.id < b.id
  end)

  local ds = snapshot.dataSet
  return {
    data_set = { id = ds.id, name = ds.name, factorio_version = ds.factorioVersion },
    blocks = blocks,
    missing = missing_list,
  }
end

return M
