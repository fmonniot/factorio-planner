import type { Block, GameData, SolverResult, SubPlan } from '../../data/types'
import { placingItemIds } from '../../data/horizon'
import { surplusTolerance } from '../../solver/index'
import { findSubPlan } from '../../store/blockStore'
import { areaName } from './areaRows'

// ---------------------------------------------------------------------------
// The balance matrix of a block's areas: items as rows, areas as columns, an outside column at each
// end. All rates are items/min. A cell is the area's net of the item (+ it sends, − it receives),
// which is exactly what the solver reports per area (`SolvedArea.sends/receives`); the outside
// columns are the residual that balances the row.
//
// Who sends to whom is NOT known to the solver (its pools are per item), so `rowPairs` allocates
// each sender's output to the receivers pro rata. It is an allocation for display only.
// ---------------------------------------------------------------------------

/** Party id of the block boundary in pair flows. */
export const OUTSIDE = 'outside'
/** items/min: rows below this go to the tail of their group. */
export const TAIL_RATE = 1
/** Rows shown before the tail. */
export const GROUP_HEAD = 7
export const OTHER_GROUP = 'other-items'
export const MACHINES_GROUP = 'machines'

export interface AreaContents {
  rowCount: number
  recipeNames: string[]
  subFactories: string[]
  nestedAreas: string[]
}

export interface MatrixArea {
  areaId: string
  name: string
  isRoot: boolean
  /** the sub-factory row that stands for the area in the block's table; undefined for the root */
  handleNodeId: string | undefined
  contents: AreaContents
}

export interface MatrixRow {
  itemId: string
  name: string
  groupId: string
  /** areaId -> signed net (+ sends, − receives); absent = 0 */
  cells: Record<string, number>
  /** ≥ 0, at most one of the two outside values is non-zero */
  fromOutside: number
  toOutside: number
  /** Σ sends + fromOutside (= Σ receives + toOutside) */
  total: number
}

export interface BlockMatrix {
  blockId: string
  blockName: string
  color: string
  areas: MatrixArea[]
  rows: MatrixRow[]
}

/** `from` and `to` are area ids or OUTSIDE. */
export interface PairFlow { from: string; to: string; rate: number }
export interface ItemGroupInfo { id: string; name: string; order: string }
export type RowMode = 'category' | 'rate' | 'name'
export type ColumnMode = 'flow' | 'table'
export interface RowGroup<R> { id: string; name: string; rows: R[]; head: R[]; tail: R[] }

/** The id of the handle row of sub-plan `subPlanId`, searched through the whole tree. */
export function subPlanHandleId(plan: SubPlan, subPlanId: string): string | undefined {
  for (const n of plan.nodes) if (n.kind === 'subplan' && n.subPlanId === subPlanId) return n.id
  for (const sp of plan.subPlans) {
    const found = subPlanHandleId(sp, subPlanId)
    if (found) return found
  }
  return undefined
}

/** What an area holds: its recipe rows, the sub-factories it contains and the areas nested in it (not entered). */
export function areaContents(root: SubPlan, areaId: string, recipes: GameData['recipes']): AreaContents {
  const start = areaId === root.id ? root : findSubPlan(root, areaId)
  const out: AreaContents = { rowCount: 0, recipeNames: [], subFactories: [], nestedAreas: [] }
  if (!start) return out
  const names = new Set<string>()

  function visit(plan: SubPlan) {
    const children = new Map(plan.subPlans.map(sp => [sp.id, sp]))
    const handled = new Set<string>()
    const enter = (child: SubPlan) => {
      if (child.area === true) out.nestedAreas.push(child.name)
      else {
        out.subFactories.push(child.name)
        visit(child)
      }
    }
    for (const n of plan.nodes) {
      if (n.kind === 'game-recipe') {
        out.rowCount += 1
        const name = recipes[n.recipeId]?.name ?? n.recipeId
        if (!names.has(name)) {
          names.add(name)
          out.recipeNames.push(name)
        }
      } else {
        const child = children.get(n.subPlanId)
        if (!child) continue
        handled.add(child.id)
        enter(child)
      }
    }
    for (const sp of plan.subPlans) if (!handled.has(sp.id)) enter(sp)
  }
  visit(start)
  return out
}

