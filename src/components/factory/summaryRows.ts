import type { BlockConnection } from '../../data/types'

// Pure grouping for the summary panes: one row per item, so an item's tile and
// its connection chips sit together.

export interface IngredientRow {
  itemId: string
  connections: BlockConnection[]
  /** items/min still imported; undefined when nothing is imported */
  importPerMin: number | undefined
  locked: boolean
}

/**
 * Rows in order of first appearance: connected items, then imported items,
 * then locked items. Every item appears once.
 */
export function ingredientRows(
  connections: BlockConnection[],
  unsatisfied: { itemId: string; rate: number }[],
  noImportItems: string[],
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
    if (u.rate > 0) row(u.itemId).importPerMin = u.rate
  }
  for (const itemId of noImportItems) row(itemId)
  return [...rows.values()]
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
