# Initiative: Block granularity

Status: Future

Problem statement and requirements for planning a factory that is built in many places. This document is deliberately solution-neutral: it describes what is missing and what any answer must do, not how. Proposals live in [proposals/](proposals/) and are judged against the requirements and scenarios below. A proposal that disagrees with a requirement should say so explicitly rather than quietly drop it.

---

## Vocabulary

These words describe the player's factory, not the planner's model. Proposals may map them to whatever concept they choose (a block, a sub-factory, something new).

- **Product chain:** every recipe needed to make one product, from raw resources to the product itself.
- **Area:** a part of the map where the player builds a group of machines together (a smelting column, a plastics line, an outpost). The planner does not know where areas are or how they are laid out; it only knows which machines the player says belong to which area.
- **Flow between areas:** an item made in one area and used in another, which the player has to move by belt, pipe, train or robots.

## The problem

Planning a factory means answering two different questions:

1. **What does it take to make X?** The product chain: recipes, rates, machine counts, raw inputs.
2. **Where does each group of machines go?** The areas, and what has to be carried between them.

The planner today answers both questions with a single concept: a **block** is one product chain (one solve, one table) and, implicitly, one area. In small factories the two answers coincide. In large overhaul mods (Seablock, Nullius, Pyanodons) they do not, and neither of the planner's two grouping tools fits:

- **Blocks are good building blocks, but do not combine well at scale.** A large factory needs 20–30+ of them. Once a product chain is spread over that many blocks, there is no single place to see everything needed to make one product.
- **Sub-factories are good for organising a block, but are not areas.** They group rows of the table, and nothing more: the solver flattens them (see [spec/solver.md](../../spec/solver.md#sub-plans)), so they cannot express "these machines are over there" or what flows between groups.

The sharpest symptom is **intermediates built in several places**. A block can contain a recipe only once (later duplicates solve to zero with a `duplicate-recipe` warning), so a shared intermediate is one row with one machine count. In the factory, the same intermediate is often built several times, next to each of the lines that use it, because that is easier than shipping it. The planner cannot show that split, how many machines each place needs, or what still has to be shipped between places.

## Requirements

Each requirement comes from what the player asked for or from a constraint they stated.

**R1. One place to see a whole product chain.** The player can see every recipe needed to make one product together, with its rates and machine counts, the way a block's table shows them today. Splitting the factory into areas must not scatter that view.

**R2. Machines are assigned to areas.** The player can say which group of machines is built in which area, and the planner shows, per area, which recipes run there and how many machines each needs.

**R3. The same recipe can be built in several areas.** This is the main need: an intermediate made in two or three places, each sized for its own part of the work. It must be possible without splitting the product chain across separately solved plans by hand.

**R4. Building counts reflect the split.** Machines are counted per area, each rounded up to whole buildings in its own area. Splitting a recipe across areas can therefore increase the total building count: one machine at 60 % becomes two buildings at 30 % when its work is done in two places. Rates (what runs, what is imported and exported) do not change because of the split.

**R5. Flows between areas are tracked.** For each area, the planner shows which items come in and go out, and how much. This is bookkeeping: the planner reports the flows, it does not limit them.

**R6. The player decides where things go.** The planner has no notion of where buildings will be placed, so it must not pick areas for recipes, create per-area copies by itself, or apply a rule such as "always build X next to its consumers". It may size and report what the player has placed.

**R7. Nested groups are the player's choice.** Inside an area, the player can still organise rows into groups. Per group, the player chooses whether it is a separate area or only organises its parent area.

**R8. The top level is an area.** Whatever is not assigned elsewhere belongs to a default area at the top level, which takes part in flow tracking like any other.

**R9. Existing plans keep working.** Plans saved today load and solve with the same results, and the current way of working (one block, rows, optional sub-factories) stays available without extra steps. Migrating data to get there is an option (one-way migration).

## Out of scope

- **Capacity limits between areas.** No belt, pipe or train throughput limits, and no optimisation of what to ship versus build locally.
- **Automatic placement.** See R6.
- **Spatial layout.** No map, coordinates, distances or drawing of areas. The project's non-goals exclude belt and logistics layout and spatial planning ([spec/overview.md](../../spec/overview.md#non-goals)). Areas as bookkeeping are compatible with that, but the overview's wording should be revisited when this ships so it does not read as excluding them.

## Scenarios

Every proposal should walk through these. Numbers are illustrative.

1. **Intermediate in three areas.** A block makes plastics and rocket fuel. Both need hydrogen, 13.6 electrolysers in total. The player builds hydrogen next to plastics (enough for 4.2 electrolysers), next to rocket fuel (4.8) and on the main bus (the rest, 4.6). The plan shows 5 + 5 + 5 = 15 buildings, and plastics and rocket fuel no longer show hydrogen coming in.
2. **Rounding.** A recipe needs 0.6 machines. Built in two areas at 0.3 each, it shows 2 buildings, not 1.
3. **Large factory.** A Nullius-scale factory with 25+ areas. The player can still open one product and see its whole chain (R1), and can list what each area receives and sends (R5).
4. **Chained intermediates.** The hydrogen built next to plastics needs water, and the player also builds water there. Both are sized for that area's needs together.
5. **Loops and byproducts.** An area makes an item as a byproduct of another recipe and also has its own recipe for it (common in Nullius). The proposal says how the area's numbers come out and what is reported as flowing in or out.
6. **Nested groups.** An area contains two groups of rows: one is just organisation, the other is a separate area (R7). Flows are reported between the areas only.
7. **Old plan.** A plan saved before this work loads and shows the same rates and building counts (R9).

## Open questions

These are the player's own uncertainties, to settle while proposals are compared.

- **Default for nested groups:** whether a new group starts as a separate area or as organisation only.
- **Who ships to whom:** whether per-area net in/out is enough, or flows need a source and a destination (with several suppliers and consumers there is more than one valid answer).
- **Different machines per area:** whether the same recipe may use different machines or modules in different areas (for example an early build and a later one).
- **Areas and blocks:** whether an area always lives inside one block, can span blocks, or can be a whole block; and how areas relate to the existing connections between blocks.

## Proposals

| Proposal | Summary |
|---|---|
| [Sub-factory sites](proposals/sites.md) | A sub-factory can be marked as a site; recipe rows get hand-placed copies in other sites, sized automatically; a per-site ledger lists flows. |
| [Areas in the solve](proposals/area-solve.md) | A sub-factory can be marked as an area; a recipe has an ordinary row, with its own settings, in each area that builds it; the block LP balances items per area and an area's own rows serve it first. |
| [Areas as an overlay](proposals/overlay.md) | Areas are a plan-level layer that can span blocks; rows and sub-factories are bound to an area, and a row gets parts in other areas (local, share or buildings), sized after the solve; the table stays the chain and an Areas view shows what each area builds and ships. |
