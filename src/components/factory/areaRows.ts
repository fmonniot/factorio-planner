import type { AreaFlow, SolvedArea, SubPlan } from '../../data/types'
import { findSubPlan } from '../../store/blockStore'

/** What the block's root area is called in the Areas pane. */
export const ROOT_AREA_LABEL = 'Top level'

export interface AreaRow {
  areaId: string
  name: string
  isRoot: boolean
  receives: AreaFlow[]
  sends: AreaFlow[]
}

/** The display name of an area: the root is "Top level", a sub-factory has its own name (the id when it is gone). */
export function areaName(rootPlan: SubPlan, areaId: string): string {
  if (areaId === rootPlan.id) return ROOT_AREA_LABEL
  return findSubPlan(rootPlan, areaId)?.name ?? areaId
}

/** One row per solved area, in the order the solver gives them (table order), named from the block tree. */
export function areaRows(rootPlan: SubPlan, areas: SolvedArea[]): AreaRow[] {
  return areas.map(a => ({
    areaId: a.areaId,
    name: areaName(rootPlan, a.areaId),
    isRoot: a.areaId === rootPlan.id,
    receives: a.receives,
    sends: a.sends,
  }))
}
