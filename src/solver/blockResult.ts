import type {
  GameData,
  GameRecipeNode,
  RecipeNode,
  Recipe,
  SolvedNode,
  SolverGoal,
  SourceRule,
  SolverWarning,
  UnsatisfiedItem,
} from '../data/types'
import { importOffItems as importOffOf } from '../data/sourceRules'
import { rowIngredients, rowProductAmount, type ClassifiedSystem } from './build'
import { computeMachineMetrics, rowMachine, type NodeEffects } from './effects'
import type { SolverArea } from './areas'

// ---------------------------------------------------------------------------
// Pieces of a block's result shared by the plain solve and the area solve
// ---------------------------------------------------------------------------

export interface SolverPlan {
  goals: SolverGoal[]
  nodes: RecipeNode[]
  /** itemId → the block's source rule for it. */
  sourceRules?: Record<string, SourceRule>
  /** Present only when a sub-factory is a separate area; its absence selects the plain solve. */
  areas?: SolverArea[]
}

/** Items whose rule has `makeHere` set to `makeHere`. */
export function itemsWithSourcing(plan: SolverPlan, makeHere: 'after-blocks' | 'off'): string[] {
  return Object.entries(plan.sourceRules ?? {}).filter(([, r]) => r.makeHere === makeHere).map(([id]) => id)
}

/** Items whose rule has Import off. */
export function importOffItems(plan: SolverPlan): string[] {
  return importOffOf(plan.sourceRules)
}

/** `makeHere: 'off'` items whose import is cheap: not in `noImportItems` (an Import-off item, or a byproduct consumer's ingredient). */
export function byproductsFirstSet(plan: SolverPlan, noImportItems: Set<string>): Set<string> {
  return new Set(itemsWithSourcing(plan, 'off').filter(id => !noImportItems.has(id)))
}

/** Rates at or below this are treated as zero when comparing supply and demand. */
export const FLOW_TOLERANCE = 1e-6

/** Absolute floor of the net surplus an intermediate may keep before `overconstrained` is raised. */
const SURPLUS_TOLERANCE = 1e-6
/** Fraction of an item's gross flow added to the surplus tolerance, so LP rounding noise at large flows is not reported. */
const SURPLUS_REL_TOLERANCE = 1e-8

/**
 * Noise floor of any difference of flows of the given scale (an item's gross flow, the larger of
 * produced and consumed, or the larger operand of the comparison): the smallest surplus, residual
 * or gap worth reporting. Equals `FLOW_TOLERANCE` for scales up to 100/min.
 */
export function surplusTolerance(grossFlow: number): number {
  return Math.max(SURPLUS_TOLERANCE, SURPLUS_REL_TOLERANCE * grossFlow)
}

/** Larger of produced and consumed of one item over the columns, from an `S` row and the throughputs. */
export function itemGrossFlow(row: Map<string, number> | undefined, throughput: Map<string, number>): number {
  let produced = 0
  let consumed = 0
  for (const [recipeId, coeff] of row ?? []) {
    const flow = coeff * (throughput.get(recipeId) ?? 0)
    if (flow > 0) produced += flow
    else consumed -= flow
  }
  return Math.max(produced, consumed)
}

/**
 * Pass 2 of the connection-fill solve, from the pass-1 residuals: the caps that let supply fill what
 * the block's own recipes could not cover, and the locks that stay. A locked item whose offer is
 * below its residual is unlocked, so the LP stays feasible. Whether to run pass 2 at all ignores
 * residuals within `surplusTolerance` of the item's gross flow (LP noise), but once it runs every
 * residual above the absolute `FLOW_TOLERANCE` is capped or unlocked, so a locked item is never
 * left short by a residual the run did not cover. `run` is false when there is nothing to fill.
 */
export function pass2Plan(args: {
  totalCaps: Map<string, number>
  intermediates: Set<string>
  firstItems: Set<string>
  noImportItems: Set<string>
  slack: Map<string, number>
  S: Map<string, Map<string, number>>
  throughput: Map<string, number>
}): { run: boolean; caps: Map<string, number>; noImport: Set<string> } {
  const caps = new Map<string, number>()
  const noImport = new Set(args.noImportItems)
  let run = false
  for (const [itemId, cap] of args.totalCaps) {
    if (!args.intermediates.has(itemId)) continue
    const residual = args.slack.get(itemId) ?? 0
    if (residual <= FLOW_TOLERANCE) continue
    if (args.firstItems.has(itemId)) {
      // Already supplied in pass 1 up to its offer: stays unlocked only if something is left.
      noImport.delete(itemId)
      continue
    }
    caps.set(itemId, Math.min(cap, residual))
    if (cap < residual - FLOW_TOLERANCE) noImport.delete(itemId)
    if (residual > surplusTolerance(itemGrossFlow(args.S.get(itemId), args.throughput))) run = true
  }
  return { run, caps, noImport }
}

