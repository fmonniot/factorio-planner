-- export-game-data.lua
--
-- Exports Factorio prototype data (items, fluids, recipes, machines, modules)
-- to a JSON file for use by the factorio-planner web app.
--
-- DELIVERY:
--   Option A — In-game console:
--     Open the console with ~ and paste this entire script after /c
--     e.g.  /c <paste>
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
-- NOTE: This is a Phase 0.1 raw dump. Fields are extracted as-is from the
-- runtime prototype API. The goal is to see real data shapes, not to match
-- the final GameData schema yet.

local OUTPUT_FILE = "factorio-planner-export.json"

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Safely read a field that may not exist on a prototype.
local function field(proto, key)
  local ok, val = pcall(function() return proto[key] end)
  if ok then return val else return nil end
end

-- Convert a dictionary-style table (keys are the values) to an array of strings.
-- Used for crafting_categories which is { ["crafting"] = true, ... }
local function dict_keys(t)
  if not t then return {} end
  local result = {}
  for k, _ in pairs(t) do
    table.insert(result, k)
  end
  table.sort(result)
  return result
end

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

local function export_items()
  local items = {}
  for name, proto in pairs(game.item_prototypes) do
    items[name] = {
      name       = proto.name,
      type       = proto.type,       -- e.g. "item", "module", "tool", "armor", ...
      stack_size = proto.stack_size,
    }
  end
  return items
end

-- ---------------------------------------------------------------------------
-- Fluids
-- ---------------------------------------------------------------------------

local function export_fluids()
  local fluids = {}
  for name, proto in pairs(game.fluid_prototypes) do
    fluids[name] = {
      name                = proto.name,
      type                = "fluid",
      default_temperature = field(proto, "default_temperature"),
      max_temperature     = field(proto, "max_temperature"),
    }
  end
  return fluids
end

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------

local function export_ingredient(ing)
  return {
    name   = ing.name,
    type   = ing.type,    -- "item" or "fluid"
    amount = ing.amount,
    -- Fluid-specific temperature constraints (may be nil for items)
    minimum_temperature = field(ing, "minimum_temperature"),
    maximum_temperature = field(ing, "maximum_temperature"),
  }
end

local function export_product(prod)
  return {
    name        = prod.name,
    type        = prod.type,    -- "item" or "fluid"
    amount      = prod.amount,
    -- Probabilistic products: amount_min/amount_max define the range;
    -- when set, amount holds the average. probability < 1 means it may not appear.
    amount_min  = field(prod, "amount_min"),
    amount_max  = field(prod, "amount_max"),
    probability = field(prod, "probability"),
  }
end

local function export_recipes()
  local recipes = {}
  for name, proto in pairs(game.recipe_prototypes) do
    local ingredients = {}
    for _, ing in pairs(proto.ingredients) do
      table.insert(ingredients, export_ingredient(ing))
    end

    local products = {}
    for _, prod in pairs(proto.products) do
      table.insert(products, export_product(prod))
    end

    recipes[name] = {
      name        = proto.name,
      category    = proto.category,
      -- energy is crafting time in SECONDS (at crafting_speed = 1).
      -- Not to be confused with MJ — this is purely a time duration.
      energy      = proto.energy,
      ingredients = ingredients,
      products    = products,
      enabled     = proto.enabled,
      hidden      = proto.hidden,
      -- main_product is the "primary" output item name when there are multiple
      -- products. nil if the recipe has a single product or no clear main.
      main_product = field(proto, "main_product") and field(proto, "main_product").name or nil,
    }
  end
  return recipes
end

-- ---------------------------------------------------------------------------
-- Machines
-- ---------------------------------------------------------------------------

-- Entity types that can execute recipes. We cast a wide net here and will
-- filter/classify in the data analysis step.
local CRAFTING_ENTITY_TYPES = {
  ["assembling-machine"] = true,
  ["furnace"]            = true,
  ["rocket-silo"]        = true,
}

