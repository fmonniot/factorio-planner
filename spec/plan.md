# Plan of Attack

A sequenced list of work items. Later phases depend on earlier ones — don't skip ahead. Each item should be treated as a discrete unit of work that can be reviewed on its own.

Status markers: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Ground Truth

Before writing a line of application code, establish what the real data looks like. The data model in `data-model.md` is a sketch based on documentation and prior knowledge — it will be wrong in places.

- [x] **0.1 Write the Lua export script (minimal version)**
  Written at `scripts/export-game-data.lua`. Corrected after analysis (0.3): energy_usage
  kept as raw string, parameter recipes filtered, allow_productivity and
  ignored_by_productivity added, crafting_categories kept as array.

- [x] **0.2 Run the export and capture sample data**
  Nullius export captured at `data/samples/nullius/` (git-ignored due to size). Used as
  ground truth for all data modelling. Vanilla export deferred — not in scope for v1.

- [x] **0.3 Analyze the raw data and revise the data model**
  Go through the raw export and answer:
  - What fields are actually present vs. absent on recipe/item/machine prototypes?
  - What are the real category strings in use?
  - How are multi-output recipes represented (`results` vs `result`/`result_count` vs `main_product`)?
  - How are fluid ingredients/products represented vs item ones?
  - Which machines have `allowed_effects` and what values appear?
  - How do furnaces differ from assemblers in the prototype structure?
  - Are there recipe categories with no natural machine (hand-crafting)?
  - How is `energy_usage` actually encoded (string with unit? number?)?
  - What does the quality prototype structure look like, even if we ignore it for v1?
  Analysis in `spec/data-analysis.md`. Data model updated. Key findings: energy_usage is a
  string ("150kW"), crafting_categories is an array, module effects include "quality",
  ignored_by_productivity matters for Kovarex, allow_productivity is per-recipe, parameter
  recipes must be filtered. amount_min/max not observed in the wild.

- [x] **0.4 Run the export with Space Age active**
  Nullius runs on Factorio 2.0 with Space Age, so the sample data already includes Space
  Age entities. A separate vanilla+Space Age export is deferred with vanilla support.

- [x] **0.5 Identify a representative test corpus**
  Six cases documented in `spec/test-corpus.md` with full derivations:
  1. Simple linear chain (iron-ore → iron-plate → iron-gear-wheel)
  2. Shared intermediate (electronic-circuit, copper-cable used once)
  3. Multi-output recipe (advanced-oil-processing, 3 products, byproduct feed-back)
  4. Cycle (Kovarex enrichment — U-235 is both input and output)
  5. Probability outputs (uranium-processing, p=0.007 for U-235)
  6. Productivity + ignored_by_productivity (Kovarex with prod-module-3)

---

## Phase 1 — Project Scaffold

- [x] **1.1 Initialise the repo**
  Vite 8 + React 19 + TypeScript. Tailwind CSS v4 via @tailwindcss/vite. Vitest 3,
  ml-matrix, Zod, Zustand added. Minimal App.tsx placeholder; src/ structure created.

- [x] **1.2 Define the TypeScript types**
  `src/data/types.ts` — all types from `spec/data-model.md`: Item, Ingredient, Product,
  Recipe, Machine, Module, GameData, Plan, SolvedNode, SolverResult, etc.

- [x] **1.3 Write the Zod schema and loader**
  `src/data/schema.ts` — full Zod schemas with "" → null transform for mainProduct.
  `src/data/loader.ts` — parseGameData / loadGameDataFromJson / parsePlan /
  loadPlanFromJson with structured error types (GameDataLoadError, PlanLoadError).
  29 unit tests in `src/data/loader.test.ts` covering happy path and error cases.
  Note: CI validation against a committed sample deferred — sample is git-ignored (size).

