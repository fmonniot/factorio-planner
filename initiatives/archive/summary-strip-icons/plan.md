# Summary strip: icon actions

Status: Shipped

The detail strip under each summary pane holds too much when an item is selected. In Products and Byproducts the actions are text buttons on one 22 px row that never wraps, and they run under the next pane (177 px past the edge at a 413 px pane in Products, 233 px in Byproducts at 260 px). In Ingredients the strip stacks seven lines (header, bar, actions, Comes from with its presets and Import, Leftover alone, Sources… alone, the sentence) and is never shorter than 156 px: 194 px at 413 px, 227 px at 260 px. The design replaces the text buttons with one icon toolbar pattern shared by the three panes, and folds the Comes from block into that toolbar. The design is done and judged; It shipped in three pull requests (T1 the toolbar, T2 the Ingredients strip, T3 the documents, which also archived this folder).

## The design

The design is the spec page in [artifact/index.html](artifact/index.html). Open it in a browser (it is one self-contained file; the fonts come from Google Fonts and fall back to system fonts offline). It holds, in order: the decisions, the shared pattern, a replica of each pane at the four pane widths the layout produces (260, 333, 413 and 467 px) with today's layout one click away, the control tables (visibility, accessible name, tooltip, behaviour, test ids), the icons with their path data, the open decisions, the implementation notes and the acceptance checks. A private published copy exists at <https://claude.ai/artifact/SePinjLsdKwVzn64ztHUaW>; the repository file is the one to keep in step.

[check-artifact.mjs](check-artifact.mjs) turns every claim of the page into an assertion (overflow at each width, the order and names of the controls, one icon per action and one action per icon, the served order popover, the measured heights). Run it from the repository root after any edit of the page: `node initiatives/archive/summary-strip-icons/check-artifact.mjs` (add `--channel chrome` to use an installed Chrome instead of the Playwright Chromium).

Decided on 2026-11-23, in short:

- **One pattern.** Every selected strip has one 22 px row of 24 × 22 icon buttons, 4 px apart, no text labels, never wrapping. The left cluster is how the item is made or supplied (Find recipe, Receive from…, Add consumer recipe…). After a flexible spacer comes information first (Served order…, Sources…), then changes to the block, the most destructive at the far edge (Remove product, Make it a product). An action has the same icon in every pane and no icon means two things.
- **Products and Byproducts** keep their 72 px strip. Ingredients becomes header, bar, the sentence (two lines at most), then the toolbar with the rule group (three preset icons, Import, Leftover) in the middle, and no minimum height: 93 px at 413 px, 108 px at 260 px.
- **Unchanged:** the served order popover (only its trigger becomes an icon), the right-click menus, the slot grid, the bars, and every accessible name, `data-testid` and handler.

## Open decisions

Each has a default the implementer can build; see the page's section for the options.

1. **Touch.** `TooltipLayer` never opens on touch, so the icons have a name but no visible label on a phone. Default: ship it that way and solve it with [Hover-only UI on touch](../../backlog.md), which already covers `IconButton` tooltips.
2. **Legibility of some icons** (Make it a product, Use it all here, Leftover, the two arrows). Default: keep icons; if one reads badly, change that icon or give that one action a text label in every pane that has it.
3. **Conditional rows of Comes from** (takers note, "N areas have their own rule", rules with no effect). Default: keep them as text rows under the toolbar, adding height only when present (151 px at 413 px and 193 px at 260 px in the worst case).

## Tickets

- [x] **T1: shared toolbar, Products and Byproducts.** Built: `StripToolbar.tsx` and `StripIcon.tsx`; Ingredients' Find recipe and Receive from… already use it, the rest of its strip is T2. The Extra output control is now the Add extra output / Remove extra pair (accessible name `Add extra output`, was `+ Extra output`). One icon-toolbar component (side, icon, name, tooltip, badge, danger, disabled through `TipWrap`) used by `SummaryDetailStrip`; `actionsFor` of the two panes in the order of the pattern; the Extra output control moves from `renderKeyExtra` into the toolbar. Accessible names, ids and handlers unchanged. Add a pane-width e2e check for the no-overflow rule.
- [x] **T2: Ingredients strip.** Built in `ComesFrom` (the `listInPopover` usage) with `StripToolbar`'s `middle` slot; the popover keeps its text layout. `tall` stays, now meaning "content-sized while selected, and holds the measured height in a preview"; the other panes' grids grow with `min-h-full` instead of `max-h-[181px]`. The sentence under the bar, the toolbar with the rule group, the conditional rows, no `min-h-[156px]`. `ComesFrom` keeps its text layout in the Comes from popover (add a flag or split a row component). Re-derive or drop the `tall` prop and the `max-h-[181px]` growth of the other panes' grids (the strip now grows 21 to 36 px, not 84 px). Review the unit and e2e tests that query by visible text.
- [x] **T3: documents.** `spec/ui.md` (the Detail strip paragraph, the Products and Byproducts action lists, Comes from, the chip tooltips paragraph) and the README's "Using the planner" if it names the buttons. Archive this folder when T1 and T2 have shipped.

Related backlog items, left where they are because they are broader: [Instant tooltips on the last native `title`s](../../backlog.md) (the new icons use `data-tip` from the start) and [Hover-only UI on touch](../../backlog.md).
