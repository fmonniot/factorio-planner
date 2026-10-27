# Proposal: Areas as an overlay

Proposal for [Block granularity](../problem.md). Not chosen: [Areas in the solve](area-solve.md) was preferred (see [Decision](../problem.md#decision)). Not implemented.

Areas are a **plan-level layer** next to the blocks, not a kind of sub-factory. A block's table stays exactly the product chain, one row per recipe, solved as today. The player places work on the map by binding rows or sub-factories to an area (**Built in**), and by giving a row **parts** in other areas: a share of its work, a number of buildings, or what that area uses. An **Areas** view lists, per area and across every block, what is built there, how many buildings it takes and what comes in and goes out. The two questions of the problem get two views: the table answers *what does it take to make X*, the Areas view answers *where does each group of machines go*.

---

## Principles

- **The table is what you make, the Areas view is what you build.** The block table is never split by placement, so a product chain always reads as one table (R1). Placement lives in its own layer and its own view.
- **Places are not chains.** An area is a part of the map, so it is not owned by a block: the main bus can hold smelting from the Metals block and circuits from the Electronics block. A block can also live entirely in one area, or spread over several.
- **The player places, the planner sizes.** The planner never binds a row to an area or adds a part by itself (R6). A part's size is either a number the player typed or "what this area uses", which the planner computes.
- **Bookkeeping, not constraints.** Areas are read after the block solves and never feed back into them: rates, imports, exports, connections and the block's power are the same with or without areas (R4). Only building counts change, because each part is rounded up on its own.

## The model

**Areas.** A plan has a list of areas (`AppState.areas`), each with a name and a colour, created from the Areas view or from any **Built in** picker. Every block also has a **home area**: implicit, named after the block and in its colour. A plan without areas is a set of home areas, one per block, which is exactly what a block means today.

**Built in.** A sub-factory or a recipe row can be bound to an area. A row's area is the nearest binding: its own, else the nearest enclosing sub-factory's, else the root's, else the block's home area. Binding the root moves the whole block into a plan area ("this block is built on the main bus"). A sub-factory without a binding only organises the rows of its parent's area, so per group the player chooses between a separate area and organisation (R7), and nothing is an area unless the player says so. Whatever is not bound sits in the block's home area, the default area at the top level (R8).

**Parts.** A row can have parts in other areas. A part builds the same recipe, with the same productivity, in another place, and takes some of the row's solved work. The rest stays in the row's own area (the **remainder**). Each part has one of three sizes:

- **Local:** what its area uses of the row's primary product (`primaryProduct ?? mainProduct ?? first product`), net of what that area already makes of it. Covers "I build hydrogen next to plastics".
- **Share:** a fraction of the row's work ("half of it is built there").
- **Buildings:** a number of buildings, the size of the build that is already on the map. The part takes up to what they can run.

A part can use another machine, and other speed or efficiency modules and beacons, than its row (an early build and a later one). Productivity is always the row's: it sets the recipe's inputs and outputs per run, and those must not change with placement. A row has at most one part per area, and no part in its own area.

Example: block *Plastics & fuel* is bound to the area *Main bus*. Its plastics rows sit in a sub-factory bound to *Plastics*, its rocket fuel rows in one bound to *Rocket fuel*. *Hydrogen* is one row in the root, 13.6 electrolysers of work. The player gives it a local part in *Plastics* and one in *Rocket fuel*: they get 4.2 and 4.8 electrolysers, the remainder on the main bus 4.6. The row shows 15 buildings in 3 areas (5 + 5 + 5) instead of 14, and *Plastics* and *Rocket fuel* no longer receive hydrogen.

## Solver

The block solves (`solveAll`) are unchanged and do not read areas. A new pure step, `allocateAreas(blocks, results, areas, gameData)`, runs after them in `wireSolver` and produces an `AreaResult`. It runs per block, then gathers the ledger at plan level.

### Allocation, per block

For every row `n` with solved throughput `x_n`, its parts are sized in two steps.

1. **Fixed parts** (share and buildings), in part order, each capped by what the row has left: `p_k = min(fraction · x_n, left)` for a share; `p_k = min(count · runs per building, left)` for buildings, where runs per building comes from the part's machine and speed bonus (`craftingSpeed · (1 + speedBonus) · 60 / craftingTime`).
2. **Local parts**, all together in one small LP, because they depend on each other: a hydrogen part in *Plastics* uses water, and if water has a local part there too, its size depends on hydrogen's.

```
p_k ≥ 0                       each local part k, of row n(k), in area a(k), for item i(k) = n's primary product
e⁺_k, e⁻_k ≥ 0                what area a(k) still sends / receives of i(k)

r_n = x_n − Σ_{k of n} p_k ≥ 0                                    the remainder of each row with parts
Σ_{w in a(k)} S_{i(k),w} · runs_w − e⁺_k + e⁻_k = 0               each local part: its area balances its item
minimise Σ_k (e⁺_k + e⁻_k)
```

`runs_w` ranges over the block's work in the area: whole rows whose area it is, remainders whose row's area it is, and parts placed in it (fixed parts as constants, local parts as variables). `S` is the row's net coefficient per run, with productivity, as the block solve used it; a part carries every output and input of its row in proportion, byproducts included. As in [Sub-factory sites](sites.md#solver), there is one equation per local part, so the result is unique in practice, cycles are ordinary, and the slack absorbs what a part cannot balance. `e⁻` covers what the row cannot spare, because the block imports part of the item or the fixed parts took it. `e⁺` covers an area that makes more than it uses without the part, for example as a byproduct of other work there: the part then runs at 0.

**Machine counts.** `computeMachineMetrics` runs once per part and once for the remainder, each with its own machine and speed bonus, and each is rounded up on its own (R4). A row's building count is the sum. Power is summed from exact counts, so with the row's machine everywhere it is the block's power as today. A part on another machine changes the power and the building count, never the rates.

### Ledger, per plan

For every area and item, the ledger adds up the work placed in that area, across every block: what it makes minus what it uses. A positive balance goes out of the area, a negative one comes in (R5). Each entry keeps its breakdown by block, so *Main bus* can show that its iron plate surplus is from Metals and its circuit deficit is Electronics' own use.

Two tags mark where the plan meets the outside: **from outside the plan** (what the plan imports: raw resources and block imports) and **plan output** (block products and byproducts that no block uses). Connections between blocks are not ledger entries. They say which *chain* supplies which, while the ledger says what moves between *places*. When block B receives plates from block A and both are built on the main bus, the connection is still there, and the main bus ledger shows nothing for plates.

### Warnings

Area warnings go into `AreaResult`, not into the block's `SolverResult`, and are shown with the other warnings:

- `part-unused`: a local part whose area does not use its item (it runs at 0), or a fixed part left with nothing because earlier parts took the whole row.
- `local-duplicate`: two local parts for one item in one area of a block (two recipes making it). The second one runs at 0.
- `part-productivity`: a part whose machine cannot hold the row's productivity modules. It is still sized with the row's productivity.

## Scenarios

1. **Intermediate in three areas.** As in the example above: 4.2, 4.8 and 4.6 electrolysers in *Plastics*, *Rocket fuel* and *Main bus*, 15 buildings, and the *Plastics* and *Rocket fuel* ledgers have no hydrogen coming in.
2. **Rounding.** A row of 0.6 machines with a share part of one half shows 1 + 1 = 2 buildings. A local part sized at 0.3 gives the same. A **Buildings: 1** part takes all 0.6, since one building can run it, and leaves a remainder of 0: 1 building.
3. **Large factory.** Each product chain is one block, and its table is the whole chain (R1). The Areas view lists the 25+ areas of the plan. Each area has its build sheet (every row and part placed there, from every block) and its ledger (R5). An area that hosts work from six blocks is one entry, not six.
4. **Chained intermediates.** The hydrogen row and the water row each have a local part in *Plastics*. They are in the same allocation LP: the water part is sized for the hydrogen part and anything else in *Plastics* that uses water.
5. **Loops and byproducts.** Area *A* runs recipe *R*, which makes *X* as a byproduct, and has a local part of *X*'s row. The part makes only what *R*'s *X* does not cover, and runs at 0 if that is enough. A surplus of *X* goes out in *A*'s ledger. An area that receives *X* does not care whether it came from a byproduct or a dedicated row: the ledger is a balance. Loops are cycles in the allocation LP.
6. **Nested groups.** Sub-factory *Plastics* is bound to an area. Inside it, *Cracking* is bound to its own area and *Polymers* has no binding. *Polymers'* rows are in *Plastics*, *Cracking's* in their own area, and the ledgers show flows between *Plastics* and *Cracking* only, not to *Polymers*.
7. **Old plan.** A saved plan has no areas, bindings or parts. The block solves are the same code with the same inputs, so rates are unchanged. No row has parts, so building counts are unchanged. Each block is its home area, and its ledger is the block's net in and out, as the summary panes show today.
8. **One area, several chains.** *Metals* and *Electronics* both bind their root to *Main bus*. The *Main bus* build sheet lists both blocks' rows, grouped by block. Its ledger nets their flows: the plates Metals sends to Electronics through a connection stay inside the area.

## Data model

```ts
interface AppState {
  // …existing fields
  areas: Area[]                 // default []
}

interface Area {
  id: string
  name: string
  color: string                 // '#rrggbb', from the block palette rules
}

interface SubPlan {
  // …existing fields
  areaId?: string               // "Built in"; absent = the parent's area (the block's home area for the root)
}

interface GameRecipeNode {
  // …existing fields
  areaId?: string               // "Built in" for this row only
  parts?: RecipePart[]          // default []
}

interface RecipePart {
  id: string
  areaId: string
  size: { kind: 'local' } | { kind: 'share'; fraction: number } | { kind: 'buildings'; count: number }
  machineId?: string            // absent = the row's machine
  modules?: ModuleConfig[]      // absent = the row's; productivity modules are copied from the row
  beaconConfig?: BeaconConfig   // absent = the row's
}
```

- `fraction` is in `(0, 1]` and `count` is an integer `> 0`.
- A home area has no `Area` entry. Its id in `AreaResult` is the block's id.
- No migration. Absent fields mean no areas, and the schema treats a dangling `areaId` as no binding and drops a part whose area does not exist, so imported or hand-edited JSON still loads.
- `clonePlan` gives areas fresh ids and remaps every reference to them, like block ids in connections.
- `primaryProduct` is read by the allocation (local parts), not by the block solve.

## UI

- **Areas view.** A top-bar button opens a near-full-screen view, like the [block graph](../../../../../spec/ui.md#block-graph). The left column lists the areas (home areas first, in block order, then plan areas). Each area shows its in and out counts, and there is **New area**, rename, recolour and delete. The selected area shows its **build sheet**: every row and part placed there, grouped by block then sub-factory, with machine, buildings and exact count. Clicking a row opens it in its block. The **ledger** shows items in and out, each with its breakdown by block and the outside-the-plan tags, using the summary panes' slots and segment bars.
- **Built in…** on the sub-factory and recipe row menus: an area picker with **New area…** and **Not bound**. A bound group row shows an area chip in the area's colour. A bound recipe row shows a small chip on its icon.
- **Split badge.** A row with parts shows its building count as "15 · 3 areas". The tooltip gives the split: "15 buildings (13.6 exact): 5 Main bus, 5 Plastics (local), 5 Rocket fuel (local)".
- **Split popover**, from the badge or **Build also in…** in the row menu. It lists the row's own area (the remainder) and each part: area, size (Local / Share / Buildings), machine and result. **Add part** lists the areas that use the row's primary product, with how much each one uses, then every other area. The list helps choose and never adds anything by itself. A part's machine and module cells open the existing modals with productivity locked to the row.
- **Area filter** in the table header: *All areas*, or one area. With an area chosen, the table shows only the work in that area, at its own rates and building counts: whole rows, parts (marked as such) and remainders. Rows with nothing there are hidden. The block's chain stays one table, and the filter shows one area's slice of it.
- **Removing an area** that has bindings or parts asks first, naming the blocks it touches, then unbinds them and removes the parts. Like removing a block, it is not undoable, because it edits several blocks. Binding and part edits are undoable `Command`s in their block's history.

## Phases

1. **Areas and bindings.** `AppState.areas`, **Built in**, home areas, the ledger and the Areas view, with no parts yet. This is useful on its own: binding sub-factories and blocks to areas shows what moves between the places of an existing plan, across blocks, including the block-per-area setups players already use.
2. **Parts.** Share, buildings and local parts, the allocation, the split badge and popover, and the area filter.
3. **Machine variants.** Per-part machine, modules and beacons, and the `part-productivity` warning.

## Compared with the other proposals

| | Sub-factory sites | Areas in the solve | Areas as an overlay |
|---|---|---|---|
| What an area is | A sub-factory with a toggle | A sub-factory with a toggle | A plan-level entity; sub-factories, rows and blocks are bound to it |
| Areas across blocks | No | No (phase 3: matched by name) | Yes |
| Recipe in several areas | Copy rows in the table | Ordinary rows in the table | Parts of one row, outside the table |
| Table | What you build | What you build | What you make; the Areas view and the filter show what you build |
| Sizing | Local, after the solve | Local first, in the LP | Local, share or buildings, after the solve |
| Rates | Never change | Can change | Never change |
| Different machines per area | No | Yes, with productivity | Machine, speed and beacons; productivity stays the row's |
| Data model | `separateSite`, `RecipeCopyNode` | `area` | `AppState.areas`, `areaId` on sub-plans and rows, `parts` on rows |

## Decisions and rejected options

- **Areas are not sub-factories.** How a player organises a chain (by stage, by product) and where they build it (by place) are different groupings. Tying areas to sub-factories forces one tree to serve both, and keeps an area inside one block. Sub-factories can still be bound to an area, so the common case of "this group is built over there" stays one click.
- **Parts are not rows.** Rows in the table for each place (sites, area-solve) make the table the build, so the chain spreads over the areas it is built in. Keeping parts on the row leaves the table as the chain (R1). The area filter gives the per-area table when the player wants it.
- **Sizing after the solve.** Putting areas into the LP lets every part have its own productivity, at the cost of rates that move with placement. This proposal keeps R4 strictly and allows only the settings that do not enter the LP.
- **Fixed sizes next to local.** "What this area uses" covers building next to consumers. A share or a building count covers a build that already exists, or one sized for reasons the planner cannot see, such as a train stop that also serves another area. Both are numbers the player chose, so R6 holds.
- **A home area per block, not one plan-level default.** Blocks are already places in the plans players have made, so a plan without areas keeps its block boundaries as its area boundaries (scenario 7). One shared default area would merge every unbound block into one place.
- **Connections stay chain bookkeeping.** Replacing connections with area flows would mix the two questions again. Both are kept, and the ledger nets across them.

## Open questions

- **Local parts across blocks.** A local part is sized to its area's use *within its block*. When *Rocket fuel* (another block, built in *Chem park*) receives hydrogen from *Plastics & fuel* through a connection, a local hydrogen part in *Chem park* does not count that use: the ledger shows hydrogen coming in, and the player can use a buildings part instead. Counting it needs the consumer's received amount attributed to its areas, which is well defined only when the consumer makes none of the item itself.
- **Who ships to whom.** The ledger gives each area's net in and out, with a per-block breakdown, not routes. As in the other proposals, an item's senders and receivers can be listed as a pool, which is what planning train stops needs.
- **Home areas as entries.** Whether a home area can be renamed apart from its block, or merged into a plan area (today: bind the root).
- **Byproduct-consumer rows.** Their work follows another recipe's surplus, so a local part has no clear meaning. Phase 2 allows only share and buildings parts on them.
- **A plan-level "by area" summary,** such as a matrix of areas by items, for very large plans where the per-area list gets long.

## Backlog interactions

- *Prevent adding a recipe already present in the block* is unchanged: a recipe is still one row per block, however many areas build it.
- *Isolate a subfactory from the rest of the plan* is unrelated: binding a sub-factory to an area changes no rates.
- Spec updates when this ships: [spec/data-model.md](../../../../../spec/data-model.md) (`AppState.areas`, `Area`, `SubPlan.areaId`, `GameRecipeNode.areaId` and `parts`, `AreaResult`), [spec/solver.md](../../../../../spec/solver.md) (a new *Areas* section after the block solve, and `primaryProduct`), [spec/ui.md](../../../../../spec/ui.md) (top bar, Areas view, sub-factory and recipe rows, area filter), and the overview's non-goals as [problem.md](../problem.md#out-of-scope) notes.
