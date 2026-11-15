# Sourcing priority, phase 5: area rules

Phase 5 of [plan.md](plan.md). It builds on the stored rule of [phase 2](phase-2.md) and follows [phase 4](phase-4.md), which shipped on 2026-11-15.

The questions of the first draft were answered from the code and one throwaway `solveBlock` run on 2026-11-15 ([What the code says](#what-the-code-says)). Three answers shape the phase: an area rule needs no new pass, only a slack and a supply per area in place of one per item; choosing the supplying area needs flows per pair of areas, which the area LP does not have; and a rule on an area does not reserve a byproduct for that area, because the LP sends a byproduct where it saves the most machines. The author confirmed the [decisions](#decisions-for-the-author) the same day; the [tickets](#tickets) are written against them. Nothing of the new LP was prototyped: the phase starts with a spike (T2), as phase 3 did.

## Scope

In: a Sources rule attached to an area, which replaces its block's rule for that area; *Other blocks* above *Make more here* in an area (a central block feeding an area that has its own row); *Don't make more here* and Import off on one area; the *Other areas* line expanded, in an area's list, to one line per area that makes the item, each with a switch and the rate the solver routed; the same routes on the collapsed-area chips and in the areas matrix's "Trades with" panel.

Out: choosing between two recipes for one item inside a block (*Make more here* stays one line); an order among the supplying areas (D6); *Make more here* below *Other areas* (D4); a **Served in this order** list on a supplying row (D6); reserving a byproduct for the area that has the rule (D8); in the areas matrix, the outside column split into connected and imported for items no area rule touches (the split exists only where the LP has it, see T4).

The three cases it must serve, from [Keeping the power](plan.md#keeping-the-power):

- One consumer of an item stops making it and takes what is left over; the other consumer of the same block keeps its own row.
- A central block feeds an area that also has its own row for the item.
- An area without its own row is supplied by the area the player chose, not by the first one in the table.

## What the code says

Read on 2026-11-15. File names are under `src/solver/` unless said otherwise.

### The area LP has one slack and one supply per item

`solveAreaLPOnce` (`areas.ts`) builds on `buildLPModel` (`solve.ts`), which gives every intermediate one import slack `s_i` and, with an offer, one supply variable `u_i`. For an item that two areas or more touch, both are wired into the item's *other* pool (`opool`), so they reach any area. The rule decides three things, all per item:

| Part of the rule | Where it is read | Per item today |
| --- | --- | --- |
| `importOff` | `sourcingSets` (`blockResult.ts`): the item has no slack | yes |
| `makeHere: 'off'` | `sourcingSets`: the slack costs `BYPRODUCTS_FIRST_SLACK_COST` instead of `BIG_M` | yes |
| `makeHere: 'after-blocks'` | `solveAreaBlock`: `u_i` is in every pass, capped by the offer only (`firstItems`); otherwise it exists in pass 2 only, capped at the pass-1 residual (`pass2Plan`) | yes |

So a rule on one area is a slack and a supply variable of that area, with that area's cost and caps, wired into the area's balance row instead of the pool. The two passes and the two stages stay as they are: **an area rule adds variables, not LP calls**. The risk in plan.md ("one pass per movable tier") does not arise, because *Make more here* still has the two positions the two passes already express (D5).

### Local first is two rules

"An area with its own dedicated row does not take another area's dedicated output" is the penalised `din` of stage 1. It is narrower than it sounds:

- It applies to an area that has a row **dedicated** to the item (`dedicatedProduct`: the row's primary product, else the recipe's main product, else its first product).
- It covers only the **dedicated** output of other areas. What other areas' rows make of the item on the side (the `o…` flows), the import slack and connected supply are *other supply* and reach every area, with or without its own row.

In the words of the list: the dedicated rows of an area are its *Make more here*; its other rows that make the item are its *Already made here*; and the *Other areas* line holds two things, other areas' byproducts (used before the area's own row runs harder, as they add no machines) and other areas' dedicated rows (used after it). The primary product keeps deciding which rows are which.

### There are no flows per pair of areas

The LP bounds what is taken by what is sent with two pools per item (`dpool`, `opool`). Which area supplies which is not an LP decision: `itemRoutes` (`areaRoutes.ts`) pairs senders and receivers after the solve with a fixed rule (areas with their own row first, then table order). Among senders the LP prefers the cheaper row, and on a tie the area higher in the table (`SHIP_COST · (1 + RANK_STEP · rank)` per unit sent).

Two consequences:

- **"This area takes nothing from that area" cannot be said to the LP today.** It needs a flow variable per pair of areas for the item, in place of the pools, so that a pair can be left out.
- **An order among suppliers would be a tie-break only.** The LP minimises machines; an order could decide between two rows of equal cost and nothing else. A player who drags the less productive area to the top would see nothing move.

### A byproduct goes where it saves machines

*Don't make more here* is a cheap slack: importing a unit costs 1e-5 against 1 per recipe run, so no row runs for the item. It cannot be a structural rule (any row that makes the item on the side could be run harder for it, which is exactly what the mode forbids). The cost of that choice shows once the rule sits on one area only. Take a byproduct of 30 X, an area C1 that uses 40 and has the rule, and an area C2 that uses 50 and has its own row R (2 X per run):

| Who takes the byproduct | R runs | X imported | Cost in the LP |
| --- | --- | --- | --- |
| C2 | 10 | 40 | 10 runs + 40 × 1e-5 |
| C1 | 25 | 10 | 25 runs + 10 × 1e-5 |

The LP takes the first line. C2 no longer imports, which is what the backlog item asks ("a second consumer of the item in the same block also gets imported supply"), but C1 gets none of the byproduct. No cost on C1's slack fixes it: to beat 15 runs it would have to be high enough to make R run for C1 as well. The player reaches the second line with the supplier switch: C2 switches off the area that makes the byproduct (D8, case 21 C).

### Measured today

A throwaway `solveBlock` run (not kept), on the fixtures of [case 21](#case-21-area-rules). "Offer" is the cap on the connected item.

| Fixture | Rule on the block | Offer | Result |
| --- | --- | --- | --- |
| A: areas L and B each use plate (12 and 8) and have their own plate row | none | 100 | each area makes its own; received 0 |
| A | *Receive it first* | 100 | received 20; both plate rows idle |
| A | *Receive it first* | 5 | received 5; L's row makes 7, B's 8 (which area gets the 5 is the LP's vertex, not a rule) |
| A | *Don't make more here* | none | both rows idle; 20 plate imported |
| B: area L uses 12 plate; areas M1 and M2 each have a plate row | none | none | M1 makes 12, M2 idle; route M1 to L |
| C with C1 40 and C2 30 | none | none | R makes 40 X; no X imported |
| C with C1 40 and C2 30 | *Don't make more here* | none | R idle; 40 X imported; the routes say the byproduct goes to C2 |

The first two lines are the item "Connections first vs local-first": with no rule a connection for plate delivers nothing to an area that has its own row, and the only way to change it is block-wide.

### What already shows the routes

- The areas matrix and its focus view (`areaMatrix.ts`, `MatrixRow.pairs`).
- The group panel of an area (`sidePanel/GroupPanel.tsx`, `groupFlows.ts`): each received or sent item names its other end ("from Oil", "outside the block").

Not yet: the chips on a collapsed area row and their `+N` popup show an icon and a rate with no partner; the "Trades with" list of the matrix's focus panel gives, per partner, an item count and total rates, not the items. That is what is left of "Per-partner area figures elsewhere" (T1).

### What is stored, and the precedent for cleaning it up

- `SubPlanSchema` (`src/data/schema.ts`) has `area?: boolean` and no rule. The root plan is a `SubPlan` too, and is an area ("Top level") whenever the block has one.
- `Block.sourceRules` holds `SourceRule` (`makeHere?`, `importOff?`); a rule with no key is dropped, since it means the default.
- Phase 4 stores area ids in the served lists and removes them when the sub-factory is deleted or its flag goes off, from the same command, with undo restoring them (`src/store/servedCuts.ts`: `lostAreaIds` includes the root's id when the last flag goes). `cloneSubPlanTree` renews sub-plan ids; `remapServedOrder` follows them.
- `flattenBlock` (`index.ts`) puts `areas: { id, nodeIds }[]` on the solver plan; `planKey` (`solveCache.ts`) and the request-loop memo key include `areas` as given. A rule carried on each area entry therefore reaches both keys with no further change.

### What reads a block's result per area

The request probe and the served lists read each area's *need* from the outside legs of `areaRoutes` (`areaNeedsOf`, `servedAreas.ts`). With an area rule those legs change with the rule, and for an item solved with a slack per area they come from the LP instead of the pairing rule, so the looseness of [phase 4, D3](phase-4.md#decisions-for-the-author) narrows for those items. Nothing in `solveAll` needs to know about area rules beyond that: a request is still the block's `received` from its probe.

## Decisions for the author

Proposed and confirmed with the author on 2026-11-15. D6, D7 and D8 depart from plan.md or from phase 2.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D1 | What is stored? | `SubPlan.sourceRules?: Record<itemId, AreaSourceRule>`, where `AreaSourceRule` is `SourceRule` plus `areasOff?: string[]` (ids of areas of the block this area takes nothing of the item from). An area's rule for an item **replaces** the block's rule for that area, whole. A rule with no key is kept: on an area it means "*Make it here*, Import on, whatever the block says". No migration: the key is absent on every stored plan. | One rule type, as phase 2 intended. Replacing whole means the area's list reads on its own, with no part inherited from a list the player is not looking at. |
| D2 | May the top level have a rule? | Yes, like any area, stored on the root plan. In a block without areas the root's rules are not read. | The top level is an area in the solver, the matrix and the served lists. Without it "the block receives plate first, except the top level" cannot be said. |
| D3 | What happens to an area's rules when its flag is switched off? | They are removed by the same command, and undo restores them; so are the `areasOff` entries of other areas that name it. The same on deleting the sub-factory. On load, a rule on a sub-plan that is not an area and an `areasOff` id that names no area of the block are dropped. | Phase 4's precedent (`servedCuts.ts`). A rule kept but ignored is the hidden state this initiative removes. |
| D4 | Local first as a position: can *Make more here* go below *Other areas*? | No. *Other areas* keeps following *Make more here* directly, as in phase 2. The primary product decides which rows of an area are its *Make more here* (dedicated to the item) and which are *Already made here*. | "Other areas before my own row" would only switch off the stage-1 penalty: the LP would then pick the cheaper row, not the other area's. A position that promises an order and delivers a tie-break is what phase 1 removed. |
| D5 | Which orders does an area's list allow? | The three of the block: *Make it here*, *Receive it first*, *Don't make more here*, each with the Import switch. "Other blocks above Make more here in an area" is *Receive it first* on the area. | They are the two positions and the off state the two passes express. No new tier, so no new pass. |
| D6 | How does an area choose its supplier? | A switch on each *Other areas* line of the receiving area's list (stored in `areasOff`). Off means nothing of the item comes from that area: its dedicated rows and its byproducts. The lines are in table order and are not dragged. No **Served in this order** list on a supplying row. | The switch is exact; an order would be a tie-break ([above](#there-are-no-flows-per-pair-of-areas)). "This row serves nobody else" stays several clicks; it goes to the backlog as a follow-up if it comes up. This narrows plan.md's "in order". |
| D7 | Is there a **Custom** state? | No. With D1, D5 and D6 every rule is still a preset plus switches (Import, and one per supplying area). The sentence names what is switched off. | [Phase 2, D8](phase-2.md#decisions) planned the state for "an order no preset expresses"; this phase adds no such order. plan.md is corrected by T8. |
| D8 | Does *Don't make more here* on an area reserve the block's byproduct for it? | No. The byproduct goes where it saves the most machines. To give it to the area with the rule, the other consumer switches off the area that makes it. The area's sentence says what it got. | See [A byproduct goes where it saves machines](#a-byproduct-goes-where-it-saves-machines): no single LP expresses the reservation. |
| D9 | Where is an area's rule set? | In the **Comes from** popover. In a block with areas it gains a scope control: **Whole block** and the area of the row it was opened from. An area with no rule shows the block's rule and the line "Follows the block's rule"; the first change writes a rule on the area; **Use the block's rule** removes it. The Ingredients slot keeps the block's rule and says how many areas have their own. | The rule belongs where its effect shows: the rows of that area. The slot is block-wide by nature. |
| D10 | How does the UI show which rule applies to a row? | The side panel's sentence per ingredient and the chip's marker follow the area's rule when it has one, and the sentence starts with the area's name. The block's rule list has one entry per part of an area rule, named "{area}: {rule}", and one per switched-off supplier ("{area}: takes nothing from {other}"). | The risk "narrower scope wins" of the first draft. |
| D11 | Which items get the new LP shape? | Only an item for which two areas that touch it have different rules, or for which some area has a supplier switched off. Every other item, and every plan with no area rule, is solved by today's model, bit for bit. | `legacyParity.test.ts` covers only blocks without areas; the area scenarios (`areas.test.ts`, cases 7, 11, 12, 19) must not move either. T2 confirms or overturns this. |
| D12 | What do the lines of an area's list read? | *Already made here* and *Make more here*: the area's own rows. Each *Other areas* line: the rate routed from that area into this one. A block line: the connection's whole rate, as in the block's list, with its controls read-only here (order and limits belong to the block, [phase 2, D1](phase-2.md#decisions)); under the block lines, "{rate} of it reaches this area". *Import*: what this area imports, or "Missing {rate}" with the switch off. | The figures the solver has per area. A connection is the block's, so its split between areas is one figure, not one per connection. |

The list of D6, D9 and D12, for plate in an area that has its own row and receives first:

```
Plate   comes from      [ Whole block | Logistics ]
(•) Receive it first    Import [on]      Use the block's rule

1  Already made here          nothing yet
2  Metals       requested     20          (12 of it reaches this area)
3  Make more here             plate casting (idle)
4  Smelting            [on]   0
   Building            [off]  —
5  Import                     none
```

## The rule in the area LP

The target of T4 and T5; T2 tries it first.

1. **The rule of an area for an item** is the area's stored rule when it has one, else the block's.
2. **An item is *split*** when it meets D11. An item touched by one area only is not split: it takes that area's rule through today's model.
3. **A split item has, per area that touches it:** a slack `s_a` wired into the area's balance row, with the cost of that area's rule (`BIG_M`; cheap under `makeHere: 'off'`; absent with `importOff` and without `'off'`), and a supply variable `u_a`, with `Σ u_a ≤ offer`. An area with `'after-blocks'` has `u_a` in every pass, bounded by what its own columns use (the `supuse` row of today, over that area's columns); any other area has it in pass 2 only, capped at that area's pass-1 residual. Stage 1 keeps `BIG_M` on every slack, as today.
4. **An item with a supplier switched off** has, in place of its two pools, a dedicated and an other flow per ordered pair of areas, capped per sender as `dout` and `oout` are today; a switched-off pair has no variables. The stage-1 penalty is on the dedicated flows into an area that has its own dedicated row, and the shipping cost on each flow by the sender's rank.
5. **The routes of a split item** are read from the LP (pair flows where it has them, `s_a` and `u_a` for the outside legs); `itemRoutes` keeps pairing the others. An outside leg into an area gains `supplied`, the part of it that is connected supply.
6. **What the block reports** does not change shape: `unsatisfied` is the sum of the slacks, `received` the deficit the supply covered. The part of an item's `unsatisfied` that is *missing* is the sum, over the areas whose rule has Import off, of their outside leg less its `supplied` part.

## Synthetic cases

### Case 21: area rules

Three fixtures. Values derived by hand on 2026-11-15 from the rule above; the rows marked *measured* are today's solver. The ticket that adds a row re-derives it in its plan, writes the test first and sees it fail, and never edits an expected value to match the solver.

**A. A central block and an area with its own row (T4).** Case 13's recipes (1 ore makes 1 plate; 1 plate makes 1 gear). Block H, product 20 gears; area L has a gear row pinned at 12 and a plate row, area B a gear row pinned at 8 and a plate row; one connection for plate.

| Row | Rule for plate | Offer | Received | L's plate row | B's plate row | Plate imported or missing |
| --- | --- | --- | --- | --- | --- | --- |
| a | none (*measured*) | 100 | 0 | 12 | 8 | 0 |
| b | block: *Receive it first* (*measured*) | 100 | 20 | 0 | 0 | 0 |
| c | L: *Receive it first* | 100 | 12 | 0 | 8 | 0 |
| d | block: *Receive it first*; B: `{}` | 100 | 12 | 0 | 8 | 0 |
| e | L: *Receive it first* | 5 | 5 | 7 | 8 | 0 |
| f | L: *Receive it first* | unlimited (the probe) | 12 | 0 | 8 | 0 |
| g | L: *Don't make more here* | none | 0 | 0 | 8 | 12 imported |
| h | L: *Don't make more here* | 100 | 12 | 0 | 8 | 0 |
| i | L: *Don't make more here* | 5 | 5 | 0 | 8 | 7 imported |
| j | L: *Don't make more here*, Import off | none | 0 | 0 | 8 | 12 missing |
| k | block: *Don't make more here*; L: `{}` | none | 0 | 12 | 0 | 8 imported |

- c against a and b: the case plan.md calls not possible today.
- d: an empty rule on an area is a rule (D1).
- g: B's row does not run for L (1 per run against 1e-5 per unit imported), so *Other areas* gives L only what B already makes, which is nothing.
- f, as a `solveAll` row: a source block that has plate as a product is asked for 12.

**B. Choosing the supplying area (T5).** Block H, product 12 gears; area L has a gear row pinned at 12 and no plate row; areas M1 and M2, in that order, each have a plate row.

| Row | L's rule for plate | M1's row | M2's row | Routes of plate into L | Plate imported |
| --- | --- | --- | --- | --- | --- |
| a | none (*measured*) | 12 | 0 | M1 12 | 0 |
| b | `areasOff: [M1]` | 0 | 12 | M2 12 | 0 |
| c | `areasOff: [M1, M2]` | 0 | 0 | outside 12 | 12 |
| d | `areasOff: [M1, M2]`, offer 100 | 0 | 0 | outside 12, supplied 12 | 0 (received 12) |

**C. One consumer takes the byproduct (T4, row d in T5).** Case 11's recipes (A: 1 ore makes 1 goal and 1 X; U: 1 X makes 1 other; R: 1 feed makes 2 X). Products 30 goal and 90 other. Area T has A; area C1 has U pinned at 40; area C2 has U pinned at 50 and R.

| Row | Rule for X | R runs | X imported or missing | Byproduct goes to |
| --- | --- | --- | --- | --- |
| a | none | 30 | 0 | either |
| b | block: *Don't make more here* | 0 | 60 imported | either |
| c | C1: *Don't make more here* | 10 | 40 imported | C2 |
| d | C1: *Don't make more here*; C2: `areasOff: [T]` | 25 | 10 imported | C1 |
| e | as d, with Import off on C1 | 25 | 10 missing | C1 |

- a: 90 used, 30 made on the side, R makes 60.
- c: see the table of [A byproduct goes where it saves machines](#a-byproduct-goes-where-it-saves-machines) (D8).
- d: C2 takes nothing from T, so R makes its 50; the byproduct is left for C1, which imports the other 10.

## Tickets

T1 needs nothing and can run at any time. T2 comes first among the others; T3 can run beside it. T4 needs T2 and T3, T5 needs T4, T6 needs T4, T7 needs T5 and T6, T8 is last. T4 and T5 change the same solver files and are sequential.

- [ ] **T1. Routes on the area chips and in "Trades with".** No solver change. The chips of an area row (`area-chips-in`, `area-chips-out`) and the lines of their `+N` popup name the other end of each item from `SolverResult.areaRoutes`, in the words of the group panel (`groupFlows.ts`: "from Oil", "to the rest of the block", "outside the block"), with one line per partner when an item has several. The "Trades with" list of the matrix's focus panel lists, under each partner, the items exchanged with it and their rates (folded past a few lines, as the group panel's lists are). Reuse `flowLines`; no second pairing. e2e on the plan of case 7. `spec/ui.md`. Closes "Per-partner area figures elsewhere".

- [ ] **T2. Spike: the area LP with a slack and a supply per area, and flows per pair.** Prototype steps 3 to 5 of [The rule in the area LP](#the-rule-in-the-area-lp) in `areas.ts` on a branch, driven by rules passed on the solver plan's `areas` entries (no stored field, no UI). Report in this file:
  1. Equivalence: with the new shape forced on **every** area item and no rule set, which results move in `areas.test.ts`, cases 7, 11, 12 and 19 and the e2e fixtures that have areas. This decides D11 (new shape for ruled items only, or one code path for all).
  2. The rows of case 21 that are not *measured*: which hold as derived, and for any that does not, why. A row that disagrees stops the phase until the author has seen it.
  3. Ties: which area gets a short offer in pass 2 (row e gives it to the area with the rule; two areas with residuals and an offer below their sum is the open case) and what tie-break makes it table order.
  4. Whether stage 1's bound on the penalised flows and stage 2's fallbacks survive the pair flows unchanged.
  5. Cost: LP calls per solve (expected: unchanged) and solve time on the largest fixture with areas, with the new shape on one item and on all.
  6. What an area does when it has switched off every supplier and Import and has no row of its own (expected: infeasible, reported like a locked item that cannot be made).

  The outcome fixes the order and the scope of T4 and T5; if the pair flows have to come first, T5's solver part moves into T4.

- [x] **T3. The stored rule and its commands.** D1, D2 and D3. `src/data/schema.ts`: `AreaSourceRuleSchema` and `SubPlan.sourceRules`; on load, drop a rule on a sub-plan that is not an area (the root counts as one only when the block has areas), an `areasOff` id that names no area of the block or the area itself, repeats, and an empty `areasOff`; keep a rule with no key. `src/data/types.ts` exports the type. Store: `setAreaMakeHere`, `toggleAreaImportOff`, `toggleAreaSupplier(areaId, itemId, otherAreaId)` and `clearAreaRule(areaId, itemId)`, undoable in the block's history; the first three write a full rule on an area that had none, starting from the block's rule for the item. `setSubPlanArea(off)` and `removeSubPlan` remove the area's rules and the `areasOff` entries that name it in the same command, undo restoring them (extend `servedCuts.ts` or sit beside it). `cloneSubPlanTree`, `duplicateSubPlanTo`, `cloneBlock` and `clonePlan` copy the rules and remap the area ids; an id that has no copy in the target block is dropped. The solver and the UI do not read the field yet. `spec/data-model.md`; `npm run contract`.

- [ ] **T4. Solver: a rule per area.** Steps 1 to 3 and 6 of the rule, and the outside legs of step 5. `flattenBlock` puts each area's rules on its `areas` entry (so `planKey` and the request-loop memo key carry them). Case 21 A and C (rows a to c) first, each with and without a second, unruled item that areas trade (to pin D11: its figures do not move). Plus: `solveAll`, row f as a request; a block with an area rule inside a loop of blocks; a served list on the source that ranks L and B, to pin that an area's need follows its rule (L's need is 12 in row c, 0 in row a). `legacyParity.test.ts` and `contract/` must not move. `scripts/inspect-plan.mjs` prints each area's rules and, per split item, each area's received, imported and missing rates, and gains `--area-sourcing <area>:<item>=<first|off|here>` and `--area-import-off <area>:<item>`. `spec/solver.md` (Areas; Connections first; Byproducts first, whose "Limits" loses "the mode is per item, not per consumer"), `spec/test-synthetic.md`.

- [ ] **T5. Solver: supplier switches.** Step 4 of the rule and the pair legs of step 5. Case 21 B and C (rows d and e) first. Plus: a switched-off supplier that is pinned (its output shows as a surplus, not as a route); the case of T2's point 6; an item with a switch in one area and a rule in another. `inspect-plan.mjs` gains `--area-off <area>:<item>=<other area>`. `spec/solver.md` (Areas: Routes), `spec/test-synthetic.md`.

- [ ] **T6. The control: scope, presets and Import on an area.** D9 and D10. `ComesFromPopover.tsx` and `ComesFrom.tsx`: the scope control (the shared segmented control), shown only in a block with areas; opened from a row, it starts on the row's area when that area has a rule for the item, else on **Whole block**; "Follows the block's rule" and **Use the block's rule**. `sourcingText.ts` and `useSourcingSentence.ts`: the sentence of an area's rule starts with the area's name and counts only that area's rows. `sourceRules.ts`, `SourceRulesButton.tsx`: one entry per part of an area rule. The marker on the chips of the rows an area rule changes, and on the area's column in the matrix. `summarySegments.ts`: the missing part of an item per step 6 of the rule. The Ingredients slot's line "{n} areas have their own rule", which opens the popover on the first of them. e2e on case 21 A: rows c and d reached from a row's chip, the figures of the table read in the pane, the rule list, **Use the block's rule**, switching the area flag off and undoing it. `spec/ui.md`, README "Using the planner".

- [ ] **T7. The list: one line per supplying area.** D6 and D12 in `SourcesList.tsx`: at area scope, *Other areas* is one line per other area that has a row making the item, in table order, with its switch (`toggleAreaSupplier`) and the routed rate; the block lines are read-only with the "reaches this area" figure; *Import* reads the area's own figure. At block scope *Other areas* stays one read-only line. The sentence names the areas switched off; the rule list gains their entries (D10). e2e on case 21 B (rows a to c) and C (row d), with the route asserted in the list and in the areas matrix. `spec/ui.md`, README.

- [ ] **T8. Docs and close.** What T1 to T7 left out of `spec/`. In [plan.md](plan.md): tick the four items below; correct the phase table's row 5, "Choosing the supplying area", "Scopes" and the **Custom** sentence of "Presets, named by outcome" where this phase turned out differently (D4, D6, D7, D8). Move to [backlog.md](../backlog.md) as follow-ups what was left out: an order among supplying areas, "this row serves nobody else" in one click, reserving a byproduct for the area with the rule, and the connected and imported split of the matrix's outside column for unruled items.

Each ticket appends its report here (deviations and additions only), as in [phase 4](phase-4.md#t1-report).

## Running the tickets

For the session that orchestrates. Each ticket is one run of the `backlog-task` skill (`.claude/skills/backlog-task/SKILL.md`) with `noplan`, and one pull request. The tiers below are the ones the skill's own criteria give (small, standard, hard, and the spike shape for T2), so step 1's classification is not redone. Explore is `haiku` at `medium` wherever a plan is written.

The author's subscription limits Opus, so the run uses it three times: T2's investigator, and the plan and the review of T4. T2 is invoked with `spike`. Every ticket except T2 and T4 is invoked with the `sonnet` control word: the tiers already keep them on Sonnet, and the word keeps the skill's risky-diff rule from raising a review to Opus (T5's diff will be large enough to trigger it).

| Ticket | Tier | Plan | Implement | Review (`code-review` level) | Why |
| --- | --- | --- | --- | --- | --- |
| T1 | standard | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | UI only, on helpers that exist; the plan is short |
| T2 | spike, with a hard criterion | none: the main session writes the brief | one agent, `opus`, `high` | `sonnet`, `high` | **Opus 1.** An experiment has no implementation-grade plan, so a separate planner would be paid for twice. The review checks the tests and the report's claims against the code; the judgement on the LP is the author's, who reads the report |
| T3 | standard | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | Wide but mechanical, on phase 4's precedent (`servedCuts.ts`); an optional key, no migration |
| T4 | hard | `Plan`, `opus`, `high` | `sonnet`, `medium` | Opus wrapper (`low`), `high` | **Opus 2 and 3.** The LP change every later ticket stands on; the plan re-derives case 21 A and C and the reviewer re-derives them again |
| T5 | standard: it follows the spike and T4 | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | By then the pair flows were prototyped in T2 and the split shape reviewed in T4; case 21 B and C pin the result. T2's report and T4's plan go into the planner's prompt |
| T6 | standard | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | UI on a settled design (D9, D10) |
| T7 | standard | `Plan`, `sonnet`, `high` | `sonnet`, `medium` | `sonnet`, `high` | UI on a settled design (D6, D12) |
| T8 | small | none: the main session | the main session | none (docs only; `npm run lint:docs`) | No planning needed: the ticket lists the edits |

If Opus is scarcer still, drop in this order: T4's review (to `sonnet`, `high`), then T4's plan. T2 keeps Opus last: a wrong conclusion there misleads four tickets. If there is Opus to spare, add it to T5: its review first (drop the `sonnet` word and the risky-diff rule does it), then its plan.

Rules of the run, as agreed for phases 3 and 4:

- **Order.** T1 and T3 can each start at once, from `main`. T2 runs first among the solver tickets and its report is read by the author before T4 starts: the run **stops after T2**. T4 to T7 then run in the order of [Tickets](#tickets); a ticket whose predecessor is not merged is cut from that predecessor's branch and its pull request targets it. T2's plan and report are passed to the planners of T4 and T5.
- **Never merge.** Push each branch as soon as its implementation commit exists.
- **Accuracy.** A synthetic row is written first and seen failing; an expected value is never edited to match the solver; the rows a ticket adds are re-derived by its planner and by its reviewer. The run halts on a derived value that disagrees with the solver, and on a ticket that fails twice.
- **Decisions.** A product decision a ticket meets and this document does not settle is taken as the planner's recommendation and listed under "Decisions taken" in the pull request.
- **Known noise.** A handful of e2e specs fail on the author's machine when its own dev server and Factorio are running, on `main` too; re-run a failure alone before treating it as a regression, and never kill those processes.

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- "Byproducts first per consumer" (T4; with D8's limit).
- "Connections first vs local-first" (T4).
- "Supplies other areas toggle" (T5 and T7, as a switch on the receiving area).
- "Per-partner area figures elsewhere" (T1).

## Risks

- **The LP shape is untested.** Every value of case 21 that is not *measured* is a derivation. T2 exists to find out before four tickets depend on it.
- **Two models for one LP.** With D11 the area solve has the pooled shape and the split shape side by side. If T2 shows the split shape reproduces today's results, one path for all items is simpler and D11 should be dropped.
- **Degenerate vertices.** Flows per pair give the LP more equal-cost solutions than the pools did. Routes read from the LP need a tie-break as firm as `itemRoutes`' fixed rule, or the figures in the list flicker between solves.
- **D8 will surprise.** A player who sets *Don't make more here* on the area meant to absorb a byproduct sees the other area take it. The sentence has to say what the area got and the help has to name the switch.
- **A rule set far from where it shows.** An area's rule is set in a popover and changes rows; the rule list and the marker (D10) are the only way back to it.
- **Stale ids.** `areasOff` holds area ids, as the served lists do; every command that deletes, un-flags, moves or copies a sub-factory has to keep them right (T3).

## T3 report

- **One cleaner for load and store.** `cleanAreaRules` (`src/data/subPlanTree.ts`) drives both the load pass in `BlockSchema` and the cuts of `setSubPlanArea` and `removeSubPlan` (through `cutAreaRules` in `src/store/areaRuleCuts.ts`), instead of extending `lostAreaIds`. "Valid" is the area set after the change, so the root's rules go when the last area goes. `servedCuts.ts` is untouched.
- **`areaIdsOf`** is the data-layer twin of `blockAreas` (the data folder cannot import the solver); a test checks they agree.
- **Strict parse.** A malformed rule rejects the load, as `servedOrder` does; only the shapes named in the ticket are repaired.
- **`setAreaMakeHere`** to the value the effective rule already has is a no-op, as `setMakeHere`.
- **`duplicateSubPlanTo`** reads "an id with no copy is dropped" literally: a switch naming an area outside the copied sub-factory is dropped from the copy, not kept.
