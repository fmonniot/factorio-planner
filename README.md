# Factorio Planner

A browser-based production planner for Factorio.

Tell it what you want to produce and how fast. It works out every recipe, intermediate, raw resource, machine count and power draw needed to get there. Cycles (Kovarex-style loops) and multi-output recipes are handled, and byproducts can be routed to recipes that consume them. Everything runs in your browser. There is no backend and no account.

**Try it:** <https://fmonniot.github.io/factorio-planner/>

## Using the planner

### 1. Pick a game data set

The selector at the top right chooses which recipes and machines the planner knows about. Nothing is loaded on your first visit: pick **Nullius** (listed first, and the best-tested set) or **Seablock**, both bundled with the app. You can also load your own with **Upload file…**, using a JSON export in the same format (see [Exporting game data](#exporting-game-data)). Your choice is remembered for the next visit.

### 2. Set your goals

In the **Products** pane of the summary panel, use the **+** button in the pane header (tooltip "Add goal") to pick an item and enter a target rate. Each goal is a slot with a small bar showing where its output goes. Select a goal (click it) to see its target next to what the solver actually achieves, so you can see when something is short; click the target, or double-click the slot, to edit it, and use **Find recipe** in the detail strip below the slots to open the recipe picker and add a recipe that produces it. Right-click a goal to remove it.

### 3. Read and shape the production table

Each row in the table is one recipe, with its machines, modules, beacons, power and the item flows going in and out. A few things you can do from there (the row's pin, absorb, wrap and remove actions are in a menu you get by right-clicking the recipe icon):

- **Add recipes** with **+ Add recipe** below the table. To switch a row to an alternative recipe for the same product, open its machine cell, open the machine picker and choose from the **Alternate recipe** list (this resets the row's modules and beacons).
- **Configure machines, modules and beacons** from the machine and beacon cells. The modals show the resulting speed, productivity and consumption effects.
- **Pin a rate** on a recipe to fix its throughput instead of letting the solver pick it.
- **Click an ingredient** on a row, or select it in the summary's **Ingredients** pane and use **Find recipe**, to find or add a recipe that produces it. For a raw ore or pumped fluid this offers its mining or offshore-pump recipe ("Iron ore (mining)"), so the row shows the drills or pumps you need. Without such a row the item stays a raw input. Mining assumes the base mining rate (no mining productivity research) and fluid resources a 100 % yield.
- **Choose the primary output** of a multi-output recipe by clicking one of its byproducts.
- **Right-click a byproduct** (in a row or in the summary's Byproducts pane) to add a recipe that consumes it.
- **Absorb byproducts.** A recipe can be marked as "only run to absorb byproduct from other recipes", so it soaks up surplus from other recipes without ever importing its own inputs; such rows are marked with a small badge on the recipe icon.
- **Lock an item** by selecting it in the summary's **Ingredients** pane and choosing **Forbid imports** (or right-click it), so the solver never imports it (select it and choose **Allow imports** to unlock). Whatever it would have needed from outside then shows up as a shortfall.
- **Group recipes into subfactories** with "Wrap in subfactory" (right-click a subfactory row to remove it; you are asked to confirm when it is not empty), and drag rows to reorder them, including between groups.

If the plan can't be solved cleanly (a goal with no recipe, the same recipe added twice, conflicting pins, or surplus that nothing consumes), a warnings indicator appears in the summary header, next to the /sec · /min toggle, and lists what the solver found.

### 4. Work with several blocks

A plan is a set of **blocks**, shown as tabs. Use the **+** tab to add one and click a tab to switch to it. Rename the active block by clicking its name in the summary header, or right-click a tab for **Rename**, **Duplicate** and **Delete**. Use blocks for independent production lines, for example one per science pack.

Blocks can also feed one another. Right-click an item in a block's **Ingredients** pane (or select it and choose **Receive from…**) and pick the block that should supply it: the block that was importing the item now receives it from there, shown as a segment in the source block's colour on the item's bar. The supplying block shows where its output goes on the product's bar. A block always uses its own recipes first, so a connection only covers what the block would otherwise import; if the source offers less than needed, the slot is marked limited and the rest stays an import. Right-click the source's segment to remove the connection. Every block has its own colour, picked automatically.

The **Block graph** button in the top bar shows all blocks and their connections. Click a block to open it. To connect from the supplying side, click the **→** on the source block, then the block that should receive the item, then the item; the **×** on an edge label removes that connection.

### 5. Plan horizon

**Horizon** in the top bar limits the recipes the pickers offer, and the products you can add as goals, to those unlocked by the technologies you choose and their prerequisites, plus the recipes available at game start. Hidden recipes are ignored when deciding which goals are offered. Use it to plan the first science packs without being offered space-science recipes. The horizon also limits machines, modules, beacons and the default machine: a row without an explicit machine uses the best machine inside the horizon, and a recipe with no machine inside it shows 0 machines and no power (its rates are unchanged). Recipes, goals, machines, modules and beacons already in your plan keep working and are marked when they fall outside the horizon. The horizon is saved with the plan, and the button only appears for data sets that include technology data.

**Tech tree** opens the technology tree: cards with icons and research cost in columns by prerequisite depth, coloured researched, available or locked from your horizon. Drag to pan, scroll to zoom, **Fit** shows the whole tree. Click a technology to research up to it (it becomes a horizon target, with all its prerequisites); click again to remove it, or use **Clear horizon**. Hovering a recipe in the recipe picker also shows the technology that unlocks it, with its science packs and count.

### Saving and sharing

Your plan is saved in your browser's local storage as you work, separately for each game data set: switching data sets swaps the plan, and switching back restores it. **Export plan** downloads it as JSON, and **Import plan** loads such a file back, replacing the current data set's plan after a confirmation. Sharing a plan by URL is not built yet. See the [backlog](initiatives/backlog.md).

## How it works

For each block, the planner builds a net-flow matrix of items against recipes and solves it as a small linear program in the browser (with [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver)). Goals are hard constraints. Intermediates may be imported, but at a heavy penalty, so the solver prefers to produce them. Blocks are solved in dependency order, and a block that receives an item from another block takes it only where its own recipes cannot cover the need. The result is turned into machine counts and power draw per recipe. [spec/solver.md](spec/solver.md) has the full formulation.

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
# 1. Dump Factorio's prototype data with the mods active
factorio --dump-data

# 2. Convert the dump into game-data.json and extract icons
node scripts/build-game-data.js \
  --dump      ~/Library/Application\ Support/factorio/script-output/data-raw-dump.json \
  --factorio-dir /Applications/factorio.app/Contents \
  --mods-dir  ~/Library/Application\ Support/factorio/mods \
  --icons-out public/data/nullius/icons \
  --output    public/data/nullius/game-data.json
```

To add technology data (including research cost and technology icons, written to `<bundle dir>/icons/technology/`) to an existing bundle without re-exporting recipes and the other icons (the dump must come from the same mod set as the bundle; this is checked), use patch mode:

```sh
node scripts/build-game-data.js --patch-technologies \
  --dump ... --factorio-dir ... --mods-dir ... \
  --output public/data/kompetenz-seablock/game-data.json
```

`--patch-extraction` adds the mining and offshore-pump recipes, and the drills and pumps that run them, to an existing bundle the same way (same mod-set check, safe to re-run); it also refreshes `placeResult`. Machine icons already on disk are never overwritten, because a drill or pump can share its id with an item whose icon is already written. The Seablock bundle has them; the Nullius bundle does not yet.

Patch mode also writes `placeResult` on the items that place a machine or beacon, which the horizon uses to gate machines and beacons (bundles without it match machines to the item with the same id).

`--patch-names` works the same way but recomputes only the `name` fields (locale placeholders such as `__ITEM__x__` are expanded); it applies the same mod-set check. It also refreshes the names of extraction recipes (`<resource> (mining)`, `<fluid> (offshore pump)`) and of drills and pumps.

The paths above are the macOS defaults. Adjust them for your platform. [spec/data-model.md](spec/data-model.md) documents the output format.

### Repository map

| Path | What's there |
|---|---|
| `src/main.tsx` | Entry point: wires persistence and the debounced auto-solve, mounts the UI |
| `src/solver/` | The LP-based production solver (`build.ts`, `solve.ts`, `effects.ts`, `blockGraph.ts` for block ordering and cycle checks, `index.ts`) |
| `src/store/` | Zustand stores: blocks/plan, game data, solver result, persistence, UI, and the connection rules (`connections.ts`) |
| `src/components/` | React UI; `factory/` holds the summary panel (`summaryRows.ts` groups its pane rows), the production table and the block connection menu (`ConnectionMenu.tsx`) and the block graph (`BlockGraph.tsx`); `summarySegments.ts` turns each pane item into allocation segments, drawn by `SummarySlot.tsx`, `SummaryDetailStrip.tsx` and `SummaryPane.tsx`; `subPlanContents.ts` counts a sub-factory's contents for the removal prompt |
| `src/data/` | Zod schemas (`schema.ts`, the source of truth for types), types, block colours (`blockColors.ts`), the game data loader, research-horizon rules and the technology-tree layout |
| `src/utils/` | Small helpers (icon URLs, pan/zoom transform maths, block-graph layout) |
| `scripts/build-game-data.js` | Converts a `--dump-data` dump into `game-data.json` and extracts icons |
| `scripts/icon-compositor.js` | Composites layered icons (used by the build script) |
| `scripts/locale.js` | Locale parsing and name resolution (used by the build script) |
| `scripts/place-results.js` | Marks the items that place a machine or beacon (`placeResult`; used by the build script) |
| `scripts/extraction.js` | Exports mining and offshore-pump recipes and the drills and pumps that run them (used by the build script) |
| `scripts/energy.js` | Energy-string parsing and energy-type inference shared by the export scripts |
| `scripts/technologies.js` | Exports technologies and starting recipes from a dump (used by the build script) |
| `scripts/build-icons.mjs` | `postbuild` step: WebP and optimised PNG icons in `dist/data` |
| `scripts/check-doc-links.mjs` | `lint:docs`: fails on broken relative links and missing repo paths in Markdown |
| `scripts/__tests__/` | Tests for the icon compositor (golden images), the technology, extraction and place-result exports, locale resolution and bundled-name checks |
| `public/data/` | Bundled datasets: `nullius/` and `kompetenz-seablock/`, each with `game-data.json` and `icons/` |
| `e2e/` | Playwright specs and fixtures (`block-connection.spec.ts` covers block connections, `block-graph.spec.ts` the block graph, `summary-panes-many-items.spec.ts` the summary panes with many items using `fixtures/summary-many-items.json`, `block-color.spec.ts` block colours, `support/summary.ts` the slot and detail-strip helpers) |
| `spec/` | How the system works today |
| `initiatives/` | Backlog, in-flight initiatives and the archive of finished ones |
| `.github/workflows/` | CI (lint, doc links, unit, e2e, build on PRs) and GitHub Pages deploy on release |
| `CLAUDE.md` | Project conventions for AI coding agents |

Contributors who use AI coding agents should also read [CLAUDE.md](CLAUDE.md), which holds the project conventions.

## Status

The planner is usable but still early. Known gaps include sharing by URL. The [backlog](initiatives/backlog.md) tracks known bugs, small items and larger work.
