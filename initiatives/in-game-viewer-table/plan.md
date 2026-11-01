# Initiative: In-game viewer as a production table

Status: Active

Redesign the in-game viewer window ([mod/](../../mod/README.md)) after the production table of the Factory Planner mod: a block drop-down, one row per recipe with icons, and a "built" checkbox per row. The snapshot side (PR 1, the contract) is in; the in-game window is not. The reference is the compact dialog of [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner/tree/master/modfiles/ui) (see `ui/base/compact_dialog.lua` and `ui/main/production_table.lua`).

---

## Target

Same look as the reference, minus the pin and maximize buttons and the display toggles (items/s, belts, per building). The window opens at the top left at the reference's default size (decision 14). From top to bottom:

- **Title bar:** the title, centred between two drag handles, and the close button.
- **Above the table:** only what needs attention: the indicator line, the list of missing ids and the "no plan yet" and "no blocks" messages, as today. With none of them there is nothing above the navigation frame. Warnings and connections are no longer shown in game; the web planner is where they are dealt with.
- **Navigation row in an inset frame:** a block drop-down with each block's colour swatch, replacing today's left-hand block list. Its tooltip names the data set. A block whose solve failed shows the solver's message under the frame.
- **Production table in an inset frame:** striped rows, one per recipe and one header row per sub-factory (see below), with no column titles, as in the reference. A block with no rows shows "None" instead. Up to six columns:
  - a checkbox ("built") and the recipe icon in one cell (for a mining, offshore or power row, the icon of its product);
  - the machine icon, with the machine count as its number;
  - the beacon icon, with the total beacon count as its number (the column is left out of a block where no row has a beacon);
  - the products;
  - the ingredients, in green as in the reference;
  - an empty column that takes the free width, so the stripes reach the frame.
- **Summary row at the top of the table:** a checkbox that ticks or unticks every row (decision 10), a blue icon of the block's first net product (the colour of the reference's sub-floors, with "Whole block" in its tooltip: a caption would widen the recipe column of every row), its net products and its net ingredients.

A row the solve did not value shows its icons without numbers. A built row loses its colours, background included, and stays clickable (decision 4).

### Click a building for a blueprint

Clicking a machine or a beacon icon puts that building in the player's cursor, ready to place, as Factory Planner does (`modfiles/util/cursor.lua`, `set_entity`). There is nothing to edit in this window, so a plain left click does it, and only a left click (`mouse_button_filter`). It is one building per paste, not one per counted machine. The window stays open while the player builds (decision 12).

- An assembling machine (which includes refineries and chemical plants) or a rocket silo becomes a one-entity blueprint with the row's recipe and its modules.
- A furnace or a drill with modules becomes a one-entity blueprint with its modules and no recipe, since a blueprint can only set a recipe on the two types above.
- A beacon becomes a one-entity blueprint holding its modules.
- Any other building with no modules (a furnace, drill or pump with none, a generator) goes into the cursor as a ghost of the item that builds it.
- A building that cannot be placed (not blueprintable, not player-creatable, no item that places it, or an id the game lacks) shows a short flying text at the cursor instead. So does a row whose recipe or modules the game lacks, or a building with modules and no known module inventory, and so does a cursor that cannot be cleared.
- The blueprint is handed over through the clipboard and paste mode, like the reference; there is no item left in the player's inventory.

Modules show in the machine's and beacon's tooltip, not as icons of their own in the table.

### Sub-factories

The planner's sub-plans ("sub-factories") are the counterpart of Factory Planner's floors: groups of rows that nest, with the web planner showing them inline ([spec/ui.md](../../spec/ui.md), the ProductionTable). The in-game table shows them like a floor row, but **always expanded, as a tree**:

