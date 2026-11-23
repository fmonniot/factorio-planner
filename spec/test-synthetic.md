# Solver Synthetic Test Cases

Twenty-nine recipe chains of increasing complexity. Cases 1–8 use recipes from the committed
Nullius export (`public/data/nullius/game-data.json`; see the README section
"Exporting game data" for how to regenerate it); case 9 uses the vanilla power
recipes the exporter generates (`scripts/power.js`); case 10 uses vanilla smelting and fuel figures; cases 11 to 29 use plain made-up item ids.

Cases 11 to 25 (made-up ids) are the exception to the Nullius ids: their recipes are only in the fixtures.

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

---

## Case 16 — Served order inside a loop of blocks

**Exercises:** a served list on a source that is a member of a loop of blocks (the supply rounds). Grants once per round, from the offer that round reads; the member order never changes; the result not depending on tab order.

**Recipes:** time 1, category smelting, X = `case16-x`, Y = `case16-y`.

- `case16-make`: 1 Y → 1 `case16-goal` + 1 X
- `case16-use`: 1 X → 1 `case16-other` + 1 Y

### Blocks

- **S**: goal 30, row make. Connections, in this order: `c-S1` takes Y from C1, `c-S2` takes Y from C2. Its list is on X.
- **C1**: other 20, row use, `c-1` takes X from S.
- **C2**: other 25, row use, `c-2` takes X from S.

### Expected solver output

| Tabs | `loops[0].blockIds` | List on S's X | C1 gets | C2 gets |
|---|---|---|---|---|
| S, C1, C2 | S, C1, C2 | none | 20 `ok` | 10 `limited`, 15 imported |
| C1, C2, S | C1, S, C2 | none | 20 `ok` | 10 `limited`, 15 imported |
| C2, C1, S | C2, S, C1 | none | 5 `limited`, 15 imported | 25 `ok` |
| each of the three | as above | C2, C1 | 5 `limited`, 15 imported | 25 `ok` |
| each of the three | as above | C1, C2 | 20 `ok` | 10 `limited`, 15 imported |

In every row S runs make at 30 and imports nothing, `c-S1` is 20 `ok` and `c-S2` is 10 `ok`, `loops[0]` has `rounds: 2` and `converged: true`, and no block has a warning. With list (C2, C1), `served.S['case16-x']` is C2 {take, share 25, got 25}, then C1 {take, share 5, got 5}, no extra; with (C1, C2) it is C1 {20, 20}, then C2 {10, 10}. A warm solve (one `SolveCache`, tabs C1, C2, S, list C2, C1) reuses every result object: a probed loop member does not need a fourth cache slot.

**d (a round limit of 1):** add **C3** (other 25, `c-3` takes X from S; `c-S3` takes Y from C3), tabs C1, C2, C3, S, list (C3, C2, C1), `loopRoundLimit: 1`. The loop is C1, S, C2, C3 (not converged, 1 round). C1 reads S over a back connection, so round 1 has no previous offer and the credits stay reserved: C3 min(30, 25) = 25, C2 min(30 − 25, 25) = 5, C1 0. C2 is solved before C3 and is offered its reserve 5 plus what nobody reserves (30 − 25 − 5 = 0): `c-2` 5, then `c-3` 25. (With no reservation in round 1, C2 would take 25 and C3 get 5.)

**e (requests in one group, S pinned):** S also has product X (extra 0), so C1 and C2 request X from S (`c-1`, `c-2`, requested 20 and 25), and S's row is pinned at 30: the source is short and S carries `infeasible-pins`. Tabs and loop members as in the table; the list on S's X is a group.

| List on S's X | C1 gets | C2 gets |
|---|---|---|
| e1: {C1, C2} | 15 `limited`, 5 imported | 15 `limited`, 10 imported |
| e2: {C1 80, C2 20} | 20 `ok` | 10 `limited`, 15 imported |
| e3: {C1 20, C2 80} | 6 `limited`, 14 imported | 24 `limited`, 1 imported |

Same in the three tab orders, `rounds: 2`, `converged: true`, S makes 30, `c-S1` 20 `ok` and `c-S2` 10 `ok` (C1 and C2 make 20 and 25 Y for their goals whatever X they get, so S's 30 Y come 20 from C1 then 10 from C2). e1: 30 left, 15 each, both lack more. e2: offers 24 and 6; C1 lacks 20 and is covered; C2 takes 6; 4 is left and goes to C2: 10. e3: offers 6 and 24, both short, nothing left. `served.S['case16-x']` is C1 {request, share 20}, C2 {request, share 25}, no extra.

### Derivation

```
S: 30 runs → 30 X/min on the side (S uses none), 30 Y/min used (Y is raw in S). C1: 20 X used (raw), 20 Y made; C2: 25 X, 25 Y.
X: 30 on offer, 45 wanted. Y: 45 on offer, 30 wanted, taken in S's connection order: c-S1 20, c-S2 10. No block's rows depend on
what it receives, so offers are the same every round; round 1 reads 0 on the back connections, so the loop settles in round 2.
Member order: tabs S, C1, C2 → S, C1, C2 (c-S1, c-S2 back). C1, C2, S → C1, S, C2 (c-1, c-S2 back).
C2, C1, S → C2, S, C1 (c-2, c-S1 back).
a (no list): the consumer of X solved first takes what it needs. S, C1, C2 and C1, S, C2: C1 20; C2 gets 10, imports 15.
   (C1, S, C2: in round 2, C1 reads S's round-1 offer 30 and takes 20; C2 gets 30 − 20 = 10.) C2, S, C1: C2 25; C1 5, imports 15.
b (C2, C1): request pass (no requests; rank edges S→C2, S→C1, C2→C1): S probed, leftover X 30. C2 needs 25: credit
   min(30, 25) = 25. C1 needs 20: credit min(30 − 25, 20) = 5. Grants from 30: C2 25, C1 5; all 30 held.
   S, C1, C2: no consumer of X before S, so grants when S is solved: C1 is offered max(0, min(5, 30), 30 − (30 − 5)) = 5, C2 25.
   C1, S, C2 (C1 reads S over a back connection): grants at round start from S's previous-round offer. Round 1: 0 → no grants,
   pending 0: C1 gets 0, C2 takes 25. Round 2: from 30: C2 25, C1 5. C1 is offered 5 of 30; C2 25 of the 25 left.
   C2, S, C1: round 2 grants C2 25, C1 5; C2 takes 25, C1 is offered 5 of the 5 left.
   Every order: C1 5 (imports 15, limited), C2 25 ok.
c (C1, C2): credits C1 min(30, 20) = 20, C2 min(10, 25) = 10; grants 20, 10, whatever the order: C1 20 ok, C2 10 limited, 15 imported.
```

---

## Case 17 — Served order inside a cycle of requests

**Exercises:** a served list on a take source whose consumers are the members of a cycle of requests (the demand rounds). Credits by rank in each round, back credits, the member order never changing, an unsettled cycle, and the cycle memo.

**Recipes:** case 11's (X = `case11-x`), time 1, category smelting, plus:

- `case17-make-p`: 1 X → 1 `case17-p`
- `case17-use-q`: 1 `case17-q` → 1 `case17-r`
- `case17-make-q`: 1 X → 1 `case17-q`
- `case17-use-p`: 1 `case17-p` → 1 `case17-s`

### Blocks

- **T**: goal 15, row make-goal. Its list is on X.
- **V**: product X (extra 0), row make-x.
- **K1**: products r 10 and p 0; rows make-p, use-q. Connections, in this order: `c-K1T` takes X from T, `c-K1V` requests X from V, `c-K1q` requests q from K2.
- **K2**: products s 10 and q 0; rows make-q, use-p. Connections, in this order: `c-K2T` takes X from T, `c-K2V` requests X from V, `c-K2p` requests p from K1.

### Expected solver output

| Tabs | `requestLoops[0].blockIds` | List on T's X | `c-K1T` | `c-K1V` requested / rate | `c-K2T` | `c-K2V` requested / rate |
|---|---|---|---|---|---|---|
| T, V, K1, K2 | K1, K2 | none | 10 | 0 / 0 `unused` | 5 | 5 / 5 |
| T, V, K2, K1 | K2, K1 | none | 5 | 5 / 5 | 10 | 0 / 0 `unused` |
| both | as above | K2, K1 | 5 | 5 / 5 | 10 | 0 / 0 `unused` |
| both | as above | K1, K2 | 10 | 0 / 0 `unused` | 5 | 5 / 5 |

In every row the T flows and the non-zero V flows are `ok`, `c-K1q` and `c-K2p` are requested 10 at rate 10, V runs make-x at 2.5, `requestLoops[0]` has `rounds: 2` and `converged: true`, and K1 and K2 import no X and have no warnings. `served.T['case11-x']` shares equal the T rates above, consumers in list order; with no list they are in member order.

**d (an unsettled cycle):** add **K3**: s 5, row use-p, `c-K3p` requests p from K1. Tabs T, V, K1, K2, K3, `requestRoundLimit: 1`, no list on T; K1's list on p is absent, (K2, K3) or (K3, K2). `requestLoops[0]` is `{ converged: false, rounds: 1 }`. `c-K2p` is a take with `requestIgnored: 'request-loop'`, rate 0, `limited`; `c-K3p` is requested 5, rate 5, `ok`. The flows are equal in the three runs and `served.K1['case17-p']` follows the list (K2, K3 when absent).

**f (back credits in an unsettled cycle):** add **K3**: s 10, row use-p, `c-K3p` requests p from K1 (10 X). Tabs T, V, K1, K2, K3, list (K2, K1) on T, `requestRoundLimit: 1`. Round 1 reads K2's back credit as 0, so K1 is credited min(15, 10) = 10 and K2 10, 20 of T's 15. The fallback round reads K2's credit (10, from the last round) as K1's back credit: K1 min(15 − 10, 10) = 5 and asks V for the other 5, K2 10 and asks V nothing. `c-K1T` 5, `c-K1V` requested 5 at rate 5, `c-K2T` 10, `c-K2V` requested 0; neither imports X.

**e (a list never changes member order):** as the main case, except that K1 has no `c-K1V` and takes X from **W** (`c-K1W`), W being goal 5, row make-goal, with a list on its X: (K1). Tabs T, V, W, K1, K2. Without the list the cycle is K2, K1 (only K2 has an outside input); with it `requestLoops[0].blockIds` and `backConnectionIds` are the same.

### Derivation

```
T leaves 15 X. Settled demand: K1 makes p 10 for K2 (10 X), K2 makes q 10 for K1 (10 X): 20 X wanted. Each covers X first
by its take of T (takes first), then by its request to V. Request pass: T, the cycle {K1, K2}, then V. The cycle starts at
the first member in tab order with an outside input (both take from T): K1, K2 for tabs T, V, K1, K2 (back c-K2p);
K2, K1 for T, V, K2, K1 (back c-K1q). Round 1 reads 0 on the back request, so the first member's product is not a goal yet
(0 X needed); the second needs 10. Round 2: both need 10; the back share stays 10, so it settles in round 2.
a (no list): T's 15 is credited in member order: first member 10, second min(5, 10) = 5, which asks V for 5.
b (K2, K1), tabs T, V, K1, K2 (K2, the second member, ranked first): K1 reads K2's previous-round credit (a back credit).
   R1: K1 0 X → no credit; K2 min(15, 10) = 10. R2: K1 min(15 − 10, 10) = 5, asks V 5; K2 10. Back share 10 and back credit 10
   unchanged: settled in 2. Tabs T, V, K2, K1: R1: K2 0 X; K1 min(15 − 0, 10) = 10 (K2 credited 0 this round).
   R2: K2 10; K1 min(5, 10) = 5, asks V 5. Settled in 2 (no back credit here).
c (K1, K2): the mirror image: K1 10, K2 5 (asks V 5), whatever the tabs.
Supply: V makes 5 X (2.5 runs). T grants 15 down the list (b: K2 10, K1 5; c: K1 10, K2 5) or, with no list, serves the
credits (same numbers). Each consumer gets its credit from T and its request from V; K1 gets q 10 from K2, K2 gets p 10
from K1; nothing is imported.
d: K3 asks 5. Round 1 does not settle (out 10, in 0), so it is kept with c-K2p taking existing output. K1 makes only 5 p, all
   of K3's share. K2's grant is 0, and connectionOffer(5, 5, 0) = 0.
e: a list never changes member order: the list's edge W → K1 would make K1 an entry (tab order puts it first), giving K1, K2.
   The shape is taken before the list's edges.
```

## Case 18 — Shares on a short product

**Exercises:** `tied` groups and shares on a ranked pair: the water-fill inside a group, a covered member's spare going round again, the extra as a member, the tab order never mattering.

**Recipes:** case 13's (`case13-make-plate`, `case13-use-plate`; plate = `case13-plate`).

### Blocks

Case 15's: **A** makes plate, extra 10, its row pinned at 45 (so it carries `infeasible-pins`), a list on plate; **B**, **C**, **D** make 30, 20 and 10 `case13-gear` with `case13-use-plate` and request plate from A (`c-B`, `c-C`, `c-D`).

### Expected solver output

Braces are a group, equal unless a percentage is given. Each row is checked with tabs A, B, C, D and A, D, C, B.

| Row | List on A's plate | B | C | D | Extra got / place | Served order |
|---|---|---|---|---|---|---|
| a | B, {C, D} | 30 `ok` | 7.5 `limited`, 12.5 imported | 7.5 `limited`, 2.5 imported | 0 / 3 | B, C, D |
| b | B, {C 80, D 20} | 30 `ok` | 12 `limited`, 8 imported | 3 `limited`, 7 imported | 0 / 3 | B, C, D |
| c | {B, D}, C | 30 `ok` | 5 `limited`, 15 imported | 10 `ok` | 0 / 3 | B, D, C |
| d | {B, C, D} | 17.5 `limited`, 12.5 imported | 17.5 `limited`, 2.5 imported | 10 `ok` | 0 / 3 | B, C, D |
| e | B, {C, extra} | 30 `ok` | 7.5 `limited`, 12.5 imported | 0 `limited`, 10 imported | 7.5 / 2 | B, C, D |

A runs at 45 in every row. Each `served.A` consumer is a request with `share` the amount asked (30, 20, 10) and `got` its rate; `extra.asked` is 10. A stale head or middle entry in row a's list (`B, {ghost, C, D}`, where C must head {C, D} and not join B's group, and `B, {C, ghost, D}`) gives row a's numbers. A group of takes is shared by need (case 14's fixture with the list `{H2, H1}`, the two tied: T leaves 30 X, H2 needs 25 and H1 20, each is offered 15 and both stay short: H2 15 `limited` with 10 imported, H1 15 `limited` with 5 imported; see case 20 for the rest). A group holding an ignored request is shared by need too: A pinned at 25 with an extra of 10 and receiving plate from an empty Z makes B, C, D takes (`source-receives`); with the list `{B, extra}`, A's estimate is 25 and B needs 30, so the group is offered 12.5 each, the extra takes 10 and B 12.5 then the 2.5 left: B is credited 15 and gets 15, the extra gets 10, C and D 0.

