# Summary panes → item slots with allocation micro-bars

Status: Shipped

## Context

The Products, Byproducts and Ingredients panes of `FactorySummary` have had two
layouts, and neither copes with a block that has many items:

- **Before PR #100:** goal tiles and
  export chips flowed together in one wrapping list. Dense, but a chip could land
  on the line after its tile, so you could not tell which item it belonged to.
- **After PR #100:** one row per item,
  tile on the left, chips to the right. Grouping is clear, but each row is tall,
  most of the pane width stays empty, and a 25vh pane shows about six items.

Six directions were explored on a design canvas (private to the owner:
<https://claude.ai/artifact/2LEtuXu57nhK84zt8fec5B>). The chosen one is
**B+C**: inventory-style slots that each carry a tiny allocation bar, plus a
detail strip at the bottom of each pane. The other directions are summarised
under [Alternatives considered](#alternatives-considered).

## Design

### Pane layout

Each pane keeps its header (label, `· N` count, and `+` for Products). Below it:

1. **Slot grid.** Items as fixed-size slots in a wrapping grid, in today's row
   order. The grid scrolls; the 25vh cap applies to the grid only.
2. **Detail strip.** A fixed-height strip (about 136px) under the grid, always
   present. It never collapses or resizes, so slots do not move when the
   selection changes.

### Slot

A 50×54 button:

- the item icon (name fallback as today), centred in the top part;
- the rate in the bottom-right corner, monospace, with a dark text shadow, as in
  Factorio's stack counts. Products show the actual rate; Byproducts what is left
  after exports; Ingredients the need;
- a status badge in the top-right corner: `▼` amber for a short goal, `!` amber
  for a limited connection, `⊘` grey for imports forbidden;
- a **micro-bar**: a 4px stacked bar along the bottom edge, made of the item's
  allocation segments (below) in their solid colours;
- border: teal when selected, amber for a short goal or limited connection, grey
  otherwise. An unused connection or a locked item dims the slot.

The slot's accessible name is "<item>, <rate> per <unit>"; the item name is also
its tooltip.

### Allocation segments

Every item is drawn as a bar whose segments add up to its scale. The micro-bar,
the detail bar and the overview all use the same encoding.

| Pane | Scale | Segments, in order |
|---|---|---|
| Products | max(target, actual) | one per consumer block (exported rate) · kept (actual − exports) · short (target − actual, when short) |
| Byproducts | net production | one per consumer block · left (what stays) |
| Ingredients | need | one per source block (delivered) · import (still imported) |

| Kind | Look |
|---|---|
| Block (consumer or source) | that block's colour, translucent fill with a stronger border |
| Limited source | the source block's colour with an amber border; amber in the micro-bar |
| Kept / left | dark fill, grey border |
| Import | no fill, light grey outline |
| Short | faint amber fill, dashed amber border |
| Unused connection | dashed grey outline across the whole bar, labelled "← <block> · unused" |
| Imports forbidden | grey hatching across the whole bar, labelled "imports forbidden" |

Products also draw a white tick at the target when actual ≠ target (an
over-producing goal shows the tick inside the bar).

### Detail strip states

| State | When | Shows |
|---|---|---|
| Overview | nothing selected or hovered | one row per segment key in the pane: swatch, label (`→ Sciences`, `Kept`, `Imported`…), a bar sized against the pane's largest total, total rate, item count |
| Preview | a slot is hovered | that slot's detail, with a small "preview" tag; leaving the slot returns to the selection or the overview |
| Selected | a slot is clicked | header (icon, name, rates, `×` back to the overview), the full detail bar with labels on segments wide enough, a colour key listing every segment with its exact rate, and the item's actions |
| Editing | Products only: target clicked in the strip, or slot double-clicked | the target becomes an input (Enter commits, Escape cancels, blur commits); hover does not change the strip meanwhile |

Header rates: Products `target → actual /unit` (the target is the edit control,
amber `▼` actual when short); Byproducts `made N`; Ingredients `need N`.

### Interactions

| Action | Result |
|---|---|
| Click a slot | select it; click again to clear |
| Double-click a Products slot | select it and edit its target |
| Hover a slot | preview it in the strip |
| Click an overview row | trace that key: slots without it dim to 30 %, and every micro-bar fades all other segments; click again to clear |
| `×` or Escape | back to the overview |
| Right-click a slot | the same menus as today (`RowActionsMenu` / `ConnectionMenu`) |
| `+` | add a goal, as today |

Selection and trace are view state, not saved, and reset when the active block
changes.

Actions in the strip, by item kind (they replace today's click targets, which
stay reachable by right-click):

- **Goal:** Find recipe, Remove goal (target edit is in the header).
- **Byproduct:** Add consumer recipe…
- **Ingredient:** Find recipe, Receive from…, Forbid imports (or Allow imports
  when locked). Connection chips' actions (open the source block, remove the
  connection) move to the segments: clicking a source segment in the detail bar
  opens that block; right-clicking it offers Remove connection.
- **Export segment:** clicking a consumer segment opens that block.

### Block colours

Each block gets a colour, stored on the block:

- `BlockSchema` gains `color: string` (hex). `migrateBlock` assigns one to blocks
  that have none, so old plans and imports keep loading.
- A new or duplicated block picks a random colour from a 16-colour palette,
  preferring one no other block uses. Duplicates get a new colour.
- The palette avoids the colours that already mean something: teal (actual
  rates, selection), amber (warnings) and grey (kept, import). Candidates to tune
  during implementation: `#60a5fa #7dd3fc #818cf8 #a78bfa #d8b4fe #e879f9
  #f472b6 #fda4af #fca5a5 #a5b4fc #a3e635 #86efac #bfdbfe #fbcfe8 #c4b5fd
  #f9a8d4` (the orange pair was swapped out so no block colour resembles the
  amber warning colour).

The canvas also tried colours derived from the block's position in the list;
that was rejected because reordering blocks recolours every one of them.

Out of scope here, as follow-ups in [../../backlog.md](../../backlog.md): letting the
user choose the colour, deriving the default from the block's icon, and showing
the colour in the block tabs and the block graph.

## Alternatives considered

All on the canvas linked above.

- **A · Ledger.** One dense table row per item with text routing ("Circuits 65 ·
  Sciences 35"). Readable but adds nothing over today's information.
- **B · Allocation bars.** One row per item with a full-width segmented bar. Kept
  as the encoding inside B+C.
- **C · Inventory slots.** Slots with coloured pips and a detail strip. Kept as
  the layout of B+C; the pips became the micro-bar.
- **D · One merged ledger.** Products, Byproducts and Ingredients in one
  full-width table with filter tabs. Rejected: wastes too much space.
- **E · Grouped by block.** Goals as compact tokens, deliveries grouped under
  per-block headers. Its per-block totals live on as the overview state.
- **B+E.** Bars grouped under block headers. Rejected: an item sent to several
  blocks repeats in each group, and leftovers only show inside bars.

## Implementation notes

- `FactorySummary.tsx`: replace `GoalTile` / `ItemTile` rows and the export and
  connection chips in the panes with a `SummarySlot` and a `SummaryDetailStrip`.
  `summaryRows.ts` keeps the grouping; add a pure function that turns a row into
  its segments (scale, kind, key, amount) so it can be unit tested.
- `ConnectionChip` / `ExportChip` lose their place in the panes; their states
  (limited, unused, deleted block, cycle) map to segment kinds. Deleted-block and
  cycle connections need a segment look too (grey, dashed), so they stay visible
  and removable.
- Data model: `BlockSchema.color`, migration, palette picker in the block store
  (add, duplicate, import).
- Docs: [spec/ui.md](../../../spec/ui.md) (FactorySummary panes),
  [spec/data-model.md](../../../spec/data-model.md) (block colour), README "Using the
  planner".
- Tests: unit tests for the segment function and colour assignment; update
  `e2e/summary-panes-many-items.spec.ts` for slots, selection, hover preview,
  trace and target editing.
