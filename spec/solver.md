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

Entry point: `solveAll(blocks, gameData, cache?, options?)` in [src/solver/index.ts](../src/solver/index.ts). It groups the blocks into components with `orderBlocks` ([src/solver/blockGraph.ts](../src/solver/blockGraph.ts)) and orders them so every source is solved before its consumers; a component of mutually supplying blocks is a loop and is solved in rounds (see [Loops](#loops)). Each block (each round of a loop, for its members) is solved with `solveBlock(plan, gameData, supplyCaps)`, where `plan = flattenBlock(block)` (every node in the tree; the block's products as goals `{ id, itemId, rate }` built by `productGoals`: rate = `extraRate` (0 when absent) plus, for the first product of an item, what other blocks request of it; goals with a rate of 0 or less are dropped; `noImportItems`) and `supplyCaps` is what the block's sources have on offer (empty for a block without connections; see [Connections between blocks](#connections-between-blocks)). `solve(plan, gameData)` is `solveBlock` without supply, returning only the `SolverResult`. With a `SolveCache` ([src/solver/solveCache.ts](../src/solver/solveCache.ts)), a block whose flattened plan, game data object and supply caps (exact values, in order) are all unchanged reuses its previous `solveBlock` output instead of solving again. Offers and flows are still recomputed for every block. A failed solve is never cached. The cache keeps up to three entries per block (most recently used first), so the request probe of a requesting block (see [Requests](#requests)) and the first-round and the settled solve of a block in a loop all survive. Before any block is solved, `computeRequests` works out what requesting consumers ask of their sources and `solveAll` solves each source against its products' extra output plus those requests.

Per block, `solveBlock` runs:

1. Keep only `game-recipe` nodes. One LP variable per distinct `recipeId`: nodes that share a recipe share one throughput (and a `duplicate-recipe` warning is emitted). The first node in flatten order (a plan's own nodes before its sub-plans, depth-first) is authoritative for effects, pin and byproduct settings; later duplicates solve to zero throughput, machines and power, with empty rates.
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

- **goal** — appears in `SolverPlan.goals` (the block's products: extra output plus what other blocks request). Drives a hard "produce at least X per minute" constraint.
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

- **`duplicate-recipe`** — the same `recipeId` is used by more than one node; emitted before the LP, with the count. The first node in flatten order is authoritative; later duplicates solve to zero.
- **`no-recipe`** — a goal item has no positive coefficient in `S` (no producer in the plan); emitted before the LP. Checked before `discard` policies are applied.
- **`infeasible-pins`** — the LP is infeasible and pins are present.
- **`overconstrained`** — one or more intermediates end with positive net flow at the LP optimum; lists each surplus item and rate.
- **`loop-not-converged`** — added by `solveAll` to every member of a loop of blocks that did not settle within the round limit; lists the loop's `blockIds` and the rounds run (see [Loops](#loops)).

Warnings come out in that order: `duplicate-recipe`, `no-recipe`, then the LP warnings (`infeasible-pins`, `overconstrained`); `loop-not-converged` is appended last.

Unsatisfied items (`UnsatisfiedItem`, surfaced in the Ingredients pane):

- **Goal shortfall** — goal target minus the net actual rate (sum of `outputRates − inputRates` over all nodes), when positive.
- **Intermediate slack** — each `s_i` above tolerance: the item must come from outside.
- **Raw consumption** — total consumption of each `raw` item across recipes, minus what the block receives of it from connected blocks (dropped when nothing is left). Items already reported as a goal shortfall are skipped.

`unsatisfied` is ordered goal shortfalls, then intermediate slack, then raw consumption.

---

## Pinned rates, byproduct policies, byproduct consumers, no-import items

The first three knobs sit on individual recipe nodes; `noImportItems` sits on the `Block`.

- **`pinnedRate`** — translates to `x_j = rate` (equality constraint), where `rate` is in executions per minute. Useful for "I want exactly N executions per minute of this" (and so a fixed machine count).
- **`byproductPolicy[itemId] = 'discard'`** — zeroes the recipe's positive coefficient for that item in `S`. This happens **after** classification and before the LP, so the item keeps its classification; it affects only the LP rows. `SolvedNode.outputRates` still include the discarded product.
- **`byproductPolicy[itemId] = 'feed-back'`** — the default in the UI. A no-op for the solver.
- **`byproductConsumer = true`** — flips the recipe's objective coefficient from `+1` to `BC_BONUS`. Its ingredients are added to the no-import set, so the LP can't import them just to fire the bonus — they must come from another in-plan producer.
- **`noImportItems`** (per block) — removes the slack variable from the item's row, making it hard. This only matters for intermediates: goals never have slack, and raw items have no LP row, so a raw byproduct-consumer ingredient stays a free input. An ore that has an extraction row is an intermediate, so a lock on it applies.

`primaryProduct` on a node is display-only; the solver ignores it.

---

## Connections between blocks

A `BlockConnection` on block B says "B receives item X from block A" (see [data-model.md](data-model.md#block)). The kind of a connection is derived, never stored: it is a **request** when item X is one of A's products (`hasProduct`, with or without extra output), and **take existing** otherwise. A *take* only draws on what A has left over: A's own products drive A's LP and consumers share the rest. A *request* is different: B's need for X also drives A (see [Requests](#requests)). Either way **B always uses its own recipes first**; connected supply covers only what B would otherwise import.

**Offer.** What a source can offer of X is `max(0, Σ outputRates[X] − Σ inputRates[X])` over its solved nodes (`netBalance`): goal output, surplus intermediates and byproducts. A block's received items are consumed by its own recipes, so it never re-exports them.

**Solve order.** `orderBlocks` groups blocks into strongly connected components (blocks that supply each other, directly or through other blocks) and sorts the components topologically (Kahn's algorithm, ties broken by the lowest position of a component's blocks in `blocks`). A block outside any loop is its own component and is solved once. `solveAll` keeps, per block, the offer still unclaimed. Several consumers of the same `(A, X)` are served in solve order, each getting what earlier ones left. Several sources of the same `(B, X)` are summed into one cap, and the amount delivered is split between them in `inputConnections` order. A connection's optional `maxRate` caps its share of the offer; whatever the cap holds back stays on offer for consumers solved later. A block with no goals (every product without extra output and unrequested) or no nodes gets the empty result and offers and receives nothing, unless requests give it goals (see [Requests](#requests)).

**What B takes.** `delivered = min(what B would otherwise import, what is still on offer, maxRate)`, where "would otherwise import" depends on how X is classified in B:

- **Raw in B** (no recipe in B makes X): all of B's consumption of X. No LP change; after the solve `received = min(consumption, cap)` and the `rawConsumption` entry is reduced by it.
- **Intermediate in B** (B can make X): the slack B needs for X after running its own recipes as far as they go. Pins, locked upstream items or missing upstream recipes limit how far that is.
- **Product (goal) or byproduct in B**: nothing is taken (flow status `unused`).

**Own production first: two passes.** One LP cannot guarantee the ordering (a cost on the supply variable would have to exceed an unbounded recipe-chain cost yet stay below `BIG_M` times the units it replaces), so `solveBlock` runs up to two:

1. *Measure.* Solve with no supply variables. Connected items are removed from the no-import set for this pass only, so a locked connected item reports its shortfall as slack instead of making the LP infeasible. The residual of a connected intermediate is its slack.
2. *Fill.* Only if some connected intermediate has a residual above `1e-6`: solve again with the original no-import set plus, per such item, a supply variable `u_i` (objective cost 0) and a constraint `u_i ≤ min(cap_i, residual_i)`. Capping at the residual keeps own production at its pass-1 level (replacing it would bring slack back at `BIG_M`), and supply fills the gap ahead of slack (0 < `BIG_M`).

Diagnostics come from the final pass only. The amount actually received is computed after the solve as `min(u_i, max(0, −net_i))` rather than from `u_i` alone, because a degenerate optimum may leave `u_i` above the deficit. Locking an item (`noImportItems`) does not block connected supply. If the offer covers the whole residual of a locked item, the lock holds in pass 2. If it covers only part, the lock is dropped for that item in pass 2 (an infeasible LP would return meaningless values and discard the valid pass-1 answer): pins stay honoured, supply fills what is on offer, the rest shows up as an import, and the flow is `limited`.

**Own production that needs an import.** If B can make X only by importing an upstream item Y, whether the connected X replaces that import depends on the recipe ratio, because pass 1 picks the cheaper of two slacks. Slack on X costs `BIG_M` per unit; slack on Y plus running the recipe costs `BIG_M · (Y per X) + 1`. With 1 Y per X (or more Y per X) the slack on X is cheaper, so X is reported short and the supply fills it. When the recipe yields more X than it consumes Y (for example 1 Y makes 2 X), importing Y is cheaper: Y stays an import and the connected X is not used. Connect Y as well to feed it. The rule is an artefact of the objective and is not tuned; see the backlog item "Let connected supply replace an upstream import". Supply never makes a byproduct-consumer recipe run harder: it only fills a shortfall, while that recipe only consumes surplus.

**Flow status** (`ConnectionFlow.status`, per connection):

- `limited` — B still imports the item and takes everything the connection allows, whether that is the source's offer or the connection's `maxRate` (`rate ≥ available − 1e-6`); `capped` tells which bound applies.
- `unused` — otherwise, when `rate ≤ 1e-6` (B makes the item, or does not need it from outside), and always for a repeated `(fromBlockId, itemId)` pair. A product item is never fed, so the UI does not offer a connection on a product shortfall; such a connection from imported JSON just reads `unused`.
- `ok` — otherwise.
- `missing-source` — the source block does not exist; the connection is ignored.
- `self` — the connection's source is its own block (the store rejects those, so only imported or hand-edited JSON can contain one); it is ignored. Every other block is still solved.

`ConnectionFlow.loop` is `true` on an active flow whose two ends are members of one loop.

A repeated `(fromBlockId, itemId)` on one block counts once. A block whose solve throws gets an empty result, offers nothing, and is reported in `MultiBlockSolve.errors`; other blocks are unaffected.

### Requests

A connection to one of the source's products is a *request*: it makes the source produce what the consumer needs, instead of only offering what its own products leave over. A source whose products have no extra output can be driven this way; a block with requested amounts is solved even though its goals would otherwise be empty. Every connection is either a request or a take; the flow says which (`ConnectionFlow.kind`).

**What is requested by a connection `c` (A → B, item X)** is B's `received(X)` from a *request probe*: B solved with an unlimited cap (`Infinity`) on every connected item. B's need does not depend on what it receives (pass 1 of `solveBlock` never uses supply), so the item B would import with unlimited supply is exactly what it needs from outside. The probe goes through the solve cache like any other solve. A locked item (`noImportItems`) is unlocked in pass 1, so the amount is the residual left after B's own production, and pins are honoured. A block whose probe throws asks for nothing (its supply solve reports the error). B's need for X is given to B's applicable requests for X in `inputConnections` order, each capped by its `maxRate`. Takes for the same item are not subtracted, because their offer is unknown when requests are computed.

**When a request is applied.** The source exists, it is not a self-connection, X is one of A's products (otherwise the connection is a take and is not part of this pass), and:

- *The connection is the first for its `(fromBlockId, itemId)` pair.* Otherwise `requestIgnored: 'duplicate'` (only imported JSON has one) and it delivers nothing.
- *A receives no X itself*: none of A's connections takes X from an existing source (`receivesItem`, the one definition of this rule). Otherwise `requestIgnored: 'source-receives'`, because the supply would cancel A's own.
- *The request is not part of a cycle of requests.* Otherwise `requestIgnored: 'request-loop'`. The store refuses to create such a cycle when a request is added (`closesRequestLoop`), but making an item a product can close one, after confirmation (see [ui.md](ui.md#product-change-confirmation)), and imported JSON can contain one. `closesRequestLoop` follows the same edges as this pass before its cycle check: connections to a product of their source, leaving out those whose source receives the item itself (`source-receives`, decided with the shared `receivesItem`). It still counts `duplicate` connections, which cannot change reachability, and it needs no solver run, so it reads recipes only through products and connections, never flows.

An ignored request takes existing output, exactly like a take: its flow has `kind: 'take'` and `requestIgnored` names the reason. In a cycle of requests every connection of the cycle is ignored.

**The pass.** `computeRequests` orders the blocks consumers first (`orderBlocks` over the applicable requests reversed; a component with more than one block is a cycle of requests, so its connections are ignored). Walking in that order, each block's *effective goals* are `productGoals(block.products, requested)`: every product's `extraRate`, plus the amount requested so far on the first product of the item (additive, not a maximum). Then, if the block has applicable requests as a consumer, the probe gives its need, which is added to its sources. The effective goals exist only inside the solver and are never stored. In one pass the amounts converge; no iteration is needed because requests form a DAG and need only flows from consumer to source.

**Supply phase.** `solveAll` solves each block with its effective goals, in the usual order (sources first), and the take semantics above apply unchanged. To stop a take consumer solved earlier from taking what A made for a requester, and to stop a requester from drawing on a later source beyond its own share, `solveAll` keeps `pending: sourceId → itemId → requested amount not yet served`:

- A connection's offer from `(A, X)` is `connectionOffer(left, pending, share) = max(0, min(share, left), left − (pending − share))`, with `left = remaining(A, X)`, `pending = pending(A, X)` and `share = requested(c)` for an applied request, 0 for a take or an ignored request.
- So a take (or an ignored request) sees `max(0, left − pending)`: only the extra or surplus. A request sees its own share first and, beyond it, what no unserved request holds.
- The offer is then capped by `maxRate` as usual.
- After an applied request is served, `pending(A, X) -= requested(c)`: whatever B left unused goes back to the consumers solved later.

**Shortfall.** When a source makes less than the extra plus all requests, requests are served in solve order and the source's output is a shortage for the last ones. The extra gives way first (it is never reserved), then the requests served last: a request is served its own share before later requests. With an extra of 10, requests of 30 (served first) and 20, and 45 made, the extra loses 10 and the second request 5: the first gets 30, the second 15. The LP meets or misses a product wholesale: goal rows are hard constraints, and a source capped by pins or by a locked, limited import still reports the goal met. No `solveAll` scenario reaches a partial shortfall, so the `min(share, left)` branch is covered only by the pure `connectionOffer` table in `index.test.ts`; the `solveAll` test covers the full shortfall (the source makes nothing), where every request and the extra come up short.

Two cases `pending` protects: a take consumer of the same `(A, X)` solved before the requester (it must not take what A made for the request), and a requester with several sources of one item (B requests X from A1 and A2: the whole request goes to A1 and none to A2, and B must not draw on A2's output, which another consumer's request may need).

**Flow fields.** Every flow has `kind`. A request has `requested` (items/min asked, possibly 0); a take that is an ignored request has `requestIgnored`; a plain take has neither key. `capped` for a request is true only when the limit is what bounded the flow: `maxRate !== undefined`, `requested ≥ maxRate − 1e-6` (the limit cut the ask) and the source's offer to this connection is at least `maxRate − 1e-6` (it could have met the limit). A source that offers less than the limit leaves `capped` false, so the UI says the source "only offers N". There is no extra status: if A meets the request the flow is `ok`; if A falls short (pins, locks, no capacity, no recipe for the item) the flow is `limited` and A's result reports a shortfall for X, because the requested amount is part of its goal.

**Loops.** The shortfall rule is unchanged in loops. Requests are decided once, before the supply phase, so the effective goals do not change between loop rounds. In a loop of blocks, `pending` is cloned per round from the snapshot taken before the component (like `remaining`) and the last round's copy is kept. A loop may close through a take; cycles of requests are not solved (ignored as `request-loop`).

### Loops

Blocks may supply each other (Metals → Sciences → Ores → Metals). A loop is a strongly connected component of two or more blocks; a connection from a block to itself is never a loop (status `self`). `MultiBlockSolve.loops` lists one `BlockLoop` per loop: `blockIds` in member order, `connectionIds` (in-loop connections: members in order, each in `inputConnections` order), `backConnectionIds`, `rounds` and `converged`.

**Member order.** The entry is the first member (in `blocks` order) that receives from a block outside the loop, else the first member. The other members follow in a topological order of the in-loop connections: reverse depth-first postorder from the entry, visiting each member's consumers in reverse `blocks` order so that blocks the connections leave unordered keep their `blocks` order. A connection whose source comes later in this order than its consumer is a *back connection*; these are exactly the connections that close a cycle in the depth-first search, so every other in-loop connection runs forward.

**Rounds.** The members are solved once per round, in member order. A back connection reads its source's offer from the previous round; in round 1 that offer is zero, since a loop never starts from supply nobody made. Offers from blocks upstream of the loop are re-read from a snapshot every round, so they are never drawn twice. Consumers that compete for one offer inside a loop are served in member order. A loop is settled when, for every `(source, item)` pair carried by a back connection, the source's offer equals the previous round's within a relative `1e-6` (`|a − b| ≤ 1e-6 · max(1, |a|, |b|)`).

**Why it usually settles in round 2.** In the common case a block's solved nodes, and so its offers, do not depend on the supply it receives: raw supply never enters the LP; for an intermediate, the pass-1 optimum stays optimal in pass 2 because supply only fills the residual that pass 1 measured; and a block never re-exports what it receives. Round 2 then reads the same back offers round 1 produced, and the loop is settled in two rounds (one when the back connections carry nothing). The exception is an intermediate in `noImportItems` (locked) or a pinned recipe that the block cannot cover alone: without supply the lock makes pass 1 infeasible and the block reports `infeasible-pins`; with supply, pass 1 drops the lock, so the nodes (and the offers) can differ between round 1 and round 2. Such a loop may need more than two rounds, and a block can then see more distinct supply caps than the `SolveCache` has slots (three per block), in which case its entries evict each other and the loop is re-solved on every `solveAll` call. `LOOP_ROUND_LIMIT = 8` (overridable with `options.loopRoundLimit`) bounds the rounds. Only the split of a source's offer among consumers depends on other blocks.

**Not settled.** The last round's results are kept, `converged` is `false`, and each member's result gets a `loop-not-converged` warning (on a shallow copy, so cached results are never mutated; the copy is memoised per cached result, so an unsettled loop keeps result identity between solves while its inputs are unchanged). In a round that did not settle, members solved earlier may have drawn more from a later member's previous-round offer than it offers now; the excess is dropped from what stays on offer (never negative), and the committed flows are not reduced, so they can add up to more than the source's offer. The UI's `offeredRate` clamps at 0 for that case.

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

The productivity bonus is dropped (treated as 0) when the recipe has `allowProductivity: false`, or is not in the game data; speed and consumption bonuses are unaffected. The machine's `allowedEffects` is not checked by the solver.

Per node, given recipe throughput `x_j` (executions/minute) — `computeMachineMetrics`:

```
machineCountExact = x_j · craftingTime / 60 / (craftingSpeed · (1 + speedBonus))
machineCountCeil  = Math.ceil(machineCountExact)
powerKw           = machineCountExact · (energyUsageKw · (1 + consumptionBonus) + drainKw)
```

Drain is not affected by consumption modules. Beacon power is not counted. For a mining drill or offshore pump, `craftingSpeed` is its mining or pumping speed (an offshore pump recipe yields 60 units per craft, so one pump of speed 20 makes 1200 per second).

---

## Statelessness and store integration

`solveBlock` is stateless and deterministic. The only state is the optional per-block `SolveCache`, which holds up to two entries per block id (the most recent successful solves, least recently used evicted first; an entry with equal inputs is replaced in place), dropped when the block is removed, fails or has nothing to solve.

`wireSolver()` in [src/store/solverStore.ts](../src/store/solverStore.ts) subscribes to the block and game-data stores and debounces (150 ms) so a burst of UI input collapses to one `solveAll`. Only blocks whose inputs changed are solved (up to two LPs each, plus the request probe of a block that requests). Renaming or recolouring a block, or an edit elsewhere that leaves a block's supply unchanged, solves nothing in that block. `wireSolver` owns the cache and reuses one effective game data object while the data and the effective default machines are unchanged. It skips the solver when no game data is loaded — status becomes `idle`. A block with zero goals or zero nodes gets an empty result.

The store keeps `lastResults` (every block's result by id) and `flows`. `status` and `lastResult` follow the active block, so `selectSolverResult` is unchanged. A solver exception in the active block sets status `error`; in any other block it only leaves that block's result empty. `lastResult` keeps the most recent successful result while a re-solve is pending, so views don't flash.
