import type { AreaRoute, AreaSourceRule, Block, GameData, SolverResult } from '../../data/types'
import { areaName } from '../../data/subPlanTree'
import { blockAreas } from '../../solver/areas'
import { outsideLegParts } from '../../solver/areaRoutes'
import { itemMakers } from './sourcingText'

// ---------------------------------------------------------------------------
// What the Sources list of an area reads (D6, D12 of phase 5): figures taken from the solver's `areaRoutes`, never worked
// out again. Pure functions of the routes, the rule and the block.
// ---------------------------------------------------------------------------

const EPS = 1e-6

export interface AreaSupply {
  /** items/min the area brings in from outside the plan. */
  imported: number
  /** items/min the area is short of with Import off. */
  missing: number
  /** items/min of the block's connections that reach the area. */
  reaches: number
}

/**
 * What the area `areaId` gets from outside the block for `itemId`. An item two areas or more touch has its outside legs split by the LP
 * (`supplied`, see `outsideLegParts`). An item one area touches has no split: the block's own unsatisfied rate is what it imports (or
 * misses), the rest of the leg is connected supply. Without a leg, nothing reaches the area from outside.
 */
export function areaSupply(routes: readonly AreaRoute[] | undefined, itemId: string, areaId: string, rule: AreaSourceRule, unsatisfied: number): AreaSupply {
  const ofItem = (routes ?? []).filter(r => r.itemId === itemId)
  const legs = ofItem.filter(r => r.from === undefined && r.to === areaId)
  const total = legs.reduce((sum, r) => sum + r.rate, 0)
  if (total <= 0) return { imported: 0, missing: 0, reaches: 0 }
  const split = ofItem.some(r => r.supplied !== undefined)
  if (split) {
    const parts = legs.map(leg => outsideLegParts(leg, rule))
    const sum = (key: 'received' | 'imported' | 'missing') => parts.reduce((s, p) => s + p[key], 0)
    return { reaches: sum('received'), imported: sum('imported'), missing: sum('missing') }
  }
  const rest = Math.min(total, Math.max(0, unsatisfied))
  return rule.importOff === true
    ? { reaches: total - rest, imported: 0, missing: rest }
    : { reaches: total - rest, imported: rest, missing: 0 }
}

/** items/min of `itemId` routed from the area `fromId` to the area `toId`. */
export function routedFrom(routes: readonly AreaRoute[] | undefined, itemId: string, fromId: string, toId: string): number {
  return (routes ?? []).filter(r => r.itemId === itemId && r.from === fromId && r.to === toId).reduce((sum, r) => sum + r.rate, 0)
}

export interface SupplierLine {
  areaId: string
  name: string
  /** items/min routed from this area into the one asked about. */
  routed: number
  /** The area is switched off as a supplier (`areasOff`). */
  off: boolean
}

/**
 * The other areas of the block that supply, or could supply, the area `areaId` with `itemId`, in table order: those with a row making
 * it, those with a route into the area (a relay), and those already switched off (so that they can be switched back).
 */
export function supplierLines(
  block: Block,
  gameData: GameData,
  result: SolverResult | undefined,
  itemId: string,
  areaId: string,
  rule: AreaSourceRule,
): SupplierLine[] {
  const lines: SupplierLine[] = []
  for (const area of blockAreas(block.rootPlan) ?? []) {
    if (area.id === areaId) continue
    const routed = routedFrom(result?.areaRoutes, itemId, area.id, areaId)
    const off = rule.areasOff?.includes(area.id) ?? false
    if (itemMakers(block, gameData, undefined, itemId, area.id).length > 0 || routed > EPS || off) {
      lines.push({ areaId: area.id, name: areaName(block.rootPlan, area.id), routed, off })
    }
  }
  return lines
}
