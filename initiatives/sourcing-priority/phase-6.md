# Sourcing priority, phase 6: predictable default

Phase 6 of [plan.md](plan.md). Not ticketed yet. It stands alone and should ship alone, with a release note, because it changes numbers in existing plans.

## Scope

In: the default order (*Make more here* above *Other blocks*) no longer depends on a recipe ratio. Today, when a block makes X only from an imported Y, a connection for X replaces the import when the recipe uses at least 1 Y per X and does not when it yields more X than Y, an artefact of the objective described in [spec/solver.md](../../spec/solver.md#connections-between-blocks).

Out: any new control. The player-facing rule is only that the list is followed.

## To settle before ticketing

- **Which way the default goes.** "Make it here" taken literally keeps importing Y and ignores the connection for X; the other reading lets connected X replace the import. Decide which one the default means, since the reverse stays available by moving the block line up.
- **How.** An extra pass, or a changed objective, for items made from an import. Check it against the [surplus-aware objective](../surplus-aware-objective/plan.md) initiative, which also changes the objective.
- **Which plans move.** Measure on real plans before shipping: how many items change source, and by how much.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- The rest of "Let connected supply replace an upstream import".

## Risks

- Results change for affected plans with no edit by the player. `legacyParity.test.ts` will need its expectations revisited, deliberately.
