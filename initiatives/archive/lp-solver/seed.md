# Plan seed: LP-based solver (v2) + plain-language warnings

## Goal

Add a second solver (`v2`) that formulates the recipe network as a Linear
Program, living side-by-side with the existing linear-system solver (`v1`)
during a migration period.  v2 must correctly solve any valid recipe network,
regardless of whether internal stoichiometric ratios are commensurate.
Simultaneously, give v2 plain-language warnings a non-expert Factorio player
can act on.

The two solvers coexist per-plan via a `solverVersion: 1 | 2` field.  Old plans
default to `1`; new plans default to `2`.  Once v2 is proven on real plans,
v1 is deleted.

---

## Motivation — the concrete failure

The tool exists because the user wants to plan complex Nullius mod factories
that in-game tools like helmod or Factory Planner don't handle well.  A
representative plan (captured at
[factorio-plan-2026-04-26-15-09.json](factorio-plan-2026-04-26-15-09.json)) has:

- **Goals**: ethylene 800/min, methane 400/min
- **Recipes**: Propene pyrolysis · Alkene synthesis · Benzene combustion ·
  Steam electrolysis · Methane synthesis

The recipe network has a feedback loop (propene ↔ alkenes) and a sub-cycle
(benzene combustion ↔ steam electrolysis).  The sub-cycle is stoichiometrically
incompatible:

| Equation | Constraint on R3/R4 |
|---|---|
| Oxygen balance: R4 produces 400, R3 consumes 150 | R3/R4 = 400/150 ≈ **2.67** |
| Steam balance: R3 produces 400, R4 consumes 2000 | R3/R4 = 2000/400 = **5.00** |

No throughput assignment satisfies both simultaneously.  The current solver
sends this 8×5 overdetermined system to the Moore-Penrose pseudo-inverse, which
minimises ‖x‖ with no awareness of goals.  The result has incorrect rates and
goals are not met.  The warning shown ("more recipe columns than constraints")
is also wrong — there are *fewer* columns than rows in this case.

---

## Project context

| | |
|---|---|
| **Stack** | React + TypeScript (Vite), Zustand, Tailwind, Playwright e2e |
| **Game data** | Nullius mod (fluid-heavy, many feedback loops) loaded from a JSON export |
| **Persistence** | Plans saved to localStorage as JSON; Zod schema validates on load |
| **Solver location (v1)** | `src/solver/` — `build.ts`, `reduce.ts`, `pin.ts`, `solve.ts`, `index.ts` |
| **UI entry point** | `src/components/factory/RecipeRow.tsx`, `WarningsPopover.tsx` |
| **Warning types** | `src/data/types.ts` → `SolverWarning` discriminated union |

### Current v1 solver pipeline (`src/solver/index.ts`)

```
plan.nodes
  → split into mainNodes / bcNodes (byproductConsumer flag)
  → buildStoichiometryMatrix()   [build.ts]
  → apply byproductPolicy (zero out discarded products)
  → reduceSystem()               [reduce.ts]  — keeps goal + intermediate rows
  → applyPinnedRates()           [pin.ts]     — substitutes fixed throughputs
  → solveSystem()                [solve.ts]   — LU or pseudo-inverse
  → mergeThroughput()            [pin.ts]
  → compute bcNode throughputs from item surplus
  → build SolvedNode[] per node
  → compute unsatisfied raw items
```

### `reduceSystem` item classification (`src/solver/reduce.ts`)

- **goal** — item is in the goals map; v1 row equation: `Σ S_ij·x_j = goal_rate`
- **intermediate** — produced and consumed by active recipes; v1 row equation: `Σ S_ij·x_j = 0`
- **raw** — no producer; excluded from system, consumption computed post-solve
- **byproduct** — no consumer; excluded from system, shown as output

v1 uses **equality** constraints for both goals and intermediates.  This is
the root cause: equality on intermediates forces exact balance, which is
impossible when internal stoichiometric ratios are incommensurate.

---

## Architecture: side-by-side solvers

### Layout

```
src/solver/
  index.ts          dispatches on plan.solverVersion → v1 or v2
  v1/               existing solver, moved verbatim
    build.ts  reduce.ts  pin.ts  solve.ts  effects.ts  subplan.ts  index.ts
    *.test.ts
  v2/               new LP solver
    build.ts        item classification (shared shape with v1, no equality matrix)
    solve.ts        LP construction + javascript-lp-solver call
    warnings.ts     LP-status → SolverWarning mapping
    index.ts
    *.test.ts
  __fixtures__/     shared fixtures, including the captured Nullius plan
  __harness__/
    cross-solver.test.ts   runs both solvers on every fixture, snapshots diff
```

The dispatcher in `src/solver/index.ts` is a thin switch on `plan.solverVersion`.
Effects, subplan logic, and the byproduct-consumer post-pass are duplicated
into v2 as needed (copy-paste over abstraction — v1 is going away).

