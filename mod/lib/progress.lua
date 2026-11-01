-- The "built" ticks, as plain tables: done[block_key][row_key] = true. The
-- caller keeps `done` in the save and passes it in; these functions hold no state.
-- Keys are the ones the view-model gives (block.key, row.key). A row that is not
-- done has no entry, and a block with nothing done has no table, so the save
-- does not grow with ticks that were taken back.
local M = {}

function M.is_done(done, block_key, key)
  local block = done[block_key]
  return block ~= nil and block[key] == true
end

-- Sets one row to `value` (a boolean).
local function set(done, block_key, key, value)
  if value then
    local block = done[block_key]
    if not block then
      block = {}
      done[block_key] = block
    end
    block[key] = true
  else
    local block = done[block_key]
    if block then
      block[key] = nil
      if next(block) == nil then
        done[block_key] = nil
      end
    end
  end
end

-- Flips one row. Returns the new state.
function M.toggle(done, block_key, key)
  local value = not M.is_done(done, block_key, key)
  set(done, block_key, key, value)
  return value
end

-- Sets every row of `keys` (a list: a sub-factory's, or the whole block's) to
-- `value`, a boolean.
function M.set_all(done, block_key, keys, value)
  for _, key in ipairs(keys) do
    set(done, block_key, key, value and true or false)
  end
end

-- True when `keys` is not empty and every row in it is done: what a sub-factory's
-- or the summary's checkbox shows. Derived, never stored.
function M.all_done(done, block_key, keys)
  if #keys == 0 then
    return false
  end
  for _, key in ipairs(keys) do
    if not M.is_done(done, block_key, key) then
      return false
    end
  end
  return true
end

return M
