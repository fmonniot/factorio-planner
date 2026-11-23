# Block graph past 6–7 blocks

Status: Active

The [block graph](../../spec/ui.md#block-graph) is practically unreadable beyond six or seven blocks. A design artifact tried four answers on a real 15-block plan; the owner kept two (a tidier layout and a dependency matrix) and dropped two. This folder holds the findings, the decisions, the reference prototype and the tickets to build the two options in the planner. T1 (the tidy layout) has shipped; T2 (the matrix) has not started.

## The problem

From a screenshot of a plan with about 10 blocks, and confirmed on the 15-block plan below:

- The graph runs off the right edge with no fit-to-view, so the rightmost blocks and their labels are cut off.
- Edges that skip columns run as long lines across the whole graph, crossing unrelated blocks and each other.
- Flow labels (e.g. `0.39/s ≤`) float mid-edge and sit on top of other edges, so it is hard to tell which block a label belongs to.
- Several edges leave one block and fan out into a bundle; a few route around the right side of a block.

## Evidence: the real plan

[real-plan.layout.json](real-plan.layout.json) is the layout-only fixture: the 15 blocks of the owner's Seablock "middle ring" plan exported on 2026-11-22, with their 140 input connections (real ids and item ids, no rows). It is what the layout tests should use. The flows (rates, statuses) are not in it; `tools/extract-plan.mjs` produces them from a full export.

| Measure | Today | Option A (prototype) |
|---|---|---|
| Blocks / edges (one per source and consumer pair) / connections | 15 / 46 / 140 | same |
| Size of the graph | 3112 × 842 px, 9 columns | 2394 × 948 px, 8 columns |
| Edges running right to left (drawn along the bottom) | 11 | 6 |
| Forward edges that skip a column or more | 20 | 20 (routed through the gaps) |
| Edges collapsed to a summary chip | 10 | n/a (counts shown on hover) |
| Crossings | not measured | 55 |

Why 11 back edges today: the solver's loop handling picks Sciences as the entry of a loop (Sciences sends waste to Ores and sulfur to Sludge, which feed Metals, which feeds Sciences), so it lands in column 0 and every edge into it runs backwards. Choosing the ordering that leaves the fewest back edges puts Sciences at the right and leaves 6.

Five blocks (Paper & Charcoal 8 edges, Sludge 7, Bio Plastic/Resin 7, Metals 6, Ores 6) are the source of 34 of the 46 edges. Removing them from the graph leaves 8 edges and 1 crossing. That was option D's idea; the owner dropped it, but the figure says where the clutter comes from.

## The artifact and what was decided

Design canvas (private to the owner): <https://claude.ai/artifact/R7ruND9hbSoRMyZNZVrtay>. Its source is in [artifact/project/](artifact/project/): `Main.dc.html` (today's layout, as the app draws it), `A-Tidy.dc.html`, `C-Matrix.dc.html`, with the data in `graph-data.js` and helpers in `graph-lib.js`. `graph-data.js` also still holds the two hub-rail layouts of the dropped option D; nothing reads them.

| Option | Decision | Note |
|---|---|---|
| A. Tidy layout | **Keep** | Same left-to-right graph, laid out properly. Fit-to-view only (no 100% mode, no "show every count" switch). |
| B. Focus lens (one block and its neighbours, rest in a strip) | Dropped | The owner is not interested. |
| C. Dependency matrix (rows supply, columns receive) | **Keep** | Dependency order or plan order; a cell lists the items. |
| D. Hub rails (busiest suppliers as rails along the top) | Dropped | The owner is not interested. |

The only change the owner asked for after trying the two: **show the item's icon in front of its name** wherever an item is listed (option A's detail strip and option C's side panel). The prototype has no icons; the app has them, so this is a requirement for the tickets, not a design question.

### What option A is

- **Ordering.** Blocks are ordered to minimise back edges (the prototype uses the Eades-Lin-Smyth heuristic followed by local moves; ties by plan order). An edge is a back edge when its source comes after its consumer in that order.
- **Columns and rows.** Column is the longest path over the forward edges. A forward edge that skips columns gets one dummy vertex per skipped column, so it is routed through the gaps between blocks instead of across them; rows come from 24 barycenter sweeps plus a transposition pass, then a barycenter relaxation with minimum gaps.
- **Ports.** Edges leave and enter a block spread along its right and left sides, not all at the middle.
- **Edge weight and colour.** Line width grows with the number of items on the edge; colour is the source block's, amber when limited, grey when unused (as today). Back edges are dashed and run along the bottom.
- **Labels only where you point.** No chips by default. Pointing at (or focusing) a block lights its edges and dims the rest; pointing at an edge lights it; a count badge sits on the lit edge next to its consumer.
- **Detail strip.** A strip under the graph, so nothing floats over it: for a block, two columns headed **Receives from** and **Supplies** (block, item count); for an edge, one column headed **Items on this edge** (item, rate, `existing`, `limited`, `not used`). The headers are always on the top line.
- **Fit.** The graph is scaled to fit the board, no pan or zoom. At 15 blocks that is about 0.46, so block names come out around 6 px: accepted, see decision 3.

Reference implementation: `tools/layout-prototype.mjs` (a throwaway, run on the data from `tools/extract-plan.mjs`).

### What option C is

A grid with one row per supplying block and one column per consuming block (15 × 15 here; 46 cells filled). A filled cell shows the item count, tinted in the supplying block's colour (stronger with more items), an amber ring when a connection is limited, a dashed ring when every connection is unused. The diagonal is hatched. **Dependency order** (the layout's ordering) puts forward edges above the diagonal and loops below it, marked `↻` and hatched; **Plan order** is the order of the tabs. Pointing at a cell cross-hairs its row and column; clicking it lists the edge's items in a side panel. Row headers carry the number of blocks supplied, column headers the number of blocks received from.

