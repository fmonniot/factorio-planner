import { create } from 'zustand'
import type { ConnectionFlow, MultiBlockSolve, SolverResult } from '../data/types'
import { solveAll } from '../solver/index'
import { useBlockStore } from './blockStore'
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
  /** Latest result of every block (blockId → result); the active block's is also `lastResult`. */
  lastResults: Record<string, SolverResult>
  /** Latest delivery on every block-to-block connection. */
  flows: ConnectionFlow[]
  /** Internal — set by the subscription wiring; not for direct use. */
  _setStatus: (status: SolverStatus) => void
  /** Internal — store a whole-plan solve; `status`/`lastResult` follow the active block. */
  _setSolved: (all: MultiBlockSolve, activeBlockId: string) => void
}

export const useSolverStore = create<SolverStoreState>((set) => ({
  status: { type: 'idle' },
  lastResult: undefined,
  lastResults: {},
  flows: [],
  _setStatus: (status) => {
    if (status.type === 'solved') {
      set({ status, lastResult: status.result })
    } else {
      set({ status })
    }
  },
  _setSolved: (all, activeBlockId) => {
    const error = all.errors[activeBlockId]
    // A failure in one block is that block's status only; other blocks stay solved.
    if (error !== undefined) {
      set({ status: { type: 'error', message: error }, lastResults: all.results, flows: all.flows })
      return
    }
    const result = all.results[activeBlockId] ?? { nodes: [], unsatisfied: [], warnings: [] }
    set({
      status: { type: 'solved', result },
      lastResult: result,
      lastResults: all.results,
      flows: all.flows,
    })
  },
}))

// ---------------------------------------------------------------------------
// Subscription wiring
//
// Called once at app startup (e.g. from main.tsx).
// Subscribes to the block + gameData changes, debounces, then re-solves every
// block in dependency order (one LP per block, see solveAll).
// Returns an unsubscribe function for cleanup.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150

export function wireSolver(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule() {
    useSolverStore.getState()._setStatus({ type: 'pending' })

    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      const { blocks, activeBlockId } = useBlockStore.getState()
      const gameData = selectGameData(useGameDataStore.getState())

      if (!gameData) {
        useSolverStore.getState()._setStatus({ type: 'idle' })
        return
      }

      try {
        useSolverStore.getState()._setSolved(solveAll(blocks, gameData), activeBlockId)
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

/** Latest result of every block, keyed by block id. */
export function selectBlockResults(state: SolverStoreState): Record<string, SolverResult> {
  return state.lastResults
}

/** Latest delivery on every block-to-block connection. Filter in useMemo, not here. */
export function selectFlows(state: SolverStoreState): ConnectionFlow[] {
  return state.flows
}
