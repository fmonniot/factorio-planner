-- Runtime entry point of the in-game viewer. Thin glue between the game API and
-- the pure modules in lib/ (see mod/README.md and
-- initiatives/in-game-viewer/protocol.md, "The mod"):
--
--   * every POLL_TICKS ticks, recv_udp (inside pcall) raises the packet events;
--   * the packet handler feeds the receiver, which only fills its answer slot;
--   * FLUSH_OFFSET ticks into the cycle, the slot is sent (inside pcall), so the
--     mod sends at most once per poll;
--   * the accepted snapshot lives in `storage`; everything else (reassembly,
--     slot, newest id, last-heard tick, mismatch flag) is plain Lua state that a
--     load simply starts empty.
--
-- The mod changes no prototype and no entity.
local C = require("lib.constants")
local format = require("lib.format")
local Receiver = require("lib.receiver")
local snapshot_lib = require("lib.snapshot")
local viewmodel = require("lib.viewmodel")
local gui = require("scripts.gui")

local SETTING_PORT = "fp-viewer-bridge-port"
local SETTING_DEBUG = "fp-viewer-debug"

-- ---------------------------------------------------------------------------
-- Plain Lua state. A load runs this file again, so all of it starts empty.

local receiver = nil -- created on first use: `storage` is not readable in the main chunk
local model_cache = nil -- { stored = <the stored table it was built from>, model = ... }
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
    storage.fp_viewer = { stored = nil, selected = {} }
  end
  return storage.fp_viewer
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
    model_cache = { stored = stored, model = viewmodel.build(stored.snapshot, { missing = missing }) }
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
-- the first block of that name, else the first block.
local function selected_for(player_index, model)
  if model == nil then
    return 1
  end
  local selections = state().selected
  local chosen = selections[player_index]
  local names = {}
  for i, block in ipairs(model.blocks) do
    names[i] = block.name
  end
  local index = format.reselect(names, chosen and chosen.index, chosen and chosen.name)
  if chosen == nil or chosen.index ~= index or chosen.name ~= names[index] then
    selections[player_index] = { index = index, name = names[index] }
  end
  return index
end

-- What the GUI needs to draw one player's window; `extra` adds fields.
local function context(player, indicator, model, extra)
  local ctx = { model = model, indicator = indicator, selected = selected_for(player.index, model) }
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

local function ensure_buttons()
  for _, player in pairs(game.players) do
    gui.ensure_button(player)
  end
end

-- ---------------------------------------------------------------------------
-- Events

script.on_init(function()
  state()
  ensure_buttons()
end)

-- Nothing to do on load: the plain state above starts empty, as the protocol
-- wants, and `storage` is not written here.

script.on_configuration_changed(function()
  state()
  ensure_buttons()
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

script.on_event(defines.events.on_gui_click, function(event)
  local element = event.element
  if element == nil or not element.valid then
    return
  end
  local player = game.get_player(event.player_index)
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
  else
    local index = format.parse_block_button(name)
    local model = get_model()
    if index ~= nil and model ~= nil and model.blocks[index] ~= nil then
      state().selected[player.index] = { index = index, name = model.blocks[index].name }
      local indicator = get_receiver():indicator(game.tick, game.speed)
      -- Only the selection changed: keep the list and its scroll position.
      gui.update(player, context(player, indicator, model, { only_selection = true, reset_scroll = true }))
    end
  end
end)

script.on_event(defines.events.on_player_removed, function(event)
  state().selected[event.player_index] = nil
end)

script.on_event(defines.events.on_gui_closed, function(event)
  local element = event.element
  if element ~= nil and element.valid and element.name == gui.WINDOW then
    element.destroy()
  end
end)
