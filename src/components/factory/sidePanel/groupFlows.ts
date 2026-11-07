import type { AreaFlow, AreaRoute } from '../../../data/types'

export interface FlowLine {
  itemId: string
  /** items/min */
  rate: number
  /** The other end, e.g. "from Oil" or "to the rest of the block"; empty when no route names it. */
  otherEnd: string
}

/**
 * The receives or sends list of an area for the panel: the same items as the chips on the group row, each with the
 * party at the other end. `nameOf` names an area id; `undefined` stands for outside the block.
 */
export function flowLines(
  flows: readonly AreaFlow[],
  routes: readonly AreaRoute[],
  areaId: string,
  direction: 'receives' | 'sends',
  nameOf: (areaId: string | undefined) => string,
): FlowLine[] {
  return flows.map(f => {
    const ends = routes
      .filter(r => r.itemId === f.itemId && (direction === 'receives' ? r.to === areaId : r.from === areaId))
      .map(r => nameOf(direction === 'receives' ? r.from : r.to))
    const unique = [...new Set(ends)]
    return {
      itemId: f.itemId,
      rate: f.rate,
      otherEnd: unique.length > 0 ? `${direction === 'receives' ? 'from' : 'to'} ${unique.join(', ')}` : '',
    }
  })
}
