import { create } from 'zustand'
import type { PlanEntry, PlanIndex } from '../data/types'

export interface PlansState {
  /** Normalised id of the data set whose plans are listed; null until one is active. */
  sourceId: string | null
  /**
   * That data set's plans and this tab's active plan; null until a data set is active. Its list may be empty
   * (every plan deleted), and then there is no active plan either.
   * The list is kept in step with the stored one when other tabs change it.
   */
  index: PlanIndex | null
}

/**
 * The plan list of the active data set. Only `persistence.ts` writes to it;
 * it also tells the autosave which key the current plan belongs to.
 */
export const usePlansStore = create<PlansState>(() => ({ sourceId: null, index: null }))

export function selectActivePlanEntry(s: PlansState): PlanEntry | undefined {
  return s.index?.plans.find(p => p.id === s.index?.activePlanId)
}

/** True when the data set's last plan was deleted: no plan is open and the table shows the no-plan screen. */
export function selectNoPlan(s: PlansState): boolean {
  return s.index !== null && s.index.plans.length === 0
}
