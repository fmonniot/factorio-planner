import type {
  Block,
  BlockConnection,
  BlockLoop,
  ConnectionFlow,
  ConnectionFlowStatus,
  GameData,
  MultiBlockSolve,
  ProductionGoal,
  PullIgnoredReason,
  RecipeNode,
  SolvedNode,
  SolverResult,
  SolverWarning,
  SubPlan,
  UnsatisfiedItem,
} from '../data/types'
import { buildClassifiedSystem, effectiveProductAmount } from './build'
import { solveLP } from './solve'
import { computeNodeEffects, computeMachineMetrics } from './effects'
import { orderBlocks, type LoopShape } from './blockGraph'
import { planKey, type SolveCache } from './solveCache'

interface SolverPlan {
  goals: ProductionGoal[]
  nodes: RecipeNode[]
  noImportItems?: string[]
}

/**
 * Flatten a Block into a SolverPlan: walk the rootPlan tree, collect every
 * node, and surface block-level goals + noImportItems. SubPlanNode handles
 * are pure UI grouping; solve() skips them by filtering on kind.
 */
export function flattenBlock(block: Block): SolverPlan {
  const nodes: RecipeNode[] = []
  function visit(plan: SubPlan): void {
    for (const n of plan.nodes) nodes.push(n)
    for (const sp of plan.subPlans) visit(sp)
  }
  visit(block.rootPlan)
  return {
    goals: block.goals,
    nodes,
    noImportItems: block.noImportItems,
  }
}

/**
 * Can `block` make `itemId`? True when a game-recipe node of the block has a
 * product of that item with a positive effective amount and does not discard it.
 * The one definition of "has a producer" for pull connections, shared by the
 * solver and the connection menus.
 */
export function producesItem(block: Block, itemId: string, gameData: GameData): boolean {
  for (const n of flattenBlock(block).nodes) {
    if (n.kind !== 'game-recipe' || n.byproductPolicy[itemId] === 'discard') continue
    const recipe = gameData.recipes[n.recipeId]
    if (!recipe) continue
    const makes = recipe.products.some(
      p =>
        p.itemId === itemId &&
        effectiveProductAmount(p.amount ?? 0, p.probability ?? 1, p.ignoredByProductivity ?? 0, 0) > 0,
    )
    if (makes) return true
  }
  return false
}

/**
 * Does `block` take `itemId` from a connection of its own, from an existing
 * block other than itself? Then it is not a pure producer of the item: a
 * pull on it would cancel its own supply. The one definition of "source
 * receives the item", shared by the solver and the connection menus.
 */
export function receivesItem(block: Block, itemId: string, blockIds: ReadonlySet<string>): boolean {
  return block.inputConnections.some(c => c.itemId === itemId && c.fromBlockId !== block.id && blockIds.has(c.fromBlockId))
}

/**
 * Why a pull of `itemId` from `source` could not apply, apart from cycles of
 * pulls, or undefined when it can. Shared by the solver and the connection menus.
 */
export function pullIgnoredReason(
  source: Block,
  itemId: string,
  blockIds: ReadonlySet<string>,
  gameData: GameData,
): 'no-producer' | 'source-receives' | undefined {
  if (!producesItem(source, itemId, gameData)) return 'no-producer'
  if (receivesItem(source, itemId, blockIds)) return 'source-receives'
  return undefined
}

/** Rates at or below this are treated as zero when comparing supply and demand. */
export const FLOW_TOLERANCE = 1e-6

/**
 * Net items/min a set of solved nodes leaves over per item (produced minus
 * consumed). Positive entries are what a block can offer to other blocks.
 */
