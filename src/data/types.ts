// ---------------------------------------------------------------------------
// Re-exports — game data and plan types are derived from the Zod schema.
// Import from here rather than from schema.ts directly.
// ---------------------------------------------------------------------------

export type {
  Item,
  Ingredient,
  Product,
  Recipe,
  EffectName,
  Machine,
  Module,
  BeaconEntity,
  GameData,
  ProductionGoal,
  ModuleConfig,
  BeaconConfig,
  RecipeNode,
  GameRecipeNode,
  SubPlanNode,
  SubPlan,
  Block,
  AppState,
} from './schema'

// ---------------------------------------------------------------------------
// Solver State — transient, not persisted, not parsed by Zod.
// Produced by the solver and consumed by the UI.
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
  | { type: 'duplicate-recipe'; recipeId: string; count: number }
  // v2-only warning types
  | { type: 'infeasible-pins'; recipeIds: string[] }
  | { type: 'overconstrained'; surplusItems: { itemId: string; rate: number }[] }
  | { type: 'too-many-alternatives'; recipeIds: string[] }

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
}
