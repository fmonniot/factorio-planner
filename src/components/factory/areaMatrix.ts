import type { Block, FluidTag, GameData, SolverResult, SubPlan } from '../../data/types'
import { compareTags, fmtFluidTag, flowKey, parseFlowKey } from '../../data/flowKey'
import { placingItemIds } from '../../data/horizon'
import { outsideResidual } from '../../solver/index'
import { findSubPlan } from '../../data/subPlanTree'
import { areaName } from '../../data/subPlanTree'
import { isEnergyItem } from '../../data/electricity'
import { routeEnds } from './areaRouteEnds'
import { areaMissingOf } from './summaryRows'

// ---------------------------------------------------------------------------
// The balance matrix of a block's areas: flow keys as rows (a split fluid has a row per temperature or range), areas as columns, an outside column at each
// end. All rates are items/min. A cell is the area's net of the item (+ it sends, − it receives),
// which is exactly what the solver reports per area (`SolvedArea.sends/receives`); the outside
// columns are the residual that balances the row.
//
// Who sends to whom comes from the solver's routes (`SolverResult.areaRoutes`), kept per row in
// `MatrixRow.pairs`.
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

/** What a row's From outside figure is made of (items/min, the parts add up to the figure). */
export interface OutsideSplit {
  /** supplied by other blocks */
  connected: number
  /** taken from outside the plan, Import on */
  imported: number
  /** what Import off leaves unmet */
  missing: number
}

const SPLIT_EPS = 1e-6

/**
 * Splits `fromOutside` using the block's own unsatisfied import of the key (`unsatisfied`) and the part of it that Import off
 * leaves missing: the import is at most the figure, the rest comes from connections. A connected sliver below the
 * tolerance is folded into the import so no part is noise.
 */
export function splitOutside(fromOutside: number, unsatisfied: number, missing: number): OutsideSplit {
  const imp = Math.min(fromOutside, Math.max(0, unsatisfied))
  const m = Math.min(imp, Math.max(0, missing))
  let connected = fromOutside - imp
  let imported = imp - m
  let miss = m
  if (imported + miss < SPLIT_EPS) {
    return { connected: fromOutside, imported: 0, missing: 0 }
  }
  if (connected < SPLIT_EPS) {
    if (imported > 0) imported += connected
    else miss += connected
    connected = 0
  }
  return { connected, imported, missing: miss }
}

export interface MatrixRow {
  /** Unique within the matrix: the flow key of a split fluid's temperature or range, the item id otherwise. */
  key: string
  /** The base item: what its icon, energy check and rule are about. */
  itemId: string
  /** The base item's name; `rowDisplayName` adds the temperature. */
  name: string
  /** A split fluid's temperature or range. */
  temp?: FluidTag
  groupId: string
  /** areaId -> signed net (+ sends, − receives); absent = 0 */
  cells: Record<string, number>
  /** ≥ 0, at most one of the two outside values is non-zero */
  fromOutside: number
  toOutside: number
  /** What `fromOutside` is made of; absent when it is 0 and for energy */
  fromSplit?: OutsideSplit
  /** Σ sends + fromOutside (= Σ receives + toOutside) */
  total: number
  /** the solver's routes of this item, outside as OUTSIDE; empty when the result has none */
  pairs: PairFlow[]
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

/** The keys of one item in order: the untagged key first, then the tags in `compareTags` order (a total order). */
export function compareTempKeys(a: { temp?: FluidTag }, b: { temp?: FluidTag }): number {
  if (a.temp === undefined || b.temp === undefined) return a.temp === b.temp ? 0 : a.temp === undefined ? -1 : 1
  return compareTags(a.temp, b.temp)
}

const byName = (a: { name: string; temp?: FluidTag }, b: { name: string; temp?: FluidTag }) =>
  a.name.localeCompare(b.name) || compareTempKeys(a, b)

const byTotalThenName = (a: { total: number; name: string; temp?: FluidTag }, b: { total: number; name: string; temp?: FluidTag }) =>
  b.total - a.total || byName(a, b)

/** A row's name with its temperature or range: "Steam ≥465°C"; the plain name when it has none. */
export function rowDisplayName(row: { name: string; temp?: FluidTag }): string {
  const label = fmtFluidTag(row.temp)
  return label ? `${row.name} ${label}` : row.name
}

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
  const add = (key: string, areaId: string, v: number) => {
    let cells = cellsOf.get(key)
    if (!cells) cellsOf.set(key, (cells = {}))
    cells[areaId] = (cells[areaId] ?? 0) + v
  }
  for (const a of result.areas) {
    for (const f of a.sends) add(flowKey(f.itemId, f.temp), a.areaId, f.rate)
    for (const f of a.receives) add(flowKey(f.itemId, f.temp), a.areaId, -f.rate)
  }

