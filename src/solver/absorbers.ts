import type { ClassifiedSystem } from './build'

export interface AbsorberRoles {
  /** Flagged byproduct consumers and the rows that only feed them; left out of `supuse`/`auuse`. */
  chain: ReadonlySet<string>
  /** Chain columns whose objective is BC_BONUS (flagged rows taking a bounded item); the rest of the chain costs 0. */
  rewarded: ReadonlySet<string>
}

/**
 * The absorber chains of a system: which columns run on a byproduct's surplus, and which of them the objective rewards.
 *
 * A *chain* is the flagged columns plus their *feeders*: an unflagged, unpinned column with a product, where no product is a goal,
 * every product that something consumes is consumed only by chain columns, and at least one product is consumed by a chain column.
 * A feeder whose product an ordinary column also uses is not one, so an absorber never pulls ordinary production. Producers
 * are the columns with a positive net coefficient, consumers a negative one (a saw row that gives back 0.9 of the saw it takes
 * only consumes saw).
 *
 * An item is *bounded* when it is an intermediate or a goal, has a producer, and every producer is outside the chain, pinned,
 * or *anchored*; a chain column is anchored when it takes a bounded item. Anchoring is found from nothing by repeating until
 * it settles.
 *
 * The objective rewards (BC_BONUS, negative) the flagged columns that are anchored, charges 0 for the rest of the chain, and 1
 * for any other column. Why this is bounded: only rewarded columns are negative and each takes a bounded item, so its runs are
 * limited by the producers of that item; following producers back, every path ends at an ordinary column (cost 1) or an import
 * slack. A column that takes only raw items is never anchored, so it cannot run for free forever. "Every producer" matters: if X is made
 * by an ordinary column and by a raw-fed feeder, rewarding X's consumer would let the feeder make X for nothing. The one
 * remaining unbounded case is the ratio limit already documented in spec/solver.md (100 or more rewarded runs per ordinary run).
 *
 * A flagged id that is not a column of `system` is ignored.
 */
export function absorberRoles(
  system: ClassifiedSystem,
  flagged: ReadonlySet<string>,
  pinned: ReadonlyMap<string, number>,
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

  const chain = new Set([...flagged].filter(id => columns.has(id)))
  for (let changed = true; changed;) {
    changed = false
    for (const id of system.recipes) {
      if (chain.has(id) || pinned.has(id)) continue
      const products = productsOf.get(id) ?? []
      if (products.length === 0 || products.some(itemId => goals.has(itemId))) continue
      if (!products.every(itemId => (consumersOf.get(itemId) ?? []).every(c => chain.has(c)))) continue
      if (!products.some(itemId => consumersOf.has(itemId))) continue
      chain.add(id)
      changed = true
    }
  }

  const anchored = new Set<string>()
  const bounded = (itemId: string): boolean => {
    if (!intermediates.has(itemId) && !goals.has(itemId)) return false
    let any = false
    for (const [id, coeff] of system.S.get(itemId) ?? []) {
      if (coeff <= 0 || !columns.has(id)) continue
      any = true
      if (chain.has(id) && !pinned.has(id) && !anchored.has(id)) return false
    }
    return any
  }
  for (let changed = true; changed;) {
    changed = false
    for (const id of chain) {
      if (anchored.has(id)) continue
      if ((takesOf.get(id) ?? []).some(bounded)) {
        anchored.add(id)
        changed = true
      }
    }
  }

  return { chain, rewarded: new Set([...chain].filter(id => flagged.has(id) && anchored.has(id))) }
}
