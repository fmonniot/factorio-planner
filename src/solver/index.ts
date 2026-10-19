import type {
  Block,
  BlockConnection,
  ConnectionFlow,
  ConnectionFlowStatus,
  GameData,
  MultiBlockSolve,
  ProductionGoal,
  RecipeNode,
  SolvedNode,
  SolverResult,
  SubPlan,
  UnsatisfiedItem,
} from '../data/types'
import { buildClassifiedSystem, effectiveProductAmount } from './build'
import { solveLP, type ShareLimit } from './solve'
import { computeNodeEffects, computeMachineMetrics } from './effects'
import { primaryItemId } from '../data/recipeItems'
import { orderBlocks } from './blockGraph'

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

  const recipeIds = [...new Set(gameRecipeNodes.map(n => n.recipeId))]

  const goalsMap = new Map(plan.goals.map(g => [g.itemId, g.rate]))

  const nodeEffectsMap = new Map(
    gameRecipeNodes.map(n => [n.recipeId, computeNodeEffects(n, gameData)]),
  )
  const productivityMap = new Map<string, number>()
  for (const n of gameRecipeNodes) {
    const effects = nodeEffectsMap.get(n.recipeId)!
    if (effects.productivityBonus > 0) {
      productivityMap.set(n.recipeId, effects.productivityBonus)
    }
  }

  const bcRecipeIds = new Set(
    gameRecipeNodes.filter(n => n.byproductConsumer).map(n => n.recipeId),
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

  for (const n of gameRecipeNodes) {
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
  for (const n of gameRecipeNodes) {
    if (n.pinnedRate !== undefined) {
      pinnedRates.set(n.recipeId, n.pinnedRate)
    }
  }

  // Share limits: one per recipe, last duplicate row wins (same rule as pins and
  // effects). A pin or an absorb flag on any row of the recipe wins over the limit.
  const limitByRecipe = new Map<string, ShareLimit>()
  for (const n of gameRecipeNodes) {
    if (n.maxShare === undefined) continue
    // Pins and absorb flags are per recipe, so they apply across duplicate rows.
    if (pinnedRates.has(n.recipeId) || bcRecipeIds.has(n.recipeId)) continue
    const itemId = primaryItemId(n, gameData.recipes[n.recipeId])
    if (!itemId) continue
    limitByRecipe.set(n.recipeId, { recipeId: n.recipeId, itemId, maxShare: n.maxShare })
  }
  const shareLimits = [...limitByRecipe.values()]

  // No-import set: user's explicit list, plus bc recipes' ingredients.
  // Auto-adding bc ingredients preserves the "consume surplus only, don't
  // trigger new ingredient production" semantics: with no slack allowed on
  // a bc ingredient, the LP can't import it just to fire the bc bonus —
  // it must come from an in-plan producer (or raw if no producer exists).
  const noImportItems = new Set(plan.noImportItems ?? [])
  for (const n of gameRecipeNodes) {
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
  let lp = solveLP(system, pinnedRates, bcRecipeIds, pass1NoImport, new Map(), shareLimits)

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
    lp = solveLP(system, pinnedRates, bcRecipeIds, pass2NoImport, pass2Caps, shareLimits)
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

/**
 * Solve every block in dependency order, feeding each block the net output its
 * sources still have on offer. Several consumers of one source are served in
 * solve order; several sources of one item are drained in connection order.
 */
export function solveAll(blocks: Block[], gameData: GameData): MultiBlockSolve {
  const { order, cyclicConnectionIds } = orderBlocks(blocks)
  const blockIds = new Set(blocks.map(b => b.id))
  const results: Record<string, SolverResult> = {}
  const errors: Record<string, string> = {}
  const flows: ConnectionFlow[] = []
  // blockId → itemId → items/min still on offer
  const remaining = new Map<string, Map<string, number>>()

  function ignoredFlow(block: Block, c: BlockConnection, status: ConnectionFlowStatus): ConnectionFlow {
    return {
      connectionId: c.id,
      fromBlockId: c.fromBlockId,
      toBlockId: block.id,
      itemId: c.itemId,
      available: 0,
      rate: 0,
      status,
    }
  }

  for (const block of order) {
    const active: BlockConnection[] = []
    const available = new Map<string, number>() // connection id → items/min on offer
    const caps = new Map<string, number>()      // item id → total on offer
    const seen = new Set<string>()
    const duplicates = new Set<string>() // connection ids repeating an earlier (source, item) pair
    for (const c of block.inputConnections) {
      if (!blockIds.has(c.fromBlockId)) {
        flows.push(ignoredFlow(block, c, 'missing-source'))
      } else if (cyclicConnectionIds.has(c.id)) {
        flows.push(ignoredFlow(block, c, 'cycle'))
      } else {
        // A repeated (source, item) pair in hand-edited JSON must not double the offer.
        const key = `${c.fromBlockId}\0${c.itemId}`
        const duplicate = seen.has(key)
        if (duplicate) duplicates.add(c.id)
        const offer = duplicate ? 0 : remaining.get(c.fromBlockId)?.get(c.itemId) ?? 0
        seen.add(key)
        active.push(c)
        available.set(c.id, offer)
        caps.set(c.itemId, (caps.get(c.itemId) ?? 0) + offer)
      }
    }

    let result = emptyResult()
    let received = new Map<string, number>()
    const plan = flattenBlock(block)
    if (plan.goals.length > 0 && plan.nodes.length > 0) {
      try {
        ;({ result, received } = solveBlock(plan, gameData, caps))
      } catch (err) {
        errors[block.id] = err instanceof Error ? err.message : String(err)
        result = emptyResult()
        received = new Map()
      }
    }
    results[block.id] = result

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
        rate,
        status,
      })
    }

    const offers = new Map<string, number>()
    for (const [itemId, net] of netBalance(result.nodes)) {
      if (net > FLOW_TOLERANCE) offers.set(itemId, net)
    }
    remaining.set(block.id, offers)
  }

  return { results, flows, errors }
}
