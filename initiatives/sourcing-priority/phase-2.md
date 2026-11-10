# Sourcing priority, phase 2: the list

Phase 2 of [plan.md](plan.md). Not ticketed yet: the questions below come first. It follows [phase 1](phase-1.md), which must have shipped so the names have been used.

## Scope

In: **Custom order…** on the **Comes from** control, opening the Sources list itself (drag to reorder, a switch per line, a limit field on each block line); the line names with their help texts (plan.md, "Help on every line"); the *Other blocks* lines in their connection order, each with the read-only **requested** / **existing** tag and its help text; the two combinations the stored modes cannot express on one item (receive first and never make it here; *Only what's already made* with Import off); one stored rule per item in place of `itemSourcing` and `noImportItems`.

Out: rules on an area and the *Other areas* line expanded per area (phase 5); the source side (phases 3 and 4); the default's dependence on the recipe ratio (phase 6).

## To settle before ticketing

- **The stored rule.** One map per block from item to rule: which lines are off and where *Make more here* sits among the block lines. Decide its shape, and whether the connection order stays the order of `inputConnections` or moves into the rule.
- **Migration.** `itemSourcing` and `noImportItems` load into the rule map, as `connectionsFirstItems` did before them. Decide whether exports keep writing the old keys for a while.
- **The LP for the new combinations.** A free supply variable and a cheap import slack both exist but have never been set on one item. Write the synthetic cases first, then check the passes, the locks and the request probe against them.
- **Names, after phase 1.** Confirm or change the line and preset names from what phase 1 taught, before a format is built around them.
- **A custom order as a sentence.** Every order must read as a sentence, never a code; list the orders the control allows and their sentences.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- Part of "Let connected supply replace an upstream import": the order decides, where a connection exists. The default case is phase 6.

## Risks

- First phase that changes solver inputs and the saved-plan schema. `legacyParity.test.ts` must stay green for plans without a custom order.
- "Connections first with partial supply" (a request probe defect) is not fixed here; any order with a block line above *Make more here* inherits it.
