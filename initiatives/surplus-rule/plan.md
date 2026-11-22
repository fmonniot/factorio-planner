# Surplus rule: close a loop on purpose

Status: Future

The solver treats a left-over of an intermediate as free, so it will not close a loop that costs more recipe runs than the alternative. In the author's Seablock plan the coolant is the case: the block brews new coolant from water and mineral oil and dumps 2,432 used coolant per minute, where the player wants every used unit cooled, filtered and reused. Today the only ways to get the loop are a byproduct-consumer flag on four rows or a pin on one. This initiative adds a per-item rule that says a surplus of that item is not acceptable, and works out how it fits the plain LP, the area LP and the connections between blocks.

A [spike](#spike-2026-11-22) already shows the solver change is small for one block and that the result is the one the flags give. What is not designed yet is the player's side (where the rule lives, what it is called, what it does when the item cannot be consumed) and the interplay with connections and areas.

Related: [surplus-aware-objective](../surplus-aware-objective/plan.md) is the general version (a surplus priced in the objective for every item, with a choice of unit). This initiative is the narrow one: a rule the player sets on one item. It can ship first, and it is a measurement for that initiative (a third real case, and the first where the price of a surplus changes the plan the way the player wants).

## The problem, from the player's side

- **A loop is a design decision, and the solver cannot see it.** The player builds the coolant chain (three coolings, a filter, a make-up recipe) and expects the plan to be the loop. The solver leaves the cooling rows at 7 runs per minute instead of 19 and brews 27 runs of fresh coolant, because that is fewer runs.
- **The flag that works is a side effect.** A [byproduct consumer](../../spec/solver.md#absorber-chains) makes a row absorb a surplus, and four flags give the loop. But the flag is per row, says nothing about the intent ("this item must loop"), and a row added later is not covered.
- **Closing the loop moves the surplus, it does not remove it.** Cooling makes steam (50 per run, three temperatures). With the loop closed the block makes about 2,900 steam per minute and its one consumer takes 1,072, so 1,824 steam is left over and `overconstrained` warns. That is real: the plan now needs a steam sink. The rule has to make that visible, not hide it.

## Evidence

Both plans are exports of the Seablock "middle ring" plan of 2026-11-22 (the author's files `…middle-ring-2026-11-22 (2).json` and `(3).json`). They differ only in the four flags on the coolant area's rows: `(2)` has `byproductConsumer` on the three cooling rows and the filtration row, `(3)` has it off.

The Metals block is saved on its own as [coolant-loop.plan.json](coolant-loop.plan.json): the plan of `(3)` with only that block, no input connections, and `extraRate` on each product set to the rate the whole plan asked of it, so it solves alone. It reproduces `(3)` exactly (1,662.57 executions/min). The coolant area is a sub-factory with `area: true`, so the area LP is in play.

The recipes (Seablock data): `angels-coolant-cool-300`, `-200` and `-100` each take 200 used coolant (a range of temperatures) and 50 water, make 200 used coolant 100° colder and 50 steam. `angels-coolant-used-filtration-1` takes 200 used coolant at 50° or below and a charcoal filter and makes 160 coolant, so a loop loses 20% and needs make-up. `angels-liquid-coolant` makes 100 coolant from 80 water and 20 mineral oil. The roll recipes (`…-2`) turn coolant into used coolant at 300°, one for one.

| Metals (coolant area) | Executions/min | Machines | Power |
|---|---|---|---|
| `(3)`: no flags, no rule | 1,662.57 | 27.02 (94 rounded up) | 6,407 kW |
| `(2)`: four flags | 1,698.64 | 27.64 (94) | 6,352 kW |

| Rows (executions/min) | `(3)` | `(2)` |
|---|---|---|
| cool-300, cool-200, cool-100, filtration (each) | 7.15 | 19.31 |
| charcoal filter | 1.43 | 3.86 |
| coolant (make-up) | 27.18 | 7.72 |
| used coolant left over | 2,431.9 at 300° | 0 |
| steam left over | 0 | 1,823.9 (858.4 at 150°, 965.5 at 125°) |

In `(2)` the loop is the physical minimum: all 3,862 used coolant per minute go through all four rows, and the 20% the filter loses (772) is the make-up. In `(3)` the solver closes only 37% of it. Why: closing the loop for 200 used units costs about 4.2 runs (three coolings, the filtration, 0.2 of a charcoal filter) and recovers 160 coolant, which 1.6 runs of the make-up recipe make from water and mineral oil.

## Spike (2026-11-22)

A scratch change in `buildLPModel` (`src/solver/solve.ts`, reverted, not in the tree): for the items in an environment variable, the intermediate's row becomes an equality and a surplus variable `v ≥ 0` with a price joins it. About seven lines:

```ts
const spikeItems = new Set((process.env.SPIKE_SURPLUS ?? '').split(',').filter(Boolean))
const spikePrice = Number(process.env.SPIKE_SURPLUS_PRICE ?? '0.1')
for (const itemId of classification.intermediates) {
  const cName = addConstraintWithSlack(itemId, 0)
  if (spikeItems.has(system.flow?.info.get(itemId)?.itemId ?? itemId)) {   // a key of a split fluid: its base item
    constraints[cName] = { equal: 0 }                                       // Σ S x + s + u − v = 0
    variables[named('surplus_', itemId)] = { __obj__: spikePrice, [cName]: -1 }
  }
}
```

Run with `SPIKE_SURPLUS=angels-liquid-coolant-used SPIKE_SURPLUS_PRICE=<p> node scripts/inspect-plan.mjs initiatives/surplus-rule/coolant-loop.plan.json`. Results on that fixture:

- **It closes the loop, and the plan is the one `(2)` gives.** From a price of 0.015 per unit up, up to 1e6 (`BIG_M`) with no numeric trouble: cooling and filtration at 19.31, make-up at 7.72, no used coolant left over, 1,698.64 executions, 27.64 machines, 6,352 kW, the steam surplus of 1,823.9.
- **The threshold is the exchange rate of the loop.** Prices of 0.005, 0.01, 0.012 and 0.0135 leave the loop open; 0.015 closes it. The break-even is the extra runs per unit of surplus removed: (1,698.64 − 1,662.57) / 2,431.9 = 0.0148 executions per unit. It depends on the recipes, so no fixed price is right for every item; a price high enough to act as a ban (anything well above 1) is the robust choice.
- **It works through the area LP.** The block's row for the item is the one that is changed (the item is an area item here, touched by rows in several areas); the area balance rows and pools are untouched and the solve is feasible and unchanged elsewhere: only the coolant rows and `offshore:water` (120.16 → 124.62) move.
- **A surplus rule on two items can move the surplus instead of removing it.** With the rule on used coolant and on steam at price 1, the solver closes the loop and also over-runs `angels-solid-carbon`, the one row that takes steam (35.76 → 96.55 runs), to burn the steam; steam and used coolant are then at zero and 182.4 solid carbon per minute is left over (`overconstrained`), 1,759.44 executions. The same "over-run a recipe for its co-product" the [surplus-aware-objective](../surplus-aware-objective/plan.md) evidence shows. So the rule is useful where the item can be consumed in full and a sink is not another recipe whose own output then piles up.
- **It follows through the connections.** On the full plan of `(3)` the Metals block asks Bio Plastic/Resin for 14.5 mineral oil per minute instead of 403.6 (the make-up is smaller) and Paper & Charcoal for 162.0 charcoal instead of 159.5 (more filters). Bio Plastic/Resin voids more mineral oil (12.7 → 16.6) and Paper & Charcoal runs 2.1 more executions per minute; no other block changes. So in `(3)` the mineral oil that the loop no longer takes was a byproduct nobody else wanted, which the player should know.

Not tried by the spike: a surplus that another block takes over a connection (the item here is not exported), a rule at area scope, the connection-order solves with a connected source (the fixture has none; the full plan only through `solveAll`), a pair item (an item with a switched-off supplier between areas), and the hard `net = 0` variant. They are the open questions below.

## Design

**One rule per item, on the block.** A third part of a block's rule for an item next to `makeHere` and `importOff` in `Block.sourceRules` ([data-model.md](../../spec/data-model.md)), a flag that reads as "no surplus", with the area scope later if the first use needs it. It sits in the [Comes from](../../spec/ui.md#comes-from) control (the Sources list has a *Leftover* line, as the lines for *Import* and the blocks), since a player who wants the loop is already in the item's sourcing.

**Soft, with a price far above a run.** The row of the item gets a surplus variable at a cost well above a run (a constant a few orders above 1, below `BIG_M` so an import is still worse than a surplus), not a hard `net = 0`. A hard equality is infeasible when nothing can take the item (steam, or any item no row uses) and the plan then does not solve; the soft one keeps the warning as the fallback and reports the left-over as today. The price is the same for every item (the break-even above depends on the recipes, so there is no good per-item number to ask the player for).

**The solver reads it where it builds the row.** `buildLPModel` is where the intermediate rows are built, and the area LP and the connection-order solves build on it, so the change is one place plus a check of each caller. A split fluid's keys all take the rule of their base item.

### Interplay to settle

These questions are shared with [surplus-aware-objective](../surplus-aware-objective/plan.md), which needs the same answers for any priced surplus and links here instead of repeating them. They are decided in this initiative because it ships first.

- *Exported surplus.* A block's surplus is also what it offers over a connection. A surplus price must not charge what another block takes (the same issue as the backlog bug "`overconstrained` warns on surplus that is exported"). Options: the rule is refused (or has no effect, with the grey "no effect" line) for an item with an outgoing connection; or the surplus is charged only after the offers.
- *Byproduct consumers and `discard`.* A flagged row already makes a surplus worth absorbing. The two should agree: a discarded output is not a surplus, and a flagged row on an item with the rule is redundant (say so with a no-effect line).
- *Areas.* Whether the rule can be set per area (an area that must loop its own coolant). The block row is enough when the rule is the block's.
- *Pairs and routes.* An item with switched-off suppliers has sinks for what leaves an area (`areaRoutes`); a priced surplus has to count those sinks as surplus, or the rule says nothing for such items.
- *Connections before imports.* The [sourcing priority](../archive/sourcing-priority/phase-6.md) initiative made a connection replace an import by an order of LP solves (least import, least received, fill), not by a weight on a slack, because a weight breaks at real recipe ratios (its T1 report, point 5). `buildLPModel` builds the model of every step, so the surplus variable is in each of them; whether its price belongs in every step's objective or only the last one's, and that it does not change what the earlier steps decide, is to check. The spike ran the full plan only through `solveAll`, and the fixture has no connected source.

## Open questions

- **Name and wording.** "No surplus", "Close the loop", "Use it all". The control has to say what happens when it cannot: the item is left over anyway and the warning names it.
- **Per area?** Does the first version need an area's own rule, or is the block's enough? The Coolant area makes the used coolant of rows in other areas, so the block's rule covers the author's case.
- **What if the loop is not worth it?** A player who sets the rule on an item the plan then makes more of (the over-run of solid carbon above) needs the warning to say what moved. Is that the existing `overconstrained` and `coproduct-driven`, or a sentence in the summary?
- **Absorber flags afterwards.** Does the rule replace the flags in the author's plan (and the docs that recommend them), or do the two stay?
- **A diagnostic for the missing rule.** Should `overconstrained` on an item that some row of the block consumes (here the used coolant, which the three coolings take) suggest the rule?
- **The synthetic case.** Plain made-up ids, 1 s recipes: a goal `P` made by `use` (100 coolant → 1 `P` and 100 used); `cool A`, `cool B` (200 used → 200 used, one run each); `filter` (200 used → 160 coolant); `brew` (→ 100 coolant). For a goal of 10 `P`/min: without the rule `use` 10 and `brew` 10, 1,000 used left over (20 runs); with it `use` 10, `filter` 5, `cool A` 5, `cool B` 5, `brew` 2 (27 runs), 0 left over. The break-even is 7 / 1,000 = 0.007 runs per unit. Derived by hand here, to be confirmed by the first test.

## Phases

1. **Spike** (`[x]`). Done 2026-11-22, see above.
2. **Decide** (`[ ]`). Settle the questions under *Design* and *Open questions*: the exported-surplus rule, the name, the scope, the price. Outcome: write the decisions in this document. A second spike on a plan with a connected surplus is part of this phase.
3. **Solver** (`[ ]`). The rule in `Block.sourceRules` (`schema.ts`, with `sourceRules.ts` for the no-effect cases), the surplus variable in `buildLPModel`, the area LP and the connection order, `overconstrained` and the other diagnostics; [spec/solver.md](../../spec/solver.md), [spec/data-model.md](../../spec/data-model.md) and the synthetic case ([spec/test-synthetic.md](../../spec/test-synthetic.md), `src/solver/synthetic.test.ts`); real-data invariants in `src/solver/index.integration.test.ts` if the fixture earns a place there; `npm run contract` if the snapshot changes (it should not).
4. **Player-facing** (`[ ]`). The control and the Sources line ([spec/ui.md](../../spec/ui.md)), the help text, an e2e test of switching it on and seeing the loop, README "Using the planner" if user-visible.

## Reproducing

```sh
node scripts/inspect-plan.mjs initiatives/surplus-rule/coolant-loop.plan.json          # the plan of (3): 1,662.57 executions, 2,431.9 used coolant left over
node scripts/inspect-plan.mjs initiatives/surplus-rule/coolant-loop.plan.json --pin angels-liquid-coolant=7.72428724   # the loop, by a pin
```

The pin closes the loop today without the rule, at the make-up rate the loop needs; the price is that it is a constant to recompute when the plan changes. The spike above needs the seven-line change.
