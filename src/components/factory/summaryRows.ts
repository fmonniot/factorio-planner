import type { AreaRoute, BlockConnection, SourceRule, SubPlan } from '../../data/types'
import { surplusTolerance } from '../../solver/index'
import { areaRuleOf, blockAreas, withAreaRules } from '../../solver/areas'
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
  unsatisfied: { itemId: string; rate: number }[],
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
  for (const u of unsatisfied) {
    if (u.rate <= 0) continue
    const r = row(u.itemId)
    r.importPerMin = u.rate
    const missing = missingOf?.(u.itemId, u.rate)
    if (missing !== undefined) r.missingPerMin = missing
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
  const areas = withAreaRules(rootPlan, blockAreas(rootPlan) ?? [])
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
  itemId: string
  /** items/min left after exports; undefined when everything is exported */
  leftPerMin: number | undefined
  exported: boolean
}

/** Leftover byproducts first, then items that are only exported. */
export function byproductRows(
  byproducts: { itemId: string; ratePerMin: number }[],
  exportedItemIds: string[],
): ByproductRow[] {
  const exported = new Set(exportedItemIds)
  const rows: ByproductRow[] = byproducts.map(b => ({
    itemId: b.itemId,
    leftPerMin: b.ratePerMin,
    exported: exported.has(b.itemId),
  }))
  const seen = new Set(rows.map(r => r.itemId))
  for (const itemId of exportedItemIds) {
    if (seen.has(itemId)) continue
    rows.push({ itemId, leftPerMin: undefined, exported: true })
  }
  return rows
}
