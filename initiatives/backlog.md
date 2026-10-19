# Backlog

Single list of planned and possible work. When an item grows a design doc,
promote it to its own folder under `initiatives/` and link it here. Shipped
initiatives are indexed in [README.md](README.md); smaller shipped items are
in `git log`. For the timeless system specification, see [../spec/](../spec/).

Markers: `[ ]` not started · `[~]` partly done (the item says what is missing)

---

## Bugs


- [ ] **Pinned rate unit mismatch.** The solver treats `pinnedRate` as executions per minute, but `RecipeRow` displays and stores it as if it were per second. Verify and fix (found during the docs-cleanup audit).
- [ ] **`allowProductivity` not enforced by the solver.** Productivity modules can be added to recipes that disallow productivity and the solver applies them; only the Edit machine modal's effect preview honours the flag.
- [ ] **Beacon modal ignores `allowedEffects`.** `BeaconModal` offers modules without checking the beacon's `allowedEffects`.
- [ ] **Locking a raw item does nothing.** Raw items have no LP row, so `noImportItems` only affects intermediates; the summary still lets the user lock a raw ingredient. Add an extraction row to make an ore lockable.
- [ ] **Duplicate recipe nodes share one LP variable.** Two rows with the same recipe collapse into one variable; the last node's effects and pin win. Either merge them explicitly or give each node its own variable.
- [ ] **Absolute home paths in committed `iconPath`s.** Every `iconPath` in the bundled `game-data.json` files contains the exporting machine's absolute home directory. `scripts/build-game-data.js` should emit paths relative to the Factorio / mods directories.
- [ ] **`overconstrained` warns on surplus that is exported.** A source block's surplus intermediate that another block consumes still raises the `overconstrained` warning in the source.

## Sharing and import

- [ ] **Record the data set in exported plans.** Export does not record which data set a plan was made for; stamping the data-set id would let import warn on a mismatch instead of only listing unknown ids (changes the export format).
- [ ] **Read-only shared view.** Depends on URL sharing.

## Planning features

- [ ] **Pull connections.** Let a consumer's demand drive the source block's goals (today connections are push only: the source's own goals set what it can offer).
- [ ] **Connect items not shown in Ingredients.** Connections can only be created for items in the target block's Ingredients pane (from a tile or from the block graph); items a block already covers cannot be connected, and goal shortfalls are deliberately not connectable (goals never receive supply).
- [ ] **Let connected supply replace an upstream import.** When a block makes X only from an imported Y, connected X is not used (the block keeps importing Y). Supply could replace that import. Today the outcome depends on the recipe ratio: with 1 Y per X supply does replace the import, with a recipe that yields more X than it consumes Y it does not (see spec/solver.md).
- [ ] **Per-connection rate caps.** Let the user limit how much a consumer may take.
- [ ] **Skip re-solving unchanged blocks.** Every edit re-solves all blocks (up to two LPs each); memoise per block or move the solve to a worker if large plans get slow.
- [ ] **Machine picker: beyond the research horizon.** Add a collapsed "Beyond research horizon" section so a row with no machine in the horizon can pick one explicitly (the row is then flagged).
- [ ] **Recipe picker "Made in" tooltip ignores the horizon.** It lists every machine of the category.
- [ ] **Mining productivity research and fluid-resource yield.** Extraction rows use the drill's base mining speed and a 100 % yield for fluid resources (crude oil and similar), as the game's resource entity yield and depletion are not modelled. Mining productivity research and a drill's base `effect_receiver` are ignored too.
- [ ] **Optimization mode.** Minimize machines or power through the LP objective.
- [ ] **Quality tiers.**

## UI / UX

- [ ] **Undo/redo in the UI.** `undo` / `redo` exist in `src/store/blockStore.ts`; no button or shortcut calls them. Connection edits made on a non-active block (block graph) are recorded in the consumer's history, but `undo` / `redo` act on the active block only; the UI should account for this (e.g. switch to the edited block, or make the graph's edits undoable from the graph).
- [ ] **Rename sub-blocks (subfactories).** `renameSubPlan` exists in the store; no component calls it.
- [ ] **Keyboard navigation.** Arrow keys and Enter in the pickers; shortcuts for add goal, undo, redo. (Escape already closes modals, popovers and pickers.)
- [~] **Solver warnings on rows.** Warnings show in the summary-header popover (`WarningsPopover`); they are not yet marked on the affected recipe rows.
- [~] **Settings.** The rate unit (sec/min) toggle exists. Missing: default machine per category, game-data info (modset, version, counts).
- [ ] **Beacons: several beacon types per recipe.** `RecipeNode.beaconConfig` holds a single beacon config today.
- [ ] **Beacons: enforce module restrictions** (e.g. no productivity in Nullius beacons — verify in game first). `BeaconModal` lists every non-hidden module.
- [ ] **Rate-changed highlight.** Briefly highlight rows whose rate changed after a solve.
- [ ] **Responsive layout.** Usable production table on narrow screens.
- [ ] **Drag-and-drop goal ordering.**
- [ ] **Auto-group recipes by tier.** (Manual grouping exists via subfactories.)
- [ ] **Remove via right-click menu, not a cross icon.** Standardize on a context (right-click) menu for removing things instead of the small cross icon. Non-exhaustive list of affected removals: subfactories, goals.
- [ ] **Byproduct menu: hide "Add consumer recipe…" when nothing consumes the item.** The menu is always offered; when no recipe takes the byproduct as an ingredient (or every consumer is outside the research horizon) the picker opens empty. Disable or hide the entry in that case.
- [ ] **Indicator for byproduct-consumer rows.** A row marked "Absorb byproduct" (`byproductConsumer`, see [spec/ui.md](../spec/ui.md)) looks like any other row, so the user can forget it only soaks up surplus. Show a small badge next to the recipe icon as a reminder, with a tooltip explaining the mode.
- [ ] **Hover tooltip: unlocking technology.** The item / recipe hover tooltip shows inputs, outputs and buildings. Add a section that names the technology that unlocks it, with its science pack type(s) shown in the UI (e.g. the pack icons), so the player can see how far away the option is. Layout is open.

