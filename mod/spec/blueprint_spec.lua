local blueprint = require("lib.blueprint")
local viewmodel = require("lib.viewmodel")
local support = require("spec.support")

local INVENTORIES = { crafter_modules = 4, mining_drill_modules = 9, beacon_modules = 7 }

local function module(id, count, missing)
  return { id = id, count = count, missing = missing or false }
end

-- A view-model row, with what the test cares about. A field given as false is
-- removed (a table constructor cannot carry nil).
local function row(fields)
  local r = { machine = "machine-1", machine_missing = false, recipe = "recipe-1", recipe_missing = false, modules = {} }
  for k, v in pairs(fields or {}) do
    if v == false then
      r[k] = nil
    else
      r[k] = v
    end
  end
  return r
end

local function info(fields)
  local i = {
    type = "assembling-machine",
    blueprintable = true,
    player_creatable = true,
    place_item = "machine-1",
    inventories = INVENTORIES,
  }
  for k, v in pairs(fields or {}) do
    i[k] = v
  end
  return i
end

local function refusal(result)
  assert.are.equal("refused", result.kind)
  return result.reason
end

describe("blueprint.for_machine", function()
  it("makes a one-entity blueprint with the recipe and the modules for an assembling machine", function()
    local result = blueprint.for_machine(
      row({ modules = { module("speed-module", 2), module("productivity-module", 1) } }),
      info()
    )
    assert.are.equal("blueprint", result.kind)
    assert.are.same({
      {
        entity_number = 1,
        name = "machine-1",
        position = { x = 0.5, y = 0.5 },
        recipe = "recipe-1",
        items = {
          {
            id = { name = "speed-module" },
            items = { in_inventory = { { inventory = 4, stack = 0 }, { inventory = 4, stack = 1 } } },
          },
          {
            id = { name = "productivity-module" },
            items = { in_inventory = { { inventory = 4, stack = 2 } } },
          },
        },
      },
    }, result.entities)
  end)

  it("sets the recipe with no modules on an assembling machine, with no items", function()
    local result = blueprint.for_machine(row(), info())
    assert.are.equal("blueprint", result.kind)
    assert.are.equal("recipe-1", result.entities[1].recipe)
    assert.is_nil(result.entities[1].items)
  end)

  it("sets the recipe on a rocket silo, in the crafter module inventory", function()
    local result = blueprint.for_machine(row({ modules = { module("speed-module", 1) } }), info({ type = "rocket-silo" }))
    assert.are.equal("recipe-1", result.entities[1].recipe)
    assert.are.equal(4, result.entities[1].items[1].items.in_inventory[1].inventory)
  end)

  it("makes a blueprint for a furnace with modules: modules, no recipe", function()
    local result = blueprint.for_machine(row({ modules = { module("speed-module", 2) } }), info({ type = "furnace" }))
    assert.are.equal("blueprint", result.kind)
    assert.is_nil(result.entities[1].recipe)
    assert.are.equal(4, result.entities[1].items[1].items.in_inventory[2].inventory)
    assert.are.equal(1, result.entities[1].items[1].items.in_inventory[2].stack)
  end)

  it("puts a furnace with no modules in the cursor as a ghost of the item that places it", function()
    local result = blueprint.for_machine(row(), info({ type = "furnace", place_item = "stone-furnace-item" }))
    assert.are.same({ kind = "ghost", item = "stone-furnace-item" }, result)
  end)

  it("makes a blueprint for a mining drill with modules, in the drill inventory", function()
    local result = blueprint.for_machine(row({ recipe = false, modules = { module("speed-module", 3) } }), info({ type = "mining-drill" }))
    assert.are.equal("blueprint", result.kind)
    assert.is_nil(result.entities[1].recipe)
    local positions = result.entities[1].items[1].items.in_inventory
    assert.are.same({ { inventory = 9, stack = 0 }, { inventory = 9, stack = 1 }, { inventory = 9, stack = 2 } }, positions)
  end)

  it("puts a plain building (a generator, a pump, a drill with no modules) in the cursor as a ghost", function()
    for _, type in ipairs({ "generator", "offshore-pump", "mining-drill", "boiler" }) do
      local result = blueprint.for_machine(row({ recipe = false }), info({ type = type, place_item = "item-" .. type }))
      assert.are.same({ kind = "ghost", item = "item-" .. type }, result)
    end
  end)

  it("sets no recipe on a type that cannot take one, though the row has a recipe", function()
    local result = blueprint.for_machine(row({ modules = { module("speed-module", 1) } }), info({ type = "furnace" }))
    assert.is_nil(result.entities[1].recipe)
  end)

  it("makes a ghost, not a blueprint, for an assembling-machine row that has no recipe and no modules", function()
    local result = blueprint.for_machine(row({ recipe = false }), info())
    assert.are.equal("ghost", result.kind)
  end)

  it("numbers the slots from 0 in order across entries", function()
    local result = blueprint.for_machine(
      row({ modules = { module("a", 1), module("b", 2), module("a", 1) } }),
      info()
    )
    local stacks = {}
    for _, plan in ipairs(result.entities[1].items) do
      for _, p in ipairs(plan.items.in_inventory) do
        stacks[#stacks + 1] = plan.id.name .. p.stack
      end
    end
    assert.are.same({ "a0", "b1", "b2", "a3" }, stacks)
  end)

  it("skips a module entry with a count of 0", function()
    local result = blueprint.for_machine(row({ modules = { module("a", 0), module("b", 1) } }), info())
    assert.are.equal(1, #result.entities[1].items)
    assert.are.equal(0, result.entities[1].items[1].items.in_inventory[1].stack)
  end)

  it("centres an entity of an even size on a tile corner", function()
    local result = blueprint.for_machine(row(), info({ tile_width = 2, tile_height = 2 }))
    assert.are.same({ x = 0, y = 0 }, result.entities[1].position)
    result = blueprint.for_machine(row(), info({ tile_width = 9, tile_height = 9 }))
    assert.are.same({ x = 0.5, y = 0.5 }, result.entities[1].position)
    result = blueprint.for_machine(row(), info({ tile_width = 3, tile_height = 2 }))
    assert.are.same({ x = 0.5, y = 0 }, result.entities[1].position)
  end)

  describe("refuses", function()
    it("a row with no machine", function()
      assert.are.equal("no-machine", refusal(blueprint.for_machine(row({ machine = false }), info())))
    end)

    it("a building the game lacks, whether the game said so or the view-model flagged it", function()
      assert.are.equal("unknown-entity", refusal(blueprint.for_machine(row(), nil)))
      assert.are.equal("unknown-entity", refusal(blueprint.for_machine(row({ machine_missing = true }), info())))
    end)

    it("a building that is not blueprintable", function()
      assert.are.equal("not-blueprintable", refusal(blueprint.for_machine(row(), info({ blueprintable = false }))))
    end)

    it("a building the player cannot create, or no item places", function()
      assert.are.equal("not-placeable", refusal(blueprint.for_machine(row(), info({ player_creatable = false }))))
      assert.are.equal("not-placeable", refusal(blueprint.for_machine(row(), info({ place_item = false }))))
    end)

    it("a recipe the game lacks", function()
      assert.are.equal("unknown-recipe", refusal(blueprint.for_machine(row({ recipe_missing = true }), info())))
      assert.are.equal(
        "unknown-recipe",
        refusal(blueprint.for_machine(row({ recipe_missing = true }), info({ type = "furnace" })))
      )
    end)

    it("a module the game lacks, rather than placing the building without it", function()
      local r = row({ modules = { module("speed-module", 1), module("gone-module", 1, true) } })
      assert.are.equal("unknown-module", refusal(blueprint.for_machine(r, info())))
    end)

    it("modules in a type with no known module inventory", function()
      local r = row({ modules = { module("speed-module", 1) } })
      assert.are.equal("no-module-inventory", refusal(blueprint.for_machine(r, info({ type = "lab" }))))
      assert.are.equal("no-module-inventory", refusal(blueprint.for_machine(r, info({ inventories = {} }))))
      assert.are.equal("no-module-inventory", refusal(blueprint.for_machine(r, info({ inventories = false }))))
    end)

    it("an absurd number of modules", function()
      local r = row({ modules = { module("speed-module", 1e9) } })
      assert.are.equal("too-many-modules", refusal(blueprint.for_machine(r, info())))
    end)

    it("checks the entity before the recipe and the modules", function()
      local r = row({ recipe_missing = true, modules = { module("gone", 1, true) } })
      assert.are.equal("not-blueprintable", refusal(blueprint.for_machine(r, info({ blueprintable = false }))))
    end)
  end)
end)

describe("blueprint.for_beacon", function()
  local function beacon_row(fields)
    local beacon = { id = "beacon", missing = false, per_machine = 8, total = 8, modules = { module("speed-module", 2) } }
    for k, v in pairs(fields or {}) do
      beacon[k] = v
    end
    return row({ beacon = beacon })
  end
  local function beacon_info(fields)
    local i = info({ type = "beacon", place_item = "beacon" })
    for k, v in pairs(fields or {}) do
      i[k] = v
    end
    return i
  end

  it("makes a one-entity blueprint holding the beacon's modules, and no recipe", function()
    local result = blueprint.for_beacon(beacon_row(), beacon_info())
    assert.are.same({
      {
        entity_number = 1,
        name = "beacon",
        position = { x = 0.5, y = 0.5 },
        items = {
          {
            id = { name = "speed-module" },
            items = { in_inventory = { { inventory = 7, stack = 0 }, { inventory = 7, stack = 1 } } },
          },
        },
      },
    }, result.entities)
    assert.are.equal("blueprint", result.kind)
  end)

  it("puts a beacon with no module in the cursor as a ghost", function()
    local result = blueprint.for_beacon(beacon_row({ modules = {} }), beacon_info())
    assert.are.same({ kind = "ghost", item = "beacon" }, result)
  end)

  it("ignores the row's own recipe and modules", function()
    local r = beacon_row()
    r.recipe_missing = true
    r.modules = { module("gone", 1, true) }
    assert.are.equal("blueprint", blueprint.for_beacon(r, beacon_info()).kind)
  end)

  it("refuses a row with no beacon", function()
    assert.are.equal("no-machine", refusal(blueprint.for_beacon(row(), beacon_info())))
  end)

  it("refuses a beacon the game lacks, a module it lacks, and a beacon it cannot place", function()
    assert.are.equal("unknown-entity", refusal(blueprint.for_beacon(beacon_row(), nil)))
    assert.are.equal("unknown-entity", refusal(blueprint.for_beacon(beacon_row({ missing = true }), beacon_info())))
    assert.are.equal(
      "unknown-module",
      refusal(blueprint.for_beacon(beacon_row({ modules = { module("gone", 1, true) } }), beacon_info()))
    )
    assert.are.equal("not-placeable", refusal(blueprint.for_beacon(beacon_row(), beacon_info({ player_creatable = false }))))
  end)
end)

describe("blueprint on rows from the view-model", function()
  local function block()
    return viewmodel.build(support.read_json(support.CONTRACT .. "/fixtures/seablock-groups.json")).blocks[1]
  end
  local SEP = "\31"

  it("builds the furnace row's blueprint from its snapshot modules", function()
    local r = block().by_key["Plates and cables" .. SEP .. "sb-iron-plate-from-ore"].row
    local result = blueprint.for_machine(r, info({ type = "furnace", place_item = r.machine }))
    assert.are.equal("blueprint", result.kind)
    assert.are.equal(r.machine, result.entities[1].name)
    assert.are.equal("speed-module", result.entities[1].items[1].id.name)
    assert.are.equal(2, #result.entities[1].items[1].items.in_inventory)
  end)

  it("builds the beacon of the cable row", function()
    local r = block().by_key["Plates and cables" .. SEP .. "copper-cable"].row
    local result = blueprint.for_beacon(r, info({ type = "beacon", place_item = "beacon" }))
    assert.are.equal("beacon", result.entities[1].name)
    assert.are.equal(7, result.entities[1].items[1].items.in_inventory[1].inventory)
  end)

  it("puts a generator row in the cursor as a ghost", function()
    local r = block().rows[3]
    assert.are.equal("synthetic", r.kind)
    local result = blueprint.for_machine(r, info({ type = "solar-panel", place_item = "solar-panel" }))
    assert.are.same({ kind = "ghost", item = "solar-panel" }, result)
  end)
end)
