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

-- Opens the window. With `ctx` (see M.update) its content is built before the
-- window is centred, so the frame is centred at its final size.
function M.open(player, ctx)
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

  if ctx ~= nil then
    M.update(player, ctx)
  end
  -- Centred only now that the content is in (and only here: calling it on every
  -- update would pull a dragged window back to the middle).
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

function M.toggle(player, ctx)
  if M.is_open(player) then
    M.close(player)
  else
    M.open(player, ctx)
  end
end

-- ---------------------------------------------------------------------------
-- Content

-- A block's name as shown anywhere: a nameless block gets the "(unnamed block)"
-- text, and a block the snapshot does not hold (a dangling index) a "?".
local function block_text(name)
  if name == nil then
    return "?"
  elseif name == "" then
    return { key("unnamed") }
  end
  return name
end

-- An area's name from its 1-based index; the number when it has no name.
local function area_text(block, index)
  local name = block.areas[index]
  if name ~= nil and name ~= "" then
    return name
  end
  return tostring(index)
end

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

local function add_warning(parent, w, block)
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
    names[i] = block_text(b.name)
  end
  caption_lines(parent, { "", "    ", { key("warning-blocks") }, " " }, names)
  -- w.areas are 0-based indices into the block's areas, as in the snapshot.
  local areas = {}
  for i, a in ipairs(w.areas) do
    areas[i] = area_text(block, a + 1)
  end
  caption_lines(parent, { "", "    ", { key("warning-areas") }, " " }, areas)
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
      label(t, row.area_index and area_text(block, row.area_index) or "")
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
  bold(label(parent, { "", format.colored(block.color.hex, SWATCH), " ", block_text(block.name) }))
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
        { key("from"), block_text(c.from_name) },
      })
    end
  end

  if #block.warnings > 0 then
    heading(parent, "warnings")
    for _, w in ipairs(block.warnings) do
      add_warning(parent, w, block)
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

-- The window's skeleton is built once and kept: content > header (indicator, data
-- set, missing ids) and main > left and right scroll-panes. An update clears and
-- refills the panes' contents, never the panes, so the scroll bars survive.
local HEADER = "fp_viewer_header"
local MAIN = "fp_viewer_main"
local LEFT = "fp_viewer_list"
local RIGHT = "fp_viewer_details"

local function ensure_main(content)
  local main = content[MAIN]
  if main ~= nil then
    return main
  end
  main = content.add({ type = "flow", name = MAIN, direction = "horizontal" })
  local left = main.add({ type = "scroll-pane", name = LEFT, horizontal_scroll_policy = "never" })
  left.style.minimal_width = 200
  left.style.maximal_width = 280
  left.style.minimal_height = 300
  left.style.maximal_height = 600
  local right = main.add({ type = "scroll-pane", name = RIGHT })
  right.style.minimal_width = 520
  right.style.maximal_width = 900
  right.style.minimal_height = 300
  right.style.maximal_height = 600
  return main
end

local function fill_header(header, ctx)
  local note = indicator_caption(ctx.indicator)
  if note then
    local l = label(header, note, ctx.indicator == "stale" and ORANGE or RED)
    l.style.single_line = false
    l.style.maximal_width = 640
  end
  local model = ctx.model
  if model == nil then
    label(header, { key("no-plan") })
    return
  end
  label(header, { key("data-set"), model.data_set.name or model.data_set.id }, GREY)
  if #model.missing > 0 then
    add_missing(header, model.missing)
  end
  if #model.blocks == 0 then
    label(header, { key("no-blocks") })
  end
end

local function fill_list(left, blocks, selected)
  left.clear()
  for i, block in ipairs(blocks) do
    local b = left.add({
      type = "button",
      name = format.block_button_name(i),
      caption = { "", format.colored(block.color.hex, SWATCH), " ", block_text(block.name) },
    })
    b.toggled = (i == selected)
    b.style.horizontally_stretchable = true
    b.style.horizontal_align = "left"
  end
end

-- ctx = {
--   model          = viewmodel.build(...) | nil   nil: no snapshot stored
--   indicator      = "disconnected" | "mismatch" | "stale" | nil
--   selected       = 1-based block index
--   only_selection = true when only the selection changed: the header and the
--                    list are kept, the toggled button moves, the details change
--   reset_scroll   = true to scroll the details back to the top (a new block)
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
  local content = window[CONTENT]
  if content == nil then
    content = window.add({ type = "flow", name = CONTENT, direction = "vertical" })
    -- Created first, so it stays above the main part.
    content.add({ type = "flow", name = HEADER, direction = "vertical" })
  end
  local model = ctx.model
  local blocks = model and model.blocks or {}
  local selected = math.max(1, math.min(ctx.selected or 1, math.max(#blocks, 1)))

  local header = content[HEADER]
  local main = content[MAIN]
  local keep = ctx.only_selection and main ~= nil and #main[LEFT].children == #blocks

  if keep then
    for _, b in ipairs(main[LEFT].children) do
      b.toggled = (format.parse_block_button(b.name) == selected)
    end
  else
    header.clear()
    fill_header(header, ctx)
    if #blocks == 0 then
      if main ~= nil then
        main.destroy()
      end
      return
    end
    main = ensure_main(content)
    fill_list(main[LEFT], blocks, selected)
  end

  local right = main[RIGHT]
  right.clear()
  add_block_details(right, blocks[selected])
  if ctx.reset_scroll then
    right.scroll_to_top()
  end
end

return M
