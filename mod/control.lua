-- Runtime entry point of the in-game viewer. Thin glue between the game API and
-- the pure modules in lib/ (see mod/README.md and
-- spec/in-game-viewer-protocol.md, "The mod"):
--
--   * every POLL_TICKS ticks, recv_udp (inside pcall) raises the packet events;
--   * the packet handler feeds the receiver, which only fills its answer slot;
--   * FLUSH_OFFSET ticks into the cycle, the slot is sent (inside pcall), so the
--     mod sends at most once per poll;
--   * the accepted snapshot, the players' selected blocks and the "built" ticks
--     live in `storage`; everything else (reassembly, slot, newest id, last-heard
--     tick, mismatch flag) is plain Lua state that a load simply starts empty.
--
-- The mod's one prototype is the sprite of its button (data.lua) and it changes no
-- entity; a click on a building only fills the player's cursor (scripts/cursor.lua).
local C = require("lib.constants")
local format = require("lib.format")
local progress = require("lib.progress")
local Receiver = require("lib.receiver")
local snapshot_lib = require("lib.snapshot")
local viewmodel = require("lib.viewmodel")
local cursor = require("scripts.cursor")
local gui = require("scripts.gui")

local SETTING_PORT = "fp-viewer-bridge-port"
local SETTING_DEBUG = "fp-viewer-debug"

-- ---------------------------------------------------------------------------
-- Plain Lua state. A load runs this file again, so all of it starts empty.

local receiver = nil -- created on first use: `storage` is not readable in the main chunk
local model_cache = nil -- { stored = <the stored table it was built from>, model = ..., generation = ... }
local model_generation = 0 -- counts the models built; the GUI keeps its header only for the one it drew
local ui_dirty = true -- the windows need a rebuild (a load leaves old content in them)
local last_indicator = false -- false differs from every indicator, nil included
local logged = {} -- log lines already written, so a failing call logs once

local function log_once(tag, err)
  if not logged[tag] then
    logged[tag] = true
    log("[factorio-planner-viewer] " .. tag .. " failed: " .. tostring(err))
  end
end

-- ---------------------------------------------------------------------------
-- Storage

-- Never called from on_load, where `storage` may be read but not written.
local function state()
  if storage.fp_viewer == nil then
    storage.fp_viewer = { stored = nil, selected = {}, done = {} }
  end
  return storage.fp_viewer
end

-- The "built" ticks, done[block_key][row_key] (lib/progress.lua): one set for the
-- save, not per player, kept through new snapshots. Created on first use, so a
-- save made before it existed gets it then (never from on_load).
local function done()
  local s = state()
  if s.done == nil then
    s.done = {}
  end
  return s.done
end

-- ---------------------------------------------------------------------------
-- The receiver

-- True when the running game has the prototype of that kind.
local exists = {
  item = function(id)
    return prototypes.item[id] ~= nil
  end,
  fluid = function(id)
    return prototypes.fluid[id] ~= nil
  end,
  recipe = function(id)
    return prototypes.recipe[id] ~= nil
  end,
  machine = function(id)
    return prototypes.entity[id] ~= nil
  end,
}

local function get_receiver()
  if receiver == nil then
    receiver = Receiver.new({
      decode_json = function(text)
        return helpers.json_to_table(text)
      end,
      count_unknown = function(snapshot)
        local count = snapshot_lib.find_missing(snapshot, exists)
        return count
      end,
      stored = state().stored,
      on_store = function(stored)
        state().stored = stored
        model_cache = nil
        ui_dirty = true
      end,
    })
  end
  return receiver
end

-- What the GUI draws; rebuilt only when the stored snapshot (or the mod set,
-- through on_store) changes.
local function get_model()
  local stored = get_receiver().stored
  if stored == nil then
    return nil
  end
  if model_cache == nil or model_cache.stored ~= stored then
    local _, missing = snapshot_lib.find_missing(stored.snapshot, exists)
    model_generation = model_generation + 1
    model_cache = {
      stored = stored,
      model = viewmodel.build(stored.snapshot, { missing = missing }),
      generation = model_generation,
    }
  end
  return model_cache.model
end

-- ---------------------------------------------------------------------------
-- UDP

local function bridge_port()
  local port = settings.global[SETTING_PORT].value
  if type(port) ~= "number" or port < 1 or port > 65535 or port % 1 ~= 0 then
    return C.DEFAULT_BRIDGE_PORT
  end
  return port
end

local function poll()
  -- Without --enable-lua-udp the call does nothing (or raises); either way the
  -- mod carries on and shows Disconnected.
  local ok, err = pcall(function()
    helpers.recv_udp()
  end)
  if not ok then
    log_once("recv_udp", err)
  end
