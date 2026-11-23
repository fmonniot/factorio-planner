import type { ClassifiedSystem } from './build'

/** The objective of a live column that is not rewarded, before the weight of `feederCost`. Far below BC_BONUS. */
export const CHAIN_COST = 1e-4

/**
 * One row of the ordinary-share bookkeeping of a share column j (see `AbsorberRoles.ordinaryShare`): for the product `itemId` that
 * a chain column takes, what ordinary rows can use of what j makes.
 */
export interface ShareRow {
  itemId: string
  /** What one run of j makes of `itemId` (S_pj, > 0). */
  made: number
  /** The goal rate of `itemId`, 0 when it is not a goal. */
  goal: number
  /** The columns outside the chain (conversions left out) that take `itemId` → what a run of them takes. */
  ordinary: ReadonlyMap<string, number>
  /** The share columns of a lower level that take `itemId` → what a run of them takes. */
  shares: ReadonlyMap<string, number>
}

export interface AbsorberRoles {
  /** Flagged byproduct consumers and the rows that only feed a live row. */
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
  /**
   * The columns left out of the `supuse`/`auuse` rows: the flagged columns, or the whole `chain` when a supplied item must anchor a
   * feeder for a rewarded row to stay rewarded. In that fallback the columns of `ordinaryShare` still count in those rows, but only
   * for their ordinary share.
   */
  noSupply: ReadonlySet<string>
  /**
   * The *share columns* Σ of the fallback and, for each, the rows that bound its ordinary share, in level order. Empty unless the
   * fallback holds and some column of Σ takes a supplied item. Σ is the unflagged chain columns that are not conversions and that
   * run for ordinary use: level 0 has a product that is a goal or that a column outside the chain takes (only marked feeders
   * qualify), level L+1 has a product that a column of Σ takes (the unmarked feeders upstream of a marked feeder).
   */
  ordinaryShare: ReadonlyMap<string, readonly ShareRow[]>
  /**
   * The chain rows that run only for an absorber: the flagged columns and the unmarked feeders. A marked feeder also runs for
   * ordinary rows, so diagnostics that ask "what drives this row" treat it as an ordinary row.
   */
  absorberOnly: ReadonlySet<string>
}

