# AGENTS.md — Factorio Planner

Common knowledge for agents working in this repository.

---

## What this project is

A browser-based production planner for Factorio targeting the **Nullius** overhaul mod (Factorio 2.0). Given a set of desired output rates, it solves the full production chain — recipes, intermediates, raw resources, machine counts, and power draw — using a linear algebra approach. No backend; everything runs client-side.

---

## Tech stack

| Concern | Library/tool |
|---|---|
| UI | React 19 + TypeScript |
| State | Zustand 5 |
| Solver | ml-matrix 6 (LU decomposition, pseudo-inverse) |
| Schema/validation | Zod 3 |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Build | Vite 8 |
| Tests | Vitest 3 |

**Important quirks:**
- `vite.config.ts` and `vitest.config.ts` are **separate files**. The `test` key causes a TypeScript error in `UserConfigExport`, so test config lives exclusively in `vitest.config.ts`.
- Tailwind CSS v4 uses `@import "tailwindcss"` in CSS (not `@tailwind` directives).

---

## Commands

```sh
npm test           # run all tests once
npm run test:watch # re-run on change
npm run dev        # start Vite dev server
npm run build      # type-check + bundle
npm run lint       # ESLint
```

---

## Repository layout

```
spec/                  Design documents (read before changing behaviour)
  plan.md              Sequenced work plan with status markers [x]/[~]/[ ]
  test-corpus.md       6 verified corpus cases — source of truth for solver tests
  solver.md            Solver algorithm and formulation
  data-model.md        Full data model reference
scripts/
  build-game-data.js             Node.js pipeline: --dump-data JSON → game-data.json
  verify-game-data.js            Report-only diff of new vs backup game-data.json
  trace-recipe-chain.js          Trace recipe dependency chain; emits solver fixtures
data/samples/          Git-ignored — real Nullius export goes here locally
src/
  data/
    schema.ts          Zod schemas — single source of truth for all types
    types.ts           Re-exports game/plan types from schema.ts; adds solver state types
    loader.ts          parseGameData / loadGameDataFromJson / parsePlan / loadPlanFromJson
    loader.test.ts     29 unit tests
    loader.integration.test.ts  6 skipIf tests (need data/samples/nullius/game-data.json)
  solver/
    build.ts           buildStoichiometryMatrix + effectiveProductAmount
    reduce.ts          reduceSystem — classifies items, builds reduced S and d
    solve.ts           solveSystem — LU then pseudo-inverse fallback
    pin.ts             applyPinnedRates + mergeThroughput
    effects.ts         computeNodeEffects + computeMachineMetrics
    index.ts           solve(plan, gameData) — the single entry point the UI calls
  store/
    gameDataStore.ts   Active GameData (empty/loading/loaded/error); handles file import
    planStore.ts       Plan state with undo/redo via command pattern
    solverStore.ts     Auto-solves on plan/data change (150 ms debounce)
    persistence.ts     localStorage auto-save and restore on startup
  components/
    AppShell.tsx       Full-screen layout: header, sidebar, main area, summary bar
    GoalsPanel.tsx     Sidebar panel for production goals (add/remove/edit rate)
    NodesPanel.tsx     Sidebar panel for recipe nodes (add/remove)
    ItemPicker.tsx     Modal search for items or recipes
    RecipeCard.tsx     Card showing recipe details, machine count, power, I/O rates
    TreeView.tsx       Horizontal column layout of the production chain
    TableView.tsx      Sortable table view of nodes with inline editing
    SummaryBar.tsx     Footer: total machines, power, unsatisfied inputs, warnings
```

---

## Type system

**`src/data/schema.ts` is the single source of truth for all game data and plan types.**

- All types are derived with `z.output<typeof FooSchema>` — never hand-written.
- `schema.ts` exports both runtime types and Zod schemas.
- `src/data/types.ts` re-exports the game/plan types from `schema.ts` and adds the transient solver state types (`SolvedNode`, `SolverResult`, etc.) that have no Zod schema.
- Downstream code imports from `src/data/types.ts`.
- Do **not** cast with `as GameData` or `as Plan` — the Zod output type IS the TypeScript type, no cast needed.

