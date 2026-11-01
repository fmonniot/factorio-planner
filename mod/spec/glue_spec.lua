-- Runs control.lua and scripts/gui.lua against a fake runtime (spec/fake_game.lua).
-- This catches plain Lua mistakes in the glue; it does not check the real Factorio
-- API, which only the manual checklist (mod/CHECKLIST.md) can.
local fake_game = require("spec.fake_game")
local support = require("spec.support")
local viewmodel = require("lib.viewmodel")
local snapshot_lib = require("lib.snapshot")

local ID = "1111111111111111"

local function fixture_text(name)
  return support.read_file(support.CONTRACT .. "/fixtures/" .. name .. ".json")
end

local function everything_exists()
  return support.exists_except({})
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
    gui.open(player)
    local _, missing = snapshot_lib.find_missing(snapshot, opts.exists or everything_exists())
    gui.update(player, {
      model = viewmodel.build(snapshot, { missing = missing }),
      indicator = opts.indicator,
      selected = opts.selected or 1,
    })
    return player, player.gui.screen[gui.WINDOW]
  end

  it("adds the top-bar button once", function()
    local player = fake.players[1]
    gui.ensure_button(player)
    gui.ensure_button(player)
    assert.are.equal(1, #player.gui.top.children)
  end)

  it("opens a window with a close button, and toggles it away", function()
    local player = fake.players[1]
    gui.toggle(player)
    assert.is_true(gui.is_open(player))
    assert.is_truthy(player.gui.screen[gui.WINDOW].children[1].children[3].name == gui.CLOSE)
    assert.are.equal(player.gui.screen[gui.WINDOW], player.opened)
    gui.toggle(player)
    assert.is_false(gui.is_open(player))
  end)

  for _, name in ipairs(support.list_snapshot_fixtures()) do
    it("draws every block of " .. name .. " and the first one's details", function()
      local snapshot = support.json_to_table(fixture_text(name))
      local _, window = show(snapshot)
      local buttons = fake_game.find(window, function(e)
        return e.type == "button" and e.name ~= nil
      end)
      assert.are.equal(#snapshot.blocks, #buttons)
      assert.is_true(fake_game.any_caption(window, snapshot.blocks[1].name))
    end)

    it("draws every block of " .. name .. " as the selected one", function()
      local snapshot = support.json_to_table(fixture_text(name))
      for i = 1, #snapshot.blocks do
        local _, window = show(snapshot, { selected = i })
        assert.is_true(fake_game.any_caption(window, snapshot.blocks[i].name))
        fake_game.uninstall()
        fake = fake_game.install({})
        gui = require("scripts.gui")
      end
    end)
  end

  it("draws a non-ASCII block name as it is", function()
    local snapshot = support.json_to_table(fixture_text("unicode"))
    local _, window = show(snapshot)
    for _, block in ipairs(snapshot.blocks) do
      assert.is_true(fake_game.any_caption(window, block.name))
    end
  end)

  it("lists the ids the game lacks instead of hiding them", function()
    fake_game.uninstall()
    local snapshot = support.json_to_table(fixture_text("small"))
    local lacking = { ["iron-gear-wheel"] = true, ["bob-assembling-machine-6"] = true }
    fake = fake_game.install(lacking)
    gui = require("scripts.gui")
    local _, window = show(snapshot, { exists = support.exists_except(lacking) })
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.missing-heading|"))
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.kind-item}: iron-gear-wheel"))
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.kind-machine}: bob-assembling-machine-6"))
    -- The row names the missing machine as text, not as a rich-text tag.
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.missing-id|bob-assembling-machine-6}"))
    assert.is_false(fake_game.any_caption(window, "[entity=bob-assembling-machine-6]"))
  end)

  it("shows a synthetic row with no product as unknown", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    snapshot.blocks[1].rows[1] = { kind = "mining", machines = 1, machinesCeil = 1 }
    local _, window = show(snapshot)
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.unknown-row|{fp-viewer.kind-mining}}"))
  end)

  it("shows the indicator in the window and the button's tooltip", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    for _, indicator in ipairs({ "disconnected", "mismatch", "stale" }) do
      local player, window = show(snapshot, { indicator = indicator })
      assert.is_true(fake_game.any_caption(window, "{fp-viewer.indicator-" .. indicator))
      assert.is_true(string.find(fake_game.flatten(player.gui.top[gui.BUTTON].tooltip), indicator, 1, true) ~= nil)
      fake_game.uninstall()
      fake = fake_game.install({})
      gui = require("scripts.gui")
    end
  end)

  it("says so when no plan has arrived", function()
    local player = fake.players[1]
    gui.open(player)
    gui.update(player, { model = nil, indicator = "disconnected", selected = 1 })
    assert.is_true(fake_game.any_caption(player.gui.screen[gui.WINDOW], "{fp-viewer.no-plan}"))
  end)

  it("clamps a selection past the end", function()
    local snapshot = support.json_to_table(fixture_text("small"))
    local _, window = show(snapshot, { selected = 99 })
    assert.is_true(fake_game.any_caption(window, snapshot.blocks[#snapshot.blocks].name))
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

  before_each(function()
    fake = fake_game.install({})
    assert(loadfile("control.lua"))()
    fake.handlers.on_init()
    fake.handlers.on_player_created({ player_index = 1 })
  end)
  after_each(function()
    fake_game.uninstall()
  end)

  local function deliver(text)
    hear(support.probe(ID, 1, #text), 11)
    tick(12)
    hear(support.chunk(ID, 0, 1, #text, text), 21)
    tick(22)
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
    fake = fake_game.install({ ["iron-gear-wheel"] = true })
    assert(loadfile("control.lua"))()
    fake.handlers.on_init()
    deliver(fixture_text("small"))
    assert.are.equal(2, _G.storage.fp_viewer.stored.unknown_ids) -- the item and the recipe
    assert.are.equal("FP01 A " .. ID .. " 2", fake.sent[#fake.sent].data)
  end)

  it("builds the window after a delivery, and a click selects a block", function()
    local snapshot = support.json_to_table(fixture_text("seablock-areas"))
    deliver(fixture_text("seablock-areas"))
    local player = fake.players[1]
    fake.handlers.on_gui_click({ element = player.gui.top["fp_viewer_button"], player_index = 1 })
    local window = player.gui.screen["fp_viewer_window"]
    assert.is_truthy(window)
    assert.is_true(fake_game.any_caption(window, snapshot.blocks[1].name))

    local last = #snapshot.blocks
    local buttons = fake_game.find(window, function(e)
      return e.type == "button" and string.find(e.name or "", "^fp_viewer_block_") ~= nil
    end)
    assert.are.equal(last, #buttons)
    fake.handlers.on_gui_click({ element = buttons[last], player_index = 1 })
    assert.are.equal(last, _G.storage.fp_viewer.selected[1])
    window = player.gui.screen["fp_viewer_window"]
    assert.is_true(fake_game.any_caption(window, snapshot.blocks[last].name))
  end)

  it("shows Disconnected after the silence, and clears it when the bridge speaks", function()
    local player = fake.players[1]
    fake.handlers.on_gui_click({ element = player.gui.top["fp_viewer_button"], player_index = 1 })
    tick(12)
    local window = player.gui.screen["fp_viewer_window"]
    assert.is_true(fake_game.any_caption(window, "{fp-viewer.indicator-disconnected"))
    hear(support.ping(), 21)
    tick(22)
    window = player.gui.screen["fp_viewer_window"]
    assert.is_false(fake_game.any_caption(window, "{fp-viewer.indicator-disconnected"))
  end)

  it("closes the window when the game says the player closed it", function()
    local player = fake.players[1]
    fake.handlers.on_gui_click({ element = player.gui.top["fp_viewer_button"], player_index = 1 })
    fake.handlers.on_gui_closed({ element = player.gui.screen["fp_viewer_window"] })
    assert.is_nil(player.gui.screen["fp_viewer_window"])
  end)

  it("picks the stored snapshot up again after a load", function()
    deliver(fixture_text("small"))
    local kept = _G.storage
    fake_game.uninstall()
    fake = fake_game.install({})
    _G.storage = kept
    assert(loadfile("control.lua"))()
    -- No on_init: a load. The first ping is answered with the stored id.
    hear(support.ping(), 11)
    tick(12)
    assert.are.equal("FP01 H " .. ID .. " 0 " .. support.NO_ID, fake.sent[1].data)
  end)
end)
