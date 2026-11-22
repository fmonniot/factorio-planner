import solver, { type SolveResult } from 'javascript-lp-solver'
import type { ClassifiedSystem } from './build'
import type { SolverWarning } from '../data/types'
import { flowKey, isTemperatureTag, rangeDepth, versatility, type FluidRange } from '../data/flowKey'
import { isTemperatureKey, itemKeys } from './flowKeys'
import { absorberRoles, type AbsorberRoles } from './absorbers'

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
  /** What each supplied key (see `FlowKeys.supply`) took from each connection, per offered key; only entries > tolerance. Empty without supplied keys. */
  keySupplyUse: { key: string; connectionId: string; offeredKey: string; value: number }[]
  warnings: SolverWarning[]
  /** feasible flag from the LP solver */
  feasible: boolean
  /**
   * Goal item → items/min the elastic solve left short (see `boundShortfall`); only entries above
   * `SLACK_TOLERANCE`. Empty when the plain LP was feasible.
   */
  shortfall: Map<string, number>
  /** the absorber chains the model was built with (see `absorberRoles`) */
  absorbers: AbsorberRoles
}

/** Sanitize a string to be a valid LP variable / constraint name. */
function lpName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

export const BIG_M = 1e6
/**
 * Objective cost per unit of a conversion column (a made temperature moved to a range it fits, see build.ts): above
 * the solver's 1e-8 pivot precision, so the LP never converts for nothing (that would turn a surplus at one temperature
 * into one at "any"), and far below a run (1), the byproducts-first slack (1e-5) and SHIP_COST (1e-6).
 */
export const CONVERT_COST = 1e-7
/**
 * Objective cost per unit of a supplied key times its versatility (the number of the fluid's ranges it fits): each consumer prefers
 * the least versatile key that does for it, so a later consumer is not starved of the key only it can use (fluid temperatures,
 * decision 11). Like `CONVERT_COST` it sits above the solver's pivot precision and far below a run.
 */
export const SUPPLY_TIE_COST = 1e-7
/**
 * Weight of the depth term of a supplied conversion (R1 of the case 26 b derivation): the conversion of a supplied key into a
 * range costs `SUPPLY_TIE_COST · SUPPLY_DEPTH · N · (N − depth)`, N the number of the fluid's ranges, depth the number of ranges that
 * contain the target. The depth term moves in steps of N while versatility differences stay below N, so a short supply serves the narrowest
 * ranges first, then the least versatile key. With no shortage every range is covered, the term is constant and decision 11 alone decides.
 * 0 leaves decision 11 as written.
 */
export const SUPPLY_DEPTH: number = 1
export const SLACK_TOLERANCE = 1e-6
/**
 * Tiny negative coefficient applied to the rewarded recipes of an absorber chain (flagged byproduct
 * consumers that take a bounded item, see absorbers.ts) in the objective. Makes the LP prefer to run them
 * up to the surplus their intermediate constraints allow, without overriding goal-meeting decisions
 * (BIG_M slack cost dominates if the LP would have to import inputs). The rows that only feed them cost `feederCost` (about `CHAIN_COST`, absorbers.ts).
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
  /** the least total shortfall `D` `boundShortfall` found (elastic models, once bounded) */
  leastShortfall?: number
  /** the absorber chains of the system: which columns cost BC_BONUS or `feederCost` and which stay out of the supply-use rows */
  absorbers: AbsorberRoles
  /** the per-connection supply variables of the supplied keys */
  keySupplyVars: { name: string; key: string; connectionId: string; offeredKey: string }[]
}

/** Options of `buildLPModel` that few callers set. */
export interface LPBuildOptions {
  /** Rows marked to feed absorbing rows. */
  markedFeeders?: ReadonlySet<string>
  /** Items supplied by something other than `supplyCaps` (the areas' own supply rows). */
  extraSupplied?: ReadonlySet<string>
  /** split fluid → a cap on what its supplied keys take together (the pass-2 rule: own production first); Receive-it-first keys are not bounded by it */
  fluidCaps?: ReadonlyMap<string, number>
}

/** At most this many pins are probed one by one to tell which bind (see `bindingPins`). */
export const PIN_PROBE_LIMIT = 8

