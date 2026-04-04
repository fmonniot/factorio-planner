# Data Analysis — Nullius Mod Export

Analysis of `data/samples/nullius/data-raw-dump.json` (41MB, data.raw stage dump,
Nullius overhaul mod + base game, Factorio 2.0).

Dataset size: 2405 recipes · 1038 items · 89 fluids · 136 machines (101 assembling + 33 furnace + 2 rocket-silo) · 27 modules · 2 quality tiers.

---

## Corrections to the Draft Data Model

### 1. `energy_required` vs `energy`

In `data.raw`, the field is **`energy_required`** (time in seconds). The runtime Lua API exposes it as `proto.energy`. Both refer to the same value. The export script uses runtime API so `energy` is correct there; the data model should document both names.

Default when absent: **0.5 seconds** (271 recipes omit `category`, 109 omit `energy_required`).

### 2. `energy_usage` is a string, not a number

Contrary to what the Lua API docs suggested, in `data.raw` `energy_usage` is a **formatted string**: `"75kW"`, `"375kW"`, `"9.75MW"`, `"20MW"`. Same for `energy_source.drain`: `"6kW"`, `"60kW"`.

The importer must parse these strings into watts. Suffixes observed: `kW`, `MW`. No `W` or `GW` seen but should be handled.

### 3. `crafting_categories` on machines is an array, not a dict

In the data model spec it was described as a dict. In `data.raw` it is a plain **array of strings**:
```json
"crafting_categories": ["crafting", "basic-crafting", "advanced-crafting"]
```

### 4. `module_slots` absence means 0

`assembling-machine-1` has no `module_slots` field at all. Absence = 0 slots. The TypeScript type should default to 0.

### 5. Module effects include `quality`

Five effect names appear in practice: `speed`, `productivity`, `consumption`, `pollution`, **`quality`**. The `Module.effects` type must include `quality?`. Machines also have `quality` in their `allowed_effects` list.

Speed modules have `quality: -0.1` (negative quality effect). This is confirmed in `data.raw`.

### 6. `ignored_by_productivity` on products

Kovarex enrichment has `ignored_by_productivity: 40` on the U-235 product. This means productivity bonuses do **not** apply to that amount — only the excess above 40 benefits. The spec's productivity stoichiometry section must account for this:

```
effective_output = amount - ignored_by_productivity + (amount - ignored_by_productivity) * productivityBonus
                 = (amount - ignored_by_productivity) * (1 + productivityBonus) + ignored_by_productivity
```

`ignored_by_stats` appears on both ingredients (222 occurrences) and products (222 occurrences) — this is purely cosmetic (hides from production stats UI) and can be ignored by the solver.

### 7. `allow_productivity` is a recipe-level flag

Only 1220 of 2405 recipes have `"allow_productivity": true`. Recipes without this flag must reject productivity modules. The solver must check this before applying the productivity stoichiometry adjustment.

### 8. `main_product` shapes

Two variants:
- `"main_product": ""` — explicitly no main product (5 recipes, all multi-output)
- `"main_product": "item-name"` — names the primary product (412 recipes)
- Absent — implicitly the single product when there is only one (the majority)

For recipe-to-item mapping (which recipe produces which item), use: if `main_product` is a non-empty string, that item is the primary output. Otherwise, if there is exactly one product, that is the primary output. Multi-output with `main_product=""` has no primary.

### 9. `parameter: true` recipes

10 recipes have `"parameter": true` and no `results` field. These are Factorio's blueprint parameter recipes — not real production recipes. **Filter these out** during import (skip any recipe with `parameter: true` or missing `results`).

### 10. `amount_min` / `amount_max` not observed

These fields (probabilistic product ranges) do not appear in this dataset. They exist in the API spec but may only be used by specific modded content. Keep in the type definition as optional but do not build special solver logic for them in v1; treat as equivalent to a fixed `amount` equal to `amount_min + (amount_max - amount_min) / 2` if encountered.

### 11. `fluidbox_index` on ingredients/products

185 ingredient entries and 67 product entries have a `fluidbox_index` field. This indicates which physical fluid port on the machine to use. Relevant for multi-fluid-port machines (e.g. a machine with separate input/output fluid boxes). **Ignore for v1** — the solver works with item/fluid flow rates only, not physical connections.

---

## Category Landscape

The Nullius mod adds 50+ custom recipe categories. Vanilla 2.0 has far fewer. The key insight: **recipe categories are open strings**, not an enum. The planner must treat them as opaque strings and map them to machines dynamically, not via a hardcoded list.

Vanilla categories that appear in this dataset: `crafting`, `smelting`, `oil-processing`, `centrifuging`, `chemistry`, `crafting-with-fluid`, `advanced-crafting`, `rocket-building`.

---

## Machine `energy_source` Structure

Two energy source types observed on crafting machines:

**Electric:**
```json
{
  "type": "electric",
  "usage_priority": "secondary-input",
  "drain": "3kW",          // idle drain (may be absent)
  "emissions_per_minute": { "pollution": 2 }
}
```

**Burner:**
```json
{
  "type": "burner",
  "fuel_categories": ["chemical"],
  "effectivity": 1,
  "fuel_inventory_size": 1,
  "emissions_per_minute": { "pollution": 2 }
}
```

Drain only appears on electric machines. `effectivity` on burners affects fuel consumption (fuel value × effectivity = usable energy).

---

## Quality Tiers

This dataset only has 2 quality prototypes: `quality-unknown` (hidden, level 0) and `normal` (level 0, `next_probability: 0.1`). Vanilla Space Age adds 5 (normal through legendary). The Nullius mod does not implement quality tiers. This confirms the v1 decision to ignore quality is safe for this mod.

---

## Implications for the Lua Export Script

The following corrections are needed for the export script:

1. **`energy_usage` and `drain`** — already exported as strings ("150kW"). The import/Zod layer must parse these; alternatively the script can parse them to numbers (divide kW by 1, MW × 1000).
2. **`crafting_categories`** — already exported as an array, correct.
3. **`module_slots`** — script uses `field(proto, "module_slots") or 0`, correct.
4. **Filter parameter recipes** — add `if not r.parameter` guard in the recipe export loop.
5. **`allow_productivity`** — add to the recipe export (currently missing from the script).
6. **`ignored_by_productivity`** — add to product export.

---

## Implications for the TypeScript Data Model

See updated `data-model.md` for the revised type definitions reflecting these findings.
