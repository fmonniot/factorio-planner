-- The viewer's GUI: a button in the mod-gui frame in the top left corner and, per
-- player, a read-only window with a block drop-down and the selected block's production table. Thin on purpose:
-- what to show comes from lib/viewmodel.lua, the "built" ticks from
-- lib/progress.lua, text from lib/format.lua and the locale file; this file only
-- creates and fills game GUI elements. It does not touch `storage` and holds no
-- state: control.lua passes in the view-model, the indicator, the selection and
-- the ticks, and every update rebuilds what changed.
--
-- The look follows Factory Planner's compact dialog (ui/base/compact_dialog.lua):
-- a centred title, an inset navigation frame, and a striped table with no column
-- titles. Its columns: the "built" checkbox and the recipe (or a sub-factory's
-- name) in one cell, the machine, the beacon (left out of a block where no row has
-- one), the products, the ingredients in green, and a last empty column that
-- stretches the stripes across the frame. A sub-factory is one line, like a
-- floor in the reference: its checkbox, a blue icon of its first product that
-- opens it (the window then shows that level's lines), and its net products and
-- ingredients. A button in the navigation row goes back up a level.
--
-- Ids are drawn as sprites and rich text with the prototype's localised name. An
-- id the running game lacks gets no sprite (a sprite path the game does not know
-- raises): its button is red and its tooltip says so.
local C = require("lib.constants")
local format = require("lib.format")
local layout = require("lib.layout")
local progress = require("lib.progress")
-- From the base game (lualib/mod-gui.lua); `require` only works while the file is
-- loaded, so it cannot be asked for later.
local mod_gui = require("mod-gui")

local L = format.LOCALE

local M = {}

-- The button that opens the window, and its icon (data.lua). The window used to
-- open from a plain button added to the top level of the GUI; that one is removed
-- where a save still has it.
M.BUTTON = "fp_viewer_toggle"
M.SPRITE = "fp-viewer-button"
local LEGACY_BUTTON = "fp_viewer_button"
M.WINDOW = "fp_viewer_window"
M.CLOSE = "fp_viewer_close"
local BAR = "fp_viewer_title_bar"
local CONTENT = "fp_viewer_content"

local RED = { r = 1, g = 0.4, b = 0.35 }
local ORANGE = { r = 1, g = 0.75, b = 0.3 }
local GREY = { r = 0.6, g = 0.6, b = 0.6 }

-- U+25A0 BLACK SQUARE in UTF-8 (Lua 5.2 has no \u escape): the block's colour swatch.
local SWATCH = "\226\150\160"

-- The screen size to work with when the game's cannot be read.
local DEFAULT_SCREEN = { width = 1920, height = 1080, scale = 1 }
-- The table's scroll pane: the height the window's other parts take, and the least
-- it may be left with.
local WINDOW_CHROME_HEIGHT = 120
local TABLE_MIN_HEIGHT = 200

-- Slot-button styles, best first. This mod has no data stage, so the dark slots of
-- the reference are flib's, there whenever flib is loaded (Factory Planner needs
-- it); without it the lighter ones of the base game (core/prototypes/style.lua)
-- are used. All are 40 pixels, so slot() sets the reference's size itself.
local SLOT = { "flib_slot_button_default", "slot_sized_button", "slot_button" }
local SLOT_GREEN = { "flib_slot_button_green", "slot_sized_button_green", "slot_button" }
local SLOT_BLUE = { "flib_slot_button_blue", "slot_sized_button_blue", "slot_button" }
local SLOT_RED = { "flib_slot_button_red", "slot_sized_button_red", "slot_button" }

-- The base game's table with the reference's stripes (the same graphic as its
-- fp_table_production). It descends from a table with column settings of its own,
-- which striped() undoes.
local STRIPED_TABLE = "finished_game_table"

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

-- The screen in GUI pixels (before the display scale), and that scale.
local function screen_size(player)
  local ok, size = pcall(function()
    local resolution, scale = player.display_resolution, player.display_scale
    return {
      width = math.ceil(resolution.width / scale),
      height = math.ceil(resolution.height / scale),
      scale = scale,
    }
  end)
  return ok and size or DEFAULT_SCREEN
end

-- A label's room for wrapped text: the window's width without its frame.
local function text_width(player)
  return layout.window_width(screen_size(player).width) - layout.FRAME_BORDER * 2
