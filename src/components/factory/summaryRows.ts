import type { AreaRoute, BlockConnection, ConnectionFlow, FluidTag, SourceRule, SubPlan } from '../../data/types'
import { compareTags, flowKey, parseFlowKey } from '../../data/flowKey'
import { FLOW_TOLERANCE, surplusTolerance } from '../../solver/index'
import { flowShares } from './flowParts'
import { areaRuleOf, blockAreas, withAreaRules, type SolverArea } from '../../solver/areas'
import { outsideLegParts } from '../../solver/areaRoutes'

// Pure grouping for the summary panes: one row per flow key (a plain item is its own key), the keys of an item together, so a
// tile and its connection chips sit together.

/**
 * A leftover counts as a byproduct only above the solver's surplus tolerance for the item's flow and
 * when it does not display as 0.00/min. The rounding check is fixed to `min` (the finest unit) so the
 * set of tiles does not change with the rate-unit toggle.
 */
export function isLeftover(ratePerMin: number, grossPerMin: number): boolean {
  return ratePerMin > surplusTolerance(grossPerMin) && parseFloat(ratePerMin.toFixed(2)) > 0
}

export interface IngredientRow {
  /** Unique within the pane: the flow key of a split fluid's range or temperature, the item id otherwise. */
  key: string
  itemId: string
  connections: BlockConnection[]
  /** items/min still imported; undefined when nothing is imported */
  importPerMin: number | undefined
  locked: boolean
  /** A split fluid's range or temperature (absent for a plain item). */
  temp?: FluidTag
  /**
   * items/min of `importPerMin` that is missing (Import is off in the areas that import it), when the rows of the block's areas
   * say so (`areaMissingPerMin`); undefined: the block's lock decides, all of it or none.
   */
  missingPerMin?: number
}

/**
 * The rows with the keys of one item together: items in order of first appearance, inside an item the untagged key first, then
 * the tags in `compareTags` order (temperatures ascending, then ranges). Stable otherwise.
 */
export function groupKeysTogether<T extends { itemId: string; temp?: FluidTag }>(rows: T[]): T[] {
  const order = new Map<string, number>()
  for (const r of rows) if (!order.has(r.itemId)) order.set(r.itemId, order.size)
  const rank = (r: T) => order.get(r.itemId)!
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      if (rank(x.r) !== rank(y.r)) return rank(x.r) - rank(y.r)
      const tx = x.r.temp
      const ty = y.r.temp
      if (tx === undefined || ty === undefined) return tx === ty ? x.i - y.i : tx === undefined ? -1 : 1
      return compareTags(tx, ty) || x.i - y.i
    })
    .map(x => x.r)
}

/**
 * One row per flow key: a row for each range the block imports a split fluid over, and for each key a connection's parts
 * carry. A connection that carries nothing (unused, missing source, no flow yet) sits on its item's first row. Items in order
 * of first appearance: connected items, then imported items, then locked items. An item that is none of the three (the block
 * covers it by itself) has no row, whatever its source rule: its Comes from control is in a popover (`ComesFromPopover`).
 */
export function ingredientRows(
  connections: BlockConnection[],
  unsatisfied: { itemId: string; rate: number; temp?: FluidTag }[],
  noImportItems: string[],
  /** The part of a key's import that is missing, for an item whose areas have rules of their own. */
  missingOf?: (itemId: string, importPerMin: number, temp?: FluidTag) => number | undefined,
  flows?: ReadonlyMap<string, ConnectionFlow>,
): IngredientRow[] {
  const itemOrder: string[] = []
  const touch = (itemId: string) => { if (!itemOrder.includes(itemId)) itemOrder.push(itemId) }
  for (const c of connections) touch(c.itemId)
  for (const u of unsatisfied) if (u.rate > 0) touch(u.itemId)
  for (const id of noImportItems) touch(id)

  const rows = new Map<string, IngredientRow>()
  const row = (key: string): IngredientRow => {
    let r = rows.get(key)
    if (!r) {
      const { itemId, tag } = parseFlowKey(key)
      r = { key, itemId, connections: [], importPerMin: undefined, locked: noImportItems.includes(itemId), ...(tag ? { temp: tag } : {}) }
      rows.set(key, r)
    }
    return r
  }
  for (const u of unsatisfied) {
    if (u.rate <= 0) continue
    const r = row(flowKey(u.itemId, u.temp))
    r.importPerMin = (r.importPerMin ?? 0) + u.rate
  }
  const deferred: BlockConnection[] = []
  for (const c of connections) {
    const flow = flows?.get(c.id)
    const keys = flow && (flow.status === 'ok' || flow.status === 'limited')
      ? flowShares(flow).filter(s => s.rate > FLOW_TOLERANCE).map(s => s.key)
      : []
    if (keys.length === 0) deferred.push(c)
    for (const key of keys) row(key).connections.push(c)
  }
  const sorted = (itemId: string) => groupKeysTogether([...rows.values()].filter(r => r.itemId === itemId))
  for (const c of deferred) {
    const first = sorted(c.itemId)[0] ?? row(c.itemId)
    first.connections.push(c)
  }
  for (const itemId of noImportItems) {
    const mine = sorted(itemId)
    if (mine.length === 0) row(itemId)
    for (const r of rows.values()) if (r.itemId === itemId) r.locked = true
  }
  if (missingOf) {
    for (const r of rows.values()) {
      if (r.importPerMin === undefined) continue
      const missing = missingOf(r.itemId, r.importPerMin, r.temp)
      if (missing !== undefined) r.missingPerMin = missing
    }
  }
  const all = [...rows.values()].sort((a, b) => itemOrder.indexOf(a.itemId) - itemOrder.indexOf(b.itemId))
  return groupKeysTogether(all)
}

