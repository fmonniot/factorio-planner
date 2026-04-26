import solver from 'javascript-lp-solver'
import type { ClassifiedSystem } from './build'
import type { SolverWarning } from '../../data/types'

// ---------------------------------------------------------------------------
// LP construction and solve
// ---------------------------------------------------------------------------

export interface LPResult {
  /** throughput for each recipe (recipe id → items/min of recipe executions) */
  throughput: Map<string, number>
  warnings: SolverWarning[]
  /** feasible flag from the LP solver */
  feasible: boolean
}

/** Sanitize a string to be a valid LP variable / constraint name. */
function lpName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * Build and solve the LP for the given classified system.
 *
 * LP formulation:
 *   Variables: x_j ≥ 0 for each recipe j
 *   Constraints:
 *     - Goal items:         Σ S_ij * x_j ≥ d_i
 *     - Intermediate items: Σ S_ij * x_j ≥ 0
 *     - Pinned recipes:     x_j = rate  (equality)
 *   Objective: minimize Σ x_j
 *
 * If the LP is infeasible and pinnedRates is non-empty, emits `infeasible-pins`.
 */
export function solveLP(
  system: ClassifiedSystem,
  pinnedRates: Map<string, number> = new Map(),
): LPResult {
  const { S, recipes, classification } = system
  const warnings: SolverWarning[] = []

  // Build recipe-name ↔ sanitized-LP-name mapping (handle collisions).
  const recipeToVar = new Map<string, string>()
  const usedNames = new Set<string>()
  for (const recipeId of recipes) {
    let name = lpName(recipeId)
    if (usedNames.has(name)) {
      let i = 2
      while (usedNames.has(`${name}_${i}`)) i++
      name = `${name}_${i}`
    }
    usedNames.add(name)
    recipeToVar.set(recipeId, name)
  }

  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {}
  const variables: Record<string, Record<string, number>> = {}

  // Initialize variable entries (each participates in the objective with coeff 1).
  for (const recipeId of recipes) {
    const varName = recipeToVar.get(recipeId)!
    variables[varName] = { __obj__: 1 }
  }

  // Goal constraints: Σ S_ij * x_j ≥ d_i
  let constraintIdx = 0
  for (const [itemId, rate] of classification.goals) {
    const rowS = S.get(itemId)
    if (!rowS) continue
    const cName = `c${constraintIdx++}`
    constraints[cName] = { min: rate }
    for (const [recipeId, coeff] of rowS) {
      const varName = recipeToVar.get(recipeId)
      if (varName) variables[varName][cName] = (variables[varName][cName] ?? 0) + coeff
    }
  }

  // Intermediate constraints: Σ S_ij * x_j ≥ 0
  for (const itemId of classification.intermediates) {
    const rowS = S.get(itemId)
    if (!rowS) continue
    const cName = `c${constraintIdx++}`
    constraints[cName] = { min: 0 }
    for (const [recipeId, coeff] of rowS) {
      const varName = recipeToVar.get(recipeId)
      if (varName) variables[varName][cName] = (variables[varName][cName] ?? 0) + coeff
    }
  }

  // Pinned rates: x_j = rate (equality via min + max).
  for (const [recipeId, rate] of pinnedRates) {
    const varName = recipeToVar.get(recipeId)
    if (!varName) continue
    const cName = `pin_${varName}`
    constraints[cName] = { equal: rate }
    variables[varName][cName] = 1
  }

  const model = {
    optimize: '__obj__',
    opType: 'min' as const,
    constraints,
    variables,
  }

  const result = solver.Solve(model)
  const feasible = result.feasible === true

  if (!feasible && pinnedRates.size > 0) {
    warnings.push({ type: 'infeasible-pins', recipeIds: [...pinnedRates.keys()] })
  }

  const throughput = new Map<string, number>()
  for (const recipeId of recipes) {
    const varName = recipeToVar.get(recipeId)!
    const val = result[varName]
    throughput.set(recipeId, typeof val === 'number' ? Math.max(0, val) : 0)
  }

  // For pinned recipes, ensure the throughput matches the pin when feasible.
  if (feasible) {
    for (const [recipeId, rate] of pinnedRates) {
      throughput.set(recipeId, rate)
    }
  }

  return { throughput, warnings, feasible }
}
