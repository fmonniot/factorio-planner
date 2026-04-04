// ---------------------------------------------------------------------------
// Game Data — static, loaded at startup from the exported JSON bundle
// ---------------------------------------------------------------------------

export interface Item {
  id: string
  name: string
  type: 'item' | 'fluid'
  iconPath: string
  stackSize?: number // undefined for fluids
}

export interface Ingredient {
  itemId: string
  type: 'item' | 'fluid'
  amount: number
  // Fluid temperature constraints — informational only, not used by solver in v1
  minimumTemperature?: number
  maximumTemperature?: number
}

export interface Product {
  itemId: string
  type: 'item' | 'fluid'
  amount: number
  probability?: number // 0–1; defaults to 1
  // Variable-yield range (rarely used); if present, solver uses (min+max)/2
  amountMin?: number
  amountMax?: number
  // Productivity exclusion: fixed units that do not scale with productivity bonus.
  // Only the amount above this threshold scales. Used by Kovarex enrichment.
  ignoredByProductivity?: number
}

export interface Recipe {
  id: string
  name: string
  // Open string — e.g. "crafting", "smelting", "distillation", etc.
  // Absent in data.raw means "crafting" (default).
  category: string
  craftingTime: number // seconds at crafting_speed=1
  ingredients: Ingredient[]
  products: Product[]
  // Machine ids whose craftingCategories include this recipe's category.
  // Populated by the export script.
  madeIn: string[]
  allowProductivity: boolean
  // Item id of the primary output.
  // undefined  = single-product recipe
  // null       = explicitly multi-output with no primary (main_product = "")
  mainProduct?: string | null
}

export type EffectName = 'speed' | 'productivity' | 'consumption' | 'pollution' | 'quality'

export interface Machine {
  id: string
  name: string
  type: 'assembling-machine' | 'furnace' | 'rocket-silo'
  craftingSpeed: number // multiplier on craftingTime; 1.0 = base speed
  energyUsageKw: number // kW at full load (parsed from "150kW" / "9.75MW" string)
  energyType: 'electric' | 'burner' | 'heat' | 'void'
  drainKw: number // kW idle drain; 0 when absent or non-electric
  moduleSlots: number // 0 when absent
  allowedEffects: EffectName[]
  craftingCategories: string[]
  iconPath: string
}

export interface Module {
  id: string
  name: string
  category: string // "speed" | "productivity" | "efficiency" | open string
  tier: number
  effects: Partial<Record<EffectName, number>> // additive fraction, e.g. 0.2 = +20%
  limitation: string[] // recipe ids this module IS restricted to; empty = unrestricted
  limitationBlacklist: string[] // recipe ids this module is excluded from
}

export interface GameData {
  factorioVersion: string // e.g. "2.0.28"
  modSet: Record<string, string> // { mod_name: version }

  items: Record<string, Item>
  recipes: Record<string, Recipe>
  machines: Record<string, Machine>
  modules: Record<string, Module>

  // Suggested default machine per recipe category (populated by export script).
  defaultMachines: Record<string, string> // category -> machine id
}

// ---------------------------------------------------------------------------
// Plan — user data, persisted to localStorage / JSON export
// ---------------------------------------------------------------------------

export interface ProductionGoal {
  id: string // stable uuid
  itemId: string
  rate: number // items per minute
}

export interface ModuleConfig {
  moduleId: string
  count: number
}

export interface BeaconConfig {
  moduleId: string
  beaconCount: number
  modulesPerBeacon: number // typically 2
  distributionEfficiency: number // fraction of beacons affecting this machine, 0–1
}

export interface RecipeNode {
  id: string
  recipeId: string

  // User overrides — absent means use plan/global defaults
  machineId?: string
  modules: ModuleConfig[]
  beaconConfig?: BeaconConfig
  pinnedRate?: number // if set, solver treats this throughput as fixed

  // Per-product byproduct policy. Default: "feed-back".
  // Only needs an entry when the user has changed a product from the default.
  byproductPolicy: Record<string, 'discard' | 'feed-back'>
}

export interface Plan {
  id: string
  name: string
  gameDataVersion: string // factorioVersion from the loaded GameData
  goals: ProductionGoal[]
  nodes: RecipeNode[] // one per active recipe; populated/updated on solve
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

// ---------------------------------------------------------------------------
// Solver State — transient, not persisted, recomputed after every plan change
// ---------------------------------------------------------------------------

export interface SolvedNode {
  recipeNodeId: string
  inputRates: Record<string, number> // itemId -> items/min consumed
  outputRates: Record<string, number> // itemId -> items/min produced (gross)
  throughput: number // recipe executions/min
  machineCountExact: number
  machineCountCeil: number
  powerKw: number
}

export interface UnsatisfiedItem {
  itemId: string
  rate: number // items/min that must come from outside (raw resource / import)
}

export type SolverWarning =
  | { type: 'cycle-detected'; recipeIds: string[] }
  | { type: 'underdetermined'; freeVariables: string[] }
  | { type: 'no-recipe'; itemId: string }
  | { type: 'productivity-not-allowed'; recipeId: string }

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
}
