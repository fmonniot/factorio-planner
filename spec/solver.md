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

Entry point: `solveAll(blocks, gameData)` in [src/solver/index.ts](../src/solver/index.ts). It orders the blocks with `orderBlocks` ([src/solver/blockGraph.ts](../src/solver/blockGraph.ts)) so every source is solved before its consumers, then calls `solveBlock(plan, gameData, supplyCaps)` for each one, where `plan = flattenBlock(block)` and `supplyCaps` is what the block's sources have on offer (empty for a block without connections; see [Connections between blocks](#connections-between-blocks)). `solve(plan, gameData)` is `solveBlock` without supply, returning only the `SolverResult`.

Per block, `solveBlock` runs:

1. Keep only `game-recipe` nodes. One LP variable per distinct `recipeId`: nodes that share a recipe share one throughput (and a `duplicate-recipe` warning is emitted).
2. `computeNodeEffects` — module + beacon bonuses per node ([src/solver/effects.ts](../src/solver/effects.ts)).
3. `buildClassifiedSystem` — net stoichiometry `S[item][recipe]` with productivity applied, and item classification ([src/solver/build.ts](../src/solver/build.ts)).
4. `no-recipe` check on goals.
5. Apply `byproductPolicy = 'discard'` (zeroes coefficients in `S`).
6. Collect pins and the no-import set.
7. `solveLP` — build and solve the LP ([src/solver/solve.ts](../src/solver/solve.ts)); a second pass when connected supply is needed.
8. Diagnostics: overconstrained surplus, goal shortfalls, intermediate slack, raw consumption (reduced by what was received).
9. `computeMachineMetrics` — machine count and power per node.

The result is a `SolverResult` `{ nodes, unsatisfied, warnings }` (see [src/data/types.ts](../src/data/types.ts)); `solveAll` returns one per block plus the connection flows. Rates are per minute; recipe throughput is executions per minute.

---

## Item classification

For each item that appears in the active recipe set, `buildClassifiedSystem` puts it in exactly one bucket:

