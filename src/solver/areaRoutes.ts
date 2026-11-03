// ---------------------------------------------------------------------------
// Area-to-area routes: the LP decides each area's net of an item and who may take dedicated output
// from whom; this fixed rule pairs the rest (see spec/solver.md, "Areas"). Pure, no LP.
// ---------------------------------------------------------------------------

/** `other` = the part of `rate` that rows not dedicated to the item make (min(rate, their gross output)). */
export interface RouteSender { area: number; rate: number; other: number }
export interface RouteReceiver { area: number; rate: number; restricted: boolean; dedicatedIn: number }
/** An absent end is outside the block; `from` and `to` are area indices. */
export interface ItemRoute { from?: number; to?: number; rate: number }

interface Source { area: number | undefined; ded: number; oth: number }

/**
 * Pairs senders with receivers, in table order. A restricted receiver (an area with its own row
 * for the item) takes `dedicatedIn` from other areas' dedicated output, the rest from other output
 * and the outside import; unrestricted receivers and the outside take what is left. A restricted
 * receiver still short at the end takes whatever remains (the LP kept circulation or is infeasible).
 * `tol` is the block's surplus tolerance; legs at or below it are dropped.
 */
export function itemRoutes(senders: RouteSender[], receivers: RouteReceiver[], tol: number): ItemRoute[] {
  let pos = 0
  let neg = 0
  for (const s of senders) pos += s.rate
  for (const r of receivers) neg += r.rate
  const s = pos - neg
  const fromOutside = s < -tol ? -s : 0
  const toOutside = s > tol ? s : 0

  const sources: Source[] = senders.map(x => {
    const oth = Math.min(x.rate, Math.max(0, x.other))
    return { area: x.area, ded: x.rate - oth, oth }
  })
  if (fromOutside > 0) sources.push({ area: undefined, ded: 0, oth: fromOutside })

  const legs = new Map<string, ItemRoute>()
  const give = (src: Source, to: number | undefined, rate: number) => {
    const key = `${src.area ?? ''}\u0000${to ?? ''}`
    const leg = legs.get(key)
    if (leg) leg.rate += rate
    else legs.set(key, { from: src.area, to, rate })
  }
  /** Takes up to `need` from `part` of each source in order; returns what is still needed. */
  const take = (need: number, to: number | undefined, part: 'ded' | 'oth' | 'both'): number => {
    for (const src of sources) {
      if (need <= 0) break
      if (src.area !== undefined && src.area === to) continue
      for (const p of part === 'both' ? (['ded', 'oth'] as const) : [part]) {
        const got = Math.min(need, src[p])
        if (got <= 0) continue
        src[p] -= got
        need -= got
        give(src, to, got)
      }
    }
    return need
  }

  const restricted = receivers.filter(r => r.restricted)
  const need = new Map<RouteReceiver, number>()
  // 1a: dedicated output, up to the allowed shortfall.
  for (const r of restricted) {
    const want = Math.min(Math.max(0, r.dedicatedIn), r.rate)
    need.set(r, r.rate - want + take(want, r.area, 'ded'))
  }
  // 1b: other output, then the outside import.
  for (const r of restricted) need.set(r, take(need.get(r)!, r.area, 'oth'))
  // 2: unrestricted receivers, then the outside.
  for (const r of receivers) if (!r.restricted) take(r.rate, r.area, 'both')
  if (toOutside > 0) take(toOutside, undefined, 'both')
  // 3: fallback.
  for (const r of restricted) {
    const left = need.get(r)!
    if (left > 0) take(left, r.area, 'both')
  }

  const rank = (a: number | undefined) => (a === undefined ? Infinity : a)
  return [...legs.values()]
    .filter(l => l.rate > tol)
    .sort((a, b) => rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to))
}