- A sub-factory is a header row followed by its rows, indented one step per nesting depth. The header has the sub-factory's name (and an "Area" tag when it is a separate area) in the recipe column, its **net** products and net ingredients in the other columns, and a checkbox that ticks or unticks everything under it.
- No drilling, so no "Level N" label and no up buttons. No collapsing either.
- Net flows are the sum over the sub-factory's rows (all depths) of outputs minus inputs, per item: a positive balance is a product, a negative one an ingredient, and a balance under 0.01/min in size is dropped, since per-row rounding leaves that much on an item made and used inside the sub-factory. The mod computes them from the per-row rates, so the snapshot needs no extra numbers for them.
- A sub-factory's checkbox state is derived (checked when every row under it is built), never stored.

Blocks are selected through the drop-down. Rates are items per minute, as in the reference's "Items/m".

## Decisions

1. **Per-row item rates come from the snapshot, not from the game's recipe prototypes.** A snapshot row has only machine counts, throughput and power today. Computing item rates in the mod from `prototypes.recipe` would ignore modules, productivity and probabilities, would break when the mod set differs from the plan, and cannot cover mining, offshore and power rows. The solver already has exact `inputRates` and `outputRates` per row (`SolvedNode`), so the snapshot sends them as optional `inputs` and `outputs` per row.
2. **No compatibility story: the snapshot changes in place, `v` stays 1.** The in-game viewer has not been released, so no installed mod or bridge reads another shape. An older reader is not a concern, which is also why the snapshot sheds what the new window does not draw (decision 7) rather than carrying it for nobody. The mod in the tree still has to work after each PR (decision 13).
3. **No data stage.** This mod changes no prototype. Factory Planner draws with the `flib_slot_button_*` styles of flib, with `_small` variants of its own, so the slots go through the `try_style` guard: flib's styles when flib is loaded (an optional dependency, which any install of the reference has), then the vanilla `slot_sized_button` family, then the plain slot button. All are 40 pixels, and `style.size` makes them the reference's 36 at runtime. The vanilla ones are lighter than the reference. The stripes need no flib: the vanilla `finished_game_table` has the graphic of the reference's `fp_table_production`, and its cell padding and column alignments are reset at runtime. This is checked in game.
4. **A built row is drawn in grayscale, and stays clickable.** Factory Planner uses grayscale styles of its own, but `LuaStyle.draw_grayscale_picture` is writable at runtime, so setting it on a row's buttons gives the same look with no data stage. Disabling the buttons would not do: a disabled button raises no click, so a built row's machine could not be picked up. The checkbox is the source of truth.
5. **Built state lives in the save, not per player:** it is one factory. Multiplayer is out of scope for the viewer, so only the acting player's window is redrawn. The state is `storage.fp_viewer.done[blockKey][rowKey]` and survives new snapshots.
   - A row's key is the sub-factory path (names, outermost first, joined with the control character `\31`, which a typed name cannot hold) plus the recipe id, or the kind, product and machine for a synthetic row, since every generator row makes the same electricity.
   - A key that repeats within the block gets an occurrence suffix (`#2`, `#3`): the same recipe twice in one plan, two recipes of the same machine and product. A sub-factory's path gets the same suffix when a sibling has its name, so their rows stay apart.
   - A block's key is its name, with the same suffix when another block has that name (names may repeat or be empty).
   - Renaming a block or a sub-factory drops its ticks, and reordering same-named blocks swaps theirs. Both are accepted.
6. **The sub-factory tree travels in the snapshot as a flat list of groups.** The snapshot flattens sub-plans today and keeps only the `area` index of those that are separate areas. A block gets `groups?: { name, parent?, area? }[]` and each row an optional `group` index (absent for a row of the root plan).
   - `groups` is in pre-order, so a parent always has a lower index than its children. `parent` is an index into `groups`, absent for a top-level sub-factory; `area: true` marks a separate area.
   - Rows are in table order, which is **not** contiguous per group: a sub-factory's rows sit where its handle is, so a plan `P[a, S, b]` gives the groups `P, S, P`. A group's rows are only ever interrupted by its own descendants.
   - The mod rebuilds the tree by walking the rows: at each row it emits a header for every group in its chain, outermost first, that has not been reached yet. That also covers a sub-factory that holds only nested ones. Each row adds its rates and key to its group and all its ancestors.
   - A sub-factory with no rows at any depth is not sent. Groups replace the block's `areas` and the per-row `area`, which are removed (decision 7).
