local snapshot = require("lib.snapshot")
local support = require("spec.support")

local function fixture(name)
  return support.read_json(support.CONTRACT .. "/fixtures/" .. name .. ".json")
end

describe("snapshot.validate", function()
  describe("the shared snapshot fixtures", function()
    for _, name in ipairs(support.list_snapshot_fixtures()) do
      it("accepts " .. name, function()
        local ok, reason, detail = snapshot.validate(fixture(name))
        assert.is_true(ok, tostring(reason) .. ": " .. tostring(detail))
      end)
    end
  end)

  local function invalid(description, mutate)
    it("refuses " .. description, function()
      local s = fixture("small")
      mutate(s)
      local ok, reason, detail = snapshot.validate(s)
      assert.is_nil(ok)
      assert.are.equal("invalid", reason)
      assert.is_string(detail)
    end)
  end

  it("refuses another version with the reason version, before looking at the shape", function()
    local ok, reason = snapshot.validate({ v = 2, nothing = "else" })
    assert.is_nil(ok)
    assert.are.equal("version", reason)
    local _, reason0 = snapshot.validate({ v = 0 })
    assert.are.equal("version", reason0)
  end)

  it("refuses what is not a table, or has no usable v, as invalid", function()
    for _, value in ipairs({ "text", 12, true }) do
      local _, reason = snapshot.validate(value)
      assert.are.equal("invalid", reason)
    end
    assert.are.equal("invalid", select(2, snapshot.validate({})))
    assert.are.equal("invalid", select(2, snapshot.validate({ v = "1" })))
    assert.are.equal("invalid", select(2, snapshot.validate({ v = 1, blocks = "none" })))
  end)

  invalid("a missing dataSet", function(s)
    s.dataSet = nil
  end)
  invalid("an empty dataSet id", function(s)
    s.dataSet.id = ""
  end)
  invalid("blocks that are not an array", function(s)
    s.blocks = { name = "x" }
  end)
  invalid("a block without a name", function(s)
    s.blocks[1].name = nil
  end)
  invalid("a colour that is not #rrggbb", function(s)
    s.blocks[1].color = "#3B82F6"
  end)
  invalid("a block without rows", function(s)
    s.blocks[1].rows = nil
  end)
  invalid("a product with an unknown type", function(s)
    s.blocks[1].products[1].type = "recipe"
  end)
  invalid("a negative rate", function(s)
    s.blocks[1].products[1].rate = -1
  end)
  invalid("a rate that is not a number", function(s)
    s.blocks[1].imports[1].rate = "160"
  end)
  invalid("a row with neither a recipe nor a kind", function(s)
    s.blocks[1].rows[1] = { machine = "m" }
  end)
  invalid("a row of an unknown kind", function(s)
    s.blocks[1].rows[1] = { kind = "smelting" }
  end)
  invalid("a fractional machinesCeil", function(s)
    s.blocks[1].rows[1].machinesCeil = 1.5
  end)
  invalid("an input with a bad rate", function(s)
    s.blocks[1].rows[1].inputs[1].rate = -1
  end)
  invalid("outputs that are not an array", function(s)
    s.blocks[1].rows[1].outputs = "iron"
  end)
  invalid("an output of an unknown type", function(s)
    s.blocks[1].rows[1].outputs[1].type = "recipe"
  end)
  invalid("a module without an id", function(s)
    s.blocks[1].rows[1].modules = { { count = 2 } }
  end)
  invalid("a module with a fractional count", function(s)
    s.blocks[1].rows[1].modules = { { id = "speed-module", count = 1.5 } }
  end)
  invalid("modules that are not a list", function(s)
    s.blocks[1].rows[1].modules = "speed-module"
  end)
  invalid("a beacon that is not an object", function(s)
    s.blocks[1].rows[1].beacon = "beacon"
  end)
  invalid("a beacon without an id", function(s)
    s.blocks[1].rows[1].beacon = { count = 8, module = "speed-module", modules = 2 }
  end)
  invalid("a beacon with a negative count", function(s)
    s.blocks[1].rows[1].beacon = { id = "beacon", count = -1, module = "speed-module", modules = 2 }
  end)
  invalid("a beacon without a module", function(s)
    s.blocks[1].rows[1].beacon = { id = "beacon", count = 1, modules = 2 }
  end)
  invalid("a beacon with a fractional module count", function(s)
    s.blocks[1].rows[1].beacon = { id = "beacon", count = 1, module = "speed-module", modules = 0.5 }
  end)
  invalid("a group index that is not an integer", function(s)
    s.blocks[1].rows[1].group = 0.5
  end)
  invalid("a negative group index", function(s)
    s.blocks[1].rows[1].group = -1
  end)
  invalid("groups that are not an array", function(s)
    s.blocks[1].groups = "all"
  end)
  invalid("a group without a name", function(s)
    s.blocks[1].groups = { { parent = 0 } }
  end)
  invalid("a group whose parent is not an index", function(s)
    s.blocks[1].groups = { { name = "A" }, { name = "B", parent = "A" } }
  end)
  invalid("a group whose area is not a boolean", function(s)
    s.blocks[1].groups = { { name = "A", area = 1 } }
  end)
  invalid("a non-string error", function(s)
    s.blocks[1].error = 5
  end)
  invalid("an array with a hole", function(s)
    s.blocks[1].rows[4] = s.blocks[1].rows[1]
  end)

  it("accepts a block with an error and unsolved rows", function()
    local s = fixture("small")
    s.blocks[1].error = "infeasible"
    s.blocks[1].rows = { { recipe = "iron-gear-wheel" } }
    assert.is_true(snapshot.validate(s))
  end)

  it("accepts a synthetic row with no product (its recipe left the data set)", function()
    local s = fixture("small")
    s.blocks[1].rows[1] = { kind = "mining", machines = 1, machinesCeil = 1 }
    assert.is_true(snapshot.validate(s))
  end)

  it("accepts groups, modules, a beacon and a row of a group", function()
    local s = fixture("small")
    s.blocks[1].groups = { { name = "A" }, { name = "B", parent = 0, area = true } }
    s.blocks[1].rows[1].group = 1
    s.blocks[1].rows[1].modules = { { id = "speed-module", count = 2 } }
    s.blocks[1].rows[1].beacon = { id = "beacon", count = 8, module = "speed-module", modules = 2 }
    assert.is_true(snapshot.validate(s))
  end)

  it("accepts a group or parent index that leads nowhere, which the view-model puts at the root", function()
    local s = fixture("small")
    s.blocks[1].groups = { { name = "A", parent = 7 } }
    s.blocks[1].rows[1].group = 99
    assert.is_true(snapshot.validate(s))
  end)

  it("accepts a snapshot that still carries the retired fields, and ignores them", function()
    local s = fixture("small")
    s.blocks[1].warnings = { { code = "" } }
    s.blocks[1].connections = { { id = "iron-plate" } }
    s.blocks[1].areas = { 1, 2 }
    s.blocks[1].rows[1].area = "x"
    s.blocks[1].rows[1].powerKw = -3
    assert.is_true(snapshot.validate(s))
  end)

  it("ignores keys it does not know, so a later addition within v 1 is not refused", function()
    local s = fixture("small")
    s.somethingNew = { 1, 2 }
    s.blocks[1].somethingNew = true
    assert.is_true(snapshot.validate(s))
  end)

  it("accepts empty tables as empty arrays, which is what json_to_table makes of []", function()
    local s = fixture("small")
    s.blocks[1].groups = {}
    s.blocks[1].rows[1].inputs = {}
    s.blocks[1].rows[1].modules = {}
    assert.is_true(snapshot.validate(s))
    assert.is_true(snapshot.validate({ v = 1, dataSet = { id = "x" }, blocks = {} }))
  end)
end)

