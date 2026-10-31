# Factorio Planner

A browser-based production planner for Factorio.

Tell it what you want to produce and how fast. It works out every recipe, intermediate, raw resource, machine count and power draw needed to get there. Cycles (Kovarex-style loops) and multi-output recipes are handled, and byproducts can be routed to recipes that consume them. Everything runs in your browser. There is no backend and no account.

**Try it:** <https://fmonniot.github.io/factorio-planner/>

## Using the planner

### 1. Pick a game data set

Open the workspace button at the top right (it reads **Choose game data** until you pick one) to choose which recipes and machines the planner knows about. Nothing is loaded on your first visit: pick **Nullius** (listed first, and the best-tested set) or **Seablock**, both bundled with the app. You can also load your own with **Upload file…**, using a JSON export in the same format (see [Exporting game data](#exporting-game-data)). The current data set is checked in its menu, and shown under the plan name on the button, and your choice is remembered for the next visit.

### 2. Set your goals

In the **Products** pane of the summary panel, use the **+** button in the pane header (tooltip "Add product") to pick an item and enter an extra output rate (leave the amount empty to make the item only when other blocks request it). Each product is a slot with a small bar showing where its output goes. Select a product (click it) to see its extra output and what other blocks request next to what the solver actually achieves, so you can see when something is short and where the shortfall comes from; click the extra output, or double-click the slot, to edit it (clear it to remove it), use **+ Extra output** or **Remove extra** to add or drop it, and use **Find recipe** in the detail strip below the slots to open the recipe picker and add a recipe that produces it. **Remove product** (also in the right-click menu) removes the product; if other blocks use it, you are asked to confirm first.

### 3. Read and shape the production table

Each row in the table is one recipe, with its machines, modules, beacons, power and the item flows going in and out; the Ingredients header shows the block's total power draw. A few things you can do from there (the row's pin, absorb, wrap, area and remove actions are in a menu you get by right-clicking the recipe icon):

- **Add recipes** with the **+** button in the table header's left (reorder) column (or **+ Add recipe** in an empty block). To switch a row to an alternative recipe for the same product, open its machine cell, open the machine picker and choose from the **Alternate recipe** list (this resets the row's modules and beacons). The recipe picker greys out recipes the area (or, in a block without areas, the block) already has.
- **Configure machines, modules and beacons** from the machine and beacon cells. The modals show the resulting speed, productivity and consumption effects.
- **Pin a rate** on a recipe to fix its throughput instead of letting the solver pick it.
- **Plan power.** In a data set with power data (Seablock), set a goal of **Electricity** from the **Power** tab of the product picker (the amount is in MW) and add a generator recipe, for example "Steam engine (Steam)"; click its Steam ingredient to add a boiler recipe on the fuel you choose, one recipe per fuel. The table shows how many engines, boilers and solar panels (at 70 % of peak) you need, and the fuel and water they take. Electricity is always shown in W / kW / MW / GW. Steam temperature is not checked: a low-temperature boiler can feed a high-temperature engine, so pick boilers and engines of the same tier yourself. Grids, accumulators and heat or reactor power are not modelled.
- **Click an ingredient** on a row, or select it in the summary's **Ingredients** pane and use **Find recipe**, to find or add a recipe that produces it. For a raw ore or pumped fluid this offers its mining or offshore-pump recipe ("Iron ore (mining)"), so the row shows the drills or pumps you need. Without such a row the item stays a raw input. Mining assumes the base mining rate (no mining productivity research) and fluid resources a 100 % yield.
- **Read fluid temperatures.** Ingredient tiles show the fluid temperature a recipe requires (e.g. ≥95°C), when it has one.
- **Choose the primary output** of a multi-output recipe by clicking one of its byproducts. In a block with areas, the primary output is what the row builds for its own area first.
- **Right-click a byproduct** (in a row or in the summary's Byproducts pane) to add a recipe that consumes it.
- **Absorb byproducts.** A recipe can be marked as "only run to absorb byproduct from other recipes", so it soaks up surplus from other recipes without ever importing its own inputs; such rows are marked with a small badge on the recipe icon.
- **Lock an item** by selecting it in the summary's **Ingredients** pane and choosing **Forbid imports** (or right-click it), so the solver never imports it (select it and choose **Allow imports** to unlock). Whatever it would have needed from outside then shows up as a shortfall.
- **Group recipes into subfactories** with "Wrap in subfactory" (right-click a subfactory row to rename or remove it; you are asked to confirm removal when it is not empty), and drag rows to reorder them, including between groups. Turn on **Separate area** in a subfactory's menu to build the same recipe there as well; its rows serve it first and the **Areas in every block** matrix shows what each area receives and sends. In a block with areas, **Build also in…** in a row's menu adds the same row (machine, modules, beacon, byproduct settings) to another area that uses its product, with how much each area uses; a recipe built in several areas carries a badge with the area count whose tooltip splits its buildings per area, and **Go to row in…** jumps to its row in another area. The machine and beacon modals can **Apply to every row of this recipe**. A collapsed area shows what it receives and sends (hover or focus +N to see the rest). In a block with areas, **Duplicate to…** in a subfactory's menu copies the whole subfactory into the area you pick (areas that already have a row of one of its recipes are greyed out). In a block with areas, the **By recipe** option of the **Tree / By recipe** switch in the table header shows one line per recipe with its total buildings over every area; open a line to see its rows per area. The choice is remembered.

If the plan can't be solved cleanly (a goal with no recipe, the same recipe twice in one area, an area that can't cover its own need, conflicting pins, or surplus that nothing consumes), a warnings pill appears in the top bar, next to the rate unit toggle, and lists what the solver found.

