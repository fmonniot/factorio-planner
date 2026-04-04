# Data Model

All types are defined in TypeScript. The game data bundle is a single JSON file
produced by the Lua export script. Field names and shapes are grounded in the
analysis of real `data.raw` output — see `spec/data-analysis.md` for findings.

---

## Game Data (static, loaded at startup)

### Item

```ts
interface Item {
  id: string;           // internal name, e.g. "iron-plate"
  name: string;         // display name (localised_name resolved to English, or id fallback)
  type: "item" | "fluid";
  iconPath: string;     // relative path to the icon PNG within the export directory
  stackSize?: number;   // undefined for fluids
}
```

### Recipe

```ts
interface Recipe {
  id: string;
  name: string;         // display name
  category: string;     // open string — "crafting", "smelting", "oil-processing", etc.
                        // absent in data.raw means "crafting" (default)
  craftingTime: number; // seconds at crafting_speed=1 (data.raw: energy_required, default 0.5)
  ingredients: Ingredient[];
  products: Product[];
  madeIn: string[];     // machine ids whose crafting_categories include this recipe's category
  allowProductivity: boolean;  // whether productivity modules may be applied
  mainProduct?: string; // item id of the primary output; absent = single-product recipe;
                        // null = explicitly multi-output with no primary (main_product="")
}

interface Ingredient {
  itemId: string;
  type: "item" | "fluid";
  amount: number;
  // Fluid temperature constraints — informational, not used by solver in v1
  minimumTemperature?: number;
  maximumTemperature?: number;
}

interface Product {
  itemId: string;
  type: "item" | "fluid";
  amount: number;
  probability?: number;           // 0–1, defaults to 1; if < 1 item may not appear
  // Amount range for variable-yield products (rarely used; average = (min+max)/2)
  amountMin?: number;
  amountMax?: number;
  // Productivity exclusion: this many units are "fixed" and do not benefit from
  // productivity bonuses. Only the amount above this threshold scales with productivity.
  // Used by Kovarex enrichment (U-235 input/output).
  ignoredByProductivity?: number;
}
```

### Machine

```ts
interface Machine {
  id: string;
  name: string;
  type: "assembling-machine" | "furnace" | "rocket-silo";
  craftingSpeed: number;          // multiplier on craftingTime; 1.0 = base speed
  energyUsageKw: number;          // kW at full load (parsed from "150kW" / "9.75MW" string)
  energyType: "electric" | "burner" | "heat" | "void";
  drainKw: number;                // kW idle drain; 0 for non-electric or when absent
  moduleSlots: number;            // 0 when the field is absent in data.raw
  allowedEffects: EffectName[];   // which module effects this machine accepts
  craftingCategories: string[];   // recipe categories this machine can execute
  iconPath: string;
}

type EffectName = "speed" | "productivity" | "consumption" | "pollution" | "quality";
```

### Module

```ts
interface Module {
  id: string;
  name: string;
  category: string;   // "speed" | "productivity" | "efficiency" | etc. (open string)
  tier: number;
  effects: Partial<Record<EffectName, number>>;  // additive fraction, e.g. 0.2 = +20%
  // Recipe restriction. Empty = unrestricted (applies to all allowed recipes).
  limitation: string[];           // recipe ids this module IS restricted to
  limitationBlacklist: string[];  // recipe ids this module is excluded from
}
```

### GameData (root bundle)

```ts
interface GameData {
  // Game/mod version information
  factorioVersion: string;        // e.g. "2.0.28"
  modSet: Record<string, string>; // { mod_name: version } for all active mods

  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  machines: Record<string, Machine>;
  modules: Record<string, Module>;

  // Suggested default machine per recipe category.
  // Populated by the export script based on the "best" available machine
  // (typically the highest tier) for each category.
  defaultMachines: Record<string, string>;  // category -> machine id
}
```

---

## Plan (user data, persisted)

A plan is the unit of user work. It is serialized to JSON for export and URL sharing.

### ProductionGoal

```ts
interface ProductionGoal {
  id: string;       // stable uuid
  itemId: string;
  rate: number;     // items per minute
}
```

### RecipeNode

One node in the solved production tree. Corresponds to one recipe running at a computed rate.

```ts
interface RecipeNode {
  id: string;
  recipeId: string;

  // User overrides (all optional — absent means use plan/global defaults)
  machineId?: string;             // overrides default machine for this recipe's category
  modules: ModuleConfig[];        // per-node module configuration; enforced against moduleSlots
  beaconConfig?: BeaconConfig;
  pinnedRate?: number;            // if set, solver treats this throughput as fixed

  // Per-product byproduct policy. Default: "feed-back".
  // Only needs an entry when the user has changed a product away from the default.
  byproductPolicy: Record<string, "discard" | "feed-back">;
}

interface ModuleConfig {
  moduleId: string;
  count: number;
}

interface BeaconConfig {
  moduleId: string;
  beaconCount: number;
  modulesPerBeacon: number;             // typically 2
  distributionEfficiency: number;       // fraction of beacons affecting this machine, 0–1
}
```

### Plan

```ts
interface Plan {
  id: string;
  name: string;
  gameDataVersion: string;        // factorioVersion from the loaded GameData
  goals: ProductionGoal[];
  nodes: RecipeNode[];            // one per active recipe; populated/updated on solve
  createdAt: string;              // ISO timestamp
  updatedAt: string;
}
```

---

## Solver State

Transient, not persisted. Produced by the solver and consumed by the UI.

```ts
interface SolverResult {
  nodes: SolvedNode[];
  unsatisfied: UnsatisfiedItem[];   // items with no producing recipe (raw resources)
  warnings: SolverWarning[];
}

interface SolvedNode {
  recipeNodeId: string;
  inputRates: Record<string, number>;    // itemId -> items/min consumed
  outputRates: Record<string, number>;   // itemId -> items/min produced (gross, before byproduct policy)
  throughput: number;                    // recipe executions/min
  machineCountExact: number;
  machineCountCeil: number;
  powerKw: number;
}

interface UnsatisfiedItem {
  itemId: string;
  rate: number;                     // items/min that must come from outside (miners, imports)
}

type SolverWarning =
  | { type: "cycle-detected"; recipeIds: string[] }
  | { type: "underdetermined"; freeVariables: string[] }
  | { type: "no-recipe"; itemId: string }
  | { type: "productivity-not-allowed"; recipeId: string };
```

---

## Known Omissions (v1)

These fields exist in `data.raw` but are intentionally excluded from the v1 model:

- **`fluidbox_index`** on ingredients/products — physical fluid port routing; irrelevant to flow-rate solver
- **`ignored_by_stats`** — cosmetic UI flag; no effect on calculations
- **`quality`** — quality tier on items; all items treated as normal quality
- **`allow_quality`** on recipes — quality upgrade mechanics ignored
- **`allow_decomposition`** — recycling recipes; out of scope
- **`parameter: true`** recipes — blueprint parameter slots; filtered out during import