/**
 * What a block takes from and gives to the outside for an item, from the gross rates areas send
 * and receive (net of each area's own rows): the residual, unless within `surplusTolerance`.
 */
export function outsideResidual(sent: number, received: number): { fromOutside: number; toOutside: number } {
  const s = sent - received
  const tol = surplusTolerance(Math.max(sent, received))
  return { fromOutside: s < -tol ? -s : 0, toOutside: s > tol ? s : 0 }
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
  // count and power at 0; rates do not depend on the machine, except a burner's fuel.
  const machine = rowMachine(planNode, gameData)

  let machineCountExact = 0
  let machineCountCeil = 0
  let powerKw = 0
  if (machine) {
    const m = computeMachineMetrics(throughput, recipe.craftingTime, machine, effects)
    machineCountExact = m.machineCountExact
    machineCountCeil = m.machineCountCeil
    // A burner row with fuel data draws no electricity: its energy is the fuel ingredient.
    powerKw = effects.fuel ? 0 : m.powerKw
  }

  const inputRates: Record<string, number> = {}
  for (const ing of rowIngredients(recipe, effects)) {
    inputRates[ing.itemId] = (inputRates[ing.itemId] ?? 0) + ing.amount * throughput
  }

  const outputRates: Record<string, number> = {}
  for (const prod of recipe.products) {
    const effective = rowProductAmount(prod, prodBonus, effects.heatBonus)
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
    ...(effects.fuel ? { fuelItemId: effects.fuel.itemId } : {}),
  }
}

/**
 * A recipe is `coproduct-driven` when at most this share of its throughput is needed for its other
 * outputs: the rest runs only to make a co-product the block consumes.
 */
export const COPRODUCT_DRIVEN_RATIO = 0.5

/**
 * Detects recipes the LP over-runs to make a co-product (see `coproduct-driven` in spec/solver.md).
 * Diagnostic only: analytic, from the solved flows. `fixed` columns (pinned rates, byproduct
 * consumers) are not free LP choices and never count as drivers; `recipeOf` maps a column to the
 * recipe it runs, so rows of one recipe merge into one entry. `mainItemOf` gives the item a column
 * is built for (undefined when the recipe names no main product: its outputs are then equals and
 * the column is skipped); a column whose main item is what binds it is running for its main product.
 */