### 4. Work with several blocks

A plan is a set of **blocks**, shown as tabs. Use the **+** tab to add one and click a tab to switch to it. Drag a tab to reorder the blocks, or right-click it for **Rename**, **Duplicate**, **Move left** / **Move right** and **Delete**, plus colour swatches to change the block's colour. With many blocks the tab strip scrolls, and an **All blocks** menu next to **+** jumps to any of them. Use blocks for independent production lines, for example one per science pack.

Blocks can also feed one another. Right-click an item in a block's **Ingredients** pane (or select it and choose **Receive from…**) and pick the block that should supply it. Under **Request <item> from** are the blocks that have the item as a product: the receiving block's needs drive the source, which makes what is needed on top of its own extra output, even when the product has no extra output. When a source cannot make everything asked of it, the extra output gives way first, then the requests served last. Under **Take existing <item> from** are the blocks that have some of the item left over (a byproduct, say): the receiving block takes only what is left. A block that takes and requests the same item asks only for what its takes will not cover. Either way the block that was importing the item now receives it from there, shown as a segment in the source block's colour on the item's bar, and the supplying block shows where its output goes on the product's bar. A block uses its own recipes first, so a connection only covers what the block would otherwise import, unless you change how the block sources that item: right-click an item chip in the production table, or an Ingredients slot (its menu shows the choice once the item has a connection or a mode), and pick one of three. **Own recipes first** is the default. **Connections first** uses the connected supply first and the block's own recipes make only the rest. **Byproducts first** uses what the block's recipes make anyway (co-products, say) and imports or connects the rest, instead of running a recipe just to make that item; a small letter badge (`B` or `C`) marks the chips of such items. If the source offers less than needed, the slot is marked limited and the rest stays an import. **Make in a new block…** in the same menu creates a block that makes the item, requests it from there and opens the recipe picker for it. Right-click the source's segment to limit how much the block takes over that connection or to remove it. A product with no extra output shows **—** until something requests it. **Make it a product** on a byproduct in the Byproducts pane turns it into a product without extra output. Making an item a product, or removing one, can change how other blocks' connections behave (takes become requests and the other way round); the planner lists what changes and asks you to confirm. Every block has its own colour, picked automatically; change it from the tab's right-click menu.