/** Ids of the items that place a machine or a beacon. */
export function machineItemIds(gameData: GameData): Set<string> {
  const ids = new Set<string>()
  for (const list of placingItemIds(gameData).values()) for (const id of list) ids.add(id)
  return ids
}

/** The category of an item: its item group, "Machines for buildings" for a machine, "Other" when unknown. */
export function itemGroupOf(itemId: string, gameData: GameData, machines: Set<string>): ItemGroupInfo {
  if (machines.has(itemId)) return { id: MACHINES_GROUP, name: 'Machines for buildings', order: '' }
  const subgroup = gameData.items[itemId]?.subgroup
  const groupId = subgroup ? gameData.itemSubgroups[subgroup]?.group : undefined
  const group = groupId ? gameData.itemGroups[groupId] : undefined
  if (!group) return { id: OTHER_GROUP, name: 'Other', order: '' }
  return { id: group.id, name: group.name, order: group.order }
}

const byTotalThenName = (a: { total: number; name: string }, b: { total: number; name: string }) =>
  b.total - a.total || a.name.localeCompare(b.name)

/** The matrix of a block's areas; undefined when the block has no separate area. */
export function blockMatrix(block: Block, result: SolverResult, gameData: GameData, machines: Set<string>): BlockMatrix | undefined {
  if (!result.areas) return undefined
  const root = block.rootPlan
  const areas: MatrixArea[] = result.areas.map(a => ({
    areaId: a.areaId,
    name: areaName(root, a.areaId),
    isRoot: a.areaId === root.id,
    handleNodeId: a.areaId === root.id ? undefined : subPlanHandleId(root, a.areaId),
    contents: areaContents(root, a.areaId, gameData.recipes),
  }))

  const cellsOf = new Map<string, Record<string, number>>()
  const add = (itemId: string, areaId: string, v: number) => {
    let cells = cellsOf.get(itemId)
    if (!cells) cellsOf.set(itemId, (cells = {}))
    cells[areaId] = (cells[areaId] ?? 0) + v
  }
  for (const a of result.areas) {
    for (const f of a.sends) add(f.itemId, a.areaId, f.rate)
    for (const f of a.receives) add(f.itemId, a.areaId, -f.rate)
  }

  const rows: MatrixRow[] = []
  for (const [itemId, cells] of cellsOf) {
    let pos = 0
    let neg = 0
    for (const v of Object.values(cells)) {
      if (v > 0) pos += v
      else neg -= v
    }
    const s = pos - neg
    const tol = surplusTolerance(Math.max(pos, neg))
    const fromOutside = s < -tol ? -s : 0
    const toOutside = s > tol ? s : 0
    rows.push({
      itemId,
      name: gameData.items[itemId]?.name ?? itemId,
      groupId: itemGroupOf(itemId, gameData, machines).id,
      cells,
      fromOutside,
      toOutside,
      total: pos + fromOutside,
    })
  }
  rows.sort(byTotalThenName)
  return { blockId: block.id, blockName: block.name, color: block.color, areas, rows }
}

/**
 * Who sends how much to whom, allocated pro rata: a sender's output is split over the receivers in
 * proportion to what each takes. The outside is a sender (`fromOutside`) and a receiver (`toOutside`).
 */
export function rowPairs(row: MatrixRow): PairFlow[] {
  const sources: [string, number][] = []
  const sinks: [string, number][] = []
  for (const [id, v] of Object.entries(row.cells)) {
    if (v > 0) sources.push([id, v])
    else if (v < 0) sinks.push([id, -v])
  }
  if (row.fromOutside > 0) sources.push([OUTSIDE, row.fromOutside])
  if (row.toOutside > 0) sinks.push([OUTSIDE, row.toOutside])
  const T = sinks.reduce((n, [, v]) => n + v, 0)
  if (T <= 0) return []
  const pairs: PairFlow[] = []
  for (const [from, src] of sources) {
    for (const [to, sink] of sinks) {
      const rate = (src * sink) / T
      if (rate > 1e-9) pairs.push({ from, to, rate })
    }
  }
  return pairs
}

