# Technology Stack

---

## Frontend Framework: React + TypeScript

**Why React:** The UI is a tree of interactive components. React's component model maps well to recipe cards, and its ecosystem (tooling, state libraries, testing) is mature. TypeScript is mandatory — the data model has enough shape complexity that type errors at compile time are essential.

**Why not Svelte/Vue/Solid:** No strong reason against them. React is chosen for ecosystem breadth and to avoid exotic constraints, not as a rejection of alternatives.

---

## State Management: Zustand

**Why Zustand:** The application state has two layers:
1. **Plan state** — goals, node overrides, machine selections. Needs undo/redo and JSON serialization.
2. **Solver result** — derived, transient, recomputed after every plan change.

Zustand's minimal API handles both without boilerplate. Redux Toolkit is viable but heavier than needed.

**Undo/redo:** Implemented via a simple command stack in the plan store. Each mutation is a reversible action. The solver result is not part of the undo stack — it is recomputed after undo/redo.

---

## Solver: Pure TypeScript, Client-Side

The solver runs entirely in the browser with no server round-trip. This keeps the app fully static and ensures it works offline.

**LP engine:** [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver) — a pure-JS simplex implementation. The solver builds an elastic LP per plan: hard constraints on goals, slack-extended constraints on intermediates, equality constraints for pinned recipes. Problems are small (< 200 variables for any realistic plan), so performance is not a concern. See [solver.md](solver.md) for the formulation.

**No WASM for v1.** If profiling later shows the solver is slow for very large modded plans, it can be moved to a Web Worker with a message-passing interface.

---

## Styling: Tailwind CSS

Tailwind's utility classes enable fast iteration without maintaining a parallel CSS file. The design is information-dense (helmod-style), and Tailwind's spacing/color system handles that well.

Component library: none for v1. Recipe cards and the item picker are custom components.

---

## Build Tooling: Vite

Fast dev server with HMR, native ESM, and simple configuration. No custom webpack config needed.

---

## Testing

| Layer | Tool | Scope |
|---|---|---|
| Solver unit tests | Vitest | LP construction, solve correctness, cycle handling, slack reporting, known recipe chains |
| Component tests | React Testing Library + Vitest | Item picker, recipe row interactions, modal flows, goal CRUD |
| Integration | Vitest (skip-if) | Real Nullius `game-data.json` loading |
| E2E | Playwright | Full plan creation flows |

Solver tests cover all six corpus cases (see [test-corpus.md](test-corpus.md)) plus integration scenarios for the LP-specific machinery: byproduct-consumer recipes, pinned rates, intermediate slack reporting, overconstrained surplus, and infeasible pins.

---

## Data Pipeline

Game data is not bundled in source. The primary pipeline runs `factorio --dump-data` (no GUI needed) to emit `data-raw-dump.json`, then a Node script post-processes it into the `GameData` shape the app expects.

**Build script** (`scripts/build-game-data.js`): reads the raw dump, walks the mods directory for icons, resolves locale strings, classifies machines, exports beacons, and emits `data/samples/nullius/game-data.json` plus a sprite of icons under `public/data/<mod>/icons/`.

**Verify script** (`scripts/verify-game-data.js`): report-only diff between the new and a backup `game-data.json`, used after re-exports.

**Legacy fallback:** `scripts/factorio-planner-export_1.0.0/` is a Factorio mod that emits the same JSON shape from a save's first tick. Used when `--dump-data` is not viable.

**Schema validation:** The JSON is parsed at load time against the Zod schema in `src/data/schema.ts`. Invalid bundles surface a structured `GameDataLoadError`.

**No bundled data.** The app starts empty — the user imports `game-data.json` via the top-bar selector. Plans persist in localStorage independently of the active game data.

---

## Hosting

Static site. No backend, no database.

- Primary: Cloudflare Pages or Vercel (free tier sufficient)
- Plans stored in localStorage; large plans can be exported/imported as JSON
- URL sharing via compressed query parameter

---

## Project Structure

```
factorio-planner/
├── spec/                       # Timeless reference docs (this directory)
├── initiatives/                # Roadmap, active and archived initiatives
├── scripts/                    # Game-data export + verification tooling
├── data/samples/               # Git-ignored — local game-data.json exports
├── src/
│   ├── data/
│   │   ├── schema.ts           # Zod schema for GameData and Plan (single source of truth)
│   │   ├── types.ts            # Re-exports + transient solver types
│   │   └── loader.ts           # parseGameData / parsePlan with structured errors
│   ├── solver/
│   │   ├── build.ts            # Net stoichiometry + item classification
│   │   ├── solve.ts            # LP construction and solveLP()
│   │   ├── effects.ts          # Module/beacon effects + machine metrics
│   │   ├── subplan.ts          # Synthetic-recipe synthesis for sub-plans
│   │   └── index.ts            # solve(plan, gameData) entry point
│   ├── store/
│   │   ├── blockStore.ts       # Block/SubPlan/RecipeNode state, undo/redo
│   │   ├── gameDataStore.ts    # Active GameData (empty/loading/loaded/error)
│   │   ├── solverStore.ts      # Debounced auto-solve subscription
│   │   ├── uiStore.ts          # Transient UI prefs (rateUnit, etc.)
│   │   └── persistence.ts      # localStorage save/restore
│   ├── components/
│   │   ├── ItemPicker.tsx      # Modal recipe/item picker (Factorio-style)
│   │   ├── BlockTabs.tsx       # Block selector
│   │   ├── Modal.tsx           # Generic modal primitive
│   │   └── factory/            # Production view (FactoryShell, RecipeRow, ProductionTable, …)
│   └── main.tsx                # Entry: wires stores + mounts FactoryShell
├── public/data/<mod>/icons/    # Generated icons sprite per game-data import
├── e2e/                        # Playwright specs
├── index.html
├── vite.config.ts
├── vitest.config.ts            # Separate file — `test` key in vite.config errors
└── tsconfig.json
```
