# Initiative: In-game viewer as a production table

Status: Future

Redesign the in-game viewer window ([mod/](../../mod/README.md)) after the production table of the Factory Planner mod: a block drop-down, one row per recipe with icons, and a "built" checkbox per row. Nothing is implemented yet. The reference is the compact dialog of [Factory Planner](https://github.com/ClaudeMetz/FactoryPlanner/tree/master/modfiles/ui) (see `ui/base/compact_dialog.lua` and `ui/main/production_table.lua`).

---

## Target

Same look as the reference, minus the pin and maximize buttons and the display toggles (items/s, belts, per building). From top to bottom:

- **Title bar:** title, drag space and close button.
- **Navigation row:** a block drop-down, replacing today's left-hand block list.
- **Production table in an inset frame:** one row per recipe, and one header row per sub-factory (see below), seven columns:
  - a checkbox ("built");
  - the recipe icon;
  - the machine icon, with the machine count as its number;
  - the beacon icon, with the total beacon count as its number (the column is left out of a block where no row has a beacon);
  - the products;
  - the ingredients;
  - power.
- **Summary row at the top of the table:** the block's products in green, its imports as ingredients, total power, and a checkbox that ticks or unticks every row.
- **Above the table:** the indicator line and the list of missing ids stay as they are today. Warnings and connections are no longer shown in game; the web planner is where they are dealt with.

### Click a building for a blueprint

Clicking a machine or a beacon icon puts that building in the player's cursor, ready to place, as Factory Planner does (`modfiles/util/cursor.lua`, `set_entity`). There is nothing to edit in this window, so a plain left click does it. It is one building per paste, not one per counted machine.

- A machine that takes a recipe (an assembling machine, a furnace, a refinery, a chemical plant) becomes a one-entity blueprint with the row's recipe and its modules.
- A beacon becomes a one-entity blueprint holding its modules.
- Any other building with no modules (a drill or pump with none, a generator) goes into the cursor as a ghost of the item that builds it.
- A building that cannot be placed (not blueprintable, not player-creatable, no item that places it, or an id the game lacks) shows a short flying text at the cursor instead.
- The blueprint is handed over through the clipboard and paste mode, like the reference; there is no item left in the player's inventory.

Modules show in the machine's and beacon's tooltip, not as icons of their own in the table.

### Sub-factories

The planner's sub-plans ("sub-factories") are the counterpart of Factory Planner's floors: groups of rows that nest, with the web planner showing them inline ([spec/ui.md](../../spec/ui.md), the ProductionTable). The in-game table shows them like a floor row, but **always expanded, as a tree**:

- A sub-factory is a header row followed by its rows, indented one step per nesting depth. The header has the sub-factory's name (and an "Area" tag when it is a separate area) in the recipe column, its **net** products in green and net ingredients in the other columns, its total power, and a checkbox that ticks or unticks everything under it.
- No drilling, so no "Level N" label and no up buttons. No collapsing either.
- Net flows are the sum over the sub-factory's rows (all depths) of outputs minus inputs, per item: a positive balance is a product, a negative one an ingredient. The mod computes them from the per-row rates, so the snapshot needs no extra numbers for them.
- A sub-factory's checkbox state is derived (checked when every row under it is built), never stored.

Blocks are selected through the drop-down. Rates are items per minute, as in the reference's "Items/m".

## Decisions

1. **Per-row item rates come from the snapshot, not from the game's recipe prototypes.** A snapshot row has only machine counts, throughput and power today. Computing item rates in the mod from `prototypes.recipe` would ignore modules, productivity and probabilities, would break when the mod set differs from the plan, and cannot cover mining, offshore and power rows. The solver already has exact `inputRates` and `outputRates` per row (`SolvedNode`), so the snapshot sends them as optional `inputs` and `outputs` per row.
2. **No compatibility story: the snapshot changes in place, `v` stays 1.** The in-game viewer has not been released, so no installed mod or bridge reads another shape. The snapshot, the mod and the fixtures change together, and an older reader is not a concern. This is also why the snapshot sheds what the new window does not draw (decision 7), rather than carrying it for nobody.
3. **No data stage.** Factory Planner uses its own `fflib_slot_button_*` styles; this mod changes no prototype. Use vanilla `slot_button` styles through the existing `try_style` guard, falling back to the plain slot button. The coloured variants (green products, blue power) may not match the reference exactly; this is checked in game.
4. **A built row is shown by disabling its icon buttons** (dimmed), since there are no grayscale styles. The checkbox is the source of truth.
5. **Built state is per save, not per player:** it is one factory, so everyone on the save sees the same checkboxes. It lives in `storage.fp_viewer.done[blockName][rowKey]` and survives new snapshots. The row key is the sub-factory path (names, outermost first) plus the recipe id, or the kind and product for a synthetic row. Two sibling sub-factories with the same name share keys; that is accepted.
6. **The sub-factory tree travels in the snapshot as a flat list of groups.** The snapshot flattens sub-plans today and keeps only the `area` index of those that are separate areas. A block gets `groups?: { name, parent?, area? }[]` (in table order, `parent` an index into `groups`, absent for a top-level sub-factory, `area: true` for a separate area) and each row an optional `group` index (absent for a row of the root plan). Rows are already in table order with a sub-factory's rows contiguous, so the mod rebuilds the tree by walking the rows and emitting a header whenever the group changes. A sub-factory with no rows is not sent. Groups replace the block's `areas` and the per-row `area`, which are removed (decision 7).
7. **The snapshot drops `warnings`, `connections`, `areas` and the per-row `area`.** Warnings and connections are no longer drawn in game (the web planner deals with them), and `areas` is superseded by `groups`. Warnings also point into `areas`, so the three go together. `products`, `imports` and the rest stay. The mod's id check (`collect_ids`, `find_missing`) then reads ids from rows, products and imports only, so a plan's unknown-id count no longer includes ids that only a warning named.
8. **The snapshot carries each row's modules and beacon.** The blueprint needs them, and the snapshot has neither today. A row gets `modules?: { id, count }[]` (the machine's own) and `beacon?: { id, count, module, modules }`: the beacon entity, how many per machine, and the module and how many of it each holds. A beacon config with no `beaconId` (made without beacon data) is not sent, since there is nothing to place. The total beacon count shown is `count` times the row's `machinesCeil`, as in the reference; the tooltip gives the count per machine. Module ids and the beacon id go through the same id check as the rest (`collect_ids`), so a mod set that lacks them lists them as missing.
9. **No byproducts column.** The snapshot does not distinguish byproducts from products, so every output is shown as a product.

