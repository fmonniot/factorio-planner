-- export-game-data.lua
--
-- Exports Factorio prototype data to a GameData JSON bundle for use by the
-- factorio-planner web app. The output matches the GameData TypeScript interface
-- in src/data/types.ts and passes the Zod schema in src/data/schema.ts.
--
-- DELIVERY:
--   Option A — In-game console:
--     Open the console with ~ and paste this entire script after /c
--
--   Option B — Simple mod:
--     Create a folder in your mods directory called "factorio-planner-export_1.0.0"
--     Place this file as control.lua inside it, alongside the info.json below.
--
--   info.json contents:
--     { "name": "factorio-planner-export", "version": "1.0.0",
--       "title": "Factorio Planner Export", "author": "you",
--       "factorio_version": "2.0", "dependencies": [] }
--
-- OUTPUT:
--   script-output/factorio-planner-export.json
--
--   Windows: %APPDATA%\Factorio\script-output\
--   Linux:   ~/.factorio/script-output/
--   macOS:   ~/Library/Application Support/factorio/script-output/
--
-- IMPORT
--   You can easily import the generated json into this project with a command like the
--   following:
--   cp ~/Library/Application\ Support/factorio/script-output/factorio-planner-export.json \
--      data/samples/nullius/game-data.json

local OUTPUT_FILE = "factorio-planner-export.json"

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Safely read a field that may not exist on a prototype.
local function field(proto, key)
  local ok, val = pcall(function() return proto[key] end)
  if ok then return val else return nil end
end

-- Parse an energy string like "75kW", "9.75MW", "180W" to kilowatts.
-- If the value is already a number (watts from some API versions) convert it.
--
-- MANUAL TEST CHECKLIST (Lua has no unit-test runner; verify in the console):
--   parse_energy_kw(nil)        → 0
--   parse_energy_kw(0)          → 0        (number passthrough: 0W)
--   parse_energy_kw(150000)     → 150      (number passthrough: 150kW)
--   parse_energy_kw("")         → 0
--   parse_energy_kw("180W")     → 0.18
--   parse_energy_kw("75kW")     → 75
--   parse_energy_kw("150kW")    → 150
--   parse_energy_kw("9.75MW")   → 9750
--   parse_energy_kw("1GW")      → 1000000
--   parse_energy_kw("500KW")    → 500      (case-insensitive)
--   parse_energy_kw("bogus")    → 0
-- To run in-game: /c game.print(parse_energy_kw("9.75MW"))  -- expects 9750
local function parse_energy_kw(s)
  if s == nil then return 0 end
  if type(s) == "number" then return s / 1000 end
  if type(s) ~= "string" or s == "" then return 0 end
  local num, unit = s:match("^([%d%.]+)%s*([kKmMgGtT]?[wW])")
  if not num then return 0 end
  num = tonumber(num) or 0
  local u = unit:upper()
  if u == "KW" then return num
  elseif u == "MW" then return num * 1000
  elseif u == "GW" then return num * 1000000
  elseif u == "TW" then return num * 1000000000
  else return num / 1000  -- plain "W"
  end
end

-- Convert a boolean-dict table ({ key = true, ... }) to a sorted array of keys.
local function dict_keys(t)
  if not t then return {} end
  local result = {}
  for k, _ in pairs(t) do
    table.insert(result, k)
  end
  table.sort(result)
  return result
end

-- Return the energy type string for an entity prototype.
local function get_energy_type(proto)
  if field(proto, "electric_energy_source_prototype") ~= nil then return "electric" end
  if field(proto, "burner_prototype")                 ~= nil then return "burner"   end
  if field(proto, "heat_energy_source_prototype")     ~= nil then return "heat"     end
  return "void"
end

-- ---------------------------------------------------------------------------
-- Items (items + fluids unified under type "item" | "fluid")
-- ---------------------------------------------------------------------------

local function export_items()
  local items = {}

  -- All item subtypes (tool, ammo, armor, module, etc.) are normalised to "item".
  -- Note: proto.name is the internal name (e.g. "iron-plate"). Localised display
  -- names require a locale lookup that is not easily available in a console script;
  -- the app falls back to the internal name for display until a richer export is available.
  for name, proto in pairs(prototypes.item) do
    items[name] = {
      id        = proto.name,
      name      = proto.name,
      type      = "item",
      iconPath  = "",   -- icons are handled separately (see spec/plan.md phase 7)
      stackSize = proto.stack_size,
    }
  end

  -- Fluids are stored in the same table with type = "fluid".
  for name, proto in pairs(prototypes.fluid) do
    items[name] = {
      id       = proto.name,
      name     = proto.name,
      type     = "fluid",
      iconPath = "",
    }
  end

  return items
