# Initiative: One Factory overview for graph, matrix, power and areas

Status: Shipped

The areas modal is merged into the block graph modal, which becomes the **Factory overview**: one place to inspect what is going on across the plan. It follows [archive/power-overview/](../power-overview/plan.md), whose plan left "where Power sits with areas" open.

---

## Decision

- **A fourth view, Areas**, between Matrix and Power (the switch reads Graph, Matrix, Areas, Power). The top bar loses the **Areas in every block** button; the Areas view shows only while some block has areas, and a stored choice of it falls back to the graph when none does.
- **The modal is renamed** "Factory overview" (heading and top-bar button), since it is no longer only the block graph.
- **One header for every view**: the title, the View switch, Close, and the Power figures in the Power view. A view's own controls sit in a row under it (`ViewToolbar`), so switching views changes that row and nothing above it. The graph's legend and loop status moved there from the header; the Areas view's controls are there too.
- **A block picker instead of one pill per block.** The Areas view's block choice is a button with the chosen block's colour, name and area count, previous and next buttons, and a searchable list with **All blocks** first. A row of pills was drawn and rejected: with 9 of 15 blocks having areas it either wraps the header to three rows or scrolls sideways past what is visible.
- **The Areas view keeps its state across a switch of view** (block, row and column modes, filter, focus, open groups), held by the modal like the Power list's open rows; closing the modal resets it.
- **Links between views.** **Areas of <block>** in the graph's strip for a lit block, and an **Areas** button on a Power block row, open that block in the Areas view. Both show only for blocks that have areas.

## Design reference

The design canvas "Factory Overview Header" (https://claude.ai/artifact/5Jp3N2C7Q5fEAkhFUPt26P, private to the owner's account) compares the sub-toolbar with pills (B) and with the picker (C); C was chosen. A third board, with every control inline in one row as the old areas modal had it, was dropped because it made the Areas header differ from the other three views.

## Not done

- **A shared selection.** The canvas let a block pinned in the Graph carry over to the Matrix and Power views as a highlight. The built views each keep their own selection; the two links above are the only carry-over.
- **A Power-by-area split** is still open.