/** Area ids ordered so that flows mostly go left to right (a greedy feedback-arc ordering). */
export function flowOrder(m: BlockMatrix): string[] {
  const ids = m.areas.map(a => a.areaId)
  const w = new Map<string, number>()
  const key = (a: string, b: string) => `${a}\u0000${b}`
  for (const row of m.rows) {
    for (const p of rowPairs(row)) {
      if (p.from === OUTSIDE || p.to === OUTSIDE) continue
      w.set(key(p.from, p.to), (w.get(key(p.from, p.to)) ?? 0) + p.rate)
    }
  }
  const remaining = [...ids]
  const order: string[] = []
  const weight = (a: string, b: string) => w.get(key(a, b)) ?? 0
  while (remaining.length > 0) {
    const incoming = (n: string) => remaining.reduce((t, o) => (o === n ? t : t + weight(o, n)), 0)
    const outgoing = (n: string) => remaining.reduce((t, o) => (o === n ? t : t + weight(n, o)), 0)
    let pick = remaining.find(n => incoming(n) <= 1e-9)
    if (pick === undefined) {
      pick = remaining[0]
      let best = outgoing(pick) - incoming(pick)
      for (const n of remaining.slice(1)) {
        const d = outgoing(n) - incoming(n)
        if (d > best + 1e-9) {
          best = d
          pick = n
        }
      }
    }
    order.push(pick)
    remaining.splice(remaining.indexOf(pick), 1)
  }
  return order
}

/**
 * Splits rows into groups by the row mode, and each group into a head and a tail (the small rows).
 * `category`: item-group order, then Other, then Machines; `rate`: one group by total; `name`: one A–Z group, no tail.
 */
export function groupRows<R extends { itemId: string; name: string; total: number; groupId: string }>(
  rows: R[],
  mode: RowMode,
  groups: Map<string, ItemGroupInfo>,
  opts: { collapseTail: boolean },
): RowGroup<R>[] {
  const split = (id: string, name: string, list: R[]): RowGroup<R> => {
    if (!opts.collapseTail || mode === 'name') return { id, name, rows: list, head: list, tail: [] }
    const n = list.length
    const small = list.findIndex(r => r.total < TAIL_RATE)
    let k = Math.min(GROUP_HEAD, small === -1 ? n : small)
    k = Math.max(k, 1)
    if (n - k === 1 && list[k].total >= TAIL_RATE) k = n
    k = Math.min(k, n)
    return { id, name, rows: list, head: list.slice(0, k), tail: list.slice(k) }
  }

  if (mode === 'rate') return [split('all', 'All items', [...rows].sort(byTotalThenName))]
  if (mode === 'name') return [split('all', 'All items', [...rows].sort((a, b) => a.name.localeCompare(b.name)))]

  const byGroup = new Map<string, R[]>()
  for (const r of rows) {
    const list = byGroup.get(r.groupId)
    if (list) list.push(r)
    else byGroup.set(r.groupId, [r])
  }
  const rank = (id: string): [number, string] => {
    if (id === OTHER_GROUP) return [1, '']
    if (id === MACHINES_GROUP) return [2, '']
    return [0, groups.get(id)?.order || id]
  }
  const ids = [...byGroup.keys()].sort((a, b) => {
    const [ra, oa] = rank(a)
    const [rb, ob] = rank(b)
    return ra - rb || oa.localeCompare(ob) || a.localeCompare(b)
  })
  return ids.map(id => {
    const name = id === OTHER_GROUP ? 'Other' : id === MACHINES_GROUP ? 'Machines for buildings' : (groups.get(id)?.name ?? id)
    return split(id, name, [...byGroup.get(id)!].sort(byTotalThenName))
  })
}