## What the prototype does not cover

The tickets must build or decide all of these:

- **Item icons** (the owner's request).
- **Editing.** The app's chips have a limit control and a `×` that removes the connection, and a block could start connect mode from its `→` handle (removed in T1). The prototype lists items read-only.
- **Loop status text** (`↻ N loops`, "did not settle") and the loop chips' `↻` prefix.
- **Request and take chips**, the `#N` served-order tag, ignored-request reasons and the other chip titles in [spec/ui.md](../../spec/ui.md#block-graph); the strip lists them only as `existing` / `limited` / `not used`.
- **Clicking a block makes it active and closes the graph.** Option A's click pins the highlight instead; T1 does that and adds a **Go to** button on each block.
- **Keyboard access to edges.** Blocks are buttons in the prototype; edges are reachable by pointer only.
- **Fluid temperatures** in the item lines.
- Real tooltips (the app uses `TooltipLayer`, not the native `title`), light theme, and graphs with areas.

## Decisions

Settled with the owner on 2026-11-22. They replace the open questions of the first draft.

1. **Back edges are the layout's.** The layout computes its own back-edge set, for drawing only, with the ordering that leaves the fewest; the solver and its loop entry are untouched. `data-loop` keeps meaning "member of a loop" (solver); `data-back` means "drawn right to left" (layout). The spec's Layout and Loops bullets change wording. T1 first checks that nothing else reads `BlockEdgeLayout.back` as the solver's notion (today only `BlockGraph.tsx` and its test do, for `data-back`).
2. **Limit and remove live in the detail strip of a pinned edge.** Every edge of the tidy layout gets a summary chip (`graph-edge-summary`, the count badge and keyboard stop); clicking an edge, its chip or a block pins it, and the strip under the graph shows the pinned edge's connections as the existing chips with the limit control and `×`. There is no popover. Clicking a block no longer opens it: a **Go to** button on each block does, and the `→` connect handle and connect mode are gone (a connection is made from the consumer's Ingredients slot).
3. **Text at fit is accepted.** The graph always fits the modal, at about 0.46 on the 15-block plan (block names about 6 px); the detail strip carries the readable text. Revisit only if a real plan shows it failing; the fallbacks would be a minimum scale with scrolling, or a semantic zoom.
4. **The matrix is a second view in the Block graph modal.** A **Graph | Matrix** switch in the modal's header, not a new top-bar button. T2 reads the areas matrices in [spec/ui.md](../../spec/ui.md) first and reuses what fits.
5. **The player picks the view, and it is remembered.** The modal opens in the view used last, stored with the other UI state; no automatic switch by block count.

## Tickets

Strictly in order; the second reuses the first's ordering.

### T1. The tidy layout in the planner

**Done.** Shipped in the pull request that moved this initiative to Active. Two tests read `real-plan.layout.json` by its path under `initiatives/block-graph-scale/` (`src/utils/blockGraphLayout.test.ts` and `e2e/block-graph-scale.spec.ts`): fix both paths when the initiative is archived. The ordering measured on the fixture leaves 6 edges running right to left.

In `src/utils/blockGraphLayout.ts` (and `BlockGraph.tsx` for what it draws):

1. The ordering, layering, dummy vertices, crossing minimisation and row placement of the prototype, deterministic (ties by plan order), keeping `layoutBlockGraph`'s role. Carry the ports and the routed edge paths in `BlockEdgeLayout`.
2. Layout tests against [real-plan.layout.json](real-plan.layout.json): at most 6 back edges, no two blocks overlap, every edge point lies in a gap between blocks, same input gives the same output, plus a case where a loop's entry is not the first block (the Sciences case). Keep or update the existing synthetic layout tests.
3. Fit-to-view: scale the graph to the modal, no pan or zoom.
4. Hover and focus lighting, edge weight by item count, the detail strip with item icons, and a summary chip on every edge (decision 2).
5. Update [spec/ui.md](../../spec/ui.md#block-graph) (Layout, Edges, Loops) and the e2e specs for the block graph (`e2e/block-graph*.spec.ts`).

Done when the 15-block fixture opens with every block and label visible and no edge runs across an unrelated block.

### T2. Dependency matrix view

A **Graph | Matrix** switch in the Block graph modal's header (decisions 4 and 5: remembered with the other UI state) and the **Matrix** view as described above, in dependency or plan order, with the cell panel (items, rates, status tags and icons) and the editing controls the chip list already has. Unit tests for the cell model (counts, status, loop cells); an e2e spec on the fixture; [spec/ui.md](../../spec/ui.md#block-graph) section.

Done when a 15-block plan can be read as a matrix with no horizontal scroll at 1280 px, and a limit set from a cell shows in the graph.

## Rebuilding the artifact data

On a machine with the owner's full plan export (not in the repo):

```sh
node initiatives/block-graph-scale/tools/extract-plan.mjs <plan.json> <out-dir>     # data.json, fixture.json
node initiatives/block-graph-scale/tools/layout-prototype.mjs <out-dir>             # graph-data.js
```

`graph-data.js` rebuilt this way from the 2026-11-22 plan is byte for byte the one in [artifact/project/](artifact/project/). Publishing changes to the canvas needs the Design artifact tooling, not this repo.