export function netBalance(
  nodes: { inputRates: Record<string, number>; outputRates: Record<string, number> }[],
): Map<string, number> {
  const net = new Map<string, number>()
  for (const node of nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      net.set(id, (net.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      net.set(id, (net.get(id) ?? 0) - rate)
  }
  return net
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
 *
 * The solve cache key (see solveCache.ts) must grow if this ever reads
 * anything beyond `plan`, `gameData` and `supplyCaps`.
 */
export function solveBlock(
  plan: SolverPlan,
  gameData: GameData,
  supplyCaps: Map<string, number> = new Map(),
): { result: SolverResult; received: Map<string, number> } {
  // SubPlanNodes are UI grouping only; the solver only sees game-recipe nodes.
  // byproductConsumer is a flag that applies a small negative bonus to the
  // recipe's objective coefficient, making the LP prefer to run it up to
  // whatever surplus the intermediate constraints allow — without overriding
  // goal-meeting decisions.
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
  // (effects, pin, byproduct settings); later duplicates solve to zero.
  const seenRecipes = new Set<string>()
  const representatives = gameRecipeNodes.filter(n => {
    if (seenRecipes.has(n.recipeId)) return false
    seenRecipes.add(n.recipeId)
    return true
  })
  const representativeIds = new Set(representatives.map(n => n.id))

  const recipeIds = representatives.map(n => n.recipeId)

  const goalsMap = new Map(plan.goals.map(g => [g.itemId, g.rate]))

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

  const system = buildClassifiedSystem(gameData, recipeIds, goalsMap, productivityMap)

  // Warn for goal items with no producer recipe in the plan.
  const noRecipeWarnings: SolverResult['warnings'] = []
  for (const goal of plan.goals) {
    const row = system.S.get(goal.itemId)
    const hasProducer = row !== undefined && [...row.values()].some(c => c > 0)
    if (!hasProducer) {
      noRecipeWarnings.push({ type: 'no-recipe', itemId: goal.itemId })
    }
  }

  for (const n of representatives) {
    for (const [itemId, policy] of Object.entries(n.byproductPolicy)) {
      if (policy === 'discard') {
        const row = system.S.get(itemId)
        if (row) {
          const coeff = row.get(n.recipeId) ?? 0
          if (coeff > 0) row.set(n.recipeId, 0)
        }
      }
    }
  }

  const pinnedRates = new Map<string, number>()
  for (const n of representatives) {
    if (n.pinnedRate !== undefined) {
      pinnedRates.set(n.recipeId, n.pinnedRate)
    }
  }

  // No-import set: user's explicit list, plus bc recipes' ingredients.
  // Auto-adding bc ingredients preserves the "consume surplus only, don't
  // trigger new ingredient production" semantics: with no slack allowed on
  // a bc ingredient, the LP can't import it just to fire the bc bonus —
  // it must come from an in-plan producer (or raw if no producer exists).
  const noImportItems = new Set(plan.noImportItems ?? [])
  for (const n of representatives) {
    if (!n.byproductConsumer) continue
    const recipe = gameData.recipes[n.recipeId]
    if (!recipe) continue
    for (const ing of recipe.ingredients) {
      noImportItems.add(ing.itemId)
    }
  }

  const totalCaps = new Map([...supplyCaps].filter(([, cap]) => cap > FLOW_TOLERANCE))

  // Pass 1: what the block's own recipes cannot cover. Connected items lose their
  // lock for this pass only, so a shortfall shows up as slack, not as infeasibility.
  const pass1NoImport = totalCaps.size === 0
    ? noImportItems
    : new Set([...noImportItems].filter(itemId => !totalCaps.has(itemId)))
  let lp = solveLP(system, pinnedRates, bcRecipeIds, pass1NoImport)

  // Pass 2: supply fills only the residual of connected intermediates. Capping at
  // the residual keeps own production at its pass-1 level (replacing it would
  // bring slack back at BIG_M); raw items need no LP row and are handled below.
  const pass2Caps = new Map<string, number>()
  // A locked item whose offer is below its residual stays unlocked in pass 2: with
  // the lock the LP would be infeasible and its output meaningless. The uncovered
  // part then shows up as an import, the same as in pass 1.
  const pass2NoImport = new Set(noImportItems)
  for (const [itemId, cap] of totalCaps) {
    if (!system.classification.intermediates.has(itemId)) continue
    const residual = lp.slack.get(itemId) ?? 0
    if (residual > FLOW_TOLERANCE) {
      pass2Caps.set(itemId, Math.min(cap, residual))
      if (cap < residual - FLOW_TOLERANCE) pass2NoImport.delete(itemId)
    }
  }
  if (pass2Caps.size > 0) {
    lp = solveLP(system, pinnedRates, bcRecipeIds, pass2NoImport, pass2Caps)
  }

  const { throughput: throughputMap, slack: slackMap, warnings } = lp

  // Per-item net surplus from the LP solve.
  const itemSurplus = new Map<string, number>()
  for (const [itemId, rowS] of system.S) {
    let net = 0
    for (const [recipeId, coeff] of rowS) {
      net += coeff * (throughputMap.get(recipeId) ?? 0)
    }
    itemSurplus.set(itemId, net)
  }

  // Detect overconstrained intermediates: positive net flow at LP optimum.
  const SURPLUS_TOLERANCE = 1e-6
  const overconstrainedItems: { itemId: string; rate: number }[] = []
  for (const itemId of system.classification.intermediates) {
    const surplus = itemSurplus.get(itemId) ?? 0
    if (surplus > SURPLUS_TOLERANCE) {
      overconstrainedItems.push({ itemId, rate: surplus })
    }
  }
  if (overconstrainedItems.length > 0) {
    warnings.push({ type: 'overconstrained', surplusItems: overconstrainedItems })
  }

  const nodes: SolvedNode[] = []

  for (const planNode of gameRecipeNodes) {
    if (!representativeIds.has(planNode.id)) {
      nodes.push({
        recipeNodeId: planNode.id,
        inputRates: {},
        outputRates: {},
        throughput: 0,
        machineCountExact: 0,
        machineCountCeil: 0,
        powerKw: 0,
      })
      continue
    }

    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue

    const throughput = throughputMap.get(planNode.recipeId) ?? 0
    const effects = nodeEffectsMap.get(planNode.recipeId)!
    const prodBonus = productivityMap.get(planNode.recipeId) ?? 0

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

    nodes.push({
      recipeNodeId: planNode.id,
      inputRates,
      outputRates,
      throughput,
      machineCountExact,
      machineCountCeil,
      powerKw,
    })
  }

  // Goal shortfall pass: if LP was infeasible (no LP-active producer, or conflicting pins),
  // the actual net output of a goal may be below its target. Surface the deficit so the
  // Ingredients pane shows what must come from outside.
  const GOAL_SHORTFALL_TOLERANCE = 1e-4
  const goalShortfalls: UnsatisfiedItem[] = []
  for (const goal of plan.goals) {
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
    const fromSupply = Math.min(lp.supply.get(itemId) ?? 0, deficit)
    if (fromSupply > FLOW_TOLERANCE) received.set(itemId, fromSupply)
  }

  // Ordering: goal shortfalls first, then intermediate slack, then raw consumption.
  const unsatisfied: UnsatisfiedItem[] = [...goalShortfalls, ...slackIntermediates, ...rawConsumption]

  return {
    result: { nodes, unsatisfied, warnings: [...duplicateWarnings, ...noRecipeWarnings, ...warnings] },
    received,
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

export interface SolveAllOptions {
  /** Overrides `LOOP_ROUND_LIMIT` (at least 1). */
  loopRoundLimit?: number
}

/** itemId → items/min; one block's offer, or what is still unclaimed of it. */
type Offers = Map<string, number>

interface StepContext {
  blockIds: Set<string>
  selfConnectionIds: Set<string>
  /** Connections between two members of one loop. */
  loopConnectionIds: Set<string>
  gameData: GameData
  cache?: SolveCache
  /** connection id → what the pull pass decided for a connection marked `pull`. */
  pull: Map<string, PullInfo>
}

interface BlockStep {
  result: SolverResult
  error?: string
  flows: ConnectionFlow[]
  /** The block's net output, before any consumer took from it. */
  offers: Offers
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
  }
}

/**
 * Solve one block against what its sources have left in `remaining`, and take
 * the delivered amounts out of `remaining`. `pending` is the demand of applied
 * pulls not yet served (source → item → items/min): other consumers see the
 * offer without it, and an applied pull gives its own share back when served.
 */
function solveStep(
  block: Block,
  ctx: StepContext,
  remaining: Map<string, Offers>,
  pending: Map<string, Offers>,
): BlockStep {
  const { gameData, cache } = ctx
  const flows: ConnectionFlow[] = []
  const active: BlockConnection[] = []
  const available = new Map<string, number>() // connection id → items/min on offer
  const caps = new Map<string, number>()      // item id → total on offer
  const seen = new Set<string>()
  const duplicates = new Set<string>() // connection ids repeating an earlier (source, item) pair
  const capped = new Set<string>() // connection ids whose maxRate is below the source's offer
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
      const info = ctx.pull.get(c.id)
      const reserved = pending.get(c.fromBlockId)?.get(c.itemId) ?? 0
      const held = info && 'demand' in info ? reserved - info.demand : reserved
      const sourceOffer = duplicate ? 0 : Math.max(0, (remaining.get(c.fromBlockId)?.get(c.itemId) ?? 0) - held)
      const offer = c.maxRate === undefined ? sourceOffer : Math.min(sourceOffer, c.maxRate)
      const limitBinds =
        info && 'demand' in info
          ? // The limit bounded the flow only if it cut the demand and the source could have met it.
            c.maxRate !== undefined &&
            info.demand >= c.maxRate - FLOW_TOLERANCE &&
            sourceOffer >= c.maxRate - FLOW_TOLERANCE
          : c.maxRate !== undefined && c.maxRate < sourceOffer - FLOW_TOLERANCE
      if (limitBinds) capped.add(c.id)
      seen.add(key)
      active.push(c)
      available.set(c.id, offer)
      caps.set(c.itemId, (caps.get(c.itemId) ?? 0) + offer)
    }
  }

  let error: string | undefined
  let result = emptyResult()
  let received = new Map<string, number>()
  const plan = flattenBlock(block)
  if (plan.goals.length > 0 && plan.nodes.length > 0) {
    const key = cache ? planKey(plan) : ''
    const hit = cache?.get(block.id, gameData, key, caps)
    if (hit) {
      ;({ result, received } = hit)
    } else {
      try {
        const solved = solveBlock(plan, gameData, caps)
        ;({ result, received } = solved)
        cache?.set(block.id, gameData, key, caps, solved)
      } catch (err) {
        cache?.delete(block.id)
        error = err instanceof Error ? err.message : String(err)
        result = emptyResult()
        received = new Map()
      }
    }
  } else {
    cache?.delete(block.id)
  }

  const stillImported = new Map<string, number>()
  for (const u of result.unsatisfied) {
    stillImported.set(u.itemId, (stillImported.get(u.itemId) ?? 0) + u.rate)
  }

  const undelivered = new Map(received)
  for (const c of active) {
    const offer = available.get(c.id) ?? 0
    const rate = Math.min(undelivered.get(c.itemId) ?? 0, offer)
    undelivered.set(c.itemId, (undelivered.get(c.itemId) ?? 0) - rate)
    const sourceLeft = remaining.get(c.fromBlockId)
    if (sourceLeft && rate > 0) {
      sourceLeft.set(c.itemId, (sourceLeft.get(c.itemId) ?? 0) - rate)
    }
    // Served: whatever this consumer left unused goes back to the ones solved later.
    const info = ctx.pull.get(c.id)
    const sourcePending = pending.get(c.fromBlockId)
    if (info && 'demand' in info && sourcePending) {
      sourcePending.set(c.itemId, Math.max(0, (sourcePending.get(c.itemId) ?? 0) - info.demand))
    }

    const importsItem = (stillImported.get(c.itemId) ?? 0) > FLOW_TOLERANCE
    const status: ConnectionFlowStatus =
      duplicates.has(c.id) ? 'unused'
      : importsItem && rate >= offer - FLOW_TOLERANCE ? 'limited'
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
      ...(ctx.loopConnectionIds.has(c.id) ? { loop: true as const } : {}),
      ...(info && 'demand' in info ? { demand: info.demand } : {}),
      ...(info && 'ignored' in info ? { pullIgnored: info.ignored } : {}),
    })
  }

  const offers: Offers = new Map()
  for (const [itemId, net] of netBalance(result.nodes)) {
    if (net > FLOW_TOLERANCE) offers.set(itemId, net)
  }
  return { result, error, flows, offers }
}

