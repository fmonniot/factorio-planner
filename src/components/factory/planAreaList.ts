import type { Block, GameData, SolverResult, SubPlan } from '../../data/types'
import { areaRows, type AreaRow } from './areaRows'

// ---------------------------------------------------------------------------
// The areas of every block, for the plan-level list. One row per area per block: a name is not an
// identity (every block has a "Top level"), and each block has its own pool, so what an area
// receives or sends is relative to its block and never summed across blocks.
// ---------------------------------------------------------------------------

export interface PlanAreaRow extends AreaRow {
  blockId: string
  /** the sub-factory row that stands for the area in the block's table; undefined for the root */
  handleNodeId: string | undefined
}

export interface PlanAreaBlock {
  blockId: string
  blockName: string
  color: string
  rows: PlanAreaRow[]
}

/** The id of the handle row of sub-plan `subPlanId`, searched through the whole tree. */
function subPlanHandleId(plan: SubPlan, subPlanId: string): string | undefined {
  for (const n of plan.nodes) if (n.kind === 'subplan' && n.subPlanId === subPlanId) return n.id
  for (const sp of plan.subPlans) {
    const found = subPlanHandleId(sp, subPlanId)
    if (found) return found
  }
  return undefined
}

/** The blocks that have areas, in tab order, each with its area rows. */
export function planAreaBlocks(blocks: Block[], results: Record<string, SolverResult>): PlanAreaBlock[] {
  const list: PlanAreaBlock[] = []
  for (const b of blocks) {
    const areas = results[b.id]?.areas
    if (!areas) continue
    list.push({
      blockId: b.id,
      blockName: b.name,
      color: b.color,
      rows: areaRows(b.rootPlan, areas).map(row => ({
        ...row,
        blockId: b.id,
        handleNodeId: row.isRoot ? undefined : subPlanHandleId(b.rootPlan, row.areaId),
      })),
    })
  }
  return list
}

/**
 * Keeps what matches the query (trimmed, case-insensitive): a block by its name (all its rows), a
 * row by its area name or the name of an item it receives or sends. Blocks left empty are dropped.
 */
export function filterPlanAreas(list: PlanAreaBlock[], query: string, items: GameData['items']): PlanAreaBlock[] {
  const q = query.trim().toLowerCase()
  if (q === '') return list
  const has = (text: string) => text.toLowerCase().includes(q)
  const itemMatches = (id: string) => has(items[id]?.name ?? id)
  return list.flatMap(block => {
    if (has(block.blockName)) return [block]
    const rows = block.rows.filter(
      r => has(r.name) || r.receives.some(f => itemMatches(f.itemId)) || r.sends.some(f => itemMatches(f.itemId)),
    )
    return rows.length > 0 ? [{ ...block, rows }] : []
  })
}