Key transform: `mainProduct: z.string().nullable().optional().transform(v => v === '' ? null : v)` — the Lua exporter emits `""` for explicit multi-output recipes; the schema normalises to `null`.

---

## Solver pipeline

```
solve(plan, gameData)
  → computeNodeEffects        module + beacon bonuses per node
  → buildStoichiometryMatrix  S[item][recipe] = net production per exec
  → reduceSystem              classify items, build reduced S and demand d
  → applyPinnedRates          substitute fixed throughputs into d
  → solveSystem               LU decompose; pseudo-inverse fallback
  → mergeThroughput           reassemble full throughput vector
  → computeMachineMetrics     machine count and power per node
  → SolverResult              { nodes, unsatisfied, warnings }
```

**Item classifications** (from `reduceSystem`):
- `raw` — no active recipe produces it; reported as `UnsatisfiedItem` after solving
- `byproduct` — produced but never consumed and not a goal; row removed from system
- `intermediate` — both produced and consumed; row kept with `d[i] = 0`
- `goal` — user-demanded item; row kept with `d[i] = goal_rate`

**Stoichiometry sign convention:** positive = net produced, negative = net consumed.

**Productivity:** `effectiveProductAmount(amount, probability, ignoredByProductivity, productivityBonus)` — only the `amount − ignoredByProductivity` portion scales. Used in `build.ts` to modify S before solving.

**Kovarex cycle:** handled naturally by net stoichiometry — U-235 row is `41 − 40 = +1`, no special cycle-breaking needed.

---

## Tests

Tests live beside the source files as `*.test.ts`. Integration tests use `.integration.test.ts`.

**Corpus cases** (`spec/test-corpus.md`) are the canonical expected values for solver tests. All 6 cases are covered in `src/solver/index.test.ts` and the individual module tests. Any change to solver logic must be validated against all 6.

**Integration tests** (`loader.integration.test.ts`) skip automatically when `data/samples/nullius/game-data.json` is absent (CI-safe). Run locally after re-exporting from Factorio.

**Fixture hygiene:** test fixture factory functions must return `structuredClone(...)` to prevent test-to-test mutation. Failure to do this causes hard-to-diagnose test ordering bugs.

**Vitest API note:** The message argument in `expect` goes on `expect(value, 'message')`, not `expect(value).toBe(true, 'message')`. The latter causes a TypeScript error.

---

## Game data export

The primary pipeline uses `factorio --dump-data` and a Node.js script — no Factorio GUI needed.

```sh
# 1. Dump data (with target mods active, e.g. Nullius)
factorio --dump-data
# macOS Steam install:
# ~/Library/Application\ Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio --dump-data

# 2. Build game-data.json + extract icons (macOS defaults apply when flags are omitted)
node scripts/build-game-data.js \
  --dump      ~/Library/Application\ Support/factorio/script-output/data-raw-dump.json \
  --factorio-dir /Applications/factorio.app/Contents \
  --mods-dir  ~/Library/Application\ Support/factorio/mods \
  --icons-out public/data/nullius/icons \
  --output    data/samples/nullius/game-data.json

# 3. Optional: diff against a reference backup
node scripts/verify-game-data.js \
  --reference data/samples/nullius/game-data.json.backup \
  --actual    data/samples/nullius/game-data.json
```

**Legacy Lua mod** (fallback): `scripts/factorio-planner-export_1.0.0/` — symlink into the Factorio mods directory, load a save, wait one tick. Output lands at `script-output/factorio-planner-export.json`.

---

## Spec documents

Read these before making decisions that affect core behaviour:

| File | Contents |
|---|---|
| `spec/plan.md` | Implementation roadmap with status; update `[x]` on completion |
| `spec/test-corpus.md` | 6 corpus cases with full derivations — ground truth for solver |
| `spec/solver.md` | Linear algebra formulation, algorithm walkthrough |
| `spec/data-model.md` | Full field-level data model reference |
| `spec/data-analysis.md` | Findings from real Nullius export (explains design choices) |
| `spec/tech-stack.md` | Technology choices and rationale |

---

## What is not yet implemented

Phases 6–7 are pending (see `spec/plan.md`):
- **Phase 6** — Import/export, URL sharing (6.1–6.5)
- **Phase 7** — Icons and polish (7.1–7.5)
