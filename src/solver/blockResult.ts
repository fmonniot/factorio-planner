import type {
  GameData,
  GameRecipeNode,
  RecipeNode,
  Recipe,
  SolvedNode,
  SolverGoal,
  ItemSourcing,
  ItemSourcingMode,
  SolverWarning,
  UnsatisfiedItem,
} from '../data/types'
import { effectiveProductAmount, type ClassifiedSystem } from './build'
import { computeMachineMetrics, type NodeEffects } from './effects'
import type { SolverArea } from './areas'

// ---------------------------------------------------------------------------
// Pieces of a block's result shared by the plain solve and the area solve
// ---------------------------------------------------------------------------

export interface SolverPlan {
  goals: SolverGoal[]
  nodes: RecipeNode[]
  noImportItems?: string[]
  itemSourcing?: ItemSourcing
  /** Present only when a sub-factory is a separate area; its absence selects the plain solve. */
  areas?: SolverArea[]
}

/** Items set to `mode` in the plan's itemSourcing. */
export function itemsWithSourcing(plan: SolverPlan, mode: ItemSourcingMode): string[] {
  return Object.entries(plan.itemSourcing ?? {}).filter(([, m]) => m === mode).map(([id]) => id)
}

/** Byproducts-first items whose import is cheap: not in `noImportItems` (a user lock, or a byproduct consumer's ingredient). */
export function byproductsFirstSet(plan: SolverPlan, noImportItems: Set<string>): Set<string> {
  return new Set(itemsWithSourcing(plan, 'byproducts-first').filter(id => !noImportItems.has(id)))
}

/** Rates at or below this are treated as zero when comparing supply and demand. */
export const FLOW_TOLERANCE = 1e-6

/** Absolute floor of the net surplus an intermediate may keep before `overconstrained` is raised. */
const SURPLUS_TOLERANCE = 1e-6
/** Fraction of an item's gross flow added to the surplus tolerance, so LP rounding noise at large flows is not reported. */
const SURPLUS_REL_TOLERANCE = 1e-8

/** Smallest net surplus of an item reported as `overconstrained`, given its gross flow (the larger of produced and consumed). */
export function surplusTolerance(grossFlow: number): number {
  return Math.max(SURPLUS_TOLERANCE, SURPLUS_REL_TOLERANCE * grossFlow)
}

/** A goal's shortfall below this is not reported. */
export const GOAL_SHORTFALL_TOLERANCE = 1e-4

/** The solved node of a duplicate row: it takes no part in the solve. */
export function zeroNode(recipeNodeId: string): SolvedNode {
  return {
    recipeNodeId,
    inputRates: {},
    outputRates: {},
    throughput: 0,
    machineCountExact: 0,
    machineCountCeil: 0,
    powerKw: 0,
  }
}

/** The rates, machine count and power of one row running at `throughput` executions/min. */
export function solvedNodeOf(
  planNode: GameRecipeNode,
  recipe: Recipe,
  throughput: number,
  effects: NodeEffects,
  prodBonus: number,
  gameData: GameData,
): SolvedNode {
  // A missing default (no machine for the category, or none within the research horizon) leaves
  // count and power at 0; rates do not depend on the machine.
  const machineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = machineId ? gameData.machines[machineId] : undefined

  let machineCountExact = 0
  let machineCountCeil = 0
  let powerKw = 0
  if (machine) {
    const m = computeMachineMetrics(throughput, recipe.craftingTime, machine, effects)
    machineCountExact = m.machineCountExact
    machineCountCeil = m.machineCountCeil
    powerKw = m.powerKw
  }

  const inputRates: Record<string, number> = {}
  for (const ing of recipe.ingredients) {
    inputRates[ing.itemId] = (inputRates[ing.itemId] ?? 0) + ing.amount * throughput
  }

  const outputRates: Record<string, number> = {}
  for (const prod of recipe.products) {
    const effective = effectiveProductAmount(
      prod.amount ?? 0,
      prod.probability ?? 1,
      prod.ignoredByProductivity ?? 0,
      prodBonus,
    )
    outputRates[prod.itemId] = (outputRates[prod.itemId] ?? 0) + effective * throughput
  }

  return {
    recipeNodeId: planNode.id,
    inputRates,
    outputRates,
    throughput,
    machineCountExact,
    machineCountCeil,
    powerKw,
  }
}

export interface BlockDiagnostics {
  /** itemId → net production over the block's columns */
  itemSurplus: Map<string, number>
  /** itemId → larger of produced and consumed */
  itemGross: Map<string, number>
  overconstrained?: SolverWarning
  unsatisfied: UnsatisfiedItem[]
  /** itemId → items/min taken from the offers */
  received: Map<string, number>
}

