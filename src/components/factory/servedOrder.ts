import type { Block, ServedEntry, ServedList } from '../../data/types'
import { areaName } from '../../data/subPlanTree'
import { dropServedEntries, expandServedAreas, groupPercents, servedEntryKey, servedGroupSpans } from '../../data/servedEntries'
import type { ServedPlace } from '../../data/servedEntries'
import type { RateUnit } from '../../store/uiStore'
import { isShortfall } from './summarySegments'
import { blockAreas } from '../../solver/areas'

/** A line's group: how many lines share its place, its index among them, its percentage and whether the solver served the group in list order. */
export interface ServedLineGroup { size: number; index: number; percent: number; listOrder: boolean }

/** One line of the served-order popover: a consumer, or the source's own extra output. */
export interface ServedLine {
  kind: 'request' | 'take' | 'extra'
  /** 1-based place of the line's group among the ranked groups (lines of a group share it); 0 for a line the list does not rank (also before `splitServed` has run) */
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
  /** the take got no credit because the request pass flushed it while its source or a take above it was not credited yet, and the credit passes did not settle it (see `ServedConsumer.notCredited`) */
  notCredited?: true
  /** a take whose group the solver served in list order, not by its weights (copied from the consumer) */
  groupInListOrder?: true
  /** only on a ranked line whose group has two lines or more */
  group?: ServedLineGroup
  /** Set when the line is one area of a consumer block (copied from `ServedConsumer.areaId`). */
  areaId?: string
  /** Only on a ranked line of a plain block entry that stands for two lines or more (a stored list written before the popover drew areas, or a block entry covering several areas): how many lines the entry covers and this line's index among them. The entry's rank, group and percentage belong to all of them. */
  span?: { size: number; index: number }
}

/** The order is worth showing when something is ordered: two lines, or one line and the extra. */
export function hasServedOrder(list: ServedList | undefined): boolean {
  if (!list) return false
  return list.consumers.length >= 2 || (list.consumers.length === 1 && list.extra !== undefined)
}

/**
 * The lines in the order the solver served them. A take gets no `short`: its `need` comes from the request probe (unlimited
 * supply), so a gap to `got` may be the consumer's own limit or another source, not this one running dry.
 */
