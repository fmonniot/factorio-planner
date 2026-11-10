# Sourcing priority, phase 3: served order

Phase 3 of [plan.md](plan.md). Not ticketed yet: the questions below come first. It does not depend on phase 2 and can ship before it.

## Scope

In: a **Served in this order** list on each product and spare output of a block, in the Products and Byproducts panes and on the block graph; consumers are blocks, one per rank, dragged to reorder; the block's own extra output is a line of the list that can be moved up; the list defaults to today's block order, so an untouched plan does not change.

Out: groups, shares and areas as consumers (phase 4).

## To settle before ticketing

- **Where the order is read.** Today competing consumers are served in block order in `solveAll`, in loop member order inside a loop, and extra output gives way first on a shortfall. List every place and confirm one list can replace all three.
- **Loops.** Member order also decides which connections are back connections and how rounds run. Decide whether the list changes only who is served first, or the member order itself; the first is far smaller.
- **Requests against takes.** A request reserves its share and rarely runs short; takes compete for what is left. Decide whether one list ranks both kinds, and what a rank means for a request.
- **The stored field.** An optional list per source item; absent means block order. Decide how it follows a consumer that is added, removed or reconnected, and that a reorder of block tabs no longer changes the plan once a list exists.
- **Showing the result.** The product bar already says who is short and why ("comes out of the extra"); decide how the list and that text fit together.

## Backlog items it closes

- "Choose who is served first in a loop", for blocks. Shares come with phase 4.

## Risks

- The solve cache and the loop memo key on what the rounds read; the list has to enter both keys.
- Each change needs its synthetic case in `spec/test-synthetic.md` first.
