import type { ServedConsumer, ServedEntry, ServedList } from '../../data/types'
import { servedEntryKey } from '../../data/servedEntries'
import type { RateUnit } from '../../store/uiStore'
import { isShortfall } from './summarySegments'

/** One line of the served-order popover: a consumer, or the source's own extra output. */
export interface ServedLine {
  kind: 'request' | 'take' | 'extra'
  /** 1-based position in the ranked list; 0 for a line the list does not rank (also before `splitServed` has run) */
  rank: number
  blockId?: string
  connectionId?: string
  /** items/min asked: requests and the extra only (a take's reserved share is a credit, not an ask) */
  asked?: number
  got: number
  /** items/min short of `asked`; present only when the shortfall survives display rounding */
  short?: number
  /** items/min a take's consumer needs of the item from outside (see `ServedConsumer.need`) */
  need?: number
  /** the take got no credit because the request pass was not done with its source yet (see `ServedConsumer.notCredited`) */
  notCredited?: true
}

/**
 * One consumer per block: the lines of a block's areas merged (at the block's first line, `share`, `got` and `need` summed)
 * until the list draws areas. `extraPlace` counts blocks, not lines. A list with no area line comes back as it is.
 */
export function blockLines(list: ServedList): { consumers: ServedConsumer[]; extraPlace: number | undefined } {
  if (!list.consumers.some(c => c.areaId !== undefined)) return { consumers: list.consumers, extraPlace: list.extra?.place }
  const merged = new Map<string, ServedConsumer>()
  for (const c of list.consumers) {
    const first = merged.get(c.blockId)
    if (!first) {
      const whole = { ...c }
      delete whole.areaId
      merged.set(c.blockId, whole)
      continue
    }
    first.share += c.share
    first.got += c.got
    if (c.need !== undefined) first.need = (first.need ?? 0) + c.need
    if (c.notCredited) first.notCredited = true
  }
  const extraPlace = list.extra ? new Set(list.consumers.slice(0, list.extra.place).map(c => c.blockId)).size : undefined
  return { consumers: [...merged.values()], extraPlace }
}

/** The order is worth showing when something is ordered: two consumers, or one consumer and the extra. */
export function hasServedOrder(list: ServedList | undefined): boolean {
  if (!list) return false
  const { consumers } = blockLines(list)
  return consumers.length >= 2 || (consumers.length === 1 && list.extra !== undefined)
}

/**
 * The lines in the order the solver served them. A take gets no `short`: its `need` comes from the request probe (unlimited
 * supply), so a gap to `got` may be the consumer's own limit or another source, not this one running dry.
 */
export function servedLines(list: ServedList, itemId: string, unit: RateUnit): ServedLine[] {
  const { consumers, extraPlace } = blockLines(list)
  const lines: ServedLine[] = consumers.map(c => {
    const line: ServedLine = { kind: c.kind, rank: 0, blockId: c.blockId, connectionId: c.connectionId, got: c.got }
    if (c.kind === 'request') {
      line.asked = c.share
      if (isShortfall(c.share, c.got, unit, itemId)) line.short = c.share - c.got
    } else {
      if (c.notCredited) line.notCredited = true
      if (c.need !== undefined) line.need = c.need
    }
    return line
  })
  if (list.extra) {
    const { asked, got } = list.extra
    const extra: ServedLine = { kind: 'extra', rank: 0, asked, got }
    if (isShortfall(asked, got, unit, itemId)) extra.short = asked - got
    lines.splice(Math.min(extraPlace ?? list.extra.place, lines.length), 0, extra)
  }
  return lines.map((l, i) => ({ ...l, rank: i + 1 }))
}

/** What a line is called in a list and in the DOM: the extra, the consumer block, or one area of it (an entry only). */
export function lineKey(x: ServedLine | ServedEntry): string {
  if (x.kind === 'extra') return 'extra'
  return servedEntryKey('areaId' in x ? x : { kind: 'block', blockId: x.blockId! })
}

/** The list entry of a line. */
export function entryOf(line: ServedLine): ServedEntry {
  return line.kind === 'extra' ? { kind: 'extra' } : { kind: 'block', blockId: line.blockId! }
}

/** The index to insert before `before` in `order`: its place, or the end when `before` is null or not in the list. */
export function insertionIndex(order: readonly ServedEntry[], before: ServedEntry | null): number {
  if (before === null) return order.length
  const i = order.findIndex(e => lineKey(e) === lineKey(before))
  return i < 0 ? order.length : i
}

export interface ServedSections {
  /** a list is stored: the ranked lines are the list, the rest is not ranked */
  hasList: boolean
  ranked: ServedLine[]
  unranked: ServedLine[]
}

/**
 * Split the lines into those the stored list ranks (in its order, stale entries skipped) and those it does not (in the
 * solver's order, the extra last). Without a stored list every line is ranked, in the order the solver served them.
 */
export function splitServed(lines: ServedLine[], stored: readonly ServedEntry[] | undefined): ServedSections {
  if (stored === undefined) return { hasList: false, ranked: lines.map((l, i) => ({ ...l, rank: i + 1 })), unranked: [] }
  const byKey = new Map(lines.map(l => [lineKey(l), l]))
  const ranked: ServedLine[] = []
  const used = new Set<string>()
  for (const e of stored) {
    const key = lineKey(e)
    const line = byKey.get(key)
    if (!line || used.has(key)) continue
    used.add(key)
    ranked.push({ ...line, rank: ranked.length + 1 })
  }
  const rest = lines.filter(l => !used.has(lineKey(l)) && l.kind !== 'extra').map(l => ({ ...l, rank: 0 }))
  const extra = lines.find(l => l.kind === 'extra' && !used.has('extra'))
  return { hasList: true, ranked, unranked: extra ? [...rest, { ...extra, rank: 0 }] : rest }
}

/** How many of the list's lines the stored list does not rank (0 without a stored list). */
export function unrankedCount(list: ServedList, stored: readonly ServedEntry[] | undefined): number {
  if (stored === undefined) return 0
  const keys = new Set(stored.map(lineKey))
  let n = blockLines(list).consumers.filter(c => !keys.has(lineKey({ kind: 'block', blockId: c.blockId }))).length
  if (list.extra && !keys.has('extra')) n++
  return n
}

/** Where `entry` goes in the store's terms when dropped before `before` (null: last): an insertion index into the current list, and the order shown for a block with no list. */
export function placement(
  ranked: readonly ServedLine[],
  stored: readonly ServedEntry[] | undefined,
  before: ServedLine | null,
): { toIndex: number; shown: ServedEntry[] } {
  const shown = ranked.map(entryOf)
  return { toIndex: insertionIndex(stored ?? shown, before && entryOf(before)), shown }
}

/** The line a ranked line at `index` goes before when moved by one place (`delta` -1 up, 1 down); null: the end. */
export function moveTarget(ranked: readonly ServedLine[], index: number, delta: -1 | 1): ServedLine | null {
  return delta < 0 ? (ranked[index - 1] ?? null) : (ranked[index + 2] ?? null)
}
