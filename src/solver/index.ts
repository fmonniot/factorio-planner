import type { GameData, SubPlan, SolverResult, SolvedNode, UnsatisfiedItem, SolverWarning } from '../data/types'
import type { SyntheticRecipe } from './subplan'
import { buildStoichiometryMatrix, effectiveProductAmount } from './build'
import { reduceSystem } from './reduce'
import { applyPinnedRates, mergeThroughput } from './pin'
import { solveSystem } from './solve'
import { computeNodeEffects, computeMachineMetrics } from './effects'

// ---------------------------------------------------------------------------
// Solver entry point
//
// This is the single function the UI calls. It orchestrates all solver steps:
//   build → reduce → pin → solve → effects → metrics
//
// Warnings are collected and surfaced in the result; they never throw.
//
// The optional syntheticRecipes map allows subplan nodes to be treated as
// opaque recipes whose stoichiometry is derived from a child plan's solve
// result. Each entry is keyed by its sentinel id ('__subplan__:<subPlanId>').
// ---------------------------------------------------------------------------

/**
 * Solve a plan against the given game data and return the full solver result.
 *
 * @param plan             - the user's production plan
 * @param gameData         - validated game data
 * @param syntheticRecipes - optional map of synthetic recipes for subplan nodes
 */
export function solve(
  plan: Pick<SubPlan, 'goals' | 'nodes'>,
  gameData: GameData,
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  const warnings: SolverWarning[] = []

  // ── 1. Compute module effects per node (game-recipe nodes only) ──────────
  const nodeEffectsMap = new Map(
    plan.nodes
      .filter(n => n.kind === 'game-recipe')
      .map(n => [n.recipeId, computeNodeEffects(n, gameData)]),
  )

  // ── 2. Productivity map (skip recipes that disallow it) ─────────────────
  const productivityMap = new Map<string, number>()
  for (const n of plan.nodes) {
    if (n.kind !== 'game-recipe') continue
    const recipe = gameData.recipes[n.recipeId]
    const effects = nodeEffectsMap.get(n.recipeId)!
    if (recipe && !recipe.allowProductivity && effects.productivityBonus > 0) {
      warnings.push({ type: 'productivity-not-allowed', recipeId: n.recipeId })
    } else if (effects.productivityBonus > 0) {
      productivityMap.set(n.recipeId, effects.productivityBonus)
    }
  }

  // ── 3. Build stoichiometry matrix ────────────────────────────────────────
  // Game-recipe nodes come from the plan; child subplans are implicit — every
  // synthetic recipe passed in participates automatically (no explicit wiring).
  const recipeIds: string[] = [
    ...plan.nodes.filter(n => n.kind === 'game-recipe').map(n => n.recipeId),
    ...syntheticRecipes.keys(),
  ]
  const matrix = buildStoichiometryMatrix(gameData, recipeIds, productivityMap, syntheticRecipes)

  // ── 3b. Apply byproductPolicy: zero out discarded products ───────────────
  // Only game-recipe nodes carry a byproduct policy.
  for (const planNode of plan.nodes) {
    if (planNode.kind !== 'game-recipe') continue
    const j = matrix.recipeIndex.get(planNode.recipeId)
    if (j === undefined) continue
    for (const [itemId, policy] of Object.entries(planNode.byproductPolicy)) {
      if (policy === 'discard') {
        const i = matrix.itemIndex.get(itemId)
        if (i !== undefined && matrix.S[i][j] > 0) {
          matrix.S[i][j] = 0
        }
      }
    }
  }

  // ── 4. Check for goals with no producer in the active recipe set ─────────
  const goalsMap = new Map(plan.goals.map(g => [g.itemId, g.rate]))
  for (const [itemId] of goalsMap) {
    const rowIdx = matrix.itemIndex.get(itemId)
    const hasProducer =
      rowIdx !== undefined && matrix.S[rowIdx].some(v => v > 0)
    if (!hasProducer) {
      warnings.push({ type: 'no-recipe', itemId })
    }
  }

  // ── 5. Reduce system ─────────────────────────────────────────────────────
  const system = reduceSystem(matrix, goalsMap)

  // ── 6. Apply pinned rates ────────────────────────────────────────────────
  const pinnedRates = new Map<string, number>()
  for (const n of plan.nodes) {
    if (n.kind === 'game-recipe' && n.pinnedRate !== undefined) {
      pinnedRates.set(n.recipeId, n.pinnedRate)
    }
  }
  const pinned = applyPinnedRates(system.S, system.d, matrix.recipes, pinnedRates)

  // ── 7. Solve ─────────────────────────────────────────────────────────────
  const solveResult = solveSystem(pinned.S, pinned.d, pinned.freeRecipeIds)
  warnings.push(...solveResult.warnings)

  // ── 8. Merge full throughput vector ─────────────────────────────────────
  const fullThroughput = mergeThroughput(
    solveResult.throughput,
    pinned.freeRecipeIds,
    matrix.recipes,
    pinnedRates,
  )
  const throughputMap = new Map(
    matrix.recipes.map((id, j) => [id, fullThroughput[j]]),
  )

  // ── 9. Build SolvedNode per plan node and per implicit subplan ──────────
  const nodes: SolvedNode[] = []

  // Game-recipe nodes
  for (const planNode of plan.nodes) {
    if (planNode.kind !== 'game-recipe') continue
    const recipe = gameData.recipes[planNode.recipeId]
    if (!recipe) continue

    const throughput = throughputMap.get(planNode.recipeId) ?? 0
    const effects = nodeEffectsMap.get(planNode.recipeId)!
    const prodBonus = productivityMap.get(planNode.recipeId) ?? 0

    // Machine metrics (use node's machineId or the default for this category).
    const machineId =
      planNode.machineId ?? gameData.defaultMachines[recipe.category]
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

    // Input rates: raw ingredients consumed per minute.
    const inputRates: Record<string, number> = {}
    for (const ing of recipe.ingredients) {
      inputRates[ing.itemId] = (inputRates[ing.itemId] ?? 0) + ing.amount * throughput
    }

    // Output rates: effective production per minute (accounting for productivity).
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

  // Implicit subplan nodes — one SolvedNode per synthetic recipe.
  // recipeNodeId is the subPlanId so TreeView can match it to subPlan.subPlans.
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

  // ── 10. Unsatisfied items (raw resources consumed by the plan) ──────────
  const unsatisfied: UnsatisfiedItem[] = []
  for (const itemId of system.rawItems) {
    const rowIdx = matrix.itemIndex.get(itemId)
    if (rowIdx === undefined) continue
    let totalConsumption = 0
    for (let j = 0; j < matrix.recipes.length; j++) {
      const net = matrix.S[rowIdx][j]
      if (net < 0) totalConsumption += Math.abs(net) * fullThroughput[j]
    }
    if (totalConsumption > 0) {
      unsatisfied.push({ itemId, rate: totalConsumption })
    }
  }

  return { nodes, unsatisfied, warnings }
}
