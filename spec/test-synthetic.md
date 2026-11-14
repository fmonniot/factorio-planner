# Solver Synthetic Test Cases

Fifteen recipe chains of increasing complexity. Cases 1–8 use recipes from the committed
Nullius export (`public/data/nullius/game-data.json`; see the README section
"Exporting game data" for how to regenerate it); case 9 uses the vanilla power
recipes the exporter generates (`scripts/power.js`); case 10 uses vanilla smelting and fuel figures; cases 11 to 15 use plain made-up item ids.

Cases 11 to 15 (made-up ids) are the exception to the Nullius ids: their recipes are only in the fixtures.

These cases are the ground truth for the solver's expected output. They are
automated in `src/solver/synthetic.test.ts`, which uses synthetic fixtures mirroring
the Nullius recipes at crafting speed 1. When a case value changes, update this
file and that test together. Real-data coverage lives separately in
`src/solver/index.integration.test.ts`; these cases must not be pinned to the real data.

All machine counts use **crafting_speed = 1, no modules** unless stated otherwise.
Real default machines have other speeds (e.g. the default `centrifuging` machine),
so to reproduce the machine counts with real data, override each node's `machineId`
with a speed-1 machine (or compare throughput only).

Cases 4–6 use `kovarex-enrichment-process` and `uranium-processing`, which are
base-game recipes marked `hidden: true` in the Nullius export — Nullius players
cannot use them. They are kept because their properties (a cycle, probability
outputs, `ignoredByProductivity`) exercise the solver; they are valid as solver
cases.

Formula: `machineCount = throughput_exec_per_min × craftingTime_s / 60`

Raw resources confirmed: `iron-ore` has no non-packaging non-hidden producer;
`nullius-air` has no recipe at all (pump-only). The synthetic plans contain no extraction rows (mining or offshore pump recipes), so ores and pumped fluids stay raw in every case. In case 9 coal and water stay raw too.

---

## Case 1 — Linear chain with byproduct

**Exercises:** basic stoichiometry, multi-step chain, byproduct on intermediate recipe
(gravel). Nothing consumes gravel, so it is classified as `byproduct` and excluded
from the LP rows.

**Goal:** 60 `nullius-iron-plate` / min

### Recipes

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `nullius-iron-ingot` | dry-smelting | 8s | 5 iron-ore | 2 nullius-iron-ingot + 1 nullius-gravel |
| `nullius-iron-plate` | machine-casting | 3s | 4 nullius-iron-ingot | 3 nullius-iron-plate |

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `nullius-iron-plate` | 20 | 1.000 |
| `nullius-iron-ingot` | 40 | 5.333 |

Raw resources: **iron-ore 200 / min**
Byproduct surplus: **nullius-gravel 40 / min** (classified as byproduct: no consumer, excluded from LP rows)

### Derivation

```
nullius-iron-plate: 60/min ÷ 3 plates/exec = 20 exec/min
  → nullius-iron-ingot demand: 20 × 4 = 80/min

nullius-iron-ingot: 80/min ÷ 2 ingots/exec = 40 exec/min
  → iron-ore: 40 × 5 = 200/min (raw resource)
  → nullius-gravel: 40 × 1 = 40/min (byproduct, no consumer)
```

---

## Case 2 — Shared intermediate

**Exercises:** one intermediate item (`nullius-iron-ingot`) consumed by two downstream
recipes; solver must sum demands correctly before determining upstream throughput.

**Goal:** 30 `nullius-iron-gear` / min

### Recipes

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `nullius-iron-ingot` | dry-smelting | 8s | 5 iron-ore | 2 nullius-iron-ingot + 1 nullius-gravel |
| `nullius-iron-plate` | machine-casting | 3s | 4 nullius-iron-ingot | 3 nullius-iron-plate |
| `nullius-iron-rod` | machine-casting | 4s | 4 nullius-iron-ingot | 5 nullius-iron-rod |
| `nullius-iron-gear` | small-crafting | 4s | 2 nullius-iron-plate + 1 nullius-iron-rod | 2 nullius-iron-gear |

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `nullius-iron-gear` | 15 | 1.000 |
| `nullius-iron-plate` | 10 | 0.500 |
| `nullius-iron-rod` | 3 | 0.200 |
| `nullius-iron-ingot` | 26 | 3.467 |