end

-- A piece of the title bar to drag the window by; one on each side of the title.
local function drag_handle(bar)
  local drag = bar.add({ type = "empty-widget" })
  try_style(drag, "draggable_space_header")
  drag.style.horizontally_stretchable = true
  drag.style.minimal_width = 24
  drag.style.height = 24
  drag.ignored_by_interaction = true
end

-- The frame in the top left corner that mods share, for the button to sit in. The
-- first call for a player creates it.
local function button_flow(player)
  return mod_gui.get_button_flow(player)
end

-- Lit while the window is open.
local function sync_button(player)
  local button = button_flow(player)[M.BUTTON]
  if button ~= nil then
    button.toggled = player.gui.screen[M.WINDOW] ~= nil
  end
end

-- M.update does this, so every player has the button after the first refresh of
-- a new game, a load or a join.
function M.ensure_button(player)
  local flow = button_flow(player)
  if flow[M.BUTTON] == nil then
    flow.add({
      type = "sprite-button",
      name = M.BUTTON,
      sprite = M.SPRITE,
      style = mod_gui.button_style,
      tooltip = { key("button-tooltip") },
      mouse_button_filter = { "left" },
    })
  end
end

-- Removes the free-floating button an earlier version of the mod left in a save;
-- M.update does it.
function M.drop_legacy_button(player)
  local button = player.gui.top[LEGACY_BUTTON]
  if button ~= nil then
    button.destroy()
  end
end

function M.is_open(player)
  return player.gui.screen[M.WINDOW] ~= nil
end

-- Opens the window. With `ctx` (see M.update) its content is built before the
-- window is shown.
--
-- It opens at the top left, at the width of Factory Planner's compact dialog, out
-- of the way of what the player is building. The width is fixed, so control.lua
-- reopens the window when the screen changes.
--
-- The window is not made `player.opened`: like Factory Planner's compact dialog,
-- it stays open beside the game, so the inventory, other windows and the paste
-- mode of a picked building work while it is shown. E and Esc therefore leave it
-- alone; its close button and the top-left button close it.
function M.open(player, ctx)
  local screen = player.gui.screen
  if screen[M.WINDOW] ~= nil then
    return
  end
  local window = screen.add({ type = "frame", name = M.WINDOW, direction = "vertical" })
  sync_button(player)
  local size = screen_size(player)
  window.style.width = layout.window_width(size.width)
  window.style.maximal_height = layout.window_height(size.height)
  window.location = { layout.LEFT * size.scale, layout.TOP * size.scale }

  local bar = window.add({ type = "flow", name = BAR, direction = "horizontal" })
  try_style(bar, "frame_header_flow")
  bar.drag_target = window
  drag_handle(bar)
  local title = bar.add({ type = "label", caption = { key("title") } })
  try_style(title, "frame_title")
  title.ignored_by_interaction = true
  drag_handle(bar)
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
end

-- Lays an open window out again for a new screen size. Closed, it stays closed.
function M.reopen(player, ctx)
  if M.is_open(player) then
    M.close(player)
    M.open(player, ctx)
  end
end

function M.close(player)
  local window = player.gui.screen[M.WINDOW]
  if window ~= nil then
    window.destroy()
  end
  sync_button(player)
end

function M.toggle(player, ctx)
  if M.is_open(player) then
    M.close(player)
  else
    M.open(player, ctx)
  end
end

-- ---------------------------------------------------------------------------
-- Header: indicator, missing ids. Empty, and hidden, when all is well.

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

local function fill_header(player, header, ctx)
  local note = indicator_caption(ctx.indicator)
  if note then
    local l = label(header, note, ctx.indicator == "stale" and ORANGE or RED)
    l.style.single_line = false
    l.style.maximal_width = text_width(player)
  end
  local model = ctx.model
  if model == nil then
    label(header, { key("no-plan") })
    return
  end
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
-- tooltip; a missing id is drawn in red, and a built row's buttons lose their
-- colour, the icon's included.
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
  local style = spec.style or SLOT
  if spec.missing then
    style = SLOT_RED
  elseif spec.gray then
    style = SLOT
  end
  try_style(b, table.unpack(style))
  pcall(function()
    b.style.size = layout.BUTTON_SIZE
  end)
  if spec.gray then
    grayscale(b)
  end
  return b