Blocks may also feed each other in a loop, for example Metals → Sciences → Ores → Metals. Connections that belong to a loop are marked **↻**, and the block graph draws the connection that closes the loop in its own lane under the blocks. A loop is solved in rounds until its flows stop changing; if it does not settle, a warning says so and the rates shown are from the last round. Blocks may also request from each other in a cycle: the cycle is solved in rounds too, and if the blocks need more of each other than the cycle can give back, a warning says so and the requests that close the loop only take what is left over (set a limit on one of them to settle it).

The **Block graph** icon button in the top bar shows all blocks and their connections. Click a block to open it. To connect from the supplying side, click the **→** on the source block, then the block that should receive the item, then the item (the list includes the source's products even when it makes none of them yet); the **×** on an edge label removes that connection. The **≤** on an edge label caps how much the receiving block takes over that connection (leave it empty for no limit), which keeps the rest of the source's output for other consumers. An edge that carries more than three items shows one summary chip; click it to list every connection with its limit and remove controls.

The **Areas in every block** icon button (shown once some block has areas) opens a balance matrix: items as rows, the block's areas as columns, with a **From outside** and a **To outside** column so that every row balances (what areas send plus what comes from outside equals what areas receive plus what goes outside). Pick a block, or **All blocks** to see the blocks side by side with what no block takes or supplies. Group the rows by category, rate or name, filter by item or area name (a block's own name keeps all its areas, and in All blocks it narrows to that block), and click an area's header to focus it: its trades with the other areas (an allocation for display, since the solver does not route items between areas), its contents, and **Show in table** to open it in its block.

### 5. Plan horizon

The **Horizon** flag in the top bar (a blue dot means targets are set; click it to list, remove or clear them, or to edit the horizon) limits the recipes the pickers offer, and the products you can add as goals, to those unlocked by the technologies you choose and their prerequisites, plus the recipes available at game start. Hidden recipes are ignored when deciding which goals are offered. Use it to plan the first science packs without being offered space-science recipes; the recipe picker's **Beyond research horizon** checkbox temporarily shows the locked recipes (dimmed) so you can preview what is coming. The horizon also limits machines, modules, beacons and the default machine: a row without an explicit machine uses the best machine inside the horizon, and a recipe with no machine inside it shows 0 machines and no power (its rates are unchanged). Recipes, goals, machines, modules and beacons already in your plan keep working and are marked when they fall outside the horizon. The horizon is saved with the plan, and the button only appears for data sets that include technology data.

The **workspace menu** also sets the **default machine** of each crafting category that has a choice (**Default machines**): rows left on "Default" use it, within the horizon, and it is saved with the plan. The Edit machine dialog badges the current default and offers **Make default** on the other machines. The menu's **Rate unit** and the **/min** button in the top bar switch rates between per minute and per second, and the checked game data set shows its Factorio version and the number of mods and recipes.

The **Tech tree** icon button opens the technology tree: cards with icons and research cost in columns by prerequisite depth, coloured researched, available or locked from your horizon. Drag to pan, scroll to zoom, **Fit** shows the whole tree. Click a technology to research up to it (it becomes a horizon target, with all its prerequisites); click again to remove it, or use **Clear horizon**. Hover or focus a technology to see the recipes and machines it unlocks. Type in the search box to find a technology by name (Enter picks the first match): the view centres on it and the card pulses briefly, without changing the horizon. Hovering a recipe in the recipe picker also shows the technology that unlocks it, with its science packs and count.

### Saving and sharing

Your plans are saved in your browser's local storage as you work. Each game data set has its own list of plans: the workspace menu at the right of the top bar lists them and switches between them, with tiles to create, rename, duplicate and delete, and switching data sets brings back that data set's active plan. **Export plan**, in the same menu, downloads the active plan as JSON, and **Import plan…** adds such a file as a new plan (a warning appears if it was exported for another data set or uses recipes or items the loaded data set lacks). Sharing a plan by URL is not built yet. See the [backlog](initiatives/backlog.md).

## How it works

