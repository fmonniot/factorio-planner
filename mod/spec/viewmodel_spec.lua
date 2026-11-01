local snapshot = require("lib.snapshot")
local viewmodel = require("lib.viewmodel")
local support = require("spec.support")

local SEP = "\31"
local GROUP = "\30"

local function fixture(name)
  return support.read_json(support.CONTRACT .. "/fixtures/" .. name .. ".json")
end

-- A snapshot with one block made of `rows` (and `groups`).
local function one_block(rows, groups, extra)
  local block = { name = "B", color = "#112233", products = {}, imports = {}, rows = rows, groups = groups }
  for k, v in pairs(extra or {}) do
    block[k] = v
  end
  local s = { v = 1, dataSet = { id = "x" }, blocks = { block } }
  assert(snapshot.validate(s))
  return s
end

local function rate(id, r)
  return { id = id, type = "item", rate = r }
end

-- A recipe row that makes `out` from `inp` (both lists of { id, rate }).
local function recipe_row(id, inp, out, group)
  local row = { recipe = id, machine = "m", machines = 1, machinesCeil = 1, throughput = 1, group = group }
  if inp then
    row.inputs = { rate(inp[1], inp[2]) }
  end
  if out then
    row.outputs = { rate(out[1], out[2]) }
  end
  return row
end

-- The shape of a table as "kind:depth:name-or-key" lines, to compare in one go.
local function outline(block)
  local out = {}
  for i, e in ipairs(block.entries) do
    out[i] = e.type .. ":" .. e.depth .. ":" .. (e.type == "group" and e.name or e.row.recipe or e.row.synthetic_kind)
  end
  return out
end

