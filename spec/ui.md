# UI

The app is a single screen built around a production table. There is no router
and no backend: all state lives in Zustand stores and the browser.

Components live in `src/components/` (shared pieces and pickers) and
`src/components/factory/` (the screen itself). This file names the component
behind each feature so you can find it.

---

## Startup

`src/main.tsx`, in order:

1. Restores the rate unit (`loadPersistedUiState`, `src/store/uiStore.ts`). The
   plan is not loaded yet: it belongs to a game data set, which is only known once
   data has loaded (see [Game data set](#game-data-set)). Until then the
   table shows "Load game data to begin", the summary strip is hidden and the block
   tabs are disabled, so no edit can land in the wrong plan.
2. Starts auto-saving (`initAppStatePersistence`, `src/store/persistence.ts`) on
   every change, and subscribes to the game data store so the data set's active plan
   is swapped in when a data set finishes loading.
3. Wires the solver (`wireSolver`, `src/store/solverStore.ts`): any change to the
   block store or the game data schedules a re-solve after a 150 ms debounce; only
   blocks whose plan, supply or game data changed are solved again, the others keep
   their previous result. A block with nothing to make (no product with extra output and no request) or no recipe nodes gets an empty
   result without calling the solver.
4. Mounts `FactoryShell`.

Game data is not loaded at startup unless a dataset was chosen in an earlier
session (see [Game data set](#game-data-set)).

---

## Layout

`FactoryShell` stacks three regions full-height:

```
┌ TopBar ──────────────────────────────────────────────────────────────────┐
│ [▣ Plates][▣ Gears] +                                  ⚑  ⊞  ⚗ │ [≡ Main base ▾] │
├ FactorySummary ──────────────────────────────────────────────────────────┤
│ ┌ PRODUCTS · 1       [+]┐ ┌ BYPRODUCTS · 1 ─────┐ ┌ INGREDIENTS · 2 ────┐ │
│ │ [slot 58▼] [slot ]    │ │ [slot 12 ] [slot ]  │ │ [slot 30 ] [slot ⊘] │ │
│ │  ▂▂▂▂▂▂    micro-bars │ │  ▂▂▂▂▂▂             │ │  ▂▂▂▂▂▂             │ │
│ ├───────────────────────┤ ├─────────────────────┤ ├─────────────────────┤ │
│ │ detail strip: overview│ │ overview / preview /│ │ [→ B 40 · 2][Imp. 5]│ │
│ │ bar, or the selected  │ │ selected slot with  │ │                     │ │
│ │ slot's bar, actions   │ │ bar and actions     │ │                     │ │
│ └───────────────────────┘ └─────────────────────┘ └─────────────────────┘ │
├ ProductionTable ─────────────────────────────────────────────────────────┤
│ [+ Recipe] [Filter…] [/min /sec]          9 recipes · 35 machines · 7.2MW │
│    │ Recipe │ Machine │ Beacons │ Products │ Byprod. │ Ingr. │ Power     │
│ ▲▼ │ ▶ ▣ Smelting   3 recipes · 5 machines                               │
│ ▲▼ │ [icon] name │ [m 4][2/4] │ [+] │ [..] │ [..] │ [..] [..] │ 3kW      │
└──────────────────────────────────────────────────────────────────────────┘
```

The side panel appears to the right of the table only while a row is selected. The layout supports viewports from 360px wide; 768px and up is comfortable. It is CSS with two breakpoints (plus one media query in JS, `useNarrowTable`, which changes the production table's columns below `md`, see [Narrow screens](#narrow-screens)): `md` (768px) sets the density of the chrome and the shape of the summary strip, and `xl` (1280px) decides whether the side panel sits beside the table (from `xl`) or floats over it as a drawer (below). The shell is `h-dvh` with clipped overflow, so no region may grow wider than the viewport: the production table scrolls inside its own wrapper (`overscroll-x-contain`) and the summary strip scrolls inside itself. Hover-only and right-click-only interactions have no touch alternative yet (see the backlog).

---

## TopBar

`TopBar.tsx` (`factory/`) is one row, 44px high. On the left are the block list button and the block tabs (a scrolling strip; see [Block tabs](#block-tabs)). On the right
are, in order, the icon-only tool buttons (**Add block**, a 32px `+` with the same gray-300 icon, tooltip and spacing as the others, disabled until game data is loaded; the [horizon](#research-horizon)
flag, the [block graph](#block-graph), the [areas in every block](#plan-areas) button,
shown only while some block has areas and the [tech tree](#technology-tree)), a divider
(shown only
when game data is loaded, like the tools) and the [workspace menu](#workspace-menu), which also carries the
[in-game viewer](#in-game-viewer) connection. The root
carries `data-testid="top-bar"`. From `md` (768px) the workspace button has no fill and no border, is 32px high like the tool buttons and a fixed 132px wide (its text lines, including Loading… and Error loading data, truncate with an ellipsis rather than wrap), with a native `title` that starts with the plan name, with the tool buttons' fill on hover and focus. Below `md` the gaps are tighter and it stays the compact button (36px high, filled and bordered, 64px wide) that shows only its icon and status dot (its accessible name still carries the plan name); the block tabs strip scrolls.

The rate unit is switched from the [table toolbar](#table-toolbar)'s `/min | /sec` segment; the top bar has no rate control of its own.

The tool buttons are `IconButton` (`IconButton.tsx`): 32px, borderless, `text-gray-300` icons (3:1 on the top bar), with a CSS-only tooltip
(shown on hover and keyboard focus, `aria-hidden`, equal to the button's accessible name). The
glyphs come from `icons.tsx`, a set of small stroke SVG icons for the UI chrome (the game images
are `Icon.tsx` / `TechIcon.tsx`).

### Plans

The plans (a "plan" is everything for one game data set: the block tabs, their contents and the
horizon) are the first section of the [workspace menu](#workspace-menu); `usePlanSection`
(`PlanMenu.tsx`) renders it and owns its dialogs. The section appears once a data set is active
and holds:

- a "Plans" heading and a group of one radio item per plan of the loaded data set, the active
  one checked; picking one switches to it;
- a row of four action tiles, **New**, **Rename**, **Duplicate** and **Delete** (accessible
  names `New plan`, `Rename plan`, `Duplicate plan`, `Delete plan`), which act on the active plan.
  The plan radio items and the tiles are disabled until game data has loaded.

Plan state lives in `plansStore.ts` (plan list and active plan) and the actions in
`persistence.ts`.

- **Default names.** A first visit starts with "Plan 1"; **New plan** adds an empty plan named
  "Plan N" (N is the plan count plus one, increased until the name is unused). No name is asked
  for. Names need not be unique.
- **Rename** opens a dialog with a "Plan name" field, pre-filled and selected; Enter or
  **Rename** saves, Escape or **Cancel** closes it, and **Rename** is disabled while the trimmed
  name is empty. Names are trimmed and cut to 60 characters. (Renaming a block tab still uses
  `window.prompt`.)
- **Duplicate** copies the active plan right after it, named "<name> (copy)", and makes the copy
  active. Every block, sub-plan, node, goal and connection in the copy has a fresh id (the
  solver results and undo history are keyed by block id), with connections and the active block
  pointing into the copy.
- **Delete** asks "Delete plan "<name>"?" (the block count, that it cannot be undone and to
  export first; plus "An empty plan replaces it." for the only plan) with **Cancel** and
  **Delete plan**. Deleting the active plan activates the next one (else the previous one).
  Deleting the only plan is allowed and leaves an empty "Plan 1".
- Creating, duplicating and switching save the current plan first, so nothing is lost, and
  clear the undo history. The active plan is remembered per data set and restored on the next
  visit; each data set has its own list. See [Game data set](#game-data-set) for storage.
- **Several tabs.** Plans created, renamed or deleted in another tab show up in the list without
  a reload; each tab keeps its own active plan, unless another tab deleted it, in which case the
  tab switches to the neighbouring plan. Editing the same plan in two tabs is last write wins.

### Block tabs

`BlockTabs.tsx`. One folder-style tab per block, sitting on the top bar's bottom border. The
**active** tab shows the icon of the block's first goal (none when it has no goal) and the block's
name, truncated when long. Every **inactive** tab is its icon alone, 44px wide (a block with no goal
or an icon that fails to load shows the first letter of its name instead); its accessible name is the
block's name (`aria-label`), and the name is shown in a black tooltip (the box the tool buttons use,
`TOOLTIP_BOX_CLASS` in `IconButton.tsx`) on hover and on keyboard focus, not as a browser `title`.
Focus left by a mouse click does not show it, and the active tab has none. The tooltip is a fixed-position portal anchored below the
tab, since the scrolling strip would clip an absolute one, and centred on it, then shifted to stay 8px inside the window using its measured width (a name wider than the window ends in an ellipsis); it closes when anything scrolls, when the window is resized, when the tab turns active and when a
drag or the context menu starts. A stripe in the block's colour runs across the top of each tab, 3px
high: full strength on the active tab, 85% on the others. The colour stays off the icon so item icons
keep their own colours. The active tab also has a raised background and border and carries
`aria-current`.

The tabs sit in a horizontally scrolling strip (`block-tab-strip`): the active tab is at least about
6rem wide and at most `max-w-44`, where a longer name truncates (tabs never shrink); the strip scrolls
with the mouse wheel (line and page wheel modes are converted to pixels) when the tabs do not fit; its
scrollbar is hidden. The active tab is scrolled to the middle of the strip when it changes, is added or
moved (when everything fits there is nothing to scroll). Before the first tab sits the **block list**,
a 28 × 28 icon button (a list glyph, `aria-label` "All blocks", the same black tooltip) that is always
visible, whether the tabs fit or not: it opens a menu with one radio item per block (colour dot, icon,
name; the active one checked), and choosing one activates that block and scrolls its tab into view.
Escape closes it and the tooltip steps aside while it is open. It is a navigation aid only, not a
reorder surface. The add-block button is not part of the strip: see [TopBar](#topbar).

- Click a tab to make that block active. Only the active block is shown, but
  every block is solved on each edit (blocks can feed one another; see
  [Ingredients pane](#ingredients-pane)).
- The **Add block** tool button (`AddBlockButton`, in the top bar's tool row) adds a new empty block named "Block N" and activates it. Every block has a
  display colour ([data-model.md](data-model.md#block)); a new block gets a random
  palette colour, preferring one no other block uses. A block can also be created by
  **Make in a new block…** in the [Ingredients pane](#ingredients-pane)'s menu (named after the item, appended last).
- Drag a tab onto another to reorder the blocks: a blue line shows the insertion point on the half of
  the tab under the pointer (no line where a drop would not move anything), and the dragged tab is
  dimmed. The strip scrolls when the pointer nears its left or right edge. The active block stays
  active, whichever tab moves. The order is the order of `blocks` in the plan and is saved with it;
  like the other block actions it is not undoable. Known limitations: some Firefox versions may not
  start a drag from a button inside a draggable ancestor (Mozilla bug 568313), so use **Move left** /
  **Move right** in the context menu there; Safari reports no `relatedTarget` on `dragleave`, so the
  drop line may flicker when crossing between a tab's children.
- Right-click a tab for a small menu, rendered in a portal at fixed position so the strip does not
  clip it (it closes on Escape, outside click, scroll and window blur): **Rename** (browser prompt; the only way to rename a block), **Duplicate**,
  **Move left** / **Move right** (the keyboard-free alternative to dragging; disabled on the first / last tab) and **Delete**,
  plus a **Colour** grid of the 16 palette swatches (the current one is ringed; the store accepts any `#rrggbb`, the UI offers the palette).
  Picking a swatch sets the block's colour and closes the menu; several blocks may
  share a colour, and like the other block actions it is not undoable.
  Duplicate copies the block as "<name> (copy)", inserts it right after the
  original and activates it, with a new colour (never the original's). Goals, recipes, sub-plans and input connections
  are copied with fresh ids; connections from other blocks reading the original
  are not. Like add, rename and delete, it is not undoable.
  Delete is disabled when only one block remains; deleting the active block
  activates the first remaining one.
- All of the above, including dragging, the block list and **Add block**, are disabled unless game data is loaded (not while it is empty,
  loading or failed to load).

### Block graph

`BlockGraph.tsx`. The **Block graph** icon button (a three-node graph glyph; hidden until game data is loaded) opens a
near-full-screen modal showing every block and the connections between them, like the
[technology tree](#technology-tree) but without pan or zoom: the viewport scrolls natively.

- **Layout** (`src/utils/blockGraphLayout.ts`). A block's column is the longest chain of
  sources feeding it (sources on the left), not counting the *back connections* of loops (see
  [solver.md](solver.md#loops)), so every other edge runs left to right and every back edge right to left; rows follow one barycenter pass (the mean row of a
  block's sources, ties by plan order). Positions are recomputed on every change and never saved.
- **Nodes.** Block name, first goal icon (or `?`) and up to four goal icons plus `+N`. The active
  block has a teal ring. A 3px stripe across the top of the node shows the block's colour
  (`Block.color`) at full strength. Clicking a node makes that block active and closes the graph.
- **Edges.** One curve per (source, consumer) pair, coloured by its connections' status (limited,
  then ok, then not used). An ok edge is stroked, and its chips
  bordered, in the *source* block's colour, matching the source segment on the consumer's bar;
  the other statuses keep their status colours (limited stays amber). The legend's OK swatch is
  a multi-colour gradient with the title "In the source block's colour". Each connection is a chip:
  item icon, delivered rate (`—` before the first solve), the limit control and `×`, which removes the
  connection at once. The limit control reads `≤` (no limit) or `≤ N` and opens an inline number
  input (display unit); Enter or blur commits, an empty field clears the limit, Escape cancels
  without closing the graph. A chip held back by its limit has the title "Limited by this
  connection's limit of N". There is no pull toggle: whether a connection is a [request](solver.md#requests) follows from the source's products. A chip carries `data-kind="request"` or `"take"` (absent before the first solve); a take chip, including an ignored request, also shows a small `existing` tag after the item name (`graph-edge-existing`; none before the first solve). A chip also carries, when when the source has the item as a product but the request is not applied, `data-request-ignored` with the reason. A request chip's title ends " — requested: <source> makes N/m for <target>"; an ignored request ends " — taken as existing: " and the reason: the requests around this loop do not settle, the source receives the item itself, or an earlier connection already takes the item from the same source (the connection then takes existing output).
  An edge with more than three connections (`MAX_EDGE_CHIPS`) shows one **summary chip**
  (`graph-edge-summary`) instead of one chip each: the first three item icons, `+N` for the rest,
  `↻` if the edge is part of a loop and a `▾`, with the border in the
  edge's status. Its title gives the count and how many connections are limited or not used (for example "12 items from Metals to Sciences; 2 limited — click to list them"). Clicking
  it opens a list (`graph-edge-list`, a popover over the graph; the layout does not move) with one
  full chip per connection, item name included, in the consumer's connection order; limit and
  remove work there as on a plain chip. A click outside or Escape closes the list; Escape closes only
  the list, or cancels a limit edit, never the graph. If removals bring the edge to three
  connections or fewer, plain chips come back.
  The chips of an edge (or its summary chip) are stacked in the gutter just before the consumer's
  column, which never holds a node, at the height of the edge there; the layout reserves one chip
  height for a summarised edge. Chips of different edges sharing a gutter are
  pushed apart so none covers another; if a tall stack would reach above the first row, the whole
  graph is moved down to make room. Edges are drawn under the nodes. A graph edit is recorded
  in the *consumer* block's history, while undo and redo act on the *active* block, so undoing
  after editing another block's connections does not revert that edit. Titles match the
  [Ingredients pane's segment titles](#ingredients-pane). Connections whose source was deleted and
  self-connections are not drawn; they stay visible and removable in the Ingredients pane.
- **Loops.** Blocks that supply each other form a loop. The back edge runs from the source's right
  side down to its own lane under every block and label in the columns it spans, left along that
  lane, and up into the consumer's left side; its chips sit on the lane, and two back edges that
  overlap use separate lanes. The graph grows to make room (the corner reaches slightly left of
  and right of the first and last column, inside the padding). Edges and chips that belong to a loop
  carry `data-loop`, the back edge `data-back`; a loop chip has a `↻` prefix and the title suffix
  " — part of a loop". The legend ends with **↻ Loop**. When the plan has loops the header shows
  `↻ N loop(s)` (title: the members of each loop in order, `A → B → C → A`, loops joined by `; `);
  when a loop did not settle it instead shows, in red, "Loop through <blocks> did not settle after
  N rounds; rates are from the last round". A cycle of requests whose demand does not settle adds, in
  the same red status (`data-converged="false"`, parts joined by `. `), "Requests around <blocks> do not
  settle after N rounds; the requests that close the loop take what is left over". A cycle that settles
  is counted as an ordinary loop.
- **Connecting from the source side.** The `→` handle on a node (disabled with a single block)
  starts connect mode: blocks that import something the source has as a product (whatever it offers now) or still has left over are
  highlighted, the others are dimmed with a reason ("<block> has not been
  solved yet" or "Nothing to send: <block> imports nothing <source> makes or has left over"). A highlighted block that would close a loop is marked
  (`data-closes-loop`) with the title "Closes a loop: <source> already receives from <block>, directly or
  through other blocks", and its item menu starts with "↻ Closes a loop with <source>"; the
  connection is made without confirmation.
  Clicking a highlighted block opens a menu "Send to <block>" with one entry per item, showing
  what the source offers and the target needs (`data-kind` `request` when the source has the item as a product, else `take`; a request entry shows only "needs N", a take entry "offers X · needs Y");
  choosing one adds the connection to the target. An item that the source receives itself is disabled, with the reason as its title ("<source> receives <item> itself"); a request that would close a cycle of requests is allowed (the menu above it says "↻ Closes a loop").
  The same rules as the Ingredients menu apply (`src/store/connections.ts`). **Cancel**, the
  handle again or a click on the empty background (anywhere outside nodes, chips and the menu) leaves connect mode; Escape closes the whole graph.

### Plan areas

`PlanAreas.tsx`. The **Areas in every block** icon button (four small squares in a grid;
hidden until game data is loaded, and while no block's last solve has areas) opens a
wide modal (`w-[min(96rem,98vw)] h-[90vh]`) that shows the areas as a balance matrix:
items as rows, areas as columns, and an outside column at each end. It is built from the
last solve of each block and is read-only. View state (tab, row and column modes, filter,
focus, open groups) is local to the modal: not persisted.

**Header.** The title "Areas"; then three [segmented controls](#segmented-control), each a
`role="group"` with one pill button per option: a group named "Block" with one pill per
block that has areas (a dot in the block's colour, the name, the number of areas) and
**All blocks**; a group
named "Rows" (**By category**, **By rate**, **A–Z**); in the block view a group named
"Column order" (**Flow order**, **Table order**); the text filter (`aria-label="Filter areas"`, placeholder "Filter by area,
block or item"); **Close**. The modal opens on the active block when it has areas, else
on the first block that has some. Changing the tab clears the focus, the selected item
and the open groups. A footer explains the colours (sky "+ sends", orange "− receives")
and, in the block view, that each row balances (in All blocks, what the block columns and
**Not taken** / **Not supplied** mean). Escape and a click on the backdrop close the modal.

**Block view** (`BlockAreaMatrix.tsx`, a table named "Areas of <block>"). A cell is the
area's net of the item in the current rate unit: `+` (sky) when the area sends it, `−`
(orange) when it receives it; a value that rounds to zero reads "<0.01". Electricity and heat
(1 unit/s = 1 MW) show in power units with the unit inside the text, whatever the rate unit
("+10.0MW", "−42.0kW", "<1W" when it rounds to zero); this holds for the cells, the outside
columns, the counterpart cells and their tooltips, and the tail text (`matrixFormat.ts` takes
an `energy` flag from `isEnergyItem`). The rows
balance: the area cells, plus the **From outside** column, equal the **To outside**
column. The outside columns hold the residual of the block, derived from the areas'
sends and receives (the same figures as an area's `sends`/`receives` after the solver
discarded unwanted byproducts): a negative total is what the block imports, a positive
one is what it exports, and a residual within the solver's surplus tolerance is shown as
nothing. Each row carries `data-item-id`, each cell `data-col` (the area id, or
`from-outside` / `to-outside`), `data-rate` (items/min, signed) and `data-sign`.
Columns are in **Flow order** (senders left of receivers: a greedy ordering of the
solver's area-to-area routes, ties and cycles resolved in table order) or **Table order**.
Each area header is a button (`aria-pressed`, title "Focus <area>") with the name and its
number of recipe rows.

Rows are grouped by **category** — the Factorio item groups, then "Other", then "Machines
for buildings" (items that place a machine or a beacon) — or listed by total rate, or
A–Z (no groups). A group row (`th scope="rowgroup"` with a button, `aria-expanded`) shows
the group's item count and its totals per column. A total adds up the items only, because
items and power share no unit: the electricity and heat rows of a mixed group stay visible
below but are left out of its header (the item count then carries a tooltip saying so), and
a group made only of one of them sums it in power units; electricity and heat are never
added together, so a group holding both shows no total. Group cells truncate with the full
text as tooltip. Within a group rows are ordered by total
rate (what the areas send plus what comes from outside), then name. Rows below 1 item/min
form a tail, after at most seven rows; a single leftover row of at least 1/min stays in the head.
Groups and their tails all start open, so the player sees the full list: a tail's button reads
"Show fewer" and folds it, and a folded tail reads "+ N more, X/m and below: A, B, C, D…" and
reopens it. Which tails are folded is kept per group (like the groups' own state) until the
block tab changes. A filter turns the tails off (every matching row shows, with no tail button).
The filter matches item names and area names case-insensitively: an item match keeps those rows, an area match keeps only those
columns (and the rows that have a cell there). A query that matches the block's own name
filters nothing (every area and row stays); nothing left shows `No area or item
matches "<query>"`. A block that moves nothing between its areas says so.

**Focus.** Clicking an area header focuses it (again to clear): its column is ringed in
teal and a panel (`aside`, named after the area) opens at the right with the area's
name, "Area in <block> · N rows", **Show in table**, a close button ("Stop focusing
<area>"), its contents (sub-factories, areas nested inside, the first recipes of its
rows) and a "Trades with" list of the areas and the outside it exchanges items with
(each area is a button that moves the focus; the outside reads "Outside the block"), with the item count and the rates in and out: "12.0/m + 10.0MW in", the items and the electricity and heat kept apart). Parties are sorted by item rate, then by energy rate: items and power share no unit, so a party trading few items ranks above one trading much power. The header note counts energy flows for its direction.
Unless **Show all N areas** is chosen, only the items the area moves and the areas it
trades with stay; the other headers read "sends it N items", "takes N items" or "trades N
items", and the counterpart cells (`data-counterpart="true"`, teal ring) read "13.8 →"
(that area sends the focus 13.8) or "→ 4.2" (the focus sends it 4.2). A group row's total
for such a column keeps the two directions apart: "10 →" when the area only sends to the
focus, "→ 5" when it only receives from it, "10 → · → 5" when both; the direction comes
from each row's own cell and rows with no counterpart value do not count. Outside
counterpart mode a group total is the sum of the nets, blank when it cancels to rounding
noise (within 1e-9 of its largest addend). **Show in table**
makes the block active, then, for an area other than "Top level", switches the
[table](#productiontable) back to the tree view and asks it to reveal the area's
sub-factory row (expanding the sub-factories above it and flashing it, as **Go to row
in…** does; the area row itself is not expanded), then closes the modal; for "Top level"
it only switches the block.

**Counterpart figures are the solver's routes.** They come from `SolverResult.areaRoutes`,
kept per row in `MatrixRow.pairs` (an absent end is the outside). When the plan solves, the
totals and the permissions are exact: per sender the parts add up to what it sends, and an
area with its own row for an item is not handed another area's dedicated output beyond its
allowed shortfall. When the solve is infeasible, or the solver result does not show an outside
import beside a surplus of the same item (see [spec/solver.md](solver.md#areas)), a restricted
receiver may be fed another area's dedicated output. Where the solver is indifferent between
suppliers, areas higher in the table supply first and an area with its own row for the item is
served before the others. The tooltips of counterpart cells state that rule, and the Flow
order uses the same routes.

**All blocks** (`AllBlocksMatrix.tsx`, built by `planAreaMatrix.ts`). Items are rows and
each block is a column group. Under **Only items that cross a block boundary** (on by
default) the columns are the ends of the active connections (rate above the flow
tolerance, not `missing-source` or `self`) and the rows the items they carry; off, every
block with a solve and every item with a boundary net or an area cell. A block's
**Net** is its boundary balance from `netBalance` of its solved nodes (the quantity the
solver offers to other blocks, before byproducts are discarded; signed, `+` leaves the
block, `−` enters it). A block with areas has a header button (`aria-expanded`) that
swaps its **Areas** column (the areas that move the item the way the net goes, the
largest first, "+N" for the others, all listed with their rates in the title) for one
column per area; the active block starts expanded, the others collapsed, and a block
without areas reads "<block> · no areas" and has only **Net**. **Not taken** is what the
blocks leave beyond what the connections deliver: `max(0, Σ positive nets −
delivered)`; **Not supplied** (shown only when a row needs it) is `max(0, Σ negative
nets − delivered)`, what is imported. Both sums run over every block with a solve, shown
or not, so they do not change with the crossing checkbox (a hidden block's surplus still
counts as not taken). Because the Net is taken before byproducts are
discarded while area cells are taken after, a block's area cells may not add up to its
Net. Selecting an item (the row label is a button, `aria-pressed`) opens a region named
"<item> across blocks" under the table: one line per block with a net ("<block> ·
<areas> +X/m leaves the block" or "−Y/m enters the block"), one per connection ("<from>
→ <to>: R/m", "(limited)" when limited) and the not-taken / not-supplied remainders. The
rows are grouped, ordered, folded and filtered as in the block view (the filter also
matches block names, an area of a block, or items). With nothing to show it says "No item
crosses a block boundary." under the checkbox, "No item moves in or out of a block."
without it, and "Nothing to show for these blocks." when a query matches only a block or
area that has no row.

Areas are never merged by name: each block has its own pool, so what an area receives or
sends is relative to its block, and every block has a "Top level".

### In-game viewer

`ViewerMenuItem` (`ViewerMenu.tsx`) is an **In-game viewer** item of the [workspace menu](#workspace-menu), a `SubmenuItem` (`variant="controls"`: a flyout of controls, `role="dialog"` named "In-game viewer", opened by hover, click or ArrowRight) for the connection to the in-game viewer's bridge, a program on the same computer that passes the plan to the Factorio mod. The row shows a plug icon, the label and, on the right, the badge's short status (`viewer-menu-status`: Off, Connecting, No bridge, No game, Connected, …) behind a coloured dot (blue busy, green connected, amber warning, red error; none while off). The same dot sits on the workspace menu's trigger (`viewer-dot`), so a problem shows without opening anything. Inside a controls flyout the arrow keys, Home and End are the controls' own; Escape returns to the row, and Tab moves between the controls and closes the menu once focus leaves them.

The connection is **off by default and never remembered**: the planner opens no socket until the player turns on the **Connect to the bridge** switch (`role="switch"`, first row of the flyout), and a reload starts off again. While off the flyout explains what the viewer needs. While on it shows a status card (the badge's coloured dot and label in `viewer-badge`, `aria-live="polite"`), error notices (`viewer-notice`, `role="alert"`), the **Send to Factorio** button (disabled, with "Available once the game is connected", until the game is) and, always, the **Send after every change** checkbox and the **Bridge** row: the address (`viewer-address`, default `ws://127.0.0.1:34199/`) with a **Change** link that swaps it for a field with **Save** and **Cancel** (and **Use the default** when it differs); saving while connected disconnects and reconnects to the new address. The card's explanation (`viewer-detail`) shows for the states that are not a warning or an error; for those the card shows a **Troubleshoot…** link instead. The address and the auto-send choice are persisted with the other UI settings in `uiStore`.

**Troubleshoot dialog.** **Troubleshoot…** closes the menu and opens `ViewerTroubleshootDialog` (a `Modal`, `role="dialog"` named "Troubleshoot the in-game viewer", owned by `WorkspaceMenu` so it outlives the menu). It lists three steps, in order, each with a numbered circle (a check when fine, `!` when it is not), a state and a sentence about what the step is: **Bridge** (running; carries the address and its Change link), **Game** (answering) and **Plan** (sent). The first step that is not fine says what to do, with a Copy button for the command (`factorio-planner-bridge` for no bridge, `--enable-lua-udp <port>` for no game: the flag takes the game's UDP port, which is the `gamePort` the bridge reports in its `status`, or 34198 before the first `status` or when the bridge reports none; the "Bridge, no game" explanation carries the same option); the steps after it read Waiting. The diagnosis is the pure `troubleshootSteps` (`src/viewer/troubleshoot.ts`), computed from the badge, and updates live while the dialog is open since the planner keeps retrying. **Done**, the close button, Escape and a click outside close it.

Badge states: Off; Connecting; Waiting for the browser (the socket has been opening for 2.5 s: the browser may be asking for permission to reach the local network); No bridge (the socket closed without opening, or an open one closed; the explanation lists the browser causes: the permission prompt, content blockers such as uBlock, Safari, unsupported, timing out on the hosted https page); Blocked by the browser (creating the socket threw); Bad address; Version mismatch (the bridge's first status has another protocol version: nothing is sent); Unreadable status (a status of our protocol version that does not have the shape that version defines: nothing is sent until a readable one arrives); Bridge, no game; Game quiet (paused, saving or closed); Mod version mismatch; Data set mismatch (the mod reports ids the running game lacks, shown with the count); Connected (the explanation says where the delivery stands). While the connection is on and the socket is closed the planner retries every 5 s.

After each solve the planner builds the snapshot (`projectSnapshot`), hashes it and either sends it (auto-send on, or **Send to Factorio**) or only announces its id, so the game can show a plan edited and not sent as stale. Nothing is built while the connection is off. A snapshot above 8,000,000 bytes is never sent: the id is announced, a notice says the plan is too large for the in-game viewer, and Send announces too. After a restart that left the bridge empty the planner sends the last bytes it sent again; it does so only when the bridge's first status shows nothing held, and never for bytes the bridge refused. A bridge `error` is shown in plain words and nothing is resent by itself; it goes away when the socket closes. The notices about the plan (too large, a failed build) show only while the connection is on. Switching the connection off forgets the plan, so the one built after switching on is the only one announced; a frame the socket cannot take (not open, or `send` throws) is not counted as sent. After a reconnect the planner announces its plan unless the bridge already reports that id as its newest (or the restore just sent exactly those bytes), so a bridge holding another planner's plan is not left showing it as current. The rules live in the pure state machine `src/viewer/connection.ts`; `controller.ts` owns the WebSocket and the timers.

### Research horizon

`HorizonButton` (in `HorizonPicker.tsx`) limits the recipes the pickers offer, and the
items the goal picker offers, to those researched up to a chosen point. It is a flag icon
button, hidden unless the loaded data set has technology data. Its accessible name and tooltip
read `Horizon: none`, `Horizon: <technology>` or `Horizon: N technologies`. A blue dot
(`data-testid="horizon-dot"`) sits on the flag exactly when at least one valid target (one
present in the data set's technologies) is set.

Clicking the flag toggles the **targets popover** (`HorizonTargetsPopover`, a `Popover` named
"Horizon targets" anchored under the flag). It lists each valid target with its icon and name and
a remove button (`Remove <name>`), the list scrolling (`horizon-target-list`) so the popover never
exceeds 70% of the viewport height, plus **Edit horizon…** and **Clear** (`Clear horizon`). With
no targets it says so and offers **Choose technologies…** instead. Opening moves focus to the
edit button (**Edit horizon…** / **Choose technologies…**), deliberately not the first remove
button, so a second Enter or Space cannot delete a target; removing or clearing targets moves
focus back to that button, which survives. Escape or an outside click closes it, and only Escape
returns focus to the flag. **Edit horizon…** / **Choose technologies…** closes the popover and
opens the [technology tree](#technology-tree), the only place to pick targets; closing the tree
returns focus to the flag.

The targets and all their prerequisites define the horizon (rule in
[data-model.md](data-model.md#technology)). It belongs to the plan, so it is saved
per data set and included in the export. Recipes already in the plan are not
marked and keep solving.

The horizon also gates machines, beacons and modules (rules in
[data-model.md](data-model.md#technology)): the machine, module and beacon pickers
list only available ones, and a row without an explicit machine uses the horizon's
default machine. A hidden machine, beacon or module that no non-hidden recipe makes is
never available under a horizon. A machine, module or beacon already chosen but outside the horizon
is kept and marked with an amber ring (`data-beyond-horizon`) or a "Beyond research
horizon" label. When no machine of a recipe's category is inside the horizon, the row
has no machine: its machine count and power are 0 and the row is flagged (see
[Machine cell](#production-table)); recipe throughput and rates are unaffected.

The recipe picker's hover detail panel lists in "Made in" only the machines inside the horizon, all of them when "Beyond research horizon" is ticked; hidden machines are never listed under a horizon, and when none remains the section reads "No machine inside the research horizon". Power recipes are exempt (the exporter gives each one machine, gated through its placing item). Machines beyond the horizon are not dimmed or marked when the checkbox is ticked.

### Technology tree

`TechTreeButton` (in `TechTree.tsx`, a flask icon button named **Tech tree**) sits next to the
block graph button and is hidden unless the loaded data set has technology data. It opens a
near-full-screen modal (Escape, the backdrop and **Close** dismiss it).

- **Layout** (`src/data/techTree.ts`): one column per prerequisite depth (the longest
  chain of prerequisites), so a technology is always to the right of its prerequisites.
  Rows within a column are ordered by a barycenter heuristic to reduce crossings;
  columns are top-aligned. One curved edge links each prerequisite to its dependent.
- **Cards**: icon (a letter placeholder when the bundle has none), name, and the
  cost: one chip per science pack (the pack's item icon, tooltip `<pack> ×amount`)
  followed by `×count · time s` (`×?` for a formula count). A research-trigger
  technology shows its condition in place of the cost: the subject's icon and a one-line text
  such as "Craft 10 × Steel plate" (truncated to the card; the full sentence is in the hover popup, and in a native `title` only in the recipe picker's technology list, via `TechCost`'s `tooltip` prop); it
  shows a bare "Trigger" when the bundle has no condition or the type is unknown. A bundle
  without cost data shows nothing. The cost is
  rendered by the shared `TechCost` component (`TechCost.tsx`), which the recipe
  picker also uses, without the time.
  The icon (or a letter placeholder) comes from the shared `TechIcon` component
  (`TechIcon.tsx`), likewise used by the picker.
- **States**, derived from the plan's research horizon: *researched* (a target or
  one of its prerequisites; green), *available* (all prerequisites researched; amber),
  *locked* (gray, dimmed). Edges take the colour of their dependent's state. With no
  horizon nothing is researched and the roots are available; the header says
  "No horizon: every recipe is offered. Click a technology to research up to it."
  Otherwise it reads "Horizon: N targets". Next to it, "N of M recipes available"
  (`data-testid="tech-tree-recipe-count"`; M counts non-hidden recipes, extraction
  recipes count as available) shows what the horizon unlocks.
- **Unlocks popup** (`TechUnlocksPopup.tsx`): hovering a card for 300 ms, or focusing it, shows
  the recipes and machines the technology unlocks (`technologyUnlocks` in `src/data/horizon.ts`);
  focus shows it at once (not for a card outside the visible canvas, and not for the focus a
  pointer press causes, whatever the button), and moving the pointer between cards switches
  without the delay: leaving a card keeps a shown popup for a 100 ms grace period, which entering
  another card cancels. The header repeats the icon, the full name and the cost with its time; a trigger technology shows the full sentence instead ("Researched by crafting 10 × Steel plate"). **Recipes** lists
  up to 8 with the icon of `recipeIconItem` (`src/data/recipeIcon.ts`, shared with the recipe
  picker) and a "+N more" row; a technology without recipes says "Unlocks no recipes".
  **Machines** (only when there are any) lists the non-hidden machines and beacons placed by an
  item that one of the listed recipes produces, up to 8 with "+N more"; the item is found through
  `Item.placeResult`, with the same-id fallback of older bundles. Hidden recipes (and what only
  they would unlock) and hidden machines are left out. Other research effects are not shown: the
  export keeps only recipe unlocks. The popup is a `pointer-events-none` portal on `document.body`
  (the scaled canvas and the modal clip their contents), placed by `anchoredPosition`
  (`src/utils/anchoredPosition.ts`) to the right of the card, flipped left and clamped to the
  viewport. On short viewports it is height-limited and the recipe list is clipped first; the
  header and the machines stay. It hides (after the grace period when the pointer leaves, at once
  otherwise) on leaving or blurring the card, a pointer click (Enter or Space on a focused card
  keeps it), a pointer down in the viewport, wheel, zoom buttons, **Fit**, and window blur or resize. Escape dismisses the popup first
  (captured before the modal's listener); then a non-empty search box is cleared; the next Escape closes the tree. Cards carry no native
  `title` tooltip.
- **Search** (`TechSearch` in `TechTree.tsx`, `searchTechnologies` in `src/data/techTree.ts`): a box in the
  header (`data-testid="tech-tree-search"`, "Search technologies") lists the technologies whose name contains the
  trimmed query, case-insensitively; a leveled name such as "Toolbelt 5" matches by its full name. Names starting
  with the query come first, then the rest, each group sorted by name with numbers compared numerically. A blank
  box lists nothing; no match shows "No matching technologies"; the dropdown shows at most 50 results, then a
  "N more — refine the search" row. Choosing a result (click, or Enter for the first) centres its card at scale 1
  (`centerOn`), hides the unlocks popup, clears the box and highlights the card for 1.5 s (`data-highlight`,
  a pulsing sky ring that wins over the target ring). It never changes the horizon. A pointer down in the viewport clears the box. The dropdown is right-aligned to the box so it stays inside the header. Escape clears a non-empty
  box before it closes the tree (captured ahead of the modal's listener); with the unlocks popup open, that
  popup's Escape comes first.
- **Click** a card to toggle it as a horizon target; targets get a ring. Adding a locked technology researches its whole prerequisite
  chain. **Clear horizon** empties the targets.
- **Pan and zoom** (maths in `src/utils/viewTransform.ts`): drag the background to
  pan (a drag longer than 4 px never counts as a click), mouse wheel to zoom around
  the cursor (wheel deltas are normalised by `deltaMode` and clamped per event),
  **+** / **−** to zoom around the centre (scale 0.1 to 2), **Fit** to show the
  whole tree (it may go down to scale 0.02, below the zoom buttons' floor, so a very
  wide tree still fits). The viewport never scrolls natively: focusing an off-screen
  card does not move the view. The modal opens centred on the furthest target, if any.

### Workspace menu

`WorkspaceMenu` (`WorkspaceMenu.tsx`) is the button at the right end of the top bar
(`aria-haspopup="menu"`, `aria-expanded`). It merges the plan list and the app-level entries and is
never disabled, since the game data group must stay reachable. The trigger shows a layers icon, the
active plan's name and a sub-line, and a chevron:

| State | Top line | Sub-line | Accessible name |
|---|---|---|---|
| No data set chosen yet | Choose game data | none | `Choose game data` |
| Loading | active plan name, else "Choose game data" | Loading… | `Plan: <name>, loading` (or `Choose game data, loading`) |
| Error | active plan name, else "Choose game data" | Error loading data (red; the tooltip carries the error message) | `Plan: <name>, error loading data` (or `Choose game data, error loading data`) |
| Loaded | active plan name | data set label: Nullius, Seablock or the uploaded file name | `Plan: <name>` |

While the in-game viewer connection is on, a status dot (`viewer-dot`) sits on the trigger's top-right corner and `. In-game viewer: <badge label>` is appended to the accessible name (for example `Plan: Main. In-game viewer: Connected`); both are absent while the connection is off.

It opens a panel named "Plan and game data", in order:

- the [Plans](#plans) section (heading, plan radio items, action tiles), only when a data set is
  active;
- a separator, then a **Game data** group: **Nullius**, **Seablock**, the name of the uploaded file
  once there is one, and **Upload file…**; the current data set is the checked item (see
  [Game data set](#game-data-set)). The radio items carry their label as `aria-label`;
- a separator, then the **In-game viewer** submenu item (see [In-game viewer](#in-game-viewer)) and another separator;
- only once game data is loaded: the **Default machines** submenu item (see below) and another separator;
- **Export plan** and **Import plan…** (see [Export and import plan](#export-and-import-plan)).

The trigger, panel, keyboard handling and focus rules are the shared `MenuButton` component
(`MenuButton.tsx`), which takes optional `triggerClassName`, `caret`, `panelClassName` and
`openSignal`; `align` picks which edge of the button the panel lines up with (right here). The menu
is meant to collect more app-level entries over time. A non-zero `openSignal` that changes opens the
menu without moving focus (the workspace menu passes the `seq` of `uiStore.defaultMachinesRequest`).

**Default machines.** `DefaultMachinesMenuItem` (`DefaultMachinesMenu.tsx`) is a `SubmenuItem`: a
`menuitem` with `aria-haspopup="menu"`, `aria-expanded` and a chevron, opening a flyout menu named
"Default machines" to its left (`absolute right-full`, `max-h-[calc(100vh-4rem)]`, scrolling
inside). The flyout lists the crafting categories that have at least two non-hidden machines inside
the [research horizon](#research-horizon) (`defaultMachineCategories`), in two sections: "Used in
this plan" (categories with at least one row left on "Default", across all blocks) and, after a
separator, "Other categories". Each category is a group named after its label (`categoryLabel`: the
id with `:`, `_` and `-` as spaces, first letter capitalised; the id is the tooltip) with the number
of such rows and one radio item per machine (24px tile with the icon, or the name's first letter;
the name is the accessible name and tooltip). The checked one is the effective default; picking one
sets the plan's `defaultMachineOverrides` entry and leaves the menu open. Rows set to an explicit
machine are not affected. The footer has **Reset all** (clears every override; disabled with none) and
the note "Used by rows set to 'Default'". Overrides are not undoable.

Opening the flyout programmatically: `uiStore.requestDefaultMachines(category?)` (used by the Edit
machine modal's "All defaults…") opens the workspace menu with the flyout open and focus on the
checked machine of that category (else the first checked item). The request is transient; the item
captures it on mount and clears it.

`uiStore.revealRowRequest` / `requestRevealRow(nodeId)` is a similar transient request (not
persisted, never cleared; `seq` changes on every request) to show a production-table row,
see [Recipe rows](#recipe-rows).

The checked data set's radio item carries a second line, "Factorio <version> · N mods · N recipes"
(singular for 1; `aria-describedby`, so it is its accessible description; the tooltip lists the mod
names). Mods are the `modSet` entries other than `base`, `elevated-rails`, `quality` and
`space-age`; recipes are the non-hidden ones. It shows only once the data has loaded.

**Nested menus.** `SubmenuItem` (`MenuButton.tsx`) is the one nested-menu primitive. Arrow keys,
Home and End move within the menu that holds focus (the panel or the flyout) and wrap there.
ArrowRight (or Enter / Space) on a submenu item opens its flyout and focuses its checked item (else
its first item, or the `initialFocus` target). Escape or ArrowLeft inside a flyout closes just the
flyout and focuses its item; Escape at the top level closes the menu and ArrowLeft there does
nothing. Tab closes everything. With the mouse, hovering the item opens the flyout without moving
focus and leaving it closes it after 200 ms, unless focus is inside the flyout. Moving focus out of
the item and flyout (to a point the mouse is not over) also closes it. When focus is in the flyout
because of a click, leaving with the mouse closes it after the same delay and moves focus back to its
item; a flyout focused with the keyboard stays open. ArrowRight opens and ArrowLeft closes the flyout
although it opens to the item's left (the usual menu convention).

Opening with the keyboard (Enter, Space or ArrowDown) focuses the first checked item (the active plan, else the checked data set; failing that the first
enabled item). ArrowUp focuses the last enabled item. Opening with the mouse leaves focus on the
button, so only the hovered row looks active. Arrow keys move between enabled items and wrap;
Home / End jump to the ends; Tab closes the menu. Apart from Escape, these keys are only taken
while focus is inside the menu or on its button. Escape closes it and
returns focus to the button; it is handled in the capture phase and prevented, so it does not
also clear a summary pane selection. A click outside closes it; a click on the button toggles.
The hidden data-set file input, the data-set auto-load on page load and the import dialogs live in
`WorkspaceMenu` itself rather than in the panel, so they keep working after the panel closes (the file
pick and the confirmation dialog are asynchronous).

### Export and import plan

The **Export plan** item (`exportPlan` in `WorkspaceMenu.tsx`) downloads the active plan's `AppState`
(`{ blocks, activeBlockId, horizonTechnologyIds, defaultMachineOverrides, dataSet }`) as `factorio-plan-<slug>-YYYY-MM-DD.json`
(`exportFileName`). The slug is the plan name lower-cased, with each run of characters other than
`a-z0-9` replaced by `-`, outer dashes trimmed and cut to 40 characters; with an empty slug the file is
`factorio-plan-YYYY-MM-DD.json`. A saved file is the shape the app keeps in `localStorage` plus `dataSet`,
which import drops.

`dataSet` (`PlanDataSetStamp`) records the data set the plan was exported from: `id` is the loaded source
id without trailing slashes (`nullius`, `kompetenz-seablock`, or `custom:<filename>#<8-hex mod set
fingerprint>` for an upload), `name` the bundled label ("Nullius", "Seablock") or the uploaded file name
without the fingerprint, and `factorioVersion` the loaded data's Factorio version. Import compares the
stamp's `id` with the loaded data set (`isSameDataSet`, `src/store/sourceId.ts`): bundled ids must be
equal; two uploads match when their fingerprints are equal, whatever the file name; a bundled id never
matches an upload, so a bundled data set and an upload of the same files count as different. Only the
id is compared: the fingerprint covers mod names and versions, while `factorioVersion` is shown in the warning
but never compared, so two data sets with equal mods count as the same. A file without a stamp (or with a
malformed one) skips the mismatch check, and its unknown-ids paragraph ends with "The plan may have been made for another data set."

The **Import plan…** item (`usePlanImport` in `WorkspaceMenu.tsx`) loads such a file back **as a new plan**; the
current plan is kept. It is disabled until game data has loaded, because the plans belong to the current
data set. Importing has two phases. First `checkPlanImport` (`src/store/persistence.ts`) parses and
validates the file without touching the store: malformed JSON, a schema failure, a plan with no blocks
("The plan contains no blocks.") or a duplicated block, sub-plan or node id (ids must be unique per
block; e.g. `Duplicate block id "b1".`) opens an error dialog; an `activeBlockId` that matches no block
falls back to the first block. A valid file whose recipes and goal items the loaded game data all defines,
and whose stamp (if any) names the loaded data set, is imported straight away, with no confirmation,
since nothing is overwritten. Otherwise a warning dialog opens with up to two paragraphs; **Cancel**
drops the file, **Import anyway** continues.

- `import-data-set-mismatch`, when the stamp names another data set: "This plan was exported for
  <name> (Factorio <version>); the loaded game data is <name> (Factorio <version>)." (the stamp's
  version part is left out when it has none), followed by "All its recipes and goal items exist in the
  loaded game data." when no id is unknown. When both names are equal (two uploads of one file name with
  different mod sets) the loaded name is followed by "(a different mod set)" (`dataSetMismatchMessage`,
  `src/store/persistence.ts`).
- `import-unknown-ids`, when the file refers to recipes or goal items the loaded game data does not
  define: it lists the first few ids and says they cannot be produced (unknown recipes do nothing,
  unknown goals stay unsatisfiable, so a plan made for another data set looks mostly empty). It ends with
  "The plan may have been made for another data set." for an unstamped file, "The game data may have
  changed since the plan was exported." when the stamp matches, and nothing extra when the stamp
  mismatches (the other paragraph already says so).

Both paths call `importPlanAsNew` with the source id of the data set the file was checked against; it
refuses with "The loaded game data changed; pick the file again." if another data set is loaded (or
shown) by then, and with "Load game data first." while none is. Otherwise it saves the current plan,
adds a plan named after the file without its last extension (`block-connection.json` becomes
"block-connection", trimmed, cut to 60 characters; an empty result falls back to "Plan N"), makes it
active, gives all its ids fresh values (as in Duplicate, so importing the same file twice shares nothing)
and clears the undo history; autosave persists it. The file input is created on each click, attached
(hidden) to the page only while the pick is in flight, and removed on selection or cancel.

### Game data set

The workspace menu's Game data group (`useGameDataSource` in `WorkspaceMenu.tsx`) is a set of radio items:

- the bundled datasets, **Nullius** and **Seablock** (served from
  `public/data/<dataset>/game-data.json`);
- **Upload file…**, which opens a file chooser for a custom `game-data.json`;
- the name of the uploaded file, once there is one.

Picking the checked bundled data set again does nothing, unless its last load failed (then it
retries); the uploaded file's item only closes the menu (upload the file again to retry).
Once loaded, the checked item shows the data set's version and mod and recipe counts (see
[Workspace menu](#workspace-menu)). A failure to store the upload or to clear it when switching (IndexedDB blocked) shows the same
"Error loading data" label and leaves the previous choice checked. Picking a data set before the
stored upload has been read abandons that pending read.
Picking a bundled dataset remembers the choice in `localStorage` and clears any
stored upload. An uploaded file is stored in IndexedDB (database
`factorio-planner`) and reloaded on the next visit. With neither, no item is
checked, nothing is loaded and the empty table says to open the workspace menu, whose button reads "Choose game data". "Loading…"
or "Error loading data" shows as the button's sub-line while loading or after a validation
failure (the tooltip carries the error message).

Each data set has its own list of plans (see [Plans](#plans)). When a data set finishes loading and
differs from the previous one, its active plan replaces the one on screen (or an empty "Factory"
block if it has none); switching back restores the earlier data set's active plan. The plans are
identified by the loaded source id: the bundled data set's id for a bundled
dataset, or `custom:<filename>#<fingerprint>` for an
upload, where the fingerprint is a short hash of the data's `modSet`, so uploads
with different names or different mod sets do not share a plan (two files with the
same name and the same mod set do; the menu still lists the file name).
Reloading the same data set does not reset the plan, and a failed load leaves the
current plan untouched.

Only one upload exists at a time, so its plans do too: activating an upload
removes the plans of earlier uploads, and picking a bundled dataset (which clears
the stored upload) removes every upload plan.

Legacy data-set id. A `kompetenz-seablock/` value stored in `localStorage` by
older versions is normalised to `kompetenz-seablock` and rewritten on load; if the
rewrite fails (quota full, storage blocked) the normalised id is still used.

**Storage.** Each data set has an index key, `factorio-planner:plan-index:<sourceId>`, holding
`{ activePlanId, plans: [{ id, name }] }`, and one key per plan,
`factorio-planner:plan:<sourceId>/<planId>`, holding that plan's `AppState` (the autosave writes
to the active one; switching tabs alone does not save). A stored plan that fails validation is not
overwritten: its raw value is first copied to `<planKey>:corrupt`, and the plan starts empty (it stays in
the list). An unreadable index is moved to `<indexKey>:corrupt` and rebuilt from the plan keys found
(named "Plan 1", "Plan 2", …). Tabs share the index and merge each other's changes (see
[data-model.md](data-model.md)).

**Migration.** Older versions kept one plan per data set under
`factorio-planner:app-state:<sourceId>`. When such a key exists at activation it is copied unchanged into
a new plan key, added to the list (named "Plan N") and made active, and only then is the old key deleted.
This also happens when an index already exists (an old tab of the previous version may still be writing
the old key), so the old plan appears as an extra active plan. An unreadable old plan is quarantined by the
normal load path. If the copy cannot be written, the old key stays and the plan is still shown. The oldest
key, `factorio-planner:app-state` (before plans were per data set), is adopted the same way by the first
data set that has neither an index nor an old key, then deleted. `:corrupt` values left by older versions
are not touched.

---

## FactorySummary

`FactorySummary.tsx` is the summary strip for the active block.

There is no header row: the block name is on its tab (renamed from the tab's context menu), and the
warnings pill is in the [table toolbar](#table-toolbar).

**Collapsed and expanded.** The strip is **collapsed** by default (`uiStore.summaryCollapsed`, persisted with the other UI state like the rate unit, and kept across block switches): `SummaryLine` draws one line per pane instead of the three full panes. From `md` the strip is one 58px row (`data-testid="summary-line"`, 9px of padding above and below) of three 40px lines (`summary-line-pane`, a `section` region named after the pane, so the pane's name finds either form) and a 68px **Expand** button at the right (`aria-label` "Expand summary"); the lines end before it. Below `md` the three lines stack, 38px each in a 123px strip (3 x 38px, 8px of padding and the strip's 1px border), and the button is not drawn. A line is the label (10px, uppercase), the item count (12px, `summary-line-count`), as many item chips as fit (the table's [`IconChip`](#icon-chip): 32px, the quantity in the corner, `summary-line-chip` with the quantity as `summary-line-quantity`, 38px slots, toned like the recipe and group rows: product, byproduct and ingredient; the room is the line's measured width, `lineChipFit` in `lineChipFit.ts`). A Products chip shows the product's **goal** (the extra output plus what other blocks request) when it has one, and the actual rate when it has none; a product with nothing requested shows `—` and is dimmed. Its tooltip reads `<item> — goal N/m`, with `, making M/m` when the output differs and `, short by S/m` when it falls short; the actual is never below 0, and `, making M/m` is left out when it would read the same as the goal; a short product's chip has the amber ring, a small amber ▼ in its corner and `data-status="short"`, and every chip is `role="img"` with its tooltip text as `aria-label`. A byproduct or ingredient chip shows its rate, tooltip `<item> — N/m`. The chip is informational: a span, not a button and, when some do not fit, a `+N` button (`summary-line-more`, `aria-label` "Show all N products|byproducts|ingredients", 34px kept for it). The `+N` opens, on hover, keyboard focus or click (`useHoverPopup`, as the area rows' `+N`), a 300px list of **every** item of the pane with its rate (a Products row with a goal reads `goal → actual`, the actual amber with a ▼ when short and teal otherwise; `summary-line-popup`, `aria-label` "All N products", at most 270px high, scrolling): it is informational, an item in it is not a button. Nothing in a collapsed line selects an item, so the collapsed summary has no **+** for Products: expand it to add one. **Expanded**, the three panes below are followed by an 18px **handle row** (the text "Collapse summary" is its accessible name; there is no `aria-label` and no `aria-expanded`, which would state the same fact twice) that collapses them; the table moves down by its height. Below `md` the handle row is also drawn when collapsed (text and accessible name "Expand summary"), below the stacked lines, and is the way to expand; from `md` it is not drawn when collapsed. The line's Expand button keeps `aria-label` "Expand summary", which contains its visible text "Expand". Focus follows a toggle: after the line's Expand button expands the strip focus moves to the handle row, and after the handle row collapses it from `md` focus moves to the line's Expand button (the button or row that had the focus is unmounted or hidden); below `md` the handle row is one element in both states and keeps its focus. An expanded strip below `md` scrolls sideways as described below. The e2e suite stores the choice as expanded for every spec (`playwright.config.ts`); `summary-line.spec.ts` opts out.

Each of the three panes is a `SummaryPane` (a `section` region named after its label) with a header (label, an item count `· N`, and for Products the `+` button, as far from the pane's top border as from its right one), a grid of **item slots** and a **detail strip**. Panes are keyed by the active block, so changing block resets them.

**Slot grid.** One 50×54 slot per item, in row order, wrapping. A slot shows the item icon (the name when there is none), the rate in the bottom-right corner, a status badge in the top-right corner and a 4px **micro-bar** (segments 1px apart) along the bottom edge. Its accessible name is "<item>, <rate> per minute|second", with ", short", ", limited" or ", locked" appended when the slot has a status (the badge itself is decorative), and its tooltip the item name. The border is teal (with a dark teal fill) when selected, amber for a short product or a limited connection, grey otherwise; a short product's rate is amber. A locked item or an unused connection dims the slot. An empty product slot (see [Products pane](#products-pane)) is dimmed, has a dashed border and the tooltip `<item> — nothing requested yet`. The grid grows to fill the pane, so the three detail strips line up at the bottom of the row. Below `md` the three panes form a horizontal swipe strip (`overflow-x-auto`, scroll snap, each pane 85% of the width so the next one peeks in); from `md` they share a three-column grid. The strip keeps its fixed heights. The grid is capped at one row of slots plus half of the next (`max-h-[97px]`), to leave room for the production table, and scrolls vertically while the header and the strip stay put; a gradient fades the bottom edge (the pane has `data-overflow="true"`) while more slots sit below. The fade is re-measured after every render and whenever the grid's content resizes (`useMoreBelow`).

**Allocation segments.** Every item is a bar whose segments add up to the bar's scale. The micro-bar, the detail bar and the overview all use the same encoding:

| Pane | Scale | Segments, in order |
|---|---|---|
| Products | max(required, actual) | one `export` per consumer block (delivered) · `kept`, labelled `Extra` (what is left) · `short` (required minus actual, when short) |
| Byproducts | net production | one `export` per consumer block · `left` (what stays) |
| Ingredients | need | one `source` per source block (delivered) · `import` (still imported) |

| Kind | Look in the detail bar (micro-bar: solid) |
|---|---|
| `export`, `source` | the block's colour as a translucent fill with a solid border; a limited source has an amber border (amber in the micro-bar) |
| `kept`, `left` | dark fill, grey border |
| `import` | no fill, light grey outline |
| `short` | faint amber fill, dashed amber border |
| unused / self / deleted source | no fill, dashed grey border; takes no share of the bar, but fills it (dark grey in the micro-bar) when the item has no segment, and otherwise is a 10px mark at the end of the detail bar |
| imports forbidden | grey stripes; fills the bar when the item has no segment |

The looks live in `segmentLooks.ts` and are shared by the micro-bar and the strip's two bars (an item's and the overview's).

Products also draw a 2px light tick at the target when the actual rate differs from it (inside the bar when over-producing, at its end when short). Block colours come from `Block.color`; a block that no longer exists is grey. The segment model is built by pure functions in `summarySegments.ts` from the rows of `summaryRows.ts`.

**Detail strip.** A fixed-height strip (`h-[72px]`, `data-testid="summary-detail"`, `data-state`) at the bottom of the pane, on a lighter background, always present, so slots never move when the selection changes. Padding is 5px above and 3px below (6 and 4 for the overview's empty message), 10px at the sides, 3px between lines. It has four states:

- *overview* (nothing selected or hovered): an `Overview` heading with the hint "click a segment to trace it" ("click again to clear" while tracing), then **one stacked bar** (`StackedBar`, 16px high) with one segment per segment key in the pane (`data-testid="summary-overview-segment"`, `data-key`, `aria-pressed`). A segment is as wide as its key's share of the bar: items are sized by their total rate, electricity and heat (which have no common unit with items) by the largest power-only key, so power-only segments compare with each other and are as wide as the largest item key at most; a key with no rate (an unused source) keeps 3px. It writes the text it can fit, by width (see below), with the number of items carrying the key riding along with the amount ("381 · 14") when it fits. Its tooltip reads label, amount (`unused` has none) and `N items` (a key carrying both items and power reads "12.0/m of items + 10.0MW"). A known weakness: a segment of about 12% of the bar writes only its amount, and a thinner one nothing, so the colour, the tooltip and the accessible name carry the rest. Clicking a segment traces that key (a segment with a limited source has an amber border; a trace whose key no longer exists is ignored): the segment gets a light border, the other segments fade to 50%, slots without the key fade to 30% and every micro-bar fades its other segments; click again to clear. With no keys the strip says "Nothing here yet".
- *preview* (a slot is hovered): that slot's detail with a `preview` tag after the name. Hovering the selected slot keeps the selected state.
- *selected* (a slot is clicked): header (icon, name, rates, `×` back to the overview), the full-size bar (16px) and the item's actions on one line. There is no key line: the bar carries the text and its tooltips the rest. The preview has the header and the bar only.
- *editing* (Products only): as selected, with the extra output as an input. Hover does not change the strip meanwhile.

**Bar text and tooltips.** `StackedBar` is the one bar of both the item's detail and the overview; the pure arithmetic is `layoutBar` in `summarySegments.ts`. The bar's width is measured (`ResizeObserver`); the gaps (1px) and the fixed marks come off first, the rest is shared by weight, a segment under 3px keeps 3px and the others give that room up so the bar never spills out (repeated until no other segment is pushed under 3px by it). A segment writes its **name and amount** when it is at least the amount's width + 46px wide (the amount's width is estimated at 6.2px a character + 10px), the **amount alone** from the amount's width + 4px, and nothing below that; a segment with no amount (an unused source, imports forbidden) writes its name alone from 60px. Every segment has a **tooltip**, the black one of the tool buttons, shown on hover and on keyboard focus, and on touch by a tap (see below): a first line with name, amount and note (`data-testid="summary-segment-tip"`, the text a colour-key entry used to carry: see the Products pane) and, for `export`, `source`, unused, self and deleted-source segments, a muted second line saying what a click does or why the source is limited (`summary-segment-detail`, the texts listed below). The tooltip opens upward and is at most 280px wide (never wider than the bar; longer lines wrap): centred on the segment when that fits inside the bar, else hung from the segment's left edge, else from its right edge, else aligned on the bar's left edge, so it always stays inside the pane. On a touch screen (`pointerType` `touch`) the first tap on a segment opens its tooltip and does nothing else; a second tap on the same segment does what a click does, and a tap elsewhere or Escape closes the tooltip. Every segment is focusable (a `div` with `role="img"` when it is not a button) and its **accessible name** is the tooltip's first line (`name · amount · note`); the muted second line is its **accessible description** (`aria-describedby` on the hidden line), so it reaches screen readers too. A segment's fill and border are a layer of their own: fading a segment (the trace) fades that layer only, never the text or the tooltip. The strip does not clip, so the tooltips can reach over the slot grid.

Clicking a slot selects it and clicking it again clears the selection. A double-click on a slot leaves it selected. Escape (heard on the document, so it works wherever focus is, and only when no input or menu handled it) clears the selection, or the trace when nothing is selected. Selection, hover and trace are view state: not saved. Slots are identified by a pane-unique id (the product id in Products, so two products for one item are separate slots; the item id elsewhere).

Segments in the detail bar are interactive (one whose block was deleted is still focusable, so its context menu opens from the keyboard): an `export` or `source` whose block exists, and an unused / self segment, opens that block when clicked; right-clicking a `source`, or an unused / self / deleted-source segment, opens a `RowActionsMenu` with **Limit rate…** (**Change limit…** when the connection has a limit) and **Remove connection** (Ingredients pane only). The second tooltip line: `Sends <item> to <consumer> — click to open`, `<item> from <source> — click to open, right-click to remove`, `Limited: <source> only offers N — …`, `Not used: this block makes or needs none from outside — right-click to remove`, and for a deleted source or a self-connection the corresponding explanation. The label of an `export` or `source` that belongs to a loop ends with ` ↻`, and its second line gets ` — part of a loop` before ` — click to open`.

### Products pane

One slot per block product, in product order. The slot's requirement is `required` = the product's extra output plus what other blocks request of the item (the `requested` of the flows leaving the block; summed over the first product of the item only, as the solver adds it). The slot rate is the actual output (the requirement before the first solve). Segments: one `export` per consumer, `kept` (labelled `Extra`), and `short` when short. There are no pulled-only slots: everything other blocks request is a product.

A product with no extra output and nothing requested, exported or made is an **empty slot** (`SlotModel.empty`, accessible name "<item>, nothing requested yet"): it shows `—` instead of a rate and has no bar, is dimmed and has a dashed border and the tooltip `<item> — nothing requested yet`. An item made only as a coproduct of a product without extra shows what is made, never short.

- Header rates in the strip, never saying "makes": `extra N + requested M → K /unit` (an extra and requests), `requested M → K /unit` (requests only), `extra N → K /unit` (an extra only), or `nothing requested yet` (an empty slot). `extra N` is a button (`Extra output: X/m — click to edit`) that edits the product's extra output inline in the current display unit (Enter or blur commits, Escape cancels and keeps the selection); clearing the input removes the extra. Double-clicking a slot selects it and edits its extra at once. `requested M` is the sum of what other blocks request of the item.
- Segment text (the tooltip's first line, the accessible name, and the bar's name where it fits): an `export` that is a request reads `<block> requests N` when served in full and `<block>: N of M requested` when it got less; a take reads `→ <block> N`. `kept` reads `Extra: N of E` (E is the extra output) or `Extra N` without an extra. `short` reads `Short N` with a note on where the shortfall comes from: `— comes out of the extra`, `— comes out of the extra and <block>'s request`, or `— comes out of <block>'s request` (`<block>'s and <block>'s requests` for several; a block name ending in `s` takes a bare apostrophe). A requester that got nothing has no segment or entry; the Short note names it. Without an extra the actions line ends with **+ Extra output** (a dashed button) that starts editing the extra. In the bar a segment's name drops the trailing ` requests` and colon (`Hub`, `Extra`).
- The actual rate is the item's net balance across all solved nodes; it appears once the solver has a result. When it is below the target (by more than the surplus tolerance for the larger of target and actual, and by an amount that does not round to zero in the displayed precision) the slot gets an amber border and a `▼` badge, and the actual turns amber with a leading `▼` and its tooltip reads "Actual: X/m — short by Y/m"; a met or exceeded product stays teal. Once the solver has a result, a product that no node produces counts as an actual of 0, so it is fully short when something is requested. "Short" compares the product's net balance with `required` (extra plus requested) and does not subtract what the block exports, so a product whose output is partly delivered to other blocks is not marked short for that reason.
- Actions (selected strip): **Find recipe** opens the [recipe picker](#recipe-picker) filtered to recipes producing the item (the chosen recipe is added to the root plan); **Remove extra** (only when the product has an extra output); **Remove product**. Right-clicking a slot opens a `RowActionsMenu` with **Remove extra** (when present) and **Remove product**. Removing a product asks first when it changes other blocks (see below).
- Electricity and Heat are shown in power units: the slot rate, the strip's header rates, the extra output and the segments' amounts read "10.0MW" (the unit is part of the text, whatever the rate-unit toggle) and the slot's accessible name is "Electricity, 10.0 MW" ("Heat, 21.6 MW" for heat). The extra output input is typed in MW and labelled "MW" next to the field (`data-testid="extra-input-unit"`), also in /m mode. The same holds for the Byproducts and Ingredients panes, the connection menu and limit editor (MW), the block graph's chips and the warnings texts.
- `+`, pinned in the pane header so it never scrolls away, opens the [item picker](#item-picker) to add a product (an empty amount adds one without extra output). Adding one asks first when it changes other blocks (see below).

#### Product change confirmation

`ProductChangeDialog` (a `Modal`, `data-testid="product-change-confirm"`, `w-[28rem]`) opens instead of applying the change when adding or removing a product changes how connections of other blocks behave (`productChangeEffects` in `src/store/connections.ts`, texts in `productChangeText.ts`). Adding a product of an item that no other block takes from this one, and removing one nobody uses, apply at once. Otherwise the dialog lists one line per affected connection (`data-testid="product-change-effect"`, consumers in plan order, with the rate delivered now, `—` without a flow); Cancel leaves the plan unchanged.

- Add, heading "Make <item> a product of <block>?", button **Make it a product**: "<consumer> takes existing <item> from this block (<rate>). It will request it instead, so its needs will drive how much this block makes." If this block receives the item itself: "…It would request it instead, but this block receives <item> itself, so it will still only take what is left over." The change is allowed in both cases. A request that closes a cycle of requests needs no extra line: the solver solves the cycle in rounds.
- Remove (only when it is the item's only product), heading "Remove <item> from <block>'s products?" (a bare apostrophe after a block name ending in `s`), button **Remove product** (red): "<consumer> requests <item> from this block (<rate>). It will only take what is left over and no longer drive this block." Connections whose request was already ignored are not listed.

### Byproducts pane

One slot per non-goal item with a positive net balance. The slot rate is the net balance minus what other blocks receive; a leftover counts only above the solver's surplus tolerance for the item's flow (`max(1e-6, 1e-8 × gross flow)`, see spec/solver.md Tolerances; the `left` segment has no further gate of its own) and when it does not display as `0.00` per minute, so LP rounding noise never produces a tile (the rounding check is fixed to per minute, so the tile set does not change with the rate-unit toggle; a surplus that displays as `0.00` per minute gets no tile even if the `overconstrained` warning lists it); an item that is only exported has rate 0. Segments: one `export` per consumer, then `left`. Slots list leftover byproducts first, then export-only items. Header rates: `made N`, the net production. Actions (strip) and the right-click menu: **Add consumer recipe…**, then **Make it a product**, which adds the item as a product without extra output (it never changes what the block makes); it asks first, like any product addition, when another block takes the item from this one.

Right-clicking a slot, or **Add consumer recipe…** in the strip, opens a recipe picker filtered to recipes that take the item as an ingredient. The chosen recipe is added to the block's root plan (even while a sub-factory is expanded). Escape or an outside click closes the menu without opening the picker.

### Ingredients pane

The solver's `unsatisfied` list: everything the block must import (product shortfalls, intermediate slack, raw resources), together with the block's connections and locked items, grouped into one slot per item. Slots are ordered by first appearance: connected items, then imported items, then locked items. The slot rate is the need: what is delivered plus what is still imported. Segments: one `source` per connection that delivers something, then `import`. Header rates: `need N`.

- Actions (selected strip): **Find recipe** opens the [recipe picker](#recipe-picker) filtered to recipes producing the item (the chosen recipe is added to the root plan); **Receive from…** opens `ConnectionMenu` under the button; **Forbid imports** / **Allow imports** (**Forbid imports** is disabled with the title "No recipe in this block makes <item>, so forbidding imports would change nothing. Add a recipe that makes it first." when no recipe row of the block makes the item, see the next bullet). A plain left click on a slot only selects it, locked or not.
- Right-clicking a slot opens `ConnectionMenu` under the slot, except on a product shortfall, which has no menu: products are never fed by connections and have no import slack, so forbidding imports would change nothing (see [solver.md](solver.md)). A lock for a product's item can still exist (the lock predates the product, or comes from saved data); it stays removable, and its menu and strip hold only **Allow imports**. The menu has up to two sections, excluding blocks already connected for that item. **Request <item> from** comes first and lists the blocks that have the item as a product, whatever they offer now (`data-kind="request"`, no rate, title "<block> makes what this block needs"); choosing one adds a [request](solver.md#requests). A request whose source receives the item itself is disabled with the reason as its title ("<source> receives <item> itself"; `requestBlocker`); a request that would close a cycle of requests is enabled. **Take existing <item> from** follows (after a divider when both show) with the blocks that still have the item left over and no product for it (`data-kind="take"`, the offered rate minus what it already delivers to other blocks; a net output within the surplus tolerance of the item's flow counts as no offer, as in the solver, while what deliveries leave of a real offer is shown as it is, because the solver re-checks nothing after them; sources with nothing left are not listed). A block that would close a loop (it already receives from the active block, directly or through other blocks) is still listed in either section, marked with `↻` and, when enabled, the title "Closes a loop: <block> already receives from this block, directly or through other blocks". Choosing one adds a connection to the active block. Connections can also be made from the source side in the [block graph](#block-graph). With no candidate the menu reads "No other block has this item to spare". It is rendered in a portal at the bottom-left corner of the slot or button (so the grid's scrolling cannot clip it) and closes on Escape, a click outside, or a scroll. **Make in a new block…** follows the take entries (not on a product shortfall, nor for an item no recipe makes, such as a raw resource, where the recipe picker would be empty; title "Create a block that makes <item> and request it from there"): it appends a block named after the item with the item as a product (no extra output), makes it active, requests the item from it for the block it was opened on, and opens the [recipe picker](#recipe-picker) filtered to producers of the item, which adds the chosen recipe to the new block. The block stays if the picker is cancelled. After a divider come, when the item has a connection the solver honours (one whose source block exists and is not the block itself) or already has a sourcing mode (on a product of the block with a leftover mode, only **Own recipes first** is enabled), the three sourcing choices **Own recipes first**, **Byproducts first** and **Connections first** (`role="menuitemradio"`, `aria-checked`, a `•` on the current one; set `itemSourcing`, see [solver.md](solver.md#connections-first); closes the menu; the slot shows no marker; the same choices are on item chips in the [production table](#item-chip-sourcing-menu)), and another divider, then **Forbid imports** (adds the item to the block's `noImportItems`, so the solver never imports it) or, for a locked item, **Allow imports**. **Forbid imports** is disabled, with the same title as in the strip, when no recipe row of the block makes the item (`forbidImportsTitle` in `src/components/factory/itemSourcing.ts`, shared by the menu and the strip, on top of `blockMakesItem` in `src/solver/index.ts`, which applies the solver's own test: a product counts only with an effective amount above 0, so probability 0 does not): such an item is raw in the block, has no LP row, and a lock would change nothing. An item the rows only consume (ingredient or fuel) is raw too. A goal item with no row is not offered Forbid at all (it is a product, see above). **Allow imports** is never disabled, so a lock set earlier (or kept from saved data) can always be lifted. An ore or pumped fluid becomes lockable once the block has its extraction row.
- Connection states: normal (a `source` segment in the source's colour); `limited` (amber border and `!` badge on the slot, title "Limited: <source> only offers N", or "Limited by this connection's limit of N" when the connection's limit is the bound; the rest of the need stays in the `import` segment); `unused` (dashed overlay, slot dimmed when nothing else is shown, title "Not used: …"); `(deleted block)` or `← <source> · self, ignored` (dashed overlay). A connection whose first solve has not landed draws nothing yet. Remove a connection by right-clicking its segment or key entry (undoable). That menu holds **Limit rate…** / **Change limit…** and **Remove connection**. The limit action closes the menu and opens `ConnectionLimitEditor` (a portalled `RateInput`, `Connection limit`, at the click position; Enter or blur commits in items/min through `setConnectionMaxRate`, an empty field clears the limit, Escape cancels; undoable; the editor closes without writing when the pane scrolls, the window resizes or loses focus, or the connection or active block changes), the same limit as the graph's **≤** control. The segment of a request has the title suffix ` — requested` before ` — click to open` (`Segment.requested`).
- A locked item shows grey hatching across the bar, a `⊘` badge and a dimmed slot; its key entry reads "Imports forbidden".

### Warnings popover

`WarningsPopover` (in `TableToolbar.tsx`), in the [table toolbar](#table-toolbar), just before the totals; below `md` its list is anchored to the toolbar and spans its width, so it stays on screen. A `⚠ N warnings ▾` pill (`aria-haspopup="dialog"`,
`aria-expanded`; below `md` the compact `⚠ N`, with 8px of side padding instead of 10 and no arrow: the words stay in the accessible name, visually hidden), amber, or red when any warning is
`infeasible-pins`; it renders only while the last solve produced warnings. Clicking it opens a list where each warning has a title, an
explanation naming the items or recipes involved, and a hint:

| Warning | Title |
|---|---|
| `no-recipe` | No recipe in plan |
| `duplicate-recipe` | Duplicate recipe — with a **Fix: remove duplicates** button that keeps the first node using the recipe (a plan's own nodes before its sub-plans, as the solver does) and removes the others; until then a duplicate row shows zero. In a block with areas the warning has an area: the body names it ("appears on N rows in <area>"), the hint is to remove the duplicates from that area or make one of their sub-factories a separate area, and the fix touches only that area's rows, never the same recipe in another area |
| `area-shortfall` | Area can't cover its own need — amber; one sentence per entry, "<area> takes <rate> of <item> from other areas, though it has its own row for it", with the hint to unpin that row or allow imports of its inputs |
| `infeasible-pins` | Pinned rate is impossible |
| `overconstrained` | Recipe network can't fully balance |
| `coproduct-driven` | Recipe runs for its co-product — amber; one sentence per recipe, "<recipe> runs mainly to make <items> as a co-product. Its other outputs would only need <about N% / under 1%> of its current rate, so the rest of them is surplus.", with the hint to add an extraction or other row that supplies the co-product, set it to Byproducts first (right-click its chip) or pin the recipe's rate |
| `loop-not-converged` | Loop between blocks did not settle — amber; names the blocks around the loop and the rounds run, with the hint to remove one of the loop's connections or set a limit on one |
| `request-loop-not-converged` | Requests around a loop do not settle — amber; names the blocks around the loop and the demand rounds run, says the requests that close the loop only take what is left over, with the hint to set a limit on one of the loop's requests or remove one |
| `temperature-mismatch` | Fluid temperature does not fit — amber; "Steam Turbine (Steam) needs Steam at ≥465°C, but it is only supplied at 165°C." (heat works the same way: "Heat exchanger 4 (Heat) needs Heat at ≥765°C, but it is only supplied at 750°C."; several supplied temperatures are comma-separated), with the hint to use a boiler or recipe whose output is in range or connect a block that makes it at the right temperature. When the solver imports the fluid because nothing in the block makes it at a fitting temperature (the import shows in the Ingredients pane), the sentence says so: "Steam Turbine (Steam) needs Steam at ≥465°C, but it is only made at 165°C, so 666.67/min is imported.", adding " and the 60/min made is left unused" when the block makes some of it that nothing takes (a pinned boiler); rates follow the rate-unit toggle |

The popover closes on Escape or a click outside.

---

## ProductionTable

`ProductionTable.tsx` renders the active block's recipe tree, and the [side panel](#side-panel) beside it.

- Without game data: "Load game data to begin".
- With no nodes: "No recipes yet" (the toolbar's `+ Recipe` button is the way to add one). When the [filter](#table-toolbar) matches nothing, the table gives way to `No rows match "<query>"` and a **Show all rows** button.
- Otherwise: the [table toolbar](#table-toolbar) above a table with a sticky header, then rows. The table is 900px wide at the 1280px reference width and the panel 380px; with no row selected the table takes the full width. The table is at least 730px wide (the sum of the column minimums); when its wrapper is narrower, the wrapper scrolls horizontally while the sticky header stays at its top. Above 730px the free width is shared by the Recipe, Byproducts and Ingredients columns in the proportions 3 : 2 : 4 (Products is fixed), on top of their minimums (see [Columns](#columns)). Below 768px the table has no Machine and Beacons columns and is at least 554px wide (see [Narrow screens](#narrow-screens)).

The toolbar's `+ Recipe` button opens the
[recipe picker](#recipe-picker); the chosen recipe is appended to the block's root
plan as a new node with default settings.

### Table toolbar

`TableToolbar.tsx` (`factory/`) is the row just above the table, 44px high, shown whenever game data is loaded. It is separate from the [TopBar](#topbar), which it does not change. From left to right:

- **`+ Recipe`** (teal, `aria-label` "Add recipe"): opens the recipe picker. It is the only add button for rows. Below `md` it, the unit switch, the counts and the pill never wrap or shrink (`max-md:whitespace-nowrap`, `max-md:shrink-0`): the toolbar is one line high at 416px. From `md` they behave as before.
- **Filter**: a search field, "Filter recipes or items" (hidden below `md`). The query is local state of the production table: it is not persisted, and it resets when the active block changes, when a reveal request for a row of the block arrives (Build also in…, Go to row in…; a request for a row that is not there leaves it alone) and when a recipe is added from the picker (the filter could hide the new row). It is trimmed and matched case-insensitively as a substring (`data/search.ts`, the recipe picker's rule) against a recipe row's recipe name or id, its ingredient and product item names or ids (byproducts included) and a group's name. Machines, modules and rates are not matched. A blank query filters nothing. The rows that stay are the matching recipe and group rows, every row inside a group whose name matches, and the ancestor groups of any row that stays (`factory/tableFilter.ts` computes them). While a filter is active a group is open exactly when it has a row that stays, or when it stays because its name matches and it is empty (so its "Drop here" target shows); the user's own expanded groups are ignored and left untouched, so clearing the filter restores them, and a group's chevron is disabled meanwhile (title "Groups open automatically while filtering"). Rows keep their positions in the full list, so drops act on the whole block; Move up / Move down are disabled while filtering (title "Clear the filter to reorder rows"), because a swap with a hidden sibling would look like a no-op. Next to the field, whenever the query is non-blank (also below `md`), `role="status"` text (`data-testid="table-filter-status"`) reads "N of M rows hidden", M being every recipe row and every group row (the handle itself, so it can exceed the recipe count above) of the block at every depth, collapsed or not; below `md` the visible text shortens to "N hidden" (the full sentence stays for assistive technology), followed by a **Clear** button (`aria-label` "Clear filter"). Escape in the field clears a non-empty query. The selected row stays in the side panel even when the filter hides it.
- **`/min | /sec`**: a segmented control (`role="group"`, "Rate unit") that switches the rate unit: the unit is stored in `uiStore` and persisted, the default is per minute, and it changes how every rate in the summary and the table is displayed (stored values are always per minute). The pressed segment is the current unit.
- **Totals**, right-aligned, over the whole block at every depth. The [warnings pill](#warnings-popover) (compact below `md`; only while the last solve produced warnings) opens the first of them, before the recipe count: the recipe rows (`data-testid="block-recipe-count"`, "1 recipe" / "N recipes"), the machines (`block-machine-count`, the sum of each row's rounded-up machine count; hidden below `md`), and the power (`block-power-total`, ⚡ with auto-scaled W / kW / MW / GW, hidden when zero). The power total is the sum of every solved row's power draw.

There is no Tree / By recipe toggle: the by-recipe view is slated for removal.

Row order is the order of the nodes in each sub-plan. The table is not sortable;
the user arranges rows by drag-and-drop or the ▲/▼ buttons.

### Columns

The reorder column comes first (▲/▼ buttons), then:

| Column | Content |
|---|---|
| Recipe (min 150px) | The recipe icon and name (a button), one 12px tree guide per nesting level. |
| Machine (88px) | The machine chip (count in its corner), then the module chip (used / slots). |
| Beacons (88px) | The beacon chip (count) and its module chip (modules per beacon / slots); two dashed placeholders, the beacon `+` and its module slot `+ 0/N`, when the row has no beacon. |
| Products (72px) | The single product chip, left-aligned (it sits above the items a collapsed area sends); wide enough for the header and the chip's pin badge. |
| Byproducts (min 80px) | Byproduct chips (red rates). |
| Ingredients (min 148px) | Ingredient chips (green rates), left-aligned in the column, the first one 28px in from the cell padding (36px from the column's left edge, `INGREDIENTS_PADDING_LEFT` in `treeGuides.ts`), at the same x as the first item a collapsed area receives; the header is left-aligned at the same offset. The largest share of the free width. |
| Power (72px) | The row's power (cyan, right-aligned). The block's total power draw is in the [table toolbar](#table-toolbar), not in this header. A burner row with fuel data draws none (its fuel is an ingredient), so it adds nothing. |

The table is `table-fixed` with a `<colgroup>` (`COLUMNS` in `ProductionTable.tsx`, widths include the cell padding), so the content of a row never moves the columns. Reorder, Machine, Beacons, Products and Power are fixed; the other three are their minimum plus a share (weights 3 : 2 : 4) of the width beyond the 730px table minimum, computed with `calc()` on `cqw` (the table's scroll wrapper is an inline-size container; a percentage inside a `<col>` calc is ignored by browsers). Container query units in a `<col>` need Safari 16+ / Firefox 110+ / Chrome 105+; older browsers drop the declaration, and the three shared columns then split the leftover width equally (no fallback is provided). The container's layout containment would also make a `position: fixed` descendant of the wrapper position against it; popups are portalled to `body`, so none exists. A chip slot is 38px (a 32px icon and a 6px gap), so `n` chips need `38n - 6`px inside a cell's 16px of padding: Products holds exactly one (its fixed 72px), at the minimum Byproducts holds 1 chip per line and wraps beyond, Ingredients 2 (the 28px indent costs one slot); at 1470px with the panel closed Byproducts and Ingredients hold about 5 and 10.

Below 768px the Machine and Beacons columns are gone: see [Narrow screens](#narrow-screens).

Products, Byproducts and Ingredients are adjacent on purpose: everything a machine outputs reads together, then what it consumes. There is no column picker and no by-recipe view. A cell that holds chips never uses `overflow: hidden`, which would clip their badges.

### Narrow screens

Below 768px (`md`; `useNarrowTable.ts` follows the media query `(min-width: 768px)`) the production table changes shape. The Machine and Beacons columns are dropped (`NARROW_COLUMNS` in `ProductionTable.tsx`): the table's minimum width is 554px (32 + 150 + 72 + 80 + 148 + 72) and the shared columns split what is beyond it as usual. The columns come back at 768px, so a phone held sideways or a tablet keeps the full table.

- **Recipe rows** hold their machine, module and beacon chips on a line under the recipe name (`data-testid="row-machine-stack"`, 2px between its chips). A recipe row has one fixed height, 73px (37 + 36): two lines of 32px chips (4px between the lines, the cell's 4px of padding, the 1px border) hold the Byproducts and Ingredients chips, and a row with fewer chips is as high. A column with more chips than two lines hold shows one fewer than they hold and a `+N` in the last slot (`ChipColumn` in `RecipeRow.tsx` counts with `chipsInLines` from `oneLineChips.ts`; at the 554px minimum, Byproducts holds one chip per line and Ingredients two). Products always holds exactly one chip. The stack of four chips (machine, module and the two beacon chips) is 134px wide, and the Recipe column holds 134px at the 554px minimum, so the narrow indent is 2px per nesting level instead of 12 (`NARROW_GUIDE_WIDTH_PX` in `treeGuides.ts`, guide lines included): at the nesting limit the stack ends exactly at the cell's right edge, never on the Products chip.
- **The `+N`** (`RecipeChipsMore.tsx`, `data-testid="recipe-chips-more"`, `aria-label` "N more byproducts" / "N more ingredients", 32px wide) opens on click a dialog (`role="dialog"`, named "More byproducts" or "More ingredients", `data-testid="recipe-chips-popup"`) under the button and 16px to its left, above it when there is no room, clamped to the screen (`anchoredBelow` in `anchoredPosition.ts`); the dialog has a Close button and lists only the hidden items, one per line: the chip, the name and the rate. The chips in the list are the row's own chips (`renderChip` of `ChipColumn`) and do what a visible chip does: a hidden ingredient finds its producer recipe, a hidden byproduct becomes the primary product (or toggles feed-back / discard on a single-output recipe), and right-clicking a hidden byproduct opens its "Add consumer recipe…" menu; the chip's tooltip names the exact rate, the sourcing badge and the fuel mark are drawn as on a visible chip. A press on a chip closes the list (so does a right-click that opened a menu, which would otherwise lie under the list). Escape, Close, a press outside, a scroll, a resize or focus moving elsewhere close it; opening it does not select the row. It is `useHoverPopup` in its `click` mode (no hover or focus opening): the dialog takes focus when it opens (it is focusable itself, then Tab walks Close and the chips), the button carries `aria-controls`, and closing by Escape, Close or the button gives focus back to the button (a press outside leaves focus to what was pressed; Tab past the dialog closes it and focus stays where it went). When the dialog fits neither under nor above the button (a short landscape screen) it takes the side with more room and scrolls inside that room (`maxHeight`), so it never covers its button. The `+N` of a collapsed area row uses the same placement (and the same height limit).
- **Group rows** have a name cell of one column (the 176px of empty space the Machine and Beacons columns gave it are gone): the summary ("3 recipes · 5 machines") is on a line of its own under the name, 10px, indented to start under the icon; a group row keeps its 37px minimum height. The sent items span the Products and Byproducts columns as before (152px), the received items the Ingredients column.
- The drop zones span the six columns.

### Icon chip

`IconChip.tsx` is the one component for every icon with a number in the table (item, machine, module and beacon chips): the icon, a quantity in its **bottom-right** corner (as Factorio draws stack counts), optional badges in its **top-right** corner and an optional label in its top-left corner (a temperature requirement, orange). Every icon is 32px, so an item chip takes a 38px slot with the 6px gap. An item chip (`size="item"`) sits on a faint **plate** (`rgba(148,163,184,0.09)` fill, 5px radius, a 1px inset ring of `rgba(148,163,184,0.10)`, so dark icons such as coal do not read as holes) and writes its quantity in 11px bold monospace outlined in black (a 1px text-shadow in four directions); a machine, module or beacon chip (`size="entity"`) has no plate and a 9px quantity. With an `onClick` the chip is a button; `warn` draws an amber ring; `empty` draws a dashed outline and a `+` instead of the icon. An empty chip with `quiet` (the module and beacon placeholders of a table row) is a **quiet placeholder**: gray-700 border and gray-600 glyph at rest (the `+` and the `0/N` share the glyph colour), gray-600 and gray-400 while its row (`group/row` on the `tr`) is hovered, selected (`data-selected`) or holds the keyboard focus, and gray-400 and gray-200 on the placeholder itself (hover or `focus-visible`). It is never hidden, so a touch screen shows the same faint placeholders. A disabled placeholder (the Beacons cell when the research horizon allows no machine, beacon or module) is not quiet: it keeps the plain dashed chip at 40% opacity and never brightens on its own hover or focus. The placeholders of the side panel's module slots are not quiet. The collapsed summary line also draws `IconChip`s (`LineChip` in `SummaryLine.tsx`).

**Chip quantities.** `chipFmt` (in `ItemTile.tsx`) writes the rate on an item chip so that it always fits the corner: from 10000 whole thousands (`12k`), from 1000 one decimal (`1.1k`, `.0` dropped), from 100 no decimals, from 1 one decimal, from 0.01 two decimals without the leading zero (`.05`), below that `<.01` (an exact zero reads `0`). Thresholds apply to the rounded value (0.996 reads `1.0`, 999.6 reads `1k`); from a million the pattern continues with `M` and `G` and from 999.5 G (or Infinity) it reads `>999G`; NaN and negative values read `?`. Electricity and heat keep their power units but drop the decimal from 10 up so they stay within five characters (`1.5MW`, `10MW`, `100kW`, `999W`; a value that rounds to 1000 takes the next unit, `1.0MW`; `>999G` beyond); the tooltip keeps the exact value (`10.0MW`). The chip's tooltip keeps the exact rate through `fmtItemRateText` (`Purified water — 14100/m`, `Cobalt steel — 1.6e-6/m`); `fmtRate` is unchanged and used everywhere else.

- Bottom-right is always a quantity: an item rate (the number only; the tooltip adds the unit), the machine count, a module chip's used / slots, a beacon count, a beacon module chip's modules per beacon / slots. An energy item (electricity, heat) shows its value with its power unit.
- Top-right is always a badge: an amber pin (`data-testid="chip-pin"`, the product's rate is pinned), a lavender `+N` (`chip-more`, the row has N more beacon configurations besides the first; never shown while a row holds at most one), an amber `B` or `C` (`item-tile-sourcing`, the item is not sourced from Own recipes first).
- A chip without an icon shows the first two letters of its name (⚡ for electricity).

`ItemChip.tsx` is the item chip on top of it: the item's icon, its rate in the rate unit, a tone by variant (product, byproduct, ingredient; the chip carries `data-variant`), the pin and sourcing badges and the temperature label. Its title is the item name, then the sourcing mode when there is one (" (byproducts first)", " (connections first)"), then " — " and the rate with its unit.

### Recipe rows

`RecipeRow.tsx`, one per `GameRecipeNode`. Nodes whose recipe does not exist in the loaded data render nothing. Every row (recipe or sub-factory) carries `data-node-id`.

**Selecting.** Clicking a row anywhere that is not a button, field, label or menu selects it (`data-selected="true"`) and opens the [side panel](#side-panel). A selected row, recipe or group, is drawn the same way: a full-row teal tint (`rgba(20,184,166,0.22)`, teal-500 at 22%, which replaces a group's depth tint), a 3px inset bar on the left of the reorder cell (`#2dd4bf`, teal-400), a 1px inset outline around the whole row (`rgba(45,212,191,0.65)`, `outline-offset: -1px`) and a white, bold name. Hover does not repaint a selected row, and the flash of a just-revealed row draws its own outline instead of the selection's. Selecting changes no size. The recipe icon and name is a button (`aria-pressed`), the keyboard path to the same selection. The chips and menus keep their own behaviour and do not select the row.

**Reorder cell.** ▲/▼ move the node within its sub-plan (disabled at the ends). They are `text-gray-400`, 3:1 on the row.

**Recipe cell.** The icon of the primary product (falls back to the first two letters of the recipe name) and the recipe name (ellipsis, the name as tooltip), indented by one 12px guide per nesting level (`data-guide-levels`; see [sub-factory rows](#sub-factory-rows)). Byproduct-consumer rows carry a small amber "↓" badge at the icon's bottom-right corner, whose tooltip explains the mode. In a block with areas, a recipe that has rows in two or more areas also carries a count badge (`data-testid="multi-area-badge"`, teal, the number of areas) after the name. Its tooltip names the recipe and splits its buildings per area: "Electrolysis: 15 buildings (13.6 exact) in 3 areas: 5 here, 5 Plastics, 5 Rocket fuel" ("here" is the row's own area and comes first, the others follow in table order, the root is "Top level"; several rows in one area are summed, a row with no solve result counts as 0). The badge is display-only.

Right-clicking anywhere in the recipe cell opens a context menu
(`RowActionsMenu.tsx`, portalled to `document.body`, sized to its content and
clamped to the viewport; an item with a `checked` state is a `menuitemcheckbox` with a leading ✓, or a `menuitemradio` with a leading • when it is one of a set of exclusive choices; an item can have a separator above it) with:

- **Absorb byproduct** / **Stop absorbing byproduct** — "only run to absorb
  byproduct from other recipes" (sets `byproductConsumer`).
- **Pin rate** / **Unpin rate** — pins the recipe at its current throughput (at
  least 1); omitted on byproduct-consumer rows. The product chip then carries the pin badge, and the rate is edited in the panel's [Rate section](#rate).
- **Wrap in subfactory…** — prompts for a name (defaults to the recipe name) and
  replaces the row with a new sub-factory containing just this node. Disabled with the title "Cannot nest deeper than 4 levels" when the new group would sit past the [nesting limit](#nesting-limit).
- **Build also in…** (blocks with areas only) — adds a copy of this row to another area (machine, modules, beacon configurations, neighbour count, byproduct policy and primary product; not the pin).
  It is disabled when no area qualifies, with the title "No other area uses <item>
  without a row of this recipe", or "Waiting for the solve" while the row has no solve
  result (right after turning on Separate area, or when the solve failed). An area qualifies when its rows (including those in
  organising groups inside it) consume the row's primary product (above a negligible
  rate) and it has no row of the same recipe yet; an area that makes the item with a
  different recipe is still offered. Choosing it opens a second menu with one entry per
  area, "<area> · uses <rate>/m" (or `/s`, the area's total consumption of the item in
  the current rate unit). Picking one appends a row to that area's own rows with the
  recipe, machine, modules, beacon configurations, byproduct policy and primary product, deep-copied;
  the pin and the byproduct-consumer flag are not copied. It is one undoable command.
  The table then reveals the new row (see **Go to row in…**).
- **Go to row in…** (shown when at least one row can be revealed) — opens a second menu
  listing this recipe's rows in the other areas, one entry per row in table order,
  "<area> · N building(s)". Rows in a sub-plan without a handle in the table cannot be
  revealed and are left out (the badge still counts them).
  Choosing one expands the sub-factories above that row, scrolls it to the centre of the
  table and highlights it (`data-highlighted="true"`, a teal outline) for two seconds. The
  request is transient (`uiStore.revealRowRequest`, handled by the table of the active
  block; a request made before the table mounted is ignored).
- **Remove recipe** (red). Removing the selected row closes the panel.

The menu closes on an outside click, Escape, scroll, window blur or after choosing
an item.

**Machine column.** `MachineCell` is the machine chip (`data-testid="machine-chip"`, the machine's icon with the rounded-up machine count in its corner, titled with the machine's name). Clicking it opens the [machine picker](#machine-picker) under the chip (`aria-expanded`). An explicit machine outside the research horizon gets an amber ring and the title "<name> (beyond research horizon)" (`data-beyond-horizon`). When no machine is inside the horizon the chip shows the `?` placeholder with count 0, an amber ring, the title "No machine within research horizon" and `data-no-machine`.

`ModuleCell` follows it (`data-testid="module-chip"`) whenever the machine has slots or modules are configured, so leftover modules stay visible. Its corner reads `used/slots`. With modules it shows the icon of the most used module type (on a tie the first by module id) and a click selects the row and highlights the panel's Machine section (slots can hold mixed modules, so there is no quick picker). With none it is a dashed `+` chip reading `0/N` (title "Fill all N slots with a module") whose click opens a **fill-all picker**: the modules the machine accepts, headed "Fill all N slots with"; choosing one puts that module in every slot. It is ringed (amber) in three cases, each with its own title: the row has no machine in the horizon ("Modules without a machine", `data-beyond-horizon`, no picker); a module is outside the horizon ("Edit modules (beyond research horizon)", `data-beyond-horizon`); or the modules outnumber the slots (`data-over-slots`, "Edit modules (more modules than slots)", or "Edit modules (this machine has no module slots)" for a real machine with 0 slots). The plan and the solver are untouched: the solver applies every configured module (except the productivity of a recipe that disallows it and effects the machine's `allowedEffects` lacks), so the flag is the only sign of an overfilled row.

**Beacons column.** `BeaconCell` (in `BeaconPopover.tsx`) takes the row's beacon configurations (`beaconConfigs`) as a list; it shows the first and a lavender `+N` badge on the beacon chip counts the others (the chip's tooltip lists them all). Filling a module in the dashed module chip changes the first configuration only.

- Without a beacon, two dashed placeholders sit side by side, like the Machine cell: the beacon `+` (title and name "Add beacon") and its module slot `+ 0/N` (name "Add beacon module", `N` the slots of the default beacon type). Both open the same fill-all picker headed "Add 4 × Beacon, fill its slots with", listing the modules the default beacon type accepts. Choosing one creates a configuration with the first non-hidden beacon type inside the research horizon (by name), 4 beacons and that module in every slot, as one command. Both placeholders are disabled, with a title giving the reason, when the row has no machine within the horizon ("No machine within research horizon"), no non-hidden beacon is inside it ("No beacon within the research horizon") or no module is ("No module within the research horizon"; only when a horizon is active).
- With a beacon, the **beacon chip** (the beacon's icon, `N` beacons in its corner; title "Edit beacon") and the **beacon module chip** (`data-testid="beacon-module-chip"`, the module's icon, modules per beacon over the beacon's slots; title "<module> × N per beacon") follow. Both open the panel on the highlighted Beacons section. A configuration without a module (the beacon's `moduleId` is optional) shows the beacon module chip as a dashed `+` reading `0/N` (title "Beacon without a module"), whose click opens a fill-all picker headed "Fill its slots with" limited to the modules the beacon accepts (speed and efficiency, never productivity); it contributes nothing to the row until it has a module. With several configurations, the chips show the first and a `+N` badge; the beacon chip gets the amber ring when any configuration's type or module is outside the horizon.

**Products column.** The output that counts as the primary product (`primaryProduct`, else the recipe's `mainProduct`, else its first product), as an item chip. The cell holds at most that one chip; every other output is a byproduct. A pinned row's chip carries the pin badge; the pinned rate is not editable in the table. A product chip has no right-click menu and no click action.

**Byproducts column.** Every other output, as chips. On multi-output recipes, clicking a byproduct makes it the primary product (it swaps places with the current one). In a block with areas the chip's tooltip adds "; the primary product decides what this row builds for its area" after "Set as primary". Right-clicking a byproduct chip opens a `RowActionsMenu` with the single entry **Add consumer recipe…** (when the row can add one), which opens the recipe picker filtered to recipes consuming that item; the chosen recipe is added to the same sub-plan as the row. The chip's tooltip hint reads "; right-click to add a consumer recipe" when the row can. The menu follows the same closing rules as the recipe-cell menu, and only one of the two is open at a time. A single-output recipe's rare byproduct chip toggles its feed-back / discard policy on click.

**Ingredients column.** Every input as a chip with its rate. Clicking one opens the recipe
picker filtered to recipes producing that item; the chosen recipe is added to the
same sub-plan as the clicked row. For a raw ore or pumped fluid in a data set with extraction data this lists its mining or offshore-pump recipe, so clicking the chip adds the drill or pump row. When the row's recipe sets a temperature bound on an ingredient, its chip shows it in the top-left corner in orange (`≥95°C` minimum only, `≤30°C` maximum only, `125–165°C` both, `95°C` when they are equal); values are rounded to one decimal, a minimum above the maximum is shown as given (not validated), and bounds at or beyond ±1e30 count as unbounded. The chip title includes it (e.g. "Steam (125–165°C) — Find producer recipe"), and a recipe that lists the fluid twice with different bounds shows both, comma-separated. Product and byproduct chips show the same orange label, and their title adds it (e.g. "Steam (165°C)"; a multi-output byproduct reads "Steam (165°C) — Set as primary…"), only when the recipe sets an explicit `temperature` on that product (a fluid at its default temperature shows none). The solver reads the bounds only for the `temperature-mismatch` warning; the summary, goals, item picker and block graph do not show temperatures. A burner row's fuel is one of these inputs: its chip is marked `data-fuel="true"` and titled "Fuel: <name> — Find producer recipe", and the row has no power. An ingredient chip has no right-click menu.

**Power column.** The row's power draw (`data-testid="row-power"`, auto-scaled W / kW / MW / GW) when it is above zero. A power generation row, or a burner row with fuel, draws nothing: its output is the electricity product chip, in power units.

**Sourcing badge.** A chip whose item has a sourcing mode other than the default shows an amber `B` (byproducts first) or `C` (connections first) badge in its top-right corner (`data-testid="item-tile-sourcing"`, `data-sourcing`). The mode is set in the panel's [sourcing section](#sourcing), not from the chip; the `B` / `C` badge and the title suffix are its only trace in the table.

Rates come from the last solve; before a solve (or for a row the solver did not
reach) the rate cells are empty and the machine count is 0.

### Side panel

`sidePanel/SidePanel.tsx`, an `aside` (`data-testid="side-panel"`, `aria-label="Row details"`) 380px wide at the right of the table from `xl`. Below `xl` it is a drawer: `position: fixed` against the right edge, `min(300px, max(200px, viewport − 140px))` wide (300px from 440px up, 250px on a 390px phone, 200px at the narrowest), so the first columns of the selected row stay visible beside it, above the table, with a dimmed backdrop (`data-testid="side-panel-backdrop"`) under it that clears the selection when clicked (not when the press only dismissed a picker, menu or popover opened over the drawer: `useDismiss.ts` samples, in a window capture listener installed before any overlay's own listener, whether a `useDismiss` user or a `useOverlayOpen` registrant (the row and connection menus, the block tab menu, `MenuButton` panels, `Popover`, the warnings popover) was open when the press began, and the backdrop's click honours that sample for pointer clicks only; a keyboard click always closes the drawer. A new overlay that closes itself on an outside press must call `useOverlayOpen`; hover popups are not registered, as a press on the backdrop never starts over their trigger), so the table does not resize. While the drawer is up the backdrop also covers the top bar and the table toolbar: the first tap there only closes the drawer. Both sit below modals and pickers. It exists only while a row is selected: there is no empty state, and the close button (✕, "Close panel") clears the selection and gives the table its full width. Opening it does not move or resize the rows. Selection is transient UI state (`uiStore.selectedRow`: a block id and a node id); the panel of another block, or of a node that no longer exists, counts as none and the selection is cleared (removing the selected row closes the panel). Escape closes the drawer (a window capture listener in `SidePanel`, active only below `xl`: docked, Escape keeps its other meanings and does not clear the selection). It yields to anything that handled the key or is open: a menu, popover or picker registered through `useDismiss` or `useOverlayOpen` (`ItemPicker`'s frame and `Modal` register too, and mark their Escape handled), so one Escape closes only that overlay and the next one closes the drawer. The drawer has no focus management yet (no focus trap, no `aria-modal`: Tab still reaches the table behind the backdrop); that is in the backlog. Nothing inside the panel makes it wider than the drawer: the beacon card's first line wraps, the Where-inputs-come-from segments wrap their labels, and the Effects grid scrolls inside its own box in a narrow drawer.

The panel shows exactly one of a recipe row, an organising sub-factory or a separate area. Its header shows the title (`data-testid="panel-title"`) with the row's icon.

#### Recipe panel

Sections in order, each a `section` with a heading:

1. **Header.** The primary product's icon, the recipe name, and "Absorbs byproduct" for a byproduct-consumer row.
2. <a id="rate"></a>**Rate.** The **Pin rate** switch (a native checkbox with `role="switch"`, `data-testid="pin-checkbox"`, laid invisibly over a 34 × 20px track that is gray-700 off and teal-500 on, followed by the label; disabled with a title on a byproduct-consumer row that is not pinned: "A row that absorbs a byproduct runs on surplus and cannot be pinned"). While pinned, a number input (`aria-label="Pinned rate"`, 90 × 26px) with the unit (the primary product's rate in the current rate unit; MW for an electricity or heat row; stored as executions per minute, the typed rate divided by the primary product's items per run, productivity included) sits on the same line as the switch, 16px after it and 8px before its unit; the sentence "The row always runs at this rate, whatever the block needs." is the group's tooltip and, for touch and screen readers, a visually hidden description of the switch while pinned (`aria-describedby`). The section has the same height pinned or not, at every width: the input group's 118px slot (90px input, 8px, 20px unit) is reserved while unpinned, and "= N runs/min" (`data-testid="runs-per-min"`, always shown) sits on the same line from `xl` (the 380px panel) and on its own line below the switch in a drawer. In a drawer narrower than about 255px (a viewport under about 395px) the input group wraps below the switch, pinned or not. Pinning starts from where the row runs now, at least 1. When the node is unsolved or solved at zero throughput, the last positive solved factor is reused (declared product amounts only if there never was one), so the value does not jump.
3. **Machine.** The machine picker button (`data-testid="machine-picker-button"`: the 32px machine icon and a chevron, the machine's name as tooltip, `aria-expanded`), beside it "N needed" and "X exact · Y% busy"; the machine's name below, with the "Beyond research horizon" tag (amber) for an explicit machine outside the horizon. With no machine in the horizon: "No machine within research horizon: machine count and power are 0 for this row. Module and beacon productivity still applies to the output rates." (amber, and the button is ringed). Then, when they apply:
   - **Fuel** (only when the machine burns fuel, `energyType: 'burner'` or `'fluid-burner'`; a fluid-burner lists fluids): a picker button (`fuel-button`: icon, name, value in MJ or kJ) resolved with `resolveRowFuel`. Its list holds **Default** (`fuel-default`, "Default (<fuel name>)": the lowest-value accepted fuel inside the research horizon, the lowest overall when none is inside) and the machine's accepted fuels inside the research horizon (`fuel-option`, `data-item-id`, lowest value first). Choosing one stores it as the row's `fuelItemId`, **Default** clears it; both are undoable. An effective fuel outside the horizon carries the "Beyond research horizon" marker and is not listed. A burner whose data set has no fuel data (for a fluid-burner: no fluid with a fuel value) shows "No fuel data in this data set" (`no-fuel-data`) instead, and the row keeps its ⚡ draw; a machine with fuel categories whose every accepted fuel is excluded (burnt result, hidden) shows "No usable fuel for this machine" in the same slot, as does a fluid-burner whose data set has fluid fuels but none the machine accepts.
   - **Neighbours** (only when the machine has `neighbourBonus > 0`, i.e. a reactor): a layout builder (`neighbour-section`). The player draws one rectangular cluster of reactors: **Wide** and **Deep** steppers (`neighbour-cols`, `neighbour-rows`; 1–30, typed or stepped, a typed value outside the range is clamped, other text stays until blur) and a drawing (`neighbour-grid`, `role="img"`). Each 40 px tile shows how many reactors share a side with it (0–4, diagonals do not count), coloured by that number. An axis longer than 5 is folded into five tracks (the first two, a gap marked ⋯ / ⋮ / ⋱, the last two); the numbers come from the real positions and the average always uses the full size. The average of the drawing, `2 × (cols × (rows − 1) + rows × (cols − 1)) / (cols × rows)`, is what is stored in `neighbourCount` (an exact ratio; 1 × 1 stores nothing). The size is UI state and is not persisted: reopening finds the rectangle whose average equals the stored count (smallest area, then the most square, then cols ≤ rows; no stored count opens as 1 × 1) and, when none matches, opens in own-average mode. Below a rule, **Not a rectangle?** is a number input (`neighbour-count`, accessible name "Neighbouring reactors", 0–4) that shows the drawing's average and takes the player's own. Typing a valid own value saves it, dims the drawing ("Not used: you typed your own average below.") and offers **Use the drawing**; changing a size does the same. Text outside 0–4 shows "A reactor has four sides, so use a number from 0 to 4." and is not saved (the schema accepts any non-negative number, and a stored value above 4 is kept and flagged); on blur the field reverts to the stored value. Every valid change is saved at once and is undoable (0 clears it). A result strip shows the average, "Each neighbour adds +N %" (from the machine's bonus) and the heat per reactor (`neighbour-multiplier`, "×N" = 1 + bonus × average). Switching to a machine without a bonus hides the section; the count is kept but ignored.
   - **Modules** (when the machine has slots or modules are configured): "N / M slots used" (amber when over) and one button per slot (`data-testid="module-slot"`, 32px chips; dashed when empty). A slot opens a [picker](#pickers) headed "Module" with **Empty slot** and the modules that slot may take. The machine's modules are stored as `{ moduleId, count }` entries; the slot buttons are a view over them, so slots can hold mixed modules. Only modules inside the research horizon whose effects the machine allows (and whose recipe limitations permit the recipe) are offered, and a module with a positive productivity effect only when the recipe allows productivity; the total never exceeds the machine's slots when choosing. A slot past the machine's slot count (more modules than slots) is ringed amber and titled "(more modules than slots)"; a configured module outside the horizon is ringed and the section carries the "Beyond research horizon" tag. Without a machine, slots can be emptied but not filled.
   - **Apply to every row of this recipe (N)** (`apply-to-recipe-rows`; only when the active block has N > 1 rows of the recipe, in any area): copies this row's machine, fuel and modules together (including "Default", which clears the machine) to every other row of the recipe, as one undoable command. The panel stays open; when every other row already matches, nothing happens and no history entry is recorded.
4. **Beacons.** One card per configuration: a beacon type button (chevron; the list holds the non-hidden beacons inside the research horizon, the configured one marked "Beyond research horizon" when outside; picking one copies its module slots and distribution efficiency into the configuration), a count input (`aria-label="Beacon count"`), one button per module slot (a picker headed "Module"), a remove button ("Remove beacon configuration") and a line with the configuration's efficiency and what it contributes. A configuration without a module shows its empty slot buttons and contributes nothing. When the data has no beacon entities, editable "Modules/beacon" and "Efficiency" fields appear instead. A selected module that no longer fits (for example after picking another beacon type) stays in the configuration and shows an amber note (`module-not-allowed`). Offered modules: inside the research horizon, whose effects are all in the selected beacon's `allowedEffects` (so no productivity module in a speed-only beacon; skipped when the data has no beacon entity), not excluded by the module's recipe limitation lists, and productivity modules only when the recipe allows productivity. Below the cards, a dashed **+ Add beacon configuration** button (`add-beacon-config`) creates the default configuration (first beacon type inside the horizon, 4 beacons, the first module that fits); there is no limit on the number of configurations; it is disabled only, with a title giving the reason, in the cases where the table's `+` chip is. Every edit, add and remove is one undoable store command on the whole list. When the list changes from outside the section (undo/redo, "Apply to every row", another row selected), the cards remount and any open picker closes, so a pick never lands on a different configuration than the one it was opened for. **Apply to every row of this recipe (N)** (only when N > 1) copies this row's beacon configurations, in order, to every other row of the recipe (replacing theirs), so rows without any get them; the rows keep their own machine. Removing a configuration is not propagated. One undoable command; the panel stays open.
5. **Effects on this row.** Only once the row has a module or a beacon configuration (without either the section is not rendered, and Where inputs come from follows Beacons). Speed, productivity and energy as rows; columns Machine, one per beacon configuration ("Beacons 1", "Beacons 2", …), and Total (a single "Beacons" column while a row has at most one configuration). The values apply the same rule as the solver (`effectAllowed`): an effect counts only when both the beacon entity's and the machine's `allowedEffects` include it, productivity is zeroed if the recipe disallows it, and an unknown beacon or machine filters nothing. An effect that does not count is shown amber and struck through with a title saying why (`data-ignored`), and a "Recipe effects: …" note (`recipe-effects-note`) names what does not count. Footnote: "Beacon effect = module effect × efficiency × modules per beacon × beacons. All sources add up."
6. <a id="sourcing"></a>**Where inputs come from.** One entry per ingredient (`data-testid="sourcing-entry"`, `data-item-id`): the item's icon, name and rate, a radio group of **Own recipes / Byproducts / Connections** (`data-sourcing-choice` `own`, `byproducts-first`, `connections-first`; titles "Own recipes first" and so on; they set the block's `itemSourcing` for the item, see [solver.md](solver.md#connections-between-blocks)), one sentence (`data-testid="sourcing-sentence"`), and a **Forbid imports** checkbox (`forbid-imports`, `noImportItems`). The mode is per item for the whole block, so every row that uses the item follows it (a line says so). For an item that is a product of the block the choices other than Own recipes are disabled (title "<item> is a product of this block, so the block always makes it"), except Own recipes first while a mode is set, so a leftover mode can be cleared; Forbid imports is disabled for an item no row makes. A row with no inputs reads "This row takes no inputs."

   The sentence is built by the pure function in `sourcingText.ts` from the item, its mode, the block's connections and the solve result (no generated text; rates go through `fmtItemRateText`):

   | Mode | Sentence |
   |---|---|
   | Own recipes first | "Made in this block by {recipe} ({n} × {machine})." If no row makes it: "No row here makes {item}; it is imported." With Forbid imports on, " Imports are forbidden." is appended. |
   | Byproducts first | "Uses byproducts of other rows first ({recipe} {rate}/min, …). {recipe} makes the rest." With none: "No row here makes {item} as a byproduct, so {recipe} covers it." |
   | Connections first | "Takes {item} from {block} first ({offered}/min offered), then {recipe} makes the rest." The second half is dropped when the connection covers everything. With no connection: "No connection for {item}; {recipe} covers it." |

   "The rest" follows what the solver took from each source, not only the settings.

A chip shortcut (the filled module or beacon chips) selects the row and highlights one section of its panel: it scrolls into view and shows a teal ring (`data-highlighted="true"`) for about two seconds. The highlight (`uiStore.panelHighlight`) is transient, belongs to the row that asked for it, and ends when another row is selected.

#### Group panel

`sidePanel/GroupPanel.tsx`, read only. Selecting a group row (anywhere that is not its chevron button or a field) shows:

- **Header.** A folder icon, the group's name and the subtitle "Sub-factory · level N of 4" or "Separate area · level N of 4" (N = the group's own nesting level, 1 for a group in the root). A separate area also carries the **Area** marker (`panel-area-marker`).
- **Summary.** Recipes (recursive), Machines (recursive) and Power (recursive; "–" when zero), as on the group row.
- **Receives** and **Sends** (separate areas only): item icon, name, rate and the other end ("from Oil", "to the rest of the block", "outside the block"); they hold the same items as the chips on the group row. Each list shows its first six entries; with more, a full-width button (`area-receives-toggle`, `area-sends-toggle`, `aria-expanded`) reads "Show all N" and expands that list, then "Show fewer" (the lists expand independently, and collapse again when another group is selected). An area with nothing to receive or send shows an empty line ("This area receives nothing from outside it.", "This area sends nothing out.").
- **Inside this group.** The rows and groups directly below it, each a button (`data-testid="group-child"`, `data-node-id`) with its icon, name, machine count and power; clicking one selects that row or group, and the panel becomes its panel. An empty group reads "Nothing in this group yet." A closing line says a sub-factory only organises rows and that **Separate area**, from its right-click menu, tracks what it sends and receives, or, for an area, that it is solved on its own.

Rename, Separate area, Duplicate to… and Remove stay in the group's right-click menu.

### Pickers

Every list that opens under a button follows one pattern, in `Picker.tsx` and `PickerTrigger.tsx`:

- `PickerTrigger` renders the trigger button (it owns the open flag and provides the anchor) and, when open, its picker. `Picker` is the frame (`data-testid="picker"`): a popover list portalled to `document.body` and fixed to the viewport, aligned to the trigger's left edge, opening upward when there is more room above and clamped to the viewport, so the table's scroll container never clips it; an optional heading (`picker-heading`) names what the choice does. `PickerRow` is a row of icon, name and an optional detail (a machine's "speed 1.5"), the current choice in teal; `PickerEmpty` is the note when nothing fits.
- A picker closes on a click away from it and its trigger, and on Esc (the topmost open picker only; nothing else reacts to that Esc). A click on the trigger toggles it. A click inside a picker does not select the table row under it.
- Lists are filtered by the research horizon and by the usual rules (`effectAllowed`; productivity modules only when the recipe allows productivity; a beacon accepts only the effects of its entity).

The pickers are the machine picker, the fuel picker, the module slot pickers, the beacon type picker and the two fill-all pickers (`ModuleFillPicker.tsx`, rows `module-fill-option`).

#### Machine picker

`MachinePicker.tsx`, opened from the table's machine chip and the panel's machine button; headed "Select machine", 288px wide:

- **Default** (`machine-option-default`, labelled "Default (<machine name>)" when the category has a default) and every non-hidden machine inside the research horizon that can craft the recipe's category (`availableMachinesFor`; `machine-option`, `data-machine-id`), each with its icon, name and "speed N". The names show because Seablock recipes can have around six machines and the assemblers look alike. The category's current default carries a "default" badge (`default-machine-badge`); every other machine has a **Make default** button (accessible name "Make <machine> the <category> default", shown on hover and focus) that sets the plan's default for the category, resets this row to "Default" and closes the list; the row reset is undoable with the block, the default change is not (defaults are not part of block history). When none is available the list shows "No machine for this recipe within the research horizon. Widen the horizon to choose one."
- A footer (`default-machine-usage`): "<Category> default is used by N rows" (rows of the category left on "Default", across all blocks) with an **All defaults…** link that opens the workspace menu's [Default machines](#workspace-menu) flyout on that category.
- An **Alternate recipe** section: other non-hidden recipes inside the research horizon that produce the current recipe's main product. Choosing one swaps the row's recipe and resets its machine, modules, beacon, pin and other settings. A power generation row has exactly one machine (its recipe's), so a tier or fuel change goes through **Alternate recipe**, where the several power recipes of one machine are one expandable entry (`alt-recipe-group`, `data-machine-id`, "(N recipes)", one open at a time; expanding scrolls the fuels into view inside the short list) listing its fuels (`alt-recipe-fuel`, with the fuel's icon and, for item fuels, its value); a machine left with a single other fuel is a plain `alt-recipe` entry. Other alternates outside the research horizon are left out, but power recipes beyond it stay listed (a row can always switch back to the fuel it used) with the amber "Beyond research horizon" tag (`beyond-horizon`; `data-beyond-horizon="true"` on the fuel entry).

### Sub-factory rows

A `SubPlanNode` renders as a group row in the same grid as the recipe rows:

- The same ▲/▼ reorder cell as a recipe row; rows and groups are both draggable.
- One 12px vertical **guide** line per ancestor level in the Recipe cell (`treeGuides.ts`; `data-guide-levels` is the number drawn), running the full height of the row so the tree reads as one continuous line; recipe rows use the same guides (2px per level instead of 12 below 768px, see [Narrow screens](#narrow-screens)). The indent stops growing at 4 levels. A collapsed group row has a tinted background that gets fainter with each nesting level (gray-800 at 30%, 20%, 10%, 5%; the last step is shared by anything deeper); an open group is banded instead (see below).
- A chevron **button** (`aria-expanded`, `aria-label` "Collapse X" / "Expand X"), then a 12px **icon** (always, so a table of areas and a mixed table look alike; gray-400, an `<svg role="img">` named by its tooltip): the areas icon of the toolbar (`data-testid="area-marker"`, "Separate area") for a separate area, a folder (`data-testid="group-marker"`, "Sub-factory") for a plain sub-factory; then the name as a button (it selects the group; `aria-pressed`), then the summary (`data-testid="group-summary"`), both counts recursive over nested sub-factories: "N machines" when it equals the recipe count, else "N recipes · M machines".
- An **open** group (and only an open one) is banded: background teal-400 at 5% instead of its gray tint, a 1px hairline under its header (teal-400 at 28%, an inset shadow in every cell of the row; not drawn on a selected row, which keeps the selection tint) and a teal-400 icon. The name weight is untouched. Collapsed rows keep the tint.
- The Power column shows the group's recursive total (`data-testid="group-power"`).
- Clicking the group row anywhere that is not a button or field selects it and opens the [group panel](#group-panel). The chevron only expands or collapses.
- A collapsed group hides everything below it until the next node at its depth or shallower; expanding it shows its nodes (including nested sub-factories) with their own expanded state kept. An empty expanded group shows a "Drop here" target. Expanded or collapsed state is local to the table and not saved.

A sub-factory that is a separate area, collapsed or expanded, spans the Recipe, Machine and Beacons columns with its icon, name and summary. The items it sends sit under the Products and Byproducts columns, which the cell spans (at least 152px; `data-testid="area-chips-out"`), and the items it receives in the Ingredients column (`data-testid="area-chips-in"`). Both are left-aligned: the sent chips start at the same x as the recipe rows' product chips, the received chips at the same x as a recipe row's first ingredient chip (the Ingredients cell has the 28px of left padding, and the sends span borrows the same 28px from the Ingredients column with a negative margin, so its `+N` has room). The chips are display-only (`<span>`s), with no visible "in" or "out" label (the column header says it); each group is `role="group"` with `aria-label` "Sends" or "Receives". Right-clicking any cell of the row, chips included, opens the row menu. A group row is always **one line high**, exactly 37px (a `h-[37px]` minimum on the row, so every group row has it: a plain sub-factory with no chips and no area, an area with nothing sent or received, and an area with chips; the content stays vertically centred): the chips that fit on the line are shown (`chipsOnOneLine` in `oneLineChips.ts`, which measures the line with a `ResizeObserver` and counts 38px slots), with a cap of 8 sent and 16 received. When everything fits all chips show; otherwise one fewer than fits is shown and the rest is a "+N" button in the last slot (`data-testid="area-chips-more"`, `aria-label` "N more received items"
or "N more sent items") that opens a popup (`AreaChipsMore.tsx`, `data-testid="area-chips-popup"`,
`role="tooltip"`) headed "Also receives" or "Also sends". It lists only the hidden items, one per
line: a chip (icon and rate) and the item name. Hovering the button opens it after 300 ms;
keyboard focus opens it at once (focus caused by a mouse press does not; the press ends with the
pointer, so a press that never becomes a click leaves later focus working); a click opens it at
once and pins it, even within the hover delay, and a second click, Enter or Space closes it. Leaving the button or the popup
closes it after a 100 ms grace period unless it is pinned or opened by focus, so the pointer can
move onto the popup, which scrolls when the list is long. Escape (default prevented, which the warnings popover, the menus and the summary pane honour, so it closes
nothing else), blur, a press outside, any scroll outside the popup (except the one in the 300 ms after
a focus opened it, which only re-anchors it: focus may scroll the button into view), a window resize or
blur and the start of a row drag also close it. The placement is measured on opening and again whenever
the popup resizes. Context-menu events from the popup do not reach the row. The popup closes when the
overflow empties. The popup is rendered in a portal on `document.body`
(`position: fixed`, under the button and 16px to its left, above it when there is no room, clamped to the screen by `anchoredBelow`: the same place as the list of a recipe row's "+N", see [Narrow screens](#narrow-screens)), since
the table scrolls. Timing, placement and dismissal live in the `useHoverPopup.ts` hook. An organising
sub-factory shows no chips (the Products and Ingredients cells stay empty, as does a side with no flows).

**Right-click menu.** **Rename subfactory…**, the checkbox **Separate area**, **Duplicate to…** (blocks with areas only) and **Remove subfactory**.
**Separate area** (`role="menuitemcheckbox"`, `aria-checked`) solves the sub-factory as its own area (see [solver.md](solver.md#areas)): its rows serve it first and, while collapsed, its row shows what it receives and sends. It is undoable at store level, like removal.
Rename opens a browser prompt prefilled with the current name; cancelling or a
blank answer is ignored. Adding, renaming, wrapping a row in and removing a sub-factory are
undoable (undoing a wrap is dropped once the new sub-factory holds more than the wrapped row).
Remove deletes it **with all
its contents**. When it has contents a confirmation names the sub-factory and
counts its recipes and nested sub-factories; an empty one is removed at once.
**Duplicate to…** opens a second menu listing every area of the block in table order (the root as "Top level"). Picking one deep-copies the sub-factory into it (`duplicateSubPlanTo`): a new handle and sub-plan with fresh ids, named "<name> (copy)", with everything copied (pins, byproduct-consumer flags, `area` flags, nested names). The new handle goes right after the source's handle when the target area holds it, else at the end of the target's rows; the table then reveals and flashes the new row (collapsed). An area that cannot take the copy is shown disabled with a tooltip: the sub-factory itself or an area inside it ("Cannot copy a subfactory into itself"), an area where the copy would nest past the limit ("Cannot nest deeper than 4 levels"), or an area that already has a row of one of the recipes the copy would add ("Already has a row of X", "Already has rows of X and Y", "… X, Y and Z", "… X, Y, Z and N more"), since the solver builds each recipe once per area. The rows that would join the area are the sub-factory's own and those of its nested sub-factories that are not areas; rows in nested areas, and every row when the source is itself an area, keep their own area and never conflict. When every area is disabled the entry is disabled too, with the tooltip "Every area already has a row of one of its recipes" when each area is disabled for a recipe conflict, else "No area can take a copy of this subfactory". The entry is hidden in a block without areas. The copy is one undoable command.
Removal, with all its contents, is undoable at store level: undo restores the
sub-factory at its original position. The undo history is session-only and per
block.

A sub-factory only organises the table unless it is a separate area; then the solver builds each recipe once per area.

#### Nesting limit

A row or group may sit inside at most **4** ancestor groups (`MAX_NESTING_DEPTH` in `src/data/nesting.ts`, read by both the UI and the store commands; the data model itself has no limit). A row 4 levels deep has about 78px for its name at the reference layout, and a group row about 255px for name, marker and summary; a higher limit would need a wider Recipe column. The limit counts a moved group's own deepest descendant: the target's depth plus the height of the moved subtree must stay within 4.

- **Wrap in subfactory…** (row menu) is disabled with the title "Cannot nest deeper than 4 levels" when the new group would sit past the limit. **Duplicate to…** disables the areas where the copy would go past it (above).
- A drop that would go past the limit does nothing: no drop line or outline is shown and the plan is unchanged (the store command refuses the move too). That covers a row or group dropped onto or between the rows of a group that is too deep.
- Plans already deeper than the limit still load and render. They are not flattened or rewritten; the indent just stops growing at 4 levels.

### Drag and drop

Every row (recipe or sub-factory) is draggable with native HTML5 drag-and-drop.
`RecipeDnd.tsx` holds the drag state in a context; the drop logic is in
`RecipeRow` and `ProductionTable`.

- Dropping on the top or bottom half of a recipe row inserts before or after it
  (a blue line marks the spot). The line is an overlay inside the row, not a
  table cell, so neighbouring rows and column widths do not move during a drag.
- Dropping on a collapsed sub-factory row appends into it; on an expanded one, the
  top half inserts before the group and the bottom half appends into it.
- An empty expanded sub-factory accepts drops on its "Drop here" row.
- While dragging, a "Drop here to append" row at the end of the table appends to
  the root plan.
- A sub-factory cannot be dropped inside itself or its descendants.
- A drop that would [nest past the limit](#nesting-limit) is refused.
- Dropping a sub-factory into another plan moves the sub-factory with its rows, so they join the
  area of the plan it lands in (see [data-model.md](data-model.md#subplan)); undo puts it back.

---

## Modals and pickers

Modals (`Modal.tsx`, and the item and recipe pickers' own frame) are centred over a dimmed
backdrop and close on Escape or a click on the backdrop. They never exceed the viewport: modals are capped at the viewport minus 0.5rem on each side and scroll vertically (`Modal` adds the width cap only when the caller's `className` has no `max-w-` class, variant-prefixed ones included, and `overflow-y-auto` only when it has no `overflow-y-*` or both-axis `overflow-*` class; `overflow-x-*` alone keeps the vertical scroll), the item and recipe picker frame is `w-[32rem]` with the cap in the frame itself (so a custom width keeps it), starts closer to the top below `md`, and its recipe grids use 6, 8 then 10 columns (`sm`, `md`). The recipe picker's floating detail panel is shown from `xl` only (below it hovering a recipe shows no detail; see the backlog). The summary strip below `md` snaps to its panes with the `px-3` end padding as scroll padding and does not scroll vertically. Menu flyouts that open to the left of their menu (`MenuButton`) are pinned to the viewport's edges below `md`.

### Item picker

`ItemPicker.tsx`, items mode (`source="items"`), used to add a product.

- Search box (case-insensitive substring match on display name or id).
- **Amount** field in items per minute, default 60 (always /min, regardless of the
  rate-unit toggle), except for Electricity and Heat, which are typed in MW (the unit label then
  reads "/min (MW for Electricity and Heat)"; 10 is stored as 600 units/min). Empty adds a product without extra output (the field shows `—`); anything else must be a positive number, or the item cannot be picked and Submit is disabled.
- Item-group tabs, then items of the selected group in rows by subgroup, sorted by
  Factorio `order`. Hidden items are never shown. A bundle with power generation has a
  **Power** tab holding Electricity and Heat (inside the research horizon when a recipe producing them is, which
  holds as long as a power recipe whose fuel is offered exists).
- With a research horizon, items produced only by non-hidden recipes outside it are
  not offered; items no non-hidden recipe produces (raw resources without an extraction
  recipe, or items only hidden recipes make) are always offered. An ore with a
  non-hidden extraction recipe is offered because that recipe is inside every horizon. An empty
  result caused by the horizon reads "No items match within the research horizon
  (N outside it)". Goals already set are unaffected.
- Clicking an item adds it as a product immediately when the amount is valid or empty;
  **Submit** does the same for the last clicked item.

### Recipe picker

The same component in recipes mode (`source="recipes"`).

- Search box (substring on recipe name or id), a **Hidden recipes** checkbox
  (hidden recipes are excluded by default) and, when a research horizon is
  active, a **Beyond research horizon** checkbox (see below).
- Item-group tabs (only when results span more than one group), then recipe
  slots in subgroup rows. Each slot shows the icon of the recipe's main product.
- Hovering or focusing a slot shows a side panel with the recipe's ingredients,
  crafting time, products (with probability) and the machines that can make it.
  When the data set has technology data, the panel ends with an **Unlocked by:**
  section. Each technology that unlocks the recipe is listed (fewest science-pack
  types first, then by name; technologies with no cost data or a research
  trigger sort last) with its icon, its name and its science packs (pack
  icons, then `×count`; `×?` for a formula count; the short trigger condition
  ("Craft 10 × Steel plate", or a bare "Trigger" when unknown or incomplete) for a research-trigger
  technology; nothing when the bundle has no cost data). Research time is not shown.
  Starting and extraction recipes read "Available from the start"; a recipe no
  technology unlocks reads "No technology unlocks this recipe".
- When opened from a summary slot's **Find recipe**, an ingredient chip or **Make in a new block…**, only recipes producing that item are
  listed and the subtitle reads "Choose a recipe to produce '…'".
- When opened from a byproduct, only recipes consuming that item (as an
  ingredient, fluid temperature ignored) are listed and the subtitle reads
  "Choose a recipe that consumes '…'".
- Extraction recipes ("Iron ore (mining)", "Water (offshore pump)") are listed like any other recipe, under the group of what they produce; they are always inside the research horizon.
- Power generation recipes (`Recipe.power`; "Boiler (Coal)", "Steam engine (Steam)", "Solar panel (electricity)") are listed in the **Power** group, by subgroup (boilers and heat exchangers, generators, burner generators, solar panels, reactors); a heat exchanger reads "Heat exchanger (Heat)" and a reactor "Uranium reactor (Uranium-235 fuel cell)", with heat as the badge of the exchanger. Steam and heat temperatures (boiler and exchanger steam, reactor heat and the exchanger's heat minimum) show as the usual orange badges. A reactor row's neighbour count is set in the side panel's Machine section. A power slot shows its machine's icon, with its last ingredient (the fuel, or the steam of a generator) as a small badge at the bottom-right (`data-testid="recipe-slot-badge"`). A machine with two or more power recipes in the list (a boiler, burner generator or reactor has one per fuel) is collapsed into one **group slot** (`data-testid="recipe-group-slot"`, `data-machine-id`, the machine's icon and a count pill `recipe-group-count`); clicking it replaces the grid with a fuel view (`recipe-fuel-grid`): a **← Back** button (`recipe-fuel-back`), the machine's name and "Choose a recipe (N)" (focus moves to Back on entering, and Escape steps back to the groups instead of closing the picker), and one slot per fuel (the fuel's icon, no badge, with the usual hover detail panel) that picks the recipe. Grouping runs after the search, item filter and horizon, and search matches the per-fuel recipe names ("Boiler (Wood)"), so a list left with a single recipe of a machine shows it as a plain slot. The group slot has no detail panel, and is disabled ("already in …") only when every fuel of it is already in the area; changing the group tab, or a search, horizon or hidden toggle that leaves one fuel, closes the fuel view (and clears the hovered recipe). A machine's recipes are grouped over the whole tab, so a machine spread over several subgroups still has a single group slot, placed in the subgroup of its first recipe. A fuel without an icon shows its name as text. They are inside the research horizon only when everything they take is offered (a fuel only a recipe beyond the horizon makes hides its boiler recipe until "Beyond research horizon" is ticked); a group slot is dimmed as beyond the horizon only when every one of its fuels is, the fuel view dims each fuel on its own, and the group's count follows the checkbox like the rest of the grid. Their detail panel reads "Available from the start" (the machine is gated through its placing item), or "Needs <items>, not yet available" (`data-unlock-kind="fuel"`) when the recipe is beyond the horizon. Amounts below 0.01 in the detail panel show two significant digits ("0.0015 ×"). Steam temperatures (boiler output and generator minimum) are checked by the `temperature-mismatch` warning: a boiler whose steam is below every generator's minimum in the block (or its connected sources) is flagged. The detail panel shows the generator's minimum next to its steam ingredient and the boiler's steam temperature next to its product, in orange (`data-testid="recipe-detail-temperature"`, formatted like the tile badge; products only when the recipe sets one).
- Non-hidden recipes outside the [research horizon](#research-horizon) are left out
  (hidden recipes, shown with "Hidden recipes" ticked, ignore the horizon). When
  that empties the list, it reads "No recipes match within the research horizon
  (N outside it)".
- The **Beyond research horizon** checkbox is only shown while a horizon is
  active (technology data and at least one target). It starts unticked every time
  the picker opens and is not persisted. Ticking it lifts the horizon filter so
  the player can preview what is locked: the revealed non-hidden recipes are drawn
  dimmed, carry `data-beyond-horizon="true"` and a "(beyond research horizon)"
  tooltip suffix, and are selected like any other slot. Hidden recipes are
  unaffected. While it is ticked the "outside it" empty-state message never appears.
- A recipe that already has a row where the new one would go is disabled: dimmed,
  `data-in-area="true"`, title "<name> (already in this area)" (or "this block" in a block
  without areas), and clicking it does nothing. The target is the area that encloses the
  sub-plan the row will be added to (the root for the header button and the summary's
  Find recipe). Other routes (dragging a row into an area, **Alternate recipe**, turning an
  area off) can still create a duplicate, which the solver reports as `duplicate-recipe`.
- Clicking a slot adds the recipe and closes the picker.

---

## Shared pieces

- **Dim text.** Secondary text (hints such as "click a row to trace it", counts, table header and side-panel section labels, units, the `–` cells, empty-state notes) is `text-gray-400`, at least 4.5:1 on the gray-800 and gray-900 surfaces it sits on; search-input placeholders are `gray-400` too. The exception is detail text in a picker or menu row that is hovered (`hover:bg-gray-700`): there it is 3.96:1.
- `IconChip.tsx` and `ItemChip.tsx` — the [icon chip](#icon-chip) and the item chip of the production table (variants product,
  byproduct, ingredient; the chip carries `data-variant`). `ItemTile.tsx` holds the rate formatters they use: `fmtRate`, `fmtPower` and, for the corner of a chip, `chipFmt` / `fmtChipQuantity` (see [chip quantities](#icon-chip)). Rates show
  0–2 decimals depending on magnitude, and two significant digits for a non-zero rate below 0.005 ("0.00082", never "0.00"). `fmtItemRate(itemId, ratePerSec, unit)` / `fmtItemRateText` format a
  rate of an item as value + unit, and show the electricity and heat items (1 unit/s = 1 MW) in W / kW / MW / GW whatever the
  rate unit; `inputRateUnit(itemId, unit)` is the unit a rate input is typed in (`'sec'`, i.e. MW, for electricity and heat).
  Every rate text of an item goes through them (slots, strips, chips, menus, warnings, the product-change dialog),
  and so does the rounding check behind "short" and "differs from the target" (`isShortfall`, `differsFromTarget` take
  the item id: an electricity or heat gap is rounded in power units, so it does not depend on the rate toggle). The areas
  matrices do the same through the `energy` flag of `matrixFormat.ts` (`fmtAmount`, `fmtSigned`, `tradeRateText`...), and
  `fmtEnergyText(unitsPerSec)` is the power string on its own.
  An electricity item chip without an icon shows ⚡ (heat has its own icon). An optional `temperature` prop adds the
  orange temperature label in the chip's top-left corner.
- `temperature.ts` — formats an ingredient's temperature bounds (`fmtTemperatureRange`)
  and builds the per-item labels for a recipe (`ingredientTemperatureLabels`, and
  `productTemperatureLabels` for explicit product temperatures); `fmtTemperatureWarning`
  writes the `temperature-mismatch` sentence.
- `Icon.tsx` — renders an `iconPath` as a `<picture>` with a WebP source and PNG
  fallback, via `src/utils/iconUrl.ts` (see [data-model.md](data-model.md#icon-paths)).
  The `<picture>` is `display: contents` and its `<source>` is `display: none`, so the `<img>` is
  the only flex item it contributes and a parent's `gap` adds no extra space before it.
- `Modal.tsx` — the modal frame.
- `factory/Picker.tsx`, `factory/PickerTrigger.tsx` — the [picker](#pickers) frame and its trigger.
- `factory/Popover.tsx` — an absolutely positioned panel that closes on an outside pointerdown
  (except inside its optional `ignoreRef`, the trigger, so a click on the trigger just toggles) and on
  Escape, handled in the capture phase and prevented so it does not also clear a summary selection.
- `SegmentedControl.tsx` — the [segmented control](#segmented-control) (`Segmented` and `Segment`).
- `icons.tsx`, `IconButton.tsx` — the stroke SVG icons and the tooltip icon button of the top bar.
- `src/utils/viewTransform.ts` — pure pan/zoom maths (zoom around a point, pan, fit,
  centre) used by the technology tree.
- `src/utils/blockGraphLayout.ts` — layered layout of the blocks and their
  connections, used by the block graph.

### Segmented control

`SegmentedControl.tsx`: `Segmented` is a dark rounded track (`bg-gray-950`, grey border) and
each `Segment` a pill button in it; the pressed pill is filled grey (`bg-gray-700`) with white
text, the others are muted and brighten on hover. `Segmented` takes an optional `label` (it then
is a `role="group"` with that name) and a `size`: `md` (28px pills, the Areas modal header), `sm`
(24px) or `xs` (20px, 10px text).
A `Segment` reports `aria-pressed`; given `role="menuitemradio"` it reports `aria-checked`
instead and shows its keyboard focus on any focus (a teal inset ring), like the other menu
items. Other props (`title`, `tabIndex`, …) go to the button.

---

## Not in the UI

Some store capabilities have no UI: undo/redo (`blockStore` keeps a per-block
history) and the per-product `byproductPolicy`
(`'discard'`). There is no URL sharing, settings panel, totals bar,
or responsive layout. Planned work lives in
[initiatives/backlog.md](../initiatives/backlog.md).