end

local function rate_tooltip(ref)
  return { "", ref_caption(ref), "\n", { key("tt-rate"), format.tooltip_number(ref.rate) } }
end

-- A table of item buttons. Virtual refs (electricity) are never drawn here: their
-- rate is not an item count.
local function add_items(parent, refs, style, gray, columns)
  local t = parent.add({ type = "table", column_count = columns })
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

local function checkbox(cell, state, tags, tooltip)
  return cell.add({ type = "checkbox", state = state, tags = tags, tooltip = tooltip })
end

-- The first cell of a line, for its checkbox and its recipe or sub-factory icon.
local function first_cell(t)
  local cell = t.add({ type = "flow", direction = "horizontal" })
  pcall(function()
    cell.style.vertical_align = "center"
  end)
  return cell
end

-- ---------------------------------------------------------------------------
-- Lines of the table

-- The last cell of a line: takes the free width, so the stripes reach the frame.
local function add_pusher(t)
  t.add({ type = "empty-widget" }).style.horizontally_stretchable = true
end

-- A sub-factory's name for a tooltip.
local function group_text(entry)
  return entry.name ~= "" and entry.name or { key("unnamed-group") }
end

-- A sub-factory is one line: its icon is the first of its net products, in the
-- blue of the reference's floors, and a click on it opens the sub-factory. Its
-- name, which has no room in the line, is in the icon's tooltip.
local function add_group(t, block, entry, done, columns)
  local checked = progress.all_done(done, block.key, entry.keys)
  local cell = first_cell(t)
  checkbox(cell, checked, format.tags(block.key, entry.key, format.TAG_CHECK), { key("tt-check-group") })
  local first = entry.products[1]
  local parts = { group_text(entry) }
  if entry.area then
    parts[#parts + 1] = { "", "\n", { key("tt-area") } }
  end
  parts[#parts + 1] = { "", "\n", { key("tt-open") } }
  slot(cell, {
    sprite = first and sprite_of(first.sprite, first.missing),
    tooltip = concat(parts),
    style = SLOT_BLUE,
    missing = first and first.missing,
    gray = checked,
    tags = format.tags(block.key, entry.key, format.TAG_OPEN),
    clickable = true,
  })
  t.add({ type = "empty-widget" })
  if block.has_beacon then
    t.add({ type = "empty-widget" })
  end
  add_items(t, entry.products, SLOT, checked, columns.products)
  add_items(t, entry.ingredients, SLOT_GREEN, checked, columns.ingredients)
  add_pusher(t)
end

local function add_row(t, block, entry, done, columns)
  local row = entry.row
  local built = progress.is_done(done, block.key, entry.key)
  local cell = first_cell(t)
  checkbox(cell, built, format.tags(block.key, entry.key, format.TAG_CHECK), { key("tt-check-row") })
  recipe_cell(cell, row, built)
  machine_cell(t, block, entry, built)
  if block.has_beacon then
    beacon_cell(t, block, entry, built)
  end
  add_items(t, row.outputs, SLOT, built, columns.products)
  add_items(t, row.inputs, SLOT_GREEN, built, columns.ingredients)
  add_pusher(t)
end

-- The item buttons a list of refs draws.
local function drawn(refs)
  local n = 0
  for _, ref in ipairs(refs) do
    n = n + (ref.virtual and 0 or 1)
  end
  return n
end

-- How many product and ingredient columns a level gets in a window this wide.
local function item_columns(block, entries, window_width)
  local lines = {}
  for _, entry in ipairs(entries) do
    local row = entry.row
    lines[#lines + 1] = {
      products = drawn(row and row.outputs or entry.products),
      ingredients = drawn(row and row.inputs or entry.ingredients),
    }
  end
  local available = layout.item_columns(window_width, block.has_beacon)
  local products, ingredients = layout.split(lines, available)
  return { products = products, ingredients = ingredients }
end

-- Gives the table its stripes and takes back what the style brings along: padding
-- in the cells and right-aligned columns. Without the style the table only loses
-- its stripes.
local function striped(t, columns)
  if not try_style(t, STRIPED_TABLE) then
    return
  end
  pcall(function()
    t.style.left_cell_padding = 0
    t.style.right_cell_padding = 0
    for i = 1, columns do
      t.style.column_alignments[i] = "top-left"
    end
  end)
end

-- `entries` are the lines of the level shown: the block's top level or a
-- sub-factory's own lines.
local function fill_table(scroll, block, entries, done, window_width)
  scroll.clear()
  if #entries == 0 then
    label(scroll, { key("none") }, GREY)
    return
  end
  local columns = block.has_beacon and 6 or 5
  local t = scroll.add({ type = "table", column_count = columns })
  striped(t, columns)
  pcall(function()
    t.vertical_centering = false
  end)
  t.style.horizontal_spacing = 12
  t.style.vertical_spacing = 8
  t.style.padding = { 4, 8 }
  local item_cols = item_columns(block, entries, window_width)
  for _, entry in ipairs(entries) do
    if entry.type == "group" then
      add_group(t, block, entry, done, item_cols)
    else
      add_row(t, block, entry, done, item_cols)
    end
  end
end

-- ---------------------------------------------------------------------------
-- The window's skeleton

-- content > header (indicator, missing ids) and main > inset navigation frame >
-- drop-down and the button that goes up a level, the block's note (a failed
-- solve) and the inset table frame > scroll pane > table. The skeleton is built
-- once and kept; an update refills its parts, never the scroll pane, so the scroll
-- bar survives a tick or a new snapshot.
local HEADER = "fp_viewer_header"
local MAIN = "fp_viewer_main"
local NAV_FRAME = "fp_viewer_nav_frame"
local NAV = "fp_viewer_nav"
local NOTE = "fp_viewer_note"
local FRAME = "fp_viewer_table_frame"
local SCROLL = "fp_viewer_table_scroll"

-- The table's height: what the window's height leaves it.
local function table_height(player)
  local window = layout.window_height(screen_size(player).height)
  return math.max(TABLE_MIN_HEIGHT, window - WINDOW_CHROME_HEIGHT)
end

local function ensure_main(player, content)
  local main = content[MAIN]
  if main ~= nil then
    return main
  end
  main = content.add({ type = "flow", name = MAIN, direction = "vertical" })
  main.style.vertical_spacing = 8

  local nav_frame = main.add({ type = "frame", name = NAV_FRAME, direction = "vertical" })
  try_style(nav_frame, "inside_deep_frame")
  nav_frame.style.horizontally_stretchable = true
  nav_frame.style.padding = 4
  local nav = nav_frame.add({ type = "flow", name = NAV, direction = "horizontal" })
  nav.style.vertical_align = "center"
  nav.style.margin = { 4, 4, 4, 8 }
  nav.add({ type = "drop-down", name = format.BLOCK_DROPDOWN, items = {}, selected_index = 0 })
  nav.add({ type = "empty-widget" }).style.horizontally_stretchable = true
  nav.add({
    type = "button",
    name = format.LEVEL_UP,
    caption = { key("level-up") },
    mouse_button_filter = { "left" },
    visible = false,
  })

  main.add({ type = "flow", name = NOTE, direction = "vertical" })

  local frame = main.add({ type = "frame", name = FRAME, direction = "vertical" })
  try_style(frame, "inside_deep_frame")
  frame.style.horizontally_stretchable = true
  local scroll = frame.add({ type = "scroll-pane", name = SCROLL, horizontal_scroll_policy = "never" })
  try_style(scroll, "flib_naked_scroll_pane_no_padding")
  scroll.style.horizontally_stretchable = true
  scroll.style.maximal_height = table_height(player)
  scroll.style.padding = 0
  pcall(function()
    scroll.style.extra_right_padding_when_activated = -8
  end)
  return main
end

local function find_nav(main)
  return main and main[NAV_FRAME] and main[NAV_FRAME][NAV]
end

local function find_dropdown(main)
  local nav = find_nav(main)
  return nav and nav[format.BLOCK_DROPDOWN]
end

local function find_level_up(main)
  local nav = find_nav(main)
  return nav and nav[format.LEVEL_UP]
end

local function dropdown_items(blocks)
  local items = {}
  for i, block in ipairs(blocks) do
    items[i] = { "", format.colored(block.color.hex, SWATCH), " ", block_text(block.name) }
  end
  return items
end

-- The button that goes up a level: there only inside a sub-factory, and its
-- tooltip says which one it leaves and where it goes.
local function fill_level_up(button, block, level)
  button.visible = level ~= nil
  if level == nil then
    return
  end
  local parent = level.parent and block.by_key[level.parent]
  local to = parent and group_text(parent) or block_text(block.name)
  button.tooltip = { key("tt-level-up"), group_text(level), to }
end

local function fill_note(player, note, block)
  note.clear()
  note.visible = block.error ~= nil
  if block.error then
    local l = label(note, { key("solve-failed"), block.error }, RED)
    l.style.single_line = false
    l.style.maximal_width = text_width(player)
  end
end

-- ctx = {
--   model        = viewmodel.build(...) | nil   nil: no snapshot stored
--   generation   = a number that changes whenever `model` is rebuilt from a new
--                  snapshot; the drop-down remembers the one it was drawn from
--   indicator    = "disconnected" | "mismatch" | "stale" | nil
--   selected     = 1-based block index
--   level        = the key of the sub-factory shown in the whole window (an entry
--                  of the selected block), nil for the block's top level; one
--                  that is not a sub-factory of the block counts as nil
--   done         = the "built" ticks (lib/progress.lua); none ticked when nil
--   only_table   = true when only the selection, the level or a tick changed: the
--                  header and the drop-down are kept, the block's note, the level
--                  button and the table redrawn
--   reset_scroll = true to scroll the table back to the top (a new block or level)
-- }
function M.update(player, ctx)
  -- Runs on the first refresh after a load or a join (on_player_joined_game does
  -- not fire for a save loaded in single player).
  M.drop_legacy_button(player)
  M.ensure_button(player)
  local button = button_flow(player)[M.BUTTON]
  local note = indicator_caption(ctx.indicator)
  button.tooltip = note and { "", { key("button-tooltip") }, "\n", note } or { key("button-tooltip") }
  button.toggled = M.is_open(player)

  local window = player.gui.screen[M.WINDOW]
  if window == nil then
    return
  end
  if window[BAR] == nil then
    -- Left by an older version of the mod: no update fires for a mod whose version
    -- did not change, so the window is replaced here.
    M.close(player)
    M.open(player, ctx)
    return
  end
  local content = window[CONTENT]
  if content == nil then
    content = window.add({ type = "flow", name = CONTENT, direction = "vertical" })
    content.style.vertical_spacing = 8
    -- Created first, so it stays above the main part.
    content.add({ type = "flow", name = HEADER, direction = "vertical" })
  end
  local model = ctx.model
  local blocks = model and model.blocks or {}
  local selected = math.max(1, math.min(ctx.selected or 1, math.max(#blocks, 1)))

  local main = content[MAIN]
  if main ~= nil and find_level_up(main) == nil then
    -- Drawn by a version of the mod before the level button: drawn again below.
    main.destroy()
    main = nil
  end
  local dropdown = find_dropdown(main)
  -- A model the header and the drop-down were not drawn from redraws everything,
  -- even on an event that only meant the table (a new snapshot with as many
  -- blocks as the old one included).
  local keep = ctx.only_table
    and dropdown ~= nil
    and #dropdown.items == #blocks
    and (dropdown.tags or {}).generation == ctx.generation

  if not keep then
    local header = content[HEADER]
    header.clear()
    fill_header(player, header, ctx)
    header.visible = #header.children > 0
    if #blocks == 0 then
      if main ~= nil then
        main.destroy()
      end
      return
    end
    main = ensure_main(player, content)
    dropdown = find_dropdown(main)
    dropdown.items = dropdown_items(blocks)
    dropdown.tags = { generation = ctx.generation }
    dropdown.tooltip = { key("data-set"), model.data_set.name or model.data_set.id }
  end
  dropdown.selected_index = selected

  local block = blocks[selected]
  local level = ctx.level and block.by_key[ctx.level]
  if level ~= nil and level.type ~= "group" then
    level = nil
  end
  fill_level_up(find_level_up(main), block, level)
  fill_note(player, main[NOTE], block)
  local scroll = main[FRAME][SCROLL]
  fill_table(
    scroll,
    block,
    level and level.entries or block.entries,
    ctx.done or {},
    layout.window_width(screen_size(player).width)
  )
  if ctx.reset_scroll then
    scroll.scroll_to_top()
  end
end

return M
