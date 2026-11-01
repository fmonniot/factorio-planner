local layout = require("lib.layout")

describe("lib/layout.lua", function()
  it("takes the reference's share of the screen", function()
    assert.are.equal(499, layout.window_width(1920))
    assert.are.equal(864, layout.window_height(1080))
  end)

  describe("item_columns", function()
    it("counts the buttons that fit, rounded down", function()
      -- 500 - 24 frame - 16 padding - 48 gaps - 58 first - 36 machine = 318, plus
      -- the last button's 4 of spacing, in steps of 40.
      assert.are.equal(8, layout.item_columns(500, false))
      assert.are.equal(7, layout.item_columns(497, false))
    end)

    it("gives a beacon column and a wider first column their room", function()
      assert.is_true(layout.item_columns(500, true) < layout.item_columns(500, false))
      assert.is_true(layout.item_columns(500, 200, false) < layout.item_columns(500, false))
    end)

    it("never goes below two, for a very small window", function()
      assert.are.equal(2, layout.item_columns(100, true))
    end)
  end)

  describe("split", function()
    local function line(products, ingredients)
      return { products = products, ingredients = ingredients }
    end

    it("gives the columns to the side that needs them", function()
      assert.are.same({ 1, 5 }, { layout.split({ line(1, 5) }, 6) })
      assert.are.same({ 3, 3 }, { layout.split({ line(3, 1) }, 6) })
    end)

    it("gives the products at most three columns and the ingredients five", function()
      assert.are.same({ 3, 5 }, { layout.split({ line(5, 1) }, 8) })
      assert.are.same({ 3, 5 }, { layout.split({ line(6, 9) }, 8) })
    end)

    it("leaves a wide window's spare columns empty", function()
      assert.are.same({ 3, 5 }, { layout.split({ line(6, 9) }, 20) })
      assert.are.same({ 1, 5 }, { layout.split({ line(1, 1) }, 20) })
    end)

    it("keeps the table as short as it can over all the lines", function()
      -- Heights: 2 + 1 + 1 at 2 and 4, 2 + 2 + 1 at 3 and 3.
      assert.are.same({ 2, 4 }, { layout.split({ line(4, 1), line(1, 4), line(1, 1) }, 6) })
    end)

    it("prefers the fewest product columns when any share will do", function()
      assert.are.same({ 1, 5 }, { layout.split({ line(1, 1) }, 8) })
    end)

    it("copes with no lines and with too few columns", function()
      assert.are.same({ 1, 3 }, { layout.split({}, 4) })
      assert.are.same({ 1, 1 }, { layout.split({ line(3, 3) }, 1) })
    end)
  end)
end)
