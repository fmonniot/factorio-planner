# Solver Design

The solver is the computational core of the planner. It takes a set of production goals and a set of recipe/machine configurations and produces a complete, balanced production plan.

---

## Why a Linear Program

A naive recursive walk over the recipe graph fails in two cases:

1. **Cycles** — coal liquefaction consumes heavy oil to produce more coal; Kovarex enrichment cycles U-235/U-238. A recursive walker either loops indefinitely or requires ad-hoc cycle-breaking.
2. **Multi-output recipes** — advanced oil processing produces light oil, heavy oil, and petroleum gas simultaneously. If all three are needed downstream, throughputs must balance globally, not greedily per-product.

A linear program handles both naturally: cycles are just additional constraints, multi-output recipes share a single throughput variable, and the LP picks among alternative recipes by minimising total throughput. The solver uses [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver) — a pure-JS simplex implementation. Problems are small (< 200 variables for any realistic plan); performance is not a concern.

---

## Item classification

For each item that appears in the active recipe set, classify it into exactly one bucket (see [src/solver/build.ts](../src/solver/build.ts)):

- **goal** — appears in `plan.goals`. Drives a hard "produce at least X per minute" constraint.
- **intermediate** — produced and consumed by recipes in the plan. Must net to ≥ 0 (no surplus, no deficit), with elastic slack so an unbalanced plan still solves with an explicit "external import" report.
- **raw** — no producer in the active recipe set. Treated as a free input; consumption is reported as `UnsatisfiedItem`.
- **byproduct** — has producers but no consumers. Excluded from the LP rows; the LP doesn't try to balance them.

`goals` take priority — an item that appears in `plan.goals` is a goal even if recipes also produce/consume it.

---

## LP formulation

Variables (see [src/solver/solve.ts](../src/solver/solve.ts)):

```
x_j ≥ 0   for each recipe j           (throughput, executions/minute)
s_i ≥ 0   for each goal/intermediate  (external import slack)
```

Constraints:

```
Σ S_ij · x_j        ≥ d_i      for each goal i           (hard, no slack)
Σ S_ij · x_j + s_i  ≥ 0        for each intermediate i   (elastic — slack allowed)
x_j                 = pin_j    for each pinned recipe j
```

`S_ij` is the net stoichiometry coefficient: positive = produced per execution, negative = consumed. Productivity bonuses scale only the `amount − ignoredByProductivity` portion of products before they enter `S` (`effectiveProductAmount` in `build.ts`).

Objective:

```
minimize  Σ x_j  +  BIG_M · Σ s_i  +  BC_BONUS · Σ x_j (j ∈ byproductConsumer)
```

Where `BIG_M = 1e6` makes slack the last-resort balancer (the LP only imports an item if the network genuinely cannot produce it internally), and `BC_BONUS = -0.01` is a tiny negative coefficient that nudges byproduct-consumer recipes to run up to whatever surplus the intermediate constraints permit, without ever overriding goal-meeting decisions.

---

## Slack, surplus, and warnings

The LP always returns a feasible solution as long as goals have producers and pins don't conflict. Three diagnostic passes interpret the result:

- **Goal shortfall** — if a goal's `outputRates − inputRates` across all nodes is below its `rate`, the deficit is reported as `UnsatisfiedItem`. Happens when no LP-active producer exists or pinned rates conflict.
- **Intermediate slack** — any `s_i > 1e-6` is reported as `UnsatisfiedItem` ("must come from outside") and surfaced in the Ingredients pane.
- **Raw consumption** — for items classified as `raw`, total consumption across recipes is summed and reported as `UnsatisfiedItem`.
- **Overconstrained** — if an intermediate ends with positive net flow at the LP optimum (surplus that can't be discarded), emits the `overconstrained` warning with the surplus items and rates.
- **Too-many-alternatives** — if a goal or intermediate has more than one active producer (multiple `x_j > 1e-6` with positive `S_ij`), emits `too-many-alternatives`. Usually a sign that a recipe selection is missing.
- **Duplicate-recipe** — same `recipeId` used by multiple plan nodes; emitted up front, before the LP.
- **Infeasible-pins** — LP infeasible AND pins are present. Emitted as `infeasible-pins` with the pinned recipe ids.

`SolverWarning` is the discriminated union in [src/data/types.ts](../src/data/types.ts).

---

## Pinned rates, byproduct policies, byproduct consumers

These three knobs sit on individual `RecipeNode`s and are consumed by `solve()`:

- **`pinnedRate`** — translates to `x_j = rate` (equality constraint). Useful for "I want exactly N machines of this".
- **`byproductPolicy[itemId] = 'discard'`** — zeroes the recipe's positive coefficient for that item in `S` before classification, so the item is no longer treated as produced by this recipe.
- **`byproductConsumer = true`** — flips the recipe's objective coefficient from `+1` to `BC_BONUS`. The recipe also auto-extends `noImportItems` with its ingredients, so the LP can't import them just to fire the bonus — it must consume from another in-plan producer.

`noImportItems` makes a constraint hard (no slack variable on its row). The user can also pass an explicit list per plan.

---

## Sub-plans

Sub-plans are a UI/persistence grouping only. They do not affect solver output: every `RecipeNode` in the tree, regardless of how deeply nested in `subPlans`, is flattened into a single global LP per `Block` via [`flattenBlock(block)`](../src/solver/index.ts) before `solve()` runs. Goals and `noImportItems` live on the `Block`, not on individual subplans.

Wrapping a recipe into a subplan for organisation has no effect on its computed throughput. Solver entry point: `solve(plan, gameData)`, where `plan = flattenBlock(block)`.

---

## Machine count and power

Per node, given recipe throughput `x_j` (executions/minute):

```
machineCountExact = x_j · craftingTime / 60 / craftingSpeed / (1 + speedBonus)
machineCountCeil  = Math.ceil(machineCountExact)
powerKw           = machineCountCeil · energyConsumption · (1 + consumptionBonus)
                  + beaconCount · beaconBasePower · (1 + beaconConsumptionBonus)
```

Module and beacon effects are computed in [src/solver/effects.ts](../src/solver/effects.ts) (`computeNodeEffects` + `computeMachineMetrics`).

---

## Statelessness

The solver is fully stateless: every call recomputes from scratch. There is no incremental update logic. The store debounces (150 ms) so a burst of UI input collapses to one solve.
