# Backlog

Single list of planned and possible work. When an item grows a design doc,
promote it to its own folder under `initiatives/` and link it here. Shipped
initiatives are indexed in [README.md](README.md); smaller shipped items are
in `git log`. For the timeless system specification, see [../spec/](../spec/).

Markers: `[ ]` not started · `[~]` partly done (the item says what is missing)

---

## Bugs


- [ ] **Beacon modal ignores `allowedEffects`.** `BeaconModal` offers modules without checking the beacon's `allowedEffects`.
- [ ] **Prevent adding a recipe already present in the block.** `blockStore.addNode` accepts a second node for the same recipe; the solver zeroes the later duplicate and warns.
- [ ] **Two products of one item keep only the last rate.** The LP keys goals by item, so when a block has two products of the same item only the last one's rate is enforced (pre-existing). A request goes to the first product of the item, so with two products the request and the enforced rate can disagree.
- [ ] **Locking a raw item does nothing.** Raw items have no LP row, so `noImportItems` only affects intermediates; the summary still lets the user lock a raw ingredient. Add an extraction row to make an ore lockable.
- [ ] **`overconstrained` warns on surplus that is exported.** A source block's surplus intermediate that another block consumes still raises the `overconstrained` warning in the source.
- [ ] **`overconstrained` warns on floating-point noise at large flows.** The surplus check in `solveBlock` (`src/solver/index.ts`, `SURPLUS_TOLERANCE = 1e-6`) is absolute, so a high-throughput intermediate can exceed it through LP rounding error alone. In a Seablock save (Metals block) `angels-liquid-molten-brass` at about 2000/min reports a surplus of 1.6e-6/min and raises the warning although production and consumption match. Make the tolerance relative to the item's flow (e.g. `max(1e-6, 1e-9 × throughput)`), add a regression test with a large-flow case, and update spec/solver.md.

## Sharing

- [ ] **Share a plan by URL.** Encode a plan in a link so it can be shared without exchanging a file; import would open it as a new plan, with the same data-set check as a file import. Size measurements and a proposed design are in [share-by-url/](share-by-url/plan.md).

## Planning features