- **goal** — appears in the block's goals. Drives a hard "produce at least X per minute" constraint.
- **intermediate** — produced and consumed by recipes in the plan. Must net to ≥ 0 (no deficit; surplus is allowed by the constraint and reported afterwards as `overconstrained`), with elastic slack so an unbalanced plan still solves with an explicit "external import" report.
- **raw** — no producer in the active recipe set. Treated as a free input; consumption is reported as `UnsatisfiedItem`. An ore or pumped fluid is raw until the block has its extraction row (a `mining:` or `offshore:` recipe, see [data-model.md](data-model.md#extraction-recipes)); with the row it is an intermediate like any other.
- **byproduct** — has producers but no consumers. Excluded from the LP rows; the LP doesn't try to balance them.

Goals take priority — an item that is a goal is a goal even if recipes also produce/consume it.

---

## LP formulation

Variables:

```
x_j ≥ 0   for each recipe j                                   (throughput, executions/minute)
s_i ≥ 0   for each intermediate i not in noImportItems        (external import slack)
u_i ≥ 0   for each intermediate i with a supply cap           (supply from another block; pass 2 only)
```

Constraints:

```
Σ S_ij · x_j        ≥ d_i      for each goal i with a row in S             (hard, no slack)
Σ S_ij · x_j + s_i  ≥ 0        for each intermediate i                     (elastic)
Σ S_ij · x_j        ≥ 0        for each intermediate i in noImportItems    (hard)
Σ S_ij · x_j + u_i (+ s_i)  ≥ 0, u_i ≤ cap_i   for each intermediate i with a supply cap
x_j                 = pin_j    for each pinned recipe j
```

`S_ij` is the net stoichiometry coefficient: positive = produced per execution, negative = consumed. Productivity bonuses scale only the `amount − ignoredByProductivity` portion of products, then the result is multiplied by `probability` (`effectiveProductAmount` in `build.ts`). Productivity is applied before items enter `S`; speed and consumption only affect machine count and power after the solve.

Objective:

```
minimize  Σ c_j · x_j  +  BIG_M · Σ s_i      (supply u_i costs 0)
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
- **Raw consumption** — total consumption of each `raw` item across recipes, minus what the block receives of it from connected blocks (dropped when nothing is left). Items already reported as a goal shortfall are skipped.

`unsatisfied` is ordered goal shortfalls, then intermediate slack, then raw consumption.

---

## Pinned rates, byproduct policies, byproduct consumers, no-import items

The first three knobs sit on individual recipe nodes; `noImportItems` sits on the `Block`.

- **`pinnedRate`** — translates to `x_j = rate` (equality constraint). Useful for "I want exactly N machines of this".
- **`byproductPolicy[itemId] = 'discard'`** — zeroes the recipe's positive coefficient for that item in `S`. This happens **after** classification and before the LP, so the item keeps its classification; it affects only the LP rows. `SolvedNode.outputRates` still include the discarded product.
- **`byproductPolicy[itemId] = 'feed-back'`** — the default in the UI. A no-op for the solver.
- **`byproductConsumer = true`** — flips the recipe's objective coefficient from `+1` to `BC_BONUS`. Its ingredients are added to the no-import set, so the LP can't import them just to fire the bonus — they must come from another in-plan producer.
- **`noImportItems`** (per block) — removes the slack variable from the item's row, making it hard. This only matters for intermediates: goals never have slack, and raw items have no LP row, so a raw byproduct-consumer ingredient stays a free input. An ore that has an extraction row is an intermediate, so a lock on it applies.

`primaryProduct` on a node is display-only; the solver ignores it.

---

## Connections between blocks

A `BlockConnection` on block B says "B receives item X from block A" (see [data-model.md](data-model.md#block)). The model is push-based: A's own goals drive A's LP and consumers only draw on what A has left over. **B always uses its own recipes first**; connected supply covers only what B would otherwise import.

**Offer.** What a source can offer of X is `max(0, Σ outputRates[X] − Σ inputRates[X])` over its solved nodes (`netBalance`): goal output, surplus intermediates and byproducts. A block's received items are consumed by its own recipes, so it never re-exports them.

**Solve order.** `orderBlocks` sorts blocks topologically (Kahn's algorithm, ties broken by position in `blocks`). `solveAll` keeps, per block, the offer still unclaimed. Several consumers of the same `(A, X)` are served in solve order, each getting what earlier ones left. Several sources of the same `(B, X)` are summed into one cap, and the amount delivered is split between them in `inputConnections` order. A block with no goals or no nodes offers and receives nothing.

**What B takes.** `delivered = min(what B would otherwise import, what is still on offer)`, where "would otherwise import" depends on how X is classified in B:

- **Raw in B** (no recipe in B makes X): all of B's consumption of X. No LP change; after the solve `received = min(consumption, cap)` and the `rawConsumption` entry is reduced by it.
- **Intermediate in B** (B can make X): the slack B needs for X after running its own recipes as far as they go. Pins, locked upstream items or missing upstream recipes limit how far that is.
- **Goal or byproduct in B**: nothing is taken (flow status `unused`).

**Own production first: two passes.** One LP cannot guarantee the ordering (a cost on the supply variable would have to exceed an unbounded recipe-chain cost yet stay below `BIG_M` times the units it replaces), so `solveBlock` runs up to two:

1. *Measure.* Solve with no supply variables. Connected items are removed from the no-import set for this pass only, so a locked connected item reports its shortfall as slack instead of making the LP infeasible. The residual of a connected intermediate is its slack.
2. *Fill.* Only if some connected intermediate has a residual above `1e-6`: solve again with the original no-import set plus, per such item, a supply variable `u_i` (objective cost 0) and a constraint `u_i ≤ min(cap_i, residual_i)`. Capping at the residual keeps own production at its pass-1 level (replacing it would bring slack back at `BIG_M`), and supply fills the gap ahead of slack (0 < `BIG_M`).

Diagnostics come from the final pass only. The amount actually received is computed after the solve as `min(u_i, max(0, −net_i))` rather than from `u_i` alone, because a degenerate optimum may leave `u_i` above the deficit. Locking an item (`noImportItems`) does not block connected supply. If the offer covers the whole residual of a locked item, the lock holds in pass 2. If it covers only part, the lock is dropped for that item in pass 2 (an infeasible LP would return meaningless values and discard the valid pass-1 answer): pins stay honoured, supply fills what is on offer, the rest shows up as an import, and the flow is `limited`.

**Own production that needs an import.** If B can make X only by importing an upstream item Y, whether the connected X replaces that import depends on the recipe ratio, because pass 1 picks the cheaper of two slacks. Slack on X costs `BIG_M` per unit; slack on Y plus running the recipe costs `BIG_M · (Y per X) + 1`. With 1 Y per X (or more Y per X) the slack on X is cheaper, so X is reported short and the supply fills it. When the recipe yields more X than it consumes Y (for example 1 Y makes 2 X), importing Y is cheaper: Y stays an import and the connected X is not used. Connect Y as well to feed it. The rule is an artefact of the objective and is not tuned; see the backlog item "Let connected supply replace an upstream import". Supply never makes a byproduct-consumer recipe run harder: it only fills a shortfall, while that recipe only consumes surplus.

**Flow status** (`ConnectionFlow.status`, per connection):

- `limited` — B still imports the item and takes everything on offer (`rate ≥ available − 1e-6`).
- `unused` — otherwise, when `rate ≤ 1e-6` (B makes the item, or does not need it from outside), and always for a repeated `(fromBlockId, itemId)` pair. A goal item is never fed, so the UI does not offer a connection on a goal shortfall; a goal connection from imported JSON just reads `unused`.
- `ok` — otherwise.
- `missing-source` — the source block does not exist; the connection is ignored.
- `cycle` — the connection lies on a cycle (the store rejects those when adding, undoing and redoing, so only imported or hand-edited JSON can contain one); it is ignored. Every other block is still solved.

A repeated `(fromBlockId, itemId)` on one block counts once. A block whose solve throws gets an empty result, offers nothing, and is reported in `MultiBlockSolve.errors`; other blocks are unaffected.

---

## Sub-plans

Sub-plans are a UI/persistence grouping only. They do not affect solver output: every node in the tree, regardless of how deeply nested in `subPlans`, is collected into a single global LP per `Block` via [`flattenBlock(block)`](../src/solver/index.ts) before `solve()` runs. `flattenBlock` collects every node including `subplan` handles; `solve()` keeps only `kind === 'game-recipe'`. Goals and `noImportItems` live on the `Block`, not on individual sub-plans.

Wrapping a recipe into a sub-plan for organisation has no effect on its computed throughput.

---

## Machine count and power

Machine resolution per node: `planNode.machineId ?? <default machine for recipe.category>`. `wireSolver` supplies the plan's effective `defaultMachines` (the research horizon's, with the plan's `defaultMachineOverrides` layered on top; identical to `gameData.defaultMachines` when there is no limit and no override; see [data-model.md](data-model.md#technology)), so a category with no machine inside the horizon has no default. If no machine is found, machine count and power are 0; throughput, input and output rates and connection flows do not depend on the machine and are unchanged. Module and beacon effects still apply to the LP on such a node. No warning is emitted; the UI flags the row.

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

Drain is not affected by consumption modules. Beacon power is not counted. For a mining drill or offshore pump, `craftingSpeed` is its mining or pumping speed (an offshore pump recipe yields 60 units per craft, so one pump of speed 20 makes 1200 per second).

---

## Statelessness and store integration

The solver is fully stateless: every call recomputes from scratch. There is no incremental update logic.

`wireSolver()` in [src/store/solverStore.ts](../src/store/solverStore.ts) subscribes to the block and game-data stores and debounces (150 ms) so a burst of UI input collapses to one `solveAll` over every block (up to two LPs per block). It skips the solver when no game data is loaded — status becomes `idle`. A block with zero goals or zero nodes gets an empty result.

The store keeps `lastResults` (every block's result by id) and `flows`. `status` and `lastResult` follow the active block, so `selectSolverResult` is unchanged. A solver exception in the active block sets status `error`; in any other block it only leaves that block's result empty. `lastResult` keeps the most recent successful result while a re-solve is pending, so views don't flash.
