# Solver Design

The solver is the computational core of the planner. It takes a set of production goals and a set of recipe/machine configurations and produces a complete, balanced production plan.

---

## Why a Matrix Solver

A naive recursive approach (walk the recipe tree, multiply rates) fails in two cases:

1. **Cycles** — coal liquefaction consumes heavy oil to produce more coal; Kovarex enrichment cycles U-235/U-238. A recursive walker either loops infinitely or requires ad-hoc cycle-breaking.
2. **Multi-output recipes** — advanced oil processing produces light oil, heavy oil, and petroleum gas simultaneously. If all three are needed downstream, the rates must be balanced globally, not greedily per-product.

A linear system handles both naturally: cycles become additional constraints in the same matrix, and multi-output recipes share a single throughput variable.

---

## Formulation

### Variables

Let there be `n` recipes reachable from the production goals. The unknowns are:

```
x = [x_1, x_2, ..., x_n]   (recipe throughput, in executions/minute)
```

### Stoichiometry Matrix

Build an `m × n` matrix `S` (m = number of distinct items/fluids):

```
S[i][j] = net production of item i per execution of recipe j
         = sum(products where itemId == i) * productivity
         - sum(ingredients where itemId == i)
```

For items that only appear as ingredients (raw resources), the row will be all-negative or zero.

### Demand Vector

```
d[i] = desired net output rate for item i (items/minute)
     = goal rate if item i is a production goal
     = 0 for all intermediates (consumed = produced)
     = unconstrained for raw resources and byproducts
```

### System

```
S · x = d     subject to x >= 0
```

This is an underdetermined system in general (more items than recipes or vice versa). The approach:

1. For items that are **pure intermediates** (appear as both product and ingredient, no external goal), add the constraint `net = 0`: their row in `S · x = d` contributes `d[i] = 0`.
2. For **production goals**, set `d[i] = goal_rate`.
3. For **raw resources** (items with no producing recipe), treat as free inputs — remove their row from the system, record the computed demand as a `UnsatisfiedItem`.
4. For **byproducts** with `policy = "feed-back"` (default), keep the row — the solver will route surplus output to satisfy downstream demand. With `policy = "discard"`, remove the row (excess output is dropped and the solver ignores it).

After reduction, the system should be square and determined for well-formed inputs.

---

## Algorithm

```
1. Collect all reachable recipes via BFS from production goals.
2. Assign an index to each recipe and each item.
3. Build stoichiometry matrix S.
4. Partition items into: goals | intermediates | raw | byproducts.
5. Reduce system per partition rules above.
6. If any recipe rate is pinned (user override), substitute x_j = pinned_value,
   move its column to the RHS, reduce dimensions.
7. Solve the reduced system via LU decomposition.
   - If rank-deficient: flag underdetermined warning, fall back to least-squares (pseudoinverse).
   - If any x_i < 0: flag infeasible, report which recipes.
8. Back-substitute pinned variables.
9. Compute per-node outputs: inputRates, outputRates, machineCount, powerKw.
```

---

## Machine Count and Power

Given recipe throughput `x_j` (executions/minute):

```
machineCountExact = x_j * recipe.craftingTime / 60 / machine.craftingSpeed / productivityMultiplier

powerKw = machineCountCeil * (machine.energyConsumption * speedMultiplier + machine.drainConsumption)
        + beaconPowerKw
```

Module effects are applied as multipliers on the machine's base crafting speed and energy consumption. Productivity modules also affect the stoichiometry matrix (they increase effective product output, which the solver must account for in step 3 above).

---

## Productivity and Stoichiometry

When productivity modules are present:

```
S[i][j] (for products) = amount * (1 + productivityBonus)
S[i][j] (for ingredients) = -amount   (unchanged)
```

This means productivity effectively reduces upstream demand. The solver handles this by recomputing `S` after the user configures modules, then re-solving.

---

## Cycles

A cycle (e.g. recipe A produces item X, recipe B consumes X and produces Y, recipe A also consumes Y) results in a square, non-singular system if there is an external demand. The LU decomposition handles this directly — no special cycle-breaking is needed as long as the system is determined.

If a cycle has no external demand it is rank-deficient. The solver warns with `cycle-detected` and sets those recipe rates to 0 (no reason to run them).

---

## Alternate Recipe Selection

The user may select, per item, which recipe to use when multiple recipes produce that item. This is a discrete choice that changes which recipes are included in the system. After the user changes a recipe selection, the solver re-runs from step 1.

Items with multiple producing recipes and no user selection use the non-alternate recipe by default.

---

## Incremental Re-solving

The solver is stateless and fast enough to re-run fully on every change. There is no incremental update logic. The UI should debounce user inputs and call the solver once per settled state.
