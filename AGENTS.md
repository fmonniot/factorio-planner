# AGENTS.md — Factorio Planner

Common knowledge for agents working in this repository.

---

## What this project is

A browser-based production planner for Factorio targeting the **Nullius** overhaul mod (Factorio 2.0). Given a set of desired output rates, it solves the full production chain — recipes, intermediates, raw resources, machine counts, and power draw — using a linear algebra approach. No backend; everything runs client-side.

---

## Tech stack

React 19 + TypeScript on Vite 8, Zustand 5 for state, Zod 3 for schemas, ml-matrix 6 for the solver, Tailwind v4 for styling, Vitest 3 for tests.

→ Full rationale and version pins: [spec/tech-stack.md](spec/tech-stack.md).

**Quirks worth knowing:**
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
spec/                  Timeless reference: how the system works today
initiatives/           Time-bound: roadmap, active initiatives, archive
TODO.md                Inbox of small items
scripts/               Build/export tooling (build-game-data.js, verify-game-data.js, trace-recipe-chain.js)
data/samples/          Git-ignored — real Nullius export goes here locally
src/
  data/                Zod schemas, loader (schema.ts is the single source of truth)
  solver/              Stoichiometry, reduction, LU + pseudo-inverse, effects, entry point
  store/               Zustand stores (block, gameData, solver, persistence, ui)
  components/          UI components; src/components/factory/ is the production-table view
e2e/                   Playwright specs
```

→ For component and module specifics, read the file headers in `src/`. For the data model, see [spec/data-model.md](spec/data-model.md).

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
| [spec/test-corpus.md](spec/test-corpus.md) | 6 corpus cases with full derivations — ground truth for solver |
| [spec/solver.md](spec/solver.md) | Linear algebra formulation, algorithm walkthrough |
| [spec/data-model.md](spec/data-model.md) | Full field-level data model reference |
| [spec/data-analysis.md](spec/data-analysis.md) | Findings from real Nullius export (explains design choices) |
| [spec/tech-stack.md](spec/tech-stack.md) | Technology choices and rationale |
| [initiatives/README.md](initiatives/README.md) | Index of active and archived initiatives |
| [initiatives/roadmap.md](initiatives/roadmap.md) | What's shipped, what's active, what's deferred |

---

## What is not yet implemented

Phases 6–7 are pending — see [initiatives/roadmap.md](initiatives/roadmap.md):
- **Phase 6** — Import/export, URL sharing (6.1–6.5)
- **Phase 7** — Icons and polish (7.1–7.5)

---

## Documentation layout

Two locations, two purposes. Follow these rules when adding or editing docs:

1. **`spec/` is timeless.** Files there describe how the system currently works. No phase markers, no ticket numbers, no `[ ]/[~]/[x]` checklists. If a fact changes, the file changes; old behaviour is not preserved.

2. **`initiatives/` is time-bound.** Anything with a status, a ticket list, a roadmap, or a "we plan to do X" framing belongs here. Each initiative is its own folder.

3. **Status badge on every active initiative.** The first non-heading line of an initiative's primary doc is one of:
   - `Status: Active` — work in progress
   - `Status: Future` — design exists, no implementation yet
   - `Status: Blocked — <reason>` — waiting on external work

4. **When an initiative ships, move the folder to `initiatives/archive/`.** Verbatim — no rewriting, no splitting. A single `git mv initiatives/<name> initiatives/archive/<name>` is the entire operation. The location implies the final status; no badge needed in archive.

5. **Update `initiatives/README.md` whenever a folder is added, archived, or its status changes.** The README is the only initiative index; nothing else should claim that role.

6. **AGENTS.md does not duplicate `spec/`.** It points to spec files for tech stack, data model, and solver behaviour — never restates them.

---

## Spec maintenance

After making changes to source files, update the relevant spec docs so this file stays accurate for future sessions. The goal is that a new session can read `AGENTS.md` + the `spec/` files and have enough context to work without traversing the codebase.

| What changed | What to update |
|---|---|
| Solver algorithm (`src/solver/`) | [spec/solver.md](spec/solver.md); [spec/test-corpus.md](spec/test-corpus.md) if expected corpus values changed |
| Data model (`src/data/schema.ts`, `types.ts`) | [spec/data-model.md](spec/data-model.md) |
| File added/removed/renamed | Repository layout table in this file (`AGENTS.md`) |
| Store or component architecture | Repository layout table in this file (`AGENTS.md`) |
| Technology or tooling change | [spec/tech-stack.md](spec/tech-stack.md); Commands and Tech stack sections in this file |
| Phase or feature completed | Mark `[x]` in [initiatives/roadmap.md](initiatives/roadmap.md) |
| Initiative shipped | `git mv initiatives/<name> initiatives/archive/<name>`, update [initiatives/README.md](initiatives/README.md) |
| New corpus case added | [spec/test-corpus.md](spec/test-corpus.md) |
