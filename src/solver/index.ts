import type {
  FluidConversion,
  FluidTag,
  Block,
  BlockConnection,
  BlockLoop,
  ConnectionFlow,
  ConnectionFlowStatus,
  ConnectionPart,
  GameData,
  MultiBlockSolve,
  Product,
  RecipeNode,
  RequestIgnoredReason,
  SolvedNode,
  SolverGoal,
  SolverResult,
  SolverWarning,
  SubPlan,
} from '../data/types'
import { blockAreas, explicitMainProduct, solveAreaBlock, withAreaRules } from './areas'
import { buildClassifiedSystem, discardProduct, lockedIngredients, rowProductAmount, type FluidKeySupply, type KeySupply } from './build'
import { hasUnreliableRates, isUnbounded, solveLP } from './solve'
import { isFeeder } from './absorbers'
import { connectionOrder, needsConnectionOrder } from './connectionOrder'
import { hasTemperatureData, temperatureWarnings } from './temperature'
import { compareTags, fitsRange, flowKey, isTemperatureTag, keysOfItem, parseFlowKey, rangeDepth, splitFluids, sumOfItem, versatility, type FluidRange } from '../data/flowKey'
import { allocateKeys, type AllocKey, type AllocMember } from './keyAllocation'
import { baseOf, conversionsOf, expandToKeys, fluidRanges, goalKeyOf, goalMapKey, keyCaps, keyGoals, noFittingTemperature, supplyCaps as suppliedKeyCaps } from './flowKeys'
import { keySupplyPlanOf } from './keySupplyPlan'
import { computeNodeEffects } from './effects'
import { moduleNotAllowedWarning } from './moduleWarnings'
import { consumersOf, hasProduct, orderBlocks, reaches, receivesItem, type LoopShape } from './blockGraph'
import {
  FLOW_TOLERANCE, blockDiagnostics, coproductDrivenWarning, sourcingSets, itemsWithSourcing, outsideResidual, pass2Plan, solvedNodeOf, surplusTolerance, zeroNode, type SolverPlan,
} from './blockResult'
import { buildServed } from './served'
import { areaKeyNeedsOf, areaNeedsOf, splitByArea, type AreaNeed, type AreaNeeds, type AreaReport } from './servedAreas'
import { servedGroupSpans } from '../data/servedEntries'
import { grantByRank, rankedPairs, servedRankOf, waterFill, type RankedEntry, type RankedPair, type RankedPairs, type ServedRank } from './servedRank'
import { canonicalAreas, exactKey, keySupplyKey, planKey, sourcingKey, type RequestLoopSolve, type SolveCache } from './solveCache'

/**
 * Flatten a Block into a SolverPlan: walk the rootPlan tree, collect every
 * node, and surface the block's products as goals and its source rules. SubPlanNode handles
 * are pure UI grouping; solve() skips them by filtering on kind. When a sub-factory is a
 * separate area the plan also lists the areas, each with its own rules when its sub-plan has some
 * (see areas.ts); otherwise it has no `areas` key.
 */
export function flattenBlock(block: Block): SolverPlan {
  const nodes: RecipeNode[] = []
  function visit(plan: SubPlan): void {
    for (const n of plan.nodes) nodes.push(n)
    for (const sp of plan.subPlans) visit(sp)
  }
  visit(block.rootPlan)
  const plan: SolverPlan = {
    goals: productGoals(block.products),
    nodes,
    sourceRules: block.sourceRules,
  }
  const areas = blockAreas(block.rootPlan)
  return areas ? { ...plan, areas: withAreaRules(block.rootPlan, areas) } : plan
}

/**
 * Does a recipe row of the block make `itemId`? Such an item has an LP row, so Import off can
 * forbid importing it; any other item is raw in the block and a lock on it changes nothing. With `nodeIds`, only the rows
 * of that set count (the rows of one area).
 */
export function blockMakesItem(block: Block, gameData: GameData, itemId: string, nodeIds?: ReadonlySet<string>): boolean {
  // Same test as buildClassifiedSystem: a product registers a producer only with an effective amount above 0
  // (a probability of 0 does not). Bonuses are left out: they scale a positive amount but never change its sign.
  const makes = (plan: SubPlan): boolean =>
    plan.nodes.some(n => n.kind === 'game-recipe' && (nodeIds === undefined || nodeIds.has(n.id))
      && gameData.recipes[n.recipeId]?.products.some(p => p.itemId === itemId && rowProductAmount(p) > 0))
    || plan.subPlans.some(makes)
  return makes(block.rootPlan)
}

/**
 * The solver goals of a block's products: `extraRate` (0 when absent), and for the first product
 * of each item also what other blocks `requested` of it. Rates at or below zero are dropped.
 * `requested` is keyed by flow key (the item id for a plain item): a split fluid is requested per range, the request of any
 * temperature (`item[,]`) joins the first product's goal and each other requested range is one more goal on that product,
 * `temp` set (see `SolverGoal.temp`).
 */
export function productGoals(products: Product[], requested?: Map<string, number>): SolverGoal[] {
  const goals: SolverGoal[] = []
  const first = new Set<string>()
  for (const p of products) {
    let rate = p.extraRate ?? 0
    const ranged: SolverGoal[] = []
    if (!first.has(p.itemId)) {
      first.add(p.itemId)
      for (const key of requested ? keysOfItem(requested, p.itemId) : []) {
        const r = requested!.get(key) ?? 0
        if (!(r > FLOW_TOLERANCE)) continue
        const tag = parseFlowKey(key).tag
        // A plain item, or a split fluid requested at any temperature, adds to the product's own goal.
        if (key === p.itemId || (tag && !isTemperatureTag(tag) && tag.min === undefined && tag.max === undefined)) rate += r
        else if (tag && !isTemperatureTag(tag)) ranged.push({ id: `${p.id}\0${key}`, itemId: p.itemId, rate: r, temp: tag })
      }
    }
    if (rate > 0) goals.push({ id: p.id, itemId: p.itemId, rate })
    goals.push(...ranged)
  }
  return goals
}

export { receivesItem }

export { FLOW_TOLERANCE, surplusTolerance, outsideResidual }

/**
 * What a source's remaining output `left` of an item offers one connection. `pending` is what
 * unserved shares still hold (including this connection's own `share`; 0 for a take with no credit).
 * A connection is served its own share first; beyond it, like a take, it sees only what no unserved
 * share holds. `share` is the request or the take's credit, or, for a pair the source's served list
 * ranks, the grant the list gives the connection: the list decides who is short, so the solve order
 * of the consumers no longer does.
 */
export function connectionOffer(left: number, pending: number, share: number): number {
  return Math.max(0, Math.min(share, left), left - (pending - share))
}

/** The flows of solved nodes, for `netBalance` and `grossFlow`: rates by base item, with the tags of the split fluids. */
interface FlowNode {
  inputRates: Record<string, number>
  outputRates: Record<string, number>
  inputTags?: Record<string, FluidTag>
  outputTags?: Record<string, FluidTag>
}

/**
 * Net items/min a set of solved nodes leaves over per flow key (the item id for a plain item; `steam@500`, `steam[465,]`
 * for a split fluid, see src/data/flowKey.ts): produced minus consumed. Positive entries are what a block can offer to other
 * blocks. A conversion moves flow from the key it takes to the key it gives, so a boiler at 500°C feeding a turbine that
 * takes 465°C or more nets to zero on both.
 */
export function netBalance(nodes: FlowNode[], conversions?: FluidConversion[]): Map<string, number> {
  const net = new Map<string, number>()
  const add = (key: string, rate: number) => net.set(key, (net.get(key) ?? 0) + rate)
  for (const node of nodes) {
    for (const [id, rate] of Object.entries(node.outputRates)) add(flowKey(id, node.outputTags?.[id]), rate)
    for (const [id, rate] of Object.entries(node.inputRates)) add(flowKey(id, node.inputTags?.[id]), -rate)
  }
  for (const c of conversions ?? []) {
    add(flowKey(c.itemId, c.from), -c.rate)
    add(flowKey(c.itemId, c.to), c.rate)
  }
  return net
}

/** Gross flow per flow key: the larger of what the nodes produce and what they consume (conversions count on both sides). */
export function grossFlow(nodes: FlowNode[], conversions?: FluidConversion[]): Map<string, number> {
  const produced = new Map<string, number>()
  const consumed = new Map<string, number>()
  const add = (map: Map<string, number>, key: string, rate: number) => map.set(key, (map.get(key) ?? 0) + rate)
  for (const node of nodes) {
    for (const [id, rate] of Object.entries(node.outputRates)) add(produced, flowKey(id, node.outputTags?.[id]), rate)
    for (const [id, rate] of Object.entries(node.inputRates)) add(consumed, flowKey(id, node.inputTags?.[id]), rate)
  }
  for (const c of conversions ?? []) {
    add(consumed, flowKey(c.itemId, c.from), c.rate)
    add(produced, flowKey(c.itemId, c.to), c.rate)
  }
  const gross = new Map<string, number>()
  for (const key of new Set([...produced.keys(), ...consumed.keys()]))
    gross.set(key, Math.max(produced.get(key) ?? 0, consumed.get(key) ?? 0))
  return gross
}

/**
 * What a block with these `nodes` can offer per flow key (the item id for a plain item): each key's net above its own noise
 * floor, and the unthresholded positive nets with their noise floors for the loops' convergence test.
 */
function offersOf(nodes: FlowNode[], conversions?: FluidConversion[]): { offers: Offers; netOffers: BlockStep['netOffers'] } {
  const offers: Offers = new Map()
  const netOffers: BlockStep['netOffers'] = new Map()
  const gross = grossFlow(nodes, conversions)
  for (const [key, net] of netBalance(nodes, conversions)) {
    const tol = surplusTolerance(gross.get(key) ?? 0)
    if (net > 0) netOffers.set(key, { net, tol })
    if (net > tol) offers.set(key, net)
  }
  return { offers, netOffers }
}

export function solve(plan: SolverPlan, gameData: GameData): SolverResult {
  return solveBlock(plan, gameData).result
}

/**
 * Solve one block, optionally with items supplied by other blocks.
 *
 * `supplyCaps` maps itemId → items/min on offer. Own production comes first,
 * so the block runs in up to two passes:
 *   1. Solve without supply, letting connected items use slack even when they
 *      are locked, to measure what the block's own recipes cannot cover.
 *   2. Only if a connected intermediate is short, solve again with the original
 *      locks and a supply variable per short item, capped at min(offer, shortfall).
 * `received` is what the block actually takes from each offer (items/min).
 * Exception: connections-first items (`makeHere: 'after-blocks'`) have their supply in every
 * pass, capped by the offer only, so it is used before the block's own recipes.
 * Byproducts-first items (`makeHere: 'off'`) get a cheap import slack (not BIG_M) in both passes, so
 * the LP imports them rather than run a recipe just for them; the pass-1 residual is then exactly
 * what the byproducts don't cover, and the passes are otherwise unchanged. Locked items and
 * byproduct consumers' ingredients keep the default cost.
 *
 * A third step lets a connection replace an import: when the two passes still import an
 * intermediate while a connected one on the default rule has offer left, `connectionOrder`
 * decides what is taken (up to three more LP solves; a Don't make more here item adds a refill solve, and each bounded step
 * (least received, fill, refill) may retry once with looser bounds, so at most seven in all; see connectionOrder.ts).
 *
 * The solve cache key (see solveCache.ts) must grow if this ever reads
 * anything beyond `plan`, `gameData`, `supplyCaps` and `keySupply` (a split fluid's offers per connection and key, its ranges
 * across the plan and the connections' limits, see `keySupplyKey`); `connectionOrder` reads only those
 * (the plan, the game data and the offers), so the key is `planKey`, the caps and `keySupplyKey`.
 *
 * `keySupply` hands a split fluid over by key: each offered key is a supplied key with its own variables, and the result says
 * what each connection delivered of each key (`receivedParts`), and what a probe received per range key (`receivedKeys`).
 */
