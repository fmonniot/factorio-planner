local snapshot = require("lib.snapshot")
local viewmodel = require("lib.viewmodel")
local support = require("spec.support")

local function fixture(name)
  return support.read_json(support.CONTRACT .. "/fixtures/" .. name .. ".json")
end

describe("viewmodel.build", function()
  describe("the shared snapshot fixtures", function()
    for _, name in ipairs(support.list_snapshot_fixtures()) do
      it("builds " .. name .. " without raising, one block model per block", function()
        local s = fixture(name)
        local vm = viewmodel.build(s)
        assert.are.equal(#s.blocks, #vm.blocks)
        for i, block in ipairs(vm.blocks) do
          assert.are.equal(s.blocks[i].name, block.name)
          assert.are.equal(#s.blocks[i].rows, #block.rows)
        end
      end)
    end
  end)

  it("builds the small fixture's block", function()
    local vm = viewmodel.build(fixture("small"))
    assert.are.same(
      { id = "kompetenz-seablock", name = "Kompetenz Seablock", factorio_version = "2.0.77" },
      vm.data_set
    )
    local block = vm.blocks[1]
    assert.are.equal(1, block.index)
    assert.are.equal("Gears", block.name)
    assert.are.equal("#3b82f6", block.color.hex)
    assert.is_true(math.abs(block.color.r - 0x3b / 255) < 1e-9)

    local product = block.products[1]
    assert.are.equal("iron-gear-wheel", product.id)
    assert.are.equal(60, product.rate)
    assert.are.equal("item/iron-gear-wheel", product.sprite)
    assert.are.equal("[item=iron-gear-wheel]", product.rich)

    local row = block.rows[1]
    assert.are.equal("recipe", row.kind)
    assert.are.equal("recipe/iron-gear-wheel", row.sprite)
    assert.are.equal("entity/bob-assembling-machine-6", row.machine_sprite)
    assert.are.equal("[entity=bob-assembling-machine-6]", row.machine_rich)
    assert.are.equal(1, row.machines_ceil)
    assert.are.equal(68.571, row.power_kw)
    assert.is_true(row.solved)

    assert.are.equal(3, block.totals.machines_ceil) -- 1 + 2 machines
    assert.is_true(math.abs(block.totals.power_kw - (68.571 + 525)) < 1e-9)
    assert.are.same({}, vm.missing)
  end)

  it("uses sprite prefixes by type and gives a virtual item neither sprite nor rich text", function()
    local s = fixture("small")
    s.blocks[1].products = {
      { id = "water", type = "fluid", rate = 1 },
      { id = "electricity", type = "virtual", rate = 1000 },
    }
    local products = viewmodel.build(s).blocks[1].products
    assert.are.equal("fluid/water", products[1].sprite)
    assert.are.equal("[fluid=water]", products[1].rich)
    assert.is_true(products[2].virtual)
    assert.is_nil(products[2].sprite)
    assert.is_nil(products[2].rich)
    assert.is_nil(products[2].missing)
  end)

  describe("a synthetic row", function()
    it("keeps its kind and main product", function()
      local s = fixture("small")
      s.blocks[1].rows = { { kind = "mining", product = { id = "iron-ore", type = "item" }, machine = "electric-mining-drill", machines = 2, machinesCeil = 2 } }
      local row = viewmodel.build(s).blocks[1].rows[1]
      assert.are.equal("synthetic", row.kind)
      assert.are.equal("mining", row.synthetic_kind)
      assert.are.equal("item/iron-ore", row.product.sprite)
      assert.is_false(row.unknown)
      assert.is_nil(row.recipe)
    end)

    it("is shown as unknown, not a crash, when its recipe left the data set", function()
      local s = fixture("small")
      s.blocks[1].rows = { { kind = "power" }, { kind = "offshore", machine = "offshore-pump", machines = 1 } }
      assert.is_true(snapshot.validate(s))
      local rows = viewmodel.build(s).blocks[1].rows
      assert.are.equal("synthetic", rows[1].kind)
      assert.is_true(rows[1].unknown)
      assert.is_nil(rows[1].product)
      assert.is_false(rows[1].solved)
      assert.are.equal("offshore", rows[2].synthetic_kind)
      assert.is_true(rows[2].unknown)
      assert.is_true(rows[2].solved)
    end)
  end)

  it("builds an unsolved block: rows without numbers, the error kept, totals at zero", function()
    local s = fixture("small")
    s.blocks[1].error = "No feasible solution"
    s.blocks[1].rows = { { recipe = "iron-gear-wheel" }, { recipe = "r2", machine = "m" } }
    local block = viewmodel.build(s).blocks[1]
    assert.are.equal("No feasible solution", block.error)
    assert.is_false(block.rows[1].solved)
    assert.is_nil(block.rows[1].machine)
    assert.is_nil(block.rows[1].machine_sprite)
    assert.are.equal(0, block.totals.power_kw)
    assert.are.equal(0, block.totals.machines_ceil)
  end)

  it("resolves areas to 1-based indices and names, and tolerates an index out of range", function()
    local s = fixture("seablock-areas")
    local with_areas
    for i, b in ipairs(s.blocks) do
      if b.areas and #b.areas > 0 then
        with_areas = i
      end
    end
    assert.is_truthy(with_areas, "the fixture should have a block with areas")
    local block = viewmodel.build(s).blocks[with_areas]
    assert.are.same(s.blocks[with_areas].areas, block.areas)
    for j, row in ipairs(block.rows) do
      local area = s.blocks[with_areas].rows[j].area
      if area then
        assert.are.equal(area + 1, row.area_index)
        assert.are.equal(s.blocks[with_areas].areas[area + 1], row.area_name)
      end
    end

    s.blocks[with_areas].rows[1].area = 99
    local rows = viewmodel.build(s).blocks[with_areas].rows
    assert.are.equal(100, rows[1].area_index)
    assert.is_nil(rows[1].area_name)
  end)

  it("resolves connections and warning blocks to 1-based indices and names, and survives a dangling one", function()
    local s = fixture("seablock-loop")
    local connected
    for i, b in ipairs(s.blocks) do
      if #b.connections > 0 then
        connected = i
        break
      end
    end
    assert.is_truthy(connected)
    local c = s.blocks[connected].connections[1]
    local vm = viewmodel.build(s)
    local got = vm.blocks[connected].connections[1]
    assert.are.equal(c.from + 1, got.from_index)
    assert.are.equal(s.blocks[c.from + 1].name, got.from_name)
    assert.are.equal(c.available, got.available)

    s.blocks[connected].connections[1].from = 500
    s.blocks[connected].warnings[#s.blocks[connected].warnings + 1] = { code = "loop-not-converged", blocks = { 0, 500 } }
    vm = viewmodel.build(s)
    assert.is_nil(vm.blocks[connected].connections[1].from_name)
    local w = vm.blocks[connected].warnings[#vm.blocks[connected].warnings]
    assert.are.equal(s.blocks[1].name, w.blocks[1].name)
    assert.is_nil(w.blocks[2].name)
  end)

  it("flags ids the game lacks and lists them, sorted", function()
    local s = fixture("small")
    local _, missing = snapshot.find_missing(
      s,
      support.exists_except({ ["iron-ore"] = true, ["iron-gear-wheel"] = true, ["bob-assembling-machine-6"] = true })
    )
    local vm = viewmodel.build(s, { missing = missing })
    local block = vm.blocks[1]
    assert.is_true(block.products[1].missing)
    assert.is_true(block.imports[1].missing)
    assert.is_true(block.rows[1].recipe_missing)
    assert.is_true(block.rows[1].machine_missing)
    assert.is_false(block.rows[2].recipe_missing)
    assert.is_false(block.rows[2].machine_missing)
    local listed = {}
    for i, e in ipairs(vm.missing) do
      listed[i] = e.kind .. ":" .. e.id
    end
    assert.are.same({
      "item:iron-gear-wheel",
      "item:iron-ore",
      "machine:bob-assembling-machine-6",
      "recipe:iron-gear-wheel",
    }, listed)
  end)

  it("flags nothing when no missing set is given", function()
    local vm = viewmodel.build(fixture("small"))
    assert.is_false(vm.blocks[1].products[1].missing)
    assert.are.same({}, vm.missing)
  end)

  it("carries non-ASCII block and area names through unchanged", function()
    local s = fixture("unicode")
    local vm = viewmodel.build(s)
    for i, b in ipairs(s.blocks) do
      assert.are.equal(b.name, vm.blocks[i].name)
    end
    assert.are.equal("\xe9\x89\x84\xe5\xb7\xa5\xe5\xa0\xb4 (\xe6\xad\xaf\xe8\xbb\x8a)", vm.blocks[2].name)
  end)

  it("builds an empty snapshot", function()
    local vm = viewmodel.build({ v = 1, dataSet = { id = "x" }, blocks = {} })
    assert.are.same({}, vm.blocks)
    assert.are.equal("x", vm.data_set.id)
  end)
end)
