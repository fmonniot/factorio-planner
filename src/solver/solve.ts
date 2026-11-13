import solver, { type SolveResult } from 'javascript-lp-solver'
import type { ClassifiedSystem } from './build'
import type { SolverWarning } from '../data/types'
import { temperatureRows } from './temperatureRows'

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
  /**
   * Goal item → items/min the elastic solve left short (see `boundShortfall`); only entries above
   * `SLACK_TOLERANCE`. Empty when the plain LP was feasible.
   */
  shortfall: Map<string, number>
}

/** Sanitize a string to be a valid LP variable / constraint name. */
function lpName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

export const BIG_M = 1e6
export const SLACK_TOLERANCE = 1e-6
/**
 * Tiny negative coefficient applied to byproduct-consumer recipes in the
 * objective. Makes the LP prefer to run them up to the surplus their
 * intermediate constraints allow, without overriding goal-meeting decisions
 * (BIG_M slack cost dominates if the LP would have to import inputs).
 */
export const BC_BONUS = -0.01
/**
 * Objective cost per unit imported of a byproducts-first item (instead of BIG_M).
 * > 0: output that recipes make anyway is used before importing (at 0 the LP may import and leave that output as surplus).
 * << 1 (a recipe run): a recipe runs only for the item if one run replaced more than 1e5 imported units
 *   (the bundled data sets yield at most 5000 per run: nullius-boxed-wood-chip-burning; Seablock max 1500).
 * Above the shipping cost SHIP_COST·(1 + RANK_STEP·area) in areas.ts (1e-6 up to ~1e-5) for areas below ~90, so another
 *   area's output is shipped before importing; at area 90 the two are equal (a tie), beyond it shipping costs more.
 * 1000x the solver's 1e-8 pivot precision.
 */
export const BYPRODUCTS_FIRST_SLACK_COST = 1e-5
/**
 * The elastic solve's bound on the total shortfall: the minimum `D` found by the first stage, relaxed by
 * `D·SHORTFALL_REL + SHORTFALL_ABS` per goal row. The solver rounds each returned value to 1e-8 and
 * pivots at 1e-8 (see areas.ts), so `D` can be off by about 1e-8 per term; 1e-6 per goal stays well above
 * that. A looser bound costs no accuracy: the second solve still charges `BIG_M` per unit short.
 */
export const SHORTFALL_REL = 1e-7
export const SHORTFALL_ABS = 1e-6

/** The LP rows and columns of a classified system, before any objective is chosen beyond `__obj__`. */
export interface LPModel {
  constraints: Record<string, { min?: number; max?: number; equal?: number }>
  variables: Record<string, Record<string, number>>
  /** recipe id → LP variable name */
  recipeToVar: Map<string, string>
  /** itemId → slack variable name */
  itemToSlack: Map<string, string>
  /** itemId → supply variable name */
  itemToSupply: Map<string, string>
  /** goal itemId → shortfall variable name (elastic models only) */
  goalToShort: Map<string, string>
}

/**
 * Build the elastic LP for the given classified system.
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
 *       (no cap row when the cap is infinite)
 *     - Connections-first items: u_i + Σ_{j∉BC, S_ij<0} S_ij * x_j ≤ 0
 *       (supply covers at most what non-byproduct-consumer recipes use)
 *     - Pinned recipes:     x_j = rate  (equality)
 *   Objective: minimize Σ c_j * x_j + Σ m_i * s_i
 *     where c_j = 1, or BC_BONUS for byproduct-consumer recipes, and m_i = BYPRODUCTS_FIRST_SLACK_COST
 *     for byproducts-first items, BIG_M otherwise; supply u_i is free,
 *     so it is used ahead of slack. Callers cap it at what own production can't cover.
 *
 * Slack s_i represents external import required for item i to balance.
 * BIG_M ensures the LP only uses slack when the network is genuinely infeasible; a byproducts-first
 * item's cheap slack instead lets the LP import it rather than run a recipe just to make it.
 * If pinned rates conflict, emits `infeasible-pins`.
 */
