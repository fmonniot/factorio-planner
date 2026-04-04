import { usePlanStore } from './planStore'
import { parsePlan } from '../data/loader'
import { PlanLoadError } from '../data/loader'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAN_STORAGE_KEY = 'factorio-planner:plan'

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Serialize the current plan to localStorage.
 * Silently ignores QuotaExceededError and other write failures.
 */
export function savePlan(): void {
  try {
    const plan = usePlanStore.getState().plan
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan))
  } catch {
    // Storage quota exceeded or unavailable — ignore.
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export type LoadPlanResult =
  | { type: 'ok' }
  | { type: 'missing' }
  | { type: 'error'; message: string }

/**
 * Read the persisted plan from localStorage and call setPlan() on the plan store.
 * Returns a result object describing what happened.
 *
 * On any failure the plan store is left unchanged (uses its default empty plan).
 */
export function loadPersistedPlan(): LoadPlanResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(PLAN_STORAGE_KEY)
  } catch {
    return { type: 'error', message: 'localStorage unavailable' }
  }

  if (raw === null) return { type: 'missing' }

  try {
    const parsed = JSON.parse(raw) as unknown
    const plan = parsePlan(parsed)
    usePlanStore.getState().setPlan(plan)
    return { type: 'ok' }
  } catch (err) {
    if (err instanceof PlanLoadError) {
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
 * Subscribe to plan store changes and auto-save to localStorage on each change.
 * Returns an unsubscribe function for cleanup.
 *
 * Call this once at app startup after loadPersistedPlan().
 */
export function initPlanPersistence(): () => void {
  return usePlanStore.subscribe((state, prevState) => {
    // Only save when the plan itself changed (not just undo/redo stacks).
    if (state.plan !== prevState.plan) {
      savePlan()
    }
  })
}
