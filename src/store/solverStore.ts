import { create } from 'zustand'
import type { SubPlan, SolverResult, GameData } from '../data/types'
import type { SyntheticRecipe } from '../solver/subplan'
import { deriveSyntheticRecipe } from '../solver/subplan'
import { solve } from '../solver/index'
import { useBlockStore, selectActiveSubPlan, findSubPlan } from './blockStore'
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
  /**
   * Solve results for every subplan in the active block, keyed by subplan id.
   * Populated by solveBottomUp on each solve cycle. Useful for showing
   * throughput summaries for non-active subplans.
   */
  subPlanResults: Map<string, SolverResult>
  /** Internal — set by the subscription wiring; not for direct use. */
  _setStatus: (status: SolverStatus, subPlanResults?: Map<string, SolverResult>) => void
}

export const useSolverStore = create<SolverStoreState>((set) => ({
  status: { type: 'idle' },
  lastResult: undefined,
  subPlanResults: new Map(),
  _setStatus: (status, subPlanResults) => {
    if (status.type === 'solved') {
      set({ status, lastResult: status.result, subPlanResults: subPlanResults ?? new Map() })
    } else {
      set({ status })
    }
  },
}))

// ---------------------------------------------------------------------------
// Bottom-up solver
//
// Solves every subplan in the tree in post-order (children before parents).
// Child solve results are used to derive synthetic recipes that let the parent
// treat each child subplan as an opaque black-box recipe.
// ---------------------------------------------------------------------------

function solveBottomUp(rootPlan: SubPlan, gameData: GameData): Map<string, SolverResult> {
  const results = new Map<string, SolverResult>()

  function visit(subPlan: SubPlan): void {
    // Post-order: solve children first
    for (const child of subPlan.subPlans) visit(child)

    // Collect synthetic recipes for subplan nodes in this subplan
    const syntheticRecipes = new Map<string, SyntheticRecipe>()
    for (const node of subPlan.nodes) {
      if (node.kind !== 'subplan') continue
      const childPlan = findSubPlan(rootPlan, node.subPlanId)
      const childResult = results.get(node.subPlanId)
      if (childPlan && childResult) {
        const synthetic = deriveSyntheticRecipe(childPlan, childResult)
        if (synthetic) syntheticRecipes.set(synthetic.id, synthetic)
      }
    }

    const result = solve(subPlan, gameData, syntheticRecipes)
    results.set(subPlan.id, result)
  }

  visit(rootPlan)
  return results
}

// ---------------------------------------------------------------------------
// Subscription wiring
//
// Called once at app startup (e.g. from main.tsx).
// Subscribes to active subplan + gameData changes, debounces, then re-solves.
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
      const subPlan = selectActiveSubPlan(blockState)
      const gameData = selectGameData(useGameDataStore.getState())

      if (!gameData) {
        useSolverStore.getState()._setStatus({ type: 'idle' })
        return
      }

      if (!subPlan || subPlan.goals.length === 0 || subPlan.nodes.length === 0) {
        useSolverStore.getState()._setStatus({
          type: 'solved',
          result: { nodes: [], unsatisfied: [], warnings: [] },
        })
        return
      }

      try {
        // Find the root plan for the active block so we can run the full
        // bottom-up solve (required to populate synthetic recipes for child
        // subplans referenced as nodes in the active subplan).
        const activeBlock = blockState.blocks.find(b => b.id === blockState.activeBlockId)
        const rootPlan = activeBlock?.rootPlan ?? subPlan

        const allResults = solveBottomUp(rootPlan, gameData)
        const activeResult = allResults.get(subPlan.id) ?? { nodes: [], unsatisfied: [], warnings: [] }

        useSolverStore.getState()._setStatus(
          { type: 'solved', result: activeResult },
          allResults,
        )
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
