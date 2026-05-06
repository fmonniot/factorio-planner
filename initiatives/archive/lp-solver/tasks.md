# LP solver migration — task breakdown

Companion to [seed.md](seed.md).  Each task is sized for one commit (up to
three if the change has a natural staging).  Tasks are ordered: each one
leaves `main` green and the app working.

Conventions:
- "Test passes" means `vitest` (unit) or `playwright` (e2e) reports green.
- "v1 tests still pass" appears on every task that touches solver code —
  v1 behavior is frozen during the migration.
- Each task owns its own tests; no task is "done" without them.

---

## Task 1 — Add `solverVersion` to the plan schema

**Goal**: the plan model carries a `solverVersion: 1 | 2` field, persisted
through localStorage, with a Zod migration so existing plans default to `1`
and new plans default to `2`.

**Scope**:
- Add `solverVersion` to the plan Zod schema in `src/data/`.
- Migration: missing field → `1`.
- Default for newly-created plans → `2`.
- No solver wiring yet; no UI toggle yet.

**Success criteria**:
- New unit test in `src/store/persistence.test.ts` (or a new file): a plan
  JSON without `solverVersion` loads as `1`; a plan with `solverVersion: 2`
  round-trips; an invalid value (`0`, `3`, `'2'`) fails Zod validation.
- New unit test: store action that creates a fresh plan produces
  `solverVersion: 2`.
- All existing tests pass.
- Captured fixture
  [factorio-plan-2026-04-26-15-09.json](factorio-plan-2026-04-26-15-09.json)
  still loads cleanly (treated as v1).

---

## Task 2 — Move existing solver into `src/solver/v1/`

**Goal**: relocate v1 code under `src/solver/v1/` with zero behavior change.

**Scope**:
- Move `build.ts`, `reduce.ts`, `pin.ts`, `solve.ts`, `effects.ts`,
  `subplan.ts`, `index.ts` and their `*.test.ts` siblings into `src/solver/v1/`.
- `src/solver/index.ts` becomes a thin re-export of `v1/index.ts` for now
  (dispatcher comes in Task 3).
- Update imports across the codebase.

**Success criteria**:
- All existing v1 unit and integration tests pass unchanged (relocated only).
- `npm run build` and `npm run typecheck` are green.
- All Playwright e2e specs pass (no behavior change visible to UI).
- Git diff shows pure moves + import path updates, no logic edits.

---

## Task 3 — Dispatcher in `src/solver/index.ts`

**Goal**: `solve(plan)` dispatches on `plan.solverVersion`, routing `1` to
v1 and `2` to a v2 stub that throws "not implemented".

**Scope**:
- Replace the re-export in `src/solver/index.ts` with a switch on
  `plan.solverVersion`.
- Create `src/solver/v2/index.ts` exporting a stub that throws.

**Success criteria**:
- New unit test `src/solver/index.test.ts`: a plan with `solverVersion: 1`
  produces the same result as calling v1 directly (use the captured fixture).
- New unit test: a plan with `solverVersion: 2` throws a recognisable
  "v2 not implemented" error.
- All v1 tests pass.
- e2e specs pass (still all v1 plans in fixtures).

---

## Task 4 — Cross-solver harness skeleton

**Goal**: a test harness that runs both solvers on every fixture and
snapshots the diff, gated on v2 actually being implemented.

**Scope**:
- New file `src/solver/__harness__/cross-solver.test.ts`.
- Iterate fixtures in `src/solver/__fixtures__/`.
- For each, run v1 and v2; if v2 throws "not implemented", mark the case
  as `pending` (test passes, logs skip).
- When v2 returns, snapshot per-recipe rates (1e-6 relative tolerance),
  warning types, and raw/byproduct rates into a `__snapshots__` file.
- Copy the captured plan into
  `src/solver/__fixtures__/nullius-ethylene-methane.json`.

**Success criteria**:
- Harness runs green with all fixtures in `pending` state for v2.
- Snapshot infra in place but only v1 results captured (v2 still stubbed).
- Adding a fixture requires no code change to the harness.

---

## Task 5 — v2 classification + minimal LP (no pins, no bc, no surplus)

**Goal**: v2 solves the simplest case — no pinned rates, no
byproduct-consumer recipes, no surplus reporting — using
`javascript-lp-solver` with goal `≥` and intermediate `≥ 0` constraints
and `min Σ x_j` objective.

