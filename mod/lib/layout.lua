-- The window's sizes, after Factory Planner's compact dialog
-- (ui/base/compact_dialog.lua). Plain Lua, so they run under busted. The window has
-- a fixed width and its table does not scroll sideways, so what goes on a line has
-- to fit: the room left for item buttons is shared between the product and the
-- ingredient columns of a block.
local M = {}

-- The window: a share of the screen, and where it opens. Both are the reference's
-- defaults; sizes are in GUI pixels, so before the display scale.
M.WIDTH_SHARE = 0.26
M.HEIGHT_SHARE = 0.8
M.LEFT = 10
M.TOP = 63

-- What the window's frame takes on each side.
M.FRAME_BORDER = 12

local TABLE_PADDING = 8
local TABLE_SPACING = 12
local BUTTON_SPACING = 4
-- Always at least one column each for the products and the ingredients.
local MIN_COLUMNS = 2

-- The width of a line's first cell, for its checkbox and its recipe icon.
M.CHECK_WIDTH = 22
M.BUTTON_SIZE = 36

-- The window's width, from the screen's size before scaling (`width`).
function M.window_width(width)
  return math.floor(width * M.WIDTH_SHARE)
end

function M.window_height(height)
  return math.floor(height * M.HEIGHT_SHARE)
end

-- The item buttons that fit on a line, given the window's width, the width of the
-- first column and whether the block has a beacon column. Rounded down, so nothing
-- is cut off, and never below MIN_COLUMNS, for a very small window.
function M.item_columns(window_width, first_width, has_beacon)
  -- The gaps are between all the columns, the empty last one included.
  local gaps = has_beacon and 5 or 4
  local used = M.FRAME_BORDER * 2
    + TABLE_PADDING * 2
    + TABLE_SPACING * gaps
    + first_width
    + M.BUTTON_SIZE * (has_beacon and 2 or 1)
  local room = window_width - used + BUTTON_SPACING
  return math.max(MIN_COLUMNS, math.floor(room / (M.BUTTON_SIZE + BUTTON_SPACING)))
end

-- Lines of buttons needed to draw `count` buttons in `columns` columns.
local function rows_of(count, columns)
  return math.ceil(count / columns)
end

-- Shares `columns` item columns between products and ingredients so that the table
-- is as short as it can be. `lines` is a list of { products = n, ingredients = n },
-- the buttons of each line. Returns the column counts: products, ingredients. Of
-- the shares that are equally short, the one with the fewest product columns.
function M.split(lines, columns)
  columns = math.max(columns, MIN_COLUMNS)
  local best_height, best_products = math.huge, 1
  for products = 1, columns - 1 do
    local ingredients = columns - products
    local height = 0
    for _, line in ipairs(lines) do
      height = height + math.max(rows_of(line.products, products), rows_of(line.ingredients, ingredients))
    end
    if height < best_height then
      best_height, best_products = height, products
    end
  end
  return best_products, columns - best_products
end

return M