local function export_machines()
  local machines = {}
  for name, proto in pairs(game.entity_prototypes) do
    if CRAFTING_ENTITY_TYPES[proto.type] then
      -- energy_usage is in watts (as a plain number, e.g. 150000 = 150kW).
      -- energy_drain is the idle drain for electric machines.
      local energy_source = field(proto, "electric_energy_source_prototype")
      local drain = energy_source and field(energy_source, "drain") or nil

      machines[name] = {
        name               = proto.name,
        type               = proto.type,
        crafting_speed     = proto.crafting_speed,
        energy_usage       = field(proto, "energy_usage"),   -- watts
        energy_drain       = drain,                          -- watts idle, nil for non-electric
        crafting_categories = dict_keys(field(proto, "crafting_categories")),
        module_slots       = field(proto, "module_slots") or 0,
        -- allowed_effects is a set of effect names this machine accepts from modules.
        -- e.g. { "speed" = true, "productivity" = true, ... }
        allowed_effects    = dict_keys(field(proto, "allowed_effects")),
      }
    end
  end
  return machines
end

-- ---------------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------------

-- Modules are a subtype of item. We filter item_prototypes by type == "module".
local function export_modules()
  local modules = {}
  for name, proto in pairs(game.item_prototypes) do
    if proto.type == "module" then
      local effects = field(proto, "module_effects")
      local parsed_effects = {}
      if effects then
        -- Each effect is { bonus = number }. We record the bonus directly.
        for effect_name, effect_data in pairs(effects) do
          parsed_effects[effect_name] = effect_data.bonus
        end
      end

      -- limitation is an array of recipe names this module is restricted to.
      -- Empty array means unrestricted.
      local limitation = {}
      local raw_limitation = field(proto, "limitation")
      if raw_limitation then
        for _, recipe_name in pairs(raw_limitation) do
          table.insert(limitation, recipe_name)
        end
      end

      local limitation_blacklist = {}
      local raw_blacklist = field(proto, "limitation_blacklist")
      if raw_blacklist then
        for _, recipe_name in pairs(raw_blacklist) do
          table.insert(limitation_blacklist, recipe_name)
        end
      end

      modules[name] = {
        name                 = proto.name,
        tier                 = field(proto, "tier"),
        effects              = parsed_effects,
        limitation           = limitation,
        limitation_blacklist = limitation_blacklist,
      }
    end
  end
  return modules
end

-- ---------------------------------------------------------------------------
-- Main
-- ---------------------------------------------------------------------------

local function run()
  log("[factorio-planner] Starting export...")

  local output = {
    -- game.active_mods is a dict { mod_name = version_string }
    active_mods = game.active_mods,
    items       = export_items(),
    fluids      = export_fluids(),
    recipes     = export_recipes(),
    machines    = export_machines(),
    modules     = export_modules(),
  }

  local json = game.table_to_json(output)
  game.write_file(OUTPUT_FILE, json)

  local counts = {
    "items="    .. tostring(#(function() local n=0 for _ in pairs(output.items)    do n=n+1 end return n end)()),
    "fluids="   .. tostring(#(function() local n=0 for _ in pairs(output.fluids)   do n=n+1 end return n end)()),
    "recipes="  .. tostring(#(function() local n=0 for _ in pairs(output.recipes)  do n=n+1 end return n end)()),
    "machines=" .. tostring(#(function() local n=0 for _ in pairs(output.machines) do n=n+1 end return n end)()),
    "modules="  .. tostring(#(function() local n=0 for _ in pairs(output.modules)  do n=n+1 end return n end)()),
  }
  -- # operator doesn't work on dict-style tables; use a helper
  local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
  local summary = string.format(
    "[factorio-planner] Export complete. items=%d fluids=%d recipes=%d machines=%d modules=%d",
    count(output.items), count(output.fluids), count(output.recipes),
    count(output.machines), count(output.modules)
  )

  log(summary)
  game.print(summary)
  game.print("[factorio-planner] Written to script-output/" .. OUTPUT_FILE)
end

-- When used as a mod, run on_tick once then deregister.
-- When pasted as a console command, script.on_event is available but
-- we can call run() directly since we're already in a valid game state.
if script then
  script.on_event(defines.events.on_tick, function(event)
    script.on_event(defines.events.on_tick, nil)  -- run once
    run()
  end)
else
  run()
end
