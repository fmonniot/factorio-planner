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
   their previous result. A block with no goals or no recipe nodes gets an empty
   result without calling the solver.
4. Mounts `FactoryShell`.

Game data is not loaded at startup unless a dataset was chosen in an earlier
session (see [Game data set](#game-data-set)).

---

## Layout

`FactoryShell` stacks three regions full-height:

```
┌ TopBar ──────────────────────────────────────────────────────────────────┐
│ [▣ Plates][▣ Gears] +      (⚠ 2 warnings)  /min ⇄  ⚑  ⊞  ⚗ │ [≡ Main base ▾] │
├ FactorySummary ──────────────────────────────────────────────────────────┤
│ ┌ PRODUCTS · 1       [+]┐ ┌ BYPRODUCTS · 1 ─────┐ ┌ INGREDIENTS · 2 ────┐ │
│ │ [slot 58▼] [slot ]    │ │ [slot 12 ] [slot ]  │ │ [slot 30 ] [slot ⊘] │ │
│ │  ▂▂▂▂▂▂    micro-bars │ │  ▂▂▂▂▂▂             │ │  ▂▂▂▂▂▂             │ │
│ ├───────────────────────┤ ├─────────────────────┤ ├─────────────────────┤ │
│ │ detail strip: overview│ │ overview / preview /│ │ → B ▇▇▇▇ 40 · 2     │ │
│ │ rows, or the selected │ │ selected slot with  │ │ Imported ▇▇ 5 · 1   │ │
│ │ slot's bar and key    │ │ bar, key and actions│ │                     │ │
│ └───────────────────────┘ └─────────────────────┘ └─────────────────────┘ │
├ ProductionTable ─────────────────────────────────────────────────────────┤
│ [+]│ Recipe          │ Machine      │ Beacon │ Products │ Byprod. │ Ingr. │
│ ▲▼ │ ▶ Smelting  3 recipes                                               │
│ ▲▼ │ [icon]           │ [mach 4][2/4] │ [+]    │ [..]     │ [..]    │ [..]⚡│
└──────────────────────────────────────────────────────────────────────────┘
```

The layout is designed for desktop widths; there is no mobile layout.

---

## TopBar

`TopBar.tsx` (`factory/`) is one row, 44px high. On the left are the block tabs. On the right
are, in order, the [warnings pill](#warnings-popover) (only while the last solve produced
warnings), the rate unit toggle, three icon-only tool buttons (the [horizon](#research-horizon)
flag, the [block graph](#block-graph) and the [tech tree](#technology-tree)), a divider (shown only
when game data is loaded, like the tools) and the [workspace menu](#workspace-menu). The root
carries `data-testid="top-bar"`.

The rate unit toggle (`RateUnitButton.tsx`, shown only when game data is loaded) is a wide
`IconButton` (`wide`: `h-8 px-2 gap-1 text-xs`) showing `/min` or `/sec` and a swap icon. Its
accessible name and tooltip are "Rates per minute, switch to per second" or "Rates per second, switch
to per minute"; a click flips the unit. The unit is stored in `uiStore` and persisted; the default is
per minute. It changes how every rate in the summary and the table is displayed; stored values are
always per minute. The workspace menu has the same switch (see below).

The tool buttons are `IconButton` (`IconButton.tsx`): 32px, borderless, with a CSS-only tooltip
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

### Block tabs

`BlockTabs.tsx`. One folder-style tab per block, sitting on the top bar's bottom border: the
icon of the block's first goal (none when it has no goal), then the block's name, truncated when
long; the full name is the tab's tooltip. A stripe in the block's colour runs across the top of each
tab: full strength and 3px on the active tab, muted and 2px on the others. The colour stays off the
icon so item icons keep their own colours. The active tab also has a raised background and border
and carries `aria-current`.

- Click a tab to make that block active. Only the active block is shown, but
  every block is solved on each edit (blocks can feed one another; see
  [Ingredients pane](#ingredients-pane)).
- `+` adds a new empty block named "Block N" and activates it. Every block has a
  display colour ([data-model.md](data-model.md#block)); a new block gets a random
  palette colour, preferring one no other block uses.
- Right-click a tab for a small menu: **Rename** (browser prompt; the only way to rename a block), **Duplicate** and **Delete**,
  plus a **Colour** grid of the 16 palette swatches (the current one is ringed; the store accepts any `#rrggbb`, the UI offers the palette).
  Picking a swatch sets the block's colour and closes the menu; several blocks may
  share a colour, and like the other block actions it is not undoable.
  Duplicate copies the block as "<name> (copy)", inserts it right after the
  original and activates it, with a new colour (never the original's). Goals, recipes, sub-plans and input connections
  are copied with fresh ids; connections from other blocks reading the original
  are not. Like add, rename and delete, it is not undoable.
  Delete is disabled when only one block remains; deleting the active block
  activates the first remaining one.
- All of the above are disabled unless game data is loaded (not while it is empty,
  loading or failed to load).

### Block graph

`BlockGraph.tsx`. The **Block graph** icon button (a three-node graph glyph; hidden until game data is loaded) opens a
near-full-screen modal showing every block and the connections between them, like the
[technology tree](#technology-tree) but without pan or zoom: the viewport scrolls natively.

- **Layout** (`src/utils/blockGraphLayout.ts`). A block's column is the longest chain of
  sources feeding it (sources on the left); rows follow one barycenter pass (the mean row of a
  block's sources, ties by plan order). Positions are recomputed on every change and never saved.
- **Nodes.** Block name, first goal icon (or `?`) and up to four goal icons plus `+N`. The active
  block has a teal ring. A 3px stripe across the top of the node shows the block's colour
  (`Block.color`) at full strength. Clicking a node makes that block active and closes the graph.
- **Edges.** One curve per (source, consumer) pair, coloured by its connections' status (limited,
  then ok, then not used, then cycle, which is dashed). An ok edge is stroked, and its chips
  bordered, in the *source* block's colour, matching the source segment on the consumer's bar;
  the other statuses keep their status colours (limited stays amber). The legend's OK swatch is
  a multi-colour gradient with the title "In the source block's colour". Each connection is a chip: item icon,
  delivered rate (`—` before the first solve), the limit control and `×`, which removes the
  connection at once. The limit control reads `≤` (no limit) or `≤ N` and opens an inline number
  input (display unit); Enter or blur commits, an empty field clears the limit, Escape cancels
  without closing the graph. A chip held back by its limit has the title "Limited by this
  connection's limit of N".
  The chips of an edge are stacked in the gutter just before the consumer's column, which never
  holds a node, at the height of the edge there; chips of different edges sharing a gutter are
  pushed apart so none covers another; if a tall stack would reach above the first row, the whole
  graph is moved down to make room. Edges are drawn under the nodes. A graph edit is recorded
  in the *consumer* block's history, while undo and redo act on the *active* block, so undoing
  after editing another block's connections does not revert that edit. Titles match the
  [Ingredients pane's segment titles](#ingredients-pane). Connections whose source was deleted and
  self-connections are not drawn; they stay visible and removable in the Ingredients pane.
- **Connecting from the source side.** The `→` handle on a node (disabled with a single block)
  starts connect mode: blocks that import something the source still has left to offer are
  highlighted, the others are dimmed with a reason ("Would create a cycle", "<block> has not been
  solved yet" or "Nothing to send").
  Clicking a highlighted block opens a menu "Send to <block>" with one entry per item, showing
  what the source offers and the target needs; choosing one adds the connection to the target.
  The same rules as the Ingredients menu apply (`src/store/connections.ts`). **Cancel**, the
  handle again or a click on the empty background (anywhere outside nodes, chips and the menu) leaves connect mode; Escape closes the whole graph.

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
  technology shows "Trigger"; a bundle without cost data shows nothing. The cost is
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
  another card cancels. The header repeats the icon, the full name and the cost with its time. **Recipes** lists
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
  (captured before the modal's listener); a second Escape closes the tree. Cards carry no native
  `title` tooltip.
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

It opens a panel named "Plan and game data", in order:

- the [Plans](#plans) section (heading, plan radio items, action tiles), only when a data set is
  active;
- a separator, then a **Game data** group: **Nullius**, **Seablock**, the name of the uploaded file
  once there is one, and **Upload file…**; the current data set is the checked item (see
  [Game data set](#game-data-set)). The radio items carry their label as `aria-label`;
- a separator, then, only once game data is loaded: a **Rate unit** group with `/sec` and `/min`
  radio items (a segmented control; picking one sets the unit and leaves the menu open), the
  **Default machines** submenu item (see below) and another separator;
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
enabled item). The rate unit radio is never focused first, since a checked plan or data set radio
always precedes it, and it only renders once data is loaded. ArrowUp focuses the last enabled item. Opening with the mouse leaves focus on the
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
(named "Plan 1", "Plan 2", …).

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
warnings pill and the rate unit toggle are in the [top bar](#topbar).

Each of the three panes is a `SummaryPane` (a `section` region named after its label) with a header (label, an item count `· N`, and for Products the `+` button, as far from the pane's top border as from its right one), a grid of **item slots** and a **detail strip**. Panes are keyed by the active block, so changing block resets them.

**Slot grid.** One 50×54 slot per item, in row order, wrapping. A slot shows the item icon (the name when there is none), the rate in the bottom-right corner, a status badge in the top-right corner and a 4px **micro-bar** (segments 1px apart) along the bottom edge. Its accessible name is "<item>, <rate> per minute|second", with ", short", ", limited" or ", locked" appended when the slot has a status (the badge itself is decorative), and its tooltip the item name. The border is teal (with a dark teal fill) when selected, amber for a short goal or a limited connection, grey otherwise; a short goal's rate is amber. A locked item or an unused connection dims the slot. The grid grows to fill the pane, so the three detail strips line up at the bottom of the row. The grid is capped at two rows of slots plus a peek at the third (`max-h-[124px]`), to leave room for the production table, and scrolls vertically while the header and the strip stay put; a gradient fades the bottom edge (the pane has `data-overflow="true"`) while more slots sit below. The fade is re-measured after every render and whenever the grid's content resizes (`useMoreBelow`).

**Allocation segments.** Every item is a bar whose segments add up to the bar's scale. The micro-bar, the detail bar and the overview all use the same encoding:

| Pane | Scale | Segments, in order |
|---|---|---|
| Products | max(target, actual) | one `export` per consumer block · `kept` (actual minus exports) · `short` (target minus actual, when short) |
| Byproducts | net production | one `export` per consumer block · `left` (what stays) |
| Ingredients | need | one `source` per source block (delivered) · `import` (still imported) |

| Kind | Look in the detail bar (micro-bar: solid) |
|---|---|
| `export`, `source` | the block's colour as a translucent fill with a solid border; a limited source has an amber border (amber in the micro-bar) |
| `kept`, `left` | dark fill, grey border |
| `import` | no fill, light grey outline |
| `short` | faint amber fill, dashed amber border |
| unused / cycle / deleted source | no fill, dashed grey border; takes no share of the bar, but fills it (dark grey in the micro-bar) when the item has no segment, and otherwise outlines the detail bar with a dashed line |
| imports forbidden | grey stripes; fills the bar when the item has no segment |

The looks live in `segmentLooks.ts` and are shared by the micro-bar, the detail bar, the colour key and the overview's swatches and bars.

Products also draw a 2px light tick at the target when the actual rate differs from it (inside the bar when over-producing, at its end when short). Block colours come from `Block.color`; a block that no longer exists is grey. The segment model is built by pure functions in `summarySegments.ts` from the rows of `summaryRows.ts`.

**Detail strip.** A fixed-height strip (`h-[110px]`, `data-testid="summary-detail"`, `data-state`) at the bottom of the pane, on a lighter background, always present, so slots never move when the selection changes. It has four states:

- *overview* (nothing selected or hovered): an `Overview` heading with the hint "click a row to trace it" ("click again to clear" while tracing), then one button per segment key in the pane, laid out in columns: swatch, label such as `→ Sciences`, `Kept`, `Imported`, a bar sized against the pane's largest total (at least 2% wide), the total rate (`unused` for an unused source, `—` for a key with no rate) and the number of items carrying it. The strip's height shows three rows and a peek at the fourth; more rows scroll (`summary-overview-rows`) with the same bottom fade as the grid. Clicking a row traces that key (a row with a limited source shows its label in amber; a trace whose key no longer exists is ignored): the row gets a border in its block's colour, the other rows fade, slots without it fade to 30% and every micro-bar fades its other segments; click again to clear.
- *preview* (a slot is hovered): that slot's detail with a `preview` tag after the name. Hovering the selected slot keeps the selected state.
- *selected* (a slot is clicked): header (icon, name, rates, `×` back to the overview), the full-size bar with labels (name and rate) on segments at least 20% wide, a colour key listing every segment and overlay with its exact rate, wrapped inline (it scrolls inside the strip), and the item's actions.
- *editing* (Products only): as selected, with the target as an input. Hover does not change the strip meanwhile.

Clicking a slot selects it and clicking it again clears the selection. A double-click on a slot leaves it selected. Escape (heard on the document, so it works wherever focus is, and only when no input or menu handled it) clears the selection, or the trace when nothing is selected. Selection, hover and trace are view state: not saved. Slots are identified by a pane-unique id (the goal id in Products, so two goals for one item are separate slots; the item id elsewhere).

Segments in the detail bar and entries in the colour key are interactive (an entry whose block was deleted is still focusable, so its context menu opens from the keyboard): an `export` or `source` whose block exists opens that block when clicked; right-clicking a `source`, or an unused / cycle / deleted-source entry, opens a `RowActionsMenu` with **Remove connection** (Ingredients pane only). Titles: `Sends <item> to <consumer> — click to open`, `<item> from <source> — click to open, right-click to remove`, `Limited: <source> only offers N — …`, `Not used: this block makes or needs none from outside — right-click to remove`, and for a deleted source or a cycle the corresponding explanation.

### Products pane

One slot per block goal, in goal order. The slot rate is the actual output (the target before the first solve). Segments: one `export` per consumer, `kept`, and `short` when short.

- Header rates in the strip: `target → actual /unit`. The target is a button (`Target: X/m — click to edit`) that edits inline in the current display unit (Enter or blur commits, Escape cancels and keeps the selection); double-clicking a slot selects it and edits its target at once.
- The actual rate is the item's net balance across all solved nodes; it appears once the solver has a result. When it is below the target (by more than the solver's flow tolerance, and by an amount that does not round to zero in the displayed precision) the slot gets an amber border and a `▼` badge, and the actual turns amber with a leading `▼` and its tooltip reads "Actual: X/m — short by Y/m"; a met or exceeded goal stays teal. Once the solver has a result, a goal that no node produces counts as an actual of 0, so it is fully short. "Short" compares the goal's net balance with its target and does not subtract what the block exports, so a goal whose output is partly delivered to other blocks is not marked short for that reason.
- Actions (selected strip): **Find recipe** opens the [recipe picker](#recipe-picker) filtered to recipes producing the item (the chosen recipe is added to the root plan); **Remove goal**. Right-clicking a slot opens a `RowActionsMenu` with **Remove goal**.
- `+`, pinned in the pane header so it never scrolls away, opens the [item picker](#item-picker) to add a goal.

### Byproducts pane

One slot per non-goal item with a positive net balance. The slot rate is the net balance minus what other blocks receive; an item that is only exported has rate 0. Segments: one `export` per consumer, then `left`. Slots list leftover byproducts first, then export-only items. Header rates: `made N`, the net production.

Right-clicking a slot, or **Add consumer recipe…** in the strip, opens a recipe picker filtered to recipes that take the item as an ingredient. The chosen recipe is added to the block's root plan (even while a sub-factory is expanded). Escape or an outside click closes the menu without opening the picker.

### Ingredients pane

The solver's `unsatisfied` list: everything the block must import (goal shortfalls, intermediate slack, raw resources), together with the block's connections and locked items, grouped into one slot per item. Slots are ordered by first appearance: connected items, then imported items, then locked items. The slot rate is the need: what is delivered plus what is still imported. Segments: one `source` per connection that delivers something, then `import`. Header rates: `need N`.

- Actions (selected strip): **Find recipe** opens the [recipe picker](#recipe-picker) filtered to recipes producing the item (the chosen recipe is added to the root plan); **Receive from…** opens `ConnectionMenu` under the button; **Forbid imports** / **Allow imports**. A plain left click on a slot only selects it, locked or not.
- Right-clicking a slot opens `ConnectionMenu` under the slot, except on a goal shortfall, which has no menu: goals are never fed by connections and have no import slack, so forbidding imports would change nothing (see [solver.md](solver.md)). A lock for a goal item can still exist (the lock predates the goal, or comes from saved data); it stays removable, and its menu and strip hold only **Allow imports**. The menu lists "Receive <item> from" with one entry per other block that still has the item to give (the offered rate minus what it already delivers to other blocks; sources with nothing left are not listed), excluding blocks already connected for that item and blocks that would close a cycle. Choosing one adds a connection to the active block. Connections can also be made from the source side in the [block graph](#block-graph). With no candidate the menu reads "No other block produces this item". It is rendered in a portal at the bottom-left corner of the slot or button (so the grid's scrolling cannot clip it) and closes on Escape, a click outside, or a scroll. After a divider it ends with **Forbid imports** (adds the item to the block's `noImportItems`, so the solver never imports it) or, for a locked item, **Allow imports**.
- Connection states: normal (a `source` segment in the source's colour); `limited` (amber border and `!` badge on the slot, title "Limited: <source> only offers N", or "Limited by this connection's limit of N" when the connection's limit is the bound; the rest of the need stays in the `import` segment); `unused` (dashed overlay, slot dimmed when nothing else is shown, title "Not used: …"); `(deleted block)` or `← <source> · cycle, ignored` (dashed overlay). A connection whose first solve has not landed draws nothing yet. Remove a connection by right-clicking its segment or key entry (undoable).
- A locked item shows grey hatching across the bar, a `⊘` badge and a dimmed slot; its key entry reads "Imports forbidden".

### Warnings popover

`WarningsPopover.tsx`, in the [top bar](#topbar). A `⚠ N warnings` pill (`aria-haspopup="dialog"`,
`aria-expanded`), amber, or red when any warning is
`infeasible-pins`; it renders only while the last solve produced warnings. Clicking it opens a list where each warning has a title, an
explanation naming the items or recipes involved, and a hint:

| Warning | Title |
|---|---|
| `no-recipe` | No recipe in plan |
| `duplicate-recipe` | Duplicate recipe — with a **Fix: remove duplicates** button that keeps the first node using the recipe and removes the others |
| `infeasible-pins` | Pinned rate is impossible |
| `overconstrained` | Recipe network can't fully balance |

The popover closes on Escape or a click outside.

---

## ProductionTable

`ProductionTable.tsx` renders the active block's recipe tree.

- Without game data: "Load game data to begin".
- With no nodes: "No recipes yet" and a `+ Add recipe` link.
- Otherwise: a table with a sticky header — reorder, Recipe, Machine, Beacon,
  Products, Byproducts, Ingredients. The left (reorder) header column carries a `+`
  button (Add recipe).

The header `+` button (and the empty-state `+ Add recipe` link) opens the
[recipe picker](#recipe-picker); the chosen recipe is appended to the block's root
plan as a new node with default settings.

Row order is the order of the nodes in each sub-plan. The table is not sortable;
the user arranges rows by drag-and-drop or the ▲/▼ buttons.

### Recipe rows

`RecipeRow.tsx`, one per `GameRecipeNode`. Rows inside a sub-factory are indented
by depth. Nodes whose recipe does not exist in the loaded data render nothing.

**Reorder cell.** ▲/▼ move the node within its sub-plan (disabled at the ends).

**Recipe cell.** The icon of the primary product (falls back to the first two
letters of the recipe name), with the recipe name as tooltip. The cell has no
buttons; the row actions are in the right-click menu below. Byproduct-consumer
rows carry a small amber "↓" badge at the icon's bottom-right corner, whose
tooltip explains the mode.

Right-clicking anywhere in the recipe cell opens a context menu
(`RowActionsMenu.tsx`, portalled to `document.body`, sized to its content and
clamped to the viewport) with:

- **Absorb byproduct** / **Stop absorbing byproduct** — "only run to absorb
  byproduct from other recipes" (sets `byproductConsumer`).
- **Pin rate** / **Unpin rate** — pins the recipe at its current throughput (at
  least 1); omitted on byproduct-consumer rows. While pinned, the Products cell
  becomes a number input for the pinned rate, shown in the current rate unit
  and stored per minute (executions per minute).
- **Wrap in subfactory…** — prompts for a name (defaults to the recipe name) and
  replaces the row with a new sub-factory containing just this node.
- **Remove recipe** (red).

The menu closes on an outside click, Escape, scroll, window blur or after choosing
an item.

**Machine cell.** `MachineCell` (machine icon with the rounded-up machine count)
and, when the machine has module slots, `ModuleCell` (first module's icon, or
`+`, with a `used/total` slot badge). Both open the
[Edit machine modal](#edit-machine-modal). An explicit machine outside the research
horizon gets an amber ring and the title "<name> (beyond research horizon)". When no
machine is inside the horizon the cell shows the `?` placeholder with count 0, an amber
ring, and the title "No machine within research horizon". `ModuleCell` renders whenever the machine has
slots or modules are configured, so leftover modules stay visible. It is ringed (amber)
in three cases, each with its own title: the row has no machine in the horizon ("Modules
without a machine", `data-beyond-horizon`); a module is outside the horizon ("Edit modules
(beyond research horizon)", `data-beyond-horizon`); or the modules outnumber the slots
(`data-over-slots`, "Edit modules (more modules than slots)", or "Edit modules (this machine has
no module slots)" for a real machine with 0 slots). The plan and the solver are untouched:
the solver applies every configured module (except the productivity of a recipe that disallows it), so the flag is the only sign of an overfilled row.

**Beacon cell.** `BeaconCell` (in `BeaconPopover.tsx`). Without a beacon, a `+`
button creates one — the first non-hidden beacon type by name, the first module by
name, 4 beacons — and opens the [Edit beacon modal](#edit-beacon-modal). With a
beacon, it shows the beacon icon and `N×`; click to edit. The beacon and module chosen
are the first ones inside the research horizon. The `+` is disabled, with a title giving
the reason, when the row has no machine within the horizon ("No machine within research
horizon"), no non-hidden beacon is inside it ("No beacon within the research horizon") or
no module is ("No module within the research horizon"; only when a horizon is active). A configured beacon whose type or
module is outside the horizon gets an amber ring.

**Products cell.** The output that counts as the primary product
(`primaryProduct`, else the recipe's `mainProduct`, else its first product), as an
`ItemTile` with its rate.

**Byproducts cell.** Every other output. On multi-output recipes, clicking a
byproduct makes it the primary product (it swaps places with the current one).
Right-clicking a byproduct tile opens a `RowActionsMenu` with **Add consumer
recipe…**, which opens the recipe picker filtered to recipes consuming that item;
the chosen recipe is added to the same sub-plan as the row. The menu follows the
same closing rules as the recipe-cell menu, and only one of the two is open at a
time.

**Ingredients cell.** Every input with its rate. Clicking one opens the recipe
picker filtered to recipes producing that item; the chosen recipe is added to the
same sub-plan as the clicked row. For a raw ore or pumped fluid in a data set with extraction data this lists its mining or offshore-pump recipe, so clicking the tile adds the drill or pump row. A ⚡ tile at the end shows the row's power draw
(auto-scaled W / kW / MW / GW) when it is above zero.

Rates come from the last solve; before a solve (or for a row the solver did not
reach) the rate cells are empty and the machine count is 0.

### Sub-factory rows

A `SubPlanNode` renders as a group row: ▶/▼ toggle, sub-plan name, recipe count (recursive, including nested sub-factories),
and a right-click menu with **Rename subfactory…** and **Remove subfactory**.
Rename opens a browser prompt prefilled with the current name; cancelling or a
blank answer is ignored, and renaming is not undoable. Remove deletes it **with all
its contents**. When it has contents a confirmation names the sub-factory and
counts its recipes and nested sub-factories; an empty one is removed at once.
Removal is not undoable. Expanding shows its
nodes indented beneath it (including nested sub-factories); an empty expanded
group shows a "Drop here" target. Expanded/collapsed state is not saved.

Sub-factories exist only to organise the table; the solver ignores the grouping.

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

---

## Modals and pickers

Modals (`Modal.tsx`, and the pickers' own frame) are centred over a dimmed
backdrop and close on Escape or a click on the backdrop.

### Item picker

`ItemPicker.tsx`, items mode (`source="items"`), used to add a goal.

- Search box (case-insensitive substring match on display name or id).
- **Amount** field in items per minute, default 60 (always /min, regardless of the
  rate-unit toggle).
- Item-group tabs, then items of the selected group in rows by subgroup, sorted by
  Factorio `order`. Hidden items are never shown.
- With a research horizon, items produced only by non-hidden recipes outside it are
  not offered; items no non-hidden recipe produces (raw resources without an extraction
  recipe, or items only hidden recipes make) are always offered. An ore with a
  non-hidden extraction recipe is offered because that recipe is inside every horizon. An empty
  result caused by the horizon reads "No items match within the research horizon
  (N outside it)". Goals already set are unaffected.
- Clicking an item adds it as a goal immediately when the amount is valid;
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
  icons, then `×count`; `×?` for a formula count; "Trigger" for a research-trigger
  technology; nothing when the bundle has no cost data). Research time is not shown.
  Starting and extraction recipes read "Available from the start"; a recipe no
  technology unlocks reads "No technology unlocks this recipe".
- When opened from a summary slot's **Find recipe** or an ingredient tile, only recipes producing that item are
  listed and the subtitle reads "Choose a recipe to produce '…'".
- When opened from a byproduct, only recipes consuming that item (as an
  ingredient, fluid temperature ignored) are listed and the subtitle reads
  "Choose a recipe that consumes '…'".
- Extraction recipes ("Iron ore (mining)", "Water (offshore pump)") are listed like any other recipe, under the group of what they produce; they are always inside the research horizon.
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
- Clicking a slot adds the recipe and closes the picker.

### Edit machine modal

`EditMachineModal.tsx`, opened from the Machine cell.

- **Machine** — the current machine; clicking it lists **Default** (use the
  category's default machine, labelled "Default (<machine name>)" when there is one) and every non-hidden machine inside the research
  horizon that can craft the recipe's category (`availableMachinesFor`). The machine that is the
  plan's current default for the category carries a "default" badge; every other machine has a
  **Make default** button (accessible name "Make <machine> the <category> default", shown on hover
  and focus) that sets the plan's default for the category, resets this row to "Default" and closes
  the list; the row reset is undoable with the block, the default change is not (defaults are not part of block history). The list's footer reads "<Category> default is used by N rows" (rows of the category
  left on "Default", across all blocks) with an **All defaults…** link that closes the modal and
  opens the workspace menu's [Default machines](#workspace-menu) flyout on that category. When none is, the list shows "No
  machine for this recipe within the research horizon. Widen the horizon to choose
  one." The current-machine label reads "No machine within research horizon" in amber
  when the row has no machine, and carries a "Beyond research horizon" marker for an
  explicit machine outside the horizon. The same list has an **Alternate recipe** section: other
  non-hidden recipes inside the research horizon that produce the current recipe's
  main product. Choosing one
  swaps the row's recipe and resets its machine, modules, beacon, pin and other
  settings.
- **Modules** (when the machine has slots or modules are configured) — each configured
  module with −/+ counts, and an "add module" dropdown. Only modules inside the
  research horizon whose effects the machine allows (and whose recipe limitations
  permit the recipe) are offered, and a module with a positive productivity effect only
  when the recipe allows productivity; the total never exceeds the machine's slots. A
  configured module outside the horizon carries a "Beyond research horizon" marker.
  Without a machine, modules can be removed but not added.
- **Effects** — "Module effects" (raw totals) and "Recipe effects" (after the
  machine's allowed effects, and with productivity zeroed if the recipe disallows
  it). Quality is listed only when relevant.

### Edit beacon modal

`BeaconModal.tsx`, opened from the Beacon cell.

- **Beacon** — beacon type (non-hidden beacons inside the research horizon, the
  configured one marked "Beyond research horizon" when outside; picking one copies its module
  slots and distribution efficiency into the config) and **Amount** (beacon
  count). When the data has no beacon entities, editable "Modules/beacon" and
  "Efficiency" fields appear instead.
- **Effects** — "Beacon effects" and "Recipe effects", as in the machine modal. When
  the row has no machine within the horizon, a note says the row's machine count and
  power are 0 while module and beacon productivity (where the recipe allows it) still applies to the output rates.
- **Module** — the module placed in every beacon slot (modules inside the research
  horizon are offered; productivity modules only when the recipe allows productivity).
- **Remove beacon**.

---

## Shared pieces

- `ItemTile.tsx` — the coloured rate tile used in the production table (variants product,
  byproduct, ingredient, electricity), plus `fmtRate` and `fmtPower`. Rates show
  0–2 decimals depending on magnitude.
- `Icon.tsx` — renders an `iconPath` as a `<picture>` with a WebP source and PNG
  fallback, via `src/utils/iconUrl.ts` (see [data-model.md](data-model.md#icon-paths)).
  The `<picture>` is `display: contents` and its `<source>` is `display: none`, so the `<img>` is
  the only flex item it contributes and a parent's `gap` adds no extra space before it.
- `Modal.tsx` — the modal frame.
- `factory/Popover.tsx` — an absolutely positioned panel that closes on an outside pointerdown
  (except inside its optional `ignoreRef`, the trigger, so a click on the trigger just toggles) and on
  Escape, handled in the capture phase and prevented so it does not also clear a summary selection.
- `icons.tsx`, `IconButton.tsx` — the stroke SVG icons and the tooltip icon button of the top bar.
- `src/utils/viewTransform.ts` — pure pan/zoom maths (zoom around a point, pan, fit,
  centre) used by the technology tree.
- `src/utils/blockGraphLayout.ts` — layered layout of the blocks and their
  connections, used by the block graph.

---

## Not in the UI

Some store capabilities have no UI: undo/redo (`blockStore` keeps a per-block
history) and the per-product `byproductPolicy`
(`'discard'`). There is no URL sharing, settings panel, totals bar,
or responsive layout. Planned work lives in
[initiatives/backlog.md](../initiatives/backlog.md).