## Data sets

- [ ] **Use the game's resolved names when available.** `factorio --dump-prototype-locale` writes `*-locale.json` next to the dump with Factorio's own English names; `build-game-data.js` should prefer them over its merged locale map, which ignores mod load order (e.g. tech `bob-advanced-logistic-science-pack` is exported as "Transport science pack"; in game it is "Science pack: Commercial AI implementation").
- [ ] **Technology data for the Nullius bundle.** Patch mode now also writes research cost and technology icons. `public/data/nullius/game-data.json` has no `technologies` or `startingRecipes`, so the horizon button is hidden for Nullius. Switch to the Nullius mod set, run `factorio --dump-data`, then `node scripts/build-game-data.js --patch-technologies` with `--output public/data/nullius/game-data.json` (see the README). Check that recipes unlocked only by scripts are acceptable as outside every horizon. The same patch must also write `placeResult` (Nullius needs it for machine gating; 63 of its 136 machines have no same-id item). The bundle's names also contain Factorio placeholders (12 items, 12 recipes, e.g. `bob-storage-tank-2` shows `__ENTITY__storage-tank__ 2`); with a dump and mod list matching the bundle's mod set (nullius 2.0.4) run `--patch-technologies` then `--patch-names` and empty the Nullius list in `scripts/__tests__/bundle-names.test.js`. The same re-dump must be followed by `--patch-extraction` (the Nullius bundle has no mining or offshore-pump recipes yet, so its ores have no producer).
- [ ] **Icon layers with `tint` alpha 0 render dark.** `compositeIconLayers` draws additive highlight/light layers (tint alpha 0) with normal `over` blending, so some icons come out almost black (e.g. technologies `advanced-material-processing-2/3/4`; about 165 bundled technologies and 397 bundled items have such layers). Predates the tech tree.
- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates: vanilla Factorio 2.0.

## Tests and tooling

- [ ] **Encode the 6 corpus cases as solver unit tests.** [spec/test-corpus.md](../spec/test-corpus.md) is the solver's ground truth, but its cases were deleted with the v1 solver (`f55c2db`) and never ported. Multi-output (case 3), the Kovarex cycle (case 4), probability (case 5) and `ignoredByProductivity` (case 6) have no solver test at all. Expected values still match today's `solve()` output.
- [ ] **Solver integration test on real data.** A `src/solver/index.integration.test.ts` that runs the solver against `public/data/nullius/game-data.json` with corpus-like goals, to catch what synthetic tests cannot (missing machine for a category, unexpected classifications, real crafting speeds). An earlier version existed and was deleted in `f55c2db`. The data file is committed, so no skip gate is needed.
- [ ] **CI on pushes to `main`.** `.github/workflows/test.yml` runs on pull requests and `v*` tags only, so a direct push or merge result on `main` is never tested.
- [ ] **Dead code: `MachinePopover` / `ModulePopover`.** Neither component is rendered anywhere (their files' `MachineCell`, `ModuleCell` and `isModuleAllowed*` exports are used). Delete the components (and the `ModulePopover` cases in `ModulePopover.test.tsx`), or move the live exports to better-named files.

## Ideas (not planned)

- Sankey / flow diagram view
- Tech tree search / jump-to technology
- Show research trigger conditions on trigger technologies
- Plan diffing
- Light theme / theme toggle (the UI is dark-only)
- Named plan links (needs a server; conflicts with "no backend")