export interface FocusView {
  areaId: string
  /** the rows where the area has a cell */
  rows: MatrixRow[]
  /** itemId -> partyId -> rate (allocated) between the focus and that party, either direction */
  counterpart: Record<string, Record<string, number>>
  tradingAreaIds: string[]
  /** `inRate` is what the party sends the focus, `outRate` what the focus sends the party */
  trades: { partyId: string; items: number; inRate: number; outRate: number }[]
}

/** What one area trades: its rows, the allocated counterpart of each, and who it trades with. */
export function focusArea(m: BlockMatrix, areaId: string): FocusView {
  const rows = m.rows.filter(r => (r.cells[areaId] ?? 0) !== 0)
  const counterpart: Record<string, Record<string, number>> = {}
  const trade = new Map<string, { items: Set<string>; inRate: number; outRate: number }>()
  const entry = (id: string) => {
    let t = trade.get(id)
    if (!t) trade.set(id, (t = { items: new Set(), inRate: 0, outRate: 0 }))
    return t
  }
  for (const row of rows) {
    const per: Record<string, number> = {}
    for (const p of rowPairs(row)) {
      if (p.from === areaId) {
        per[p.to] = (per[p.to] ?? 0) + p.rate
        const t = entry(p.to)
        t.items.add(row.itemId)
        t.outRate += p.rate
      } else if (p.to === areaId) {
        per[p.from] = (per[p.from] ?? 0) + p.rate
        const t = entry(p.from)
        t.items.add(row.itemId)
        t.inRate += p.rate
      }
    }
    counterpart[row.itemId] = per
  }
  const tradingAreaIds = m.areas.map(a => a.areaId).filter(id => id !== areaId && trade.has(id))
  const trades = [...trade.entries()]
    .map(([partyId, t]) => ({ partyId, items: t.items.size, inRate: t.inRate, outRate: t.outRate }))
  const order = (id: string) => (id === OUTSIDE ? Infinity : m.areas.findIndex(a => a.areaId === id))
  trades.sort((a, b) => {
    if ((a.partyId === OUTSIDE) !== (b.partyId === OUTSIDE)) return a.partyId === OUTSIDE ? 1 : -1
    return b.inRate + b.outRate - (a.inRate + a.outRate) || order(a.partyId) - order(b.partyId)
  })
  return { areaId, rows, counterpart, tradingAreaIds, trades }
}

/**
 * Filters rows and columns by a free-text query (trimmed, case-insensitive). Rows are the item hits
 * if any, otherwise the rows with a cell in a column hit; `columnIds` null = every column.
 * Returns null when nothing matches.
 */
export function matchQuery<R extends { itemId: string; name: string }>(
  query: string,
  rows: R[],
  columns: { id: string; names: string[] }[],
  hasCell: (r: R, colId: string) => boolean,
): { rows: R[]; columnIds: Set<string> | null } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { rows, columnIds: null }
  const has = (text: string) => text.toLowerCase().includes(q)
  const itemHits = rows.filter(r => has(r.name))
  const colHits = columns.filter(c => c.names.some(has)).map(c => c.id)
  if (itemHits.length === 0 && colHits.length === 0) return null
  const columnIds = colHits.length > 0 ? new Set(colHits) : null
  if (itemHits.length > 0) return { rows: itemHits, columnIds }
  return { rows: rows.filter(r => colHits.some(c => hasCell(r, c))), columnIds }
}

/** Every category an item can fall in, by id (the item groups of the bundle, Other and Machines). */
export function itemGroupMap(gameData: GameData): Map<string, ItemGroupInfo> {
  const map = new Map<string, ItemGroupInfo>()
  for (const g of Object.values(gameData.itemGroups)) map.set(g.id, { id: g.id, name: g.name, order: g.order })
  map.set(OTHER_GROUP, { id: OTHER_GROUP, name: 'Other', order: '' })
  map.set(MACHINES_GROUP, { id: MACHINES_GROUP, name: 'Machines for buildings', order: '' })
  return map
}
