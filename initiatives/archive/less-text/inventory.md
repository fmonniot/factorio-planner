# Less text: inventory

Every place the app is overly verbose, found by sweeping `src/components/` on 2026-11-24. Paths are relative to `src/components/`; line numbers are those of that day. All four sections are in scope ([plan.md](plan.md)).

---

## Outcome

Every item of sections 1 to 4 below is shipped or left on purpose. The bullets themselves are kept as they were found. T1 to T7 are the tickets of [plan.md](plan.md).

| Section and item | Outcome |
|---|---|
| 1. Where inputs come from | Shipped (T3, T4): the Sources model laid out as lines |
| 1. Where outputs go | Shipped (T1): the outputs model laid out as lines |
| 1. Comes from: the leftover-take note, rules without effect | Shipped (T4) |
| 1. Area matrices: not taken, not supplied, an area's contents | Shipped (T7): label and figure rows in the Inspector, a definition list of name chips in the area panel |
| 2. Sources list, line detail | Shipped (T5): the help is the name's tooltip |
| 2. Group panel | Shipped (T7): a tooltip on the "Separate area" label and a **Make it a separate area** button |
| 2. Effects section | Shipped (T7): the formula is the title's tooltip; the amber note is gone |
| 2. Neighbours section | Shipped (T7): a tooltip on the title and one on the drawing; the other paragraphs are gone |
| 2. Module misfit note | Shipped (T7): dropped, the ringed slot's tooltip says it |
| 2. Served order popover | Shipped (T7): the first rule is the title's tooltip; the rest of the manual is gone |
| 2. Area matrix panel note | Shipped (T7): the ordering rule is the tooltip of the Trades with heading; the note is gone |
| 2. Plan areas legend | Shipped (T7): tooltips on the Net, Not taken and Not supplied headers; the footer keeps the unit |
| 3. Labels and tooltip tails (all) | Shipped (T6) |
| 4. Long tooltips (all) | Shipped (T6) |

Left on purpose:

| What | Why |
|---|---|
| The block graph connection chip's dash-chained data tooltip (`useConnectionDetail().title`) | Facts, not hints |
| The "No connection for {name}." notice of the Sources list | State, not help (T5) |
| The accessible-description duplication of two-line tips under `describedTip` (the description repeats the name) | Fixing it needs `tipProps(name, detail)` and about ten test changes: a follow-up |
| The warnings popover, empty states, confirmation dialogs and screen-reader announcements | Out of scope from the start |
| The served-order popover's one conditional hint ("Lines of one place that are not in a bracket (a block's areas) are served in table order. Move or share one to rank them apart.") | Only for a legacy plain entry that covers several areas; not in the manual or this inventory; the owner may drop it |
| The Inspector's "leaves the block" / "enters the block" and connection lines | Data sentences |
| The overview segments' "N items" | Kept in T6 |
| The Leftover tooltip's lost caveats and the rule chip no longer saying how to change the rule | Accepted in the T6 pull request |
| The Neighbours grid's "Not used: you typed your own average below." and the invalid-average note | Validation and state, not help |
| The Machine section's "No machine within research horizon…" amber sentence | A state; it was never in this inventory |

---

## 1. Running-prose sentences built from data

### Where inputs come from — `factory/sourcingText.ts:60-125`

One builder, read by four surfaces through `useSourcingSentence` / `useBlockSourcingSentence`:

- Details panel, Where inputs come from (`factory/sidePanel/SourcingSection.tsx:38`).
- The strip of a selected Ingredients slot (`factory/ComesFrom.tsx:180`, clamped to two lines), e.g. "No row here makes Zinc ore; it is taken from Ores, and the rest is imported."
- The text of each item in the Source rules list (`factory/SourceRulesButton.tsx:74`).
- The tooltip of the source rule marker (`factory/SourceRuleMarker.tsx:46,72`).

Variants:

- Make it here: "Made here by X (n × Machine) and Y (n × Machine), and taken from B (rate)." / "No row here makes X; it is taken from A and B, and the rest is imported." / "No row here makes X; it is imported."
- Receive it first: "Taken from A and B first (rate offered), then X makes the rest." / "No connection for X; Y covers it." / "No connection for X; it is imported."
- Don't make more here: "Uses what this block already makes (X rate, Y rate), then takes from B. The rest is imported." / "No row here already makes X; it is taken from B, and the rest is missing: Import is off."
- Suffixes: " Import is off."; an area's sentence starts "Area: …" and can end " Takes nothing from A and B."

