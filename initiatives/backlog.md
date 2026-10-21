# Backlog

Single list of planned and possible work. When an item grows a design doc,
promote it to its own folder under `initiatives/` and link it here. Shipped
initiatives are indexed in [README.md](README.md); smaller shipped items are
in `git log`. For the timeless system specification, see [../spec/](../spec/).

Markers: `[ ]` not started · `[~]` partly done (the item says what is missing)

---

## Bugs


- [ ] **Beacon modal ignores `allowedEffects`.** `BeaconModal` offers modules without checking the beacon's `allowedEffects`.
- [ ] **Locking a raw item does nothing.** Raw items have no LP row, so `noImportItems` only affects intermediates; the summary still lets the user lock a raw ingredient. Add an extraction row to make an ore lockable.
- [ ] **Duplicate recipe nodes share one LP variable.** Two rows with the same recipe collapse into one variable; the last node's effects and pin win. Either merge them explicitly or give each node its own variable.
- [ ] **`overconstrained` warns on surplus that is exported.** A source block's surplus intermediate that another block consumes still raises the `overconstrained` warning in the source.

## Sharing

- [ ] **Share a plan by URL.** Encode a plan in a link so it can be shared without exchanging a file; import would open it as a new plan, with the same data-set check as a file import. Size measurements and a proposed design are in [share-by-url/](share-by-url/plan.md).

## Planning features

- [ ] **Pull connections.** Let a consumer's demand drive the source block's goals (today connections are push only: the source's own goals set what it can offer).
- [ ] **Connect items not shown in Ingredients.** Connections can only be created for items in the target block's Ingredients pane (from a slot or from the block graph); items a block already covers cannot be connected, and goal shortfalls are deliberately not connectable (goals never receive supply).
- [ ] **Let connected supply replace an upstream import.** When a block makes X only from an imported Y, connected X is not used (the block keeps importing Y). Supply could replace that import. Today the outcome depends on the recipe ratio: with 1 Y per X supply does replace the import, with a recipe that yields more X than it consumes Y it does not (see spec/solver.md).
- [ ] **Per-connection rate caps.** Let the user limit how much a consumer may take.
- [ ] **Skip re-solving unchanged blocks.** Every edit re-solves all blocks (up to two LPs each); memoise per block or move the solve to a worker if large plans get slow.
- [ ] **Machine picker: beyond the research horizon.** Add a collapsed "Beyond research horizon" section so a row with no machine in the horizon can pick one explicitly (the row is then flagged).
- [ ] **Recipe picker "Made in" tooltip ignores the horizon.** It lists every machine of the category.
- [ ] **Mining productivity research and fluid-resource yield.** Extraction rows use the drill's base mining speed and a 100 % yield for fluid resources (crude oil and similar), as the game's resource entity yield and depletion are not modelled. Mining productivity research and a drill's base `effect_receiver` are ignored too.
- [ ] **Multi-tab safety for the plan list.** Each tab keeps the plan index in memory and writes it whole, and nothing listens for `storage` events, so with two tabs open one tab's write can drop plans the other created (the plan keys stay but no index lists them). Listen for `storage` events (or re-read the index before each write) and merge.
- [ ] **Optimization mode.** Minimize machines or power through the LP objective.
- [ ] **Quality tiers.**

## UI / UX

- [ ] **Block counts in the plan list.** Show each plan's block count next to its name in the workspace menu. `PlanEntry` only has `id` and `name`; counts for inactive plans need reading each stored plan (or storing the count in the index).
- [ ] **Default block colour from the block's icon.** Derive a new block's default colour from its first goal's icon. Open question: the icon changes with goals, so decide whether the colour is fixed at creation.
- [~] **Block colour in block graph.** Block tabs show the colour as a stripe across the top; block graph nodes and edges do not show it yet, so they do not match the summary bars.
- [ ] **Undo/redo in the UI.** `undo` / `redo` exist in `src/store/blockStore.ts`; no button or shortcut calls them. Connection edits made on a non-active block (block graph) are recorded in the consumer's history, but `undo` / `redo` act on the active block only; the UI should account for this (e.g. switch to the edited block, or make the graph's edits undoable from the graph).
- [ ] **Rename sub-blocks (subfactories).** `renameSubPlan` exists in the store; no component calls it.
- [ ] **Default machines flyout: grid keyboard navigation.** Up / Down inside the flyout walk every machine radio in one list (hundreds of stops in Seablock). Navigate it as a grid instead: Up / Down between category rows, Left / Right within a row.
- [ ] **Keyboard navigation.** Arrow keys and Enter in the pickers; shortcuts for add goal, undo, redo. (Escape already closes modals, popovers and pickers.)
- [~] **Solver warnings on rows.** Warnings show in the top-bar popover (`WarningsPopover`); they are not yet marked on the affected recipe rows.
- [ ] **Localised crafting-category names.** The default-machines flyout and the edit-machine modal label categories from their id (`categoryLabel` in `src/data/defaultMachines.ts`); `scripts/locale.js` parses entity/item names only. Extract category names (or derive from the machines that craft them) and use them instead.
- [ ] **Beacons: several beacon types per recipe.** `RecipeNode.beaconConfig` holds a single beacon config today.
- [ ] **Beacons: enforce module restrictions** (e.g. no productivity in Nullius beacons — verify in game first). `BeaconModal` lists every non-hidden module.
- [ ] **Rate-changed highlight.** Briefly highlight rows whose rate changed after a solve.
- [ ] **Responsive layout.** Usable production table on narrow screens.
- [ ] **Drag-and-drop goal ordering.**
- [ ] **Byproduct menu and summary strip: hide "Add consumer recipe…" / "Find recipe" when nothing matches the item.** The byproduct menu is always offered; when no recipe takes the byproduct as an ingredient (or every consumer is outside the research horizon) the picker opens empty. The summary strip's **Find recipe** action (Products and Ingredients) has the same flaw: for raw items, or when every producer is outside the research horizon, it opens an empty "Add recipe" picker. Disable or hide the action in those cases.
- [ ] **Fluid temperature indicator.** Fluids show their temperature nowhere in the UI (tiles, goals, pickers, production table). The schema carries `minimumTemperature` / `maximumTemperature` on fluids, but no component reads them and the solver ignores them.
- [ ] **Item hover panel.** The production table have no hover panel for items; one could list the item's producing recipes and their unlocking technologies (reuse `recipeUnlock` in `src/data/horizon.ts` and `TechCost`).
- [ ] **Make sub-factory removal undoable.** `removeSubPlan` in `src/store/blockStore.ts` uses `set` directly instead of a `Command`, so removing a sub-factory (and its contents) cannot be undone.

