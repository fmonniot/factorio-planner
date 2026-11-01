-- A stand-in for the parts of the Factorio runtime that control.lua,
-- scripts/gui.lua and scripts/cursor.lua touch, so a spec can run them and catch
-- typos, bad nesting and nil indexing. It models only what the mod calls; it is
-- NOT a check of the real API (that is the manual checklist's job,
-- mod/CHECKLIST.md).
--
-- GUI elements keep every field they were added with (`tags`, `number`, `items`,
-- `selected_index`, `state`, `mouse_button_filter`, ...) as plain fields, and a
-- spec sets them the same way before raising an event. The cursor calls are
-- recorded in `fake.cursor` as { call, ... } entries, in order; a name in
-- `fake.raise` makes that call raise.
local support = require("spec.support")

local M = {}

local function make_element(args, parent)
  local e = { type = args.type, parent = parent, valid = true, children = {}, names = {} }
  local look = {} -- what `element.style.x = ...` writes to
  for k, v in pairs(args) do
    e[k] = v
  end
  e.add = function(child_args)
    local child = make_element(child_args, e)
    e.children[#e.children + 1] = child
    if child_args.name then
      e.names[child_args.name] = child
    end
    return child
  end
  e.destroy = function()
    e.valid = false
    if parent then
      for i, c in ipairs(parent.children) do
        if c == e then
          table.remove(parent.children, i)
          break
        end
      end
      if e.name then
        parent.names[e.name] = nil
      end
    end
  end
  e.clear = function()
    for _, c in ipairs(e.children) do
      c.valid = false
    end
    e.children, e.names = {}, {}
  end
  e.force_auto_center = function()
    e.centred = (e.centred or 0) + 1
  end
  e.scroll_to_top = function()
    e.scrolled_to_top = (e.scrolled_to_top or 0) + 1
  end
  return setmetatable(e, {
    __index = function(t, k)
      if k == "style" then
        return look
      end
      return rawget(t, "names")[k]
    end,
    -- Assigning a style name (a string) swaps the style, which this fake only
    -- records; the real element keeps accepting `style.x = ...` afterwards.
    __newindex = function(t, k, v)
      if k == "style" then
        look.name = v
      else
        rawset(t, k, v)
      end
    end,
  })
end

function M.root()
  return make_element({ type = "root" })
end

-- A caption as the plain text it would show: locale keys stay visible as
-- `{key|param|param}`, so a spec can look for them.
function M.flatten(caption)
  if type(caption) ~= "table" then
    return tostring(caption)
  end
  local parts = {}
  for i, part in ipairs(caption) do
    parts[i] = M.flatten(part)
  end
  if caption[1] == "" then
    return table.concat(parts, "", 2)
  end
  return "{" .. table.concat(parts, "|") .. "}"
end

-- All descendants of `e` (depth first) that satisfy `pred`.
function M.find(e, pred, out)
  out = out or {}
  for _, c in ipairs(e.children) do
    if pred(c) then
      out[#out + 1] = c
    end
    M.find(c, pred, out)
  end
  return out
end

function M.captions(e)
  local out = {}
  for _, c in ipairs(M.find(e, function(x)
    return x.caption ~= nil
  end)) do
    out[#out + 1] = M.flatten(c.caption)
  end
  return out
end

function M.any_caption(e, needle)
  for _, text in ipairs(M.captions(e)) do
    if string.find(text, needle, 1, true) then
      return true
    end
  end
  return false
end

-- A prototype set that has every id except those in `lacking`. Entities also
-- answer what scripts/cursor.lua reads: `type` (from `entities[id].type`, else an
-- assembling machine), `has_flag`, `items_to_place_this` (an item of the same
-- name, unless `entities[id].no_item`) and the tile size.
function M.prototype_set(kind, lacking, entities)
  return setmetatable({}, {
    __index = function(_, id)
      if lacking[id] then
        return nil
      end
      local proto = { name = id, localised_name = { kind .. "-name." .. id } }
      if kind == "entity" then
        local e = (entities and entities[id]) or {}
        local flags = e.flags or { ["player-creation"] = true }
        proto.type = e.type or "assembling-machine"
        proto.has_flag = function(flag)
          return flags[flag] == true
        end
        proto.items_to_place_this = (not e.no_item) and { { name = id, count = 1 } } or nil
        proto.tile_width = e.tile_width or 3
        proto.tile_height = e.tile_height or 3
      end
      return proto
    end,
  })
end

-- `fake` records the cursor calls (see the header); without it they are dropped.
function M.player(index, fake)
  local gui = { top = make_element({ type = "top" }), screen = make_element({ type = "screen" }) }
  local player = { index = index, gui = gui, opened = nil }
  local function record(call, ...)
    if fake == nil then
      return
    end
    fake.cursor[#fake.cursor + 1] = { call, ... }
    if fake.raise[call] then
      error(call .. " failed")
    end
  end
  player.clear_cursor = function()
    record("clear_cursor")
    return not (fake and fake.cursor_stuck)
  end
  player.add_to_clipboard = function(stack)
    record("add_to_clipboard", stack)
  end
  player.activate_paste = function()
    record("activate_paste")
  end
  player.create_local_flying_text = function(args)
    record("create_local_flying_text", args)
  end
  -- cursor_ghost is a property: writes are recorded through a proxy.
  return setmetatable(player, {
    __newindex = function(t, k, v)
      -- Not stored, so every write comes back here.
      if k == "cursor_ghost" then
        record("cursor_ghost", v)
      else
        rawset(t, k, v)
      end
    end,
  })
end

-- A script inventory of one stack, as game.create_inventory(1) gives.
local function inventory(fake)
  local function record(call, ...)
    fake.cursor[#fake.cursor + 1] = { call, ... }
    if fake.raise[call] then
      error(call .. " failed")
    end
  end
  local stack = {}
  stack.set_stack = function(spec)
    record("set_stack", spec)
    return true
  end
  stack.set_blueprint_entities = function(entities)
    record("set_blueprint_entities", entities)
  end
  local inv = { stack }
  inv.destroy = function()
    record("destroy")
    fake.inventories_open = fake.inventories_open - 1
  end
  fake.inventories_open = fake.inventories_open + 1
  return inv
end

-- Installs the runtime globals; returns the fake with what a spec inspects.
-- `lacking`: ids the "running game" does not have.
function M.install(lacking)
  local fake = {
    handlers = {},
    sent = {},
    logged = {},
    players = {},
    cursor = {}, -- the cursor calls, in order
    raise = {}, -- call name -> true: that call raises
    cursor_stuck = false, -- clear_cursor returns false
    inventories_open = 0, -- created and not destroyed
    entities = {}, -- id -> { type, flags, no_item, tile_width, tile_height }
    send_fails = false,
    recv_fails = false,
    recv_calls = 0,
    settings = { ["fp-viewer-bridge-port"] = { value = 34199 }, ["fp-viewer-debug"] = { value = false } },
  }
  fake.players[1] = M.player(1, fake)
  local events = {}
  for _, name in ipairs({
    "on_tick",
    "on_udp_packet_received",
    "on_player_created",
    "on_player_joined_game",
    "on_gui_click",
    "on_gui_selection_state_changed",
    "on_gui_checked_state_changed",
    "on_player_removed",
  }) do
    events[name] = name
  end

  -- Inventory numbers as in 2.0 (only the module ones are read).
  local inventories = { crafter_modules = 4, mining_drill_modules = 2, beacon_modules = 1 }
  _G.defines = { events = events, inventory = inventories }
  _G.storage = {}
  _G.log = function(message)
    fake.logged[#fake.logged + 1] = message
  end
  _G.script = {
    on_init = function(f)
      fake.handlers.on_init = f
    end,
    on_configuration_changed = function(f)
      fake.handlers.on_configuration_changed = f
    end,
    on_event = function(name, f)
      fake.handlers[name] = f
    end,
  }
  _G.settings = { global = fake.settings }
  _G.prototypes = {
    item = M.prototype_set("item", lacking),
    fluid = M.prototype_set("fluid", lacking),
    recipe = M.prototype_set("recipe", lacking),
    entity = M.prototype_set("entity", lacking, fake.entities),
  }
  _G.helpers = {
    json_to_table = support.json_to_table,
    is_valid_sprite_path = function()
      return true
    end,
    recv_udp = function()
      fake.recv_calls = fake.recv_calls + 1
      if fake.recv_fails then
        error("udp is not enabled")
      end
    end,
    send_udp = function(port, data)
      if fake.send_fails then
        error("udp is not enabled")
      end
      fake.sent[#fake.sent + 1] = { port = port, data = data }
    end,
  }
  _G.game = {
    tick = 0,
    speed = 1,
    players = fake.players,
    get_player = function(index)
      return fake.players[index]
    end,
    create_profiler = function()
      return { stop = function() end }
    end,
    create_inventory = function(size)
      fake.cursor[#fake.cursor + 1] = { "create_inventory", size }
      if fake.raise.create_inventory then
        error("create_inventory failed")
      end
      return inventory(fake)
    end,
  }
  return fake
end

function M.uninstall()
  for _, name in ipairs({ "defines", "storage", "log", "script", "settings", "prototypes", "helpers", "game" }) do
    _G[name] = nil
  end
  package.loaded["scripts.gui"] = nil
  package.loaded["scripts.cursor"] = nil
end

return M
