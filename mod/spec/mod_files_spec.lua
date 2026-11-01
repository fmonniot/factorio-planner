-- Checks on the files that only the game loads (info.json, settings.lua, the
-- locale file and the GUI and cursor sources): nothing here starts the game, so
-- these specs catch the mistakes a text check can catch.
local C = require("lib.constants")
local support = require("spec.support")

local function read_locale()
  local text = support.read_file("locale/en/factorio-planner-viewer.cfg")
  local groups, current = {}, nil
  for line in string.gmatch(text, "[^\r\n]+") do
    local group = string.match(line, "^%[([%w%-_]+)%]$")
    if group then
      current = group
      groups[current] = groups[current] or {}
    else
      local k = string.match(line, "^([%w%-_]+)=")
      if k and current then
        groups[current][k] = true
      end
    end
  end
  return groups
end

describe("settings.lua", function()
  local settings = {}
  local fake_data = {
    extend = function(_, list)
      for _, s in ipairs(list) do
        settings[s.name] = s
      end
    end,
  }

  setup(function()
    -- Lua 5.2: the environment is the third argument of loadfile.
    local chunk = assert(loadfile("settings.lua", "t", { data = fake_data }))
    chunk()
  end)

  it("defaults the bridge port to the bridge's default", function()
    local port = settings["fp-viewer-bridge-port"]
    assert.are.equal("int-setting", port.type)
    assert.are.equal("runtime-global", port.setting_type)
    assert.are.equal(C.DEFAULT_BRIDGE_PORT, port.default_value)
    assert.are.equal(1, port.minimum_value)
    assert.are.equal(65535, port.maximum_value)
  end)

  it("has a runtime-global debug switch, off by default", function()
    local debug = settings["fp-viewer-debug"]
    assert.are.equal("bool-setting", debug.type)
    assert.are.equal("runtime-global", debug.setting_type)
    assert.is_false(debug.default_value)
  end)

  it("has a name and a description in the locale for each setting", function()
    local groups = read_locale()
    for name in pairs(settings) do
      assert.is_true(groups["mod-setting-name"][name], name .. " has no mod-setting-name")
      assert.is_true(groups["mod-setting-description"][name], name .. " has no mod-setting-description")
    end
  end)
end)

describe("data.lua", function()
  local prototypes = {}
  local fake_data = {
    extend = function(_, list)
      for _, p in ipairs(list) do
        prototypes[#prototypes + 1] = p
      end
    end,
  }

  setup(function()
    local chunk = assert(loadfile("data.lua", "t", { data = fake_data, ipairs = ipairs }))
    chunk()
  end)

  it("adds the one sprite the button shows, and nothing else", function()
    assert.are.equal(1, #prototypes)
    local sprite = prototypes[1]
    assert.are.equal("sprite", sprite.type)
    package.preload["mod-gui"] = function()
      return {}
    end
    assert.are.equal(require("scripts.gui").SPRITE, sprite.name)
    package.preload["mod-gui"] = nil
    package.loaded["mod-gui"] = nil
    assert.are.same({ "gui-icon" }, sprite.flags)
    package.loaded["scripts.gui"] = nil
  end)

  it("has its image, at the size it says", function()
    local sprite = prototypes[1]
    local file = string.match(sprite.filename, "^__factorio%-planner%-viewer__/(.+)$")
    assert.is_string(file, sprite.filename .. " is not in this mod")
    local png = support.read_file(file)
    assert.are.equal("\137PNG", string.sub(png, 1, 4), file .. " is not a PNG")
    -- The IHDR chunk holds the width and the height as big-endian 32-bit numbers.
    local a, b, c, d, e, f, g, h = string.byte(png, 17, 24)
    local width, height = ((a * 256 + b) * 256 + c) * 256 + d, ((e * 256 + f) * 256 + g) * 256 + h
    assert.are.equal(sprite.size, width, file)
    assert.are.equal(sprite.size, height, file)
  end)
end)

describe("info.json", function()
  local info = support.read_json("info.json")

  it("pins Factorio 2.0 and depends on base", function()
    assert.are.equal("2.0", info.factorio_version)
    assert.are.same({ "base", "? flib" }, info.dependencies)
  end)

  it("has the mandatory fields, with a three-number version", function()
    assert.are.equal("factorio-planner-viewer", info.name)
    assert.is_truthy(string.match(info.version, "^%d+%.%d+%.%d+$"))
    assert.is_truthy(info.title)
    assert.is_truthy(info.author)
  end)
end)

describe("the Lua sources", function()
  it("call require only while the file loads: the game refuses it afterwards", function()
    local files = { "control.lua", "scripts/gui.lua", "scripts/cursor.lua" }
    for _, name in ipairs({ "blueprint", "constants", "datagram", "format", "layout", "progress", "receiver", "snapshot", "viewmodel" }) do
      files[#files + 1] = "lib/" .. name .. ".lua"
    end
    for _, file in ipairs(files) do
      for line in string.gmatch(support.read_file(file), "[^\r\n]+") do
        if string.find(line, "require%(") and string.find(line, "^%s") then
          error(file .. " calls require inside a function: " .. line)
        end
      end
    end
  end)
end)

describe("the locale file", function()
  local groups = read_locale()

  it("has every key the Lua sources ask for", function()
    local used = {}
    for _, file in ipairs({ "control.lua", "scripts/gui.lua", "scripts/cursor.lua", "lib/format.lua" }) do
      local text = support.read_file(file)
      for k in string.gmatch(text, 'key%("([%w%-_]+)"%)') do
        used[k] = file
      end
      for k in string.gmatch(text, '"fp%-viewer%.([%w%-_]+)"') do
        used[k] = file
      end
    end
    local count = 0
    for k, file in pairs(used) do
      count = count + 1
      assert.is_true(groups["fp-viewer"][k], "locale key fp-viewer." .. k .. " (used in " .. file .. ") is missing")
    end
    assert.is_true(count > 20, "the scan found suspiciously few keys")
  end)

  it("has a flying text for every reason lib/blueprint.lua refuses with", function()
    local reasons = require("scripts.cursor").REASONS
    local count = 0
    for reason in string.gmatch(support.read_file("lib/blueprint.lua"), 'refused%("([%w%-_]+)"%)') do
      count = count + 1
      assert.is_string(reasons[reason], "no flying text for the refusal " .. reason)
      assert.is_true(groups["fp-viewer"][string.match(reasons[reason], "^fp%-viewer%.(.+)$")])
    end
    assert.is_true(count >= 8, "the scan found suspiciously few refusals")
    package.loaded["scripts.cursor"] = nil
  end)

  it("has a key for every indicator, synthetic kind and id kind", function()
    for _, indicator in ipairs({ "disconnected", "mismatch", "stale" }) do
      assert.is_true(groups["fp-viewer"]["indicator-" .. indicator])
    end
    for _, kind in ipairs({ "mining", "offshore", "power", "item", "fluid", "recipe", "machine" }) do
      assert.is_true(groups["fp-viewer"]["kind-" .. kind])
    end
  end)
end)