end

local function flush()
  local text = get_receiver():take_answer()
  if text == nil then
    return
  end
  local timer = settings.global[SETTING_DEBUG].value and game.create_profiler() or nil
  local port = bridge_port()
  local ok, err = pcall(function()
    helpers.send_udp(port, text)
  end)
  if not ok then
    log_once("send_udp", err)
  end
  if timer ~= nil then
    timer.stop()
    log({ "", "[factorio-planner-viewer] send_udp ", string.sub(text, 1, 8), " took ", timer })
  end
end

-- ---------------------------------------------------------------------------
-- GUI

-- The block a player has selected, kept through a new snapshot by name (the
-- snapshot has no block ids): the same position if it still holds that name, else
-- the first block of that name, else the first block. Also returns the key of the
-- sub-factory the player has open in it (nil: the block's top level), kept while
-- the block of that name still has it.
local function selected_for(player_index, model)
  if model == nil then
    return 1, nil
  end
  local selections = state().selected
  local chosen = selections[player_index]
  local names = {}
  for i, block in ipairs(model.blocks) do
    names[i] = block.name
  end
  local index = format.reselect(names, chosen and chosen.index, chosen and chosen.name)
  local level = chosen and chosen.name == names[index] and chosen.level or nil
  local block = model.blocks[index]
  local entry = level and block and block.by_key[level]
  if entry == nil or entry.type ~= "group" then
    level = nil
  end
  if chosen == nil or chosen.index ~= index or chosen.name ~= names[index] or chosen.level ~= level then
    selections[player_index] = { index = index, name = names[index], level = level }
  end
  return index, level
end

-- What the GUI needs to draw one player's window; `extra` adds fields.
local function context(player, indicator, model, extra)
  local selected, level = selected_for(player.index, model)
  local ctx = {
    model = model,
    generation = model_cache and model_cache.generation,
    indicator = indicator,
    selected = selected,
    level = level,
    done = done(),
  }
  for k, v in pairs(extra or {}) do
    ctx[k] = v
  end
  return ctx
end

local function update_player(player, indicator, model)
  gui.update(player, context(player, indicator, model))
end

-- Rebuilds the windows when the snapshot changed or the indicator did.
local function refresh_gui(tick)
  local indicator = get_receiver():indicator(tick, game.speed)
  if not ui_dirty and indicator == last_indicator then
    return
  end
  ui_dirty = false
  last_indicator = indicator
  local model = get_model()
  for _, player in pairs(game.players) do
    update_player(player, indicator, model)
  end
end

-- ---------------------------------------------------------------------------
-- Events

script.on_init(function()
  state()
end)

-- Nothing to do on load: the plain state above starts empty, as the protocol
-- wants, and `storage` is not written here.

script.on_configuration_changed(function()
  state()
  -- A changed mod set changes which ids exist, so the unknown-id count is
  -- recomputed (this calls on_store, which marks the GUI dirty).
  local ok, err = pcall(function()
    get_receiver():recompute_unknown()
  end)
  if not ok then
    log_once("recompute_unknown", err)
  end
  ui_dirty = true
end)

script.on_event(defines.events.on_tick, function(event)
  local phase = event.tick % C.POLL_TICKS
  if phase == 0 then
    poll()
  elseif phase == C.FLUSH_OFFSET then
    -- A failure here must not repeat every 10 ticks, or come back with every
    -- load of a save that holds the snapshot that causes it.
    local sent, send_err = pcall(flush)
    if not sent then
      log_once("flush", send_err)
    end
    local drawn, draw_err = pcall(refresh_gui, event.tick)
    if not drawn then
      log_once("refresh_gui", draw_err)
    end
  end
end)

script.on_event(defines.events.on_udp_packet_received, function(event)
  -- A bug in the receiver must not crash the game over a stray packet.
  local ok, err = pcall(function()
    get_receiver():on_datagram(event.payload, event.tick)
  end)
  if not ok then
    log_once("on_datagram", err)
  end
end)

local function on_player_added(event)
  local player = game.get_player(event.player_index)
  if player ~= nil then
    gui.ensure_button(player)
    -- The player may have a window left from before a load.
    ui_dirty = true
  end
end

script.on_event(defines.events.on_player_created, on_player_added)
script.on_event(defines.events.on_player_joined_game, on_player_added)

-- Redraws one player's window after a GUI event; `extra` as in context(). A
-- failure is logged once and leaves the game running.
local function redraw(player, extra)
  local ok, err = pcall(function()
    local indicator = get_receiver():indicator(game.tick, game.speed)
    gui.update(player, context(player, indicator, get_model(), extra))
  end)
  if not ok then
    log_once("gui_update", err)
  end
end

-- The block and the entry an element's tags point at in the current view-model;
-- nil when they are gone (a new snapshot since the window was drawn) or are not
-- ours.
local function tagged(element)
  local block_key, entry_key, what = format.parse_tags(element.tags)
  if block_key == nil then
    return nil
  end
  local model = get_model()
  if model == nil then
    return nil
  end
  for _, block in ipairs(model.blocks) do
    if block.key == block_key then
      local entry = block.by_key[entry_key]
      if entry == nil then
        return nil
      end
      return block, entry, what
    end
  end
  return nil
end

local function event_player(event)
  local element = event.element
  if element == nil or not element.valid then
    return nil
  end
  return game.get_player(event.player_index), element
end

-- Shows a sub-factory of a block (nil: its top level) in the player's whole
-- window, from the top of its table.
local function show_level(player, block, level)
  state().selected[player.index] = { index = block.index, name = block.name, level = level }
  redraw(player, { only_table = true, reset_scroll = true })
end

script.on_event(defines.events.on_gui_click, function(event)
  local player, element = event_player(event)
  if player == nil then
    return
  end

  local name = element.name
  if name == gui.BUTTON then
    local model = get_model()
    local indicator = get_receiver():indicator(game.tick, game.speed)
    gui.toggle(player, context(player, indicator, model))
  elseif name == gui.CLOSE then
    gui.close(player)
  elseif name == format.LEVEL_UP then
    -- Up from the sub-factory shown, to the one it is in or the block's top level.
    local model = get_model()
    if model == nil then
      return
    end
    local index, level = selected_for(player.index, model)
    local block = model.blocks[index]
    local entry = block and level and block.by_key[level]
    if entry ~= nil then
      show_level(player, block, entry.parent)
    end
  else
    local block, entry, what = tagged(element)
    if what == format.TAG_OPEN then
      -- A sub-factory's icon: the whole window shows that sub-factory.
      if entry.type == "group" then
        show_level(player, block, entry.key)
      end
      return
    end
    -- A machine or a beacon: into the cursor. The window stays open.
    if entry == nil or entry.type ~= "row" or (what ~= format.TAG_MACHINE and what ~= format.TAG_BEACON) then
      return
    end
    local ok, err = pcall(cursor.place, player, entry.row, what)
    if not ok then
      log_once("cursor", err)
      pcall(cursor.refuse, player, "failed")
    end
  end
end)

-- The block drop-down: draw the chosen block's table, scrolled to the top.
script.on_event(defines.events.on_gui_selection_state_changed, function(event)
  local player, element = event_player(event)
  if player == nil or element.name ~= format.BLOCK_DROPDOWN then
    return
  end
  local model = get_model()
  local index = element.selected_index
  if model == nil or model.blocks[index] == nil then
    return
  end
  state().selected[player.index] = { index = index, name = model.blocks[index].name }
  redraw(player, { only_table = true, reset_scroll = true })
end)

-- A "built" checkbox: a row's or a sub-factory's (every row under it). The table
-- is redrawn so the derived checkboxes and the grayscale follow; its scroll
-- position stays.
script.on_event(defines.events.on_gui_checked_state_changed, function(event)
  local player, element = event_player(event)
  if player == nil then
    return
  end
  local block, entry, what = tagged(element)
  if what ~= format.TAG_CHECK then
    -- Not ours, or its block or row is gone: the redraw puts the box back.
    if format.parse_tags(element.tags) ~= nil then
      redraw(player, { only_table = true })
    end
    return
  end
  local keys
  if entry.type == "group" then
    keys = entry.keys
  else
    keys = { entry.key }
  end
  progress.set_all(done(), block.key, keys, element.state == true)
  redraw(player, { only_table = true })
end)

-- The window's width and place follow the screen.
local function on_screen_changed(event)
  local player = game.get_player(event.player_index)
  if player == nil then
    return
  end
  local ok, err = pcall(function()
    local indicator = get_receiver():indicator(game.tick, game.speed)
    gui.reopen(player, context(player, indicator, get_model()))
  end)
  if not ok then
    log_once("gui_update", err)
  end
end

script.on_event(defines.events.on_player_display_resolution_changed, on_screen_changed)
script.on_event(defines.events.on_player_display_scale_changed, on_screen_changed)

script.on_event(defines.events.on_player_removed, function(event)
  state().selected[event.player_index] = nil
end)
