# Solver Design

The solver is the computational core of the planner. It takes a set of production goals and a set of recipe/machine configurations and produces a complete, balanced production plan.

---

## Why a Linear Program

A naive recursive walk over the recipe graph fails in two cases:

1. **Cycles** — coal liquefaction consumes heavy oil to produce more coal; Kovarex enrichment cycles U-235/U-238. A recursive walker either loops indefinitely or requires ad-hoc cycle-breaking.
2. **Multi-output recipes** — advanced oil processing produces light oil, heavy oil, and petroleum gas simultaneously. If all three are needed downstream, throughputs must balance globally, not greedily per-product.

A linear program handles both naturally: cycles are just additional constraints, multi-output recipes share a single throughput variable, and the LP picks among alternative recipes by minimising total throughput. The solver uses [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver) — a pure-JS simplex implementation. Problems are small (< 200 variables for any realistic plan); performance is not a concern.

---

## Pipeline

Entry point: `solve(plan, gameData)` in [src/solver/index.ts](../src/solver/index.ts), where `plan = flattenBlock(block)`.

1. Keep only `game-recipe` nodes. One LP variable per distinct `recipeId`: nodes that share a recipe share one throughput (and a `duplicate-recipe` warning is emitted).
2. `computeNodeEffects` — module + beacon bonuses per node ([src/solver/effects.ts](../src/solver/effects.ts)).
3. `buildClassifiedSystem` — net stoichiometry `S[item][recipe]` with productivity applied, and item classification ([src/solver/build.ts](../src/solver/build.ts)).
4. `no-recipe` check on goals.
5. Apply `byproductPolicy = 'discard'` (zeroes coefficients in `S`).
6. Collect pins and the no-import set.
7. `solveLP` — build and solve the LP ([src/solver/solve.ts](../src/solver/solve.ts)).
8. Diagnostics: overconstrained surplus, goal shortfalls, intermediate slack, raw consumption.
9. `computeMachineMetrics` — machine count and power per node.

The result is a `SolverResult` `{ nodes, unsatisfied, warnings }` (see [src/data/types.ts](../src/data/types.ts)). Rates are per minute; recipe throughput is executions per minute.

---

## Item classification

For each item that appears in the active recipe set, `buildClassifiedSystem` puts it in exactly one bucket:

- **goal** — appears in the block's goals. Drives a hard "produce at least X per minute" constraint.
- **intermediate** — produced and consumed by recipes in the plan. Must net to ≥ 0 (no deficit; surplus is allowed by the constraint and reported afterwards as `overconstrained`), with elastic slack so an unbalanced plan still solves with an explicit "external import" report.
- **raw** — no producer in the active recipe set. Treated as a free input; consumption is reported as `UnsatisfiedItem`.
- **byproduct** — has producers but no consumers. Excluded from the LP rows; the LP doesn't try to balance them.

Goals take priority — an item that is a goal is a goal even if recipes also produce/consume it.

---

## LP formulation

Variables:

```
x_j ≥ 0   for each recipe j                                   (throughput, executions/minute)
s_i ≥ 0   for each intermediate i not in noImportItems        (external import slack)
```

Constraints:

```
Σ S_ij · x_j        ≥ d_i      for each goal i with a row in S             (hard, no slack)
Σ S_ij · x_j + s_i  ≥ 0        for each intermediate i                     (elastic)
Σ S_ij · x_j        ≥ 0        for each intermediate i in noImportItems    (hard)
x_j                 = pin_j    for each pinned recipe j
```

`S_ij` is the net stoichiometry coefficient: positive = produced per execution, negative = consumed. Productivity bonuses scale only the `amount − ignoredByProductivity` portion of products, then the result is multiplied by `probability` (`effectiveProductAmount` in `build.ts`). Productivity is applied before items enter `S`; speed and consumption only affect machine count and power after the solve.

Objective:

```
minimize  Σ c_j · x_j  +  BIG_M · Σ s_i
          c_j = BC_BONUS for byproduct-consumer recipes, 1 otherwise
```

`BIG_M = 1e6` makes slack the last-resort balancer (the LP only imports an item if the network genuinely cannot produce it internally). `BC_BONUS = -0.01` is a tiny negative coefficient that nudges byproduct-consumer recipes to run up to whatever surplus the intermediate constraints permit, without ever overriding goal-meeting decisions.

Tolerances: slack is reported only above `SLACK_TOLERANCE = 1e-6`; intermediate surplus above `SURPLUS_TOLERANCE = 1e-6` triggers `overconstrained`; goal shortfall is reported above `GOAL_SHORTFALL_TOLERANCE = 1e-4`.

---

## Infeasibility

Goals have no slack and `noImportItems` intermediates have no slack, so the LP can be infeasible: conflicting pins, or a no-import item the network cannot produce in sufficient quantity. When it is infeasible:

- If any pin is present, the `infeasible-pins` warning is emitted with all pinned recipe ids.
- Without pins, no warning is emitted; the problem shows up only as goal shortfalls in `unsatisfied`.
- Throughputs are whatever the LP solver returned for each variable, clamped to ≥ 0. Pinned throughputs are forced to the pin value only when the LP is feasible.

A goal with no producer in the plan has no row in `S` and therefore no LP constraint; it gets a `no-recipe` warning and a goal shortfall.

---

## Warnings and unsatisfied items

Warnings (`SolverWarning` in [src/data/types.ts](../src/data/types.ts)):

- **`duplicate-recipe`** — the same `recipeId` is used by more than one node; emitted before the LP, with the count.
- **`no-recipe`** — a goal item has no positive coefficient in `S` (no producer in the plan); emitted before the LP. Checked before `discard` policies are applied.
- **`infeasible-pins`** — the LP is infeasible and pins are present.
- **`overconstrained`** — one or more intermediates end with positive net flow at the LP optimum; lists each surplus item and rate.

Warnings come out in that order: `duplicate-recipe`, `no-recipe`, then the LP warnings (`infeasible-pins`, `overconstrained`).

Unsatisfied items (`UnsatisfiedItem`, surfaced in the Ingredients pane):

- **Goal shortfall** — goal target minus the net actual rate (sum of `outputRates − inputRates` over all nodes), when positive.
- **Intermediate slack** — each `s_i` above tolerance: the item must come from outside.
- **Raw consumption** — total consumption of each `raw` item across recipes. Items already reported as a goal shortfall are skipped.

`unsatisfied` is ordered goal shortfalls, then intermediate slack, then raw consumption.

---

## Pinned rates, byproduct policies, byproduct consumers, no-import items

The first three knobs sit on individual recipe nodes; `noImportItems` sits on the `Block`.

- **`pinnedRate`** — translates to `x_j = rate` (equality constraint). Useful for "I want exactly N machines of this".
- **`byproductPolicy[itemId] = 'discard'`** — zeroes the recipe's positive coefficient for that item in `S`. This happens **after** classification and before the LP, so the item keeps its classification; it affects only the LP rows. `SolvedNode.outputRates` still include the discarded product.
- **`byproductPolicy[itemId] = 'feed-back'`** — the default in the UI. A no-op for the solver.
- **`byproductConsumer = true`** — flips the recipe's objective coefficient from `+1` to `BC_BONUS`. Its ingredients are added to the no-import set, so the LP can't import them just to fire the bonus — they must come from another in-plan producer.
- **`noImportItems`** (per block) — removes the slack variable from the item's row, making it hard. This only matters for intermediates: goals never have slack, and raw items have no LP row, so a raw byproduct-consumer ingredient stays a free input.

`primaryProduct` on a node is display-only; the solver ignores it.

---

## Sub-plans

Sub-plans are a UI/persistence grouping only. They do not affect solver output: every node in the tree, regardless of how deeply nested in `subPlans`, is collected into a single global LP per `Block` via [`flattenBlock(block)`](../src/solver/index.ts) before `solve()` runs. `flattenBlock` collects every node including `subplan` handles; `solve()` keeps only `kind === 'game-recipe'`. Goals and `noImportItems` live on the `Block`, not on individual sub-plans.

Wrapping a recipe into a sub-plan for organisation has no effect on its computed throughput.

---

## Machine count and power

Machine resolution per node: `planNode.machineId ?? gameData.defaultMachines[recipe.category]`. If no machine is found, machine count and power are 0.

Effects (`computeNodeEffects`) are additive per effect type (productivity, speed, consumption):

```
bonus = Σ moduleEffect · moduleCount
      + beaconModuleEffect · distributionEfficiency · modulesPerBeacon · beaconCount
```

The solver does not check `allowProductivity`; it trusts the node configuration.

Per node, given recipe throughput `x_j` (executions/minute) — `computeMachineMetrics`:

```
machineCountExact = x_j · craftingTime / 60 / (craftingSpeed · (1 + speedBonus))
machineCountCeil  = Math.ceil(machineCountExact)
powerKw           = machineCountExact · (energyUsageKw · (1 + consumptionBonus) + drainKw)
```

Drain is not affected by consumption modules. Beacon power is not counted.

---

## Statelessness and store integration

The solver is fully stateless: every call recomputes from scratch. There is no incremental update logic.

`wireSolver()` in [src/store/solverStore.ts](../src/store/solverStore.ts) subscribes to the block and game-data stores and debounces (150 ms) so a burst of UI input collapses to one solve of the active block. It skips the solver when:

- no game data is loaded — status becomes `idle`;
- there is no active block, or the block has zero goals or zero nodes — status becomes `solved` with an empty result.

Solver exceptions set status `error`. `lastResult` keeps the most recent successful result while a re-solve is pending, so views don't flash.
