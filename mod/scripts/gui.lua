-- The viewer's GUI: a top-bar button and, per player, a read-only window with the
-- block list on the left and the selected block on the right. Thin on purpose:
-- what to show comes from lib/viewmodel.lua, text from lib/format.lua and the
-- locale file; this file only creates and fills game GUI elements. It does not
-- touch `storage` and holds no state: control.lua passes in the view-model, the
-- indicator and the selection, and every update rebuilds the window's content.
--
-- Ids are drawn as rich text (`[item=...]`, `[recipe=...]`, ...) followed by the
-- prototype's localised name. An id the running game lacks is written out as text,
-- never as rich text or a sprite path, which the game could refuse.
local C = require("lib.constants")
local format = require("lib.format")

local L = format.LOCALE

local M = {}

M.BUTTON = "fp_viewer_button"
M.WINDOW = "fp_viewer_window"
M.CLOSE = "fp_viewer_close"
local CONTENT = "fp_viewer_content"

-- A LocalisedString may hold at most 20 parameters, so a list of captions is
-- written one label per CHUNK entries.
local CHUNK = 8

local RED = { r = 1, g = 0.4, b = 0.35 }
local ORANGE = { r = 1, g = 0.75, b = 0.3 }
local GREY = { r = 0.6, g = 0.6, b = 0.6 }

-- U+25A0 BLACK SQUARE in UTF-8 (Lua 5.2 has no \u escape): the block's colour swatch.
local SWATCH = "\226\150\160"

local function key(name)
  return L .. "." .. name
end

-- Assigning a style the running game lacks raises; the look is not worth an error.
local function try_style(element, name)
  pcall(function()
    element.style = name
  end)
end

local function bold(label)
  pcall(function()
    label.style.font = "default-bold"
  end)
  return label
end

local function label(parent, caption, color)
  local l = parent.add({ type = "label", caption = caption })
  if color then
    l.style.font_color = color
  end
  return l
end

local function heading(parent, name)
  return bold(label(parent, { key(name) }))
end

-- ---------------------------------------------------------------------------
-- Ids

local ELECTRICITY_ICON = "utility/electricity_icon"

-- Looks an id up in the running game's prototypes; nil when it is not there.
local function prototype(kind, id)
  local set = prototypes[kind]
  return set and set[id] or nil
end

-- `kind` is the `prototypes` table to look in (item, fluid, recipe or entity),
-- `rich` the rich-text tag for the id.
local function named(kind, id, rich)
  local proto = prototype(kind, id)
  if proto == nil then
    return { key("missing-id"), id }
  end
  return { "", rich, " ", proto.localised_name }
end

-- A viewmodel reference: an item, a fluid or the virtual electricity item,
-- which the game has no prototype for and this mod draws itself.
local function ref_caption(ref)
  if ref.virtual then
    if ref.id == "electricity" then
      local icon = helpers.is_valid_sprite_path(ELECTRICITY_ICON) and ("[img=" .. ELECTRICITY_ICON .. "] ") or ""
      return { "", icon, { key("electricity") } }
    end
    return ref.id
  end
  return named(ref.type, ref.id, ref.rich)
end

-- ---------------------------------------------------------------------------
-- Top-bar button and window frame

function M.ensure_button(player)
  if player.gui.top[M.BUTTON] == nil then
    player.gui.top.add({
      type = "button",
      name = M.BUTTON,
      caption = { key("button") },
      tooltip = { key("button-tooltip") },
    })
  end
end

function M.is_open(player)
  return player.gui.screen[M.WINDOW] ~= nil
end

