# Initiative: Plan power generation

Status: Shipped

Design notes for "set a goal of 10 MW and get the generators, boilers, fuel and water that deliver it". Phases 0–2 shipped for the Seablock bundle (see [Outcome](#outcome)). Linked from [../backlog.md](../../backlog.md#planning-features).

---

## Problem

Power is only an output of the planner today. [spec/solver.md](../../../spec/solver.md#machine-count-and-power) computes `powerKw` per node after the solve, and the UI shows it per row. There is no way to ask for power, so a player who wants "10 MW" has to work out the boilers, engines and fuel by hand. [spec/overview.md](../../../spec/overview.md) lists "map-level infrastructure (power grids …)" as out of scope; this initiative stays on the production side of that line (how much generating equipment and fuel a target needs), not where it is placed or how it is wired.

What the export drops today, which blocks generation:

- Only `assembling-machine`, `furnace`, `rocket-silo`, mining drills and offshore pumps become machines. Boilers, generators, solar panels, reactors and heat exchangers are not exported ([spec/data-model.md](../../../spec/data-model.md#machine)).
- Fuel data (`fuel_value`, `fuel_category`, burner `effectivity`) is not exported ([spec/data-model.md](../../../spec/data-model.md#what-the-build-script-leaves-out)).
- Fluid `heat_capacity` and temperatures are not exported (see also the backlog item on fluid temperatures).

## Idea

Do what extraction did: turn the new thing into ordinary recipes, so the LP needs no special case ([spec/data-model.md](../../../spec/data-model.md#extraction-recipes)).

- **`electricity` pseudo-item.** One unit is 1 MJ. Rates are per minute, so 10 MW is 600 units/min and the existing per-second toggle shows it as 10 MW. It has no icon file yet and needs its own item group ("Power") so the pickers can place it.
- **Generation recipes** produce `electricity` with `craftingTime` 1 and are made in the generator entity, so machine count is the number of engines, turbines or panels. The player adds them as rows like any other recipe, and the solver sizes them.
- **A goal of `electricity`** then solves like any other goal: 10 MW needs about 11 steam engines of 900 kW (vanilla figure), the steam they consume, the boilers that make it, and the fuel and water those need.

The player still chooses the recipes (boiler on coal, or on solid fuel), as for everything else in the planner. Choosing automatically is the separate [optimization mode](../../backlog.md#planning-features).

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
- Schema: a new machine `type` for generators, the `electricity` item, the new fuel fields. Update [spec/data-model.md](../../../spec/data-model.md).
- Regenerate both bundles from fresh dumps (the Nullius re-export is already planned in the [backlog](../../backlog.md#data-sets), so do them together).
- Tests: `scripts/__tests__/power.test.js` with synthetic prototype tables, plus a solver case in [spec/test-synthetic.md](../../../spec/test-synthetic.md) and `src/solver/synthetic.test.ts` for a water → boiler → turbine → 10 MW chain.

### Phase 2 — UI

- `electricity` is offered in the goal picker; its icon and "Power" group exist.
- Rates of `electricity` format as W / kW / MW / GW (reuse `fmtPower`) in goals, tiles, the summary and the per-second toggle.
- The recipe picker copes with one boiler recipe per fuel: group them under a "Power" subgroup, and consider collapsing the per-fuel variants into one entry with a fuel choice.
- Machine picker, machine count and the ⚡ tile work for the new machine type. A generator row's own ⚡ tile must not show its output as consumption.
- Update [spec/ui.md](../../../spec/ui.md), the README "Using the planner", and an e2e spec in `e2e/` (add the goal, add the rows, check the machine counts).

## Findings (Phase 0)

**Entity types in the dumps** (count, with the number not hidden in brackets):

| Type | Seablock | Nullius |
|---|---|---|
| `boiler` | 14 (13): 5 burner boilers (`boiler` 1.8 MW/165 °C, `bob-boiler-2..5` 3.6–9 MW, 315–765 °C), 5 fluid-burning (`bob-oil-boiler`..`-4` 5.4–13.5 MW plus hidden `oil-steam-boiler`), 4 heat exchangers (heat) | 2 (0): vanilla, hidden |
| `generator` | 9 (8): `steam-engine`, `steam-turbine` (max 465 °C), `bob-steam-engine-2..5`, `bob-steam-turbine-2/3`, plus hidden minable `petroleum-generator` | 20 (0): vanilla engine and turbine (hidden), plus 18 `nullius-turbine-generator-{open,closed}-{backup,standard,exhaust}-{1,2,3}` (hidden, no `minable`, `burns_fluid`, filter `nullius-energy`, `scale_fluid_usage`) |
| `burner-generator` | 2 (0) | 1 (0) |
| `solar-panel` | 9 (9), 26.67–240 kW | 5 (4): `nullius-solar-panel-1..4` 100/200/500/800 kW |
| `reactor` / `heat-pipe` | 8 / 4 | 17 (geothermal, thermal tanks, solar collectors) / 4 |
| `electric-energy-interface` | 10 (1: `wind-turbine-2` 15 kW) | 18 (6: wind turbines 1–3, Stirling engines 1–3; output set by script) |
| `accumulator` | 9 | 4 |
| `fusion-*` | 0 | 0 |

**Fuels and fluids:**

- Seablock has 15 `chemical` fuel items (14 visible). Examples: wood 2 MJ, solid-fuel 12 MJ, rocket-fuel 100 MJ, nuclear-fuel 1.21 GJ. `coal` has no `fuel_value` there. There are 7 fluid fuels (4 visible: crude-oil 0.5 MJ, angels-gas-methane 0.5 MJ, angels-liquid-naphtha 0.5 MJ, angels-liquid-fuel-oil 1 MJ).
- Seablock water and steam both have `heat_capacity` 0.2 kJ and `default_temperature` 15.
- Nullius: `nullius-energy` has fuel_value 10 kJ (heat_capacity 0.1 kJ, default 100 °C). Nullius water is 2 kJ.

**What Nullius already covers.** Its boilers and heat exchangers are assembling machines (`boiling`, `pressure-boiling`; `nullius-boiling-*` → `nullius-steam`). Combustion chambers make steam too. Turbines are furnaces (`nullius-burn-{open,closed}-*` → fluid `nullius-energy`, e.g. 335 steam → 201 energy per 1.8 s).

- The missing link is the hidden, script-placed turbine generator inside each turbine. It turns `nullius-energy` into electricity.
- Every generator is capped. Full output is fluid_usage 2/5/11 per tick × 60 × 10 kJ = 1.2/3/6.6 MW, times effectivity (closed 0.85/0.9/0.95, open 0.9/0.95/1). That gives 1.02/1.08, 2.7/2.85 and 6.27/6.6 MW, all above the caps of 1/2.5/6 MW.
- With `scale_fluid_usage`, consumption drops to cap / (10 kJ × eff): 117.65/111.11, 277.78/263.16 and 631.58/600 energy/s.
- The turbine furnaces make 111.67 (open) and 120 (closed) energy/s at speed 1, × 2.4 and × 5.4 for tiers 2 and 3. That matches the capped generators within 0.5 % (open) and about 2 % (closed).
- So the chain steam → turbine row (`nullius-energy`) → generator row (electricity) is correct in game. The generator row count equals the turbine count, because the generator is part of the turbine.
- Seablock exports none of these today. Its boilers and generators are not crafting machines, so the exporter duplicates nothing.

**Arithmetic, checked on the dumps:**

- Vanilla boiler: 1.8 MW / (0.2 kJ × (165 − 15)) = 60 steam/s. Coal at 4 MJ needs 0.45/s; Seablock solid-fuel needs 0.15/s.
- Steam engine: 30/s × 0.2 × 150 = 900 kW. Seablock steam-turbine: 60 × 0.2 × 450 = 5.4 MW. bob-steam-engine-2..5: 1.8/2.7/3.6/4.5 MW. bob-steam-turbine-2/3: 7.2/9 MW.
- bob-oil-boiler: 90 steam/s on 10.8 crude-oil/s.
- Solar: 60 kW × 0.7 = 42 kW.
- Seablock gets 103 recipes: 86 boiler (70 burner-boiler + 16 oil-boiler), 8 generator and 9 solar, on 26 machines. Four heat exchangers are skipped with a warning.
- Nullius would get 22: 18 turbine generators + 4 solar.

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

[spec/data-model.md](../../../spec/data-model.md), [spec/ui.md](../../../spec/ui.md), [spec/overview.md](../../../spec/overview.md) (scope line), [spec/test-synthetic.md](../../../spec/test-synthetic.md), the README repository map and "Using the planner", and this folder's entry in [../README.md](../../README.md).

## Outcome

Phases 0–2 shipped, for the Seablock bundle. `scripts/power.js` exports boilers, fluid generators, burner generators and solar panels as recipes (one per machine and input, category `power:<machine>`) that produce the `power:electricity` pseudo-item, `--patch-power` adds them to an existing bundle, and the UI shows and takes electricity in power units (MW inputs). See [spec/data-model.md](../../../spec/data-model.md#power-generation-recipes) and [spec/ui.md](../../../spec/ui.md).

Deviations from the design above:

- **D1: the Nullius bundle is not regenerated.** The only Nullius dump comes from a different mod set than the bundle (nullius 2.0.3 vs 2.0.4, and the mods directory no longer has 2.0.4), so `--patch-power` fails the mod-set check there. `scripts/power.js` handles the Nullius shapes and has tests for them; regeneration is folded into the Nullius re-dump item of the backlog.
- **D7: no fuel fields in the schema.** Fuel values, fuel categories, burner effectivity and heat capacity are read from the dump and baked into the recipes, not exported as `Item` fields. The burner machines item adds them when something reads them.
- **D8 exception:** a hidden generator with no `minable` result is script-placed (Nullius' turbine generators) and is exported not hidden, so the pickers and the horizon defaults use it.
- **D14: electricity always shows in W / kW / MW / GW** whatever the rate-unit toggle, and its inputs are typed in MW. The areas matrices and the summary overview totals keep MJ per minute or second.

The deferred items above are now backlog items, under [Planning features](../../backlog.md#planning-features), [UI / UX](../../backlog.md#ui--ux) and [Data sets](../../backlog.md#data-sets).
