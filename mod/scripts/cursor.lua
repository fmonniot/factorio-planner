-- Puts a row's building in the player's cursor: the game-facing half of
-- lib/blueprint.lua, which decides what to place. This file reads the entity
-- prototype for it and carries out its answer:
--
--   * a one-entity blueprint, built in a script inventory, copied to the player's
--     clipboard and pasted from there (paste mode), as Factory Planner's
--     util/cursor.lua does; no item is left in the player's inventory;
--   * a ghost of the item that places the building (`cursor_ghost`);
--   * a short flying text at the cursor when it cannot be placed.
--
-- The script inventory is destroyed whatever happens, also when a call raises,
-- so none is left in the save. A raise is passed on to the caller (control.lua
-- runs this inside pcall and logs it once). It holds no state.
local blueprint = require("lib.blueprint")
local format = require("lib.format")

local L = format.LOCALE

local M = {}

local function key(name)
  return L .. "." .. name
end

-- The flying text of each refusal reason of lib/blueprint.lua, plus the cursor
-- that cannot be emptied and a call that raised.
local REASONS = {
  ["no-machine"] = key("refused-no-machine"),
  ["unknown-entity"] = key("refused-unknown-entity"),
  ["not-blueprintable"] = key("refused-not-blueprintable"),
  ["not-placeable"] = key("refused-not-placeable"),
  ["unknown-recipe"] = key("refused-unknown-recipe"),
  ["unknown-module"] = key("refused-unknown-module"),
  ["no-module-inventory"] = key("refused-no-module-inventory"),
  ["too-many-modules"] = key("refused-too-many-modules"),
  ["cursor-full"] = key("refused-cursor-full"),
  ["failed"] = key("refused-failed"),
}
M.REASONS = REASONS

-- Shows why nothing was placed, at the cursor.
function M.refuse(player, reason)
  player.create_local_flying_text({
    text = { key("cannot-place"), { REASONS[reason] or REASONS["failed"] } },
    create_at_cursor = true,
  })
end

-- The item that places an entity: the first of items_to_place_this (a list of
-- { name, count }; a plain name is accepted too).
local function place_item(proto)
  local items = proto.items_to_place_this
  local first = items and items[1]
  if type(first) == "table" then
    return first.name
  end
  return first
end

-- What lib/blueprint.lua needs to know about the building; nil when the game
-- lacks it.
local function entity_info(id)
  if id == nil then
    return nil
  end
  local proto = prototypes.entity[id]
  if proto == nil then
    return nil
  end
  return {
    type = proto.type,
    blueprintable = not proto.has_flag("not-blueprintable"),
    player_creatable = proto.has_flag("player-creation"),
    place_item = place_item(proto),
    tile_width = proto.tile_width,
    tile_height = proto.tile_height,
    inventories = defines.inventory,
  }
end

-- The blueprint goes through a script inventory: a blueprint item needs a stack
-- to live in. The inventory is destroyed even when a call raises.
local function paste_blueprint(player, entities)
  local inventory = game.create_inventory(1)
  local ok, err = pcall(function()
    local stack = inventory[1]
    stack.set_stack({ name = "blueprint" })
    stack.set_blueprint_entities(entities)
    player.add_to_clipboard(stack)
    player.activate_paste()
  end)
  inventory.destroy()
  if not ok then
    error(err, 0)
  end
end

-- `what` is "machine" or "beacon" (format.TAG_MACHINE, format.TAG_BEACON);
-- `row` a view-model row. Returns what was done: "blueprint", "ghost" or the
-- refusal reason shown.
function M.place(player, row, what)
  local plan
  if what == format.TAG_BEACON then
    plan = blueprint.for_beacon(row, entity_info(row.beacon and row.beacon.id))
  else
    plan = blueprint.for_machine(row, entity_info(row.machine))
  end
  if plan.kind == "refused" then
    M.refuse(player, plan.reason)
    return plan.reason
  end
  -- Whatever the player held goes back to the inventory first; a full inventory
  -- keeps it in the cursor, and then nothing is placed.
  if not player.clear_cursor() then
    M.refuse(player, "cursor-full")
    return "cursor-full"
  end
  if plan.kind == "ghost" then
    player.cursor_ghost = { name = plan.item, quality = "normal" }
    return "ghost"
  end
  paste_blueprint(player, plan.entities)
  return "blueprint"
end

return M