describe("snapshot ids", function()
  local function ids(s)
    local out = {}
    for i, e in ipairs(snapshot.collect_ids(s)) do
      out[i] = e.kind .. ":" .. e.id
    end
    return out
  end

  it("lists each distinct item, fluid, recipe and machine id once, in order of appearance", function()
    assert.are.same({
      "item:iron-gear-wheel",
      "item:iron-ore",
      "recipe:iron-gear-wheel",
      "machine:bob-assembling-machine-6",
      "item:iron-plate",
      "recipe:sb-iron-plate-from-ore",
      "machine:bob-electric-chemical-mixing-furnace-2",
    }, ids(fixture("small")))
  end)

  it("keeps an item and a fluid of the same name apart", function()
    local s = fixture("small")
    s.blocks[1].products = {
      { id = "water", type = "item", rate = 1 },
      { id = "water", type = "fluid", rate = 1 },
      { id = "water", type = "fluid", rate = 2 },
    }
    local got = ids(s)
    assert.are.equal("item:water", got[1])
    assert.are.equal("fluid:water", got[2])
    assert.are_not.equal("fluid:water", got[3])
  end)

  it("exempts virtual ids, wherever they appear", function()
    local s = fixture("small")
    local electricity = { id = "electricity", type = "virtual", rate = 5 }
    s.blocks[1].products[#s.blocks[1].products + 1] = electricity
    s.blocks[1].imports[#s.blocks[1].imports + 1] = electricity
    s.blocks[1].rows[#s.blocks[1].rows + 1] = { kind = "power", product = { id = "electricity", type = "virtual" } }
    s.blocks[1].rows[1].inputs[1] = electricity
    s.blocks[1].rows[1].outputs[1] = electricity
    for _, key in ipairs(ids(s)) do
      assert.is_nil(string.find(key, "electricity", 1, true), key)
    end
  end)

  it("takes ids from synthetic rows' products", function()
    local s = fixture("small")
    s.blocks[1].rows[#s.blocks[1].rows + 1] = { kind = "mining", product = { id = "iron-ore", type = "item" } }
    s.blocks[1].rows[#s.blocks[1].rows + 1] = { kind = "offshore", product = { id = "water", type = "fluid" }, machine = "offshore-pump" }
    local got = table.concat(ids(s), " ")
    for _, want in ipairs({ "item:iron-ore", "fluid:water", "machine:offshore-pump" }) do
      assert.is_truthy(string.find(got, want, 1, true), want)
    end
  end)

  it("takes ids from a row's inputs and outputs, modules (as items) and beacon (a machine and a module)", function()
    local s = fixture("small")
    s.blocks[1].rows = {
      {
        recipe = "r",
        inputs = { { id = "steam", type = "fluid", rate = 1 } },
        outputs = { { id = "copper-cable", type = "item", rate = 1 } },
        modules = { { id = "speed-module", count = 2 }, { id = "productivity-module", count = 1 } },
        beacon = { id = "beacon", count = 8, module = "speed-module-2", modules = 2 },
      },
    }
    s.blocks[1].products = {}
    s.blocks[1].imports = {}
    assert.are.same({
      "recipe:r",
      "fluid:steam",
      "item:copper-cable",
      "item:speed-module",
      "item:productivity-module",
      "machine:beacon",
      "item:speed-module-2",
    }, ids(s))
  end)

  it("lists a module that the game lacks as a missing item, and a beacon as a missing machine", function()
    local s = fixture("seablock-groups")
    local count, missing = snapshot.find_missing(s, support.exists_except({ ["speed-module"] = true, beacon = true }))
    assert.are.equal(2, count)
    assert.is_true(missing["item:speed-module"])
    assert.is_true(missing["machine:beacon"])
  end)

  it("counts the ids the game lacks, and returns them as a set", function()
    local count, missing = snapshot.find_missing(
      fixture("small"),
      support.exists_except({ ["iron-ore"] = true, ["bob-assembling-machine-6"] = true })
    )
    assert.are.equal(2, count)
    assert.is_true(missing["item:iron-ore"])
    assert.is_true(missing["machine:bob-assembling-machine-6"])
  end)

  it("counts nothing when the game has every id", function()
    local count = snapshot.find_missing(fixture("seablock-loop"), support.exists_except({}))
    assert.are.equal(0, count)
  end)

  it("saturates the count at MAX_UNKNOWN_IDS", function()
    local s = { v = 1, dataSet = { id = "x" }, blocks = { { products = {}, imports = {}, rows = {} } } }
    for i = 1, 10005 do
      s.blocks[1].products[i] = { id = "item-" .. i, type = "item", rate = 1 }
    end
    local none = function()
      return false
    end
    local count = snapshot.find_missing(s, { item = none, fluid = none, recipe = none, machine = none })
    assert.are.equal(9999, count)
  end)
end)