Raw resources: **iron-ore 130 / min**
Byproduct surplus: **nullius-gravel 26 / min**

### Derivation

```
nullius-iron-gear: 30/min ÷ 2 gears/exec = 15 exec/min
  → nullius-iron-plate demand: 15 × 2 = 30/min
  → nullius-iron-rod demand:   15 × 1 = 15/min

nullius-iron-plate: 30/min ÷ 3 plates/exec = 10 exec/min
  → ingot demand from plates: 10 × 4 = 40/min

nullius-iron-rod: 15/min ÷ 5 rods/exec = 3 exec/min
  → ingot demand from rods: 3 × 4 = 12/min

Total ingot demand: 40 + 12 = 52/min
nullius-iron-ingot: 52/min ÷ 2 ingots/exec = 26 exec/min
  → iron-ore: 26 × 5 = 130/min (raw)
  → gravel:   26 × 1 = 26/min (byproduct)
```

---

## Case 3 — Multi-output recipe

**Exercises:** one recipe producing three outputs; only one is a stated goal;
remaining outputs have no consumer, so they are classified as `byproduct` and
excluded from the LP rows.

**Goal:** 660 `nullius-nitrogen` / min

### Recipes

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `nullius-air-separation-2` | distillation | 1s | 100 nullius-air | 66 nullius-nitrogen + 3 nullius-residual-gas + 30 nullius-carbon-dioxide |

`nullius-air` has no recipe — it is a raw fluid (pumped).

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `nullius-air-separation-2` | 10 | 0.167 |

Raw resources: **nullius-air 1000 / min**
Byproduct surplus: **nullius-residual-gas 30 / min, nullius-carbon-dioxide 300 / min**

### Derivation

```
nullius-air-separation-2: 660/min ÷ 66 nitrogen/exec = 10 exec/min
  → nullius-air: 10 × 100 = 1000/min (raw)
  → residual-gas:    10 × 3  = 30/min  (surplus)
  → carbon-dioxide:  10 × 30 = 300/min (surplus)
```

**Variant (Case 3b) — two simultaneous goals:**
Goals: 660 `nullius-nitrogen`/min + 300 `nullius-carbon-dioxide`/min.
Both satisfied exactly by 10 exec/min — output is identical to Case 3. Confirms the
solver doesn't run two separate recipe instances when two goals share one execution.

---

## Case 4 — Cycle (Kovarex enrichment)

**Exercises:** a recipe where an output item also appears as an ingredient; the solver
must encode net stoichiometry rather than recursing into the output.

**Goal:** 5 `uranium-235` / min (net)

### Recipe

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `kovarex-enrichment-process` | centrifuging | 60s | 40 U-235 + 5 U-238 | 41 U-235 + 2 U-238 |

Net per execution: **+1 U-235, −3 U-238**

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `kovarex-enrichment-process` | 5 | 5.000 |

External import: **uranium-238 15 / min** — reported in `unsatisfied` through
intermediate slack, not the raw-consumption pass: Kovarex both produces and consumes
U-238, so it is classified as an `intermediate`.

### Derivation

```
Net U-235 per exec: 41 − 40 = +1
Throughput: 5/min ÷ 1/exec = 5 exec/min

Net U-238 per exec: 2 − 5 = −3
U-238 import (slack): 5 × 3 = 15/min
```

### Why this tests the solver

A naive recursive walker sees U-235 as both produced and consumed and would loop.
The matrix stoichiometry encodes net values directly:

```
S[U-235][kovarex] = +1    S[U-238][kovarex] = −3
```

Solve x_kovarex = 5 from d[U-235] = 5 in one step.

---

## Case 5 — Probability outputs

**Exercises:** products with `probability < 1`; the solver treats them as expected
values (effective yield = amount × probability).

**Goal:** 1 `uranium-235` / min

### Recipe

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `uranium-processing` | centrifuging | 12s | 10 uranium-ore | 1 U-235 (p=0.007) + 1 U-238 (p=0.993) |

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `uranium-processing` | ≈142.857 | ≈28.571 |

Raw resources: **uranium-ore ≈ 1428.571 / min**
Byproduct surplus: **uranium-238 ≈ 141.857 / min**

### Derivation

