-- Rows of the protocol's mod-side tables that the shared delivery cases do not
-- exercise, written out as scenarios: the answer slot, the Disconnected and
-- Stale signals, refusals, and the corners of finishing.
local constants = require("lib.constants")
local receiver = require("lib.receiver")
local snapshot_lib = require("lib.snapshot")
local support = require("spec.support")

local X = "1111111111111111"
local Y = "2222222222222222"
local SMALL = support.read_file(support.CONTRACT .. "/fixtures/small.json")

local function new(opts)
  opts = opts or {}
  local stored_events = {}
  local r = receiver.new({
    decode_json = support.json_to_table,
    count_unknown = opts.count_unknown or function()
      return 0
    end,
    stored = opts.stored,
    on_store = function(s)
      stored_events[#stored_events + 1] = s
    end,
  })
  return r, stored_events
end

local function hear(r, data, tick)
  r:on_datagram(data, tick or 100)
end

-- Probe, every chunk, end of window: one full delivery.
local function deliver(r, id, text, size, tick)
  hear(r, support.probe(id, math.ceil(#text / size), #text), tick)
  local parts = support.split(text, size)
  for i, part in ipairs(parts) do
    hear(r, support.chunk(id, i - 1, #parts, #text, part), tick)
  end
  hear(r, support.eow(id, 0, #parts), tick)
end

describe("the answer slot", function()
  it("is empty until a datagram arrives: the mod never sends unprompted", function()
    local r = new()
    assert.is_nil(r:take_answer())
    hear(r, "not a datagram")
    hear(r, "")
    hear(r, "FP01 Z 0123456789abcdef")
    assert.is_nil(r:take_answer())
  end)

  it("is emptied by taking the answer", function()
    local r = new()
    hear(r, support.ping(X))
    assert.is_string(r:take_answer())
    assert.is_nil(r:take_answer())
  end)

  it("lets a hello fill an empty slot only", function()
    local r = new()
    hear(r, support.probe(X, 1, 100))
    hear(r, support.ping(Y))
    assert.are.equal("FP01 R " .. X, r:take_answer())
  end)

  it("lets every other answer replace what is there, the latest word winning", function()
    local r = new()
    hear(r, support.ping(X))
    hear(r, support.probe(Y, 1, 100)) -- replaces the hello
    assert.are.equal("FP01 R " .. Y, r:take_answer())

    -- A window of Y then a probe of X: the batch ends with R for X.
    hear(r, support.probe(Y, 1, 100))
    hear(r, support.eow(Y, 3, 1))
    assert.are.equal("FP01 M " .. Y .. " 0003 0", r:take_answer())
    hear(r, support.eow(Y, 4, 1))
    hear(r, support.probe(X, 1, 100))
    assert.are.equal("FP01 R " .. X, r:take_answer())
  end)

  it("keeps a report over a ping that comes after it", function()
    local r = new()
    hear(r, support.probe(X, 3, 300))
    hear(r, support.eow(X, 1, 3))
    hear(r, support.ping(X))
    assert.are.equal("FP01 M " .. X .. " 0001 0-2", r:take_answer())
  end)

  it("answers a hello that shows what is stored and what is assembling", function()
    local r = new({ stored = { id = X, unknown_ids = 4, snapshot = {} } })
    hear(r, support.probe(Y, 2, 100))
    r:take_answer()
    hear(r, support.ping(nil))
    assert.are.equal("FP01 H " .. X .. " 4 " .. Y, r:take_answer())
  end)
end)

describe("reassembly", function()
  it("answers a probe of the stored id with an ack and drops any reassembly", function()
    local r = new({ stored = { id = X, unknown_ids = 2, snapshot = {} } })
    hear(r, support.probe(Y, 2, 100))
    hear(r, support.chunk(Y, 0, 2, 100, string.rep("a", 50)))
    r:take_answer()
    hear(r, support.probe(X, 1, 100))
    assert.are.equal("FP01 A " .. X .. " 2", r:take_answer())
    assert.is_nil(r:state().assembling)
    assert.are.same({}, r:state().have)
  end)

  it("answers an end of window for the stored id with an ack", function()
    local r = new({ stored = { id = X, unknown_ids = 0, snapshot = {} } })
    hear(r, support.eow(X, 7, 3))
    assert.are.equal("FP01 A " .. X .. " 0", r:take_answer())
  end)

  it("keeps what has arrived when the same probe repeats, and answers ready", function()
    local r = new()
    hear(r, support.probe(X, 3, 300))
    hear(r, support.chunk(X, 1, 3, 300, string.rep("a", 100)))
    r:take_answer()
    hear(r, support.probe(X, 3, 300))
    assert.are.equal("FP01 R " .. X, r:take_answer())
    assert.are.same({ 1 }, r:state().have)
  end)

  it("drops an end of window whose upto is above count, and one for another id", function()
    local r = new()
    hear(r, support.probe(X, 3, 300))
    r:take_answer()
    hear(r, support.eow(X, 0, 4))
    assert.is_nil(r:take_answer())
    hear(r, support.eow(Y, 0, 3))
    assert.is_nil(r:take_answer())
    hear(r, support.eow(X, 0, 3)) -- upto equal to count is fine
    assert.are.equal("FP01 M " .. X .. " 0000 0-2", r:take_answer())
  end)

  it("echoes the round as received", function()
    local r = new()
    hear(r, support.probe(X, 2, 200))
    r:take_answer()
    hear(r, support.eow(X, 123, 2))
    assert.are.equal("FP01 M " .. X .. " 0123 0-1", r:take_answer())
  end)

  it("reports at most twelve ranges, lowest first", function()
    local r = new()
    hear(r, support.probe(X, 40, 4000))
    for i = 0, 39, 2 do
      hear(r, support.chunk(X, i, 40, 4000, string.rep("a", 100)))
    end
    r:take_answer()
    hear(r, support.eow(X, 0, 40))
    assert.are.equal("FP01 M " .. X .. " 0000 1,3,5,7,9,11,13,15,17,19,21,23", r:take_answer())
  end)

  it("drops chunks of an id that is not the target, and chunks after a finish", function()
    local r = new()
    hear(r, support.chunk(X, 0, 1, #SMALL, SMALL))
    assert.is_nil(r:state().stored)
    deliver(r, X, SMALL, 200)
    assert.are.equal(X, r:state().stored)
    r:take_answer()
    hear(r, support.chunk(X, 0, 3, 600, string.rep("a", 200)))
    assert.is_nil(r:take_answer())
    assert.is_nil(r:state().assembling)
  end)

  it("joins chunks of any size by index, including NUL bytes", function()
    local r = new({ count_unknown = function() return 0 end })
    local text = SMALL
    hear(r, support.probe(X, 2, #text))
    hear(r, support.chunk(X, 1, 2, #text, string.sub(text, 6)))
    hear(r, support.chunk(X, 0, 2, #text, string.sub(text, 1, 5)))
    assert.are.equal(X, r:state().stored)
    local payload = "a\0b"
    hear(r, support.probe(Y, 1, #payload))
    hear(r, support.chunk(Y, 0, 1, #payload, payload))
    -- Not JSON, but it must have reached the decoder byte for byte: refused as json, not length.
    assert.are.equal("FP01 N " .. Y .. " json", r:take_answer())
  end)
end)

describe("finishing", function()
  it("stores and acks a valid snapshot once, writing it through on_store", function()
    local r, events = new({ count_unknown = function() return 3 end })
    deliver(r, X, SMALL, 128)
    assert.are.equal("FP01 A " .. X .. " 3", r:take_answer())
    assert.are.equal(1, #events)
    assert.are.equal(X, events[1].id)
    assert.are.equal(3, events[1].unknown_ids)
    assert.are.equal("kompetenz-seablock", events[1].snapshot.dataSet.id)
    assert.is_nil(r:state().assembling)
  end)

  it("saturates the unknown-id count at MAX_UNKNOWN_IDS", function()
    local r = new({ count_unknown = function() return 20000 end })
    deliver(r, X, SMALL, 1000)
    assert.are.equal("FP01 A " .. X .. " 9999", r:take_answer())
    assert.are.equal(constants.MAX_UNKNOWN_IDS, r:state().unknownIds)
  end)

  local function refused(reason, text)
    it("refuses with " .. reason .. " and leaves the stored snapshot untouched", function()
      local old = { id = "aaaaaaaaaaaaaaaa", unknown_ids = 1, snapshot = { marker = true } }
      local r, events = new({ stored = old })
      deliver(r, X, text, 64)
      -- deliver ends with an end of window, which is dropped after a refusal; the N from
      -- the finishing chunk was replaced by nothing, so look at the slot as it stands.
      assert.are.equal("FP01 N " .. X .. " " .. reason, r:take_answer())
      assert.are.equal(0, #events)
      assert.are.equal(old, r.stored)
      assert.is_nil(r:state().assembling)
    end)
  end

  refused("json", string.sub(SMALL, 1, 300))
  refused("version", (string.gsub(SMALL, '"v": 1', '"v": 2', 1)))
  refused("invalid", '{"v":1,"blocks":"none"}')
  refused("invalid", "[1,2,3]")
  refused("invalid", '"just a string"')

  it("refuses with length when the chunks add up to other than bytes", function()
    local r = new()
    hear(r, support.probe(X, 2, 100))
    hear(r, support.chunk(X, 0, 2, 100, string.rep("a", 50)))
    hear(r, support.chunk(X, 1, 2, 100, string.rep("a", 49)))
    assert.are.equal("FP01 N " .. X .. " length", r:take_answer())
  end)

  it("drops an end of window that follows a refusal, and acks one that follows an accept", function()
    local r = new()
    hear(r, support.probe(X, 1, 5))
    hear(r, support.chunk(X, 0, 1, 5, "nojso"))
    r:take_answer()
    hear(r, support.eow(X, 0, 1))
    assert.is_nil(r:take_answer())

    deliver(r, Y, SMALL, 5000)
    r:take_answer()
    hear(r, support.eow(Y, 1, 1))
    assert.are.equal("FP01 A " .. Y .. " 0", r:take_answer())
  end)

  it("replaces a stored snapshot by a later accepted one", function()
    local r, events = new()
    deliver(r, X, SMALL, 5000)
    deliver(r, Y, SMALL, 5000)
    assert.are.equal(Y, r:state().stored)
    assert.are.equal(2, #events)
  end)

  it("recomputes the unknown-id count when the mod set changes", function()
    local unknown = 1
    local r, events = new({ count_unknown = function() return unknown end })
    deliver(r, X, SMALL, 5000)
    assert.are.equal(1, r:state().unknownIds)
    unknown = 5
    r:recompute_unknown()
    assert.are.equal(5, r:state().unknownIds)
    assert.are.equal(5, events[#events].unknown_ids)
    unknown = 99999
    r:recompute_unknown()
    assert.are.equal(constants.MAX_UNKNOWN_IDS, r:state().unknownIds)
  end)

  it("recomputes nothing when nothing is stored", function()
    local r, events = new()
    r:recompute_unknown()
    assert.are.equal(0, #events)
  end)

  it("counts unknown ids through the snapshot module, exempting the virtual item", function()
    local text = [[{"v":1,"dataSet":{"id":"x"},"blocks":[{"name":"b","color":"#112233",
      "products":[{"id":"electricity","type":"virtual","rate":1},{"id":"gone","type":"item","rate":1}],
      "rows":[{"recipe":"gone","machine":"m"}],"imports":[],"warnings":[],"connections":[]}]}]]
    local r = new({
      count_unknown = function(snap)
        local n = snapshot_lib.find_missing(snap, support.exists_except({ gone = true, m = true }))
        return n
      end,
    })
    deliver(r, X, text, 100)
    -- item "gone", recipe "gone" and machine "m" are three distinct ids; electricity is exempt.
    assert.are.equal("FP01 A " .. X .. " 3", r:take_answer())
  end)
end)

describe("the Stale signal", function()
  local stored = function()
    return { id = X, unknown_ids = 0, snapshot = {} }
  end

  it("shows when the ping names another id, and clears when it names the stored one", function()
    local r = new({ stored = stored() })
    assert.is_false(r:is_stale())
    hear(r, support.ping(Y))
    assert.is_true(r:is_stale())
    hear(r, support.ping(X))
    assert.is_false(r:is_stale())
  end)

  it("clears on the no-id value: a restarted bridge claims nothing", function()
    local r = new({ stored = stored() })
    hear(r, support.ping(Y))
    hear(r, support.ping(nil))
    assert.is_false(r:is_stale())
  end)

  it("never shows with nothing stored", function()
    local r = new()
    hear(r, support.ping(Y))
    assert.is_false(r:is_stale())
  end)

  it("is rechecked when a snapshot is accepted", function()
    local r = new()
    hear(r, support.ping(X))
    assert.is_false(r:is_stale())
    deliver(r, Y, SMALL, 5000)
    assert.is_true(r:is_stale()) -- stored Y, planner's newest X
    deliver(r, X, SMALL, 5000)
    assert.is_false(r:is_stale())
  end)

  it("is not changed by a ping of another version", function()
    local r = new({ stored = stored() })
    hear(r, support.ping(Y))
    hear(r, "FP02 P " .. X)
    assert.is_true(r:is_stale())
  end)
end)

describe("the Disconnected signal", function()
  it("shows before the first datagram, whatever the tick", function()
    local r = new()
    assert.is_true(r:is_disconnected(0, 1))
    assert.is_true(r:is_disconnected(1000000, 1))
  end)

  it("clears on a datagram and trips above DISCONNECT_TICKS", function()
    local r = new()
    hear(r, support.ping(nil), 500)
    assert.is_false(r:is_disconnected(500, 1))
    assert.is_false(r:is_disconnected(500 + 1080, 1))
    assert.is_true(r:is_disconnected(500 + 1081, 1))
  end)

  it("scales the threshold with the game speed", function()
    local r = new()
    hear(r, support.ping(nil), 0)
    assert.is_false(r:is_disconnected(8640, 8))
    assert.is_true(r:is_disconnected(8641, 8))
    assert.is_true(r:is_disconnected(541, 0.5))
    assert.is_false(r:is_disconnected(540, 0.5))
  end)

  it("is not refreshed by a datagram that is dropped", function()
    local r = new()
    hear(r, support.ping(nil), 0)
    hear(r, "FP01 P too short", 1000)
    hear(r, "FP01 Z 0123456789abcdef", 1000)
    assert.is_true(r:is_disconnected(1081, 1))
  end)

  it("is refreshed by any valid datagram, a chunk nobody asked for included", function()
    local r = new()
    hear(r, support.chunk(X, 0, 1, 10, "abcdefghij"), 1000)
    assert.is_false(r:is_disconnected(1000, 1))
  end)

  it("is refreshed by a datagram of another version", function()
    local r = new()
    hear(r, "FP02 H 5 anything", 700)
    assert.is_false(r:is_disconnected(700, 1))
  end)

  it("does not trip on a tick that went backwards (a pause or a load)", function()
    local r = new()
    hear(r, support.ping(nil), 5000)
    assert.is_false(r:is_disconnected(100, 1))
  end)
end)

describe("the protocol mismatch flag", function()
  it("is set by any datagram of another version, answered with a hello in our version", function()
    local r = new({ stored = { id = X, unknown_ids = 1, snapshot = {} } })
    hear(r, "FP02 C anything at all, never read")
    assert.is_true(r:state().mismatch)
    assert.are.equal("FP01 H " .. X .. " 1 " .. constants.NO_ID, r:take_answer())
    assert.are.equal(X, r:state().stored)
  end)

  it("is cleared by a valid datagram of this version", function()
    local r = new()
    hear(r, "FP02 P " .. X)
    hear(r, support.ping(nil))
    assert.is_false(r:state().mismatch)
  end)

  it("is not cleared by a malformed datagram of this version", function()
    local r = new()
    hear(r, "FP02 P " .. X)
    hear(r, "FP01 P short")
    assert.is_true(r:state().mismatch)
  end)

  it("lets a hello fill only an empty slot, as for a ping", function()
    local r = new()
    hear(r, support.probe(X, 1, 100))
    hear(r, "FP03 P " .. X)
    assert.are.equal("FP01 R " .. X, r:take_answer())
  end)
end)

describe("the indicator", function()
  it("shows one thing at a time: Disconnected, else Protocol mismatch, else Stale", function()
    local r = new({ stored = { id = X, unknown_ids = 0, snapshot = {} } })
    assert.are.equal("disconnected", r:indicator(0, 1))

    hear(r, "FP02 P " .. X, 0)
    hear(r, support.ping(Y), 0) -- stale
    hear(r, "FP02 P " .. X, 0) -- and mismatched
    assert.are.equal("mismatch", r:indicator(1, 1))

    hear(r, support.ping(Y), 0)
    assert.are.equal("stale", r:indicator(1, 1))
    assert.are.equal("disconnected", r:indicator(5000, 1))

    hear(r, support.ping(X), 0)
    assert.is_nil(r:indicator(1, 1))
  end)
end)

describe("after a load", function()
  it("starts with no reassembly, no answer and no newest, and drops the chunks that follow", function()
    local r = new({ stored = { id = X, unknown_ids = 0, snapshot = {} } })
    assert.is_nil(r:state().assembling)
    assert.is_nil(r:take_answer())
    hear(r, support.chunk(Y, 0, 3, 600, string.rep("a", 200)))
    hear(r, support.eow(Y, 0, 3))
    assert.is_nil(r:take_answer())
  end)
end)