export function solveBlock(
  plan: SolverPlan,
  gameData: GameData,
  supplyCaps: Map<string, number> = new Map(),
  keySupply: KeySupply = new Map(),
): { result: SolverResult; received: Map<string, number>; receivedParts?: Map<string, Map<string, number>>; receivedKeys: Map<string, number> } {
  if (plan.areas) return solveAreaBlock(plan, plan.areas, gameData, supplyCaps, keySupply)

  // SubPlanNodes are UI grouping only; the solver only sees game-recipe nodes.
  // byproductConsumer is a flag that applies a small negative bonus to the
  // recipe's objective coefficient, making the LP prefer to run it up to
  // whatever surplus the intermediate constraints allow — without overriding
  // goal-meeting decisions. The rows that only feed a flagged row run along
  // with it at no cost (`absorberRoles`, see spec/solver.md, "Absorber chains"); a row marked `absorberFeeder` runs for them too.
  const gameRecipeNodes = plan.nodes.filter(n => n.kind === 'game-recipe') as
    Extract<(typeof plan.nodes)[number], { kind: 'game-recipe' }>[]

  // Detect duplicate recipe nodes (same recipeId used more than once).
  const recipeIdCount = new Map<string, number>()
  for (const n of gameRecipeNodes) {
    recipeIdCount.set(n.recipeId, (recipeIdCount.get(n.recipeId) ?? 0) + 1)
  }
  const duplicateWarnings: SolverResult['warnings'] = []
  for (const [recipeId, count] of recipeIdCount) {
    if (count > 1) {
      duplicateWarnings.push({ type: 'duplicate-recipe', recipeId, count })
    }
  }

  // One LP variable per recipe: the first node in plan order is authoritative
  // (effects (modules, beacons, neighbour count), pin, byproduct settings); later duplicates solve to zero.
  const seenRecipes = new Set<string>()
  const representatives = gameRecipeNodes.filter(n => {
    if (seenRecipes.has(n.recipeId)) return false
    seenRecipes.add(n.recipeId)
    return true
  })
  const representativeIds = new Set(representatives.map(n => n.id))

  const recipeIds = representatives.map(n => n.recipeId)

  const goalsMap = new Map(plan.goals.map(g => [goalMapKey(g), g.rate]))

  const nodeEffectsMap = new Map(
    representatives.map(n => [n.recipeId, computeNodeEffects(n, gameData)]),
  )
  const productivityMap = new Map<string, number>()
  for (const n of representatives) {
    const effects = nodeEffectsMap.get(n.recipeId)!
    if (effects.productivityBonus > 0) {
      productivityMap.set(n.recipeId, effects.productivityBonus)
    }
  }

  const bcRecipeIds = new Set(
    representatives.filter(n => n.byproductConsumer).map(n => n.recipeId),
  )

  const markedFeeders = new Set(
    representatives.filter(n => n.absorberFeeder && !n.byproductConsumer).map(n => n.recipeId),
  )

  const system = buildClassifiedSystem(gameData, recipeIds, goalsMap, nodeEffectsMap, { supplyCaps, keySupply })

  // Warn for goal items with no producer recipe in the plan (one warning per item for the goals on a range).
  const noRecipeWarnings: SolverResult['warnings'] = []
  for (const goal of plan.goals) {
    const row = system.S.get(goalKeyOf(system, goal))
    const hasProducer = row !== undefined && [...row.values()].some(c => c > 0)
    if (!hasProducer && !(goal.temp && noRecipeWarnings.some(w => w.type === 'no-recipe' && w.itemId === goal.itemId))) {
      noRecipeWarnings.push({ type: 'no-recipe', itemId: goal.itemId })
    }
  }

  for (const n of representatives) {
    for (const [itemId, policy] of Object.entries(n.byproductPolicy)) {
      if (policy === 'discard') discardProduct(system, itemId, n.recipeId)
    }
  }

  const pinnedRates = new Map<string, number>()
  for (const n of representatives) {
    if (n.pinnedRate !== undefined) {
      pinnedRates.set(n.recipeId, n.pinnedRate)
    }
  }

  // Ingredients of byproduct consumers (not of the rows that only feed them): locked (no import slack) whatever the rule of the item.
  // Auto-adding bc ingredients preserves the "consume surplus only, don't
  // trigger new ingredient production" semantics: with no slack allowed on
  // a bc ingredient, the LP can't import it just to fire the bc bonus —
  // it must come from an in-plan producer (or raw if no producer exists).
  const consumerIngredients = new Set<string>()
  for (const n of representatives) {
    if (!n.byproductConsumer) continue
    const recipe = gameData.recipes[n.recipeId]
    if (!recipe) continue
    for (const ing of lockedIngredients(recipe, nodeEffectsMap.get(n.recipeId), n)) {
      consumerIngredients.add(ing.itemId)
    }
  }

  // The LP's locked set, its byproducts-first set and the set `coproductDrivenWarning` reads (see `sourcingSets`).
  const sets = sourcingSets(plan, consumerIngredients)
  const locked = expandToKeys(system, sets.locked)
  const cannotImport = expandToKeys(system, sets.cannotImport)
  const byproductsFirst = expandToKeys(system, sets.byproductsFirst)

  // A split fluid's offer is the cap of each of its range keys (the LP's group row bounds their sum); one a connection supplies
  // by key (`keySupply`) has a supplied key per offered key instead, capped by what the connections offer of it.
  const totalCaps = new Map([
    ...keyCaps(system, new Map([...supplyCaps].filter(([id, cap]) => cap > FLOW_TOLERANCE && !keySupply.has(id)))),
    ...suppliedKeyCaps(system),
  ])
  const noFitWarnings = noFittingTemperature(system, expandToKeys(system, sets.importOffLocked), id => id)

  // Pass 1: what the block's own recipes cannot cover. Connected items lose their
  // lock for this pass only, so a shortfall shows up as slack, not as infeasibility. A split fluid loses it on every key.
  const connectedBases = new Set([...totalCaps.keys()].map(k => baseOf(system, k)))
  const pass1NoImport = totalCaps.size === 0
    ? locked
    : new Set([...locked].filter(itemId => !connectedBases.has(baseOf(system, itemId))))
  // Connections-first intermediates have their supply in every pass, capped by the
  // offer only, so the LP uses it before the block's own recipes.
  const firstItems = new Set(
    [...expandToKeys(system, itemsWithSourcing(plan, 'after-blocks'))].filter(
      itemId => totalCaps.has(itemId) && system.classification.intermediates.has(itemId),
    ),
  )
  const firstCaps = new Map([...firstItems].map(itemId => [itemId, totalCaps.get(itemId)!]))
  const keySupplyPlan = keySupplyPlanOf(system)
  const offerFluidCaps = new Map([...(keySupplyPlan?.fluids ?? [])].map(([fluid, f]) => [fluid, f.offers]))
  let lp = solveLP(system, pinnedRates, bcRecipeIds, pass1NoImport, firstCaps, firstItems, byproductsFirst, markedFeeders, { fluidCaps: offerFluidCaps, leftoverOff: sets.leftoverOff })

  // Pass 2: supply fills only the residual of connected intermediates. Capping at
  // the residual keeps own production at its pass-1 level (replacing it would
  // bring slack back at BIG_M); raw items need no LP row and are handled below.
  const pass2 = pass2Plan({
    totalCaps, intermediates: system.classification.intermediates, firstItems, locked,
    slack: lp.slack, S: system.S, throughput: lp.throughput, flow: system.flow, keySupply: keySupplyPlan,
  })
  // An unbounded pass 1 has arbitrary slack and throughput, so pass 2 would be planned from noise: keep pass 1 and its warning.
  if (pass2.run && !isUnbounded(lp.warnings)) {
    lp = solveLP(
      system, pinnedRates, bcRecipeIds, pass2.noImport,
      new Map([...firstCaps, ...pass2.caps]), firstItems, byproductsFirst, markedFeeders, { fluidCaps: pass2.fluidCaps, leftoverOff: sets.leftoverOff },
    )
  }

  // A connection replaces an import: when the two passes still import an intermediate while a connection
  // has offer to spare, the order of connectionOrder.ts decides (least import, least received, fill).
  const order = {
    system, pinnedRates, bcRecipeIds, markedFeeders, pass1NoImport, locked, byproductsFirst, firstItems, totalCaps, today: lp,
    fluidCaps: offerFluidCaps, keySupply: keySupplyPlan, leftoverOff: sets.leftoverOff,
  }
  if (needsConnectionOrder(order)) lp = connectionOrder(order) ?? lp

  const { throughput: throughputMap, warnings } = lp

  const nodes: SolvedNode[] = []

  for (const planNode of gameRecipeNodes) {
    if (!representativeIds.has(planNode.id)) {
      nodes.push(zeroNode(planNode.id))
      continue
    }

    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue

    const throughput = throughputMap.get(planNode.recipeId) ?? 0
    const effects = nodeEffectsMap.get(planNode.recipeId)!
    const prodBonus = productivityMap.get(planNode.recipeId) ?? 0
    nodes.push(solvedNodeOf(
      planNode, recipe, throughput, effects, prodBonus, gameData, isFeeder(lp.absorbers, bcRecipeIds, planNode.recipeId),
    ))
  }

  const { overconstrained, itemSurplus, itemGross, unsatisfied, received, receivedKeys, receivedParts } = blockDiagnostics({
    goals: plan.goals, system, throughput: throughputMap, slack: lp.slack, supply: lp.supply, nodes, totalCaps, keySupplyUse: lp.keySupplyUse,
  })
  if (overconstrained) warnings.push(overconstrained)
  const mainItemOfRecipe = new Map<string, string>()
  for (const n of representatives) {
    const r = gameData.recipes[n.recipeId]
    const main = r ? explicitMainProduct(n, r) : undefined
    if (main !== undefined) mainItemOfRecipe.set(n.recipeId, main)
  }
  // Pins that cannot be met, or an unbounded objective, make the flows meaningless for this check.
  const coproductDriven = hasUnreliableRates(warnings) ? undefined : coproductDrivenWarning({
    goals: keyGoals(system, plan.goals), system, throughput: throughputMap, slack: lp.slack, itemSurplus, itemGross,
    fixed: new Set([...pinnedRates.keys(), ...lp.absorbers.absorberOnly]), noImportItems: cannotImport, recipeOf: id => id,
    mainItemOf: id => mainItemOfRecipe.get(id), itemOf: key => baseOf(system, key),
  })
  if (coproductDriven) warnings.push(coproductDriven)

  const conversions = conversionsOf(system, throughputMap)
  return {
    result: {
      nodes, unsatisfied, warnings: [...duplicateWarnings, ...noRecipeWarnings, ...noFitWarnings, ...warnings],
      ...(conversions ? { conversions } : {}),
    },
    received,
    ...(receivedParts.size > 0 ? { receivedParts } : {}),
    receivedKeys,
  }
}

// ---------------------------------------------------------------------------
// Whole-plan solve
// ---------------------------------------------------------------------------

function emptyResult(): SolverResult {
  return { nodes: [], unsatisfied: [], warnings: [] }
}

/** Most rounds a loop of blocks is solved before its last round is kept as is. */
export const LOOP_ROUND_LIMIT = 8

/** Most demand rounds a cycle of requests is solved before its first round is kept. */
export const REQUEST_ROUND_LIMIT = 30

/** Rounds in a row the demand of a cycle of requests may grow before it is called diverging. */
const REQUEST_GROWTH_ROUNDS = 3

export interface SolveAllOptions {
  /** Overrides `LOOP_ROUND_LIMIT` (at least 1). */
  loopRoundLimit?: number
  /** Overrides `REQUEST_ROUND_LIMIT` (at least 1). */
  requestRoundLimit?: number
}

/** flow key (the item id for a plain item) → items/min; one block's offer, or what is still unclaimed of it. */
type Offers = Map<string, number>

interface StepContext {
  blockIds: Set<string>
  selfConnectionIds: Set<string>
  /** Connections between two members of one loop. */
  loopConnectionIds: Set<string>
  gameData: GameData
  cache?: SolveCache
  /** connection id → what the request pass decided for a connection to a product of its source. */
  requests: Map<string, RequestInfo>
  /** take connection id → what the request pass credited it (reserved for it like a request share). */
  credits: Map<string, number>
  /** connection id → what the source's served list grants it of the source's offer; absent for a pair that is not ranked. */
  grants: ReadonlyMap<string, number>
  /** split fluid: connection id → flow key → what the connection's request asked or its take was credited (parts of `requests` and `credits`). */
  keyShares: ReadonlyMap<string, ReadonlyMap<string, number>>
  /** split fluid: connection id → flow key → what the source's served list grants it; absent for a pair that is not ranked. */
  keyGrants: ReadonlyMap<string, ReadonlyMap<string, number>>
  /** split fluid → the ranges the plan's rows take of it (see `fluidRanges`) */
  ranges: ReadonlyMap<string, FluidRange[]>
  /** blockId → goals with requested amounts added; absent = the block's own. */
  goals: Map<string, SolverGoal[]>
}

interface BlockStep {
  result: SolverResult
  error?: string
  flows: ConnectionFlow[]
  /** The block's net output, before any consumer took from it. */
  offers: Offers
  /** Every key with a positive net output, unthresholded, with the noise floor of its gross flow: the loop's convergence test reads these, so a value hovering at the offer threshold does not flip it. */
  netOffers: Map<string, { net: number; tol: number }>
}

function ignoredFlow(block: Block, c: BlockConnection, status: ConnectionFlowStatus): ConnectionFlow {
  return {
    connectionId: c.id,
    fromBlockId: c.fromBlockId,
    toBlockId: block.id,
    itemId: c.itemId,
    available: 0,
    capped: false,
    rate: 0,
    status,
    kind: 'take',
  }
}

/**
 * Solve one block against what its sources have left in `remaining`, and take
 * the delivered amounts out of `remaining`. `pending` holds reserved amounts not yet
 * served (source → item → items/min; requested amounts and take credits): other consumers
 * of the same (source, item) and requesters drawing on a later source beyond their own share
 * see the offer without it. A reserved share is served before later consumers: when the source
 * is short, the extra gives way first, then the shares served last (see `connectionOffer`). For a
 * pair the source's served list ranks, `ctx.grants` replaces the share: the list, not the solve order, decides who is short.
 */
function solveStep(
  block: Block,
  ctx: StepContext,
  remaining: Map<string, Offers>,
  pending: Map<string, Offers>,
): BlockStep {
  const { gameData, cache } = ctx
  const split = splitFluids(gameData)
  const flows: ConnectionFlow[] = []
  const active: BlockConnection[] = []
  const available = new Map<string, number>() // connection id → items/min on offer
  const shares = new Map<string, number>()    // connection id → reserved items/min (request share or take credit)
  const caps = new Map<string, number>()      // item id → total on offer
  const seen = new Set<string>()
  const duplicates = new Set<string>() // connection ids repeating an earlier (source, item) pair
  const capped = new Set<string>() // connection ids whose maxRate is below the source's offer
  // A split fluid is offered per key: connection id → key → { share, offer } (the offer capped by `maxRate`), and what the solve is told.
  const keyed = new Map<string, Map<string, { share: number; offer: number }>>()
  const keySupply = new Map<string, FluidKeySupply>()
  for (const c of block.inputConnections) {
    if (!ctx.blockIds.has(c.fromBlockId)) {
      flows.push(ignoredFlow(block, c, 'missing-source'))
    } else if (ctx.selfConnectionIds.has(c.id)) {
      flows.push(ignoredFlow(block, c, 'self'))
    } else {
      // A repeated (source, item) pair in hand-edited JSON must not double the offer.
      const key = `${c.fromBlockId}\0${c.itemId}`
      const duplicate = seen.has(key)
      if (duplicate) duplicates.add(c.id)
      const info = ctx.requests.get(c.id)
      let sourceOffer: number
      let share: number
      if (split.has(c.itemId)) {
        const left = remaining.get(c.fromBlockId)
        const reserved = pending.get(c.fromBlockId)
        const granted = ctx.keyGrants.get(c.id)
        const shareMap = granted ?? ctx.keyShares.get(c.id)
        const keys = new Set([...keysOfItem(left ?? new Map(), c.itemId), ...keysOfItem(reserved ?? new Map(), c.itemId), ...(shareMap?.keys() ?? [])])
        const perKey = new Map<string, { share: number; offer: number }>()
        sourceOffer = 0
        share = 0
        for (const k of [...keys].sort((x, y) => compareTags(parseFlowKey(x).tag ?? {}, parseFlowKey(y).tag ?? {}))) {
          const kShare = shareMap?.get(k) ?? 0
          // `??`: a grant of 0 stays 0.
          const offer = duplicate ? 0 : connectionOffer(left?.get(k) ?? 0, reserved?.get(k) ?? 0, kShare)
          perKey.set(k, { share: kShare, offer })
          sourceOffer += offer
          share += kShare
          const tag = parseFlowKey(k).tag
          const cap = c.maxRate === undefined ? offer : Math.min(offer, c.maxRate)
          if (tag && cap > FLOW_TOLERANCE) {
            const ks = keySupply.get(c.itemId) ?? { ranges: ctx.ranges.get(c.itemId) ?? [], offers: [], maxRates: [] }
            ks.offers.push({ connectionId: c.id, tag, offer: cap })
            keySupply.set(c.itemId, ks)
          }
        }
        if (c.maxRate !== undefined && keySupply.get(c.itemId)?.offers.some(o => o.connectionId === c.id)) {
          keySupply.get(c.itemId)!.maxRates.push([c.id, c.maxRate])
        }
        keyed.set(c.id, perKey)
      } else {
        const reserved = pending.get(c.fromBlockId)?.get(c.itemId) ?? 0
        const left = remaining.get(c.fromBlockId)?.get(c.itemId) ?? 0
        // `??`: a grant of 0 stays 0.
        share = ctx.grants.get(c.id) ?? connectionShare(info, ctx.credits.get(c.id))
        sourceOffer = duplicate ? 0 : connectionOffer(left, reserved, share)
      }
      const offer = c.maxRate === undefined ? sourceOffer : Math.min(sourceOffer, c.maxRate)
      const limitBinds =
        info && 'requested' in info
          ? // The limit bounded the flow only if it cut the request and the source could have met it.
            c.maxRate !== undefined &&
            info.requested >= c.maxRate - surplusTolerance(c.maxRate) &&
            sourceOffer >= c.maxRate - surplusTolerance(c.maxRate)
          : c.maxRate !== undefined && c.maxRate < sourceOffer - surplusTolerance(sourceOffer)
      if (limitBinds) capped.add(c.id)
      seen.add(key)
      active.push(c)
      available.set(c.id, offer)
      shares.set(c.id, duplicate ? 0 : share)
      if (!split.has(c.itemId)) caps.set(c.itemId, (caps.get(c.itemId) ?? 0) + offer)
    }
  }

  let error: string | undefined
  let result = emptyResult()
  let received = new Map<string, number>()
  let receivedParts: Map<string, Map<string, number>> | undefined
  const base = flattenBlock(block)
  const plan = { ...base, goals: ctx.goals.get(block.id) ?? base.goals }
  if (plan.goals.length > 0 && plan.nodes.length > 0) {
    const key = cache ? planKey(plan) : ''
    const supplyKey = cache ? keySupplyKey(keySupply) : ''
    const hit = cache?.get(block.id, gameData, key, caps, supplyKey)
    if (hit) {
      ;({ result, received, receivedParts } = hit)
    } else {
      try {
        const solved = solveBlock(plan, gameData, caps, keySupply)
        ;({ result, received, receivedParts } = solved)
        cache?.set(block.id, gameData, key, caps, solved, supplyKey)
      } catch (err) {
        cache?.delete(block.id)
        error = err instanceof Error ? err.message : String(err)
        result = emptyResult()
        received = new Map()
        receivedParts = undefined
      }
    }
  } else {
    cache?.delete(block.id)
  }

  const stillImported = new Map<string, number>()
  for (const u of result.unsatisfied) {
    stillImported.set(u.itemId, (stillImported.get(u.itemId) ?? 0) + u.rate)
  }

  // Delivery in two passes, each in connection order: first every connection's reserved share
  // (what its source made or kept for it), then what the block still needs from the rest of the offers.
  // A split fluid's delivery is read per connection and key from the solve.
  const undelivered = new Map(received)
  const delivered = new Map<string, number>() // connection id → items/min
  const deliveredKeys = new Map<string, Map<string, number>>() // split connection id → key → items/min
  const deliver = (c: BlockConnection, offer: number): void => {
    const rate = Math.min(undelivered.get(c.itemId) ?? 0, offer)
    if (rate <= 0) return
    undelivered.set(c.itemId, (undelivered.get(c.itemId) ?? 0) - rate)
    delivered.set(c.id, (delivered.get(c.id) ?? 0) + rate)
  }
  for (const c of active) if (!keyed.has(c.id)) deliver(c, Math.min(shares.get(c.id) ?? 0, available.get(c.id) ?? 0))
  for (const c of active) if (!keyed.has(c.id)) deliver(c, (available.get(c.id) ?? 0) - (delivered.get(c.id) ?? 0))
  for (const c of active) {
    const perKey = keyed.get(c.id)
    if (perKey) {
      const parts = new Map<string, number>()
      for (const [k, rate] of receivedParts?.get(c.id) ?? []) if (rate > 0) parts.set(k, rate)
      deliveredKeys.set(c.id, parts)
      delivered.set(c.id, [...parts.values()].reduce((a, r) => a + r, 0))
    }
    const rate = delivered.get(c.id) ?? 0
    const sourceLeft = remaining.get(c.fromBlockId)
    if (sourceLeft && rate > 0) {
      if (perKey) for (const [k, r] of deliveredKeys.get(c.id)!) sourceLeft.set(k, (sourceLeft.get(k) ?? 0) - r)
      else sourceLeft.set(c.itemId, (sourceLeft.get(c.itemId) ?? 0) - rate)
    }
    // Served: whatever this consumer left unused of its share goes back to the ones solved later.
    const sourcePending = pending.get(c.fromBlockId)
    if (perKey) {
      if (sourcePending) {
        for (const [k, kv] of perKey) if (kv.share > 0) sourcePending.set(k, Math.max(0, (sourcePending.get(k) ?? 0) - kv.share))
      }
      continue
    }
    const share = shares.get(c.id) ?? 0
    if (share > 0 && sourcePending) {
      sourcePending.set(c.itemId, Math.max(0, (sourcePending.get(c.itemId) ?? 0) - share))
    }
  }

  for (const c of active) {
    const offer = available.get(c.id) ?? 0
    const rate = delivered.get(c.id) ?? 0
    const info = ctx.requests.get(c.id)
    const perKey = keyed.get(c.id)
    const importsItem = (stillImported.get(c.itemId) ?? 0) > FLOW_TOLERANCE
    let limited: boolean
    let parts: ConnectionPart[] | undefined
    if (perKey) {
      // Limited: the block still imports a range one of the connection's offered keys fits and that key is used up, or the
      // connection's own limit is used up while it still imports the fluid.
      const wanted = result.unsatisfied.filter(u => u.itemId === c.itemId && u.temp !== undefined && !isTemperatureTag(u.temp) && u.rate > FLOW_TOLERANCE)
      const got = deliveredKeys.get(c.id)!
      limited = duplicates.has(c.id) ? false
        : wanted.some(u => [...perKey].some(([k, kv]) => {
            const cap = c.maxRate === undefined ? kv.offer : Math.min(kv.offer, c.maxRate)
            const tag = parseFlowKey(k).tag
            return tag !== undefined && cap > FLOW_TOLERANCE && fitsRange(tag, u.temp as FluidRange) && (got.get(k) ?? 0) >= cap - surplusTolerance(cap)
          }))
          || (importsItem && c.maxRate !== undefined && rate >= c.maxRate - surplusTolerance(c.maxRate))
      parts = []
      const asked = info && 'requested' in info ? info.parts : undefined
      for (const k of new Set([...perKey.keys(), ...got.keys(), ...(asked?.keys() ?? [])])) {
        const tag = parseFlowKey(k).tag
        if (!tag) continue
        const kv = perKey.get(k)
        const cap = kv === undefined ? 0 : c.maxRate === undefined ? kv.offer : Math.min(kv.offer, c.maxRate)
        const r = got.get(k) ?? 0
        const requested = asked?.get(k)
        if (r <= FLOW_TOLERANCE && cap <= FLOW_TOLERANCE && !(requested !== undefined && requested > FLOW_TOLERANCE)) continue
        parts.push({ temp: tag, rate: r, available: cap, ...(info && 'requested' in info ? { requested: requested ?? 0 } : {}) })
      }
      parts.sort((x, y) => compareTags(x.temp, y.temp))
    } else {
      limited = importsItem && rate >= offer - surplusTolerance(offer)
    }
    const status: ConnectionFlowStatus =
      duplicates.has(c.id) ? 'unused'
      : limited ? 'limited'
      : rate <= FLOW_TOLERANCE ? 'unused'
      : 'ok'
    flows.push({
      connectionId: c.id,
      fromBlockId: c.fromBlockId,
      toBlockId: block.id,
      itemId: c.itemId,
      available: offer,
      capped: capped.has(c.id),
      rate,
      status,
      kind: info && 'requested' in info ? 'request' : 'take',
      ...(ctx.loopConnectionIds.has(c.id) ? { loop: true as const } : {}),
      ...(info && 'requested' in info ? { requested: info.requested } : {}),
      ...(info && 'ignored' in info ? { requestIgnored: info.ignored } : {}),
      ...(parts ? { parts } : {}),
    })
  }

  const { offers, netOffers } = offersOf(result.nodes, result.conversions)
  return { result, error, flows, offers, netOffers }
}