export interface AbsorberInputs {
  /** Rows marked `absorberFeeder` (Feed absorbing rows). A flagged or pinned one is ignored. */
  markedFeeders?: ReadonlySet<string>
  /** Items whose supply has a `supuse` / `auuse` row in this model: they never anchor an unflagged candidate. */
  supplied?: ReadonlySet<string>
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
 * A *marked* row (`inputs.markedFeeders`, unflagged and unpinned) is a feeder as soon as one of its products is consumed by a
 * candidate, whatever else consumes it and even when a product is a goal: it also runs for the ordinary rows that use it.
 * Producers are the columns with a positive net coefficient, consumers a negative one (a saw row that gives back 0.9 of the
 * saw it takes only consumes saw).
 *
 * An item is *bounded* when it is an intermediate or a goal, its import is not cheap (`cheapImports`: byproducts-first items
 * keep a slack of 1e-5 per unit), it has a producer, and every producer is outside the candidates, pinned, or *anchored*; a
 * candidate is anchored when it takes a bounded item. Anchoring is found from nothing by repeating until it settles. The
 * flagged anchored columns are *rewarded* (BC_BONUS, negative).
 *
 * A candidate is *live* when it is rewarded, or when every product that something consumes is consumed only by live columns
 * and at least one is (for a marked row: when some consumer of a product is live). The rows that feed a rewarded row are live;
 * a flagged row that is not anchored and whose product an ordinary row uses, or that feeds nothing live, is not, so the chain
 * never pulls ordinary production. Live columns that are not rewarded cost a tiny `feederCost`, so the optimum is the same
 * whatever the order of the rows; every other column costs 1. The `chain` is the flagged columns plus the live feeders.
 *
 * Supply. Connected supply (`supuse` / `auuse` rows) must never feed a rewarded row: it would run for its reward on free items.
 * `noSupply` is the set of columns left out of those rows: the flagged candidates only, so a supply can feed a feeder. That is
 * safe while a supplied item (`inputs.supplied`) never anchors an unflagged candidate: a feeder that takes free supply is then
 * not anchored by it, costs `feederCost` and runs only as far as a rewarded row needs. If ignoring the supplied items takes a
 * reward away (a flagged row anchored only through a feeder whose bounded input is supplied), the old behaviour is kept for the
 * whole model: `noSupply` is the `chain`. A marked feeder would then take no supply even for what ordinary rows use of its
 * product, so `ordinaryShare` names the columns that keep the supply for that ordinary use: the solver gives each an *ordinary
 * share* a_j (at most its runs, at most what ordinary rows, goals and lower-level shares take of its products), counted in the
 * supply-use rows instead of x_j. The rest of its runs, the chain part, is fed without supply, as in the plain fallback.
 *
 * Why this is bounded: only rewarded columns are negative and each takes a bounded item, so its runs are limited by the
 * producers of that item; following producers back, every path ends at an ordinary column (cost 1), an import slack that
 * is not cheap, or a supply that only ordinary rows and feeders take (in the fallback, only ordinary rows and the ordinary share of
 * a feeder, which ordinary activity bounds). A flagged row never gets supply, so what it uses of an
 * item is limited by the column production of that item plus slack. A column that takes only raw items, or a cheaply imported
 * one, is never anchored, so it cannot run for free forever. "Every producer" matters: if X is made by an ordinary column and
 * by a raw-fed feeder, rewarding X's consumer would let the feeder make X for nothing. What remains unbounded is a loop whose
 * gain exceeds the reward ratio: a rewarded row that gives back most of an item a feeder makes (100 or more runs per unit of
 * it) while that feeder's ingredients cost less than the runs earn; see spec/solver.md.
 *
 * A flagged id that is not a column of `system` is ignored.
 */
export function absorberRoles(
  system: ClassifiedSystem,
  flagged: ReadonlySet<string>,
  pinned: ReadonlyMap<string, number>,
  /** Items whose import costs far less than a run (byproducts-first items that can be imported): never bounded. */
  cheapImports: ReadonlySet<string> = new Set(),
  inputs: AbsorberInputs = {},
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

  const marked = new Set([...(inputs.markedFeeders ?? [])].filter(id => columns.has(id) && !flagged.has(id)))
  const candidates = new Set([...flagged].filter(id => columns.has(id)))
  for (let changed = true; changed;) {
    changed = false
    for (const id of system.recipes) {
      if (candidates.has(id) || pinned.has(id)) continue
      const products = productsOf.get(id) ?? []
      if (products.length === 0) continue
      if (marked.has(id)) {
        if (products.some(itemId => (consumersOf.get(itemId) ?? []).some(c => candidates.has(c)))) {
          candidates.add(id)
          changed = true
        }
        continue
      }
      if (products.some(itemId => goals.has(itemId))) continue
      if (!products.every(itemId => (consumersOf.get(itemId) ?? []).every(c => candidates.has(c)))) continue
      if (!products.some(itemId => consumersOf.has(itemId))) continue
      candidates.add(id)
      changed = true
    }
  }

  /** The candidates that take a bounded item; the items in `ignore` do not anchor an unflagged candidate. */
  const anchoredWith = (ignore: ReadonlySet<string>): Set<string> => {
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
        if ((takesOf.get(id) ?? []).some(item => bounded(item) && (flagged.has(id) || !ignore.has(item)))) {
          anchored.add(id)
          changed = true
        }
      }
    }
    return anchored
  }
  const anchored = anchoredWith(new Set())

  const rewarded = new Set([...candidates].filter(id => flagged.has(id) && anchored.has(id)))
  const live = new Set(rewarded)
  for (let changed = true; changed;) {
    changed = false
    for (const id of candidates) {
      if (live.has(id)) continue
      const consumed = (productsOf.get(id) ?? []).filter(itemId => consumersOf.has(itemId))
      if (consumed.length === 0) continue
      const reached = marked.has(id)
        ? consumed.some(itemId => consumersOf.get(itemId)!.some(c => live.has(c)))
        : consumed.every(itemId => consumersOf.get(itemId)!.every(c => live.has(c)))
      if (!reached) continue
      live.add(id)
      changed = true
    }
  }
  const chain = new Set([...candidates].filter(id => flagged.has(id) || live.has(id)))
  const flaggedCols = [...candidates].filter(id => flagged.has(id))
  const supplied = inputs.supplied ?? new Set<string>()
  const relaxed = supplied.size === 0 ? anchored : anchoredWith(supplied)
  const fallback = ![...rewarded].every(id => relaxed.has(id))
  const noSupply = new Set(fallback ? chain : flaggedCols)
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
  const absorberOnly = new Set([...chain].filter(id => !marked.has(id)))
  const ordinaryShare = fallback && supplied.size > 0
    ? ordinaryShareOf(system, flagged, chain, supplied, productsOf, consumersOf, takesOf)
    : new Map<string, readonly ShareRow[]>()
  return { chain, rewarded, live, feederCost, noSupply, ordinaryShare, absorberOnly }
}