- [x] **1.4 Finalise and refine the Lua export script**
  `scripts/export-game-data.lua` rewritten to emit GameData-shaped JSON:
  camelCase field names, items+fluids unified, energy strings parsed to kW,
  madeIn computed from category_map, defaultMachines populated, mainProduct ""
  for multi-output (normalised to null by the Zod schema transform).

---

## Phase 2 — Solver

- [x] **2.1 Stoichiometry matrix builder**
  `src/solver/build.ts` — net S matrix (items × recipes), `effectiveProductAmount` handles
  probability and ignoredByProductivity. Unit tests: corpus cases 1, 4, 5.

- [x] **2.2 System reduction**
  `src/solver/reduce.ts` — classifies items (goal/intermediate/raw/byproduct), builds the
  reduced S and demand vector d. Tests: corpus cases 1–4 and case 3b (two goals).

- [x] **2.3 Core solve**
  `src/solver/solve.ts` — LU decomposition via ml-matrix; pseudo-inverse fallback for
  rank-deficient/non-square systems with 'underdetermined' warning. Tests: all 5 cases.

- [x] **2.4 Pinned rates**
  `src/solver/pin.ts` — substitutes pinned throughputs into d before solving; mergeThroughput
  reconstitutes the full vector. Tests: pin upstream and downstream nodes.

- [x] **2.5 Module and beacon effects**
  `src/solver/effects.ts` — computeNodeEffects (speed/productivity/consumption from modules
  and beacons), computeMachineMetrics (machine count and power). Tests: corpus case 6.

- [x] **2.6 Solver entry point**
  `src/solver/index.ts` — solve(plan, gameData) orchestrates all steps and returns SolverResult.
  End-to-end tests: all 6 corpus cases, warnings (no-recipe, productivity-not-allowed).

> **TODO (integration):** Add a `src/solver/index.integration.test.ts` that runs the full solver
> against the real Nullius `data/samples/nullius/game-data.json` export (gate with `skipIf(!sampleExists)`).
> Exercise corpus-like goals on real recipe/machine data to catch regressions that synthetic unit
> tests cannot: missing machine for a category, unexpected item classifications, real craftingSpeed
> values affecting machine counts.

---

## Phase 3 — State and Data Loading

- [x] **3.1 Plan store**
  `src/store/planStore.ts` — Zustand store for `Plan` state. Actions: add/remove goal, update
  goal rate, add/remove node, update node machine/modules/beacon/pinnedRate/byproductPolicy.
  Undo/redo via command pattern (apply+undo pairs on a stack). setPlan() for full replacement.

- [x] **3.2 Game data store**
  `src/store/gameDataStore.ts` — holds active GameData with status: empty/loading/loaded/error.
  importGameData(json), importGameDataFile(file), clearGameData(). selectGameData() helper.
  No bundled file; starts empty. UI will offer file import (Phase 6).

- [x] **3.3 Solver integration**
  `src/store/solverStore.ts` — holds SolverStatus (idle/pending/solved/error) as derived state.
  wireSolver() subscribes to planStore + gameDataStore, debounces 150ms, calls solve().
  Short-circuits to empty result when no gameData or no goals/nodes.

- [x] **3.4 Plan persistence**
  `src/store/persistence.ts` — savePlan() / loadPersistedPlan() / initPlanPersistence().
  Auto-saves on every plan reference change via store subscription. Loads on startup with
  structured error return (ok / missing / error). Silently ignores write failures.

---

## Phase 4 — UI: Core

- [x] **4.1 App shell**
  `src/components/AppShell.tsx` — full-screen layout: header (with game data status badge and
  minimal file-import button), left sidebar (w-80), scrollable main area, fixed summary bar.
  `src/main.tsx` wired: loadPersistedPlan + initPlanPersistence + wireSolver at startup with
  HMR dispose. App.tsx renders AppShell with placeholder sidebar/main/summary content.

- [x] **4.2 Item picker**
  `src/components/ItemPicker.tsx` — backdrop modal with case-insensitive substring search over
  item name and id. Auto-focuses input, closes on Escape or backdrop click. Graceful empty
  state when no game data is loaded. Used by GoalsPanel (4.3) and any future item-selection UI.

