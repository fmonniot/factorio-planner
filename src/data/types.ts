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
  TechnologyCost,
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
  PlanDataSetStamp,
  PlanEntry,
  PlanIndex,
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
  | { type: 'loop-not-converged'; blockIds: string[]; rounds: number }

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
}

// ---------------------------------------------------------------------------
// Multi-block solve — transient, produced by solveAll().
// ---------------------------------------------------------------------------

export type ConnectionFlowStatus = 'ok' | 'unused' | 'limited' | 'missing-source' | 'self'

/** Why a connection marked `pull` behaves like a push connection. */
export type PullIgnoredReason = 'pull-loop' | 'no-producer' | 'source-receives' | 'duplicate'

export interface ConnectionFlow {
  connectionId: string
  fromBlockId: string
  toBlockId: string
  itemId: string
  /** items/min this consumer could take over this connection: the source's unclaimed offer, limited by `maxRate` */
  available: number
  /** true when `maxRate` is below the source's unclaimed offer, so the limit, not the source, bounds `available` */
  capped: boolean
  /** items/min actually delivered */
  rate: number
  /**
   * unused: rate ≤ 1e-6 (the consumer makes the item itself or needs none);
   * limited: rate ≥ available − 1e-6 and the consumer still imports the item
   * (the source or the connection's limit is the bound; `capped` tells which).
   */
  status: ConnectionFlowStatus
  /** true when both ends are members of one loop of blocks */
  loop?: true
  /** Present iff the connection pulls and the pull is applied: items/min the consumer asked the source to make (may be 0). */
  demand?: number
  /** Present iff the connection is marked `pull` but behaves like a push connection. */
  pullIgnored?: PullIgnoredReason
}

/** A group of blocks that supply each other, directly or through other blocks. */
export interface BlockLoop {
  /** Member order: the entry block first, then breadth-first along in-loop connections. */
  blockIds: string[]
  /** In-loop connections: members in order, each in `inputConnections` order. */
  connectionIds: string[]
  /** Connections whose source comes later in `blockIds` than its consumer. */
  backConnectionIds: string[]
  /** Rounds solved before the back connections stopped changing (or the limit). */
  rounds: number
  converged: boolean
}

export interface MultiBlockSolve {
  results: Record<string, SolverResult>
  flows: ConnectionFlow[]
  /** One entry per loop of blocks; empty when the connections form no loop. */
  loops: BlockLoop[]
  /** Per-block solver failures; the failing block also gets an empty result. */
  errors: Record<string, string>
}