end

-- ---------------------------------------------------------------------------
-- Machines (assembling-machine, furnace, rocket-silo)
-- ---------------------------------------------------------------------------

local CRAFTING_ENTITY_TYPES = {
  ["assembling-machine"] = true,
  ["furnace"]            = true,
  ["rocket-silo"]        = true,
}

local function export_machines()
  local machines = {}

  for name, proto in pairs(prototypes.entity) do
    if CRAFTING_ENTITY_TYPES[proto.type] then
      local energy_source = field(proto, "electric_energy_source_prototype")
      local drain_raw     = energy_source and field(energy_source, "drain") or nil

      -- allowed_effects may be a bool-dict or nil; normalise to array of strings.
      local raw_effects = field(proto, "allowed_effects")
      local effects = {}
      if type(raw_effects) == "table" then
        for effect_name, _ in pairs(raw_effects) do
          table.insert(effects, effect_name)
        end
        table.sort(effects)
      end

      -- crafting_categories is also a bool-dict on entity prototypes.
      local raw_cats = field(proto, "crafting_categories")
      local cats = {}
      if type(raw_cats) == "table" then
        for cat_name, _ in pairs(raw_cats) do
          table.insert(cats, cat_name)
        end
        table.sort(cats)
      end

      machines[name] = {
        id                = proto.name,
        name              = proto.name,
        type              = proto.type,
        -- In Factorio 2.0 the property proto.crafting_speed was replaced by the
        -- method proto:get_crafting_speed(quality?). Call it via pcall so the
        -- script does not crash on prototypes that lack the method, falling back
        -- to 1 (base speed) only as a last resort.
        craftingSpeed     = (function()
          local ok, v = pcall(function() return proto:get_crafting_speed() end)
          return (ok and type(v) == "number" and v) or 1
        end)(),
        energyUsageKw     = parse_energy_kw(field(proto, "energy_usage")),
        energyType        = get_energy_type(proto),
        drainKw           = parse_energy_kw(drain_raw),
        moduleSlots       = field(proto, "module_inventory_size") or 0,
        allowedEffects    = effects,
        craftingCategories = cats,
        iconPath          = "",
      }
    end
  end

  return machines
end

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------

local function export_ingredient(ing)
  return {
    itemId  = ing.name,
    type    = ing.type,   -- "item" or "fluid"
    amount  = ing.amount,
    minimumTemperature = field(ing, "minimum_temperature"),
    maximumTemperature = field(ing, "maximum_temperature"),
  }
end

local function export_product(prod)
  return {
    itemId                = prod.name,
    type                  = prod.type,
    amount                = prod.amount,
    probability           = field(prod, "probability"),
    amountMin             = field(prod, "amount_min"),
    amountMax             = field(prod, "amount_max"),
    ignoredByProductivity = field(prod, "ignored_by_productivity"),
  }
end

-- Build a reverse map: category -> array of machine ids.
local function build_category_map(machines)
  local map = {}
  for machine_id, machine_data in pairs(machines) do
    for _, cat in ipairs(machine_data.craftingCategories) do
      if not map[cat] then map[cat] = {} end
      table.insert(map[cat], machine_id)
    end
  end
  return map
end

