# Surplus-aware objective

Status: Future

The solver picks the plan with the fewest recipe executions per minute and treats left-over output as free. In two real Seablock plans that produced results a player does not expect: rows the player added to build a chain stay at zero, and a recipe is over-run so that an unwanted output piles up. This initiative collects what was found, the options for changing what the solver optimises, and what is still unknown. No option is chosen yet: the first phase is an experiment that decides.

## The problem, from the player's side

- **Rows are read as a menu, not as a design.** A player who adds the yellow-waste, lime-filter and scrubbing rows to a block expects those rows to be the plan. The solver is free to leave any row at zero when another route is cheaper.
- **Surplus is free in the solver, but not in the factory.** An output nothing consumes backs up, and the producer stalls. A plan with a left-over is only buildable with a sink the plan does not contain. Today the only sign is the `overconstrained` warning.
- **"Balanced" is not a goal.** The player expects a block's intermediates to balance, "just make what's required". The solver never tries to: it minimises executions and accepts any net surplus.

## What the solver optimises today

Described in [spec/solver.md](../../spec/solver.md#lp-formulation); the facts that matter here:

- The objective is Σ x_j, the executions per minute of every recipe, with `c_j = 1` (`BC_BONUS = -0.01` for byproduct consumers). It is not a count of recipes, and not a count of buildings: a 1-second recipe and a 60-second recipe cost the same.
- Surplus of an intermediate is allowed by the constraints (`net ≥ 0`) and costs nothing; it is only reported afterwards (`overconstrained`).
- Imports cost `BIG_M` per unit (or `BYPRODUCTS_FIRST_SLACK_COST`), so the solver builds an item in-plan rather than import it, however many recipes that takes.
- Per-row machine counts are computed after the solve, from the throughput.

## Evidence

Both cases come from a Seablock "middle ring" plan the author exported on 2026-11-07. The Extra Sulfur block is saved here as [extra-sulfur.plan.json](extra-sulfur.plan.json) and reproduces with the tool below. The Mod 1 block depends on the other blocks of that plan (sulfur supply from Ores, in particular), so only its numbers are recorded.

### Mod 1: geodes exported as byproducts

Block goal: `angels-bio-yield-module`. The "Crystal slurry" sub-factory makes slurry from geodes and has a liquify row for each of the six colours.

Result: `angels-solid-geodes` runs 41.5/min and leaves 62.3 blue, 62.3 red and 14.2 yellow geodes per minute unused.

Why:

1. **One recipe makes all six colours in fixed proportions** (per run: 1.5 blue, 1.5 red, 1 yellow, 0.75 purple, 0.6 cyan, 0.6 light-green).
2. **The colours are worth different amounts.** Every liquify recipe takes 5 geodes and 15 sulfuric acid, and gives 20 slurry (blue, red), 30 (yellow), 40 (purple) or 50 (cyan, light-green).
3. **Acid is capped by a closed loop.** Slurry filtering (18.2 runs/min, 910.7 slurry/min) makes yellow waste water. Purification turns it into 7.29 sulfur/min, and hydrogen sulfide from heavy mud adds 0.83. That feeds sulfur dioxide, then 5.41 acid runs/min, which is acid for exactly 21.6 liquify runs/min. The sulfur link from Ores offers Mod 1 nothing, because Sludge takes it all.
4. **The solver needs 42 slurry per liquify run (910.7 / 21.6)**, which only the high-yield colours reach. So it over-runs `angels-solid-geodes` to collect enough cyan, light-green and purple, and leaves the low-yield blue and red unliquified.

The balanced alternative (every colour consumed, `angels-solid-geodes` pinned to 25.3/min) exists but needs 30 liquify runs/min and about 40% more acid, so the mud chain grows from 8 to 40 heavy-mud runs/min and from 25 to 118 offshore viscous-mud runs/min.

| Mod 1 | Executions/min | Machines | Power |
|---|---|---|---|
| Solver's choice (surplus geodes) | 239.5 | 5.50 (38 rounded up per row) | 1.70 MW |
| Balanced (geodes pinned to 25.3) | 369.4 | 6.68 (40 rounded up) | 1.87 MW |

The solver's choice is cheaper on every metric, so a machine-count objective would pick the same plan.

### Extra Sulfur: heavy mud over-run for its hydrogen sulfide

Block goal: 6,000 `sulfur`/min. The rows form two routes: the yellow-waste / lime-filter / scrubbing loop, and `angels-solid-sulfur` fed with the hydrogen sulfide that `angels-water-heavy-mud` makes as a co-product.

Result: the loop is at zero. `angels-water-heavy-mud` runs 60,000/min only for its 2 hydrogen sulfide per run, and 12,000,000 heavy mud/min (plus 90,000 solid mud/min) pile up. The solver raises `overconstrained` and `coproduct-driven` ("needed: 0") and imports 12,000,000 viscous mud/min, since the block has no viscous-mud row.

Removing the `angels-solid-sulfur` row makes the solver build the full loop and reach 6,000 sulfur/min.

| Extra Sulfur | Executions/min | Machines | Power |
|---|---|---|---|
| Solver's choice (hydrogen sulfide route) | 62,000 | 2,243 (2,244 rounded up) | 342 MW |
| Loop only (`angels-solid-sulfur` removed) | 120,874 | 2,492 (2,498 rounded up) | 540 MW |
| Hydrogen sulfide route, heavy mud voided (void row pinned to 30,000/min) | 92,000 | 3,493 (3,494 rounded up) | 379 MW |

The last row is the hydrogen sulfide route plus `angels-water-void-angels-water-heavy-mud` (400 heavy mud per run) absorbing the 12M/min. The 90,000 solid mud/min is still left over.

### What the evidence says about the choice of cost

- **Minimising machines instead of executions would not change either result** for the two solver choices (Mod 1: 5.5 against 6.7 machines; Extra Sulfur: 2,243 against 2,492).
- **Whether pricing the surplus changes Extra Sulfur depends on the unit.** If the voiding is paid in executions, the hydrogen sulfide route still wins (92,000 against 120,874). In machines the loop wins (2,492 against 3,493). In power the hydrogen sulfide route still wins (379 against 540 MW). The three disagree, so the unit is a real decision, not a detail.
- **Not measured:** whether pricing Mod 1's geode surplus flips Mod 1. The surplus is about 139 geodes/min and the balanced variant costs about 1.2 machines more; it depends on whether a geode void recipe exists and what it costs.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Minimise machines instead of executions** | Matches what the table shows and what the player pays. Short recipes stop being over-weighted. | Does not change the two cases above. Changes the cost scale behind the synthetic cases and snapshots. Needs exact counts, since the per-row rounding up is not linear. |
| **B. Price surplus** | Matches "don't make what I don't need". It can change Extra Sulfur (depending on the unit). | A sum over different items is meaningless (12M fluid units against 139 geodes), so it needs a per-item weight. Some surplus is unavoidable (fixed-ratio co-products). Surplus sent to another block is not waste and must not be charged (see the backlog bug "`overconstrained` warns on surplus that is exported"). |
| **C. Require every row to be used** | Easy to explain: "my rows are my design". | Breaks the use of adding alternatives and letting the solver choose. Can be infeasible or force silly runs. Could be a per-row opt-in rather than a global rule. |
| **D. Lexicographic or weighted combination** | Middle ground: least surplus first, then fewest machines; or machines plus a weighted surplus term. | Priority rules and weights are harder to document and to explain in the UI. |

### Refined idea: a self-contained plan

A plan is self-contained when every output is consumed or voided. The solver would minimise the cost of the whole plan, including the machines that void the surplus. Pricing surplus as the cost of voiding it puts everything in one unit, which removes the weighting problem of option B.

Known so far: the Seablock data has void rows for some items (`angels-water-void-angels-water-heavy-mud`, `angels-chemical-void-angels-gas-carbon-dioxide`). Not known: how many items have one, whether Nullius has any, and what to do for an item without one (a flat penalty, or treat the surplus as infeasible). The Extra Sulfur numbers above show the result is sensitive to the unit chosen for the cost, so this idea does not settle the question alone.

## Open questions

- **Which cost unit?** Executions, machines and power disagree on Extra Sulfur. Is the answer one of them, a blend, or a per-plan setting?
- **How is surplus priced when there is no void row?** And how many items have one in each bundled data set?
- **Exported surplus.** A source block's surplus that another block consumes is not waste. The objective works per block, so pricing must exclude what flows over a connection (and the interplay with the requests and takes in [spec/solver.md](../../spec/solver.md#connections-between-blocks)).
- **Byproduct consumers and policies.** `byproductConsumer`, `byproductPolicy = 'discard'` and `byproducts-first` already express some intent about surplus. A priced surplus has to agree with them (a discarded output should not be charged).
- **Areas.** The area LP has two stages with their own costs (shipping, `BIG_M` slack). Whatever changes in the plain LP has to be mirrored there.
- **Opt-in or default?** Changing the objective changes existing plans. A per-block or per-plan setting would keep old results.
- **Row intent.** Is "require this row" (option C) a per-row flag next to pinning, or part of a block-level mode?

## Phases

1. **Experiment** (`[ ]`). Prototype the candidate objectives behind a flag in a scratch branch and measure them on the two cases above and on a few synthetic ones, with the [inspection tool](#inspecting-a-solved-plan). Questions to answer: which unit flips Extra Sulfur and Mod 1, how many items have a void row in each data set, and what the candidates do to the existing synthetic cases. Outcome: pick an option (or none) and write the decision in this document.
2. **Solver** (`[ ]`). Implement the chosen objective in the plain and area LPs, update [spec/solver.md](../../spec/solver.md) and the synthetic cases ([spec/test-synthetic.md](../../spec/test-synthetic.md), `src/solver/synthetic.test.ts`), and refresh the real-data invariants in `src/solver/index.integration.test.ts`.
3. **Player-facing** (`[ ]`). Decide how the UI shows a plan that needs a sink, and whether the warning changes ([spec/ui.md](../../spec/ui.md)).

## Inspecting a solved plan

`scripts/inspect-plan.mjs` solves an exported plan with the app's solver and prints one block's result: rows (executions, machines, power), left-over items, imports, warnings and connection flows. What-if flags change a copy of the plan, never the file. Use it instead of writing a throwaway test; the logic is `src/solver/inspect.ts`.

```sh
node scripts/inspect-plan.mjs initiatives/surplus-aware-objective/extra-sulfur.plan.json
node scripts/inspect-plan.mjs initiatives/surplus-aware-objective/extra-sulfur.plan.json --drop angels-solid-sulfur
node scripts/inspect-plan.mjs <plan.json> --list                       # block names
node scripts/inspect-plan.mjs <plan.json> --block "Mod 1" --pin angels-solid-geodes=25.2976
node scripts/inspect-plan.mjs <plan.json> --block "Mod 1" --json       # the whole report as JSON
```

Flags: `--block`, `--list`, `--data`, `--pin recipe=rate`, `--drop recipe`, `--sourcing item=mode`, `--no-area`, `--all-rows`, `--all-items`, `--json`; `--help` lists them. The data set comes from the stamp in the exported file. To try a recipe that is not in the block, add a row to a copy of the plan file first (the void measurement above was a copy of the fixture with one extra `game-recipe` node, then `--pin` on it).

Reading the output: "Left over" is `produced − consumed > 0`, with the block's goals tagged `[product]`, so everything untagged is surplus; "Imports" is what the block needs from outside; "(N rows at zero hidden)" shows which of the player's rows the solver did not use.