local function ids(list)
  local out = {}
  for i, r in ipairs(list) do
    out[i] = r.id .. "=" .. r.rate
  end
  return out
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

      it("lays out " .. name .. " consistently: every row once, every key found, group keys are row keys", function()
        local vm = viewmodel.build(fixture(name))
        for _, block in ipairs(vm.blocks) do
          local row_entries, seen = 0, {}
          for _, e in ipairs(block.entries) do
            assert.are.equal(e, block.by_key[e.key])
            assert.is_nil(seen[e.key], "key repeated: " .. e.key)
            seen[e.key] = true
            if e.type == "row" then
              row_entries = row_entries + 1
              assert.are.equal(e.key, e.row.key)
            else
              assert.is_true(#e.keys > 0)
              for _, k in ipairs(e.keys) do
                assert.are.equal("row", block.by_key[k].type)
              end
            end
          end
          assert.are.equal(#block.rows, row_entries)
          assert.are.equal(#block.rows, #block.summary.keys)
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
    assert.are.equal("Gears", block.key)
    assert.are.equal("#3b82f6", block.color.hex)
    assert.is_true(math.abs(block.color.r - 0x3b / 255) < 1e-9)

    local product = block.products[1]
    assert.are.equal("iron-gear-wheel", product.id)
    assert.are.equal(60, product.rate)
    assert.are.equal("item/iron-gear-wheel", product.sprite)
    assert.are.equal("[item=iron-gear-wheel]", product.rich)

    local row = block.rows[1]
    assert.are.equal("recipe", row.kind)
    assert.are.equal("iron-gear-wheel", row.key)
    assert.are.equal("recipe/iron-gear-wheel", row.sprite)
    assert.are.equal("entity/bob-assembling-machine-6", row.machine_sprite)
    assert.are.equal("[entity=bob-assembling-machine-6]", row.machine_rich)
    assert.are.equal(1, row.machines_ceil)
    assert.is_true(row.solved)
    assert.are.same({ "iron-plate=120" }, ids(row.inputs))
    assert.are.equal("item/iron-plate", row.inputs[1].sprite)
    assert.are.same({ "iron-gear-wheel=60" }, ids(row.outputs))
    assert.are.same({}, row.modules)
    assert.is_nil(row.beacon)
    assert.is_false(block.has_beacon)
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
      assert.are.equal("mining" .. SEP .. "iron-ore" .. SEP .. "electric-mining-drill", row.key)
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
      assert.are.equal("power" .. SEP .. SEP, rows[1].key)
      assert.are.equal("offshore", rows[2].synthetic_kind)
      assert.is_true(rows[2].unknown)
      assert.is_true(rows[2].solved)
    end)
  end)

  it("builds an unsolved block: rows without numbers, the error kept", function()
    local s = fixture("small")
    s.blocks[1].error = "No feasible solution"
    s.blocks[1].rows = { { recipe = "iron-gear-wheel" }, { recipe = "r2", machine = "m" } }
    local block = viewmodel.build(s).blocks[1]
    assert.are.equal("No feasible solution", block.error)
    assert.is_false(block.rows[1].solved)
    assert.is_nil(block.rows[1].machine)
    assert.is_nil(block.rows[1].machine_sprite)
    assert.are.same({}, block.rows[1].inputs)
    assert.are.same({}, block.rows[1].outputs)
  end)

  it("flags ids the game lacks and lists them, sorted", function()
    local s = fixture("small")
    local _, missing = snapshot.find_missing(
      s,
      support.exists_except({ ["iron-ore"] = true, ["iron-gear-wheel"] = true, ["bob-assembling-machine-6"] = true, ["iron-plate"] = true })
    )
    local vm = viewmodel.build(s, { missing = missing })
    local block = vm.blocks[1]
    assert.is_true(block.products[1].missing)
    assert.is_true(block.imports[1].missing)
    assert.is_true(block.rows[1].recipe_missing)
    assert.is_true(block.rows[1].machine_missing)
    assert.is_true(block.rows[1].inputs[1].missing)
    assert.is_true(block.rows[1].outputs[1].missing)
    assert.is_false(block.rows[2].recipe_missing)
    assert.is_false(block.rows[2].machine_missing)
    local listed = {}
    for i, e in ipairs(vm.missing) do
      listed[i] = e.kind .. ":" .. e.id
    end
    assert.are.same({
      "item:iron-gear-wheel",
      "item:iron-ore",
      "item:iron-plate",
      "machine:bob-assembling-machine-6",
      "recipe:iron-gear-wheel",
    }, listed)
  end)

  it("flags nothing when no missing set is given", function()
    local vm = viewmodel.build(fixture("small"))
    assert.is_false(vm.blocks[1].products[1].missing)
    assert.are.same({}, vm.missing)
  end)

  it("carries non-ASCII block and sub-factory names through unchanged", function()
    local s = fixture("unicode")
    local vm = viewmodel.build(s)
    for i, b in ipairs(s.blocks) do
      assert.are.equal(b.name, vm.blocks[i].name)
    end
    assert.are.equal("\xe9\x89\x84\xe5\xb7\xa5\xe5\xa0\xb4 (\xe6\xad\xaf\xe8\xbb\x8a)", vm.blocks[2].name)
    local header
    for _, e in ipairs(vm.blocks[1].entries) do
      header = header or (e.type == "group" and e)
    end
    assert.are.equal(s.blocks[1].groups[1].name, header.name)
    assert.is_true(header.area)
  end)

  it("builds an empty snapshot", function()
    local vm = viewmodel.build({ v = 1, dataSet = { id = "x" }, blocks = {} })
    assert.are.same({}, vm.blocks)
    assert.are.equal("x", vm.data_set.id)
  end)

  describe("modules and beacon", function()
    local function groups_block(missing)
      return viewmodel.build(fixture("seablock-groups"), { missing = missing }).blocks[1]
    end

    it("gives a row its modules with sprites and rich tags", function()
      local furnace = groups_block().by_key["Plates and cables" .. SEP .. "sb-iron-plate-from-ore"].row
      assert.are.equal(1, #furnace.modules)
      assert.are.same(
        { id = "speed-module", count = 2, sprite = "item/speed-module", rich = "[item=speed-module]", missing = false },
        furnace.modules[1]
      )
      assert.is_nil(furnace.beacon)
    end)

    it("gives a row its beacon, with the total count and the module each holds", function()
      local block = groups_block()
      local cable = block.by_key["Plates and cables" .. SEP .. "copper-cable"].row
      local beacon = cable.beacon
      assert.are.equal("beacon", beacon.id)
      assert.are.equal("entity/beacon", beacon.sprite)
      assert.are.equal("[entity=beacon]", beacon.rich)
      assert.are.equal(8, beacon.per_machine)
      assert.are.equal(8, beacon.total) -- 8 per machine, 1 machine rounded up
      assert.are.same({
        { id = "speed-module", count = 2, sprite = "item/speed-module", rich = "[item=speed-module]", missing = false },
      }, beacon.modules)
      assert.is_true(block.has_beacon)
    end)

    it("multiplies by the rounded-up machine count, and has no total without one", function()
      local s = one_block({
        { recipe = "a", machinesCeil = 3, beacon = { id = "beacon", count = 4, module = "speed-module", modules = 2 } },
        { recipe = "b", beacon = { id = "beacon", count = 4, module = "speed-module", modules = 0 } },
      })
      local rows = viewmodel.build(s).blocks[1].rows
      assert.are.equal(12, rows[1].beacon.total)
      assert.are.equal(4, rows[2].beacon.per_machine)
      assert.is_nil(rows[2].beacon.total)
      assert.are.same({}, rows[2].beacon.modules)
    end)

    it("flags a module, a beacon and an item rate the game lacks", function()
      local s = fixture("seablock-groups")
      local _, missing = snapshot.find_missing(s, support.exists_except({ ["speed-module"] = true, beacon = true, ["copper-plate"] = true }))
      local block = viewmodel.build(s, { missing = missing }).blocks[1]
      local furnace = block.by_key["Plates and cables" .. SEP .. "sb-iron-plate-from-ore"].row
      local cable = block.by_key["Plates and cables" .. SEP .. "copper-cable"].row
      assert.is_true(furnace.modules[1].missing)
      assert.is_true(cable.beacon.missing)
      assert.is_true(cable.beacon.modules[1].missing)
      assert.is_true(cable.inputs[1].missing)
      assert.is_false(cable.outputs[1].missing)
    end)

    it("says a block has no beacon when no row does", function()
      assert.is_false(viewmodel.build(fixture("small")).blocks[1].has_beacon)
    end)
  end)

  describe("the table of sub-factories", function()
    it("lays out the seablock-groups fixture: headers where a sub-factory first appears, rows indented", function()
      local block = viewmodel.build(fixture("seablock-groups")).blocks[1]
      assert.are.same({
        "row:0:iron-gear-wheel",
        "group:0:Plates and cables",
        "row:1:sb-iron-plate-from-ore",
        "group:1:Power",
        "row:2:power",
        "row:2:power",
        "row:1:copper-cable", -- after the nested sub-factory
        "row:0:pipe",
      }, outline(block))
    end)

    it("gives a header the keys of every row under it, nested ones too, and its net flows", function()
      local block = viewmodel.build(fixture("seablock-groups")).blocks[1]
      local top = block.by_key[GROUP .. "Plates and cables"]
      local power = block.by_key[GROUP .. "Plates and cables" .. SEP .. "Power"]
      assert.are.equal("group", top.type)
      assert.is_false(top.area)
      assert.are.same({
        "Plates and cables" .. SEP .. "sb-iron-plate-from-ore",
        "Plates and cables" .. SEP .. "Power" .. SEP .. "power" .. SEP .. "electricity" .. SEP .. "solar-panel",
        "Plates and cables" .. SEP .. "Power" .. SEP .. "power" .. SEP .. "electricity" .. SEP .. "bob-solar-panel-large",
        "Plates and cables" .. SEP .. "copper-cable",
      }, top.keys)
      assert.are.same({ top.keys[2], top.keys[3] }, power.keys)
      assert.are.same({ "iron-plate=150", "copper-cable=120" }, ids(top.products))
      assert.are.same({ "iron-ore=200", "copper-plate=60" }, ids(top.ingredients))
      assert.are.same({}, power.products) -- electricity is no item
      assert.are.same({}, power.ingredients)
      assert.are.equal("item/iron-plate", top.products[1].sprite)
    end)

    it("computes the summary from the rows: the iron plate made and used cancels out and is left out", function()
      local block = viewmodel.build(fixture("seablock-groups")).blocks[1]
      assert.are.same({ "copper-cable=120", "iron-gear-wheel=60", "pipe=30" }, ids(block.summary.products))
      assert.are.same({ "iron-ore=200", "copper-plate=60" }, ids(block.summary.ingredients))
      assert.are.equal(6, #block.summary.keys)
      assert.are.equal(block.rows[1].key, block.summary.keys[1])
    end)

    it("follows table order for P[a, S, b]: no second header for P after S", function()
      local s = one_block({
        recipe_row("a", nil, { "x", 1 }, 0),
        recipe_row("c", nil, { "y", 1 }, 1),
        recipe_row("b", nil, { "z", 1 }, 0),
        recipe_row("d", nil, { "w", 1 }),
      }, { { name = "P" }, { name = "S", parent = 0 } })
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({
        "group:0:P",
        "row:1:a",
        "group:1:S",
        "row:2:c",
        "row:1:b",
        "row:0:d",
      }, outline(block))
      local p = block.by_key[GROUP .. "P"]
      assert.are.same({ "P" .. SEP .. "a", "P" .. SEP .. "S" .. SEP .. "c", "P" .. SEP .. "b" }, p.keys)
      assert.are.same({ "P" .. SEP .. "S" .. SEP .. "c" }, block.by_key[GROUP .. "P" .. SEP .. "S"].keys)
    end)

    it("emits the headers of a sub-factory that holds only nested ones", function()
      local s = one_block({
        recipe_row("deep", { "i", 2 }, { "o", 3 }, 2),
        recipe_row("after", nil, { "o", 1 }),
      }, { { name = "Outer" }, { name = "Middle", parent = 0 }, { name = "Inner", parent = 1, area = true } })
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({
        "group:0:Outer",
        "group:1:Middle",
        "group:2:Inner",
        "row:3:deep",
        "row:0:after",
      }, outline(block))
      local outer = block.by_key[GROUP .. "Outer"]
      assert.are.same({ "Outer" .. SEP .. "Middle" .. SEP .. "Inner" .. SEP .. "deep" }, outer.keys)
      assert.are.same({ "o=3" }, ids(outer.products))
      assert.are.same({ "i=2" }, ids(outer.ingredients))
      assert.is_true(block.by_key[GROUP .. "Outer" .. SEP .. "Middle" .. SEP .. "Inner"].area)
    end)

    it("sums a sub-factory's flows over all depths, and a row of the root plan is in no group", function()
      local s = one_block({
        recipe_row("a", { "ore", 10 }, { "plate", 5 }, 0),
        recipe_row("b", { "plate", 2 }, { "gear", 1 }, 1),
        recipe_row("c", { "plate", 1 }, nil),
      }, { { name = "P" }, { name = "S", parent = 0 } })
      local block = viewmodel.build(s).blocks[1]
      local p = block.by_key[GROUP .. "P"]
      assert.are.same({ "plate=3", "gear=1" }, ids(p.products))
      assert.are.same({ "ore=10" }, ids(p.ingredients))
      assert.are.same({ "gear=1" }, ids(block.by_key[GROUP .. "P" .. SEP .. "S"].products))
      assert.are.same({ "plate=2" }, ids(block.by_key[GROUP .. "P" .. SEP .. "S"].ingredients))
      assert.are.same({ "plate=2", "gear=1" }, ids(block.summary.products))
      assert.are.same({ "ore=10" }, ids(block.summary.ingredients))
      assert.are.equal(0, block.by_key["c"].depth)
    end)

    it("cuts a net balance under 0.01/min, and keeps one of exactly 0.01", function()
      local s = one_block({
        recipe_row("a", { "kept", 10 }, { "kept2", 10.01 }),
        recipe_row("b", { "kept2", 10 }, { "dropped", 10.009 }),
        recipe_row("c", { "dropped", 10 }, nil),
      })
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({ "kept2=0.01" }, ids(block.summary.products))
      assert.are.same({ "kept=10" }, ids(block.summary.ingredients))
    end)

    it("applies the same cut-off in a sub-factory header", function()
      local s = one_block({
        recipe_row("a", { "x", 1.005 }, { "y", 1 }, 0),
        recipe_row("b", nil, { "x", 1 }, 0),
      }, { { name = "P" } })
      local p = viewmodel.build(s).blocks[1].by_key[GROUP .. "P"]
      assert.are.same({ "y=1" }, ids(p.products))
      assert.are.same({}, ids(p.ingredients)) -- 1.005 used, 1 made: 0.005 short is under the cut-off
    end)

    it("sorts net flows by rate, largest first, ties in order of appearance", function()
      local s = one_block({
        recipe_row("a", nil, { "small", 1 }),
        recipe_row("b", nil, { "big", 5 }),
        recipe_row("c", nil, { "also-big", 5 }),
      })
      assert.are.same({ "big=5", "also-big=5", "small=1" }, ids(viewmodel.build(s).blocks[1].summary.products))
    end)

    it("never counts the electricity item, even in a row's rates", function()
      local s = one_block({ recipe_row("a", nil, { "x", 1 }) })
      s.blocks[1].rows[1].inputs = { { id = "electricity", type = "virtual", rate = 50 } }
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({ "x=1" }, ids(block.summary.products))
      assert.are.same({}, block.summary.ingredients)
    end)

    it("falls back on products and imports for a block with no rates at all, leaving out electricity", function()
      local s = fixture("small")
      s.blocks[1].error = "infeasible"
      s.blocks[1].products[#s.blocks[1].products + 1] = { id = "electricity", type = "virtual", rate = 9 }
      s.blocks[1].imports[#s.blocks[1].imports + 1] = { id = "electricity", type = "virtual", rate = 9 }
      s.blocks[1].rows = { { recipe = "iron-gear-wheel" }, { recipe = "r2", machine = "m" } }
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({ "iron-gear-wheel=60" }, ids(block.summary.products))
      assert.are.same({ "iron-ore=160" }, ids(block.summary.ingredients))
      assert.are.equal("item/iron-ore", block.summary.ingredients[1].sprite)
      assert.are.equal(2, #block.summary.keys)
    end)

    it("does not fall back when the rows have rates, even if they cancel out", function()
      local s = one_block({ recipe_row("a", { "x", 1 }, { "x", 1 }) })
      s.blocks[1].products = { rate("target", 100) }
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({}, block.summary.products)
      assert.are.same({}, block.summary.ingredients)
    end)

    it("gives a failed block's sub-factory headers no flows", function()
      local s = one_block({ { recipe = "a", group = 0 } }, { { name = "P" } }, { error = "bad" })
      local p = viewmodel.build(s).blocks[1].by_key[GROUP .. "P"]
      assert.are.same({}, p.products)
      assert.are.same({}, p.ingredients)
      assert.are.same({ "P" .. SEP .. "a" }, p.keys)
    end)

    it("draws a sub-factory that holds no row at any depth nowhere", function()
      local s = one_block({ recipe_row("a", nil, { "x", 1 }, 1) }, { { name = "Empty" }, { name = "Full" } })
      assert.are.same({ "group:0:Full", "row:1:a" }, outline(viewmodel.build(s).blocks[1]))
    end)

    describe("a reference that leads nowhere", function()
      it("puts a row whose group is out of range at the root", function()
        local s = one_block({ recipe_row("a", nil, { "x", 1 }, 5), recipe_row("b", nil, { "x", 1 }, 0) }, { { name = "P" } })
        assert.are.same({ "row:0:a", "group:0:P", "row:1:b" }, outline(viewmodel.build(s).blocks[1]))
      end)

      it("puts a row whose block has no groups at the root", function()
        local s = one_block({ recipe_row("a", nil, { "x", 1 }, 0) })
        assert.are.same({ "row:0:a" }, outline(viewmodel.build(s).blocks[1]))
      end)

      it("treats a parent that is not a lower index as absent, so the walk ends", function()
        local s = one_block({
          recipe_row("a", nil, { "x", 1 }, 0),
          recipe_row("b", nil, { "x", 1 }, 1),
          recipe_row("c", nil, { "x", 1 }, 2),
        }, {
          { name = "Self", parent = 0 }, -- itself
          { name = "Later", parent = 2 }, -- a higher index
          { name = "Gone", parent = 40 }, -- out of range
        })
        local block = viewmodel.build(s).blocks[1]
        assert.are.same({
          "group:0:Self",
          "row:1:a",
          "group:0:Later",
          "row:1:b",
          "group:0:Gone",
          "row:1:c",
        }, outline(block))
      end)

      it("cannot loop on two groups that name each other as parent", function()
        local s = one_block({ recipe_row("a", nil, { "x", 1 }, 1) }, { { name = "A", parent = 1 }, { name = "B", parent = 0 } })
        assert.are.same({ "group:0:A", "group:1:B", "row:2:a" }, outline(viewmodel.build(s).blocks[1]))
      end)
    end)
  end)

  describe("keys", function()
    it("makes a row's key the path of sub-factory names, outermost first, then the recipe", function()
      local s = one_block({ recipe_row("r", nil, nil, 1) }, { { name = "Outer" }, { name = "Inner", parent = 0 } })
      assert.are.equal("Outer" .. SEP .. "Inner" .. SEP .. "r", viewmodel.build(s).blocks[1].rows[1].key)
    end)

    it("suffixes a recipe that repeats in a block", function()
      local s = one_block({ recipe_row("r"), recipe_row("r"), recipe_row("r"), recipe_row("other") })
      local keys = {}
      for i, row in ipairs(viewmodel.build(s).blocks[1].rows) do
        keys[i] = row.key
      end
      assert.are.same({ "r", "r#2", "r#3", "other" }, keys)
    end)

    it("keeps the same recipe in two sub-factories apart without a suffix", function()
      local s = one_block({ recipe_row("r", nil, nil, 0), recipe_row("r", nil, nil, 1) }, { { name = "A" }, { name = "B" } })
      local rows = viewmodel.build(s).blocks[1].rows
      assert.are.same({ "A" .. SEP .. "r", "B" .. SEP .. "r" }, { rows[1].key, rows[2].key })
    end)

    it("suffixes a sub-factory whose sibling has its name, so their rows stay apart", function()
      local s = one_block({
        recipe_row("r", nil, nil, 0),
        recipe_row("r", nil, nil, 1),
        recipe_row("r", nil, nil, 2),
      }, { { name = "Same" }, { name = "Same" }, { name = "Same", parent = 1 } })
      local block = viewmodel.build(s).blocks[1]
      assert.are.same({
        "Same" .. SEP .. "r",
        "Same#2" .. SEP .. "r",
        "Same#2" .. SEP .. "Same" .. SEP .. "r",
      }, { block.rows[1].key, block.rows[2].key, block.rows[3].key })
      assert.is_truthy(block.by_key[GROUP .. "Same"])
      assert.is_truthy(block.by_key[GROUP .. "Same#2"])
      assert.is_truthy(block.by_key[GROUP .. "Same#2" .. SEP .. "Same"])
    end)

    it("keeps same-named sub-factories under different parents apart without a suffix", function()
      local s = one_block({ recipe_row("r", nil, nil, 1), recipe_row("r", nil, nil, 3) }, {
        { name = "P" },
        { name = "Q", parent = 0 },
        { name = "R" },
        { name = "Q", parent = 2 },
      })
      local rows = viewmodel.build(s).blocks[1].rows
      assert.are.equal("P" .. SEP .. "Q" .. SEP .. "r", rows[1].key)
      assert.are.equal("R" .. SEP .. "Q" .. SEP .. "r", rows[2].key)
    end)

    it("gives two generator rows of one machine and product different keys, and keeps the machines apart", function()
      local power = { id = "electricity", type = "virtual" }
      local s = one_block({
        { kind = "power", product = power, machine = "solar-panel", machines = 2, machinesCeil = 2 },
        { kind = "power", product = power, machine = "solar-panel", machines = 1, machinesCeil = 1 },
        { kind = "power", product = power, machine = "steam-engine", machines = 1, machinesCeil = 1 },
      })
      local block = viewmodel.build(s).blocks[1]
      local base = "power" .. SEP .. "electricity" .. SEP
      assert.are.same({
        base .. "solar-panel",
        base .. "solar-panel#2",
        base .. "steam-engine",
      }, { block.rows[1].key, block.rows[2].key, block.rows[3].key })
      assert.are.equal(3, #block.entries)
    end)

    it("does not let a typed suffix collide with a generated one", function()
      local s = one_block({ recipe_row("r"), recipe_row("r#2"), recipe_row("r") })
      local keys = {}
      for i, row in ipairs(viewmodel.build(s).blocks[1].rows) do
        keys[i] = row.key
      end
      assert.are.same({ "r", "r#2", "r#3" }, keys)
    end)

    it("makes a block's key its name, with a suffix when another block has it", function()
      local s = fixture("small")
      local copy = support.copy(s.blocks[1])
      s.blocks[2] = copy
      s.blocks[3] = support.copy(s.blocks[1])
      s.blocks[3].name = ""
      s.blocks[4] = support.copy(s.blocks[1])
      s.blocks[4].name = ""
      local blocks = viewmodel.build(s).blocks
      assert.are.same({ "Gears", "Gears#2", "", "#2" }, { blocks[1].key, blocks[2].key, blocks[3].key, blocks[4].key })
    end)

    it("keeps keys stable across a rebuild of the same snapshot", function()
      local a = viewmodel.build(fixture("seablock-groups")).blocks[1]
      local b = viewmodel.build(fixture("seablock-groups")).blocks[1]
      for i, row in ipairs(a.rows) do
        assert.are.equal(row.key, b.rows[i].key)
      end
    end)
  end)
end)
