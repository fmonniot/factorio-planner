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
  ResearchTrigger,
  GameData,
  ModuleConfig,
  BeaconConfig,
  RecipeNode,
  GameRecipeNode,
  SubPlanNode,
  SubPlan,
  BlockConnection,
  Block,
  SourceRule,
  AreaSourceRule,
  ServedEntry,
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
export interface SolverGoal {
  id: string
  itemId: string
  rate: number
  /** A split fluid only: the range the goal accepts (a request from another block, delivered as that range key); absent: any temperature. */
  temp?: { min?: number; max?: number }
}

/**
 * What a split fluid's flow carries: `{ at }` a made temperature (`null`: unknown), or a range an
 * ingredient accepts (`{}`: any temperature). See src/data/flowKey.ts.
 */
export type FluidTag = { at: number | null } | { min?: number; max?: number }

/** A fluid made at `from` that a block uses where `to` is taken: items/min that moved between two keys (see `SolverResult.conversions`). */
export interface FluidConversion {
  itemId: string
  from: FluidTag
  to: FluidTag
  rate: number
  /** The area that converts it (blocks with areas only). */
  areaId?: string
  /** Set (never `false`) on a conversion out of a key supplied by a connection: received, not made here. */
  supplied?: true
}

export interface SolvedNode {
  recipeNodeId: string
  inputRates: Record<string, number> // itemId -> items/min consumed
  outputRates: Record<string, number> // itemId -> items/min produced (gross)
  throughput: number // recipe executions/min
  machineCountExact: number
  machineCountCeil: number
  powerKw: number
  /** Burner rows: the fuel item burnt (already counted in `inputRates`; `powerKw` is then 0). */
  fuelItemId?: string
  /** Set (never `false`) on a row that only runs to feed a row absorbing a byproduct, while it runs. Not part of the snapshot. */
  feedsAbsorber?: true
  /** The temperature the row makes each split fluid at (present only when it makes one). Rates stay keyed by base item. */
  outputTags?: Record<string, FluidTag>
  /** The temperature range the row accepts of each split fluid (present only when it takes one). */
  inputTags?: Record<string, FluidTag>
}

export interface UnsatisfiedItem {
  itemId: string
  rate: number // items/min that must come from outside (raw resource / import)
  /** A split fluid only: the range the import or the shortfall is for (`{}` any). */
  temp?: FluidTag
}

export type SolverWarning =
  | { type: 'no-recipe'; itemId: string }
  | { type: 'duplicate-recipe'; recipeId: string; count: number; areaId?: string }
  | {
      type: 'infeasible-pins'
      recipeIds: string[]
      /** true when the elastic solve failed too (the pins conflict, or a locked item cannot be made whatever the pins): values are arbitrary. Absent: the pins hold and products fall short; recipeIds are the pins that bind where the solver could tell, else all */
      conflict?: true
    }
  | { type: 'overconstrained'; surplusItems: { itemId: string; rate: number; temp?: FluidTag }[] }
  /**
   * Recipes the solver runs mostly to make a co-product the block consumes. `throughput` and
   * `needed` are executions/min summed over the recipe's rows: what it runs at, and what its other
   * outputs would need. `itemIds` are the co-products that bind it.
   */
  | { type: 'coproduct-driven'; drivers: { recipeId: string; itemIds: string[]; throughput: number; needed: number }[] }
  | { type: 'area-shortfall'; shortfalls: { areaId: string; itemId: string; rate: number; temp?: FluidTag }[] }
  | { type: 'area-cut-off'; cutOffs: { areaId: string; itemId: string; temp?: FluidTag }[] }
  | { type: 'loop-not-converged'; blockIds: string[]; rounds: number }
  | { type: 'request-loop-not-converged'; blockIds: string[]; rounds: number }
  /**
   * A connection of a split fluid offers it only at temperatures that fit none of the ranges the block still imports. One entry per
   * counting connection; `offered` are its temperatures (known ones only), `needed` the ranges still imported.
   */
  | {
      type: 'connection-temperature'
      connections: {
        connectionId: string
        itemId: string
        offered: { temperature: number; rate: number }[]
        needed: { min?: number; max?: number; rate: number }[]
      }[]
    }
  /** Heat only: a reactor's heat buffer maximum against an exchanger's minimum. */
  | { type: 'temperature-mismatch'; recipeId: string; itemId: string; supplied: number[]; minimum?: number; maximum?: number }
  /**
   * A temperature range of a fluid the block's rows take that nothing in the block makes, no connection could
   * supply and the block cannot import (a locked fluid). `recipeIds` are the rows that take it.
   */
  | { type: 'no-fitting-temperature'; itemId: string; min?: number; max?: number; recipeIds: string[] }
  /** Modules the game would not accept in their machine or beacon (effects or category); the planner still counts them as before. */
  | {
      type: 'module-not-allowed'
      misfits: { recipeId: string; moduleId: string; kind: 'machine' | 'beacon'; entityId: string; reason: 'effect' | 'category' }[]
    }

