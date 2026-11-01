-- The viewer's GUI: a top-bar button and, per player, a read-only window with a
-- block drop-down and the selected block's production table. Thin on purpose:
-- what to show comes from lib/viewmodel.lua, the "built" ticks from
-- lib/progress.lua, text from lib/format.lua and the locale file; this file only
-- creates and fills game GUI elements. It does not touch `storage` and holds no
-- state: control.lua passes in the view-model, the indicator, the selection and
-- the ticks, and every update rebuilds what changed.
--
-- The table has no column titles. Its columns: the "built" checkbox, the recipe
-- (or a sub-factory's name), the machine, the beacon (left out of a block where
-- no row has one), the products and the ingredients. The first line is the
-- block's summary; each sub-factory has a header line followed by its rows,
-- indented one step per depth.
--
-- Ids are drawn as sprites and rich text with the prototype's localised name. An
-- id the running game lacks gets no sprite (a sprite path the game does not know
-- raises): its button is red and its tooltip says so.
local C = require("lib.constants")
local format = require("lib.format")
local progress = require("lib.progress")

local L = format.LOCALE

local M = {}

M.BUTTON = "fp_viewer_button"
M.WINDOW = "fp_viewer_window"
M.CLOSE = "fp_viewer_close"
local CONTENT = "fp_viewer_content"

local RED = { r = 1, g = 0.4, b = 0.35 }
local ORANGE = { r = 1, g = 0.75, b = 0.3 }
local GREY = { r = 0.6, g = 0.6, b = 0.6 }

-- U+25A0 BLACK SQUARE in UTF-8 (Lua 5.2 has no \u escape): the block's colour swatch.
local SWATCH = "\226\150\160"

-- Pixels of left margin per sub-factory depth, on the recipe cell.
local INDENT = 20
-- A sub-factory's name is capped at this width (a table column is as wide as its
-- widest cell); the full name is in its tooltip.
local NAME_WIDTH = 180
-- Products and ingredients wrap after this many per line.
local ITEMS_PER_LINE = 4
-- The table's scroll pane: its height when the screen size cannot be read, and the
-- bounds of the height computed from it.
local TABLE_HEIGHT = 560
local TABLE_MIN_HEIGHT = 200
local TABLE_MAX_HEIGHT = 720

-- Slot-button styles of the base game (core/prototypes/style.lua, 40 pixels).
local SLOT = "slot_sized_button"
local SLOT_GREEN = "slot_sized_button_green"
local SLOT_RED = "slot_sized_button_red"
local SLOT_FALLBACK = "slot_button"

local function key(name)
  return L .. "." .. name
end

-- Assigning a style the running game lacks raises; the look is not worth an
-- error. Tries each name in turn and stops at the first that takes.
local function try_style(element, ...)
  for _, name in ipairs({ ... }) do
    if pcall(function()
      element.style = name
    end) then
      return true
    end
  end
  return false
end

