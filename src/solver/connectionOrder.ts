import type { ClassifiedSystem } from './build'
import { FLOW_TOLERANCE, itemGrossFlow, surplusTolerance, type KeySupplyPlan } from './blockResult'
import { fluidSupply, itemKeys } from './flowKeys'
import { BIG_M, buildLPModel, readLPResult, runLP, type LPModel, type LPResult } from './solve'

// ---------------------------------------------------------------------------
// A connection replaces an import (sourcing priority phase 6)
// ---------------------------------------------------------------------------

/**
 * Per-term slack of the bounds carried from one step to the next. javascript-lp-solver rounds each returned
 * value to 1e-8 (absolute), so a sum of n returned values is off by up to n·5e-9; the bound must stay above
 * the true least value. It is absolute only: the next step takes supply at no cost and runs cost 1, so it
 * spends all the room the bound leaves (a relative 1e-9 on 1e5 received let an item made at 200 runs per
 * unit be received at 4e-4). Below r·k = BIG_M (r the ratio of a loop, k the runs per unit of another chain)
 * the drift stays below FLOW_TOLERANCE. Limit, measured by the T1 investigator (report, point 5): from
 * r·k >= BIG_M a step trades the room of the bound for runs and the result drifts by about n·1e-8·r, above
 * FLOW_TOLERANCE (3e-4 of 1e5 W at r = 1e4). The two 1e4:1 blocks of connectionOrder.test.ts (r·k = 2e6 on the
 * second) show no drift, so the shape that drifts is not pinned by any test.
 */
const ORDER_ABS = 1e-8
/** If a step is infeasible at the tight bound (solver rounding), it is retried once with the bound this much looser. */
const ORDER_RETRY = 100

/** What `connectionOrder` reads of the block: the same inputs as the two passes of `solveBlock`. */
export interface ConnectionOrderInput {
  system: ClassifiedSystem
  pinnedRates: Map<string, number>
  bcRecipeIds: Set<string>
  /** Rows marked to feed absorbing rows. */
  markedFeeders: Set<string>
  /** Pass 1's no-import set: the block's locked items less the connected ones. */
  pass1NoImport: Set<string>
  /** The block's locked items (Import off, byproduct consumers' ingredients). */
  locked: Set<string>
  byproductsFirst: Set<string>
  /** Connections-first items (supplied in every pass, capped by the offer only). */
  firstItems: Set<string>
  /** Offer per connected item (above `FLOW_TOLERANCE`). */
  totalCaps: Map<string, number>
  /** The result today's two passes end with. */
  today: LPResult
  /** split fluid → Σ of what its connections offer: the cap of its supplied keys together */
  fluidCaps?: ReadonlyMap<string, number>
  /** the fluids with supplied keys (see `KeySupplyPlan`) */
  keySupply?: KeySupplyPlan
}

/** The items whose order the steps change: connected intermediates with the default rule (locked ones included). */
function defaultItems(input: ConnectionOrderInput): string[] {
  const { totalCaps, system, byproductsFirst, firstItems } = input
  return [...totalCaps.keys()].filter(itemId =>
    system.classification.intermediates.has(itemId) && !byproductsFirst.has(itemId) && !firstItems.has(itemId))
}

/** Total import of an LP result, as the steps count it: every slack except the cheap one of *Don't make more here*. */
function importOf(lp: LPResult, byproductsFirst: Set<string>): number {
  let total = 0
  for (const [itemId, rate] of lp.slack) if (!byproductsFirst.has(itemId)) total += rate
  return total
}

/**
 * The gate of D3: the steps run only for a block whose two passes end with an import of an intermediate
 * (above LP noise) while a default-rule connected intermediate still has offer to spare. Every other block
 * keeps today's result, number for number, and its LP count.
 */
export function needsConnectionOrder(input: ConnectionOrderInput): boolean {
  const { today, system, byproductsFirst } = input
  if (!today.feasible || today.shortfall.size > 0 || today.warnings.some(w => w.type === 'infeasible-pins')) return false
  const imports = [...today.slack].some(([itemId, rate]) =>
    !byproductsFirst.has(itemId) && rate > surplusTolerance(itemGrossFlow(system.S.get(itemId), today.throughput)))
  if (!imports) return false
  return defaultItems(input).some(itemId => {
    // A supplied key shares its fluid's offers: what is spare is the offers of all its keys less all that was supplied.
    const fluid = system.flow?.supply.get(itemId)?.fluid
    const offer = fluid === undefined ? input.totalCaps.get(itemId)! : (input.keySupply?.fluids.get(fluid)?.offers ?? input.totalCaps.get(itemId)!)
    return offer - fluidSupply(system, today.supply, itemId) > FLOW_TOLERANCE
  })
}

