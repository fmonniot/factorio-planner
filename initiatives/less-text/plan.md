# Initiative: Less text

Status: Future

The planner explains itself in running prose: the Details panel, the Comes from strip, the Sources list and several popovers set long sentences where a list, a table or a chip would show the same facts. This initiative replaces those sentences, help paragraphs and "click to…" hints with layouts that read at a glance. Nothing is designed or implemented yet.

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

The owner reviewed the layouts canvas (four artboards: Details panel, summary strip, Sources line detail, explanations and tooltips; each shows today beside a proposal) and accepted every proposal. Which value of each variant (Details layout rows / chips / bar, rule as icons or chip, preview mark, Ingredient strip legend, Sources help) is still to be picked.

### Where an explanation goes (2026-11-24)

No ⓘ button and no disclosure: the owner rejected the ⓘ popover because it gives little the layout does not already show. An explanation that still helps becomes the tooltip of the label it explains (the Effects title, the "Separate area" subtitle, the served order's title, a Sources line's name), in the author's existing wording; one the layout already says is dropped. Rewritten copy stays plain sentences or labels, never a crammed chain of clauses.

## Open questions

- **Variant picks** for the accepted layouts (above).
- **Tests.** `sourcingText.test.ts`, `outputsText.test.ts` and many component and e2e tests assert the sentences verbatim; they move with the model.
