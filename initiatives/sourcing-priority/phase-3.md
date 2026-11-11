# Sourcing priority, phase 3: served order

Phase 3 of [plan.md](plan.md). It does not depend on phase 2 and can ship before it.

The questions of the first draft were answered from the code on 2026-11-11 ([What the code says](#what-the-code-says)). One answer changes the phase: a source is never short by a definite amount today, so a rank among requests has almost nothing to act on. The author confirmed D1 and D2 the same day: the phase starts with the spike of T1, and one list ranks requests and takes. D3 to D6 are still proposals; the [tickets](#tickets-draft) are a draft that holds only if they are confirmed, and the spike can still change them.

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

Goal rows are hard, so a source makes all that is asked or the LP is infeasible; an infeasible LP returns what the solver library happened to hold, here the goal met and the pin ignored. [spec/solver.md](../../spec/solver.md#requests) says the same: "No `solveAll` scenario reaches a partial shortfall".

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

| # | Question | Proposal | Why |
| --- | --- | --- | --- |
| D1 | Should a source be able to hold at a capacity and be short by a definite amount? | **Confirmed on 2026-11-11.** Yes, as the first ticket of this phase, a spike with its own synthetic case: when a block's LP is infeasible, solve it again with elastic goal rows (a shortfall variable per goal, costed above an import), so pins and locks hold and each product reports what it lacks. | Without it, ranking requests and moving the extra output up have nothing to act on, and phase 4's shares neither. The Products pane already draws a short product and says where the shortage comes from. It changes numbers only for blocks that are infeasible today, whose numbers are arbitrary. If the spike fails, this phase ranks takes only and says so. |
| D2 | Does one list rank requests and takes? | **Confirmed on 2026-11-11.** Yes. | A product is requested; a spare output is taken; the two meet in one list only for an ignored request. For a request the rank means: whose share is honoured first when the source is short. |
| D3 | Does the list change loop member order? | No: only who is served. | Member order decides the back connections and the rounds; changing it changes what a loop converges to. |
| D4 | What does the stored list hold? | `Block.servedOrder?: Record<itemId, ServedEntry[]>` on the source, an entry being a consumer block id or the extra output. Absent means today's order. Consumers not in the list are served after it, in today's order; an entry whose consumer no longer takes the item is ignored by the solver and removed by the store with the consumer's last connection for it (undo restores it). The list is written on the first drag, from the order shown, and **Reset order** removes it. | Block ids, not connection ids: a consumer has one counting connection per source item, and reconnecting must not lose its rank. Once a list exists, reordering tabs no longer changes who is served among its entries. Phase 4 adds groups, shares and areas to the entry, so the entry is an object from the start. |
| D5 | How do the list and the "comes out of the extra" text fit together? | The list is where the result shows: each line carries what its consumer asked or needs, what it got, and what it is short. The short segment keeps its text, which names the same consumers. | The plan's principle: the result shows on the thing that was set. |
| D6 | Where is the list opened? | A **Served order…** action in the strip of a selected Products or Byproducts slot, opening a popover; shown only when the item has two consumers or more, or one consumer and an extra output. On the graph, the chips of a listed source item carry their rank. | The 72px strip has no room for a list. A source with one consumer has nothing to order. |

## Tickets (draft)

Not final: they assume D3 to D6 as proposed. T1 and T2 are safe to start whatever the answers.

- [ ] **T1. Spike: a source that holds its capacity.** Prototype the second solve of D1 in `solveBlock` and `solveAreaBlock` on a branch, with the three rows of the table above as a synthetic case and one `solveAll` case: a pinned source, an extra of 10 and requests of 30 and 20, 45 made (the example of spec/solver.md's "Shortfall", which no scenario reaches today). Report: which e2e fixtures change (`legacyParity.test.ts`), what a locked item that cannot be covered does, the cost of the second solve, and whether `infeasible-pins` still has a job. The outcome decides D1 and the rest of this list.
- [ ] **T2. The solver says in what order it served.** No change of behaviour. `MultiBlockSolve` gains, per source item with at least one consumer, the consumers in the order they were served, each with its share and what it got, and the extra output's place. The list ships read-only in the Products and Byproducts panes: the hidden order becomes visible before it becomes editable.
- [ ] **T3. The stored list and its commands.** `Block.servedOrder` (D4), `moveServed`, `resetServedOrder`, the cleanup with a consumer's last connection. Nothing reads it yet.
- [ ] **T4. Solver: grants by rank, outside loops.** The two steps of [How a rank can be honoured](#how-a-rank-can-be-honoured). Synthetic cases first: two takes of one byproduct, served by rank and unchanged by a reorder of the tabs; a consumer that is solved first and ranked last; a plan with no list, unchanged (`legacyParity.test.ts`).
- [ ] **T5. Solver: loops.** Grants inside the supply rounds, credits inside the demand rounds, the memo key. A synthetic loop in which the second member in member order is ranked first.
- [ ] **T6. The list, editable.** Drag and **Move up** / **Move down**, the extra output line on a product with an extra, **Reset order**, the figures of D5.
- [ ] **T7. The graph, and docs.** Ranks on the chips; `spec/solver.md`, `spec/data-model.md`, `spec/ui.md`, `spec/test-synthetic.md`.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- "Choose who is served first in a loop", for blocks. Shares come with phase 4.

## Risks

- **Without D1 the phase is smaller than it reads.** It would order takes and the consumers of a source that makes nothing, and nothing else.
- The request-loop memo has to take the list into its key ([Cache keys](#cache-keys)); the block cache may need a fourth entry per block for a probed take consumer.
- Credits by rank need each higher-ranked consumer's need before a lower-ranked one is credited. Where that order would close a cycle in the request pass, the lower-ranked take gets no credit, as a take whose source is not processed yet gets none today; the list then holds only as far as solve order allows, and the UI has to say so on that line.
- Each change needs its synthetic case in `spec/test-synthetic.md` first.