7. **The snapshot drops `warnings`, `connections`, `areas`, the per-row `area` and `powerKw`.** Warnings and connections are no longer drawn in game (the web planner deals with them), `areas` is superseded by `groups`, and power is out of this window (decision 11). Warnings also point into `areas`, so the three go together. `products`, `imports` and the rest stay. The mod's id check (`collect_ids`, `find_missing`) then reads ids from rows (including their `inputs`, `outputs`, modules and beacon), products and imports, so a plan's unknown-id count no longer includes ids that only a warning named.
8. **The snapshot carries each row's modules and beacon.** The blueprint needs them, and the snapshot has neither today. A row gets `modules?: { id, count }[]` (the machine's own) and `beacon?: { id, count, module, modules }`: the beacon entity, how many per machine, and the module and how many of it each holds. A beacon config with no `beaconId` (made without beacon data) or with a `beaconCount` of 0 is not sent, since there is nothing to place. The total beacon count shown is `count` times the row's `machinesCeil`, as in the reference, and no number shows when `machinesCeil` is absent; the tooltip gives the count per machine. Module ids (as items) and the beacon id (as a machine) go through the same id check as the rest, so a mod set that lacks them lists them as missing.
9. **No byproducts column.** The snapshot does not distinguish byproducts from products, so every output is shown as a product.
10. **The summary row is computed from the rows, like a sub-factory header.** The whole block is the root group, with the same net flows and the same 0.01/min cut-off. `products` holds a target, not what the block makes, so a pinned block would read 0; `imports` leaves out what connections supply, and with connections gone those items would show nowhere. Only a block with no rates at all (a failed solve) falls back on `products` and `imports`, so it still says what it was meant to make. This supersedes the backlog item "In-game viewer shows a product's target, not what the block makes".
11. **Power is out of this initiative.** No power column, no total power in the summary or sub-factory headers, no power in tooltips: the planner has the plan's figures and the game has real consumption. `powerKw` leaves the snapshot, and `format.power` leaves the mod.
    - Generators and boilers stay as ordinary rows, since they are still buildings to place. A power row's recipe cell shows its product: for electricity, `utility/electricity_icon` as today, with its kind in the tooltip.
    - Electricity is not an item in the product and ingredient columns. `project.ts` leaves it out of a row's `inputs` and `outputs`, and the failed-block fallback of decision 10 skips `virtual` references. So the rate of electricity (MJ per minute, not an item count) is never drawn.
12. **The window no longer sets `player.opened`.** The reference's compact dialog leaves it unset so that paste mode and other GUIs, like the inventory, work while it is open; its main dialog sets it, and has to close on a pick. The viewer is a read-only companion to building, so it follows the compact dialog: a click leaves the window open and the player can paste straight away. The cost is that E and Esc no longer close it; the close button and the top-bar button do. `on_gui_closed` is no longer raised for it, so its handler goes.
13. **Two PRs: the contract, then the mod GUI.** The mod requires `warnings` and `connections` to be arrays and ignores unknown keys, so the first PR only adds to the snapshot and the mod keeps working. The second PR changes the mod and removes the old fields together.

14. **The window opens at the top left, at a fixed size, like the reference.** It sits at (10, 63) times the display scale, 26 % of the screen's width (the default of the reference's `compact_width_percentage`, which here is a constant) and at most 80 % of its height, so that it stays out of the way of what the player is building. The table cannot scroll sideways, so a fixed width means what goes on a line has to fit: as in the reference, `lib/layout.lua` works out how many item buttons fit, given the first column (indentation and sub-factory names included) and the beacon column, and shares them between products and ingredients so the table is as short as it can be. The window is reopened on `on_player_display_resolution_changed` and `on_player_display_scale_changed`, as the reference does. If both windows are open they overlap until one is dragged.

## Steps

### PR 1: contract