### Where outputs go — `factory/outputsText.ts:66-93`

Shown under each output of the Details panel (`factory/sidePanel/OutputsSection.tsx:29`):

- "A product of this block; Used here by X (absorber, takes 3/m) and Y in Area (takes 1/m); Sent to B (2/m); 2/m left over."
- With other makers: "Used in this block by …", "Sent from this block to …", "… left over in this block", and the tail "These are the block's rates: 2 other rows also make it."
- Single states: "Discarded: this row's X is not counted, so no row or block takes it from here." / "Not produced: this row makes no X at the moment." / "Left over: no row or block uses it (rate)." / "Not used by any row or block." / "Not solved yet."

### Comes from

- The leftover-take note (`factory/ComesFrom.tsx:116`, text in `factory/itemSourcing.ts:68-70`): "B takes X from this block. It gets only what the rows here cannot use; make X a product to send it more."
- Rules without effect (`factory/sourceRules.ts:205-207`, shown in Comes from and the Source rules list): "X is a product of this block, so the block always makes it." / "No row in this area makes X." / "No connection for X."

### Area matrices

- Plan areas, a row's detail (`factory/AllBlocksMatrix.tsx:327-332`): "N/m is not taken by any block (extra output, byproduct or surplus)." / "N/m is not supplied by any block: it is imported."
- Area panel of a block (`factory/BlockAreaMatrix.tsx:439-441`): "Sub-factories: a, b." / "Areas inside: …" / "Rows include a, b, c, d and 3 more."

## 2. Help paragraphs printed on the page

Most repeat a tooltip of the same control.

- **Sources list, the detail of an expanded line** (`factory/SourcesList.tsx:350-535`). Each line prints its help text (`SOURCES_LINES`, `AREA_LINE_HELP` in `factory/itemSourcing.ts:105-182`) as the first paragraph:
  - Already made here: "What this block's rows already make while running for something else: byproducts and spare output. Using it adds no machines."
  - Make more here: "Run this block's rows, or more of them, for this item. Adds machines."
  - Other areas: "Take it from rows in another area of this block."
  - One area: "Take it from the rows of this area. Off: nothing of it comes from this area."
  - Import: "Bring it in from outside the plan. Off: what the other sources leave is shown as missing."
  - A block line joins two sentences (`factory/sourcesRows.ts:54-58` and the Other blocks help): "Ores only gives what it has left over. Receive it from a connected block, up to the connection's limit."
  - At area scope: "Order, limit and Remove are the block's." and "N/m over this connection; M/m of it reaches this area."
- **Group panel** (`factory/sidePanel/GroupPanel.tsx:165-168`): "This area is solved on its own: its rows serve it first, and what it sends and receives is listed above." / "A sub-factory only organises rows. Choose Separate area from its right-click menu to track what it sends and receives."
- **Effects section** (`factory/sidePanel/EffectsSection.tsx:92-98`): the permanent footnote "Beacon effect = for each module, its effect × efficiency × its count × beacons, added up. All sources add up." and the amber "Recipe effects: the … do not count here (the recipe, machine or beacon does not allow them)."
- **Neighbours section** (`factory/NeighbourSection.tsx:121,156,165,183`): "Draw one cluster of reactors that touch each other. The planner uses the average number of neighbours per reactor." / "Each number is how many reactors share a side with that one. Diagonals don't count, and only working reactors do." / "Not a rectangle? Type the average number of neighbours instead." / "Change the size above to use the drawing again."
- **Module misfit note** (`factory/sidePanel/moduleOptions.ts:53-54`, Machine and Beacons sections): "Ringed modules cannot be inserted in X; pick other modules."
- **Served order popover** (`factory/ServedOrderPopover.tsx:461-462`): "Ranked by you. When the source is short, the lines at the bottom go without first. Lines in a bracket share a place and split what is left by their percentages. Drop a line on the middle of another to share its place, between two lines for a place of its own." / "Today's order: the order the solver served them in. Move a line to rank it."
- **Area matrix panel** (`factory/BlockAreaMatrix.tsx:503`): "Counterpart cells read "13.8 →": the part of that area's output that goes to the focused area."
- **Plan areas legend** (`factory/PlanAreas.tsx:199-200`): "Each block column is what the block takes or leaves across its boundary; Not taken and Not supplied are what the connections between blocks leave over." / "Each row balances: what areas send, plus what comes from outside, equals what areas receive plus what goes outside."

