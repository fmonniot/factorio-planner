-- Lua 5.2 is the Factorio runtime. The pure modules under lib/ use no game
-- globals; only control.lua, scripts/ and settings.lua see the game's, and each
-- gets exactly the ones it uses.
std = "lua52"
max_line_length = 120
exclude_files = { ".lua/**" }
files["spec/**"] = { std = "+busted", max_line_length = 200 }

local runtime = {
  read_globals = { "game", "script", "helpers", "prototypes", "settings", "defines", "log" },
  globals = { "storage" },
}
files["control.lua"] = runtime
files["scripts/**"] = runtime
-- The settings stage has only `data`.
files["settings.lua"] = { read_globals = { "data" } }