/** Equal within a relative `FLOW_TOLERANCE`. */
function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOW_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Did every (source, item) pair carried by a back connection keep its offer between two rounds? */
function backOffersSettled(
  loop: LoopShape,
  members: Block[],
  prev: Map<string, Offers>,
  next: Map<string, Offers>,
): boolean {
  const back = new Set(loop.backConnectionIds)
  for (const b of members) {
    for (const c of b.inputConnections) {
      if (!back.has(c.id)) continue
      const before = prev.get(c.fromBlockId)?.get(c.itemId) ?? 0
      const after = next.get(c.fromBlockId)?.get(c.itemId) ?? 0
      if (!sameRate(before, after)) return false
    }
  }
  return true
}

const loopWarningCopies = new WeakMap<SolverResult, { key: string; result: SolverResult }>()

/**
 * `result` plus a warning, on a copy (cached results are never mutated). The copy is
 * memoised per result object, so a loop that stays unsettled keeps result identity
 * between solves as long as its cached results do.
 */
function withLoopWarning(
  result: SolverResult,
  warning: Extract<SolverWarning, { type: 'loop-not-converged' }>,
): SolverResult {
  const key = `${warning.rounds}\0${warning.blockIds.join('\0')}`
  const hit = loopWarningCopies.get(result)
  if (hit?.key === key) return hit.result
  const copy = { ...result, warnings: [...result.warnings, warning] }
  loopWarningCopies.set(result, { key, result: copy })
  return copy
}

