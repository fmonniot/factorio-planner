import { useBlockStore, makeEmptyBlock, selectAppState } from './blockStore'
import { useGameDataStore } from './gameDataStore'
import { parseAppState } from '../data/loader'
import { AppStateLoadError } from '../data/loader'
import { planStorageKey, CUSTOM_PLAN_KEY_PREFIX } from './sourceId'
import { flattenBlock } from '../solver/index'
import type { AppState, GameData, SubPlan } from '../data/types'

export { planStorageKey }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-per-data-set key; adopted once by the first data set activated, then deleted. */
export const LEGACY_APP_STATE_STORAGE_KEY = 'factorio-planner:app-state'

/** Suffix of the key an unreadable stored plan is moved to, so it stays recoverable. */
const CORRUPT_SUFFIX = ':corrupt'

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
    localStorage.setItem(activeKey, JSON.stringify(selectAppState(useBlockStore.getState())))
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

type ParseRawResult = { type: 'ok'; appState: AppState } | { type: 'error'; message: string }

function parseRawAppState(raw: string, malformedPrefix: string): ParseRawResult {
  try {
    const parsed = JSON.parse(raw) as unknown
    return { type: 'ok', appState: parseAppState(parsed) }
  } catch (err) {
    if (err instanceof AppStateLoadError) {
      return { type: 'error', message: err.message }
    } else if (err instanceof SyntaxError) {
      return { type: 'error', message: `${malformedPrefix}: ${err.message}` }
    }
    return { type: 'error', message: String(err) }
  }
}

function applyRawAppState(raw: string, malformedPrefix: string): LoadAppStateResult {
  const result = parseRawAppState(raw, malformedPrefix)
  if (result.type === 'error') return result
  useBlockStore.getState().setAppState(result.appState)
  return { type: 'ok' }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Recipe ids (game-recipe nodes) and goal item ids that the loaded game data does not define, deduped, in first-seen order. */
export function findUnknownPlanIds(appState: AppState, gameData: GameData): string[] {
  const unknown = new Set<string>()
  for (const block of appState.blocks) {
    const plan = flattenBlock(block)
    for (const n of plan.nodes) {
      if (n.kind === 'game-recipe' && !gameData.recipes[n.recipeId]) unknown.add(n.recipeId)
    }
    for (const g of plan.goals) {
      if (!gameData.items[g.itemId]) unknown.add(g.itemId)
    }
  }
  return [...unknown]
}

/** First duplicated block, sub-plan or node id (ids must be unique per block), as an error message; null when all are unique. */
function findDuplicateId(appState: AppState): string | null {
  const blockIds = new Set<string>()
  for (const block of appState.blocks) {
    if (blockIds.has(block.id)) return `Duplicate block id "${block.id}".`
    blockIds.add(block.id)
    const subPlanIds = new Set<string>()
    const nodeIds = new Set<string>()
    const walk = (plan: SubPlan): string | null => {
      if (subPlanIds.has(plan.id)) return `Duplicate sub-plan id "${plan.id}" in block "${block.id}".`
      subPlanIds.add(plan.id)
      for (const n of plan.nodes) {
        if (nodeIds.has(n.id)) return `Duplicate node id "${n.id}" in block "${block.id}".`
        nodeIds.add(n.id)
      }
      for (const sp of plan.subPlans) {
        const dup = walk(sp)
        if (dup) return dup
      }
      return null
    }
    const dup = walk(block.rootPlan)
    if (dup) return dup
  }
  return null
}

export type PlanImportCheck =
  | { type: 'ok'; appState: AppState; unknownIds: string[]; sourceId: string }
  | { type: 'error'; message: string }

/**
 * Parse and validate an exported plan file against the loaded game data
 * (`sourceId` identifies it; `replacePlan` refuses if it changed meanwhile).
 * Never touches the store.
 */
export function checkPlanImport(json: string, gameData: GameData, sourceId: string): PlanImportCheck {
  const result = parseRawAppState(json, 'Not a valid JSON file')
  if (result.type === 'error') return result
  let appState = result.appState
  if (appState.blocks.length === 0) return { type: 'error', message: 'The plan contains no blocks.' }
  const duplicate = findDuplicateId(appState)
  if (duplicate) return { type: 'error', message: duplicate }
  if (!appState.blocks.some(b => b.id === appState.activeBlockId)) {
    appState = { ...appState, activeBlockId: appState.blocks[0].id }
  }
  return { type: 'ok', appState, unknownIds: findUnknownPlanIds(appState, gameData), sourceId }
}

/**
 * Replace the current data set's plan with an imported one. `sourceId` is the
 * data set the plan was checked against. Not undoable; autosave persists it.
 */
export function replacePlan(appState: AppState, sourceId: string): LoadAppStateResult {
  const status = useGameDataStore.getState().status
  if (status.type !== 'loaded') {
    return { type: 'error', message: 'Load game data before importing a plan.' }
  }
  if (status.sourceId !== sourceId) {
    return { type: 'error', message: 'The loaded game data changed; pick the file again.' }
  }
  useBlockStore.getState().setAppState(appState)
  return { type: 'ok' }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function resetToEmptyPlan(): void {
  const block = makeEmptyBlock('Factory')
  useBlockStore.getState().setAppState({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: [] })
}

/** Copy an unreadable stored value to `<key>:corrupt` and drop the original. */
function quarantine(key: string, raw: string): void {
  try {
    localStorage.setItem(key + CORRUPT_SUFFIX, raw)
    localStorage.removeItem(key)
  } catch {
    // Storage full or unavailable — nothing more we can do.
  }
}

/**
 * Remove the plans stored for custom uploads, except the one under
 * `keepKey`. Only one upload exists at a time, so its predecessors' plans
 * can never be reached again.
 */
export function removeCustomPlans(keepKey?: string): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null && key.startsWith(CUSTOM_PLAN_KEY_PREFIX) && key !== keepKey) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // localStorage unavailable — ignore.
  }
}

/**
 * Make `sourceId`'s plan the active one: later autosaves write to its key,
 * and the block store is replaced by the stored plan (or an empty one if none
 * exists or it is unreadable). Does nothing if that data set is already active.
 *
 * The key is switched before the store is replaced, so the previous data
 * set's plan is never written under the new key. An unreadable stored plan is
 * moved to `<key>:corrupt` before the empty plan is autosaved over it.
 */
export function activatePlan(sourceId: string): void {
  const key = planStorageKey(sourceId)
  if (key === activeKey) return
  activeKey = key
  // Only one custom upload exists at a time; drop plans of replaced ones.
  if (key.startsWith(CUSTOM_PLAN_KEY_PREFIX)) removeCustomPlans(key)

  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    raw = null // localStorage unavailable: nothing to restore or protect.
  }

  if (raw !== null) {
    if (applyRawAppState(raw, 'Malformed JSON in localStorage').type === 'ok') return
    quarantine(key, raw)
  } else {
    // One-time migration of the pre-per-data-set plan.
    try {
      const legacy = localStorage.getItem(LEGACY_APP_STATE_STORAGE_KEY)
      if (legacy !== null) {
        if (applyRawAppState(legacy, 'Malformed legacy plan').type === 'ok') {
          localStorage.removeItem(LEGACY_APP_STATE_STORAGE_KEY)
          return
        }
        quarantine(LEGACY_APP_STATE_STORAGE_KEY, legacy)
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
    if (state.blocks !== prevState.blocks || state.horizonTechnologyIds !== prevState.horizonTechnologyIds) {
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