### Derivation

```
a: B 30, 15 left; the group {C, D} is offered 7.5 each and both lack more.
b: 15 left; weights 80 and 20: C 12, D 3.
c: R = 45; the group {B, D} is offered 22.5 each; D takes 10 and passes 12.5; B lacks 7.5 and takes it; 5 is left for C.
d: 15 each; D takes 10 and passes 5; B and C get 2.5 more each.
e: B 30, 15 left; {C, extra} offered 7.5 each: C 7.5, the extra holds 7.5; D (not listed) gets 0; extra got min(10, 45 - 30 - 7.5) = 7.5.
```

## Case 19 — Areas of a consumer

**Exercises:** a ranked source that ranks the areas of a consumer block: an area entry, a block entry standing for the areas no entry names, a group of two areas, one area in a group with another consumer; a pair with no list; areas that trade the item among themselves; a take into a block with areas; a member of a cycle of requests with areas; a block with one needy area staying one line; a stale area entry.

**Recipes:** case 13's (`case13-make-plate`, `case13-use-plate`; plate = `case13-plate`), and case 11's and case 17's for the sub-cases j and k.

### Blocks

**A** makes plate, its row pinned at 45 (36 in row f), no extra output; **S** makes 30 `case13-gear` with `case13-use-plate` and requests plate from A (`c-S`); **H** makes 20 `case13-gear` in two areas, **L** (a `case13-use-plate` row pinned at 12) and **B** (pinned at 8, below L in the table), and requests plate from A (`c-H`). H's request probe gives plate: outside to L 12, outside to B 8. Entries are written `H/L` (the area L of H) and braces make a group.

### Expected solver output

Each row is checked with tabs A, S, H and A, H, S (row a with the first only).

| Row | A's list for plate | `c-S` | `c-H` | Lines (share / got) |
|---|---|---|---|---|
| a | none | 30 | 15 | S 30 / 30; H/L 12 / 12; H/B 8 / 3 |
| b | S, H | 30 | 15 | S 30 / 30; H/L 12 / 12; H/B 8 / 3 |
| c | S, H/B, H/L | 30 | 15 | S 30 / 30; H/B 8 / 8; H/L 12 / 7 |
| d | S, {H/L, H/B} | 30 | 15 | S 30 / 30; H/L 12 / 7.5; H/B 8 / 7.5 |
| e | H/L, S, H/B | 30 | 15 | H/L 12 / 12; S 30 / 30; H/B 8 / 3 |
| f | {S, H/L}, H/B, A pinned at 36 | 24 | 12 | S 30 / 24; H/L 12 / 12; H/B 8 / 0 |
| g | H/B, S, H | 30 | 15 | H/B 8 / 8; S 30 / 30; H/L 12 / 7 |
| h | H/L, H/B, S | 25 | 20 | H/L 12 / 12; H/B 8 / 8; S 30 / 25 |

In every row A runs at its pin with `infeasible-pins`, H's rows run at 12 and 8, H imports 20 less `c-H`, and S has no `areaId`. Further checks: a second solve through the solve cache reports the same lists as a cold one (row c); with one needy area (H with only L, A pinned at 36, list S, H) the lists and flows equal those of the same plan without the area flag, and both lines are whole-block lines; an area entry naming an area H does not have gives row b with no extra line; an area entry for an area that no longer needs plate leaves one line for H.

### Derivation

Requests: S 30, H 20; the parts of H are L 12/20 = 0.6 and B 8/20 = 0.4.

```
a: no list, tabs A S H: S is solved first: connectionOffer(45, pending 50, 30) = max(min(30, 45), 45 - (50 - 30)) = 30; H gets 15 of its 20.
   No list, two needy areas: one block entry covering [L 12, B 8], share 20, grant 0; handOut(15, [[0], [20], [20]]) = 15; areas handOut(15, [[12, 8], [12, 8]]) = L 12, B 3.
b: S 30; H min(20, 15) = 15, handed to its areas in table order: L 12, B 3.
c: S 30, 15 left; H/B min(8, 15) = 8, 7 left; H/L min(12, 7) = 7; H's block entry (among the unlisted) covers no area: no line.
d: S 30; the group {H/L 12, H/B 8} is offered 15, 7.5 each, both short.
e: H/L 12, 33 left; S 30, 3 left; H/B 3.
f: A pinned at 36; the group {S 30, H/L 12} is offered 36, 18 each; H/L takes 12 and passes 6; S 18 + 6 = 24; nothing is left for H/B.
g: H/B 8, 37 left; S 30, 7 left; the block entry H covers the area no entry names, L, share 20 x 0.6 = 12: min(12, 7) = 7, labelled H/L.
h: H/L 12, H/B 8, 25 left; S min(30, 25) = 25.
```

### Sub-case i — a consumer whose areas trade the item

**H2** has areas P (a `case13-make-plate` row pinned at 5), Q (`case13-use-plate` pinned at 12) and R (`case13-use-plate` pinned at 8), a product of 20 `case13-gear` and a request of plate from A (pinned at 10, a list on plate). Plate in H2: P makes 5, Q and R use 20, so the block imports 15. `itemRoutes` sends P's 5 to Q first (table order) and Q takes 7 and R 8 from outside, not Q 12: the needs are Q 7 and R 8, and the block asks 15. A offers 10: with the list R, Q, the lines are R 8 / 8 and Q 7 / 2; with Q, R they are Q 7 / 7 and R 8 / 3; with no list, handOut(10, [[7, 8], [7, 8]]) gives Q 7 / 7 and R 8 / 3. `c-H2` is 10 and `limited`; area P has no line. The figures per area follow the fixed pairing of `itemRoutes`, so they are right in total and arbitrary in detail where areas trade the item.

### Sub-case j — a take into a block with areas

**T** makes 30 `case11-goal` with `case11-x` on the side (30 leftover, so every connection is a take); **J** uses 25 X (`case11-use-x`, `c-J`); **H3** has areas L (`case11-use-x` pinned at 12) and B (pinned at 8), a product of 20 `case11-other` and a take of X from T (`c-H3`). Each is checked with tabs T, J, H3 and T, H3, J.

