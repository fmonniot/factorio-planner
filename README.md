# Factorio Planner

A browser-based production planner for Factorio.

Tell it what you want to produce and how fast. It works out every recipe, intermediate, raw resource, machine count and power draw needed to get there. Cycles (Kovarex-style loops) and multi-output recipes are handled, and byproducts can be routed to recipes that consume them. Everything runs in your browser. There is no backend and no account.

**Try it:** <https://fmonniot.github.io/factorio-planner/>

## Using the planner

### 1. Pick a game data set

The selector at the top right chooses which recipes and machines the planner knows about. **Nullius** is the default. A Seablock set is also bundled. You can load your own with **Upload file…**, using a JSON export in the same format (see [Exporting game data](#exporting-game-data)).

### 2. Set your goals

In the summary panel, use **Add goal** to pick an item and enter a target rate. Click a rate to edit it. The planner then shows the target next to what the solver actually achieves, so you can see when something is short.

### 3. Read and shape the production table

Each row in the table is one recipe, with its machines, modules, beacons, power and the item flows going in and out. A few things you can do from there:

- **Choose another recipe** for an item when alternatives exist, using the recipe picker.
- **Configure machines, modules and beacons** from the machine and beacon cells. The modals show the resulting speed, productivity and consumption effects.
- **Pin a rate** on a recipe to fix its throughput instead of letting the solver pick it.
- **Click an ingredient** to find or add a recipe that produces it.
- **Choose what a byproduct does.** Click a product to make it the recipe's primary output, or toggle its policy. A recipe can also be marked as "only run to absorb byproduct", so it soaks up surplus from other recipes without ever importing its own inputs.
- **Lock an item** in the summary so the solver never imports it. Whatever it would have needed from outside then shows up as a shortfall.
- **Group recipes into subfactories** with "Wrap in subfactory", and drag rows to reorder them, including between groups.

If the plan can't be solved cleanly (a shortfall, a bad pin, too many ways to satisfy a constraint), a warnings indicator in the footer lists what the solver found.

### 4. Work with several blocks

A plan is a set of **blocks**, shown as tabs. Use the **+** tab to add one, and click a block's name to rename it. Use blocks for independent production lines, for example one per science pack.

### Saving and sharing

Your plan is saved in your browser's local storage as you work. **Export plan** downloads it as JSON. Importing a plan and sharing one by URL are not built yet. See the [roadmap](initiatives/roadmap.md).

## How it works

For each plan, the planner builds a net-flow matrix of items against recipes and solves it as a small linear program in the browser (with [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver)). Goals are hard constraints. Intermediates may be imported, but at a heavy penalty, so the solver prefers to produce them. The result is turned into machine counts and power draw per recipe. [spec/solver.md](spec/solver.md) has the full formulation.

## Development

You need Node.js 22 or newer.

```sh
npm install
npm run dev        # start the dev server
npm test           # unit tests + Playwright e2e
npm run test:unit  # unit tests only
npm run lint
npm run build      # type-check and production bundle
```

The e2e tests use Playwright. On a fresh checkout, run `npx playwright install chromium` first.

The stack is React 19, TypeScript, Vite, Zustand, Zod and Tailwind. The reasoning behind those choices is in [spec/tech-stack.md](spec/tech-stack.md).

### Exporting game data

The planner is data-driven. The recipes, machines and icons it shows come from a JSON file generated from a real Factorio install with the target mods enabled. The Nullius export in `public/data/nullius/` is committed. To regenerate it or build one for another mod set:

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

The paths above are the macOS defaults. Adjust them for your platform. [spec/data-model.md](spec/data-model.md) documents the output format.

### Repository map

| Path | What's there |
|---|---|
| `src/solver/` | The LP-based production solver |
| `src/store/` | Zustand stores: plan, game data, solver result, persistence, UI |
| `src/components/` | React UI; `factory/` holds the production table |
| `src/data/` | Zod schemas and the game data loader |
| `scripts/` | Game data export and icon tooling |
| `e2e/` | Playwright specs |
| `spec/` | How the system works today |
| `initiatives/` | Roadmap and in-flight or finished work |
| `TODO.md` | Small items and known bugs |

Contributors who use AI coding agents should also read [CLAUDE.md](CLAUDE.md), which holds the project conventions.

## Status

The planner is usable but still early. Known gaps include importing plans, sharing by URL, switching game data sets without stale plan state, and filtering recipes by tech progression. [TODO.md](TODO.md) tracks small items and bugs, and [initiatives/roadmap.md](initiatives/roadmap.md) tracks larger work.
