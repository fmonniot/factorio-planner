# Solver Test Corpus

Six recipe chains of increasing complexity, all using real Nullius recipes verified
against the raw `factorio --dump-data` output (see AGENTS.md for how to regenerate).

All machine counts use **crafting_speed = 1, no modules** unless stated otherwise.

Formula: `machineCount = throughput_exec_per_min × craftingTime_s / 60`

Raw resources confirmed: `iron-ore` has no non-packaging non-hidden producer;
`nullius-air` has no recipe at all (pump-only).

---

## Case 1 — Linear chain with byproduct

**Exercises:** basic stoichiometry, multi-step chain, byproduct on intermediate recipe
(gravel) with feed-back policy defaulting to discard since nothing demands it.

**Goal:** 60 `nullius-iron-plate` / min

### Recipes

| Recipe | Category | Time | Ingredients | Products |
|---|---|---|---|---|
| `nullius-iron-ingot-1` | dry-smelting | 8s | 5 iron-ore | 2 nullius-iron-ingot + 1 nullius-gravel |
| `nullius-iron-plate-1` | machine-casting | 3s | 4 nullius-iron-ingot | 3 nullius-iron-plate |

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `nullius-iron-plate-1` | 20 | 1.000 |
| `nullius-iron-ingot-1` | 40 | 5.333 |

Raw resources: **iron-ore 200 / min**
Byproduct surplus: **nullius-gravel 40 / min** (no demand, fed-back but discarded)

### Derivation

```
nullius-iron-plate-1: 60/min ÷ 3 plates/exec = 20 exec/min
  → nullius-iron-ingot demand: 20 × 4 = 80/min

nullius-iron-ingot-1: 80/min ÷ 2 ingots/exec = 40 exec/min
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
| `nullius-iron-ingot-1` | dry-smelting | 8s | 5 iron-ore | 2 nullius-iron-ingot + 1 nullius-gravel |
| `nullius-iron-plate-1` | machine-casting | 3s | 4 nullius-iron-ingot | 3 nullius-iron-plate |
| `nullius-iron-rod-1` | machine-casting | 4s | 4 nullius-iron-ingot | 5 nullius-iron-rod |
| `nullius-iron-gear` | small-crafting | 4s | 2 nullius-iron-plate + 1 nullius-iron-rod | 2 nullius-iron-gear |

### Expected solver output

| Recipe | Throughput (exec/min) | Machine count (exact) |
|---|---|---|
| `nullius-iron-gear` | 15 | 1.000 |
| `nullius-iron-plate-1` | 10 | 0.500 |
| `nullius-iron-rod-1` | 3 | 0.200 |
| `nullius-iron-ingot-1` | 26 | 3.467 |

Raw resources: **iron-ore 130 / min**
Byproduct surplus: **nullius-gravel 26 / min**

### Derivation

```
nullius-iron-gear: 30/min ÷ 2 gears/exec = 15 exec/min
  → nullius-iron-plate demand: 15 × 2 = 30/min
  → nullius-iron-rod demand:   15 × 1 = 15/min

nullius-iron-plate-1: 30/min ÷ 3 plates/exec = 10 exec/min
  → ingot demand from plates: 10 × 4 = 40/min

nullius-iron-rod-1: 15/min ÷ 5 rods/exec = 3 exec/min
  → ingot demand from rods: 3 × 4 = 12/min

Total ingot demand: 40 + 12 = 52/min
nullius-iron-ingot-1: 52/min ÷ 2 ingots/exec = 26 exec/min
  → iron-ore: 26 × 5 = 130/min (raw)
  → gravel:   26 × 1 = 26/min (byproduct)
```

---

## Case 3 — Multi-output recipe

**Exercises:** one recipe producing three outputs; only one is a stated goal;
remaining outputs are byproduct surplus under feed-back policy.

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

Raw resources: **uranium-238 15 / min**

### Derivation

```
Net U-235 per exec: 41 − 40 = +1
Throughput: 5/min ÷ 1/exec = 5 exec/min

Net U-238 per exec: 2 − 5 = −3
U-238 raw demand: 5 × 3 = 15/min
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
| `kovarex-enrichment-process` | ≈3.571 | ≈3.571 |

Raw resources: **uranium-238 ≈ 10.714 / min**

### Derivation

```
Throughput: 5/min ÷ 1.40 net U-235/exec ≈ 3.571 exec/min
U-238 raw:  3.571 × 3 ≈ 10.714/min
```

Compared to Case 4 (no modules): throughput 5.000 → 3.571 (−29%),
U-238 consumption 15 → 10.714 (−29%). Productivity reduces both proportionally
because U-238's `ignoredByProductivity` covers all its output — it is unaffected.
