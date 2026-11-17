# Sourcing priority, phase 6: predictable default

Phase 6 of [plan.md](plan.md), and its last. It depends on no other phase. It stands alone and ships alone, with a release note, because it changes numbers in existing plans.

The three questions of the first draft were answered from the code, two throwaway `solveBlock` runs and a measurement on 36 plans on 2026-11-16 ([What the code says](#what-the-code-says)). Two answers shape the phase. The item the block "imports" in this rule is never a raw input: it is an intermediate the block is short of, and in real plans that is a loop that loses, not a pin. And the literal reading of *Make it here* breaks such a loop in the author's plan, while the other reading moves no plan measured. The [decisions](#decisions-for-the-author) are **proposed, not yet confirmed by the author**; the [tickets](#tickets) are written against them and D1 has to be confirmed before T1 starts. Nothing of the new solve was prototyped: the phase starts with a spike (T1), as phases 3 and 5 did.

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

Proposed on 2026-11-16. **Not confirmed yet.** D1 departs from plan.md, whose [Keeping the power](plan.md#keeping-the-power) table says "*Make more here* above *Other blocks* always makes it here".

| # | Question | Proposed decision | Why |
| --- | --- | --- | --- |
| D1 | Which way does the default go? | **A connection replaces the import.** With *Make it here*, the block's rows run for an item as far as they can without importing an intermediate; a connection then covers what is missing; imports come last, for the whole block. The reverse of the first draft's "literal" reading. | The literal reading is not "make it here" where it matters: a block on a loop that loses cannot make X, it can only turn an imported Y into X. Sludge would swap 47 sulfur received for 2,429 acid imported. The proposed reading is what the solver already does on one side of the ratio, what the backlog item asked for, and it moves no plan measured. |
| D2 | Is a raw input an import for this rule? | No. A row fed by raw inputs is the block's own production, as today: a block that makes plate from ore keeps making it, with a plate connection idle. | Everything is made from raw inputs in the end; counting them would turn the default into *Receive it first*. |
| D3 | How? | An exact order, as extra LP solves in the measure step: the least import with the connections available, then the least received, then today's fill. Not a weight on a slack or on a supply. The extra solves run only for a block that has a connected intermediate and whose pass 1 leaves an import on an intermediate; every other block solves as today, number for number. | [spec/solver.md](../../spec/solver.md#connections-between-blocks) already says why one LP cannot do it: the weight would have to beat a recipe chain of unbounded cost. A weight moves the artefact to another ratio; Sludge's 100 to 1 shows real data reaches far. T1 closes the weight option with a counter-example or reopens it. |
| D4 | Is the mirror in scope (the connection on the upstream item, the import on the downstream one)? | Yes. The rule is about the block: no intermediate is imported while a connection can replace it. | One rule instead of two; the mirror is the same artefact (fixture A, sixth row), and on a loop the two cannot be told apart. |
| D5 | What decides between two imports, or between two connections, when either would do? | The fewest units, then the fewest runs, as today. Documented in `spec/solver.md`, and a follow-up in the backlog. | No list says which: both lines are *Import*, or both are block lines of different items. An exact rule there needs an order between items, which the model does not have. |
| D6 | Is there a setting to keep the old result? | No, and no stored field. A player who wants the import back removes the connection, which was idle before the change. | "Out: any new control". An opt-out would be a seventh setting in an initiative that removes six. |
| D7 | Do blocks with areas follow the same rule? | Yes, in the same release (T3). | Otherwise switching an area flag changes which source a block uses. |
| D8 | How does it ship? | Alone: what is on `main` is released first, then this phase with a release note that names the rule and the way back (D6). `legacyParity.json` is regenerated only if T2 or T3 shows a line that has to move, each moved line named in the pull request. | The risk named since the first draft. The measurement says no fixture moves; the golden file is the proof. |
| D9 | Does the initiative close with this phase? | Yes: T4 archives the folder. | It is the last phase; follow-ups are in the backlog. |

## The order in the solve

The target of T2 and T3; T1 tries it first and may change the steps, not the outcome. For a block with offers on connected intermediates:

1. **Measure, as today** (pass 1, no supply). If no intermediate has an import above tolerance, or no connected intermediate has an offer, the solve continues exactly as today.
2. **Least import.** Solve with every connected intermediate's supply available, capped by its offer, at cost 0. The total import of this solve is the least the block can do with its connections. If it is not below the total import today's two passes end with, today's result stands.
3. **Least received.** Among the solutions with that import, take the least from the connections, so own production still comes first: a row that can run without importing an intermediate runs before a connection is used.
4. **Fill.** Today's pass 2, with each supply capped at what step 3 took instead of at the pass-1 slack. Recipe runs are minimised last, as today.

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

T1 comes first and the run stops after it. T2 needs T1; T3 needs T2 and changes the area solve only; T4 is last. D1 is confirmed by the author before T1 starts.

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
- **More LP solves for a touched block.** Up to four instead of two; the gate of D3 keeps every other block at today's count (T1, point 10).
- **The area LP may not fit.** Its two stages and per-area variables were built for other rules; T1's point 9 decides whether T3 stands as written.
- **Ties.** Steps 2 and 3 minimise sums of units, so two connections or two imports of different items are still told apart by a ratio (D5). The phase removes the ratio from "connection or import", not from every choice.