## 3. Labels and tooltip tails that explain the UI

- Overview strip (`factory/SummaryDetailStrip.tsx:134`): "click a segment to trace it" / "click again to clear".
- Hovered slot (`factory/SummaryDetailStrip.tsx:198`): the "preview" badge.
- Block graph detail (`factory/BlockGraphDetail.tsx:111,180`): "· click the edge to pin it and edit" / "Point at a block or a connection to see what it carries."
- Block graph (`factory/BlockGraph.tsx:96`): "Click to pin the highlight".
- Block matrix legend (`factory/BlockMatrix.tsx:345`): "Click a cell to list its items and edit them."
- Summary segment tooltips (`factory/summarySegments.ts:450-467`): "— click to open", "— click to open, right-click to remove", "— right-click to remove this connection".
- Products pane (`factory/FactorySummary.tsx:93`): "Extra output: … — click to edit".
- Recipe row (`factory/RecipeRow.tsx:872,906,948-949`): "; right-click to add a consumer recipe", "(click to toggle)", "— Find producer recipe".
- Graph connection chip (`factory/GraphConnectionChip.tsx:97`): "Most B takes over this connection; click to edit, clear to remove".

## 4. Long tooltips

- Absorber and feeder badges (`factory/RecipeRow.tsx:52-58`): three sentences each, e.g. "Absorbs byproduct: runs only to consume surplus from other recipes and never imports what it absorbs. Rows that only feed it run along with it. Right-click the row to stop absorbing."
- Leftover switch (`factory/itemSourcing.ts:44-50`): four sentences ("Off: the rows of this block use all of it they can. What they cannot use is still left over, and the warning names it. Turn it off on every item of a chain, … set it to Receive it first.").
- Rule chip (`factory/itemSourcing.ts:130`): "The rule this order makes. Move Make more here above or below the other blocks, or switch it off, to change it."
- Make more here places (`factory/itemSourcing.ts:134-137`): the preset name and its full help text.
- Default machine (`factory/sidePanel/MachinePicker.tsx:82`): "Defaults are per primary category (…). This machine only crafts an additional category of the recipe, so it can only be chosen for this row."
- Area matrix counterparts (`factory/BlockAreaMatrix.tsx:43,138-139`): every counterpart tooltip ends with "Areas higher in the table supply first; an area with its own row for the item is served before the others."
- Loops (`factory/GraphConnectionChip.tsx`, `factory/ConnectionMenu.tsx:96,139`): "Closes a loop: B already receives from this block, directly or through other blocks".
- Requests ignored (`factory/summarySegments.ts:29-31`, `factory/ServedOrderPopover.tsx:22-26`): "the requests around this loop do not settle, so this takes what is left over", "The planner reached this block before the list could reserve a share for it, so it is served from what the others leave over, not by its rank."
- Effects (`factory/sidePanel/EffectsSection.tsx:22`): "…: +x does not apply to this row (the recipe, machine or beacon does not allow it)".
- Sub-factory area toggle (`factory/RecipeRow.tsx:506`): "Solve this subfactory as its own area: its rows serve it first, and the summary lists what it receives and sends".

## Out of scope

- The warnings popover (`factory/TableToolbar.tsx:180-298`): long bodies and "→" fix hints, but explaining is a warning's job.
- Empty states ("This row takes no inputs.", "Nothing here yet").
- Confirmation dialogs (`factory/ProductChangeDialog.tsx`, the import dialogs in `WorkspaceMenu.tsx`).
- The served order's move messages (`factory/ServedOrderPopover.tsx:168-236`): screen-reader-only announcements.

## Patterns

- **One builder, several surfaces.** The sourcing sentence feeds four surfaces and the outputs sentence one, but both mix the facts with the wording. Most sentences are lists of "name (n × machine)" or "block (rate)": rows or chips of icon, name and rate.
- **Tooltip and paragraph say the same thing.** The Sources list detail is mostly its own tooltip again.
- **Hints instead of affordances.** "click…" and "right-click…" labels stand in for controls that do not look clickable.
