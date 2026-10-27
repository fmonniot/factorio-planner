# Proposal: Sub-factory sites

Proposal for [Block granularity](../problem.md). Not chosen: [Areas in the solve](area-solve.md) was preferred (see [Decision](../problem.md#decision)). Not implemented.

A sub-factory can be marked as a **site** (an area, in the problem's vocabulary), a recipe can have **copies** in other sites, and the planner shows what each site makes, uses and has to ship in or out. The proposal keeps one block (one solve, one table) per product chain, which covers R1, and adds sites on top of it.

---

## Principles

- **The user decides where things go.** The planner has no idea where buildings will be placed, so it never moves a recipe or creates a copy by itself. It sizes what the user placed and reports the consequences.
- **Bookkeeping, not constraints.** Sites never change the block's rates: what each recipe runs at, what the block imports and exports, and its power are the same with or without sites. Sites split those rates by place and list the flows between places. Building counts do change: each row is rounded up to whole machines on its own, so splitting a recipe over two sites can add buildings (one machine at 60 % becomes two at 30 %). Capacity limits between sites (belts, trains) are out of scope.
- **The table is what you build.** Every group of machines that exists on the map is a row in the table.

## The model

**Sites.** The block's root is always a site. A sub-factory becomes a site when its **Separate site** toggle is on. A sub-factory with the toggle off belongs to the nearest enclosing site, so nested sub-factories can either be separate places or just organise the rows of their parent site; the user picks per sub-factory. The toggle is off by default, so existing plans are unchanged.

**Copies.** A recipe row can have **copies** in other sites. The original row is the **main row**; it owns every setting (machine, modules, beacons, pin, byproduct policy, primary product). A copy has no settings of its own: it builds the same recipe, the same way, in another place. A copy produces what its site uses of the recipe's primary product; the main row produces the rest (the block's products, and every site without a copy).

Example: *Hydrogen* is a main row in the root, needing 13.6 electrolysers (14 buildings). The user adds a copy in the *Plastics* site, which uses enough hydrogen for 4.2 electrolysers, and one in *Rocket fuel*, which uses 4.8. The copies show 5 buildings each, the main row 5 for the remaining 4.6: 15 buildings instead of 14. *Plastics* and *Rocket fuel* no longer import hydrogen from the root.

At most one row per recipe (main or copy) per site. A second one in the same site is a duplicate, handled as today: it solves to zero with a warning.

**Ledger.** For every site and item, the planner computes what the site makes and uses. A positive balance is shipped out of the site, a negative one is shipped in. These are the belts and trains between places. Items the block as a whole imports or exports (raw resources, connections from other blocks, products) appear in the ledger of the site that uses or makes them, marked as crossing the block boundary.

## Solver

The block solve is unchanged: `flattenBlock` merges each copy into its main row, so a recipe is still one LP variable. Because copies share the main row's settings, every copy has the same inputs and outputs per run, so the merge is exact.

A new **site allocation** step runs after each block solve:

- One variable per row (main or copy) of a recipe that has copies; rows without copies keep their solved rate.
- For each recipe: the rates of its main row and copies add up to the solved rate.
- For each copy, in its site: the balance of the recipe's primary product is zero (the site makes what it uses), with slack on both sides; the objective minimises the slack.

The system is square (one equation per row), so the result is unique in practice. Solving it as one small LP, rather than recipe by recipe, handles chained copies: a hydrogen copy needs water, and if water has a copy in the same site, its share depends on hydrogen's. It also handles loops, which Nullius has plenty of. Slack absorbs the cases where a copy cannot balance its site: the site makes the item as a byproduct of something else (the copy runs at 0 and the surplus is shipped out), or the block imports part of the item, so the main row cannot make up for all the copies (the shortfall is shipped in).

Machine metrics (`computeMachineMetrics`) are then computed per row from its allocated rate: each row's building count is rounded up on its own, so a recipe's building count is the sum over its rows, which can be more than the rounded-up count of the merged recipe. Power uses the exact count and adds up to the same total. The ledger is a sum over the allocated rows per site. Allocation and ledger are part of `SolverResult`; they do not feed back into the block solve or into connections between blocks.

New warnings: a copy in a site that does not use its primary product (it runs at 0); two rows of one recipe in the same site (today's `duplicate-recipe`, now per site).

## Data model

- `SubPlan.separateSite?: boolean`. Absent means off.
- A new node kind, `RecipeCopyNode { kind: 'recipe-copy', id, mainNodeId }`, in the `RecipeNode` union. It references a `GameRecipeNode` of the same block and carries nothing else.
- The schema drops copies whose main row does not exist, so imported or hand-edited JSON still loads.

## UI

- **Sub-factory menu:** a **Separate site** checkbox. Site group rows get a site marker; collapsed, they show the site's in and out items as chips.
- **Recipe row menu:** **Copy to site…**, listing the sites that use the recipe's primary product and have no row for it yet, with how much each one uses. The copy is added at the end of that site; it can then be dragged like any row.
- **Copy rows:** a link badge on the recipe icon; the machine count and rates are the copy's own. The machine, module and beacon cells show the main row's settings and open the main row's editors, with a note that the change applies to every copy. Row menu: **Go to main row**, **Remove copy**.
- **Main rows** show their own building count, like copies, and a tooltip with the recipe's total and the split: "15 buildings (13.6 exact): 5 here, 5 Plastics, 5 Rocket fuel".
- **Removing a main row with copies** asks first and removes the copies too (one undoable command).
- **Sites pane** in the summary: every site of the block with its in and out items, including the root.

Every new action is an undoable `Command` (see [backlog.md](../../../backlog.md) for the sub-factory edits that are not yet).

## Phases

1. **Sites and ledger.** The toggle, the ledger and the Sites pane, with no copies yet. Useful on its own: it shows what moves between the places of an existing plan.
2. **Copies.** The node kind, site allocation, copy rows and the row menu actions.

## Decisions and rejected options

- **Sizing is automatic, placement is not.** Proposals that pick where a recipe is built were rejected: a per-item "build locally / ship it" policy, a "copy to every site that uses it" shortcut, and splitting rows by consumer without any copies. They guess at a layout the planner knows nothing about, and the table no longer matches the build.
- **One block per site** (connections as belts between sites) was rejected: each block solves on its own, and it is exactly the many-blocks setup this initiative avoids.
- **Copies are not separate LP variables.** That would let copies have their own settings, but the block solve would then need site constraints to split the work, which makes sites constraints rather than bookkeeping.

## Open questions

- **Per-copy settings.** Different machines or modules per site (e.g. an early and a late build) break the exact merge, because base and module productivity change the outputs per run. Possible later: per-copy machine and speed modules only, with productivity tied to the main row.
- **Byproduct-consumer rows.** Their rate follows another recipe's surplus, not demand for their primary product. Copies of them are not allowed in phase 2.
- **Routes between sites.** The ledger gives each site's net in and out, not who ships to whom: with several suppliers and consumers there are many valid routings. A proportional split could be shown later.
- **Default of the toggle** for new top-level sub-factories.

## Backlog interactions

- *Prevent adding a recipe already present in the block* becomes "…already present in the same site".
- *Isolate a subfactory from the rest of the plan* is related but separate: an isolated sub-factory shuts out the other *blocks*, while a site still exchanges items with the other sites of its block.
- Spec updates when this ships: [spec/data-model.md](../../../../../spec/data-model.md) (`SubPlan`, `RecipeNode`), [spec/solver.md](../../../../../spec/solver.md) (sub-plans, site allocation), [spec/ui.md](../../../../../spec/ui.md) (sub-factory rows, recipe rows, summary).
