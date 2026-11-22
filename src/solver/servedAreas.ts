import type { AreaRoute, ServedConsumer } from '../data/types'
import { FLOW_TOLERANCE } from './blockResult'
import type { RankedEntry } from './servedRank'

/** An area of a consumer block and what it takes of an item from outside the block. */
export interface AreaNeed { areaId: string; need: number }

/** item id → the areas that need it from outside, in table order. */
export type AreaNeeds = ReadonlyMap<string, readonly AreaNeed[]>

/**
 * The outside legs of `areaRoutes` (an item entering an area from outside the block), per item, in table order. Undefined
 * when the block has no areas (`routes` undefined), so a block without areas costs nothing.
 */
export function areaNeedsOf(routes: readonly AreaRoute[] | undefined): AreaNeeds | undefined {
  if (!routes) return undefined
  const needs = new Map<string, AreaNeed[]>()
  for (const r of routes) {
    if (r.from !== undefined || r.to === undefined || !(r.rate > FLOW_TOLERANCE)) continue
    const list = needs.get(r.itemId) ?? []
    // A split fluid's legs into one area (one per range) add up to the area's need.
    const same = list.find(n => n.areaId === r.to)
    if (same) same.need += r.rate
    else list.push({ areaId: r.to, need: r.rate })
    needs.set(r.itemId, list)
  }
  return needs
}

/**
 * Turn the entries of a pair (the listed ones, then the unlisted consumers in solve order) into entries that know their
 * areas. A consumer is split iff it needs the item (`total > 0`) and has two or more needy areas or some area entry in the
 * order; any other consumer, and the extra, comes out untouched so the arithmetic of a plain pair is unchanged.
 * An area entry takes its area's part of the total need; a block entry takes the areas no area entry names (`part` 1 when no
 * entry names any). An entry with nothing to cover (an area that does not need the item, a block entry whose areas are all
 * named) stays in the order as a zero entry (`areas: []`, `part: 0`): inert in every group.
 */
export function splitByArea(order: readonly RankedEntry[], needsOf: (blockId: string) => readonly AreaNeed[]): RankedEntry[] {
  const named = new Map<string, Set<string>>()
  for (const e of order) {
    if (e.kind !== 'block' || e.areaId === undefined) continue
    const set = named.get(e.blockId) ?? new Set<string>()
    set.add(e.areaId)
    named.set(e.blockId, set)
  }
  return order.map((e): RankedEntry => {
    if (e.kind === 'extra') return e
    const needs = needsOf(e.blockId)
    const total = needs.reduce((a, n) => a + n.need, 0)
    const names = named.get(e.blockId)
    if (e.areaId !== undefined && !(total > 0)) return { ...e, areas: [], total, part: 0 }
    if (!(total > 0 && (needs.length >= 2 || names !== undefined))) return e
    if (e.areaId !== undefined) {
      const mine = needs.find(n => n.areaId === e.areaId)
      return mine ? { ...e, areas: [mine], total, part: mine.need / total } : { ...e, areas: [], total, part: 0 }
    }
    const rest = needs.filter(n => !names?.has(n.areaId))
    return { ...e, areas: rest, total, part: names === undefined ? 1 : rest.reduce((a, n) => a + n.need, 0) / total }
  })
}

/**
 * Hand `total` to the targets of an index in turn: for each list of `targets`, every index in order takes up to what that list
 * allows it beyond what it already has. Something no list took (a take that got more than it was credited or needed) goes
 * to the last index with a positive target (the last one when none has).
 */
export function handOut(total: number, targets: readonly (readonly number[])[]): number[] {
  const n = targets[0]?.length ?? 0
  const got = new Array<number>(n).fill(0)
  let left = Math.max(0, total)
  for (const t of targets) {
    for (let i = 0; i < n && left > 0; i++) {
      const give = Math.min(left, Math.max(0, t[i] - got[i]))
      got[i] += give
      left -= give
    }
  }
  if (left > FLOW_TOLERANCE && n > 0) {
    // the last index that draws a line (one with a share or a need somewhere): a zero entry has no line to show it on
    let last = n - 1
    for (let i = n - 1; i >= 0; i--) {
      if (targets.some(t => t[i] > 0)) { last = i; break }
    }
    got[last] += left
  }
  return got
}