/** The share columns of the fallback and their rows (see `AbsorberRoles.ordinaryShare`). */
function ordinaryShareOf(
  system: ClassifiedSystem,
  flagged: ReadonlySet<string>,
  chain: ReadonlySet<string>,
  supplied: ReadonlySet<string>,
  productsOf: ReadonlyMap<string, string[]>,
  consumersOf: ReadonlyMap<string, string[]>,
  takesOf: ReadonlyMap<string, string[]>,
): Map<string, readonly ShareRow[]> {
  const conversions = system.flow?.conversions
  const { goals } = system.classification
  const eligible = (id: string) => chain.has(id) && !flagged.has(id) && !conversions?.has(id)
  const outside = (id: string) => !chain.has(id) && !conversions?.has(id)
  const level = new Map<string, number>()
  for (const id of system.recipes) {
    if (!eligible(id)) continue
    const runsForOrdinary = (productsOf.get(id) ?? []).some(
      itemId => goals.has(itemId) || (consumersOf.get(itemId) ?? []).some(outside),
    )
    if (runsForOrdinary) level.set(id, 0)
  }
  for (let l = 0; level.size > 0; l++) {
    const upper = new Set(level.keys())
    const next = system.recipes.filter(
      id => eligible(id) && !level.has(id)
        && (productsOf.get(id) ?? []).some(itemId => (consumersOf.get(itemId) ?? []).some(c => upper.has(c))),
    )
    if (next.length === 0) break
    for (const id of next) level.set(id, l + 1)
  }
  const columns = [...level.keys()].sort((a, b) => level.get(a)! - level.get(b)!)
  if (!columns.some(id => (takesOf.get(id) ?? []).some(itemId => supplied.has(itemId)))) return new Map()
  const take = (itemId: string, id: string): number => -(system.S.get(itemId)?.get(id) ?? 0)
  const result = new Map<string, readonly ShareRow[]>()
  for (const id of columns) {
    const rows: ShareRow[] = []
    for (const itemId of productsOf.get(id) ?? []) {
      const takers = consumersOf.get(itemId) ?? []
      if (!takers.some(c => c !== id && chain.has(c))) continue
      rows.push({
        itemId,
        made: system.S.get(itemId)!.get(id)!,
        goal: goals.get(itemId) ?? 0,
        ordinary: new Map(takers.filter(outside).map(c => [c, take(itemId, c)])),
        shares: new Map(takers.filter(c => level.has(c) && level.get(c)! < level.get(id)!).map(c => [c, take(itemId, c)])),
      })
    }
    result.set(id, rows)
  }
  return result
}
