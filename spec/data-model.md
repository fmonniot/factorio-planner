# Data Model

All types are defined in TypeScript. The game data bundle is a single JSON file produced by a Lua export script run against the game or loaded from a community-maintained source.

---

## Game Data (static, loaded at startup)

### Item

```ts
interface Item {
  id: string;           // internal name, e.g. "iron-plate"
  name: string;         // display name, e.g. "Iron Plate"
  type: "item" | "fluid";
  iconPath: string;     // path within the icon sprite sheet
  stackSize?: number;   // undefined for fluids
}
```

### Recipe

```ts
interface Recipe {
  id: string;
  name: string;
  category: string;           // "crafting", "smelting", "chemistry", "oil-processing", ...
  craftingTime: number;       // seconds
  ingredients: Ingredient[];
  products: Product[];
  madeIn: string[];           // machine ids that can run this recipe
  isAlternate?: boolean;      // true for non-default recipes (e.g. advanced oil processing)
}

interface Ingredient {
  itemId: string;
  amount: number;
}

interface Product {
  itemId: string;
  amount: number;
  probability?: number;       // 0–1, defaults to 1
}
```

### Machine

```ts
interface Machine {
  id: string;
  name: string;
  craftingSpeed: number;      // multiplier on crafting time
  energyConsumption: number;  // kW at full load
  drainConsumption: number;   // kW idle drain (electric machines)
  energyType: "electric" | "burner" | "heat" | "void";
  moduleSlots: number;
  allowedCategories: string[];
  iconPath: string;
}
```

### Module

```ts
interface Module {
  id: string;
  name: string;
  tier: number;
  effects: {
    speed?: number;           // additive fraction, e.g. 0.2 = +20%
    productivity?: number;
    consumption?: number;
    pollution?: number;
  };
  limitations: string[];      // recipe ids this module is restricted to (empty = no restriction)
}
```

### GameData (root bundle)

```ts
interface GameData {
  version: string;            // e.g. "2.0.28"
  modSet: string[];           // mod ids included, empty for vanilla
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  machines: Record<string, Machine>;
  modules: Record<string, Module>;
  // Default machine per category, used as initial machine selection
  defaultMachines: Record<string, string>;
}
```

---

## Plan (user data, persisted)

A plan is the unit of user work. It is serialized to JSON for export and URL sharing.

### ProductionGoal

```ts
interface ProductionGoal {
  id: string;           // stable uuid
  itemId: string;
  rate: number;         // items per minute
}
```

### RecipeNode

One node in the solved production tree. Corresponds to one recipe running at a computed rate.

```ts
interface RecipeNode {
  id: string;
  recipeId: string;
  // Solver output
  throughput: number;         // recipe executions per minute
  machineCount: number;       // exact (non-rounded)
  // User overrides
  machineId?: string;         // overrides default machine for this category
  modules: ModuleConfig[];
  beaconConfig?: BeaconConfig;
  ratePinned?: number;        // if set, solver treats this rate as fixed (free variable)
  byproductPolicy: Record<string, "discard" | "feed-back">;  // default: "feed-back"
}

interface ModuleConfig {
  moduleId: string;
  count: number;
}

interface BeaconConfig {
  moduleId: string;
  beaconCount: number;
  modulesPerBeacon: number;   // typically 2
  distributionEfficiency: number; // fraction of beacons affecting this machine
}
```

### Plan

```ts
interface Plan {
  id: string;
  name: string;
  gameDataVersion: string;
  goals: ProductionGoal[];
  nodes: RecipeNode[];        // populated/updated by solver
  createdAt: string;          // ISO timestamp
  updatedAt: string;
}
```

---

## Solver State

Transient, not persisted. Produced by the solver and consumed by the UI.

```ts
interface SolverResult {
  nodes: SolvedNode[];
  unsatisfied: UnsatisfiedItem[];  // items with no available recipe (raw resources)
  warnings: SolverWarning[];
}

interface SolvedNode {
  recipeNodeId: string;
  inputRates: Record<string, number>;   // itemId -> items/min consumed
  outputRates: Record<string, number>;  // itemId -> items/min produced
  machineCountExact: number;
  machineCountCeil: number;
  powerKw: number;
}

interface UnsatisfiedItem {
  itemId: string;
  rate: number;   // items/min that must come from outside (miners, imports)
}

type SolverWarning =
  | { type: "cycle-detected"; recipeIds: string[] }
  | { type: "underdetermined"; freeVariables: string[] }
  | { type: "no-recipe"; itemId: string };
```