function M.open(player)
  local screen = player.gui.screen
  if screen[M.WINDOW] ~= nil then
    return
  end
  local window = screen.add({ type = "frame", name = M.WINDOW, direction = "vertical" })

  local bar = window.add({ type = "flow", direction = "horizontal" })
  bar.drag_target = window
  local title = bar.add({ type = "label", caption = { key("title") } })
  try_style(title, "frame_title")
  title.ignored_by_interaction = true
  local drag = bar.add({ type = "empty-widget" })
  try_style(drag, "draggable_space_header")
  drag.style.horizontally_stretchable = true
  drag.style.minimal_width = 24
  drag.style.height = 24
  drag.ignored_by_interaction = true
  if helpers.is_valid_sprite_path("utility/close") then
    local close = bar.add({
      type = "sprite-button",
      name = M.CLOSE,
      sprite = "utility/close",
      tooltip = { key("close") },
    })
    try_style(close, "frame_action_button")
  else
    bar.add({ type = "button", name = M.CLOSE, caption = "X", tooltip = { key("close") } })
  end

  window.force_auto_center()
  -- Opened, so that E and Esc close it like any other window.
  player.opened = window
end

function M.close(player)
  local window = player.gui.screen[M.WINDOW]
  if window ~= nil then
    window.destroy()
  end
end

function M.toggle(player)
  if M.is_open(player) then
    M.close(player)
  else
    M.open(player)
  end
end

-- ---------------------------------------------------------------------------
-- Content

local function indicator_caption(indicator)
  local k = format.indicator_key(indicator)
  if indicator == "disconnected" then
    return { k, tostring(C.GAME_PORT) }
  end
  return k and { k } or nil
end

