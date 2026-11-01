local progress = require("lib.progress")

describe("progress", function()
  it("flips one row and says the new state", function()
    local done = {}
    assert.is_false(progress.is_done(done, "B", "r"))
    assert.is_true(progress.toggle(done, "B", "r"))
    assert.is_true(progress.is_done(done, "B", "r"))
    assert.is_false(progress.toggle(done, "B", "r"))
    assert.is_false(progress.is_done(done, "B", "r"))
  end)

  it("keeps blocks apart, and rows of one block apart", function()
    local done = {}
    progress.toggle(done, "A", "r")
    assert.is_false(progress.is_done(done, "B", "r"))
    assert.is_false(progress.is_done(done, "A", "s"))
  end)

  it("leaves no entry behind when a tick is taken back", function()
    local done = {}
    progress.toggle(done, "B", "r")
    progress.toggle(done, "B", "s")
    progress.toggle(done, "B", "r")
    assert.are.same({ B = { s = true } }, done)
    progress.toggle(done, "B", "s")
    assert.are.same({}, done)
  end)

  it("ticks and unticks a list of rows", function()
    local done = { B = { other = true } }
    progress.set_all(done, "B", { "a", "b", "c" }, true)
    assert.are.same({ other = true, a = true, b = true, c = true }, done.B)
    progress.set_all(done, "B", { "a", "c" }, false)
    assert.are.same({ other = true, b = true }, done.B)
  end)

  it("ticks nothing for an empty list, and creates no table for it", function()
    local done = {}
    progress.set_all(done, "B", {}, true)
    assert.are.same({}, done)
  end)

  it("unticks a block that was never ticked without creating it", function()
    local done = {}
    progress.set_all(done, "B", { "a" }, false)
    assert.are.same({}, done)
  end)

  describe("all_done", function()
    it("is true only when every row of the list is done", function()
      local done = {}
      progress.set_all(done, "B", { "a", "b" }, true)
      assert.is_true(progress.all_done(done, "B", { "a", "b" }))
      assert.is_false(progress.all_done(done, "B", { "a", "b", "c" }))
      progress.toggle(done, "B", "a")
      assert.is_false(progress.all_done(done, "B", { "a", "b" }))
    end)

    it("is false for an empty list and for a block with nothing done", function()
      assert.is_false(progress.all_done({}, "B", {}))
      assert.is_false(progress.all_done({}, "B", { "a" }))
    end)

    it("follows a toggle of the last row: the derived state of a sub-factory", function()
      local done = {}
      local keys = { "a", "b" }
      progress.toggle(done, "B", "a")
      assert.is_false(progress.all_done(done, "B", keys))
      progress.toggle(done, "B", "b")
      assert.is_true(progress.all_done(done, "B", keys))
    end)

    it("does not count a row of another block", function()
      local done = {}
      progress.set_all(done, "A", { "a" }, true)
      assert.is_false(progress.all_done(done, "B", { "a" }))
    end)
  end)
end)