  const pairsOf = new Map<string, PairFlow[]>()
  for (const r of result.areaRoutes ?? []) {
    const key = flowKey(r.itemId, r.temp)
    const list = pairsOf.get(key) ?? []
    list.push({ from: r.from ?? OUTSIDE, to: r.to ?? OUTSIDE, rate: r.rate })
    pairsOf.set(key, list)
  }

  // The block's remaining import per flow key, and the part areas with Import off leave missing (as the Sources list reads them).
  const unsat = new Map<string, number>()
  for (const u of result.unsatisfied ?? []) {
    const k = flowKey(u.itemId, u.temp)
    unsat.set(k, (unsat.get(k) ?? 0) + u.rate)
  }
  const missingOf = result.areaRoutes ? areaMissingOf(block.sourceRules, root, result.areaRoutes) : undefined

  const rows: MatrixRow[] = []
  for (const [key, cells] of cellsOf) {
    const { itemId, tag } = parseFlowKey(key)
    let pos = 0
    let neg = 0
    for (const v of Object.values(cells)) {
      if (v > 0) pos += v
      else neg -= v
    }
    const { fromOutside, toOutside } = outsideResidual(pos, neg)
    let fromSplit: OutsideSplit | undefined
    if (fromOutside > 0 && !isEnergyItem(itemId)) {
      const u = unsat.get(key) ?? 0
      const m = u > 0 ? Math.min(u, missingOf?.(itemId, u, tag) ?? (block.sourceRules?.[itemId]?.importOff ? u : 0)) : 0
      fromSplit = splitOutside(fromOutside, u, m)
    }
    rows.push({
      key,
      itemId,
      ...(tag ? { temp: tag } : {}),
      name: gameData.items[itemId]?.name ?? itemId,
      groupId: itemGroupOf(itemId, gameData, machines).id,
      cells,
      fromOutside,
      toOutside,
      ...(fromSplit ? { fromSplit } : {}),
      total: pos + fromOutside,
      pairs: pairsOf.get(key) ?? [],
    })
  }
  rows.sort(byTotalThenName)
  return { blockId: block.id, blockName: block.name, color: block.color, areas, rows }
}