/** Equal within a relative `FLOW_TOLERANCE`. */
function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOW_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Did every (source, item) pair carried by a back connection keep its offer between two rounds? */
export function backOffersSettled(
  loop: LoopShape,
  members: Block[],
  prev: Map<string, BlockStep['netOffers']>,
  next: Map<string, BlockStep['netOffers']>,
): boolean {
  const back = new Set(loop.backConnectionIds)
  for (const b of members) {
    for (const c of b.inputConnections) {
      if (!back.has(c.id)) continue
      // Every key of the item (a split fluid's offer is per temperature and range): the loops converge per key.
      const prevOffers = prev.get(c.fromBlockId)
      const nextOffers = next.get(c.fromBlockId)
      for (const k of new Set([...keysOfItem(prevOffers ?? new Map(), c.itemId), ...keysOfItem(nextOffers ?? new Map(), c.itemId)])) {
        const before = prevOffers?.get(k)?.net ?? 0
        const after = nextOffers?.get(k)
        // Equal as rates, or both within the noise of the flow (an offer that rounds to nothing).
        if (!sameRate(before, after?.net ?? 0) && Math.abs(before - (after?.net ?? 0)) > (after?.tol ?? 0)) return false
      }
    }
  }
  return true
}

const extraWarningCopies = new WeakMap<SolverResult, { key: string; result: SolverResult }>()

/**
 * `result` plus warnings, on a copy (cached results are never mutated). The copy is
 * memoised per result object, so warnings that stay the same keep result identity
 * between solves as long as the cached results do.
 */
function withExtraWarnings(result: SolverResult, list: SolverWarning[]): SolverResult {
  if (list.length === 0) return result
  const key = JSON.stringify(list)
  const hit = extraWarningCopies.get(result)
  if (hit?.key === key) return hit.result
  const copy = { ...result, warnings: [...result.warnings, ...list] }
  extraWarningCopies.set(result, { key, result: copy })
  return copy
}

function cloneRemaining(remaining: Map<string, Offers>): Map<string, Offers> {
  return new Map([...remaining].map(([id, offers]) => [id, new Map(offers)]))
}

// ---------------------------------------------------------------------------
// Requests: request pass
// ---------------------------------------------------------------------------

/**
 * What the request pass decided for one connection to a product of its source. A split fluid is requested per range:
 * `parts` is the amount per range key (they add up to `requested`).
 */
type RequestInfo = { requested: number; parts?: Map<string, number> } | { ignored: RequestIgnoredReason }

/** The amount reserved for a connection while others are served: a request's amount, else the take's credit (0 when none). */
function connectionShare(info: RequestInfo | undefined, credit: number | undefined): number {
  return info && 'requested' in info ? info.requested : (credit ?? 0)
}

/** A split fluid's share of a connection per key: what the request asked per range, else what the take was credited. */
function connectionKeyShares(info: RequestInfo | undefined, creditParts: ReadonlyMap<string, number> | undefined): ReadonlyMap<string, number> | undefined {
  return info && 'requested' in info ? info.parts : creditParts
}

interface RequestPlan {
  /** blockId → the block's goals plus what its consumers request of it; only for blocks that gained some. */
  goals: Map<string, SolverGoal[]>
  /** connection id → decision; absent for connections that take existing output and for ones that never count (missing source, self). */
  info: Map<string, RequestInfo>
  /** take connection id → items/min its source's leftover covers of the consumer's need; only takes credited more than 0. */
  credits: Map<string, number>
  /** One entry per cycle of requests: `rounds` are demand rounds, `converged` whether the demand settled. */
  loops: BlockLoop[]
  /** take connection id → items/min of its consumer's need still uncovered when the take was reached (only takes the pass reached). */
  needs: Map<string, number>
  /** take connection ids the request pass reached before it could credit them (see `ServedConsumer.notCredited`). */
  uncredited: Set<string>
  /** take connection ids of the groups of takes the pass served in list order, not by need (see `ServedConsumer.groupInListOrder`). */
  inListOrder: Set<string>
  /** block id → item id → the block's areas that need the item from outside (its request probe, table order); only for probed blocks with areas. */
  areaNeeds: Map<string, AreaNeeds>
  /** split fluid: take connection id → flow key → what the take was credited (the parts of `credits`). */
  creditParts: Map<string, Map<string, number>>
  /** split fluid: a ranked pair's allocation: entry index (of `splitByArea(listed)`) → key → amount, and the extra's amount per key. */
  splitAlloc: Map<RankedPair, { entryKeys: Map<number, Map<string, number>>; extra: Map<string, number> }>
}

/** Items the block connects to existing, non-self sources, each with unlimited supply (a request probe). */
function connectedCaps(block: Block, byId: Map<string, Block>, selfConnectionIds: Set<string>): Map<string, number> {
  const caps = new Map<string, number>()
  for (const c of block.inputConnections) {
    if (byId.has(c.fromBlockId) && !selfConnectionIds.has(c.id)) caps.set(c.itemId, Infinity)
  }
  return caps
}

/**
 * Solve a block with the given goals and `caps`: what it would import (`received`) and its solved
 * nodes. Empty when there is nothing to solve; `failed` when the solver throws (the supply solve
 * reports the error, so a failing block asks for nothing). `cache` is the solve cache, or a memo
 * (block id + plan key → probe) for probes whose caps never change for a block.
 */
function probeBlock(
  block: Block,
  goals: SolverGoal[],
  gameData: GameData,
  caps: Map<string, number>,
  cache?: SolveCache | Map<string, Probe>,
): Probe {
  const plan = { ...flattenBlock(block), goals }
  if (plan.goals.length === 0 || plan.nodes.length === 0) return { received: new Map(), nodes: [], failed: false }
  const key = cache ? planKey(plan) : ''
  if (cache instanceof Map) {
    const memoKey = `${block.id}\0${key}`
    let probe = cache.get(memoKey)
    if (!probe) {
      probe = probeBlock(block, goals, gameData, caps)
      cache.set(memoKey, probe)
    }
    return probe
  }
  const hit = cache?.get(block.id, gameData, key, caps)
  if (hit) return { received: hit.receivedKeys ?? hit.received, nodes: hit.result.nodes, conversions: hit.result.conversions, failed: false, areaNeeds: areaNeedsOf(hit.result.areaRoutes), areaKeyNeeds: areaKeyNeedsOf(hit.result.areaRoutes) }
  try {
    const solved = solveBlock(plan, gameData, caps)
    cache?.set(block.id, gameData, key, caps, solved)
    return { received: solved.receivedKeys, nodes: solved.result.nodes, conversions: solved.result.conversions, failed: false, areaNeeds: areaNeedsOf(solved.result.areaRoutes), areaKeyNeeds: areaKeyNeedsOf(solved.result.areaRoutes) }
  } catch {
    cache?.delete(block.id)
    return { received: new Map(), nodes: [], failed: true }
  }
}

interface Probe {
  /** items/min the block would import, per flow key (the item id for a plain item; a split fluid: per range it takes) */
  received: Map<string, number>
  nodes: SolvedNode[]
  conversions?: FluidConversion[]
  failed: boolean
  /** The block's areas that need each item from outside; defined iff the block has areas (see `areaNeedsOf`). */
  areaNeeds?: AreaNeeds
  /** A split fluid: item id → area id → range key → what the area takes of it from outside; defined iff the block has areas. */
  areaKeyNeeds?: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>
}

/** What `applyTakeCredits` needs to credit the takes of a split fluid. */
interface SplitCredit {
  items: ReadonlySet<string>
  ranges: ReadonlyMap<string, FluidRange[]>
  /** take connection id → the flow keys it was credited (the parts of `credits`) */
  creditParts: Map<string, Map<string, number>>
  /** The credit of a take of a ranked pair (the list's allocation, or the take alone from what the entries above left); `null` when its ledger is not final yet (blocked). */
  rankedCredit?: (take: BlockConnection, itemId: string, needed: Map<string, number>) => { parts: Map<string, number>; covered: Map<string, number> } | null | undefined
}

/** The keys of `itemId` of a per-key map, as the allocator takes them: offers with their tags and versatility. */
function allocKeysOfMap(itemId: string, offers: ReadonlyMap<string, number> | undefined, ranges: readonly FluidRange[]): AllocKey[] {
  const out: AllocKey[] = []
  for (const k of keysOfItem(offers ?? new Map(), itemId)) {
    const tag = parseFlowKey(k).tag
    const offer = offers?.get(k) ?? 0
    if (tag !== undefined && offer > 0) out.push({ key: k, tag, offer, versatility: versatility(tag, ranges) })
  }
  return out
}

/** The ranges a consumer still needs of `itemId` (`needed` is per key), as the allocator takes them. */
function rangeNeedsOf(itemId: string, needed: ReadonlyMap<string, number>): { range: FluidRange; rate: number }[] {
  const out: { range: FluidRange; rate: number }[] = []
  for (const k of keysOfItem(needed, itemId)) {
    const tag = parseFlowKey(k).tag
    const rate = needed.get(k) ?? 0
    if (tag !== undefined && !isTemperatureTag(tag) && rate > 0) out.push({ range: tag, rate })
  }
  return out
}

/** A take alone: the source's keys on offer allocated to the ranges the consumer still needs, up to its limit. */
function creditAlone(itemId: string, take: BlockConnection, offers: ReadonlyMap<string, number> | undefined, needed: ReadonlyMap<string, number>, ranges: readonly FluidRange[]) {
  const alloc = allocateKeys(itemId, allocKeysOfMap(itemId, offers, ranges), [[{ id: take.id, needs: rangeNeedsOf(itemId, needed), cap: take.maxRate, weight: 1 }]])
  return { parts: alloc.grants.get(take.id) ?? new Map<string, number>(), covered: alloc.covered.get(take.id) ?? new Map<string, number>() }
}

/**
 * Let a consumer's takes cover part of what it needs (`needed`, per flow key, reduced in place). Each take in
 * connection order covers min(what its source has left, its limit, the need left), reduces
 * the source's estimate (`estimates`, in place) and is recorded in `credits`. A take of a pair the
 * source's served list ranks gets what `rankedRest` says is left for it instead, and leaves the estimate alone
 * (the ledger of a ranked pair is `credits`, read by `rankedRest`). A split fluid's take covers per key: the source's
 * keys go to the consumer's ranges (a one-member allocation: a key only to a range it fits, the least versatile first), the
 * parts are recorded in `split.creditParts`.
 *
 * A ranked take that is blocked (`rankedRest` or `rankedCredit` says `null`: its source, or a take above it, is not credited yet) is
 * credited 0, unless `defer` accepts it: `defer(itemId, takes, needed)` gets the consumer's takes of the item from the blocked one
 * on and the need still left, keeps them to credit later, and the consumer's takes of that item stop here.
 */