export function buildLPModel(
  system: ClassifiedSystem,
  pinnedRates: Map<string, number> = new Map(),
  bcRecipeIds: Set<string> = new Set(),
  noImportItems: Set<string> = new Set(),
  supplyCaps: Map<string, number> = new Map(),
  connectionsFirst: Set<string> = new Set(),
  byproductsFirst: Set<string> = new Set(),
  /** Give every goal row a shortfall variable (see `boundShortfall`). */
  elasticGoals = false,
): LPModel {
  const { S, recipes, classification } = system

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
    // Slack variable: one per row, coefficient +1 in the row and the item's import cost in the objective.
    const slackName = `slack_${lpName(itemId)}`
    itemToSlack.set(itemId, slackName)
    variables[slackName] = { __obj__: byproductsFirst.has(itemId) ? BYPRODUCTS_FIRST_SLACK_COST : BIG_M, [cName]: 1 }
    return cName
  }

  // Goal constraints: Σ S_ij * x_j ≥ d_i  (hard — no slack; products must be produced internally).
  // Elastic: Σ S_ij * x_j + h_i ≥ d_i. `__short` (cost 1) finds the least shortfall; `__obj__` charges BIG_M,
  // like an import, so that the solve within the bound keeps h_i at that least value instead of letting it
  // drift to the bound to save runs.
  const goalToShort = new Map<string, string>()
  let constraintIdx = 0
  for (const [itemId, rate] of classification.goals) {
    const rowS = S.get(itemId)
    if (!rowS) continue
    const goalIdx = constraintIdx
    const cName = `c${constraintIdx++}`
    constraints[cName] = { min: rate }
    for (const [recipeId, coeff] of rowS) {
      const varName = recipeToVar.get(recipeId)
      if (varName) variables[varName][cName] = (variables[varName][cName] ?? 0) + coeff
    }
    if (elasticGoals) {
      // Named after the goal's row, not its item: `lpName` can map a recipe or another goal to the same name.
      const shortName = `__short${goalIdx}`
      goalToShort.set(itemId, shortName)
      variables[shortName] = { __obj__: BIG_M, __short: 1, [cName]: 1 }
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
      variables[supplyName] = { __obj__: 0, [cName]: 1 }
      // An infinite cap (a probe's unlimited supply) needs no row.
      if (Number.isFinite(cap)) {
        constraints[capName] = { max: cap }
        variables[supplyName][capName] = 1
      }
      if (connectionsFirst.has(itemId)) {
        // Supply covers at most what the non-byproduct-consumer recipes use.
        // Without this row a free u_i could feed a byproduct consumer for its
        // bonus, and be unbounded when the cap is infinite.
        const useName = `supuse_${lpName(itemId)}`
        constraints[useName] = { max: 0 }
        variables[supplyName][useName] = 1
        for (const [recipeId, coeff] of S.get(itemId) ?? []) {
          if (coeff < 0 && !bcRecipeIds.has(recipeId)) {
            const varName = recipeToVar.get(recipeId)
            if (varName) variables[varName][useName] = coeff
          }
        }
      }
    }
  }

  // Fluid temperatures: Σ made at an acceptable temperature + imports + supply ≥ Σ taken by each set of
  // temperature-bounded consumers. Imports and supply fit any bound, so they sit in every row.
  for (const [itemId, f] of system.fluidTemperatures ?? []) {
    // An import or supply is what lets a mismatched fluid fall back to something; a row without one (a goal,
    // a fluid that cannot be imported) would force its consumers to zero or make the LP infeasible, so it
    // is left to the `temperature-mismatch` warning.
    if (!classification.intermediates.has(itemId)) continue
    const slackName = itemToSlack.get(itemId)
    const supplyName = itemToSupply.get(itemId)
    if (!slackName && !supplyName) continue
    for (const row of temperatureRows(f)) {
      const cName = `c${constraintIdx++}`
      constraints[cName] = { min: 0 }
      for (const [colId, coeff] of row) {
        const varName = recipeToVar.get(colId)
        if (varName) variables[varName][cName] = (variables[varName][cName] ?? 0) + coeff
      }
      if (slackName) variables[slackName][cName] = 1
      if (supplyName) variables[supplyName][cName] = 1
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

  return { constraints, variables, recipeToVar, itemToSlack, itemToSupply, goalToShort }
}

type LPConstraints = LPModel['constraints']
type LPVariables = LPModel['variables']

/** Solve `constraints` / `variables` for `optimize` (minimised); javascript-lp-solver does not modify them. */
export function runLP(optimize: string, constraints: LPConstraints, variables: LPVariables): SolveResult {
  return solver.Solve({ optimize, opType: 'min', constraints, variables }) as SolveResult
}

/**
 * Lexicographic shortfall of an elastic model (`buildLPModel(…, elasticGoals = true)`): first the least
 * total shortfall `D` over all goals, every other cost ignored, so a goal falls short only of what no
 * import, run or supply can make; then `Σ h_i ≤ D·(1 + SHORTFALL_REL) + SHORTFALL_ABS·n` (n goal rows) is
 * added to the model's constraints in place and `undefined` is returned, or the first stage's infeasible
 * result when even the elastic model is infeasible (pins or locks that conflict whatever the goals).
 * The sum is unweighted: when goals share a capped input, the least total goes to the goals that need
 * the least of it per unit, not in proportion to their rates.
 */
export function boundShortfall(lp: LPModel): SolveResult | undefined {
  const first = runLP('__short', lp.constraints, lp.variables)
  if (first.feasible !== true) return first
  let d = 0
  for (const name of lp.goalToShort.values()) d += Math.max(0, (first[name] as number | undefined) ?? 0)
  lp.constraints.__shortsum = { max: d * (1 + SHORTFALL_REL) + SHORTFALL_ABS * lp.goalToShort.size }
  for (const name of lp.goalToShort.values()) lp.variables[name].__shortsum = 1
  return undefined
}

/**
 * Read the throughput, slack and supply of a solved `lp`; infeasible pins are reported here. `lp` is the
 * elastic model when the plain one was infeasible: the pins then hold, and `infeasible-pins` still names them.
 */
export function readLPResult(
  result: SolveResult,
  lp: LPModel,
  recipes: string[],
  pinnedRates: Map<string, number>,
  feasible: boolean,
): LPResult {
  const { recipeToVar, itemToSlack, itemToSupply, goalToShort } = lp
  const warnings: SolverWarning[] = []

  // With hard goal constraints, LP can still be infeasible (no producer, or conflicting pins).
  if ((!feasible || goalToShort.size > 0) && pinnedRates.size > 0) {
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

  const shortfall = new Map<string, number>()
  if (feasible) {
    for (const [itemId, name] of goalToShort) {
      const val = result[name]
      if (typeof val === 'number' && val > SLACK_TOLERANCE) shortfall.set(itemId, val)
    }
  }

  return { throughput, slack, supply, warnings, feasible, shortfall }
}

/** Does any goal have a row in `S`? Without one, an elastic model is the plain one. */
export function hasGoalRow(system: ClassifiedSystem): boolean {
  for (const itemId of system.classification.goals.keys()) if (system.S.has(itemId)) return true
  return false
}

/**
 * Build and solve the elastic LP of `buildLPModel`. When it is infeasible (pins or locks that keep a goal
 * from being met), it is solved again with elastic goal rows (`boundShortfall`): pins and locks hold and
 * each goal reports what it lacks. If that is infeasible too, the first result is returned as it was.
 */
export function solveLP(
  system: ClassifiedSystem,
  pinnedRates: Map<string, number> = new Map(),
  bcRecipeIds: Set<string> = new Set(),
  noImportItems: Set<string> = new Set(),
  supplyCaps: Map<string, number> = new Map(),
  connectionsFirst: Set<string> = new Set(),
  byproductsFirst: Set<string> = new Set(),
): LPResult {
  const lp = buildLPModel(system, pinnedRates, bcRecipeIds, noImportItems, supplyCaps, connectionsFirst, byproductsFirst)
  const result = runLP('__obj__', lp.constraints, lp.variables)
  if (result.feasible === true || !hasGoalRow(system)) {
    return readLPResult(result, lp, system.recipes, pinnedRates, result.feasible === true)
  }
  const elastic = buildLPModel(
    system, pinnedRates, bcRecipeIds, noImportItems, supplyCaps, connectionsFirst, byproductsFirst, true,
  )
  if (boundShortfall(elastic) === undefined) {
    const second = runLP('__obj__', elastic.constraints, elastic.variables)
    if (second.feasible === true) return readLPResult(second, elastic, system.recipes, pinnedRates, true)
  }
  return readLPResult(result, lp, system.recipes, pinnedRates, false)
}
