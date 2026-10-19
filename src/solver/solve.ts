import solver, { type SolveResult } from 'javascript-lp-solver'
import type { ClassifiedSystem } from './build'
import type { SolverWarning } from '../data/types'

// ---------------------------------------------------------------------------
// LP construction and solve
// ---------------------------------------------------------------------------

export interface LPResult {
  /** throughput for each recipe (recipe id → items/min of recipe executions) */
  throughput: Map<string, number>
  /** external import required per item (itemId → rate); only entries > tolerance */
  slack: Map<string, number>
  /** items/min taken from `supplyCaps` per item; only entries > tolerance */
  supply: Map<string, number>
  warnings: SolverWarning[]
  /** feasible flag from the LP solver */
  feasible: boolean
}

/** Sanitize a string to be a valid LP variable / constraint name. */
function lpName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

const BIG_M = 1e6
const SLACK_TOLERANCE = 1e-6
/**
 * Tiny negative coefficient applied to byproduct-consumer recipes in the
 * objective. Makes the LP prefer to run them up to the surplus their
 * intermediate constraints allow, without overriding goal-meeting decisions
 * (BIG_M slack cost dominates if the LP would have to import inputs).
 */
const BC_BONUS = -0.01
/**
 * Cost per item/min a recipe goes over its share limit. Far above recipe costs
 * (the limit holds whenever it can) and far below BIG_M (going over always
 * comes before importing).
 */
const SHARE_PENALTY = 1e3

/** Upper bound on a recipe's share of the producers' output of one item. */
export interface ShareLimit {
  recipeId: string
  itemId: string
  /** 0 < maxShare < 1 */
  maxShare: number
}

/**
 * Build and solve the elastic LP for the given classified system.
 *
 * LP formulation:
 *   Variables:
 *     x_j ≥ 0  for each recipe j (throughput)
 *     s_i ≥ 0  for each intermediate item i not in noImportItems (external import slack)
 *     u_i ≥ 0  for each intermediate item i with a supply cap (supply from another block)
 *   Constraints:
 *     - Goal items:         Σ S_ij * x_j ≥ d_i        (hard, no slack)
 *     - Intermediate items: Σ S_ij * x_j + s_i ≥ 0
 *     - Intermediate items with a cap: Σ S_ij * x_j + s_i + u_i ≥ 0,  u_i ≤ cap_i
 *     - Pinned recipes:     x_j = rate  (equality)
 *     - Share limits:       (1 − s)·S_if·x_f − s·Σ_{j≠f} S_ij·x_j − o_k ≤ 0
 *                           (f = limited recipe, producers only; o_k ≥ 0 is the overshoot)
 *   Objective: minimize Σ c_j * x_j + BIG_M * Σ s_i + SHARE_PENALTY * Σ o_k
 *     where c_j = 1, or BC_BONUS for byproduct-consumer recipes; supply u_i is free,
 *     so it is used ahead of slack. Callers cap it at what own production can't cover.
 *
 * Slack s_i represents external import required for item i to balance.
 * BIG_M ensures the LP only uses slack when the network is genuinely infeasible.
 * If pinned rates conflict, emits `infeasible-pins`.
 */
export function solveLP(
  system: ClassifiedSystem,
  pinnedRates: Map<string, number> = new Map(),
  bcRecipeIds: Set<string> = new Set(),
  noImportItems: Set<string> = new Set(),
  supplyCaps: Map<string, number> = new Map(),
  shareLimits: ShareLimit[] = [],
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

  // Initialize variable entries. Regular recipes contribute +1 per unit
  // throughput; byproduct-consumer recipes contribute BC_BONUS (a tiny
  // negative number) so the LP prefers to run them up to the surplus their
  // intermediates allow.
  for (const recipeId of recipes) {
    const varName = recipeToVar.get(recipeId)!
    variables[varName] = { __obj__: bcRecipeIds.has(recipeId) ? BC_BONUS : 1 }
  }

  // itemId → slack variable name (for post-solve extraction)
  const itemToSlack = new Map<string, string>()

  // itemId → supply variable name (for post-solve extraction)
  const itemToSupply = new Map<string, string>()

  /** Adds the row for itemId and returns its constraint name. */
  function addConstraintWithSlack(itemId: string, rhs: number): string {
    const rowS = S.get(itemId)
    const cName = `c${constraintIdx++}`
    constraints[cName] = { min: rhs }
    if (rowS) {
      for (const [recipeId, coeff] of rowS) {
        const varName = recipeToVar.get(recipeId)
        if (varName) variables[varName][cName] = (variables[varName][cName] ?? 0) + coeff
      }
    }
    // No-import items: hard constraint (no slack). LP becomes infeasible if
    // the network can't balance internally.
    if (noImportItems.has(itemId)) return cName
    // Slack variable: one per row, coefficient +1 in the row and BIG_M in objective.
    const slackName = `slack_${lpName(itemId)}`
    itemToSlack.set(itemId, slackName)
    variables[slackName] = { __obj__: BIG_M, [cName]: 1 }
    return cName
  }

  // Goal constraints: Σ S_ij * x_j ≥ d_i  (hard — no slack; products must be produced internally)
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

  // Intermediate constraints: Σ S_ij * x_j + s_i ≥ 0  (elastic — slack allowed)
  for (const itemId of classification.intermediates) {
    const cName = addConstraintWithSlack(itemId, 0)
    const cap = supplyCaps.get(itemId) ?? 0
    if (cap > 0) {
      const supplyName = `supply_${lpName(itemId)}`
      const capName = `supcap_${lpName(itemId)}`
      itemToSupply.set(itemId, supplyName)
      constraints[capName] = { max: cap }
      variables[supplyName] = { __obj__: 0, [cName]: 1, [capName]: 1 }
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

  // Share limits: the flagged recipe makes at most `maxShare` of the item's
  // total production. Soft (overshoot variable) because a hard cap can make the
  // goal unreachable, e.g. when another recipe on the item is pinned.
  shareLimits.forEach((limit, k) => {
    const rowS = S.get(limit.itemId)
    if (!rowS) return
    if (!((rowS.get(limit.recipeId) ?? 0) > 0)) return
    const producers = [...rowS].filter(([, coeff]) => coeff > 0)
    if (producers.length < 2) return
    const cName = `share_${k}`
    const overName = `shover_${k}`
    constraints[cName] = { max: 0 }
    for (const [recipeId, coeff] of producers) {
      const varName = recipeToVar.get(recipeId)
      if (!varName) continue
      const factor = recipeId === limit.recipeId ? 1 - limit.maxShare : -limit.maxShare
      variables[varName][cName] = (variables[varName][cName] ?? 0) + factor * coeff
    }
    variables[overName] = { __obj__: SHARE_PENALTY, [cName]: -1 }
  })

  const model = {
    optimize: '__obj__',
    opType: 'min' as const,
    constraints,
    variables,
  }

  const result = solver.Solve(model) as SolveResult
  const feasible = result.feasible === true

  // With hard goal constraints, LP can still be infeasible (no producer, or conflicting pins).
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

  const slack = new Map<string, number>()
  for (const [itemId, slackName] of itemToSlack) {
    const val = result[slackName]
    if (typeof val === 'number' && val > SLACK_TOLERANCE) {
      slack.set(itemId, val)
    }
  }

  const supply = new Map<string, number>()
  for (const [itemId, supplyName] of itemToSupply) {
    const val = result[supplyName]
    if (typeof val === 'number' && val > SLACK_TOLERANCE) {
      supply.set(itemId, val)
    }
  }

  return { throughput, slack, supply, warnings, feasible }
}