-- One label per CHUNK captions, comma-separated; `list` is a list of captions.
local function caption_lines(parent, prefix, list)
  local i = 1
  while i <= #list do
    local caption = { "", prefix }
    for j = i, math.min(i + CHUNK - 1, #list) do
      if j > i then
        caption[#caption + 1] = ", "
      end
      caption[#caption + 1] = list[j]
    end
    label(parent, caption)
    prefix = "    "
    i = i + CHUNK
  end
end

local function rate_line(parent, ref)
  label(parent, { "", ref_caption(ref), "   ", format.rate(ref.rate) })
end

local function add_warning(parent, w)
  label(parent, { "", "- ", format.warning_text(w.code) }, ORANGE)
  local items = {}
  for i, ref in ipairs(w.items) do
    items[i] = ref_caption(ref)
  end
  caption_lines(parent, "    ", items)
  local recipes = {}
  for i, r in ipairs(w.recipes) do
    recipes[i] = named("recipe", r.id, r.rich)
  end
  caption_lines(parent, "    ", recipes)
  local names = {}
  for i, b in ipairs(w.blocks) do
    names[i] = b.name or "?"
  end
  if #names > 0 then
    label(parent, { "", "    ", { key("warning-blocks") }, " ", table.concat(names, ", ") })
  end
  if #w.areas > 0 then
    local areas = {}
    for i, a in ipairs(w.areas) do
      areas[i] = tostring(a + 1)
    end
    label(parent, { "", "    ", { key("warning-areas") }, " ", table.concat(areas, ", ") })
  end
end

local function row_recipe_caption(row)
  if row.kind == "recipe" then
    return named("recipe", row.recipe, row.rich)
  end
  local kind = format.synthetic_kind_text(row.synthetic_kind)
  if row.unknown then
    -- A synthetic row that cannot say what it makes: shown as unknown.
    return { key("unknown-row"), kind }
  end
  return { "", kind, ": ", ref_caption(row.product) }
end

local function add_rows(parent, block)
  local with_area = #block.areas > 0
  local t = parent.add({ type = "table", column_count = with_area and 5 or 4 })
  t.style.horizontal_spacing = 16
  if with_area then
    bold(label(t, { key("column-area") }))
  end
  bold(label(t, { key("column-recipe") }))
  bold(label(t, { key("column-machine") }))
  bold(label(t, { key("column-count") }))
  bold(label(t, { key("column-power") }))

  for _, row in ipairs(block.rows) do
    -- A row the solve did not value has no numbers: dashes, dimmed.
    local dim = (not row.solved) and GREY or nil
    if with_area then
      label(t, row.area_name or "")
    end
    label(t, row_recipe_caption(row))
    if row.machine then
      label(t, named("entity", row.machine, row.machine_rich))
    else
      label(t, "-", GREY)
    end
    label(t, format.machines(row.machines_ceil, row.machines) or "-", dim)
    label(t, row.power_kw and format.power(row.power_kw) or "-", dim)
  end
end

local function add_block_details(parent, block)
  bold(label(parent, { "", format.colored(block.color.hex, SWATCH), " ", block.name }))
  if block.error then
    label(parent, { key("solve-failed"), block.error }, RED)
  end

  heading(parent, "products")
  if #block.products == 0 then
    label(parent, { key("none") }, GREY)
  end
  for _, p in ipairs(block.products) do
    rate_line(parent, p)
  end

  heading(parent, "recipes")
  if #block.rows == 0 then
    label(parent, { key("none") }, GREY)
  else
    add_rows(parent, block)
    label(parent, {
      key("totals"),
      format.power(block.totals.power_kw),
      tostring(block.totals.machines_ceil),
    })
  end

  heading(parent, "imports")
  if #block.imports == 0 then
    label(parent, { key("none") }, GREY)
  end
  for _, p in ipairs(block.imports) do
    rate_line(parent, p)
  end

  if #block.connections > 0 then
    heading(parent, "connections")
    for _, c in ipairs(block.connections) do
      label(parent, {
        "",
        ref_caption(c),
        "   ",
        format.rate(c.available),
        "   ",
        { key("from"), c.from_name or "?" },
      })
    end
  end

  if #block.warnings > 0 then
    heading(parent, "warnings")
    for _, w in ipairs(block.warnings) do
      add_warning(parent, w)
    end
  end
end

-- The ids of the plan that the running game lacks: listed, never hidden.
local function add_missing(parent, missing)
  label(parent, { key("missing-heading"), tostring(#missing) }, RED)
  local pane = parent.add({ type = "scroll-pane", horizontal_scroll_policy = "never" })
  pane.style.maximal_height = 110
  for _, entry in ipairs(missing) do
    label(pane, { "", { key("kind-" .. entry.kind) }, ": ", entry.id })
  end
end

-- ctx = {
--   model     = viewmodel.build(...) | nil   nil: no snapshot stored
--   indicator = "disconnected" | "mismatch" | "stale" | nil
--   selected  = 1-based block index
-- }
function M.update(player, ctx)
  local button = player.gui.top[M.BUTTON]
  if button ~= nil then
    local note = indicator_caption(ctx.indicator)
    button.tooltip = note and { "", { key("button-tooltip") }, "\n", note } or { key("button-tooltip") }
  end

  local window = player.gui.screen[M.WINDOW]
  if window == nil then
    return
  end
  local old = window[CONTENT]
  if old ~= nil then
    old.destroy()
  end
  local content = window.add({ type = "flow", name = CONTENT, direction = "vertical" })

  local note = indicator_caption(ctx.indicator)
  if note then
    local l = label(content, note, ctx.indicator == "stale" and ORANGE or RED)
    l.style.single_line = false
    l.style.maximal_width = 640
  end

  local model = ctx.model
  if model == nil then
    label(content, { key("no-plan") })
    return
  end

  label(content, { key("data-set"), model.data_set.name or model.data_set.id }, GREY)
  if #model.missing > 0 then
    add_missing(content, model.missing)
  end
  if #model.blocks == 0 then
    label(content, { key("no-blocks") })
    return
  end

  local main = content.add({ type = "flow", direction = "horizontal" })
  local left = main.add({ type = "scroll-pane", horizontal_scroll_policy = "never" })
  left.style.minimal_width = 200
  left.style.maximal_width = 280
  left.style.minimal_height = 300
  left.style.maximal_height = 600
  local right = main.add({ type = "scroll-pane" })
  right.style.minimal_width = 520
  right.style.maximal_width = 900
  right.style.minimal_height = 300
  right.style.maximal_height = 600

  local selected = math.max(1, math.min(ctx.selected or 1, #model.blocks))
  for i, block in ipairs(model.blocks) do
    local name = block.name ~= "" and block.name or { key("unnamed") }
    local b = left.add({
      type = "button",
      name = format.block_button_name(i),
      caption = { "", format.colored(block.color.hex, SWATCH), " ", name },
    })
    b.toggled = (i == selected)
    b.style.horizontally_stretchable = true
    b.style.horizontal_align = "left"
  end
  add_block_details(right, model.blocks[selected])
end

return M
