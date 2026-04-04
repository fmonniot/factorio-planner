# UI Specification

The UI is inspired by helmod: panel-based, information-dense, and structured around recipe nodes. It is not a visual flow editor — the layout is computed, not freeform.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ HEADER: plan name  |  [New] [Open] [Import] [Export]  |  [⚙ Settings] │
├──────────────┬───────────────────────────────────────────────────┤
│  GOALS       │  PRODUCTION TREE                                  │
│  ─────────   │                                                   │
│  [+ Add]     │  (recipe cards, see below)                        │
│              │                                                   │
│  🟩 Green    │                                                   │
│     Circuit  │                                                   │
│     60/min   │                                                   │
│  🔩 Iron Gear│                                                   │
│     30/min   │                                                   │
│              │                                                   │
├──────────────┴───────────────────────────────────────────────────┤
│  SUMMARY: 42 machines  |  1.2 MW  |  Raw: iron-ore 180/min  ...  │
└──────────────────────────────────────────────────────────────────┘
```

### Panels

**Goals Panel (left sidebar)**
- Fixed-width sidebar listing active production goals.
- Each goal shows item icon, name, rate (editable inline), and a remove button.
- "Add goal" opens the item picker.
- Clicking a goal highlights its root node in the tree.

**Production Tree (main area)**
- Scrollable canvas displaying recipe nodes in a top-down tree.
- Default layout: each level of the dependency tree is a horizontal row of cards.
- Nodes that supply multiple consumers are shown once; their edges fan out to each consumer.
- View toggle: Tree | Table | (future: Sankey).

**Summary Bar (bottom)**
- Total machine count, total power draw (MW), list of raw resource rates.
- Clicking a raw resource scrolls to the nodes consuming it.

---

## Recipe Card

The primary UI atom. One card per `RecipeNode` in the solved plan.

```
┌────────────────────────────────────────────────────┐
│ [icon] Electronic Circuit          [▼ alt recipe]  │
│ ──────────────────────────────────────────────────  │
│  Rate:      60.0 /min     [🔒 pin]                  │
│  Machines:  3.0  → 3 × [Assembler 3 ▼]             │
│  Power:     0.45 MW                                 │
│ ──────────────────────────────────────────────────  │
│  Modules: [Speed 3 ×4 ▼]  Beacons: [configure]     │
│ ──────────────────────────────────────────────────  │
│  Inputs:                                            │
│    🔩 Iron Plate    120/min  (from Iron Smelting)   │
│    🔵 Copper Cable  180/min  (from Copper Drawing)  │
└────────────────────────────────────────────────────┘
```

### Card Elements

- **Header**: item icon, recipe name, optional alternate-recipe dropdown (shown only if alternatives exist).
- **Rate**: computed items/min. Editable to pin the rate (locks this node as a free variable for the solver). Pin indicator shown when active.
- **Machines**: exact count (e.g. `3.0`) and ceiling (e.g. `3 ×`). Machine type is a dropdown filtered to machines that support the recipe's category.
- **Power**: total kW for this node including drain.
- **Modules**: per-node module configuration (slot count enforced). Optional — collapses when no modules set.
- **Beacons**: opens a popover for beacon/module/count configuration.
- **Inputs**: each ingredient with its rate and the name of the upstream recipe card providing it. Clicking an input scrolls to its source card.

### Card States

- **Normal**: default
- **Highlighted**: when its goal is selected in the Goals panel
- **Warning**: solver warning on this node (underdetermined, cycle) — amber border + tooltip
- **Pinned**: rate is user-overridden — blue border
- **Rate changed**: node's computed rate changed from the previous solve (e.g. because a newly added recipe's byproduct now covers some of its demand) — briefly animated, then settled. Prevents silent re-routing surprises caused by the feed-back byproduct default.

---

## Item Picker

Used to add goals and to select alternate items/machines/modules.

- Modal dialog with search input (fuzzy search on item name and id).
- Results show item icon + name + type (item/fluid).
- For adding a goal: after picking the item, a rate input appears inline.
- Keyboard-navigable; Enter selects.

---

## Table View

Flat list of all recipe nodes, sortable by:
- Recipe name
- Rate (executions/min)
- Machine count
- Power (kW)

Each row has the same inline-edit affordances as the tree card (machine picker, module config, pin toggle). Useful for large plans where the tree becomes wide.

---

## Settings Panel

Accessible via the settings icon in the header.

- **Default machine per category** — set global defaults used for new nodes.
- **Default module configuration** — applied to all new nodes.
- **Rate unit** — items/min, items/sec, items/tick.
- **Game data** — current loaded bundle version; button to import a custom bundle (JSON file).
- **Plan management** — list saved plans in localStorage, rename, delete.

---

## Import / Export

- **Export plan**: downloads a `.json` file of the `Plan` object.
- **Import plan**: file picker that loads a previously exported plan.
- **Share URL**: serializes the plan to a compressed base64 query parameter (`?plan=...`). Long plans may exceed URL length limits — a warning is shown in that case.
- **Import game data**: loads a custom `GameData` JSON bundle (for mods). The bundle replaces the active game data for the current session; the user is warned that existing nodes referencing removed recipes will be invalidated.

---

## Responsive Behavior

The layout is designed for desktop (1280px+). On smaller screens:
- Goals panel collapses to an icon-only rail; tap to expand as an overlay.
- Summary bar collapses to a single summary line with a tap-to-expand drawer.
- Recipe cards in tree view switch to a compact single-column list.

Full mobile editing is not a goal for v1.
