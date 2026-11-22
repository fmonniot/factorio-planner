# Fluid temperatures as first-class items

Status: Future

To the solver a fluid is one item, whatever temperature it is made at. Temperature enters only as extra LP rows inside a block, and as a warning after the solve. Everywhere else (the block boundary, offers, connections, area routes, surplus, the summary) it is lost. This initiative makes the temperature part of what flows. No design is chosen yet: this doc records the problem, the one decision already taken, the directions and the open questions.

## The problem, from the player's side

- **A fluid nothing takes disappears.** Steam from a boiler pinned too cold, or a co-product at a temperature no row accepts, nets against the import that replaces it. It is not shown as a byproduct, not offered to other blocks, and only appears as `unused` on the `temperature-mismatch` warning.
- **A connection carries "steam", not "500°C steam".** The consumer block cannot plan on the temperature it receives; only the warning checks it after the solve, and a source block that passes the fluid on makes it unknown.
- **Area routes ignore it.** The temperature rows are block-wide, so the routes between areas can show a too-cold fluid going to the row that refused it.
- **Locked fluids are only checked when the block can fit them.** A goal or Import-off fluid gets temperature rows without slack when every consumer class has a producer at an accepted temperature, and none otherwise (see *Related items* below for the local fix, shipped in the pull request that added case 24).

## What the solver does today