function cloneRemaining(remaining: Map<string, Offers>): Map<string, Offers> {
  return new Map([...remaining].map(([id, offers]) => [id, new Map(offers)]))
}

// ---------------------------------------------------------------------------
// Pull connections: demand pass
// ---------------------------------------------------------------------------

/** What the demand pass decided for one connection marked `pull`. */
type PullInfo = { demand: number } | { ignored: PullIgnoredReason }

interface PullPlan {
  /** blockId → the block's goals plus what its pull consumers ask of it; only for blocks that gained some. */
  goals: Map<string, ProductionGoal[]>
  /** connection id → decision; absent for push connections and for ones that never count (missing source, self, duplicate). */
  info: Map<string, PullInfo>
}

/** `goals` plus `pulled` (itemId → items/min): added to the own goal of that item, or as a new goal `pull:<item>`. */
function mergePulledGoals(goals: ProductionGoal[], pulled: Map<string, number> | undefined): ProductionGoal[] {
  let merged = goals
  for (const [itemId, rate] of pulled ?? []) {
    if (rate <= FLOW_TOLERANCE) continue
    const i = merged.findIndex(g => g.itemId === itemId)
    if (i >= 0) merged = merged.map((g, j) => (j === i ? { ...g, rate: g.rate + rate } : g))
    else merged = [...merged, { id: `pull:${itemId}`, itemId, rate }]
  }
  return merged
}