### Per-plan selection

- New field on the plan schema: `solverVersion: 1 | 2`
- Zod migration: missing field → `1` (existing plans keep current behavior)
- New plans default to `2`
- UI toggle in the plan header (small, unstyled — migration period only)
- localStorage round-trip verified by an existing persistence test, extended
  to cover the new field

### End state

When v2 is validated on real plans, delete `src/solver/v1/` entirely, drop
the `solverVersion` field (Zod migration: any value → remove), and inline
v2 back into `src/solver/`.  No long-term dual-path investment.

---

## v2 design

### LP formulation

| Row type | v1 constraint | v2 constraint |
|---|---|---|
| Goal item | `Σ S_ij·x_j = d_i` (equality) | `Σ S_ij·x_j ≥ d_i` (lower bound) |
| Intermediate | `Σ S_ij·x_j = 0` (equality) | `Σ S_ij·x_j ≥ 0` (non-negative net) |
| Raw | excluded | excluded (external source, unconstrained) |
| Byproduct | excluded | excluded |
| Pinned recipe | substituted out via `pin.ts` | `x_j = pinned_rate` (LP equality) |
| All throughputs | implicit ≥ 0 via clamping | `x_j ≥ 0` (explicit LP bound) |

**Objective**: minimise total throughput `Σ x_j` — the most neutral choice;
selects the least-work solution and degrades gracefully when multiple
solutions exist.

**Why this works for the failing plan**: steam and oxygen intermediates
become `≥ 0` inequalities instead of `= 0` equalities.  The LP picks the
R3/R4 ratio that is feasible, and one of steam or oxygen ends up with a
positive surplus.  Goals are met exactly.

**Pinned rates as LP equalities** (changed from initial seed): pinned
throughputs go directly into the LP as `x_j = rate` constraints.  This
lets the LP report infeasible pins (e.g. user pinned a rate that violates
balance) as a warning, instead of silently mis-solving downstream.  v2 has
no `pin.ts` substitution step.

**byproduct-consumer recipes**: same approach as v1 — excluded from the
main LP, throughput computed post-solve from item surplus.  Code copied
into v2.

**No fast path**: v2 always runs the LP.  The LU fast path stays in v1.
The complexity of detecting "is this system square and non-singular" is
not worth carrying into v2 when the LP solver is fast enough at our scale.

### LP library

`javascript-lp-solver` (MIT, pure JS, ~50 KB).  If precision issues
surface during testing on real plans, swap to `glpk.js` (WASM, ~1 MB).

### Surplus rendering

When the LP returns a positive net for an item that v1 would have called
"intermediate":

- If the item is **not a goal**: render it as a **byproduct** — reuse the
  existing byproduct tile UI, no new visual category.
- If the item **is a goal**: the surplus adds to the goal's output.  The
  goal tile shows actual throughput (≥ requested rate); no separate tile.

This is a v2-only behavior — v1 keeps its current rendering.

### Warning types (v2 only)

Replace v2's emission of `'underdetermined'` with three distinct types
in `src/data/types.ts`:

```ts
| { type: 'too-many-alternatives'; recipeIds: string[] }
  // multiple recipes can produce the same goal/intermediate, LP has
  // freedom the user probably didn't intend
| { type: 'overconstrained'; surplusItems: string[] }
  // intermediates with positive net at LP optimum — internal flows can't
  // all balance; surplus items shown as byproducts
| { type: 'infeasible-pins'; recipeIds: string[] }
  // LP reports infeasibility traceable to pinned-rate equalities
```

(The third replaces the seed's `singular-cycle`: with LP + pin equalities,
an unanchored cycle is just an LP with multiple optima, handled by the
objective; the genuine new failure mode is infeasible pins.)

v1 keeps `'underdetermined'` unchanged — no v1 modifications.
`SolverWarning` becomes a union of v1 types ∪ v2 types during migration;
v1-only types disappear when v1 is deleted.

**User-facing copy** (WarningsPopover):

| Type | Title | Body | Hint |
|---|---|---|---|
| `too-many-alternatives` | "Ambiguous production split" | "X recipes can all produce \<item\>." | "Pin one recipe's rate to set the split, or remove a recipe you don't need." |
| `overconstrained` | "Recipe network can't fully balance" | "The internal flows of \<items\> can't all balance — the surplus is shown as a byproduct." | "Two recipes likely share a material loop with incompatible ratios." |
| `infeasible-pins` | "Pinned rate is impossible" | "The pinned rate on \<recipe\> can't be reached given the other recipes." | "Unpin it, or change which recipes are active." |

---

## Testing strategy (real data, from day one)

### Cross-solver harness — primary safety net

`src/solver/__harness__/cross-solver.test.ts`: for every fixture in
`__fixtures__/` (including the captured Nullius plan), run **both** v1 and
v2, snapshot:

