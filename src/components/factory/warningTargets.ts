import { blockAreas } from '../../solver/areas'
import type { SolverWarning, SubPlan, GameData } from '../../data/types'
import { areaName } from '../../data/subPlanTree'

/** Where a warning's link goes: a row of the active block, or another block. */
export type WarningTarget =
  | { kind: 'row'; label: string; nodeId: string }
  | { kind: 'block'; label: string; blockId: string }

function collectRows(plan: SubPlan, out: { id: string; recipeId: string }[] = []) {
  for (const n of plan.nodes) if (n.kind === 'game-recipe') out.push({ id: n.id, recipeId: n.recipeId })
  for (const sp of plan.subPlans) collectRows(sp, out)
  return out
}

/** The id of the node that stands for the sub-factory `areaId` in its parent's table, if any. */
function handleNodeId(plan: SubPlan, areaId: string): string | undefined {
  for (const n of plan.nodes) if (n.kind === 'subplan' && n.subPlanId === areaId) return n.id
  for (const sp of plan.subPlans) {
    const found = handleNodeId(sp, areaId)
    if (found !== undefined) return found
  }
  return undefined
}

/** The targets without a second link to the same row (the buttons are keyed by it). */
function uniqueRows(targets: WarningTarget[]): WarningTarget[] {
  const seen = new Set<string>()
  return targets.filter(t => t.kind !== 'row' || (!seen.has(t.nodeId) && seen.add(t.nodeId)))
}

/**
 * The links of a warning, in the order the warning names them: the first row of each recipe it
 * names (the first one of the area for an area's duplicate), the handle row of each area, or each
 * block around a loop other than the open one. A warning that names only items, or names nothing the table shows, has none.
 */
export function warningTargets(
  w: SolverWarning,
  rootPlan: SubPlan | undefined,
  gameData: GameData,
  blockName: (id: string) => string,
  activeBlockId?: string,
): WarningTarget[] {
  if (w.type === 'loop-not-converged' || w.type === 'request-loop-not-converged') {
    // The block that is open already shows its own rows: a link to it would do nothing.
    return w.blockIds.filter(id => id !== activeBlockId).map(id => ({ kind: 'block', label: `Go to ${blockName(id)}`, blockId: id }))
  }
  if (!rootPlan) return []
  const rows = collectRows(rootPlan)
  const recipeTarget = (recipeId: string, areaId?: string): WarningTarget[] => {
    // Without areas (a stale warning, or the area is gone) the whole block is searched.
    const area = areaId === undefined ? undefined : blockAreas(rootPlan)?.find(a => a.id === areaId)
    const inArea = area ? new Set(area.nodeIds) : undefined
    const row = rows.find(r => r.recipeId === recipeId && (inArea === undefined || inArea.has(r.id)))
    if (!row) return []
    return [{ kind: 'row', label: `Go to ${gameData.recipes[recipeId]?.name ?? recipeId}`, nodeId: row.id }]
  }
  switch (w.type) {
    case 'duplicate-recipe': return recipeTarget(w.recipeId, w.areaId)
    case 'infeasible-pins': return uniqueRows(w.recipeIds.flatMap(id => recipeTarget(id)))
    case 'temperature-mismatch': return recipeTarget(w.recipeId)
    case 'coproduct-driven': return uniqueRows(w.drivers.flatMap(d => recipeTarget(d.recipeId)))
    case 'area-shortfall': {
      const seen = new Set<string>()
      return w.shortfalls.flatMap(s => {
        if (seen.has(s.areaId)) return []
        seen.add(s.areaId)
        const nodeId = handleNodeId(rootPlan, s.areaId)
        return nodeId === undefined ? [] : [{ kind: 'row' as const, label: `Go to ${areaName(rootPlan, s.areaId)}`, nodeId }]
      })
    }
    default: return []
  }
}
