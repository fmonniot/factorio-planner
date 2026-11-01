-- Small pure helpers for the GUI: number and power text, rich-text colour, GUI
-- element names, and the locale keys that depend on the data. No game API, so
-- they run under busted; the GUI code (scripts/gui.lua) only calls them.
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

-- Rates in a snapshot are per minute.
function M.rate(per_minute)
  return M.number(per_minute) .. "/min"
end

-- Power in kW, as the snapshot carries it, written in W, kW, MW or GW.
function M.power(kw)
  if kw >= 1000000 then
    return M.number(kw / 1000000) .. " GW"
  elseif kw >= 1000 then
    return M.number(kw / 1000) .. " MW"
  elseif kw >= 1 then
    return M.number(kw) .. " kW"
  end
  return M.number(kw * 1000) .. " W"
end

-- "2 (1.75)": the machines to place, rounded up, then the exact count. Either
-- may be missing (a row the solve did not value); nil when both are.
function M.machines(ceil, exact)
  if ceil ~= nil and exact ~= nil then
    return M.number(ceil) .. " (" .. M.number(exact) .. ")"
  end
  if ceil ~= nil then
    return M.number(ceil)
  end
  if exact ~= nil then
    return "(" .. M.number(exact) .. ")"
  end
  return nil
end

-- Rich text that colours `text` with a snapshot colour (`#rrggbb`).
function M.colored(hex, text)
  return "[color=" .. hex .. "]" .. text .. "[/color]"
end

-- ---------------------------------------------------------------------------
-- GUI element names

M.BLOCK_BUTTON_PREFIX = "fp_viewer_block_"

function M.block_button_name(index)
  return M.BLOCK_BUTTON_PREFIX .. index
end

-- The 1-based block index a block button's name carries, or nil.
function M.parse_block_button(name)
  local digits = string.match(name or "", "^" .. M.BLOCK_BUTTON_PREFIX .. "(%d+)$")
  return digits and tonumber(digits) or nil
end

-- ---------------------------------------------------------------------------
-- Locale keys. A key the locale file lacks would show as "Unknown key", so the
-- data-dependent ones are looked up in a known set and fall back to raw text.

M.WARNING_CODES = {
  ["no-recipe"] = true,
  ["duplicate-recipe"] = true,
  ["infeasible-pins"] = true,
  ["overconstrained"] = true,
  ["area-shortfall"] = true,
  ["loop-not-converged"] = true,
  ["request-loop-not-converged"] = true,
}

M.SYNTHETIC_KINDS = { mining = true, offshore = true, power = true }

-- A LocalisedString for a warning code, or the code itself when it is new.
function M.warning_text(code)
  if M.WARNING_CODES[code] then
    return { M.LOCALE .. ".warning-" .. code }
  end
  return code
end

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