function applyTakeCredits(
  takes: Map<string, BlockConnection[]> | undefined,
  needed: Map<string, number>,
  estimates: Map<string, Offers>,
  credits: Map<string, number>,
  rankedRest?: (take: BlockConnection, itemId: string) => number | null | undefined,
  needs?: Map<string, number>,
  split?: SplitCredit,
  defer?: (itemId: string, rest: BlockConnection[], needed: ReadonlyMap<string, number>) => boolean,
): void {
  for (const [itemId, list] of takes ?? []) {
    if (split?.items.has(itemId)) {
      let need = sumOfItem(needed, itemId)
      for (let i = 0; i < list.length; i++) {
        const t = list[i]
        if (need <= 0) break
        needs?.set(t.id, need) // what is left to cover when this take is reached
        const ranked = split.rankedCredit?.(t, itemId, needed)
        if (ranked === null && defer?.(itemId, list.slice(i), new Map(keysOfItem(needed, itemId).map(k => [k, needed.get(k) ?? 0])))) break
        const credit = ranked === null ? { parts: new Map<string, number>(), covered: new Map<string, number>() } : ranked ?? creditAlone(itemId, t, estimates.get(t.fromBlockId), needed, split.ranges.get(itemId) ?? [])
        let total = 0
        for (const v of credit.parts.values()) total += v
        if (total <= 0) continue
        if (!ranked) {
          const left = estimates.get(t.fromBlockId)!
          for (const [k, v] of credit.parts) left.set(k, (left.get(k) ?? 0) - v)
        }
        credits.set(t.id, total)
        split.creditParts.set(t.id, credit.parts)
        for (const [k, v] of credit.covered) needed.set(k, Math.max(0, (needed.get(k) ?? 0) - v))
        need -= total
      }
      continue
    }
    let need = needed.get(itemId) ?? 0
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (need <= 0) break
      needs?.set(t.id, need) // what is left to cover when this take is reached
      const r = rankedRest?.(t, itemId)
      if (r === null && defer?.(itemId, list.slice(i), new Map([[itemId, need]]))) break
      const left = r === null ? 0 : r ?? estimates.get(t.fromBlockId)?.get(itemId) ?? 0
      const cover = Math.min(left, t.maxRate ?? Infinity, need)
      if (cover <= 0) continue
      if (r === undefined) estimates.get(t.fromBlockId)!.set(itemId, left - cover)
      credits.set(t.id, cover)
      need -= cover
    }
    needed.set(itemId, need)
  }
}

/** What a source with solved `nodes` has left per key (the item id for a plain item) after the amounts requested of it. */
function leftoverEstimate(nodes: SolvedNode[], requestedOfSource: Map<string, number> | undefined, conversions?: FluidConversion[]): Offers {
  const left: Offers = new Map()
  const gross = grossFlow(nodes, conversions)
  for (const [key, net] of netBalance(nodes, conversions)) {
    // A flow key's offer is the positive part of its net (a made temperature that a conversion took has none).
    const rest = (parseFlowKey(key).tag === undefined ? net : Math.max(0, net)) - (requestedOfSource?.get(key) ?? 0)
    if (rest > surplusTolerance(gross.get(key) ?? 0)) left.set(key, rest)
  }
  return left
}

/**
 * How much each source must make for its requesting consumers. A consumer's need
 * for an item does not depend on what it receives (solving it with unlimited
 * supply on every connection, a "request probe", gives exactly what it would import; a
 * connections-first item's need is its use minus what the block's rows already make of it, as the probe's supply is unlimited; a
 * byproducts-first item's need is what recipes that run anyway don't cover),
 * and a source's goals only depend on its own products plus what its consumers
 * request of it. So requests are computed before any supply is handed out, consumers first.
 *
 * Takes before requests: a consumer that takes an item it also requests asks only for what its
 * takes will not cover, and what a take is credited is reserved for it at its source like a
 * request share. The estimate of a take source is what it has left after the amounts
 * requested of it; sources are processed before their take consumers where the request order
 * allows it. A takes-first take whose source is not processed yet gets no credit; a take of a consumer
 * that requests nothing of the item waits for its source instead (`deferFor`, `resolveDeferred`): that
 * credit feeds no request, so it can be given later, once its source and the takes above it are done.
 *
 * A pair the source's served list ranks (`ranked`; see `rankedPairs`) is credited by rank: a listed
 * take is credited what is left of the source's estimate after the extra (when listed above it) and
 * the credits of the takes above it, so a take that requests nothing is probed too, and the listed
 * consumers are ordered by extra edges (never one that would close a cycle). A listed take of a consumer that requests nothing of
 * the item, whose source or higher-ranked takes are not credited yet (the request order reached it first), is parked and credited once they
 * are; a takes-first take in that position gets no credit and is flagged. Takes-first consumers the
 * list does not name are credited after the listed ones. The takes of a `tied` group are credited together, by need, when the first
 * member is reached (`creditGroups`: the other members are probed ahead, the source's leftover is water-filled by weight; readiness
 * edges put the blocks that request of a member before the members), unless the pass cannot know every need in time, or a consumer of
 * the pair is in a cycle of requests, or a member does not take the item first: such a group is credited in list order and granted in
 * list order, and its takes are flagged (`RequestPlan.inListOrder`).
 *
 * Cycles of requests are solved in demand rounds: members in order (consumers first), each probed
 * with its products plus what the other members requested of it, a request that closes the cycle
 * reading the previous round's amount (0 in round 1). A geometric extrapolation step on those
 * amounts speeds up a settling cycle and the demand is cut after `roundLimit` rounds or when it
 * keeps growing for `REQUEST_GROWTH_ROUNDS` rounds. A cycle that does not settle is solved for
 * round 1 again with the requests that close it taking existing output (`request-loop`), so a
 * member's other requests share its whole need.
 *
 * Ranked pairs inside a cycle: members are credited by rank in each round. A member's ranked take whose higher-ranked
 * take belongs to a later member reads that member's previous-round credit (a back credit, 0 in round 1) and joins the
 * back requests in the settle test and the extrapolation. A cycle's member order comes from the graph before the
 * lists' edges are added (`unrankedShapes`): a list only changes who is served. The memo key holds the lists
 * of the pairs the members take from and the credits of their takes outside the cycle (and whether one is parked). A take of
 * a member source reads that source's leftover estimate: of the same round when the source comes first in member order, else of the
 * previous round (a back estimate, which joins the back requests in the round's input and output and is absent in the final round of a
 * cycle that does not settle: those takes get no credit there).
 */