local function export_recipes(category_map)
  local recipes = {}

  for name, proto in pairs(prototypes.recipe) do
    -- Skip blueprint parameter placeholder recipes (no real products).
    if proto.parameter then goto continue end

    local ingredients = {}
    for _, ing in ipairs(proto.ingredients) do
      table.insert(ingredients, export_ingredient(ing))
    end

    local products = {}
    for _, prod in ipairs(proto.products) do
      table.insert(products, export_product(prod))
    end

    -- main_product in the runtime API is either:
    --   nil            → single-product recipe (or absent) — omit the field
    --   a prototype    → the primary product; use its .name
    --   "" (string)    → explicitly multi-output with no primary → emit JSON null
    -- game.table_to_json serialises Lua nil fields as absent, not "null".
    -- We use the sentinel string "__null__" for the multi-output case and
    -- post-process at import, OR we emit 0 products case below.
    -- Simplest approach: use JSON-serialisable false to mean "null" is not
    -- workable since Zod expects string|null|undefined.
    -- Instead: we store the field only when meaningful.
    -- "" is an empty string in Lua when main_product is explicitly "".
    local mp_val = field(proto, "main_product")
    local main_product
    if mp_val == nil then
      main_product = nil        -- absent: field will be omitted by table_to_json
    elseif type(mp_val) == "string" and mp_val == "" then
      -- Explicit multi-output, no primary.
      -- We store the empty string; the loader normalises "" → null.
      main_product = ""
    elseif type(mp_val) == "table" and mp_val.name then
      main_product = mp_val.name
    else
      main_product = nil
    end

    -- madeIn: machine ids that can execute this recipe's category.
    local cat = proto.category or "crafting"
    local made_in = {}
    if category_map[cat] then
      for _, mid in ipairs(category_map[cat]) do
        table.insert(made_in, mid)
      end
      table.sort(made_in)
    end

    recipes[name] = {
      id               = proto.name,
      name             = proto.name,
      category         = cat,
      craftingTime     = proto.energy,
      ingredients      = ingredients,
      products         = products,
      madeIn           = made_in,
      -- allow_productivity was removed in Factorio 2.0. Productivity support is
      -- now expressed via allowed_effects on LuaRecipePrototype: the dict includes
      -- "productivity" as a key when the recipe allows productivity modules.
      allowProductivity = (function()
        local effects = field(proto, "allowed_effects")
        return type(effects) == "table" and effects["productivity"] == true or false
      end)(),
      mainProduct      = main_product,
    }

    ::continue::
  end

  return recipes
end

-- ---------------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------------

local function export_modules()
  local modules = {}

  for name, proto in pairs(prototypes.item) do
    if proto.type == "module" then
      local parsed_effects = {}
      local raw_effects = field(proto, "module_effects")
      if raw_effects then
        for effect_name, effect_data in pairs(raw_effects) do
          parsed_effects[effect_name] = type(effect_data) == "table" and effect_data.bonus or effect_data
        end
      end

      -- limitation and limitation_blacklist were removed from LuaItemPrototype in
      -- Factorio 2.0. Recipe-level module restrictions are now expressed via
      -- allowed_effects and allowed_module_categories on LuaRecipePrototype.
      -- These fields are kept as empty arrays for schema compatibility.
      local limitation = {}
      local limitation_blacklist = {}

      modules[name] = {
        id                   = proto.name,
        name                 = proto.name,
        category             = field(proto, "category") or "unknown",
        tier                 = field(proto, "tier") or 0,
        effects              = parsed_effects,
        limitation           = limitation,
        limitationBlacklist  = limitation_blacklist,
      }
    end
  end

  return modules
end

-- ---------------------------------------------------------------------------
-- Default machines: best (highest craftingSpeed) machine per category
-- ---------------------------------------------------------------------------

local function compute_default_machines(machines, category_map)
  local defaults = {}
  for cat, machine_ids in pairs(category_map) do
    local best_id    = nil
    local best_speed = -1
    for _, mid in ipairs(machine_ids) do
      local speed = machines[mid] and machines[mid].craftingSpeed or 0
      if speed > best_speed then
        best_speed = speed
        best_id    = mid
      end
    end
    if best_id then
      defaults[cat] = best_id
    end
  end
  return defaults
end

-- ---------------------------------------------------------------------------
-- Main
-- ---------------------------------------------------------------------------

local function run()
  log("[factorio-planner] Starting export...")

  local machines     = export_machines()
  local category_map = build_category_map(machines)
  local recipes      = export_recipes(category_map)

  local output = {
    factorioVersion = script.active_mods["base"],
    modSet          = script.active_mods,
    items           = export_items(),
    recipes         = recipes,
    machines        = machines,
    modules         = export_modules(),
    defaultMachines = compute_default_machines(machines, category_map),
  }

  local json = helpers.table_to_json(output)
  helpers.write_file(OUTPUT_FILE, json)

  local function count(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
  end

  local summary = string.format(
    "[factorio-planner] Export complete — factorioVersion=%s items=%d recipes=%d machines=%d modules=%d",
    output.factorioVersion,
    count(output.items),
    count(output.recipes),
    count(output.machines),
    count(output.modules)
  )

  log(summary)
  game.print(summary)
  game.print("[factorio-planner] Written to script-output/" .. OUTPUT_FILE)
end

-- When used as a mod, run on_tick once then deregister.
-- When pasted as a console command, call run() directly.
if script then
  script.on_event(defines.events.on_tick, function(_event)
    script.on_event(defines.events.on_tick, nil)  -- run once
    run()
  end)
else
  run()
end
