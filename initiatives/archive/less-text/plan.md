# Initiative: Less text

Status: Shipped

The planner explains itself in running prose: the Details panel, the Comes from strip, the Sources list and several popovers set long sentences where a list, a table or a chip would show the same facts. This initiative replaces those sentences, help paragraphs and "click to…" hints with layouts that read at a glance. The design is settled (Decisions below) and is implemented.

---

## Problem

Started as the backlog item "Details and Sources panels: less text": both panels set long sentences in running prose, for example "Made here by Mono silicon (1 × Casting machine 4) and Quartz crucible (1 × Assembling machine 6)." The same habit is found across the app:

- **Sentences built from data.** `sourcingText.ts` and `outputsText.ts` turn a list of makers, connections, rates and leftovers into one sentence. Each is read by several surfaces (the sourcing sentence by four), so the wording is the same everywhere and fits none of them well.
- **Help text printed twice.** The Sources list prints each line's tooltip again as the first paragraph of its detail; other panels carry a permanent footnote (the beacon formula, the neighbour instructions, the served-order manual).
- **Labels that explain the UI.** "click a segment to trace it", the "preview" badge, "click the edge to pin it and edit", tooltips ending in "— click to open, right-click to remove".
- **Long tooltips.** Three- and four-sentence tooltips on the absorber badges, the Leftover switch and the rule chip.

The full list, with file and line references, is in [inventory.md](inventory.md).

## Goal

Every fact the prose carries stays reachable, but the default view shows it as structure (rows with an icon, a name and a rate; chips; a small table) rather than a sentence. Explanations that a user needs once move behind an affordance (a tooltip, an info button, a disclosure) instead of sitting on the page. Interaction hints go where the interaction is obvious from the control itself.

## Scope

All four sections of [inventory.md](inventory.md):

1. Running-prose sentences built from data.
2. Help paragraphs printed on the page.
3. Labels and tooltip tails that explain the UI.
4. Long tooltips.

Out of scope: the warnings popover (explaining is what a warning is for), empty states, confirmation dialogs (`ProductChangeDialog`, the import dialogs) and screen-reader-only announcements. Their wording may still be trimmed in passing.

## Decisions

### One structured model, each surface lays it out (2026-11-24)

The sentence builders mix the facts (who makes the item, which block sends it, what is imported) with the wording. They go: each concept has one structured model, and every surface that shows it lays the model out in its own way (a row list in the Details panel, a single compact line in the strip, a chip or icon in a tooltip). No surface formats a sentence from it.

**Where an item comes from: the Sources model.** `buildSourcesModel` (`src/components/factory/sourcesModel.ts`) already holds everything the sourcing sentence states, and more:

| The sentence says | The Sources model has |
|---|---|
| "Made here by X (n × Machine)" | `makers` (recipe, machine, count, rate, byproduct) behind the *Already made here* and *Make more here* lines, each with its consumed share |
| "taken from B (rate)", "Taken from A first (rate offered)" | one `block` line per connection: source name, colour, rate; `rows[].flow` for offered, limited, unused |
| "the rest is imported", "Import is off", "missing" | the `import` line, `missing`, the `missing` mark |
| "Area: … Takes nothing from A" | area scope: one `other-area` line per supplying area, `off` when switched off |
| the preset ("Receive it first", …) | the line order and `ruleChipOf` |

The sentence is a second, poorer reading of the same facts: it names the rows that could make the item, not how much each source gives, so it can say "Made here by X" while connections deliver most of it. Every surface of the sourcing sentence (Details panel inputs, Ingredients strip, Source rules list, source rule marker) reads the Sources model instead. Needed for that:

- `useSourcesModel` reads the active block only; the source rule marker of the block graph needs any block, so the hook takes the block (as `useBlockSourcingSentence` does).
- The strip control calls it with `enabled = false` today to skip the work; laying the model out in the strip makes it pay for the model. Area scope walks the plan once per other area (`supplierLines`) and flattens the block (`areaLPItems`), so check the cost on a large Seablock plan before every table row's marker reads it.

