import { create } from 'zustand'
import type { BlockLoop, ConnectionFlow, GameData, MultiBlockSolve, SolverResult } from '../data/types'
import { solveAll } from '../solver/index'
import { createSolveCache } from '../solver/solveCache'
import { useBlockStore } from './blockStore'
import { useGameDataStore, selectGameData } from './gameDataStore'
import { horizonFor } from './horizon'

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
  /** Latest solver error of every block that failed (blockId → message). */
  lastErrors: Record<string, string>
  /** Latest delivery on every block-to-block connection. */
  flows: ConnectionFlow[]
  /** Latest loops of blocks that supply each other. */
  loops: BlockLoop[]
  /** Internal — set by the subscription wiring; not for direct use. */
  _setStatus: (status: SolverStatus) => void
  /** Internal — point status/lastResult at another block using the stored results (no solve). */
  _selectBlock: (blockId: string) => void
  /** Internal — store a whole-plan solve; `status`/`lastResult` follow the active block. */
  _setSolved: (all: MultiBlockSolve, activeBlockId: string) => void
}

export const useSolverStore = create<SolverStoreState>((set) => ({
  status: { type: 'idle' },
  lastResult: undefined,
  lastResults: {},
  lastErrors: {},
  flows: [],
  loops: [],
  _setStatus: (status) => {
    if (status.type === 'solved') {
      set({ status, lastResult: status.result })
    } else {
      set({ status })
    }
  },
  _selectBlock: (blockId) =>
    set(state => {
      const error = state.lastErrors[blockId]
      if (error !== undefined) return { status: { type: 'error', message: error } }
      const result = state.lastResults[blockId]
      return result ? { status: { type: 'solved', result }, lastResult: result } : {}
    }),
  _setSolved: (all, activeBlockId) => {
    const shared = { lastResults: all.results, lastErrors: all.errors, flows: all.flows, loops: all.loops }
    const error = all.errors[activeBlockId]
    // A failure in one block is that block's status only; other blocks stay solved.
    if (error !== undefined) {
      set({ status: { type: 'error', message: error }, ...shared })
      return
    }
    const result = all.results[activeBlockId] ?? { nodes: [], unsatisfied: [], warnings: [] }
    set({ status: { type: 'solved', result }, lastResult: result, ...shared })
  },
}))

// ---------------------------------------------------------------------------
// Subscription wiring
//
// Called once at app startup (e.g. from main.tsx).
// Subscribes to the block + gameData changes, debounces, then
// re-solves in dependency order, reusing the previous result of every block
// whose inputs are unchanged (see solveAll and solveCache.ts).
// Returns an unsubscribe function for cleanup.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150

function sameMachines(a: GameData['defaultMachines'], b: GameData['defaultMachines']): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && a[k] === b[k])
}

export function wireSolver(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cache = createSolveCache()
  // Keeps the effective game data object stable across solves so cache hits survive.
  let solverDataMemo:
    | { gameData: GameData; defaultMachines: GameData['defaultMachines']; data: GameData }
    | undefined

  function solverDataFor(gameData: GameData, defaultMachines: GameData['defaultMachines']): GameData {
    if (defaultMachines === gameData.defaultMachines) {
      solverDataMemo = undefined
      return gameData
    }
    if (solverDataMemo?.gameData !== gameData || !sameMachines(solverDataMemo.defaultMachines, defaultMachines)) {
      solverDataMemo = { gameData, defaultMachines, data: { ...gameData, defaultMachines } }
    }
    return solverDataMemo.data
  }

  function schedule() {
    useSolverStore.getState()._setStatus({ type: 'pending' })

    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const { blocks, activeBlockId, horizonTechnologyIds, defaultMachineOverrides } = useBlockStore.getState()
      const gameData = selectGameData(useGameDataStore.getState())

      if (!gameData) {
        cache.clear()
        solverDataMemo = undefined
        useSolverStore.getState()._setStatus({ type: 'idle' })
        return
      }

      try {
        // Rows without an explicit machine solve with the horizon's default machine.
        const { defaultMachines } = horizonFor(gameData, horizonTechnologyIds, defaultMachineOverrides)
        const solverData = solverDataFor(gameData, defaultMachines)
        useSolverStore.getState()._setSolved(solveAll(blocks, solverData, cache), activeBlockId)
      } catch (err) {
        useSolverStore.getState()._setStatus({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }, DEBOUNCE_MS)
  }

  // Switching tabs changes no block, so the stored results are already right:
  // only repoint the active block's status instead of re-solving every block.
  const unsubBlocks = useBlockStore.subscribe((state, prev) => {
    if (
      state.blocks === prev.blocks &&
      state.activeBlockId !== prev.activeBlockId &&
      timer === undefined &&
      state.activeBlockId in useSolverStore.getState().lastResults
    ) {
      useSolverStore.getState()._selectBlock(state.activeBlockId)
      return
    }
    schedule()
  })
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

/**
 * The latest result of one block. Unlike `selectSolverResult` this follows the
 * block it is asked for, so a view stays consistent right after the active
 * block changes, before the next solve lands. Falls back to `lastResult` while
 * no per-block results exist yet.
 */
export function selectBlockResult(blockId: string | undefined) {
  return (state: SolverStoreState): SolverResult | undefined =>
    (blockId !== undefined ? state.lastResults[blockId] : undefined) ??
    (Object.keys(state.lastResults).length === 0 ? state.lastResult : undefined)
}

/** Latest result of every block, keyed by block id. */
export function selectBlockResults(state: SolverStoreState): Record<string, SolverResult> {
  return state.lastResults
}

/** Latest delivery on every block-to-block connection. Filter in useMemo, not here. */
export function selectFlows(state: SolverStoreState): ConnectionFlow[] {
  return state.flows
}

/** Latest loops of blocks that supply each other. */
export function selectLoops(state: SolverStoreState): BlockLoop[] {
  return state.loops
}
