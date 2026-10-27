# Proposal: Areas in the solve

Proposal for [Block granularity](../problem.md). **Chosen** (see [Decision](../problem.md#decision)). Phases 1, 2 and 3 implemented.

A sub-factory can be marked as an **area**. A recipe can have an ordinary row in each area that builds it, each row with its own machine, modules and beacons. The block's LP knows which area every row is in: it balances each item per area, tracks what moves between areas, and sizes every row in the same solve. As in [Sub-factory sites](sites.md), one block (one solve, one table) stays one product chain, which covers R1. Unlike sites, areas are part of the solve, not bookkeeping after it.

---

## Principles

- **The player places rows, the solve sizes them.** The planner never adds, moves or removes a row. Where a recipe is built is exactly where the player put its rows.
- **A row in an area serves that area first.** An area that has its own row for an item does not take that item from another area's row for it. This is the one rule areas add to the solve, and the reason they are in it: it is what "I build hydrogen next to plastics" means.
- **Every row is a full row.** A recipe built in three areas is three ordinary rows. Each has its own settings, so an early build and a later one can use different machines, modules and beacons.
- **Flows are not limited.** No belt, pipe or train capacity; the solve reports what crosses between areas.

## The model

**Areas.** The block's root is always an area (R8). A sub-factory becomes an area when its **Separate area** toggle is on; with the toggle off it only organises the rows of the nearest enclosing area (R7). The toggle is off by default, so existing plans are unchanged. A row's area is its nearest enclosing area.

**Rows.** A recipe may have one row per area. A second row of the same recipe in the same area is a duplicate, handled as today: it solves to zero with a `duplicate-recipe` warning. There is no main row and no copy: every row owns its machine, modules, beacon, pin, byproduct policy and primary product.

**Dedicated rows.** A row is the *dedicated* producer of its primary product (`primaryProduct ?? mainProduct ?? first product`, the output the Products cell shows). Its other outputs are byproducts. The local-first rule is about dedicated rows only: an electrolysis row whose primary product is hydrogen keeps its area from importing hydrogen, not oxygen. Clicking a byproduct to make it primary, which the table already allows, moves the rule to that item. `primaryProduct` stops being display-only.

**Supply between areas.** An area sends out what it makes and does not use, and receives what it uses and does not make. Supply comes in two kinds:

- *dedicated supply* comes from another area's dedicated rows for the item;
- *other supply*: byproducts of other areas, and what the block receives from outside (connections, imports, raw resources).

An area that has a dedicated row for an item takes no dedicated supply of it while its own row can cover its need. It does take other supply, so a byproduct made elsewhere still shrinks the local row, exactly as it shrinks the one row today. An area without a dedicated row takes both.

Example: *Hydrogen* has a row in the root, one in *Plastics* and one in *Rocket fuel*, 13.6 electrolysers of work in total. Plastics and Rocket fuel each have their own row, so they take no hydrogen from the root: their rows are sized to their own use, 4.2 and 4.8 electrolysers. The root row makes the rest, 4.6. Each row rounds up on its own: 5 + 5 + 5 = 15 buildings instead of 14.

## Solver

### LP

The single-area case is today's LP. With areas, the variables and constraints of [spec/solver.md](../../../../../spec/solver.md#lp-formulation) become:

```
x_n ≥ 0                       for each row n, in area a(n)       (one variable per row, not per recipe)
din_ia, dout_ia ≥ 0           dedicated supply of i into / out of area a
oin_ia, oout_ia ≥ 0           other supply of i into / out of area a
s_i, u_i                      as today, at block level

Σ_{n∈a} S_in · x_n + din_ia + oin_ia − dout_ia − oout_ia = 0     each item i made or used in area a
dout_ia ≤ Σ_{n∈a, n dedicated to i} max(S_in, 0) · x_n             dedicated supply comes from dedicated rows
oout_ia ≤ Σ_{n∈a, n not dedicated to i} max(S_in, 0) · x_n         other supply comes from the other rows
Σ_a din_ia ≤ Σ_a dout_ia                                           no more dedicated supply taken than sent
Σ_a oin_ia ≤ Σ_a oout_ia + s_i + u_i                               the same for other supply, plus outside supply
Σ_a (dout_ia + oout_ia − din_ia − oin_ia) + s_i + u_i ≥ d_i        the block row: today's goal or intermediate row
```

Pins, the no-import set, byproduct policies, byproduct consumers and connections-first rows stay as they are, applied per row and at block level. The two bounds on what an area sends stop an area from relabelling its dedicated output as other supply. An area's balance is an equality, so a surplus is always sent out and shows in the ledger. The block row stays a `≥` and reports the block's surplus as today (`overconstrained`). Raw items have no row, as today: an area's consumption of them is received from outside the block. Flow variables exist only for an item in an area that makes or uses it, and only when the item appears in more than one area or crosses the block boundary.

Summing the area equalities gives today's block row, so with one area the flow variables vanish and the LP is exactly today's.

### Objective in stages

One weighted objective cannot put "local first" between imports and recipe runs, for the same reason it cannot put own production before connected supply ([spec/solver.md](../../../../../spec/solver.md#connections-between-blocks)): the weight would have to exceed any recipe chain's cost and stay below `BIG_M`. The objective is solved in stages instead, each one an LP that keeps the previous optimum (within a relative `1e-9`):

1. **Imports, then local first:** minimise `BIG_M · Σ s_i + Σ din_ia` over the areas that have a dedicated row for `i`.
2. **Recipe runs:** minimise `Σ c_n · x_n`, today's run cost (`BC_BONUS` for byproduct consumers).
3. **Shipping:** minimise what is sent, with a slight preference for sending from areas higher in the table (the root first). This removes items sent out and back in, and picks which area supplies an area that has no row of its own when several could.

Each pass of `solveLP` (measure and fill, see connections) runs the stages. A block with no area other than the root runs today's single LP, unchanged, so its results are identical (R9). With areas, a pass is up to three LPs of a few hundred variables; the problems stay small, and the solve cache works as before since a block's inputs are the same.

`computeMachineMetrics` already works per row; each row's building count is rounded up on its own (R4). The result gains `SolverResult.areas`: for each area (its sub-plan id, the root plan's id for the top level), the items it receives and sends, and which of them cross the block boundary.

### Warnings

- `duplicate-recipe`: now per area, with the area named.
- `area-shortfall` (new): an area that has its own dedicated row still takes dedicated supply from other areas, because its row cannot cover its need (it is pinned, or an input is locked). Lists the area, the item and the rate.

## Scenarios

1. **Intermediate in three areas.** As in the example above: 4.2, 4.8 and 4.6 electrolysers, 15 buildings, and Plastics and Rocket fuel receive no hydrogen.
2. **Rounding.** Two rows of 0.3 machines in two areas show 1 + 1 = 2 buildings.
3. **Large factory.** A block per product chain, with as many areas as the build has. The table is the product chain (R1); the Areas pane lists what each area receives and sends (R5). With 25+ areas over several blocks, the plan-level area list of phase 3 gathers them.
4. **Chained intermediates.** The Plastics area has a hydrogen row and a water row. Both are in the same LP: the area takes no water from other areas' water rows, so its water row is sized for its hydrogen row and anything else there that uses water. Nothing needs a separate allocation step.
5. **Loops and byproducts.** An area runs recipe R, which makes X as a byproduct, and also has a dedicated X row. Its own byproduct is used first: the X row makes only what R does not cover, and runs at 0 if R's X is enough. A surplus of X is sent out as other supply, and any area that uses X can take it, with or without its own X row. Loops are ordinary LP cycles inside and between areas.
6. **Nested groups.** An area with an organising group and a separate area inside it: the organising group's rows are in the parent area, and flows are reported between the parent and the inner area only.
7. **Old plan.** No sub-factory has the toggle on, so the block runs today's LP: same rates, same building counts.
8. **Early and late builds.** Gears are built in *Mall* (assemblers, no modules) and in *Science* (with productivity modules). Each area has its own row, so each makes its own gears: Science's productivity reduces its own inputs and does not take work from Mall. An area with no gear row gets gears from the row with productivity first, since it costs fewer runs, then from the area higher in the table.

## Where this departs from the problem

**R4 says rates do not change because of the split.** Here they can, in two cases, both on purpose:

- **Different settings per area.** Productivity in one area's row changes what that row needs per item, so the block's rates follow the settings the player chose. Machines, speed modules and beacon speed do not enter the LP, so differences in them change only building counts and power.
- **Alternative recipes in different areas.** If Mall makes X with recipe X1 and Science makes X with recipe X2, Science uses X2 for its own need even if the block, as one area, would have made all X with X1. The player placed X2 there.

With the same productivity on every row of a recipe and no alternative recipes split across areas, the split leaves the rates as they would be without areas: it only redistributes the same work (pins aside). In practice, turning an area on can change the block's numbers, unlike in sites; the Areas pane shows where the change comes from.

**Who ships to whom.** The ledger gives each area's net in and out per item, not routes. Each item has one pool per block: areas put into it and take from it, much like train stops with the same name or a logistic network in the game. The Areas pane can show, for an item, every area that sends it and every area that receives it, which is what the player needs to plan stations. Routes would need a variable per pair of areas and item and would still have many equal answers.

## Data model

- `SubPlan.area?: boolean` ("Separate area"). Absent means off.
- No new node kind. `GameRecipeNode` is unchanged; `primaryProduct` is now read by the solver when the block has areas.
- No migration. Duplicate detection moves from per block to per area, which changes nothing for a plan without areas.

## UI

- **Sub-factory menu:** a **Separate area** checkbox (undoable). Area group rows get an area marker; collapsed, they show the area's in and out items as chips.
- **Adding a row in an area:** the existing ways already work. Clicking an ingredient tile inside an area adds the producing recipe to that area, so building hydrogen next to plastics is one click on the hydrogen tile of a plastics row. The recipe picker rejects only a recipe already present *in the same area*.
- **Recipe row menu: Build also in…** lists the areas that use the row's primary product and have no row for it, with how much each one uses. It adds a row there with the same settings. The new row is independent from then on.
- **Rows of a recipe built in several areas** get a small badge with the area count. Its tooltip gives the recipe's total and the split: "Hydrogen: 15 buildings (13.6 exact) in 3 areas: 5 here, 5 Plastics, 5 Rocket fuel". **Go to row in…** jumps to another one.
- **Machine and beacon modals** offer **Apply to every row of this recipe (3)**, for the common case where the areas use the same build.
- **Primary product:** on a row in a block with areas, the byproduct click's tooltip says that the primary product decides what the area builds for itself.
- **Areas pane** in the summary: every area of the block, root included, with what it receives and sends. Clicking an item shows its pool: the areas that send it and those that receive it, and the block's own import or export of it.

Every new action is an undoable `Command`.

## Phases

1. **Areas in the solve.** The toggle, the area-aware LP with staged objective, `SolverResult.areas`, the Areas pane and the per-area duplicate rule. This already covers R2–R8: a second row in another area is added with the existing ingredient click.
2. **Row conveniences.** **Build also in…**, the multi-area badge and tooltip, **Apply to every row of this recipe**, collapsed-area chips, the primary-product tooltip and the recipe picker's same-area check.
3. **Scale.** A plan-level list of areas across blocks (scenario 3), and a "by recipe" view of the table that shows one line per recipe with its total and opens to its rows per area.

## Compared with sites

| | Sub-factory sites | Areas in the solve |
|---|---|---|
| Rows in other areas | Copies of a main row, sharing its settings | Ordinary rows, each with its own settings |
| Sizing | After the solve, in a separate allocation LP | In the block LP, by the local-first stage |
| Rates | Never change with sites | Can change (per-area productivity, alternative recipes per area) |
| Different machines per area | No (open question) | Yes |
| Data model | `separateSite`, new `RecipeCopyNode` | `area` only |
| Solver cost | One small extra LP per block | Up to three LPs per pass for a block with areas |

## Decisions and rejected options

- **Areas are constraints, not bookkeeping.** That is what lets each row keep its own settings: post-solve allocation needs the copies to have the main row's coefficients so the merge is exact. The price is the R4 departure above.
- **Local first comes before recipe runs.** The other order, runs first and locality as a tie-break, lets a row with productivity take the whole recipe's work, since it costs fewer runs, and leaves the other areas' rows at 0.
- **The rule covers dedicated rows only.** Applied to every output, an area would overrun a multi-output recipe to avoid importing one of its byproducts, and an area's byproduct could never shrink another area's row.
- **One weighted objective** was rejected for the reason given under *Objective in stages*.
- **Routes between areas** were rejected (see *Who ships to whom*).

## Open questions

- **Default of the toggle** for new top-level sub-factories.
- **A notice when turning an area on changes rates.** Comparing with the block solved as one area costs an extra solve; it could be shown only on demand.
- **Choice of supplier.** An area without its own row is supplied by the most productive row, then table order. A per-row **Supplies other areas** toggle would let the player choose instead.
- **Byproduct consumers** absorb surplus from any area here. Absorbing only their own area's surplus is the more physical reading.
- **Connections first** items are other supply, so connected supply does not override the local-first rule. It may need to.
- **Areas across blocks.** Settled: an area lives in one block and the plan-level list keeps one row per block, never merged by name (see the phase 3 notes below).

## Backlog interactions

- *Prevent adding a recipe already present in the block* becomes "…already present in the same area"; phase 2 does it in the recipe picker.
- *Isolate a subfactory from the rest of the plan* is related but separate: an isolated sub-factory shuts out the other blocks, while an area still exchanges items with the other areas of its block.
- Spec updates when this ships: [spec/data-model.md](../../../../../spec/data-model.md) (`SubPlan`, `primaryProduct`, `SolverResult.areas`), [spec/solver.md](../../../../../spec/solver.md) (sub-plans, area LP, stages, warnings), [spec/ui.md](../../../../../spec/ui.md) (sub-factory rows, recipe rows, modals, summary), and the overview's non-goals as [problem.md](../problem.md#out-of-scope) notes.

## Implementation notes

Phase 1 follows the design above, with these differences found while building it. The formulation as shipped is in [spec/solver.md](../../../../../spec/solver.md#areas).

- **Stage 3 is folded into the second LP.** A separate third LP that minimised shipping after runs drifts: a relative `1e-9` bound is below the solver's resolution (1e-8), and any workable tolerance lets the shipping objective buy less shipping with tolerance-sized extra runs, so a row that should be at 0 runs at about 1e-6 and shows one building. Shipping is instead a dominated per-unit cost on the units sent, inside LP 2, so it only decides run-cost ties. There are two LP calls per pass, not three.
- **Bound the dedicated imports alone.** Bounding the combined stage-1 value (`BIG_M·s` plus `din`) would let `din` drift by about `1e-7·BIG_M·s`, so only `Σ din` is bounded and slack is re-optimised in LP 2.
- **The tie-break is on units sent**, not on runs, so a row cannot be over-run to manufacture "other supply" for an area that has its own row, and among senders the area higher in the table wins.
- **Flows are read from per-area net production**, not from the flow variables, so out-and-back circulation never shows and degenerate flow values do not matter.
- **A dedicated row needs a positive coefficient** for its item after `discard`; a primary product that is discarded or is not a product of the recipe makes the row dedicated to nothing.
- The root area is shown as "Top level". `area-shortfall` is one warning with an entry per area and item, like `overconstrained`. The result carries no names; the UI resolves them from the block tree.

Phase 2 follows the UI section, with these choices:

- **Consumption, not receipt, ranks the areas in Build also in….** An area "uses" the primary product when its rows (organising groups inside it included) consume it, summed from the rows' solved input rates above a negligible rate. `SolvedArea.receives` is a net figure and reads 0 when the area makes some of the item itself. The label shows that consumption in the current rate unit.
- **Areas are excluded by recipe, not by item.** The row's own area and any area with a row of the same recipe are left out, which matches the per-area duplicate rule; an area that makes the item with a different recipe is still offered.
- **The badge tooltip names the recipe**, not the item, because the badge counts rows of a recipe and the rows can have different primary products. The badge is display-only; **Go to row in…** in the row menu is the way to jump.
- **The new row does not copy the pin nor the byproduct-consumer flag.** A pin sized for another area is wrong there, and the flag would change the row's role. Recipe, machine, modules, beacon, byproduct policy and primary product are deep-copied, and the row is appended to the area sub-plan's own rows, not to nested organising groups.
- **The new row is revealed.** Build also in… and Go to row in… share one transient request (`uiStore.revealRowRequest`): the table expands the ancestors, scrolls to the row and highlights it for two seconds. A request is ignored if the row is not in the active block or was made before the table mounted. Nothing is persisted and the schema is unchanged.
- **Apply to every row copies machine and modules together** (the machine modal, "Default" included), and the beacon (the beacon modal). Removing a beacon is not propagated, since the modal is only open while a beacon exists. It is one undoable command and does nothing, with no history entry, when every other row already matches.
- **Collapsed-area chips are display-only and capped at four per direction**, then a "+N" whose tooltip lists the rest; selecting an item stays in the Areas pane.
- **The picker disables, `addNode` stays permissive.** Recipes with a row in the target area (the whole block without areas) are greyed out. Dragging a row, **Alternate recipe** and turning an area off can still create a duplicate, which the solver reports as `duplicate-recipe`.

Phase 3 follows the UI section, with these choices:

- **Areas are listed per block, never merged by name.** Each block has its own pool, so what an area receives or sends is relative to its block, and summing it across blocks would add flows of different pools. Every block has a "Top level", so merging by name would merge all roots, and a name is not an identity (renaming would silently merge or split). The filter box puts every block's "Compression" side by side instead.
- **The list is a modal opened from the top bar**, like the block graph, and only while some block's last solve has areas. It filters on block, area and item names, shares the item selection between blocks, and ends with the number of blocks without areas.
- **Clicking an area opens it**: the block becomes active, the table goes back to the tree view and reveals the area's sub-factory row, reusing the transient reveal request of phase 2 (the block switch comes first so the request is resolved against the new block's plan).
- **The by-recipe view is a global, persisted choice** (`uiStore.tableView`, like the rate unit), offered only in blocks with areas; any other block shows the tree. Which lines are open is local to the table and starts over in another block.
- **A recipe line totals its rows by R4**: the sum of each row's whole machines, with the exact count and the split by area in the tooltip. Lines follow the order of the tree, rows inside a line the order of the areas. A recipe with one row is shown as that row.
- **Rows keep the row menu** in the by-recipe view but not reordering or dragging, and show their area's name instead of the multi-area badge. Rows in a sub-plan without a handle count in the total but are not listed, as in the tree.
