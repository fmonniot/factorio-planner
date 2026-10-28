import type { SubPlan } from '../../data/types'
import { findSubPlan } from '../../store/blockStore'

/** What the block's root area is called in the Areas pane. */
export const ROOT_AREA_LABEL = 'Top level'

/** The display name of an area: the root is "Top level", a sub-factory has its own name (the id when it is gone). */
export function areaName(rootPlan: SubPlan, areaId: string): string {
  if (areaId === rootPlan.id) return ROOT_AREA_LABEL
  return findSubPlan(rootPlan, areaId)?.name ?? areaId
}