**Scope**:
- Add `javascript-lp-solver` to `package.json`.
- `src/solver/v2/build.ts`: item classification (goal / intermediate / raw /
  byproduct), reused shape from v1's `reduce.ts`.
- `src/solver/v2/solve.ts`: build LP, call solver, return throughputs.
- `src/solver/v2/index.ts`: orchestrate build → solve → assemble
  `SolvedNode[]`.
- Throw a clear error if the plan has pinned rates or bc recipes (those
  arrive in later tasks).

**Success criteria**:
- New unit tests `src/solver/v2/solve.test.ts` covering:
  - A trivial 1-recipe / 1-goal plan: rates correct.
  - A 2-recipe chain: rates correct.
  - A plan with goals and a recipe loop where v1 would also solve correctly:
    v2 matches v1 within tolerance.
- Cross-solver harness: pinned-free, bc-free fixtures move from `pending`
  to passing with matching snapshots.
- All v1 tests still pass.

---

## Task 6 — v2: pinned rates as LP equalities + `infeasible-pins` warning

**Goal**: pinned-rate recipes add `x_j = rate` constraints to the LP; if
the LP is infeasible and pins are present, emit `infeasible-pins`.

**Scope**:
- Extend `src/solver/v2/solve.ts` with pin equalities.
- Add `'infeasible-pins'` to `SolverWarning` in `src/data/types.ts` (v2
  union extension; v1 untouched).
- `src/solver/v2/warnings.ts`: map LP solver status → warning(s).

**Success criteria**:
- Unit test: feasible pin → rate matches the pin exactly.
- Unit test: infeasible pin (rate forces a goal violation) → solver returns
  with `infeasible-pins` warning naming the recipe(s).
- Unit test: removing the pin from the same plan resolves cleanly.
- Harness: previously-pending fixtures with pins now pass.
- All v1 tests still pass.

---

## Task 7 — v2: byproduct-consumer recipes post-pass

**Goal**: byproduct-consumer recipes are excluded from the LP and have
their throughput computed post-solve from item surplus, matching v1
behavior.

**Scope**:
- Port v1's bc post-pass logic into `src/solver/v2/index.ts`.
- Remove the "throw if bc recipes present" guard from Task 5.

**Success criteria**:
- Unit tests in `src/solver/v2/index.test.ts` mirroring v1's bc test cases:
  bc recipe consumes exactly the surplus produced upstream; multiple bc
  recipes split surplus the same way v1 does.
- Cross-solver harness: bc-containing fixtures pass with v1/v2 snapshots
  matching.
- Existing `e2e/byproduct-consumer.spec.ts` passes against a `solverVersion: 2`
  variant of its plan (add the variant as a fixture).

---

## Task 8a — v2: surplus reporting + `overconstrained` warning

**Goal**: detect intermediates with positive net flow at the LP optimum,
emit `overconstrained` naming them, and carry the surplus value through
the result.

**Scope**:
- After LP solve, check each intermediate's net flow; net > 0 (with
  tolerance) → emit `overconstrained` listing those items.
- Add `'overconstrained'` to `SolverWarning` in `src/data/types.ts`.
- Result shape: surplus items returned alongside byproducts (a flag or
  separate field — pick the simpler one and document it).

**Success criteria**:
- Unit test using the captured Nullius fixture: ethylene ≥ 800, methane
  ≥ 400, exactly one `overconstrained` warning naming `steam` or `oxygen`,
  surplus value on that item is positive.
- Unit test: a clean single-path plan → no `overconstrained` warning,
  no surplus.
- Cross-solver harness: captured fixture moves from `pending` to passing.
- All v1 tests still pass.

---

## Task 8b — v2: `too-many-alternatives` warning

**Goal**: detect and emit `too-many-alternatives` when multiple active
recipes produce the same goal/intermediate with non-zero throughput at
the LP optimum.

**Scope**:
- Heuristic detection on the LP solution; refine if false positives
  appear in the harness.
- Add `'too-many-alternatives'` to `SolverWarning` in `src/data/types.ts`.
- New fixture: a small plan with two parallel recipes producing the same
  goal item.

**Success criteria**:
- Unit test: the new parallel-recipes fixture → one
  `too-many-alternatives` warning naming both recipes.
- Unit test: single-path plan → no `too-many-alternatives` warning.
- Cross-solver harness still green on all prior fixtures.
- All v1 tests still pass.