/**
 * How much each source must make for its pull consumers. A consumer's demand
 * for an item does not depend on what it receives (solving it with unlimited
 * supply on every connection, a "probe", gives exactly what it would import),
 * and a source's goals only depend on its own goals plus what its consumers
 * ask of it. So demand is computed in one pass, consumers first, before any
 * supply is handed out. Pulls forming a cycle are ignored.
 */
function computePullDemands(
  blocks: Block[],
  gameData: GameData,
  selfConnectionIds: Set<string>,
  cache?: SolveCache,
): PullPlan {
  const byId = new Map(blocks.map(b => [b.id, b]))
  const blockIds = new Set(byId.keys())
  const info = new Map<string, PullInfo>()
  const goals = new Map<string, ProductionGoal[]>()

  // Candidates: pulls that count, in plan order. Applicable ones go on to the cycle check.
  const applicable: { consumer: Block; connection: BlockConnection }[] = []
  for (const consumer of blocks) {
    const seen = new Set<string>()
    for (const c of consumer.inputConnections) {
      const source = byId.get(c.fromBlockId)
      if (!source || selfConnectionIds.has(c.id)) continue
      const key = `${c.fromBlockId}\0${c.itemId}`
      const duplicate = seen.has(key)
      seen.add(key)
      if (!c.pull) continue
      if (duplicate) {
        info.set(c.id, { ignored: 'duplicate' })
        continue
      }
      const reason = pullIgnoredReason(source, c.itemId, blockIds, gameData)
      if (reason) info.set(c.id, { ignored: reason })
      else applicable.push({ consumer, connection: c })
    }
  }
  if (applicable.length === 0) return { goals, info }

  // Order consumers before sources: orderBlocks puts sources first, so feed it the reversed pulls.
  const reversed = new Map<string, BlockConnection[]>()
  for (const { consumer, connection } of applicable) {
    const list = reversed.get(connection.fromBlockId) ?? []
    list.push({ id: connection.id, itemId: connection.itemId, fromBlockId: consumer.id })
    reversed.set(connection.fromBlockId, list)
  }
  const { components } = orderBlocks(blocks.map(b => ({ ...b, inputConnections: reversed.get(b.id) ?? [] })))
  const looped = new Set<string>()
  for (const component of components) {
    for (const id of component.loop?.connectionIds ?? []) {
      looped.add(id)
      info.set(id, { ignored: 'pull-loop' })
    }
  }
  const pullsOf = new Map<string, BlockConnection[]>() // consumer id → applied pulls, in connection order
  for (const { consumer, connection } of applicable) {
    if (looped.has(connection.id)) continue
    const list = pullsOf.get(consumer.id) ?? []
    list.push(connection)
    pullsOf.set(consumer.id, list)
  }

  const pulled = new Map<string, Map<string, number>>() // source id → item id → items/min
  for (const component of components) {
    for (const member of component.blocks) {
      const block = byId.get(member.id)!
      const effectiveGoals = mergePulledGoals(block.goals, pulled.get(block.id))
      if (effectiveGoals !== block.goals) goals.set(block.id, effectiveGoals)

      const pulls = pullsOf.get(block.id)
      if (!pulls) continue
      const demand = new Map<string, number>() // item id → what the block would import
      const plan = { ...flattenBlock(block), goals: effectiveGoals }
      if (plan.goals.length > 0 && plan.nodes.length > 0) {
        const caps = new Map<string, number>()
        for (const c of block.inputConnections) {
          if (byId.has(c.fromBlockId) && !selfConnectionIds.has(c.id)) caps.set(c.itemId, Infinity)
        }
        const key = cache ? planKey(plan) : ''
        let received = cache?.get(block.id, gameData, key, caps)?.received
        if (!received) {
          try {
            const solved = solveBlock(plan, gameData, caps)
            cache?.set(block.id, gameData, key, caps, solved)
            received = solved.received
          } catch {
            // The supply solve reports the error; a failing block asks for nothing.
            cache?.delete(block.id)
          }
        }
        for (const [itemId, rate] of received ?? []) demand.set(itemId, rate)
      }

      for (const c of pulls) {
        const left = demand.get(c.itemId) ?? 0
        const share = c.maxRate === undefined ? left : Math.min(left, c.maxRate)
        demand.set(c.itemId, left - share)
        info.set(c.id, { demand: share })
        if (share > 0) {
          const items = pulled.get(c.fromBlockId) ?? new Map<string, number>()
          items.set(c.itemId, (items.get(c.itemId) ?? 0) + share)
          pulled.set(c.fromBlockId, items)
        }
      }
    }
  }
  return { goals, info }
}