/** Adds `attr` with coefficient 1 to each named variable. */
function tag(lp: LPModel, names: Iterable<string>, attr: string): void {
  for (const name of names) lp.variables[name][attr] = 1
}

function sumOf(result: Record<string, unknown>, names: Iterable<string>): number {
  let total = 0
  for (const name of names) {
    const v = result[name]
    if (typeof v === 'number' && v > 0) total += v
  }
  return total
}

/** The bound a step puts on a sum whose least value the previous step found over `terms` variables. */
export function boundOf(least: number, terms: number, looser = 1): number {
  return least + ORDER_ABS * Math.max(1, terms) * looser
}

/**
 * Runs a bounded step: `run(1)` with the tight bounds, then once `run(ORDER_RETRY)` with every bound of the
 * step loosened when the tight one is infeasible (solver rounding). Returns the feasible result, or undefined.
 * The plain path and the area path both go through it, so a step never retries in one and not in the other.
 */
export function boundedStep<R extends { feasible?: boolean }>(run: (looser: number) => R): R | undefined {
  const first = run(1)
  if (first.feasible === true) return first
  const retry = run(ORDER_RETRY)
  return retry.feasible === true ? retry : undefined
}

/** Whether a least import found by step 2 is a gain over the import of today's result (D3). */
export function improvesImport(least: number, todayImport: number): boolean {
  return least < todayImport - surplusTolerance(todayImport)
}

/**
 * The order of phase 6 after the two passes, for a block `needsConnectionOrder` lets through:
 *
 *   2. Least import: every connected intermediate's supply, capped by its offer, at cost 0; the objective
 *      is the total import (each slack 1, the cheap slack of *Don't make more here* 0), runs free.
 *   3. Least received: the total import bounded by step 2's, the objective is the total supply of the
 *      default-rule connected items, so a row that runs without importing runs before a connection is used.
 *   4. Fill: both totals bounded, today's objective (runs, `BIG_M` per unit imported). The bound is on the
 *      total received, not per item, so when two connections tie on units the runs decide (D5).
 *
 * Every supply has the `supuse` row of connections first (supply covers at most what the recipes
 * outside the flagged rows, or the whole chain in the fallback of absorbers.ts, use), so a free supply never feeds a flagged row and is bounded
 * with an unlimited offer. *Don't make more here* items get no supply in steps 2 and 3 (their slack is
 * free there) and, in step 4, a supply capped at step 4's own residual for them: one more LP, today's
 * pass 2 on the bounded model, only when such an item is short.
 * Connections-first items keep their supply, capped by the offer, in every step. A locked connected item
 * whose step-3 slack is zero is locked again in step 4, as `pass2Plan` does.
 *
 * LP solves: step 2 alone when it finds no gain (1); otherwise steps 2 to 4 (3), plus 1 for a refill, plus 1 per
 * bounded step that is retried (at most 7). A retry has not been seen on any test fixture.
 *
 * Returns undefined when today's result stands: step 2 finds no smaller import, or a step is infeasible.
 */