## Steps

1. **Snapshot contract (planner side)**
   - Add `inputs` and `outputs` (arrays of `SnapshotItemRateSchema`) to `rowShape` in `src/snapshot/schema.ts`; omitted when empty or when the row is unsolved.
   - Fill them from `SolvedNode.inputRates` and `outputRates` in `src/snapshot/project.ts`, rounded to three decimals, dropping zero or unusable rates.
   - Remove `warnings`, `connections`, `areas` and the row's `area` from `src/snapshot/schema.ts`, and `projectWarning` and the area and connection plumbing from `project.ts` (decision 7), with their tests.
   - Add `modules` and `beacon` to the row (decision 8), filled from the node's `modules` and `beaconConfig`.
   - Add `groups` to the block and `group` to the row (decision 6). `visit` in `project.ts` already walks sub-plans in table order; it assigns each sub-plan with rows (or with a descendant that has rows) the next group index, with `parent` set from the enclosing sub-plan, and `area` from `blockAreas`.
   - Unit tests in `src/snapshot/project.test.ts`: modules and beacon (and a beacon config with no id), rates, empty or unusable rates, nested sub-factories, a sub-factory with only nested ones, an area, a row of the root plan.
   - Run `npm run contract`. This regenerates about 40 files in `contract/` (every fixture and datagram case embeds snapshot bytes).
   - Document `groups` and `group`, `inputs` and `outputs` in the snapshot section of [spec/data-model.md](../../spec/data-model.md).
   - Update the sample datagram bytes and example lines in [spec/in-game-viewer-protocol.md](../../spec/in-game-viewer-protocol.md); its "shows an example of …" tests fail until it matches the regenerated `contract/datagrams/`.
   - Check the Rust bridge: it treats snapshot bytes as opaque, but its tests read `contract/datagrams/`.
2. **Mod view-model (`mod/lib/viewmodel.lua`)**
   - Rows get `inputs` and `outputs` (as `refs`) and a stable `key`.
   - Blocks get totals for products and imports.
   - Rows get `modules` and `beacon` with their sprites and rich tags, and the total beacon count. A block says whether any row has a beacon, so the column can be left out.
   - Build the table as a flat list of entries in order, each a `row` or a `group` header with its `depth`, its descendant row keys, its net products and ingredients and its total power and machine count (decision 6). A `group` index that leads nowhere (dangling) puts the row at the root rather than raising, as the rest of the view-model does.
   - Drop `warnings`, `connections` and the area fields from the view-model and from `mod/lib/snapshot.lua` (validation and `collect_ids`), with their specs.
   - busted specs.
3. **Pure helpers**
   - New `mod/lib/blueprint.lua`: from a view-model row and what the game says about the entity (its type, whether it takes recipes, whether it can be placed, the item that places it), it returns the one-entity blueprint table, the plain ghost, or a refusal reason. It also maps an entity type to its module inventory name (`assembling-machine` to `assembling_machine_modules`, and so on), and numbers module slots from 0 in order. Specs cover a crafter with modules, a beacon, a plain building, and each refusal.
   - New `mod/lib/progress.lua`: `toggle`, `set_all` (a list of keys, for a sub-factory or the whole block) and `all_done`, with specs.
   - `mod/lib/format.lua`: remove `WARNING_CODES` and `warning_text` with their specs. Add element names for the checkbox and drop-down, tag parsing, number text for tooltips. Remove `block_button_name` and `parse_block_button` and their specs.
