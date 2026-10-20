import { create } from 'zustand'
import type { PlanEntry, PlanIndex } from '../data/types'

export interface PlansState {
  /** Normalised id of the data set whose plans are listed; null until one is active. */
  sourceId: string | null
  /** That data set's plans and its active plan; null until a data set is active. */
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
