# Fluid temperatures as first-class items

Status: Shipped

To the solver a fluid is one item, whatever temperature it is made at. Temperature enters only as extra LP rows inside a block, and as a warning after the solve. Everywhere else (the block boundary, offers, connections, area routes, surplus, the summary) it is lost. This initiative makes the temperature part of what flows. The design is chosen (decisions below) and split into tickets (*Phases*); this doc is meant to be executed as written.

## The problem, from the player's side

- **A fluid nothing takes disappears.** Steam from a boiler pinned too cold, or a co-product at a temperature no row accepts, nets against the import that replaces it. It is not shown as a byproduct, not offered to other blocks, and only appears as `unused` on the `temperature-mismatch` warning.
- **A connection carries "steam", not "500°C steam".** The consumer block cannot plan on the temperature it receives; only the warning checks it after the solve, and a source block that passes the fluid on makes it unknown.
- **Area routes ignore it.** The temperature rows are block-wide, so the routes between areas can show a too-cold fluid going to the row that refused it.
- **Locked fluids are only checked when the block can fit them.** A goal or Import-off fluid gets temperature rows without slack when every consumer class has a producer at an accepted temperature, and none otherwise (see *Related items* below for the local fix, shipped in PR #361).
- **A recipe that takes a fluid and returns it nets to zero.** The balance row holds the net coefficient, so a recipe taking 100 steam at 465°C or more and returning 100 at 165°C needs no steam at all.

## What the solver does today

Described in [spec/solver.md](../../../spec/solver.md#fluid-temperatures); the facts that matter here:

- One balance row per fluid. `FluidTemperatureCollector` (`src/solver/temperatureRows.ts`, removed by T1) records, while the stoichiometry is built, each producer's temperature (the product's `temperature`, else the fluid's `defaultTemperature`, else unknown; heat is always unknown) and each bounded consumer. `temperatureRows` turns that into Hall's condition rows, one per distinct union of consumer classes (at most 4096).
- `buildLPModel` ([src/solver/solve.ts](../../../src/solver/solve.ts)) puts the import slack and the supply variable in every temperature row with coefficient 1. **Anything from outside the block is assumed to fit any bound.** The rows rest on that assumption, and it is the assumption that breaks at the boundary.
- A fluid with neither slack nor supply (a goal, Import off, a byproduct consumer's ingredient, an area item locked in every area) gets its rows without slack when every consumer class has a producer at an accepted temperature (`analyseTemperatures`), else none; if the model with them is infeasible `solveLP` solves the one without them ([src/solver/areas.ts](../../../src/solver/areas.ts) does the same). So a locked fluid runs and warns rather than fails: the LP may run a producer that does not fit, and `temperature-mismatch` reports it. This is the policy PR #361 shipped, as a local fix that could not make a feasible block infeasible. Its limits: the choice is all or nothing per fluid (one consumer class without a fitting producer leaves every class of the fluid without rows), and a connection order whose step is infeasible only because of the slack-less rows stops, so today's result stands.
- Classification, surplus, offers, `overconstrained`, connections, served lists, area routes and the snapshot all use the plain item. The UI's summary nets the solved rows per item (`netBalance` in [src/solver/index.ts](../../../src/solver/index.ts), used by `FactorySummary.tsx`).
- `temperature-mismatch` ([src/solver/temperature.ts](../../../src/solver/temperature.ts)) reconstructs the temperatures after the solve from the block's rows and from the rows of connected source blocks. For heat it compares a reactor's heat buffer maximum (an upper bound) with an exchanger's minimum.

**Measured on the bundled data (2026-11-21).** Nullius: no recipe bounds a fluid temperature. Seablock: 8 fluids have a bounded consumer: `steam` (9 temperatures made: 15, 125, 150, 165, 175, 315, 465, 615, 765; 6 distinct ranges; 19 unbounded consumers), `power:heat` (made with unknown temperature in the LP; 4 ranges), `angels-liquid-coolant-used` (4 temperatures, 4 ranges), `angels-gas-enriched-hydrogen-sulfide` (1 temperature, 1 range), and the four heavy and semiheavy waters (2 temperatures, 2 ranges each). `diesel-fuel` is made at two temperatures but no recipe bounds it.

## Items this initiative covers

Moved from the backlog on 2026-11-21.

- [ ] **Fluid temperatures stop at the block boundary.** The LP keeps a bounded fluid's temperatures apart inside a block (spec/solver.md, "Fluid temperatures"), but a fluid is still one item in the merged balance, in offers and over connections. A fluid made at a temperature nothing in the block takes (a pinned cold boiler, a co-product) nets against the import that replaces it: it is not shown as a byproduct, not offered to other blocks, and only appears as `unused` on the `temperature-mismatch` warning. A connection carries the plain fluid, so the consumer block cannot know which temperature it gets and only the post-solve warning checks it. The same holds between areas of a block: the temperature rows are block-wide and area routes carry the plain fluid, so the routes can show a too-cold fluid going to the row that refused it. Fix: carry a temperature with fluid flows (items keyed by fluid and temperature through the LP, area routes, offers, connections and the summary tiles).
- [ ] **Temperature rows past 4096 unions are only a necessary condition.** A fluid whose bounded consumers form more than 4096 distinct unions of accepted temperatures (13 or more single-temperature classes) gets one row per class only, so the LP can again meet the balance with temperatures nobody takes; the warning still runs. No bundled data set comes near it. Closed by decision 4: the Hall rows go, and conversion columns are exact for any number of ranges.

## Related items left in the backlog

- **Goal and no-import fluids get no temperature rows.** Shipped in PR #361 (case 24 in spec/test-synthetic.md): a local fix in `buildLPModel`, done ahead of this initiative because it is small and a real plan needs it. Its run-and-warn policy is described under *What the solver does today*; decision 1 below replaces it.
- **Reactor heat temperature is not in the LP.** It needs a model of the reactor's working temperature first. Until then heat is made at an unknown temperature (a wildcard, decision 4), and the heat part of `temperature-mismatch` stays (decision 8). Once that exists, a reactor's heat gets a temperature key like any other producer.
- **Nullius bundle: *Temperatures*.** Data, not solver: until the patch runs, Nullius has no temperatures to carry, and no Nullius plan changes.

## Decisions

1. **A (fluid, temperature) behaves like any item.** A locked fluid that nothing in the block can make at a temperature its consumers accept is the ordinary "locked item the network cannot produce" infeasibility: the elastic goals turn it into a goal shortfall, as they do for an item with Import off and no recipe. Today's run-and-warn policy goes, and with it the fallback to the model without the slack-less rows and the part of `temperature-mismatch` that reports it. (Decided on 2026-11-21, replacing the policy PR #361 shipped as a stopgap.)

   Requirement that comes with it: the shortfall names what is missing, with its temperature ("steam at 500°C or more"), not just the goal that falls short. Without that, a player sees an unexplained failure where today they see a warning. Decision 8 defines how (`no-fitting-temperature`). Unknown temperatures (heat, Nullius until its temperature data lands) stay wildcards and never fail.

2. **An import carries the range its consumers accept, not a temperature.** A producer makes a fluid at one temperature; a consumer accepts a range; an import is demand the block cannot meet itself, so it is shaped like a consumer. There is one import variable per distinct accepted range (min, max) of the fluid, and it can feed only consumers whose range contains it; consumers with no bounds and goals import "any temperature". The block reports "imports 60/min steam, 500°C or more", and in phase 2 a connection fits an import when the offer's temperature lies in the range. (Decided on 2026-11-21.)

   - Imports keep `BIG_M` and stay the last resort. A producer at a temperature outside the range cannot stand in for the import, and a locked fluid has no import, which gives decision 1's shortfall.
   - Imports are keyed by range, not by today's consumer classes. A class groups consumers by the *made* temperatures they accept: consumers accepting ≥400°C and ≥500°C form one class in a block that makes only 165°C and 500°C. A shared import would need the intersection (≥500°C) and would wrongly refuse a 450°C offer.
   - No plan-state change: the ranges come from the recipes.
   - A fluid can have several imports at once (one producer feeding two ranges, short on both). The LP picks the split, and the results show each import with its range.
   - Rejected: the fluid's `defaultTemperature` (165°C for steam, wrong for the turbine case that matters most), a player-chosen temperature (a new plan field and a migration, to ask what the recipes already say), and keeping today's wildcard (it tells the player nothing and leaves nothing to match an offer against).
   - The UI must show a range ("≥500°C", "≤50°C", "any"), not a single temperature; see decision 9.

3. **The plan state does not change.** Every persisted field stays keyed by item, and no `AppState` migration is needed. A temperature comes from a producer's output and a range from a consumer's bounds, and the solver splits by them. (Decided on 2026-11-21.) Field by field:

   - `sourceRules[item]` and area `sourceRules` (Import off, `makeHere`, `areasOff`): apply to every temperature and range of the fluid. Import off on steam means no import of any range.
   - `byproductPolicy[item]`, `primaryProduct`, `pinnedRate`: a row makes a fluid at one temperature, so the item alone is unambiguous.
   - `products[].extraRate`: the extra output of a fluid is a goal that accepts any temperature, so the LP makes the one that costs the fewest runs. There is no temperature on a goal in this initiative. A player who needs a temperature puts the consumer row in the block or connects the consumer block, and both give the demand its range. If a plan ever needs it, an optional range on `ProductSchema` (absent = any) is additive and needs no migration either.
   - `inputConnections` (`itemId`, `fromBlockId`, `maxRate`): a connection stays per item; decision 6 says how it carries several keys.
   - `servedOrder[item]`: one list per item ranks the consumers for every temperature of it. **Fit before rank:** a consumer is a candidate for the source's fluid at `T` only if `T` lies in one of its import ranges, and the list only orders the candidates. A first-ranked consumer that accepts any temperature must not take the 500°C steam that a lower-ranked turbine block needs when the 165°C steam would do for it. Decision 6 defines the grant that achieves it.

4. **Mechanism: flow keys and conversion columns.** A temperature-bounded fluid is split into *flow keys*, which the LP, the block results, area routes and connections treat as ordinary items; a fitting temperature reaches a range through a *conversion column*. This replaces the Hall rows (and the "flow variables" and "temperatures through the boundary" directions of the first draft: a conversion column is the flow variable `y_{T,c}`, and once the keys are items the boundary carries them with almost no new mechanism). (Decided on 2026-11-21.)

   - **Split fluids.** A fluid is split when some recipe of the game data has an ingredient of it with a real bound (`minimumTemperature` / `maximumTemperature` within ±1e30, the rule `temperature.ts` uses). The set is computed once per `GameData` object (a `WeakMap`, as the warning's "no recipe bounds a temperature" check is). It is the same in every block, so two blocks always agree on a fluid's keys. Any other fluid stays one plain item: for Nullius nothing changes at all.
   - **Keys.** `<item>@<T>` (made at `T`), `<item>@?` (made at an unknown temperature), `<item>[<min>,<max>]` (taken by a consumer accepting that range; an empty side is open, `<item>[,]` is any temperature). The helpers live in a new `src/data/flowKey.ts`: `flowKey(itemId, tag)`, `parseFlowKey(key) → { itemId, tag? }`, `fitsRange(tag, range)` and `fmtFluidTag(tag)`. A plain item's key is its id. No game item id contains `@`, `[` or `]` (checked on the bundled data); `GameDataSchema` gains a refine that rejects one, so a future export fails loudly instead of parsing wrongly.
   - **Producers** make the temperature key: the product's `temperature`, else the fluid's `defaultTemperature`, else `@?`. Heat is always `@?` (until the reactor item lands). **Consumers** take the range key of their ingredient's bounds; an ingredient with no bound takes `[,]`. A goal on a split fluid (extra output, or a request in phase 1) is a goal on `[,]`.
   - **Conversion columns.** For every key the block makes or is supplied with, and every range key the block consumes or has as a goal, a column `conv:<from>→<to>` takes 1 of `from` and gives 1 of `to` when `from` fits `to`: `@T` fits when `T` lies in the range (1e-9 slack, as the warning); `@?` fits every range; a range key `[a,b]` fits `[c,d]` when `[a,b]` lies inside `[c,d]` (a request delivered for one range can feed a wider one). Cost `CONVERT_COST = 1e-7` per unit: above the 1e-8 pivot precision, so the LP never converts for nothing (which would turn a 165°C surplus into an "any temperature" surplus), and far below a recipe run (1), the byproducts-first slack (1e-5) and `SHIP_COST` (1e-6). Conversion columns are not rows: they have no machine, no node in the results and no place in the table, and they never count as an area's "own row" of an item. A block with no split fluid has none, and Seablock's worst case is steam with 9 temperatures × 7 range keys = 63 columns per area. No performance gate is needed (the first draft's "phase 0, measure" is dropped; the numbers are above).
   - **Imports and locks.** Only range keys have an import slack (decision 2), with the item's cost (`BIG_M`, or `BYPRODUCTS_FIRST_SLACK_COST` under *Don't make more here*). A temperature key never has a slack: its row is hard (≥ 0), so what is made at `T` and taken by no conversion is surplus. Import off, a byproduct consumer's ingredient and every other lock remove the slack of the fluid's range keys.
   - **Consequences.** A temperature nothing takes is a byproduct of the block (the first problem above). A recipe that takes a fluid and returns it no longer nets to zero: it takes the range key and makes the temperature key, which feeds it back only when it fits. Classification, surplus, `overconstrained`, the two passes, connections-first, byproducts-first and the connection order work on keys unchanged.
   - **Removed.** `temperatureRows.ts` (the collector and the Hall rows), `analyseTemperatures`, `LPModel.lockedTemperatureItems`, `LPResult.lockedTemperatures`, the `lockedTemperatures` option of `buildLPModel` and the retry in `solveLP`, and the matching code in `areas.ts` and `connectionOrder.ts`. The 4096 limit goes with them.

5. **Results keep base item ids and carry a tag.** Keys stay inside the solver; what leaves it names the base item, so every UI action that writes plan state (decision 3) keeps working unchanged. (Decided on 2026-11-21.)

   - `FluidTag = { at: number | null } | { min?: number; max?: number }` in `src/data/types.ts`: a made temperature (`null` = unknown), or a range (`{}` = any).
   - An optional `temp?: FluidTag` on `UnsatisfiedItem`, `AreaFlow`, `AreaRoute`, the entries of `overconstrained.surplusItems`, `area-shortfall` and `area-cut-off`. It is present only for a split fluid, so for any other item every result is what it is today.
   - `SolvedNode` gains `inputTags?` and `outputTags?` (`Record<itemId, FluidTag>`, split fluids only); its rates stay keyed by base item.
   - `SolverResult.conversions?: { itemId, from: FluidTag, to: FluidTag, rate, areaId? }[]`, above `FLOW_TOLERANCE`, present only when non-empty.
   - `netBalance(nodes, conversions?)` and `grossFlow` return maps keyed by flow key (the item id for a plain item), so the summary nets per key; with the conversions, a boiler at 500°C feeding a turbine nets to zero instead of showing 500°C surplus and a ≥465°C deficit.
   - `ConnectionFlow` and `ServedConsumer` gain `parts?` (decision 6).

6. **Connections carry keys.** A connection stays one stored record per item (decision 3); for a split fluid the solver expands it into one internal flow per key. (Decided on 2026-11-21; pairs without a served list are decision 11.)

   - **Takes carry temperature keys.** A source's offer of a split fluid is its net balance per key (`netBalance` with conversions): what it makes at each `@T` (and `@?`) that no conversion takes, plus any range key it makes beyond its goals. In the consumer, each offered key is supplied over its own variable `u_{c,k}` (connection `c`, key `k`) and enters through the consumer's conversion columns, so the consumer's own rows decide what fits. An offered key that is supplied is never *raw* in the consumer: it always has a hard row with its supply, since a raw key has no row and the conversions from it would be free.
   - **Requests carry range keys.** The request probe gives the consumer unlimited supply on each of its range keys of the fluid, so its need is per range (`received` of each range key). The source's effective goals get one goal per requested range (on the first product of the item, as today), which its own conversions meet at the cheapest fitting temperature. What is delivered is the range key, which the consumer takes directly. A request asks for no particular temperature.
   - **Two passes.** A split fluid's residual is the sum of its range keys' slacks in pass 1. Pass 2 adds a supply variable for each offered key when that sum is above the tolerance, with `Σ_k u_{c,k} ≤ min(Σ_k offer_{c,k}, residual)` per fluid, so own production still comes first. Locks are dropped and restored per fluid, as per item today. *Receive it first* supplies every key in every pass.
   - **`maxRate` caps the sum** of a connection's keys: `Σ_k u_{c,k} ≤ maxRate`, a row per connection in the consumer's LP. Per-(connection, key) variables keep that exact when several connections bring the same fluid; after the solve the delivery per connection is read from its own variables instead of being split in `inputConnections` order.
   - **Flows.** `ConnectionFlow.rate`, `available` and `requested` are totals over the keys; `parts?: { temp: FluidTag, rate, available }[]` gives the split for a split fluid. Status: `limited` when the consumer still imports a range that one of the connection's offered keys fits and that key's offer (or the `maxRate`) is used up; `unused` and `ok` as today, on the total.
   - **Served lists: fit before rank** (decision 3). For a pair `(source, split fluid)` that the list ranks, the credits of its takes come from one allocation instead of the per-pair rule: the source's offered keys go to the consumers' needs per range (from the probe; an area entry's need from its outside legs per range key), with a key going only to a range it fits. Groups are taken in rank order. Within a group, the grants are filled progressively: raise a common level `t`, each member taking up to `min(need, weight × t)`, freeze the members that cannot grow, repeat. This is `waterFill` generalised to several keys, and it gives the same numbers when the source offers one key. Each group's grants are then fixed as lower bounds for the groups below it. A last solve keeps every total and minimises `Σ versatility(k) × grant`, so each consumer gets the least versatile keys that do for it. The versatility of a key is the number of distinct range keys of the fluid, across the plan's blocks, that the key fits. This makes the split deterministic. The extra is a member with range `[,]`. The result, per (connection, key), is the share that `grantByRank` and the consumer's caps use, so grants, groups, areas and loops keep their rules key by key. The allocation is a few small LPs (keys × ranges is at most 9 × 7) solved with the block LP's solver. Requests do not need it: each request is on its own range key.
   - **Loops and cycles of requests** run per key: the convergence test (`sameRate`) compares every key, the cycle memo key includes the keys, and the round limits are unchanged.
   - **`connection-temperature`** (decision 3) is added by `solveAll`, one per consumer block, listing `{ connectionId, itemId, offered: { temperature, rate }[], needed: { min?, max?, rate }[] }` for each counting connection of a split fluid whose source offers the fluid only at temperatures outside every range the consumer still imports. Example: "Steam from Boilers is 165°C, but this block needs steam at ≥465°C." It is not critical. Its link goes to the source block.
   - **Phase 1 interim.** Until phase 2 lands, supply of a split fluid enters the consumer as `@?` (fits any range, today's assumption), offers are summed over the keys, and a request is a goal on `[,]`. Each phase can then be merged on its own.

7. **Areas route keys.** The area LP builds the same keys and conversion columns per area. Temperature keys (and `@?`) are routed between areas; range keys are not (a range key comes from outside the block, as an import or a requested delivery, into the area that takes it), so conversion happens in the consuming area and a route says "used 25°C from Cool to the root". `areaRoutes` and `SolvedArea` flows carry `temp`. An area's source rule for the item applies to every key of it. `area-shortfall` and `area-cut-off` are per key, with `temp`. (Decided on 2026-11-21.)

8. **Diagnostics.** (Decided on 2026-11-21.)

   - **`no-fitting-temperature`**, a new critical warning emitted before the LP, like `no-recipe`: `{ itemId, min?, max?, recipeIds }` for each range key of a split fluid that the block's rows take, that nothing can feed (no row of the block makes a key that fits it, no connection could supply one, no request delivers it) and that cannot be imported (locked). This is the naming that decision 1 requires: "Steam turbine needs steam at ≥465°C, but nothing in this block makes it and it cannot be imported." The elastic goals then report the goal shortfall as usual. A range that can be imported needs no warning: the Ingredients pane already shows the ranged import.
   - **`temperature-mismatch` keeps only heat.** With keys, a fluid can no longer reach a range it does not fit inside a block, and connections have `connection-temperature`. The remaining case is heat, whose producers are `@?` in the LP: the post-solve check of a reactor's heat buffer maximum against an exchanger's minimum stays exactly as it is, and the fluid part of the pass (candidates, `imported`, `unused`, sources' rows) is removed. It goes away with the reactor item.
   - Unsatisfied ranged imports and goal shortfalls carry `temp` (decision 5), so the Ingredients pane names the range.

9. **UI.** (Decided on 2026-11-21.) Where a result entry has a `temp`, the item chip shows the existing orange label in its top-left corner (`ItemChip`'s `temperature` label; `fmtFluidTag` in `src/data/flowKey.ts` reuses `fmtTemperatureRange`): "500°C", "≥465°C", "≤50°C", "125–165°C"; nothing for `{}` (any) or `{ at: null }` (unknown).

   - The summary tiles and the Products, Ingredients and Byproducts panes show one chip per flow key, so a block can show two steam chips with different labels. The keys of one item sit together: temperatures ascending, then ranges by minimum.
   - Every action a chip offers (Comes from, connect, Make in a new block, Sources list) acts on the base item id (decision 3). The Comes from control lists a split fluid once.
   - The block graph keeps one line per connection; its tooltip lists `parts` when there are two or more. The all-blocks and area matrices show one line per flow key.
   - The goals list and the item picker do not change.
   - New warning sentences: `connection-temperature` (above) and `no-fitting-temperature` (above), with links to the source block and to the consuming rows (`warningTargets.ts`). `fmtTemperatureWarning` keeps only the heat sentence.

10. **Snapshot and in-game viewer: no contract change.** A row's inputs and outputs are already per base item, and a row has one temperature or range per fluid. A block's `products` and `imports` are summed per base item before they go into the snapshot. `npm run contract` must leave `contract/` byte-identical; the viewer shows no temperatures. (Decided on 2026-11-21.)

11. **Pairs without a served list use a tie-break cost.** Consumers of an unranked `(source, fluid)` pair are served in solve order, each taking what the earlier ones left. Left alone, each consumer's LP would pick freely among the offered keys (all cost 0), so an early "any temperature" consumer could take the 500°C steam a later turbine block needs. So the supply of a temperature key costs `SUPPLY_TIE_COST × versatility(k)` with `SUPPLY_TIE_COST = 1e-7` (versatility as in decision 6), in every consumer LP: each consumer prefers the least versatile key that does for it. This needs no extra LP, keeps today's "what earlier ones left" rule and is deterministic. The versatility depends on other blocks, so it goes into the solve cache key with the supply caps. (Decided on 2026-11-21.)

    - Limit, accepted: the rule is greedy, so a contrived plan can still starve a later consumer. A served list fixes it exactly (decision 6's allocation).
    - Rejected: running the allocation for unranked pairs too, with the solve order as the rank. It is exact, but every take consumer of a split fluid with two or more offered keys would need one more probe LP.

## Phases

### Running the tickets

This section is for the session that orchestrates the run. Each ticket is one run of the `backlog-task` skill (`.claude/skills/backlog-task/SKILL.md`) with `noplan`, and one pull request. The tiers are set here, so the skill's step 1 does not classify them again. Explore is `haiku` at `medium` for every ticket.

| Ticket | Tier | Plan | Implement | Review (`code-review` level) | Fix | Why |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | hard | `Plan`, `opus`, `high` | `general-purpose`, `sonnet`, `high` | Opus wrapper (`low`), `high` | `general-purpose`, `sonnet`, `medium` | It changes the LP formulation of every block with a split fluid, in both builders (`build.ts`, `areas.ts`), and removes the Hall rows and their fallback; nothing prototyped it. The plan has to place the keys in code that is large (`areas.ts` is 1450 lines) and find every caller of `netBalance`. The implementer runs at `high`, not the skill's `medium`, because of the size of the diff. The reviewer re-derives cases 24 and 25. |
| T2 | hard | `Plan`, `opus`, `high` | `general-purpose`, `sonnet`, `high` | Opus wrapper (`low`), `high` | `general-purpose`, `sonnet`, `medium` | A new kind of flow between blocks: per-key supply, requests per range, and an allocator inside the served-list machinery (credits, groups, areas, loops, cycles of requests). This is where a wrong call is the hardest to find later. The planner and the reviewer re-derive cases 26 and 27, and case 22 D must not move. |
| T3 | standard | `Plan`, `sonnet`, `high` | `general-purpose`, `sonnet`, `medium` | `sonnet`, `high` | `general-purpose`, `sonnet`, `medium` | UI and snapshot work that follows decisions 9 and 10, on result fields T1 and T2 already produce. No solver change. |

If Opus is scarce, T2 keeps its Opus plan and review, and T1's review drops to `sonnet`, `high`. T1's plan stays on Opus.

Rules of the run, the same as for the sourcing-priority phases:

- **Order.** Strictly T1, T2, T3, one agent at a time. The run **stops after T1**, so the author can check the results on their own Seablock plans before T2 builds on them. A ticket whose predecessor is not merged is cut from that predecessor's branch, and its pull request targets that branch.
- **Never merge.** Push each branch as soon as its implementation commit exists. Pull request bodies are not hard-wrapped.
- **Accuracy.** A synthetic row is written first and seen failing. An expected value is never edited to match the solver. The rows a ticket adds are re-derived by its planner and by its reviewer. The run halts on any of these:
  - a derived value that disagrees with the solver;
  - a ticket that fails twice;
  - a moved line of `contract/`;
  - a moved line of `src/solver/__snapshots__/legacyParity.json` for a Nullius plan or for a block with no split fluid.

  Seablock blocks with steam or another split fluid are expected to move in T1 and T2; the pull request lists each moved block and says why it moved.
- **Decisions.** A product decision that a ticket meets and this document does not settle is taken as the planner's recommendation and listed under "Decisions taken" in the pull request.
- **Known noise.** A handful of e2e specs fail on the author's machine while their own dev server and Factorio are running, on `main` too. Re-run a failure alone before treating it as a regression, and never kill those processes.

### The tickets

Each phase is one ticket, ends in one pull request, and keeps `main` green and usable. Every ticket updates [spec/solver.md](../../../spec/solver.md), [spec/test-synthetic.md](../../../spec/test-synthetic.md) and `src/solver/synthetic.test.ts` together, plus [spec/data-model.md](../../../spec/data-model.md) or [spec/ui.md](../../../spec/ui.md) where it touches them, as the CLAUDE.md maintenance table says. The synthetic cases below give the setups and the expected values that matter; the ticket writes the derivations in the case-24 style.

### T1. Keys inside a block and its areas (decisions 1, 2, 4, 5, 7, 8; 6 in its interim form)

Done (merged, #362): the keys, the conversion columns and the diagnostics are in. Two interim choices differ from the text below, both replaced by T2: connected supply of a split fluid is given to each consumed range key directly (one supply variable per range key, a group row bounding their sum by the offer) instead of entering as `@?`, and a split fluid that is a goal of the block and also feeds its rows gets that supply for the rows' ranges, never for the goal key. T1 adds no snapshot merge: a block's `imports` can list one split fluid once per range until T3 sums them per base item (no contract fixture has a split fluid).

- `src/data/flowKey.ts`, the split set, `FluidTag`, and the `GameDataSchema` refine.
- `buildClassifiedSystem` and the area column system build keys, conversion columns, tags and `conversions`; range-key imports; temperature keys without slack.
- Remove the Hall rows and everything listed under *Removed* (decision 4).
- `no-fitting-temperature`; `temperature-mismatch` reduced to heat.
- Supply of a split fluid enters as `@?`, offers are summed over the keys, requests are goals on `[,]` (decision 6, *Phase 1 interim*).
- `netBalance` and `grossFlow` by key, with their solver callers.
- Minimal UI so `main` stays truthful: `FactorySummary` nets by key and shows the tag label on summary chips (the rest of decision 9 is T3).
- Tests:
  - Case 24 rewritten (below).
  - New case 25.
  - `index.integration.test.ts`: every Nullius result unchanged (the split set is empty). A Seablock plan with steam solves with no `temperature-mismatch` except heat.
  - Unit tests for `flowKey.ts`.

### T2. Connections (decisions 6, 11)

- Offers per key, `u_{c,k}`, requests per range, the two-pass and `maxRate` rules, `parts`, status, `connection-temperature`, loops and cycles per key.
- The served-list allocation.
- The supply tie-break cost and its place in the solve cache key (decision 11).
- Tests: new cases 26 and 27; case 22 D (a loop of blocks and a served list) unchanged.

Done, unmerged: the offers are per key everywhere in `solveAll`, a connection supplies the consumer's supplied keys, requests are per range, the served list allocates the keys (`keyAllocation.ts`), loops and cycles of requests run per key, and `connection-temperature` is raised. Cases 26 and 27 pass; case 22 D, `legacyParity.json` and `contract/` did not move. Where the implementation settled a point the text above leaves open or reads differently:

- *Case 26 b uses a depth term (R1).* Decision 11 as written (supply costs `SUPPLY_TIE_COST × versatility`) makes B's LP pick T 900 at 500° and E 1800 at 165°, importing 900 `{ min: 465 }`, because both imports cost `BIG_M` and only the ties decide. The author chose to keep the value of the table above: a conversion out of a supplied key also costs `SUPPLY_TIE_COST · SUPPLY_DEPTH · N · (N − depth)`, so a short supply serves the narrowest ranges first (`SUPPLY_DEPTH = 0` gives decision 11 as written).
- *The pass-2 cap is one row per fluid*, not per connection (two connections could each take the whole residual and replace own production).
- *A supplied key is its own key* (`item@T#in`, `#in#<area>`), converting into every non-goal range key it fits, so supply never reaches a goal key and a consumer's own range row keeps its meaning.
- *The request probe and direct `solveBlock` calls keep T1's item-level supply* of the range keys; `solveAll` hands a split fluid over by key only.
- *The offer includes goal keys* (requested ranges, the extra on `[,]`), as for plain items. A requested range is a goal with a range (`SolverGoal.temp`).
- *Takes-first credit on a pair with no list* is a one-member allocation (the keys the source has left, the consumer's need per range, its `maxRate`).
- *The allocation runs once per ranked pair* when the request pass reaches its first listed take and every need is final; otherwise each listed take is allocated alone in list order (`notCredited`, `groupInListOrder`). The extra is a member asking `extraRate` on any temperature.
- *`connection-temperature`* is raised only when the connection offers temperatures with a number (unknown fits everything, a range key is a delivery of what was asked) and none fits a range the block still imports.
- *Import off locks the intermediate range keys of a connected fluid* the block does not make; pass 1 unlocks them and pass 2 locks them again unless the fitting supply is short (`maxFit`).
- *`R_F`, for versatility and depth*, is the distinct ranges of the recipe ingredients of every row of every block (fuel ignored, goal ranges left out).
- *A part* (`ConnectionFlow.parts`, `ServedConsumer.parts`) with no rate, no offer and nothing requested is left out; area lines carry no parts (T3 may add them).
- *Commits.* The connections per key and the served-list allocation are one commit: they share the per-key ledger of `solveAll`.

### T3. UI and snapshot (decisions 9, 10)

Done: the Ingredients and Byproducts panes have one slot per flow key (a connection sits on the key of each part it carries), the collapsed chips and the strip header carry the label, the block graph's connection tooltip lists the parts, both areas matrices have one row per key, `connection-temperature` links the consuming rows, and the snapshot's `imports` are summed per base item. Where the implementation differs from the text: a tooltip also names a single labelled part (decision 9 says two or more); products are not summed in the snapshot (they come from product records and never fork by temperature, and an existing test pins two entries for one item); the Products pane keeps one untagged chip per product, counting every temperature the block leaves; the e2e uses a 465°C connection because Seablock makes no 500°C steam; its fixture sits in `e2e/fixtures/not-in-golden/` so the legacy parity golden file stays as it is.

- All of decision 9 not done in T1, plus the snapshot merge.
- Tests:
  - A Playwright spec on a Seablock plan: a boiler pinned at 165°C feeding a turbine shows a "steam 165°C" byproduct chip and a "steam ≥465°C" import chip. A connection delivering 500°C steam to a turbine block shows no import, and its tooltip lists the part.
  - `npm run contract` leaves `contract/` unchanged.
  - Update [spec/ui.md](../../../spec/ui.md) and the README's "Using the planner" if the player sees it.

When T3 merges, the initiative is shipped: move the folder to `initiatives/archive/` and update [initiatives/README.md](../../README.md).

### Synthetic cases

**Case 24, rewritten for decision 1.**

- a, c, e, g and h keep their values. In e the route reads "used 25°C" from Cool to the root, 6000.
- b now gives:
  - every row 0;
  - goal shortfall 60 clean;
  - one `no-fitting-temperature` on `case24-used` with max 50, naming F;
  - no `temperature-mismatch`.
- d and f now give `infeasible-pins` with `conflict: true`: F pinned at 60 needs 6000 at 50° or less, and C1 pinned at 10 makes 1000.
- g2 is removed: there are no longer rows that give way.
- Add b2, "b with Import on": H, C3 and C2 at 0, F 60, and an import of 6000 used at 50° or less (`temp: { max: 50 }`).

**Case 25, keys inside a block.** Fluid `case25-steam` (no `defaultTemperature`), 1 s recipes:

| Row | Takes | Makes |
|---|---|---|
| B1 | 1 fuel | 60 steam at 165° |
| B2 | 1 fuel | 30 steam at 500° |
| U | 1 fuel | 60 steam, no temperature |
| T | 60 steam at ≥465° | 1 work |
| E | 60 steam, no bound | 1 work2 |
| R | 60 steam at ≥465° | 60 steam at 165° and 1 work |

Fuel is raw.

| Row | Setup | Expected |
|---|---|---|
| a | B1 pinned at 60, T; goal 60 work | T 60; import 3600 steam `{ min: 465 }`; byproduct 3600 steam `{ at: 165 }` (today it nets away) |
| b | B1, B2, T; goal 60 work | B2 120, B1 0; no import |
| c | B2, T, E; goals 60 work, 60 work2 | B2 240; conversions 3600 to `{ min: 465 }` and 3600 to `{}` |
| d | U, T; goal 60 work | U 60, feeding T through `@?`; no import |
| e | B2, R; goal 60 work | R 60, B2 120; byproduct 3600 steam `{ at: 165 }` (today R needs no steam) |
| f | B1 (not pinned), T; goal 60 work; Import off on steam | every row 0; goal shortfall 60 work; one `no-fitting-temperature` on steam, min 465, naming T |

**Case 26, connections.** Same rows as case 25, and two blocks.

| Row | Setup | Expected |
|---|---|---|
| a | A: rows W (1 fuel → 1 widget + 60 steam at 500°) and W2 (1 fuel → 1 widget2 + 60 steam at 165°, pinned at 30), goal 60 widget, so it offers 3600 at 500° and 1800 at 165°. B: T and E, goals 30 work and 30 work2, a take from A | B receives 1800 at 500° (to T) and 1800 at 165° (to E, the less versatile key); no import; `parts` lists both |
| b | a with `maxRate` 2700 | T 1800 at 500°, E 900 at 165°; B imports 900 steam `{}`; flow `limited`, `capped` |
| c | A: B1 and B2 with steam as a product, no extra. B: T and E as in a, with a request | requested 1800 `{ min: 465 }` and 1800 `{}`; A runs B2 60 and B1 30; no import in B |
| d | A: W2 alone, goal 30 widget2 (offers 1800 at 165°). B: T alone, goal 30 work, a take | flow `unused`; B imports 1800 `{ min: 465 }`; one `connection-temperature`: offered 165° 1800, needed min 465 1800 |

**Case 27, fit before rank.** Source A has the rows of case 26 a with goal 30 widget, so it offers 1800 at 500° (W 30) and 1800 at 165° (W2 pinned at 30). Consumer C1 has E with goal 30 work2 (needs 1800, any). Consumer C2 has T with goal 30 work (needs 1800, ≥465). Both take from A.

| Row | Setup | Expected |
|---|---|---|
| a | served list C1, C2 | C1 1800 at 165°, C2 1800 at 500°; no imports |
| b | a with W2 pinned at 15 (offers 900 at 165°) | C1 900 at 165° + 900 at 500° (ranked first, fully served), C2 900 at 500° and imports 900 `{ min: 465 }` |
| c | no list, solve order C1 then C2 | as a (versatility tie-break) |
| d | b with C1 and C2 tied at 50/50 | 2700 shared: C1 900 at 165° + 450 at 500°, C2 1350 at 500°; C2 imports 450 `{ min: 465 }`, C1 imports 450 `{}` |
