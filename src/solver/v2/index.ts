import type { SubPlan, GameData, SolverResult, SolvedNode, UnsatisfiedItem } from '../../data/types'
import type { SyntheticRecipe } from '../v1/subplan'
import { buildClassifiedSystem, effectiveProductAmount } from './build'
import { solveLP } from './solve'
import { computeNodeEffects, computeMachineMetrics } from '../v1/effects'

// ---------------------------------------------------------------------------
// v2 solver entry point
// ---------------------------------------------------------------------------

export function solve(
  plan: Pick<SubPlan, 'goals' | 'nodes'>,
  gameData: GameData,
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  // Split nodes: byproduct-consumer recipes are excluded from the LP and have
  // their throughput computed post-solve from item surplus (same as v1).
  const mainNodes = plan.nodes.filter(
    n => n.kind !== 'game-recipe' || !n.byproductConsumer,
  )
  const bcPlanNodes = plan.nodes.filter(
    n => n.kind === 'game-recipe' && n.byproductConsumer,
  ) as Extract<(typeof plan.nodes)[number], { kind: 'game-recipe' }>[]

  const rawRecipeIds = [
    ...mainNodes.filter(n => n.kind === 'game-recipe').map(n => n.recipeId),
    ...syntheticRecipes.keys(),
  ]
  const recipeIds = [...new Set(rawRecipeIds)]

  const goalsMap = new Map(plan.goals.map(g => [g.itemId, g.rate]))

  const nodeEffectsMap = new Map(
    mainNodes
      .filter(n => n.kind === 'game-recipe')
      .map(n => [n.recipeId, computeNodeEffects(n, gameData)]),
  )
  const bcEffectsMap = new Map(
    bcPlanNodes.map(n => [n.recipeId, computeNodeEffects(n, gameData)]),
  )
  const productivityMap = new Map<string, number>()
  for (const n of mainNodes) {
    if (n.kind !== 'game-recipe') continue
    const effects = nodeEffectsMap.get(n.recipeId)!
    if (effects.productivityBonus > 0) {
      productivityMap.set(n.recipeId, effects.productivityBonus)
    }
  }

  const system = buildClassifiedSystem(gameData, recipeIds, goalsMap, productivityMap)

  for (const n of mainNodes) {
    if (n.kind !== 'game-recipe') continue
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
  for (const n of mainNodes) {
    if (n.kind === 'game-recipe' && n.pinnedRate !== undefined) {
      pinnedRates.set(n.recipeId, n.pinnedRate)
    }
  }

  const { throughput: throughputMap, warnings, feasible: _feasible } = solveLP(system, pinnedRates)

  // bc post-pass: compute per-item net surplus from main solve.
  const itemSurplus = new Map<string, number>()
  for (const [itemId, rowS] of system.S) {
    let net = 0
    for (const [recipeId, coeff] of rowS) {
      net += coeff * (throughputMap.get(recipeId) ?? 0)
    }
    itemSurplus.set(itemId, net)
  }

  const bcThroughputMap = new Map<string, number>()
  for (const planNode of bcPlanNodes) {
    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue
    let throughput = Infinity
    for (const ing of recipe.ingredients) {
      const surplus = itemSurplus.get(ing.itemId) ?? 0
      if (surplus > 0 && ing.amount > 0) {
        throughput = Math.min(throughput, surplus / ing.amount)
      }
    }
    if (!isFinite(throughput)) throughput = 0
    bcThroughputMap.set(planNode.recipeId, throughput)
    for (const ing of recipe.ingredients) {
      const s = itemSurplus.get(ing.itemId) ?? 0
      itemSurplus.set(ing.itemId, Math.max(0, s - ing.amount * throughput))
    }
  }

  // Detect overconstrained intermediates: positive net flow after bc consumption.
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

  for (const planNode of mainNodes) {
    if (planNode.kind !== 'game-recipe') continue
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

  for (const planNode of bcPlanNodes) {
    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue

    const throughput = bcThroughputMap.get(planNode.recipeId) ?? 0
    const effects = bcEffectsMap.get(planNode.recipeId)!

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
      const effective = effectiveProductAmount(prod.amount ?? 0, prod.probability ?? 1, prod.ignoredByProductivity ?? 0, 0)
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

  let unsatisfied: UnsatisfiedItem[] = []
  for (const itemId of system.classification.raw) {
    const row = system.S.get(itemId)
    if (!row) continue
    let totalConsumption = 0
    for (const [recipeId, coeff] of row) {
      if (coeff < 0) {
        totalConsumption += Math.abs(coeff) * (throughputMap.get(recipeId) ?? 0)
      }
    }
    if (totalConsumption > 0) {
      unsatisfied.push({ itemId, rate: totalConsumption })
    }
  }

  // Goal shortfall pass: if the net production of a goal item across all built
  // nodes (LP + bc + synthetic) is less than the goal rate, surface the deficit
  // as an unsatisfied entry so the Ingredients pane shows what must come from
  // outside. Always checked — not gated on _feasible — because the bc post-pass
  // can cause a shortfall even when the LP is nominally feasible.
  const GOAL_SHORTFALL_TOLERANCE = 1e-4
  const unsatisfiedIds = new Set(unsatisfied.map(u => u.itemId))
  const goalShortfalls: UnsatisfiedItem[] = []

  for (const goal of plan.goals) {
    if (unsatisfiedIds.has(goal.itemId)) continue
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

  // Goal shortfalls first so the UI surfaces them before raw ingredients.
  unsatisfied = [...goalShortfalls, ...unsatisfied]

  return { nodes, unsatisfied, warnings }
}