export function connectionOrder(input: ConnectionOrderInput): LPResult | undefined {
  const { system, pinnedRates, bcRecipeIds, markedFeeders, pass1NoImport, locked, byproductsFirst, firstItems, totalCaps, today } = input
  const defaults = defaultItems(input)
  const supplied = new Set([...firstItems, ...defaults])
  const bfConnected = [...totalCaps.keys()].filter(itemId =>
    system.classification.intermediates.has(itemId) && byproductsFirst.has(itemId))
  const caps = new Map([...supplied, ...bfConnected].map(itemId => [itemId, totalCaps.get(itemId)!]))
  // `connectionsFirst` here only adds the `supuse` row; it changes no cost.
  const lp = buildLPModel(
    system, pinnedRates, bcRecipeIds, pass1NoImport, caps, new Set([...supplied, ...bfConnected]), byproductsFirst, false, new Set(),
    { markedFeeders, fluidCaps: input.fluidCaps },
  )

  const importSlacks = [...lp.itemToSlack].filter(([itemId]) => !byproductsFirst.has(itemId)).map(([, name]) => name)
  const defaultSupplies = defaults.map(itemId => lp.itemToSupply.get(itemId)).filter((n): n is string => n !== undefined)
  // Steps 2 and 3: a Don't make more here item takes nothing from its connections yet. A split fluid with supplied keys has
  // one row over its supplied keys' aggregates, in place of one per key.
  const bfRows = new Map<string, { row: string; fluid?: string }>()
  const bfFluids = new Map<string, string[]>() // fluid → its aggregates
  for (const itemId of bfConnected) {
    const name = lp.itemToSupply.get(itemId)
    if (!name) continue
    const fluid = system.flow?.supply.get(itemId)?.fluid
    if (fluid !== undefined) {
      bfFluids.set(fluid, [...(bfFluids.get(fluid) ?? []), name])
      continue
    }
    const row = `__bfsup_${name}`
    lp.constraints[row] = { max: 0 }
    lp.variables[name][row] = 1
    bfRows.set(itemId, { row })
  }
  for (const [fluid, names] of bfFluids) {
    const row = `__bfsupf_${fluid}`
    lp.constraints[row] = { max: 0 }
    for (const name of names) lp.variables[name][row] = 1
    bfRows.set(fluid, { row, fluid })
  }

  // Step 2: least import.
  tag(lp, importSlacks, '__imp')
  const step2 = runLP('__imp', lp.constraints, lp.variables)
  if (step2.feasible !== true) return undefined
  const leastImport = sumOf(step2, importSlacks)
  const todayImport = importOf(today, byproductsFirst)
  if (!improvesImport(leastImport, todayImport)) return undefined

  // Step 3: least received, with the import at its least.
  tag(lp, importSlacks, '__impcap')
  tag(lp, defaultSupplies, '__rec')
  // The bound leaves the import a few 1e-8 of room; at BIG_M per unit the step never spends it to save
  // supply (with 100 W per X, 1e-8 X would otherwise save 1e-6 W). It only acts inside that room.
  for (const name of importSlacks) lp.variables[name].__rec = BIG_M
  const step3 = boundedStep(looser => {
    lp.constraints.__impcap = { max: boundOf(leastImport, importSlacks.length, looser) }
    return runLP('__rec', lp.constraints, lp.variables)
  })
  if (!step3) return undefined
  const leastReceived = sumOf(step3, defaultSupplies)

  // Step 4: fill, both totals bounded, today's objective.
  tag(lp, defaultSupplies, '__reccap')
  for (const itemId of locked) {
    const slack = lp.itemToSlack.get(itemId)
    if (!slack || sumOf(step3, [slack]) > FLOW_TOLERANCE) continue
    const row = `__relock_${slack}`
    lp.constraints[row] = { max: 0 }
    lp.variables[slack][row] = 1
  }
  // Both bounds are loosened by a retry: step 3's retry may have left `__impcap` loose, and a rounding that
  // made step 3 infeasible can make step 4 infeasible through either row.
  const fill = () => boundedStep(looser => {
    lp.constraints.__impcap = { max: boundOf(leastImport, importSlacks.length, looser) }
    lp.constraints.__reccap = { max: boundOf(leastReceived, defaultSupplies.length, looser) }
    return runLP('__obj__', lp.constraints, lp.variables)
  })
  let step4 = fill()
  if (!step4) return undefined
  // A Don't make more here item: steps 2 and 3 leave its slack arbitrary (runs and its slack are both free
  // there), so step 4 is today's two passes for it: its residual is measured first, with no supply and the
  // runs priced, then its supply fills that residual (min(offer, residual), as `pass2Plan`).
  let refill = false
  for (const [itemId, { row, fluid }] of bfRows) {
    // A split fluid's residual is the sum of its range keys' slacks, and its supply is capped by the offers in all.
    const slacks = fluid === undefined ? [lp.itemToSlack.get(itemId) ?? ''] : itemKeys(system, fluid).map(k => lp.itemToSlack.get(k) ?? '')
    const residual = sumOf(step4, slacks)
    if (residual <= FLOW_TOLERANCE) continue
    const offer = fluid === undefined ? totalCaps.get(itemId)! : (input.keySupply?.fluids.get(fluid)?.offers ?? Infinity)
    lp.constraints[row] = { max: Math.min(offer, residual) }
    refill = true
  }
  if (refill) {
    step4 = fill()
    if (!step4) return undefined
  }
  return readLPResult(step4, lp, system.recipes, pinnedRates, true)
}