function computeRequests(
  blocks: Block[],
  gameData: GameData,
  selfConnectionIds: Set<string>,
  cache: SolveCache | undefined,
  roundLimit: number,
  ranked: RankedPairs,
  ranges: ReadonlyMap<string, FluidRange[]>,
): RequestPlan {
  const split = splitFluids(gameData)
  const creditParts = new Map<string, Map<string, number>>()
  const splitAlloc: RequestPlan['splitAlloc'] = new Map()
  const byId = new Map(blocks.map(b => [b.id, b]))
  const blockIds = new Set(byId.keys())
  const info = new Map<string, RequestInfo>()
  const credits = new Map<string, number>()
  const goals = new Map<string, SolverGoal[]>()
  const loops: BlockLoop[] = []

  // Candidates: requests that count, in plan order.
  const applicable: { consumer: Block; connection: BlockConnection }[] = []
  for (const consumer of blocks) {
    const seen = new Set<string>()
    for (const c of consumer.inputConnections) {
      const source = byId.get(c.fromBlockId)
      if (!source || selfConnectionIds.has(c.id)) continue
      const key = `${c.fromBlockId}\0${c.itemId}`
      const duplicate = seen.has(key)
      seen.add(key)
      if (!hasProduct(source, c.itemId)) continue
      if (duplicate) {
        info.set(c.id, { ignored: 'duplicate' })
        continue
      }
      if (receivesItem(source, c.itemId, blockIds)) info.set(c.id, { ignored: 'source-receives' })
      else applicable.push({ consumer, connection: c })
    }
  }
  if (applicable.length === 0 && ranked.size === 0) return { goals, info, credits, loops, needs: new Map(), uncredited: new Set(), inListOrder: new Set(), areaNeeds: new Map(), creditParts, splitAlloc }

  const requestsOf = new Map<string, BlockConnection[]>() // consumer id → applied requests, in connection order
  for (const { consumer, connection } of applicable) {
    const list = requestsOf.get(consumer.id) ?? []
    list.push(connection)
    requestsOf.set(consumer.id, list)
  }
  const requestersOf = new Map<string, string[]>() // source id → consumers with an applied request to it
  for (const { consumer, connection } of applicable) requestersOf.set(connection.fromBlockId, [...(requestersOf.get(connection.fromBlockId) ?? []), consumer.id])

  // Takes that can cover a request: an existing source's first connection for its (source, item)
  // pair that is not a request, for an item the consumer also requests.
  const applicableIds = new Set(applicable.map(a => a.connection.id))
  const takeOf = new Map<string, Map<string, BlockConnection[]>>() // consumer id → item id → takes, in connection order
  for (const consumer of blocks) {
    const requestedItems = new Set((requestsOf.get(consumer.id) ?? []).map(c => c.itemId))
    if (requestedItems.size === 0) continue
    const seen = new Set<string>()
    for (const c of consumer.inputConnections) {
      if (!byId.has(c.fromBlockId) || selfConnectionIds.has(c.id)) continue
      const key = `${c.fromBlockId}\0${c.itemId}`
      const duplicate = seen.has(key)
      seen.add(key)
      if (duplicate || applicableIds.has(c.id) || !requestedItems.has(c.itemId)) continue
      const items = takeOf.get(consumer.id) ?? new Map<string, BlockConnection[]>()
      items.set(c.itemId, [...(items.get(c.itemId) ?? []), c])
      takeOf.set(consumer.id, items)
    }
  }

  // Takes of ranked pairs. A listed block entry whose connection is not a request is a ranked take, at its
  // position in the list; a consumer the list does not name that takes the item first (it also requests it) is
  // credited after the listed ones, at position -1. `rankedTakeOf` holds the listed takes of consumers that
  // request nothing of the item (probed for them).
  const rankedTake = new Map<string, { pair: RankedPair; position: number }>() // connection id →
  const rankedTakeOf = new Map<string, Map<string, BlockConnection[]>>()      // consumer id → item id → takes, in list order
  for (const items of ranked.values()) {
    for (const pair of items.values()) {
      pair.listed.forEach((e, position) => {
        if (e.kind !== 'block' || applicableIds.has(e.connection.id)) return
        if (rankedTake.has(e.connection.id)) return // a consumer with several entries: the first, best-ranked one keeps the position
        rankedTake.set(e.connection.id, { pair, position })
        if (takeOf.get(e.blockId)?.has(pair.itemId)) return
        const byItem = rankedTakeOf.get(e.blockId) ?? new Map<string, BlockConnection[]>()
        if (byItem.has(pair.itemId)) return
        // All the consumer's takes of the item, in connection order: its other sources come out of its need in
        // that order, as they do at supply, so a ranked take does not hide what an earlier one still covers.
        const consumer = byId.get(e.blockId)!
        const seen = new Set<string>()
        const takes: BlockConnection[] = []
        for (const c of consumer.inputConnections) {
          if (c.itemId !== pair.itemId || !byId.has(c.fromBlockId) || selfConnectionIds.has(c.id)) continue
          if (seen.has(c.fromBlockId)) continue
          seen.add(c.fromBlockId)
          if (!applicableIds.has(c.id)) takes.push(c)
        }
        byItem.set(pair.itemId, takes)
        rankedTakeOf.set(e.blockId, byItem)
      })
      for (const u of pair.unlisted) {
        if (u.areaNamed || applicableIds.has(u.connection.id) || !takeOf.get(u.blockId)?.has(pair.itemId)) continue
        rankedTake.set(u.connection.id, { pair, position: -1 })
      }
    }
  }
  const takesCache = new Map<string, Map<string, BlockConnection[]> | undefined>()
  const takesOf = (id: string): Map<string, BlockConnection[]> | undefined => {
    if (takesCache.has(id)) return takesCache.get(id)
    const own = rankedTakeOf.get(id)
    const takes = own ? new Map([...(takeOf.get(id) ?? []), ...own]) : takeOf.get(id)
    takesCache.set(id, takes)
    return takes
  }

  // Groups of takes: a `tied` group of a ranked pair with a take in it. The first member the pass reaches credits the whole
  // group at once, by need (`creditGroups`); a group the pass cannot share that way is served in list order (D7, `toListOrder`).
  // A list without `tied` makes no group, so none of the code for groups runs.
  interface TakeGroup {
    pair: RankedPair
    start: number
    end: number // listed indices [start, end)
    /** The take connections whose first entry is in [start, end), in list order; the weight sums the weights of the member's entries in the group. */
    members: { connection: BlockConnection; blockId: string; weight: number }[]
    extra?: { weight: number } // the extra, when it is in the group
    status: 'pending' | 'shared' | 'listOrder'
    credit?: Map<string, number> // shared: connection id → credit
    held?: number // shared: the credits and what the extra holds, in all
  }
  const takeGroups: TakeGroup[] = []
  const sharedAt = new Map<RankedPair, Map<number, TakeGroup>>() // pair → start index → group
  const groupOfTake = new Map<string, TakeGroup>() // member connection id → its group
  const groupsOfBlock = new Map<string, TakeGroup[]>() // member block id → its groups
  const inListOrder = new Set<string>() // member connections of the groups served in list order
  for (const items of ranked.values()) {
    for (const pair of items.values()) {
      if (split.has(pair.itemId)) continue // a split fluid's list is allocated per key (`splitPairs`)
      for (const [start, end] of servedGroupSpans(pair.listed)) {
        if (end - start < 2) continue
        const byConnection = new Map<string, TakeGroup['members'][number]>()
        let extra: TakeGroup['extra']
        for (let i = start; i < end; i++) {
          const e = pair.listed[i]
          if (e.kind === 'extra') {
            extra = { weight: e.weight ?? 1 }
            continue
          }
          const at = rankedTake.get(e.connection.id)
          if (!at || at.pair !== pair || at.position < start || at.position >= end) continue // a request, or credited at an earlier entry
          const member = byConnection.get(e.connection.id)
          if (member) member.weight += e.weight ?? 1
          else byConnection.set(e.connection.id, { connection: e.connection, blockId: e.blockId, weight: e.weight ?? 1 })
        }
        if (byConnection.size === 0) continue // a group of requests: the request pass reads no weights
        const group: TakeGroup = { pair, start, end, members: [...byConnection.values()], ...(extra ? { extra } : {}), status: 'pending' }
        takeGroups.push(group)
        const byStart = sharedAt.get(pair) ?? new Map<number, TakeGroup>()
        byStart.set(start, group)
        sharedAt.set(pair, byStart)
        for (const m of group.members) groupOfTake.set(m.connection.id, group)
      }
    }
  }
  const toListOrder = (g: TakeGroup): void => {
    g.status = 'listOrder'
    for (const m of g.members) inListOrder.add(m.connection.id)
  }

  // A split fluid's ranked pair: its takes are credited from one allocation of the source's keys to the consumers' ranges (`creditSplitPairs`),
  // when the request pass reaches the first listed take and every need is final; else in list order (`splitToListOrder`), each listed take
  // allocated alone from what the entries above it left, per key.
  interface SplitPair {
    pair: RankedPair
    status: 'pending' | 'shared' | 'listOrder'
    /** the consumers with a listed take, in list order */
    members: { connection: BlockConnection; blockId: string }[]
    /** shared: member id (a connection id, or 'extra') → key → amount */
    grants?: Map<string, Map<string, number>>
    /** shared: member id → range key → need met */
    covered?: Map<string, Map<string, number>>
    /** shared: key → what the list holds in all */
    held?: Map<string, number>
  }
  const splitPairs = new Map<RankedPair, SplitPair>()
  const splitPairsOf = new Map<string, SplitPair[]>() // block id → the pairs it has a listed take in
  for (const items of ranked.values()) {
    for (const pair of items.values()) {
      if (!split.has(pair.itemId)) continue
      const members: SplitPair['members'] = []
      for (const e of pair.listed) {
        if (e.kind === 'block' && rankedTake.get(e.connection.id)?.pair === pair && !members.some(m => m.connection.id === e.connection.id)) {
          members.push({ connection: e.connection, blockId: e.blockId })
        }
      }
      if (members.length === 0) continue
      const sp: SplitPair = { pair, status: 'pending', members }
      splitPairs.set(pair, sp)
      for (const m of members) splitPairsOf.set(m.blockId, [...(splitPairsOf.get(m.blockId) ?? []), sp])
    }
  }
  const splitToListOrder = (sp: SplitPair): void => {
    sp.status = 'listOrder'
    for (const [start, end] of servedGroupSpans(sp.pair.listed)) {
      if (end - start < 2) continue
      for (let i = start; i < end; i++) {
        const e = sp.pair.listed[i]
        if (e.kind === 'block' && rankedTake.has(e.connection.id)) inListOrder.add(e.connection.id)
      }
    }
  }

  // Order consumers before sources: orderBlocks puts sources first, so feed it the reversed requests.
  // A take source goes before its take consumer unless the consumer already reaches it.
  const reversed = new Map<string, BlockConnection[]>()
  for (const { consumer, connection } of applicable) {
    const list = reversed.get(connection.fromBlockId) ?? []
    list.push({ id: connection.id, itemId: connection.itemId, fromBlockId: consumer.id })
    reversed.set(connection.fromBlockId, list)
  }
  const depBlocks = blocks.map(b => ({ ...b, inputConnections: [...(reversed.get(b.id) ?? [])] }))
  const depConsumers = consumersOf(depBlocks) // kept up to date as take edges are added
  const takeSources = new Set<string>()
  for (const dep of depBlocks) {
    for (const [itemId, takes] of takeOf.get(dep.id) ?? []) {
      for (const t of takes) {
        if (reaches(depConsumers, dep.id, t.fromBlockId)) continue // the edge would close a loop
        dep.inputConnections.push({ id: `take\0${t.id}`, itemId, fromBlockId: t.fromBlockId })
        depConsumers.set(t.fromBlockId, [...(depConsumers.get(t.fromBlockId) ?? []), dep.id])
        takeSources.add(t.fromBlockId)
      }
    }
  }
  const listEdges = new Set<BlockConnection>() // the edges a served list adds below
  const depById = new Map(depBlocks.map(b => [b.id, b]))
  // A take-only consumer's other sources of a ranked item (see `rankedTakeOf`) are processed before it too.
  for (const [consumerId, items] of rankedTakeOf) {
    for (const [itemId, takes] of items) {
      for (const t of takes) {
        if (rankedTake.has(t.id) || reaches(depConsumers, consumerId, t.fromBlockId)) continue
        const edge = { id: `take\0${t.id}`, itemId, fromBlockId: t.fromBlockId }
        listEdges.add(edge)
        depById.get(consumerId)!.inputConnections.push(edge)
        depConsumers.set(t.fromBlockId, [...(depConsumers.get(t.fromBlockId) ?? []), consumerId])
        takeSources.add(t.fromBlockId)
      }
    }
  }
  // Ranked pairs: the source before its listed takes, the listed takes in rank order, the listed takes before the
  // takes-first consumers the list does not name. An edge that would close a cycle is left out.
  const orderEdge = (from: string, to: string, itemId: string, id: string): void => {
    if (reaches(depConsumers, from, to) || reaches(depConsumers, to, from)) return
    const edge = { id, itemId, fromBlockId: from }
    listEdges.add(edge)
    depById.get(to)!.inputConnections.push(edge)
    depConsumers.set(from, [...(depConsumers.get(from) ?? []), to])
  }
  if (takeGroups.length > 0 || splitPairs.size > 0) {
    // Static fallback. Every edge so far is guarded, so the cycles of `depBlocks` are the cycles of requests.
    const inCycle = new Set(orderBlocks(depBlocks).components.flatMap(c => (c.loop ? c.loop.blockIds : [])))
    for (const g of takeGroups) {
      const consumers = [...g.pair.listed.flatMap(e => (e.kind === 'block' ? [e.blockId] : [])), ...g.pair.unlisted.map(u => u.blockId)]
      // F1: a consumer of the pair is in a cycle of requests (the demand rounds read the list in order).
      // F2: a member's group take is not its first take of the item, so its need depends on the credits of its other sources.
      // F4: a member's connection has entries below the group (another group, or alone): its demand is the whole connection's need, so the
      // group would credit it for the areas ranked below it too.
      const below = (m: TakeGroup['members'][number]): boolean =>
        g.pair.listed.some((e, i) => e.kind === 'block' && e.connection.id === m.connection.id && (i < g.start || i >= g.end))
      if (
        consumers.some(id => inCycle.has(id)) ||
        g.members.some(m => takesOf(m.blockId)?.get(g.pair.itemId)?.[0]?.id !== m.connection.id || below(m))
      ) toListOrder(g)
      else for (const m of g.members) groupsOfBlock.set(m.blockId, [...(groupsOfBlock.get(m.blockId) ?? []), g])
    }
    // The same three conditions for a split fluid's list: with any of them its takes are credited in list order.
    for (const sp of splitPairs.values()) {
      const { pair } = sp
      const consumers = [...pair.listed.flatMap(e => (e.kind === 'block' ? [e.blockId] : [])), ...pair.unlisted.map(u => u.blockId)]
      const spread = (m: SplitPair['members'][number]): boolean => {
        const spans = servedGroupSpans(pair.listed)
        const inSpan = (i: number) => spans.findIndex(([a, b]) => i >= a && i < b)
        const mine = pair.listed.flatMap((e, i) => (e.kind === 'block' && e.connection.id === m.connection.id ? [inSpan(i)] : []))
        return new Set(mine).size > 1
      }
      if (
        consumers.some(id => inCycle.has(id)) ||
        sp.members.some(m => takesOf(m.blockId)?.get(pair.itemId)?.[0]?.id !== m.connection.id || spread(m))
      ) splitToListOrder(sp)
    }
  }
  for (const [sourceId, items] of ranked) {
    for (const pair of items.values()) {
      // A consumer with several entries gets several edges: the later ones are skipped by `orderEdge` (it never links a block to itself,
      // and an edge already present makes `reaches` true).
      const listedTakes = pair.listed.filter((e): e is Extract<RankedEntry, { kind: 'block' }> => e.kind === 'block' && rankedTake.has(e.connection.id))
      const unlistedTakes = pair.unlisted.filter(u => rankedTake.has(u.connection.id))
      if (listedTakes.length + unlistedTakes.length > 0) takeSources.add(sourceId)
      listedTakes.forEach((h, i) => {
        orderEdge(sourceId, h.blockId, pair.itemId, `rank\0source\0${h.connection.id}`)
        for (const later of listedTakes.slice(i + 1)) orderEdge(h.blockId, later.blockId, pair.itemId, `rank\0${h.connection.id}\0${later.connection.id}`)
        for (const u of unlistedTakes) orderEdge(h.blockId, u.blockId, pair.itemId, `rank\0${h.connection.id}\0${u.connection.id}`)
      })
    }
  }
  if (takeGroups.length > 0) {
    // Readiness: a member's need is known once the blocks that request of it are processed, so those go before the other members. After all
    // the rank edges, so an edge refused here (it falls back to list order, see `creditGroups`) never takes a place from a list's own edge.
    for (const g of takeGroups) {
      if (g.status !== 'pending') continue
      for (const mj of g.members) {
        for (const r of requestersOf.get(mj.blockId) ?? []) {
          for (const mi of g.members) if (mi.blockId !== mj.blockId) orderEdge(r, mi.blockId, g.pair.itemId, `group\0${r}\0${mi.connection.id}`)
        }
      }
    }
  }
  // The same for a split fluid's list: every need is known once the blocks that request of a member are processed.
  for (const sp of splitPairs.values()) {
    if (sp.status !== 'pending') continue
    for (const mj of sp.members) {
      for (const r of requestersOf.get(mj.blockId) ?? []) {
        for (const mi of sp.members) if (mi.blockId !== mj.blockId) orderEdge(r, mi.blockId, sp.pair.itemId, `split\0${r}\0${mi.connection.id}`)
      }
    }
  }
  const { components } = orderBlocks(depBlocks)
  // Cycle shapes before a served list adds edges: those edges could make another member the entry, and a list never
  // changes member order. Those edges never close or merge a cycle, so with no cycle (or no edge) there is nothing to redo.
  // Keyed by the first member: a block is in one cycle at most.
  let unrankedShapes: Map<string, LoopShape> | undefined
  const shapeOf = (loop: LoopShape): LoopShape => {
    if (listEdges.size === 0) return loop
    unrankedShapes ??= new Map(
      orderBlocks(depBlocks.map(b => ({ ...b, inputConnections: b.inputConnections.filter(c => !listEdges.has(c)) }))).components
        .flatMap(c => (c.loop ? c.loop.blockIds.map(id => [id, c.loop!] as const) : [])),
    )
    return unrankedShapes.get(loop.blockIds[0]) ?? loop
  }

  const requested = new Map<string, Map<string, number>>() // source id → flow key (the item id for a plain item) → items/min
  const estimates = new Map<string, Offers>() // processed take source id → flow key → leftover items/min
  const addRequest = (c: BlockConnection, share: number, parts?: ReadonlyMap<string, number>): void => {
    if (share <= 0) return
    const items = requested.get(c.fromBlockId) ?? new Map<string, number>()
    if (parts) for (const [k, v] of parts) items.set(k, (items.get(k) ?? 0) + v)
    else items.set(c.itemId, (items.get(c.itemId) ?? 0) + share)
    requested.set(c.fromBlockId, items)
  }
  // Hand out `needed` over a block's requests in connection order; `share(c, amount, parts)` receives each. A split fluid's request
  // takes every range the block needs of it, the deepest (narrowest) first, then by key, up to its limit; `parts` is the amount per range.
  const shareOut = (requests: BlockConnection[], needed: Map<string, number>, share: (c: BlockConnection, amount: number, parts?: Map<string, number>) => void): void => {
    for (const c of requests) {
      if (split.has(c.itemId)) {
        const rs = ranges.get(c.itemId) ?? []
        const depth = (k: string) => rangeDepth((parseFlowKey(k).tag ?? {}) as FluidRange, rs)
        const keys = keysOfItem(needed, c.itemId).filter(k => (needed.get(k) ?? 0) > 0).sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0))
        let room = c.maxRate ?? Infinity
        let total = 0
        const parts = new Map<string, number>()
        for (const k of keys) {
          const amount = Math.min(needed.get(k) ?? 0, room)
          if (amount <= 0) continue
          needed.set(k, (needed.get(k) ?? 0) - amount)
          room -= amount
          total += amount
          parts.set(k, amount)
        }
        share(c, total, parts)
        continue
      }
      const left = needed.get(c.itemId) ?? 0
      const amount = c.maxRate === undefined ? left : Math.min(left, c.maxRate)
      needed.set(c.itemId, left - amount)
      share(c, amount)
    }
  }
  // Blocks whose takes have been credited so far, and what is left of a ranked take's source for it:
  // the source's leftover estimate less the extra (when listed above it) and the credits of the takes above it.
  const processed = new Set<string>()
  // `creditOf`: the credit of a higher-ranked take of `blockId`, or undefined when it is not credited yet;
  // `listed` is false for a takes-first consumer the list does not name.
  type CreditOf = (blockId: string, connectionId: string, listed: boolean) => number | undefined
  // What is left of a ranked pair's source at list index `end` (the takes-first consumers the list does not name, when `unlisted`, come
  // after all of it): the source's leftover estimate less the extra (when listed above) and the credits of the takes above. A group
  // shared by need counts once, for what it holds in all. Undefined when the request pass is not done with the source (or a higher
  // take, or a group above) yet; 0 when the source has nothing left.
  const restAt = (pair: RankedPair, itemId: string, end: number, unlisted: boolean, self: string | undefined, est: Map<string, Offers>, creditOf: CreditOf): number | undefined => {
    const offers = est.get(pair.sourceId)
    if (offers === undefined) return undefined // the source is not processed yet, or in the same cycle of requests
    const left = offers.get(itemId)
    if (left === undefined) return 0 // the source has nothing left
    let rest = left
    const counted = new Set<string>() // a consumer with several entries is credited once
    for (let i = 0; i < end; i++) {
      const g = sharedAt.get(pair)?.get(i)
      if (g && g.status !== 'listOrder') { // a group of takes shared by need: what it holds in all
        if (g.status === 'pending') return undefined
        rest -= g.held!
        for (const m of g.members) counted.add(m.connection.id)
        i = g.end - 1
        continue
      }
      const e = pair.listed[i]
      if (e.kind === 'extra') {
        rest -= Math.min(pair.extraRate, Math.max(0, rest))
        continue
      }
      if (!rankedTake.has(e.connection.id) || counted.has(e.connection.id)) continue // a request: its share is not in the leftover
      counted.add(e.connection.id)
      const c = creditOf(e.blockId, e.connection.id, true)
      if (c === undefined) return undefined // a higher-ranked take is not credited yet
      rest -= c
    }
    if (unlisted) {
      for (const u of pair.unlisted) {
        if (u.areaNamed || u.connection.id === self || !rankedTake.has(u.connection.id)) continue
        rest -= creditOf(u.blockId, u.connection.id, false) ?? 0
      }
    }
    return Math.max(0, rest)
  }
  // `blocked` collects the takes that are blocked (null) because the request pass is not done with the source (or a higher take) yet.
  const restOf = (t: BlockConnection, itemId: string, est: Map<string, Offers>, creditOf: CreditOf, blocked?: Set<string>): number | null | undefined => {
    const at = rankedTake.get(t.id)
    if (!at) return undefined
    const g = groupOfTake.get(t.id)
    if (g?.status === 'shared') return g.credit!.get(t.id) ?? 0
    // A pending group is never read here: `creditGroups` settles every group of a block before the block reads a take, and a group a cycle
    // reads is served in list order from the start. Should it happen, `restAt` reads the group as not credited yet (blocked), changing no state.
    const r = restAt(at.pair, itemId, at.position < 0 ? at.pair.listed.length : at.position, at.position < 0, t.id, est, creditOf)
    if (r === undefined) {
      blocked?.add(t.id)
      return null
    }
    return r
  }
  const needs = new Map<string, number>()
  const uncredited = new Set<string>()
  // Takes of a take-only consumer that wait for their source (or a take above them): `deferFor` parks them, `resolveDeferred` credits them
  // once they can be. A parked take reads as not credited yet to the takes ranked below it.
  // `held`: what the unranked takes after the blocked one were set aside at their sources, so a consumer processed meanwhile cannot use it up.
  interface Held { sourceId: string; itemId: string; amount: number }
  interface DeferredTake { blockId: string; itemId: string; takes: BlockConnection[]; needed: Map<string, number>; held: Held[] }
  const deferred: DeferredTake[] = []
  const deferredTakes = new Set<string>()
  const deferFor = (blockId: string) => (itemId: string, takes: BlockConnection[], needed: ReadonlyMap<string, number>): boolean => {
    if (takeOf.get(blockId)?.has(itemId)) return false // takes first: the take feeds the consumer's requests, so it cannot wait
    const held: Held[] = []
    if (!split.has(itemId)) {
      let need = needed.get(itemId) ?? 0
      for (const t of takes.slice(1)) {
        if (rankedTake.has(t.id)) continue
        const offers = estimates.get(t.fromBlockId)
        const left = offers?.get(itemId) ?? 0
        const amount = Math.min(left, t.maxRate ?? Infinity, need)
        if (!offers || amount <= 0) continue
        offers.set(itemId, left - amount)
        held.push({ sourceId: t.fromBlockId, itemId, amount })
        need -= amount
      }
    }
    deferred.push({ blockId, itemId, takes, needed: new Map(needed), held })
    for (const t of takes) deferredTakes.add(t.id)
    return true
  }
  const outerCreditOf: CreditOf = (blockId, id) => (processed.has(blockId) && !deferredTakes.has(id) ? (credits.get(id) ?? 0) : undefined)
  const rankedRest = (t: BlockConnection, itemId: string) => restOf(t, itemId, estimates, outerCreditOf, uncredited)
  const estimateTakeSource = (block: Block, probe?: { nodes: SolvedNode[]; conversions?: FluidConversion[] }): void => {
    if (!takeSources.has(block.id)) return
    const solved = probe ?? probeBlock(
      block, productGoals(block.products, requested.get(block.id)), gameData,
      connectedCaps(block, byId, selfConnectionIds), cache,
    )
    estimates.set(block.id, leftoverEstimate(solved.nodes, requested.get(block.id), solved.conversions))
  }

  const areaNeeds = new Map<string, AreaNeeds>()

  // The probe of a member of a group, ahead of its turn: its need is read when the first member is reached. The goals it was solved
  // for are kept: the member's own turn reuses the probe when they are still its goals.
  const ahead = new Map<string, { goals: string; probe: Probe }>()
  const aheadProbe = (id: string): Probe => {
    const b = byId.get(id)!
    const aheadGoals = productGoals(b.products, requested.get(id))
    const kept = ahead.get(id)
    if (kept !== undefined && kept.goals === exactKey(aheadGoals)) return kept.probe // a block in several groups is solved once
    const probe = probeBlock(b, aheadGoals, gameData, connectedCaps(b, byId, selfConnectionIds), cache)
    ahead.set(id, { goals: exactKey(aheadGoals), probe })
    return probe
  }
  // Credit the groups of takes `block` belongs to that are still pending, once, when the first member is reached: every member's
  // credit is then known before any member shares its need out. A group whose members' needs are not all final (a requester of a
  // member, or the source, or the takes above it, are not processed yet) is served in list order instead.
  const creditGroups = (block: Block, probe: Probe): void => {
    for (const g of groupsOfBlock.get(block.id) ?? []) {
      if (g.status !== 'pending') continue
      const rest = restAt(g.pair, g.pair.itemId, g.start, false, undefined, estimates, outerCreditOf)
      const ready = rest !== undefined && g.members.every(m =>
        m.blockId === block.id || (!processed.has(m.blockId) && (requestersOf.get(m.blockId) ?? []).every(r => processed.has(r))))
      if (rest === undefined || !ready) {
        toListOrder(g)
        continue
      }
      const demands = g.members.map(m => Math.min((m.blockId === block.id ? probe : aheadProbe(m.blockId)).received.get(g.pair.itemId) ?? 0, m.connection.maxRate ?? Infinity))
      const weights = g.members.map(m => m.weight)
      if (g.extra) {
        demands.push(g.pair.extraRate)
        weights.push(g.extra.weight)
      }
      const taken = waterFill(rest, demands, weights)
      g.credit = new Map(g.members.map((m, i) => [m.connection.id, Math.min(taken[i], demands[i])])) // clamped: floating-point error
      g.held = [...g.credit.values()].reduce((a, c) => a + c, 0) + (g.extra ? Math.min(taken[taken.length - 1], g.pair.extraRate) : 0)
      g.status = 'shared'
    }
  }

  // A split fluid's list. `creditPartsOf`: what a higher-ranked take of `blockId` was credited per key, or undefined when it is not credited yet.
  type CreditPartsOf = (blockId: string, connectionId: string, listed: boolean) => ReadonlyMap<string, number> | undefined
  // What is left per key of a split pair's source at list index `end` (the takes-first consumers the list does not name, when `unlisted`,
  // come after all of it): the source's leftover estimate less what the entries above hold (the extra allocated alone at its place, the
  // takes at their credits; a list shared by need holds `held` in all). Undefined when the pass is not done with the source or a higher take yet.
  const restKeysAt = (sp: SplitPair, end: number, unlisted: boolean, self: string | undefined, est: Map<string, Offers>, creditPartsOf: CreditPartsOf): Map<string, number> | undefined => {
    const { pair } = sp
    const offers = est.get(pair.sourceId)
    if (offers === undefined) return undefined
    const rest = new Map<string, number>()
    for (const k of keysOfItem(offers, pair.itemId)) rest.set(k, offers.get(k) ?? 0)
    const sub = (parts: ReadonlyMap<string, number>): void => {
      for (const [k, v] of parts) rest.set(k, Math.max(0, (rest.get(k) ?? 0) - v))
    }
    if (sp.status === 'shared') sub(sp.held!)
    else {
      const counted = new Set<string>()
      for (let i = 0; i < end; i++) {
        const e = pair.listed[i]
        if (e.kind === 'extra') {
          // As `grantPair` asks it with no allocation: the extra is the goal on any temperature, held on `item[,]`.
          const any = flowKey(pair.itemId, {})
          if (pair.extraRate > 0) sub(new Map([[any, Math.min(pair.extraRate, rest.get(any) ?? 0)]]))
          continue
        }
        if (!rankedTake.has(e.connection.id) || counted.has(e.connection.id)) continue
        counted.add(e.connection.id)
        const parts = creditPartsOf(e.blockId, e.connection.id, true)
        if (parts === undefined) return undefined // a higher-ranked take is not credited yet
        sub(parts)
      }
    }
    if (unlisted) {
      for (const u of pair.unlisted) {
        if (u.areaNamed || u.connection.id === self || !rankedTake.has(u.connection.id)) continue
        const parts = creditPartsOf(u.blockId, u.connection.id, false)
        if (parts) sub(parts)
      }
    }
    return rest
  }
  // The credit of a ranked take of a split fluid: its part of the list's allocation, or alone from what is left of the source for it.
  // `blocked` collects the takes that get nothing because the pass is not done with the source (or a higher take) yet.
  const splitCreditOf = (t: BlockConnection, itemId: string, needed: Map<string, number>, est: Map<string, Offers>, creditPartsOf: CreditPartsOf, blocked?: Set<string>): { parts: Map<string, number>; covered: Map<string, number> } | null | undefined => {
    const at = rankedTake.get(t.id)
    const sp = at && splitPairs.get(at.pair)
    if (!at || !sp) return undefined
    if (sp.status === 'shared' && at.position >= 0) return { parts: sp.grants!.get(t.id) ?? new Map<string, number>(), covered: sp.covered!.get(t.id) ?? new Map<string, number>() }
    const rest = restKeysAt(sp, at.position < 0 ? at.pair.listed.length : at.position, at.position < 0, t.id, est, creditPartsOf)
    if (rest === undefined) {
      blocked?.add(t.id)
      return null
    }
    return creditAlone(itemId, t, rest, needed, ranges.get(itemId) ?? [])
  }
  const outerCreditPartsOf: CreditPartsOf = (blockId, id) => (processed.has(blockId) && !deferredTakes.has(id) ? (creditParts.get(id) ?? new Map<string, number>()) : undefined)
  const splitCredit: SplitCredit = {
    items: split, ranges, creditParts,
    rankedCredit: (t, itemId, needed) => splitCreditOf(t, itemId, needed, estimates, outerCreditPartsOf, uncredited),
  }
  // Credit the parked takes that can be now, in the order they were parked, until a full pass changes nothing: a take is credited
  // once its source and the takes above it are (the ones above it may be parked too). A slice that parks again at its first take is
  // unchanged; one that parks later has credited the takes before it.
  const unpark = (d: DeferredTake): void => {
    for (const t of d.takes) {
      deferredTakes.delete(t.id)
      uncredited.delete(t.id)
    }
    for (const h of d.held) {
      const offers = estimates.get(h.sourceId)
      offers?.set(h.itemId, (offers.get(h.itemId) ?? 0) + h.amount)
    }
  }
  const resolveDeferred = (last = false): void => {
    for (let progress = true; progress && deferred.length > 0;) {
      progress = false
      for (const d of deferred.splice(0)) {
        unpark(d)
        if (last) { // nothing else will come: credit the take, or flag it, now
          applyTakeCredits(new Map([[d.itemId, d.takes]]), new Map(d.needed), estimates, credits, rankedRest, needs, splitCredit)
          continue
        }
        const before = deferred.length
        applyTakeCredits(new Map([[d.itemId, d.takes]]), new Map(d.needed), estimates, credits, rankedRest, needs, splitCredit, deferFor(d.blockId))
        const again = deferred.length > before ? deferred[deferred.length - 1] : undefined
        if (!again || again.takes.length < d.takes.length) progress = true
      }
    }
  }
  // Allocate the pairs `block` has a listed take in, once, when the first member is reached: the source's keys go to the members' ranges
  // by rank (a group by weight), a key only to a range it fits, then every member's credit is known. A pair whose needs are not all
  // final (the source, or a member's requesters, are not processed yet) is credited in list order instead.
  const creditSplitPairs = (block: Block, probe: Probe): void => {
    for (const sp of splitPairsOf.get(block.id) ?? []) {
      if (sp.status !== 'pending') continue
      const { pair } = sp
      const est = estimates.get(pair.sourceId)
      const ready = est !== undefined && sp.members.every(m =>
        m.blockId === block.id || (!processed.has(m.blockId) && (requestersOf.get(m.blockId) ?? []).every(r => processed.has(r))))
      if (!ready) {
        splitToListOrder(sp)
        continue
      }
      const probeOf = (id: string): Probe => (id === block.id ? probe : aheadProbe(id))
      const entries = splitByArea(pair.listed, id => probeOf(id).areaNeeds?.get(pair.itemId) ?? [])
      // What an entry needs per range key: its areas' outside legs when it stands for some areas, else the block's probe.
      const needOfEntry = (e: Extract<RankedEntry, { kind: 'block' }>): Map<string, number> => {
        const out = new Map<string, number>()
        const p = probeOf(e.blockId)
        if (e.areas !== undefined) {
          for (const a of e.areas) {
            for (const [k, v] of p.areaKeyNeeds?.get(pair.itemId)?.get(a.areaId) ?? []) out.set(k, (out.get(k) ?? 0) + v)
          }
          return out
        }
        for (const k of keysOfItem(p.received, pair.itemId)) out.set(k, p.received.get(k) ?? 0)
        return out
      }
      const needsById = new Map<string, Map<string, number>>()
      const entryOf = new Map<string, { index: number; need: number }[]>()
      const groups: AllocMember[][] = []
      for (const [start, end] of servedGroupSpans(pair.listed)) {
        const byId = new Map<string, AllocMember>()
        for (let i = start; i < end; i++) {
          const e = entries[i]
          if (e.kind === 'extra') {
            const m = byId.get('extra') ?? { id: 'extra', needs: [{ range: {}, rate: pair.extraRate }], weight: 0 }
            m.weight += e.weight ?? 1
            byId.set('extra', m)
            continue
          }
          const at = rankedTake.get(e.connection.id)
          if (!at || at.pair !== pair || at.position < start || at.position >= end) continue // a request, or credited at an earlier entry
          const m = byId.get(e.connection.id) ?? { id: e.connection.id, needs: [], cap: e.connection.maxRate, weight: 0 }
          m.weight += e.weight ?? 1
          byId.set(e.connection.id, m)
          const mine = needOfEntry(e)
          const all = needsById.get(e.connection.id) ?? new Map<string, number>()
          let total = 0
          for (const [k, v] of mine) {
            all.set(k, (all.get(k) ?? 0) + v)
            total += v
          }
          needsById.set(e.connection.id, all)
          entryOf.set(e.connection.id, [...(entryOf.get(e.connection.id) ?? []), { index: i, need: total }])
        }
        for (const [id, m] of byId) {
          if (id === 'extra') continue
          m.needs = rangeNeedsOf(pair.itemId, needsById.get(id)!)
        }
        if (byId.size > 0) groups.push([...byId.values()])
      }
      const alloc = allocateKeys(pair.itemId, allocKeysOfMap(pair.itemId, est, ranges.get(pair.itemId) ?? []), groups)
      sp.grants = alloc.grants
      sp.covered = alloc.covered
      sp.held = alloc.held
      sp.status = 'shared'
      const entryKeys = new Map<number, Map<string, number>>()
      for (const m of sp.members) {
        const parts = alloc.grants.get(m.connection.id)
        if (!parts) continue
        let total = 0
        for (const v of parts.values()) total += v
        credits.set(m.connection.id, total)
        creditParts.set(m.connection.id, parts)
        let need = 0
        for (const v of needsById.get(m.connection.id)?.values() ?? []) need += v
        needs.set(m.connection.id, need)
        const mine = entryOf.get(m.connection.id) ?? []
        const sum = mine.reduce((a, x) => a + x.need, 0)
        mine.forEach((x, n) => {
          const fraction = sum > 0 ? x.need / sum : n === 0 ? 1 : 0
          entryKeys.set(x.index, new Map([...parts].map(([k, v]) => [k, v * fraction])))
        })
      }
      splitAlloc.set(pair, { entryKeys, extra: alloc.grants.get('extra') ?? new Map() })
    }
  }

  for (const component of components) {
    const loop = component.loop && shapeOf(component.loop)
    if (!loop) {
      const block = byId.get(component.blocks[0].id)!
      const effectiveGoals = productGoals(block.products, requested.get(block.id))
      if (requested.has(block.id)) goals.set(block.id, effectiveGoals)

      const requests = requestsOf.get(block.id)
      const rankedTakes = rankedTakeOf.get(block.id)
      if (!requests && !rankedTakes && !takeSources.has(block.id)) continue
      const kept = ahead.get(block.id)
      ahead.delete(block.id)
      const probe = kept !== undefined && kept.goals === exactKey(effectiveGoals)
        ? kept.probe
        : probeBlock(block, effectiveGoals, gameData, connectedCaps(block, byId, selfConnectionIds), cache)
      if (probe.areaNeeds) areaNeeds.set(block.id, probe.areaNeeds)
      creditGroups(block, probe)
      creditSplitPairs(block, probe)
      if (requests || rankedTakes) {
        const needed = new Map(probe.received) // flow key → what the block would import
        applyTakeCredits(takesOf(block.id), needed, estimates, credits, rankedRest, needs, splitCredit, deferFor(block.id))
        if (requests) {
          shareOut(requests, needed, (c, amount, parts) => {
            info.set(c.id, { requested: amount, ...(parts ? { parts } : {}) })
            addRequest(c, amount, parts)
          })
        }
      }
      processed.add(block.id)
      estimateTakeSource(block, probe)
      resolveDeferred()
      continue
    }

    const members = loop.blockIds.map(id => byId.get(id)!)
    const back = new Set(loop.backConnectionIds)
    const requestById = new Map<string, BlockConnection>()
    for (const m of members) for (const c of requestsOf.get(m.id) ?? []) requestById.set(c.id, c)
    const memberSet = new Set(loop.blockIds)
    const memberPos = new Map(loop.blockIds.map((id, i) => [id, i]))
    // Back credits: a member's ranked take ranked above a take of an earlier member. The lower one reads its credit
    // from the previous round (0 in round 1), as a back connection reads the previous round's request.
    const backCredits = new Map<string, BlockConnection>()
    // The ranked pairs the members take from, with how far down each list a member's take reads (listed entries before
    // `listedEnd`, and the unlisted ones when `unlisted`): only the takes up there are credited before the cycle's reads.
    const rankedRead = new Map<RankedPair, { listedEnd: number; unlisted: boolean }>()
    for (const m of members) {
      const mPos = memberPos.get(m.id)!
      for (const takes of takesOf(m.id)?.values() ?? []) {
        for (const t of takes) {
          const at = rankedTake.get(t.id)
          if (!at) continue
          const end = at.position < 0 ? at.pair.listed.length : at.position
          const read = rankedRead.get(at.pair) ?? { listedEnd: 0, unlisted: false }
          read.listedEnd = Math.max(read.listedEnd, end)
          read.unlisted ||= at.position < 0
          rankedRead.set(at.pair, read)
          for (let i = 0; i < end; i++) {
            const e = at.pair.listed[i]
            if (e.kind !== 'block' || !rankedTake.has(e.connection.id)) continue
            const p = memberPos.get(e.blockId)
            if (p !== undefined && p > mPos) backCredits.set(e.connection.id, e.connection)
          }
        }
      }
    }
    // Member sources: a member some other member takes from. The consumer reads the source's leftover estimate of the round (the source
    // comes first in member order), or of the previous round (a back estimate: the source comes later, round 1 has none).
    const memberSources = new Map<string, Map<string, boolean>>() // source id → item id → is it a back estimate for some consumer?
    for (const m of members) {
      for (const [itemId, takes] of takesOf(m.id) ?? []) {
        for (const t of takes) {
          if (!memberSet.has(t.fromBlockId) || t.fromBlockId === m.id) continue
          const items = memberSources.get(t.fromBlockId) ?? new Map<string, boolean>()
          items.set(itemId, (items.get(itemId) ?? false) || memberPos.get(t.fromBlockId)! > memberPos.get(m.id)!)
          memberSources.set(t.fromBlockId, items)
        }
      }
    }
    // The ids the rounds carry from one round to the next: a back connection (or back credit) of a plain item is one id; a split
    // fluid's is one id per range key it carries (`part`), known once a round has run. A back estimate is one id per flow key too.
    // Its leading NUL keeps it clear of `connectionOfInput`, `requestById` and `maxRateOf`.
    const backIds = [...loop.backConnectionIds, ...backCredits.keys()]
    const estimateId = (sourceId: string, key: string) => `\0est\0${sourceId}\0${key}`
    const isEstimateId = (id: string) => id.startsWith('\0est\0')
    const part = (id: string, key: string) => `${id}\0${key}`
    const connectionOfInput = (id: string) => id.split('\0')[0]
    const maxRateOf = (id: string) => (requestById.get(connectionOfInput(id)) ?? backCredits.get(connectionOfInput(id)))?.maxRate ?? Infinity

    // Everything the rounds read, as an exact string.
    const key = cache
      ? exactKey([
          roundLimit,
          loop.blockIds,
          loop.backConnectionIds,
          // The ranges of the split fluids (every block's ingredients, not only the members') shape the credits and the parts.
          [...ranges].map(([itemId, rs]) => [itemId, rs.map(r => flowKey(itemId, r))]),
          members.map(m => {
            const flat = flattenBlock(m)
            return [
              m.products,
              flat.nodes,
              sourcingKey(flat.sourceRules),
              [...connectedCaps(m, byId, selfConnectionIds).keys()],
              (requestsOf.get(m.id) ?? []).map(c => [c.id, c.itemId, c.fromBlockId, c.maxRate ?? null]),
              [...(takesOf(m.id) ?? [])].map(([itemId, takes]) => [
                itemId,
                takes.map(t => [t.id, t.fromBlockId, t.maxRate ?? null]),
              ]),
              [...(requested.get(m.id) ?? [])],
              ...(flat.areas ? [canonicalAreas(flat.areas)] : []),
            ]
          }),
          members.flatMap(m =>
            [...(takesOf(m.id) ?? [])].flatMap(([itemId, takes]) =>
              takes.map(t => [
                t.fromBlockId, itemId, estimates.has(t.fromBlockId),
                // A split fluid's estimate is per key.
                split.has(itemId)
                  ? keysOfItem(estimates.get(t.fromBlockId) ?? new Map(), itemId).sort().map(k => [k, estimates.get(t.fromBlockId)!.get(k)])
                  : estimates.get(t.fromBlockId)?.get(itemId) ?? null,
              ]),
            ),
          ),
          // The lists of the ranked pairs the members take from, and what their outside takes are credited.
          [...rankedRead].map(([pair, read]) => [
            pair.sourceId, pair.itemId, pair.extraRate,
            pair.listed.map(e => (e.kind === 'extra'
              ? ['extra', e.tied ?? false, e.weight ?? null]
              : [e.blockId, e.connection.id, rankedTake.has(e.connection.id), e.areaId ?? null, e.tied ?? false, e.weight ?? null])),
            pair.unlisted.map(u => [u.blockId, u.connection.id, rankedTake.has(u.connection.id), u.areaNamed ?? false]),
            // Only the credits a member's take reads: the listed takes above it, and the unlisted ones for a takes-first take.
            [...pair.listed.slice(0, read.listedEnd).flatMap(e => (e.kind === 'block' ? [e] : [])), ...(read.unlisted ? pair.unlisted : [])]
              .filter(e => rankedTake.has(e.connection.id) && !memberSet.has(e.blockId))
              .map(e => [e.connection.id, processed.has(e.blockId), deferredTakes.has(e.connection.id), credits.get(e.connection.id) ?? null, [...(creditParts.get(e.connection.id) ?? [])].sort()]),
          ]),
        ])
      : ''
    let solved: RequestLoopSolve | undefined = cache?.getRequestLoop(loop.blockIds, gameData, key)

    if (!solved) {
      let failed = false
      // Probes of this cycle by plan: the solve cache is left alone so the supply entries are not evicted.
      const memo = new Map<string, Probe>()
      // One round: members in order, a back connection reading `input`; returns every request's share.
      // With `skipBack` the back connections take no share, so a member's other requests share its whole need.
      const runRound = (input: Map<string, number>, skipBack = false) => {
        const shares = new Map<string, number>()
        const shareParts = new Map<string, Map<string, number>>() // a split fluid's request per range key
        const roundCredits = new Map<string, number>()
        const roundCreditParts = new Map<string, Map<string, number>>()
        const roundNeeds = new Map<string, number>()
        const roundAreaNeeds = new Map<string, AreaNeeds>()
        const roundBlocked = new Set<string>()
        const forward = new Map<string, Map<string, number>>() // member id → flow key → shares from earlier members
        const est = cloneRemaining(estimates)
        // The back estimates of member sources the previous round left (`seeded` keeps what they were before this round's takes used them).
        const seeded = new Map<string, Offers>()
        for (const [id, v] of input) {
          if (!isEstimateId(id)) continue
          const rest = id.slice('\0est\0'.length)
          const at = rest.indexOf('\0')
          const offers = est.get(rest.slice(0, at)) ?? new Map<string, number>()
          offers.set(rest.slice(at + 1), v)
          est.set(rest.slice(0, at), offers)
          seeded.set(rest.slice(0, at), new Map(offers))
        }
        const freshEstimates = new Map<string, Offers>() // member source id → what it has left after this round's probe
        const roundProcessed = new Set<string>()
        // What a back credit of a split fluid carried into this round, per key.
        const inputParts = (id: string): Map<string, number> => {
          const out = new Map<string, number>()
          for (const [pid, v] of input) if (pid.startsWith(`${id}\0`)) out.set(pid.slice(id.length + 1), v)
          return out
        }
        // What a ranked take of a member is left: the credits above it, read from this round (earlier members), from
        // the input (a back credit) or from outside the cycle.
        const roundRest = (t: BlockConnection, itemId: string) => restOf(t, itemId, est, (blockId, id, listed) => {
          if (!memberSet.has(blockId)) return processed.has(blockId) && !deferredTakes.has(id) ? (credits.get(id) ?? 0) : undefined
          if (roundProcessed.has(blockId)) return roundCredits.get(id) ?? 0
          return listed ? (input.get(id) ?? 0) : undefined // a back credit; an unlisted later member is credited after
        }, roundBlocked)
        const roundCreditPartsOf: CreditPartsOf = (blockId, id, listed) => {
          if (!memberSet.has(blockId)) return processed.has(blockId) && !deferredTakes.has(id) ? (creditParts.get(id) ?? new Map<string, number>()) : undefined
          if (roundProcessed.has(blockId)) return roundCreditParts.get(id) ?? new Map<string, number>()
          return listed ? inputParts(id) : undefined
        }
        const roundSplitCredit: SplitCredit = {
          items: split, ranges, creditParts: roundCreditParts,
          rankedCredit: (t, itemId, needed) => splitCreditOf(t, itemId, needed, est, roundCreditPartsOf, roundBlocked),
        }
        let roundFailed = false
        for (const block of members) {
          const asked = new Map(requested.get(block.id))
          const add = (key: string, amount: number): void => {
            if (amount > 0) asked.set(key, (asked.get(key) ?? 0) + amount)
          }
          for (const [key, amount] of forward.get(block.id) ?? []) add(key, amount)
          for (const [id, amount] of input) {
            const c = requestById.get(connectionOfInput(id))
            if (c && c.fromBlockId === block.id) add(id.includes('\0') ? id.slice(id.indexOf('\0') + 1) : c.itemId, amount)
          }
          const probe = probeBlock(block, productGoals(block.products, asked), gameData, connectedCaps(block, byId, selfConnectionIds), memo)
          roundFailed ||= probe.failed
          if (probe.areaNeeds) roundAreaNeeds.set(block.id, probe.areaNeeds)
          if (memberSources.has(block.id)) {
            // What the members that took from the back estimate already used of it stays used.
            const fresh = leftoverEstimate(probe.nodes, asked, probe.conversions)
            freshEstimates.set(block.id, fresh)
            const before = seeded.get(block.id)
            const now = est.get(block.id)
            est.set(block.id, new Map([...fresh].map(([k, v]) => [k, Math.max(0, v - Math.max(0, (before?.get(k) ?? 0) - (now?.get(k) ?? 0)))])))
          }
          const needed = new Map(probe.received)
          applyTakeCredits(takesOf(block.id), needed, est, roundCredits, roundRest, roundNeeds, roundSplitCredit)
          const requests = (requestsOf.get(block.id) ?? []).filter(c => !(skipBack && back.has(c.id)))
          shareOut(requests, needed, (c, amount, parts) => {
            shares.set(c.id, amount)
            if (parts) shareParts.set(c.id, parts)
            if (memberSet.has(c.fromBlockId) && !back.has(c.id) && amount > 0) {
              const items = forward.get(c.fromBlockId) ?? new Map<string, number>()
              if (parts) for (const [k, v] of parts) items.set(k, (items.get(k) ?? 0) + v)
              else items.set(c.itemId, (items.get(c.itemId) ?? 0) + amount)
              forward.set(c.fromBlockId, items)
            }
          })
          roundProcessed.add(block.id)
        }
        const credited: [string, string, number][] = []
        const seen = new Set<string>()
        for (const m of members) {
          for (const [itemId, takes] of takesOf(m.id) ?? []) {
            for (const t of takes) {
              const offers = est.get(t.fromBlockId)
              // [source, flow key, leftover]: a split fluid's estimate is per key.
              const keys = split.has(itemId) ? keysOfItem(offers ?? new Map(), itemId) : [itemId]
              for (const key of keys) {
                const left = offers?.get(key)
                const k = `${t.fromBlockId}\0${key}`
                if (left === undefined || seen.has(k)) continue
                seen.add(k)
                credited.push([t.fromBlockId, key, left])
              }
            }
          }
        }
        failed ||= roundFailed
        return { shares, shareParts, credits: roundCredits, creditParts: roundCreditParts, credited, needs: roundNeeds, areaNeeds: roundAreaNeeds, blocked: roundBlocked, failed: roundFailed, estimates: freshEstimates }
      }
      // What a round passes on to the next: per back connection (request or credit) its amount, a split fluid's per range key.
      const outputOf = (r: ReturnType<typeof runRound>): Map<string, number> => {
        const out = new Map<string, number>()
        for (const id of backIds) {
          const credit = backCredits.get(id)
          const c = credit ?? requestById.get(id)
          if (c && split.has(c.itemId)) {
            for (const [k, v] of (credit ? r.creditParts : r.shareParts).get(id) ?? []) out.set(part(id, k), v)
          } else out.set(id, credit ? (r.credits.get(id) ?? 0) : (r.shares.get(id) ?? 0))
        }
        for (const [sourceId, items] of memberSources) {
          const fresh = r.estimates.get(sourceId)
          for (const [itemId, isBack] of items) {
            if (!isBack) continue
            if (split.has(itemId)) for (const k of keysOfItem(fresh ?? new Map(), itemId)) out.set(estimateId(sourceId, k), fresh?.get(k) ?? 0)
            else out.set(estimateId(sourceId, itemId), fresh?.get(itemId) ?? 0)
          }
        }
        return out
      }

      const maxAbs = (values: Iterable<number>): number => {
        let m = 0
        for (const v of values) m = Math.max(m, Math.abs(v))
        return m
      }
      let input: Map<string, number> = new Map(backIds.filter(id => !split.has((backCredits.get(id) ?? requestById.get(id))?.itemId ?? '')).map(id => [id, 0]))
      let last: ReturnType<typeof runRound>
      let rounds = 0
      let converged = false
      let plainInput = false // is `input` the previous round's output as it came?
      let extrapolate = true
      let plainOut: Map<string, number> | undefined // the output an extrapolated `input` started from
      let prevDelta: number | undefined
      let growing = 0
      for (;;) {
        rounds++
        last = runRound(input)
        if (last.failed && plainOut) {
          // The extrapolated input made a probe fail: go back to the plain output and stop extrapolating.
          if (rounds >= roundLimit) break
          input = plainOut
          plainOut = undefined
          plainInput = true
          prevDelta = undefined
          extrapolate = false
          continue
        }
        const out = outputOf(last)
        const ids = [...new Set([...out.keys(), ...input.keys()])]
        const delta = new Map(ids.map(id => [id, (out.get(id) ?? 0) - (input.get(id) ?? 0)]))
        if (ids.every(id => sameRate(out.get(id) ?? 0, input.get(id) ?? 0))) {
          converged = true
          break
        }
        if (rounds >= roundLimit) break
        // A back estimate follows the source's leftover, which no extrapolation bounds: it joins the settle test, not the growth test or the extrapolation.
        const change = maxAbs(ids.filter(id => !isEstimateId(id)).map(id => delta.get(id)!))
        let factor: number | undefined
        if (plainInput && prevDelta !== undefined && prevDelta > FLOW_TOLERANCE) {
          const q = change / prevDelta
          if (q >= 1) {
            growing++
            if (growing >= REQUEST_GROWTH_ROUNDS) break
          } else {
            growing = 0
            if (extrapolate) factor = q / (1 - q)
          }
        }
        prevDelta = change
        plainInput = factor === undefined
        plainOut = factor === undefined ? undefined : out
        input = new Map(
          ids.map(id => {
            const next = (out.get(id) ?? 0) + (factor === undefined || isEstimateId(id) ? 0 : delta.get(id)! * factor)
            return [id, Math.min(Math.max(0, next), maxRateOf(id))]
          }),
        )
        // The parts of one connection (a split fluid) share its `maxRate`: scaled down together when the extrapolation pushed them over it.
        const total = new Map<string, number>()
        for (const [id, v] of input) if (id.includes('\0') && !isEstimateId(id)) total.set(connectionOfInput(id), (total.get(connectionOfInput(id)) ?? 0) + v)
        for (const [id, v] of input) {
          if (isEstimateId(id)) continue
          const c = connectionOfInput(id)
          const sum = total.get(c)
          const max = maxRateOf(id)
          if (id.includes('\0') && sum !== undefined && sum > max) input.set(id, v * (max / sum))
        }
      }
      // Not settled: round 1 again, the back connections taking existing output instead of a share.
      // A back credit keeps the last round's value: reading 0 would credit members more than the source has left.
      const keptInput = (): Map<string, number> => {
        const m = new Map<string, number>()
        for (const id of backIds) {
          const credit = backCredits.get(id)
          if (credit === undefined) m.set(id, 0)
          else if (split.has(credit.itemId)) for (const [k, v] of last.creditParts.get(id) ?? []) m.set(part(id, k), v)
          else m.set(id, last.credits.get(id) ?? 0)
        }
        return m
      }
      const kept = converged ? last : runRound(keptInput(), true)
      solved = {
        shares: kept.shares, credits: kept.credits, credited: kept.credited, needs: kept.needs, areaNeeds: kept.areaNeeds, uncredited: kept.blocked, rounds, converged,
        shareParts: kept.shareParts, creditParts: kept.creditParts,
      }
      if (!failed) cache?.setRequestLoop(loop.blockIds, gameData, key, solved)
    }

    // Commit: a request that closes an unsettled cycle takes existing output.
    for (const m of members) {
      for (const c of requestsOf.get(m.id) ?? []) {
        if (!solved.converged && back.has(c.id)) {
          info.set(c.id, { ignored: 'request-loop' })
          continue
        }
        const share = solved.shares.get(c.id) ?? 0
        const parts = solved.shareParts?.get(c.id)
        info.set(c.id, { requested: share, ...(parts ? { parts } : {}) })
        addRequest(c, share, parts)
      }
    }
    for (const [id, credit] of solved.credits) credits.set(id, credit)
    for (const [id, parts] of solved.creditParts ?? []) creditParts.set(id, parts)
    for (const [id, n] of solved.needs) needs.set(id, n)
    for (const [id, n] of solved.areaNeeds ?? []) areaNeeds.set(id, n) // not in the memo key: the key holds every plan, and a member's probe follows from its plan and goals
    for (const id of solved.uncredited) uncredited.add(id)
    for (const m of members) processed.add(m.id)
    for (const m of members) {
      if (requested.has(m.id)) goals.set(m.id, productGoals(m.products, requested.get(m.id)))
    }
    // A member source's estimate first, then the credited leftovers on top: what the members took of it stays out of what the blocks after the cycle read.
    for (const m of members) estimateTakeSource(m)
    for (const [sourceId, itemId, left] of solved.credited) {
      if (memberSet.has(sourceId) && !takeSources.has(sourceId)) continue
      const items: Offers = estimates.get(sourceId) ?? new Map()
      items.set(itemId, left)
      estimates.set(sourceId, items)
    }
    loops.push({ ...loop, rounds: solved.rounds, converged: solved.converged })
    resolveDeferred()
  }
  for (const g of takeGroups) if (g.status === 'pending') toListOrder(g) // unreachable: a group of a pair a cycle reads is served in list order from the start
  resolveDeferred()
  resolveDeferred(true) // takes that wait on each other: credited in the order they were parked, or flagged
  return { goals, info, credits, loops, needs, uncredited, inListOrder, areaNeeds, creditParts, splitAlloc }
}