1. **Snapshot additions (planner side)**
   - Add `inputs` and `outputs` (arrays of `SnapshotItemRateSchema`) to `rowShape` in `src/snapshot/schema.ts`; omitted when empty or when the row is unsolved.
   - Fill them from `SolvedNode.inputRates` and `outputRates` in `src/snapshot/project.ts`, rounded to three decimals, dropping zero or unusable rates and the electricity item (decision 11).
   - Add `modules` and `beacon` to the row (decision 8), filled from the node's `modules` and `beaconConfig`.
   - Add `groups` to the block and `group` to the row (decision 6). `visit` in `project.ts` already walks sub-plans in table order. On entering a sub-plan with rows at any depth it assigns the next group index, so that parents come first, with `parent` set from the enclosing sub-plan and `area` from `sp.area`.
   - Unit tests in `src/snapshot/project.test.ts`: modules and beacon (and a beacon config with no id, and one with a count of 0), rates, empty or unusable rates, electricity left out, nested sub-factories, rows after a nested sub-factory, a sub-factory with only nested ones, one with no rows, an area, a row of the root plan.
2. **Contract fixtures**
   - Add a `seablock-groups` fixture to `buildSnapshotFixtures` in `src/test/snapshotFixtures.ts`. The existing ones have no modules, no beacon, no nesting and no sub-factory that is not an area, so the Lua specs would never see the new shape. It holds nested sub-factories with a row after the nested one, a sub-factory that is not an area, a row with modules (`speed-module`), a row with a `beacon`, and two `power:` rows that make electricity.
   - Run `npm run contract`. This regenerates about 40 files in `contract/` (every fixture and datagram case embeds snapshot bytes).
   - Check that the mod's specs still pass on the regenerated fixtures: it must ignore the new keys.
3. **Docs**
   - Document `groups` and `group`, `inputs` and `outputs`, `modules` and `beacon` in the snapshot section of [spec/data-model.md](../../spec/data-model.md).
   - Update the sample datagram bytes and example lines in [spec/in-game-viewer-protocol.md](../../spec/in-game-viewer-protocol.md); its "shows an example of …" tests fail until it matches the regenerated `contract/datagrams/`.
   - Check the Rust bridge: it treats snapshot bytes as opaque, but its tests read `contract/datagrams/`.

### PR 2: mod GUI

4. **Remove the old snapshot fields**
   - Remove `warnings`, `connections`, `areas`, the row's `area` and `powerKw` from `src/snapshot/schema.ts`, and `projectWarning`, `blockIndex`, the area and connection plumbing and `powerKw` from `project.ts` (decisions 7 and 11), with their tests.
   - Update the header comments of `schema.ts` and `project.ts`, which name areas, warnings and connections.
   - Run `npm run contract` again, and update `spec/data-model.md` (the removed fields and the rules that name them) and the sample bytes in `spec/in-game-viewer-protocol.md`.
5. **Snapshot validation (`mod/lib/snapshot.lua`)**
   - Remove the checks and `collect_ids` code for `warnings`, `connections`, `areas`, the row's `area` and `powerKw`, with their specs.
   - Validate the new fields, so that a validated snapshot still cannot make the view-model raise: `inputs` and `outputs`, `modules`, `beacon`, `groups` and `group`.
   - `collect_ids` adds row `inputs` and `outputs`, module ids as items and the beacon id as a machine (decision 7). Without this a row's item the game lacks would be neither listed nor drawn in red.
6. **Mod view-model (`mod/lib/viewmodel.lua`)**
   - Drop `warnings`, `connections`, the area fields, `power_kw` and `totals`, with their specs, and `powerKw` from the `solved` test.
   - Rows get `inputs` and `outputs` (as `refs`) and a `key`, and blocks a `key` (decision 5).
   - Rows get `modules` and `beacon` with their sprites and rich tags, and the total beacon count. A block says whether any row has a beacon, so the column can be left out.
   - Build the table as a flat list of entries in order, each a `row` or a `group` header with its `depth`, its key, its descendant row keys and its net products and ingredients, by the walk of decision 6. Blocks get a map from key to entry, for the click handlers, and the summary's net flows (decision 10).
   - A `group` index that leads nowhere (dangling) puts the row at the root, and a `parent` that is not a lower index counts as absent, so the walk ends, rather than raising, as the rest of the view-model does.
   - busted specs, with the `P[a, S, b]` case, a sub-factory with only nested ones, the key suffixes, two generator rows, the cut-off, and the failed-block fallback.
