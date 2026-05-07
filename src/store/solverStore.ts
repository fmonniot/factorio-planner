import { create } from 'zustand'
import type { SolverResult } from '../data/types'
import { solve, flattenBlock } from '../solver/index'
import { useBlockStore, selectActiveBlock } from './blockStore'
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
  /** The most recent successful solve result; persists while re-solving so views don't flash. */
  lastResult: SolverResult | undefined
  /** Internal — set by the subscription wiring; not for direct use. */
  _setStatus: (status: SolverStatus) => void
}

export const useSolverStore = create<SolverStoreState>((set) => ({
  status: { type: 'idle' },
  lastResult: undefined,
  _setStatus: (status) => {
    if (status.type === 'solved') {
      set({ status, lastResult: status.result })
    } else {
      set({ status })
    }
  },
}))

// ---------------------------------------------------------------------------
// Subscription wiring
//
// Called once at app startup (e.g. from main.tsx).
// Subscribes to the active block + gameData changes, debounces, then re-solves
// the whole block as one global LP.
// Returns an unsubscribe function for cleanup.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150

export function wireSolver(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule() {
    useSolverStore.getState()._setStatus({ type: 'pending' })

    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      const blockState = useBlockStore.getState()
      const block = selectActiveBlock(blockState)
      const gameData = selectGameData(useGameDataStore.getState())

      if (!gameData) {
        useSolverStore.getState()._setStatus({ type: 'idle' })
        return
      }

      if (!block) {
        useSolverStore.getState()._setStatus({
          type: 'solved',
          result: { nodes: [], unsatisfied: [], warnings: [] },
        })
        return
      }

      const plan = flattenBlock(block)
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

  const unsubBlocks = useBlockStore.subscribe(schedule)
  const unsubGameData = useGameDataStore.subscribe(schedule)

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    unsubBlocks()
    unsubGameData()
  }
}

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** Returns the latest SolverResult, or undefined if no solve has completed yet.
 *  Remains defined during re-solves so views don't unmount mid-interaction. */
export function selectSolverResult(state: SolverStoreState): SolverResult | undefined {
  return state.lastResult
}