/**
 * What a solved block leaves over or lacks: surplus, `overconstrained`, the unsatisfied list and
 * what was received. `throughput`, `slack` and `supply` are keyed like `system.S` columns.
 */
export function blockDiagnostics(args: {
  goals: SolverGoal[]
  system: ClassifiedSystem
  throughput: Map<string, number>
  slack: Map<string, number>
  supply: Map<string, number>
  nodes: SolvedNode[]
  totalCaps: Map<string, number>
}): BlockDiagnostics {
  const { goals, system, throughput: throughputMap, slack: slackMap, supply, nodes, totalCaps } = args

  // Per-item net surplus from the LP solve.
  const itemSurplus = new Map<string, number>()
  // Gross flow per item (larger of produced and consumed), to scale the overconstrained tolerance.
  const itemGross = new Map<string, number>()
  for (const [itemId, rowS] of system.S) {
    let net = 0
    let produced = 0
    let consumed = 0
    for (const [recipeId, coeff] of rowS) {
      const flow = coeff * (throughputMap.get(recipeId) ?? 0)
      net += flow
      if (flow > 0) produced += flow
      else consumed -= flow
    }
    itemSurplus.set(itemId, net)
    itemGross.set(itemId, Math.max(produced, consumed))
  }

  // Detect overconstrained intermediates: positive net flow at LP optimum.
  const overconstrainedItems: { itemId: string; rate: number }[] = []
  for (const itemId of system.classification.intermediates) {
    const surplus = itemSurplus.get(itemId) ?? 0
    if (surplus > surplusTolerance(itemGross.get(itemId) ?? 0)) {
      overconstrainedItems.push({ itemId, rate: surplus })
    }
  }
  const overconstrained: SolverWarning | undefined = overconstrainedItems.length > 0
    ? { type: 'overconstrained', surplusItems: overconstrainedItems }
    : undefined

  // Goal shortfall pass: if LP was infeasible (no LP-active producer, or conflicting pins),
  // the actual net output of a goal may be below its target. Surface the deficit so the
  // Ingredients pane shows what must come from outside.
  const goalShortfalls: UnsatisfiedItem[] = []
  for (const goal of goals) {
    let netActual = 0
    for (const node of nodes) {
      netActual += node.outputRates[goal.itemId] ?? 0
      netActual -= node.inputRates[goal.itemId] ?? 0
    }
    const shortfall = goal.rate - netActual
    if (shortfall > GOAL_SHORTFALL_TOLERANCE) {
      goalShortfalls.push({ itemId: goal.itemId, rate: shortfall })
    }
  }

  // Intermediate slack → external imports needed for network balance.
  const slackIntermediates: UnsatisfiedItem[] = []
  for (const [itemId, rate] of slackMap) {
    slackIntermediates.push({ itemId, rate })
  }

  const received = new Map<string, number>()
  const rawConsumption: UnsatisfiedItem[] = []
  const goalShortfallIds = new Set(goalShortfalls.map(u => u.itemId))
  for (const itemId of system.classification.raw) {
    if (goalShortfallIds.has(itemId)) continue
    const row = system.S.get(itemId)
    if (!row) continue
    let totalConsumption = 0
    for (const [recipeId, coeff] of row) {
      if (coeff < 0) {
        totalConsumption += Math.abs(coeff) * (throughputMap.get(recipeId) ?? 0)
      }
    }
    if (totalConsumption <= 0) continue
    // Supply is always preferred over import for items the block cannot make.
    const fromSupply = Math.min(totalConsumption, totalCaps.get(itemId) ?? 0)
    if (fromSupply > FLOW_TOLERANCE) received.set(itemId, fromSupply)
    const imported = totalConsumption - fromSupply
    if (fromSupply === 0 || imported > FLOW_TOLERANCE) {
      rawConsumption.push({ itemId, rate: imported })
    }
  }

  // Connected intermediates: the amount taken is the deficit left after own
  // production, never the raw LP variable (degenerate optima can leave it higher).
  for (const itemId of totalCaps.keys()) {
    if (!system.classification.intermediates.has(itemId)) continue
    const deficit = Math.max(0, -(itemSurplus.get(itemId) ?? 0))
    const fromSupply = Math.min(supply.get(itemId) ?? 0, deficit)
    if (fromSupply > FLOW_TOLERANCE) received.set(itemId, fromSupply)
  }

  // Ordering: goal shortfalls first, then intermediate slack, then raw consumption.
  const unsatisfied: UnsatisfiedItem[] = [...goalShortfalls, ...slackIntermediates, ...rawConsumption]

  return { itemSurplus, itemGross, overconstrained, unsatisfied, received }
}
