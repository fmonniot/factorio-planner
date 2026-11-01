-- A stand-in for the parts of the Factorio runtime that control.lua and
-- scripts/gui.lua touch, so a spec can run them and catch typos, bad nesting and
-- nil indexing. It models only what the mod calls; it is NOT a check of the real
-- API (that is the manual checklist's job, mod/CHECKLIST.md).
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
  e.force_auto_center = function() end
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

-- A prototype set that has every id except those in `lacking`.
function M.prototype_set(kind, lacking)
  return setmetatable({}, {
    __index = function(_, id)
      if lacking[id] then
        return nil
      end
      return { name = id, localised_name = { kind .. "-name." .. id } }
    end,
  })
end

function M.player(index)
  local gui = { top = make_element({ type = "top" }), screen = make_element({ type = "screen" }) }
  return { index = index, gui = gui, opened = nil }
end

-- Installs the runtime globals; returns the fake with what a spec inspects.
-- `lacking`: ids the "running game" does not have.
function M.install(lacking)
  local fake = {
    handlers = {},
    sent = {},
    logged = {},
    players = { [1] = M.player(1) },
    send_fails = false,
    recv_fails = false,
    recv_calls = 0,
    settings = { ["fp-viewer-bridge-port"] = { value = 34199 }, ["fp-viewer-debug"] = { value = false } },
  }
  local events = {}
  for _, name in ipairs({ "on_tick", "on_udp_packet_received", "on_player_created", "on_player_joined_game", "on_gui_click", "on_gui_closed" }) do
    events[name] = name
  end

  _G.defines = { events = events }
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
    entity = M.prototype_set("entity", lacking),
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
  }
  return fake
end

function M.uninstall()
  for _, name in ipairs({ "defines", "storage", "log", "script", "settings", "prototypes", "helpers", "game" }) do
    _G[name] = nil
  end
  package.loaded["scripts.gui"] = nil
end

return M
