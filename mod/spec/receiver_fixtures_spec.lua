-- Replays every shared delivery case (contract/datagrams/case-*.json) through the
-- receiver, as protocol.md ("Fixtures") describes: set up `start`, hand each
-- datagram of a poll to the handler in order, flush once, compare the answer and
-- the state.
local receiver = require("lib.receiver")
local support = require("spec.support")

local function run_case(case)
  local stored = nil
  if case.start.stored then
    stored = { id = case.start.stored.id, unknown_ids = case.start.stored.unknownIds, snapshot = { marker = true } }
  end
  local r = receiver.new({
    decode_json = support.json_to_table,
    count_unknown = function()
      return case.idCheck.unknownIds
    end,
    stored = stored,
  })

  for n, poll in ipairs(case.polls) do
    local tick = n * 10
    for _, d in ipairs(poll.arrive) do
      r:on_datagram(support.from_hex(d.hex), tick)
    end
    local answer = r:take_answer()
    assert.are.equal(poll.answer, answer, "answer after poll " .. n)

    local state = r:state()
    local want = poll.after
    assert.are.equal(want.stored, state.stored, "stored after poll " .. n)
    assert.are.equal(want.unknownIds, state.unknownIds, "unknownIds after poll " .. n)
    assert.are.equal(want.assembling, state.assembling, "assembling after poll " .. n)
    assert.are.same(want.have, state.have, "chunks held after poll " .. n)
    assert.are.equal(want.stale, state.stale, "stale after poll " .. n)
    assert.are.equal(want.mismatch, state.mismatch, "mismatch after poll " .. n)
  end
  return r
end

describe("the shared delivery cases", function()
  for _, name in ipairs(support.list_cases()) do
    it(name, function()
      local case = support.read_json(support.CONTRACT .. "/datagrams/case-" .. name .. ".json")
      local r = run_case(case)

      -- An accepted snapshot is exactly what the chunks joined to.
      local snap = case.snapshot
      if snap and snap.hex and r.stored and r.stored.id == snap.id then
        assert.are.same(support.json_to_table(support.from_hex(snap.hex)), r.stored.snapshot)
      end
    end)
  end

  it("finds the cases", function()
    assert.is_true(#support.list_cases() >= 25)
  end)
end)

describe("a multi-byte character straddling two chunks", function()
  it("survives, in the block names of the unicode fixture", function()
    local case = support.read_json(support.CONTRACT .. "/datagrams/case-multibyte-straddle.json")
    local r = run_case(case)
    local names = {}
    for i, block in ipairs(r.stored.snapshot.blocks) do
      names[i] = block.name
    end
    -- Names with 2-, 3- and 4-byte characters (accents, a dash, kanji, an emoji in an area name).
    assert.is_truthy(string.find(names[1], "\xc3\xa0", 1, true))
    assert.is_truthy(string.find(names[1], "\xe2\x80\x93", 1, true))
    assert.are.equal("\xe9\x89\x84\xe5\xb7\xa5\xe5\xa0\xb4 (\xe6\xad\xaf\xe8\xbb\x8a)", names[2])
    assert.are.equal("\xe9\x8a\x85\xe3\x81\xae\xe7\xb2\xbe\xe9\x8c\xac \xf0\x9f\x94\xa5", r.stored.snapshot.blocks[1].areas[2])
  end)

  it("really does cut inside a character at that chunk size", function()
    local case = support.read_json(support.CONTRACT .. "/datagrams/case-multibyte-straddle.json")
    local bytes = support.from_hex(case.snapshot.hex)
    local size = case.snapshot.chunkSize
    local cut_inside = 0
    for boundary = size, #bytes - 1, size do
      -- A continuation byte (10xxxxxx) at the start of a chunk means the previous one ended mid-character.
      local b = string.byte(bytes, boundary + 1)
      if b >= 0x80 and b < 0xC0 then
        cut_inside = cut_inside + 1
      end
    end
    assert.is_true(cut_inside >= 3, "boundaries inside a character: " .. cut_inside)
  end)
end)
