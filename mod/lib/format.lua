-- Small pure helpers for the GUI: number text, rich-text colour, GUI element
-- names and tags, and the locale keys that depend on the data. No game API, so
-- they run under busted; the GUI code (scripts/gui.lua) only calls them.
--
-- What the GUI needs to know of the helpers that are not obvious:
--   * M.BLOCK_DROPDOWN is the name of the block drop-down (one per window, so a
--     name is safe there); its `selected_index` is the 1-based block index.
--   * Checkboxes, machine buttons and beacon buttons carry tags, not names (a
--     name must be unique within its parent). `M.tags(block_key, entry_key, what)`
--     builds the table for `tags =`, and `M.parse_tags(event.element.tags)` gives
--     back `block_key, entry_key, what`, or nil for anything that is not ours.
--     `what` is "check", "machine" or "beacon". The keys are the view-model's
--     (`block.key`, `entry.key`).
--   * M.tooltip_number(x) is the text of a count or rate in a tooltip: at most two
--     decimals, no trailing zeros, thousands separated by commas.
local M = {}

-- The group of the mod's locale file (locale/en/factorio-planner-viewer.cfg).
M.LOCALE = "fp-viewer"

-- A number with at most two decimals and no trailing zeros: 60, 0.14, 1.75.
function M.number(x)
  local s = string.format("%.2f", x)
  if string.find(s, ".", 1, true) then
    s = string.gsub(s, "0+$", "")
    s = string.gsub(s, "%.$", "")
  end
  return s
end

-- A number for a tooltip: M.number with the thousands separated by commas
-- (1,234.57). Negative numbers keep their sign.
function M.tooltip_number(x)
  local sign, int, frac = string.match(M.number(x), "^(%-?)(%d+)(.*)$")
  if not int then
    return M.number(x)
  end
  local reversed = string.gsub(string.reverse(int), "(%d%d%d)", "%1,")
  local grouped = string.gsub(string.reverse(reversed), "^,", "")
  return sign .. grouped .. frac
end

-- Keeps a player's selected block through a new snapshot: the same position if
-- it still holds a block of that name, else the first block of that name, else
-- the first block. `names` is the list of block names, `index` and `name` what
-- was selected (name may be nil). Returns a valid index (1 for an empty list).
function M.reselect(names, index, name)
  if name ~= nil then
    if names[index] == name then
      return index
    end
    for i, n in ipairs(names) do
      if n == name then
        return i
      end
    end
  end
  if name == nil and index ~= nil and index >= 1 and index <= #names then
    return index
  end
  return 1
end

-- Rich text that colours `text` with a snapshot colour (`#rrggbb`).
function M.colored(hex, text)
  return "[color=" .. hex .. "]" .. text .. "[/color]"
end

-- ---------------------------------------------------------------------------
-- GUI element names

-- The block drop-down. There is one per window, so its name is unique.
M.BLOCK_DROPDOWN = "fp_viewer_block_dropdown"

-- What a tagged element is.
M.TAG_CHECK = "check"
M.TAG_MACHINE = "machine"
M.TAG_BEACON = "beacon"
local TAG_KINDS = { [M.TAG_CHECK] = true, [M.TAG_MACHINE] = true, [M.TAG_BEACON] = true }

-- The tags of a checkbox, machine button or beacon button.
function M.tags(block_key, entry_key, what)
  return { block = block_key, entry = entry_key, what = what }
end

-- block_key, entry_key, what of an element's tags, or nil when they are not ours
-- (no tags, wrong types, an unknown `what`, or a missing entry key).
function M.parse_tags(tags)
  if
    type(tags) ~= "table"
    or type(tags.block) ~= "string"
    or type(tags.entry) ~= "string"
    or not TAG_KINDS[tags.what]
  then
    return nil
  end
  return tags.block, tags.entry, tags.what
end

-- ---------------------------------------------------------------------------
-- Locale keys. A key the locale file lacks would show as "Unknown key", so the
-- data-dependent ones are looked up in a known set and fall back to raw text.

M.SYNTHETIC_KINDS = { mining = true, offshore = true, power = true }

function M.synthetic_kind_text(kind)
  if M.SYNTHETIC_KINDS[kind] then
    return { M.LOCALE .. ".kind-" .. kind }
  end
  return kind
end

-- The locale key suffix of an indicator from receiver:indicator().
local INDICATORS = { disconnected = true, mismatch = true, stale = true }

function M.indicator_key(indicator)
  if INDICATORS[indicator] then
    return M.LOCALE .. ".indicator-" .. indicator
  end
  return nil
end

return M
