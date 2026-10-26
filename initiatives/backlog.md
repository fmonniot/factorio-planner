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
- [ ] **A block can be given a product it already receives.** `addProduct` (`src/store/blockStore.ts`) accepts a product for an item the block takes from another block, and `productChangeEffects` only looks at other blocks' connections, so there is no warning. Later requests for that item to the block are silently ignored as `source-receives`. Warn when adding the product, or ask whether to drop the incoming connection.
- [ ] **Locking a raw item does nothing.** Raw items have no LP row, so `noImportItems` only affects intermediates; the summary still lets the user lock a raw ingredient. Add an extraction row to make an ore lockable.
- [ ] **`overconstrained` warns on surplus that is exported.** A source block's surplus intermediate that another block consumes still raises the `overconstrained` warning in the source.
- [ ] **Other absolute tolerances can report noise at large flows.** The absolute `FLOW_TOLERANCE` comparisons (`src/solver/index.ts` offers and the pass-2 residual, `src/store/connections.ts`) can also report LP noise at large flows. `summarySegments.ts` too: the byproduct tile gate is relative, but its segment checks (`kept`, `left`, etc.) still use the absolute `FLOW_TOLERANCE`. Make them relative to the flow like `sameRate`.

## Sharing

- [ ] **Share a plan by URL.** Encode a plan in a link so it can be shared without exchanging a file; import would open it as a new plan, with the same data-set check as a file import. Size measurements and a proposed design are in [share-by-url/](share-by-url/plan.md).

## Planning features

- [ ] **Choose who is served first in a loop.** Consumers that compete for one offer inside a loop are served in loop member order (the entry block first, then breadth-first, see spec/solver.md#loops). Let the user set a priority.
- [~] **Let connected supply replace an upstream import.** When a block makes X only from an imported Y, connected X is not used (the block keeps importing Y). Supply could replace that import. Today the outcome depends on the recipe ratio: with 1 Y per X supply does replace the import, with a recipe that yields more X than it consumes Y it does not (see spec/solver.md). **Use connections first** (per item, in the Ingredients menu) now lets supply replace the import; the default still depends on the recipe ratio.
- [ ] **Connections first with partial supply.** The request probe gives a connections-first item unlimited supply, so when its connections deliver less than the block uses, the own recipes that top it up may need inputs that were not requested (they show as imports). Make the probe aware of the real supply.
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
- [ ] **Undo/redo in the UI.** `undo` / `redo` exist in `src/store/blockStore.ts`; no button or shortcut calls them. Connection edits made on a non-active block (block graph) are recorded in the consumer's history, but `undo` / `redo` act on the active block only; the UI should account for this (e.g. switch to the edited block, or make the graph's edits undoable from the graph). **Make in a new block…** records the request in the consumer's history while the new block becomes active, so undo then acts on the new block (nothing to undo) until the user switches back.
- [ ] **Default machines flyout: grid keyboard navigation.** Up / Down inside the flyout walk every machine radio in one list (hundreds of stops in Seablock). Navigate it as a grid instead: Up / Down between category rows, Left / Right within a row.
- [ ] **Keyboard navigation.** Arrow keys and Enter in the pickers; shortcuts for add goal, undo, redo. (Escape already closes modals, popovers and pickers.)
- [ ] **Localised crafting-category names.** The default-machines flyout and the edit-machine modal label categories from their id (`categoryLabel` in `src/data/defaultMachines.ts`); `scripts/locale.js` parses entity/item names only. Extract category names (or derive from the machines that craft them) and use them instead.
- [ ] **Beacons: several beacon types per recipe.** `RecipeNode.beaconConfig` holds a single beacon config today.
- [ ] **Beacons: enforce module restrictions** (e.g. no productivity in Nullius beacons — verify in game first). `BeaconModal` lists every non-hidden module.
- [ ] **Responsive layout.** Usable production table on narrow screens.
- [ ] **Drag-and-drop goal ordering.**
- [ ] **Recipe picker: explain an empty list when opened for an item.** The byproduct menu's **Add consumer recipe…**, the summary strip's **Find recipe** (Products and Ingredients) and **Make in a new block…** stay available, but they can open the picker with nothing to choose: no recipe consumes the byproduct, the item is raw, or every matching recipe is outside the research horizon. The picker only says "No recipes match" (or, when the horizon emptied the list, "No recipes match within the research horizon (N outside it)"). Make the message name the item and the reason: no recipe produces / consumes it at all, versus some exist but are outside the horizon (pointing at **Beyond research horizon**).
- [ ] **Export fluid and product temperatures.** Only recipe ingredients carry temperature bounds (`minimumTemperature` / `maximumTemperature`, shown on recipe-row ingredient tiles). The exporter drops fluid prototypes' `default_temperature` / `max_temperature` and recipe products' `temperature` (`scripts/build-game-data.js` `normaliseProduct` and the fluid export). Exporting them needs schema fields, a spec update and a bundle re-export from a fresh dump. It would allow temperature on product tiles, goals, the summary and pickers, the recipe picker's detail panel (ingredient bounds could already be shown there with `fmtTemperatureRange`), and a warning when a producer's output temperature is outside a consumer's required range.
- [ ] **Show research trigger conditions on trigger technologies.** A technology completed by a research trigger (no lab cost) shows a bare "Trigger" on its card and nothing in the unlocks popup, because the exporter drops the condition (`technologyCost` in `scripts/technologies.js` returns null and `spec/data-model.md` says trigger conditions are not exported). Export the condition (e.g. `mine-entity`, `craft-item`, `build-entity`, `capture-spawner`, with the entity or item it names) as an optional field on `Technology` in `src/data/schema.ts`, update `spec/data-model.md`, and re-export the bundles from a fresh dump (a bundle without the field keeps the bare "Trigger"). Show a short line on the card in place of "Trigger" (e.g. "Craft 10 × iron-gear-wheel", with the item icon where the condition names an item or entity) and the full text in the unlocks popup header. Condition types the planner does not know are shown as "Trigger".
- [ ] **Make sub-factory removal undoable.** `removeSubPlan` in `src/store/blockStore.ts` uses `set` directly instead of a `Command`, so removing a sub-factory (and its contents) cannot be undone.