/** A ranked pair's entries (areas expanded) and what the last grant gave each. */
export interface PairEntries {
  entries: readonly RankedEntry[]
  granted: readonly number[]
}

/** What the report needs of the solve to draw the areas of a consumer. */
export interface AreaReport {
  /** The areas of `blockId` that need `itemId`: the request probe, else the final solve. */
  needsOf(blockId: string, itemId: string): readonly AreaNeed[]
  /** The entries of a ranked pair and their grants; undefined when the pair is not ranked. */
  entriesOf(sourceId: string, itemId: string): PairEntries | undefined
}

/**
 * The lines of one (source, item) pair when some consumer shows as areas, or undefined when none does (the caller keeps one
 * line per block). `consumers` are the base lines, one per block in flow order; `ranked` the pair's entries when a list ranks it.
 * Each connection's rate goes to its entries in list order (up to each grant, then up to each share, then up to each need), and
 * inside an entry to its areas in table order. A block entry covering several areas gives consecutive area lines; one covering
 * exactly one area is labelled with it. The extra's place is counted in lines.
 */
export function areaLines(
  sourceId: string,
  itemId: string,
  consumers: readonly ServedConsumer[],
  ranked: PairEntries | undefined,
  needsOf: (blockId: string) => readonly AreaNeed[],
): { consumers: ServedConsumer[]; extraPlace: number } | undefined {
  let order: readonly RankedEntry[]
  let granted: readonly number[]
  if (ranked) {
    order = ranked.entries
    granted = ranked.granted
  } else {
    order = splitByArea(
      consumers.map((c): RankedEntry => ({ kind: 'block', blockId: c.blockId, connection: { id: c.connectionId, itemId, fromBlockId: sourceId } })),
      needsOf,
    )
    granted = order.map(() => 0)
  }
  if (!order.some(e => e.kind === 'block' && e.areas !== undefined)) return undefined

  const byConn = new Map(consumers.map(c => [c.connectionId, c]))
  const entriesOfConn = new Map<string, number[]>()
  order.forEach((e, i) => {
    if (e.kind !== 'block') return
    const list = entriesOfConn.get(e.connection.id) ?? []
    list.push(i)
    entriesOfConn.set(e.connection.id, list)
  })
  const entryGot = new Map<number, number>()
  for (const [id, idx] of entriesOfConn) {
    const c = byConn.get(id)
    if (!c) continue
    const share = idx.map(i => c.share * partOf(order[i]))
    const need = idx.map(i => areasOf(order[i]).reduce((a, n) => a + n.need, 0))
    const got = handOut(c.got, [idx.map(i => granted[i]), share, need])
    idx.forEach((i, m) => entryGot.set(i, got[m]))
  }

  const lines: ServedConsumer[] = []
  const used = new Set<string>()
  let extraPlace: number | undefined
  order.forEach((e, i) => {
    if (e.kind === 'extra') {
      extraPlace ??= lines.length
      return
    }
    const c = byConn.get(e.connection.id)
    if (!c) return
    used.add(c.connectionId)
    if (e.areas === undefined) {
      lines.push({ ...c })
      return
    }
    const total = e.total ?? 0
    const units = e.areas.map(a => ({ a, q: (c.share * a.need) / total }))
    const got = handOut(entryGot.get(i) ?? 0, [units.map(u => u.q), units.map(u => u.a.need)])
    units.forEach((u, m) => {
      lines.push({
        ...c,
        areaId: u.a.areaId,
        share: u.q,
        got: got[m],
        ...(c.need !== undefined ? { need: (c.need * u.a.need) / total } : {}),
      })
    })
  })
  for (const c of consumers) if (!used.has(c.connectionId)) lines.push({ ...c })
  return { consumers: lines, extraPlace: extraPlace ?? lines.length }
}

const partOf = (e: RankedEntry): number => (e.kind === 'block' ? (e.part ?? 1) : 1)
const areasOf = (e: RankedEntry): readonly AreaNeed[] => (e.kind === 'block' ? (e.areas ?? [{ areaId: '', need: Infinity }]) : [])
