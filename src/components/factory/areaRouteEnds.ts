export interface RouteEnd {
  /** The area at the other end; `undefined` (or the matrix's opaque outside id) is outside the block. */
  partnerId: string | undefined
  /** items/min */
  rate: number
}

/**
 * The routes that end at (`receives`) or start from (`sends`) an area, merged per partner in route order. Generic over
 * the solver's routes and the matrix's pairs: an end is an opaque string, absent for outside.
 */
export function routeEnds(
  routes: readonly { from?: string; to?: string; rate: number }[],
  areaId: string,
  direction: 'receives' | 'sends',
): RouteEnd[] {
  const merged = new Map<string | undefined, number>()
  for (const r of routes) {
    if ((direction === 'receives' ? r.to : r.from) !== areaId) continue
    const partnerId = direction === 'receives' ? r.from : r.to
    merged.set(partnerId, (merged.get(partnerId) ?? 0) + r.rate)
  }
  return [...merged].map(([partnerId, rate]) => ({ partnerId, rate }))
}
