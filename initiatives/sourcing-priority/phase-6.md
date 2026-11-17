# Sourcing priority, phase 6: predictable default

Phase 6 of [plan.md](plan.md), and its last. It depends on no other phase. It stands alone and ships alone, with a release note, because it changes numbers in existing plans.

The three questions of the first draft were answered from the code, two throwaway `solveBlock` runs and a measurement on 36 plans on 2026-11-16 ([What the code says](#what-the-code-says)). Two answers shape the phase. The item the block "imports" in this rule is never a raw input: it is an intermediate the block is short of, and in real plans that is a loop that loses, not a pin. And the literal reading of *Make it here* breaks such a loop in the author's plan, while the other reading moves no plan measured. The [decisions](#decisions-for-the-author) were confirmed by the author on 2026-11-16; the [tickets](#tickets) are written against them. Nothing of the new solve was prototyped: the phase starts with a spike (T1), as phases 3 and 5 did.

## Scope

In: with the default rule, whether a connection is used no longer depends on a recipe ratio. A block does not import an intermediate while a connection it has could replace that import, whichever of the two items the connection is on (D1, D4). In the single LP and in the area LP.

Out: any new control or stored field (the player-facing rule is only that the list is followed); which of two items is imported when no connection can replace either, and which of two connections is used when either would do (both still follow the fewest units, D5); the cost of a recipe run or of a left-over, which belong to [surplus-aware objective](../surplus-aware-objective/plan.md).

## What the code says

Read and measured on 2026-11-16. File names are under `src/solver/` unless said otherwise.

### Where the ratio comes from

`solveBlock` (`index.ts`) measures what a block needs from outside in pass 1, an LP with no supply variable in which every import slack costs `BIG_M` per unit and a recipe run costs 1 (`buildLPModel`, `solve.ts`). When the block can make X only from a Y it is short of, the LP compares `BIG_M` per X with `BIG_M · (Y per X) + 1`, so it counts units. Pass 2 (`pass2Plan`, `blockResult.ts`) then gives a connected item a supply capped at its pass-1 slack. A connection for X is used when pass 1 put the slack on X, and stays idle when pass 1 put it on Y. [spec/solver.md](../../spec/solver.md#connections-between-blocks) describes it under "Own production that needs an import"; `index.test.ts` pins both sides ("own production that needs an upstream import").

### The imported Y is never a raw input

A raw item (no row of the block makes it) has no LP row and no slack: it is a free input. A block that makes X from a raw Y therefore always makes X, with or without a connection for X, at any ratio (measured: row n below). The ratio only decides when Y is an **intermediate the block is short of**: a row of the block makes Y, and cannot make enough. That happens in three ways:

- the rows that make Y are pinned;
- Y, or an item further up, has Import off;
- X and Y sit on a loop that loses: the block turns X into Y and part of Y back into X, and what comes back is less than what went in.

The first draft and the backlog item only had the first in mind. The third is the one that occurs in real plans.

### Measured today

A throwaway test (not kept). Fixture A: a block with product 25 gears (G: 2 plates make 1 gear), a plate row P (i ingots make p plates) and an ingot row S (1 ore makes 1 ingot) pinned at 10. The block needs 50 plates and has 10 ingots.

| P | Connection (offer) | Received | P runs | Intermediates imported |
| --- | --- | --- | --- | --- |
| 1 ingot makes 1 plate | plate (100) | plate 40 | 10 | none |
| 1 makes 2 | plate (100) | nothing | 25 | ingot 15 |
| 2 make 1 | plate (100) | plate 45 | 5 | none |
| 1 makes 2 | plate (12) | nothing | 25 | ingot 15 |
| 1 makes 2 | plate (unlimited, the probe) | nothing | 25 | ingot 15 |
| 1 makes 1 | ingot (100) | nothing | 10 | plate 40 |
| 1 makes 2 | ingot (100) | ingot 15 | 25 | none |
| 2 make 1 | ingot (100) | nothing | 5 | plate 45 |
| 1 makes 2 | plate (100) and ingot (100) | ingot 15 | 25 | none |
| 1 makes 1 | plate (100) and ingot (100) | plate 40 | 10 | none |
| 1 makes 2, Import off on ingot | plate (100) | plate 30 | 10 | none |
| 1 makes 2, S not pinned | plate (100) | nothing | 25 (S 25) | none |

Three things the table shows beyond the known case:

- **The artefact has a mirror.** With the connection on the ingot and a 1-to-1 recipe, the block imports 40 plates and the ingot connection stays idle. The backlog item only names the connection on X.
- **A lock already says "do not import Y".** With Import off on the ingot, the plate connection delivers 30 at any ratio.
- **With two connections, the ratio picks one** (the last two rows of the first block). No import is involved, so this is outside the phase (D5).

Fixture B, a loop that loses: U turns 2 X into 1 goal and 100 W; R turns 100 W into 1 X; product 10 goal. U runs 10, uses 20 X and makes 1000 W; R turns them into 10 X; the block is 10 X short.

| Connection (offer) | Received | R runs | Imported |
| --- | --- | --- | --- |
| none | nothing | 10 | X 10 |
| X (100) | X 10 | 10 | none |
| X (4) | X 4 | 10 | X 6 |
| W (5000) | nothing | 10 | X 10 |
| X (100) and W (5000) | X 10 | 10 | none |

### What real plans do

A throwaway script (not kept) solved every plan in `e2e/fixtures`, the Extra Sulfur plan of the surplus initiative and three of the author's exported Seablock plans (2026-10-25, 2026-11-08, 2026-11-16): 36 plans, 86 blocks, 12 of them with a connection on an item one of their rows makes.

- **No block imports an intermediate while a connection on an item it makes has offer to spare.** That is the upper bound of what D1 can move, and it is empty: the 1-makes-2 shape of the test occurs in no plan measured. T1 repeats it as a real before and after.
- **An intermediate is short without any pin in six blocks**, all loops or chains that lose: Sludge (sulfur, in all three of the author's plans), Bean 1 (viscous mud), three Nullius fixtures (propene, benzene and oxygen) and the temperature fixture's steam.
- **Sludge is the real case.** Sulfur goes into sulfuric acid, the acid into slag dissolution, and yellow waste water gives part of the sulfur back (1 per 100). In the plan of 2026-10-25 the block imports 60.7 sulfur per minute; in the plan of 2026-11-16 it has connections for sulfur and receives 47.2 (43.5 and 3.75, a third connection idle), importing nothing. Forced to do without outside sulfur (`inspect-plan --import-off sulfur` on the older plan), the same block imports 2,429 sulfuric acid per minute instead. That is what "*Make more here* always makes it here" does to this block: the sulfur connections go idle and the acid is imported, because a row of the block makes sulfur.

### What reads the pass-1 residual

- `pass2Plan`: the cap of each supply variable in pass 2, and whether pass 2 runs.
- The request probe (`probeBlock`, `index.ts`): a request asks the source for what the consumer receives with unlimited offers. Today that amount does not depend on the offers, because pass 1 has no supply; [spec/solver.md](../../spec/solver.md#requests) says so. It stops being true for a block this phase touches (case 22, row f).
- The area solve (`solveAreaBlock`, `areas.ts`) has its own two passes around a two-stage LP, with one slack and one supply per area for an item several areas touch ([phase 5](phase-5.md#the-rule-in-the-area-lp)). It has the same costs; whether it shows the same artefact was not measured.
- [Connections first](../../spec/solver.md#connections-first), "Limits": a shortfall a *Receive it first* item still has once its offer is used up follows the ratio. That is a choice between two imports and stays (D5).

### The other initiative that changes the objective

[Surplus-aware objective](../surplus-aware-objective/plan.md) is `Status: Future`: its first phase is an experiment that picks a cost for recipe runs and for left-overs. This phase changes neither. It adds an order among sources (connections before imports) on top of whatever a run costs, as constraints carried from one solve to the next, so a later change of cost replaces the objective of the last step only. Two things to carry over when that initiative starts: its candidates must be tried with this order in place, and the two must not ship in one release, since each changes numbers in existing plans.

## Decisions for the author

Proposed on 2026-11-16 and confirmed by the author the same day, D1 after a check on the author's plan exported on 2026-11-17: solved block by block with `scripts/inspect-plan.mjs`, none of its 15 blocks imports an item one of its rows makes, so D1 has nothing to move in it. Sludge's pass 1 leaves sulfur short beside its sulfur connections, but its pass 2 takes the sulfur they offer and the block imports nothing, so the gate of D3 lets it through to no extra solve and it keeps today's result. D1 departs from plan.md, whose [Keeping the power](plan.md#keeping-the-power) table says "*Make more here* above *Other blocks* always makes it here".

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D1 | Which way does the default go? | **A connection replaces the import.** With *Make it here*, the block's rows run for an item as far as they can without importing an intermediate; a connection then covers what is missing; imports come last, for the whole block. The reverse of the first draft's "literal" reading. | The literal reading is not "make it here" where it matters: a block on a loop that loses cannot make X, it can only turn an imported Y into X. Sludge would swap 47 sulfur received for 2,429 acid imported. The proposed reading is what the solver already does on one side of the ratio, what the backlog item asked for, and it moves no plan measured. |
| D2 | Is a raw input an import for this rule? | No. A row fed by raw inputs is the block's own production, as today: a block that makes plate from ore keeps making it, with a plate connection idle. | Everything is made from raw inputs in the end; counting them would turn the default into *Receive it first*. |
| D3 | How? | An exact order, as extra LP solves in the measure step: the least import with the connections available, then the least received, then today's fill. Not a weight on a slack or on a supply. The extra solves run after today's two passes, and only for a block whose result still imports an intermediate while a connected intermediate on the default rule has offer left; every other block solves as today, number for number, and keeps its LP count. Decided by the author on 2026-11-16 after T1: the gate reads the result of the two passes, not pass 1, so a block that pass 2 already fixes (Sludge) pays nothing; a touched block pays up to one solve more than a gate on pass 1 would, accepted until performance shows a need. | [spec/solver.md](../../spec/solver.md#connections-between-blocks) already says why one LP cannot do it: the weight would have to beat a recipe chain of unbounded cost. A weight moves the artefact to another ratio; Sludge's 100 to 1 shows real data reaches far. T1 closes the weight option with a counter-example or reopens it. |
| D4 | Is the mirror in scope (the connection on the upstream item, the import on the downstream one)? | Yes. The rule is about the block: no intermediate is imported while a connection can replace it. | One rule instead of two; the mirror is the same artefact (fixture A, sixth row), and on a loop the two cannot be told apart. |
| D5 | What decides between two imports, or between two connections, when either would do? | The fewest units, then the fewest runs, as today. Documented in `spec/solver.md`, and a follow-up in the backlog. | No list says which: both lines are *Import*, or both are block lines of different items. An exact rule there needs an order between items, which the model does not have. |
| D6 | Is there a setting to keep the old result? | No, and no stored field. A player who wants the import back removes the connection, which was idle before the change. | "Out: any new control". An opt-out would be a seventh setting in an initiative that removes six. |
| D7 | Do blocks with areas follow the same rule? | Yes, in the same release (T3). | Otherwise switching an area flag changes which source a block uses. |
| D8 | How does it ship? | Alone: what is on `main` is released first, then this phase with a release note that names the rule and the way back (D6). `legacyParity.json` is regenerated only if T2 or T3 shows a line that has to move, each moved line named in the pull request. | The risk named since the first draft. The measurement says no fixture moves; the golden file is the proof. |
| D9 | Does the initiative close with this phase? | Yes: T4 archives the folder. | It is the last phase; follow-ups are in the backlog. |

## The order in the solve

The target of T2 and T3; T1 tries it first and may change the steps, not the outcome. For a block with offers on connected intermediates:

1. **Measure, as today** (pass 1 with no supply, then pass 2 with the connections capped at the pass-1 slack). If the result has no import of an intermediate above tolerance, or no connected intermediate on the default rule has offer left, the solve ends there, exactly as today.
2. **Least import.** Solve with every connected intermediate's supply available, capped by its offer, at cost 0. The total import of this solve is the least the block can do with its connections. If it is not below the total import today's two passes end with, today's result stands.
3. **Least received.** Among the solutions with that import, take the least from the connections, so own production still comes first: a row that can run without importing an intermediate runs before a connection is used.
4. **Fill.** Today's pass 2 again, with each supply capped at what step 3 took instead of at the pass-1 slack (the prototype bounds both totals in one model). Recipe runs are minimised last, as today.

What must hold whatever the steps turn out to be:

- A block with no import of an intermediate, and a block with no connected intermediate, solve number for number as today.
- Own production first is kept (fixture A, last measured row): a connection is never used where the block's rows can cover the need from raw inputs.
- A *Receive it first* or *Don't make more here* item, a locked item, a byproduct consumer's ingredient and a temperature-bounded fluid keep their rules. A free supply must not feed a byproduct consumer for its bonus, nor be unbounded in the probe (the `supuse` row of connections first exists for that).
- The request probe asks a source for what step 3 takes with unlimited offers.

## Synthetic cases

### Case 22: a connection replaces an import

Values derived by hand on 2026-11-16 from D1 to D5; the rows marked *measured* are today's solver and must not move. The ticket that adds a row re-derives it in its plan, writes the test first and sees it fail, and never edits an expected value to match the solver.

**A. A pinned upstream row (T2).** Fixture A of [Measured today](#measured-today).

| Row | P | Connection (offer) | Received | P runs | Intermediates imported |
| --- | --- | --- | --- | --- | --- |
| a | 1 makes 1 (*measured*) | plate (100) | plate 40 | 10 | none |
| b | 1 makes 2 | plate (100) | plate 30 | 10 | none |
| c | 2 make 1 (*measured*) | plate (100) | plate 45 | 5 | none |
| d | 1 makes 2 | plate (12) | plate 12 | 19 | ingot 9 |
| e | 1 makes 2 (*measured*) | none | nothing | 25 | ingot 15 |
| f | 1 makes 2 | plate (unlimited, the probe) | plate 30 | 10 | none |
| g | 1 makes 1 | ingot (100) | ingot 40 | 50 | none |
| h | 1 makes 2 (*measured*) | ingot (100) | ingot 15 | 25 | none |
| i | 2 make 1 | ingot (100) | ingot 90 | 50 | none |
| j | 1 makes 2 (*measured*) | plate (100) and ingot (100) | ingot 15 | 25 | none |
| k | 1 makes 1 (*measured*) | plate (100) and ingot (100) | plate 40 | 10 | none |
| l | 1 makes 2, Import off on ingot (*measured*) | plate (100) | plate 30 | 10 | none |
| m | 1 makes 2, S not pinned (*measured*) | plate (100) | nothing | 25 | none |
| n | 1 makes 2, plate on *Receive it first* (*measured*) | plate (100) | plate 50 | 0 | none |

- b: the 10 ingots make 20 plates; the connection gives the other 30. Today: nothing received, 15 ingots imported.
- d: the 12 plates on offer are taken; the other 38 need 19 runs and 19 ingots, 9 of them imported. Importing plate instead would be 18 units.
- f, as a `solveAll` row: a source block that has plate as a product is asked for 30. Today it is asked for nothing.
- g and i: the mirror (D4). 50 plates need 50 runs, and 50 or 100 ingots, 10 of them the block's own.
- e, j, k: D5, unchanged.
- m: own production first.

**B. A loop that loses (T2).** Fixture B of [Measured today](#measured-today).

| Row | Connection (offer) | Received | R runs | Imported |
| --- | --- | --- | --- | --- |
| a | none (*measured*) | nothing | 10 | X 10 |
| b | X (100) (*measured*) | X 10 | 10 | none |
| c | X (4) (*measured*) | X 4 | 10 | X 6 |
| d | W (5000) | W 1000 | 20 | none |
| e | X (100) and W (5000) (*measured*) | X 10 | 10 | none |

- b is the row D1 exists for: under the literal reading it would be nothing received, R at 20 and 1000 W imported.
- d: U's 20 X need 20 runs of R and 2000 W; U makes 1000, the connection gives the rest.
- c: the 6 X left could be 600 W; fewer units are imported (D5).

**C. Areas (T3).** Fixture A with G in area L and P and S in area M; plate is touched by both areas, ingot by M only.

| Row | P | Connection (offer) | Received | P runs | Imported | Outside leg of plate into L |
| --- | --- | --- | --- | --- | --- | --- |
| a | 1 makes 2 | plate (100) | plate 30 | 10 | none | 30, all of it supplied |
| b | 1 makes 1 | ingot (100) | ingot 40 | 50 | none | none |

Today's values of these two rows were not measured; T1 measures them. If the area LP does not show the artefact, T3 pins that instead.

## Tickets

T1 comes first and the run stops after it. T2 needs T1; T3 needs T2 and changes the area solve only; T4 is last.

- [ ] **T1. Spike: an exact order in the measure step.** Prototype [The order in the solve](#the-order-in-the-solve) in `solveBlock` on a branch, and try it in `solveAreaBlock`. No stored field, no UI. Report in this file:
  1. The rows of case 22 A and B that are not *measured*: which hold as derived, and for any that does not, why. A row that disagrees stops the phase until the author has seen it.
  2. The steps as built: how many LP solves a touched block takes, what gates them, and how steps 2 and 3 are expressed with the solver the project has (a bound on the total import, or one per item; the objective of step 3).
  3. What stays number for number: the unit suite, `legacyParity.json`, `contract/` and the e2e suite, with only the "1 ingot -> 2 plates" test of `index.test.ts` expected to move.
  4. A before and after on real plans: every plan of `e2e/fixtures`, the Extra Sulfur plan and the author's exported plans (the orchestrating session passes their paths), each block and item whose source or rate changes. Expected: none.
  5. The weight option (D3): a single LP with a cheaper slack on connected items, and the fixture on which it fails, or the reason it does not.
  6. Each rule the steps must keep ([what must hold](#the-order-in-the-solve)): byproduct consumers, *Receive it first*, *Don't make more here* with Import on and off, locks, temperature rows, an unlimited offer.
  7. Ties: rows j and k, a short offer on two connections, and whether the result is stable between solves.
  8. Requests: row f; whether loops of blocks and cycles of requests still settle within their round limits (`block-loop.json`, `request-loop-seablock.json`, cases 16 and 17).
  9. Areas: today's values of case 22 C, whether the same steps fit the area LP's two stages with a slack and a supply per area, and what T3 has to build. If the area LP needs another design, T3 is rewritten before it starts.
  10. Cost: LP calls and solve time on the largest of the author's plans, before and after.

- [ ] **T2. Solver: the order in a block without areas.** The steps as T1 left them, in `solveBlock`, with the gate of D3. Case 22 A and B first, in `synthetic.test.ts`. Plus: row f as a request in `solveAll`; a touched block inside a loop of blocks and inside a cycle of requests; a served list on a source whose consumer is touched (its need is 30 in row b); each rule of T1's point 6 as a test. The two ratio tests of `index.test.ts` become rows a and b. `solveCache.ts`: confirm the key needs nothing new (the steps read `plan`, the data and the offers only). `legacyParity.json` and `contract/` must not move; a line that does is named in the pull request (D8). `scripts/inspect-plan.mjs` says, for a block the steps touched, which imports the connections replaced. `spec/solver.md` ("Own production that needs an import" becomes the rule; "What B takes"; Requests, where a need no longer ignores the offers; Connections first, "Limits"), `spec/test-synthetic.md`.

- [ ] **T3. Solver: the order in a block with areas.** The same rule in `solveAreaBlock` and `solveAreaLPOnce`, per T1's point 9. Case 22 C first. Plus: an area with its own rule for the item (*Receive it first*, *Don't make more here*) beside an area the steps touch; a switched-off supplier (a pair item); case 21 must not move. `areas.test.ts`, `spec/solver.md` (Areas), `spec/test-synthetic.md`.

- [ ] **T4. The app, the docs and the close.** No new control (D6). e2e on a hand-written Nullius fixture of case 22 A, row b: the Ingredients pane shows the connection delivering and no import of the upstream item, the connection's flow is not `unused`, and the row panel's sentence for the item agrees (`sourcingText.ts` reads the result; fix a sentence only if it is wrong for rows b or g). README "Using the planner" where it describes what a connection replaces. In [plan.md](plan.md): tick "Let connected supply replace an upstream import"; correct the last paragraph of "How sourcing works today", the "Connected supply replaces an upstream import" row of "Keeping the power" (D1) and the phase table's row 6. In [backlog.md](../backlog.md): the follow-up of D5 (two imports, two connections), and drop the initiative's line. A line in [surplus-aware objective](../surplus-aware-objective/plan.md), "Open questions", on the order this phase adds. The release note's text (below) in the pull request. Then close the initiative (D9): `git mv initiatives/sourcing-priority initiatives/archive/sourcing-priority`, fix the paths, update [initiatives/README.md](../README.md).

Each ticket appends its report here (deviations and additions only), as in [phase 5](phase-5.md#t1-report).

### Release note

For the release that carries this phase, in the player's words:

> A block no longer imports an item while one of its connections could cover the need. Before, whether the connection was used depended on the recipe: a block that made plate from ingots it was short of received plate when the recipe gave one plate per ingot, and imported ingots when it gave two. Plans with such a block change: the connection now delivers and the import goes. To get the import back, remove the connection.

## T1 report

Deviations and additions only. Branch `spike/connection-replaces-import`. The prototype is `src/solver/connectionOrder.ts` (plain path, called at the end of `solveBlock`) and `areaConnectionOrder` in `solveAreaBlock` with an `AreaOrder` hook in `solveAreaLPOnce` (`areas.ts`). Tests: case 22 A, B and C in `synthetic.test.ts`; points 6 to 8 in `connectionOrder.test.ts`. Measurements used a throwaway Vite-SSR script (not kept) on a detached worktree of `main` and on the branch.

1. **Case 22 A and B hold as derived, every row.** Re-derived from D1 to D5 before any code; my values agree with the table on all rows. On `main` the new tests fail on exactly the rows not marked *measured* (A b, d, f, g, i; f as a request; B d) and pass on every *measured* row; on the branch all pass. Two findings that are not disagreements: row n leaves S's 10 ingots unused, so the block reports `overconstrained` (the table does not say; kept as a separate, labelled test of observed behaviour, not a table value); B d first came out at W 999.999999, a drift of the prototype's bound tolerance (fixed in the second attempt, see 2). Not tried: rows with modules or productivity.
2. **Steps as built.** Gate (`needsConnectionOrder`): the two passes run as today; the steps run only if the final LP is feasible with no elastic shortfall, still has a slack at `BIG_M` above `surplusTolerance` (any intermediate, locked ones included; the cheap slack of *Don't make more here* does not count), and a default-rule connected intermediate (not *Receive it first*, not *Don't make more here*) has offer left beyond what the final LP took. Deviation from the doc as first written (adopted by the author on 2026-11-16, the doc now says so): the gate reads the result of the two passes, not pass 1, so a block like Sludge in the plan of 2026-11-17, whose pass 1 is short but whose pass 2 covers it, runs no extra solve. One model (`buildLPModel` with every connected intermediate's supply capped by its offer and a `supuse` row on every supply), objectives swapped by attribute: step 2 minimises the total import (each `BIG_M` slack 1, runs free); if it is not below today's total by `surplusTolerance`, today's result stands. Step 3 bounds the total import (one row over all slacks, not one per item) and minimises the total received over the default-rule supplies, with `BIG_M` on the slacks inside the bound's room. Step 4 bounds both totals and minimises `__obj__`; locked connected items with no step-3 slack are locked again; a *Don't make more here* connected item gets no supply in steps 2 and 3 and, when step 4 leaves it short, one more LP with its supply capped at that residual (today's pass 2 on the bounded model). The bound is a total, not per item, so ties fall to the runs (point 7). Bounds are absolute, `least + n·1e-8`, retried once 100 times looser if infeasible (never seen); the retry (`boundedStep`) loosens every bound of the step, and the plain and area paths share it. LP calls, counted by wrapping `Solve` of the solver library: the two passes run as before (1 LP, or 2 when pass 2 runs) and steps 2, 3 and 4 add 3 more, plus 1 for a *Don't make more here* refill. So a block whose pass 2 does not run goes from 1 to 4 (A b, d, g), a block whose pass 2 ran goes from 2 to 5 (the tie "both short"), and the refill adds 1 (6 with pass 2: the rod block of point 6; derived, not counted, without it: 5); a block let through the gate whose step 2 finds no gain pays 1 more (derived from the code, no block of the suite shows it). Tried and dropped: a relative term `1e-9·least` in the bounds (step 4 spends all the room: 4e-4 of an item made at 200 runs per unit was received on a total of 1e5) and step 3 without `BIG_M` inside the import room (B d's drift).
3. **Number for number.** Unit suite: only `index.test.ts` "1 ingot -> 2 plates" moved (now 30 plates received, no ingot import); its sibling "1 ingot -> 1 plate" did not. `legacyParity.json` unchanged (its test passes, the file is untouched), `contract/` unchanged (`npm run contract`, then `git status contract/` empty). Full run on the commit: `npm run lint`, `npm run lint:docs`, `npm run test:unit` (4614 tests), `npm run test:e2e` (462 passed, 1 skipped, no failure, so no re-run needed) and `npm run build` all pass. Not moved but stale: the comment of "mixes a connections-first item with an item that keeps the default order" (`index.test.ts`) still explains its values by the ratio; that block is not touched (it imports nothing); the review rewords it.
4. **Real plans: nothing moves.** Every plan of `e2e/fixtures` (32), and five of the author's exports (2026-10-25, 2026-11-08, 2026-11-16, 2026-11-16 (1), 2026-11-17; "(2)" is byte-identical to "(1)"): 37 plans, 115 blocks, 32 with areas, 52 with connections. Per block: every row's throughput, every unsatisfied item, the warning types and every flow's rate, status and request, to 1e-6, plus the LP calls of each plan: identical before and after, and no block passed the gate (equal LP counts). The Extra Sulfur plan is not a file of the repository: it is the author's own plan, the block "Extra Sulfur" of the exports from 2026-11-08 on (it supplies Sludge 43.5 sulfur per minute in 2026-11-16 and 2026-11-17); both blocks are unchanged. Sludge: 2026-10-25 imports 60.7 sulfur with no connection; 2026-11-08 imports 33.7 sulfur with its Ores connection `limited` at 4.1 (no offer to spare, so not touched); 2026-11-16 and 2026-11-17 import nothing. The comparison script is not committed (a one-off).
5. **The weight option fails, measured.** One LP with every connected supply at cost `c` per unit, capped by its offer, with the `supuse` rows. On case 22 it holds for `c` from 2 to 5000: below about 1 run per unit it breaks own production first (A m), from 2e4 it breaks B d (10 X imported instead of 1000 W). Counter-example: one block with fixture B at r W per X and a second chain whose connected item is made from raw at k runs per unit; scanning `c` from 0.5 to 1e6, no `c` gives both "connection replaces the import" and "own production first" when r·k ≥ `BIG_M` (r = 100, k = 2e4; r = 1e4, k = 200), while r = 5000, k = 100 leaves only `c` = 100. The exact order solves all four. Limitation found there: with r·k ≥ `BIG_M` the exact order drifts by about n·1e-8·r (3e-4 of 1e5 W at r = 1e4), because step 4 trades the import bound's room for runs. That figure is the investigator's, from a throwaway fixture that was not kept; the review's two blocks at 1e4:1 (fixture B with 1e4 W per run, alone and beside a chain made at 200 runs per unit, r·k = 2e6, both in `connectionOrder.test.ts`) show no drift (0 on W received to 1e-6), so the shape that drifts is not pinned by any test and the `ORDER_ABS` comment says so. Not tried: a weight per item.
6. **The rules kept** (`connectionOrder.test.ts`, every block touched: on `main` 11 of its 12 tests fail). Byproduct consumers: a consumer of plate gets nothing from the supply, offer 100 and unlimited (bounded by the `supuse` rows). *Receive it first* on ingot (offer 4) beside a default plate connection: ingot 4, plate 22, P 14. *Don't make more here* on another connected item of a touched block: its row stays idle, its connection delivers 3 and 2 are imported. Locks: Import off on the connected plate (row d shape) and on the connected ingot (row g shape) hold. Temperature rows: a cold steam row does not replace the connection (30 received). Open, decided by the prototype and pinned: a block whose only import is a *Don't make more here* item is not touched, Import on (15 ingots imported) and Import off (15 missing), with the plate connection idle. D1 can be read either way there (the plate's rule is *Make it here*, the ingot's import is its rule's own); counting that import would run a row just for the item in step 2, where runs are free. To make the other reading work: bound each such item's production by what rows running for other reasons make, at least one more LP.
7. **Ties.** Rows j and k are not touched (no import left) and hold. Touched, each solved twice and with the offers in the other order, all identical: 1 makes 1 with plate (30) and ingot (30): plate 30, ingot 10, P 20 (the runs decide); 1 makes 2 with plate (12) and ingot (12): ingot 12, plate 6, P 22 (fewest units, D5); 1 makes 1 with 12 and 12: both used, 16 plates imported. Not tried: shuffling blocks or connections in `solveAll` for a touched block (the 37 plans are untouched).
8. **Requests.** Row f holds in `solveBlock` (unlimited offer) and in `solveAll`, both tab orders (S asked for 30, mines 30). A touched block in a cycle of requests (H requests plate, S requests a coin from H) settles in one loop, both tab orders. `block-loop.json` and `request-loop-seablock.json` are among the 37 plans: unchanged, same LP calls. Cases 16 and 17 pass. Not tried: a touched block inside a loop of takes, and a served list on a source whose consumer is touched (T2's list).
9. **Areas.** Case 22 C on `main`: row a receives nothing, P 25, 15 ingots imported, plate 50 from M to L; row b receives nothing, P 10, 40 plates imported into L. The area LP shows the same artefact. The same steps fit the two stages: steps 2 and 3 are single LPs on the area model (objective `__imp` over the plain slacks and the per-area slacks at `BIG_M`; `__rec` over the plain default supplies and the per-area supplies of areas that are not *Receive it first* or *Don't make more here*), step 4 is stage 1 and stage 2 with the two bounds in the constraints. With that, C a and b hold as derived (outside leg into L 30, supplied 30; no outside leg in b); case 21 does not move. LP calls: 2 to 6 on C. T3 stands as written; what it has to build beyond the prototype: (a) the *Don't make more here* supply and refill, which the area path lacks for a plain item and for an area on that rule (`orderSupply` is false there, so no step gives it a supply and the connection that delivers today becomes an import: a regression for a touched block with such a rule); (b) the second lock of a connected Import-off item (the plain path's `__relock_`): the area path leaves its slack at `BIG_M` in step 2 and step 4 can import an item the player locked; (c) tests for an area's own rule beside a touched area, a switched-off supplier, a touched pair item, and the gate's per-area noise floor (the prototype uses the item's); (d) a test that pins (a) and (b) as limitations until built, none exists now; (e) a test that makes a tight bound infeasible in a solve (the retry is tested through `boundedStep` only). Fixed in review: the area bounds count the variables their sum runs over (`measuredTerms`, not the item count), the area import total counts the slack of a *Don't make more here* area when the item is a byproduct consumer's ingredient (priced at `BIG_M`, as the LP's `__imp` sum), steps 3 and 4 retry through `boundedStep`, and the "least import is a gain" test (`improvesImport`) is shared. The gate predicate and the steps stay two copies (one mutable LP on the plain path, `solveAreaLP`'s two stages here). LP calls, counted: the area LP is two `Solve` calls per call, so a touched block goes from 2 to 6 (steps 2 and 3 one call each, step 4 two stages), 4 more.
10. **Cost.** No real block is touched, so LP calls are unchanged: 61 per `solveAll` on the largest exports (2026-11-16 (1) and 2026-11-17, 15 blocks each), before and after. Median of 21 runs on a machine shared with the author's dev server: 84.2 ms before and 86.9 ms after on the first, 92.0 and 84.4 ms on the second; the difference is noise. A touched block costs 3 more LP calls in the plain path (4 more with a *Don't make more here* refill: 1 to 4, 2 to 5, 2 to 6 with both) and 4 more `Solve` calls in the area path (2 to 6).

**Review of the prototype: what the spec and the decisions do not say yet.**

- *Gate wording, settled.* The D3 row, step 1 of "The order in the solve" and the Sludge sentence of the Decisions section described a gate on pass 1. The author chose the prototype's gate on 2026-11-16 (the result of the two passes: Sludge in the plan of 2026-11-17 runs no extra solve; a touched block does pass 2 and then the steps, one solve more than a pass-1 gate, accepted until performance shows a need) and the three places were rewritten to say so. T2 implements and tests that gate. A hybrid (after pass 1, run the least-import step first and pass 2 only if it shows no gain) would save that solve; it was not tried.
- *Don't make more here only, settled.* A block whose only import is a *Don't make more here* item stays untouched, Import on or off, with the connection idle (point 6). The author settled it on 2026-11-16; T2 keeps it, pins it, and says so in `spec/solver.md`. The other reading (one more LP per such item) is not built.
- *Edits T2 owns.* `spec/solver.md` line 188 ("Own production that needs an import": the connected X no longer depends on the recipe ratio when the block is touched; the paragraph and its pointer to the backlog item) and line 212 (*Limits*: "A remaining shortfall of a connections-first item follows the recipe-ratio rule above"); the solver pipeline section for the order of steps 2 to 4 and its LP counts. `spec/test-synthetic.md`: "Twenty-one recipe chains" and lines 6 and 8 ("cases 11 to 21"), `CLAUDE.md` line 90 ("21 synthetic cases"), and a Case 22 section (A, B, C as in `synthetic.test.ts`; the rows marked *measured* are the solver of before the phase; row n's `overconstrained` warning is not a derived value). README repository map, `src/solver/` row: add `connectionOrder.ts` (the order of a connection replacing an import). The comment of "mixes a connections-first item with an item that keeps the default order" in `index.test.ts` was reworded here.
- *Known limits of the prototype.* The area path (point 9, a and b); the drift of point 5 (not reproduced); a retry of steps 3 and 4 not exercised through a solve.

The prototype adds no stored field, no UI and no debug counter (the LP calls were counted by wrapping the solver library from the throwaway script). It is written to be kept by T2 and T3; the area part is the least finished (the gaps of point 9).

## Running the tickets

For the session that orchestrates. Each ticket is one run of the `backlog-task` skill (`.claude/skills/backlog-task/SKILL.md`) with `noplan`, and one pull request. The tiers are the ones the skill's own criteria give, so step 1's classification is not redone. Explore is `haiku` at `medium` wherever a plan is written.

Opus is used twice: T1's investigator and T2's review. T1 is invoked with `spike`. T3 and T4 are invoked with the `sonnet` control word.

| Ticket | Tier | Plan | Implement | Review (`code-review` level) | Why |
| --- | --- | --- | --- | --- | --- |
| T1 | spike, with a hard criterion | none: the main session writes the brief | one agent, `opus`, `high` | `sonnet`, `high` | **Opus 1.** It chooses the LP steps three tickets stand on. The review checks the tests and the report's claims; the judgement is the author's |
| T2 | standard: it follows the spike | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | Opus wrapper (`low`), `high` | **Opus 2.** The steps were prototyped in T1 and case 22 pins the values, so the plan is not hard; the review is where a change to every plan's numbers gets a second reader. The planner and the reviewer re-derive rows b, d, g and i of A and row d of B |
| T3 | standard: it follows T1 and T2 | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | The same steps in the area LP; T1's point 9 and T2's plan go into the planner's prompt |
| T4 | small | none: the main session | the main session | `sonnet`, `medium` | One e2e and docs; the ticket lists the edits |

If Opus is scarce, drop T2's review to `sonnet`, `high`; T1 keeps Opus. If there is Opus to spare, add it to T3's review (drop the `sonnet` word).

Rules of the run, as agreed for phases 3 to 5:

- **Order.** Strictly T1, T2, T3, T4, one agent at a time. The run **stops after T1**: the author reads its report before T2 starts. A ticket whose predecessor is not merged is cut from that predecessor's branch and its pull request targets it.
- **Never merge.** Push each branch as soon as its implementation commit exists.
- **Accuracy.** A synthetic row is written first and seen failing; an expected value is never edited to match the solver; the rows a ticket adds are re-derived by its planner and by its reviewer. The run halts on a derived value that disagrees with the solver, on a line of `legacyParity.json` or `contract/` that moves, and on a ticket that fails twice.
- **Decisions.** A product decision a ticket meets and this document does not settle is taken as the planner's recommendation and listed under "Decisions taken" in the pull request.
- **Known noise.** A handful of e2e specs fail on the author's machine when its own dev server and Factorio are running, on `main` too; re-run a failure alone before treating it as a regression, and never kill those processes.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- The rest of "Let connected supply replace an upstream import" (T2 and T3).

## Risks

- **Results change with no edit by the player.** The measurement found no plan that moves, on 36 plans of which three are real; other players' plans are unknown. The release note and D6 are the answer.
- **The steps are untested.** Every value of case 22 that is not *measured* is a derivation, and the steps were chosen on paper. T1 exists to find out before two tickets depend on it.
- **A need that depends on the offers.** A request used to be what the consumer needs whatever it is offered. For a touched block it now depends on the offers of its other connections, inside loops and cycles of requests too (T1, point 8).
- **More LP solves for a touched block.** Up to five instead of two (six with a *Don't make more here* refill, T1 point 2); the gate of D3 keeps every other block at today's count (T1, point 10).
- **The area LP may not fit.** Its two stages and per-area variables were built for other rules; T1's point 9 decides whether T3 stands as written.
- **Ties.** Steps 2 and 3 minimise sums of units, so two connections or two imports of different items are still told apart by a ratio (D5). The phase removes the ratio from "connection or import", not from every choice.