7. **Pure helpers**
   - New `mod/lib/blueprint.lua`: from a view-model row and what the game says about the entity (its type, its flags, the item that places it), it returns the one-entity blueprint table, the plain ghost, or a refusal reason. It sets `recipe` only for `assembling-machine` and `rocket-silo`, refuses when the recipe or a module is missing, and maps an entity type to its module inventory name: `crafter_modules` for `assembling-machine`, `furnace` and `rocket-silo` (`assembling_machine_modules` and the like are deprecated in 2.0.77), `mining_drill_modules`, `beacon_modules`. Module slots are numbered from 0 in order. Specs cover a crafter with modules, a furnace with and without modules, a drill with modules, a beacon, a plain building, and each refusal.
   - New `mod/lib/progress.lua`: `toggle`, `set_all` (a list of keys, for a sub-factory or the whole block) and `all_done`, with specs.
   - `mod/lib/format.lua`: remove `WARNING_CODES`, `warning_text`, `power` and its units, with their specs, including the warning-code test in `mod/spec/mod_files_spec.lua`. Add the drop-down's element name, tag parsing, number text for tooltips. Remove `block_button_name` and `parse_block_button` and their specs.
8. **GUI rewrite (`mod/scripts/gui.lua`)**
   - Replace the left list and right details pane with the drop-down and the production table, keeping `block.error` and the header's data-set and message lines (see the Target).
   - Stop setting `player.opened` in `M.open`, and update its comment (decision 12).
   - Draw a sub-factory header row for each `group` entry: indentation by depth (a left margin on the recipe cell), no expand or collapse. The name is capped in width with the full name in a tooltip, since a table column is as wide as its widest cell and a long name would stretch the recipe column of every row. Remove today's Area column.
   - Slot buttons are sprite-buttons with `number` and rich tooltips (localised name, rate, exact machine count). A built row's buttons get `style.draw_grayscale_picture = true`, through a guard like `try_style`.
   - A cell with no valid sprite path stays a button with a tooltip and no sprite: a missing id is drawn in red, as today, with the `missing-id` text; an unknown synthetic row with the `unknown-row` text. A power row's electricity uses `utility/electricity_icon` when it is valid.
   - Keep the title bar, indicator, data-set line and missing-id list. Remove the warnings, connections and block-details sections and their helpers (`add_warning`, `caption_lines`, `area_text`, `add_block_details`, `add_rows`, `rate_line`, `heading`).
   - Locale: remove the keys only those used (`warning-*`, `connections`, `from`, `warnings`, `products`, `recipes`, `imports`, `totals`, `column-*`); add `area-tag`, `cannot-place` and the tooltip texts.
   - Rebuild only the table on a selection change or a checkbox toggle, so derived checkboxes and grayscale follow.
   - Checkboxes, machine and beacon buttons carry tags, not names (names must be unique within a parent): the block key, the entry key, and what the element is (`check`, `machine` or `beacon`). The summary's checkbox has only the block key. Machine and beacon buttons set `mouse_button_filter = { "left" }`.
   - New `mod/scripts/cursor.lua`, the thin game-facing half of the blueprint. It reads the entity prototype for `lib/blueprint.lua` (resolving the inventory name through `defines.inventory`), calls `player.clear_cursor()`, then builds the blueprint through a script inventory and the clipboard, or sets the cursor ghost, or shows the flying text. The inventory is always destroyed, also when a call raises, so that none is left in the save. It holds no state.
