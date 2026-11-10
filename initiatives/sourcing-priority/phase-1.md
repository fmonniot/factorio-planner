# Sourcing priority, phase 1: rename and relocate

Phase 1 of [plan.md](plan.md). It changes what the player reads and where the rule is set. The solver and saved plans are untouched: `itemSourcing` and `noImportItems` stay as stored, and the three stored modes keep their current behaviour and limits.

## Scope

In: the outcome names, the **Comes from** control on the Ingredients slot with the Import switch, the sentence and marker in place of `B` / `C`, rules with no effect greyed, the block's rule list, help text on the presets and the Import switch, and one solver test.

Out, and left to later phases: **Custom order…** and the list itself with the names and help texts of its lines, the requested / existing tag, the *Other areas* and *Other blocks* lines as visible lines, any new combination of modes, the source side (**Served in this order**). Do not add data, types or UI for any of these in this phase.

## Words used in this document

Each word below has one meaning here. The tickets use no synonym for them.

| Word | Meaning |
| --- | --- |
| Preset | One of the three values of `Block.itemSourcing[item]`: absent, `'connections-first'`, `'byproducts-first'`. Every item has exactly one. |
| Import switch | On when the item is not in `Block.noImportItems`, off when it is. "Import is off" and "the item is locked" are the same state. |
| Rule | One non-default stored setting of one item in one block. There are three kinds: the preset `'connections-first'`, the preset `'byproducts-first'`, and Import off. An item has zero, one or two rules (a preset and Import off). The default preset with Import on is no rule. |
| Has an effect / has no effect | What `sourceRules` (T3) says of a rule. A rule has no effect when the solver ignores it for a reason listed in T3. |
| Help text | A fixed string, one per preset and one for the Import switch. It never changes with the plan. See [Vocabulary](#vocabulary). |
| Sentence | The string built by `sourcingText` for one item of one block from the last solve. It names recipes, blocks and rates. See [Sentences](#sentences). |
| Marker | The small dot that says "this item has a rule with an effect". See [The marker](#the-marker). |
| Slot, strip | An Ingredients slot is one item tile of the Ingredients pane in `FactorySummary.tsx`. Its strip is the detail strip the pane shows under the slots while that slot is selected. |

## Vocabulary

| Stored today | Shown in phase 1 | Help text (fixed) |
| --- | --- | --- |
| no `itemSourcing` entry | **Make it here** | "Made here; connections and imports cover what is missing." |
| `'connections-first'` | **Receive it first** | "Taken from this block's connections first; made here for the rest." |
| `'byproducts-first'` | **Only what's already made** | "Uses what this block already makes; the rest is received or imported." |
| not in `noImportItems` / in it | **Import** switch on / off | "Bring it in from outside the plan. Off: this block must make or receive all of it." |

The control is labelled **Comes from**. The words "Own recipes first", "Byproducts first", "Connections first", "Forbid imports" and "Allow imports" no longer appear anywhere in the UI, in any letter case.

### Sentences

`sourcingText` keeps its inputs and its branches; only the words change. `{recipes}` is the existing list of recipe names, `{makers}` the existing list of `recipe (n × machine)`, `{blocks}` the existing list of source block names, `{rate}` a rate through `fmtItemRateText`.

| Preset | Condition (as in the code today) | Sentence |
| --- | --- | --- |
| Make it here | a row makes the item | "Made here by {makers}." |
| Make it here | no row makes it | "No row here makes {item}; it is imported." |
| Only what's already made | rows make it as a byproduct, and a row makes it as its primary product | "Uses what this block already makes first ({recipe} {rate}, …). {recipes} makes the rest." |
| Only what's already made | rows make it as a byproduct, none as its primary product | "Uses what this block already makes first ({recipe} {rate}, …). The rest is imported." |
| Only what's already made | no row makes it as a byproduct, a row makes it as its primary product | "No row here already makes {item}, so {recipes} covers it." |
| Only what's already made | no row makes it at all | "No row here already makes {item}, so it is imported." |
| Receive it first | a connection, and own rows run for the item | "Taken from {blocks} first ({rate} offered), then {recipes} makes the rest." |
| Receive it first | a connection, and no own row runs for the item | "Taken from {blocks} first ({rate} offered)." |
| Receive it first | no connection, a row makes it | "No connection for {item}; {recipes} covers it." |
| Receive it first | no connection, no row makes it | "No connection for {item}; it is imported." |

When Import is off, " Import is off." is appended to the sentence of every row of the table (today the suffix exists on the default preset only).

### The marker

One component, used on every surface, in place of `SourcingBadge`:

- A filled grey circle, 6px, in the badge corner (top-right) of a chip or slot; next to the pin or status badge when there is one. No letter, no amber. The exact grey can be tuned in the pull request.
- `data-testid="source-rule-marker"`. The old `item-tile-sourcing` test id and the `data-sourcing` attribute go.
- Shown for an item when at least one of its rules has an effect. Never shown for a rule with no effect, and never for the default.
- Its tooltip and accessible name are the item's sentence.

## Tickets

Each ticket is one pull request. T1, T2 and T3 have no UI and can go first, in any order. T4 needs T2 and T3. T5, T6, T7 and T8 need T4. Each ticket updates the docs for what it changes; T9 is the final pass.

- [x] **T1. Solver test: spare output before connections.** No solver change. Pin today's behaviour that a `'connections-first'` item uses what the block already makes before its connected supply.

  Fixture: a block where row A runs for a goal and makes 30 / min of item X as a co-product (X does not decide how much A runs), another row uses 50 / min of X, a recipe R in the block can make X, X is `'connections-first'`, and the block has one connection for X.

  | Case | Offer on the connection | Received | R runs for X | Why |
  | --- | --- | --- | --- | --- |
  | a | 100 | 20 | no | Guaranteed: `blockDiagnostics` (`src/solver/blockResult.ts`) reports the deficit after own production, `min(supply, 50 − 30)`. |
  | b | unlimited (`Infinity`, the request probe) | 20 | no | Guaranteed, same clamp; so a request asks the source for 20. |
  | c | 5 | 5 | yes, for the other 15 | Received is guaranteed; that R covers the rest instead of an import is observed. |

  Run a, b and c through `solveBlock` twice: with no areas, and with areas where A is in another area than the row that uses X (the area solve calls the same `blockDiagnostics`). "R runs for X: no" in a and b is observed, not guaranteed (supply costs 0 against 1 per run); assert it, and say in the test which assertions are guaranteed and which observed.

  Add it as case 11 in `spec/test-synthetic.md` with its derivation, automated in `src/solver/synthetic.test.ts`. In `spec/solver.md`, under "Connections first" (*Requests*) and under "Requests", replace "its whole use" by "its use minus what the block's rows already make of it". If a case does not give these numbers, stop and report: the mapping in plan.md depends on it.

- [ ] **T2. One vocabulary module.** In `src/components/factory/itemSourcing.ts`, replace the labels and titles of `ITEM_SOURCING_CHOICES` with the names and help texts of [Vocabulary](#vocabulary), and add the Import switch's name and help text beside them, so every surface reads them from this file. Remove `itemSourcingLabel` once T6 removes its only use. Rewrite `sourcingText.ts` to the [Sentences](#sentences) table. Rewrite the `coproduct-driven` hint in `TableToolbar.tsx` ("set it to Byproducts first (right-click its chip)") to "set it to Only what's already made (select it in the Ingredients pane)". Update `sourcingText.test.ts`, `itemSourcing.test.ts` and `WarningsPopover.test.tsx`. Until T4 lands the old controls stay where they are and show the new names.

- [ ] **T3. Which rules have an effect.** A new pure module `src/components/factory/sourceRules.ts` with `sourceRules.test.ts`:

  ```ts
  export type SourceRuleKind = 'connections-first' | 'byproducts-first' | 'import-off'
  export type NoEffectReason = 'product' | 'not-made' | 'locked' | 'no-connection'
  export interface SourceRule { itemId: string; kind: SourceRuleKind; noEffect?: NoEffectReason }
  /** Every rule of the block: `itemSourcing` entries in key order, then `noImportItems` in order. */
  export function sourceRules(block: Block, gameData: GameData): SourceRule[]
  /** The text shown beside a rule that has no effect. */
  export function noEffectText(reason: NoEffectReason, itemName: string): string
  ```

  `noEffect` is the first reason that applies, tested in this order:

  | Reason | Applies to | Condition | Text |
  | --- | --- | --- | --- |
  | `product` | all three kinds | `hasProduct(block, itemId)` (`src/solver/blockGraph.ts`) | "{item} is a product of this block, so the block always makes it." |
  | `not-made` | all three kinds | `!blockMakesItem(block, gameData, itemId)` (`src/solver/index.ts`): the item is raw in the block | "No row in this block makes {item}." |
  | `locked` | `'byproducts-first'` only | the item is in `block.noImportItems` | "Import is off for {item}, so the block has to make it." |
  | `no-connection` | `'connections-first'` only | no entry of `block.inputConnections` has this item and a `fromBlockId` that is another existing block | "No connection for {item}." |

  The function reads the block only, never a solve result. So a product with no extra output and no request, which the solver does not treat as a goal, is still reported as `product`; that is accepted, and matches what the side panel does today. One unit test per reason and kind, one for the order of the reasons, one for an item with two rules.

- [ ] **T4. The Comes from control on the Ingredients slot.** In the strip of a selected Ingredients slot (`FactorySummary.tsx`), add a group `data-testid="comes-from"` labelled **Comes from** with:
  - the three presets as one radio group (`data-sourcing-choice` = `own`, `connections-first`, `byproducts-first`, the values the side panel uses today), calling `setItemSourcing`;
  - the Import switch (`role="switch"`, `data-testid="import-switch"`), calling `toggleNoImportItem`;
  - the item's sentence under them (`data-testid="sourcing-sentence"`);
  - each preset's and the switch's help text as its tooltip, shown on hover and on keyboard focus.

  Disabled states, each with its reason as the tooltip: *Only what's already made* while Import is off ("Import is off for {item}, so the block has to make it."); the Import switch while *Only what's already made* is chosen ("Only what's already made relies on imports for the rest."); so the control never creates that pair. A plan saved with both shows *Only what's already made* chosen and reports it through T3 as `locked`. A preset or an Import-off that has no effect (T3) stays selectable so it can be changed, and the control shows `noEffectText` in grey with a **Remove** button that clears that one rule (`setItemSourcing(item, undefined)` or `toggleNoImportItem(item)`).

  Remove: the three radio items and the Forbid / Allow imports entry from `ConnectionMenu.tsx`, and the separate Forbid imports / Allow imports action from the strip. The store commands are unchanged.

- [ ] **T5. Row side panel: read-only.** In `sidePanel/SourcingSection.tsx`, each ingredient keeps its icon, name, rate and sentence. The radio group and the Forbid imports checkbox go, and so does the line saying that other rows follow the same mode. Add a **Change…** button (`data-testid="sourcing-change"`) that opens the item's Ingredients slot: it expands the summary strip if it is collapsed (`uiStore.setSummaryCollapsed(false)`), selects the slot and moves focus to the **Comes from** group. Slot selection is local state of the pane today; add a transient request to `uiStore`, modelled on `panelHighlight`, that the Ingredients pane consumes. T6 and T7 reuse it.

- [ ] **T6. Marker in place of `B` / `C`.** In `ItemChip.tsx` / `IconChip.tsx` / `RecipeRow.tsx`: replace `SourcingBadge` and the `sourcing` prop with [the marker](#the-marker). "The rows a rule changes" means every recipe row of the block, in any sub-factory, that has the item as an ingredient; so the marker goes on every ingredient chip of an item that has a rule with an effect, and on no product or byproduct chip. The chip's title loses its " (byproducts first)" / " (connections first)" suffix. A click on the marker opens the item's Ingredients slot as **Change…** does in T5; a click elsewhere on the chip keeps its current behaviour.

- [ ] **T7. The block's rule list.** A button "Source rules (N)" (`data-testid="source-rules"`) in the header of the Ingredients pane, after the item count, where N is the number of rules of the block (`sourceRules(...).length`). Hidden when N is 0, and not drawn in the collapsed summary line. It opens a popover listing every rule (`data-testid="source-rule"`, `data-item-id`, `data-rule` = the kind, `data-no-effect` = the reason when there is one): the item's icon and name, the rule's name (**Receive it first**, **Only what's already made** or **Import off**), the item's sentence, and a **Remove** button that clears that one rule. A rule with no effect is greyed and shows `noEffectText` in place of the sentence. Clicking a rule's item opens its Ingredients slot as in T5. Put a screenshot of the popover in the pull request.

- [ ] **T8. Marker on the Ingredients slot, the areas matrix and the block graph.** [The marker](#the-marker), for an item with a rule that has an effect, on: its Ingredients slot, selected or not, and its chip in the collapsed summary line; the item's row header in the areas matrix of the block that holds the rule; the edge chips of the block graph for connections of that item into that block. Byproducts slots show nothing, like byproduct chips. The slot's accessible name gains ", has a source rule".

- [ ] **T9. Docs, final pass.** `spec/ui.md` (Ingredients pane, chips, side panel, connection menu, the `coproduct-driven` row of the warnings table), `spec/data-model.md` and `spec/solver.md` ("Byproducts first"), which today disagree on where the mode is set; the README's "Using the planner" where it names the modes and **Forbid imports**. Then tick the item this phase closes in plan.md.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- "Sourcing badge on Ingredients slots" (T4 and T8).

## Tests

- **Unit.** T1 to T3 as above. Component tests that assert the old labels or the badge: `FactorySummary.test.tsx`, `RecipeRow.test.tsx`, `sidePanel/SidePanel.test.tsx`, `WarningsPopover.test.tsx`, `IconChip.test.tsx`.
- **e2e.** `e2e/item-sourcing.spec.ts` and `e2e/block-requests.spec.ts` assert the current labels and the `B` / `C` badge (`item-tile-sourcing`) and are rewritten around the control. `e2e/ingredients-pane.spec.ts` asserts the **Forbid imports** / **Allow imports** menu item and strip action that T4 removes, and moves to the Import switch. New cases: setting each preset from the Ingredients slot; the third preset disabled while Import is off, and the switch disabled while that preset is chosen; a rule with no effect greyed and removed; the marker on every ingredient chip of the item and on no other chip; the **Change…** button from the side panel with the summary collapsed.
- **Parity.** No solver result changes in this phase: `legacyParity.test.ts` and the existing synthetic cases stay green without edits. T1 adds a case and changes none.

## Done when

- A player can set, read and remove every rule that exists today without meeting the words "byproducts first", "connections first", "own recipes first", "forbid imports" or a letter badge.
- Every preset and the Import switch has help text reachable by mouse and keyboard.
- A rule that has no effect says so and can be removed in one click.
- Plans saved before the phase load and solve to the same numbers.