## Data sets

- [ ] **Technology data for the Nullius bundle.** Patch mode now also writes research cost and technology icons. `public/data/nullius/game-data.json` has no `technologies` or `startingRecipes`, so the horizon button is hidden for Nullius. Switch to the Nullius mod set, run `factorio --dump-data`, then `node scripts/build-game-data.js --patch-technologies` with `--output public/data/nullius/game-data.json` (see the README). Check that recipes unlocked only by scripts are acceptable as outside every horizon. The same patch must also write `placeResult` (Nullius needs it for machine gating; 63 of its 136 machines have no same-id item). The bundle's names also contain Factorio placeholders (12 items, 12 recipes, e.g. `bob-storage-tank-2` shows `__ENTITY__storage-tank__ 2`); with a dump and mod list matching the bundle's mod set (nullius 2.0.4) run `--patch-technologies` then `--patch-names` and empty the Nullius list in `scripts/__tests__/bundle-names.test.js`. The re-dump must also run `factorio --dump-prototype-locale` so `--patch-names` uses the game's resolved names. The same re-dump must be followed by `--patch-extraction` (the Nullius bundle has no mining or offshore-pump recipes yet, so its ores have no producer).
- [ ] **Icon layers with `tint` alpha 0 render dark.** `compositeIconLayers` draws additive highlight/light layers (tint alpha 0) with normal `over` blending, so some icons come out almost black (e.g. technologies `advanced-material-processing-2/3/4`; about 165 bundled technologies and 397 bundled items have such layers). Predates the tech tree.
- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates: vanilla Factorio 2.0.

## Tests and tooling

- [ ] **`EditMachineModal` module-count tests.** `EditMachineModal.test.tsx` only removes a module of count 1. Add cases for decrementing a module that stays (count 2 → 1), adding one, and the slot-usage text (`2/4`); the cases that covered this logic lived in the deleted `ModulePopover.test.tsx` and only exercised dead code.

## Ideas (not planned)

- Sankey / flow diagram view
- Tech tree search / jump-to technology (the tree is now the only place to pick horizon targets, so finding a technology by name means panning)
- Show research trigger conditions on trigger technologies
