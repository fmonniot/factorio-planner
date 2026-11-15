import type { AreaFlow, AreaRoute, SubPlan } from '../../../data/types'
import { findSubPlan } from '../../../data/subPlanTree'

/** How the other end of a route is worded when it is outside the block, and when it is the block's top level. */
export const OUTSIDE_END = 'outside the block'
export const ROOT_END = 'the rest of the block'

/** Names an area id for the chips and the group panel; `undefined` stands for outside the block. */
export function areaEndName(rootPlan: SubPlan): (areaId: string | undefined) => string {
  return areaId => {
    if (areaId === undefined) return OUTSIDE_END
    if (areaId === rootPlan.id) return ROOT_END
    return findSubPlan(rootPlan, areaId)?.name ?? areaId
  }
}

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

export interface FlowEnd {
  partnerId: string | undefined
  /** e.g. "from Oil" or "to the rest of the block" */
  otherEnd: string
  /** items/min of this route */
  rate: number
}

export interface FlowLine {
  itemId: string
  /** items/min */
  rate: number
  /** The other end, e.g. "from Oil" or "to the rest of the block"; empty when no route names it. */
  otherEnd: string
  /** Whether the flow crosses the block's boundary. */
  boundary: boolean
  /** One entry per partner; empty when no route names one. */
  ends: FlowEnd[]
}

/**
 * The receives or sends list of an area for the panel and the chips: the same items as the chips on the group row, each
 * with the party at the other end. `nameOf` names an area id; `undefined` stands for outside the block.
 */
export function flowLines(
  flows: readonly AreaFlow[],
  routes: readonly AreaRoute[],
  areaId: string,
  direction: 'receives' | 'sends',
  nameOf: (areaId: string | undefined) => string,
): FlowLine[] {
  const word = direction === 'receives' ? 'from' : 'to'
  return flows.map(f => {
    const ends = routeEnds(routes.filter(r => r.itemId === f.itemId), areaId, direction)
      .map(e => ({ partnerId: e.partnerId, otherEnd: `${word} ${nameOf(e.partnerId)}`, rate: e.rate }))
    const unique = [...new Set(ends.map(e => nameOf(e.partnerId)))]
    return {
      itemId: f.itemId,
      rate: f.rate,
      otherEnd: unique.length > 0 ? `${word} ${unique.join(', ')}` : '',
      boundary: f.boundary,
      ends,
    }
  })
}
