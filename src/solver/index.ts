import type { SubPlan, GameData, SolverResult, SolvedNode, UnsatisfiedItem } from '../data/types'
import type { SyntheticRecipe } from './subplan'
import { buildClassifiedSystem, effectiveProductAmount } from './build'
import { solveLP } from './solve'
import { computeNodeEffects, computeMachineMetrics } from './effects'

export type { SyntheticRecipe } from './subplan'

type SolverPlan = Pick<SubPlan, 'goals' | 'nodes'> & { noImportItems?: string[] }

export function solve(
  plan: SolverPlan,
  gameData: GameData,
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  // All game-recipe nodes go into the LP. byproductConsumer is a flag that
  // applies a small negative bonus to the recipe's objective coefficient,
  // making the LP prefer to run it up to whatever surplus the intermediate
  // constraints allow — without overriding goal-meeting decisions.
  const gameRecipeNodes = plan.nodes.filter(n => n.kind === 'game-recipe') as
    Extract<(typeof plan.nodes)[number], { kind: 'game-recipe' }>[]

  const rawRecipeIds = [
    ...gameRecipeNodes.map(n => n.recipeId),
    ...syntheticRecipes.keys(),
  ]
  const recipeIds = [...new Set(rawRecipeIds)]

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

  const { throughput: throughputMap, slack: slackMap, warnings, feasible: _feasible } =
    solveLP(system, pinnedRates, bcRecipeIds, noImportItems)

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

  // Detect too-many-alternatives: multiple recipes with non-zero throughput
  // all producing the same goal or intermediate item.
  const ACTIVE_THRESHOLD = 1e-6
  const producersByItem = new Map<string, string[]>()
  for (const [itemId, rowS] of system.S) {
    if (!system.classification.goals.has(itemId) && !system.classification.intermediates.has(itemId)) continue
    const activeProducers: string[] = []
    for (const [recipeId, coeff] of rowS) {
      if (coeff > 0 && (throughputMap.get(recipeId) ?? 0) > ACTIVE_THRESHOLD) {
        activeProducers.push(recipeId)
      }
    }
    if (activeProducers.length > 1) {
      producersByItem.set(itemId, activeProducers)
    }
  }
  if (producersByItem.size > 0) {
    const allAmbiguousRecipes = [...new Set([...producersByItem.values()].flat())]
    warnings.push({ type: 'too-many-alternatives', recipeIds: allAmbiguousRecipes })
  }

  const nodes: SolvedNode[] = []

  for (const planNode of gameRecipeNodes) {
    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue

    const throughput = throughputMap.get(planNode.recipeId) ?? 0
    const effects = nodeEffectsMap.get(planNode.recipeId)!
    const prodBonus = productivityMap.get(planNode.recipeId) ?? 0

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

  for (const [syntheticId, synthetic] of syntheticRecipes) {
    const throughput = throughputMap.get(syntheticId) ?? 0
    const inputRates: Record<string, number> = {}
    for (const ing of synthetic.ingredients) {
      inputRates[ing.itemId] = ing.amount * throughput
    }
    const outputRates: Record<string, number> = {}
    for (const prod of synthetic.products) {
      outputRates[prod.itemId] = prod.amount * throughput
    }
    nodes.push({
      recipeNodeId: synthetic.subPlanId,
      inputRates,
      outputRates,
      throughput,
      machineCountExact: 0,
      machineCountCeil: 0,
      powerKw: 0,
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
    if (totalConsumption > 0) {
      rawConsumption.push({ itemId, rate: totalConsumption })
    }
  }

  // Ordering: goal shortfalls first, then intermediate slack, then raw consumption.
  const unsatisfied: UnsatisfiedItem[] = [...goalShortfalls, ...slackIntermediates, ...rawConsumption]

  return { nodes, unsatisfied, warnings }
}