/** Name of the LP row that pins the recipe column `varName`. */
export function pinRowName(varName: string): string {
  return `pin_${varName}`
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
 *     - Connections-first items: u_i + Σ_{j∉N, S_ij<0} S_ij * x_j ≤ 0
 *       (supply covers at most what recipes outside N use; N = the flagged rows, or the whole chain in the fallback, see absorbers.ts)
 *     - Pinned recipes:     x_j = rate  (equality)
 *   Objective: minimize Σ c_j * x_j + Σ m_i * s_i
 *     where c_j = 1, BC_BONUS for the rewarded rows of an absorber chain (flagged byproduct consumers that take a
 *     bounded item), `feederCost` for the rows that only feed them (see absorbers.ts), and m_i = BYPRODUCTS_FIRST_SLACK_COST
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
  /** Items imported cheaply in some other way than `byproductsFirst` (the areas' own slacks); never bounded for an absorber. */
  extraCheapImports: ReadonlySet<string> = new Set(),
  options: LPBuildOptions = {},
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

  // Initialize variable entries. Regular recipes contribute +1 per unit throughput; the rewarded rows of an
  // absorber chain contribute BC_BONUS (a tiny negative number) so the LP prefers to run them up to the surplus
  // their intermediates allow, and the rows that only feed them cost `feederCost`.
  const cheapImports = new Set([...byproductsFirst, ...extraCheapImports].filter(itemId => !noImportItems.has(itemId)))
  // The items whose supply gets a supply-use row below: they never anchor an unflagged candidate (see absorbers.ts).
  const suppliedFirst = [...connectionsFirst].filter(i => classification.intermediates.has(i) && (supplyCaps.get(i) ?? 0) > 0)
  // A Receive-it-first supplied key is bounded by one row per fluid over the fluid's range keys (`supfu`), so those keys are supplied rows too.
  const rangeKeysOf = (fluid: string): string[] => itemKeys(system, fluid).filter(k => {
    const info = system.flow!.info.get(k)!
    return !info.supplied && !isTemperatureTag(info.tag) && !classification.goals.has(k)
  })
  const supplied = new Set([
    ...suppliedFirst,
    ...suppliedFirst.flatMap(i => (system.flow?.supply.has(i) ? rangeKeysOf(system.flow.supply.get(i)!.fluid) : [])),
    ...(options.extraSupplied ?? []),
  ])
  const absorbers = absorberRoles(system, bcRecipeIds, pinnedRates, cheapImports, {
    markedFeeders: options.markedFeeders, supplied,
  })
  // A conversion out of a supplied key also pays for the depth of the range it feeds (see `SUPPLY_DEPTH`).
  const conversionCost = (recipeId: string): number => {
    const flow = system.flow!
    const conv = flow.conversions.get(recipeId)!
    const from = flow.info.get(conv.from)
    if (!from?.supplied || SUPPLY_DEPTH === 0) return CONVERT_COST
    const ranges = flow.keySupply.get(from.itemId)?.ranges ?? []
    const n = ranges.length
    const depth = rangeDepth(flow.info.get(conv.to)!.tag as FluidRange, ranges)
    return CONVERT_COST + SUPPLY_TIE_COST * SUPPLY_DEPTH * n * Math.max(0, n - depth)
  }
  for (const recipeId of recipes) {
    const varName = recipeToVar.get(recipeId)!
    variables[varName] = {
      __obj__: system.flow?.conversions.has(recipeId) ? conversionCost(recipeId)
        : absorbers.rewarded.has(recipeId) ? BC_BONUS : (absorbers.feederCost.get(recipeId) ?? 1),
    }
  }

  // itemId → slack variable name (for post-solve extraction)
  const itemToSlack = new Map<string, string>()

  // itemId → supply variable name (for post-solve extraction)
  const itemToSupply = new Map<string, string>()

  // The LP name of a variable or row named after an item: a flow key sanitises to a name another key (or item) may share, so it gets a suffix.
  const named = (prefix: string, key: string): string => {
    const name = `${prefix}${lpName(key)}`
    if (!system.flow?.info.has(key)) return name
    let unique = name
    for (let n = 2; unique in variables || unique in constraints; n++) unique = `${name}_k${n}`
    return unique
  }

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
    // No-import items and the temperatures a block makes: hard constraint (no slack). LP becomes infeasible if
    // the network can't balance internally.
    if (noImportItems.has(itemId) || isTemperatureKey(system, itemId)) return cName
    // Slack variable: one per row, coefficient +1 in the row and the item's import cost in the objective.
    const slackName = named('slack_', itemId)
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

  // The supplied keys' per-connection variables (see below): rows shared by the (connection, offered key) and the connection.
  const keySupplyVars: LPModel['keySupplyVars'] = []
  const offerRows = new Map<string, string>() // (connection, offered key) → its `kcc` row
  const connectionVars = new Map<string, string[]>() // connection → its variables
  const aggregates = new Map<string, { free: string[]; first: string[] }>() // fluid → the supplied keys' aggregate variables
  const maxRateOf = new Map<string, number>()
  let linkRows = 0
  for (const ks of system.flow?.keySupply.values() ?? []) for (const [id, rate] of ks.maxRates) maxRateOf.set(id, rate)

  // Intermediate constraints: Σ S_ij * x_j + s_i ≥ 0  (elastic — slack allowed)
  for (const itemId of classification.intermediates) {
    const cName = addConstraintWithSlack(itemId, 0)
    const cap = supplyCaps.get(itemId) ?? 0
    const suppliedKey = system.flow?.supply.get(itemId)
    if (cap > 0) {
      const supplyName = named('supply_', itemId)
      const capName = named('supcap_', itemId)
      itemToSupply.set(itemId, supplyName)
      variables[supplyName] = { __obj__: 0, [cName]: 1 }
      // An infinite cap (a probe's unlimited supply) needs no row.
      if (Number.isFinite(cap)) {
        constraints[capName] = { max: cap }
        variables[supplyName][capName] = 1
      }
      if (suppliedKey) {
        // A supplied key: its aggregate is the sum of one variable per connection that offers the key, each costing the tie-break
        // (`SUPPLY_TIE_COST` times the versatility of the key) and bounded by the connection's offer of it and its `maxRate`.
        const flow = system.flow!
        const ks = flow.keySupply.get(suppliedKey.fluid)!
        const vers = versatility(flow.info.get(itemId)!.tag, ks.ranges)
        const agg = aggregates.get(suppliedKey.fluid) ?? { free: [], first: [] }
        aggregates.set(suppliedKey.fluid, agg)
        ;(connectionsFirst.has(itemId) ? agg.first : agg.free).push(supplyName)
        // The aggregate is the sum of the key's connection variables: one link row per key.
        const link = `ksl${linkRows++}`
        constraints[link] = { equal: 0 }
        variables[supplyName][link] = -1
        for (const o of ks.offers) {
          if (flowKey(suppliedKey.fluid, o.tag) !== suppliedKey.offeredKey) continue
          const name = `ksup${keySupplyVars.length}`
          variables[name] = { __obj__: SUPPLY_TIE_COST * vers, [link]: 1 }
          const offerKey = `${o.connectionId}\0${suppliedKey.offeredKey}`
          let offerRow = offerRows.get(offerKey)
          if (offerRow === undefined) {
            offerRow = `kcc${offerRows.size}`
            offerRows.set(offerKey, offerRow)
            constraints[offerRow] = { max: o.offer }
          }
          variables[name][offerRow] = 1
          connectionVars.set(o.connectionId, [...(connectionVars.get(o.connectionId) ?? []), name])
          keySupplyVars.push({ name, key: itemId, connectionId: o.connectionId, offeredKey: suppliedKey.offeredKey })
        }
      } else if (connectionsFirst.has(itemId)) {
        // Supply covers at most what the recipes outside the flagged rows use (the whole chain in the fallback, see absorbers.ts).
        // Without this row a free u_i could feed a flagged row for its bonus, and be
        // unbounded when the cap is infinite.
        const useName = named('supuse_', itemId)
        constraints[useName] = { max: 0 }
        variables[supplyName][useName] = 1
        for (const [recipeId, coeff] of S.get(itemId) ?? []) {
          if (coeff < 0 && !absorbers.noSupply.has(recipeId)) {
            const varName = recipeToVar.get(recipeId)
            if (varName) variables[varName][useName] = coeff
          }
        }
      }
    }
  }

  // The connection's `maxRate` caps the sum of its variables (over keys and areas); a lone variable is capped by its offer already.
  let rate = 0
  for (const [connectionId, names] of connectionVars) {
    const max = maxRateOf.get(connectionId)
    if (max === undefined || names.length < 2) continue
    const row = `kmr${rate++}`
    constraints[row] = { max }
    for (const name of names) variables[name][row] = 1
  }
  for (const [fluid, agg] of aggregates) {
    // Own production comes first: the supplied keys of a fluid take together at most what pass 2 allows.
    const cap = options.fluidCaps?.get(fluid)
    if (cap !== undefined && Number.isFinite(cap) && agg.free.length > 0) {
      const row = named('kfl_', fluid)
      constraints[row] = { max: cap }
      for (const name of agg.free) variables[name][row] = 1
    }
    // Receive it first: the supply covers at most what the rows outside the flagged ones take of the fluid's range keys.
    if (agg.first.length > 0) {
      const row = named('supfu_', fluid)
      constraints[row] = { max: 0 }
      for (const name of agg.first) variables[name][row] = 1
      for (const key of rangeKeysOf(fluid)) {
        for (const [recipeId, coeff] of S.get(key) ?? []) {
          if (coeff >= 0 || system.flow!.conversions.has(recipeId) || absorbers.noSupply.has(recipeId)) continue
          const varName = recipeToVar.get(recipeId)
          if (varName) variables[varName][row] = (variables[varName][row] ?? 0) + coeff
        }
      }
    }
  }

  // A split fluid's connected supply sits on each of its range keys: together they take at most its offer.
  for (const [fluid, offer] of system.flow?.offers ?? []) {
    if (!Number.isFinite(offer)) continue
    const names = itemKeys(system, fluid).map(k => itemToSupply.get(k)).filter((n): n is string => n !== undefined)
    if (names.length < 2) continue
    const row = named('supgrp_', fluid)
    constraints[row] = { max: offer }
    for (const n of names) variables[n][row] = 1
  }

  // Pinned rates: x_j = rate (equality via min + max).
  for (const [recipeId, rate] of pinnedRates) {
    const varName = recipeToVar.get(recipeId)
    if (!varName) continue
    const cName = pinRowName(varName)
    constraints[cName] = { equal: rate }
    variables[varName][cName] = 1
  }

  return { constraints, variables, recipeToVar, itemToSlack, itemToSupply, goalToShort, absorbers, keySupplyVars }
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
  lp.leastShortfall = d
  return undefined
}

