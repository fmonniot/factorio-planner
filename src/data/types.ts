// ---------------------------------------------------------------------------
// Re-exports — game data and plan types are derived from the Zod schema.
// Import from here rather than from schema.ts directly.
// ---------------------------------------------------------------------------

export type {
  Item,
  Ingredient,
  Product,
  RecipeProduct,
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
  ModuleConfig,
  BeaconConfig,
  RecipeNode,
  GameRecipeNode,
  SubPlanNode,
  SubPlan,
  BlockConnection,
  Block,
  ItemSourcing,
  ItemSourcingMode,
  AppState,
  PlanDataSetStamp,
  PlanEntry,
  PlanIndex,
} from './schema'

// ---------------------------------------------------------------------------
// Solver State — transient, not persisted, not parsed by Zod.
// Produced by the solver and consumed by the UI.
// ---------------------------------------------------------------------------

/** A rate the LP must reach for an item (items/min). Built by the solver from a block's products; never stored. */
export interface SolverGoal { id: string; itemId: string; rate: number }

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
  | { type: 'duplicate-recipe'; recipeId: string; count: number; areaId?: string }
  | { type: 'infeasible-pins'; recipeIds: string[] }
  | { type: 'overconstrained'; surplusItems: { itemId: string; rate: number }[] }
  | { type: 'area-shortfall'; shortfalls: { areaId: string; itemId: string; rate: number }[] }
  | { type: 'loop-not-converged'; blockIds: string[]; rounds: number }
  | { type: 'request-loop-not-converged'; blockIds: string[]; rounds: number }

/** An item moving into or out of an area; `boundary` when the block also imports or exports it. */
export interface AreaFlow {
  itemId: string
  rate: number // items/min
  boundary: boolean
}

/** What one area receives from and sends to the rest of the block (id: root plan or sub-plan id). */
export interface SolvedArea {
  areaId: string
  receives: AreaFlow[]
  sends: AreaFlow[]
}

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
  /** Present only when the block has a separate area, in table order (the root first). */
  areas?: SolvedArea[]
}

// ---------------------------------------------------------------------------
// Multi-block solve — transient, produced by solveAll().
// ---------------------------------------------------------------------------

export type ConnectionFlowStatus = 'ok' | 'unused' | 'limited' | 'missing-source' | 'self'

/** A connection is a request when its item is a product of the source, otherwise it takes existing output. */
export type ConnectionKind = 'request' | 'take'

/**
 * Why a connection to a product of its source takes existing output instead of requesting.
 * `request-loop`: the request closes a cycle of requests whose demand did not settle.
 */
export type RequestIgnoredReason = 'request-loop' | 'source-receives' | 'duplicate'

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
  /** request: the item is a product of the source and the request is applied; take: it takes existing output. */
  kind: ConnectionKind
  /** Present iff `kind === 'request'`: items/min the consumer asked the source to make (may be 0). */
  requested?: number
  /** Present iff the item is a product of the source but the request is not applied; the connection then takes existing output. */
  requestIgnored?: RequestIgnoredReason
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
  /**
   * One entry per cycle of requests (blocks that request from each other); empty when there is none.
   * `blockIds` are in request-pass order (consumers first), `backConnectionIds` the requests whose
   * demand is read from the previous round, `rounds` the demand rounds solved.
   */
  requestLoops: BlockLoop[]
  /** Per-block solver failures; the failing block also gets an empty result. */
  errors: Record<string, string>
}
