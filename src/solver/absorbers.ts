import type { ClassifiedSystem } from './build'

/** The objective of a live column that is not rewarded, before the weight of `feederCost`. Far below BC_BONUS. */
export const CHAIN_COST = 1e-4

export interface AbsorberRoles {
  /** Flagged byproduct consumers and the rows that only feed a live row; left out of `supuse`/`auuse`. */
  chain: ReadonlySet<string>
  /** Chain columns whose objective is BC_BONUS (flagged rows taking a bounded item). */
  rewarded: ReadonlySet<string>
  /** The columns that cost `CHAIN_COST` or BC_BONUS: the rewarded rows and the rows that only feed them. Every other column costs 1. */
  live: ReadonlySet<string>
  /**
   * The objective of every live column that is not rewarded: `CHAIN_COST` times 1 to 2 by how many items a run takes per item it
   * makes, so of two feeders that make the same item the one that takes less runs, whatever the order of the rows.
   */
  feederCost: ReadonlyMap<string, number>
}

/** A chain row that is not flagged: it runs only to feed a flagged row (or another feeder). */
export function isFeeder(roles: AbsorberRoles, flagged: ReadonlySet<string>, id: string): boolean {
  return roles.chain.has(id) && !flagged.has(id)
}

/**
 * The absorber chains of a system: which columns run on a byproduct's surplus, and what the objective charges them.
 *
 * A *candidate* is a flagged column or a *feeder*: an unflagged, unpinned column with a product, where no product is a goal,
 * every product that something consumes is consumed only by candidates, and at least one product is consumed by a candidate.
 * Producers are the columns with a positive net coefficient, consumers a negative one (a saw row that gives back 0.9 of the
 * saw it takes only consumes saw).
 *
 * An item is *bounded* when it is an intermediate or a goal, its import is not cheap (`cheapImports`: byproducts-first items
 * keep a slack of 1e-5 per unit), it has a producer, and every producer is outside the candidates, pinned, or *anchored*; a
 * candidate is anchored when it takes a bounded item. Anchoring is found from nothing by repeating until it settles. The
 * flagged anchored columns are *rewarded* (BC_BONUS, negative).
 *
 * A candidate is *live* when it is rewarded, or when every product that something consumes is consumed only by live columns
 * and at least one is. The rows that feed a rewarded row are live; a flagged row that is not anchored and whose product an
 * ordinary row uses, or that feeds nothing live, is not, so the chain never pulls ordinary production. Live columns that are
 * not rewarded cost a tiny `feederCost`, so the optimum is the same whatever the order of the rows; every other column costs 1. The `chain` (left out of the supply-use rows) is the flagged columns plus the live feeders.
 *
 * Why this is bounded: only rewarded columns are negative and each takes a bounded item, so its runs are limited by the
 * producers of that item; following producers back, every path ends at an ordinary column (cost 1) or an import slack that
 * is not cheap. A column that takes only raw items, or a cheaply imported one, is never anchored, so it cannot run for
 * free forever. "Every producer" matters: if X is made by an ordinary column and by a raw-fed feeder, rewarding X's
 * consumer would let the feeder make X for nothing. What remains unbounded is a loop whose gain exceeds the reward ratio:
 * a rewarded row that gives back most of an item a feeder makes (100 or more runs per unit of it) while that feeder's
 * ingredients cost less than the runs earn; see spec/solver.md.
 *
 * A flagged id that is not a column of `system` is ignored.
 */
export function absorberRoles(
  system: ClassifiedSystem,
  flagged: ReadonlySet<string>,
  pinned: ReadonlyMap<string, number>,
  /** Items whose import costs far less than a run (byproducts-first items that can be imported): never bounded. */
  cheapImports: ReadonlySet<string> = new Set(),
): AbsorberRoles {
  const columns = new Set(system.recipes)
  const { goals, intermediates } = system.classification

  const productsOf = new Map<string, string[]>()
  const consumersOf = new Map<string, string[]>()
  const takesOf = new Map<string, string[]>()
  for (const [itemId, row] of system.S) {
    for (const [id, coeff] of row) {
      if (!columns.has(id)) continue
      const into = coeff > 0 ? productsOf : coeff < 0 ? takesOf : undefined
      if (!into) continue
      if (!into.has(id)) into.set(id, [])
      into.get(id)!.push(itemId)
      if (coeff < 0) {
        if (!consumersOf.has(itemId)) consumersOf.set(itemId, [])
        consumersOf.get(itemId)!.push(id)
      }
    }
  }

  const candidates = new Set([...flagged].filter(id => columns.has(id)))
  for (let changed = true; changed;) {
    changed = false
    for (const id of system.recipes) {
      if (candidates.has(id) || pinned.has(id)) continue
      const products = productsOf.get(id) ?? []
      if (products.length === 0 || products.some(itemId => goals.has(itemId))) continue
      if (!products.every(itemId => (consumersOf.get(itemId) ?? []).every(c => candidates.has(c)))) continue
      if (!products.some(itemId => consumersOf.has(itemId))) continue
      candidates.add(id)
      changed = true
    }
  }

  const anchored = new Set<string>()
  const bounded = (itemId: string): boolean => {
    if (!intermediates.has(itemId) && !goals.has(itemId)) return false
    if (cheapImports.has(itemId)) return false
    let any = false
    for (const [id, coeff] of system.S.get(itemId) ?? []) {
      if (coeff <= 0 || !columns.has(id)) continue
      any = true
      if (candidates.has(id) && !pinned.has(id) && !anchored.has(id)) return false
    }
    return any
  }
  for (let changed = true; changed;) {
    changed = false
    for (const id of candidates) {
      if (anchored.has(id)) continue
      if ((takesOf.get(id) ?? []).some(bounded)) {
        anchored.add(id)
        changed = true
      }
    }
  }

  const rewarded = new Set([...candidates].filter(id => flagged.has(id) && anchored.has(id)))
  const live = new Set(rewarded)
  for (let changed = true; changed;) {
    changed = false
    for (const id of candidates) {
      if (live.has(id)) continue
      const consumed = (productsOf.get(id) ?? []).filter(itemId => consumersOf.has(itemId))
      if (consumed.length === 0) continue
      if (!consumed.every(itemId => consumersOf.get(itemId)!.every(c => live.has(c)))) continue
      live.add(id)
      changed = true
    }
  }
  const chain = new Set([...candidates].filter(id => flagged.has(id) || live.has(id)))
  const feederCost = new Map<string, number>()
  for (const id of live) {
    if (rewarded.has(id)) continue
    let taken = 0
    let made = 0
    for (const row of system.S.values()) {
      const coeff = row.get(id) ?? 0
      if (coeff < 0) taken -= coeff
      else made += coeff
    }
    feederCost.set(id, CHAIN_COST * (1 + taken / (taken + made)))
  }
  return { chain, rewarded, live, feederCost }
}