- j1, list J, H3/B, H3/L: J is credited min(30, 25) = 25; H3, at its first entry, 5 of its need of 20. Shares: H3/B 5 x 8/20 = 2, H3/L 3. Grants J 25, H3/B 2, H3/L 3, all 30 held. `c-J` 25 `ok`; `c-H3` 5 `limited`, H3 imports 15. Lines: J 25 / 25 (need 25), H3/B 2 / 2 (need 8), H3/L 3 / 3 (need 12), all takes, none `notCredited`.
- j2, list H3/B, J, H3 (a known limitation): H3's credit is computed at its first entry, min(30, 20) = 20; J, below it, is credited 10. Shares: H3/B 8, J 10, H3 (the block entry, covering L) 12. Grants 8, 10, 12. `c-H3` 20 `ok`, `c-J` 10 `limited`. A rank-faithful solve would give J 22.
- j3, no list and H3 an unlisted take-only consumer with two needy areas: two H3 lines, L then B, whose `got` add up to `c-H3`'s rate (the needs come from the final solve), and a second solve through the solve cache solves no block again.
- j3, list J only (H3 unlisted, take-only): J 25; H3 has no credit, so share 0, and gets the 5 left; its areas come from the final solve (L 12, B 8): lines H3/L 0 / 5 and H3/B 0 / 0.
- j4, a known limitation. T leaves 10 X; the list is C/A, J, C where C has an empty area A and area B (`case11-use-x` pinned at 10) and J needs 10. C's credit sits at its first entry (C/A): min(10, 10) = 10, so J is credited 0 (a rank-faithful solve would give J 10 and C 0): `c-C` 10, `c-J` 0.
- j5, list H3/B, H3/L, J: H3's credit is taken once, at H3/B: 20; J is credited 10. Shares 8, 12, 10; `c-H3` 20, `c-J` 10 `limited`.
- j6, list C/B, J with C taking X from T and requesting it from V (areas L 12, B 8), J needing 5 and an unnamed U needing 10 that takes and requests the same way: T leaves 30. C 20 (once), J 5, U 5 and U asks V for 5; C asks V nothing: `c-C` 20, `c-J` 5, `c-U` 5, `c-UV` 5, `c-CV` 0.

### Sub-case k — a member of a cycle of requests with areas

Case 17's cycle (T, V, K1, K2) with K1 in two areas: A1 (`case17-make-p`) and A2 (`case11-use-x`, a product of 6 `case11-other`). K1's request probe needs X 10 in A1 (the p that K2 requests) and 6 in A2. Only invariants are asserted: the cycle settles in its members' order, `served.T[case11-x]` has K1 lines A1 and A2 with shares in the ratio 10 : 6 and `got` adding up to `c-K1T`'s rate; a second solve through the solve cache reads the memo of the cycle and reports the same lists and flows.

With the list K1/A2, K1/A1, K2 on T, the grants read the cycle memo's needs: T leaves 15, K1 needs 16 (A1 10, A2 6) and is credited 15 at its first entry, K2 0. Shares of `c-K1T`: A2 15 x 6/16 = 5.625, A1 15 x 10/16 = 9.375; lines A2 5.625 / 5.625 and A1 9.375 / 9.375, `c-K2T` 0; a second solve through the cache reports the same.

## Case 20 — Groups of takes

**Exercises:** a `tied` group of takes on a ranked pair is credited by need, not in list order: the water-fill on the members' needs (`min(need, maxRate)`, by weight, a covered member's spare going round again), a block with areas as one member, a readiness edge that lets the group share, a member that takes first and requests the rest from another source, and the fallback to list order (flagged `groupInListOrder`) when the request pass cannot know every need in time, when a consumer of the pair is in a cycle of requests, when a member does not take the item first, or when a member has an entry below the group; a list with no `tied` staying as it was; a group of takes in a loop of blocks; a warm solve; and the cycle memo reading the lists' flags, weights and areas.

**Recipes:** case 11's (`case11-make-goal`, `case11-use-x`, `case11-make-x`), case 13's for a8 and c, case 16's for e, case 17's for c2 and c3.

### Blocks

**T** makes 30 `case11-goal` and so 30 X (`case11-x`), with a list on X. **H(id, n)** makes n `case11-other` with `case11-use-x` and takes X from T (`c-<id>`); X is raw in H, so what a take does not deliver is imported. Braces are a group (equal weights unless a percentage is given), "imp" is the X a block imports. Each row is checked with the two tab orders written. On every take line of T's list `kind` is `take`, `share` is the credit, `got` the flow's rate, and `groupInListOrder` and `notCredited` are absent unless a row says so.

### a — two takes of one byproduct (tabs T, H1, H2 and T, H2, H1)

| Row | List | H1 n | H2 n | Credits = grants (H1, H2) | H1 | H2 |
|---|---|---|---|---|---|---|
| a1 | {H1, H2} | 10 | 25 | 10, 20 | 10 `ok`, imp 0 | 20 `limited`, imp 5 |
| a2 | {H2, H1} | 10 | 25 | 10, 20 | as a1 | as a1 |
| a3 | {H1 80, H2 20} | 10 | 25 | 10, 20 | as a1 | as a1 |
| a4 | {H1 20, H2 80} | 10 | 25 | 6, 24 | 6 `limited`, imp 4 | 24 `limited`, imp 1 |
| a5 | {H1, H2} | 20 | 25 | 15, 15 | 15 `limited`, imp 5 | 15 `limited`, imp 10 |
| a6 | {H1, H2}, `c-H2` maxRate 12 | 20 | 25 | 18, 12 | 18 `limited`, imp 2 | 12 `limited`, imp 13 |

The lines are in list order (a2: H2, H1); `need` is H1's n and 25.

```
a1: at the first member the rest is 30; the needs are 10 and 25; offers 15 and 15; H1 is covered at 10; H2 takes 15, then the 5 H1 passes: 20.
    Grants waterFill(30, [10, 20]), the same. Supply, tabs T, H1, H2: H1 connectionOffer(30, 30, 10) = max(10, 30 - 20) = 10; H2 (20, 20, 20) = 20.
a2: the same needs in list order [25, 10]: offers 15 and 15; H1 covered at 10; H2 15 + 5 = 20.
a3: weights 80 and 20: offers 24 and 6; H1 covered at 10; H2 6, 14 left, offered 14 in the second pass, lacks 19: 20.
a4: weights 20 and 80: offers 6 and 24; H1 lacks 10 and H2 lacks 25: neither is covered, the passes stop. Grants waterFill(30, [6, 24], [20, 80]) = 6, 24.
a5: offers 15 and 15; both stay short.
a6: demands 20 and min(25, 12) = 12; offers 15 and 15; H2 is covered at 12 and passes 3; H1 15 + 3 = 18.
```

**a7 — areas.** On case 19 j's fixture: J needs 25; H3 has areas L (pinned 12) and B (pinned 8) and takes X from T. List `[J, H3/L tied, H3/B tied]`, tabs T, J, H3 and T, H3, J. `c-J` 10 `limited` (J imports 15), `c-H3` 20 `ok` (imports 0). Lines J 10 / 10 (need 25), H3/L 12 / 12, H3/B 8 / 8. Members J (weight 1) and H3 (first entry H3/L, two entries: weight 2): `waterFill(30, [25, 20], [1, 2])` offers 10 and 20, J is short, H3 is covered at exactly 20. Grants: the credit of H3 is split by the needs of its areas (0.6 and 0.4), and `waterFill(30, [10, 12, 8])` gives J 10, L 12, B 8. (An area member's weight is the sum of its entries' weights: the alternative, per entry on the areas' needs, would give J 11 and H3 19.)

**a8 — a readiness edge makes the group share.** T's list `{H1, H2}`, H1 = H(H1, 20); H2 makes 25 `case11-other` and an extra-0 `case13-plate` (rows `case11-use-x` and `case13-make-plate`), takes X (`c-H2`); R makes 5 `case13-gear` (`case13-use-plate`) and requests plate from H2 (`c-RH2`). Tabs T, H1, R, H2 and T, H2, R, H1. H1 15 `limited` (imp 5), H2 15 `limited` (imp 10), `c-RH2` requested 5, rate 5, `ok`, no `groupInListOrder`. H2 has a requester (R), so the pass adds the readiness edge R -> H1 (H1 reaches nothing), (the readiness edges follow all the rank edges, including H1 -> H2): the request order is T, R, H1, H2. R asks H2 for 5 plate; at H1 R is processed, the probe of H2 ahead of its turn gives X 25, the group is credited 15 and 15. (Without the edge the order could put H1 before R and the group would fall back to H1 20, H2 10.)

### b — a takes-first member asks its other source for the rest

Case 14 c's blocks: T, **A** (product X, extra 0, `case11-make-x`), **H** = H(H, 20) and **B** (25 `case11-other`; `c-BT` takes X from T, then `c-BA` requests X from A). Tabs T, A, H, B and T, B, H, A.

| Row | List | H | `c-BT` (share, need) | `c-BA` requested = rate | A `make-x` | B imp |
|---|---|---|---|---|---|---|
| b1 | {H, B} | 15 `limited`, imp 5 (share 15, need 20) | 15 `ok` (15, 25) | 10 `ok` | 5 | 0 |
| b2 | {B, H} | as b1 | as b1 | as b1 | 5 | 0 |
| b3 | {H 20, B 80} | 6 `limited`, imp 14 | 24 `ok` (24, 25) | 1 `ok` | 0.5 | 0 |

The lines are H, B (b2: B, H).

```
b1: request order T, H, B, A (take edge T -> B, rank edges T -> H and H -> B, request B -> A). Nobody requests from H or B: no readiness edge.
    At H (the first member): rest 30; the probe of B, ahead of its turn, gives 25; offers 15 and 15, both short: credits 15 and 15.
    B's credit is known before it shares out its need: c-BA gets 25 - 15 = 10 and A makes goal X 10, make-x runs 10 / 2 = 5.
    Supply: T grants 15 and 15; H connectionOffer(30, 30, 15) = 15; B takes 15 from T and 10 from A: no import.
b2: the first member reached is B; the probe of H gives 20; waterFill(30, [25, 20]) = 15 and 15; the same flows.
b3: offers 6 and 24 (exact), both short; B asks A for 25 - 24 = 1; make-x runs 0.5. Grants waterFill(30, [6, 24], [20, 80]) = 6, 24;
    H connectionOffer(30, 30, 6) = max(6, 30 - 24) = 6.
```

### c — the fallback

**c1 — a need not known in time.** T's list `{H1, H2}`; **H1**: 20 `case11-other`, `c-H1` takes X from T, then `c-H1R` requests X from **R**; R makes X (extra 0) and 5 `case13-gear` (rows `case11-make-x` and `case13-use-plate`) and requests plate from H2 (`c-RH2`); **H2** as in a8. Tabs T, H1, R, H2 and T, H2, R, H1. `c-H1` 20 `ok` (imp 0); `c-H1R` requested 0, rate 0, `unused`; H2 10 `limited` (imp 15); `c-RH2` requested 5, rate 5, `ok`. Lines H1 (share 20, need 20) and H2 (share 10, need 25), both `groupInListOrder`, neither `notCredited`. The chain T -> H1 -> R -> H2 is forced; the readiness edge R -> H1 is refused (H1 reaches R), so when H1 is reached R, a requester of H2, is not processed: the group falls back to list order. H1 `min(30, 20) = 20`, so `c-H1R` gets 0; R asks H2 for 5 plate; H2 30 - 20 = 10; grants in list order 20 and 10.