export function servedLines(list: ServedList, itemId: string, unit: RateUnit): ServedLine[] {
  const lines: ServedLine[] = list.consumers.map(c => {
    const line: ServedLine = { kind: c.kind, rank: 0, blockId: c.blockId, connectionId: c.connectionId, got: c.got }
    if (c.areaId !== undefined) line.areaId = c.areaId
    if (c.kind === 'request') {
      line.asked = c.share
      if (isShortfall(c.share, c.got, unit, itemId)) line.short = c.share - c.got
    } else {
      if (c.notCredited) line.notCredited = true
      if (c.groupInListOrder) line.groupInListOrder = true
      if (c.need !== undefined) line.need = c.need
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

/** What a line is called in the popover: the extra, the consumer block, or `Block / Area` (ids when the block or area is gone). */
export function lineName(line: ServedLine, block: Block | undefined): string {
  if (line.kind === 'extra') return 'Extra output'
  const name = block?.name ?? line.blockId ?? ''
  if (line.areaId === undefined) return name
  return `${name} / ${block ? areaName(block.rootPlan, line.areaId) : line.areaId}`
}

/** What a line is called in a list and in the DOM: the extra, the consumer block, or one area of it (an entry only). */
export function lineKey(x: ServedLine | ServedEntry): string {
  if (x.kind === 'extra') return 'extra'
  if (x.kind === 'block') return servedEntryKey(x)
  return servedEntryKey({ kind: 'block', blockId: x.blockId!, ...(x.areaId !== undefined ? { areaId: x.areaId } : {}) })
}

/** The list entry of a line. */
export function entryOf(line: ServedLine): ServedEntry {
  return line.kind === 'extra' ? { kind: 'extra' } : { kind: 'block', blockId: line.blockId!, ...(line.areaId !== undefined ? { areaId: line.areaId } : {}) }
}

/** The line reads tied to the one above: a member of its group after the first, or a continuation line of a plain entry that is in a group. */
export function isTiedLine(line: ServedLine): boolean {
  return line.group !== undefined && (line.group.index > 0 || (line.span?.index ?? 0) > 0)
}

/** How many lines after `line` in `ranked` have its rank (0 when `line` is not there). */
export function underIn(ranked: readonly ServedLine[], line: ServedLine): number {
  const at = ranked.findIndex(l => lineKey(l) === lineKey(line))
  return at < 0 ? 0 : ranked.slice(at + 1).filter(l => l.rank === line.rank).length
}

/** The index to insert before `before` in `order`: its place, or the end when `before` is null or not in the list. */
export function insertionIndex(order: readonly ServedEntry[], before: ServedEntry | null): number {
  if (before === null) return order.length
  const i = order.findIndex(e => lineKey(e) === lineKey(before))
  return i < 0 ? order.length : i
}

/** The `hasArea` predicate of `splitServed` over the plan's blocks: whether the block's plan has an area with that id, even one that needs nothing. */
export function areaExistsIn(blocks: readonly Block[]): (blockId: string, areaId: string) => boolean {
  return (blockId, areaId) => {
    const root = blocks.find(b => b.id === blockId)?.rootPlan
    return root !== undefined && (blockAreas(root)?.some(a => a.id === areaId) ?? false)
  }
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
 * `hasArea` says whether a consumer has an area: an area entry for an area that exists but needs nothing has no line, yet the
 * solver keeps it as a member of its group (it asks for nothing), so it stays in the group's shape and percentages here too;
 * the lines show only the members that have one. Without `hasArea` such an entry reads as stale.
 */
export function splitServed(
  lines: readonly ServedLine[],
  stored: readonly ServedEntry[] | undefined,
  hasArea?: (blockId: string, areaId: string) => boolean,
): ServedSections {
  if (stored === undefined) return { hasList: false, ranked: lines.map((l, i) => ({ ...l, rank: i + 1 })), unranked: [] }
  const byKey = new Map(lines.map(l => [lineKey(l), l]))
  const named = new Map<string, Set<string>>() // block id -> area ids named by an area entry of the list
  for (const e of stored) {
    if (e.kind === 'block' && e.areaId !== undefined) {
      const set = named.get(e.blockId) ?? new Set<string>()
      set.add(e.areaId)
      named.set(e.blockId, set)
    }
  }
  const linesOf = (e: ServedEntry): ServedLine[] => {
    if (e.kind === 'extra') {
      const x = byKey.get('extra')
      return x ? [x] : []
    }
    if (e.areaId !== undefined) {
      const l = byKey.get(servedEntryKey(e))
      return l ? [l] : []
    }
    // a plain entry stands for the lines of its block that no area entry names (table order); an unsplit block has one line
    return lines.filter(l => l.kind !== 'extra' && l.blockId === e.blockId && (l.areaId === undefined || !named.get(e.blockId)?.has(l.areaId)))
  }
  const seen = new Set<string>()
  const used = new Set<string>()
  const linesByEntry = new Map<ServedEntry, ServedLine[]>() // each stored entry's lines, computed once
  // the solver's own stale rule: a stale or repeated entry goes, a removed head promotes its first follower
  const kept = dropServedEntries(stored, e => {
    const key = servedEntryKey(e)
    const repeat = seen.has(key)
    const mine = repeat ? [] : linesOf(e)
    linesByEntry.set(e, mine)
    seen.add(key)
    if (mine.length === 0) return repeat || !(e.kind === 'block' && e.areaId !== undefined && hasArea?.(e.blockId, e.areaId) === true)
    mine.forEach(l => used.add(lineKey(l)))
    return false
  })
  const ranked: ServedLine[] = []
  let place = 0
  for (const [start, end] of servedGroupSpans(kept)) {
    const members = kept.slice(start, end)
    const percents = groupPercents(members)
    const covered = members.map(e => linesByEntry.get(e) ?? linesOf(e))
    const visible = covered.flatMap((ls, i) => (ls.length > 0 ? [i] : [])) // members that have a line; the rest need nothing
    if (visible.length === 0) continue
    place++
    const listOrder = covered.some(ls => ls.some(l => l.groupInListOrder === true))
    visible.forEach((i, v) =>
      covered[i].forEach((l, k) => {
        const line: ServedLine = { ...l, rank: place }
        if (visible.length >= 2) line.group = { size: visible.length, index: v, percent: percents[i], listOrder }
        if (covered[i].length >= 2) line.span = { size: covered[i].length, index: k }
        ranked.push(line)
      }),
    )
  }
  const rest = lines.filter(l => !used.has(lineKey(l)) && l.kind !== 'extra').map(l => ({ ...l, rank: 0 }))
  const extra = lines.find(l => l.kind === 'extra' && !used.has('extra'))
  return { hasList: true, ranked, unranked: extra ? [...rest, { ...extra, rank: 0 }] : rest }
}

/** How many of the lines the stored list does not rank (0 without a stored list). */
export function unrankedCount(
  lines: readonly ServedLine[],
  stored: readonly ServedEntry[] | undefined,
  hasArea?: (blockId: string, areaId: string) => boolean,
): number {
  return stored === undefined ? 0 : splitServed(lines, stored, hasArea).unranked.length
}

/** Where `entry` goes in the store's terms when dropped before `before` (null: last): an insertion index into the current list, and the order shown for a block with no list. */
export function placement(
  ranked: readonly ServedLine[],
  stored: readonly ServedEntry[] | undefined,
  before: ServedLine | null,
): { toIndex: number; shown: ServedEntry[] } {
  const shown = ranked.map(entryOf)
  const base = stored === undefined ? shown : expandServedAreas(stored, shown)
  return { toIndex: insertionIndex(base, before && entryOf(before)), shown }
}

/** The line a ranked line at `index` goes before when moved by one place (`delta` -1 up, 1 down); null: the end. */
export function moveTarget(ranked: readonly ServedLine[], index: number, delta: -1 | 1): ServedLine | null {
  return delta < 0 ? (ranked[index - 1] ?? null) : (ranked[index + 2] ?? null)
}

/** A drop within this fraction of a line's height from its top or bottom is an edge; the rest is the middle. */
export const EDGE_FRACTION = 0.3
export type DropZone = 'top' | 'middle' | 'bottom'

/** The zone of a line a drop at `offsetY` (from the line's top) lands in; a line with no height reads as the middle. */
export function dropZone(offsetY: number, height: number): DropZone {
  if (!(height > 0)) return 'middle'
  if (offsetY < height * EDGE_FRACTION) return 'top'
  if (offsetY > height * (1 - EDGE_FRACTION)) return 'bottom'
  return 'middle'
}

/** The place a drop on ranked line `index` lands (`index >= ranked.length`: the divider, last): an edge a rank of its own, the middle the line's group. */
export function dropPlace(ranked: readonly ServedLine[], index: number, zone: DropZone): ServedPlace {
  if (index >= ranked.length) return { kind: 'rank', before: null }
  if (zone === 'middle') return { kind: 'join', target: entryOf(ranked[index]) }
  const before = zone === 'top' ? ranked[index] : ranked[index + 1]
  return { kind: 'rank', before: before ? entryOf(before) : null }
}

/** A percentage with at most one decimal. */
export const fmtPercent = (p: number): string => String(Math.round(p * 10) / 10)