---

## Task 9 — UI: surplus renders as byproduct; goal surplus adds to goal output

**Goal**: in the UI, a v2 surplus item shows in `RecipeRow`/`ItemTile` as
a byproduct.  If the surplus is on a goal item, the goal tile shows the
actual (≥ requested) throughput.

**Scope**:
- `src/components/factory/RecipeRow.tsx` / `ItemTile.tsx`: render surplus
  intermediates via the existing byproduct path.
- Goal tile: display actual throughput, not requested rate, when the two
  differ.
- No new tile category, no new colors.

**Success criteria**:
- New component test (or extension of existing) verifying that a
  `SolvedNode` with a surplus item renders a byproduct tile for it.
- New component test: goal tile reflects actual throughput when LP returns
  more than the requested rate.
- All existing component tests pass.

---

## Task 10 — UI: warning copy for the three new types

**Goal**: `WarningsPopover` shows the user-facing copy from the seed for
`too-many-alternatives`, `overconstrained`, `infeasible-pins`.

**Scope**:
- `src/components/factory/WarningsPopover.tsx`: title/body/hint per the
  seed's table.
- No layout changes; reuse the existing warning row component.

**Success criteria**:
- Component test for each new warning type: title, body (with item/recipe
  names interpolated), and hint render correctly.
- Existing `e2e/warnings-popover.spec.ts` still passes.

---

## Task 11 — UI: solver version toggle in plan header

**Goal**: a minimal toggle in the plan header switches the active plan
between `solverVersion: 1` and `2`, persisted via the existing store.

**Scope**:
- Add a small toggle (checkbox or two-button group, unstyled-ish — this
  is migration-only UI).
- Wire to the plan store; toggling re-runs the solver.

**Success criteria**:
- Unit test on the store: toggling updates `solverVersion` and triggers
  a re-solve.
- New e2e `e2e/solver-version-toggle.spec.ts`: load the captured plan
  (saved as `solverVersion: 1`), toggle to `2`, assert (a) localStorage
  reflects the change, (b) rendered rates differ, (c) the
  `overconstrained` warning appears.

---

## Task 12 — e2e: LP solver on the captured Nullius plan

**Goal**: a Playwright spec that loads the captured plan with
`solverVersion: 2` and verifies the v2 success criteria end-to-end.

**Scope**:
- `e2e/lp-solver-overconstrained.spec.ts`: load
  `nullius-ethylene-methane.json` (saved as v2), assert:
  - ethylene tile shows ≥ 800/min
  - methane tile shows ≥ 400/min
  - `WarningsPopover` shows `overconstrained` naming steam or oxygen
  - the surplus item appears as a byproduct tile in the relevant row

**Success criteria**:
- The new e2e passes locally and in CI.
- All other e2e specs still pass.

---

## Task 13 (later, gated on real-data validation) — Delete v1

**Goal**: once v2 has been validated on multiple real Nullius plans the
user has played through, remove v1 entirely.

**Scope**:
- Delete `src/solver/v1/`.
- Move v2 contents back to `src/solver/` (drop the `v2/` folder).
- Drop `solverVersion` from the schema; Zod migration: any value → remove.
- Remove the version toggle UI.
- Remove the cross-solver harness (no v1 to compare against).
- Remove v1-only warning types from `SolverWarning`.

**Success criteria**:
- All tests pass.
- All e2e specs pass.
- Captured Nullius plan still solves correctly (`overconstrained` warning,
  goals met).
- Plans saved during the dual-solver period (with `solverVersion`) still
  load and solve.

**Trigger**: user has confirmed at least N real plans (suggest N=3,
covering different recipe-graph shapes) solve correctly under v2.  Don't
do this task speculatively.

---

## Dependency graph

```
1 ──▶ 2 ──▶ 3 ──▶ 4 ──▶ 5 ──▶ 6 ──▶ 7 ──▶ 8a ──▶ 8b ──▶ 9 ──▶ 10 ──▶ 11 ──▶ 12 ──▶ 13
```

Strictly sequential through 8a (8a is what unblocks the captured-fixture
assertions and the e2e in Task 12).  8b can slip after 9/10 if convenient.
Tasks 9 and 10 are UI-only and can overlap.  Tasks 11 and 12 need the v2
solver complete (post-8a; 8b not required for the e2e).
