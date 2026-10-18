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
   data has loaded (see [Game data selector](#game-data-selector)). Until then the
   table shows "Load game data to begin", the summary strip is hidden and the block
   tabs are disabled, so no edit can land in the wrong plan.
2. Starts auto-saving (`initAppStatePersistence`, `src/store/persistence.ts`) on
   every change, and subscribes to the game data store so the plan is swapped when
   a data set finishes loading.
3. Wires the solver (`wireSolver`, `src/store/solverStore.ts`): any change to the
   block store or the game data schedules a re-solve of the **active block**
   after a 150 ms debounce. A block with no goals or no recipe nodes gets an empty
   result without calling the solver.
4. Mounts `FactoryShell`.

Game data is not loaded at startup unless a dataset was chosen in an earlier
session (see [Game data selector](#game-data-selector)).

---

## Layout

`FactoryShell` stacks three regions full-height:

```
┌ TopBar ──────────────────────────────────────────────────────────────────┐
│ [▣][▣][+] Block name                         [Export plan] [Nullius ▾]   │
├ FactorySummary ──────────────────────────────────────────────────────────┤
│ Block name                                    ⚠ 2 warnings ▼   /sec·/min │
│ ┌ PRODUCTS ─────────────┐ ┌ BYPRODUCTS ─────────┐ ┌ INGREDIENTS ────────┐ │
│ │ [icon 60 → 58.2 /m] + │ │ [icon 12 /m]        │ │ [icon 30 /m] [🔒]   │ │
│ └───────────────────────┘ └─────────────────────┘ └─────────────────────┘ │
├ ProductionTable ─────────────────────────────────────────────────────────┤
│    │ Recipe          │ Machine      │ Beacon │ Products │ Byprod. │ Ingr. │
│ ▲▼ │ ▶ Smelting  3 recipes  ×                                            │
│ ▲▼ │ ♻ 📍 ⊞ × [icon] │ [mach 4][2/4] │ [+]    │ [..]     │ [..]    │ [..]⚡│
│ + Add recipe                                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

The layout is designed for desktop widths; there is no mobile layout.

---

## TopBar

`TopBar.tsx` is one row: block tabs on the left, the horizon button, plan export
and game-data selector on the right.

### Block tabs

`BlockTabs.tsx`. One square tab per block, showing the icon of the block's first
goal (or `?` when it has none); the full name is the tab's tooltip. The active
block's name is printed after the tabs.

- Click a tab to make that block active. Only the active block is shown, but
  every block is solved on each edit (blocks can feed one another; see
  [Ingredients pane](#ingredients-pane)).
- `+` adds a new empty block named "Block N" and activates it.
- Right-click a tab for a small menu: **Rename** (browser prompt) and **Delete**.
  Delete is disabled when only one block remains; deleting the active block
  activates the first remaining one.
- All of the above are disabled unless game data is loaded (not while it is empty,
  loading or failed to load).

### Research horizon

`HorizonButton` (in `HorizonPicker.tsx`) limits the recipes the pickers offer to
those researched up to a chosen point. It is hidden unless the loaded data set has
technology data. The label reads `Horizon: none`, `Horizon: <technology>` or
`Horizon: N technologies`.

Clicking it opens the **Research horizon** modal:

- Target chips (× removes one) and a **Clear** button. With no targets: "No limit:
  every recipe is offered."
- A line "N of M recipes available" (M counts non-hidden recipes).
- A search box and a scrollable list of every exported technology, sorted by name;
  clicking one adds or removes it as a target immediately.
- **Done** closes the modal.

The targets and all their prerequisites define the horizon (rule in
[data-model.md](data-model.md#technology)). It belongs to the plan, so it is saved
per data set and included in the export. Recipes already in the plan are not
marked and keep solving.

### Export plan

`ExportPlanButton` (in `GameDataSelector.tsx`) downloads the current `AppState`
(`{ blocks, activeBlockId, horizonTechnologyIds }`) as `factorio-plan-YYYY-MM-DD.json`. There is no
import button; a saved file is the same shape the app keeps in `localStorage`.

### Game data selector

`GameDataSelector` (in `GameDataSelector.tsx`) is a dropdown with:

- the bundled datasets, **Nullius** and **Seablock** (served from
  `public/data/<dataset>/game-data.json`);
- **Upload file…**, which opens a file chooser for a custom `game-data.json`;
- the name of the uploaded file, once there is one.

Picking a bundled dataset remembers the choice in `localStorage` and clears any
stored upload. An uploaded file is stored in IndexedDB (database
`factorio-planner`) and reloaded on the next visit. With neither, the dropdown
shows "Select game data…" and nothing is loaded. A "Loading…" or "Error loading
data" label appears next to the dropdown while loading or after a validation
failure (the tooltip carries the error message).

Each data set has its own plan. When a data set finishes loading and differs from
the previous one, the plan stored for it replaces the one on screen (or an empty
"Factory" block if it has none); switching back restores the earlier plan. The
plan is identified by the loaded source id: the dropdown value for a bundled
dataset, or `custom:<filename>#<fingerprint>` for an
upload, where the fingerprint is a short hash of the data's `modSet`, so uploads
with different names or different mod sets do not share a plan (two files with the
same name and the same mod set do; the dropdown still shows `custom:<filename>`).
Reloading the same data set does not reset the plan, and a failed load leaves the
current plan untouched.

Only one upload exists at a time, so its plan does too: activating an upload
removes the plans of earlier uploads, and picking a bundled dataset (which clears
the stored upload) removes every upload plan.

Legacy data-set id. A `kompetenz-seablock/` value stored in `localStorage` by
older versions is normalised to `kompetenz-seablock` and rewritten on load; if the
rewrite fails (quota full, storage blocked) the normalised id is still used.

A stored plan that fails validation is not overwritten: its raw value is first
copied to `<key>:corrupt` (e.g. `factorio-planner:app-state:nullius:corrupt`), and
the data set starts with an empty plan.

**Legacy plan.** Before plans were per data set, the single plan lived under
`factorio-planner:app-state`. The first data set activated without a plan of its
own adopts it and the legacy key is deleted. If the legacy plan cannot be read it
is moved to `factorio-planner:app-state:corrupt` instead of being deleted.

---

## FactorySummary

`FactorySummary.tsx` is the summary strip for the active block.

### Header row

- **Block name** — click to edit inline; Enter or blur saves, Escape cancels.
- **Warnings** — `WarningsPopover` (see below), shown only when the last solve
  produced warnings.
- **Rate unit toggle** — `/sec · /min`, stored in `uiStore` and persisted. The
  default is `/min`. It changes how every rate in the summary and the table is
  displayed; stored values are always per minute.

### Products pane

One `GoalTile` per block goal: item icon, target rate, `→` actual rate, unit.

- The target is clickable and edits inline (in the current display unit).
- The actual rate is the item's net balance across all solved nodes; it appears
  once the solver has a result.
- `×` (on hover) removes the goal.
- `+` opens the [item picker](#item-picker) to add a goal.
- An `ExportChip` (`→ <consumer> <rate>`) follows the goal's tile for each block
  that receives the item from this one. Click it to open that block.

### Byproducts pane

Every item with a positive net balance that is not a goal, as `ItemTile`s. The
rate shown is the net balance minus what other blocks receive; a tile is hidden
when nothing is left. `ExportChip`s for exported non-goal items follow the tiles.

### Ingredients pane

The solver's `unsatisfied` list: everything the block must import (goal
shortfalls, intermediate slack, raw resources), as `ItemTile`s.

- Clicking a tile adds the item to the block's `noImportItems`, which forbids
  the solver from importing it.
- Right-clicking a tile opens `ConnectionMenu` ("Receive <item> from"), except on
  a goal shortfall (goals are never fed by connections, so those tiles have no
  menu): one entry per other block that still has the item to give (the offered
  rate minus what it already delivers to other blocks; sources with nothing left
  are not listed),
  excluding blocks already connected for that item and blocks that would close a
  cycle. Choosing one adds a connection to the active block. With no candidate
  the menu reads "No other block produces this item". It closes on Escape or a
  click outside.
- Connections come first, as `ConnectionChip`s: item icon, `delivered/needed`,
  `← <source block>` (click to open the source) and `×` (removes the connection;
  undoable). `needed` is what is delivered plus what is still imported. States:
  normal; `limited` (amber border, tooltip "Limited: <source> only offers N",
  the rest of the need stays in the tiles); `unused` (dimmed, tooltip "Not used:
  this block makes or needs none from outside"); `(deleted block)` or `(cycle,
  ignored)` (grey; remove with `×`).
- Each no-import item is shown after the tiles as a dimmed chip with a 🔒; click
  it to allow imports again.

### Warnings popover

`WarningsPopover.tsx`. A `⚠ N warnings` button, yellow, or red when any warning is
`infeasible-pins`. Clicking it opens a list where each warning has a title, an
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
  Products, Byproducts, Ingredients — and a `+ Add recipe` footer.

`+ Add recipe` opens the [recipe picker](#recipe-picker); the chosen recipe is
appended to the block's root plan as a new node with default settings.

Row order is the order of the nodes in each sub-plan. The table is not sortable;
the user arranges rows by drag-and-drop or the ▲/▼ buttons.

### Recipe rows

`RecipeRow.tsx`, one per `GameRecipeNode`. Rows inside a sub-factory are indented
by depth. Nodes whose recipe does not exist in the loaded data render nothing.

**Reorder cell.** ▲/▼ move the node within its sub-plan (disabled at the ends).

**Recipe cell.** Hover reveals the action buttons, which stay visible when active:

- ♻ **Byproduct consumer** toggle — "Only run to absorb byproduct from other
  recipes" (sets `byproductConsumer`; green when on).
- 📍/📌 **Pin** — pins the recipe at its current throughput (at least 1); hidden on
  byproduct-consumer rows. While pinned, the Products cell becomes a number input
  for the pinned rate.
- ⊞ **Wrap in subfactory** — prompts for a name (defaults to the recipe name) and
  replaces the row with a new sub-factory containing just this node.
- × **Remove**.

Then the recipe icon: the icon of the primary product (falls back to the first two
letters of the recipe name), with the recipe name as tooltip.

**Machine cell.** `MachineCell` (machine icon with the rounded-up machine count)
and, when the machine has module slots, `ModuleCell` (first module's icon, or
`+`, with a `used/total` slot badge). Both open the
[Edit machine modal](#edit-machine-modal).

**Beacon cell.** `BeaconCell` (in `BeaconPopover.tsx`). Without a beacon, a `+`
button creates one — the first non-hidden beacon type by name, the first module by
name, 4 beacons — and opens the [Edit beacon modal](#edit-beacon-modal). With a
beacon, it shows the beacon icon and `N×`; click to edit.

**Products cell.** The output that counts as the primary product
(`primaryProduct`, else the recipe's `mainProduct`, else its first product), as an
`ItemTile` with its rate.

**Byproducts cell.** Every other output. On multi-output recipes, clicking a
byproduct makes it the primary product (it swaps places with the current one).

**Ingredients cell.** Every input with its rate. Clicking one opens the recipe
picker filtered to recipes producing that item; the chosen recipe is added to the
same sub-plan as the clicked row. A ⚡ tile at the end shows the row's power draw
(auto-scaled W / kW / MW / GW) when it is above zero.

Rates come from the last solve; before a solve (or for a row the solver did not
reach) the rate cells are empty and the machine count is 0.

### Sub-factory rows

A `SubPlanNode` renders as a group row: ▶/▼ toggle, sub-plan name, recipe count,
and × to remove the sub-factory **with all its contents**. Expanding shows its
nodes indented beneath it (including nested sub-factories); an empty expanded
group shows a "Drop here" target. Expanded/collapsed state is not saved.

Sub-factories exist only to organise the table; the solver ignores the grouping.
There is no UI to rename a sub-factory after creating it.

### Drag and drop

Every row (recipe or sub-factory) is draggable with native HTML5 drag-and-drop.
`RecipeDnd.tsx` holds the drag state in a context; the drop logic is in
`RecipeRow` and `ProductionTable`.

- Dropping on the top or bottom half of a recipe row inserts before or after it
  (a blue line marks the spot).
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
- Clicking an item adds it as a goal immediately when the amount is valid;
  **Submit** does the same for the last clicked item.

### Recipe picker

The same component in recipes mode (`source="recipes"`).

- Search box (substring on recipe name or id) and a **Hidden recipes** checkbox
  (hidden recipes are excluded by default).
- Item-group tabs (only when results span more than one group), then recipe
  slots in subgroup rows. Each slot shows the icon of the recipe's main product.
- Hovering or focusing a slot shows a side panel with the recipe's ingredients,
  crafting time, products (with probability) and the machines that can make it.
- When opened from an ingredient, only recipes producing that item are listed and
  the subtitle reads "Choose a recipe to produce '…'".
- Recipes outside the [research horizon](#research-horizon) are left out. When
  that empties the list, it reads "No recipes match within the research horizon
  (N outside it)".
- Clicking a slot adds the recipe and closes the picker.

### Edit machine modal

`EditMachineModal.tsx`, opened from the Machine cell.

- **Machine** — the current machine; clicking it lists **Default** (use the
  category's default machine) and every non-hidden machine that can craft the
  recipe's category. The same list has an **Alternate recipe** section: other
  non-hidden recipes inside the research horizon that produce the current recipe's
  main product. Choosing one
  swaps the row's recipe and resets its machine, modules, beacon, pin and other
  settings.
- **Modules** (only when the machine has slots) — each configured module with −/+
  counts, and an "add module" dropdown. Only modules whose effects the machine
  allows (and whose recipe limitations permit the recipe) are offered; the total
  never exceeds the machine's slots.
- **Effects** — "Module effects" (raw totals) and "Recipe effects" (after the
  machine's allowed effects, and with productivity zeroed if the recipe disallows
  it). Quality is listed only when relevant.

### Edit beacon modal

`BeaconModal.tsx`, opened from the Beacon cell.

- **Beacon** — beacon type (non-hidden beacons; picking one copies its module
  slots and distribution efficiency into the config) and **Amount** (beacon
  count). When the data has no beacon entities, editable "Modules/beacon" and
  "Efficiency" fields appear instead.
- **Effects** — "Beacon effects" and "Recipe effects", as in the machine modal.
- **Module** — the module placed in every beacon slot.
- **Remove beacon**.

---

## Shared pieces

- `ItemTile.tsx` — the coloured rate tile used everywhere (variants product,
  byproduct, ingredient, electricity), plus `fmtRate` and `fmtPower`. Rates show
  0–2 decimals depending on magnitude.
- `Icon.tsx` — renders an `iconPath` as a `<picture>` with a WebP source and PNG
  fallback, via `src/utils/iconUrl.ts` (see [data-model.md](data-model.md#icon-paths)).
- `Modal.tsx` — the modal frame.

---

## Not in the UI

Some store capabilities have no UI: undo/redo (`blockStore` keeps a per-block
history), renaming a sub-factory, and the per-product `byproductPolicy`
(`'discard'`). There is no plan import, URL sharing, settings panel, totals bar,
or responsive layout. Planned work lives in
[initiatives/backlog.md](../initiatives/backlog.md).
