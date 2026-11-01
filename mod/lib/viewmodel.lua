-- Builds what the GUI draws from a validated snapshot. Plain Lua and total: a
-- validated snapshot never makes it raise, and a reference that leads nowhere (a
-- group index out of range, a parent that is not a lower index, a synthetic row
-- whose recipe left the data set) becomes an absent field or an "unknown" flag,
-- not an error.
--
-- Indices in a snapshot are 0-based and refer to arrays; the view-model uses
-- Lua's 1-based indices (`index` of a block).
--
-- build(snapshot, opts) returns
--   {
--     data_set = { id, name, factorio_version },
--     blocks   = { block, ... },          -- snapshot order
--     missing  = { { kind, id }, ... },   -- ids the game lacks, sorted
--   }
-- opts.missing is the set from snapshot.find_missing (keys `kind:id`); without
-- it nothing is flagged.
--
-- block = {
--   index, name, color = { r, g, b, hex },
--   key       = string,   -- the block's name, plus "#2", "#3" when another block has it
--   error     = string | nil,   -- the solver's message of a failed solve
--   products  = { ref }, imports = { ref },   -- as in the snapshot (rates are items/min)
--   rows      = { row },  -- every row, in snapshot order (no groups)
--   has_beacon = bool,    -- any row has a beacon: the beacon column can be left out when false
--   entries   = { entry },-- the table to draw, top to bottom, in order (below)
--   by_key    = { [entry.key] = entry },  -- for the click handlers
--   summary   = { keys = { row key, ... }, products = { ref }, ingredients = { ref } },
-- }
--
-- entry (a line of the table), `type` tells which:
--   { type = "row",   key = row.key, depth = n, row = row }
--   { type = "group", key = string, depth = n, name = string, area = bool,
--     keys = { row key, ... },            -- the keys of every row under it, at any depth
--     products = { ref }, ingredients = { ref } }  -- net flows (see below)
-- `depth` is the number of sub-factories above the line: a root row is 0, a
-- top-level sub-factory's header is 0 and its rows 1, a nested header is 1.
-- A group entry's key differs from every row key (it starts with "\30"), so
-- `by_key` holds both. Only a group that holds a row at some depth gets a
-- header, placed before the first row (in table order) it contains.
--
-- row = {
--   key, kind = "recipe" | "synthetic",
--   recipe, recipe_missing, sprite, rich,            -- kind recipe
--   synthetic_kind, product = ref | nil, unknown,    -- kind synthetic (unknown: no product)
--   machine, machine_missing, machine_sprite, machine_rich,
--   machines, machines_ceil, throughput,
--   solved,                                          -- machines, machines_ceil or throughput present
--   inputs = { ref }, outputs = { ref },             -- items/min; {} when none
--   modules = { { id, count, sprite, rich, missing } },   -- the machine's own
--   beacon = nil | { id, sprite, rich, missing,
--                    per_machine,                    -- beacons per machine
--                    total,                          -- per_machine * machines_ceil; nil without machines_ceil
--                    modules = { module } },         -- the module each beacon holds, same shape as above
-- }
--
-- ref = { id, type, rate, sprite, rich, missing }; a `virtual` ref (electricity)
-- has `virtual = true` and neither sprite, rich nor missing.
--
-- Net flows (a group header and the summary): over the rows under it, at any
-- depth, outputs minus inputs per item; a positive balance is a product, a
-- negative one an ingredient, and one under 0.01/min in size (after rounding to
-- three decimals) is dropped. Each list is sorted by rate, largest first, ties
-- in order of first appearance. `virtual` refs never count. Only a block where
-- no row has any input or output (a failed solve) falls back on its `products`
-- and `imports` for the summary, minus the `virtual` ones.
--
-- Keys (what `done` is stored under): a row's key is the path of its
-- sub-factories' names, outermost first, then its recipe id (a synthetic row:
-- kind, product id and machine), joined with "\31". A repeated key in a block
-- gets the suffix "#2", "#3", ...; so does a sub-factory name that a sibling
-- already has, and a block name.
local snapshot_lib = require("lib.snapshot")