9. **`mod/control.lua`**
   - Handle `on_gui_selection_state_changed` (drop-down) and `on_gui_checked_state_changed` (checkboxes). A toggle goes through `lib/progress.lua`, then redraws the player's table without resetting its scroll.
   - Remove the `on_gui_closed` handler (decision 12).
   - Keep `done` in storage, created lazily and never written from `on_load`.
   - Pass `done` to the GUI through `ctx`.
   - Handle a click on a machine or beacon button: find the entry by the tag's keys in the current view-model, and call `scripts/cursor.lua`. A key that is gone (a new snapshot since the last redraw) does nothing. The window stays open.
10. **Test runtime and specs**
    - Extend `mod/spec/fake_game.lua` with the new events and element fields: `tags`, `number`, `items`, `selected_index`, `state`, `mouse_button_filter`, and a recording fake for the cursor calls (`game.create_inventory`, `set_stack`, `set_blueprint_entities`, `clear_cursor`, `add_to_clipboard`, `activate_paste`, `cursor_ghost`, `create_local_flying_text`, the inventory's `destroy`).
    - `mod/spec/glue_spec.lua`: the block-list tests become drop-down tests, and any test that relies on `player.opened` or `on_gui_closed` goes. New specs for a click on a machine and on a beacon (what reaches the cursor, that the window stays open, the flying text when it cannot be placed, the inventory destroyed when a call raises), a click on a built row, the checkboxes, the summary row, a failed block's message, sub-factory headers (nesting, derived checkbox, ticking one ticks its rows) and persistence across a new snapshot.
    - `mod/spec/mod_files_spec.lua`: add `scripts/cursor.lua` to the files of the locale scan.
11. **Docs and checklist**
    - `mod/README.md` (the `gui.lua` and `viewmodel.lua` rows, the new files) and `mod/CHECKLIST.md`, including the items that name the block list, the Area column and E and Esc.
    - [README.md](../../README.md): the in-game viewer's setup section says the window shows power and warnings. Add `scripts/cursor.lua`, `lib/blueprint.lua` and `lib/progress.lua` to the [repository map](../../README.md#repository-map).
    - New manual checklist items for what CI cannot check, using `contract/fixtures/seablock-groups.json`: slot-button styles, grayscale on built rows, `number` formatting, the colour swatch in the drop-down (rich text in its items), long sub-factory names, scroll behaviour after a toggle, and the whole blueprint path: a crafter with modules, a furnace, a beacon, a plain building, an unplaceable one, pasting into the world with the window open.
    - [spec/ui.md](../../spec/ui.md) if it covers the in-game window.
    - Remove the backlog item this supersedes (decision 10), and any other it touches.
12. **Verification (each PR)**
    - `npm run contract`, `npm test`, `npm run lint`, `npm run lint:docs`.
    - `cargo test` in `bridge/`.
    - In `mod/`: `.lua/bin/busted` and `.lua/bin/luacheck .` (toolchain from `mod/setup-lua.sh`).
    - PR 2: the manual in-game pass from the checklist on Factorio 2.0.77, with `mod/tools/udp_sender.py`.

## Risks and open questions

- **Styles and rendering.** The style names are in 2.0.77's `style.lua` and `draw_grayscale_picture` in its API docs, but how they look together, and the rendering of `number`, are unverified until someone runs the game. The plain slot-button fallback should keep the window working, only less polished.
- **Blueprint API.** `game.create_inventory`, `LuaItemStack.set_stack` and `set_blueprint_entities`, `LuaPlayer.clear_cursor`, `add_to_clipboard` and `activate_paste`, and `cursor_ghost` are all in the 2.0.77 API docs and used by the reference, but none has run in this mod. A failure should be a one-line fix in `scripts/cursor.lua`; the whole call is wrapped in `pcall` and logged once, like the other glue.
- **Window and paste mode.** The window stays open on the strength of the reference's compact dialog, which does the same without `player.opened` (decision 12). If paste mode misbehaves in this mod anyway, that is the first thing to check in game.
- **Modules.** Only the machine's own and the beacon's modules go into the blueprint, in slot order. A module id the game lacks refuses the whole blueprint rather than placing a building without its modules.
- **Window size.** Seablock blocks can have dozens of rows with many ingredients each. Cap the table's height with a scroll pane and share the item columns by what fits (decision 14), as the reference does.
