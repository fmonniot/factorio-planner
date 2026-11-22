# Surplus rule: close a loop on purpose

Status: Active

The solver treats a left-over of an intermediate as free, so it will not close a loop that costs more recipe runs than the alternative. In the author's Seablock plan the coolant is the case: the block brews new coolant from water and mineral oil and dumps 2,432 used coolant per minute, where the player wants every used unit cooled, filtered and reused. Today the only ways to get the loop are a byproduct-consumer flag on four rows or a pin on one. This initiative adds a per-item rule that says a surplus of that item is not acceptable, and works out how it fits the plain LP, the area LP and the connections between blocks.

A [spike](#spike-2026-11-22) showed the solver change is small for one block and that the result is the one the flags give; a [second spike](#second-spike-2026-11-22) tried the connections and a synthetic loop. The design is settled in [Decisions](#decisions-2026-11-22) and split into two [tickets](#tickets).

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

The [second spike](#second-spike-2026-11-22) tried a surplus another block takes, a request, a synthetic loop with and without areas, and a loop that needs a connected input. Not tried by either: a rule at area scope (not in v1), a pair item (covered by reading, see [Decisions](#decisions-2026-11-22)), a block the connection order touches, and the hard `net = 0` variant (rejected).

## Second spike (2026-11-22)

The same scratch change (reverted), with the price at 10 and 100, a surplus variable on every key of the item except the supplied keys (`#in`), and the rule switched on for the Metals block only. Three plans: the fixture, the full plan of `(3)` with a block *Cooler* added, and a synthetic loop in a scratch Vitest file.

- **The price.** At 10 and at 100 the fixture gives the plan of `(2)` exactly (1,698.64 executions, steam 1,823.9 left over).
- **A take of the item.** *Cooler* makes 500 coolant per minute from the three coolings and the filtration, and takes used coolant from Metals (a take: used coolant is not a Metals product). Without the rule it takes 625 used coolant at 300° out of 2,432 on offer. With the rule on Metals, Metals closes its loop, offers nothing, the flow is `unused` with 0 available, and *Cooler* imports 625 at ≤50° (cheaper than importing at 300° and cooling). The rule wins over the take, and the take gets what the rows cannot use.
- **A request of the item.** With used coolant added as a Metals product (no extra rate), *Cooler*'s connection becomes a request: 625 at ≤50°. With the rule on Metals (run with `--no-area`, see the bug below), Metals delivers exactly 625 at ≤50° and loops the rest: cooling at 19.31, filtration 16.19, make-up 12.72, 1,707 executions. The rule and a request compose. For a split fluid this works with intermediates only, because the goal is a range key and what is made sits on the temperature keys; a plain item needs the goal row too (decided below).
- **Bug found on the way (not this initiative).** With areas, that request makes Metals warn `no-recipe` for used coolant and deliver nothing at ≤50° (the parts read `≤50°C 0/0 (asked 625.00)`); with `--no-area` it is delivered. Recorded in the [backlog](../backlog.md).
- **The synthetic loop** (the case of [Ticket T1](#t1-solver)). Without the rule: `use` 10, `brew` 10, 1,000 `hot` left over. With the rule on `hot`, `warm` and `cold`: `use` 10, `coolA`, `coolB` and `filter` 5 each, `brew` 2, nothing left over, the hand derivation confirmed. The same with `use` in an area of its own and the loop at the root (a pooled area item). **With the rule on `hot` only, `coolA` runs 5 to turn `hot` into `warm` and 1,000 `warm` is left over:** a rule on one item of a chain of plain items moves the surplus to the next item. Seablock's used coolant does not show it because its temperatures are keys of one item, which all take the rule.
- **A loop that needs a connected input.** The filter takes 1 `cart` per run; the block's own `makeCart` is pinned at 0 and a connection offers 100 carts. With the default rule the loop stays open (1,000 `hot` left over, no cart received): pass 1 prices a cart as an import at `BIG_M`, which is worse than the surplus, so its residual has no cart for the loop and pass 2 supplies none. With *Receive it first* on `cart` the loop closes and 5 carts are received. In the author's plan the charcoal is raw in Metals (no row makes it), so it takes no slack and the loop closes.

## Decisions (2026-11-22)

Settled with the author on 2026-11-22, from the two spikes.

### The rule

- **Name and place: a *Leftover* switch.** In the [Comes from](../../spec/ui.md#comes-from) control, under the **Import** switch and built like it (`role="switch"`): on is today's behaviour, off is the rule. The pair reads as one idea: *Import* off says nothing comes in from outside, *Leftover* off says nothing is left over. Help text (in `itemSourcing.ts`, with the other names): "Off: the rows of this block use all of it they can. What they cannot use is still left over, and the warning names it." The longer help adds the two limits below (a chain of items, a connected input).
- **Stored as `leftoverOff: true`** in the block's `SourceRule` (`Block.sourceRules[item]`), absent when on, like `importOff`. `SourceRuleSchema` and `sanitizeRule` (`schema.ts`) keep it; `AreaSourceRuleSchema` does not get it (block only, below). A plan saved with it and loaded by an older build loses the key (its `sanitizeRule` drops unknown keys) and solves as before, which is acceptable.
- **Block only.** No area has its own Leftover rule in v1. At area scope the Comes from control shows the block's switch read-only (disabled, with the line "Set for the whole block" and a button that switches the control to **Whole block**). The solver reads the set from the block's own `sourceRules`, never through `areaRuleOf` or the per-area `effective` copy, so an area's own rule for the item (which replaces the block's whole) does not drop it.
- **Soft, one price for every item.** `LEFTOVER_COST = 10` per unit (in `solve.ts` beside `BIG_M`). Why 10: it is about 700 times the break-even of the coolant loop (0.0148 runs per unit), so any loop that costs less than 10 runs per unit recovered closes; and `BIG_M / LEFTOVER_COST = 1e5`, so an import still costs more than the leftover it would avoid unless importing one unit avoids more than 1e5 units of leftover (the same bound as the byproducts-first cost of 1e-5 against a run). A hard `net = 0` is rejected: it is infeasible whenever nothing can use the item.
- **Goal rows too.** For an item with the rule that is a goal, the excess over the asked rate is priced the same way (`Σ S x − v = d`). A split fluid already behaves so (its goal is a range key), and the request in the second spike needs it for a plain item. So the `product` no-effect reason does not apply to this rule.

### The solver

- **Where.** `buildLPModel` takes the set (`LPBuildOptions.leftoverOff`, base item ids). For every goal row and intermediate row whose item (the base item of a flow key, `system.flow.info.get(key).itemId`) is in the set, except a supplied key (`info.supplied`, the `#in` keys: surplus supply is not production), the row becomes an equality (`min: rhs` → `equal: rhs`) and a variable `leftover_<key>` (`named('leftover_', key)`) joins it with `-1`, costing `LEFTOVER_COST` in `__obj__` **and** in `__rec`. The temperature keys of a split fluid have hard rows and get the variable like any row. A goal row with an elastic shortfall keeps it (`Σ S x + h − v = d`). Expose the variables (`LPModel.itemToLeftover`) for tests.
- **Every caller gets the set.** `solveLP` and its elastic model, `connectionOrder`, the area base model (`areas.ts`), from `sourcingSets` (`blockResult.ts`: a new `leftoverOff` set, read from `plan.sourceRules`). The request probe and the takes-first estimate go through the same solves, so they follow. **The solve cache key must change:** `sourcingKey` (`solveCache.ts`, used by the solve cache and by the request-loop memo in `index.ts`) spells out `makeHere` and `importOff` field by field, so as it is a switched rule would hit a stale entry. Add `leftoverOff`, and a test that switching the rule misses the cache.
- **The steps of the connection order.** The price is on `__obj__` (pass 1, pass 2, the fill, the refill) and on `__rec` (least received), not on `__imp` (least import). So the priority is: no import, then no leftover, then own production first (least received), then the fewest runs. Without `__rec`, the bound of the least-received step could forbid the extra supply a loop needs and the fill could not close it. In the area LP, stage 2 (`__s2`) copies `__obj__` already and stage 1 (`__s1`) must not carry the price (it only bounds the dedicated imports).
- **Areas.** Only the block row of an area item carries the variable; the area balance rows, the pools and the per-area slacks and supplies are untouched (`addAreaItem` copies the row of the item's *slack*, not of the new variable). Pooled items: the block row's net is what the pools sent and nobody took. Pair items: the sum of the area balance rows is the block row, so the leftover variable equals the sum of the sinks `sk`, and pricing the block row prices what leaves through them. No change is needed for either, but each gets a test.
- **Byproduct consumers and `discard`.** Nothing to change. A discarded output is not in `S`, so it is never a leftover. A flagged row on an item with the rule is redundant but harmless (the bonus and the price push the same way); there is no no-effect line for it, and the flag keeps covering the item when the rule is switched back on. No doc recommends the flags for a loop today, so none is rewritten.
- **Warnings.** Unchanged. A leftover the rule could not remove is still `overconstrained` (it is real: nothing can use it), and a recipe over-run to burn a rule item shows as `coproduct-driven` and as the next item's `overconstrained`, as in the spike's solid carbon. No new diagnostic suggests the rule: a leftover with a consumer in the block is common and often wanted (steam with one consumer), and the suggestion would mislead there.
- **Limits** (in [spec/solver.md](../../spec/solver.md) and in the long help text):
  - *A chain of plain items.* The rule on one item lets the solver turn it into the next item of a chain (`hot` into `warm`) and leave that over. The rule goes on every item of the chain. A split fluid's temperatures are one item, so they are covered together.
  - *A connected input of the loop.* When the loop needs an item the block would otherwise import, and the block can receive it over a connection, the default rule leaves the loop open: pass 1 prices that item as an import and the residual has no room for the loop. Set that item to *Receive it first*. The fix is a [follow-up](#follow-ups).
  - *Moving the leftover.* Pricing a leftover can make the solver over-run a recipe to use it up, and that recipe's own output is then left over (the solid carbon of the spike). The warnings name it.

### Connections

- **A take gets what the rows cannot use.** The source's rule wins over a take of the item: the source solves before its take consumers and closes its loop, so it offers only what nothing in it can use (the second spike: 0, the flow `unused`). To send the item to another block, the player makes it a product, which turns the connection into a request, and the rule then loops only what is not asked for. The Comes from control says so when the item has a take: a grey note under the switch (`data-testid="leftover-take-note"`, not a no-effect line, since the rule does act): "{block} takes {item} from this block. It gets only what the rows here cannot use; make {item} a product to send it more." One note per taking block, in `inputConnections` order of the consumers.
- **The backlog bug "`overconstrained` warns on surplus that is exported"** is not changed by this initiative. The rule makes it rarer for the rule item, since its offer is only what cannot be used.

### No-effect

- `not-made` (no row of the block makes the item) is the one no-effect reason, with the usual grey line and **Remove** (`useRemoveSourceRule` clears `leftoverOff`).
- An item no row uses is **not** no-effect: the rule then makes the solver avoid making it where it can (for steam it would open the coolant loop), so the switch shows the help text and no grey line.

## Tickets

Strictly in order; each is one pull request.

### T1: Solver

- `leftoverOff` in `SourceRuleSchema`, `sanitizeRule` and the `SourceRule` type (`schema.ts`); [spec/data-model.md](../../spec/data-model.md).
- `sourcingSets` gets `leftoverOff`; `LPBuildOptions.leftoverOff`, `LEFTOVER_COST`, the rows and variables of [The solver](#the-solver) in `buildLPModel`; every caller passes it; `LPModel.itemToLeftover`.
- [spec/solver.md](../../spec/solver.md): the LP formulation (the variable, the equality, the cost in the objective and in `__rec`), a section *Leftover off* next to *Byproducts first* with the limits above, the order of the connection steps, the area paragraph (block row only, pairs through the sinks).
- **Synthetic case 28** ([spec/test-synthetic.md](../../spec/test-synthetic.md) and `src/solver/synthetic.test.ts`), plain made-up ids, 1 s recipes, goal 10 `P`/min: `use` (100 coolant → 1 `P` + 100 `hot`), `coolA` (200 `hot` → 200 `warm`), `coolB` (200 `warm` → 200 `cold`), `filter` (200 `cold` → 160 coolant), `brew` (→ 100 coolant). Rows, all measured by the second spike:

  | Row | Rule | Expected (runs/min) | Left over |
  |---|---|---|---|
  | a | none | `use` 10, `brew` 10, the rest 0 | 1,000 `hot` |
  | b | Leftover off on `hot`, `warm`, `cold` | `use` 10, `coolA` 5, `coolB` 5, `filter` 5, `brew` 2 (27) | none |
  | c | Leftover off on `hot` only | `use` 10, `coolA` 5, `brew` 10 | 1,000 `warm` (the chain limit) |
  | d | as b, `use` in an area of its own | as b | none |
  | e | as b, `filterC` (also takes 1 `cart`) for `filter`, `makeCart` (1 `ore` → 1 `cart`) pinned at 0, 100 carts offered (`solveBlock` supply) | as a, no cart received | 1,000 `hot` (the connected-input limit) |
  | f | as e, `cart` on Receive it first | as b, 5 carts received | none |
  | g | goals 10 `P` and 40 `Q`, recipes `twin` (→ 1 `P` + 2 `Q`) and `makeQ` (→ 1 `Q`), no rule | `twin` 20, `makeQ` 0 (20 runs) | 10 `P` over its goal |
  | h | as g, Leftover off on `P` | `twin` 10, `makeQ` 20 (30 runs) | none |

  Rows g and h test the goal row and are derived by hand, not measured: in h the 10 extra runs cost less than 10 units of `P` at `LEFTOVER_COST` (100).
  Also a pair item (b with an area that switched another off, so the item leaves through a sink) asserting that the leftover is priced, and a test that switching the rule misses the solve cache.
- Real data: the [coolant-loop fixture](coolant-loop.plan.json) with `leftoverOff` on `angels-liquid-coolant-used` in `src/solver/index.integration.test.ts` (1,698.64 executions, cooling at 19.31, make-up at 7.72, no used coolant left over, steam 1,823.9 `overconstrained`).
- `scripts/inspect-plan.mjs`: a what-if flag `--leftover-off item` (as `--sourcing`), and its `--help`.
- `npm run contract` only if the snapshot changes (it should not: `src/snapshot/project.ts` does not carry `sourceRules`).

### T2: Player-facing

- The **Leftover** switch in `ComesFrom.tsx` under Import (`data-testid="leftover-switch"`, a store command `toggleLeftoverOff`, undoable), read-only at area scope with "Set for the whole block"; its names and help texts in `itemSourcing.ts`; the `not-made` no-effect line and **Remove**; the take note.
- The Byproducts pane: a strip and right-click action **Use it all here** on a leftover slot that switches Leftover off for the item (the slot goes away once the solve closes the loop; the rule is then in Comes from and in the Source rules list).
- The rule in the [Source rules](../../spec/ui.md#source-rules) list and in the markers of items with a rule (`itemsWithEffect`).
- [spec/ui.md](../../spec/ui.md); README "Using the planner" (one bullet next to Absorb byproducts).
- Carry-overs from T1: the store's `withSourceRule` and `cleanAreaRule` rebuild a rule from two keys and would drop `leftoverOff` on a store edit, so `toggleLeftoverOff` must keep it through them (today only a hand-edited plan carries the key). `effectiveAreaRule` (`subPlanTree.ts`) still returns the block's rule with `leftoverOff` for an area with no rule of its own: the read-only control at area scope must read the block's rule directly. The archive step must update the `FIXTURE` path constant in `src/solver/index.integration.test.ts`.
- An e2e test (`e2e/`): a plan with the synthetic loop of case 28 (or the coolant fixture), switch Leftover off from the Byproducts action, see the cooling rows run and the leftover slot go; Remove from a `not-made` line.

When T2 ships, set `Status: Shipped` and archive the folder (CLAUDE.md, rule 4), and update [initiatives/README.md](../README.md).

### Follow-ups

Not in v1; added to the [backlog](../backlog.md) when T2 ships, unless T1 finds them cheap:

- *The connection order for a leftover.* Open the gate of `needsConnectionOrder` also when an item with Leftover off is still left over and a default-rule connection has offer left, so that the least-received step (which carries the price) takes the input the loop needs (row e above would then close the loop).
- *A Leftover rule per area*, if a plan needs an area that loops its own item while the block's other areas may leave it over.

## Reproducing

```sh
node scripts/inspect-plan.mjs initiatives/surplus-rule/coolant-loop.plan.json          # the plan of (3): 1,662.57 executions, 2,431.9 used coolant left over
node scripts/inspect-plan.mjs initiatives/surplus-rule/coolant-loop.plan.json --pin angels-liquid-coolant=7.72428724   # the loop, by a pin
```

The pin closes the loop today without the rule, at the make-up rate the loop needs; the price is that it is a constant to recompute when the plan changes. The spike above needs the seven-line change.