/**
 * Which of `pinned` (recipe ids) keep the products short: those whose removal lowers the least total
 * shortfall `D` of the bounded elastic model `lp`. Each pin is probed by re-running the first-stage LP
 * with its row deleted; it binds when `D` falls by more than the bound's own tolerance. Diagnostic only:
 * nothing it returns feeds a result. With more than `PIN_PROBE_LIMIT` pins, or when no single pin
 * lowers `D` (several constraints jointly, or a lock, cap it), every pin is named.
 */
export function bindingPins(lp: LPModel, pinned: string[]): string[] {
  const d = lp.leastShortfall
  if (d === undefined || pinned.length > PIN_PROBE_LIMIT) return pinned
  const binding: string[] = []
  for (const id of pinned) {
    const v = lp.recipeToVar.get(id)
    if (v === undefined) continue
    const row = pinRowName(v)
    const constraints = { ...lp.constraints }
    delete constraints[row]
    const column = { ...lp.variables[v] }
    delete column[row]
    const result = runLP('__short', constraints, { ...lp.variables, [v]: column })
    if (result.feasible !== true) continue
    let dp = 0
    for (const name of lp.goalToShort.values()) dp += Math.max(0, (result[name] as number | undefined) ?? 0)
    if (d - dp > SHORTFALL_REL * d + SHORTFALL_ABS * lp.goalToShort.size) binding.push(id)
  }
  return binding.length > 0 ? binding : pinned
}

