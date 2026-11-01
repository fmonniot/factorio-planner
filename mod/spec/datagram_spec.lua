local datagram = require("lib.datagram")
local support = require("spec.support")

local messages = support.read_json(support.CONTRACT .. "/datagrams/messages.json")
local malformed = support.read_json(support.CONTRACT .. "/datagrams/malformed.json")

local function ranges_string(ranges)
  if #ranges == 0 then
    return "-"
  end
  local entries = {}
  for i, r in ipairs(ranges) do
    entries[i] = (r[1] == r[2]) and tostring(r[1]) or (r[1] .. "-" .. r[2])
  end
  return table.concat(entries, ",")
end

describe("datagram.decode", function()
  describe("the shared messages the mod receives", function()
    for _, m in ipairs(messages.messages) do
      if m.link == "udp" and m.to == "mod" then
        it("decodes " .. m.name, function()
          local d = datagram.decode(support.from_hex(m.hex))
          assert.is_table(d)
          assert.are.equal(m.type == "end-of-window" and "eow" or m.type, d.type)
          local f = m.fields
          if d.type == "ping" then
            assert.are.equal(f.newest, d.newest)
          elseif d.type == "probe" then
            assert.are.same({ f.id, f.count, f.bytes }, { d.id, d.count, d.bytes })
          elseif d.type == "chunk" then
            assert.are.same({ f.id, f.index, f.count, f.bytes }, { d.id, d.index, d.count, d.bytes })
            assert.are.equal(f.payloadBytes, #d.payload)
          else
            assert.are.same({ f.id, f.round, f.upto }, { d.id, tonumber(d.round), d.upto })
          end
        end)
      end
    end
  end)

  describe("the shared datagrams a mod must drop", function()
    for _, m in ipairs(malformed.inputs) do
      if m.reader == "mod" then
        it("drops: " .. m.why, function()
          assert.is_nil(datagram.decode(support.from_hex(m.hex)))
        end)
      end
    end
  end)

  it("reads only the first 6 bytes of a datagram of another version", function()
    local d = datagram.decode("FP02 H 5 any other layout, never read")
    assert.are.same({ type = "other_version", version = 2 }, d)
    assert.are.same({ type = "other_version", version = 2 }, datagram.decode("FP02 Z"))
    assert.are.same({ type = "other_version", version = 0 }, datagram.decode("FP00 P"))
  end)

  it("takes a payload of NUL and high bytes without looking at it", function()
    local payload = "\0\255\128{\"" .. string.rep("\0", 20)
    local d = datagram.decode("FP01 C 0123456789abcdef 0000 0001 0000030 " .. payload)
    assert.are.equal(payload, d.payload)
  end)

  it("accepts a chunk of exactly CHUNK_PAYLOAD bytes and a probe of any length from 37 up", function()
    local chunk = "FP01 C 0123456789abcdef 0000 0001 0008000 " .. string.rep("x", 8000)
    assert.is_table(datagram.decode(chunk))
    local probe = "FP01 W 0123456789abcdef 0001 0000586 "
    assert.is_table(datagram.decode(probe))
    assert.is_table(datagram.decode(probe .. string.rep(".", 8005)))
    assert.is_table(datagram.decode(probe .. string.rep(".", 10)))
  end)

  it("accepts the boundaries MAX_CHUNKS and MAX_SNAPSHOT_BYTES", function()
    local d = datagram.decode("FP01 C 0123456789abcdef 0999 1000 8000000 x")
    assert.are.same({ 999, 1000, 8000000 }, { d.index, d.count, d.bytes })
    assert.is_nil(datagram.decode("FP01 C 0123456789abcdef 0000 1001 8000000 x"))
    assert.is_nil(datagram.decode("FP01 C 0123456789abcdef 0000 1000 8000001 x"))
  end)

  it("drops non-string input", function()
    assert.is_nil(datagram.decode(nil))
    assert.is_nil(datagram.decode(42))
  end)
end)

describe("datagram encoders", function()
  for _, m in ipairs(messages.messages) do
    if m.link == "udp" and m.from == "mod" and m.fields.protocol == 1 then
      it("encodes " .. m.name, function()
        local f = m.fields
        local out
        if m.type == "hello" then
          out = datagram.hello(f.stored, f.unknownIds, f.assembling)
        elseif m.type == "ready" then
          out = datagram.ready(f.id)
        elseif m.type == "missing" then
          out = datagram.missing(f.id, string.format("%04d", f.round), ranges_string(f.missing))
        elseif m.type == "ack" then
          out = datagram.ack(f.id, f.unknownIds)
        elseif m.type == "nack" then
          out = datagram.nack(f.id, f.reason)
        end
        assert.are.equal(m.hex, support.to_hex(out))
      end)
    end
  end

  it("saturates the unknown-id count at MAX_UNKNOWN_IDS", function()
    assert.are.equal("FP01 A 0123456789abcdef 9999", datagram.ack("0123456789abcdef", 123456))
    assert.are.equal("FP01 H 0123456789abcdef 9999 ----------------", datagram.hello("0123456789abcdef", 10000, nil))
  end)

  it("sends a count of 0 in a hello with nothing stored", function()
    assert.are.equal("FP01 H ---------------- 0 ----------------", datagram.hello(nil, 7, nil))
  end)
end)

describe("datagram.missing_ranges", function()
  local function held(...)
    local set = {}
    for _, i in ipairs({ ... }) do
      set[i] = true
    end
    return set
  end

  it("is - when nothing below upto is missing", function()
    assert.are.equal("-", datagram.missing_ranges(held(0, 1, 2), 3))
  end)

  it("joins runs of two or more as first-last and leaves singles bare", function()
    assert.are.equal("1,3-5,9", datagram.missing_ranges(held(0, 2, 6, 7, 8), 10))
  end)

  it("ignores chunks at or above upto", function()
    assert.are.equal("-", datagram.missing_ranges(held(0), 1))
    assert.are.equal("1-2", datagram.missing_ranges(held(0), 3))
  end)

  it("reports a whole lost window as one range", function()
    assert.are.equal("0-23", datagram.missing_ranges({}, 24))
  end)

  it("stops at twelve entries, lowest first", function()
    local set = {}
    for i = 0, 40, 2 do
      set[i] = true -- even indices held, odd ones missing
    end
    local out = datagram.missing_ranges(set, 41)
    assert.are.equal("1,3,5,7,9,11,13,15,17,19,21,23", out)
  end)

  it("is exactly MAX_REPORT_BYTES long in the worst case, and no longer", function()
    -- Gaps of two chunks with three-digit indices, every third chunk held, the rest of the window lost.
    local set = {}
    for i = 0, 999 do
      set[i] = (i % 4 >= 2) or nil
    end
    local ranges = datagram.missing_ranges(set, 1000)
    assert.are.equal("0-1,4-5,8-9,12-13,16-17,20-21,24-25,28-29,32-33,36-37,40-41,44-45", ranges)

    local high = {}
    for i = 0, 999 do
      high[i] = (i < 100 or i % 4 >= 2) or nil
    end
    local report = datagram.missing(string.rep("a", 16), "0000", datagram.missing_ranges(high, 1000))
    assert.are.equal(124, #report)
  end)
end)
