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
  ItemGroup,
  ItemSubgroup,
  Technology,
  GameData,
  ProductionGoal,
  ModuleConfig,
  BeaconConfig,
  RecipeNode,
  GameRecipeNode,
  SubPlanNode,
  SubPlan,
  BlockConnection,
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
  | { type: 'no-recipe'; itemId: string }
  | { type: 'duplicate-recipe'; recipeId: string; count: number }
  | { type: 'infeasible-pins'; recipeIds: string[] }
  | { type: 'overconstrained'; surplusItems: { itemId: string; rate: number }[] }

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
}

// ---------------------------------------------------------------------------
// Multi-block solve — transient, produced by solveAll().
// ---------------------------------------------------------------------------

export type ConnectionFlowStatus = 'ok' | 'unused' | 'limited' | 'missing-source' | 'cycle'

export interface ConnectionFlow {
  connectionId: string
  fromBlockId: string
  toBlockId: string
  itemId: string
  /** items/min the source still offered when this consumer was solved */
  available: number
  /** items/min actually delivered */
  rate: number
  /**
   * unused: rate ≤ 1e-6 (the consumer makes the item itself or needs none);
   * limited: rate ≥ available − 1e-6 and the consumer still imports the item.
   */
  status: ConnectionFlowStatus
}

export interface MultiBlockSolve {
  results: Record<string, SolverResult>
  flows: ConnectionFlow[]
  /** Per-block solver failures; the failing block also gets an empty result. */
  errors: Record<string, string>
}