## Data sets

- [ ] **Technology data for the Nullius bundle.** Patch mode now also writes research cost and technology icons. `public/data/nullius/game-data.json` has no `technologies` or `startingRecipes`, so the horizon button is hidden for Nullius. Switch to the Nullius mod set, run `factorio --dump-data`, then `node scripts/build-game-data.js --patch-technologies` with `--output public/data/nullius/game-data.json` (see the README). Check that recipes unlocked only by scripts are acceptable as outside every horizon. The same patch must also write `placeResult` (Nullius needs it for machine gating; 63 of its 136 machines have no same-id item). The bundle's names also contain Factorio placeholders (12 items, 12 recipes, e.g. `bob-storage-tank-2` shows `__ENTITY__storage-tank__ 2`); with a dump and mod list matching the bundle's mod set (nullius 2.0.4) run `--patch-technologies` then `--patch-names` and empty the Nullius list in `scripts/__tests__/bundle-names.test.js`. The re-dump must also run `factorio --dump-prototype-locale` so `--patch-names` uses the game's resolved names. The same re-dump must be followed by `--patch-extraction` (the Nullius bundle has no mining or offshore-pump recipes yet, so its ores have no producer).
- [ ] **Icon layers with `tint` alpha 0 render dark.** `compositeIconLayers` draws additive highlight/light layers (tint alpha 0) with normal `over` blending, so some icons come out almost black (e.g. technologies `advanced-material-processing-2/3/4`; about 165 bundled technologies and 397 bundled items have such layers). Predates the tech tree.
- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates: vanilla Factorio 2.0.

## Tests and tooling
