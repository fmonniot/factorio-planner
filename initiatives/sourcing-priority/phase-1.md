# Sourcing priority, phase 1: rename and relocate

Phase 1 of [plan.md](plan.md). It changes what the player reads and where the rule is set. The solver and saved plans are untouched: `itemSourcing` and `noImportItems` stay as stored, and the three stored modes keep their current behaviour and limits.

## Scope

In: the outcome names, the **Comes from** control on the Ingredients slot with the import switch, the sentence and marker in place of `B` / `C`, greyed inert rules, the block's rule list, help text on the presets and the Import switch, and one solver test.

Out, and left to later phases: **Custom order…** and the list itself with the names and help texts of its lines, the requested / existing tag, the *Other areas* and *Other blocks* lines as visible lines, any new combination of modes, the source side (**Served in this order**).

## Vocabulary

| Stored today | Shown in phase 1 | Help text |
| --- | --- | --- |
| no entry (own recipes first) | **Make it here** | "Made here; connections and imports cover what is missing." |
| `connections-first` | **Receive it first** | "Taken from Metals first; made here for the rest." (names the connected blocks) |
| `byproducts-first` | **Only what's already made** | "Uses what this block already makes; the rest is received or imported." |
| in `noImportItems` | **Import** switched off | "Bring it in from outside the plan." (the line's help; off means the block must cover it) |

The control is labelled **Comes from**; the concept is the item's **Sources**. The words "Own recipes first", "Byproducts first", "Connections first" and "Forbid imports" no longer appear in the UI.

## Tickets

Each ticket is one pull request unless noted. T1 and T2 have no UI and can go first, in either order.

- [ ] **T1. Solver test: spare output before connections.** Pin today's behaviour that a connections-first item uses what the block already makes before its connected supply. Cases: single LP and area LP; a limited offer, an unlimited offer (the request probe) and an offer smaller than the rest of the need; the spare output made in the same area and in another area. Expected shape: with 30 spare and a need of 50, the block receives 20. The amount is by construction where the spare comes from rows the item does not size: `blockDiagnostics` reports what is received as the deficit left after own production, in the single LP and the area solve, and the request probe reads that figure. The test pins that, and also covers what the clamp does not decide: that the LP does not run an own recipe for the item while the offer covers the rest, and a spare made by a row the item itself sizes. Say in the case which expectations are guaranteed and which are only observed. Add it as a synthetic case in `spec/test-synthetic.md` with `src/solver/synthetic.test.ts`, and correct the sentences in `spec/solver.md` ("Connections first", "Requests") that say the need is the item's whole use. No solver change; if a case fails, stop and report, since the mapping in plan.md depends on it.
- [ ] **T2. One vocabulary module.** Replace the labels and titles in `src/components/factory/itemSourcing.ts` with the preset names and help texts above, so every surface reads them from one place; the line names and their help texts come with the list in phase 2. Rewrite the sentences of `sourcingText.ts` in the new words ("byproducts" becomes what the block already makes; "Imports are forbidden" becomes Import is off), and the `coproduct-driven` hint in `TableToolbar.tsx`, which tells the player to "set it to Byproducts first (right-click its chip)": it names the preset and the Ingredients slot instead. Update `sourcingText.test.ts`, `itemSourcing.test.ts` and `WarningsPopover.test.tsx`.
- [ ] **T3. Which rules have an effect.** A pure function, per block and item, that says whether the stored rule changes anything and, if not, why: no connection for the item, the item is raw in the block, the block cannot make it, the item is locked, or it is a product. It reuses the conditions the UI and the solver already apply (`forbidImportsTitle`, the connections-first and byproducts-first filters in `src/solver/`). It also reports which rows the rule changes, for the marker in T6. Unit tests for every reason.
- [ ] **T4. The Comes from control on the Ingredients slot.** In the selected strip of an Ingredients slot (`FactorySummary.tsx`): the three presets as one choice, the Import switch beside them, the rule's sentence under them, and help text on each (a tooltip on hover and keyboard focus). *Only what's already made* is disabled, with its reason, while Import is off, because a locked item ignores that mode today; for the same reason the Import switch is disabled, with its reason, while that preset is chosen, so the control never creates the pair. A plan saved with both shows the preset as a rule with no effect (T3, "the item is locked"). A rule with no effect (T3) is greyed with its reason and a **Remove** action. Remove the three radio items and the Forbid / Allow imports entry from `ConnectionMenu.tsx`, and the separate Forbid imports action from the strip. The store commands (`setItemSourcing`, the no-import toggle) are unchanged.
- [ ] **T5. Row side panel: read-only.** In `sidePanel/SourcingSection.tsx`, replace the radio group and the Forbid imports checkbox of each ingredient with the rule's sentence and a **Change…** link that selects the item's Ingredients slot. The line saying that other rows follow the same mode goes, since the rule is no longer set here.
- [ ] **T6. Marker in place of `B` / `C`.** In `ItemChip.tsx` / `IconChip.tsx`: no letter; one neutral marker, shown only for a non-default rule that has an effect and only on the ingredient chips of the rows the rule changes (T3). Its tooltip is the rule's sentence; a click selects the Ingredients slot. Byproduct and product chips of the item show nothing.
- [ ] **T7. The block's rule list.** A "Source rules (N)" entry at block level listing every non-default rule of the block (an item's preset, and Import off), each with its sentence and a **Remove** action; inert rules are greyed with their reason. Hidden when the block has no rule. Where it sits (Ingredients pane header or the block menu) is decided in the ticket, with a mock-up in the pull request.
- [ ] **T8. Marker on the Ingredients slot, the areas matrix and the block graph.** The same marker on an Ingredients slot (selected or not; its place beside the status badge is decided in the ticket), a matrix cell and a graph edge whose item has an effective rule. Byproducts slots show nothing, like byproduct chips: the rule is about where the item comes from. This closes the backlog item "Sourcing badge on Ingredients slots" together with T4.
- [ ] **T9. Docs.** `spec/ui.md` (Ingredients pane, chips, side panel, connection menu, the `coproduct-driven` row of the warnings table), `spec/data-model.md` and `spec/solver.md` ("Byproducts first"), which today disagree on where the mode is set; the README's "Using the planner" where it names the modes; the backlog's "Sourcing priority" notes. Done in each ticket for what that ticket changes; this ticket is the final pass.

## Tests

- **Unit.** T1 to T3 as above. Component tests that assert the old labels: `FactorySummary.test.tsx`, `RecipeRow.test.tsx`, `sidePanel/SidePanel.test.tsx`, `WarningsPopover.test.tsx`, `IconChip.test.tsx` (the badge).
- **e2e.** `e2e/item-sourcing.spec.ts` and `e2e/block-requests.spec.ts` assert the current labels and the `B` / `C` badge (`item-tile-sourcing`) and are rewritten around the control. `e2e/ingredients-pane.spec.ts` asserts the **Forbid imports** / **Allow imports** menu item and strip action that T4 removes, and moves to the Import switch. New cases: setting each preset from the Ingredients slot; the third preset disabled while Import is off, and the switch disabled while that preset is chosen; an inert rule greyed and removed; the marker appearing only on the rows a rule changes; the **Change…** link from the side panel.
- **Parity.** No solver result changes in this phase: `legacyParity.test.ts` and the synthetic cases stay green without edits, apart from the case T1 adds.

## Done when

- A player can set, read and remove every rule that exists today without meeting the words "byproducts first", "connections first", "own recipes first" or a letter badge.
- Every preset and the Import switch has help text reachable by mouse and keyboard.
- A rule that does nothing says so and can be removed in one click.
- Plans saved before the phase load and solve to the same numbers.
