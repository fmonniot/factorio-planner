# Sourcing priority, phase 2: the list

Phase 2 of [plan.md](plan.md). It follows [phase 1](phase-1.md), which has shipped. It stores one rule per item, makes the one combination the stored modes could not express real, and shows the Sources list itself with the connections of the item as lines.

Ticketed on 2026-11-11 from the specs, the code and two throwaway `solveBlock` runs (not kept). The author confirmed the [decisions](#decisions) the same day.

## What the measurement changed

The first draft of this phase listed two combinations the stored modes could not express on one item. One of them already works.

- **"Receive first and never make it here" exists today.** It is *Don't make more here* with a connection. Measured on the fixture of synthetic case 11 (row A makes 30 X on the side, row U uses 50, row R can make X), with X set to `'byproducts-first'` and one connection, with and without areas:

  | Offer | Received | R runs for X | Imported |
  | --- | --- | --- | --- |
  | none | 0 | no | 20 |
  | 100, or unlimited (the request probe) | 20 | no | 0 |
  | 5 | 5 | no | 15 |

  So a request asks the source for 20, and the block never makes X for itself. The name and the sentence hide it: the sentence of that preset does not mention connections. This phase fixes the sentence (T4); the solver needs nothing.
- **The one new combination is *Don't make more here* with Import off.** Today the lock wins: R runs at 10 / min, and a connection for X is not used at all (received 0 with any offer), because pass 1 covers the need with R before supply is looked at.
- **So at block scope a rule has two parts and six states.** Where *Make more here* sits (before the block lines, after them, or off) and whether Import is on. The three presets are the three positions of *Make more here*; the Import switch is the other part. Every order the list allows in this phase is a preset plus the switch, so **Sources…** adds no fourth radio state: it shows the list, the connections of the item and their order. A rule that no preset can express first appears with area rules in phase 5.
- **A sentence of phase 1 is wrong.** Under *Don't make more here*, "{recipes} makes the rest" and "so {recipes} covers it" say that a row runs for the item. It does not: the rest is imported (synthetic case 8, and the table above). T4 replaces both.

## Scope

In: one stored rule per item in place of `itemSourcing` and `noImportItems`; *Don't make more here* with Import off; **Sources…** on the **Comes from** control, opening the Sources list (the line names with their help texts, from `SOURCES_LINES` in `itemSourcing.ts`, a switch on *Make more here* and on *Import*, *Make more here* moved above or below the block lines); one line per connection of the item, in connection order, with its rate, limit, the read-only **requested** / **existing** tag, reorder and remove; corrected sentences.

Out, and left to later phases: rules on an area, and *Other areas* as anything but a read-only line (phase 5); *Make more here* between two block lines (see D3); a switch that keeps a connection but turns it off (see D4); the source side (phases 3 and 4); the default's dependence on the recipe ratio (phase 6); the request probe defect "Connections first with partial supply" ([backlog](../backlog.md)).

## Words used in this document

The words of [phase 1](phase-1.md#words-used-in-this-document) keep their meaning, except these.

| Word | Meaning |
| --- | --- |
| Rule | The stored `SourceRule` of one item in one block: `{ makeHere?, importOff? }`. An item with no entry has the default rule. |
| Part | One of the two keys of a rule. `sourceRules()` (`sourceRules.ts`) and the block's rule list keep listing parts, one entry each, under the kinds of phase 1: `'connections-first'` (`makeHere: 'after-blocks'`), `'byproducts-first'` (`makeHere: 'off'`), `'import-off'`. |
| Line | One row of the Sources list. See [The list](#the-list). |
| Block line | A line for one connection of the item (`Block.inputConnections`, in that order). |
| Missing | What an item with Import off still lacks after every source that is on. It is the solver's `unsatisfied` rate of that item. |

## The stored rule

```ts
// src/data/schema.ts
export const SourceRuleSchema = z.object({
  /** Where "Make more here" sits. Absent: before the block lines (Make it here). */
  makeHere: z.enum(['after-blocks', 'off']).optional(),
  /** Present: the Import line is off. */
  importOff: z.literal(true).optional(),
})
// Block
sourceRules: z.record(z.string(), SourceRuleSchema).default({})   // item id → rule
```

An absent key is never written, and a rule with no key is dropped, as `maxRate` is on a connection. `itemSourcing` and `noImportItems` leave the `Block` type.

| Stored before | Loads as |
| --- | --- |
| item in `noImportItems` | `{ importOff: true }` |
| `itemSourcing[item] = 'connections-first'` (or the older `connectionsFirstItems`) | `{ makeHere: 'after-blocks' }` |
| `itemSourcing[item] = 'byproducts-first'` | `{ makeHere: 'off' }` |
| `'byproducts-first'` on an item in `noImportItems` | `{ importOff: true }` only |
| both a mode and a lock, otherwise | both keys |

The fourth row is why the rule gets a new key instead of reusing the two old ones. A plan saved with that pair solves today as if only the lock were set, and the UI says the preset has no effect. With the old keys kept, the loader could not tell that plan from one saved after this phase, where the pair means something else (T3). Dropping the preset on load keeps the plan's numbers.

**Old saves.** Every way a plan enters the app goes through `BlockSchema`: local storage at startup, an imported file, a duplicated block or plan. So the migration below is the whole path for old saves: they load without a prompt or a version check, the loader reads the old keys for good, and a plan is written back in the new shape on its next save. A file exported after this phase does not load in an older build of the app as the same plan (its rules are ignored there); the app is only ever served as its latest build, so nothing reads one.

The migration runs in `migrateBlock`, after the hoisting of per-sub-plan `noImportItems`. When `sourceRules` is present on the input it wins and the legacy keys are dropped; the migration is idempotent. Entries come out in the order of the `itemSourcing` keys, then the remaining locked items. Exports write `sourceRules` only (D2).

The order of the block lines is not in the rule: it stays the order of `inputConnections` (D1).

## What each rule does in the solver

Nothing changes for five of the six states; the table names what the LP already does for them, in the terms of [spec/solver.md](../../spec/solver.md). "Fill" is the two-pass rule (supply capped at the pass-1 residual), "first" is supply in every pass capped by the offer only.

| `makeHere` | `importOff` | Preset and switch | Import slack | Connected supply |
| --- | --- | --- | --- | --- |
| absent | absent | Make it here | `BIG_M` | fill |
| absent | `true` | Make it here, Import off | none (hard row) | fill |
| `'after-blocks'` | absent | Receive it first | `BIG_M` | first |
| `'after-blocks'` | `true` | Receive it first, Import off | none (hard row) | first |
| `'off'` | absent | Don't make more here | cheap (`BYPRODUCTS_FIRST_SLACK_COST`) | fill |
| `'off'` | `true` | Don't make more here, Import off | **cheap, reported as missing** | fill |

**The new state.** With *Make more here* off and Import off, the item may come only from what the block already makes, other areas and other blocks. A hard row cannot express that: with no slack the LP runs a recipe for the item (today's behaviour), and when no recipe can, it is infeasible, which returns meaningless values and no warning. So the item keeps its cheap slack, and what the slack holds is not an import but the amount **missing** (D5). The solve is the one of *Don't make more here* with Import on, number for number; only the reading of the rest changes. A request therefore asks the source for what the block's rows do not already make, as in the table of the measurement.

Byproduct consumers' ingredients keep their hard row whatever the rule, as today.

## The list

**Sources…** shows the lines below, top to bottom. `data-testid="sources-line"`, `data-line` as given.

| Line (`data-line`) | Shown | Controls | What it reads |
| --- | --- | --- | --- |
| Already made here (`made-here`) | always | none | under *Don't make more here*, every row of the block that makes the item at a rate above 0; otherwise the rows not dedicated to it (`ItemMaker.byproduct`). Each as "{recipe} {rate}", or "nothing yet" |
| Make more here (`make-here`) | always | a switch; **Move up** / **Move down** and drag, across the whole group of block lines | the rows dedicated to the item, as "{recipe} ({n} × {machine})"; "no row here makes it" when the block has none |
| Other areas (`other-areas`) | in a block with areas | none in this phase | no figure in this phase |
| one per connection (`block`, `data-connection-id`) | one per connection of the item, in `inputConnections` order; a deleted source or a self-connection is listed greyed, with **Remove** only | drag and **Move up** / **Move down** among the block lines; the limit field; **Remove** | the source's colour and name, the tag, the delivered rate (`—` before the first solve), the flow's status text as in the Ingredients pane |
| Receive from… (`add-block`) | always, after the block lines | opens `ConnectionMenu` | with no connection its text is "No connection for {item}." |
| Import (`import`) | always, last | a switch | the imported rate; with the switch off, "Missing {rate}" when something is missing |

Positions: *Already made here* is first and *Import* last. *Make more here* sits directly above the block lines (`makeHere` absent) or directly below them (`'after-blocks'`); switched off (`'off'`) it stays where it was drawn last and is greyed. *Other areas* follows *Make more here*, or *Already made here* when *Make more here* is off, as in the mapping table of plan.md.

The list and the presets are two views of one rule. Moving *Make more here* below the block lines chooses **Receive it first**; switching it off chooses **Don't make more here**; switching it on again chooses **Make it here**. The Import line's switch and the control's Import switch are the same switch.

**The tag.** A block line reads **requested** when the source has the item as a product and the request is applied, and **existing** otherwise: a take, or a request the solver ignores (`ConnectionFlow.requestIgnored`), whose reason is the tag's tooltip, in the words of the block graph. Before the first solve the tag follows `hasProduct(source, item)`. An existing line whose source has no product for the item has the action **Make it a product**, which adds the product on the source block and asks first through `ProductChangeDialog` as the Byproducts pane does.

**Help.** Every line has its help text from `SOURCES_LINES` (plan.md, "Help on every line"; a block line has the *Other blocks* help, the Import line the Import switch's) as a tooltip on hover and keyboard focus, and as a help line under the line that has the focus. The tag's help: **requested**, "{source} makes what this block needs of it."; **existing**, "{source} only gives what it has left over."

## Sentences

`sourcingText` takes the rule instead of `mode` and `noImport`. The sentences of *Make it here* and *Receive it first* stay as in [phase 1](phase-1.md#sentences), with " Import is off." appended when it is. *Don't make more here* gets the table below, where `{used}` lists every row that makes the item at a rate above 0 as "{recipe} {rate}", and `{blocks}` the connected sources.

| Rows already make it | Connection | Import | Sentence |
| --- | --- | --- | --- |
| yes | no | on | "Uses what this block already makes ({used}). The rest is imported." |
| yes | yes | on | "Uses what this block already makes ({used}), then takes from {blocks}. The rest is imported." |
| no | no | on | "No row here already makes {item}; it is imported." |
| no | yes | on | "No row here already makes {item}; it is taken from {blocks}, and the rest is imported." |
| any | any | off | the sentence above with its last clause replaced: "The rest is imported." becomes "The rest is missing: Import is off.", "it is imported." becomes "it is missing: Import is off.", "and the rest is imported." becomes "and the rest is missing: Import is off." |

## Tickets

Each ticket is one pull request and updates the docs for what it changes; T8 is the final pass. T1 is a decision, not code. T2 comes first. T3 needs T2; T4 needs T3. T5 needs nothing. T6 needs T4. T7 needs T5 and T6.

- [x] **T1. Names, after phase 1.** Decided with the author on 2026-11-12 ([D8](#decisions)): the third preset becomes **Don't make more here** (it was *Only what's already made*), the button **Sources…** (it was *Custom order…*), and the Import switch's help reads "Bring it in from outside the plan. Off: what the other sources leave is shown as missing."; the other names stay. The renamed preset, its new help and the Import help ship with this ticket; the button, the line names and their help texts are recorded in `itemSourcing.ts` (`SOURCES_BUTTON_LABEL`, `SOURCES_LINES`) for T6 and T7 to read. No stored key depends on a name: the keys of [The stored rule](#the-stored-rule) are `makeHere` and `importOff`.

- [x] **T2. One stored rule per item.** No change of behaviour, of any solver result, or of the UI.
  - `src/data/schema.ts`: `SourceRuleSchema` and `Block.sourceRules` as in [The stored rule](#the-stored-rule); remove `itemSourcing`, `noImportItems`, `ItemSourcingModeSchema`, `ItemSourcingSchema`; `migrateBlock` builds `sourceRules` by the table and drops the legacy keys. `src/data/types.ts` exports `SourceRule`.
  - `src/store/blockStore.ts`: `setMakeHere(itemId, 'after-blocks' | 'off' | undefined)` and `toggleImportOff(itemId)` replace `setItemSourcing` and `toggleNoImportItem`, both undoable; an emptied rule removes the item's key. Duplicating a block or a plan copies the map.
  - Solver: `SolverPlan.sourceRules` replaces `noImportItems` and `itemSourcing` (`flattenBlock`, `blockResult.ts`); `itemsWithSourcing` and `byproductsFirstSet` read the rule and keep their results (`byproductsFirstSet` still leaves out an item with `importOff`; the migration guarantees no loaded plan has that pair and the control still refuses it). `planKey` and the request-loop memo key (`computeRequests`) take the rule map as sorted entries in place of the two old fields.
  - Readers: `sourceRules.ts` (the type it exports becomes `SourceRulePart`; the kinds, the `data-rule` values and the `data-sourcing-choice` values do not change; parts are listed per item, the `makeHere` part before `import-off`, in map order), `ComesFrom.tsx`, `useSourcingSentence.ts`, `useRemoveSourceRule.ts`, `summaryRows.ts`, `src/solver/inspect.ts` and `scripts/inspect-plan.mjs` (`--sourcing` keeps its two values and maps them to `makeHere`; add `--import-off <item>`), `src/test/snapshotFixtures.ts`.
  - Tests: `loader.test.ts` gets one case per row of the migration table, one for idempotence, one for a plan that has both `sourceRules` and legacy keys, and one for the oldest shapes at once (`connectionsFirstItems`, and `noImportItems` on a sub-plan). `persistence.test.ts` gets a state stored in local storage in the old shape that loads into rules and is saved back with `sourceRules` and without the old keys. The plans in `e2e/fixtures/` keep the old keys on purpose: they are the migration's real-data test, and `legacyParity.test.ts` must stay green without regenerating its golden file. Add one fixture saved in the new shape.
  - Docs: `spec/data-model.md` (the `Block` fields and the legacy migration), `spec/solver.md` where it names the stored fields.

- [x] **T3. Solver: *Don't make more here* with Import off.** Write the synthetic case first: case 12 in `spec/test-synthetic.md`, on the fixture of case 11 with the rule `{ makeHere: 'off', importOff: true }` on X, automated in `src/solver/synthetic.test.ts`, with and without areas.

  | Case | Offer | Received | R runs for X | X missing (`unsatisfied`) |
  | --- | --- | --- | --- | --- |
  | a | no connection | 0 | no | 20 |
  | b | 100 | 20 | no | 0 |
  | c | unlimited (the request probe) | 20 | no | 0 |
  | d | 5 | 5 | no | 15 |

  These are the numbers measured for the same fixture with Import on. If a case does not give them, stop and report.

  In `solveBlock` and `solveAreaBlock`: an item with `makeHere: 'off'` and `importOff` is left out of the LP's no-import set and is in the byproducts-first set, in every pass. A byproduct consumer's ingredient keeps its hard row whatever its rule. `coproductDrivenWarning` keeps receiving every item with `importOff` plus the byproduct consumers' ingredients, so its hint is unchanged. `pass2Plan` needs no change: the item is not locked in the LP, so there is no lock to restore. Add one `solveAll` test: a request for such an item asks its source for 20, and with a source that makes nothing the consumer reports 20 missing and the flow is `limited`. Docs: `spec/solver.md` ("Byproducts first": *Not affected* no longer lists user locks; "Pinned rates, … no-import items").

- [ ] **T4. The pair in the control, the missing amount, the sentences.**
  - `ComesFrom.tsx`: *Don't make more here* is selectable while Import is off and the Import switch while that preset is chosen. `RELIES_ON_IMPORT_TEXT` and the `locked` reason (`NoEffectReason`, `noEffectText`) go.
  - `summarySegments.ts`: for an item with Import off that still has an `unsatisfied` rate, the segment is drawn with the `short` look instead of `import`, reads `Missing N` with the note "— Import is off", and the slot's status is `short` (amber border, `▼`, ", short" in the accessible name). This also covers a state that exists today: a locked item whose connection delivers only part of the need.
  - `sourcingText.ts` to [Sentences](#sentences), with `sourcingText.test.ts`.
  - e2e: `item-sourcing.spec.ts` and `source-rules.spec.ts` lose the cases on the disabled pair and gain: choosing the pair, the slot reading short with `Missing N`, and the rule list showing two parts with an effect.

- [ ] **T5. Store: reorder a block's connections.** `moveConnection(connectionId, beforeConnectionId | null, toBlockId?)` in `blockStore.ts`: moves a connection so that it sits just before another connection of the same item of the same block, or after the item's last one when `null`. Undoable, in the target block's history like the other connection commands; a no-op, with no history entry, when nothing would move or the two connections differ in item or block. `moveConnectionBy(connectionId, -1 | 1)` is the one-place form among the connections of its item. No UI. Unit tests, and one `solveAll` test pinning what the order decides today: with two requests for one item, the first in order gets the whole need up to its limit (`shareOut`), and swapping them swaps the shares.

- [ ] **T6. The list: fixed lines.** A new `SourcesList.tsx`, shown by **Sources…** (`data-testid="sources-button"`, `aria-expanded`) under the presets of `ComesFrom`. In the Comes from popover and in a row of the block's rule list it expands in place. In the strip of an Ingredients slot there is no room: the button opens the Comes from popover with the list open (`uiStore.openComesFrom(itemId, anchor, { list: true })`). This ticket draws *Already made here*, *Make more here*, *Other areas*, a single read-only placeholder for the block lines ("{n} connections", or "No connection for {item}.") and *Import*, with their help texts, the two switches and the move of *Make more here* ([The list](#the-list)). Drag follows the Products slots (native drag and drop, a drop line); **Move up** / **Move down** are the keyboard and touch way. The line names and help texts are read from `SOURCES_LINES` in `itemSourcing.ts` (T1). Component tests for the mapping between list and presets in both directions; e2e: each of the six states reached from the list, and from the presets with the list open.

- [ ] **T7. The list: block lines.** Replace the placeholder with one line per connection: colour, name, tag, rate, status, the limit field (`RateInput`, `setConnectionMaxRate`), **Remove** (`removeConnection`), reorder by drag and by **Move up** / **Move down** (`moveConnection`), then the **Receive from…** line (`uiStore.openConnectionMenu`; the menu closes first on Escape, as from the control today). The tag and **Make it a product** as in [The list](#the-list); `addProduct` acts on the active block only today, so it gains an optional target block, with the history entry in that block as the connection commands do. e2e, on a plan with two sources for one item: the lines are in connection order; a reorder changes which source delivers; a limit on the first makes the second deliver the rest ("prefer a cheap source, cap it, fall back to a second" of plan.md); the tag reads **existing** for a take and **requested** after **Make it a product**. Put a screenshot of the list in the pull request.

- [ ] **T8. Docs, final pass.** `spec/ui.md` (Comes from, the popover, the Ingredients pane's segments, the sentences table), `spec/data-model.md`, `spec/solver.md` (the stored names it keeps today: "Connections first" and "Byproducts first" stay as section names for the two LP mechanisms, each saying which `makeHere` value selects it), the README's "Using the planner". In plan.md, tick nothing: the item this phase touches stays `[~]` until phase 6.

## Decisions

Taken with the author on 2026-11-11, D8 on 2026-11-12.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D1 | Does the order of the block lines live in the rule? | No: it stays the order of `inputConnections`. | The solver reads that order in four places (the caps, the sharing of a need among requests, the take credits, the delivery), and the block graph lists connections in it. A second copy in the rule could disagree with it, and would have to follow every connection added or removed. |
| D2 | Do exports keep writing the old keys for a while? | No. | The app has no backend and always runs its latest build; `connectionsFirstItems` was dropped the same way. The loader keeps reading the old keys for good. |
| D3 | May *Make more here* sit between two block lines? | Not in this phase. | The block solve gets one cap per item, the sum of its connections' offers; "between" needs two caps per item through `solveBlock`, the solve cache and the request probe, and the probe cannot know what a take placed above will deliver (the partial-supply defect). No case of plan.md's "Keeping the power" table needs it. `makeHere` can later take a third form without a migration. |
| D4 | Does a block line have a switch? | No: it has **Remove**. This departs from plan.md ("each line except Already made here can be switched off"). | A connection that is kept but off is a new stored state on `BlockConnection` and a new flow status in the pane, the graph and the solver. Removing is undoable. Revisit if what-if toggling is missed. |
| D5 | What does Import off mean when *Make more here* is off and the other sources do not cover the need? | The rest is shown as missing; the block is not forced to make it and the solve does not fail. | It is the only reading that honours both switches. The alternative, a hard row, makes the block run a recipe for the item, or makes the LP infeasible with no warning. |
| D6 | Does the block's rule list change? | No: one entry per part, as in phase 1. | It keeps the count, the test ids and the **Remove** of one part. |
| D7 | What is stored? | `Block.sourceRules`, as in [The stored rule](#the-stored-rule), with a migration for every old save. | One rule type that phase 5 can attach to an area, and a new key that lets the loader tell an old plan with the ignored pair from a new one. |
| D8 | Which names does the list ship with (T1)? | Taken on 2026-11-12, looking at the end state of all six phases. **Don't make more here** for the third preset, with the help "Runs no row for this item: uses what this block already makes, then its connections, then Import." **Sources…** for the button, which only opens the list in every phase; a rule no preset expresses (phase 5) shows as a fourth, read-only **Custom** state beside the presets. The Import switch's help: "Bring it in from outside the plan. Off: what the other sources leave is shown as missing.", which the Import line shares. Kept: **Make it here**, **Receive it first**, **Comes from**, and the lines **Already made here**, **Make more here**, **Other areas** and **Import**. *Other blocks* names no line: each block line is named after its source and carries the *Other blocks* help. | *Only what's already made* hid that the preset takes from connections before importing, and becomes false once Import off means "missing"; *Don't make more here* is the *Make more here* line switched off, and says nothing about the other sources. *Custom order…* promised a fourth state that does not exist until phase 5, mixed opening the list with choosing a rule, and the list holds more than an order (limits, tags, switches, area lines); *Sources…* is the list's own name and stays apart from phase 3's **Served order…**. The old Import help ("this block must make or receive all of it") is false with *Don't make more here* and Import off; the new one holds in all six states, since with *Make more here* on nothing is left. |

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog). None in full.

- "Let connected supply replace an upstream import" stays `[~]`: where a connection exists the order has decided since phase 1 (*Receive it first*), and this phase makes it visible as a position in the list. The default case is phase 6.

## Tests

- **Unit.** The migration (T2), `moveConnection` (T5), `sourcingText` (T4), the list's mapping to the rule (T6). Component tests that build a `Block` literal change their two fields for `sourceRules: {}`; it is mechanical and belongs to T2.
- **Synthetic.** Case 12 (T3). No existing case changes.
- **Parity.** `legacyParity.test.ts` stays green without regenerating: T2 changes no number, and T3 only changes a state no loaded plan has.
- **e2e.** As listed in T4, T6 and T7. `e2e/plan-import.spec.ts` gains a plan in the old shape that carries the pair, and checks that it loads as Import off alone.

## Risks

- **T2 is wide.** More than sixty files name the two fields, most of them tests. It must not be mixed with a change of behaviour: review it against "no solver result and no visible string changes".
- **The pair changes meaning.** A plan saved with it before this phase keeps its numbers through the migration, but its rule reads *Make it here, Import off* afterwards, not *Don't make more here*. Say so in the release notes, with the renamed preset (*Only what's already made* is now **Don't make more here**, D8).
- **The list is a second way to do what the presets do.** If T1 concludes that the presets are enough for the rule, the list still earns its place for the connections: their order, limits and tags have no other home on the consumer side.
- "Connections first with partial supply" is not fixed here; *Receive it first* inherits it, as before.

## Done when

- A plan saved before the phase, in local storage or as a file, loads into rules and solves to the same numbers.
- *Don't make more here* with Import off can be chosen, never makes the block run a row for the item, and shows what is missing.
- The player can read, in one list, every place an item comes from in the order it is tried, reorder the connections of an item, set their limits and see which are requested.
- No sentence says a row makes the rest when it does not.