/**
 * Solve every block, feeding each the net output its sources still have on
 * offer. Blocks are grouped into components of mutually supplying blocks and
 * solved in dependency order; a block outside any loop is solved once. A loop
 * is solved in rounds (members in loop order, a back connection reading its
 * source's offer from the previous round, zero in round 1) until the offers
 * carried by back connections stop changing. Several consumers of one source
 * are served in solve order; several sources of one item are drained in
 * connection order, every connection's reserved share before the rest. A connection
 * to a product of its source is a request: it first adds the consumer's need (less what its takes
 * are credited) to the source's goals, cycles of requests being solved in demand rounds of
 * their own (see `computeRequests`); that amount, like a take's credit,
 * is reserved for the consumer while others are served; when the source is short, the
 * extra gives way first, then the shares served last. A source with a stored served list for an item
 * (see `rankedPairs`) hands its offer down the list when it is solved (groups split what is left by weight): the
 * list's order, not the solve order, then decides who is short, and a listed extra holds its place. With a `cache`, a block whose
 * flattened plan, game data and caps are unchanged reuses its previous result
 * (same object) instead of solving again. `served` lists, per source and item, the consumers in the
 * order they were served (the list's order for a ranked pair) and the source's own extra output (see `buildServed`).
 */
export function solveAll(
  blocks: Block[],
  gameData: GameData,
  cache?: SolveCache,
  options: SolveAllOptions = {},
): MultiBlockSolve {
  const { order, components, selfConnectionIds } = orderBlocks(blocks)
  const requestRoundLimit = Math.max(1, options.requestRoundLimit ?? REQUEST_ROUND_LIMIT)
  const ranked = rankedPairs(blocks)
  const split = splitFluids(gameData)
  const ranges = fluidRanges(blocks, gameData)
  const requestPlan = computeRequests(blocks, gameData, selfConnectionIds, cache, requestRoundLimit, ranked, ranges)
  const solvePos = new Map(order.map((b, i) => [b.id, i]))
  const grants = new Map<string, number>()               // connection id → what a ranked source's list grants it
  const keyGrants = new Map<string, Map<string, number>>() // split fluid: connection id → key → what a ranked source's list grants it
  // What a connection is reserved of a split fluid per key: its request's parts, else its take's credit.
  const keyShares = new Map<string, ReadonlyMap<string, number>>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!split.has(c.itemId)) continue
      const parts = connectionKeyShares(requestPlan.info.get(c.id), requestPlan.creditParts.get(c.id))
      if (parts) keyShares.set(c.id, parts)
    }
  }
  const servedRanks = new Map<string, Map<string, ServedRank>>() // source id → item id → rank, for the report
  // Each ranked pair's entries (the listed ones, then the unlisted consumers in solve order) and its place in the report.
  // Grant time reads the areas' needs of the request pass only (see `reportNeedsOf` for the report).
  const grantNeedsOf = (blockId: string, itemId: string): readonly AreaNeed[] => requestPlan.areaNeeds.get(blockId)?.get(itemId) ?? []
  const entriesOf = new Map<RankedPair, RankedEntry[]>()
  const granted = new Map<RankedPair, readonly number[]>() // what the last grant gave each entry of the pair
  for (const items of ranked.values()) {
    for (const pair of items.values()) {
      const unlistedSorted = pair.unlisted
        .map(u => ({ kind: 'block' as const, blockId: u.blockId, connection: u.connection }))
        .sort((a, b) => solvePos.get(a.blockId)! - solvePos.get(b.blockId)!)
      const entries = splitByArea([...pair.listed, ...unlistedSorted], id => grantNeedsOf(id, pair.itemId))
      entriesOf.set(pair, entries)
      const byItem = servedRanks.get(pair.sourceId) ?? new Map<string, ServedRank>()
      byItem.set(pair.itemId, servedRankOf(entries))
      servedRanks.set(pair.sourceId, byItem)
    }
  }
  // Hand a ranked source's `offers` down its list: grants to the consumers; what the list holds is set as pending in `pend`.
  // A split fluid is handed down key by key: each offered key goes down the list on its own, every entry asking what the allocation (or
  // its request or credit) holds of that key.
  const grantPair = (pair: RankedPair, offers: Offers, pend: Map<string, Offers>): void => {
    const entries = entriesOf.get(pair)!
    if (split.has(pair.itemId)) {
      const alloc = requestPlan.splitAlloc.get(pair)
      for (const e of entries) if (e.kind === 'block') keyGrants.set(e.connection.id, new Map())
      const items = pend.get(pair.sourceId) ?? new Map<string, number>()
      for (const k of keysOfItem(items, pair.itemId)) items.set(k, 0) // the grants replace the shares
      pend.set(pair.sourceId, items)
      const entryGrants = entries.map(() => 0)
      const anyKey = flowKey(pair.itemId, {})
      for (const k of keysOfItem(offers, pair.itemId)) {
        const keyShare = (id: string) => connectionKeyShares(requestPlan.info.get(id), requestPlan.creditParts.get(id))?.get(k) ?? 0
        const given = grantByRank(
          offers.get(k) ?? 0, entries,
          // The extra's part of this key: the allocation's; with none, the extra is the goal on any temperature.
          alloc ? (alloc.extra.get(k) ?? 0) : (k === anyKey ? pair.extraRate : 0),
          keyShare,
          id => requestPlan.inListOrder.has(id),
          (e, i) => alloc?.entryKeys.get(i)?.get(k) ?? (e.part === undefined ? keyShare(e.connection.id) : keyShare(e.connection.id) * e.part),
        )
        for (const [id, amount] of given.grants) keyGrants.get(id)?.set(k, amount)
        given.entryGrants.forEach((g, i) => { entryGrants[i] += g })
        items.set(k, given.held)
      }
      granted.set(pair, entryGrants)
      return
    }
    const given = grantByRank(
      offers.get(pair.itemId) ?? 0, entries, pair.extraRate,
      id => connectionShare(requestPlan.info.get(id), requestPlan.credits.get(id)),
      id => requestPlan.inListOrder.has(id), // a group of takes the request pass served in list order is granted in list order
    )
    for (const [id, amount] of given.grants) grants.set(id, amount)
    granted.set(pair, given.entryGrants) // last call wins, as `grants` does
    const items = pend.get(pair.sourceId) ?? new Map<string, number>()
    items.set(pair.itemId, given.held) // set, not added: the grants replace the shares
    pend.set(pair.sourceId, items)
  }
  // blockId → itemId → items/min reserved (requested, or credited to a take) and not yet served
  let pending = new Map<string, Offers>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      const info = requestPlan.info.get(c.id)
      const share = connectionShare(info, requestPlan.credits.get(c.id))
      if (share <= 0) continue
      const items = pending.get(c.fromBlockId) ?? new Map<string, number>()
      const parts = split.has(c.itemId) ? keyShares.get(c.id) : undefined
      if (parts) for (const [k, v] of parts) items.set(k, (items.get(k) ?? 0) + v)
      else items.set(c.itemId, (items.get(c.itemId) ?? 0) + share)
      pending.set(c.fromBlockId, items)
    }
  }
  const roundLimit = Math.max(1, options.loopRoundLimit ?? LOOP_ROUND_LIMIT)
  const blockIds = new Set(blocks.map(b => b.id))
  const results: Record<string, SolverResult> = {}
  const errors: Record<string, string> = {}
  const flows: ConnectionFlow[] = []
  const loops: BlockLoop[] = []
  // blockId → itemId → items/min still on offer
  const remaining = new Map<string, Offers>()

  function commit(block: Block, step: BlockStep): void {
    results[block.id] = step.result
    if (step.error !== undefined) errors[block.id] = step.error
    flows.push(...step.flows)
  }

  for (const component of components) {
    const loop = component.loop
    if (!loop) {
      const block = component.blocks[0]
      const ctx: StepContext = {
        blockIds,
        selfConnectionIds,
        loopConnectionIds: new Set(),
        gameData,
        cache,
        requests: requestPlan.info,
        credits: requestPlan.credits,
        grants,
        keyShares,
        keyGrants,
        ranges,
        goals: requestPlan.goals,
      }
      const step = solveStep(block, ctx, remaining, pending)
      commit(block, step)
      remaining.set(block.id, step.offers)
      // A source with a served list hands its offer down the list now, before any consumer is solved: each
      // consumer is offered its grant, and what the grants (and a listed extra) hold is not on offer to the others.
      for (const pair of ranked.get(block.id)?.values() ?? []) grantPair(pair, step.offers, pending)
      continue
    }

    const ctx: StepContext = {
      blockIds,
      selfConnectionIds,
      loopConnectionIds: new Set(loop.connectionIds),
      gameData,
      cache,
      requests: requestPlan.info,
      credits: requestPlan.credits,
      grants,
      keyShares,
      keyGrants,
      ranges,
      goals: requestPlan.goals,
    }
    const back = new Set(loop.backConnectionIds)
    // A pair a member earlier than its source reads over a back connection (the previous round's offer) is granted at the
    // start of each round from that offer; any other pair of a member when its source is solved, from that round's offer.
    const readsPrev = new Set(component.blocks.flatMap(m => [...(ranked.get(m.id)?.values() ?? [])])
      .filter(p => entriesOf.get(p)!.some(e => e.kind === 'block' && back.has(e.connection.id))))
    // One round: members in loop order against the snapshot plus last round's offers of the members.
    const runRound = (prev: Map<string, Offers>) => {
      // Upstream offers are re-read from the snapshot every round, never drawn twice.
      const rem = cloneRemaining(remaining)
      const pend = cloneRemaining(pending)
      for (const m of component.blocks) rem.set(m.id, new Map(prev.get(m.id)))
      // Round 1 has no previous offer to grant from: the credits stay reserved (so a round limit of 1 still honours them).
      if (prev.size > 0) for (const pair of readsPrev) grantPair(pair, prev.get(pair.sourceId) ?? new Map(), pend)
      const steps = new Map<string, BlockStep>()
      const next = new Map<string, Offers>()
      const nets = new Map<string, BlockStep['netOffers']>()
      for (const m of component.blocks) {
        const before = rem.get(m.id)!
        const prevOffers = prev.get(m.id)
        const step = solveStep(m, ctx, rem, pend)
        // Earlier members already drew from last round's offers of this block. If they drew more than
        // this round offers, the rest is clamped to nothing (flows already committed stay as they are;
        // this only happens in a round that has not settled).
        const left: Offers = new Map()
        const gross = grossFlow(step.result.nodes, step.result.conversions)
        for (const [key, offer] of step.offers) {
          const drawn = (prevOffers?.get(key) ?? 0) - (before.get(key) ?? 0)
          const rest = offer - drawn
          if (rest > surplusTolerance(gross.get(key) ?? 0)) left.set(key, rest)
        }
        rem.set(m.id, left)
        steps.set(m.id, step)
        next.set(m.id, step.offers)
        nets.set(m.id, step.netOffers)
        for (const pair of ranked.get(m.id)?.values() ?? []) if (!readsPrev.has(pair)) grantPair(pair, step.offers, pend)
      }
      return { rem, pend, steps, next, nets }
    }

    let rounds = 1
    let round = runRound(new Map())
    let converged = backOffersSettled(loop, component.blocks, new Map(), round.nets)
    while (!converged && rounds < roundLimit) {
      rounds++
      const before = round
      round = runRound(before.next)
      converged = backOffersSettled(loop, component.blocks, before.nets, round.nets)
    }
    const { rem, pend, steps } = round

    for (const m of component.blocks) {
      const step = steps.get(m.id)!
      commit(m, step)
      if (!converged) {
        results[m.id] = withExtraWarnings(step.result, [{ type: 'loop-not-converged', blockIds: loop.blockIds, rounds }])
      }
    }
    for (const [id, offers] of rem) remaining.set(id, offers)
    pending = pend
    loops.push({ ...loop, rounds, converged })
  }

  for (const loop of requestPlan.loops) {
    if (loop.converged) continue
    for (const id of loop.blockIds) {
      results[id] = withExtraWarnings(results[id], [{ type: 'request-loop-not-converged', blockIds: loop.blockIds, rounds: loop.rounds }])
    }
  }

  // A connection of a split fluid that offers it only at temperatures no range the block still imports accepts: one warning per consumer.
  if (split.size > 0) {
    for (const b of blocks) {
      const result = results[b.id]
      if (!result) continue
      const goalRanges = new Set((requestPlan.goals.get(b.id) ?? flattenBlock(b).goals).filter(g => split.has(g.itemId)).map(g => flowKey(g.itemId, g.temp ?? {})))
      const connections: Extract<SolverWarning, { type: 'connection-temperature' }>['connections'] = []
      for (const f of flows) {
        if (f.toBlockId !== b.id || !f.parts) continue
        const offered = f.parts.filter(p => p.available > FLOW_TOLERANCE)
        // An unknown temperature fits every range, a range key is a request that delivers what was asked: neither can be a mismatch.
        if (offered.length === 0 || offered.some(p => !isTemperatureTag(p.temp) || p.temp.at === null)) continue
        const needed = result.unsatisfied.filter(u =>
          u.itemId === f.itemId && u.temp !== undefined && !isTemperatureTag(u.temp) && u.rate > FLOW_TOLERANCE && !goalRanges.has(flowKey(u.itemId, u.temp)))
        if (needed.length === 0) continue
        if (offered.some(p => needed.some(u => fitsRange(p.temp, u.temp as FluidRange)))) continue
        connections.push({
          connectionId: f.connectionId,
          itemId: f.itemId,
          offered: offered.map(p => ({ temperature: (p.temp as { at: number }).at, rate: p.available })),
          needed: needed.map(u => {
            const t = u.temp as FluidRange
            return { ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), rate: u.rate }
          }),
        })
      }
      if (connections.length > 0) results[b.id] = withExtraWarnings(result, [{ type: 'connection-temperature', connections }])
    }
  }

  if (hasTemperatureData(gameData)) {
    const recipeIdOfNode = new Map<string, Map<string, string>>()
    const discarded = new Map<string, Set<string>>()
    for (const b of blocks) {
      const recipes = new Map<string, string>()
      const dropped = new Set<string>()
      for (const n of flattenBlock(b).nodes) {
        if (n.kind !== 'game-recipe') continue
        recipes.set(n.id, n.recipeId)
        for (const [itemId, policy] of Object.entries(n.byproductPolicy)) if (policy === 'discard') dropped.add(`${n.id}\0${itemId}`)
      }
      recipeIdOfNode.set(b.id, recipes)
      if (dropped.size > 0) discarded.set(b.id, dropped)
    }
    for (const [id, list] of temperatureWarnings(blocks, results, flows, gameData, recipeIdOfNode, discarded)) {
      results[id] = withExtraWarnings(results[id], list)
    }
  }

  for (const b of blocks) {
    const w = moduleNotAllowedWarning(b, gameData)
    if (w && results[b.id]) results[b.id] = withExtraWarnings(results[b.id], [w])
  }

  // The report reads the request pass, else the final solve (a consumer of a pair the pass never probed).
  const finalNeeds = new Map<string, AreaNeeds | undefined>()
  const reportNeedsOf = (blockId: string, itemId: string): readonly AreaNeed[] => {
    const probed = requestPlan.areaNeeds.get(blockId)
    if (probed) return probed.get(itemId) ?? []
    if (!finalNeeds.has(blockId)) finalNeeds.set(blockId, areaNeedsOf(results[blockId]?.areaRoutes))
    return finalNeeds.get(blockId)?.get(itemId) ?? []
  }
  const areaReport: AreaReport = {
    needsOf: reportNeedsOf,
    entriesOf: (sourceId, itemId) => {
      const pair = ranked.get(sourceId)?.get(itemId)
      if (!pair) return undefined
      // A consumer the list does not name takes none of the pair's leftover at grant time (a take nobody requested has no
      // credit, so no share), so the request pass never probed it: its areas come from the final solve, like an unranked pair's.
      const listedEnd = pair.listed.length
      const entries = entriesOf.get(pair)!.map((e, i) => (i < listedEnd || e.kind === 'extra' || e.areas !== undefined ? e : splitByArea([e], id => reportNeedsOf(id, itemId))[0]))
      return { entries, granted: granted.get(pair) ?? entries.map(() => 0) }
    },
  }
  const served = buildServed(
    flows, blocks, id => connectionShare(requestPlan.info.get(id), requestPlan.credits.get(id)), remaining,
    (sourceId, itemId) => servedRanks.get(sourceId)?.get(itemId),
    { needs: requestPlan.needs, uncredited: requestPlan.uncredited, inListOrder: requestPlan.inListOrder },
    areaReport,
    id => keyShares.get(id),
  )

  cache?.retain(blockIds)
  return { results, flows, errors, loops, requestLoops: requestPlan.loops, served }
}