/** Area ids ordered so that flows mostly go left to right (a greedy feedback-arc ordering). */
export function flowOrder(m: BlockMatrix): string[] {
  const ids = m.areas.map(a => a.areaId)
  const w = new Map<string, number>()
  const key = (a: string, b: string) => `${a}\u0000${b}`
  for (const row of m.rows) {
    for (const p of row.pairs) {
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
export function groupRows<R extends { itemId: string; name: string; temp?: FluidTag; total: number; groupId: string }>(
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
  if (mode === 'name') return [split('all', 'All items', [...rows].sort(byName))]

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

/** One item a focus area trades with one party, in one direction (`in`: the party sends it to the focus). */
export interface TradeLine {
  /** The row's flow key. */
  key: string
  itemId: string
  name: string
  temp?: FluidTag
  direction: 'in' | 'out'
  /** items/min, or power for energy */
  rate: number
  energy: boolean
}

export interface FocusView {
  areaId: string
  /** the rows where the area has a cell */
  rows: MatrixRow[]
  /** flow key -> partyId -> rate (from the solver's routes) between the focus and that party, either direction */
  counterpart: Record<string, Record<string, number>>
  tradingAreaIds: string[]
  /**
   * `inRate` is what the party sends the focus, `outRate` what the focus sends the party; both count
   * items only, electricity and heat are in `inEnergy` / `outEnergy` (`items` counts every item)
   */
  trades: { partyId: string; items: number; inRate: number; outRate: number; inEnergy: number; outEnergy: number; lines: TradeLine[] }[]
}

/** What one area trades: its rows, the counterpart of each, and who it trades with. */
export function focusArea(m: BlockMatrix, areaId: string): FocusView {
  // A relay (an area that receives an item and sends it on, with a net of 0) has no cell but still has routes.
  const rows = m.rows.filter(r => (r.cells[areaId] ?? 0) !== 0 || r.pairs.some(p => p.from === areaId || p.to === areaId))
  const counterpart: Record<string, Record<string, number>> = {}
  const trade = new Map<string, { items: Set<string>; lines: TradeLine[]; inRate: number; outRate: number; inEnergy: number; outEnergy: number }>()
  const entry = (id: string) => {
    let t = trade.get(id)
    if (!t) trade.set(id, (t = { items: new Set(), lines: [], inRate: 0, outRate: 0, inEnergy: 0, outEnergy: 0 }))
    return t
  }
  for (const row of rows) {
    const energy = isEnergyItem(row.itemId)
    const per: Record<string, number> = {}
    for (const direction of ['sends', 'receives'] as const) {
      for (const end of routeEnds(row.pairs, areaId, direction)) {
        const partyId = end.partnerId ?? OUTSIDE
        per[partyId] = (per[partyId] ?? 0) + end.rate
        const t = entry(partyId)
        t.items.add(row.itemId)
        if (direction === 'sends') {
          if (energy) t.outEnergy += end.rate
          else t.outRate += end.rate
        } else if (energy) t.inEnergy += end.rate
        else t.inRate += end.rate
        t.lines.push({ key: row.key, itemId: row.itemId, ...(row.temp ? { temp: row.temp } : {}), name: rowDisplayName(row), direction: direction === 'sends' ? 'out' : 'in', rate: end.rate, energy })
      }
    }
    counterpart[row.key] = per
  }
  const tradingAreaIds = m.areas.map(a => a.areaId).filter(id => id !== areaId && trade.has(id))
  const trades = [...trade.entries()]
    .map(([partyId, t]) => ({
      partyId,
      items: t.items.size,
      inRate: t.inRate,
      outRate: t.outRate,
      inEnergy: t.inEnergy,
      outEnergy: t.outEnergy,
      // Items before energy, then the biggest rate first.
      lines: t.lines.sort((x, y) => Number(x.energy) - Number(y.energy) || y.rate - x.rate || x.name.localeCompare(y.name)),
    }))
  const order = (id: string) => (id === OUTSIDE ? Infinity : m.areas.findIndex(a => a.areaId === id))
  trades.sort((a, b) => {
    if ((a.partyId === OUTSIDE) !== (b.partyId === OUTSIDE)) return a.partyId === OUTSIDE ? 1 : -1
    return b.inRate + b.outRate - (a.inRate + a.outRate) || b.inEnergy + b.outEnergy - (a.inEnergy + a.outEnergy) || order(a.partyId) - order(b.partyId)
  })
  return { areaId, rows, counterpart, tradingAreaIds, trades }
}

/**
 * Filters rows and columns by a free-text query (trimmed, case-insensitive). It is an OR: a row stays
 * when its name matches or it has a cell in a matching column; a column stays when its name matches or
 * (when items match) it has a cell in a matching row. `columnIds` null = every column (the scope name
 * matched, or only items matched).
 * `scopeNames` (e.g. the block's name): a query matching one of them keeps every row and column.
 * Returns null when nothing matches.
 */
export function matchQuery<R extends { itemId: string; name: string; temp?: FluidTag }>(
  query: string,
  rows: R[],
  columns: { id: string; names: string[] }[],
  hasCell: (r: R, colId: string) => boolean,
  scopeNames: string[] = [],
): { rows: R[]; columnIds: Set<string> | null } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { rows, columnIds: null }
  const has = (text: string) => text.toLowerCase().includes(q)
  // A query that names the whole scope (the block being shown) filters nothing.
  if (scopeNames.some(has)) return { rows, columnIds: null }
  const itemHits = rows.filter(r => has(r.name) || has(rowDisplayName(r)))
  const colHits = columns.filter(c => c.names.some(has)).map(c => c.id)
  if (itemHits.length === 0 && colHits.length === 0) return null
  if (colHits.length === 0) return { rows: itemHits, columnIds: null }
  // Both can match, and the query is an OR: a row stays when its item matches or it has a cell in a
  // matching column, and a column stays when it matches or has a cell in a matching row.
  const columnIds = new Set(colHits)
  if (itemHits.length > 0) {
    for (const c of columns) if (itemHits.some(r => hasCell(r, c.id))) columnIds.add(c.id)
  }
  const itemSet = new Set(itemHits)
  const keepRow = (r: R) => itemSet.has(r) || colHits.some(c => hasCell(r, c))
  return { rows: rows.filter(keepRow), columnIds }
}

/** Every category an item can fall in, by id (the item groups of the bundle, Other and Machines). */
export function itemGroupMap(gameData: GameData): Map<string, ItemGroupInfo> {
  const map = new Map<string, ItemGroupInfo>()
  for (const g of Object.values(gameData.itemGroups)) map.set(g.id, { id: g.id, name: g.name, order: g.order })
  map.set(OTHER_GROUP, { id: OTHER_GROUP, name: 'Other', order: '' })
  map.set(MACHINES_GROUP, { id: MACHINES_GROUP, name: 'Machines for buildings', order: '' })
  return map
}

/** Whether a sum of floats is zero: it cancels to within rounding of its largest addend. */
export function cancels(sum: number, maxAbs: number): boolean {
  return Math.abs(sum) <= 1e-9 * Math.max(1, maxAbs)
}

export type GroupTotal =
  | { kind: 'net'; t: number; energy?: true }
  /** counterpart mode: what the area sends to the focus (out) and receives from it (in), kept apart */
  | { kind: 'pair'; out: number; in: number; energy?: true }

/**
 * The rows a group total adds up. Items and energy do not share a unit, so a total counts the
 * non-energy rows; a group made only of one energy item (electricity or heat, which are not
 * interchangeable) sums it, in power units (`energy`).
 */
export function totalRows<R extends { itemId: string }>(rows: R[]): { rows: R[]; energy: boolean } {
  if (rows.length > 0 && rows.every(r => isEnergyItem(r.itemId) && r.itemId === rows[0].itemId)) return { rows, energy: true }
  return { rows: rows.filter(r => !isEnergyItem(r.itemId)), energy: false }
}

export function groupTotal(all: MatrixRow[], areaId: string, focus: FocusView | null): GroupTotal {
  const { rows: list, energy } = totalRows(all)
  const flag = energy ? { energy: true as const } : {}
  if (focus) {
    let out = 0
    let inn = 0
    for (const r of list) {
      const c = focus.counterpart[r.key]?.[areaId] ?? 0
      if (c <= 1e-9) continue
      // A relay between the two areas goes both ways: the routes say how much each way.
      const sent = r.pairs.filter(p => p.from === areaId && p.to === focus.areaId).reduce((n, p) => n + p.rate, 0)
      const got = r.pairs.filter(p => p.from === focus.areaId && p.to === areaId).reduce((n, p) => n + p.rate, 0)
      if (sent > 1e-9 && got > 1e-9) {
        out += sent
        inn += got
        continue
      }
      // The direction comes from this row: the area sends it (cell > 0) or receives it.
      if ((r.cells[areaId] ?? 0) > 0) out += c
      else inn += c
    }
    return { kind: 'pair', out, in: inn, ...flag }
  }
  let t = 0
  let maxAbs = 0
  for (const r of list) {
    const v = r.cells[areaId] ?? 0
    t += v
    maxAbs = Math.max(maxAbs, Math.abs(v))
  }
  return { kind: 'net', t: cancels(t, maxAbs) ? 0 : t, ...flag }
}
