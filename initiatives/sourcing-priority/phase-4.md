# Sourcing priority, phase 4: shares and areas

Phase 4 of [plan.md](plan.md). Not ticketed yet, and the least certain phase: nothing here was prototyped. It follows [phase 3](phase-3.md).

## Scope

In: groups in the **Served in this order** list (drop a consumer onto a line to join its group); inside a group, equal shares by default and editable percentages; a consumer that needs less than its share passes the spare to the others in its group; a consumer block with areas expands into its areas, so a source can rank or share between two areas of one block.

Out: a split in proportion to need (left out until someone asks); rules on the consumer's side of an area (phase 5).

The case it must serve, from the author's own factories: iron is short; science gets all it needs; the hub's logistics and building areas share what is left, 50 / 50 or one before the other.

## To settle before ticketing

- **Solving a shared group.** Serving in order needs one solve per consumer. A group needs each member's need first, then the split with overflow, then a second solve with the shares. Decide where the needs come from (the request probe for requests; for takes, a solve against what is left) and what it costs inside loop rounds.
- **Areas as consumers.** A connection is block to block, and what a block receives reaches any of its areas. Decide how the area solve divides received supply by the source's list, and what an area's "need" is when it has its own row for the item.
- **Prototype first.** Build the split on the author's hub plan with `scripts/inspect-plan.mjs` before writing tickets; the Large estimate in plan.md rests on this.
- **The stored field.** The phase 3 list gains groups, shares and area entries; a list without them loads as one consumer per rank. Decide how shares behave when a member leaves a group (renormalise or keep).
- **The gesture.** Dropping onto a line against between lines, with a keyboard equivalent, and where the percentages are edited.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- The rest of "Choose who is served first in a loop".

## Risks

- More LP calls per solve, and more distinct supply caps per block than the solve cache keeps (three per block today).
- Shares that depend on every member's need are one more thing a loop has to converge on.