/**
 * How much of what the block imports of `itemId` is missing when some area has a rule of its own for it: the outside legs
 * into the areas whose rule has Import off, less what is supplied (`outsideLegParts`), at most `importPerMin`. Undefined when
 * no area has a rule of its own for the item, so the block's rule alone decides.
 */
export function areaMissingPerMin(
  itemId: string,
  importPerMin: number,
  blockRules: Record<string, SourceRule> | undefined,
  rootPlan: SubPlan,
  areaRoutes: readonly AreaRoute[],
  temp?: FluidTag,
): number | undefined {
  return areaMissingOf(blockRules, rootPlan, areaRoutes)(itemId, importPerMin, temp)
}

/** `areaMissingPerMin` for one plan and one solve, the areas worked out once however many items are asked about. */
export function areaMissingOf(
  blockRules: Record<string, SourceRule> | undefined,
  rootPlan: SubPlan,
  areaRoutes: readonly AreaRoute[],
): (itemId: string, importPerMin: number, temp?: FluidTag) => number | undefined {
  const areas = withAreaRules(rootPlan, blockAreas(rootPlan) ?? [])
  return (itemId, importPerMin, temp) => areaMissing(areas, itemId, importPerMin, blockRules, areaRoutes, temp)
}

function areaMissing(
  areas: readonly SolverArea[],
  itemId: string,
  importPerMin: number,
  blockRules: Record<string, SourceRule> | undefined,
  areaRoutes: readonly AreaRoute[],
  temp?: FluidTag,
): number | undefined {
  if (!areas.some(a => a.rules && Object.hasOwn(a.rules, itemId))) return undefined
  let missing = 0
  for (const route of areaRoutes) {
    if (flowKey(route.itemId, route.temp) !== flowKey(itemId, temp) || route.from !== undefined || route.to === undefined) continue
    const area = areas.find(a => a.id === route.to)
    if (area) missing += outsideLegParts(route, areaRuleOf(area, blockRules, itemId)).missing
  }
  return Math.min(importPerMin, missing)
}

export interface ByproductRow {
  /** Unique within the pane: the flow key of a split fluid's temperature, the item id otherwise. */
  key: string
  itemId: string
  /** A split fluid's temperature. */
  temp?: FluidTag
  /** items/min left after exports; undefined when everything is exported */
  leftPerMin: number | undefined
  exported: boolean
}

/** Leftover byproducts first, then keys that are only exported; the keys of one item sit together. `exportedKeys`: flow keys. */
export function byproductRows(
  byproducts: { itemId: string; ratePerMin: number; key?: string; temp?: FluidTag }[],
  exportedKeys: string[],
): ByproductRow[] {
  const exported = new Set(exportedKeys)
  const rows: ByproductRow[] = byproducts.map(b => ({
    key: b.key ?? b.itemId,
    itemId: b.itemId,
    ...(b.temp !== undefined ? { temp: b.temp } : {}),
    leftPerMin: b.ratePerMin,
    exported: exported.has(b.key ?? b.itemId),
  }))
  const seen = new Set(rows.map(r => r.key))
  for (const key of exportedKeys) {
    if (seen.has(key)) continue
    const { itemId, tag } = parseFlowKey(key)
    rows.push({ key, itemId, ...(tag ? { temp: tag } : {}), leftPerMin: undefined, exported: true })
  }
  return groupKeysTogether(rows)
}