local M = {}

local SEP = "\31"
local GROUP_PREFIX = "\30"
local MIN_NET_RATE = 0.01

-- A key not in `seen` yet: `base`, else `base#2`, `base#3`, ...
local function unique(seen, base)
  local key = base
  local n = 1
  while seen[key] do
    n = n + 1
    key = base .. "#" .. n
  end
  seen[key] = true
  return key
end

local function round3(x)
  return math.floor(x * 1000 + 0.5) / 1000
end

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
    for i, r in ipairs(list or {}) do
      out[i] = ref(r)
    end
    return out
  end

  -- A module is an item.
  local function module(id, count)
    return {
      id = id,
      count = count,
      sprite = "item/" .. id,
      rich = "[item=" .. id .. "]",
      missing = is_missing("item", id),
    }
  end

  local function row(r, key)
    local out = {
      key = key,
      machine = r.machine,
      machine_missing = r.machine ~= nil and is_missing("machine", r.machine) or false,
      machine_sprite = r.machine and ("entity/" .. r.machine) or nil,
      machine_rich = r.machine and ("[entity=" .. r.machine .. "]") or nil,
      machines = r.machines,
      machines_ceil = r.machinesCeil,
      throughput = r.throughput,
      -- A row the solve did not value carries none of the numbers.
      solved = r.machines ~= nil or r.machinesCeil ~= nil or r.throughput ~= nil,
      inputs = refs(r.inputs),
      outputs = refs(r.outputs),
      modules = {},
    }
    for i, m in ipairs(r.modules or {}) do
      out.modules[i] = module(m.id, m.count)
    end
    local b = r.beacon
    if b then
      out.beacon = {
        id = b.id,
        sprite = "entity/" .. b.id,
        rich = "[entity=" .. b.id .. "]",
        missing = is_missing("machine", b.id),
        per_machine = b.count,
        total = r.machinesCeil ~= nil and (b.count * r.machinesCeil) or nil,
        modules = b.modules > 0 and { module(b.module, b.modules) } or {},
      }
    end
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

  -- The part of a row's key that says which row it is within its sub-factory.
  local function row_identity(r)
    if r.recipe then
      return r.recipe
    end
    return r.kind .. SEP .. (r.product and r.product.id or "") .. SEP .. (r.machine or "")
  end

  -- Running sum of a group's (or the block's) flows and row keys.
  local function new_acc()
    return { keys = {}, order = {}, items = {} }
  end

  local function add_flow(acc, r, sign)
    if r.type == "virtual" then
      return
    end
    local k = r.type .. ":" .. r.id
    local item = acc.items[k]
    if not item then
      item = { id = r.id, type = r.type, balance = 0, order = #acc.order + 1 }
      acc.items[k] = item
      acc.order[item.order] = item
    end
    item.balance = item.balance + sign * r.rate
  end

  local function add_row(acc, key, r)
    acc.keys[#acc.keys + 1] = key
    for _, x in ipairs(r.inputs or {}) do
      add_flow(acc, x, -1)
    end
    for _, x in ipairs(r.outputs or {}) do
      add_flow(acc, x, 1)
    end
  end

  -- The net products and ingredients of an accumulator, as refs.
  local function net(acc)
    local products, ingredients = {}, {}
    for _, item in ipairs(acc.order) do
      local rate = round3(math.abs(item.balance))
      if rate >= MIN_NET_RATE then
        local list = item.balance > 0 and products or ingredients
        list[#list + 1] = { id = item.id, type = item.type, rate = rate, order = item.order }
      end
    end
    local function by_rate(a, b)
      if a.rate ~= b.rate then
        return a.rate > b.rate
      end
      return a.order < b.order
    end
    table.sort(products, by_rate)
    table.sort(ingredients, by_rate)
    return refs(products), refs(ingredients)
  end

  local function color(hex)
    return {
      r = tonumber(string.sub(hex, 2, 3), 16) / 255,
      g = tonumber(string.sub(hex, 4, 5), 16) / 255,
      b = tonumber(string.sub(hex, 6, 7), 16) / 255,
      hex = hex,
    }
  end

  -- The sub-factories of a block, by 1-based index, with what the walk needs:
  -- `parent` (1-based, nil at the top: a parent that is not a lower index counts
  -- as absent), `depth` and the unique `path`.
  local function resolve_groups(list)
    local groups = {}
    local siblings = {}
    for gi, g in ipairs(list or {}) do
      local parent = (g.parent ~= nil and g.parent < gi - 1) and (g.parent + 1) or nil
      local seen = siblings[parent or 0]
      if not seen then
        seen = {}
        siblings[parent or 0] = seen
      end
      local segment = unique(seen, g.name)
      groups[gi] = {
        name = g.name,
        area = g.area == true,
        parent = parent,
        depth = parent and (groups[parent].depth + 1) or 0,
        path = parent and (groups[parent].path .. SEP .. segment) or segment,
      }
    end
    return groups
  end

  local function build_block(i, b, key)
    local groups = resolve_groups(b.groups)
    local rows, entries, by_key = {}, {}, {}
    local row_keys = {}
    local summary = new_acc()
    local group_entries, group_accs = {}, {}
    local has_beacon, has_rates = false, false

    for j, r in ipairs(b.rows) do
      local gi = r.group ~= nil and groups[r.group + 1] and (r.group + 1) or nil
      local base = row_identity(r)
      local key_j = unique(row_keys, gi and (groups[gi].path .. SEP .. base) or base)
      rows[j] = row(r, key_j)
      has_beacon = has_beacon or r.beacon ~= nil
      has_rates = has_rates or (r.inputs ~= nil and #r.inputs > 0) or (r.outputs ~= nil and #r.outputs > 0)

      -- The sub-factories above this row, outermost first.
      local chain = {}
      local g = gi
      while g do
        table.insert(chain, 1, g)
        g = groups[g].parent
      end
      for _, c in ipairs(chain) do
        if not group_entries[c] then
          local entry = {
            type = "group",
            key = GROUP_PREFIX .. groups[c].path,
            depth = groups[c].depth,
            name = groups[c].name,
            area = groups[c].area,
          }
          group_entries[c] = entry
          group_accs[c] = new_acc()
          entries[#entries + 1] = entry
          by_key[entry.key] = entry
        end
        add_row(group_accs[c], key_j, r)
      end
      add_row(summary, key_j, r)

      local entry = { type = "row", key = key_j, depth = #chain, row = rows[j] }
      entries[#entries + 1] = entry
      by_key[key_j] = entry
    end

    for c, entry in pairs(group_entries) do
      entry.keys = group_accs[c].keys
      entry.products, entry.ingredients = net(group_accs[c])
    end

    local products, ingredients
    if has_rates then
      products, ingredients = net(summary)
    else
      -- A failed solve has no rates: say what the block was meant to make.
      products, ingredients = {}, {}
      for _, p in ipairs(refs(b.products)) do
        if not p.virtual then
          products[#products + 1] = p
        end
      end
      for _, p in ipairs(refs(b.imports)) do
        if not p.virtual then
          ingredients[#ingredients + 1] = p
        end
      end
    end

    return {
      index = i,
      name = b.name,
      key = key,
      color = color(b.color),
      products = refs(b.products),
      rows = rows,
      imports = refs(b.imports),
      error = b.error,
      has_beacon = has_beacon,
      entries = entries,
      by_key = by_key,
      summary = { keys = summary.keys, products = products, ingredients = ingredients },
    }
  end

  local blocks = {}
  local block_keys = {}
  for i, b in ipairs(snapshot.blocks) do
    blocks[i] = build_block(i, b, unique(block_keys, b.name))
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