For each block, the planner builds a net-flow matrix of items against recipes and solves it as a small linear program in the browser (with [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver)). Products are the hard constraints: each makes at least its extra output plus whatever other blocks request of it. Intermediates may be imported, but at a heavy penalty, so the solver prefers to produce them. Blocks are solved in dependency order, and a block that receives an item from another block takes it only where its own recipes cannot cover the need. The result is turned into machine counts and power draw per recipe. [spec/solver.md](spec/solver.md) has the full formulation.

## Development

You need Node.js 22 (the version CI uses) or newer.

```sh
npm install
npm run dev        # start the dev server
npm test           # unit tests + Playwright e2e
npm run test:unit  # unit tests only (Vitest)
npm run test:watch # unit tests in watch mode
npm run test:e2e   # Playwright e2e only (starts the dev server)
npm run lint
npm run lint:docs  # check Markdown links and repo paths
npm run build      # type-check, production bundle, then icon optimisation (postbuild)
npm run preview    # serve the production build
```

The e2e tests use Playwright. On a fresh checkout, run `npx playwright install chromium` first.

The stack is React, TypeScript, Vite, Zustand, Zod and Tailwind. The reasoning behind those choices is in [spec/tech-stack.md](spec/tech-stack.md).

### Exporting game data

The planner is data-driven. The recipes, machines and icons it shows come from a JSON file generated from a real Factorio install with the target mods enabled. The Nullius export in `public/data/nullius/` and the Seablock export in `public/data/kompetenz-seablock/` are committed. To regenerate it or build one for another mod set:

```sh
# 1. Dump Factorio's prototype data and its resolved names with the mods active
factorio --dump-data
factorio --dump-prototype-locale

# 2. Convert the dump into game-data.json and extract icons
node scripts/build-game-data.js \
  --dump      ~/Library/Application\ Support/factorio/script-output/data-raw-dump.json \
  --factorio-dir /Applications/factorio.app/Contents \
  --mods-dir  ~/Library/Application\ Support/factorio/mods \
  --icons-out public/data/nullius/icons \
  --output    public/data/nullius/game-data.json
```

The build prefers the game's own resolved English names from the `<type>-locale.json` files written by `--dump-prototype-locale` (items, fluids, entities, recipes, technologies, item groups). `--locale-dir` says where they are and defaults to the dump's directory. Any file or id that is missing falls back to the merged mod locale map, which ignores mod load order and can pick the wrong name when several mods define the same key. The normal export warns on stderr when only some of the six files are found (or a file has no names); an unparsable file stops the build. `--patch-names` requires all six files and exits non-zero otherwise (patching from the flat map alone would regress names), so pass `--locale-dir` if the dump was copied away from `script-output`.

To add technology data (including research cost and technology icons, written to `<bundle dir>/icons/technology/`) to an existing bundle without re-exporting recipes and the other icons (the dump must come from the same mod set as the bundle; this is checked), use patch mode:

```sh
node scripts/build-game-data.js --patch-technologies \
  --dump ... --factorio-dir ... --mods-dir ... \
  --output public/data/kompetenz-seablock/game-data.json
```

`--patch-extraction` adds the mining and offshore-pump recipes, and the drills and pumps that run them, to an existing bundle the same way (same mod-set check, safe to re-run); it also refreshes `placeResult`. Machine icons already on disk are never overwritten, because a drill or pump can share its id with an item whose icon is already written. The Seablock bundle has them; the Nullius bundle does not yet.

`--patch-power` adds the power generation recipes (boilers, generators, burner generators and solar panels), the machines that run them, the `power:electricity` item and the Power item group to an existing bundle the same way (same mod-set check, safe to re-run); it also refreshes `placeResult`. The Seablock bundle has them; the Nullius bundle does not yet.

`--patch-temperatures` adds the fluids' `defaultTemperature` / `maxTemperature` and the recipe products' `temperature` to an existing bundle without touching icons or names (same mod-set check, safe to re-run). It refuses a dump whose recipes do not match the bundle (more than 1 % mismatch) and leaves the generated extraction and power recipes alone. The Seablock bundle has the data; the Nullius bundle does not yet.