4. **GUI rewrite (`mod/scripts/gui.lua`)**
   - Replace the left list and right details pane with the drop-down and the production table.
   - Draw a sub-factory header row for each `group` entry: indentation by depth (a left margin on the recipe cell), no expand or collapse. Remove today's Area column.
   - Slot buttons are sprite-buttons with `number`, rich tooltips (localised name, rate, exact machine count) and a fallback for sprite paths the game lacks. A missing id is drawn in red, as today.
   - Keep the title bar, indicator and missing-id list. Remove the warnings and connections sections and their helpers (`add_warning`, `caption_lines`, `area_text`), and the locale keys only they used (`warning-*`, `connections`, `from`, `warnings`, `column-area`).
   - Rebuild only the table on a selection change.
   - Machine and beacon buttons carry a tag naming the block, the row key and which of the two it is, so the click handler can find the row again.
   - New `mod/scripts/cursor.lua`, the thin game-facing half of the blueprint: reads the entity prototype for `lib/blueprint.lua`, then builds the blueprint through a script inventory and the clipboard, or sets the cursor ghost, or shows the flying text. It holds no state.
5. **`mod/control.lua`**
   - Handle `on_gui_selection_state_changed` (drop-down) and `on_gui_checked_state_changed` (checkboxes).
   - Keep `done` in storage, created lazily and never written from `on_load`.
   - Pass `done` to the GUI through `ctx`.
   - Handle a click on a machine or beacon button: look the row up in the current view-model, call `scripts/cursor.lua`, and on success close the window so the paste is not blocked by an open GUI (see the risks).
6. **Test runtime and specs**
   - Extend `mod/spec/fake_game.lua` with the new events and element fields: `tags`, `number`, `items`, `selected_index`, `state`, and a recording fake for the cursor calls (`game.create_inventory`, `set_stack`, `set_blueprint_entities`, `add_to_clipboard`, `activate_paste`, `cursor_ghost`, `create_local_flying_text`).
   - `mod/spec/glue_spec.lua`: the block-list tests become drop-down tests; new specs for a click on a machine and on a beacon (what reaches the cursor, and the flying text when it cannot be placed), the checkboxes, the summary row, sub-factory headers (nesting, derived checkbox, ticking one ticks its rows) and persistence across a new snapshot.
7. **Docs and checklist**
   - `mod/README.md` (the `gui.lua` and `viewmodel.lua` rows) and `mod/CHECKLIST.md`.
   - New manual checklist items for what CI cannot check: slot-button styles, `number` formatting, tooltips on disabled buttons, scroll behaviour, and the whole blueprint path: a crafter with modules, a beacon, a plain building, an unplaceable one, pasting into the world, and doing it with the window open and after it closes.
   - [spec/ui.md](../../spec/ui.md) if it covers the in-game window.
   - Remove or adjust any backlog item this supersedes.
8. **Verification**
   - `npm run contract`, `npm test`, `npm run lint`, `npm run lint:docs`.
   - `cargo test` in `bridge/`.
   - In `mod/`: `.lua/bin/busted` and `.lua/bin/luacheck .` (toolchain from `mod/setup-lua.sh`).
   - The manual in-game pass from the checklist on Factorio 2.0.77, with `mod/tools/udp_sender.py`.

## Risks and open questions

- **Styles and API.** The slot-button style names and the rendering of `number` are unverified until someone runs the game. The plain slot-button fallback should keep the window working, only less polished.
- **Blueprint API (unverified).** `game.create_inventory`, `LuaItemStack.set_stack` and `set_blueprint_entities`, `LuaPlayer.add_to_clipboard` and `activate_paste`, and `cursor_ghost` are taken from the reference mod, which targets the same Factorio 2.0 API, but none has run in this mod. A failure should be a one-line fix in `scripts/cursor.lua`; the whole call is wrapped in `pcall` and logged once, like the other glue.
- **Window and paste mode.** The window is `player.opened`, which may stop paste mode from taking over, so the plan closes it after a successful click. If paste mode works with the window open, keep it open instead; this is decided in game.
- **Modules.** Only the machine's own and the beacon's modules go into the blueprint, in slot order. A module id the game lacks refuses the whole blueprint rather than placing a building without its modules.
- **Window size.** Seablock blocks can have dozens of rows with many ingredients each. Cap the table's height with a scroll pane and wrap ingredients at four per line, as the reference does.
- **PR split.** One PR, or a planner and contract PR followed by a mod GUI PR. Undecided.