```
Effective U-235 yield per exec: 1 × 0.007 = 0.007
Throughput: 1/min ÷ 0.007/exec ≈ 142.857 exec/min

U-238 produced: 142.857 × (1 × 0.993) ≈ 141.857/min
uranium-ore:    142.857 × 10 ≈ 1428.571/min
```

---

## Case 6 — Productivity with `ignored_by_productivity`

**Exercises:** productivity bonus where only the non-fixed portion of a product
scales up; `ignoredByProductivity` units are excluded from the bonus calculation.

**Goal:** 5 `uranium-235` / min (net), with 4× productivity-module-3 per machine
(+0.10 productivity per module = **+0.40 total**).

### Kovarex product breakdown with productivity

`ignoredByProductivity` on outputs:
- U-235: `amount=41`, `ignoredByProductivity=40` → only 1 unit scales
- U-238: `amount=2`,  `ignoredByProductivity=2`  → no units scale

```
effective_output = ignoredByProductivity
                 + (amount − ignoredByProductivity) × (1 + productivityBonus)

U-235: 40 + (1 × 1.40) = 41.40 per exec
U-238:  2 + (0 × 1.40) =  2.00 per exec  (fully fixed — productivity has no effect)
```

Net per execution: **U-235 +1.40, U-238 −3.00**

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `kovarex-enrichment-process` | ≈3.571 | ≈8.929 |

External import: **uranium-238 ≈ 10.714 / min** (intermediate slack, as in Case 4)

Four vanilla `productivity-module-3` modules (`speed` −0.15 each) slow the machine by 60%
(effective speed 0.4), so the machine count is the throughput divided by 0.4
(3.571 / 0.4 ≈ 8.929), not the throughput itself. Nullius's own
`nullius-productivity-module-3` has no speed penalty and would leave the count at 3.571.

### Derivation

```
Throughput: 5/min ÷ 1.40 net U-235/exec ≈ 3.571 exec/min
U-238 import (slack): 3.571 × 3 ≈ 10.714/min
Machine count: 3.571 exec/min × 60 s ÷ 60 ÷ (1 − 4 × 0.15) = 3.571 ÷ 0.4 ≈ 8.929
```

Compared to Case 4 (no modules): throughput 5.000 → 3.571 (−29%),
U-238 consumption 15 → 10.714 (−29%). Productivity reduces both proportionally
because U-238's `ignoredByProductivity` covers all its output — it is unaffected.
The machine count goes the other way, 5 → 8.929, because the speed penalty outweighs the lower throughput.

---

## Case 7 — Intermediate built in two areas

**Exercises:** areas. A recipe built in two areas gets a full row in each; each area's own row for an item serves it first, an area without one takes from the area highest in the table, and every row is rounded up on its own.

**Goal:** 60 `nullius-iron-gear` / min

