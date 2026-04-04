# Plan of Attack

A sequenced list of work items. Later phases depend on earlier ones — don't skip ahead. Each item should be treated as a discrete unit of work that can be reviewed on its own.

Status markers: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Ground Truth

Before writing a line of application code, establish what the real data looks like. The data model in `data-model.md` is a sketch based on documentation and prior knowledge — it will be wrong in places.

- [ ] **0.1 Write the Lua export script (minimal version)**
  Write a first-pass `scripts/export-game-data.lua` that extracts raw `data.raw` tables for items, fluids, recipes, and machines and dumps them as JSON. Don't try to match the final `GameData` schema yet — just get the raw data out.

- [ ] **0.2 Run the export against vanilla 2.0**
  Run the script in Factorio (no mods) and capture the output. Commit the output file under `data/samples/vanilla-2.0-raw.json` for reference. This file is the ground truth for all subsequent modelling work.

- [ ] **0.3 Analyze the raw data and revise the data model**
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
  Update `spec/data-model.md` with findings. Mark any v1 simplifications explicitly.

- [ ] **0.4 Run the export with Space Age active**
  Repeat 0.2 with Space Age enabled. Note what changes: new categories, new machine types, new recipe fields (spoilage? planet constraints?). Commit as `data/samples/space-age-2.0-raw.json`. Update the data model if necessary.

- [ ] **0.5 Identify a representative test corpus**
  Pick 5–8 recipe chains of increasing complexity to use as solver test cases throughout development:
  - Simple linear chain (iron ore → plate → gear)
  - Chain with a shared intermediate (circuits used in multiple recipes)
  - Multi-output recipe (basic/advanced oil processing)
  - Cycle (Kovarex enrichment)
  - Recipe with probability outputs (if any in vanilla 2.0)
  - A Space Age chain if structurally different
  Document these in `spec/test-corpus.md` with expected input/output rates.

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