```sh
node scripts/build-game-data.js --patch-temperatures \
  --dump ... --factorio-dir ... --mods-dir ... \
  --output public/data/kompetenz-seablock/game-data.json
```

Patch mode also writes `placeResult` on the items that place a machine or beacon, which the horizon uses to gate machines and beacons (bundles without it match machines to the item with the same id).

`--patch-names` works the same way but recomputes only the `name` fields (from the game's resolved names, which must all be present, see `--locale-dir` above); it applies the same mod-set check. It also refreshes the names of extraction recipes (`<resource> (mining)`, `<fluid> (offshore pump)`), power recipes (`<machine> (<fuel>)`) and of drills, pumps and generation machines.

The paths above are the macOS defaults. Adjust them for your platform. [spec/data-model.md](spec/data-model.md) documents the output format.

### Repository map

| Path | What's there |
|---|---|
| `src/main.tsx` | Entry point: wires persistence and the debounced auto-solve, mounts the UI |
| `src/solver/` | The LP-based production solver (`build.ts`, `solve.ts`, `effects.ts`, `blockGraph.ts` for block ordering and loop detection, `solveCache.ts` for reusing unchanged blocks' results, `areas.ts` for the area-aware solve, `blockResult.ts` for the result pieces the plain and area solves share, `index.ts`) |
| `src/store/` | Zustand stores: blocks/plan, game data, solver result, persistence, plan list (`plansStore.ts`), UI, and the connection rules (`connections.ts`) |
| `src/components/` | React UI; the top-bar workspace menu is `WorkspaceMenu.tsx` (game data, export, import) with `PlanMenu.tsx` (its plans section; `PlanNameDialog.tsx` is the rename dialog) and `DefaultMachinesMenu.tsx` (the default machines flyout), built on `MenuButton.tsx`; `RateUnitButton.tsx` is the top-bar rate unit toggle; `TechUnlocksPopup.tsx` is the tech tree's hover popup; `useHoverPopup.ts` is the hover/focus popup timing and placement; `SegmentedControl.tsx` (the pill switches of the Areas modal, the table header and the rate unit menu item); `IconButton.tsx` (tooltip icon button) and `icons.tsx` (stroke SVG UI icons, unlike the game images in `Icon.tsx` / `TechIcon.tsx`) draw the tool buttons; `factory/` holds the summary panel (`summaryRows.ts` groups its pane rows, `AreaFlow.tsx` draws an area's in/out chips and `areaRows.ts` names areas, `AreaChipsMore.tsx` is a collapsed area's +N overflow popup, `recipeAreas.ts` maps rows to areas and recipes to rows for the table's area actions), the production table and the block connection menu (`ConnectionMenu.tsx`), the product change confirmation (`ProductChangeDialog.tsx`, with its texts in `productChangeText.ts`), the block graph (`BlockGraph.tsx`), the areas matrix (`PlanAreas.tsx` is the modal, with `BlockAreaMatrix.tsx` for one block and `AllBlocksMatrix.tsx` for every block, built by `areaMatrix.ts` and `planAreaMatrix.ts`, formatted by `matrixFormat.ts`), the by-recipe view's recipe lines (`RecipeGroupRow.tsx`) and the inline rate editor for extra outputs and connection limits (`RateInput.tsx`, floated by `ConnectionLimitEditor.tsx` for the Ingredients pane's **Limit rate…**); `summarySegments.ts` turns each pane item into allocation segments, styled by `segmentLooks.ts` and drawn by `SummarySlot.tsx`, `SummaryDetailStrip.tsx` and `SummaryPane.tsx` (`useMoreBelow.ts` drives their scroll fades); `subPlanContents.ts` counts a sub-factory's contents for the removal prompt |
| `src/data/` | Zod schemas (`schema.ts`, the source of truth for types), types, block colours (`blockColors.ts`), the sub-plan tree invariant (`subPlanTree.ts`), the game data loader, research-horizon rules, the default-machine helpers (`defaultMachines.ts`), the recipe icon choice (`recipeIcon.ts`), the electricity pseudo-item id (`electricity.ts`), the "which recipes make this item" predicates (`recipeProducts.ts`) and the technology-tree layout |
| `src/utils/` | Small helpers (icon URLs, pan/zoom transform maths, popup positioning, block-graph layout) |
| `scripts/build-game-data.js` | Converts a `--dump-data` dump into `game-data.json` and extracts icons |
| `scripts/icon-compositor.js` | Composites layered icons (used by the build script) |
| `scripts/icon-url.js` | Derives the public-relative `iconPath` prefix from the icons output directory |
| `scripts/locale.js` | Locale parsing, name resolution and the game's resolved-name lookup (used by the build script) |
| `scripts/place-results.js` | Marks the items that place a machine or beacon (`placeResult`; used by the build script) |
| `scripts/temperatures.js` | Fluid and recipe-product temperatures (used by the build script and `--patch-temperatures`) |
| `scripts/extraction.js` | Exports mining and offshore-pump recipes and the drills and pumps that run them (used by the build script) |
| `scripts/power.js` | Exports boiler, generator, burner-generator and solar-panel recipes, their machines and the electricity item (used by the build script) |
| `scripts/energy.js` | Energy-string parsing and energy-type inference shared by the export scripts |
| `scripts/technologies.js` | Exports technologies and starting recipes from a dump (used by the build script) |
| `scripts/build-icons.mjs` | `postbuild` step: WebP and optimised PNG icons in `dist/data` (cached in `.cache/icons`) |
| `scripts/check-doc-links.mjs` | `lint:docs`: fails on broken relative links and missing repo paths in Markdown |
| `scripts/__tests__/` | Tests for the icon compositor (synthetic pixel checks and golden images), the technology, extraction, power, place-result and temperature exports, the energy parsers, locale resolution, icon path derivation and bundled-name, bundled-temperature and icon-path checks |
| `public/data/` | Bundled datasets: `nullius/` and `kompetenz-seablock/`, each with `game-data.json` and `icons/` |
| `e2e/` | Playwright specs and fixtures (`block-connection.spec.ts` covers block connections, `block-requests.spec.ts` requests, take existing connections, Make in a new block and Connections first, `item-sourcing.spec.ts` the sourcing menus and Byproducts first with `fixtures/item-sourcing.json`, `request-loop.spec.ts` cycles of requests (with `fixtures/request-loop-seablock.json`), `block-graph.spec.ts` the block graph, `summary-panes-many-items.spec.ts` the summary panes with many items using `fixtures/summary-many-items.json`, `block-color.spec.ts` block colours, `separate-area.spec.ts` the Separate area toggle with `fixtures/separate-area.json`, `area-matrix.spec.ts` the areas matrix with `fixtures/area-matrix.json`, `plan-areas.spec.ts` the By recipe view with `fixtures/plan-areas.json`, `area-chips-overflow.spec.ts` the collapsed area's +N popup with `fixtures/area-chips-overflow.json`, `stranded-subplan.spec.ts` a plan saved with a sub-factory stored under another plan than its handle's with `fixtures/stranded-subplan.json`, and dragging a sub-factory into an area, `support/summary.ts` the slot and detail-strip helpers, `support/appMenu.ts` the workspace menu helpers, `power-generation.spec.ts` the Electricity goal with generator, boiler and solar rows, `plans.spec.ts` the saved plans with `support/planMenu.ts` as its plan helpers, `support/horizon.ts` the helpers that open and close the tech tree from the horizon flag) |
| `spec/` | How the system works today |
| `initiatives/` | Backlog, in-flight initiatives and the archive of finished ones |
| `.github/workflows/` | CI (lint, doc links, unit, e2e, build on PRs and pushes to `main`) and GitHub Pages deploy on release |
| `CLAUDE.md` | Project conventions for AI coding agents |

Contributors who use AI coding agents should also read [CLAUDE.md](CLAUDE.md), which holds the project conventions.

## Status

The planner is usable but still early. Known gaps include sharing by URL. The [backlog](initiatives/backlog.md) tracks known bugs, small items and larger work.
