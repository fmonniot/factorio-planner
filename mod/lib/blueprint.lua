-- From a view-model row and what the game says about the building, decides what
-- a click on its icon puts in the cursor. Plain Lua: no game API, so it runs under
-- busted; scripts/cursor.lua reads the prototype, passes it in as `info` and
-- carries out the result.
--
--   blueprint.for_machine(row, info)   the row's machine
--   blueprint.for_beacon(row, info)    the row's beacon (row.beacon from the view-model)
--
-- `row` is a view-model row (lib/viewmodel.lua). `info` is nil when the game has no
-- such entity, else
--   {
--     type             = "assembling-machine",   -- LuaEntityPrototype.type
--     blueprintable    = bool,   -- not the "not-blueprintable" flag
--     player_creatable = bool,   -- the "player-creation" flag
--     place_item       = "name" | nil,   -- the item that places it (items_to_place_this)
--     tile_width       = n | nil, tile_height = n | nil,   -- default 1; centres the entity on the grid
--     inventories      = defines.inventory,   -- name -> number, for the module inventories
--   }
-- and the result is one of
--   { kind = "blueprint", entities = { <one BlueprintEntity> } }   a one-entity blueprint
--   { kind = "ghost", item = "name" }                              a plain ghost of the item
--   { kind = "refused", reason = <reason> }                        flying text; nothing placed
-- with the reasons
--   "no-machine"          the row has no machine (or no beacon)
--   "unknown-entity"      the game lacks the building (info is nil or the id was flagged missing)
--   "not-blueprintable", "not-placeable"   the prototype cannot be placed that way
--   "unknown-recipe"      the game lacks the row's recipe
--   "unknown-module"      the game lacks a module of the building
--   "no-module-inventory" modules to place in a type that has no known module inventory
--   "too-many-modules"    more module slots than any building has
--
-- A blueprint is made when there is a recipe to set (only an `assembling-machine`
-- or a `rocket-silo` takes one in a blueprint) or modules to place; else it is a ghost.
-- Module slots are numbered from 0 in order, one inventory per type.
local M = {}

-- The inventory a type's modules go in, by name in defines.inventory. The
-- deprecated per-type names (assembling_machine_modules, ...) are not used.
M.MODULE_INVENTORY = {
  ["assembling-machine"] = "crafter_modules",
  ["furnace"] = "crafter_modules",
  ["rocket-silo"] = "crafter_modules",
  ["mining-drill"] = "mining_drill_modules",
  ["beacon"] = "beacon_modules",
}

-- Types whose blueprint entity takes a `recipe`.
M.RECIPE_TYPES = { ["assembling-machine"] = true, ["rocket-silo"] = true }

-- More than any building has; a hand-made snapshot must not make a loop run away.
M.MAX_MODULE_SLOTS = 256

local function refused(reason)
  return { kind = "refused", reason = reason }
end

-- target = { id, id_missing, recipe = id | nil, recipe_missing, modules = { { id, count, missing } } }
local function plan(target, info)
  if target.id == nil then
    return refused("no-machine")
  end
  if info == nil or target.id_missing then
    return refused("unknown-entity")
  end
  if not info.blueprintable then
    return refused("not-blueprintable")
  end
  if not info.player_creatable or not info.place_item then
    return refused("not-placeable")
  end
  if target.recipe_missing then
    return refused("unknown-recipe")
  end
  local slots = 0
  for _, m in ipairs(target.modules) do
    if m.missing then
      return refused("unknown-module")
    end
    slots = slots + m.count
  end
  if slots > M.MAX_MODULE_SLOTS then
    return refused("too-many-modules")
  end

  local recipe = M.RECIPE_TYPES[info.type] and target.recipe or nil
  if slots == 0 and recipe == nil then
    return { kind = "ghost", item = info.place_item }
  end

  local entity = {
    entity_number = 1,
    name = target.id,
    -- The centre of the entity on the tile grid: half a tile for an odd size.
    position = { x = ((info.tile_width or 1) % 2) / 2, y = ((info.tile_height or 1) % 2) / 2 },
    recipe = recipe,
  }
  if slots > 0 then
    local inventories = info.inventories or {}
    local inventory = inventories[M.MODULE_INVENTORY[info.type]]
    if inventory == nil then
      return refused("no-module-inventory")
    end
    local items, stack = {}, 0
    for _, m in ipairs(target.modules) do
      if m.count > 0 then
        local positions = {}
        for _ = 1, m.count do
          positions[#positions + 1] = { inventory = inventory, stack = stack }
          stack = stack + 1
        end
        items[#items + 1] = { id = { name = m.id }, items = { in_inventory = positions } }
      end
    end
    entity.items = items
  end
  return { kind = "blueprint", entities = { entity } }
end

function M.for_machine(row, info)
  return plan({
    id = row.machine,
    id_missing = row.machine_missing,
    recipe = row.recipe,
    recipe_missing = row.recipe_missing,
    modules = row.modules,
  }, info)
end

function M.for_beacon(row, info)
  local beacon = row.beacon
  if beacon == nil then
    return refused("no-machine")
  end
  -- A beacon has no recipe; the row's recipe is not its concern.
  return plan({ id = beacon.id, id_missing = beacon.missing, modules = beacon.modules }, info)
end

return M
