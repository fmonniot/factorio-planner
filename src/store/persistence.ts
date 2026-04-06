import { useBlockStore } from './blockStore'
import { parseAppState } from '../data/loader'
import { AppStateLoadError } from '../data/loader'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const APP_STATE_STORAGE_KEY = 'factorio-planner:app-state'

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Serialize the current app state to localStorage.
 * Silently ignores QuotaExceededError and other write failures.
 */
export function saveAppState(): void {
  try {
    const { blocks, activeBlockId } = useBlockStore.getState()
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify({ blocks, activeBlockId }))
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
 * Read the persisted app state from localStorage and call setAppState() on the
 * block store. Returns a result object describing what happened.
 *
 * On any failure the store is left unchanged (uses its default initial state).
 */
export function loadPersistedAppState(): LoadAppStateResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(APP_STATE_STORAGE_KEY)
  } catch {
    return { type: 'error', message: 'localStorage unavailable' }
  }

  if (raw === null) return { type: 'missing' }

  try {
    const parsed = JSON.parse(raw) as unknown
    const appState = parseAppState(parsed)
    useBlockStore.getState().setAppState(appState)
    return { type: 'ok' }
  } catch (err) {
    if (err instanceof AppStateLoadError) {
      return { type: 'error', message: err.message }
    } else if (err instanceof SyntaxError) {
      return { type: 'error', message: `Malformed JSON in localStorage: ${err.message}` }
    }
    return { type: 'error', message: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Auto-save subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to block store changes and auto-save to localStorage on each change.
 * Returns an unsubscribe function for cleanup.
 *
 * Call this once at app startup after loadPersistedAppState().
 */
export function initAppStatePersistence(): () => void {
  return useBlockStore.subscribe((state, prevState) => {
    if (state.blocks !== prevState.blocks) {
      saveAppState()
    }
  })
}
