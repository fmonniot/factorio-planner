import type {
  Block,
  BlockConnection,
  BlockLoop,
  ConnectionFlow,
  ConnectionFlowStatus,
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
import { blockAreas, solveAreaBlock } from './areas'
import { buildClassifiedSystem } from './build'
import { solveLP } from './solve'
import { computeNodeEffects } from './effects'
import { consumersOf, hasProduct, orderBlocks, reaches, receivesItem, type LoopShape } from './blockGraph'
import {
  FLOW_TOLERANCE, blockDiagnostics, solvedNodeOf, surplusTolerance, zeroNode, type SolverPlan,
} from './blockResult'
import { exactKey, planKey, type RequestLoopSolve, type SolveCache } from './solveCache'

/**
 * Flatten a Block into a SolverPlan: walk the rootPlan tree, collect every
 * node, and surface the block's products as goals + noImportItems. SubPlanNode handles
 * are pure UI grouping; solve() skips them by filtering on kind. When a sub-factory is a
 * separate area the plan also lists the areas (see areas.ts); otherwise it has no `areas` key.
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
    noImportItems: block.noImportItems,
    connectionsFirstItems: block.connectionsFirstItems,
  }
  const areas = blockAreas(block.rootPlan)
  return areas ? { ...plan, areas } : plan
}

/**
 * The solver goals of a block's products: `extraRate` (0 when absent), and for the first product
 * of each item also what other blocks `requested` of it. Rates at or below zero are dropped.
 */
function productGoals(products: Product[], requested?: Map<string, number>): SolverGoal[] {
  const goals: SolverGoal[] = []
  const first = new Set<string>()
  for (const p of products) {
    let rate = p.extraRate ?? 0
    if (!first.has(p.itemId)) {
      first.add(p.itemId)
      const r = requested?.get(p.itemId) ?? 0
      if (r > FLOW_TOLERANCE) rate += r
    }
    if (rate > 0) goals.push({ id: p.id, itemId: p.itemId, rate })
  }
  return goals
}

export { receivesItem }

export { FLOW_TOLERANCE, surplusTolerance }

/**
 * What a source's remaining output `left` of an item offers one connection. `pending` is what
 * unserved requests still hold (including this connection's own `share`; 0 for a take).
 * A request is served its own share first: requests are served in solve order, so later ones
 * give way. Beyond its share it sees, like a take, only what no unserved request holds.
 */
export function connectionOffer(left: number, pending: number, share: number): number {
  return Math.max(0, Math.min(share, left), left - (pending - share))
}

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

/** Gross flow per item: the larger of what the nodes produce and what they consume. */
export function grossFlow(
  nodes: { inputRates: Record<string, number>; outputRates: Record<string, number> }[],
): Map<string, number> {
  const produced = new Map<string, number>()
  const consumed = new Map<string, number>()
  for (const node of nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      produced.set(id, (produced.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      consumed.set(id, (consumed.get(id) ?? 0) + rate)
  }
  const gross = new Map<string, number>()
  for (const id of new Set([...produced.keys(), ...consumed.keys()]))
    gross.set(id, Math.max(produced.get(id) ?? 0, consumed.get(id) ?? 0))
  return gross
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
 * Exception: connections-first items (`plan.connectionsFirstItems`) have their supply in every
 * pass, capped by the offer only, so it is used before the block's own recipes.
 *
 * The solve cache key (see solveCache.ts) must grow if this ever reads
 * anything beyond `plan`, `gameData` and `supplyCaps`.
 */
export function solveBlock(
  plan: SolverPlan,
  gameData: GameData,
  supplyCaps: Map<string, number> = new Map(),
): { result: SolverResult; received: Map<string, number> } {
  if (plan.areas) return solveAreaBlock(plan, plan.areas, gameData, supplyCaps)

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
  // Connections-first intermediates have their supply in every pass, capped by the
  // offer only, so the LP uses it before the block's own recipes.
  const firstItems = new Set(
    (plan.connectionsFirstItems ?? []).filter(
      itemId => totalCaps.has(itemId) && system.classification.intermediates.has(itemId),
    ),
  )
  const firstCaps = new Map([...firstItems].map(itemId => [itemId, totalCaps.get(itemId)!]))
  let lp = solveLP(system, pinnedRates, bcRecipeIds, pass1NoImport, firstCaps, firstItems)

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
    if (firstItems.has(itemId)) {
      // Already supplied in pass 1 up to its offer: stays unlocked only if something is left.
      if (residual > FLOW_TOLERANCE) pass2NoImport.delete(itemId)
      continue
    }
    if (residual > FLOW_TOLERANCE) {
      pass2Caps.set(itemId, Math.min(cap, residual))
      if (cap < residual - FLOW_TOLERANCE) pass2NoImport.delete(itemId)
    }
  }
  if (pass2Caps.size > 0) {
    lp = solveLP(
      system, pinnedRates, bcRecipeIds, pass2NoImport,
      new Map([...firstCaps, ...pass2Caps]), firstItems,
    )
  }

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
    nodes.push(solvedNodeOf(planNode, recipe, throughput, effects, prodBonus, gameData))
  }

  const { overconstrained, unsatisfied, received } = blockDiagnostics({
    goals: plan.goals, system, throughput: throughputMap, slack: lp.slack, supply: lp.supply, nodes, totalCaps,
  })
  if (overconstrained) warnings.push(overconstrained)

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

/** itemId → items/min; one block's offer, or what is still unclaimed of it. */
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
  /** blockId → goals with requested amounts added; absent = the block's own. */
  goals: Map<string, SolverGoal[]>
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
    kind: 'take',
  }
}

/**
 * Solve one block against what its sources have left in `remaining`, and take
 * the delivered amounts out of `remaining`. `pending` holds reserved amounts not yet
 * served (source → item → items/min; requested amounts and take credits): other consumers
 * of the same (source, item) and requesters drawing on a later source beyond their own share
 * see the offer without it. A reserved share is served before later consumers: when the source
 * is short, the extra gives way first, then the shares served last (see `connectionOffer`).
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
  const shares = new Map<string, number>()    // connection id → reserved items/min (request share or take credit)
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
      const info = ctx.requests.get(c.id)
      const reserved = pending.get(c.fromBlockId)?.get(c.itemId) ?? 0
      const left = remaining.get(c.fromBlockId)?.get(c.itemId) ?? 0
      const share = info && 'requested' in info ? info.requested : (ctx.credits.get(c.id) ?? 0)
      const sourceOffer = duplicate ? 0 : connectionOffer(left, reserved, share)
      const offer = c.maxRate === undefined ? sourceOffer : Math.min(sourceOffer, c.maxRate)
      const limitBinds =
        info && 'requested' in info
          ? // The limit bounded the flow only if it cut the request and the source could have met it.
            c.maxRate !== undefined &&
            info.requested >= c.maxRate - FLOW_TOLERANCE &&
            sourceOffer >= c.maxRate - FLOW_TOLERANCE
          : c.maxRate !== undefined && c.maxRate < sourceOffer - FLOW_TOLERANCE
      if (limitBinds) capped.add(c.id)
      seen.add(key)
      active.push(c)
      available.set(c.id, offer)
      shares.set(c.id, duplicate ? 0 : share)
      caps.set(c.itemId, (caps.get(c.itemId) ?? 0) + offer)
    }
  }

  let error: string | undefined
  let result = emptyResult()
  let received = new Map<string, number>()
  const base = flattenBlock(block)
  const plan = { ...base, goals: ctx.goals.get(block.id) ?? base.goals }
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

  // Delivery in two passes, each in connection order: first every connection's reserved share
  // (what its source made or kept for it), then what the block still needs from the rest of the offers.
  const undelivered = new Map(received)
  const delivered = new Map<string, number>() // connection id → items/min
  const deliver = (c: BlockConnection, offer: number): void => {
    const rate = Math.min(undelivered.get(c.itemId) ?? 0, offer)
    if (rate <= 0) return
    undelivered.set(c.itemId, (undelivered.get(c.itemId) ?? 0) - rate)
    delivered.set(c.id, (delivered.get(c.id) ?? 0) + rate)
  }
  for (const c of active) deliver(c, Math.min(shares.get(c.id) ?? 0, available.get(c.id) ?? 0))
  for (const c of active) deliver(c, (available.get(c.id) ?? 0) - (delivered.get(c.id) ?? 0))
  for (const c of active) {
    const rate = delivered.get(c.id) ?? 0
    const sourceLeft = remaining.get(c.fromBlockId)
    if (sourceLeft && rate > 0) {
      sourceLeft.set(c.itemId, (sourceLeft.get(c.itemId) ?? 0) - rate)
    }
    // Served: whatever this consumer left unused of its share goes back to the ones solved later.
    const share = shares.get(c.id) ?? 0
    const sourcePending = pending.get(c.fromBlockId)
    if (share > 0 && sourcePending) {
      sourcePending.set(c.itemId, Math.max(0, (sourcePending.get(c.itemId) ?? 0) - share))
    }
  }

  for (const c of active) {
    const offer = available.get(c.id) ?? 0
    const rate = delivered.get(c.id) ?? 0
    const info = ctx.requests.get(c.id)
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
      kind: info && 'requested' in info ? 'request' : 'take',
      ...(ctx.loopConnectionIds.has(c.id) ? { loop: true as const } : {}),
      ...(info && 'requested' in info ? { requested: info.requested } : {}),
      ...(info && 'ignored' in info ? { requestIgnored: info.ignored } : {}),
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
  warning: Extract<SolverWarning, { type: 'loop-not-converged' | 'request-loop-not-converged' }>,
): SolverResult {
  const key = `${warning.type}\0${warning.rounds}\0${warning.blockIds.join('\0')}`
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
// Requests: request pass
// ---------------------------------------------------------------------------

/** What the request pass decided for one connection to a product of its source. */
type RequestInfo = { requested: number } | { ignored: RequestIgnoredReason }

interface RequestPlan {
  /** blockId → the block's goals plus what its consumers request of it; only for blocks that gained some. */
  goals: Map<string, SolverGoal[]>
  /** connection id → decision; absent for connections that take existing output and for ones that never count (missing source, self). */
  info: Map<string, RequestInfo>
  /** take connection id → items/min its source's leftover covers of the consumer's need; only takes credited more than 0. */
  credits: Map<string, number>
  /** One entry per cycle of requests: `rounds` are demand rounds, `converged` whether the demand settled. */
  loops: BlockLoop[]
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
  if (hit) return { received: hit.received, nodes: hit.result.nodes, failed: false }
  try {
    const solved = solveBlock(plan, gameData, caps)
    cache?.set(block.id, gameData, key, caps, solved)
    return { received: solved.received, nodes: solved.result.nodes, failed: false }
  } catch {
    cache?.delete(block.id)
    return { received: new Map(), nodes: [], failed: true }
  }
}

interface Probe {
  received: Map<string, number>
  nodes: SolvedNode[]
  failed: boolean
}

/**
 * Let a consumer's takes cover part of what it needs (`needed`, reduced in place). Each take in
 * connection order covers min(what its source has left, its limit, the need left), reduces
 * the source's estimate (`estimates`, in place) and is recorded in `credits`.
 */
function applyTakeCredits(
  takes: Map<string, BlockConnection[]> | undefined,
  needed: Map<string, number>,
  estimates: Map<string, Offers>,
  credits: Map<string, number>,
): void {
  for (const [itemId, list] of takes ?? []) {
    let need = needed.get(itemId) ?? 0
    for (const t of list) {
      if (need <= 0) break
      const left = estimates.get(t.fromBlockId)?.get(itemId) ?? 0
      const cover = Math.min(left, t.maxRate ?? Infinity, need)
      if (cover <= 0) continue
      estimates.get(t.fromBlockId)!.set(itemId, left - cover)
      credits.set(t.id, cover)
      need -= cover
    }
    needed.set(itemId, need)
  }
}

/** What a source with solved `nodes` has left per item after the amounts requested of it. */
function leftoverEstimate(nodes: SolvedNode[], requestedOfSource: Map<string, number> | undefined): Offers {
  const left: Offers = new Map()
  for (const [itemId, net] of netBalance(nodes)) {
    const rest = net - (requestedOfSource?.get(itemId) ?? 0)
    if (rest > FLOW_TOLERANCE) left.set(itemId, rest)
  }
  return left
}

/**
 * How much each source must make for its requesting consumers. A consumer's need
 * for an item does not depend on what it receives (solving it with unlimited
 * supply on every connection, a "request probe", gives exactly what it would import; a
 * connections-first item's need is its whole use, as the probe's supply is unlimited),
 * and a source's goals only depend on its own products plus what its consumers
 * request of it. So requests are computed before any supply is handed out, consumers first.
 *
 * Takes before requests: a consumer that takes an item it also requests asks only for what its
 * takes will not cover, and what a take is credited is reserved for it at its source like a
 * request share. The estimate of a take source is what it has left after the amounts
 * requested of it; sources are processed before their take consumers where the request order
 * allows it, and a take whose source is not processed yet gets no credit.
 *
 * Cycles of requests are solved in demand rounds: members in order (consumers first), each probed
 * with its products plus what the other members requested of it, a request that closes the cycle
 * reading the previous round's amount (0 in round 1). A geometric extrapolation step on those
 * amounts speeds up a settling cycle and the demand is cut after `roundLimit` rounds or when it
 * keeps growing for `REQUEST_GROWTH_ROUNDS` rounds. A cycle that does not settle is solved for
 * round 1 again with the requests that close it taking existing output (`request-loop`), so a
 * member's other requests share its whole need.
 */
function computeRequests(
  blocks: Block[],
  gameData: GameData,
  selfConnectionIds: Set<string>,
  cache: SolveCache | undefined,
  roundLimit: number,
): RequestPlan {
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
  if (applicable.length === 0) return { goals, info, credits, loops }

  const requestsOf = new Map<string, BlockConnection[]>() // consumer id → applied requests, in connection order
  for (const { consumer, connection } of applicable) {
    const list = requestsOf.get(consumer.id) ?? []
    list.push(connection)
    requestsOf.set(consumer.id, list)
  }

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
  const { components } = orderBlocks(depBlocks)

  const requested = new Map<string, Map<string, number>>() // source id → item id → items/min
  const estimates = new Map<string, Offers>() // processed take source id → item id → leftover items/min
  const addRequest = (c: BlockConnection, share: number): void => {
    if (share <= 0) return
    const items = requested.get(c.fromBlockId) ?? new Map<string, number>()
    items.set(c.itemId, (items.get(c.itemId) ?? 0) + share)
    requested.set(c.fromBlockId, items)
  }
  // Hand out `needed` over a block's requests in connection order; `share(c, amount)` receives each.
  const shareOut = (requests: BlockConnection[], needed: Map<string, number>, share: (c: BlockConnection, amount: number) => void): void => {
    for (const c of requests) {
      const left = needed.get(c.itemId) ?? 0
      const amount = c.maxRate === undefined ? left : Math.min(left, c.maxRate)
      needed.set(c.itemId, left - amount)
      share(c, amount)
    }
  }
  const estimateTakeSource = (block: Block, probe?: { nodes: SolvedNode[] }): void => {
    if (!takeSources.has(block.id)) return
    const nodes = probe?.nodes ?? probeBlock(
      block, productGoals(block.products, requested.get(block.id)), gameData,
      connectedCaps(block, byId, selfConnectionIds), cache,
    ).nodes
    estimates.set(block.id, leftoverEstimate(nodes, requested.get(block.id)))
  }

  for (const component of components) {
    const loop = component.loop
    if (!loop) {
      const block = byId.get(component.blocks[0].id)!
      const effectiveGoals = productGoals(block.products, requested.get(block.id))
      if (requested.has(block.id)) goals.set(block.id, effectiveGoals)

      const requests = requestsOf.get(block.id)
      if (!requests && !takeSources.has(block.id)) continue
      const probe = probeBlock(block, effectiveGoals, gameData, connectedCaps(block, byId, selfConnectionIds), cache)
      if (requests) {
        const needed = new Map(probe.received) // item id → what the block would import
        applyTakeCredits(takeOf.get(block.id), needed, estimates, credits)
        shareOut(requests, needed, (c, amount) => {
          info.set(c.id, { requested: amount })
          addRequest(c, amount)
        })
      }
      estimateTakeSource(block, probe)
      continue
    }

    const members = loop.blockIds.map(id => byId.get(id)!)
    const back = new Set(loop.backConnectionIds)
    const requestById = new Map<string, BlockConnection>()
    for (const m of members) for (const c of requestsOf.get(m.id) ?? []) requestById.set(c.id, c)
    const memberSet = new Set(loop.blockIds)

    // Everything the rounds read, as an exact string.
    const key = cache
      ? exactKey([
          roundLimit,
          loop.blockIds,
          loop.backConnectionIds,
          members.map(m => {
            const flat = flattenBlock(m)
            return [
              m.products,
              flat.nodes,
              flat.noImportItems ?? [],
              flat.connectionsFirstItems ?? [],
              [...connectedCaps(m, byId, selfConnectionIds).keys()],
              (requestsOf.get(m.id) ?? []).map(c => [c.id, c.itemId, c.fromBlockId, c.maxRate ?? null]),
              [...(takeOf.get(m.id) ?? [])].map(([itemId, takes]) => [
                itemId,
                takes.map(t => [t.id, t.fromBlockId, t.maxRate ?? null]),
              ]),
              [...(requested.get(m.id) ?? [])],
              ...(flat.areas ? [flat.areas] : []),
            ]
          }),
          members.flatMap(m =>
            [...(takeOf.get(m.id) ?? [])].flatMap(([itemId, takes]) =>
              takes.map(t => [t.fromBlockId, itemId, estimates.get(t.fromBlockId)?.get(itemId) ?? null]),
            ),
          ),
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
        const roundCredits = new Map<string, number>()
        const forward = new Map<string, Map<string, number>>() // member id → item id → shares from earlier members
        const est = cloneRemaining(estimates)
        let roundFailed = false
        for (const block of members) {
          const asked = new Map(requested.get(block.id))
          const add = (itemId: string, amount: number): void => {
            if (amount > 0) asked.set(itemId, (asked.get(itemId) ?? 0) + amount)
          }
          for (const [itemId, amount] of forward.get(block.id) ?? []) add(itemId, amount)
          for (const [id, amount] of input) {
            const c = requestById.get(id)!
            if (c.fromBlockId === block.id) add(c.itemId, amount)
          }
          const probe = probeBlock(block, productGoals(block.products, asked), gameData, connectedCaps(block, byId, selfConnectionIds), memo)
          roundFailed ||= probe.failed
          const needed = new Map(probe.received)
          applyTakeCredits(takeOf.get(block.id), needed, est, roundCredits)
          const requests = (requestsOf.get(block.id) ?? []).filter(c => !(skipBack && back.has(c.id)))
          shareOut(requests, needed, (c, amount) => {
            shares.set(c.id, amount)
            if (memberSet.has(c.fromBlockId) && !back.has(c.id) && amount > 0) {
              const items = forward.get(c.fromBlockId) ?? new Map<string, number>()
              items.set(c.itemId, (items.get(c.itemId) ?? 0) + amount)
              forward.set(c.fromBlockId, items)
            }
          })
        }
        const credited: [string, string, number][] = []
        const seen = new Set<string>()
        for (const m of members) {
          for (const [itemId, takes] of takeOf.get(m.id) ?? []) {
            for (const t of takes) {
              const left = est.get(t.fromBlockId)?.get(itemId)
              const k = `${t.fromBlockId}\0${itemId}`
              if (left === undefined || seen.has(k)) continue
              seen.add(k)
              credited.push([t.fromBlockId, itemId, left])
            }
          }
        }
        failed ||= roundFailed
        return { shares, credits: roundCredits, credited, failed: roundFailed }
      }

      const maxAbs = (values: Iterable<number>): number => {
        let m = 0
        for (const v of values) m = Math.max(m, Math.abs(v))
        return m
      }
      const zero = new Map(loop.backConnectionIds.map(id => [id, 0]))
      let input = zero
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
        const out = new Map(loop.backConnectionIds.map(id => [id, last.shares.get(id) ?? 0]))
        const delta = new Map(loop.backConnectionIds.map(id => [id, out.get(id)! - input.get(id)!]))
        if (loop.backConnectionIds.every(id => sameRate(out.get(id)!, input.get(id)!))) {
          converged = true
          break
        }
        if (rounds >= roundLimit) break
        const change = maxAbs(delta.values())
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
          loop.backConnectionIds.map(id => {
            const next = out.get(id)! + (factor === undefined ? 0 : delta.get(id)! * factor)
            return [id, Math.min(Math.max(0, next), requestById.get(id)?.maxRate ?? Infinity)]
          }),
        )
      }
      // Not settled: round 1 again, the back connections taking existing output instead of a share.
      const kept = converged ? last : runRound(zero, true)
      solved = { shares: kept.shares, credits: kept.credits, credited: kept.credited, rounds, converged }
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
        info.set(c.id, { requested: share })
        addRequest(c, share)
      }
    }
    for (const [id, credit] of solved.credits) credits.set(id, credit)
    for (const m of members) {
      if (requested.has(m.id)) goals.set(m.id, productGoals(m.products, requested.get(m.id)))
    }
    for (const [sourceId, itemId, left] of solved.credited) {
      const items: Offers = estimates.get(sourceId) ?? new Map()
      items.set(itemId, left)
      estimates.set(sourceId, items)
    }
    for (const m of members) estimateTakeSource(m)
    loops.push({ ...loop, rounds: solved.rounds, converged: solved.converged })
  }
  return { goals, info, credits, loops }
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
 * extra gives way first, then the shares served last. With a `cache`, a block whose
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
  const requestRoundLimit = Math.max(1, options.requestRoundLimit ?? REQUEST_ROUND_LIMIT)
  const requestPlan = computeRequests(blocks, gameData, selfConnectionIds, cache, requestRoundLimit)
  // blockId → itemId → items/min reserved (requested, or credited to a take) and not yet served
  let pending = new Map<string, Offers>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      const info = requestPlan.info.get(c.id)
      const share = info && 'requested' in info ? info.requested : (requestPlan.credits.get(c.id) ?? 0)
      if (share <= 0) continue
      const items = pending.get(c.fromBlockId) ?? new Map<string, number>()
      items.set(c.itemId, (items.get(c.itemId) ?? 0) + share)
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
        goals: requestPlan.goals,
      }
      const step = solveStep(block, ctx, remaining, pending)
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
      requests: requestPlan.info,
      credits: requestPlan.credits,
      goals: requestPlan.goals,
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
        const step = solveStep(m, ctx, rem, pend)
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

  for (const loop of requestPlan.loops) {
    if (loop.converged) continue
    for (const id of loop.blockIds) {
      results[id] = withLoopWarning(results[id], { type: 'request-loop-not-converged', blockIds: loop.blockIds, rounds: loop.rounds })
    }
  }

  cache?.retain(blockIds)
  return { results, flows, errors, loops, requestLoops: requestPlan.loops }
}
