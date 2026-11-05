# Recipe table redesign

Status: Future

## Context

The production table is hard to read at the block level and its editing lives behind right-click modals:

- A block with many rows needs a lot of scrolling, and the Machine and Beacon columns repeat the same icon-and-badge idea differently.
- Machine, module and beacon settings open in separate modals ([Edit machine](../../spec/ui.md#edit-machine-modal), [Edit beacon](../../spec/ui.md#edit-beacon-modal)). The effects of the two add up to one result, but nothing shows that.
- A row holds a single beacon configuration (`beaconConfig`) and a beacon cannot exist without a module. The redesign builds the final UI of the design canvas, which draws several configurations, on top of the single one; several come afterwards, see [multiple beacon configurations](../multiple-beacon-configs/plan.md).
- How an item is sourced (own recipes, byproducts, connections) is set from a right-click menu on an item chip, and is only visible as a small `B` / `C` badge.
- Nested sub-factories have no visual structure beyond indentation.

The goal behind the redesign: find which combination of recipes should produce an item, while seeing a whole block at a glance, with the common edits one click away.

The design was explored and refined on a design canvas (private to the owner: <https://claude.ai/artifact/TEB9TKR7Qhze4gy3efMMGh>). It has two screens: **1 Current table** (the existing table redrawn at real scale, for comparison only) and **2 Target design** (interactive: use Play), plus notes beside screen 2 that carry the same requirements as this document. This document is the durable copy of those requirements. The canvas is the visual reference, and its data is invented.

Real scale means the planner's own sizes: recipe, machine, module and beacon icons 32px, item icons 28px, table text 12px. Earlier explorations that drew smaller icons looked denser than they were.

## Design

### Icon chip

One reusable component for every icon-with-a-number in the table: the icon, a quantity in its **bottom-right** corner (9px bold monospace with a dark outline, as Factorio draws stack counts), and an optional badge in its **top-right** corner. It replaces `ItemTile`'s side-by-side icon and rate in the table.

- Bottom-right is always a quantity: an item rate, the machine count, a module chip's used/slots, a beacon count, a beacon module chip's modules per beacon over slots.
- Top-right is always a badge: amber pin (the product's rate is pinned), lavender `+N` (the row has N more beacon configurations; built, but never shown until [several are supported](../multiple-beacon-configs/plan.md)), amber `B` or `C` (the item is not on Own recipes first).
- A cell that holds chips must not use `overflow: hidden`; it clips the badges.

### Columns

Reorder handle, then:

| Column | Content |
|---|---|
| Recipe | Recipe icon and name (ellipsis, tooltip), one 12px tree guide per nesting level. |
| Machine | Machine chip (count in the corner), then the module chip (used/slots). Empty modules: a dashed `+` chip reading `0/N`. |
| Beacons | The first configuration only: beacon chip (count) and its module chip (modules per beacon / slots). A `+N` badge on the beacon icon when there are more; the tooltip lists them all. A dashed `+` when there is none. |
| Products | Product chips, right-aligned. The pin badge sits on the chip. |
| Byproducts | Byproduct chips, red rates. Sized for three chips. |
| Ingredients | Ingredient chips, green rates. Takes the remaining width. |
| Power | The row's power, cyan, right-aligned. |

Products, Byproducts and Ingredients are adjacent on purpose: everything a machine outputs reads together, then what it consumes. Headers keep the planner's names. There is no column picker. At the 1280px reference width the table is 900px wide and the side panel 380px; closing the panel gives the table the full width.

The recipe icon can differ from the product (an oil processing recipe's own icon makes petroleum gas), which is why Products shows item icons. Pinned rate: the chip shows the rate plus the pin badge; the inline editable input of today's table is dropped on purpose and the rate is edited in the panel.

### Selected row and side panel

A row (or sub-factory) is selected by clicking it (anywhere that is not a button or field), its recipe icon and name, or one of the shortcuts below. The selected row gets a teal bar on the left and a tinted background, and a **side panel** opens on the right. The table does not move or resize. The panel replaces the Edit machine and Edit beacon modals and adds the sourcing controls. It has a close button.

Sections, in order:

1. **Header.** Row icon and recipe name.
2. **Rate.** Pin checkbox, the pinned value with its unit, "= N runs/min".
3. **Machine.** A picker button (32px machine icon with a chevron; the name is its tooltip) that opens a list of icon, name and speed. Seablock recipes can have around six machines and the assemblers look alike, so the open list shows names. Beside the button: "N needed" and "X exact · Y% busy". Below: the machine's module slots, one button per slot.
4. **Beacons.** One card per configuration: beacon type button (chevron, opens a list limited to the research horizon), count input, one button per module slot, remove, and a line with efficiency and what the configuration contributes. A dashed "+ Add beacon configuration" button below. Until several configurations are supported the row has at most one card, and the button is disabled once there is one (title "One beacon configuration per recipe for now").
5. **Effects on this row.** Speed, productivity and energy as rows; columns Machine, Beacons 1…n and Total (a single Beacons column while a row has at most one configuration). Footnote: beacon effect = module effect × efficiency × modules per beacon × beacons; all sources add up. This is what makes the relation between machine and beacon modules visible.
6. **Where inputs come from.** One entry per ingredient: item icon, name, rate; a three-way choice **Own recipes / Byproducts / Connections** (titles "Own recipes first" and so on, `itemSourcing`); one explanatory sentence; a **Forbid imports** checkbox (`noImportItems`). The mode is per item for the whole block, so every row that uses the item follows it.

Every picker follows one pattern: rows of icon and name, filtered by the research horizon and by the existing rules (`effectAllowed`; productivity modules only when the recipe allows productivity; a beacon accepts only the effects of its entity). Pickers close on a click away and on Esc.

### Panel for sub-factories

The panel shows exactly one of a recipe row (the six sections above), an organising sub-factory or a separate area, and exists only while one is selected. There is no "nothing selected" state: the close button clears the selection and the table takes the full width. A group row is selected by clicking it anywhere that is not its chevron button or a field.

Both group states are read-only (drawn on screen 3 of the design canvas):

- **Sub-factory (organising group).** Header with a folder icon, the name and the nesting level ("Sub-factory · level N of 4"). Recipes and machines (recursive, as on the group row) and power. **Inside this group**: the rows and groups directly below it, each a button that selects it, with its machine count and power. A closing line says the group only organises rows and that Separate area, from its right-click menu, tracks what it sends and receives.
- **Separate area.** The same, with the **Area** marker in the header, plus **Receives** and **Sends** lists: item icon, name, rate and the other end ("from Oil", "to the rest of the block"). They hold the same items as the chips on the group row. An area with nothing to send or receive shows an empty list with a short line saying so.

Rename, Separate area, Duplicate to… and Remove stay in the group's right-click menu, which is unchanged.

### Shortcuts from the table

Everything clickable is a real button. The row click is a pointer convenience; the recipe name button is its keyboard path, and the row handler ignores clicks that come from a button or field.

- **Machine chip:** opens the machine picker under the chip. Changing the machine type is common enough to justify the shortcut.
- **Module chip with modules:** opens the panel and highlights the Machine section (slots can hold mixed modules, so there is no quick picker).
- **Empty module chip (dashed `+`):** opens a picker that **fills every slot** with the chosen module.
- **Empty beacon module chip:** the same fill-all picker, limited to the modules a beacon accepts (speed and efficiency, not productivity).
- **Empty beacon `+` (the row has no beacon):** the same picker, headed "Add 4 × Beacon, fill its slots with". It creates a configuration with the default beacon type (first available by name) and 4 beacons, which is what the `+` button creates today. Type and count change in the panel.
- **Filled beacon chips:** open the panel and highlight the Beacons section.
- **Product, byproduct and ingredient chips** stay buttons with today's behaviour: an ingredient click opens the recipe picker filtered to producers of the item; a byproduct click makes it the primary product; the byproduct right-click menu keeps **Add consumer recipe…** (shown only when the row can add one). Area chips on a group row are display-only.
- **Dropped:** the sourcing choices in the right-click menus of the chips. The panel's sourcing section covers them. A product or ingredient chip therefore has no right-click menu; the byproduct menu is left with its single entry (no divider, no radios); the tooltip hints about choosing a sourcing mode go away. The `B` / `C` badge stays.

### Group rows (sub-factories)

A sub-factory is a group row in the same grid:

- The same drag handle as a recipe row (rows and groups are both draggable).
- One 12px vertical guide line per ancestor level, running the full row height so the tree reads as one continuous line. Recipe rows use the same guides.
- A chevron **button** (`aria-expanded`, label "Collapse X" / "Expand X"), then the name, the **Area** marker when it is a separate area, then a summary: recipe count (recursive, as today) and machine count.
- The Power column shows the group's recursive total. The background gets slightly darker with depth.
- A collapsed group hides everything below it until the next node at its depth or shallower. Expanded or collapsed state is still not saved.
- A separate-area group shows what it sends in Products and what it receives in Ingredients, expanded or collapsed (up to four chips per side, then the existing `+N` popup). An organising group shows no chips. The chips line up with the recipe rows' chips on the same right edge.

**Nesting limit: 4 levels.** A row or group may sit inside at most four ancestor groups. The data model has no limit; the app adds one. At the reference layout (Recipe column 170px, Recipe + Machine + Beacons spanning 338px on a group row) a row 4 levels deep has about 78px for its name and a group row about 255px for name, Area marker and summary. At 5 levels that is about 66px and 246px, at 6 about 54px and 234px, and the group summary starts to clip. A higher limit means a wider Recipe column, taking width from Ingredients.

- Disable the actions that would go past the limit and say why in the title, as **Duplicate to…** does today (for example "Cannot nest deeper than 4 levels"): adding or wrapping in a sub-factory, and dropping a row or group onto a group. When moving a group, count its own deepest descendant: target depth plus the height of the moved subtree.
- Plans already deeper than the limit still load and render. They are not flattened or rewritten; the indent just stops growing at 4 levels.
- One constant, read by both the UI and the store commands.

### Sourcing sentences

The sentence under each sourcing choice is built by a pure function of the item, its mode, the block and the solve result, in the style of `productChangeText.ts` and `fmtTemperatureWarning`. There is no generated text. Rates go through `fmtItemRateText`.

| Mode | Sentence |
|---|---|
| Own recipes first | "Made in this block by {recipe} ({n} × {machine})." If no row makes it: "No row here makes {item}; it is imported." With Forbid imports on, append " Imports are forbidden." |
| Byproducts first | "Uses byproducts of other rows first ({recipe} {rate}/min, …). {recipe} makes the rest." With none: "No row here makes {item} as a byproduct, so {recipe} covers it." |
| Connections first | "Takes {item} from {block} first ({offered}/min offered), then {recipe} makes the rest." Drop the second half when the connection covers everything. With no connection: "No connection for {item}; {recipe} covers it." |

Inputs: the mode from `block.itemSourcing`, the connections from the block, the offered rate as in the connection menu, and recipe, machine and count from the solved rows. "The rest" depends on how much the solver took from each source (the solve result), not only on the settings. A wording-free alternative is a breakdown of the solve result, for example "Plastics block 120/min · Plastic bar (1 × CP) 0/min".

## Data model and solver

The design canvas is the final UI, including its several beacon configurations. To avoid building the beacon UI twice, the redesign implements it as drawn, over a list, and the data model stays single for now:

- The components take the configurations as a list. A small adapter gives them `beaconConfig ? [beaconConfig] : []` and writes edits back to `beaconConfig`. The `+N` badge, the tooltip listing all configurations, the per-configuration cards and the per-configuration Effects columns exist but only ever render one configuration.
- The "+ Add beacon configuration" button is disabled once a row has a configuration, with the title "One beacon configuration per recipe for now". Removing the card re-enables it.
- [Multiple beacon configurations](../multiple-beacon-configs/plan.md) then replaces the adapter with `beaconConfigs` and removes the disabled state; the UI itself does not change.

`BeaconConfig.moduleId` also becomes optional, so a beacon can exist without a module. The configuration then contributes nothing. This is the state after the fill-all picker's `+` is used for the beacon but not for its modules, and the panel's per-slot buttons can be emptied.

- `moduleId` optional in `BeaconConfigSchema`; `computeNodeEffects` skips a configuration without one; the snapshot already skips it (`src/snapshot/project.ts` does not send a config with no `moduleId`, per [data-model.md](../../spec/data-model.md)). Older plans load unchanged.
- Machine modules stay `ModuleConfig[]` (`moduleId`, `count`). The panel's per-slot buttons are a view over it. The table's module chip shows the icon of the most used module type with used/slots (see Decisions). A beacon module chip shows `modulesPerBeacon` over the beacon's slot count; fewer modules than slots is possible because the modal copies the slot count from the beacon entity.
- A beacon without a module is shown as a beacon chip plus a dashed module chip.
- Sourcing data is unchanged: `itemSourcing` and `noImportItems`.

## Carry over from today's modals

The mock does not draw these; the implementation must keep them:

- "Apply to every row of this recipe (N)" footers, as one undoable command.
- The amber warnings and rings: outside the research horizon, more modules than slots, no machine within the horizon.
- The "Recipe effects" note and the effect filtering.
- Burner fuel and reactor neighbour count.
- The disabled states of the sourcing choices (an item that is a product of the block keeps only Own recipes first; Forbid imports is disabled for an item no row makes).

## Decisions

- **Narrow widths** (table 900 + panel 380 needs 1280px): handled by the "Responsive layout" backlog item.
- **Keyboard use** (arrows between rows, Esc closes the panel): handled by the "Keyboard navigation" backlog item.
- **By-recipe view:** dropped, along with the expand chevrons on recipe rows per area. It is not used.
- **Several products:** the Products cell shows the primary product (`primaryProduct`, else `mainProduct`, else the first product) and the other outputs are byproducts. The exception is `primaryProduct: null` (explicitly multi-output), where the row has no primary; the chip code takes a list so such a row can show every output in Products.
- **Inline pinned-rate input:** dropped. The rate is edited in the side panel's Rate section; the Products cell shows a chip with the pin badge.
- **Group right-click menu and "Drop here" row:** unchanged, not redrawn; the nesting-limit disables are added to the menu entries.
- **Panel selection:** the panel shows one recipe row, one organising sub-factory or one separate area, and only while one is selected; no "nothing selected" state. Group states are read-only. See "Panel for sub-factories".
- **Mixed module types in the module chip:** the chip shows the icon of the most used module type; on a tie, a deterministic pick (first by module id).

## Phases

- [x] **1. Optional beacon module.** `BeaconConfig.moduleId` optional, `computeNodeEffects` skips such a configuration, unit tests, [data-model.md](../../spec/data-model.md) and [solver.md](../../spec/solver.md).
- [ ] **2. Icon chip, columns, group rows.** The chip component, the new column set with the new order, group rows with guides and chevrons, the nesting limit constant and its disabled actions.
- [ ] **3. Side panel.** Selection, the panel and its six sections, replacing the Edit machine and Edit beacon modals (keeping everything under "Carry over"), the sourcing sentences.
- [ ] **4. Pickers and shortcuts.** The shared picker pattern, the machine and beacon pickers, the fill-all pickers, the row and chip shortcuts.
- [ ] **5. Remove the chip sourcing menu.** Keep the byproduct **Add consumer recipe…** entry and the `B` / `C` badge.
- [ ] **6. Docs and tests.** [ui.md](../../spec/ui.md) (production table, Edit machine and Edit beacon modal sections, item chip sourcing menu, sub-factory rows), the README "Using the planner" section and repository map, and Playwright specs in `e2e/` for the interactions (row click, shortcuts, pickers, panel close, group collapse, nesting limit).

## Alternatives considered

Explored on the canvas and rejected:

- An inline drawer under the selected row: it pushes every row below it down.
- A master/detail inspector and an item ledger (flow by item): they hide the block as a whole, which is what the table is for.
- Reading-order columns (inputs, machine, outputs): no gain over keeping the outputs adjacent.
- A compare table of candidate recipes with manual share percentages: the planner has no manual split. The sourcing section matches its three modes instead.
- A segmented control for the machine type: it does not scale to six machines.
- Smaller icons and shorter rows: they only looked denser. At real scale the gain comes from the column layout.
