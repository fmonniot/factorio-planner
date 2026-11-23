import type { AreaFlow, AreaRoute, SubPlan } from '../../../data/types'
import { findSubPlan } from '../../../data/subPlanTree'
import { routeEnds } from '../areaRouteEnds'

export { routeEnds, type RouteEnd } from '../areaRouteEnds'

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

export interface FlowEnd {
  partnerId: string | undefined
  /** e.g. "from Oil" or "to the rest of the block" */
  otherEnd: string
  /** items/min of this route */
  rate: number
}

export interface FlowLine {
  /** Unique among the lines of one list: a split fluid has one line per temperature, so the item id alone is not. */
  key: string
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
    // Merged by displayed text, so the popup's lines and the title agree when two partners share a name.
    const byText = new Map<string, FlowEnd>()
    for (const e of routeEnds(routes.filter(r => r.itemId === f.itemId), areaId, direction)) {
      const otherEnd = `${word} ${nameOf(e.partnerId)}`
      const seen = byText.get(otherEnd)
      if (seen) seen.rate += e.rate
      else byText.set(otherEnd, { partnerId: e.partnerId, otherEnd, rate: e.rate })
    }
    const ends = [...byText.values()]
    return {
      key: f.temp ? `${f.itemId}@${JSON.stringify(f.temp)}` : f.itemId,
      itemId: f.itemId,
      rate: f.rate,
      otherEnd: ends.length > 0 ? `${word} ${ends.map(e => e.otherEnd.slice(word.length + 1)).join(', ')}` : '',
      boundary: f.boundary,
      ends,
    }
  })
}