/** An item moving into or out of an area; `boundary` when the block also imports or exports it. */
export interface AreaFlow {
  itemId: string
  rate: number // items/min
  boundary: boolean
  /** A split fluid only: the temperature the flow carries (a made temperature, or the range it is for). */
  temp?: FluidTag
}

/** What one area receives from and sends to the rest of the block (id: root plan or sub-plan id). */
export interface SolvedArea {
  areaId: string
  receives: AreaFlow[]
  sends: AreaFlow[]
}

/** Items/min of one item from one party to another in a block with areas; an absent end is outside the block. */
export interface AreaRoute {
  itemId: string
  /** A split fluid only: the temperature the route carries. */
  temp?: FluidTag
  from?: string
  to?: string
  rate: number
  /** On an outside leg into an area of an intermediate two areas or more touch: the part of `rate` that is connected supply, present only above FLOW_TOLERANCE (absent = 0). The rest is imported, or missing where the area's rule has Import off (see `outsideLegParts`). */
  supplied?: number
}

export interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
  /** Present only when the block has a separate area, in table order (the root first). */
  areas?: SolvedArea[]
  /** Present exactly when `areas` is; sorted by item id, sender rank, receiver rank (outside last). */
  areaRoutes?: AreaRoute[]
  /** Present only when non-empty: the flows between a split fluid's temperatures and the ranges the rows take (rate above FLOW_TOLERANCE). */
  conversions?: FluidConversion[]
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

/** One key of a split fluid's connection: what it carried (`rate`), what the source had on offer (`available`), and for a request what was asked. */
export interface ConnectionPart {
  temp: FluidTag
  rate: number
  available: number
  requested?: number
}

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
  /** A split fluid only: the totals above split per key (temperatures ascending, then ranges). A key with no rate and nothing on offer is left out. */
  parts?: ConnectionPart[]
}

/** One consumer block in the order a source's item was served. */
export interface ServedConsumer {
  blockId: string
  /** its counting connection from the source (the first, if hand-edited JSON repeats the pair) */
  connectionId: string
  kind: ConnectionKind
  /** items/min asked or credited: a request's amount, a take's credit; 0 when none. For a pair a served list ranks this is not the grant the solve reserved. For a split consumer (see `areaId`), the line's part of the connection's share. */
  share: number
  /** items/min delivered */
  got: number
  /** Set when this line is one area of the consumer block (the block's areas that need the item, ≥ 2, or an area entry of the list); then `share`, `got` and `need` are this area's part. Absent: the line is the whole block. */
  areaId?: string
  /** items/min of the consumer's need of the item still uncovered when the request pass reached this take (the need less what the takes before it covered); absent for a take the pass never reached (the need was already covered) or never probed. */
  need?: number
  /** A takes-first take the request pass reached before it could credit it (its source or a higher-ranked take not credited yet), or, inside a cycle of requests, a take below an outside take not credited yet, or one that reads a back estimate in the final round of a cycle that does not settle: `share` is 0 whatever the list says. A listed take of a consumer that requests nothing of the item is never left uncredited. */
  notCredited?: true
  /** A member of a group of takes the request pass could not share by need (a member's need, its source or the ranks above were not known when the group was reached, a member's group take is not its first take of the item, or the source's item also feeds a member of a cycle of requests): the group was credited and served in list order, not by its weights. */
  groupInListOrder?: true
  /** A split fluid, block lines only: the line's part of `share` and `got` per key (the same order as `ConnectionFlow.parts`). */
  parts?: { temp: FluidTag; share: number; got: number }[]
}

/** The source block's own extra output of the item, and where it was served. */
export interface ServedExtra {
  /** consumers served before it (consumers.length unless a served list puts the extra higher) */
  place: number
  asked: number
  got: number
}

export interface ServedList {
  consumers: ServedConsumer[]
  extra?: ServedExtra
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
  /** sourceBlockId → itemId → who was served, in order; only items with at least one consumer; {} with none */
  served: Record<string, Record<string, ServedList>>
  /** Per-block solver failures; the failing block also gets an empty result. */
  errors: Record<string, string>
}
