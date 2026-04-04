import type { StoichiometryMatrix } from './build'

// ---------------------------------------------------------------------------
// System reduction
//
// The full stoichiometry matrix includes rows for items that are raw resources
// (consumed but never produced by any active recipe) and byproducts (produced
// but never consumed and not demanded as a goal). These rows have no constraint
// power — they cannot be solved for because there is no upstream recipe to set
// their rate. We remove them and build a reduced system for the linear solver.
//
// Item classifications
// -------------------
//   raw        – no recipe in the active set produces it (no positive S entry).
//                These are mined/pumped resources; we compute their consumption
//                rate after solving rather than constraining on them.
//
//   byproduct  – produced by some recipe but never consumed AND not demanded as
//                a goal. Surplus is discarded or fed back, but either way the
//                row imposes no equation we can satisfy independently.
//
//   intermediate – consumed AND produced by active recipes. Net flow = 0.
//
//   goal       – in the goals map. Row equation: S_row · x = goal_rate.
//
// The reduced system contains only goal + intermediate rows.
// ---------------------------------------------------------------------------

export type ItemClass = 'goal' | 'intermediate' | 'raw' | 'byproduct'

export interface ReducedSystem {
  /** Reduced stoichiometry matrix (goals + intermediates only, rows × recipes) */
  S: number[][]
  /** Demand vector aligned with S rows (goal_rate for goals, 0 for intermediates) */
  d: number[]
  /** Ordered item ids in the reduced system (row i ↔ reducedItems[i]) */
  reducedItems: string[]
  /** Classification of every item in the original matrix */
  itemClasses: Map<string, ItemClass>
  /** Raw resource items (not in S) — we compute consumption after solving */
  rawItems: string[]
  /** Byproduct items (not in S) — surplus, unconstrained */
  byproductItems: string[]
}

/**
 * Classify each item and build the reduced system ready for the linear solver.
 *
 * @param matrix   - output of buildStoichiometryMatrix
 * @param goals    - map of itemId → desired production rate (items/min)
 */
export function reduceSystem(
  matrix: StoichiometryMatrix,
  goals: Map<string, number>,
): ReducedSystem {
  const { S, items, recipes } = matrix

  const itemClasses = new Map<string, ItemClass>()

  for (let i = 0; i < items.length; i++) {
    const itemId = items[i]
    const row = S[i]

    if (goals.has(itemId)) {
      itemClasses.set(itemId, 'goal')
      continue
    }

    let hasProducer = false // some recipe yields a positive net amount
    let hasConsumer = false // some recipe consumes a net amount

    for (let j = 0; j < recipes.length; j++) {
      if (row[j] > 0) hasProducer = true
      if (row[j] < 0) hasConsumer = true
    }

    if (!hasProducer) {
      itemClasses.set(itemId, 'raw')
    } else if (!hasConsumer) {
      itemClasses.set(itemId, 'byproduct')
    } else {
      itemClasses.set(itemId, 'intermediate')
    }
  }

  // Build reduced system: goal + intermediate rows only
  const reducedItems: string[] = []
  const reducedS: number[][] = []
  const d: number[] = []

  for (let i = 0; i < items.length; i++) {
    const itemId = items[i]
    const cls = itemClasses.get(itemId)!
    if (cls === 'goal' || cls === 'intermediate') {
      reducedItems.push(itemId)
      reducedS.push(S[i].slice())
      d.push(goals.get(itemId) ?? 0)
    }
  }

  const rawItems = items.filter(id => itemClasses.get(id) === 'raw')
  const byproductItems = items.filter(id => itemClasses.get(id) === 'byproduct')

  return {
    S: reducedS,
    d,
    reducedItems,
    itemClasses,
    rawItems,
    byproductItems,
  }
}
