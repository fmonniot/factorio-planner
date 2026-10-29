# Initiative: Plan power generation

Status: Future

Design notes for "set a goal of 10 MW and get the generators, boilers, fuel and water that deliver it". Nothing is implemented yet. Linked from [../backlog.md](../backlog.md#planning-features).

---

## Problem

Power is only an output of the planner today. [spec/solver.md](../../spec/solver.md#machine-count-and-power) computes `powerKw` per node after the solve, and the UI shows it per row. There is no way to ask for power, so a player who wants "10 MW" has to work out the boilers, engines and fuel by hand. [spec/overview.md](../../spec/overview.md) lists "map-level infrastructure (power grids …)" as out of scope; this initiative stays on the production side of that line (how much generating equipment and fuel a target needs), not where it is placed or how it is wired.

What the export drops today, which blocks generation:

- Only `assembling-machine`, `furnace`, `rocket-silo`, mining drills and offshore pumps become machines. Boilers, generators, solar panels, reactors and heat exchangers are not exported ([spec/data-model.md](../../spec/data-model.md#machine)).
- Fuel data (`fuel_value`, `fuel_category`, burner `effectivity`) is not exported ([spec/data-model.md](../../spec/data-model.md#what-the-build-script-leaves-out)).
- Fluid `heat_capacity` and temperatures are not exported (see also the backlog item on fluid temperatures).

## Idea

Do what extraction did: turn the new thing into ordinary recipes, so the LP needs no special case ([spec/data-model.md](../../spec/data-model.md#extraction-recipes)).

- **`electricity` pseudo-item.** One unit is 1 MJ. Rates are per minute, so 10 MW is 600 units/min and the existing per-second toggle shows it as 10 MW. It has no icon file yet and needs its own item group ("Power") so the pickers can place it.
- **Generation recipes** produce `electricity` with `craftingTime` 1 and are made in the generator entity, so machine count is the number of engines, turbines or panels. The player adds them as rows like any other recipe, and the solver sizes them.
- **A goal of `electricity`** then solves like any other goal: 10 MW needs about 11 steam engines of 900 kW (vanilla figure), the steam they consume, the boilers that make it, and the fuel and water those need.

The player still chooses the recipes (boiler on coal, or on solid fuel), as for everything else in the planner. Choosing automatically is the separate [optimization mode](../backlog.md#planning-features).

## Phases

### Phase 0 — Inspect the dumps

Before designing the export, read the raw prototypes in the Nullius and Seablock dumps. The Nullius bundle already has items and recipes for boilers, open and closed turbines, wind turbines, Stirling engines, solar collectors, heat exchangers, reactors and fusion cells at several pressures, plus `nullius-burn-*-steam` recipes that may already model part of this. Seablock adds Bob's and Angel's boilers, steam engines, oil boilers and generators. Output of this phase: a list of the entity types in use (`boiler`, `generator`, `burner-generator`, `solar-panel`, `reactor`, `heat-pipe`, `fusion-generator`, …), which of them the two bundles need, and what the existing recipes already cover so the exporter does not duplicate them.

### Phase 1 — Export and model

- Export fuel data: `fuel_value` and `fuel_category` on items and fluids, burner `effectivity`, fluid `heat_capacity`. This also gives burner machines their fuel use later.
- New `scripts/power.js`, modelled on `scripts/extraction.js`, with a `--patch-power` mode like `--patch-extraction`:
  - **Boilers:** one recipe per (boiler, fuel): water plus fuel in, steam out. The fuel amount per craft is the boiler's power divided by the fuel's value (fractional amounts; check the schema accepts them). Output rate comes from the boiler's target temperature and the fluid's heat capacity.
  - **Fluid generators** (steam engines and turbines): one recipe per (generator, fluid) with the fluid at its `fluid_usage_per_tick` in and `electricity` out. Output is computed from the steam temperature, the fluid's heat capacity and `effectivity`, capped by the generator's maximum.
  - **Burner generators:** fuel in, `electricity` out.
  - **Solar panels and wind turbines:** no ingredients, average output (for vanilla solar 42 kW of the 60 kW peak). Day and night, wind and surface are not modelled.
- Schema: a new machine `type` for generators, the `electricity` item, the new fuel fields. Update [spec/data-model.md](../../spec/data-model.md).
- Regenerate both bundles from fresh dumps (the Nullius re-export is already planned in the [backlog](../backlog.md#data-sets), so do them together).
- Tests: `scripts/__tests__/power.test.js` with synthetic prototype tables, plus a solver case in [spec/test-synthetic.md](../../spec/test-synthetic.md) and `src/solver/synthetic.test.ts` for a water → boiler → turbine → 10 MW chain.

### Phase 2 — UI

- `electricity` is offered in the goal picker; its icon and "Power" group exist.
- Rates of `electricity` format as W / kW / MW / GW (reuse `fmtPower`) in goals, tiles, the summary and the per-second toggle.
- The recipe picker copes with one boiler recipe per fuel: group them under a "Power" subgroup, and consider collapsing the per-fuel variants into one entry with a fuel choice.
- Machine picker, machine count and the ⚡ tile work for the new machine type. A generator row's own ⚡ tile must not show its output as consumption.
- Update [spec/ui.md](../../spec/ui.md), the README "Using the planner", and an e2e spec in `e2e/` (add the goal, add the rows, check the machine counts).

## Deferred

- **Self-powering blocks:** a goal such as "generate what this block consumes". Power per recipe is linear in throughput, so it would fit the LP as a negative `electricity` coefficient per recipe, but machine resolution would have to move ahead of the LP, it would need to be opt-in per block, and beacon power would need counting.
- **Heat:** reactors, heat exchangers and heat pipes need a `heat` pseudo-item and neighbour bonuses.
- **Accumulators:** needed for solar at night. A fixed ratio rule per panel would do, or a note.
- **Burner machines:** fuel use of burner-powered crafting machines (needs the Phase 1 fuel data).
- **Fusion and Space Age-style generators,** if a bundled data set needs them.
- **Temperature-aware output:** Phase 1 picks one steam temperature per generator; the solver ignores temperatures.

## Risks and open questions

- **Nullius is the hard case:** several steam pressures, open and closed turbines, and recipes such as `nullius-burn-open-steam` whose role is unknown until Phase 0. The export may reduce to a few generator families plus special cases.
- **Recipe count:** (boilers × fuels) can be large. Hide the less useful ones or collapse them in the picker.
- **Fractional ingredient amounts** may hit validation or display assumptions.
- **`electricity` item id** must not collide with a mod's own item; use a namespaced id like `extraction`'s `mining:` prefix.
- **Horizon gating:** generators are gated through their placing items; check this works for the new machine type.

## Docs to update when this ships

[spec/data-model.md](../../spec/data-model.md), [spec/ui.md](../../spec/ui.md), [spec/overview.md](../../spec/overview.md) (scope line), [spec/test-synthetic.md](../../spec/test-synthetic.md), the README repository map and "Using the planner", and this folder's entry in [../README.md](../README.md).