Recipes are those of Case 2. Layout (the sub-factories after Top level are separate areas):
- **Top level** (the block's root): `nullius-iron-gear`, `nullius-iron-ingot`
- **Plate line** (area): `nullius-iron-plate`, `nullius-iron-ingot`
- **Rod line** (area): `nullius-iron-rod`

### Expected solver output

| Row | Throughput (exec/min) | Machine count (exact) | Buildings |
|---|---|---|---|
| `nullius-iron-gear` (Top level) | 30 | 2.000 | 2 |
| `nullius-iron-plate` (Plate line) | 20 | 1.000 | 1 |
| `nullius-iron-rod` (Rod line) | 6 | 0.400 | 1 |
| `nullius-iron-ingot` (Plate line) | 40 | 5.333 | 6 |
| `nullius-iron-ingot` (Top level) | 12 | 1.600 | 2 |

Raw resources: **iron-ore 260 / min** (Top level 60, Plate line 200). Gravel: 12 + 40 / min.

| Area | Receives | Sends |
|---|---|---|
| Top level | plate 60, rod 30, iron-ore 60 (from outside) | gear 60 (leaves the block), ingot 24, gravel 12 (leaves the block) |
| Plate line | iron-ore 200 (from outside) | plate 60, gravel 40 (leaves the block) |
| Rod line | ingot 24 | rod 30 |

### Derivation

```
nullius-iron-gear: 60/min ÷ 2 gears/exec = 30 exec/min (2.000 machines)
  → plate demand 60/min, rod demand 30/min (both come from another area)
nullius-iron-plate: 60/min ÷ 3 = 20 exec/min (1.000) → ingot demand 80/min
nullius-iron-rod:   30/min ÷ 5 = 6 exec/min (0.400)  → ingot demand 24/min

Plate line has its own ingot row, so it serves its 80/min first: 80 ÷ 2 = 40 exec/min (5.333 machines, 6 buildings).
Rod line has no ingot row. Ingot costs the same to make in Top level and in Plate line,
and the tie goes to the area higher in the table: Top level makes 24 ÷ 2 = 12 exec/min (1.600 machines, 2 buildings).
```

Total ingot is 52 exec/min, as in one area (6.933 machines, 7 buildings), but split into two rows it needs 6 + 2 = 8 buildings.

---

## Case 8 — Byproducts first

**Exercises:** the per-item rule `sourceRules[item] = { makeHere: 'off' }`. An item set to it is imported rather than made by a recipe that would run only for it; what recipes make anyway is used first.

**Goals:** 800 `nullius-hydrogen` / min and 125 `nullius-acid-nitric` / min

Recipes (all crafting time 1 s; the coefficients and item ids are those of the Nullius export, on synthetic fixtures):
- `nullius-steam-electrolysis` (`nullius-electrolysis`): 2000 steam → 800 hydrogen + 400 oxygen
- `nullius-decompress-oxygen` (decompression): 125 compressed oxygen → 500 oxygen
- `nullius-acid-nitric` (basic chemistry): 20 oxygen + 10 ammonia → 5 nitric acid

### Expected solver output

| | Electrolysis | Nitric acid | Decompression | Imports |
|---|---|---|---|---|
| Default | 1 | 25 | 0.2 | compressed oxygen 25 |
| `nullius-oxygen` byproducts first | 1 | 25 | 0 | oxygen 100 |

Both runs use the same steam and ammonia (imports) and raise no `overconstrained` warning.

### Derivation

```
Hydrogen 800/min needs 1 electrolysis run/min, which makes 400 oxygen as a side product.
Nitric acid 125/min ÷ 5 = 25 runs/min, which needs 500 oxygen: 100 more than the electrolysis makes.

Default: decompression at 0.2 runs/min (cost 0.2) makes the 100 oxygen from 25 compressed oxygen,
cheaper than 0.25 extra electrolysis runs (hydrogen would be left over), so it runs.
Byproducts first on oxygen: importing 100 oxygen costs 100 × 1e-5 = 1e-3, below the 0.2 of a decompression run,
so the decompression stays idle and the 100 oxygen is an import.
```

---

## Case 9 — Power generation

**Exercises:** the electricity pseudo-item and the exporter-generated power recipes (`power: true`, category `power:<machine>`, `craftingTime` 1). The machines are speed-1 generation machines with `energyUsageKw` 0 and `energyType: 'void'`, so a machine count is a building count and no power is drawn.

**Goal:** 600 `power:electricity` / min (10 MW)

Recipes (vanilla figures, per second per building; the item ids and coefficients are those the exporter produces, on synthetic fixtures):
- `power:boiler:coal` (`power:boiler`): 60 water + 0.45 coal → 60 steam (1.8 MW / (0.2 kJ × 150 °C) = 60 steam, 1.8 MW / 4 MJ = 0.45 coal)
- `power:steam-engine:steam` (`power:steam-engine`): 30 steam → 0.9 electricity (30 × 0.2 kJ × 150 °C = 900 kW)

### Expected solver output

| Row | Throughput | Machines (exact / ceil) | Power |
|---|---|---|---|
| Steam engine | 666.667 | 11.111 / 12 | `powerKw` 0 |
| Boiler | 333.333 | 5.556 / 6 | `powerKw` 0 |

Steam is balanced at 20000 / min. The unsatisfied inputs are coal 150 / min and water 20000 / min. No warnings.

### Derivation

```
Electricity 600/min ÷ 0.9 per run = 666.667 engine runs/min; × 30 = 20000 steam/min.
Steam 20000/min ÷ 60 per run = 333.333 boiler runs/min.
Coal = 333.333 × 0.45 = 150/min; water = 333.333 × 60 = 20000/min.
Machines = runs/min × 1 s / 60: 11.111 engines (12 buildings), 5.556 boilers (6 buildings).
```

---

## Case 10 — Burner fuel

**Exercises:** a burner row's fuel as an ingredient (`NodeEffects.fuel`, `rowIngredients`; see [solver.md](solver.md#burner-fuel)). Vanilla figures on synthetic fixtures: `stone-furnace` (speed 1) and `steel-furnace` (speed 2), both burners at 90 kW accepting the `chemical` category; `coal` 4 MJ and `solid-fuel` 12 MJ. Case 10d adds a `fluid-furnace` (speed 1, 90 kW, `fluid-burner`) and the fluids `fuel-gas` 300 kJ / unit and `heavy-fuel` 1200 kJ / unit.

**Goal:** 60 `iron-plate` / min

Recipes:
- `iron-plate` (`smelting`, 3.2 s): 1 iron ore → 1 iron plate
- `solid-fuel-from-light-oil` (`chemistry`, 2 s): 10 light oil → 1 solid fuel

### Expected solver output

| Case | Row setup | Furnaces (exact) | Fuel burnt | Other |
|---|---|---|---|---|
| 10a | stone furnaces, default fuel | 3.2 | 0.072 coal / execution = 4.32 coal / min | `powerKw` 0; coal is an unsatisfied input |
| 10b | steel furnaces on solid fuel, `solid-fuel-from-light-oil` in the plan | 1.6 | 0.012 solid fuel / execution = 0.72 / min | `powerKw` 0; light oil 7.2 / min is the only raw input besides ore |
| 10c | as 10a, one module with +20 % speed and +50 % consumption | 2.667 | 0.09 coal / execution = 5.4 coal / min | |
| 10d | `fluid-furnace`, default fuel; then the same with `fuelItemId` `heavy-fuel` | 3.2 | 0.96 fuel gas / execution = 57.6 / min; with heavy fuel 0.24 / execution = 14.4 / min | `powerKw` 0; the fluid is an unsatisfied input |

The default fuel is the lowest-value accepted fuel (inside the horizon; case 10 has none), so 10a burns coal; 10b sets `fuelItemId` to solid fuel; 10d burns the lowest-value fluid (fuel gas) by default. No warnings.

### Derivation

```
Plates 60/min at 1 per run = 60 executions/min.
10a: machines = 60 × 3.2 / 60 = 3.2; fuel per run = 90 kW × 3.2 s / 4000 kJ = 0.072; × 60 = 4.32/min.
10b: machines = 60 × 3.2 / 60 / 2 = 1.6; fuel per run = 90 × 3.2 / 2 / 12000 = 0.012; × 60 = 0.72/min.
     Solid fuel 0.72/min = 0.72 runs/min of the 2 s recipe: light oil = 0.72 × 10 = 7.2/min.
10c: machines = 60 × 3.2 / 60 / 1.2 = 2.667; fuel per run = 90 × 1.5 × 3.2 / 1.2 / 4000 = 0.09; × 60 = 5.4/min.
10d: machines = 3.2; fuel per run = 90 kW × 3.2 s / 300 kJ per unit = 0.96 units; × 60 = 57.6/min. With heavy fuel: 90 × 3.2 / 1200 = 0.24; × 60 = 14.4/min.
```

---

## Case 11 — Spare output before connections

**Exercises:** `sourceRules[item] = { makeHere: 'after-blocks' }` with a connection. A connections-first item uses what the block's rows already make of it before its connected supply, so the connection delivers only the deficit (`blockDiagnostics`, `src/solver/blockResult.ts`; the area solve calls the same function).

**Goals:** 30 `case11-goal` / min and 50 `case11-other` / min. `case11-x` is connections-first, with one connection from another block.

Recipes (all crafting time 1 s, plain ids):
- A, `case11-make-goal`: 1 ore → 1 goal + 1 X. It runs for the goal; X does not decide how much it runs.
- U, `case11-use-x`: 1 X → 1 other.
- R, `case11-make-x`: 1 feed → 2 X. It can make X; at 2 X per run it is cheaper than running A harder for X (at 1 X per run the two would tie).

### Expected solver output

A runs 30 / min, so it makes 30 X / min, and U uses 50 X / min: the deficit is 20 X / min.

| Case | Offer on the connection | Received | R runs for X | Why |
|---|---|---|---|---|
| a | 100 | 20 | no (0 / min) | Guaranteed: received is `min(offer, 50 − 30)`. R idle is observed: supply costs 0 against 1 per run |
| b | unlimited (`Infinity`, the request probe) | 20 | no (0 / min) | Guaranteed, same clamp; a request therefore asks the source for 20. R idle is observed |
| c | 5 | 5 | yes, 7.5 / min (the other 15 X) | Received is guaranteed; that R covers the rest instead of an import is observed |

Each case runs twice: with no areas, and with areas where A is in an area other than U (and R). The numbers are the same. In every case X is not imported.

### Derivation

```
A: 30 goal/min ÷ 1 = 30 runs/min → 30 X/min made on the side.
U: 50 other/min ÷ 1 = 50 runs/min → 50 X/min used.
Deficit after own production: 50 − 30 = 20 X/min.
a, b: supply (cost 0) covers the 20; no recipe has to run for X.
c: supply is 5; 15 X/min left. R at 2 X per run: 7.5 runs/min (cost 7.5), against 15 extra runs of A (cost 15).
```

---

## Case 12 — Don't make more here, Import off

**Exercises:** `sourceRules[item] = { makeHere: 'off', importOff: true }` with and without a connection. The item keeps the cheap slack of *Byproducts first*, so no row runs for it, and the slack is read as the amount **missing** (`unsatisfied`), not as an import. The solve is the one of case 11's item with `{ makeHere: 'off' }` alone (Import on); only the name of the rest changes.

**Goals:** 30 `case11-goal` / min and 50 `case11-other` / min, on the plan of case 11 (A, U and R, with A in an area of its own in the second run). `case11-x` has the rule above and, in b to d, one connection from another block.

### Expected solver output

As in case 11, A runs 30 / min and makes 30 X / min on the side, and U uses 50 X / min: the deficit is 20 X / min.

| Case | Offer on the connection | Received | R runs for X | X missing (`unsatisfied`) | Why |
|---|---|---|---|---|---|
| a | no connection | 0 | no (0 / min) | 20 | Guaranteed: nothing can cover the deficit, and the block does not make X for itself |
| b | 100 | 20 | no (0 / min) | 0 | Guaranteed: received is `min(offer, 50 − 30)` |
| c | unlimited (`Infinity`, the request probe) | 20 | no (0 / min) | 0 | Same clamp; a request therefore asks the source for 20 |
| d | 5 | 5 | no (0 / min) | 15 | Received is guaranteed; that R stays idle is the point of the rule (it would cover the 15 under case 11's rule) |

Each case runs twice: with no areas, and with areas where A is in an area other than U (and R). The numbers are the same. With `{ makeHere: 'off' }` alone (Import on) the same plan solves to the same numbers and reads the 20, 0, 0 and 15 X / min as imports. With `{ importOff: true }` alone, or with `{ makeHere: 'after-blocks', importOff: true }`, the item keeps its hard row instead: R runs for X.

### Derivation

```
A: 30 goal/min ÷ 1 = 30 runs/min → 30 X/min made on the side.
U: 50 other/min ÷ 1 = 50 runs/min → 50 X/min used.
Deficit after own production: 50 − 30 = 20 X/min.
X is in the byproducts-first set and out of the no-import set: its slack costs 1e-5 per item, a run of R costs 1 per run.
a: no supply, so the 20 X/min stay in the slack. R at 2 X per run would cost 10 > 20 × 1e-5, so it stays idle: 20 missing.
b, c: supply (cost 0) covers the 20: received 20, nothing missing.
d: supply is 5; the other 15 X/min stay in the slack (15 × 1e-5 < 7.5): 15 missing.
```

---

## Case 13 — A source that holds its capacity

**Exercises:** the elastic goals of [solver.md](solver.md#infeasibility). A pinned row is the only producer of a goal item; when the pin cannot meet the goal, the plain LP is infeasible and the elastic solve keeps the pin, so the goal reports what it lacks. Then the same source in `solveAll`, short of its extra plus two requests (the example of [solver.md, Shortfall](solver.md#requests)).

**Recipes** (crafting time 1, speed-1 machine):

| Recipe | Ingredients | Products |
|---|---|---|
| `case13-make-plate` | 1 `case13-ore` | 1 `case13-plate` |
| `case13-use-plate` | 1 `case13-plate` | 1 `case13-gear` |

### Expected solver output

a to c: one block, its only row `case13-make-plate` pinned, a goal of `case13-plate`. Each runs with no areas, and with the row in an area of its own; the numbers are the same.

| Case | Pin | Goal | Row runs at | Plate short (`unsatisfied`) | `infeasible-pins` |
|---|---|---|---|---|---|
| a | 10 | 30 | 10 | 20 | yes |
| b | 10 | 10 | 10 | 0 | no |
| c | 40 | 30 | 40 | 0 | no |

d: `solveAll` with three blocks. A has an extra of 10 `case13-plate` / min and the row pinned at 45. B (30 gear / min) and C (20 gear / min) each run `case13-use-plate` and request plate from A; B is solved first.

| Block | Asked of A | Gets | Status | Plate short or imported |
|---|---|---|---|---|
| A | | makes 45 of 60 | | 15 short, `infeasible-pins` |
| B | 30 | 30 | `ok` | 0 |
| C | 20 | 15 | `limited` | 5 imported |
| A's extra | 10 | 0 | | |

### Derivation

```
a: goal row x ≥ 30 and pin x = 10 conflict: the plain LP is infeasible.
   Elastic: x + h ≥ 30, x = 10. Step 1 minimises h: h = 20. Step 2 keeps h ≤ 20 (+1e-7) at BIG_M per unit: h = 20.
   The row runs at its pin, 10; the plate is short by 30 − 10 = 20.
b: x = 10 meets x ≥ 10: feasible, no second solve.
c: x = 40 meets x ≥ 30: feasible; a goal may be overshot, so no warning.
d: requests: B asks 30, C asks 20; A's goal is 10 + 30 + 20 = 60, the pin makes 45, A is short by 15.
   B (solved first, share 30): min(30, 45) = 30. Left 15.
   C (share 20): min(20, 15) = 15; C imports the other 5 and its flow is limited.
   The extra is never reserved, so it gives way first: nothing is left for it.
```

---

## Case 14 — Served order of a byproduct

**Exercises:** a source's served list on an item it has left over (takes). Credits by rank, grants by rank, the result not depending on tab order, and a takes-first consumer that asks its other source for what a higher-ranked take leaves it.

**Recipes:** case 11's (time 1, speed 1).

- `case11-make-goal`: 1 ore → 1 goal + 1 `case11-x`
- `case11-use-x`: 1 X → 1 `case11-other`
- `case11-make-x`: 1 feed → 2 X

### Blocks

- **T**: goal 30, row make-goal.
- **H1**: other 20, row use-x, takes X from T (`c-H1`).
- **H2**: other 25, row use-x, takes X from T (`c-H2`).
- X is raw in H1 and H2.

### Expected solver output

| Case | Tabs | List on T's X | H1 gets | H2 gets |
|---|---|---|---|---|
| a | T, H1, H2 | none | 20 `ok` | 10 `limited`, 15 imported |
| a | T, H2, H1 | none | 5 `limited`, 15 imported | 25 `ok` |
| b | both | H2, H1 | 5 `limited`, 15 imported | 25 `ok` |
| b | both | H1, H2 | 20 `ok` | 10 `limited`, 15 imported |

T runs make-goal at 30. No warnings in any block. For b with list (H2, H1), `served.T['case11-x']` is H2 {take, share 25, got 25}, then H1 {take, share 5, got 5}, no extra.

**c (takes first):** tabs T, A, H, B.

- **A**: product `case11-x` with no extra output, row make-x.
- **H**: other 20, takes X from T (`c-H`).
- **B**: other 25. Its connections are, in this order, `c-BT` (takes X from T) and `c-BA` (requests X from A).

| List on T's X | H | B from T | B from A (`requested`) | A runs make-x |
|---|---|---|---|---|
| none | 5 `limited`, 15 imported | 25 `ok` (share 25) | 0, `unused` (0) | empty result |
| H, B | 20 `ok` (share 20) | 10 `ok` (share 10) | 15 `ok` (15) | 7.5 (7.5 feed) |

B imports nothing in either row.

### Derivation

```
T: 30 goal/min ÷ 1 = 30 runs → 30 X/min on the side; nothing in T uses X, so T offers 30.
H1 uses 20 X/min, H2 25: 45 in all, 15 more than T offers.
a: nothing is requested or credited. The consumer solved first takes what it needs (offer 30);
   the second gets what is left (10 or 5) and imports the rest (15).
b (H2, H1): request pass: T is probed (leftover 30). H2, rank 1, needs 25: credit min(30, 25) = 25.
   H1 is processed after H2 (rank edge): needs 20, credit min(30 − 25, 20) = 5.
   Supply: T offers 30; grants down the list: H2 min(25, 30) = 25, H1 min(5, 5) = 5; all 30 are held.
   Each consumer is offered its grant whichever is solved first: H2 25, H1 5.
   (H1, H2): credits 20, then min(10, 25) = 10; grants 20 and 10.
c, no list: H requests nothing, so only B is credited: min(30, 25) = 25. B asks A for 0, so A has no goal.
   25 of T's 30 are reserved for B, so H (solved before B) is offered 30 − 25 = 5.
c, list H, B: H is credited first: min(30, 20) = 20. B: min(30 − 20, 25) = 10, so B asks A for 15:
   A runs make-x at 15 ÷ 2 = 7.5. Grants: H 20, B 10. B's 25 = 10 from T + 15 from A.
```

---

## Case 15 — Served order of a short product

**Exercises:** grants by rank of requests and of the extra, on a source that holds its pin (case 13). The tabs no longer decide who is short. Entries that do not apply are ignored. Consumers not in the list are served after it, in solve order.

**Recipes:** case 13's.

### Blocks

- **A**: plate, extra 10; row make-plate pinned at 45.
- **B, C** (and **D** in g): gear 30, 20 (10). Each runs use-plate and requests plate from A (`c-B`, `c-C`, `c-D`).
- **E**: gear 5, use-plate, no connection.

### Expected solver output

`requested`: B 30, C 20, D 10. A runs at 45 in every case and carries `infeasible-pins ['case13-make-plate']`. A's plate shortfall is 15 (25 in g).

| Case | Tabs | List on A's plate | B | C | D | A's extra got (`place`) |
|---|---|---|---|---|---|---|
| a | A, B, C | none | 30 `ok` | 15 `limited`, 5 imported | | 0 (2) |
| b | A, C, B | none | 25 `limited`, 5 imported | 20 `ok` | | 0 (2) |
| c | both | B, C | 30 `ok` | 15 `limited`, 5 imported | | 0 (2) |
| d | both | C, B | 25 `limited`, 5 imported | 20 `ok` | | 0 (2) |
| e | both | B, extra, C | 30 `ok` | 5 `limited`, 15 imported | | 10 (1) |
| f | A, B, C, E | E, ghost, C, B | as d | as d | | 0 (2) |
| g | A, B, C, D | none | 30 `ok` | 15 `limited`, 5 imported | 0 `limited`, 10 imported | 0 (3) |
| g | A, B, C, D | D | 30 `ok` | 5 `limited`, 15 imported | 10 `ok` | 0 (3) |

`served.A.plate.consumers` order: a: B, C. b: C, B. c: B, C. d: C, B. e: B, C. f: C, B (no E). g with no list: B, C, D. g with list D: D, B, C. `share` is always the request (30, 20, 10). `got` is the rate. Case d with tabs A, C, B is the mock of the sourcing-priority initiative: Science (B) 30 got 30, Hub (C) 20 got 15, short 5, extra 0.

Note: d with tabs A, B, C is "solved first, ranked last". c is a list in today's order and changes nothing.

### Derivation

```
A's goal is 10 + 30 + 20 = 60 (70 in g). The pin makes 45, so A is short by 15 (25 in g).
No list: requests are served in solve order and the extra gives way first:
  a: B min(30, 45) = 30, C min(20, 15) = 15.   b: C min(20, 45) = 20, B min(30, 25) = 25.
List: A's 45 is granted down the order when A is solved. Each consumer is offered its grant plus what
no grant holds (nothing here: the grants hold all 45), whichever is solved first.
  c (B, C): B 30, C min(20, 15) = 15.
  d (C, B): C 20, B min(30, 25) = 25.
  e (B, extra, C): B 30; the extra holds min(10, 15) = 10; C min(20, 5) = 5.
     The 10 held stays on A: extra got 10, place 1.
  f: E takes no plate from A and ghost is no block, so both are ignored; the list is C, B (d).
  g, list D: D min(10, 45) = 10, then B and C (not listed) in solve order: B min(30, 35) = 30, C min(20, 5) = 5.
  g, no list: B 30, C min(20, 15) = 15, D min(10, 0) = 0.
```
