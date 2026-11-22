import type { AreaRoute, BlockConnection, FluidTag, SourceRule, SubPlan } from '../../data/types'
import { flowKey } from '../../data/flowKey'
import { surplusTolerance } from '../../solver/index'
import { areaRuleOf, blockAreas, withAreaRules, type SolverArea } from '../../solver/areas'
import { outsideLegParts } from '../../solver/areaRoutes'

// Pure grouping for the summary panes: one row per item, so an item's tile and
// its connection chips sit together.

/**
 * A leftover counts as a byproduct only above the solver's surplus tolerance for the item's flow and
 * when it does not display as 0.00/min. The rounding check is fixed to `min` (the finest unit) so the
 * set of tiles does not change with the rate-unit toggle.
 */
export function isLeftover(ratePerMin: number, grossPerMin: number): boolean {
  return ratePerMin > surplusTolerance(grossPerMin) && parseFloat(ratePerMin.toFixed(2)) > 0
}

export interface IngredientRow {
  itemId: string
  connections: BlockConnection[]
  /** items/min still imported; undefined when nothing is imported */
  importPerMin: number | undefined
  locked: boolean
  /** A split fluid imported over one range: the range (absent when the import covers several, or for a plain item). */
  temp?: FluidTag
  /**
   * items/min of `importPerMin` that is missing (Import is off in the areas that import it), when the rows of the block's areas
   * say so (`areaMissingPerMin`); undefined: the block's lock decides, all of it or none.
   */
  missingPerMin?: number
}

/**
 * Rows in order of first appearance: connected items, then imported items,
 * then locked items. Every item appears once. An item that is none of the three (the block covers it by
 * itself) has no row, whatever its source rule: its Comes from control is in a popover (`ComesFromPopover`).
 */
export function ingredientRows(
  connections: BlockConnection[],
  unsatisfied: { itemId: string; rate: number; temp?: FluidTag }[],
  noImportItems: string[],
  /** The part of an item's import that is missing, for an item whose areas have rules of their own. */
  missingOf?: (itemId: string, importPerMin: number) => number | undefined,
): IngredientRow[] {
  const rows = new Map<string, IngredientRow>()
  const row = (itemId: string): IngredientRow => {
    let r = rows.get(itemId)
    if (!r) {
      r = { itemId, connections: [], importPerMin: undefined, locked: noImportItems.includes(itemId) }
      rows.set(itemId, r)
    }
    return r
  }
  for (const c of connections) row(c.itemId).connections.push(c)
  // A split fluid can be imported over several ranges: the row sums them, and names the range only when there is one.
  const tags = new Map<string, Set<string>>()
  for (const u of unsatisfied) {
    if (u.rate <= 0) continue
    const r = row(u.itemId)
    r.importPerMin = (r.importPerMin ?? 0) + u.rate
    const seen = tags.get(u.itemId) ?? new Set<string>()
    seen.add(u.temp === undefined ? '' : flowKey(u.itemId, u.temp))
    tags.set(u.itemId, seen)
    if (u.temp !== undefined && seen.size === 1) r.temp = u.temp
    else delete r.temp
  }
  if (missingOf) {
    for (const r of rows.values()) {
      if (r.importPerMin === undefined) continue
      const missing = missingOf(r.itemId, r.importPerMin)
      if (missing !== undefined) r.missingPerMin = missing
    }
  }
  for (const itemId of noImportItems) row(itemId)
  return [...rows.values()]
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
): number | undefined {
  return areaMissingOf(blockRules, rootPlan, areaRoutes)(itemId, importPerMin)
}

/** `areaMissingPerMin` for one plan and one solve, the areas worked out once however many items are asked about. */
export function areaMissingOf(
  blockRules: Record<string, SourceRule> | undefined,
  rootPlan: SubPlan,
  areaRoutes: readonly AreaRoute[],
): (itemId: string, importPerMin: number) => number | undefined {
  const areas = withAreaRules(rootPlan, blockAreas(rootPlan) ?? [])
  return (itemId, importPerMin) => areaMissing(areas, itemId, importPerMin, blockRules, areaRoutes)
}

function areaMissing(
  areas: readonly SolverArea[],
  itemId: string,
  importPerMin: number,
  blockRules: Record<string, SourceRule> | undefined,
  areaRoutes: readonly AreaRoute[],
): number | undefined {
  if (!areas.some(a => a.rules && Object.hasOwn(a.rules, itemId))) return undefined
  let missing = 0
  for (const route of areaRoutes) {
    if (route.itemId !== itemId || route.from !== undefined || route.to === undefined) continue
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

/** Leftover byproducts first, then items that are only exported. */
export function byproductRows(
  byproducts: { itemId: string; ratePerMin: number; key?: string; temp?: FluidTag }[],
  exportedItemIds: string[],
): ByproductRow[] {
  const exported = new Set(exportedItemIds)
  const rows: ByproductRow[] = byproducts.map(b => ({
    key: b.key ?? b.itemId,
    itemId: b.itemId,
    ...(b.temp !== undefined ? { temp: b.temp } : {}),
    leftPerMin: b.ratePerMin,
    exported: exported.has(b.itemId),
  }))
  const seen = new Set(rows.map(r => r.itemId))
  for (const itemId of exportedItemIds) {
    if (seen.has(itemId)) continue
    rows.push({ key: itemId, itemId, leftPerMin: undefined, exported: true })
  }
  return rows
}