- per-recipe throughput rates (relative tolerance, e.g. 1e-6)
- emitted warning types
- raw / byproduct / surplus item rates

The snapshot file is committed.  A diff means a behavioral change between
solvers — expected for the failing plan, unexpected elsewhere.  This is
how we know v2 doesn't regress on plans that v1 already solves correctly.

### Captured Nullius plan as a first-class fixture

Move/copy [factorio-plan-2026-04-26-15-09.json](factorio-plan-2026-04-26-15-09.json)
into `src/solver/__fixtures__/nullius-ethylene-methane.json`.  Keep the
original under `docs/lp-solver/` for reference.

A unit test (`src/solver/v2/index.test.ts`) loads this fixture and asserts:
- ethylene output ≥ 800/min
- methane output ≥ 400/min
- exactly one `overconstrained` warning, naming `steam` or `oxygen`
- the surplus item appears as a byproduct in the relevant node's outputs

### e2e — UI toggle and fixture-driven

Two Playwright specs:

1. `e2e/solver-version-toggle.spec.ts` — load a plan saved with `solverVersion: 1`,
   toggle to `2` in the UI, assert (a) the toggle persists in localStorage,
   (b) the rendered rates change for the failing plan.
2. `e2e/lp-solver-overconstrained.spec.ts` — load the captured plan (already
   `solverVersion: 2`), assert the goals tiles show ≥ 800 / ≥ 400, the
   overconstrained warning appears in `WarningsPopover`, and the surplus
   item is rendered as a byproduct tile.

### Build slice-by-slice, harness-gated

Each implementation slice ends with the cross-solver harness green on the
captured fixture before moving to the next:

1. Plan schema: add `solverVersion`, Zod migration, persistence test
2. Move v1 into `src/solver/v1/` (no behavior change, all v1 tests still pass)
3. Dispatcher in `src/solver/index.ts`
4. v2 skeleton: classification + LP build, no pins, no surplus, no bc-recipes
   — passes a trivial fixture
5. v2 + pinned rates as equalities, `infeasible-pins` warning
6. v2 + byproduct-consumer post-pass
7. v2 surplus → byproduct rendering wiring; warnings UI copy
8. Cross-solver harness on full fixture set, captured plan asserted green
9. e2e specs

### Real-data discovery

The user is actively playing Nullius and will export additional plans that
misbehave.  Each becomes a new fixture in `__fixtures__/` and a new entry
in the cross-solver harness.  Don't try to enumerate failure modes upfront.

---

## Files to change

| File | Change |
|---|---|
| `src/solver/v1/**` | Move existing solver here, no behavior change |
| `src/solver/v2/**` | New LP solver |
| `src/solver/index.ts` | Dispatcher on `plan.solverVersion` |
| `src/solver/__harness__/cross-solver.test.ts` | New cross-solver diff test |
| `src/solver/__fixtures__/nullius-ethylene-methane.json` | Copy of captured plan |
| `src/data/types.ts` | Add `solverVersion`; add v2 warning variants |
| `src/data/`*plan-schema-file* | Zod field + migration |
| `src/components/factory/WarningsPopover.tsx` | Copy for the three new warning types |
| `src/components/factory/`*plan-header* | Solver-version toggle UI (minimal) |
| `package.json` | Add `javascript-lp-solver` |
| `e2e/solver-version-toggle.spec.ts` | New |
| `e2e/lp-solver-overconstrained.spec.ts` | New |

---

## What must NOT change

- v1 solver behavior (it stays bit-for-bit identical until deleted)
- Existing v1 tests (move with the code, keep passing)
- The `byproductConsumer` feature (re-implemented in v2 by copy)
- The `byproductPolicy` (still applied pre-solve in v2)
- The `SolvedNode` shape — downstream UI must work for both solvers
- Persistence round-trip for existing plans (covered by extended persistence test)

---

## Key invariants for v2

1. **Goals are hard lower bounds** (`≥ d_i`), never part of the objective.
2. **Non-negative throughputs** enforced by the LP, not post-hoc clamping.
3. **Pinned rates are LP equalities**; infeasibility surfaces as
   `infeasible-pins`, not silent zero-clamping.
4. **Raw resource consumption** computed post-solve from negative net flows.
5. **Surplus intermediates** render as byproducts; surplus on a goal item
   adds to that goal's output.

---

## Success criteria

Given the captured Nullius plan
([factorio-plan-2026-04-26-15-09.json](factorio-plan-2026-04-26-15-09.json)):

- [ ] `solverVersion: 2` in the plan; UI toggle round-trips
- [ ] Goals met: ethylene ≥ 800/min, methane ≥ 400/min
- [ ] One `overconstrained` warning naming steam or oxygen
- [ ] Surplus item rendered as a byproduct tile
- [ ] Cross-solver harness green on all other fixtures (no regressions)
- [ ] All existing v1 tests still pass
- [ ] Two new e2e specs pass
