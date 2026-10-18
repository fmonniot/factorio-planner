# Backlog

Single list of planned and possible work. When an item grows a design doc,
promote it to its own folder under `initiatives/` and link it here. Shipped
initiatives are indexed in [README.md](README.md); smaller shipped items are
in `git log`. For the timeless system specification, see [../spec/](../spec/).

Markers: `[ ]` not started · `[~]` partly done (the item says what is missing)

---

## Bugs

- [ ] **Water from an offshore pump.** Offshore pumps (and other fluid sources that are entities, not recipes) cannot produce water in a plan. Nullius is unaffected (seawater intakes are recipes); Seablock and vanilla are. The proper fix is "Mining and extraction" below.
- [ ] **`gameDataVersion` is never set.** `AppState.gameDataVersion` (`src/data/schema.ts`) is always initialised to `''` (`src/store/blockStore.ts`) and never written. Either record the loaded data set's version (useful for the per-data-set plans) or drop the field.

- [ ] **Pinned rate unit mismatch.** The solver treats `pinnedRate` as executions per minute, but `RecipeRow` displays and stores it as if it were per second. Verify and fix (found during the docs-cleanup audit).
- [ ] **`allowProductivity` not enforced by the solver.** Productivity modules can be added to recipes that disallow productivity and the solver applies them; only the Edit machine modal's effect preview honours the flag.
- [ ] **Beacon modal ignores `allowedEffects`.** `BeaconModal` offers modules without checking the beacon's `allowedEffects`.
- [ ] **Locking a raw item does nothing.** Raw items have no LP row, so `noImportItems` only affects intermediates; the summary still lets the user lock a raw ingredient.
- [ ] **Duplicate recipe nodes share one LP variable.** Two rows with the same recipe collapse into one variable; the last node's effects and pin win. Either merge them explicitly or give each node its own variable.
- [ ] **Absolute home paths in committed `iconPath`s.** Every `iconPath` in the bundled `game-data.json` files contains the exporting machine's absolute home directory. `scripts/build-game-data.js` should emit paths relative to the Factorio / mods directories.
- [ ] **`overconstrained` warns on surplus that is exported.** A source block's surplus intermediate that another block consumes still raises the `overconstrained` warning in the source.
- [ ] **Seablock science technologies show localisation keys.** In the research horizon picker (Seablock data set), about half of the science technologies display their raw key (`__ITEM__bob-advanced-logistic-science-pack__`) instead of the English name, while the others resolve (e.g. "Automation science pack"). The same placeholder appears in the horizon target chips. The localised name is not resolved for those entries in the Seablock data.

## Sharing and import

- [ ] **Import plan from JSON.** Counterpart of the existing "Export plan" button; reuse `parseAppState` (`src/data/loader.ts`) for validation.
- [ ] **Share plan via URL.** Compressed base64 in the URL, with a size warning.
- [ ] **Read-only shared view.** Depends on URL sharing.

## Planning features

- [ ] **Pull connections.** Let a consumer's demand drive the source block's goals (today connections are push only: the source's own goals set what it can offer).
- [ ] **Connect items not shown in Ingredients.** Connections can only be created from an Ingredients tile; items a block already covers cannot be connected, and goal shortfalls are deliberately not connectable (goals never receive supply).
- [ ] **Let connected supply replace an upstream import.** When a block makes X only from an imported Y, connected X is not used (the block keeps importing Y). Supply could replace that import. Today the outcome depends on the recipe ratio: with 1 Y per X supply does replace the import, with a recipe that yields more X than it consumes Y it does not (see spec/solver.md).
- [ ] **Per-connection rate caps.** Let the user limit how much a consumer may take.
- [ ] **Visual block graph.** Show blocks and their connections as a graph, and create connections from the source side.
- [ ] **Skip re-solving unchanged blocks.** Every edit re-solves all blocks (up to two LPs each); memoise per block or move the solve to a worker if large plans get slow.
- [ ] **Horizon-aware machines and modules.** Machines, modules, beacons and `defaultMachines` are not gated by research. Needs `place_result` in the export.
- [ ] **Mining and extraction.** Model miners, pumps and other resource entities (covers the offshore-pump bug properly).
- [ ] **Optimization mode.** Minimize machines or power through the LP objective.
- [ ] **Quality tiers.**

## UI / UX

- [ ] **Undo/redo in the UI.** `undo` / `redo` exist in `src/store/blockStore.ts`; no button or shortcut calls them.
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

## Data sets

- [ ] **Technology data for the Nullius bundle.** `public/data/nullius/game-data.json` has no `technologies` or `startingRecipes`, so the horizon button is hidden for Nullius. Switch to the Nullius mod set, run `factorio --dump-data`, then `node scripts/build-game-data.js --patch-technologies` with `--output public/data/nullius/game-data.json` (see the README). Check that recipes unlocked only by scripts are acceptable as outside every horizon.
- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates: vanilla Factorio 2.0.

## Tests and tooling

- [ ] **Encode the 6 corpus cases as solver unit tests.** [spec/test-corpus.md](../spec/test-corpus.md) is the solver's ground truth, but its cases were deleted with the v1 solver (`f55c2db`) and never ported. Multi-output (case 3), the Kovarex cycle (case 4), probability (case 5) and `ignoredByProductivity` (case 6) have no solver test at all. Expected values still match today's `solve()` output.
- [ ] **Solver integration test on real data.** A `src/solver/index.integration.test.ts` that runs the solver against `public/data/nullius/game-data.json` with corpus-like goals, to catch what synthetic tests cannot (missing machine for a category, unexpected classifications, real crafting speeds). An earlier version existed and was deleted in `f55c2db`. The data file is committed, so no skip gate is needed.
- [ ] **CI on pushes to `main`.** `.github/workflows/test.yml` runs on pull requests and `v*` tags only, so a direct push or merge result on `main` is never tested.
- [ ] **Dead code: `MachinePopover` / `ModulePopover`.** Neither component is rendered anywhere (their files' `MachineCell`, `ModuleCell` and `isModuleAllowed*` exports are used). Delete the components (and the `ModulePopover` cases in `ModulePopover.test.tsx`), or move the live exports to better-named files.

## Ideas (not planned)

- Sankey / flow diagram view
- Plan diffing
- Light theme / theme toggle (the UI is dark-only)
- Named plan links (needs a server; conflicts with "no backend")