-- Draws a built row's icons in grayscale. A style field the running game lacks
-- raises; the row then keeps its colours.
local function grayscale(element)
  pcall(function()
    element.style.draw_grayscale_picture = true
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

-- A LocalisedString holds at most 20 parameters: longer lists are nested.
local function concat(parts)
  local out = { "" }
  if #parts <= 20 then
    for i, p in ipairs(parts) do
      out[i + 1] = p
    end
    return out
  end
  local groups = {}
  for i = 1, #parts, 20 do
    local g = { "" }
    for j = i, math.min(i + 19, #parts) do
      g[#g + 1] = parts[j]
    end
    groups[#groups + 1] = g
  end
  return concat(groups)
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

-- The sprite to draw, or nil when the id is missing or the game refuses the path.
local function sprite_of(path, missing)
  if path == nil or missing then
    return nil
  end
  if helpers.is_valid_sprite_path(path) then
    return path
  end
  return nil
end

local function electricity_sprite()
  return sprite_of(ELECTRICITY_ICON, false)
end

-- A view-model reference: an item, a fluid or the virtual electricity item,
-- which the game has no prototype for and this mod draws itself.
local function ref_caption(ref)
  if ref.virtual then
    if ref.id == "electricity" then
      return { key("electricity") }
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
--
-- The window is not made `player.opened`: like Factory Planner's compact dialog,
-- it stays open beside the game, so the inventory, other windows and the paste
-- mode of a picked building work while it is shown. E and Esc therefore leave it
-- alone; its close button and the top-bar button close it.
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
-- Header: indicator, data set, missing ids

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

local function indicator_caption(indicator)
  local k = format.indicator_key(indicator)
  if indicator == "disconnected" then
    return { k, tostring(C.GAME_PORT) }
  end
  return k and { k } or nil
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

-- ---------------------------------------------------------------------------
-- Slot buttons

-- A sprite-button of the slot family. `spec` = { sprite, number, tooltip, style,
-- missing, gray, tags, clickable }. With no sprite the button stays, with its
-- tooltip; a missing id is drawn in red.
local function slot(parent, spec)
  local args = { type = "sprite-button", tooltip = spec.tooltip }
  if spec.sprite then
    args.sprite = spec.sprite
  end
  if spec.number then
    args.number = spec.number
  end
  if spec.tags then
    args.tags = spec.tags
  end
  if spec.clickable then
    args.mouse_button_filter = { "left" }
  end
  local b = parent.add(args)
  try_style(b, spec.missing and SLOT_RED or spec.style or SLOT, SLOT_FALLBACK)
  if spec.gray then
    grayscale(b)
  end
  return b
end

local function rate_tooltip(ref)
  return { "", ref_caption(ref), "\n", { key("tt-rate"), format.tooltip_number(ref.rate) } }
end

-- A table of item buttons, ITEMS_PER_LINE per line. Virtual refs (electricity)
-- are never drawn here: their rate is not an item count.
local function add_items(parent, refs, style, gray)
  local t = parent.add({ type = "table", column_count = ITEMS_PER_LINE })
  for _, ref in ipairs(refs) do
    if not ref.virtual then
      slot(t, {
        sprite = sprite_of(ref.sprite, ref.missing),
        number = ref.rate,
        tooltip = rate_tooltip(ref),
        style = style,
        missing = ref.missing,
        gray = gray,
      })
    end
  end
  return t
end

local function module_lines(parts, modules)
  for _, m in ipairs(modules) do
    local name = m.missing and { key("missing-id"), m.id } or named("item", m.id, m.rich)
    parts[#parts + 1] = { "", "\n", { key("tt-module"), tostring(m.count), name } }
  end
end

-- ---------------------------------------------------------------------------
-- Cells of a row

local function recipe_cell(cell, row, gray)
  if row.kind == "recipe" then
    slot(cell, {
      sprite = sprite_of(row.sprite, row.recipe_missing),
      tooltip = row.recipe_missing and { key("missing-id"), row.recipe } or named("recipe", row.recipe, row.rich),
      missing = row.recipe_missing,
      gray = gray,
    })
    return
  end
  -- A mining, offshore or power row: the icon of its product, its kind in the tooltip.
  local kind = format.synthetic_kind_text(row.synthetic_kind)
  if row.unknown then
    slot(cell, { tooltip = { key("unknown-row"), kind }, gray = gray })
    return
  end
  local product = row.product
  local sprite
  if product.virtual then
    sprite = product.id == "electricity" and electricity_sprite() or nil
  else
    sprite = sprite_of(product.sprite, product.missing)
  end
  slot(cell, {
    sprite = sprite,
    tooltip = { "", kind, ": ", ref_caption(product) },
    missing = product.missing,
    gray = gray,
  })
end

local function machine_cell(t, block, entry, gray)
  local row = entry.row
  if row.machine == nil then
    t.add({ type = "empty-widget" })
    return
  end
  local parts = {
    row.machine_missing and { key("missing-id"), row.machine } or named("entity", row.machine, row.machine_rich),
  }
  if row.machines ~= nil then
    parts[#parts + 1] = { "", "\n", { key("tt-machines"), format.tooltip_number(row.machines) } }
  elseif row.machines_ceil ~= nil then
    parts[#parts + 1] = { "", "\n", { key("tt-machines"), format.tooltip_number(row.machines_ceil) } }
  end
  module_lines(parts, row.modules)
  parts[#parts + 1] = { "", "\n", { key("tt-click") } }
  slot(t, {
    sprite = sprite_of(row.machine_sprite, row.machine_missing),
    number = row.machines_ceil,
    tooltip = concat(parts),
    missing = row.machine_missing,
    gray = gray,
    tags = format.tags(block.key, entry.key, format.TAG_MACHINE),
    clickable = true,
  })
end

local function beacon_cell(t, block, entry, gray)
  local beacon = entry.row.beacon
  if beacon == nil then
    t.add({ type = "empty-widget" })
    return
  end
  local parts = {
    beacon.missing and { key("missing-id"), beacon.id } or named("entity", beacon.id, beacon.rich),
    { "", "\n", { key("tt-beacons-per-machine"), format.tooltip_number(beacon.per_machine) } },
  }
  if beacon.total ~= nil then
    parts[#parts + 1] = { "", "\n", { key("tt-beacons-total"), format.tooltip_number(beacon.total) } }
  end
  module_lines(parts, beacon.modules)
  parts[#parts + 1] = { "", "\n", { key("tt-click") } }
  slot(t, {
    sprite = sprite_of(beacon.sprite, beacon.missing),
    number = beacon.total,
    tooltip = concat(parts),
    missing = beacon.missing,
    gray = gray,
    tags = format.tags(block.key, entry.key, format.TAG_BEACON),
    clickable = true,
  })
end

local function checkbox(t, state, tags, tooltip)
  return t.add({ type = "checkbox", state = state, tags = tags, tooltip = tooltip })
end

-- The recipe cell: a flow, indented by depth.
local function indented(t, depth)
  local cell = t.add({ type = "flow", direction = "horizontal" })
  cell.style.left_margin = depth * INDENT
  pcall(function()
    cell.style.vertical_align = "center"
  end)
  return cell
end

-- ---------------------------------------------------------------------------
-- Lines of the table

local function add_summary(t, block, done)
  local summary = block.summary
  local checked = progress.all_done(done, block.key, summary.keys)
  if #summary.keys > 0 then
    checkbox(t, checked, format.tags(block.key, nil, format.TAG_CHECK), { key("tt-check-all") })
  else
    t.add({ type = "empty-widget" })
  end
  local cell = indented(t, 0)
  bold(label(cell, { key("summary") }))
  t.add({ type = "empty-widget" })
  if block.has_beacon then
    t.add({ type = "empty-widget" })
  end
  add_items(t, summary.products, SLOT_GREEN, checked)
  add_items(t, summary.ingredients, SLOT, checked)
end

local function add_group(t, block, entry, done)
  local checked = progress.all_done(done, block.key, entry.keys)
  checkbox(t, checked, format.tags(block.key, entry.key, format.TAG_CHECK), { key("tt-check-group") })
  local cell = indented(t, entry.depth)
  local name = entry.name ~= "" and entry.name or { key("unnamed-group") }
  local l = bold(label(cell, name))
  l.tooltip = name
  l.style.maximal_width = NAME_WIDTH
  pcall(function()
    l.style.horizontally_squashable = true
  end)
  if entry.area then
    label(cell, { key("area-tag") }, ORANGE)
  end
  t.add({ type = "empty-widget" })
  if block.has_beacon then
    t.add({ type = "empty-widget" })
  end
  add_items(t, entry.products, SLOT_GREEN, checked)
  add_items(t, entry.ingredients, SLOT, checked)
end

local function add_row(t, block, entry, done)
  local row = entry.row
  local built = progress.is_done(done, block.key, entry.key)
  checkbox(t, built, format.tags(block.key, entry.key, format.TAG_CHECK), { key("tt-check-row") })
  recipe_cell(indented(t, entry.depth), row, built)
  machine_cell(t, block, entry, built)
  if block.has_beacon then
    beacon_cell(t, block, entry, built)
  end
  add_items(t, row.outputs, SLOT_GREEN, built)
  add_items(t, row.inputs, SLOT, built)
end

local function fill_table(scroll, block, done)
  scroll.clear()
  if #block.entries == 0 then
    label(scroll, { key("none") }, GREY)
    return
  end
  local t = scroll.add({ type = "table", column_count = block.has_beacon and 6 or 5 })
  pcall(function()
    t.vertical_centering = false
  end)
  t.style.horizontal_spacing = 12
  t.style.vertical_spacing = 8
  add_summary(t, block, done)
  for _, entry in ipairs(block.entries) do
    if entry.type == "group" then
      add_group(t, block, entry, done)
    else
      add_row(t, block, entry, done)
    end
  end
end

-- ---------------------------------------------------------------------------
-- The window's skeleton

-- content > header (indicator, data set, missing ids) and main > drop-down, the
-- block's note (a failed solve) and the inset frame > scroll pane > table. The
-- skeleton is built once and kept; an update refills its parts, never the scroll
-- pane, so the scroll bar survives a tick or a new snapshot.
local HEADER = "fp_viewer_header"
local MAIN = "fp_viewer_main"
local NOTE = "fp_viewer_note"
local FRAME = "fp_viewer_table_frame"
local SCROLL = "fp_viewer_table_scroll"

-- The table's height: a share of the screen when it can be read.
local function table_height(player)
  local ok, height = pcall(function()
    return player.display_resolution.height / player.display_scale * 0.6
  end)
  if not ok or type(height) ~= "number" or height ~= height then
    return TABLE_HEIGHT
  end
  return math.floor(math.max(TABLE_MIN_HEIGHT, math.min(TABLE_MAX_HEIGHT, height)))
end

local function ensure_main(player, content)
  local main = content[MAIN]
  if main ~= nil then
    return main
  end
  main = content.add({ type = "flow", name = MAIN, direction = "vertical" })
  main.add({ type = "drop-down", name = format.BLOCK_DROPDOWN, items = {}, selected_index = 0 })
  main.add({ type = "flow", name = NOTE, direction = "vertical" })
  local frame = main.add({ type = "frame", name = FRAME, direction = "vertical" })
  try_style(frame, "inside_deep_frame")
  local scroll = frame.add({ type = "scroll-pane", name = SCROLL, horizontal_scroll_policy = "never" })
  scroll.style.minimal_width = 480
  scroll.style.maximal_height = table_height(player)
  scroll.style.padding = 4
  return main
end

local function dropdown_items(blocks)
  local items = {}
  for i, block in ipairs(blocks) do
    items[i] = { "", format.colored(block.color.hex, SWATCH), " ", block_text(block.name) }
  end
  return items
end

local function fill_note(note, block)
  note.clear()
  if block.error then
    local l = label(note, { key("solve-failed"), block.error }, RED)
    l.style.single_line = false
    l.style.maximal_width = 640
  end
end

-- ctx = {
--   model        = viewmodel.build(...) | nil   nil: no snapshot stored
--   indicator    = "disconnected" | "mismatch" | "stale" | nil
--   selected     = 1-based block index
--   done         = the "built" ticks (lib/progress.lua); none ticked when nil
--   only_table   = true when only the selection or a tick changed: the header and
--                  the drop-down are kept, the block's note and table redrawn
--   reset_scroll = true to scroll the table back to the top (a new block)
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

  local main = content[MAIN]
  local dropdown = main and main[format.BLOCK_DROPDOWN]
  -- A new snapshot not drawn yet redraws everything, even on a tick.
  local keep = ctx.only_table and dropdown ~= nil and #dropdown.items == #blocks

  if not keep then
    local header = content[HEADER]
    header.clear()
    fill_header(header, ctx)
    if #blocks == 0 then
      if main ~= nil then
        main.destroy()
      end
      return
    end
    main = ensure_main(player, content)
    dropdown = main[format.BLOCK_DROPDOWN]
    dropdown.items = dropdown_items(blocks)
  end
  dropdown.selected_index = selected

  local block = blocks[selected]
  fill_note(main[NOTE], block)
  local scroll = main[FRAME][SCROLL]
  fill_table(scroll, block, ctx.done or {})
  if ctx.reset_scroll then
    scroll.scroll_to_top()
  end
end

return M
