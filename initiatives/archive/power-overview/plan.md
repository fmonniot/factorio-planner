# Initiative: Power across every block

Status: Shipped

Design decision for a plan-wide view of electric power, now built (see `spec/ui.md`, Block graph). It follows [archive/power-generation/](../power-generation/plan.md), which lets a block make power.

---

## Problem

Each block's toolbar totals the power of its own rows (`block-power-total`). Nothing adds the blocks together, and nothing compares that total with what the power plant block makes. A player who plans a power plant has to open every block, add the figures by hand, and set the plant's Electricity goal from the result.

## Decision

A third view, **Power**, in the block graph modal, next to Graph and Matrix. The top bar keeps the existing block graph icon; no new button is added. It was chosen over three other designs (a separate ⚡ button with its own modal, an indicator in the top bar, and a treemap); the reasons are under [Not chosen](#not-chosen).

The view has two parts.

- **A list** of the demand, with two modes picked by a segmented control. *By block* lists the blocks by power, biggest first; a block expands to its groups, and a group to its recipes. *By recipe* lists every recipe of every block by power, with a filter on the recipe or block name. Each line shows the machine count, a bar, the power and its share of the whole factory's demand.
- **A gauge** on the side comparing demand with generation. Demand is one column stacked by block colour, generation is a second column, and a dashed line marks the demand level across both. A shortfall is hatched amber on the generation column; spare power is a dashed teal box.

The modal header carries the three figures: demand, generation and the balance ("4.3MW short" or "spare").

## Design reference

The view was built as an interactive page, and the page is the reference for layout, spacing, colours and behaviour. Build from it rather than from the description above.

- **Where:** the design canvas "Factory Power Overview", https://claude.ai/artifact/RYyoSMjztgQkvTbLXM8ywV (private to the owner's account), board **D · Power list in the block graph**. Read its source with the Artifact tool's `read` action and `path: project/GraphPower.dc.html`; the file holds the markup, the styles and the logic in one place. Boards A and B on the same canvas are designs that were not chosen.
- **Copy from it:** the list's columns and row heights, the expand and collapse behaviour, the By block and By recipe modes, the filter, the gauge (column positions, the dashed demand line, the hatched shortfall and the spare box), and the header figures.
- **Do not copy:** the made-up blocks, numbers and icons, the fake top bar behind the modal, and the Graph, Matrix and Close buttons, which do nothing on the page. The real modal already has those.
- **Colours and sizes** on the page are written against the app's own palette (gray scale, teal accent, cyan power text). Where the app already has a component for the same thing (`Modal`, `SegmentedControl`, the block colour dot), use the component and keep the page's spacing.

## Where the numbers come from

- **Demand** is the sum of `powerKw` over the solved nodes of every block, which is what the toolbar total already sums for one block. A group's figure is the recursive sum the group row already shows.
- **Generation** is the Electricity (`power:electricity`) the blocks make, from the solved nodes' `outputRates`, converted to kW (1 unit is 1 MJ, so units/min x 1000 / 60). It is the gross output, not netted against anything.
- Demand is summed over a block's flat `result.nodes`, exactly like the toolbar total, so the two always agree; the list's groups and recipes come from walking the block's tree.
- The view reads the last solve of each block and is read-only, as the areas modal is.

## Depends on

- **Beacon power** is counted in a row's power (see `spec/solver.md`), so beaconed blocks are not low. The one gap left is the Nullius bundle, which has no beacon energy use (see the backlog), so beaconed Nullius rows read low.

## Not chosen

- **A separate ⚡ button with a ledger modal.** Same list, with a headroom picker and a "Set the Power plant goal" action. Dropped in favour of putting the list where the other whole-plan views already live.
- **An indicator in the top bar** (icon with a status dot, or a `demand / generation` pill). Liked for being quick to read, but not wanted in the top bar for now. Its popover and the per-block "share of the factory" line in the toolbar are still good ideas if the top bar is revisited.
- **Electricity as an ingredient of every block**, connected to the power plant like any item, so the plant's goal follows its consumers. Dropped for now: it turns consumption into a solver quantity (it is computed after the solve today), with loops through the plant's own machines.
- **A treemap** of power by block, group and recipe. Replaced by the list.

## Decisions

- **Read-only.** The view has no "set the Power plant goal" action and none is planned. To change what the plant makes, edit its block.
- **Where Power sits with areas.** The owner is thinking of merging the areas modal into the block graph modal. Where Power sits then, and whether it should also split by area, is not part of this initiative.
