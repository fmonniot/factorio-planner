import { useBlockStore, makeEmptyBlock } from './blockStore'
import { useGameDataStore } from './gameDataStore'
import { parseAppState } from '../data/loader'
import { AppStateLoadError } from '../data/loader'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-per-data-set key; adopted once by the first data set activated, then deleted. */
export const LEGACY_APP_STATE_STORAGE_KEY = 'factorio-planner:app-state'

const PLAN_KEY_PREFIX = 'factorio-planner:app-state:'

/**
 * Storage key of the plan belonging to a data set. Trailing slashes are
 * dropped so `kompetenz-seablock/` and `kompetenz-seablock` share a plan.
 */
export function planStorageKey(sourceId: string): string {
  return PLAN_KEY_PREFIX + sourceId.replace(/\/+$/, '')
}

/** Key the autosave writes to; null until a data set has been loaded. */
let activeKey: string | null = null

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Serialize the current app state to the active data set's localStorage key.
 * No-op while no data set is active. Silently ignores QuotaExceededError and
 * other write failures.
 */
export function saveAppState(): void {
  if (activeKey === null) return
  try {
    const { blocks, activeBlockId } = useBlockStore.getState()
    localStorage.setItem(activeKey, JSON.stringify({ blocks, activeBlockId }))
  } catch {
    // Storage quota exceeded or unavailable — ignore.
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export type LoadAppStateResult =
  | { type: 'ok' }
  | { type: 'missing' }
  | { type: 'error'; message: string }

/**
 * Read the plan persisted for a data set and call setAppState() on the block
 * store. Returns a result object describing what happened.
 *
 * On any failure the store is left unchanged.
 */
export function loadPersistedAppState(sourceId: string): LoadAppStateResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(planStorageKey(sourceId))
  } catch {
    return { type: 'error', message: 'localStorage unavailable' }
  }

  if (raw === null) return { type: 'missing' }
  return applyRawAppState(raw, 'Malformed JSON in localStorage')
}

function applyRawAppState(raw: string, malformedPrefix: string): LoadAppStateResult {
  try {
    const parsed = JSON.parse(raw) as unknown
    const appState = parseAppState(parsed)
    useBlockStore.getState().setAppState(appState)
    return { type: 'ok' }
  } catch (err) {
    if (err instanceof AppStateLoadError) {
      return { type: 'error', message: err.message }
    } else if (err instanceof SyntaxError) {
      return { type: 'error', message: `${malformedPrefix}: ${err.message}` }
    }
    return { type: 'error', message: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function resetToEmptyPlan(): void {
  const block = makeEmptyBlock('Factory')
  useBlockStore.getState().setAppState({ blocks: [block], activeBlockId: block.id })
}

/**
 * Make `sourceId`'s plan the active one: later autosaves write to its key,
 * and the block store is replaced by the stored plan (or an empty one if none
 * exists or it is unreadable). Does nothing if that data set is already active.
 *
 * The key is switched before the store is replaced, so the previous data
 * set's plan is never written under the new key.
 */
export function activatePlan(sourceId: string): void {
  const key = planStorageKey(sourceId)
  if (key === activeKey) return
  activeKey = key

  const result = loadPersistedAppState(sourceId)
  if (result.type === 'ok') return

  if (result.type === 'missing') {
    // One-time migration of the pre-per-data-set plan.
    try {
      const legacy = localStorage.getItem(LEGACY_APP_STATE_STORAGE_KEY)
      if (legacy !== null) {
        const adopted = applyRawAppState(legacy, 'Malformed legacy plan')
        localStorage.removeItem(LEGACY_APP_STATE_STORAGE_KEY)
        if (adopted.type === 'ok') return
      }
    } catch {
      // localStorage unavailable — fall through to an empty plan.
    }
  }
  resetToEmptyPlan()
}

// ---------------------------------------------------------------------------
// Auto-save subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to block store changes and auto-save to localStorage on each
 * change, and swap the active plan whenever a different data set finishes
 * loading. Returns an unsubscribe function for cleanup.
 *
 * Call this once at app startup. No plan is loaded until game data is.
 */
export function initAppStatePersistence(): () => void {
  const unsubBlocks = useBlockStore.subscribe((state, prevState) => {
    if (state.blocks !== prevState.blocks) {
      saveAppState()
    }
  })
  const unsubGameData = useGameDataStore.subscribe((state) => {
    if (state.status.type === 'loaded') activatePlan(state.status.sourceId)
  })
  const { status } = useGameDataStore.getState()
  if (status.type === 'loaded') activatePlan(status.sourceId)

  return () => {
    unsubBlocks()
    unsubGameData()
    activeKey = null
  }
}
