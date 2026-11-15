# Sourcing priority, phase 4: shares and areas

Phase 4 of [plan.md](plan.md). It follows [phase 3](phase-3.md), which shipped on 2026-11-14.

The questions of the first draft were answered from the code and one throwaway `solveAll` run on 2026-11-14 ([What the code says](#what-the-code-says)). Two answers make the phase smaller than plan.md's "Large": a group's split is arithmetic on figures the solver already has, with no second solve, and an area as a consumer changes what its block is granted and what the list reports, not the area LP. The author confirmed the [decisions](#decisions-for-the-author) the same day; the [tickets](#tickets) are written against them.

## Scope

In: groups in the **Served in this order** list (drop a consumer onto a line to join its group); inside a group, equal shares by default and editable percentages; a consumer that needs less than its share passes the spare to the others in its group; a consumer block with areas expands into its areas, so a source can rank or share between two areas of one block.

Out: a split in proportion to need (left out until someone asks); rules on the consumer's side of an area (phase 5); showing in the consumer's areas matrix which part of an area's input is connected and which is imported (it goes with phase 5's routes, see D4).

The case it must serve, from the author's own factories: iron is short; science gets all it needs; the hub's logistics and building areas share what is left, 50 / 50 or one before the other.

## What the code says

Read on 2026-11-14, after phase 3 shipped. File names are under `src/solver/` unless said otherwise.

### A group's split is arithmetic

Phase 3 hands a ranked source's offer down its list in one function, `grantByRank` (`servedRank.ts`): each entry gets `min(its share, what the ranks above left)`. The share is known before any supply is handed out: a request's amount or a take's credit, both from the request pass. `solveAll` calls it through `grantPair` once per ranked pair when the source is solved, and once per supply round inside a loop of blocks.

A group replaces "one entry" by "several entries that split what is left by weight, the spare of one going to the others". That is a water-fill on the same shares, inside `grantByRank`. Every consumer is still solved once, against one cap per item, so:

- **No second solve, and no new cap.** The risk "more distinct supply caps per block than the solve cache keeps" does not arise: a consumer sees one grant, as today.
- **Loops of blocks come with it.** The grants of a round are computed from that round's offers by the same function; shares are fixed before the supply phase, so a group adds nothing a loop has to converge on.
- **Requests need nothing in the request pass.** The amounts asked do not depend on the list.

**Takes are different.** A take's share is its credit, and credits are handed out by rank inside the request pass (`restOf` in `computeRequests`, `index.ts`): each take is credited `min(what the takes above left, its limit, its need)` when its consumer is processed. In a group, a member's credit depends on the other members' needs, so every member has to be probed before the first one is credited. The pass can do it when each member's goals are final at that point, which needs ordering edges (the blocks that request from one member come before every member); where an edge would close a cycle the need is not known in time. Inside a cycle of requests the same dependency becomes one more value read from the previous demand round, like phase 3's back credits. This is where the remaining solver risk of the phase sits, and it is not on the path of the case above: a product is requested, a spare output is taken, and outside loops a ranked pair never holds both ([T4 report of phase 3](phase-3.md#t4-report)).

### An area as a consumer

Measured with a throwaway `solveAll` run (not kept), on the recipes of synthetic case 13: A makes plate with its row pinned at 45; S requests 30; H has two areas, L (a row pinned at 12 plate / min) and B (pinned at 8), and requests 20. A's list is S, H.

| What | Value |
| --- | --- |
| `c-S` | requested 30, rate 30, `ok` |
| `c-H` | requested 20, rate 15, `limited` |
| H's rows | L 12, B 8: as with full supply |
| H's `unsatisfied` | plate 5 |
| H's `areaRoutes` for plate | outside to L 12, outside to B 8 |

What follows:

- **A short supply never changes a consumer's rows.** What a connection does not deliver is imported (or reported missing with Import off), in a block with areas as in one without. Supply and slack are both "other supply" in the area LP and reach any area, so the LP has no notion of which area the 15 went to, and needs none.
- **So "the area solve must divide what a block receives among its areas" (plan.md) is not an LP change.** What dividing by the source's list can change is (a) how much the block is granted in all, when its areas sit at different ranks or in groups with other consumers, and (b) what the list says each area got. Both are arithmetic: before the solve on each area's need, after it on the connection's rate.
- **An area's need is already computed.** It is the outside leg of the item into that area in `areaRoutes` (`areaRoutes.ts`): what the area takes from outside the block after its own rows and the other areas. The request probe of the consumer has it (same nodes as the supply solve), and every listed consumer is probed since phase 3. An area with its own row for the item needs only what that row does not cover.
- **One known looseness.** When another area of the block also sends the item, which receiving area is paired with that area and which with the outside is the fixed rule of `itemRoutes` (areas with their own row first, then table order), not a choice of the LP. An area's need follows that pairing until phase 5 lets the player choose the supplying area.

### What is stored and drawn today

- `ServedEntrySchema` (`src/data/schema.ts`) is `{ kind: 'block', blockId }` or `{ kind: 'extra' }`, an object "so entries can carry other kinds"; `normalizeServedOrder` drops repeats on load. `src/data/servedEntries.ts` has the pure edits, keyed by `sameServedEntry` (kind and block id).
- The store has `moveServed` and `resetServedOrder`, and removes a consumer's entry with its last connection for the item, writing into the source block from the consumer's command (`applyOthers` / `undoOthers`). `clonePlan` remaps block ids in the lists (`remapServedOrder`); `cloneBlock` drops the list. Sub-plan ids are renewed by a clone (`cloneSubPlanTree`), so an area entry has to be remapped too.
- `ServedOrderPopover.tsx` draws one line per consumer block, with HTML5 drag onto a line (which today means "before this line"), **Move up** / **Move down**, the divider and **Add to list**; `servedOrder.ts` builds the lines from `MultiBlockSolve.served`, one `ServedConsumer` per consumer block. The graph chip shows `#N` from the same helpers.
- `scripts/inspect-plan.mjs` does not print the served lists.

### Cache keys

The block solve cache keys on the plan and the caps; a group or an area entry changes only the caps, as a list does today. The request-loop memo already holds, for the ranked pairs its members take from, the list's entries: it gains the group flags, the weights and the area ids of those entries when takes are shared (T4). An area's need is read from a probe the key already determines.

## Decisions for the author

Proposed and confirmed with the author on 2026-11-14.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D1 | What does the stored list hold? | The list stays flat. A block entry gains three optional keys: `areaId` (one area of the consumer), `tied: true` (this line shares the rank of the line above it) and `share` (a positive weight, read as a percentage of its group). The extra entry gains `tied` and `share`. A list without them is a phase 3 list: one consumer per rank. | Every existing helper, command and stored plan keeps working, and "a list without them loads as one consumer per rank" needs no migration. A nested list of groups would change the stored shape for a grouping that is one flag. The group shape is positional: a `tied` on the first line of a list is dropped on load. |
| D2 | What happens to the shares when a member leaves or joins a group? | Weights are kept and renormalised: 60 / 30 / 10 becomes 67 / 33 when the 10 leaves. A member that joins gets an equal part (one n-th), the others keep their ratios. A group nobody edited stores no weight and is equal. In the solver a member with no weight in a group that has some counts as the mean of the stored ones. | Leaving must not need a second edit to make the list valid again, and the ratio is what the player set. Editing one percentage rescales the others so the group reads 100. |
| D3 | What is an area's need? | The outside leg of the item into the area in the consumer's request probe (`areaRoutes`): what it takes from outside the block after its own rows and the other areas. The block's share (its request, already less its take credits and clamped to the connection's limit, or its take's credit) is divided among its area entries in proportion to those needs. | It is the figure the areas matrix already shows as coming from outside, so the list and the matrix agree. In proportion, because a limit or a credit belongs to the connection, not to an area. |
| D4 | What does ranking an area change? | The block's total grant, and the list's figures per area (asked, got, short). Not the block's rows, and not its areas matrix: the consumer still shows one import for the item. | See [An area as a consumer](#an-area-as-a-consumer). Splitting the matrix's outside column into "connected" and "imported" per area is the routes work of [phase 5](phase-5.md), which reads the same figures. |
| D5 | When does a consumer block show as areas? | Always, when two or more of its areas need the item from outside; otherwise it stays one line. A stored block entry with no `areaId` stands for every area of the block that no area entry names, in table order, so a phase 3 list reads and solves as before. The first drag writes the list from the lines shown, as today, so it writes area entries. | plan.md: "a consumer block with areas expands into its areas". No extra gesture to learn, and nothing moves: an unsplit block hands what it got to its areas in table order, which is what consecutive area lines do. An area entry whose area no longer needs the item is skipped like any stale entry, and removed when the sub-factory is deleted or stops being an area (undo restores it). |
| D6 | May the extra output be in a group? | Yes. | The grant treats it as one more entry with a need of `extraRate`; forbidding it would be the special case. |
| D7 | How is a group of takes served where the pass cannot know every member's need first? | In list order inside the group, and the lines say so (the `notCredited` badge of phase 3, with its own text). That covers a member whose need closes a cycle in the request pass, and, in this phase, every group of takes whose source feeds members of a cycle of requests. | The second is a choice of scope: sharing inside the demand rounds is a new value for the rounds to settle on, for a case nobody has asked for. It can follow as a backlog item if it comes up. |
| D8 | What is the gesture? | Drag: dropping on the middle of a line joins its group, dropping on the edge between two lines gives the line its own rank there. Keyboard and touch: a toggle on each line, **Share with the line above**. **Move up** / **Move down** swap two neighbouring lines and leave the group shape where it is. The percentage is a number field on each line of a group; editing one rescales the others. | One gesture, as plan.md says, with an equivalent that needs no drag. Keeping the shape on a move means a move never silently dissolves a group. |

The list of D1, D5 and D8, on a short source:

```
Iron plate: served in this order
1  Science                    asked 30    got 30
2  Hub / Logistics   [50] %   asked 12    got 7.5   short 4.5
   Hub / Building    [50] %   asked  8    got 7.5   short 0.5
3  Extra output               10          got 0     short 10
```

## The split

One rule for every list, with or without groups or areas. It replaces the loop of `grantByRank`.

1. **Entries.** A consumer block with area entries counts as one entry per area entry, plus one for its block entry (or, when the list has none, for its place among the consumers the list does not name) that stands for the areas no entry names. An entry's *share* is the block's share times that entry's part of the block's need (D3); a block without area entries has one entry with the whole share. The extra's share is `extraRate`.
2. **Groups.** A group is a line and the `tied` lines under it. Groups are served top to bottom, each from what the groups above left.
3. **Inside a group.** With `R` left and weights `w` (equal when none is stored): each member still short is offered `R × w / Σw` over the members still short and takes `min(what it still lacks, that)`; repeat with what was not taken until nothing is left or no member is short. A group of one is `min(share, R)`: phase 3's rule.
4. **A connection's grant** is the sum over its block's entries. `pending` is set to the sum of all grants and the extra's hold, as today.
5. **The report.** After the consumer is solved, the connection's rate is handed to its entries in list order, each up to its grant, then what is left in the same order up to each entry's share. `served` has one consumer line per entry, with the area id where the entry is an area.

For takes, step 3 also runs in the request pass, on needs instead of shares, to produce the credits (T4).

## Synthetic cases

Both use the recipes of case 13 (1 ore makes 1 plate; 1 plate makes 1 gear). Values derived by hand on 2026-11-14 with the rule above; the ticket that adds a case re-derives them in its plan, writes the test first and sees it fail, and never edits an expected value to match the solver.

### Case 18: shares on a short product (T2)

A makes plate, its row pinned at 45, extra output 10. B, C and D make 30, 20 and 10 gears and request the plate. Braces are a group, equal unless a percentage is given. Every row is checked in two tab orders.

| Row | A's list for plate | B | C | D | Extra holds |
| --- | --- | --- | --- | --- | --- |
| a | B, {C, D} | 30 | 7.5 | 7.5 | 0 |
| b | B, {C 80, D 20} | 30 | 12 | 3 | 0 |
| c | {B, D}, C | 30 | 5 | 10 | 0 |
| d | {B, C, D} | 17.5 | 17.5 | 10 | 0 |
| e | B, {C, extra} | 30 | 7.5 | 0 | 7.5 |

- a: 15 left after B; 7.5 each, and neither is covered.
- c: 22.5 each; D takes 10 and passes 12.5; B then lacks 7.5 and takes it; 5 is left for C.
- d: 15 each; D takes 10 and passes 5; B and C get 2.5 more each.
- e: D is not in the list, so it comes after it and gets nothing; the extra holds its 7.5.

Each consumer imports what it lacks (B 30 − got, and so on) and its flow is `limited` when it lacks something, `ok` otherwise. A's row stays at 45.

### Case 19: areas of a consumer (T3)

The plan of [An area as a consumer](#an-area-as-a-consumer): A's row pinned at 45 and no extra, except row f; S requests 30; H requests 20, of which area L needs 12 and area B needs 8 (L above B in the table).

| Row | A's list for plate | `c-S` | `c-H` | L got | B got |
| --- | --- | --- | --- | --- | --- |
| a | none (tabs A, S, H) | 30 | 15 | 12 | 3 |
| b | S, H | 30 | 15 | 12 | 3 |
| c | S, H/B, H/L | 30 | 15 | 7 | 8 |
| d | S, {H/L, H/B} | 30 | 15 | 7.5 | 7.5 |
| e | H/L, S, H/B | 30 | 15 | 12 | 3 |
| f | {S, H/L}, H/B with A pinned at 36 | 24 | 12 | 12 | 0 |
| g | H/B, S, H | 30 | 15 | 7 | 8 |
| h | H/L, H/B, S | 25 | 20 | 12 | 8 |

- f: 18 each; L takes 12 and passes 6 to S, which gets 24; nothing is left for B.
- g: the entry H stands for the area no entry names, L.
- h against e: moving one area changes what the two blocks get, which a block entry alone could not say.

In every row H's rows run at 12 and 8, and H imports 20 less `c-H`.

## Tickets

In order. T5 touches only the popover and can run beside T3 and T4 once T2 is merged; the others are sequential, since T2 to T4 change the same solver files.

- [x] **T1. The stored entry and its commands.** D1 and D2 in `src/data/schema.ts` (`areaId`, `tied`, `share`; load-time normalisation: a `tied` first line, a weight that is not positive, repeats, where a repeat is the same block and the same `areaId`) and `src/data/servedEntries.ts` (`sameServedEntry` and the line key gain the area; remap of area ids). Store: a command to set or clear `tied`, a command to set a group's weights, `moveServed` keeps the group shape (D8) and the weights of a line that leaves a group are dropped; an area entry is removed when its sub-factory is deleted or `setSubPlanArea` turns the flag off, from the consumer's command into the source block, undo restoring it; `clonePlan` remaps area ids. The solver and the popover ignore the new keys: an area entry is read as stale until T3, so nothing moves. `spec/data-model.md`; `npm run contract` if the snapshot schema changes.
- [x] **T2. Solver: groups.** Steps 2 and 3 of [The split](#the-split) in `grantByRank`, for every ranked pair, in and out of loops of blocks. A group that holds a take is served in list order until T4, as phase 3's T4 did with loops. Synthetic case 18 first, plus: a list with no `tied` solves bit-identically to phase 3 (cases 14 to 17 unchanged), and case 16's loop with its two takes replaced by requests in one group. `served` needs no new field for groups (the popover reads the stored list for the shape). `scripts/inspect-plan.mjs` prints each source item's served list (rank, group, share, got), so the author can check a real plan. `spec/solver.md` (Served order, Shortfall), `spec/test-synthetic.md`.
- [x] **T3. Solver: areas as consumers.** Steps 1, 4 and 5 of the split. The probe hands back the outside legs per area (`Probe` in `index.ts`, the cycle memo included); `rankedPairs` keeps area entries that name an area of a consumer with a counting connection; `ServedConsumer` gains `areaId` and `served` has one line per entry, also for a pair with no list when two or more areas of the consumer need the item (D5). Synthetic case 19 first; a consumer whose areas trade the item among themselves, to pin the looseness of D3; a take into a block with areas, ranked per area. `legacyParity.test.ts` and `contract/` must not move except for the new report lines. `spec/solver.md`, `spec/test-synthetic.md`.
- [x] **T4. Solver: groups of takes.** The water-fill of step 3 in the request pass: the members of a group are probed before the first is credited (ordering edges, never one that closes a cycle), credits come from the split on their needs, and the memo key of a cycle of requests gains the group flags, weights and area ids. D7's fallback and its flag where a need is not known in time and for a source that feeds a cycle of requests. Synthetic case 20, written by this ticket's plan on case 14's fixture (two takes of one byproduct in a group, one of which needs less than its half; a takes-first member that asks its other source for the rest; the fallback). Report in this file what the fallback leaves out, for the backlog.
- [ ] **T5. The list: groups and percentages.** D8 in `ServedOrderPopover.tsx` and `servedOrder.ts`: the drop zones (middle against edge) and their drop marks, the **Share with the line above** toggle, one rank number per group with the member lines bracketed, the percentage field on the lines of a group (equal shown, not stored, until one is edited), the status line for screen readers, and the fallback badge of D7 (text only until T4 sets the flag). The graph chip of a grouped consumer shows its group's rank. e2e on the plan of case 18: join by drop and by toggle, edit a percentage and see the figures follow, leave a group, undo. `spec/ui.md`, README "Using the planner".
- [ ] **T6. The list: areas.** A consumer block with two or more areas that need the item is drawn as area lines, "Hub / Logistics" (D5), ranked, grouped and counted under the divider like any line; the first drag writes area entries. The graph chip of such a block shows the best rank among its entries and lists each in its title. e2e on the plan of case 19, the mock of [Decisions](#decisions-for-the-author): science first, the two areas sharing 50 / 50, then one before the other. `spec/ui.md`, README.
- [ ] **T7. Docs and close.** What T1 to T6 left out of `spec/`; tick "Choose who is served first in a loop" in [plan.md](plan.md#items-taken-from-the-backlog) and correct plan.md's phase table and "Sharing" section where this phase turned out differently; move what the T4 fallback leaves out to [backlog.md](../backlog.md) as a follow-up.

Each ticket appends its report here (deviations and additions only), as in [phase 3](phase-3.md#t2-report).

## Items it closes

From [Items taken from the backlog](plan.md#items-taken-from-the-backlog).

- The rest of "Choose who is served first in a loop".

## Risks

- ~~More LP calls per solve, and more distinct supply caps per block than the solve cache keeps.~~ Settled by the reading above: a consumer is solved once against one grant. T4 adds at most a probe that the cache then reuses.
- ~~Shares that depend on every member's need are one more thing a loop has to converge on.~~ True only for takes shared inside a cycle of requests, which D7 leaves out.
- The split of a block's share among its areas rests on `areaRoutes`, whose pairing is a fixed rule where areas trade the item (D3). The figures per area are then right in total and arbitrary in detail until phase 5.
- Nothing was run on the author's hub plan: the measurement is one synthetic plan. T2 gives `inspect-plan.mjs` the output to check it with before T3 builds on it.
- Three ways to change one list (drag zones, toggle, move) have to agree; T1 fixes the shape rules in pure functions with tests before T5 draws them.

## T1 report

Deviations and additions only.

- Canonical form has a fourth rule beyond the doc: a `share` on a line alone in its group is dropped on load (it is meaningless, and every command already drops it).
- `servedCleanup` now removes every entry of the consumer from the source's list, area entries included; it is identical to before for lists without area keys. It is built on the new `src/store/servedCuts.ts` (`cutServedEntries`, `restoreServedCuts`, `lostAreaIds`), which `removeSubPlan` and `setSubPlanArea` share.
- Undo is exact for moves, cleanups and the two new commands: the command records the list it overwrote and puts it back while the list is still as the command wrote it (restoring dropped shares and flags); the old anchor path stays as the fallback.
- `lostAreaIds` includes the root's id when the last area flag goes (`blockAreas` then returns nothing).
- `remapServedOrder` takes a required third parameter, the area id map; `clonePlan` builds it from every copied block's sub-plans.
- `rankedPairs` skips entries with an `areaId` (the only solver edit); a consumer named only by an area entry stays unlisted.
- Commands are `setServedTied` and `setServedShare`; untying a middle member splits the group at that member (T5 words its toggle accordingly).
- Residuals: the undo of "area on" leaves a stale area entry (the solver ignores it); an edge drop in T5 needs a move plus a tied untie as one undo step.

## T2 report

Deviations and additions only.

- `weight` is set on a `RankedEntry` only when some member of a group of two or more stores a `share`; equal groups use exact `R/n` arithmetic.
- `grantByRank` takes a fifth parameter `isTake`, read from the request info (`!('requested' in info)`): an ignored request (`source-receives`, `request-loop`) counts as a take (a `duplicate` connection never reaches `grantByRank`: only a consumer's first connection for the pair is ranked). A group that holds a take is wholly in list order, its requests included, until T4.
- Row c of case 18 and e2 of the case 16 variant passed before the change (the sequential order gives the same numbers), as did the take-group pin. U3 and U8 also passed before the change (the sequential and water-fill totals coincide for those shares), so they pin the numbers but did not fail first.
- The one edit to an existing test is the title of `'does not read tied or share'` in `servedRank.test.ts` (now "keeps the entries and their order whatever tied and share say"); its assertions are unchanged.
- The case 16 variant needs S pinned at 30 (and a product X on S): without a pin S is never short. `c-S1` is 20 and `c-S2` is 10, derived from case 16's fixture (C1 and C2 make 20 and 25 Y for their goals whatever X they get).
- Known looseness: `restOf` subtracts a listed extra as `min(extraRate, rest)` sequentially, so a take ranked below a group containing the extra, possible only in a loop, is credited on the sequential figure (T4's ground).
- `inspect.ts` gains `servedReportOf` and `ServedItemReport` / `ServedLineReport` (`InspectReport.served`); `formatReport` prints a "Served lists" section and `--json` carries it.
- Review fixes: `inspect.ts`'s `servedReportOf` marks a group that holds a take with `group.listOrder` (no percent; printed `in list order`) and builds the ranked pairs once. A synthetic test (case 18 j) covers the take rule at `solveAll` level; case 18 g's list is now `B, {ghost, C, D}`. `validShare` is exported from `servedEntries.ts` and shared by `grantByRank`.
- Follow-up for the author: a member with no `share` reads as the mean of the stored ones, so dropping a stale member of a mixed group (here and in the store's `servedCleanup`) changes the ratios of the rest (`{B 80, C 20, D}`: C:D is 20:50, 50:50 once B goes). It follows from D2 as written; documented in spec/solver.md, behaviour unchanged.

## T3 report

Deviations and additions only.

- A stale area entry is kept as a zero entry (`areas: []`, `part: 0`), not removed: an area that no longer needs the item, and a block entry whose areas are all named by area entries, stay in the order and are inert in every group. An area entry of a consumer whose total need is 0 is a zero entry too; its block entry is left untouched.
- A block entry covering several areas expands into consecutive area lines in table order (rows a and b of case 19 force it); one covering exactly one area is labelled with it (row g). A consumer shows as areas when two or more of its areas need the item, or when an area entry of the list applies.
- `RequestLoopSolve.areaNeeds` is optional so the hand-built outcome in `solveCache.test.ts` still compiles; the memo key is unchanged.
- Corrected after review: this report first said the unlisted consumers of a ranked pair that have areas were probed in the request pass (`areaProbe`, "tested in j3"). That was wrong twice. j3 has no list, so no ranked pair, and removing the probe's skip condition kept every test green. And the probe is not needed: a consumer the list does not name and that requests nothing of the item has no credit, so its share and grant are 0; only the split of what it got between its areas remains, and that is the report's. `areaProbe` is removed (one cached LP less per such consumer, none in `inspect-plan`); the report splits the unlisted entries of a ranked pair with the final solve's needs, as it does a consumer of an unranked pair. Tested by case 19 j3 ("a list naming only J"): hand-derived L 5, B 0.
- Known limitation, pinned by the test named "limitation" (case 19 j2): a take's credit is computed once per connection at its block's first entry, so a take listed between two entries of its block is credited as if the whole block sat at the first one (J gets 10 where a rank-faithful solve gives 22). T4 fixes it.
- Known limitation (new, review finding 7), pinned by case 19 j4: when a consumer's first entry is for an area that needs nothing, the whole consumer's credit sits at that position, so a take ranked below it loses credit (T leaves 10, list C/A, J, C with C needing 10 in area B only: J gets 0 where a rank-faithful solve gives 10). The order of the request pass is built before the needs are known, so there is no clean fix in T3; T4 follow-up.
- Review findings, other: area ranking inside one consumer is by need (D3; spec/solver.md says it, case 19 j1 pins it). The dedupe guards for a consumer with several entries are now tested (j5, j6: `counted` in `restOf`, the `areaNamed` skips in the registration and in the unlisted loop of `restOf`); `seenConn` in `listedTakes` and the `areaNamed` filter of `unlistedTakes` were dead (`orderEdge` never links a block to itself and skips an edge a path already covers), so they are removed. Sub-case k now gives T a list (K1/A2, K1/A1, K2), so the report and the grants read the cycle memo's needs: A2 5.625, A1 9.375 (15 left, K1 needs 16, shares 6/16 and 10/16); making the `areaNeeds` commit a no-op fails it. A zero area entry's test (case 19, "needs nothing") now names an area that has no need (the older test, with an entry for L, covered the only-needy-area case). `handOut` gives a leftover to the last index with a positive target, not to a trailing zero entry (the lines added up to less than the rate). `inspect.ts` reuses `areaName` of `subPlanTree.ts` ("Top level" for the root).
- UI caveat (review finding 9): `blockLines` puts a block's merged line at its first area line. For a list with area entries (only reachable from edited or imported plans until T6; the UI cannot write them) that can move the block's line relative to before T3, e.g. a stored `[H/L, S]` with an unlisted U earlier in flow order draws H before U in the unranked section. "No UI behaviour change" holds for every list without area entries. Documented in spec/ui.md.

- UI guard: `blockLines` in `servedOrder.ts` merges a block's area lines back into one consumer for `hasServedOrder`, `servedLines`, `unrankedCount` and the popover's line count, so the popover, the chip and the drags behave as before T3 (stored area entries stay unmatched there). T6 draws the areas.
- `inspect.ts` (`servedReportOf`) keys groups by block and area and names an area line "Block / Area".
- Case 19's rows a to h, the sub-cases i and j (hand-derived in the plan) and an invariants-only sub-case k (case 17's cycle with K1 in two areas) passed on the first run of the implementation; `legacyParity` and `contract/` did not move.

## T4 report

Deviations and additions only.

- **The crediting point and the lookahead.** `computeRequests` builds a `TakeGroup` for every `tied` span of a ranked pair that holds a take (a connection is a member when its first entry is in the span; a block with areas is one member, its weight the sum of its entries' weights; the extra is a member asking `extraRate`). The first member the pass reaches credits the whole group (`creditGroups`, before that member's `applyTakeCredits`): the other members are probed ahead (`aheadProbe`, through the solve cache; the member's own turn reuses the probe when `exactKey(goals)` still matches) and `waterFill` (now exported from `servedRank.ts`, the one implementation) splits the source's rest on `min(need, maxRate)`. The credits are clamped to the demand, so `applyTakeCredits`'s `cover` equals the stored credit; `restAt` (the old `restOf` loop, line for line, plus a branch for a shared group) subtracts what a group holds once. `servedGroupSpans` is the one group walk (`grantByRank`, `computeRequests`, `inspect.ts`).
- **Readiness edges** (`requester -> every other member`) are added with `orderEdge` after all the rank edges (review finding: added before them, a readiness edge could refuse another list's rank edge and change who a take of that list is credited), so a refused edge (it would close a cycle, or conflicts with a rank edge) simply leaves the requester unprocessed and the group falls back (case 20 g).
- **The fallback triggers**, F2 and F3 being additions to D7's wording: F1 a consumer of the pair (listed or not) is in a cycle of requests (read per pair); F3 when the first member is reached a member's requester is not processed, or the source, a take above or a group above is not credited; F2 a member's group take is not its first take of the item (its need would depend on the credits of its other sources, case 20 i); F4 (review) a member's connection has an entry below the group, in another group or alone, since its demand is the connection's whole need and the group would credit it for the areas ranked below it (case 20 h). A fallback group is credited member by member in list order (phase 3's rule, `notCredited` where blocked), granted in list order, and its takes carry the new `ServedConsumer.groupInListOrder`.
- **`grantByRank`'s fifth parameter** is renamed `inListOrder`, and `grantPair` passes `RequestPlan.inListOrder`: it used to be "this connection is a take (or an ignored request)". Effects: a group of takes the pass shared by need is water-filled at grant time too (a take's share is its credit, which reproduces the credits); a group with an ignored request (`source-receives`) is shared by need (case 18 j); and a `request-loop` request in a group of requests no longer forces list order (its share is 0, the others share by weight). No test pinned the last one. A group with one take and some requests also became a group of takes.
- **The cycle memo key** gains `tied`, `weight` and `areaId` on the listed entries and `areaNamed` on the unlisted ones.
- **Pins changed on purpose**, the only existing assertions edited: case 18 i (now H2 15 `limited`, 10 imported; H1 15 `limited`, 5 imported; was 25 / 5) and j (now B 15, the extra got 10; was B 25, the extra 0), and the `inspect.test.ts` test that inferred `listOrder` from takes (the hand-built consumers now carry `groupInListOrder`). `served.test.ts`'s existing `takeInfo` literals are unchanged: `inListOrder` is optional there.
- **Badge text proposed for T5** (T4 does not touch the popover or `servedOrder.ts`): label "list order", title "The planner could not learn every member's need before sharing, so this group is served one line after the other, in list order, not by its percentages." T5 should keep the flag when `blockLines` merges area lines.
- **j2 and j4 are NOT fixed** (this corrects the T3 report, which said T4 fixes them): fixing them needs per-entry crediting with lookahead for lists without `tied`, which breaks T3's bit-identity. They stay documented limitations.
- **Rows that passed before the change:** a1 and a3 (list order gives the same numbers), d, f and M3. The flows of c1, c1b, c2 and c3 passed before too (phase 3 served every group of takes in list order); their flag assertions failed. Everything else failed first. c2, c3 and e were derived from the case 17 and case 16 fixtures and held as written in the plan.
- **What the fallback leaves out** (for T7 to move to the backlog): (a) a group of takes on a pair any of whose consumers is in a cycle of requests, even when no member of the group is (a narrower "member in the cycle" rule would be safe with this design; sharing inside the demand rounds is the D7 cut); (b) a group with a member whose requester is reached after the first member (a member that requests from another member, or a requester reached through a member); (c) a group reached before its source, or before a take or a group above it (phase 3's limitation forms applied to a group, with `notCredited` on the blocked member); (d) a member that takes the item from another source earlier in its connection order; (e) a block with area entries in more than one group (or in a group and alone). Carried over, not part of the fallback: j2 and j4, and an area member's credit being split by need rather than by its lines' weights.
- **Review fixes (second commit).** The defensive `toListOrder` in `restOf` is gone (it mutated state from inside a cycle's rounds, which a memo hit skips; the branch is unreachable because `creditGroups` settles every group of a block first and a group a cycle reads is in list order from the start, and `restAt` already reads a pending group as blocked without changing state). `aheadProbe` reuses a kept probe when the goals match, so a block in several groups is solved once even without a cache (case 20 k counts the solves through a cache that never hits). The one test not added: that reuse across several groups of one block (it needs a block in groups on two pairs).