/**
 * Solve every block, feeding each the net output its sources still have on
 * offer. Blocks are grouped into components of mutually supplying blocks and
 * solved in dependency order; a block outside any loop is solved once. A loop
 * is solved in rounds (members in loop order, a back connection reading its
 * source's offer from the previous round, zero in round 1) until the offers
 * carried by back connections stop changing. Several consumers of one source
 * are served in solve order; several sources of one item are drained in
 * connection order. A connection marked `pull` first adds the consumer's demand
 * to the source's goals (see `computePullDemands`); that demand is reserved for
 * the pulling consumer while others are served. With a `cache`, a block whose
 * flattened plan, game data and caps are unchanged reuses its previous result
 * (same object) instead of solving again.
 */
export function solveAll(
  blocks: Block[],
  gameData: GameData,
  cache?: SolveCache,
  options: SolveAllOptions = {},
): MultiBlockSolve {
  const { components, selfConnectionIds } = orderBlocks(blocks)
  const pullPlan = computePullDemands(blocks, gameData, selfConnectionIds, cache)
  const effective = (b: Block): Block => {
    const goals = pullPlan.goals.get(b.id)
    return goals ? { ...b, goals } : b
  }
  // blockId → itemId → items/min asked by applied pulls and not yet served
  let pending = new Map<string, Offers>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      const info = pullPlan.info.get(c.id)
      if (!info || !('demand' in info) || info.demand <= 0) continue
      const items = pending.get(c.fromBlockId) ?? new Map<string, number>()
      items.set(c.itemId, (items.get(c.itemId) ?? 0) + info.demand)
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
        pull: pullPlan.info,
      }
      const step = solveStep(effective(block), ctx, remaining, pending)
      commit(block, step)
      remaining.set(block.id, step.offers)
      continue
    }

    const ctx: StepContext = {
      blockIds,
      selfConnectionIds,
      loopConnectionIds: new Set(loop.connectionIds),
      gameData,
      cache,
      pull: pullPlan.info,
    }
    // One round: members in loop order against the snapshot plus last round's offers of the members.
    const runRound = (prev: Map<string, Offers>) => {
      // Upstream offers are re-read from the snapshot every round, never drawn twice.
      const rem = cloneRemaining(remaining)
      const pend = cloneRemaining(pending)
      for (const m of component.blocks) rem.set(m.id, new Map(prev.get(m.id)))
      const steps = new Map<string, BlockStep>()
      const next = new Map<string, Offers>()
      for (const m of component.blocks) {
        const before = rem.get(m.id)!
        const prevOffers = prev.get(m.id)
        const step = solveStep(effective(m), ctx, rem, pend)
        // Earlier members already drew from last round's offers of this block. If they drew more than
        // this round offers, the rest is clamped to nothing (flows already committed stay as they are;
        // this only happens in a round that has not settled).
        const left: Offers = new Map()
        for (const [itemId, offer] of step.offers) {
          const drawn = (prevOffers?.get(itemId) ?? 0) - (before.get(itemId) ?? 0)
          const rest = offer - drawn
          if (rest > FLOW_TOLERANCE) left.set(itemId, rest)
        }
        rem.set(m.id, left)
        steps.set(m.id, step)
        next.set(m.id, step.offers)
      }
      return { rem, pend, steps, next }
    }

    let rounds = 1
    let round = runRound(new Map())
    let converged = backOffersSettled(loop, component.blocks, new Map(), round.next)
    while (!converged && rounds < roundLimit) {
      rounds++
      const before = round.next
      round = runRound(before)
      converged = backOffersSettled(loop, component.blocks, before, round.next)
    }
    const { rem, pend, steps } = round

    for (const m of component.blocks) {
      const step = steps.get(m.id)!
      commit(m, step)
      if (!converged) {
        results[m.id] = withLoopWarning(step.result, { type: 'loop-not-converged', blockIds: loop.blockIds, rounds })
      }
    }
    for (const [id, offers] of rem) remaining.set(id, offers)
    pending = pend
    loops.push({ ...loop, rounds, converged })
  }

  cache?.retain(blockIds)
  return { results, flows, errors, loops }
}