export function coproductDrivenWarning(args: {
  goals: SolverGoal[]
  system: ClassifiedSystem
  throughput: Map<string, number>
  slack: Map<string, number>
  itemSurplus: Map<string, number>
  itemGross: Map<string, number>
  fixed: Set<string>
  /** Items the block may not import (also its byproduct consumers' ingredients): `'byproducts-first'` cannot relax them. */
  noImportItems: Set<string>
  recipeOf: (columnId: string) => string
  mainItemOf: (columnId: string) => string | undefined
}): SolverWarning | undefined {
  const { goals, system, throughput, slack, itemSurplus, itemGross, fixed, noImportItems, recipeOf, mainItemOf } = args
  const goalRate = new Map<string, number>()
  for (const g of goals) goalRate.set(g.itemId, (goalRate.get(g.itemId) ?? 0) + g.rate)

  const excessOf = (itemId: string): number =>
    Math.max(0, (itemSurplus.get(itemId) ?? 0) - (goalRate.get(itemId) ?? 0))
  const tolOf = (itemId: string): number => surplusTolerance(itemGross.get(itemId) ?? 0)

  // How much each constrained item the columns make, to share its surplus among them.
  const produced = new Map<string, number>()
  for (const itemId of new Set([...system.classification.intermediates, ...system.classification.goals.keys()])) {
    let total = 0
    for (const [columnId, coeff] of system.S.get(itemId) ?? []) {
      if (coeff > 0) total += coeff * (throughput.get(columnId) ?? 0)
    }
    produced.set(itemId, total)
  }

  // Pass 1: the constrained outputs of each column.
  const outs = new Map<string, { itemId: string; coeff: number }[]>()
  let anyExcess = false
  const constrained = [...system.classification.intermediates, ...system.classification.goals.keys()]
  for (const itemId of new Set(constrained)) {
    const row = system.S.get(itemId)
    if (!row) continue
    if (excessOf(itemId) > tolOf(itemId)) anyExcess = true
    for (const [columnId, coeff] of row) {
      if (coeff <= 0) continue
      let list = outs.get(columnId)
      if (!list) outs.set(columnId, list = [])
      list.push({ itemId, coeff })
    }
  }
  if (!anyExcess) return undefined

  // Pass 2: per column, how much of its throughput the non-surplus outputs would need.
  const byRecipe = new Map<string, { itemIds: Set<string>; saved: number }>()
  for (const [columnId, list] of outs) {
    const t = throughput.get(columnId) ?? 0
    if (t <= FLOW_TOLERANCE || fixed.has(columnId)) continue
    const binding: string[] = []
    let minRoom = Infinity
    let goalDriven = false
    for (const { itemId } of list) {
      const excess = excessOf(itemId)
      if (excess > tolOf(itemId)) {
        // The surplus is shared among the columns making the item, in proportion to what they make.
        const made = produced.get(itemId) ?? 0
        minRoom = Math.min(minRoom, made > 0 ? excess * t / made : 0)
      } else if (goalRate.has(itemId)) {
        goalDriven = true
        break
      } else if (!noImportItems.has(itemId) && (slack.get(itemId) ?? 0) <= tolOf(itemId)) {
        binding.push(itemId)
      }
    }
    if (goalDriven || binding.length === 0 || minRoom === Infinity) continue
    // A row that runs for the item it is built for, leaving a by-product in surplus, is not driven by a co-product.
    // Without an explicit main product there is no co-product to speak of.
    const main = mainItemOf(columnId)
    if (main === undefined || binding.includes(main)) continue
    const needed = Math.max(0, t - minRoom)
    if (needed > COPRODUCT_DRIVEN_RATIO * t) continue
    const recipeId = recipeOf(columnId)
    let entry = byRecipe.get(recipeId)
    if (!entry) byRecipe.set(recipeId, entry = { itemIds: new Set(), saved: 0 })
    for (const id of binding) entry.itemIds.add(id)
    entry.saved += t - needed
  }
  if (byRecipe.size === 0) return undefined

  // The recipe's rate is its total over all its columns, flagged or not; only flagged ones save anything.
  const total = new Map<string, number>()
  for (const [columnId, t] of throughput) {
    const recipeId = recipeOf(columnId)
    if (byRecipe.has(recipeId)) total.set(recipeId, (total.get(recipeId) ?? 0) + t)
  }
  const drivers = [...byRecipe].map(([recipeId, e]) => {
    const t = total.get(recipeId) ?? 0
    return { recipeId, itemIds: [...e.itemIds], throughput: t, needed: Math.max(0, t - e.saved) }
  })
  drivers.sort((a, b) =>
    (b.throughput - b.needed) - (a.throughput - a.needed) || a.recipeId.localeCompare(b.recipeId))
  return { type: 'coproduct-driven', drivers }
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
    for (const [recipeId, coeff] of rowS) net += coeff * (throughputMap.get(recipeId) ?? 0)
    itemSurplus.set(itemId, net)
    itemGross.set(itemId, itemGrossFlow(rowS, throughputMap))
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
    if (fromSupply === 0 || imported > surplusTolerance(totalConsumption)) {
      rawConsumption.push({ itemId, rate: imported })
    }
  }

  // Connected intermediates: the amount taken is the deficit left after own
  // production, never the raw LP variable (degenerate optima can leave it higher).
  for (const itemId of totalCaps.keys()) {
    if (!system.classification.intermediates.has(itemId)) continue
    const deficit = Math.max(0, -(itemSurplus.get(itemId) ?? 0))
    // Charged whatever the LP used, even a deficit within the noise of the flow: the source's
    // bookkeeping must match the supply the block actually drew.
    const fromSupply = Math.min(supply.get(itemId) ?? 0, deficit)
    if (fromSupply > FLOW_TOLERANCE) received.set(itemId, fromSupply)
  }

  // Ordering: goal shortfalls first, then intermediate slack, then raw consumption.
  const unsatisfied: UnsatisfiedItem[] = [...goalShortfalls, ...slackIntermediates, ...rawConsumption]

  return { itemSurplus, itemGross, overconstrained, unsatisfied, received }
}