**c1b — the same fixture, list `{H2, H1}`.** H2 25 `ok` (imp 0); `c-H1` 0 `unused`; `c-H1R` requested 20, rate 20, `ok`; R `make-x` 10; H1 imports 0. Lines H2 (share 25, need 25, `groupInListOrder`) and H1 (share 0, need 20, `notCredited` and `groupInListOrder`). H1 is reached first, the group falls back; H1's higher take (H2) is not processed, so H1 is credited 0 (`notCredited`) and asks R for its whole need 20; H2 `min(30, 25) = 25`; grants in list order 25 and 0.

**c2 — a group whose source feeds a cycle of requests.** Case 17's fixture, T's list `[K2, K1 tied]`, tabs T, V, K1, K2 and T, V, K2, K1. Flows and `requestLoops` as case 17's rows b: `c-K1T` 5; `c-K1V` requested 5, rate 5; `c-K2T` 10; `c-K2V` 0 `unused`; two rounds, converged. Lines K2 (share 10) and K1 (share 5), both `groupInListOrder`, no `notCredited`. The group's consumers are members of a cycle of requests (the demand rounds read the list in order), so each take is credited in turn, as for a list with no group.

**c3 — the per-pair scope.** Case 17's fixture plus **H** = H(H, 10) and **G** = H(G, 10) taking X from T. T's list `[H, G tied, K2, K1]`, tabs T, V, K1, K2, H, G and T, V, K2, K1, H, G. H 10 `ok` (imp 0); G 5 `limited` (imp 5); `c-K1T` and `c-K2T` 0; `c-K1V` and `c-K2V` requested 10, rate 10; V `make-x` 10; two rounds, converged. H and G lines `groupInListOrder`; K1 and K2 lines neither flag. K1 and K2 are consumers of the pair, so the group {H, G} falls back although none of its members is in the cycle; H `min(15, 10) = 10`, G `min(5, 10) = 5`, K2 and K1 below see nothing left, so each K needs its 10 X from V: 20 X, `make-x` 10.

### d — a list with no `tied`

Case 14 b (list H2, H1; H1 20, H2 25): H2 25 `ok`, H1 5 `limited` (imp 15), no line carries `groupInListOrder`. Cases 14 to 19 are as before.

### e — a group of takes in a loop of blocks

Case 16's fixture (tabs and loop member orders as case 16), list `{C1, C2}` on S's X. C1 15 `limited` (imp 5), C2 15 `limited` (imp 10); `c-S1` 20 `ok`, `c-S2` 10 `ok`; two rounds, converged. Lines C1 (share 15, need 20) and C2 (share 15, need 25), no flags. At C1 the probe of C2 gives 25; credits 15 and 15; round 1 grants nothing (the back credit is 0) and keeps the credits reserved, round 2 grants 15 and 15 from the offer 30; the offers do not change.

### f — a warm solve

Row b1 solved twice through one `SolveCache`: the second solve stores no block (no `cache.set`) and `served` equals a cold solve's.

### g — a readiness edge never refuses another list's rank edge

a8's fixture plus **S**, which makes 6 `case11-goal` and so 6 X, with the list `[H1, R]` on X (no tie); H1 also takes X from S (`c-H1S`, after `c-H1`); R makes 4 `case11-other` and 5 `case13-gear` (`case11-use-x`, `case13-use-plate`), requests plate from H2 and takes X from S (`c-RS`). Tabs T, S, H1, R, H2 and T, S, H2, R, H1. The rank edge H1 -> R of S's list stands, so the readiness edge R -> H1 is the one refused: when H1 is reached R is not processed and T's group falls back to list order (flagged): H1 `min(30, 20) = 20` (`c-H1` 20 `ok`, `c-H1S` 0), H2 the 10 left (10 `limited`, imp 15). H1 needs nothing of S, so R is credited `min(6, 4) = 4` (`c-RS` 4, R imports 0, plate 5) and its line of S carries no `notCredited`. (With the readiness edge first, the rank edge H1 -> R was refused and R's take was credited before H1's, `notCredited`.)

### h — entries below the group

a7's fixture, list `[J, H3/L tied, H3/B]` (B is not in the group), tabs T, J, H3 and T, H3, J. H3's connection has an entry below the group, so the group is served in list order (flagged): J `min(30, 25) = 25`, H3 at its first entry `min(30 - 25, 20) = 5`, split by the areas' needs 12:8 into L 3 and B 2. `c-J` 25 (imp 0), `c-H3` 5 (imp 15); lines J 25, H3/L 3, H3/B 2, all `groupInListOrder`. (Shared by need, J would be credited 15 and H3 15, so J would be short while B, ranked below J, is credited.)

### i — a member that does not take the item first

T's list `{H1, H2}`; **A** makes 8 `case11-goal` and so 8 X (a byproduct); H1 (20) takes X from A (`c-H1A`) before T (`c-H1`); H2 = H(H2, 25). `c-H1A` 8, `c-H1` `min(30, 20 - 8) = 12`, H2 the 18 left (`limited`, imp 7); both lines `groupInListOrder`. (Shared by need, H1 would ask T for 20 and H2 would get 15.)

### j — a take ranked below a group shared by need

T's list `[{H1, H2}, H3]`, H1 needs 10, H2 25, H3 20. T leaves 30: `waterFill(30, [10, 25])` is 10 and 20, the group holds 30 once, H3 is left 0 (credit 0, `limited`, imp 20). T leaves 40: 10 and 25, the group holds 35, H3 is left 5 (`c-H3` 5 `limited`, imp 15). No flag on any line.

### k — a member is probed once

Row b1's blocks solved through a cache that never hits and counts its `set` calls: B and H are each solved twice (once by the request pass, B ahead of its turn and reused at it, once by the supply pass).

### The cycle memo

M1: T's list `[K2, K1]` -> `[K2, K1 tied]` (case 17): the cycle is solved again, the warm solve equals a cold one and both lines carry `groupInListOrder`. M2: `[K2 60, K1 tied 40]` -> `[K2 40, K1 tied 60]`: solved again. M3: a list on V's X (the cycle only requests from V) changing weights: the memo is hit. M4 (case 19 k): `[K1/A2, K1/A1, K2]` -> `[K1/A1, K1/A2, K2]`: solved again.

---

## Case 21 — Area rules

**Exercises:** an area's own rule for an item (`SubPlan.sourceRules`) in the area LP: Receive it first, Don't make more here and Import off set on one area while the block's rule and the other areas keep theirs; a keyless `{}` rule that overrides the block's; the outside leg into an area and its connected part (`AreaRoute.supplied`); the split of that leg into received, imported and missing (`outsideLegParts`); a second item that no rule names and that two areas trade (the one-path pin); the rule as a request, in a served list's needs and in a cycle of requests; the byproduct that goes where it saves the most runs; and the supplier switch (`areasOff`): an area that takes an item from one supplying area and not another, from none (imported, or missing when Import is off), and a byproduct that only one consumer may take.

**Recipes:** case 13's (`case13-make-plate`: 1 ore makes 1 plate; `case13-use-plate`: 1 plate makes 1 gear) and case 11's (`case11-make-goal`, `case11-use-x`, `case11-make-x`), plus `case21-make-y` (1 `case21-ore` makes 1 Y), `case21-use-y` (1 Y makes 1 `case21-z`), `case21-make-coin` and `case21-use-coin` (1 `case21-ore` makes 1 coin; 1 coin makes 1 token). The values were derived by hand before the solver change; no row was edited to match the solver. Rows marked *measured* do not depend on the area rules: they hold with or without them.

### A — a central block and an area with its own row

Block H, product 20 gears; area L has a gear row pinned at 12 and a plate row, area B a gear row pinned at 8 and a plate row; one connection for plate. Both gear rows always run at 12 and 8. The area rules sit on the sub-plans' `sourceRules`; "first" is *Receive it first*, "off" is *Don't make more here*.

| Row | Block rule | Area rules | Offer | Received | L's plate row | B's plate row | Plate imported or missing | Legs into areas (to, rate, supplied) | Parts (received / imported / missing) |
|---|---|---|---|---|---|---|---|---|---|
| a | none (*measured*) | none | 100 | 0 | 12 | 8 | 0 | none | |
| b | first (*measured*) | none | 100 | 20 | 0 | 0 | 0 | (L 12 12), (B 8 8) | L 12/0/0, B 8/0/0 |
| c | none | L first | 100 | 12 | 0 | 8 | 0 | (L 12 12) | 12/0/0 |
| d | first | B `{}` | 100 | 12 | 0 | 8 | 0 | (L 12 12) | 12/0/0 |
| e | none | L first | 5 | 5 | 7 | 8 | 0 | (L 5 5) | 5/0/0 |
| f | none | L first | unlimited (the probe) | 12 | 0 | 8 | 0 | (L 12 12) | 12/0/0 |
| g | none | L off | none | 0 | 0 | 8 | 12 imported | (L 12, no supplied) | 0/12/0 |
| h | none | L off | 100 | 12 | 0 | 8 | 0 | (L 12 12) | 12/0/0 |
| i | none | L off | 5 | 5 | 0 | 8 | 7 imported | (L 12 5) | 5/7/0 |
| j | none | L off, Import off | none | 0 | 0 | 8 | 12 missing | (L 12, no supplied) | 0/0/12 |
| k | off | L `{}` | none | 0 | 12 | 0 | 8 imported | (B 8, no supplied) | 0/8/0 |

```
a: no rule, nothing connected is wanted: each area makes its own plate (12 and 8), nothing is received. (measured)
b: the block's Receive it first reaches every area: both plate rows stop, u_L = 12 and u_B = 8 (each area's supply is bounded by its own use); received 20.
c: only L receives first. u_L takes 12 of the offer; B has no supply in pass 1 and keeps its own row (8). A rule on one area does not move the other: this is the case the block-wide rule could not state.
d: B's {} is a rule (Make it here, Import on): it replaces the block's. B keeps its row, L receives 12.
e: the offer 5 is below L's use: u_L = 5, L's plate row makes the other 7; B makes 8.
f: the request probe has unlimited supply: u_L covers all of L's use, 12.
g: L's plate row would cost 1 per unit and an import costs 1e-5, so L imports; B's plate row runs for B only (8), it does not run for L: other areas give L only what they already make, which is nothing. The leg into L is all imported.
h, i: as c and e with the offer in pass 2: the supply is capped at L's pass-1 residual (12); with 5 on offer, 5 is received and 7 imported.
j: Import off on L with off: L's slack is the cheap one and stays; what it takes is missing, not imported (outsideLegParts).
k: the block's off applies to B; L's {} overrides it, so L makes its own plate (12) and B imports 8.
```