**Where an output goes: the outputs model.** `OutputTextInput` (`src/components/factory/outputsText.ts`) is already structured: product of the block, consuming rows (rate, absorber, area), receiving blocks (rate), leftover, discarded, other makers. It becomes the model the Details panel lays out, shaped like the Sources model (lines with a kind, a label, a rate and a look: the block's colour for a receiving block, the made look for a row, the leftover look), so inputs and outputs read alike. The Products and Byproducts strips already show the block-level version of the same facts as bar segments (`summarySegments.ts`); the row-level layout should use the same looks.

**Smaller sentences of section 1.** The leftover-take note lists blocks that take the item (`takers` in `ComesFrom.tsx`), and a rule without effect already has a reason code (`noEffect`); both are laid out from those, not from `leftoverTakeNote` / `noEffectText`. The matrix sentences (not taken, not supplied, an area's contents) are figures and name lists already, and are laid out as such.

**Text equivalent.** The models still produce one plain-text reading for assistive technology (`aria-describedby`, a `role="img"` label); it is derived from the model, kept short, and never shown on the page.

### Layouts per surface (2026-11-24)

The owner reviewed the layouts canvas (four artboards: Details panel, summary strip, Sources line detail, explanations and tooltips; each shows today beside a proposal) and accepted every proposal, with these picks:

- **Details panel, inputs and outputs:** rows. Each item lists its sources (inputs) or destinations (outputs) as lines of an icon or block colour, a name, a secondary detail (the machine count) and a rate; the rest of a sentence's detail (offered rate, limit, request kind) moves to the line's tooltip. The lines sit on a rail with an arrow, as in the Sources list: an input's rail ends in an arrow into the row, an output's starts with an arrow out of it. A shared output ("These are the block's rates…") is a "block ×N" tag with a tooltip; a discarded one keeps only "not counted".
- **A rule that is not the default:** its preset and Import-off icons beside the item's name, from the strip's icon vocabulary, with the rule's name as tooltip.
- **Summary strip:** no trace hint (a traced source shows as a chip with ×); no mark on a previewed slot (no toolbar and no close button already tell it from a selected one); the selected Ingredients slot drops its sentence and keeps the bar alone, the rule as icons in its toolbar.
- **Sources list:** a line's help text is its name's tooltip; only lines with controls or a status open, and the rate column carries the reading.
- **Tooltips:** a name and at most one plain sentence; "click to…" and "right-click to…" tails go.
- **New figures and controls** the proposals bring: an output's *Block product* line (what is left for the block's goal: the row's rate less consumers and receivers) and a *Make it a separate area* button in place of the sub-factory's instruction.

### Where an explanation goes (2026-11-24)

No ⓘ button and no disclosure: the owner rejected the ⓘ popover because it gives little the layout does not already show. An explanation that still helps becomes the tooltip of the label it explains (the Effects title, the "Separate area" subtitle, the served order's title, a Sources line's name), in the author's existing wording; one the layout already says is dropped. Rewritten copy stays plain sentences or labels, never a crammed chain of clauses.

## Tickets

One pull request per ticket. Each ticket rewrites the unit and e2e tests of its surfaces against the new layout (query lines by `data-testid` and `data-kind`, not by sentence) and updates [spec/ui.md](../../../spec/ui.md) for those surfaces. T3 needs T1 and T2; T4 needs T2; the others stand alone. Section numbers refer to [inventory.md](inventory.md).

- [x] **T1: outputs model and the Details panel's outputs.** Replace `outputText` (`outputsText.ts`) with a model shaped like the Sources model: per output, lines of a `kind` (`row`, `block`, `product`, `left`), a label, a rate, a look (the block's colour, the made look, the leftover look) and flags (absorber, the row's area), plus `discarded`, `notProduced`, `otherMakers`. The new *Block product* line is the row's rate less what the consumers and receivers take. A shared output gets the "block ×N" tag; a discarded one keeps only "not counted". Build the rail list (lines on a rail, arrow at the head for outputs, at the foot for inputs) as a component the inputs reuse in T3. One short plain-text reading per output for `aria-describedby`. Tests: `outputsText.test.ts`, `SidePanel.test.tsx`, `e2e/side-panel-outputs.spec.ts`. Inventory §1, outputs.
- [x] **T2: the Sources model for any block, and its cost.** `useSourcesModel` reads the active block only and its strip caller passes `enabled = false` to skip the work; give it the block (the block graph's source rule marker needs another block's model) and drop `enabled` once every caller lays the model out. Time it on a large Seablock plan, at block and at area scope (`supplierLines`, `areaLPItems`), for the case of every marked table row reading it; if that is too slow, memoise per block and solve, or keep a lighter reading for the marker, and record the figure here. Add the short plain-text reading of a model (one line per supplying source with its rate) that T3 and T4 use for tooltips and assistive technology. No visible change.

  **Cost** (largest local Seablock plan: 15 blocks, 7-292 rows, 0-31 areas, 141 connections; `solveAll` about 340 ms; `node scripts/time-sources-model.mjs`, warm, median of 5 passes). Every item of the heaviest block marked: block scope 8 ms for 173 pairs (itemMakers 0.01 ms, buildBlockRows 0.01 ms, areaMissingOf 0.01 ms per call, 821 calls each); area scope 131 ms before and 63 ms after memoising `areaLPItems` per block (`areaLPItemsOf`, 886 calls cost 199 ms before, 3 ms after); `supplierLines` is now the bulk, 0.11 ms per call (102 ms over 886 calls), and it depends on the item, so it cannot be shared. The heaviest block is the one with 31 areas and 88 rows: 66 ms for a pass over all 221 pairs, over the 50 ms limit; the largest single pair is 0.9 ms, far under 16 ms. The real markers number 0-18 per block (0.3 ms for the busiest block's 18). With 8 synthetic areas on a block that had none: 68 ms for the heaviest pass in that run, the same block. Decision: the memo is in; a pass over every pair of a many-area block still trips the limit, so a lighter reading for the marker (block scope only, no `supplierLines`) is flagged for the owner and not implemented here.
- [x] **T3: the Details panel's inputs.** `SourcingSection` lays out the Sources model of each ingredient (at the row's area when the area has its own rule): its supplying lines on the T1 rail, a maker with its machine count as secondary detail, a block in its colour with a limited mark, Import, Missing in amber, each with its tooltip (offered rate, limit, request kind). A rule that is not the default shows its preset and Import-off icons beside the item's name, with the rule's name as tooltip. The **Change…** button becomes the strip's **Sources…** icon button. Tests: `SidePanel.test.tsx`, `e2e/item-sourcing.spec.ts`, `e2e/area-suppliers.spec.ts`, `e2e/connection-replaces-import.spec.ts`. Inventory §1, Where inputs come from (Details panel).
- [x] **T4: the other sourcing sentences, then remove them.** The selected Ingredients slot drops its sentence and keeps the bar, with the rule's icons in its toolbar (`ComesFrom`, `listInPopover`). A Source rules list item keeps its name and rule and drops the sentence (`SourceRulesButton`); the source rule marker's tooltip is the rule's name and the model's reading (`SourceRuleMarker`). The leftover-take note becomes one line per taking block (colour, name), with making the item a product as an action rather than an instruction; a rule without effect shows its reason as a short label, from `noEffect`. Then delete `sourcingText()`, `useSourcingSentence.ts` and their tests (`itemMakers` and `itemConnections` move next to the Sources model). Tests: `ComesFrom.test.tsx`, `SourceRulesButton.test.tsx`, `FactorySummary.test.tsx`, `e2e/ingredients-pane.spec.ts`, `e2e/source-rules.spec.ts`, `e2e/source-rule-marker.spec.ts`, `e2e/leftover-rule.spec.ts`. Inventory §1, the rest of Where inputs come from and Comes from.
- [x] **T5: the Sources list's line detail.** A line's help text (`SOURCES_LINES`, `AREA_LINE_HELP`) becomes its name's tooltip and leaves the detail; a line whose detail would hold only a reading the rate column already shows no longer opens (Already made here, Other areas, Import unless missing, an idle Make more here keeps its place buttons). A block line drops the "only gives what it has left over" sentence (its `existing` tag carries it as tooltip); the area-scope reading moves to the rate's tooltip. Tests: `SourcesList.test.tsx`, `e2e/sources-list.spec.ts`. Inventory §2, Sources list.
- [x] **T6: hints and long tooltips.** Overview strip: drop "click a segment to trace it" / "click again to clear"; a traced source shows as a chip with a clear button. Drop the "preview" badge. Drop the "click…" / "right-click…" tails of the summary segments, the Products pane's extra output, the recipe row's chips, the graph connection chip and the block graph, and the block graph's and matrix's instruction lines. Shorten the long tooltips of §4 to a name and at most one plain sentence, in the author's wording. Inventory §3 and §4.
- [x] **T7: help paragraphs and matrix sentences.** Group panel: the area's note becomes the tooltip of its "Separate area" subtitle; the sub-factory's instruction becomes a **Make it a separate area** button (`setSubPlanArea`). Effects: the formula footnote becomes the title's tooltip; the amber "Recipe effects" sentence goes (the struck cell's tooltip says it). Served order: the manual goes; its first rule ("when the source is short, the lines at the bottom go without first") becomes the title's tooltip. The module misfit note, the Neighbours section, the area matrix panel's note, the Plan areas legend and the matrix sentences (not taken, not supplied, an area's contents) follow the same rule: a tooltip on the label they explain, a figure or list where they state data, else dropped. The Neighbours section and the matrices were not on the canvas: show the owner a before and after in the pull request. Inventory §1 (area matrices) and §2 (the rest). Last ticket: update [inventory.md](inventory.md) if anything was left out on purpose, then archive this folder and update [../../README.md](../../README.md).
