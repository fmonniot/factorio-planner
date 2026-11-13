import type { ServedList } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { isShortfall } from './summarySegments'

/** One line of the served-order popover: a consumer, or the source's own extra output. */
export interface ServedLine {
  kind: 'request' | 'take' | 'extra'
  /** 1-based position in the order served */
  rank: number
  blockId?: string
  connectionId?: string
  /** items/min asked: requests and the extra only (a take's reserved share is a credit, not an ask) */
  asked?: number
  got: number
  /** items/min short of `asked`; present only when the shortfall survives display rounding */
  short?: number
}

/** The order is worth showing when something is ordered: two consumers, or one consumer and the extra. */
export function hasServedOrder(list: ServedList | undefined): boolean {
  if (!list) return false
  return list.consumers.length >= 2 || (list.consumers.length === 1 && list.extra !== undefined)
}

export function servedLines(list: ServedList, itemId: string, unit: RateUnit): ServedLine[] {
  const lines: ServedLine[] = list.consumers.map(c => {
    const line: ServedLine = { kind: c.kind, rank: 0, blockId: c.blockId, connectionId: c.connectionId, got: c.got }
    if (c.kind === 'request') {
      line.asked = c.share
      if (isShortfall(c.share, c.got, unit, itemId)) line.short = c.share - c.got
    }
    return line
  })
  if (list.extra) {
    const { asked, got } = list.extra
    const extra: ServedLine = { kind: 'extra', rank: 0, asked, got }
    if (isShortfall(asked, got, unit, itemId)) extra.short = asked - got
    lines.splice(Math.min(list.extra.place, lines.length), 0, extra)
  }
  return lines.map((l, i) => ({ ...l, rank: i + 1 }))
}