/**
 * Read the throughput, slack and supply of a solved `lp`; infeasible pins are reported here. `lp` is the
 * elastic model when the plain one was infeasible: the pins then hold, and `infeasible-pins` names the ones
 * that bind (`bindingPins`). When the elastic solve failed too, it names all pins and sets `conflict`.
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
    const pins = [...pinnedRates.keys()]
    warnings.push(feasible
      ? { type: 'infeasible-pins', recipeIds: bindingPins(lp, pins) }
      : { type: 'infeasible-pins', recipeIds: pins, conflict: true })
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

  const keySupplyUse: LPResult['keySupplyUse'] = []
  for (const v of lp.keySupplyVars) {
    const val = result[v.name]
    if (typeof val === 'number' && val > SLACK_TOLERANCE) keySupplyUse.push({ key: v.key, connectionId: v.connectionId, offeredKey: v.offeredKey, value: val })
  }

  return {
    throughput, slack, supply, keySupplyUse, warnings, feasible, shortfall, absorbers: lp.absorbers,
  }
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
  markedFeeders: ReadonlySet<string> = new Set(),
  options: { fluidCaps?: ReadonlyMap<string, number> } = {},
): LPResult {
  const build = (elastic: boolean) => buildLPModel(
    system, pinnedRates, bcRecipeIds, noImportItems, supplyCaps, connectionsFirst, byproductsFirst, elastic, new Set(),
    { markedFeeders, fluidCaps: options.fluidCaps },
  )
  const lp = build(false)
  const result = runLP('__obj__', lp.constraints, lp.variables)
  if (result.feasible === true || !hasGoalRow(system)) {
    return readLPResult(result, lp, system.recipes, pinnedRates, result.feasible === true)
  }
  const elastic = build(true)
  if (boundShortfall(elastic) === undefined) {
    const second = runLP('__obj__', elastic.constraints, elastic.variables)
    if (second.feasible === true) return readLPResult(second, elastic, system.recipes, pinnedRates, true)
  }
  return readLPResult(result, lp, system.recipes, pinnedRates, false)
}
