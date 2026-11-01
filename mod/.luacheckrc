-- Lua 5.2 is the Factorio runtime. The pure modules under lib/ use no game
-- globals; control.lua and the GUI (a later change) add theirs here.
std = "lua52"
max_line_length = 120
exclude_files = { ".lua/**" }
files["spec/**"] = { std = "+busted", max_line_length = 200 }