Described in [spec/solver.md](../../spec/solver.md#fluid-temperatures); the facts that matter here:

- One balance row per fluid. `FluidTemperatureCollector` ([src/solver/temperatureRows.ts](../../src/solver/temperatureRows.ts)) records, while the stoichiometry is built, each producer's temperature (the product's `temperature`, else the fluid's `defaultTemperature`, else unknown; heat is always unknown) and each bounded consumer. `temperatureRows` turns that into Hall's condition rows, one per distinct union of consumer classes (at most 4096).
- `buildLPModel` ([src/solver/solve.ts](../../src/solver/solve.ts)) puts the import slack and the supply variable in every temperature row with coefficient 1. **Anything from outside the block is assumed to fit any bound.** The rows rest on that assumption, and it is the assumption that breaks at the boundary.
- A fluid with neither slack nor supply (a goal, Import off, a byproduct consumer's ingredient, an area item locked in every area) gets its rows without slack when every consumer class has a producer at an accepted temperature (`analyseTemperatures`), else none; if the model with them is infeasible `solveLP` solves the one without them ([src/solver/areas.ts](../../src/solver/areas.ts) does the same).
- Classification, surplus, offers, `overconstrained`, connections, served lists, area routes and the snapshot all use the plain item.
- `temperature-mismatch` ([src/solver/temperature.ts](../../src/solver/temperature.ts)) reconstructs the temperatures after the solve from the block's rows and from the rows of connected source blocks.

## Items this initiative covers

Moved from the backlog on 2026-11-21.

- [ ] **Fluid temperatures stop at the block boundary.** The LP keeps a bounded fluid's temperatures apart inside a block (spec/solver.md, "Fluid temperatures"), but a fluid is still one item in the merged balance, in offers and over connections. A fluid made at a temperature nothing in the block takes (a pinned cold boiler, a co-product) nets against the import that replaces it: it is not shown as a byproduct, not offered to other blocks, and only appears as `unused` on the `temperature-mismatch` warning. A connection carries the plain fluid, so the consumer block cannot know which temperature it gets and only the post-solve warning checks it. The same holds between areas of a block: the temperature rows are block-wide and area routes carry the plain fluid, so the routes can show a too-cold fluid going to the row that refused it. Fix: carry a temperature with fluid flows (items keyed by fluid and temperature through the LP, area routes, offers, connections and the summary tiles).
- [ ] **Temperature rows past 4096 unions are only a necessary condition.** A fluid whose bounded consumers form more than 4096 distinct unions of accepted temperatures (13 or more single-temperature classes) gets one row per class only, so the LP can again meet the balance with temperatures nobody takes; the warning still runs. No bundled data set comes near it. If one does, replace the rows with explicit flow variables per (temperature, consumer class).

## Related items left in the backlog

- **Goal and no-import fluids get no temperature rows.** Shipped (see the pull request that added case 24 to spec/test-synthetic.md): a local fix in `buildLPModel`, done ahead of this initiative because it is small and a real plan needs it. Its policy is carried here as a decision (below).
- **Reactor heat temperature is not in the LP.** It needs a model of the reactor's working temperature first. Once that exists, heat becomes one more fluid under whatever this initiative builds.
- **Nullius bundle: *Temperatures*.** Data, not solver: until the patch runs, Nullius has no temperatures to carry.

## Decisions already taken

1. **Locked fluids run and warn rather than fail.** When a fluid has no import or supply to fall back on, its temperatures are constrained only when the block has a producer at an accepted temperature for every consumer class. Otherwise the LP may run a producer that does not fit, and `temperature-mismatch` reports it; the plan is not made infeasible. (Decided on 2026-11-21 with the *Goal and no-import fluids* fix, shipped as: slack-less rows when every class has a producer, and the model without them when those rows make the block infeasible.) Under a first-class model, a locked (fluid, temperature) that no row can make would become the ordinary "locked item the network cannot produce" infeasibility, which the elastic goals turn into a goal shortfall. Whichever the design, it must choose this behaviour explicitly, not inherit it by accident.

   Limits of that fix: the choice is all or nothing per fluid (one consumer class without a fitting producer leaves every class of the fluid without rows), and a connection order whose step is infeasible only because of the slack-less rows stops, so today's result stands.

## Directions

### A. Flow variables inside the LP

Replace the Hall rows with explicit flows: `y_{T,c} ≥ 0`, the fluid made at temperature `T` that goes to consumer class `c`, for each `T` the class accepts. Each made temperature gets a balance (made at `T` ≥ Σ_c `y_{T,c}` + what unbounded consumers and goals take at `T`), and each class one (Σ_T `y_{T,c}` = what it consumes). This is exact for any number of classes (it closes the 4096 item), and it gives the LP a per-temperature split that the results can report. The variables number temperatures × classes, which is small for the bundled data. Unbounded consumers and goals can take any `T`: either they get a `y` per temperature too, or they stay on the plain balance and take what is left.

This needs no plan-state change and stays inside one block, so it can ship first.

### B. Temperatures through the boundary

Built on A: block results, surplus, byproducts, offers, connections and area routes carry the temperature, so supply stops being a wildcard. The temperature a consumer block receives comes from the solve, not from the post-solve warning, and a block that passes a fluid on passes its temperature on too. What is left of `temperature-mismatch` is the locked-fluid fallback and unknown temperatures.

## Open questions

- **What temperature is an import?** Today it fits any bound. Keeping that is the simplest, and matches "the player brings it in from somewhere". The fluid's `defaultTemperature` is wrong for steam, and a player-chosen temperature means a new plan field.
- **Does the plan state change?** Goals, Import off, `makeHere`, sources lists, served lists and connections are keyed by item. Can they stay that way, with the solver splitting by temperature, or does a goal or a connection need a temperature? A persisted `AppState` change needs a migration.
- **A connection with several temperatures.** One flow with a per-temperature breakdown, or one flow per temperature? Does `maxRate` cap the sum? How does the loop between blocks converge when the split changes between rounds?
- **Unknown temperatures.** A producer with no temperature (no `defaultTemperature`, and heat until the reactor item lands) fits any bound today. It should keep doing so, as a wildcard row in direction A.
- **Snapshot and in-game viewer.** Does the viewer show temperatures? Any change to `src/snapshot/` goes through `npm run contract` and [spec/in-game-viewer-protocol.md](../../spec/in-game-viewer-protocol.md).
- **UI.** Today the summary, goals, item picker and block graph show no temperatures ([spec/ui.md](../../spec/ui.md)). Where should a per-temperature rate appear: summary tiles, the Ingredients and Byproducts panes, connection lines?
- **Cost.** LP size and solve time on the author's Seablock plans, with direction A and then B.

## Phases (tentative)

0. **Measure.** Per block of the bundled data and the author's plans: the fluids with bounded consumers, their temperatures and consumer classes, and the LP size of direction A. Decide whether unbounded consumers get flow variables.
1. **Direction A inside a block.** Flow variables replace the Hall rows; results report per-temperature rates; no plan-state change. Closes the 4096 item.
2. **The block boundary.** Surplus, byproducts and offers per temperature; connections carry the temperature; the warning shrinks to what the LP cannot enforce.
3. **Areas.** Area routes per temperature.
4. **UI and snapshot.** Wherever the open questions place the temperature.
