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

## Open questions

- **One model, several layouts.** The sentence builders mix the facts (who makes the item, which block sends it, what is imported) with the wording. Split them into a structured model each surface lays out its own way, or keep one compact layout every surface shares?
- **Where does an explanation go** once it leaves the page: a tooltip on the control, an info (ⓘ) button, a disclosure, or the README?
- **Accessibility.** Several sentences are also the accessible description of a control (`aria-describedby`); a layout without prose still needs a text equivalent for assistive technology.
- **Tests.** `sourcingText.test.ts`, `outputsText.test.ts` and many component and e2e tests assert the sentences verbatim; they move with the model.