- [~] **Requests between blocks.** Replace the per-connection push/pull choice with requests to a source's products and taking existing byproducts; a product's rate becomes optional extra output. Design and phases in [block-requests/](block-requests/plan.md). It takes over four former items: pull loops (request cycles), pulling from the graph's connect mode, subtracting push supply from pull demand, and softening a source's shortfall caused by pulled demand. Phase 1 shipped (the rename `goals` → `products`, `rate` → `extraRate`, and the request semantics, see [block-requests/phase-1b-plan.md](block-requests/phase-1b-plan.md)); phases 2–6 remain.
- [ ] **Seablock loop regression test.** Add a real-data multi-block loop (Metals → Sciences → Ores → Metals, with `sct-waste-ironcopper`) to `src/solver/index.integration.test.ts`, so loop solving is checked against the bundled data sets and not only the synthetic fixtures in `src/solver/index.test.ts`.
- [ ] **Choose who is served first in a loop.** Consumers that compete for one offer inside a loop are served in loop member order (the entry block first, then breadth-first, see spec/solver.md#loops). Let the user set a priority.
- [ ] **Limit a connection from the ingredient pane.** When an item is focused, right-click its connection bar graph and choose **Limit rate** (next to **Delete**) to cap that connection's rate without going to the block graph.
- [ ] **Let connected supply replace an upstream import.** When a block makes X only from an imported Y, connected X is not used (the block keeps importing Y). Supply could replace that import. Today the outcome depends on the recipe ratio: with 1 Y per X supply does replace the import, with a recipe that yields more X than it consumes Y it does not (see spec/solver.md).
- [ ] **Isolate a subfactory from the rest of the plan.** Sharing inputs and outputs between subfactories is the default and usually the right choice, but sometimes a subfactory should stand alone. Add an option that keeps a subfactory's imports and exports to itself: its goals and surplus do not feed other blocks, and other blocks' connections do not supply it, so it solves as a self-contained factory.
- [ ] **Machine picker: beyond the research horizon.** Add a collapsed "Beyond research horizon" section so a row with no machine in the horizon can pick one explicitly (the row is then flagged).
- [ ] **Recipe picker "Made in" tooltip ignores the horizon.** It lists every machine of the category.
- [ ] **Mining productivity research and fluid-resource yield.** Extraction rows use the drill's base mining speed and a 100 % yield for fluid resources (crude oil and similar), as the game's resource entity yield and depletion are not modelled. Mining productivity research and a drill's base `effect_receiver` are ignored too.
- [ ] **Multi-tab safety for the plan list.** Each tab keeps the plan index in memory and writes it whole, and nothing listens for `storage` events, so with two tabs open one tab's write can drop plans the other created (the plan keys stay but no index lists them). Listen for `storage` events (or re-read the index before each write) and merge.
- [ ] **Optimization mode.** Minimize machines or power through the LP objective.
- [ ] **Quality tiers.**

## UI / UX

- [ ] **Block counts in the plan list.** Show each plan's block count next to its name in the workspace menu. `PlanEntry` only has `id` and `name`; counts for inactive plans need reading each stored plan (or storing the count in the index).
- [ ] **Default block colour from the block's icon.** Derive a new block's default colour from its first goal's icon. Open question: the icon changes with goals, so decide whether the colour is fixed at creation.
- [ ] **Undo/redo in the UI.** `undo` / `redo` exist in `src/store/blockStore.ts`; no button or shortcut calls them. Connection edits made on a non-active block (block graph) are recorded in the consumer's history, but `undo` / `redo` act on the active block only; the UI should account for this (e.g. switch to the edited block, or make the graph's edits undoable from the graph).
- [ ] **Default machines flyout: grid keyboard navigation.** Up / Down inside the flyout walk every machine radio in one list (hundreds of stops in Seablock). Navigate it as a grid instead: Up / Down between category rows, Left / Right within a row.
- [ ] **Keyboard navigation.** Arrow keys and Enter in the pickers; shortcuts for add goal, undo, redo. (Escape already closes modals, popovers and pickers.)
- [~] **Solver warnings on rows.** Warnings show in the top-bar popover (`WarningsPopover`); they are not yet marked on the affected recipe rows.
- [ ] **Localised crafting-category names.** The default-machines flyout and the edit-machine modal label categories from their id (`categoryLabel` in `src/data/defaultMachines.ts`); `scripts/locale.js` parses entity/item names only. Extract category names (or derive from the machines that craft them) and use them instead.
- [ ] **Beacons: several beacon types per recipe.** `RecipeNode.beaconConfig` holds a single beacon config today.
- [ ] **Beacons: enforce module restrictions** (e.g. no productivity in Nullius beacons — verify in game first). `BeaconModal` lists every non-hidden module.
- [ ] **Rate-changed highlight.** Briefly highlight rows whose rate changed after a solve.
- [ ] **Responsive layout.** Usable production table on narrow screens.
- [ ] **Drag-and-drop goal ordering.**
- [ ] **Byproduct menu and summary strip: hide "Add consumer recipe…" / "Find recipe" when nothing matches the item.** The byproduct menu is always offered; when no recipe takes the byproduct as an ingredient (or every consumer is outside the research horizon) the picker opens empty. The summary strip's **Find recipe** action (Products and Ingredients) has the same flaw: for raw items, or when every producer is outside the research horizon, it opens an empty "Add recipe" picker. Disable the action in those cases.
- [ ] **Export fluid and product temperatures.** Only recipe ingredients carry temperature bounds (`minimumTemperature` / `maximumTemperature`, shown on recipe-row ingredient tiles). The exporter drops fluid prototypes' `default_temperature` / `max_temperature` and recipe products' `temperature` (`scripts/build-game-data.js` `normaliseProduct` and the fluid export). Exporting them needs schema fields, a spec update and a bundle re-export from a fresh dump. It would allow temperature on product tiles, goals, the summary and pickers, the recipe picker's detail panel (ingredient bounds could already be shown there with `fmtTemperatureRange`), and a warning when a producer's output temperature is outside a consumer's required range.
- [ ] **Item hover panel.** The production table have no hover panel for items; one could list the item's producing recipes and their unlocking technologies (reuse `recipeUnlock` in `src/data/horizon.ts`, `TechCost` and `recipeIconItem`).
- [ ] **Technology effects other than recipe unlocks.** The tech tree popup lists only unlocked recipes and machines. `scripts/technologies.js` exports only `unlock-recipe` effects. Exporting the others (productivity, speed, capacity bonuses) needs a schema field, spec update and a bundle re-export from a fresh dump.
- [ ] **Make sub-factory removal undoable.** `removeSubPlan` in `src/store/blockStore.ts` uses `set` directly instead of a `Command`, so removing a sub-factory (and its contents) cannot be undone.

## Data sets

- [ ] **Technology data for the Nullius bundle.** Patch mode now also writes research cost and technology icons. `public/data/nullius/game-data.json` has no `technologies` or `startingRecipes`, so the horizon button is hidden for Nullius. Switch to the Nullius mod set, run `factorio --dump-data`, then `node scripts/build-game-data.js --patch-technologies` with `--output public/data/nullius/game-data.json` (see the README). Check that recipes unlocked only by scripts are acceptable as outside every horizon. The same patch must also write `placeResult` (Nullius needs it for machine gating; 63 of its 136 machines have no same-id item). The bundle's names also contain Factorio placeholders (12 items, 12 recipes, e.g. `bob-storage-tank-2` shows `__ENTITY__storage-tank__ 2`); with a dump and mod list matching the bundle's mod set (nullius 2.0.4) run `--patch-technologies` then `--patch-names` and empty the Nullius list in `scripts/__tests__/bundle-names.test.js`. The re-dump must also run `factorio --dump-prototype-locale` so `--patch-names` uses the game's resolved names. The same re-dump must be followed by `--patch-extraction` (the Nullius bundle has no mining or offshore-pump recipes yet, so its ores have no producer).
- [ ] **Icon layers with `tint` alpha 0 render dark.** `compositeIconLayers` draws additive highlight/light layers (tint alpha 0) with normal `over` blending, so some icons come out almost black (e.g. technologies `advanced-material-processing-2/3/4`; about 165 bundled technologies and 397 bundled items have such layers). Predates the tech tree.
- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates: vanilla Factorio 2.0.

## Tests and tooling


## Ideas (not planned)

- Sankey / flow diagram view
- Tech tree search / jump-to technology (the tree is now the only place to pick horizon targets, so finding a technology by name means panning)
- Show research trigger conditions on trigger technologies