- [x] **4.3 Goals panel**
  `src/components/GoalsPanel.tsx` — list of goals from planStore with inline rate editing and
  remove button. "+ Add" opens ItemPicker; item names resolved from gameData (falls back to
  itemId). App.tsx sidebar slot updated to render GoalsPanel.

- [x] **4.4 Recipe card (read-only)**
  `src/components/RecipeCard.tsx` — card showing recipe name, throughput, machine count and
  name, power, plus labeled outputs and inputs with rates. Resolves machine from planNode or
  gameData defaultMachines. Formatting helpers for rate (adaptive decimals) and power (kW/MW).

- [x] **4.5 Tree view (layout)**
  `src/components/TreeView.tsx` — horizontally scrollable column layout. `buildColumns` assigns
  each node a depth via BFS from goal producers (re-visits to maximise depth, pushing raw
  inputs right). Goal-producing nodes are column 0; orphaned nodes (no path from any goal) get
  a trailing column. Each column renders RecipeCards stacked vertically. Handles idle/pending/
  error/empty states with informative messages. App.tsx main slot updated to TreeView.

- [x] **4.6 Summary bar**
  `src/components/SummaryBar.tsx` — total machine count, total power draw (kW/MW), raw-input
  chips from SolverResult.unsatisfied with item names, and a yellow warnings badge when solver
  warnings exist. App.tsx now uses all four real components; no more placeholders.

---

## Phase 5 — UI: Editing

- [ ] **5.1 Machine selector**
  Dropdown on each recipe card to change the machine type. Filtered to machines supporting the recipe's category. Triggers re-solve.

- [ ] **5.2 Alternate recipe selector**
  Dropdown on recipe cards where multiple recipes produce the same item. Triggers re-solve.

- [ ] **5.3 Module configuration**
  Per-node module slot editor. Enforces slot count. Triggers re-solve.

- [ ] **5.4 Beacon configuration**
  Per-node beacon popover. Triggers re-solve.

- [ ] **5.5 Rate pinning**
  Pin/unpin toggle on recipe card rate field. Pinned nodes are passed to solver as fixed variables.

- [ ] **5.6 Byproduct policy editor**
  Per-product discard/feed-back toggle, accessible from the recipe card inputs/outputs section.

- [ ] **5.7 Table view**
  Flat sortable table of all nodes. Same inline-edit affordances as tree cards. Toggle between tree and table view.

---

## Phase 6 — Import / Export / Sharing

- [ ] **6.1 Export plan as JSON**
- [ ] **6.2 Import plan from JSON**
- [ ] **6.3 Share plan via URL** (compressed base64 query param, with size warning)
- [ ] **6.4 Import game data JSON** (custom mod bundle)
- [ ] **6.5 Settings panel** (default machines, rate unit, game data info)

---

## Phase 7 — Icons and Polish

- [ ] **7.1 Icon pipeline**
  Build-time script to extract item icons from game files and assemble a sprite sheet. Update recipe cards and item picker to show icons.

- [ ] **7.2 Solver warnings in UI**
  Surface `SolverWarning` entries on affected recipe cards (cycle, underdetermined, no-recipe).

- [ ] **7.3 Rate-changed animation**
  Briefly highlight cards whose computed rate changed from the previous solve (feed-back side-effect visibility).

- [ ] **7.4 Responsive layout**
  Collapsed sidebar, compact summary bar, single-column card list for small screens.

- [ ] **7.5 Keyboard navigation**
  Item picker keyboard nav, common shortcuts (add goal, undo/redo).

---

## Deferred (Post-v1)

- Optimization mode (minimize machines/power via LP)
- Sankey / flow diagram view
- Mining/extraction machine modelling
- Quality tier support
- Multi-factory / sub-factory splitting
- Plan diffing
