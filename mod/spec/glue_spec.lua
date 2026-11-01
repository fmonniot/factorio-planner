-- Runs control.lua, scripts/gui.lua and scripts/cursor.lua against a fake runtime
-- (spec/fake_game.lua). This catches plain Lua mistakes in the glue; it does not
-- check the real Factorio API, which only the manual checklist (mod/CHECKLIST.md)
-- can.
local fake_game = require("spec.fake_game")
local support = require("spec.support")
local json = require("dkjson")
local viewmodel = require("lib.viewmodel")
local snapshot_lib = require("lib.snapshot")

local ID = "1111111111111111"
local DROPDOWN = "fp_viewer_block_dropdown"

local function fixture_text(name)
  return support.read_file(support.CONTRACT .. "/fixtures/" .. name .. ".json")
end

local function everything_exists()
  return support.exists_except({})
end

local function main_of(window)
  return window["fp_viewer_content"]["fp_viewer_main"]
end

local function dropdown_of(window)
  return main_of(window)["fp_viewer_nav_frame"]["fp_viewer_nav"][DROPDOWN]
end

local function scroll_of(window)
  return main_of(window)["fp_viewer_table_frame"]["fp_viewer_table_scroll"]
end

-- The production table's lines, each a list of: the checkbox (which shares the
-- first cell with the recipe), then the cells of the table.
local function lines(window)
  local t = scroll_of(window).children[1]
  assert(t.type == "table", "no production table")
  local out = {}
  for i, cell in ipairs(t.children) do
    local n = math.floor((i - 1) / t.column_count) + 1
    if out[n] == nil then
      out[n] = { cell.children[1] }
    end
    out[n][#out[n] + 1] = cell
  end
  return out, t
end

local function buttons(cell)
  return fake_game.find(cell, function(e)
    return e.type == "sprite-button"
  end)
end

local function tagged(window, what)
  return fake_game.find(window, function(e)
    return type(e.tags) == "table" and e.tags.what == what
  end)
end

-- True when a caption or a tooltip in `e` (or `e` itself) holds `needle`.
local function shows(e, needle)
  local all = fake_game.find(e, function()
    return true
  end)
  all[#all + 1] = e
  for _, x in ipairs(all) do
    for _, field in ipairs({ "caption", "tooltip" }) do
      if x[field] ~= nil and string.find(fake_game.flatten(x[field]), needle, 1, true) then
        return true
      end
    end
  end
  return false
end

-- The first line of the table whose recipe cell shows `text` (a sub-factory's
-- name, or the recipe's rich-text tag in its button's tooltip).
local function line_named(window, text)
  for _, line in ipairs(lines(window)) do
    if shows(line[2], text) then
      return line
    end
  end
  return nil
end

describe("scripts/gui.lua", function()
  local gui, fake

  before_each(function()
    fake = fake_game.install({})
    gui = require("scripts.gui")
  end)
  after_each(function()
    fake_game.uninstall()
  end)

  local function show(snapshot, opts)
    opts = opts or {}
    local player = fake.players[1]
    gui.ensure_button(player)
    local _, missing = snapshot_lib.find_missing(snapshot, opts.exists or everything_exists())
    gui.open(player, {
      model = viewmodel.build(snapshot, { missing = missing }),
      indicator = opts.indicator,
      selected = opts.selected or 1,
      done = opts.done,
    })
    return player, player.gui.screen[gui.WINDOW]
  end

  local function reinstall(lacking)
    fake_game.uninstall()
    fake = fake_game.install(lacking or {})
    gui = require("scripts.gui")
  end

  it("adds the top-bar button once", function()
    local player = fake.players[1]
    gui.ensure_button(player)
    gui.ensure_button(player)
    assert.are.equal(1, #player.gui.top.children)
  end)

  it("opens a window with a close button, does not make it opened, and toggles it away", function()
    local player = fake.players[1]
    gui.toggle(player)
    assert.is_true(gui.is_open(player))
    assert.is_truthy(player.gui.screen[gui.WINDOW].children[1].children[4].name == gui.CLOSE)
    -- Decision 12: not player.opened, so paste mode and other windows work.
    assert.is_nil(player.opened)
    gui.toggle(player)
    assert.is_false(gui.is_open(player))
  end)

  for _, name in ipairs(support.list_snapshot_fixtures()) do
    it("draws the drop-down of " .. name .. " and the first block's table", function()
      local snapshot = support.json_to_table(fixture_text(name))
      local _, window = show(snapshot)
      local dropdown = dropdown_of(window)
      assert.are.equal(#snapshot.blocks, #dropdown.items)
      assert.are.equal(1, dropdown.selected_index)
      assert.is_true(string.find(fake_game.flatten(dropdown.items[1]), snapshot.blocks[1].name, 1, true) ~= nil)
      -- The summary line, then one line per row and per sub-factory header.
      local block = viewmodel.build(snapshot, {}).blocks[1]
      assert.are.equal(1 + #block.entries, #lines(window))
    end)

    it("draws every block of " .. name .. " as the selected one", function()
      local snapshot = support.json_to_table(fixture_text(name))
      for i = 1, #snapshot.blocks do
        local _, window = show(snapshot, { selected = i })
        assert.are.equal(i, dropdown_of(window).selected_index)
        local with_machine = 0
        for _, row in ipairs(snapshot.blocks[i].rows) do
          with_machine = with_machine + (row.machine and 1 or 0)
        end
        assert.are.equal(with_machine, #tagged(window, "machine"))
        reinstall()
      end
    end)
  end

  it("puts each block's colour swatch and name in the drop-down, non-ASCII names as they are", function()
    local snapshot = support.json_to_table(fixture_text("unicode"))
    local _, window = show(snapshot)
    local items = dropdown_of(window).items
    for i, block in ipairs(snapshot.blocks) do
      local text = fake_game.flatten(items[i])
      assert.is_true(string.find(text, block.name, 1, true) ~= nil)
      assert.is_true(string.find(text, "[color=" .. block.color .. "]", 1, true) ~= nil)
    end
  end)

  it("names the nameless block in the drop-down", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    snapshot.blocks[1].name = ""
    local _, window = show(snapshot)
    assert.is_true(string.find(fake_game.flatten(dropdown_of(window).items[1]), "{fp-viewer.unnamed}", 1, true) ~= nil)
  end)

  it("lists the ids the game lacks and draws them in red without a sprite", function()
    local lacking = { ["iron-gear-wheel"] = true, ["bob-assembling-machine-6"] = true }
    reinstall(lacking)
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot, { exists = support.exists_except(lacking) })
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.missing-heading|"))
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.kind-item}: iron-gear-wheel"))
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.kind-machine}: bob-assembling-machine-6"))
    -- The first row's machine: a button, red, with no sprite and the missing-id text.
    local machine = tagged(window, "machine")[1]
    assert.is_nil(machine.sprite)
    assert.are.equal("flib_slot_button_red", machine.style.name)
    local tooltip = fake_game.flatten(machine.tooltip)
    assert.are.equal(1, string.find(tooltip, "{fp-viewer.missing-id|bob-assembling-machine-6}", 1, true))
    -- No sprite path or rich-text tag names a missing id.
    assert.are.equal(0, #fake_game.find(window, function(e)
      return e.sprite == "entity/bob-assembling-machine-6" or e.sprite == "item/iron-gear-wheel"
    end))
  end)

  it("shows a synthetic row with no product as an unknown button with no sprite", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    snapshot.blocks[1].rows[1] = { kind = "mining", machines = 1, machinesCeil = 1 }
    local _, window = show(snapshot)
    local recipe = buttons(lines(window)[2][2])[1]
    assert.is_nil(recipe.sprite)
    assert.are.equal("{fp-viewer.unknown-row|{fp-viewer.kind-mining}}", fake_game.flatten(recipe.tooltip))
  end)

  it("draws a power row with the electricity icon and its kind in the tooltip", function()
    local snapshot = support.json_to_table(fixture_text("seablock-groups"))
    local _, window = show(snapshot)
    local power = fake_game.find(window, function(e)
      return e.type == "sprite-button" and e.sprite == "utility/electricity_icon"
    end)
    assert.are.equal(2, #power)
    assert.are.equal("{fp-viewer.kind-power}: {fp-viewer.electricity}", fake_game.flatten(power[1].tooltip))
    -- Electricity is never an item button.
    assert.are.equal(0, #fake_game.find(window, function(e)
      return e.sprite == "virtual/electricity" or e.sprite == "item/electricity"
    end))
  end)

  it("draws the summary line first: a blue icon, the net products and the net ingredients in green", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot)
    local summary = lines(window)[1]
    assert.are.equal("checkbox", summary[1].type)
    assert.are.same({ block = "Gears", what = "check" }, summary[1].tags)
    assert.is_false(summary[1].state)
    -- An icon, not a caption, so the recipe column stays one icon wide.
    local icon = buttons(summary[2])[1]
    assert.are.equal("flib_slot_button_blue", icon.style.name)
    assert.are.equal("item/iron-gear-wheel", icon.sprite)
    assert.are.equal("{fp-viewer.summary}", fake_game.flatten(icon.tooltip))
    assert.is_false(fake_game.any_caption(summary[2], "{fp-viewer.summary}"))
    -- small: ore into plates into gears, so the net is ore in, gears out.
    local products, ingredients = buttons(summary[4]), buttons(summary[5])
    assert.are.equal(1, #products)
    assert.are.equal("item/iron-gear-wheel", products[1].sprite)
    assert.are.equal("flib_slot_button_default", products[1].style.name)
    assert.are.equal(1, #ingredients)
    assert.are.equal("flib_slot_button_green", ingredients[1].style.name)
    assert.is_number(products[1].number)
  end)

  it("says why a failed block has no numbers, and falls back on its products", function()
    local snapshot = support.json_to_table(fixture_text("seablock-edge-cases"))
    local _, window = show(snapshot, { selected = 3 })
    local note = main_of(window)["fp_viewer_note"]
    assert.is_true(fake_game.any_caption(note, "{fp-viewer.solve-failed|LP solver failed"))
    local summary = lines(window)[1]
    assert.are.equal(#snapshot.blocks[3].products, #buttons(summary[4]))
    -- Rows the solve did not value: icons without numbers.
    for _, b in ipairs(buttons(lines(window)[2][3])) do
      assert.is_nil(b.number)
    end
    -- Another block: no note.
    reinstall()
    _, window = show(snapshot, { selected = 1 })
    assert.are.equal(0, #main_of(window)["fp_viewer_note"].children)
  end)

  it("shows None for a block with no rows", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    snapshot.blocks[1].rows = {}
    local _, window = show(snapshot)
    assert.is_true(fake_game.any_caption(scroll_of(window), "{fp-viewer.none}"))
    assert.are.equal(0, #fake_game.find(window, function(e)
      return e.type == "table"
    end))
  end)

  it("draws machines and beacons with their counts, tags and a left-click filter", function()
    local snapshot = support.json_to_table(fixture_text("seablock-groups"))
    local _, window = show(snapshot)
    local _, t = lines(window)
    assert.are.equal(6, t.column_count)
    local copper = line_named(window, "[recipe=copper-cable]")
    assert.is_truthy(copper)
    local machine, beacon = copper[3], copper[4]
    assert.are.equal("entity/bob-assembling-machine-6", machine.sprite)
    assert.are.equal(1, machine.number)
    assert.are.same({ "left" }, machine.mouse_button_filter)
    assert.are.equal("machine", machine.tags.what)
    assert.are.equal("Nested sub-factories", machine.tags.block)
    assert.are.equal("entity/beacon", beacon.sprite)
    assert.are.equal(8, beacon.number) -- 8 per machine, 1 machine
    assert.are.same({ "left" }, beacon.mouse_button_filter)
    assert.are.equal("beacon", beacon.tags.what)
    assert.are.equal(machine.tags.entry, beacon.tags.entry)
    local tooltip = fake_game.flatten(beacon.tooltip)
    assert.is_truthy(string.find(tooltip, "{fp-viewer.tt-beacons-per-machine|8}", 1, true))
    assert.is_truthy(string.find(tooltip, "{fp-viewer.tt-module|2|[item=speed-module] {item-name.speed-module}}", 1, true))
    -- The machine's own modules are in its tooltip, not drawn as buttons.
    local furnace = line_named(window, "[recipe=sb-iron-plate-from-ore]")
    assert.is_truthy(string.find(fake_game.flatten(furnace[3].tooltip), "{fp-viewer.tt-module|2|", 1, true))
    assert.are.equal(0, #fake_game.find(window, function(e)
      return e.sprite == "item/speed-module"
    end))
    -- A row without a beacon has an empty cell there.
    assert.are.equal("empty-widget", furnace[4].type)
  end)

  it("leaves the beacon column out of a block with no beacon", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot)
    local _, t = lines(window)
    assert.are.equal(5, t.column_count)
    assert.are.equal(0, #tagged(window, "beacon"))
  end)

  it("shares the item columns of a line by what the block needs, and fits the window", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local row = snapshot.blocks[1].rows[1]
    row.inputs = {}
    for i = 1, 9 do
      row.inputs[i] = { id = "ingredient-" .. i, type = "item", rate = i }
    end
    local _, window = show(snapshot)
    local cell = lines(window)[2][5]
    assert.are.equal("table", cell.type)
    assert.are.equal(9, #cell.children)
    -- 26 % of 1710 is 444: six buttons fit, one of them for the product.
    assert.are.equal(5, cell.column_count)
    assert.are.equal(1, lines(window)[2][4].column_count)
  end)

  it("leaves the name of a sub-factory room, and fewer buttons, in a narrow window", function()
    local _, window = show(support.json_to_table(fixture_text("seablock-groups")))
    local line = lines(window)[2]
    local _, t = lines(window)
    assert.are.equal(6, t.column_count)
    -- 444 - 24 frame - 16 padding - 60 gaps - 72 machine and beacon - 142 name and
    -- checkbox, plus 4 of spacing: three buttons of 40.
    assert.are.equal(3, line[5].column_count + line[6].column_count)
  end)

  it("works with a screen size it cannot read", function()
    local player = fake.players[1]
    player.display_resolution = nil
    gui.open(player, { model = viewmodel.build(support.json_to_table(fixture_text("small")), {}), selected = 1 })
    local window = player.gui.screen[gui.WINDOW]
    assert.are.equal(499, window.style.width)
    assert.are.same({ 10, 63 }, window.location)
  end)

  it("draws sub-factories as indented header lines, the area ones tagged", function()
    local snapshot = support.json_to_table(fixture_text("seablock-groups"))
    local _, window = show(snapshot)
    local all = lines(window)
    -- summary, gears, [Plates and cables], plates, [Power], solar, solar, cables, pipe
    assert.are.equal(9, #all)
    local plates = line_named(window, "Plates and cables")
    local power = line_named(window, "Power")
    assert.are.equal(0, plates[2].style.left_margin)
    assert.are.equal(20, power[2].style.left_margin)
    assert.are.equal(20, all[4][2].style.left_margin) -- a row of the top-level sub-factory
    assert.are.equal(40, all[6][2].style.left_margin) -- a row of the nested one
    assert.are.equal(0, all[9][2].style.left_margin) -- the root row after them
    -- The name is capped, with the full name in its tooltip; no machine there.
    local name = plates[2].children[2]
    assert.are.equal("Plates and cables", name.tooltip)
    assert.is_number(name.style.maximal_width)
    assert.are.equal("empty-widget", plates[3].type)
    assert.is_false(fake_game.any_caption(window, "{fp-viewer.area-tag}"))
    -- Net flows: the plates sub-factory turns ore and copper into plates and cables.
    assert.is_true(#buttons(plates[5]) > 0)

    reinstall()
    _, window = show(support.json_to_table(fixture_text("seablock-areas")))
    assert.is_true(fake_game.any_caption(line_named(window, "Smelting")[2], "{fp-viewer.area-tag}"))
  end)

  it("draws built rows in grayscale and derives the sub-factory's checkbox", function()
    local snapshot = support.json_to_table(fixture_text("seablock-groups"))
    local block = viewmodel.build(snapshot, {}).blocks[1]
    local power
    for _, entry in ipairs(block.entries) do
      if entry.type == "group" and entry.name == "Power" then
        power = entry
      end
    end
    local done = { [block.key] = {} }
    for _, k in ipairs(power.keys) do
      done[block.key][k] = true
    end
    local _, window = show(snapshot, { done = done })
    local all = lines(window)
    assert.is_true(line_named(window, "Power")[1].state) -- every row under it is built
    assert.is_false(line_named(window, "Plates and cables")[1].state) -- not every row
    assert.is_false(all[1][1].state)
    assert.is_true(all[6][1].state)
    for _, b in ipairs(buttons(all[6][2])) do
      assert.is_true(b.style.draw_grayscale_picture)
    end
    assert.is_true(all[6][3].style.draw_grayscale_picture)
    -- A built row's machine stays a button, clickable.
    assert.are.equal("machine", all[6][3].tags.what)
    assert.is_nil(all[2][3].style.draw_grayscale_picture)
  end)

  it("shows the indicator in the window and the button's tooltip", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    for _, indicator in ipairs({ "disconnected", "mismatch", "stale" }) do
      local player, window = show(snapshot, { indicator = indicator })
      assert.is_true(fake_game.any_caption(window, "{fp-viewer.indicator-" .. indicator))
      assert.is_true(string.find(fake_game.flatten(player.gui.top[gui.BUTTON].tooltip), indicator, 1, true) ~= nil)
      reinstall()
    end
  end)

  it("says so when no plan has arrived, and when the plan has no blocks", function()
    local player = fake.players[1]
    gui.open(player)
    gui.update(player, { model = nil, indicator = "disconnected", selected = 1 })
    assert.is_true(fake_game.any_caption(player.gui.screen[gui.WINDOW], "{fp-viewer.no-plan}"))
    local snapshot = support.json_to_table(fixture_text("small"))
    snapshot.blocks = {}
    gui.update(player, { model = viewmodel.build(snapshot, {}), selected = 1 })
    local window = player.gui.screen[gui.WINDOW]
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.no-blocks}"))
    assert.is_nil(window["fp_viewer_content"]["fp_viewer_main"])
  end)

  it("takes the green off a built row's ingredients, and the blue off a built block's icon", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local block = viewmodel.build(snapshot, {}).blocks[1]
    local done = { [block.key] = {} }
    for _, k in ipairs(block.summary.keys) do
      done[block.key][k] = true
    end
    local _, window = show(snapshot, { done = done })
    local all = lines(window)
    assert.are.equal("flib_slot_button_default", buttons(all[1][2])[1].style.name)
    assert.are.equal("flib_slot_button_default", buttons(all[2][5])[1].style.name)
    assert.is_true(buttons(all[2][5])[1].style.draw_grayscale_picture)
  end)

  it("draws the slots at 36 pixels, in a striped table with its pusher, like the reference", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot)
    local all, t = lines(window)
    assert.are.equal("finished_game_table", t.style.name)
    assert.are.equal(0, t.style.left_cell_padding)
    assert.are.same({ 4, 8 }, t.style.padding)
    assert.are.equal(36, all[2][3].style.size)
    local pusher = all[2][#all[2]]
    assert.are.equal("empty-widget", pusher.type)
    assert.is_true(pusher.style.horizontally_stretchable)
  end)

  it("centres the title between two drag handles", function()
    local _, window = show(support.json_to_table(fixture_text("small")))
    local bar = window["fp_viewer_title_bar"]
    assert.are.equal("frame_header_flow", bar.style.name)
    assert.are.equal("empty-widget", bar.children[1].type)
    assert.are.equal("label", bar.children[2].type)
    assert.are.equal("empty-widget", bar.children[3].type)
  end)

  it("falls back on the base game's slots when flib is not there", function()
    fake.lacking_styles = {
      flib_slot_button_default = true,
      flib_slot_button_green = true,
      flib_slot_button_blue = true,
      flib_slot_button_red = true,
      flib_naked_scroll_pane_no_padding = true,
    }
    local _, window = show(support.json_to_table(fixture_text("small")))
    local all = lines(window)
    assert.are.equal("slot_sized_button_blue", buttons(all[1][2])[1].style.name)
    assert.are.equal("slot_sized_button", buttons(all[1][4])[1].style.name)
    assert.are.equal("slot_sized_button_green", buttons(all[1][5])[1].style.name)
    assert.are.equal(36, buttons(all[1][4])[1].style.size)
  end)

  it("keeps the header empty and hidden when all is well, with the data set on the drop-down", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot)
    local header = window["fp_viewer_content"]["fp_viewer_header"]
    assert.are.equal(0, #header.children)
    assert.is_false(header.visible)
    assert.is_false(main_of(window)["fp_viewer_note"].visible)
    local tooltip = fake_game.flatten(dropdown_of(window).tooltip)
    assert.is_truthy(string.find(tooltip, "{fp-viewer.data-set|", 1, true))
  end)

  it("replaces the window of an older version, which has no named title bar, instead of raising", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, missing = snapshot_lib.find_missing(snapshot, everything_exists())
    local model = viewmodel.build(snapshot, { missing = missing })
    for _, only_table in ipairs({ false, true }) do
      local player = fake.players[1]
      gui.close(player)
      -- The last layout before this one: the drop-down right under the main flow.
      local old = player.gui.screen.add({ type = "frame", name = gui.WINDOW, direction = "vertical" })
      old.add({ type = "flow", direction = "horizontal" })
      local content = old.add({ type = "flow", name = "fp_viewer_content", direction = "vertical" })
      content.add({ type = "flow", name = "fp_viewer_header", direction = "vertical" })
      local main = content.add({ type = "flow", name = "fp_viewer_main", direction = "vertical" })
      main.add({ type = "drop-down", name = DROPDOWN, items = {} })
      assert.has_no.errors(function()
        gui.update(player, { model = model, selected = 1, only_table = only_table })
      end)
      local window = player.gui.screen[gui.WINDOW]
      assert.are_not.equal(old, window)
      assert.is_truthy(window["fp_viewer_title_bar"])
      assert.are.equal(#snapshot.blocks, #dropdown_of(window).items)
      assert.is_truthy(scroll_of(window))
    end
  end)

  it("redraws the drop-down for a model it was not drawn from, even on a table-only update", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local player, window = show(snapshot)
    local first = viewmodel.build(snapshot, {})
    gui.update(player, { model = first, generation = 1, selected = 1 })
    local renamed = support.json_to_table(fixture_text("small"))
    renamed.blocks[1].name = "Renamed block"
    local second = viewmodel.build(renamed, {})
    -- Same number of blocks, another snapshot.
    gui.update(player, { model = second, generation = 2, selected = 1, only_table = true })
    local dropdown = dropdown_of(window)
    assert.is_true(string.find(fake_game.flatten(dropdown.items[1]), "Renamed block", 1, true) ~= nil)
    -- The same snapshot again keeps the drop-down element as it is.
    gui.update(player, { model = second, generation = 2, selected = 1, only_table = true })
    assert.are.equal(dropdown, dropdown_of(window))
  end)

  it("clamps a selection past the end", function()
    local snapshot = support.json_to_table(fixture_text("seablock-loop"))
    local _, window = show(snapshot, { selected = 99 })
    assert.are.equal(#snapshot.blocks, dropdown_of(window).selected_index)
  end)

  it("does nothing for a player whose window is closed", function()
    local player = fake.players[1]
    gui.update(player, { model = nil, selected = 1 })
    assert.is_false(gui.is_open(player))
  end)
end)

describe("control.lua", function()
  local fake

  local function tick(t)
    _G.game.tick = t
    fake.handlers.on_tick({ tick = t })
  end

  local function hear(data, t)
    fake.handlers.on_udp_packet_received({ payload = data, tick = t })
  end

  local function boot(lacking)
    fake = fake_game.install(lacking or {})
    assert(loadfile("control.lua"))()
    fake.handlers.on_init()
    fake.handlers.on_player_created({ player_index = 1 })
  end

  before_each(function()
    boot()
  end)
  after_each(function()
    fake_game.uninstall()
  end)

  local clock = 0
  -- One full delivery in one chunk; each call takes the next 10-tick cycle.
  local function deliver(text, id)
    id = id or ID
    clock = clock + 20
    hear(support.probe(id, 1, #text), clock + 1)
    tick(clock + 2)
    hear(support.chunk(id, 0, 1, #text, text), clock + 11)
    tick(clock + 12)
  end

  local function open_window()
    local player = fake.players[1]
    fake.handlers.on_gui_click({ element = player.gui.top["fp_viewer_button"], player_index = 1 })
    return player, player.gui.screen["fp_viewer_window"]
  end

  local function select_block(window, index)
    local dropdown = dropdown_of(window)
    dropdown.selected_index = index
    fake.handlers.on_gui_selection_state_changed({ element = dropdown, player_index = 1 })
  end

  local function check(element, state)
    element.state = state
    fake.handlers.on_gui_checked_state_changed({ element = element, player_index = 1 })
  end

  local function click(element)
    fake.handlers.on_gui_click({ element = element, player_index = 1 })
  end

  -- The names of the cursor calls made, in order.
  local function calls()
    local out = {}
    for i, c in ipairs(fake.cursor) do
      out[i] = c[1]
    end
    return out
  end

  local function call(name)
    for _, c in ipairs(fake.cursor) do
      if c[1] == name then
        return c
      end
    end
    return nil
  end

  it("polls every 10 ticks and sends nothing while nothing was heard", function()
    for t = 1, 100 do
      tick(t)
    end
    assert.are.equal(10, fake.recv_calls)
    assert.are.equal(0, #fake.sent)
  end)

  it("answers a ping with a hello on the flush tick, to the bridge port", function()
    hear(support.ping(), 11)
    assert.are.equal(0, #fake.sent)
    tick(12)
    assert.are.equal(1, #fake.sent)
    assert.are.equal(34199, fake.sent[1].port)
    assert.are.equal("FP01 H " .. support.NO_ID .. " 0 " .. support.NO_ID, fake.sent[1].data)
  end)

  it("sends at most once per poll, whatever arrived", function()
    hear(support.ping(), 11)
    hear(support.probe(ID, 1, 10), 11)
    hear(support.ping(), 11)
    tick(12)
    tick(13)
    tick(22)
    assert.are.equal(1, #fake.sent)
    assert.are.equal("FP01 R " .. ID, fake.sent[1].data)
  end)

  it("uses the port setting", function()
    fake.settings["fp-viewer-bridge-port"].value = 40000
    hear(support.ping(), 11)
    tick(12)
    assert.are.equal(40000, fake.sent[1].port)
  end)

  it("survives a game launched without the flag: recv_udp and send_udp raise", function()
    fake.recv_fails, fake.send_fails = true, true
    tick(10)
    hear(support.ping(), 11)
    assert.has_no.errors(function()
      tick(12)
      tick(20)
      tick(22)
    end)
    -- Each failure is logged once, not once per poll.
    assert.are.equal(2, #fake.logged)
  end)

  it("stores a delivered snapshot in storage and acknowledges it", function()
    local text = fixture_text("small")
    deliver(text)
    local stored = _G.storage.fp_viewer.stored
    assert.are.equal(ID, stored.id)
    assert.are.equal(0, stored.unknown_ids)
    assert.are.equal("Gears", stored.snapshot.blocks[1].name)
    assert.are.equal("FP01 A " .. ID .. " 0", fake.sent[#fake.sent].data)
  end)

  it("counts the ids the game lacks and reports the count in the ack", function()
    fake_game.uninstall()
    boot({ ["iron-gear-wheel"] = true })
    deliver(fixture_text("small"))
    assert.are.equal(2, _G.storage.fp_viewer.stored.unknown_ids) -- the item and the recipe
    assert.are.equal("FP01 A " .. ID .. " 2", fake.sent[#fake.sent].data)
  end)

  it("builds the window after a delivery, and the drop-down selects a block", function()
    local snapshot = support.json_to_table(fixture_text("seablock-loop"))
    deliver(fixture_text("seablock-loop"))
    local player, window = open_window()
    assert.is_truthy(window)
    -- Decision 12: the window is not player.opened, and no on_gui_closed handler.
    assert.is_nil(player.opened)
    assert.is_nil(fake.handlers.on_gui_closed)

    local main = main_of(window)
    local dropdown, scroll = dropdown_of(window), scroll_of(window)
    local last = #snapshot.blocks
    assert.is_true(last > 1)
    assert.are.equal(last, #dropdown.items)
    select_block(window, last)
    assert.are.same({ index = last, name = snapshot.blocks[last].name }, _G.storage.fp_viewer.selected[1])
    -- Only the table changed: the drop-down and the scroll pane are the same
    -- elements, and the table is scrolled back to the top.
    assert.are.equal(main, main_of(window))
    assert.are.equal(dropdown, dropdown_of(window))
    assert.is_true(dropdown.valid)
    assert.are.equal(last, dropdown.selected_index)
    assert.are.equal(scroll, scroll_of(window))
    assert.are.equal(1, scroll.scrolled_to_top)
    local machines = tagged(window, "machine")
    assert.are.equal(#snapshot.blocks[last].rows, #machines)
    assert.are.equal(snapshot.blocks[last].name, machines[1].tags.block)
  end)

  it("does not keep the old header and drop-down for a new snapshot with as many blocks", function()
    deliver(fixture_text("small"))
    local _, window = open_window()
    local renamed = support.json_to_table(fixture_text("small"))
    renamed.blocks[1].name = "Renamed block"
    local text = json.encode(renamed)
    -- The snapshot is stored when its last chunk arrives; the window is only
    -- refreshed on the next tick, and a drop-down change can come in between.
    clock = clock + 20
    hear(support.probe("3333333333333333", 1, #text), clock + 1)
    tick(clock + 2)
    hear(support.chunk("3333333333333333", 0, 1, #text, text), clock + 11)
    assert.are.equal("3333333333333333", _G.storage.fp_viewer.stored.id)
    select_block(window, 1)
    local dropdown = dropdown_of(window)
    assert.is_true(string.find(fake_game.flatten(dropdown.items[1]), "Renamed block", 1, true) ~= nil)
  end)

  it("ignores a drop-down index that leads nowhere", function()
    deliver(fixture_text("small"))
    local _, window = open_window()
    assert.has_no.errors(function()
      select_block(window, 7)
    end)
    assert.are.equal(1, _G.storage.fp_viewer.selected[1].index)
  end)

  it("shows Disconnected after the silence, and clears it when the bridge speaks", function()
    local player = open_window()
    tick(12)
    local window = player.gui.screen["fp_viewer_window"]
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.indicator-disconnected"))
    hear(support.ping(), 21)
    tick(22)
    window = player.gui.screen["fp_viewer_window"]
    assert.is_false(fake_game.any_caption(window, "{fp-viewer.indicator-disconnected"))
  end)

  it("keeps the drop-down and the scroll pane when a new snapshot arrives, refilling them", function()
    deliver(fixture_text("seablock-loop"))
    local _, window = open_window()
    local dropdown, scroll = dropdown_of(window), scroll_of(window)
    deliver(fixture_text("small"), "2222222222222222")
    assert.are.equal(dropdown, dropdown_of(window))
    assert.are.equal(scroll, scroll_of(window))
    assert.are.equal(1, #dropdown.items)
    assert.is_nil(scroll.scrolled_to_top)
  end)

  it("opens at the top left at the reference's width, and a tick leaves a dragged window alone", function()
    deliver(fixture_text("small"))
    local _, window = open_window()
    assert.are.same({ 20, 126 }, window.location) -- 10 and 63, at a display scale of 2
    assert.are.equal(444, window.style.width) -- 26 % of 1710
    assert.are.equal(889, window.style.maximal_height) -- 80 % of 1112
    assert.is_truthy(main_of(window))
    window.location = { 500, 300 }
    hear(support.ping("3333333333333333"), 1000)
    tick(1002)
    assert.are.same({ 500, 300 }, window.location)
  end)

  it("lays an open window out again when the screen changes, and leaves a closed one closed", function()
    deliver(fixture_text("small"))
    local player, window = open_window()
    player.display_resolution = { width = 1920, height = 1080 }
    player.display_scale = 1
    fake.handlers.on_player_display_resolution_changed({ player_index = 1 })
    local reopened = player.gui.screen["fp_viewer_window"]
    assert.are_not.equal(window, reopened)
    assert.are.equal(499, reopened.style.width)
    assert.are.same({ 10, 63 }, reopened.location)
    assert.is_truthy(scroll_of(reopened).children[1])

    fake.handlers.on_gui_click({ element = player.gui.top["fp_viewer_button"], player_index = 1 })
    fake.handlers.on_player_display_scale_changed({ player_index = 1 })
    assert.is_nil(player.gui.screen["fp_viewer_window"])
  end)

  it("keeps the selected block by name through a reordered snapshot", function()
    local snapshot = support.json_to_table(fixture_text("seablock-loop"))
    local count = #snapshot.blocks
    deliver(fixture_text("seablock-loop"))
    local _, window = open_window()
    select_block(window, count)
    local chosen = snapshot.blocks[count].name

    -- The same blocks, in the opposite order, as a new snapshot.
    local reversed = support.copy(snapshot)
    for i = 1, count do
      reversed.blocks[i] = snapshot.blocks[count + 1 - i]
    end
    deliver(json.encode(reversed), "4444444444444444")
    assert.are.equal(1, _G.storage.fp_viewer.selected[1].index)
    assert.are.equal(chosen, _G.storage.fp_viewer.selected[1].name)
    assert.are.equal(1, dropdown_of(window).selected_index)
    assert.are.equal(chosen, tagged(window, "machine")[1].tags.block)
  end)

  it("drops a removed player's selection", function()
    deliver(fixture_text("small"))
    open_window()
    assert.is_truthy(_G.storage.fp_viewer.selected[1])
    fake.handlers.on_player_removed({ player_index = 1 })
    assert.is_nil(_G.storage.fp_viewer.selected[1])
  end)

  describe("the built checkboxes", function()
    it("ticks a row into storage, redraws it in grayscale and keeps the scroll", function()
      deliver(fixture_text("small"))
      local _, window = open_window()
      local scroll = scroll_of(window)
      local row = lines(window)[2]
      check(row[1], true)
      local key = row[1].tags.entry
      assert.is_true(_G.storage.fp_viewer.done["Gears"][key])
      row = lines(window)[2]
      assert.is_true(row[1].state)
      assert.is_true(row[3].style.draw_grayscale_picture)
      assert.are.equal(scroll, scroll_of(window))
      assert.is_nil(scroll.scrolled_to_top)
      -- Unticked: the entry goes, and so does the block's table.
      check(row[1], false)
      assert.is_nil(_G.storage.fp_viewer.done["Gears"])
      assert.is_false(lines(window)[2][1].state)
    end)

    it("ticks every row of the block from the summary line, and unticks them", function()
      deliver(fixture_text("seablock-groups"))
      local _, window = open_window()
      check(lines(window)[1][1], true)
      local all = lines(window)
      for i = 2, #all do
        assert.is_true(all[i][1].state, "line " .. i)
      end
      local count = 0
      for _ in pairs(_G.storage.fp_viewer.done["Nested sub-factories"]) do
        count = count + 1
      end
      assert.are.equal(6, count) -- the rows only: a header's state is derived
      check(lines(window)[1][1], false)
      assert.is_nil(_G.storage.fp_viewer.done["Nested sub-factories"])
    end)

    it("ticks a sub-factory's rows from its header, and derives the header from its rows", function()
      deliver(fixture_text("seablock-groups"))
      local _, window = open_window()
      check(line_named(window, "Power")[1], true)
      local all = lines(window)
      assert.is_true(all[6][1].state)
      assert.is_true(all[7][1].state)
      assert.is_false(all[4][1].state) -- the plates row, outside "Power"
      assert.is_false(line_named(window, "Plates and cables")[1].state)
      -- Ticking the other rows of "Plates and cables" one by one checks its header.
      check(all[4][1], true)
      check(lines(window)[8][1], true)
      assert.is_true(line_named(window, "Plates and cables")[1].state)
      assert.is_false(lines(window)[1][1].state) -- two root rows are not built
    end)

    it("keeps the ticks through a new snapshot of the same plan", function()
      deliver(fixture_text("seablock-groups"))
      local _, window = open_window()
      check(lines(window)[4][1], true)
      deliver(fixture_text("seablock-groups"), "2222222222222222")
      assert.are.equal("2222222222222222", _G.storage.fp_viewer.stored.id)
      assert.is_true(lines(window)[4][1].state)
      assert.is_true(lines(window)[4][3].style.draw_grayscale_picture)
    end)

    it("does nothing for a box whose row is gone, and puts it back", function()
      deliver(fixture_text("small"))
      local _, window = open_window()
      local box = lines(window)[2][1]
      box.tags = { block = "Gears", entry = "no-such-row", what = "check" }
      check(box, true)
      assert.is_nil(_G.storage.fp_viewer.done["Gears"])
      assert.is_false(lines(window)[2][1].state)
    end)

    it("creates the ticks in a save made before they existed", function()
      deliver(fixture_text("small"))
      _G.storage.fp_viewer.done = nil
      local _, window = open_window()
      check(lines(window)[2][1], true)
      assert.is_truthy(_G.storage.fp_viewer.done["Gears"])
    end)
  end)

  describe("a click on a building", function()
    local window

    before_each(function()
      fake.entities["bob-electric-chemical-mixing-furnace-2"] = { type = "furnace" }
      fake.entities["beacon"] = { type = "beacon" }
      fake.entities["solar-panel"] = { type = "solar-panel" }
      fake.entities["bob-solar-panel-large"] = { type = "solar-panel", flags = { ["not-blueprintable"] = true } }
      deliver(fixture_text("seablock-groups"))
      window = select(2, open_window())
    end)

    local function machine(text)
      return line_named(window, text)[3]
    end

    it("puts a crafter with its recipe into the cursor through the clipboard, and leaves the window open", function()
      click(machine("[recipe=iron-gear-wheel]"))
      assert.are.same({
        "clear_cursor",
        "create_inventory",
        "set_stack",
        "set_blueprint_entities",
        "add_to_clipboard",
        "activate_paste",
        "destroy",
      }, calls())
      assert.are.same({ name = "blueprint" }, call("set_stack")[2])
      local entities = call("set_blueprint_entities")[2]
      assert.are.equal(1, #entities)
      assert.are.equal("bob-assembling-machine-6", entities[1].name)
      assert.are.equal("iron-gear-wheel", entities[1].recipe)
      assert.are.same({ x = 0.5, y = 0.5 }, entities[1].position) -- a 3x3 building
      assert.are.equal(0, fake.inventories_open)
      assert.is_true(window.valid)
      assert.is_truthy(fake.players[1].gui.screen["fp_viewer_window"])
    end)

    it("puts a furnace with its modules and no recipe into the cursor", function()
      click(machine("[recipe=sb-iron-plate-from-ore]"))
      local entity = call("set_blueprint_entities")[2][1]
      assert.is_nil(entity.recipe)
      assert.are.same({
        {
          id = { name = "speed-module" },
          items = { in_inventory = { { inventory = 4, stack = 0 }, { inventory = 4, stack = 1 } } },
        },
      }, entity.items)
    end)

    it("puts a beacon with its modules into the cursor", function()
      click(line_named(window, "[recipe=copper-cable]")[4])
      local entity = call("set_blueprint_entities")[2][1]
      assert.are.equal("beacon", entity.name)
      assert.is_nil(entity.recipe)
      assert.are.same({
        {
          id = { name = "speed-module" },
          items = { in_inventory = { { inventory = 1, stack = 0 }, { inventory = 1, stack = 1 } } },
        },
      }, entity.items)
      assert.are.equal(0, fake.inventories_open)
    end)

    it("puts a plain building into the cursor as a ghost of its item", function()
      local solar = lines(window)[6][3]
      assert.are.equal("entity/solar-panel", solar.sprite)
      click(solar)
      assert.are.same({ "clear_cursor", "cursor_ghost" }, calls())
      assert.are.equal("solar-panel", call("cursor_ghost")[2].name)
    end)

    it("shows a flying text for a building that cannot be placed, and touches nothing else", function()
      local large = lines(window)[7][3]
      assert.are.equal("entity/bob-solar-panel-large", large.sprite)
      click(large)
      assert.are.same({ "create_local_flying_text" }, calls())
      local args = call("create_local_flying_text")[2]
      assert.is_true(args.create_at_cursor)
      assert.are.equal(
        "{fp-viewer.cannot-place|{fp-viewer.refused-not-blueprintable}}",
        fake_game.flatten(args.text)
      )
    end)

    it("shows a flying text when the cursor cannot be emptied", function()
      fake.cursor_stuck = true
      click(machine("[recipe=iron-gear-wheel]"))
      assert.are.same({ "clear_cursor", "create_local_flying_text" }, calls())
      assert.are.equal(
        "{fp-viewer.cannot-place|{fp-viewer.refused-cursor-full}}",
        fake_game.flatten(call("create_local_flying_text")[2].text)
      )
    end)

    for _, failing in ipairs({ "set_stack", "set_blueprint_entities", "add_to_clipboard", "activate_paste" }) do
      it("destroys the inventory when " .. failing .. " raises, logs it once and says so", function()
        fake.raise[failing] = true
        assert.has_no.errors(function()
          click(machine("[recipe=iron-gear-wheel]"))
          click(machine("[recipe=iron-gear-wheel]"))
        end)
        assert.are.equal(0, fake.inventories_open)
        local destroyed, failures = 0, 0
        for _, c in ipairs(fake.cursor) do
          if c[1] == "destroy" then
            destroyed = destroyed + 1
          end
        end
        for _, line in ipairs(fake.logged) do
          if string.find(line, "cursor failed", 1, true) then
            failures = failures + 1
          end
        end
        assert.are.equal(2, destroyed)
        assert.are.equal(1, failures)
        assert.are.equal(
          "{fp-viewer.cannot-place|{fp-viewer.refused-failed}}",
          fake_game.flatten(fake.cursor[#fake.cursor][2].text)
        )
      end)
    end

    it("still picks up a built row's building", function()
      local gears = line_named(window, "[recipe=iron-gear-wheel]")
      check(gears[1], true)
      gears = line_named(window, "[recipe=iron-gear-wheel]")
      assert.is_true(gears[3].style.draw_grayscale_picture)
      click(gears[3])
      assert.is_truthy(call("activate_paste"))
    end)

    it("does nothing when the row is gone since the window was drawn", function()
      local button = machine("[recipe=iron-gear-wheel]")
      button.tags = { block = "Nested sub-factories", entry = "gone", what = "machine" }
      click(button)
      button.tags = { block = "Another block", entry = "iron-gear-wheel", what = "machine" }
      click(button)
      assert.are.same({}, calls())
    end)

    it("ignores a click on a checkbox or a header", function()
      click(lines(window)[1][1])
      click(line_named(window, "Power")[1])
      assert.are.same({}, calls())
    end)
  end)

  it("shows a flying text for a machine the game lacks", function()
    fake_game.uninstall()
    boot({ ["bob-assembling-machine-6"] = true })
    deliver(fixture_text("small"))
    local _, window = open_window()
    click(lines(window)[2][3])
    assert.are.equal(
      "{fp-viewer.cannot-place|{fp-viewer.refused-unknown-entity}}",
      fake_game.flatten(call("create_local_flying_text")[2].text)
    )
    assert.is_nil(call("clear_cursor"))
  end)

  describe("a snapshot the GUI cannot draw", function()
    local gui_module, original_update, original_build

    before_each(function()
      gui_module = require("scripts.gui")
      original_update = gui_module.update
      original_build = require("lib.viewmodel").build
    end)
    after_each(function()
      gui_module.update = original_update
      require("lib.viewmodel").build = original_build
    end)

    it("logs a throwing view-model once and keeps the game running and the answers going", function()
      require("lib.viewmodel").build = function()
        error("cannot build")
      end
      deliver(fixture_text("small"))
      assert.has_no.errors(function()
        for t = 23, 100 do
          tick(t)
        end
      end)
      local failures = 0
      for _, line in ipairs(fake.logged) do
        if string.find(line, "refresh_gui failed", 1, true) then
          failures = failures + 1
        end
      end
      assert.are.equal(1, failures)
      -- The snapshot was still stored and acknowledged.
      assert.are.equal(ID, _G.storage.fp_viewer.stored.id)
      assert.is_truthy(string.find(fake.sent[#fake.sent].data, "FP01 A", 1, true))
    end)

    it("logs a throwing window update", function()
      open_window()
      gui_module.update = function()
        error("cannot draw")
      end
      deliver(fixture_text("small"))
      hear(support.ping("5555555555555555"), 1000)
      assert.has_no.errors(function()
        tick(1002)
        tick(1012)
        tick(1022)
      end)
      assert.is_true(#fake.logged >= 1)
    end)

    it("logs a throwing redraw after a GUI event, once", function()
      deliver(fixture_text("seablock-loop"))
      local _, window = open_window()
      local box = lines(window)[2][1]
      gui_module.update = function()
        error("cannot draw")
      end
      assert.has_no.errors(function()
        select_block(window, 2)
        check(box, true)
      end)
      local failures = 0
      for _, line in ipairs(fake.logged) do
        if string.find(line, "gui_update failed", 1, true) then
          failures = failures + 1
        end
      end
      assert.are.equal(1, failures)
    end)
  end)

  it("picks the stored snapshot up again after a load, ticks included", function()
    deliver(fixture_text("small"))
    local _, window = open_window()
    check(lines(window)[2][1], true)
    local kept = _G.storage
    fake_game.uninstall()
    fake = fake_game.install({})
    _G.storage = kept
    assert(loadfile("control.lua"))()
    -- No on_init: a load. The first ping is answered with the stored id.
    hear(support.ping(), 11)
    tick(12)
    assert.are.equal("FP01 H " .. ID .. " 0 " .. support.NO_ID, fake.sent[1].data)
    -- The window drawn after the load shows the tick.
    fake.handlers.on_player_joined_game({ player_index = 1 })
    _, window = open_window()
    assert.is_true(lines(window)[2][1].state)
  end)
end)
