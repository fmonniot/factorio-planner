# Multiple beacon configurations per recipe

Status: Shipped

A recipe row holds one beacon configuration (`beaconConfig`). This initiative lets it hold several, in the data model, the solver, the in-game viewer snapshot. It comes after the [recipe table redesign](../recipe-table-redesign/plan.md), which lands first with the final beacon UI but a single configuration, so this step has no UI work beyond removing a disabled state.

## Context

- Real setups mix beacon types or module sets around one machine (speed beacons plus efficiency beacons). `GameRecipeNode.beaconConfig` is a single `BeaconConfig`, so the planner cannot describe them.
- Beacon effects are additive, so several configurations need no new solver concept: the formula already used for one configuration is applied to each and summed.
- The redesign already makes `BeaconConfig.moduleId` optional (a beacon without a module), so that is not part of this work.

## Design

### Data model and solver

- `GameRecipeNode.beaconConfig` (one `BeaconConfig`) becomes `beaconConfigs: BeaconConfig[]`. Each entry keeps `beaconId`, `moduleId` (optional), `beaconCount`, `modulesPerBeacon` and `distributionEfficiency`.
- `computeNodeEffects` in `src/solver/effects.ts` loops over the list and adds each configuration's contribution with the existing formula (`effect × distributionEfficiency × modulesPerBeacon × beaconCount`, additive), with the same `effectAllowed` filtering per configuration (beacon entity and machine allowed effects).
- A plan saved with one `beaconConfig` loads as a one-element list. The migration is idempotent, like `connectionsFirstItems` to `itemSourcing`.

Code that reads `beaconConfig` today, to move to the list (found with a search of `src/`, `spec/` and `e2e/`):

- `src/data/schema.ts`: the node schema and the load-time migration.
- `src/solver/effects.ts`: `computeNodeEffects`.
- `src/store/blockStore.ts`: `updateNodeBeacon`, the "apply to every row of this recipe" settings copy (`RowSettings`), the row copy used when a node is duplicated, and the undo snapshots.
- `src/snapshot/project.ts`: the in-game viewer snapshot (see the open question).
- The adapter the redesign puts between the store and the beacon UI.
- Test fixtures and `e2e/fixtures/*.json`, which stay valid through the migration.

### UI

None to build. The [recipe table redesign](../recipe-table-redesign/plan.md) ships the final UI of its design canvas over a list of configurations (the `+N` badge, one card per configuration, one Effects column each), fed by an adapter around the single `beaconConfig`, with "+ Add beacon configuration" disabled once a row has one. This step replaces the adapter with `beaconConfigs` and removes the disabled state.

## Open questions

- **In-game viewer snapshot.** The wire contract sends one `beacon` per row (`{ id, count, module, modules }`). Options: send the first configuration only (no contract change; the mod places beacons for the first configuration), or send a `beacons` list (contract, bridge and mod change, `npm run contract`, new fixtures). Proposed: first configuration only for now, and a backlog item for the list.
- **"Apply to every row" for beacons.** Whether it copies the whole list (proposed) or only the first configuration.

## Phases

- [x] **1. Schema, migration and solver.** `beaconConfigs`, idempotent load-time migration, the loop in `computeNodeEffects`, unit tests for several configurations, the migration and per-configuration `effectAllowed` filtering, [data-model.md](../../../spec/data-model.md) and [solver.md](../../../spec/solver.md).
- [x] **2. Store.** `updateNodeBeacon`, row settings copy and duplication on the list, undo.
- [x] **3. Enable the UI.** Replace the redesign's adapter, remove the disabled "+ Add beacon configuration", [ui.md](../../../spec/ui.md), a Playwright spec with two configurations.
- [x] **4. Snapshot.** Whatever the open question settles on, with `npm run contract` if the contract changes.
