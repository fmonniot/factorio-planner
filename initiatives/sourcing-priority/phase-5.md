# Sourcing priority, phase 5: area rules

Phase 5 of [plan.md](plan.md). Not ticketed yet: the questions below come first. It needs the stored rule of [phase 2](phase-2.md).

## Scope

In: a Sources rule attached to an area, which overrides its block's rule; *Other blocks* above *Make more here* in an area (a central block feeding an area that has its own row); the *Other areas* line expanded to one line per area that makes the item, in order, each with a switch and the rate the solver routed; the same routes on the collapsed-area chips and an item's "Trades with" panel.

Out: choosing between two recipes for one item inside a block; *Make more here* stays one line.

## To settle before ticketing

- **Local first as a position.** Today an area with its own dedicated row does not take another area's dedicated output, automatically, driven by the primary product. Restate it as *Make more here* above *Other areas* in that area's order, and decide what the primary product still decides.
- **The area LP.** It needs the local-first penalty and the import slack cost per area and item, not per item. Estimate the passes; plan.md's risk is one pass per movable tier.
- **Supplier choice.** Whether per-area lines on the receiver are enough, or a supplying row also needs its own **Served in this order** list ("this row serves nobody else" in one click). See "Choosing the supplying area" in plan.md.
- **Routes first.** "Per-partner area figures elsewhere" is a prerequisite and needs no solver change (`SolverResult.areaRoutes`); it can ship ahead of the rest of the phase.
- **The stored field.** A new optional field on an area sub-factory; decide what happens to its rules when the area flag is switched off.

## Backlog items it closes

- "Byproducts first per consumer" (put the consumer in an area and set the rule there).
- "Connections first vs local-first".
- "Supplies other areas toggle", if *Other areas* expands to one line per area.
- "Per-partner area figures elsewhere".

## Risks

- The largest solver change of the initiative; a block with areas already runs up to four LPs per solve.
- Narrower scope wins: the UI must show which rule applies to a row, the block's or the area's.
