import { blockAreas } from '../../solver/areas'
import type { SolverWarning, SubPlan, GameData } from '../../data/types'
import { areaName } from '../../data/subPlanTree'
import { rangeOf } from '../../data/flowKey'
import type { ConnectionLink } from './temperature'

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

/** One link per distinct area an area warning names, to the area's handle row. */
function areaTargets(rootPlan: SubPlan, entries: { areaId: string }[]): WarningTarget[] {
  const seen = new Set<string>()
  return entries.flatMap(e => {
    if (seen.has(e.areaId)) return []
    seen.add(e.areaId)
    const nodeId = handleNodeId(rootPlan, e.areaId)
    return nodeId === undefined ? [] : [{ kind: 'row' as const, label: `Go to ${areaName(rootPlan, e.areaId)}`, nodeId }]
  })
}

/** A link per block a `connection-temperature` warning's connections take from. */
function connectionSources(
  w: Extract<SolverWarning, { type: 'connection-temperature' }>,
  connections: readonly ConnectionLink[],
  blockName: (id: string) => string,
): WarningTarget[] {
  const sources = new Set(w.connections.flatMap(c => connections.find(x => x.id === c.connectionId)?.fromBlockId ?? []))
  return [...sources].map(id => ({ kind: 'block', label: `Go to ${blockName(id)}`, blockId: id }))
}

function sameRange(a: { min?: number; max?: number }, b: { min?: number; max?: number }): boolean {
  return a.min === b.min && a.max === b.max
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
  connections: readonly ConnectionLink[] = [],
): WarningTarget[] {
  if (w.type === 'unbounded-source') return w.blockIds.filter(id => id !== activeBlockId).map(id => ({ kind: 'block', label: `Go to ${blockName(id)}`, blockId: id }))
  if (w.type === 'take-credits-not-settled') {
    const ids = [...new Set(w.takes.map(t => t.fromBlockId))]
    return ids.filter(id => id !== activeBlockId).map(id => ({ kind: 'block', label: `Go to ${blockName(id)}`, blockId: id }))
  }
  if (w.type === 'loop-not-converged' || w.type === 'request-loop-not-converged') {
    // The block that is open already shows its own rows: a link to it would do nothing.
    return w.blockIds.filter(id => id !== activeBlockId).map(id => ({ kind: 'block', label: `Go to ${blockName(id)}`, blockId: id }))
  }
  if (!rootPlan) return w.type === 'connection-temperature' ? connectionSources(w, connections, blockName) : []
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
    case 'connection-temperature': {
      // The source blocks, then each recipe of this block that takes the fluid over a range the connection could not meet.
      const blockLinks = connectionSources(w, connections, blockName)
      const recipeIds: string[] = []
      for (const c of w.connections) {
        for (const row of rows) {
          const takes = gameData.recipes[row.recipeId]?.ingredients.some(
            ing => ing.itemId === c.itemId && c.needed.some(n => sameRange(rangeOf(ing), n)),
          )
          if (takes && !recipeIds.includes(row.recipeId)) recipeIds.push(row.recipeId)
        }
      }
      return [...blockLinks, ...uniqueRows(recipeIds.flatMap(id => recipeTarget(id)))]
    }
    case 'duplicate-recipe': return recipeTarget(w.recipeId, w.areaId)
    case 'unbounded-absorber':
    case 'absorber-idle':
    case 'infeasible-pins': return uniqueRows(w.recipeIds.flatMap(id => recipeTarget(id)))
    case 'no-fitting-temperature': return uniqueRows(w.recipeIds.flatMap(id => recipeTarget(id)))
    case 'module-not-allowed': return uniqueRows(w.misfits.flatMap(m => recipeTarget(m.recipeId)))
    case 'coproduct-driven': return uniqueRows(w.drivers.flatMap(d => recipeTarget(d.recipeId)))
    case 'area-shortfall': return areaTargets(rootPlan, w.shortfalls)
    case 'area-cut-off': return areaTargets(rootPlan, w.cutOffs)
    default: return []
  }
}
