# Sourcing priority, phase 3: served order

Phase 3 of [plan.md](plan.md). It does not depend on phase 2 and can ship before it.

The questions of the first draft were answered from the code on 2026-11-11 ([What the code says](#what-the-code-says)). One answer changes the phase: a source is never short by a definite amount today, so a rank among requests has almost nothing to act on. The author confirmed the [decisions](#decisions-for-the-author) the same day, D1 first: the phase starts with the spike of T1. The spike reported on 2026-11-13 ([Spike report](#spike-report-t1)): a source now holds its capacity, so the [tickets](#tickets) keep their scope.

## Scope

In: a **Served in this order** list on each product and spare output of a block, in the Products and Byproducts panes and on the block graph; consumers are blocks, one per rank, dragged to reorder; the block's own extra output is a line of the list that can be moved up; the list defaults to today's order, so an untouched plan does not change.

Out: groups, shares and areas as consumers (phase 4).

## What the code says

### Where the order is read

Four places on the source side, one more than plan.md lists. All are in `src/solver/index.ts`.

| Order | Where | What it decides |
| --- | --- | --- |
| Solve order | `solveAll` walks the components of `orderBlocks`; each `solveStep` takes what it needs out of `remaining(source, item)` | Among the consumers of one source item, the one solved first is served first. Solve order is sources before consumers, then tab order: a consumer that feeds another consumer is always served before it, whatever the tabs say. |
| Loop member order | `runRound` in `solveAll` | The same, inside a loop: members are solved in member order each round. |
| Credit order | `applyTakeCredits` in `computeRequests` | A take's credit is what its source's leftover covers of the consumer's need. Consumers are credited in request-pass order (consumers before sources, then tab order), each lowering the estimate the next one sees. Not in plan.md's list. |
| Extra gives way | `connectionOffer` | Requested amounts and credits are reserved (`pending`); the extra output never is, so it is what a shortage eats first. |

The consumer side has its own order, `inputConnections` (which request gets the need, which take is credited, which connection delivers first). That is phase 2's list, not this one.

### A source is never partly short

Measured with a throwaway `solveBlock` run (not kept): a block whose only row is pinned at 10 / min, with a product goal of 30.

| Pin | Goal | Row runs at | Warning |
| --- | --- | --- | --- |
| 10 | 30 | 30 | `infeasible-pins` |
| 10 | 10 | 10 | none |
| 40 | 30 | 40 | none |

Goal rows are hard, so a source makes all that is asked or the LP is infeasible; an infeasible LP returns what the solver library happened to hold, here the goal met and the pin ignored. (Measured before T1. Since T1 the first row runs at 10 and the plate is short by 20: see [Spike report](#spike-report-t1).) [spec/solver.md](../../spec/solver.md#requests) says the same: "No `solveAll` scenario reaches a partial shortfall".

What follows:

- **A rank among requests acts only when the source makes nothing** (no recipe for the item, a failed solve) or in a loop round that has not settled. The extra output line is in the same position: moving it up changes nothing while the source meets its goal.
- **The case this list was designed for cannot happen.** "Iron is short; science gets all it needs; the hub shares what is left" needs a source that holds at a capacity and reports by how much it is short. The planner has one way to state a capacity, a pinned row, and the solve above shows it does not hold.
- **The list does act today on takes.** A byproduct, a surplus or an ignored request is a finite amount, takes compete for it in the orders of the table above, and reordering tabs changes who gets it.

### How a rank can be honoured

The supply phase solves consumers one at a time, in an order the connections fix. A consumer solved early cannot know what a higher-ranked consumer solved later will need, unless that need was reserved first. The reservation already exists: a request's share and a take's credit are held in `pending` until their consumer is served.

So a list is honoured in two steps, without a new solve order.

1. **Every listed consumer gets a share before any supply is handed out.** Requests have one. A take has one only when its consumer also requests the item (the takes-first credit); a listed take needs a credit too, which needs its consumer's need: the request probe, one more LP for each consumer that takes a listed item and requests nothing, through the solve cache.
2. **When the source is solved, its offer is granted down the list.** Each consumer's grant is `min(share, what the ranks above left)`; the extra output, where it is listed, holds `min(extraRate, what is left)`. A consumer's offer is its grant, plus what no grant holds. Consumers that are not in the list come after it, in today's order.

Inside a loop the grants are computed each round from the offers the round reads, so member order no longer decides who is served; it keeps deciding which connections are back connections and how rounds run.

### Cache keys

The block solve cache keys on the flattened plan and the caps, and the list changes only the caps, so `planKey` does not change. The request-loop memo keys on everything the demand rounds read: it gains the served lists of the members' sources and the credits they produce. The probe of a take consumer is one more entry per block in a cache that keeps three; a block that is probed, in a loop, and solved with settled caps already uses all three.

## Decisions for the author

Taken with the author on 2026-11-11.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D1 | Should a source be able to hold at a capacity and be short by a definite amount? | **Confirmed on 2026-11-11; the spike succeeded on 2026-11-13 ([report](#spike-report-t1)).** Yes, as the first ticket of this phase, a spike with its own synthetic case: when a block's LP is infeasible, solve it again with elastic goal rows (a shortfall variable per goal, costed above an import), so pins and locks hold and each product reports what it lacks. | Without it, ranking requests and moving the extra output up have nothing to act on, and phase 4's shares neither. The Products pane already draws a short product and says where the shortage comes from. It changes numbers only for blocks that are infeasible today, whose numbers are arbitrary. If the spike fails, this phase ranks takes only and says so. |
| D2 | Does one list rank requests and takes? | **Confirmed on 2026-11-11.** Yes. | A product is requested; a spare output is taken; the two meet in one list only for an ignored request. For a request the rank means: whose share is honoured first when the source is short. |
| D3 | Does the list change loop member order? | **Confirmed on 2026-11-11.** No: only who is served. | Member order decides the back connections and the rounds; changing it changes what a loop converges to. |
| D4 | What does the stored list hold? | **Confirmed on 2026-11-11.** `Block.servedOrder?: Record<itemId, ServedEntry[]>` on the source, an entry being a consumer block id or the extra output. Absent means today's order. The list is written on the first drag, from the order shown, and **Reset order** removes it. Consumers not in the list are served after it, in today's order, and the player is told: the list draws them under a divider, **Not ranked: served after the list**, where each can be dragged into the list, and the **Served order…** action carries their count ("Served order… · 2 not ranked") so a consumer added after the order was set is noticed without opening the list. An entry whose consumer no longer takes the item is ignored by the solver and removed by the store with the consumer's last connection for it (undo restores it). | Block ids, not connection ids: a consumer has one counting connection per source item, and reconnecting must not lose its rank. A new connection never takes from a consumer the player ranked, and connecting from one block does not write into another block's history. Once a list exists, reordering tabs no longer changes who is served among its entries. Phase 4 adds groups, shares and areas to the entry, so the entry is an object from the start. |
| D5 | How do the list and the "comes out of the extra" text fit together? | **Confirmed on 2026-11-11.** The list is where the result shows: each line carries what its consumer asked or needs, what it got, and what it is short. The short segment keeps its text, which names the same consumers. | The plan's principle: the result shows on the thing that was set. |
| D6 | Where is the list opened? | **Confirmed on 2026-11-11.** A **Served order…** action in the strip of a selected Products or Byproducts slot, opening a popover; shown only when the item has two consumers or more, or one consumer and an extra output. On the graph, the chips of a listed source item carry their rank. | The 72px strip has no room for a list. A source with one consumer has nothing to order. |

The list of D4 and D5, on a short source:

```
Iron plate: served in this order
1  Science          asked 30   got 30
2  Hub              asked 20   got 15   short 5
3  Extra output           10   got  0   short 10
-------------------------------------------------
Not ranked: served after the list
   Mall             needs 8    got  0   short 8
```

## Spike report (T1)

Done on 2026-11-13. The prototype is kept: it is T1's change, and T4 builds on it.

**What was built.** When a block's LP is infeasible, `solveLP` solves it again with an elastic goal row per goal (`Σ S x + h ≥ d`, `h ≥ 0` the shortfall). The shortfall is lexicographic rather than a cost above an import: one LP minimises `Σ h` alone, then `Σ h` is bounded at that minimum (plus 1e-7) and the plain objective is solved, with `h` at `BIG_M` so it does not drift to the bound. A single weighted objective was not used: a goal can need many imported units per unit made, so a fixed cost "above an import" would have to sit near `BIG_M²`, far past the solver's 1e-8 precision. `solveAreaLP` does the same, with the shortfall bound computed on the model with its pools, before its two stages. The plain LP runs first and is kept whenever it is feasible, so nothing changes for a feasible plan. Spec: [solver.md, Infeasibility](../../spec/solver.md#infeasibility); synthetic case 13 holds the three rows of the table above (with and without areas) and the `solveAll` example: A makes 45, the first request gets 30, the second 15 (`limited`, 5 imported), the extra nothing.

**Which e2e fixtures change.** None: `legacyParity.test.ts` and the `contract/` fixtures are unchanged, because no block of any e2e fixture is infeasible. Three unit tests changed numbers, each from "the pin is ignored" to "the pin holds and the goal is short": a pinned mine of a locked ore (it ran at 60 against its pin of 30; it now runs at 30 and the plate is short by 30), and the two "keeps the hard row" cases, whose values were not asserted before.

**A locked item that cannot be covered.** The lock holds and the goals that need the item come up short by what it cannot cover, whether a pin or the network is the cap; nothing is imported. Example: plate locked, its rows pinned at 20 + 10, a gear goal of 25 at 2 plate per gear: the gear row runs at 15 and the gear is short by 10. The elastic solve still fails when pins conflict whatever the goals: a pinned row that needs more of a locked item than pinned rows make. The plain result is then returned as before (arbitrary values, `infeasible-pins`). A partly covered locked *connected* item is not affected: pass 2 already drops its lock.

**The cost of the second solve.** Only infeasible blocks pay it: two more LPs (areas: one more before the stages). Measured on the e2e fixtures with every running row in turn pinned at half its rate (115 solves, 22 of them with areas): 72 became infeasible, and all 72 were feasible with the elastic goals, each holding its pin and reporting a goal shortfall. The two extra LPs took about as long as the plain one, so an infeasible block costs about twice what it did. The solve cache key does not change: the result still depends only on the plan and the caps.

**Does `infeasible-pins` still have a job.** Yes, two. It still marks the case the elastic solve cannot fix (pins in conflict). After an elastic solve that succeeded it names the pins that the goal shortfall comes from, so the spike keeps it whenever the plain LP was infeasible and pins are present. Its text no longer fits that second case: "Pinned rate is impossible … can't be reached … Goals will not be met" is now wrong about the pin, which holds. The copy should change before phase 3 ships (for example "Pins cap a product" / "The pinned rates on X hold, but the products they feed fall short."); folded into T2, which makes the shortfall visible anyway. As before T1, the warning names every pin of the block, even when a lock, not a pin, is what caps the goal; T2 can name only the pins that bind.

**Other effects found.**

- A request now follows the consumer's own pins: the request probe of a consumer that its pins keep from its goal solves elastically, so it asks only for what its pinned rows can use, where it used to ask as if the pin were ignored.
- `coproduct-driven` stays skipped whenever `infeasible-pins` is present, so it is skipped after an elastic solve too.

**What the review found.** The shortfall is an unweighted sum over goals: when goals share a capped input, the least total goes to the goals that need the least of it per unit, not in proportion to their rates. It is a property of the step, documented in the spec; the served list of this phase and phase 4's shares are what decide who gets a short input. The review also made the bound's headroom grow with the number of goals and named the shortfall variables after their row, so that two ids that sanitise alike cannot share one.

**What it decides.** D1 holds. T4 to T6 keep their scope: ranking requests and moving the extra output up now act on a short source.

## Tickets

T1 reported on 2026-11-13 ([Spike report](#spike-report-t1)); the list below keeps its scope.

- [x] **T1. Spike: a source that holds its capacity.** Prototype the second solve of D1 in `solveBlock` and `solveAreaBlock` on a branch, with the three rows of the table above as a synthetic case and one `solveAll` case: a pinned source, an extra of 10 and requests of 30 and 20, 45 made (the example of spec/solver.md's "Shortfall", which no scenario reaches today). Report: which e2e fixtures change (`legacyParity.test.ts`), what a locked item that cannot be covered does, the cost of the second solve, and whether `infeasible-pins` still has a job. The outcome decides D1 and the rest of this list.
- [x] **T2. The solver says in what order it served.** No change of behaviour. `MultiBlockSolve` gains, per source item with at least one consumer, the consumers in the order they were served, each with its share and what it got, and the extra output's place. The list ships read-only in the Products and Byproducts panes: the hidden order becomes visible before it becomes editable. Also the new text of `infeasible-pins` ([Spike report](#spike-report-t1)): the pins now hold and the products fall short; it names only the pins that bind, where it can tell.
- [x] **T3. The stored list and its commands.** `Block.servedOrder` (D4), `moveServed`, `resetServedOrder`, the cleanup with a consumer's last connection. Nothing reads it yet.
- [x] **T4. Solver: grants by rank, outside loops.** The two steps of [How a rank can be honoured](#how-a-rank-can-be-honoured). Synthetic cases first: two takes of one byproduct, served by rank and unchanged by a reorder of the tabs; a consumer that is solved first and ranked last; a plan with no list, unchanged (`legacyParity.test.ts`).
- [ ] **T5. Solver: loops.** Grants inside the supply rounds, credits inside the demand rounds, the memo key. A synthetic loop in which the second member in member order is ranked first.
- [ ] **T6. The list, editable.** Drag and **Move up** / **Move down**, the extra output line on a product with an extra, **Reset order**, the figures of D5, and the consumers that are not ranked: the divider and the count on the action (D4). e2e: a consumer connected after the order was set shows under the divider, is counted on the action, is served last, and joins the list when dragged into it.
- [ ] **T7. The graph, and docs.** Ranks on the chips; `spec/solver.md`, `spec/data-model.md`, `spec/ui.md`, `spec/test-synthetic.md`.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- "Choose who is served first in a loop", for blocks. Shares come with phase 4.

## Risks

- ~~Without D1 the phase is smaller than it reads.~~ Settled by T1: a source now holds its capacity.
- The request-loop memo has to take the list into its key ([Cache keys](#cache-keys)); the block cache may need a fourth entry per block for a probed take consumer.
- Credits by rank need each higher-ranked consumer's need before a lower-ranked one is credited. Where that order would close a cycle in the request pass, the lower-ranked take gets no credit, as a take whose source is not processed yet gets none today; the list then holds only as far as solve order allows, and the UI has to say so on that line.
- Each change needs its synthetic case in `spec/test-synthetic.md` first.

## T2 report

Deviations and additions only.

- `legacyParity.test.ts` drops `served` from the key it serialises (`served: undefined`); the golden file is untouched, which shows no number moved. `served` has its own tests.
- `served: {}` added to test literals of `MultiBlockSolve` and store state (`snapshot/project.test.ts`, `store/solverStore.test.ts`) and passed on by `src/viewer/viewer.ts`, which builds a `MultiBlockSolve` for `projectSnapshot` (type-only; the snapshot does not read it).
- In the Products pane **Served order…** is the last action, not the one after **Find recipe**: the strip's action row has no room to spare and the first placement pushed **Move later** out of reach (`product-reorder.spec.ts`). Byproducts keep it first.
- `infeasible-pins` gains `conflict?: true`: set when the elastic solve failed too. The held case (no `conflict`) has the new text "Pins cap a product". The existing `WarningsPopover` test fixture for the old text now carries `conflict: true`, and a new case covers the held text.
- The pin-binding probe (`bindingPins`): one first-stage LP per pin with its row deleted, at most `PIN_PROBE_LIMIT = 8` pins; more pins, or no single pin lowering the total shortfall, name all pins as before. Runs only for infeasible blocks with pins and feeds no result.

## T3 report

Deviations and additions only.

- `Command` gained a `blocks` argument on `apply` and `undo`, and optional `applyOthers` / `undoOthers`: the cleanup writes into the source block from the consumer's history. `runCommand` replaces the three inlined copies in `applyCommand`, `undo` and `redo`. The undo of an add and the redo of a removal also clean and restore the entry.
- `clonePlan` remaps the block ids in every list and `cloneBlock` drops the list.
- `shown` is a parameter of `moveServed`, not a read of `solverStore` (import cycle).

## T4 report

Deviations and additions only. Synthetic cases 14 and 15 and `servedRank.ts` are as planned; every hand-derived value matched the solver on the first run.

- "Outside loops" covers the consumers too: a list is ignored (today's order) when the source or any consumer of the item is a member of a loop of blocks, until T5.
- The source of a ranked pair gets a probe of its own for its leftover estimate when it is neither a requester nor a take source (with no input connections it has the same cache key as its supply solve, so with a cache it is a hit).
- Side effect on the request pass: the rank edges can change the order of unrelated blocks (Kahn tie-breaks), so in a plan with a list the credit order of another item's takes-first consumers can change. No test pins it.
- `ServedConsumer.share` stays the request or the credit; it is not the grant the solve reserved (decision 3 of the plan), so D5's "asked / got / short" reads right.
- No fourth cache slot: a probed take consumer outside a loop uses two of the three slots (probe and supply solve). T5 has to revisit this for loops.
- The popover line "The extra output comes last." is left for T6.
- `ServedConsumer` has no `need` yet, which D5 will want for take-only lines.
- A listed take that gets no credit because a higher-ranked take was not credited yet (the Risks rule) is not flagged in `served`; T6 has to say it on the line.
