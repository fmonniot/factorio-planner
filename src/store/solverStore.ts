import { create } from 'zustand'
import type { SolverResult } from '../data/types'
import { solve } from '../solver/index'
import { usePlanStore } from './planStore'
import { useGameDataStore, selectGameData } from './gameDataStore'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type SolverStatus =
  | { type: 'idle' }
  | { type: 'pending' }
  | { type: 'solved'; result: SolverResult }
  | { type: 'error'; message: string }

export interface SolverStoreState {
  status: SolverStatus
  /** Internal — set by the subscription wiring; not for direct use. */
  _setStatus: (status: SolverStatus) => void
}

export const useSolverStore = create<SolverStoreState>((set) => ({
  status: { type: 'idle' },
  _setStatus: (status) => set({ status }),
}))

// ---------------------------------------------------------------------------
// Subscription wiring
//
// Called once at app startup (e.g. from main.tsx or App.tsx).
// Subscribes to plan + gameData changes, debounces, then re-solves.
// Returns an unsubscribe function for cleanup.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150

export function wireSolver(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule() {
    useSolverStore.getState()._setStatus({ type: 'pending' })

    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      const plan = usePlanStore.getState().plan
      const gameData = selectGameData(useGameDataStore.getState())

      if (!gameData) {
        useSolverStore.getState()._setStatus({ type: 'idle' })
        return
      }

      // Plans with no goals or no nodes produce a trivially empty result rather
      // than running the full solver.
      if (plan.goals.length === 0 || plan.nodes.length === 0) {
        useSolverStore.getState()._setStatus({
          type: 'solved',
          result: { nodes: [], unsatisfied: [], warnings: [] },
        })
        return
      }

      try {
        const result = solve(plan, gameData)
        useSolverStore.getState()._setStatus({ type: 'solved', result })
      } catch (err) {
        useSolverStore.getState()._setStatus({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }, DEBOUNCE_MS)
  }

  const unsubPlan = usePlanStore.subscribe(schedule)
  const unsubGameData = useGameDataStore.subscribe(schedule)

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    unsubPlan()
    unsubGameData()
  }
}

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** Returns the latest SolverResult, or undefined if not yet solved. */
export function selectSolverResult(state: SolverStoreState): SolverResult | undefined {
  return state.status.type === 'solved' ? state.status.result : undefined
}
