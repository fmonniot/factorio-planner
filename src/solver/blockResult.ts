import type {
  FluidTag,
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
import { importOffItems as importOffOf, leftoverOffItems } from '../data/sourceRules'
import { flowKey, productTag, rangeOf, splitFluids } from '../data/flowKey'
import { rowIngredients, rowProductAmount, type ClassifiedSystem, type FlowKeys } from './build'
import { baseOf, goalKeyOf, isSuppliedKey, itemKeys, resultItem } from './flowKeys'
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

/** The sets of items a block's rules and byproduct consumers sort the LP's imports into. */
export interface SourcingSets {
  /** Items with no import slack in the LP (a hard row). */
  locked: Set<string>
  /** The part of `locked` that is there because of a rule (Import off), not because a byproduct consumer takes the item. Read by `noFittingTemperature`. */
  importOffLocked: Set<string>
  /** Items the block may not import: `locked` plus the items whose rule has Import off but that keep a cheap slack (`makeHere: 'off'`). Read by `coproductDrivenWarning` only. */
  cannotImport: Set<string>
  /** Items whose import slack is cheap (`BYPRODUCTS_FIRST_SLACK_COST`). */
  byproductsFirst: Set<string>
  /**
   * Items (base ids) whose rule has Leftover off: their rows get a priced left-over variable. Read from the plan passed in:
   * the area path's `effective` copy drops the key, so `solveAreaBlock` builds its own set from the block's `sourceRules`.
   */
  leftoverOff: Set<string>
}

/**
 * Sorts the items the rules and the byproduct consumers' ingredients name. An item with `makeHere: 'off'`
 * and Import off is not locked: it keeps the cheap slack of Byproducts first, whose rate is then the
 * item's missing amount (`unsatisfied`), so no row runs for it. A byproduct consumer's ingredient is
 * locked whatever its rule.
 */
export function sourcingSets(plan: SolverPlan, byproductConsumerIngredients: Set<string>): SourcingSets {
  const importOff = importOffItems(plan)
  const importOffLocked = new Set(importOff.filter(id => plan.sourceRules?.[id]?.makeHere !== 'off'))
  const locked = new Set(importOffLocked)
  for (const id of byproductConsumerIngredients) locked.add(id)
  const cannotImport = new Set([...importOff, ...byproductConsumerIngredients])
  const byproductsFirst = new Set(itemsWithSourcing(plan, 'off').filter(id => !locked.has(id)))
  return { locked, importOffLocked, cannotImport, byproductsFirst, leftoverOff: new Set(leftoverOffItems(plan.sourceRules)) }
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
 * A split fluid's keys share one offer: it is unlocked, all its keys together, when the offer is below the sum of
 * their residuals (`flow.offers`; the group row of the LP bounds what the keys take together).
 */
export function pass2Plan(args: {
  totalCaps: Map<string, number>
  intermediates: Set<string>
  firstItems: Set<string>
  locked: Set<string>
  slack: Map<string, number>
  S: Map<string, Map<string, number>>
  throughput: Map<string, number>
  /** the flow keys of the system, when it has split fluids */
  flow?: FlowKeys
  /** The fluids whose connections supply keys of their own (`FlowKeys.supply`), see below. */
  keySupply?: KeySupplyPlan
}): { run: boolean; caps: Map<string, number>; noImport: Set<string>; fluidCaps: Map<string, number> } {
  const caps = new Map<string, number>()
  const noImport = new Set(args.locked)
  const fluidCaps = new Map<string, number>()
  const fluids = new Set<string>()
  let run = false
  for (const [itemId, cap] of args.totalCaps) {
    if (!args.intermediates.has(itemId)) continue
    if (args.flow?.supply.has(itemId)) continue // a supplied key: its fluid is decided per fluid below
    const residual = args.slack.get(itemId) ?? 0
    if (residual <= FLOW_TOLERANCE) continue
    if (args.firstItems.has(itemId)) {
      // Already supplied in pass 1 up to its offer: stays unlocked only if something is left.
      noImport.delete(itemId)
      continue
    }
    caps.set(itemId, Math.min(cap, residual))
    const fluid = args.flow?.info.get(itemId)?.itemId
    if (fluid !== undefined) fluids.add(fluid)
    else if (cap < residual - FLOW_TOLERANCE) noImport.delete(itemId)
    if (residual > surplusTolerance(itemGrossFlow(args.S.get(itemId), args.throughput))) run = true
  }
  for (const fluid of fluids) {
    const keys = itemKeys({ flow: args.flow }, fluid)
    const offer = args.flow!.offers.get(fluid) ?? Infinity
    let total = 0
    for (const k of keys) total += args.slack.get(k) ?? 0
    if (offer < total - FLOW_TOLERANCE) for (const k of keys) noImport.delete(k)
  }
  // A fluid with supplied keys: the residual is the sum of its range keys' slacks. Receive it first has its supply in every
  // pass, so its keys stay unlocked only when something is left; any other fluid caps its supplied keys together at the
  // smaller of the offers and the residual (own production first) and unlocks its range keys when the offers cannot cover it.
  for (const [fluid, plan] of args.keySupply?.fluids ?? []) {
    let residual = 0
    const perRange = new Map<string, number>()
    for (const k of plan.rangeKeys) {
      const r = args.slack.get(k) ?? 0
      residual += r
      if (r > FLOW_TOLERANCE) perRange.set(k, r)
    }
    if (residual <= FLOW_TOLERANCE) continue
    if (plan.keys.every(k => args.firstItems.has(k))) {
      for (const k of plan.rangeKeys) noImport.delete(k)
      continue
    }
    for (const k of plan.keys) if (!args.firstItems.has(k)) caps.set(k, args.totalCaps.get(k)!)
    // Own production first: what the offered keys cannot serve (a range none of them fits) is not theirs to replace.
    const fit = plan.fit(perRange)
    fluidCaps.set(fluid, Math.min(plan.offers, residual, fit))
    if (fit < residual - FLOW_TOLERANCE) for (const k of plan.rangeKeys) noImport.delete(k)
    let gross = 0
    for (const k of plan.rangeKeys) gross += itemGrossFlow(args.S.get(k), args.throughput)
    if (residual > surplusTolerance(gross)) run = true
  }
  return { run, caps, noImport, fluidCaps }
}

/**
 * What `pass2Plan` needs of the fluids whose connections supply keys: per fluid its supplied keys, its non-goal range keys,
 * what the connections offer in all, and `fit`, the most the offered keys can serve of a residual per range key (`maxFit`).
 */
export interface KeySupplyPlan {
  fluids: Map<string, { keys: string[]; rangeKeys: string[]; offers: number; fit: (residual: Map<string, number>) => number }>
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
    beaconPowerKw: 0,
  }
}

/**
 * The rates, machine count and power of one row running at `throughput` executions/min.
 * `feeder` says the row is a feeder of an absorber chain; it is marked `feedsAbsorber` only while
 * it runs (throughput above `FLOW_TOLERANCE`).
 */
export function solvedNodeOf(
  planNode: GameRecipeNode,
  recipe: Recipe,
  throughput: number,
  effects: NodeEffects,
  prodBonus: number,
  gameData: GameData,
  feeder = false,
): SolvedNode {
  // A missing default (no machine for the category, or none within the research horizon) leaves
  // count and power at 0; rates do not depend on the machine, except a burner's fuel.
  const machine = rowMachine(planNode, gameData)

  let machineCountExact = 0
  let machineCountCeil = 0
  let powerKw = 0
  let beaconPowerKw = 0
  if (machine) {
    const m = computeMachineMetrics(throughput, recipe.craftingTime, machine, effects)
    machineCountExact = m.machineCountExact
    machineCountCeil = m.machineCountCeil
    // A burner row with fuel data draws no electricity for the machine (its energy is the fuel ingredient) but still
    // pays for its beacons.
    beaconPowerKw = m.beaconPowerKw
    powerKw = effects.fuel ? m.beaconPowerKw : m.powerKw
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

  // The temperatures of the split fluids the row makes and takes (one per fluid: the first listed wins).
  const split = splitFluids(gameData)
  const inputTags: Record<string, FluidTag> = {}
  for (const ing of rowIngredients(recipe, effects)) {
    if (split.has(ing.itemId) && !(ing.itemId in inputTags)) inputTags[ing.itemId] = rangeOf(ing)
  }
  const outputTags: Record<string, FluidTag> = {}
  for (const prod of recipe.products) {
    if (split.has(prod.itemId) && !(prod.itemId in outputTags)) outputTags[prod.itemId] = productTag(prod, gameData.items[prod.itemId])
  }

  return {
    recipeNodeId: planNode.id,
    inputRates,
    outputRates,
    throughput,
    machineCountExact,
    machineCountCeil,
    powerKw,
    beaconPowerKw,
    ...(effects.fuel ? { fuelItemId: effects.fuel.itemId } : {}),
    ...(feeder && throughput > FLOW_TOLERANCE ? { feedsAbsorber: true as const } : {}),
    ...(Object.keys(outputTags).length > 0 ? { outputTags } : {}),
    ...(Object.keys(inputTags).length > 0 ? { inputTags } : {}),
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
  /** The base item of a key (default: the key itself); `goals` and the flows are keyed by flow key. */
  itemOf?: (key: string) => string
}): SolverWarning | undefined {
  const { goals, system, throughput, slack, itemSurplus, itemGross, fixed, noImportItems, recipeOf, mainItemOf } = args
  const itemOf = args.itemOf ?? (key => key)
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
    const bindingItems = [...new Set(binding.map(itemOf))]
    const main = mainItemOf(columnId)
    if (main === undefined || bindingItems.includes(main)) continue
    const needed = Math.max(0, t - minRoom)
    if (needed > COPRODUCT_DRIVEN_RATIO * t) continue
    const recipeId = recipeOf(columnId)
    let entry = byRecipe.get(recipeId)
    if (!entry) byRecipe.set(recipeId, entry = { itemIds: new Set(), saved: 0 })
    for (const id of bindingItems) entry.itemIds.add(id)
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
  /** base itemId → items/min taken from the offers (a split fluid: over all its keys) */
  received: Map<string, number>
  /** unqualified flow key (the item id for a plain item) → items/min taken from the offers: a probe's range keys, a connection's supplied keys. */
  receivedKeys: Map<string, number>
  /** connection id → offered key → items/min it delivered, for the supplied keys; empty without them. */
  receivedParts: Map<string, Map<string, number>>
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
  /** what each supplied key took from each connection (`LPResult.keySupplyUse`) */
  keySupplyUse?: { key: string; connectionId: string; offeredKey: string; value: number }[]
  /** pair item → what its areas drew from the connections (area solve only, `pairDrawn`); replaces the block-net deficit cap, which counts production stranded in a switched-off area */
  pairSupplied?: ReadonlyMap<string, number>
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

  // What leaves the solver names the base item and, for a split fluid, the tag; entries of one (item, tag) are merged
  // into the first one's place (area-qualified keys of one range, or of one temperature).
  const entry = (key: string, rate: number): UnsatisfiedItem => {
    const { itemId, temp } = resultItem(system, key)
    return { itemId, rate, ...(temp ? { temp } : {}) }
  }
  const sameTag = (a: UnsatisfiedItem, b: UnsatisfiedItem) =>
    a.itemId === b.itemId && (a.temp === undefined ? b.temp === undefined : b.temp !== undefined && flowKey(a.itemId, a.temp) === flowKey(b.itemId, b.temp))
  const addMerged = <T extends UnsatisfiedItem>(list: T[], e: T): void => {
    const same = e.temp === undefined ? undefined : list.find(x => sameTag(x, e))
    if (same) same.rate += e.rate
    else list.push(e)
  }

  // Detect overconstrained intermediates: positive net flow at LP optimum.
  const overconstrainedItems: { itemId: string; rate: number; temp?: FluidTag }[] = []
  for (const itemId of system.classification.intermediates) {
    // Surplus supply of a supplied key is not production.
    if (isSuppliedKey(system, itemId)) continue
    const surplus = itemSurplus.get(itemId) ?? 0
    if (surplus > surplusTolerance(itemGross.get(itemId) ?? 0)) {
      addMerged(overconstrainedItems, entry(itemId, surplus))
    }
  }
  const overconstrained: SolverWarning | undefined = overconstrainedItems.length > 0
    ? { type: 'overconstrained', surplusItems: overconstrainedItems }
    : undefined

  // Goal shortfall pass: if LP was infeasible (no LP-active producer, or conflicting pins),
  // the actual net output of a goal may be below its target. Surface the deficit so the
  // Ingredients pane shows what must come from outside. A split fluid's goal is on its `[,]` key.
  const goalShortfalls: UnsatisfiedItem[] = []
  const goalShortfallKeys = new Set<string>()
  for (const goal of goals) {
    const key = goalKeyOf(system, goal)
    let netActual = 0
    if (key !== goal.itemId) {
      netActual = itemSurplus.get(key) ?? 0
    } else {
      for (const node of nodes) {
        netActual += node.outputRates[goal.itemId] ?? 0
        netActual -= node.inputRates[goal.itemId] ?? 0
      }
    }
    const shortfall = goal.rate - netActual
    if (shortfall > GOAL_SHORTFALL_TOLERANCE) {
      goalShortfalls.push(entry(key, shortfall))
      goalShortfallKeys.add(key)
    }
  }

  // Intermediate slack → external imports needed for network balance.
  const slackIntermediates: UnsatisfiedItem[] = []
  for (const [itemId, rate] of slackMap) addMerged(slackIntermediates, entry(itemId, rate))

  const received = new Map<string, number>()
  const receivedKeys = new Map<string, number>()
  const addReceived = (key: string, rate: number) => {
    const base = baseOf(system, key)
    received.set(base, base === key ? rate : (received.get(base) ?? 0) + rate)
    const tag = system.flow?.info.get(key)?.tag
    const unqualified = tag === undefined ? key : flowKey(base, tag)
    receivedKeys.set(unqualified, (receivedKeys.get(unqualified) ?? 0) + rate)
  }
  const receivedParts = new Map<string, Map<string, number>>()
  const rawConsumption: UnsatisfiedItem[] = []
  // A split fluid's raw keys share its offer, in key order.
  const offerLeft = new Map<string, number>()
  for (const itemId of system.classification.raw) {
    if (goalShortfallKeys.has(itemId)) continue
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
    const base = baseOf(system, itemId)
    const cap = totalCaps.get(itemId) ?? 0
    const available = base === itemId ? cap : Math.min(cap, offerLeft.get(base) ?? cap)
    const fromSupply = Math.min(totalConsumption, available)
    if (base !== itemId) offerLeft.set(base, available - fromSupply)
    if (fromSupply > FLOW_TOLERANCE) addReceived(itemId, fromSupply)
    const imported = totalConsumption - fromSupply
    if (fromSupply === 0 || imported > surplusTolerance(totalConsumption)) {
      addMerged(rawConsumption, entry(itemId, imported))
    }
  }

  // Connected intermediates: the amount taken is the deficit left after own
  // production, never the raw LP variable (degenerate optima can leave it higher).
  for (const itemId of totalCaps.keys()) {
    if (!system.classification.intermediates.has(itemId)) continue
    const deficit = Math.max(0, -(itemSurplus.get(itemId) ?? 0))
    // Charged whatever the LP used, even a deficit within the noise of the flow: the source's
    // bookkeeping must match the supply the block actually drew.
    const fromSupply = args.pairSupplied?.get(itemId) ?? Math.min(supply.get(itemId) ?? 0, deficit)
    if (fromSupply > FLOW_TOLERANCE) addReceived(itemId, fromSupply)
    // A supplied key: each connection delivered its part of what the key took.
    if (isSuppliedKey(system, itemId) && fromSupply > FLOW_TOLERANCE) {
      const total = supply.get(itemId) ?? 0
      for (const u of args.keySupplyUse ?? []) {
        if (u.key !== itemId) continue
        const parts = receivedParts.get(u.connectionId) ?? new Map<string, number>()
        parts.set(u.offeredKey, (parts.get(u.offeredKey) ?? 0) + (u.value * fromSupply) / total)
        receivedParts.set(u.connectionId, parts)
      }
    }
  }

  // Ordering: goal shortfalls first, then intermediate slack, then raw consumption.
  const unsatisfied: UnsatisfiedItem[] = [...goalShortfalls, ...slackIntermediates, ...rawConsumption]

  return { itemSurplus, itemGross, overconstrained, unsatisfied, received, receivedKeys, receivedParts }
}
