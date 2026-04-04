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

- [ ] **1.1 Initialise the repo**
  `npm create vite` with React + TypeScript template. Add Tailwind, Vitest, `ml-matrix`, Zod. Commit baseline config.

- [ ] **1.2 Define the TypeScript types**
  Translate the finalised `spec/data-model.md` into `src/data/types.ts`. No logic yet, just types. These are the contract everything else is built against.

- [ ] **1.3 Write the Zod schema and loader**
  `src/data/schema.ts` — Zod schema mirroring the TypeScript types. `src/data/loader.ts` — validates and parses a `GameData` JSON file. Include a test that validates the vanilla sample against the schema.

- [ ] **1.4 Finalise and refine the Lua export script**
  Revise the script from Phase 0 to emit JSON that passes the Zod schema from 1.3. This is the contract between the game and the app. Add a CI check that the committed vanilla sample passes validation.

---

## Phase 2 — Solver

- [ ] **2.1 Stoichiometry matrix builder**
  `src/solver/build.ts` — given a `GameData` and a set of active recipe ids, build the stoichiometry matrix `S` and index maps (item→row, recipe→col). Unit tests against the test corpus from 0.5.

- [ ] **2.2 System reduction**
  Partition items into goals / intermediates / raw resources / byproducts. Apply reduction rules (remove raw-resource rows, handle discard policy). Tests: verify the reduced system dimensions are correct for each corpus case.

- [ ] **2.3 Core solve**
  `src/solver/solve.ts` — LU decompose the reduced system via `ml-matrix`, solve for `x`. Handle rank-deficient case (least-squares fallback + warning). Tests: verify throughput vectors for each corpus case.

- [ ] **2.4 Pinned rates**
  Support user-pinned recipe rates as fixed variables. Substitute, reduce, solve remaining unknowns. Tests: pin one node in a chain and verify downstream rates adjust correctly.

- [ ] **2.5 Module and beacon effects**
  Apply module effects (speed, productivity, consumption) to per-node machine counts and power. Productivity adjusts the stoichiometry matrix before solving. Tests: verify productivity reduces upstream demand correctly.

- [ ] **2.6 Solver entry point**
  `src/solver/index.ts` — assembles the full `SolverResult` from a `Plan` + `GameData`. This is the single function the UI calls. End-to-end tests covering the full corpus.

---

## Phase 3 — State and Data Loading

- [ ] **3.1 Plan store**
  `src/store/planStore.ts` — Zustand store for `Plan` state. Actions: add/remove goal, update goal rate, add/remove node, update node config. Undo/redo via command stack.

- [ ] **3.2 Game data store**
  `src/store/gameDataStore.ts` — loads and holds the active `GameData`. Initially loads bundled vanilla JSON on startup. Exposes an `importGameData(file)` action.

- [ ] **3.3 Solver integration**
  Wire the solver to the plan store: re-run solver on every plan state change (debounced). Store `SolverResult` as derived state alongside the plan.

- [ ] **3.4 Plan persistence**
  Serialize/deserialize `Plan` to/from localStorage. Auto-save on change. Load on startup. Handle missing or malformed stored data gracefully.

---

## Phase 4 — UI: Core

- [ ] **4.1 App shell**
  Header, goals panel sidebar, main area, summary bar. No real content yet — just layout with placeholder components.

- [ ] **4.2 Item picker**
  Modal with fuzzy search over items from the active `GameData`. Used everywhere an item needs to be selected.

- [ ] **4.3 Goals panel**
  Add/remove goals. Edit rate inline. Connects to plan store. Shows item names (no icons yet).

- [ ] **4.4 Recipe card (read-only)**
  Display a `SolvedNode` as a card: recipe name, rate, machine count, power, input rates. No editing yet.

- [ ] **4.5 Tree view (layout)**
  Arrange recipe cards in a top-down dependency tree. Handle shared nodes (one card, multiple incoming edges). Scrollable canvas.

- [ ] **4.6 Summary bar**
  Total machines, total power, raw resource list. Connected to `SolverResult`.

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
