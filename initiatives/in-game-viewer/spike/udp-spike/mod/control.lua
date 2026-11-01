-- Throwaway spike (Phase 0 step 2). Datagram format: "<kind>|<field>|...\n<body>".
-- Controlled with /probe commands; results go to the chat, factorio-current.log and back over UDP.

local poll_every = 1 -- ticks between recv_udp calls; 0 = never
local use_for_player = false
local stats = { packets = 0, bytes = 0, first_tick = nil, last_tick = nil, bad = 0 }
local seqs = { seen = {}, count = 0, ooo = 0, dup = 0, last = -1, first_tick = nil, last_tick = nil }
local full = {} -- id -> { count, chunks = {}, got }
local last_report_tick = 0

local function port() return settings.global["udp-spike-echo-port"].value end

local function send(msg)
  if use_for_player then
    helpers.send_udp(port(), msg, 1)
  else
    helpers.send_udp(port(), msg)
  end
end

local function say(msg)
  game.print({ "", "[udp-spike] ", msg })
  log({ "", "[udp-spike] ", msg })
end

local function adler32(s)
  local a, b = 1, 0
  for i = 1, #s, 4096 do
    local bytes = { s:byte(i, math.min(i + 4095, #s)) }
    for j = 1, #bytes do
      a = (a + bytes[j]) % 65521
      b = (b + a) % 65521
    end
  end
  return b * 65536 + a
end

local function profiled(label, fn)
  local p = game.create_profiler()
  local r = fn()
  p.stop()
  say({ "", label .. ": ", p })
  return r
end

local function split_header(payload)
  local nl = payload:find("\n", 1, true)
  local head, body
  if nl then head, body = payload:sub(1, nl - 1), payload:sub(nl + 1) else head, body = payload, "" end
  local f = {}
  for part in (head .. "|"):gmatch("([^|]*)|") do f[#f + 1] = part end
  return f, body
end

local function missing_chunks(st)
  local m = {}
  for i = 0, st.count - 1 do if not st.chunks[i] then m[#m + 1] = i end end
  return m
end

local function finish_full(id, st)
  local m = missing_chunks(st)
  if #m > 0 then
    send("ack|" .. id .. "|missing|" .. table.concat(m, ","))
    return
  end
  local raw = table.concat(st.chunks, "", 0, st.count - 1)
  local sum = profiled("adler32 of " .. #raw .. " B", function() return adler32(raw) end)
  local decoded = profiled("json_to_table " .. #raw .. " B", function() return helpers.json_to_table(raw) end)
  if decoded == nil then
    send("ack|" .. id .. "|badjson|" .. #raw .. "|" .. sum)
    return
  end
  local blocks, rows = 0, 0
  if type(decoded.blocks) == "table" then
    for _, b in pairs(decoded.blocks) do
      blocks = blocks + 1
      if type(b.rows) == "table" then rows = rows + #b.rows end
    end
  end
  local back = profiled("table_to_json", function() return helpers.table_to_json(decoded) end)
  local enc = profiled("encode_string", function() return helpers.encode_string(raw) end)
  local dec = profiled("decode_string", function() return helpers.decode_string(enc) end)
  storage.snapshot = decoded -- exercises storage with a full-size table
  send(table.concat({ "ack", id, "ok", #raw, sum, blocks, rows, #back, #enc, tostring(dec == raw) }, "|"))
  full[id] = nil
end

local handlers = {}

local function echo_checksum(kind) return function(f, _, payload) send(table.concat({ kind, f[2], #payload, adler32(payload) }, "|")) end end
handlers.size = echo_checksum("size")
handlers.bin = echo_checksum("bin")

function handlers.ping(f, _, _, ev)
  send(table.concat({ "pong", f[2], ev.tick, game.tick }, "|"))
end

function handlers.seq(f, _, _, ev)
  local n = tonumber(f[2])
  if seqs.seen[n] then seqs.dup = seqs.dup + 1 else seqs.seen[n] = true; seqs.count = seqs.count + 1 end
  if n < seqs.last then seqs.ooo = seqs.ooo + 1 end
  if n > seqs.last then seqs.last = n end
  seqs.first_tick = seqs.first_tick or ev.tick
  seqs.last_tick = ev.tick
end

function handlers.seqend(f)
  send(table.concat({ "seqres", f[2], seqs.count, seqs.ooo, seqs.dup, seqs.first_tick or -1, seqs.last_tick or -1 }, "|"))
  seqs = { seen = {}, count = 0, ooo = 0, dup = 0, last = -1 }
end

function handlers.chunk(f, body)
  -- chunk|id|index|count|adler32(body)
  local id, idx, count = f[2], tonumber(f[3]), tonumber(f[4])
  if adler32(body) ~= tonumber(f[5]) then
    stats.bad = stats.bad + 1
    return
  end
  local st = full[id]
  if idx == 0 then say("chunk 0 of " .. count .. " received (" .. #body .. " B)") end
  if not st then st = { count = count, chunks = {}, got = 0 }; full[id] = st end
  if not st.chunks[idx] then st.chunks[idx] = body; st.got = st.got + 1 end
end

function handlers.chunkend(f) 
  local st = full[f[2]]
  if not st then send("ack|" .. f[2] .. "|missing|all") return end
  finish_full(f[2], st)
end

function handlers.reset()
  stats = { packets = 0, bytes = 0, bad = 0 }
  seqs = { seen = {}, count = 0, ooo = 0, dup = 0, last = -1 }
  full = {}
end

script.on_event(defines.events.on_udp_packet_received, function(ev)
  stats.packets = stats.packets + 1
  stats.bytes = stats.bytes + #ev.payload
  stats.first_tick = stats.first_tick or ev.tick
  stats.last_tick = ev.tick
  local f, body = split_header(ev.payload)
  local h = handlers[f[1]]
  if h then
    local ok, err = pcall(h, f, body, ev.payload, ev)
    if not ok then
      say("handler " .. f[1] .. " failed: " .. tostring(err))
      send("err|" .. f[1] .. "|" .. tostring(err):gsub("[\r\n|]", " "))
    end
  else
    say("no handler for kind " .. tostring(f[1]) .. " (" .. #ev.payload .. " B)")
  end
end)

script.on_event(defines.events.on_tick, function(ev)
  if poll_every > 0 and ev.tick % poll_every == 0 then
    if use_for_player then helpers.recv_udp(1) else helpers.recv_udp() end
  end
  if ev.tick % 600 == 0 then send("tick|" .. ev.tick .. "|" .. poll_every) end -- the echo derives UPS from these
end)

local function report()
  local s = table.concat({ "stats", stats.packets, stats.bytes, stats.first_tick or -1, stats.last_tick or -1, stats.bad }, "|")
  say(s)
  send(s)
end

commands.add_command("probe", "udp-spike: poll <n> | once | stats | reset | up <bytes...> | forplayer <on|off> | storage", function(c)
  local args = {}
  for w in (c.parameter or ""):gmatch("%S+") do args[#args + 1] = w end
  local cmd = args[1]
  if cmd == "poll" then
    poll_every = tonumber(args[2]) or 1
    say("poll every " .. poll_every .. " ticks")
  elseif cmd == "once" then
    helpers.recv_udp()
    say("recv_udp called at tick " .. game.tick .. "; run /probe stats in a second")
  elseif cmd == "stats" then
    report()
  elseif cmd == "reset" then
    handlers.reset()
    say("reset")
  elseif cmd == "up" then -- mod -> echo datagram of each requested size
    for i = 2, #args do
      local n = tonumber(args[i])
      local head = "up|" .. n .. "\n"
      send(head .. string.rep("u", math.max(0, n - #head)))
      say("sent up " .. n)
    end
  elseif cmd == "forplayer" then
    use_for_player = args[2] == "on"
    say("for_player " .. tostring(use_for_player))
  elseif cmd == "storage" then
    say("storage.snapshot is " .. (storage.snapshot and "present" or "absent"))
  elseif cmd == "sprite" then
    local paths = { "item/iron-plate", "recipe/iron-plate", "entity/assembling-machine-2" }
    for i = 2, #args do paths[#paths + 1] = args[i] end
    for _, p in ipairs(paths) do
      say(p .. " valid=" .. tostring(helpers.is_valid_sprite_path(p)))
    end
  else
    say("unknown command")
  end
end)
