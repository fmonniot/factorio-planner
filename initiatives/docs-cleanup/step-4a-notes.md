# Step 4a notes — data-model, ui, data-analysis

Scope: `spec/data-model.md`, `spec/ui.md`, `spec/data-analysis.md` (deleted).
Nothing committed or staged except the `git rm` of `spec/data-analysis.md`.

## What changed

- **spec/data-model.md** — rewritten against `src/data/schema.ts` and
  `src/data/types.ts`:
  - Intro: schema.ts is authoritative; bundle produced by
    `scripts/build-game-data.js` from `factorio --dump-data`; loader entry points.
  - Game data: every field of GameData, Item, Recipe, Ingredient, Product,
    Machine, Module, BeaconEntity, ItemGroup, ItemSubgroup with defaults and
    constraints; `luaArray` `{}`→`[]` shim; `defaultMachines` = highest
    `craftingSpeed` per category; recipe name/subgroup fallbacks; `mainProduct`
    table (`""` → `null`, single-product → explicit id, otherwise omitted);
    `amount ?? amount_max ?? 0`; probability = expected value;
    `ignoredByProductivity`; `allowProductivity` not enforced by the solver;
    icon-path semantics (absolute FS path, `iconUrl` strips through `/public/`).
  - Folded from data-analysis.md: energy-string parsing (W…TW), categories are
    open strings, `parameter` recipes skipped, quality ignored (Nullius has no
    tiers; speed modules carry negative quality), `fluidbox_index` /
    `ignored_by_stats` dropped, burner fuel data not exported, approximate bundle
    size clearly labelled as drifting.
  - App state: AppState → Block → SubPlan, `migrateBlock` legacy hoisting,
    RecipeNode union (`kind` injection for legacy), all GameRecipeNode fields,
    `pinnedRate` 0→undefined, BeaconConfig `beaconId`, `gameDataVersion`
    reserved/unused, localStorage key, double reference of nested sub-plans
    (SubPlan in `subPlans` + SubPlanNode in `nodes`).
  - Solver state: real SolverWarning union; `unsatisfied` order.
  - Removed: "Plan" type, URL-sharing claim, "(v1)" framing, Lua exporter.
- **spec/data-analysis.md** — deleted with `git rm` after folding (decision R2).
- **spec/ui.md** — rewritten from scratch for the table UI: startup wiring,
  layout sketch, TopBar (block tabs, export, game-data selector), FactorySummary
  (header, three panes, warnings popover), ProductionTable (recipe rows,
  sub-factory rows, drag and drop), modals/pickers, shared pieces, "Not in the UI".
  MachinePopover / ModulePopover / Popover.tsx are not described as UI.

## Corrections to the audit (verified in code)

- **Per-row recipe swap does exist.** `EditMachineModal.tsx` lists an
  "Alternate recipe" section under the machine picker (non-hidden recipes
  producing the same main product); choosing one calls `updateNodeRecipe`, which
  resets machine, modules, beacon, pin, primaryProduct and byproductConsumer.
  Audit A ("per-row recipe swap" under "Not present") and README finding 7
  ("no per-row recipe swap") are wrong — whoever edits README should not claim it
  is missing.
- `Popover.tsx` is only imported by the dead `MachinePopover` / `ModulePopover`,
  so it is dead too.
- Block tabs are icon-only (first goal's icon), with the active block's name
  printed after the `+`; rename is via browser `prompt`.
- Goal picker amount is always items/min (labelled `/min`), independent of the
  rate-unit toggle; default 60.

## Possible code issues (for the backlog, not fixed — D7)

1. **`pinnedRate` unit mismatch.** The solver uses `pinnedRate` as executions/min
   (`x_j`, `src/solver/solve.ts:127`). `RecipeRow.tsx` seeds it from
   `throughput` (executions/min) but displays `pinnedRate × 60` in /min mode and
   stores `input / 60` — i.e. treats it as per-second. It is also shown in the
   Products cell as if it were an item rate, though it is executions. Spec
   documents the solver meaning only.
2. **`allowProductivity` not enforced.** The modals zero productivity only in the
   "Recipe effects" display; productivity modules can still be added to a recipe
   that disallows them and `computeNodeEffects` applies the bonus.
3. Beacon modal offers every non-hidden module regardless of the beacon's
   `allowedEffects`.
4. Removing a sub-factory deletes all its nodes with no confirmation.
5. Committed bundles embed the author's absolute home path in every `iconPath`
   (`makeIconResolver` computes `publicUrl` from the already-resolved absolute
   `iconsOut`, so the `^public/` strip never matches). Works only because
   `iconUrl` cuts at `/public/`.
6. Already in the audit: Seablock id `'kompetenz-seablock/'` → `//` in URL;
   undo/redo and `renameSubPlan` without UI; unreachable byproduct-policy toggle
   branch in `RecipeRow`.

## Unverifiable / not checked

- Behaviour was verified by reading code, not by running the app.
- Counts in data-model.md are from the committed Nullius bundle at the time of
  writing (2371 recipes, 2849 items+fluids, 136 machines, 34 modules, 19 beacons);
  labelled approximate.

## Open questions

- Should `spec/ui.md` mention the Seablock `//` URL quirk? Left out (it is a bug,
  tracked in the backlog).
- `gameDataVersion`: documented as reserved/unused. Drop the field or start
  setting it? (backlog decision)