Each row's second item: with the product 6 `case21-z`, B (A) or T (C) also has `case21-make-y` and L or C1 has `case21-use-y`. No rule names Y, two areas trade it, and the figures do not move: `make-y` 6, `use-y` 6, one route Y from B to L (T to C1) of 6 with no `supplied`, `case21-ore` imported 6, and Y in the areas' `receives` and `sends` (6, not a boundary). The plate figures with Y equal those without it.

**f as a request.** H takes plate from a source S that makes it (S: `case13-make-plate` in its root, product plate 0), the connection `c-H`; tabs S, H and H, S. With L receiving first: `c-H` is a request of 12, rate 12, `ok`; S makes 12; L's plate row 0, B's 8; the leg (L 12 12). With no rule nothing is asked: `c-H` requested 0, rate 0, `unused`, L's plate row 12.

**A served list.** S lists `[H/B, H/L]` on plate. Row c: the lines of H are exactly [H / L, share 12, got 12] (B makes its own plate and needs nothing; an area's need follows its rule). Row a: no H line has a share or a grant. The request probe of H (unlimited supply) reads `[{ L, need 12 }]` in row c and no area need in row a.

**A cycle of requests.** H also makes 1 `case21-coin` (a root row `case21-make-coin`, product coin 0); S also makes 1 `case21-token` from `case21-use-coin` and takes the coin from H (`c-S`). Row c (L receives first): `c-H` requested 12, rate 12, `ok`; `c-S` requested 1, rate 1, `ok`; H's coin row 1, L's plate row 0, B's 8; S's plate row 12; one loop {H, S}, converged. Row a: `c-H` 0, `unused`, L's plate row 12.

### B — choosing the supplying area

Block H, product 12 gears; area L has a gear row pinned at 12 and no plate row; areas M1 and M2, in that order, each have a plate row. "off M1" is `areasOff: ['M1']` in L's rule for plate.

| Row | L's rule | Offer | M1 | M2 | Plate imported or missing | Received | Legs | Parts |
|---|---|---|---|---|---|---|---|---|
| a | none | none | 12 | 0 | 0 | 0 | (M1 to L 12) | |
| b | off M1 | none | 0 | 12 | 0 | 0 | (M2 to L 12) | |
| c | off M1, M2 | none | 0 | 0 | 12 imported | 0 | (outside to L 12, no supplied) | L 0/12/0 |
| d | off M1, M2 | 100 | 0 | 0 | 0 | 12 | (outside to L 12, supplied 12) | L 12/0/0 |

```
a: no switch: M1 is higher in the table, so it makes the 12 and sends them to L.
b: the pair M1 to L is gone: L takes from M2 (run cost 12) or imports (12e6 as a slack): M2 makes 12, M1 none.
c: no pair into L: L imports 12 as a slack; the leg is outside to L with no connected part.
d: pass 1 leaves L a residual of 12; in pass 2 u_L = min(100, 12) = 12 and s_L = 0: received 12, the leg outside to L is supplied 12.
```

All rows: `case13-use-plate@L` runs at 12.

### C — one consumer takes the byproduct

Case 11's recipes. Block H, products 30 `case11-goal` and 90 `case11-other`. Area T has `case11-make-goal` (30 goal and 30 X on the side); area C1 has `case11-use-x` pinned at 40; area C2 has `case11-use-x` pinned at 50 and `case11-make-x` (R: 1 ore makes 2 X).

| Row | Block rule | Area rules | R runs | X imported or missing | Legs |
|---|---|---|---|---|---|
| a | none | none | 30 | 0 | no leg has `supplied` |
| b | off | none | 0 | 60 imported | T to C1 30, outside to C1 10, outside to C2 50 (below) |
| c | none | C1 off | 10 | 40 imported | T to C2 30, outside to C1 40 (no supplied), parts 0/40/0 |
| d | none | C1 off; C2 switches T off | 25 | 10 imported | T to C1 30, outside to C1 10, parts 0/10/0 |
| e | none | C1 off with Import off; C2 switches T off | 25 | 10 missing | T to C1 30, outside to C1 10, parts 0/0/10 |

```
a: 90 used, 30 made on the side, R makes 60 / 2 = 30. (measured)
b: no row runs for X: T's 30 are used, the other 60 are imported. Which receiver takes the byproduct is not decided by the LP (the nets and the total import are the same); the per-area imports go to the receivers lower in the table, so T goes to C1 (30) and the imports are C1 10 and C2 50.
c: C1 does not make X, but the byproduct still goes where it saves the most runs: C2 takes T's 30 and R makes (50 - 30) / 2 = 10; C1 imports its 40.
d: T's 30 X are a byproduct of the fixed goal and cannot be avoided. C2 switched T off, so its 50 come from R (25 runs); T's 30 can reach only C1. C1's other 10 are cheaper imported (1e-5 each) than made by 5 more runs of R: R 25, X imported 10, legs T to C1 30 and outside to C1 10. No flow is penalised (no area has a dedicated row that takes from another), so stage 1 is skipped.
e: the same LP (`makeHere: 'off'` keeps the cheap slack); with Import off the 10 are missing, not imported: parts 0/0/10.
```

The second item Y (T makes it, C1 uses it) is the same pin as in A: the plate (X) figures with Y equal those without it.

## Case 22 — A connection replaces an import

**Exercises:** the connection order ([A connection replaces an import](solver.md#connections-between-blocks)): a block that imports an intermediate while one of its connections has offer to spare takes from the connection instead, whichever item the connection is on and whatever the recipe ratio; own production first, the default-rule gate and the rules the steps keep; the same rule in a loop that loses, in areas, and in a loop of blocks and a served list. Rows marked *measured* do not depend on the order: they hold with or without it.

**Recipes:** `case22-gear` (2 plate makes 1 gear, G), `case22-plate-1-1`, `case22-plate-1-2`, `case22-plate-2-1` (P: 1 ingot makes 1 plate, 1 ingot makes 2 plates, 2 ingots make 1 plate), `case22-ingot` (S: 1 ore makes 1 ingot), `case22-mine-plate` (1 ore makes 1 plate, a source block's row), `case22-use-x` (U: 2 X make 1 goal and 100 W), `case22-recycle` (R: 100 W make 1 X), `case22-tool` (H: 2 plate make 1 tool and 2 z), `case22-press` (Q: 1 z and 1 ore make 1 coin and 1 plate). Values are derived by hand; no row is edited to match the solver.

### A — a pinned upstream row

Fixture A: product 25 gears (G needs 50 plates); P at the ratio of the row; S pinned at 10 ingots.

| Row | P | Connection (offer) | Received | P runs | Intermediates imported |
|---|---|---|---|---|---|
| a | 1 makes 1 (*measured*) | plate (100) | plate 40 | 10 | none |
| b | 1 makes 2 | plate (100) | plate 30 | 10 | none |
| c | 2 make 1 (*measured*) | plate (100) | plate 45 | 5 | none |
| d | 1 makes 2 | plate (12) | plate 12 | 19 | ingot 9 |
| e | 1 makes 2 (*measured*) | none | nothing | 25 | ingot 15 |
| f | 1 makes 2 | plate (unlimited, the probe) | plate 30 | 10 | none |
| g | 1 makes 1 | ingot (100) | ingot 40 | 50 | none |
| h | 1 makes 2 (*measured*) | ingot (100) | ingot 15 | 25 | none |
| i | 2 make 1 | ingot (100) | ingot 90 | 50 | none |
| j | 1 makes 2 (*measured*) | plate (100) and ingot (100) | ingot 15 | 25 | none |
| k | 1 makes 1 (*measured*) | plate (100) and ingot (100) | plate 40 | 10 | none |
| l | 1 makes 2, Import off on ingot (*measured*) | plate (100) | plate 30 | 10 | none |
| m | 1 makes 2, S not pinned (*measured*) | plate (100) | nothing | 25 | none |
| n | 1 makes 2, plate on *Receive it first* (*measured*) | plate (100) | plate 50 | 0 | none |

```
b: the 10 ingots make 20 plates (x runs of P, x <= 10 without an import); the connection gives the other 30. The least import is 0 (x <= 10) and the least received is 30 at x = 10.
d: the offer 12 bounds the plates received (u <= 12), so 2x >= 38, x >= 19: 19 ingots, 9 of them imported (importing plate instead would be 18 units).
f: as a solveAll row, a source block that has plate as a product is asked for 30 (the probe's need).
g: 1 ingot makes 1 plate: 50 plates need x = 50 and 50 ingots, 10 of them the block's own, so u = 40.
i: 2 ingots make 1 plate: x = 50 and 100 ingots = 10 + u, u = 90.
e, j, k: no offer on the replacing item, or two connections that tie: the fewest units, then the fewest runs.
m: S is not pinned, so P runs on raw ore (25) and no import is left: own production first, the gate stays closed.
n: plate on Receive it first is received whole (50); P does not run. The solver also reports overconstrained (S's 10 ingots are unused); that warning is what the solver gives, not a derived value.
```

### B — a loop that loses

Fixture B: product 10 goal; U (2 X make 1 goal and 100 W) and R (100 W make 1 X).

| Row | Connection (offer) | Received | R runs | Imported |
|---|---|---|---|---|
| a | none (*measured*) | nothing | 10 | X 10 |
| b | X (100) (*measured*) | X 10 | 10 | none |
| c | X (4) (*measured*) | X 4 | 10 | X 6 |
| d | W (5000) | W 1000 | 20 | none |
| e | X (100) and W (5000) (*measured*) | X 10 | 10 | none |

```
b: 10 goals need 20 X; U makes 10 runs, so 1000 W, enough for 10 X from R; the connection gives the other 10 X.
c: 4 X received; the 6 X left could be 600 W, but fewer units are imported (6 X).
d: U's 20 X need 20 runs of R and 2000 W; U makes 1000 W, so the connection gives 1000 W and X imported is 0.
```

### C — areas

Fixture A with G in area L and P and S in area M; plate is touched by both areas, ingot by M only. Row c has S unpinned in a third area N.

| Row | P | Connection (offer) | Received | P runs | Imported | Outside leg of plate into L |
|---|---|---|---|---|---|---|
| a | 1 makes 2 | plate (100) | plate 30 | 10 | none | 30, all of it supplied |
| b | 1 makes 1 | ingot (100) | ingot 40 | 50 | none | none |
| c | 1 makes 1, S unpinned in N, M's rule switches N off for ingot | ingot (100) | ingot 50 | 50 | none | none (the ingot leg into M is 50, all of it supplied) |

Same derivations as A, rows b and g.

```
c: P needs 50 ingots for the 50 plates G asks for. S in N could make them, but M's rule switches N's ingots off (ingot is a pair item), so S's ingots cannot reach M, and the ingot connection stays idle in the two passes: the result imports the plates (or runs S for nothing). The least import of the order is 0 with u_M = 50 (the connection feeds M directly), the least received at that import is 50, and the fill gives P 50, S 0, G 25, with no plate received.
```

### D — a loop of blocks and a served list

Block H: product 25 tools, rows tool, P (1 ingot makes 2 plates) and S pinned at 10 ingots; connection `c-H` takes plate from Q. Block Q: product coin, row press; connection `c-Q` takes z from H. Neither item is a product of its source, so both are takes and H and Q form a loop of blocks.

```
a (coin 30): the tool runs 25 (50 plates for the tools, 50 z); z on offer 50 >= 30. The press runs 30 and offers 30 plates. H: 2x + u = 50 with plate received u = 30, x = 10 (the pinned ingots), no ingot or plate imported. Tab orders H Q and Q H: both flows 30, one loop of H and Q, converged.
b (warm solve): solving row a twice through one cache gives the same result objects. Coin 12: the press runs 12 and offers 12 plates, so 2x + u = 50 with u <= 12, x >= 19: P 19, ingot imported 9, both flows 12, H's result is a new object.
```

A served list on a source whose consumer is touched: S mines plate pinned at 35 (product plate 10), with a list of H, C (then C, H) and the extra after them; H is fixture A, row b, taking plate from S; C needs 5 gears, taking plate from S. H asks 30 (row f), C 10, the extra 10: 50 against 35, so S reports `infeasible-pins`.

```
List H, C: H gets 30 (P 10, no ingot or plate import); C gets 5 of the 10 it asked and imports 5. The extra gets 0.
List C, H: C gets 10 and imports nothing. H gets 25: with 25 offered, 2x + u + s = 50, u <= 25, x <= 10 + i (i ingots imported), s plates imported; the least import is s + i, s = 5 - 2i, total 5 - i, so i = 2.5 and s = 0; then the least received is u = 50 - 2x with x = 12.5 and u = 25. P 12.5, ingot imported 2.5, plate imported 0.
Both orders of tabs (S H C and C H S) give the same.
```

## Case 23 — An absorber chain

Plain made-up ids, 1 s recipes. A flagged byproduct consumer runs on the surplus of another row; the rows that only feed it run along with it ([solver.md, Absorber chains](solver.md#absorber-chains)). Wood is made only by the sawing row and nothing in the block uses it: a pure byproduct, never a goal.

| Row | Recipe | Takes | Makes |
|---|---|---|---|
| G | `case23-grow` | 1 seed | 1 goal, 2 tree |
| S | `case23-saw-wood` | 1 tree, 1 saw | 8 wood, 1 saw at probability 0.9 (net saw -0.1) |
| K | `case23-make-saw` | 1 plate | 1 saw |
| P | `case23-make-plate` | 1 roll | 4 plate |
| U | `case23-use-plate` | 1 plate | 1 gadget |
| B | `case23-burn-roll` | 1 roll | 1 ash |

Goal: 10 `case23-goal`. Seed and roll are raw.

| Row | Setup | Expected |
|---|---|---|
| a | S and K flagged | G 10, S 20, K 2, P 0.5, wood 160 made; no warning; seed 10 and roll 0.5 imported |
| b | only S flagged | as a (K is a feeder) |
| c | S, K and P flagged | as a |
| d | as a, plus U and a goal of 4 gadget | P 1, S 0, K 0, `overconstrained` tree 20 |
| e | G and a flagged B | B 0, G 10, no warning |
| f | as a, S K P in an area "Wood", G in the root | the same rates; Wood receives tree 20; one route of tree from the root to Wood, 20 |
| g | as a in a block with a take of wood by block C (50/min) and a request of roll from block M | S's rows are the same with and without C; C receives 50 wood (`ok`, a take); M is asked 0.5 roll and mines it |
| h | as f with K unflagged, P in an area of its own ("Plates"), U in Wood pinned at 4, plate Receive it first with an offer of 100 | Wood receives 6 plate (4 for U, 2 for K); S 20, K 2, P 0; feeders `['case23-make-saw@Wood']` |
| h2 | h with K flagged | Wood receives 4 plate (the use of U); K 0, S 0 |
| j | b (only S flagged), no areas; plate Receive it first, offer 100 | plate received 2, P 0, K 2, S 20, no roll imported; feeders `['case23-make-saw']` |
| k | G, K flagged, P, M (`case23-mine-roll`: 1 rock to 1 roll) and B; roll Receive it first, offer 100, and again with an unlimited offer | K 0, P 0, M 0, G 10, roll received 0 (both offers) |
| l | d2 (only S flagged, so K is an unflagged feeder; U and a goal of 4 gadget) plus Feed absorbing rows on P | G 10, S 20, K 2, P 1.5, U 4, wood 160, roll 1.5, seed 10, no warning; feeders `['case23-make-plate', 'case23-make-saw']` |
| m | l with P pinned at 1 (K stays unflagged) | as d: P 1, S 0, K 0, U 4, `overconstrained` tree 20; feeders `[]` |

```
a: G runs 10 for the goal and makes 20 trees. S earns 0.01 per run and each run is covered by the 2 trees G makes anyway, so S takes all 20. The saw row is locked: -0.1 · 20 + K >= 0, K = 2 (a feeder, about 1e-4 per run). 4 · P >= 2, P = 0.5 (a feeder). Wood is 8 · 20 = 160. Objective 10 · 1 = 10 less 20 · 0.01 = 9.8 plus the feeders' 1e-4 or so; the vertex is unique.
b: K's only product, saw, is consumed only by S, so K is a feeder: the same chain.
c: P is flagged too and takes only roll, which is raw, so it is not anchored and is not rewarded (rewarding it would make the LP unbounded: 4 plates per 1 roll for nothing). It feeds K, which feeds S, so it is live and costs the feeder cost.
d: plate is also used by U (ordinary), so P is not a feeder: it costs 1 and K is anchored (its plate has an ordinary producer). Per run of S: -0.01 - 0.1 · 0.01 for the extra saw rows + 0.1 · 0.25 plate runs at 1 = +0.014 > 0: S does not run, the 20 trees are left over. P runs 4 / 4 = 1 for the gadgets.
e: B takes only a raw item and feeds nothing: not rewarded, not live, so it costs 1 like an ordinary row: it does not run.
f: the rows of a, in an area: the same figures, and the trees cross from the root to Wood.
g: the wood only reads S's offer: a take never makes S run harder; the roll of the chain is requested from M like any raw input.
h: K's saw only goes to S, so K is a feeder. Supply may feed a feeder, never a flagged row, so `auuse` covers U and K. Once supply may feed K, plate no longer anchors K; S is still anchored by tree, so the rewards stand and supply reaches the chain. Wood takes 4 + 2 = 6 plates at no cost. P costs 1 per run (0.025 per S run), so it stays 0. S takes the 20 trees and K = 2.
h2: K is flagged, so supply never feeds it (`auuse` covers U only: 4). Plate comes from P, an ordinary row (U uses plate), so plate anchors K and K is rewarded. Per S run: -0.01 - 0.1 * 0.01 + 0.1 * 0.25 = +0.014 > 0. Per K run alone: -0.01 + 0.25 = +0.24. S and K stay 0.
j: K is the only row taking plate, so `supuse` covers K's 2. Supply costs 0 against about 3e-5 per plate from P (feeder cost about 1.2e-4 per run, 4 plates). P = 0, no roll needed. S 20, K 2 as in a.
k: P only feeds K and takes roll, which M and B (ordinary: B also takes roll, so M is no feeder) use or make. P is anchored, plate is bounded, K is rewarded. Letting roll supply reach P would leave P unanchored (a supplied item never anchors a feeder) and K would lose its reward. So the whole chain (K, P) stays out of `supuse`: u_roll <= 0. Per K run: -0.01 + 0.25 * 1.2e-4 + 0.25 * 1 (M) = +0.24 > 0, nothing runs. Were supply let through with K still rewarded, K would turn the 100 rolls into 400 plates and run 400 times (-4); with an unlimited offer the LP would be unbounded.
l: P is marked, so a candidate though U uses plate. P takes only roll (raw), so it is not anchored; plate is not bounded, so K would not be anchored even if it were flagged (rewarding it would pay K for 4 plates per roll for nothing); K is unflagged anyway, so only S is rewarded. S is anchored by tree. K is live (its saw only goes to S); P is live because K is. Per S run: -0.01 + 0.1 * ~1.5e-4 + 0.025 * ~1.2e-4 < 0, so S = 20, K = 2. 4P = K + U = 6, P = 1.5, roll 1.5. Tree, saw and plate balance; wood is a pure byproduct. No warning.
m: A pinned row is never a candidate, so the mark on P is ignored. Plate's only maker is pinned, so plate is bounded and K is anchored, but K is unflagged so only S is rewarded. P makes 4 * 1 = 4 plates, all of which U needs for the 4 gadget goal (U = 4), leaving K = 0; the saw is locked (-0.1 * S + K >= 0), so S = 0, and importing plate for S's reward 0.01 per run costs far more. Tree 20 is left over, as in d.
feeders: the rows that run only to feed S are marked `feedsAbsorber`: P in a, K and P in b, none in c (all flagged) and none in d (a feeder at 0 is not marked either), the plate row in f (`case23-make-plate@Wood`), K in h (`case23-make-saw@Wood`), K in j, none in k, P and K in l (K runs 2 and only feeds S), none in m. Two more checks: d2 is d with K unflagged, where K is a live feeder running at 0 and is not marked; i has two rows of the saw recipe with S flagged, and only the first (the one that carries the column) is marked.
```

---

## Case 24 — A cooling chain on a fluid with Import off

Plain made-up ids, 1 s smelting recipes. The used fluid is a split fluid ([Fluid temperatures](solver.md#fluid-temperatures)): each temperature the rows make is a key of its own (`@300` H, `@200` C3, `@100` C2, `@25` C1) and each range a row takes is another (`[250,350]` C3, `[150,250]` C2, `[50,150]` C1, `[,50]` F). A conversion column moves a temperature to a range it fits: `@300` to `[250,350]`, `@200` to `[150,250]`, `@100` to `[50,150]` and `@25` to `[,50]`, and no other pair fits. With Import off a range key has no slack, so a range nothing fits makes its consumers unable to run.

| Row | Recipe | Takes | Makes |
|---|---|---|---|
| H | `case24-heat` | 1 ore | 100 used at 300° |
| C3 | `case24-cool-300` | 100 used at 250–350° | 100 used at 200° |
| C2 | `case24-cool-200` | 100 used at 150–250° | 100 used at 100° |
| C1 | `case24-cool-100` | 100 used at 50–150° | 100 used at 25° |
| F | `case24-filter` | 100 used at 50° or less | 1 clean |

Goal: 60 `case24-clean`. Import off on `case24-used` (except in b2 and c). Ore is raw.

| Row | Setup | Expected |
|---|---|---|
| a | H, C3, C2, C1, F | every row 60; ore 60 imported; used not imported; four conversions of 6000; no `temperature-mismatch`, no `no-fitting-temperature` |
| b | a without C1 | every row 0; `unsatisfied` is the goal shortfall, 60 clean; `warnings` is exactly one `no-fitting-temperature` on `case24-used` (`max` 50, rows [F]); no `temperature-mismatch` |
| b2 | b with Import on | F 60; H, C3, C2 0; `unsatisfied` is one import of 6000 used with `temp: { max: 50 }`; no warning |
| c | a with Import on | as a |
| d | a with C1 pinned at 10 and F pinned at 60 | `infeasible-pins` with `conflict: true`, naming C1 and F; no `temperature-mismatch` |
| e | a with H, C3, C2, C1 in an area "Cool" and F in the root | the same rates; one route of used at `temp: { at: 25 }` from Cool to the root, 6000 |
| f | d with the rows in areas as in e | as d |
| g | a, and a block that also takes 100 plates from a connection as in [case 22](#case-22--a-connection-replaces-an-import) A-b (gear goal 25, P 1 makes 2, S pinned at 10) | the order keeps the chain: plate received 30, P 10, G 25, and H, C3, C2, C1, F all 60 |
| h | g with G in area L, P and S in area M and the chain in an area Cool | as g |

```
a: F makes 60 clean, so it takes 6000 used at 50° or less. Only `@25` feeds `[,50]`, and only C1 makes it, so C1 = 60; it takes 6000 at 50–150°, which only `@100` (C2) fits: C2 = 60; it takes 6000 at 150–250°, only `@200` (C3) fits: C3 = 60; it takes 6000 at 250–350°, only `@300` (H) fits: H = 60, 60 ore. Each conversion moves 6000. With Import off no range key has a slack, so nothing is imported.
b: without C1 nothing is made at 50° or less: `[,50]` has no conversion into it, and it is locked, so its row is -100·F >= 0 and F = 0. The goal needs F, so the plain LP is infeasible and the elastic goals report the shortfall: 60 clean, with H, C3 and C2 needed by nothing (0). `@100` is made by nothing that runs, so it is a byproduct and ore is not listed. `no-fitting-temperature` names the range (`max` 50) and the row that takes it (F).
b2: with Import on `[,50]` has a slack at BIG_M: F = 60 imports 6000 used at 50° or less, and the other rows have nothing to make.
c: with an import the ranges have slacks; the chain costs 300 runs plus 0.0024 for the conversions, importing 6000 costs 6e9: the chain runs.
d: C1 pinned at 10 makes only 1000 used at 25°, F pinned at 60 needs 6000 at 50° or less: infeasible. The pins hold in the elastic model too, so it is infeasible as well: `infeasible-pins` names both pins with `conflict: true` (the rates are arbitrary).
e, f: the same LP with the rows in an area: `@25` is made in Cool and taken by the conversion in the root, so it is an area item, and the used fluid crosses from Cool to the root at 25°, 6000 for F. A range key belongs to the area that takes it, so no range key crosses. In f the pins conflict as in d; the area order of the rows puts F first in the warning.
g, h: case 22 A-b gives plate 30, P 10 and G 25 whatever the chain does (it is a separate chain on `used`). The order builds the same keys and conversions, so the chain is as in a: every row 60.
```

---

## Case 25 — Keys inside a block

Plain made-up ids, 1 s smelting recipes. `case25-steam` is a split fluid with no `defaultTemperature`: B1 makes it at 165°, B2 at 500°, U at no temperature, T takes it at 465° or more, E at any temperature, R takes it at 465° or more and returns it at 165°. Fuel is raw.

| Row | Recipe | Takes | Makes |
|---|---|---|---|
| B1 | `case25-boil-165` | 1 fuel | 60 steam at 165° |
| B2 | `case25-boil-500` | 1 fuel | 30 steam at 500° |
| U | `case25-boil-any` | 1 fuel | 60 steam (no temperature) |
| T | `case25-turbine` | 60 steam at 465° or more | 1 work |
| E | `case25-engine` | 60 steam (no bound) | 1 work2 |
| R | `case25-reheat` | 60 steam at 465° or more | 60 steam at 165° and 1 work |

| Row | Setup | Expected |
|---|---|---|
| a | B1 pinned at 60, T; goal 60 work | T 60; `unsatisfied` is 3600 steam with `temp: { min: 465 }` and 60 fuel; the 165° steam is a byproduct (`netBalance` at `steam@165` is 3600); no conversion; no warning |
| b | B1, B2, T; goal 60 work | B2 120, B1 0; no steam imported; fuel 120; one conversion of 3600 from 500° to `{ min: 465 }` |
| c | B2, T, E; goals 60 work and 60 work2 | B2 240; two conversions of 3600 from 500°: to `{ min: 465 }` and to `{}` |
| d | U, T; goal 60 work | U 60; no steam imported; one conversion of 3600 from unknown to `{ min: 465 }` |
| e | B2, R; goal 60 work | R 60, B2 120; no steam imported; `netBalance` at `steam@165` is 3600 (R's net steam used to be 0) |
| f | B1 (not pinned), T; goal 60 work; Import off on steam | every row 0; `unsatisfied` is the 60 work shortfall; `warnings` is exactly one `no-fitting-temperature` on steam (`min` 465, rows [T]) |
| g | B1, T flagged as a byproduct consumer, E; goal 60 work2 | E 60 on the 165 steam; T 0 (its range has nothing that fits, and a byproduct consumer's ingredient is locked); the goal is met; no `no-fitting-temperature` |

```
a: `@165` fits no range of T (`[465,]`), so no conversion exists and `@165` is a byproduct. `[465,]` is a forced intermediate with a slack at BIG_M: T = 60 takes 3600, all imported, with the 60 fuel of B1. The 3600 made at 165° is surplus.
b: `@500` fits `[465,]`: 30 · B2 = 3600, B2 = 120 and B1 stays 0 (it makes nothing a range takes). Fuel is 120.
c: both ranges are fed from `@500`: 30 · B2 = 3600 + 3600, B2 = 240; one conversion each, to `[465,]` and to `[,]`.
d: unknown fits every range: 60 · U = 3600, U = 60.
e: R takes 3600 `[465,]`, which only `@500` fits: 30 · B2 = 3600, B2 = 120. R makes 3600 at `@165`, which fits nothing: a byproduct.
f: with Import off `[465,]` is locked with no conversion into it, so T = 0; the elastic goals report the 60 work. B1 would only make a byproduct, so it stays 0. `no-fitting-temperature` names steam at 465° or more and T.
```

## Case 26 — Connections carry temperature keys

Case 25's steam and rows, with two more 1 s recipes: W `case26-make-widget` (1 fuel → 1 widget and 60 steam at 500°) and W2 `case26-make-widget2` (1 fuel → 1 widget2 and 60 steam at 165°). Rates per minute. The plan's ranges of steam are `[465,]` (T) and `[,]` (E), so N = 2; the versatility of `@500` is 2 and of `@165` 1, the depth of `[465,]` is 2 and of `[,]` 1. Costs are in units of `SUPPLY_TIE_COST` = 1e-7; a conversion out of a supplied key costs `CONVERT_COST` (common to all) plus `N · (N − depth)` of them (R1, `SUPPLY_DEPTH = 1`): 0 for `@500→[465,]`, 2 for `@500→[,]` and 2 for `@165→[,]`; a supplied unit of `@500` costs 2 and of `@165` 1.

Source A: W (goal 60 widget) and W2 pinned at 30, so it offers 3600 at 500° and 1800 at 165°. Consumer B: T and E, goals 30 work and 30 work2 (3600 of steam, 1800 at ≥465° and 1800 at any temperature), a take from A.

| Row | Setup | Expected |
|---|---|---|
| a | A and B as above | flow rate 3600, `ok`, no steam import, `parts` 165° 1800 (on offer 1800) and 500° 1800 (on offer 3600), no warning |
| b | a with `maxRate` 2700 | T 1800 at 500°, E 900 at 165°; B imports 900 steam `{}`; flow 2700, available 2700, `limited`, `capped`; parts 165° 900, 500° 1800 |
| c | A: boilers B1 and B2 with steam as a product (no extra); B as in a with a request | requested 3600 in all: `{}` 1800 and `{ min: 465 }` 1800 (the parts carry `requested`); A runs B2 60 and B1 30; no import in B |
| d | A: W2 alone, goal 30 widget2 (offers 1800 at 165°); B: T alone, goal 30 work, a take | flow rate 0, `unused`; B imports 1800 steam `{ min: 465 }`; B's warnings are exactly one `connection-temperature`: connection offered `[{ 165, 1800 }]`, needed `[{ min 465, 1800 }]` |

```
a: B's pass 1 imports 3600 (1800 on `[465,]`, 1800 on `[,]`), so pass 2 caps the supplied keys together at min(3600 + 1800, 3600) = 3600 (the fluid cap) and each key by its offer (@500 3600, @165 1800). T can only use @500. E takes @165 at 1 + 2 = 3 against @500 at 2 + 2 = 4, so E takes @165: 1800 each.
b: with `maxRate` 2700 the supply is at most 2700 and 900 is imported whichever the split. X (T 1800 at 500°, E 900 at 165°) costs 1800·(0 + 2) + 900·(2 + 1) = 6300 units, Y (T 900 at 500°, E 1800 at 165°, the turbine's 900 imported) 900·2 + 1800·3 = 7200. X wins: the depth term is what keeps the narrow range fed first. Without it (decision 11 as written) X costs 1800·2 + 900·1 = 4500 and Y 900·2 + 1800·1 = 3600, and Y would win (T 900 at 500°, E 1800 at 165°, import 900 `{ min: 465 }`). Both imports cost BIG_M, so only the ties decide.
c: B's probe (raw range keys, unlimited supply) needs 1800 on `[465,]` and 1800 on `[,]`: the request parts. A's goals are steam `[465,]` 1800 and steam any 1800. `[465,]` takes @500 only: 30 · B2 = 1800, B2 = 60. `[,]` is cheapest on B1 (60 per run against 30): B1 = 30. A offers the range keys `[465,]` 1800 and `[,]` 1800, which B takes into T (`[465,]#in` costs 2 + 0) and E (`[,]#in` costs 1 + 2, against 2 + 2 from `[465,]#in`).
d: @165 fits no range B takes: no supplied key, `[465,]` stays a raw range key and T imports it. The connection offers only a known temperature that fits none of B's imported ranges: `connection-temperature`.
```

## Case 27 — Fit before rank

Source A has case 26 a's rows with goal 30 widget: W 30 (1800 at 500°) and W2 pinned at 30 (1800 at 165°). Consumer C1: E with goal 30 work2 (needs 1800 at any temperature). Consumer C2: T with goal 30 work (needs 1800 at ≥465°). Both take steam from A.

| Row | Setup | Expected |
|---|---|---|
| a | A's served list C1, C2 | C1 takes 1800 at 165°, C2 1800 at 500°; no import; served shares 1800 and 1800 (parts C1 165° 1800, C2 500° 1800) |
| b | a with W2 pinned at 15 (900 at 165°) | C1 (ranked first, fully served) takes 900 at 165° and 900 at 500°, C2 900 at 500° and imports 900 steam `{ min: 465 }`, flow `limited`; shares 1800 and 900 |
| c | no list; tabs A, C1, C2 or A, C2, C1 | as a: C1 takes @165 (3 against 4), C2 takes @500; C1, solved first with no reservation, lists 500° with rate 0 and 1800 on offer |
| d | b with C1 and C2 tied 50/50 | C1 900 at 165° + 450 at 500°, imports 450 `{}`; C2 1350 at 500°, imports 450 `{ min: 465 }`; both `limited`; shares 1350 and 1350 |

```
a: the allocation fills group C1 first: its maximum is 1800, so level L1 = 1800. Group C2 then maximises with L1 held: C1 must take @165, so C2 gets @500 1800. The final solve is unique. Credits C1 {@165: 1800}, C2 {@500: 1800}; the grants per key repeat them. C1's caps: @165 1800, @500 connectionOffer(1800, 1800, 0) = 0.
b: @165 is 900. C1: maximum 1800, L1 = 1800 (900 at @165, 900 at @500). C2: what C1's 1800 leaves of @500 is 900, so C2 = 900 and C1 = @165 900 + @500 900. C1's caps: @165 900, @500 connectionOffer(1800, 1800, 900) = 900.
c: with no list C1 is solved first and takes the key that costs it least: @165 at 3 units, @500 at 4. C2 then takes @500 1800.
d: progressive fill with g1 = g2 = t; C2 can use @500 only and 2t ≤ 2700, so t = 1350. C2 = @500 1350, C1 = @165 900 + @500 450. Grants per key: @165 waterFill(900, [900, 0]) gives C1 900; @500 waterFill(1800, [450, 1350]) gives 450 and 1350.
```

## Case 28 — Leftover off

Plain made-up ids, every recipe 1 s. `use` turns 100 coolant into 1 P and 100 hot; `cool-a` turns 200 hot into 200 warm; `cool-b` 200 warm into 200 cold; `filter` 200 cold into 160 coolant; `filter-cart` is `filter` taking 1 cart too; `brew` makes 100 coolant from a raw item; `make-cart` 1 raw item into 1 cart; `twin` makes 1 P and 2 Q; `make-q` 1 Q. Goal 10 P (rows g and h: 10 P and 40 Q). *Leftover off* is `leftoverOff` in the block's rule of an item (`LEFTOVER_COST = 10`).

| Row | Setup | Expected (runs/min) |
|---|---|---|
| a | no rule | use 10, brew 10, the rest 0 (20 runs); 1000 hot left over, `overconstrained` names hot |
| b | Leftover off on hot, warm and cold | use 10, cool-a 5, cool-b 5, filter 5, brew 2 (27 runs); hot, warm and cold net 0; no `overconstrained` |
| c | Leftover off on hot only | use 10, cool-a 5, cool-b 0, brew 10; hot net 0, 1000 warm left over (the chain limit) |
| d | as b, `use` in an area of its own, the loop at the root | as b |
| e | as b with `filter-cart` for `filter`, `make-cart` pinned at 0, 100 carts offered by a connection (default rule on cart) | as a; no cart received; 1000 hot left over (the connected-input limit) |
| f | as e, cart on Receive it first | as b with `filter-cart` 5; 5 carts received |
| g | goals 10 P and 40 Q, `twin` and `make-q`, no rule | twin 20, make-q 0 (20 runs); P net 20 (10 over its goal) |
| h | as g, Leftover off on P | twin 10, make-q 20 (30 runs); P net 10 |

```
a: the 10 use need 1000 coolant, which 10 brew make: 20 runs. The loop would recover 800 of it for 15 runs (27 in all with 2 brew), and a left-over is free, so the 1000 hot stays.
b: 10 use make 1000 hot; the loop takes it all: 5 cool-a, 5 cool-b, 5 filter give 800 coolant, brew 2 gives the other 200. 10 + 5 + 5 + 5 + 2 = 27 runs. Priced at 10 per unit, 1000 hot left over costs 10,000 against 7 more runs.
c: hot is priced, warm is not: cool-a turns the 1000 hot into warm (5 runs, 10,000 saved) and nothing is gained by going on.
e: the loop needs 5 carts; the default rule prices one as an import at BIG_M (5e6 for the five) against 10,000 for the left-over, and the residual after pass 1 has no cart for the loop: it stays open.
f: Receive it first supplies the 5 carts at no cost, so the loop costs 27 runs against 20 + 10,000.
g, h (derived by hand, not measured): with t twin runs, the cost of h is t + max(0, 40 − 2t) + 10 (t − 10) = 9t − 60 for t ≤ 20, minimal at t = 10 (30 runs); at t = 20 it is 120.
```

Two observations, not derived: a pair item (case b with a second `cool-b` in an area that takes no warm from the area of `cool-a`) gives b's result with the second `cool-b` at 0; and an area's own rule for hot (Import off) does not drop the block's rule: b's result with all rows in that area.

## Case 29 — A take credited after its consumer

**Exercises:** a listed take whose consumer requests nothing of the item, reached by the request pass before its source (it waits and is credited once its source and the takes above it are), with the source in a cycle of requests, with a consumer shown as areas, and a take of a member source inside a cycle (the member's leftover estimate, of the same round or the previous one).

**Recipes:** cases 11's (X = `case11-x`), 13's (plate = `case13-plate`, with `case13-use-plate` making a gear) and 17's (q = `case17-q`, r = `case17-r`), time 1, category smelting.

### 29a — no cycle (the shape of the stone take)

- **T**: goal 30, plate 0; rows make-goal and make-plate. Its list is on X.
- **C**: q 0, other 15, gear 5; rows make-q, use-x and use-plate. Connections, in this order: `c-CT` takes X from T, `c-CP` requests plate from T.
- **H**: r 10, other 10; rows use-q and use-x. Connections: `c-HT` takes X from T, `c-HC` requests q from C.

The request pass reaches H, C, T (the edges T to H and T to C would close a cycle). H needs 10 X, C needs 25 X (10 for the q H requests, 15 for other); neither requests X, so both takes wait. T leaves 30 X, and `c-CP` asks for 5 plate.

| List on X | Tabs | `c-HT` | `c-CT` | `c-HC` / `c-CP` | Lines (share/got, need) |
|---|---|---|---|---|---|
| H, C | T,H,C / H,C,T / C,H,T | 10 `ok`, H imports 0 | 20 `limited`, C imports 5 | 10 / 5 `ok` | H 10, need 10; C 30 - 10 = 20, need 25; no `notCredited` |
| C, H | same | 5 `limited`, H imports 5 | 25 `ok`, C imports 0 | 10 / 5 `ok` | C 25, need 25; H 5, need 10; no flags |
| H, C, `c-CT` capped at 18 | same | 10 `ok` | 18 `limited`, C imports 7 | | H 10, need 10; C 18, need 25 |

T runs make-goal 30 and make-plate 5. Before the take waited, the first row read: C 25 `ok`, H 5 `limited`, both lines `notCredited` with share 0.

**a4 (areas):** H is in areas L (use-x pinned 6) and B (use-x pinned 4), use-q at the root; C has *Receive it first* on X. List H/L, H/B, C. H's credit is min(30, 10) = 10, split 6:4 by the needs of its areas; C gets 20. Lines: H/L 6 (need 6), H/B 4 (need 4), C 20 (need 25).

### 29b — the source in a cycle of requests (the real path)

29a plus: T also has product r 5 and row use-q, and `c-Tq` requests q from **M** (q 0, gear 5; rows make-q and use-plate), which requests plate from T with `c-MP`. X is raw in M, so M imports 5. `requestLoops[0]` has the blocks T and M, `rounds: 2` and `converged: true`. T's plate goal is 10 (C's 5 and M's 5). H and C wait for T through the cycle: the flows and lines of 29a. A warm solve through one `SolveCache` equals a cold one, when the list, a need or the credit of a take changes.

### 29c — a take of a member source (the shape of the sulfur take)

- **S**: goal 15, r 10, plate 0; rows make-goal, use-q and make-plate. `c-Sq` requests q from K.
- **K**: q 0, other 10; rows make-q and use-x. Connections, in this order: `c-KS` takes X from S, `c-KV` requests X from V.
- **V**: X 0, gear 5; rows make-x and use-plate. `c-VS` requests plate from S.

The cycle is S, K, V. K takes X first (it also requests it from V), so the take feeds K's request and cannot wait: it reads S's leftover estimate inside the demand rounds.

- **c1, tabs S, K, V** (the source before its consumer). Round 1: S needs 10 q and leaves 15 X (its estimate, same round); K needs 20 X (10 for q, 10 for other), is credited 15 from S and asks V for 5; V makes 5 X (2.5 runs) and needs 5 plate (back request). Round 2 has the same output: settled in 2 rounds.
- **c2, tabs K, V, S** (the source after its consumer; back connection `c-Sq` and a back estimate of (S, X)). Round 1: K has no q goal yet and needs 10 X; there is no estimate of S, so `c-KV` is 10; S outputs q 10 and an estimate of 15 X. Round 2: K needs 20 X, is credited the 15 of the back estimate and asks V for 5. The output equals the input: settled in 2 rounds.
- **Expected in both orders:** `c-KS` 15 `ok`; `c-KV` requested 5 and rate 5; `c-Sq` 10; `c-VS` 5; V runs make-x 2.5; K imports 0 X; `requestLoops[0]` converged in 2 rounds. Before the member's estimate was read: `c-KS` 0 `unused`, `c-KV` 20, make-x 10, S's 15 X left over.
- **Unsettled** (`requestRoundLimit: 1`): c1 reads the estimate of the same round, so `c-KS` is 15; c2 has no back estimate in the final round, so `c-KS` is 0 and `c-KV` is 10.

### 29d — parked slices

- A parked take's consumer takes X from W too (no list on W), after `c-CT`: its slice is `c-CT, c-CW`. Once H has its 10, T has 20 left: `c-CT` covers 20 of C's 25 and `c-CW` the other 5 of W's 10 (it reads W's leftover when the slice resumes, in connection order).
- A tied group (C, H2) below a parked take (H): the group cannot be shared by need (H is not credited when the pass reaches it), so it is credited and granted in list order: H 10, C 20, H2 0 (H2 imports its 5).
