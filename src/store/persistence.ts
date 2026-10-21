import { useBlockStore, makeEmptyBlock, selectAppState, clonePlan } from './blockStore'
import { useGameDataStore } from './gameDataStore'
import { usePlansStore } from './plansStore'
import { parseAppState, parsePlanIndex, parsePlanDataSetStamp, AppStateLoadError } from '../data/loader'
import {
  legacyPlanStorageKey, planIndexKey, planKey, planKeyPrefix, normalizeDatasetId, isCustomSourceId, isStorageKeyOf, isSameDataSet,
  CORRUPT_SUFFIX, CUSTOM_LEGACY_PLAN_KEY_PREFIX, CUSTOM_PLAN_INDEX_KEY_PREFIX, CUSTOM_PLAN_KEY_PREFIX,
} from './sourceId'
import { flattenBlock } from '../solver/index'
import type { AppState, GameData, PlanDataSetStamp, PlanEntry, PlanIndex, SubPlan } from '../data/types'

// Each data set holds several plans: an index key (plan names and the active
// plan) plus one key per plan. The key the autosave writes to is derived from
// usePlansStore, so switching plans means moving the active plan id there
// before the block store is replaced.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-per-data-set key; adopted once by the first data set activated, then deleted. */
export const LEGACY_APP_STATE_STORAGE_KEY = 'factorio-planner:app-state'

export const PLAN_NAME_MAX_LENGTH = 60
const EXPORT_SLUG_MAX_LENGTH = 40

/** Key the autosave writes to; null until a data set has been activated. */
function activePlanKey(): string | null {
  const { sourceId, index } = usePlansStore.getState()
  return sourceId !== null && index !== null ? planKey(sourceId, index.activePlanId) : null
}

// ---------------------------------------------------------------------------
// Plan names
// ---------------------------------------------------------------------------

/** "Plan N" for the first N (count + 1 upwards) not already used in `index`. */
export function nextPlanName(index: PlanIndex | null): string {
  const used = new Set(index?.plans.map(p => p.name))
  let n = (index?.plans.length ?? 0) + 1
  while (used.has(`Plan ${n}`)) n++
  return `Plan ${n}`
}

/** The file name without its last extension, trimmed and cut to the name limit; '' when nothing is left. */
export function planNameFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]*$/, '').trim().slice(0, PLAN_NAME_MAX_LENGTH)
}

/** `factorio-plan-<slug>-YYYY-MM-DD.json`; the slug is dropped when the name has no letters or digits. */
export function exportFileName(planName: string, date: Date): string {
  const slug = planName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, EXPORT_SLUG_MAX_LENGTH).replace(/-+$/, '')
  return `factorio-plan-${slug ? slug + '-' : ''}${date.toISOString().slice(0, 10)}.json`
}

/** The exported file: the app state plus the data set it was made for. */
export function exportPlanJson(appState: AppState, dataSet: PlanDataSetStamp): string {
  return JSON.stringify({ ...appState, dataSet }, null, 2)
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Serialize the current app state to the active plan's localStorage key.
 * No-op while no data set is active or while game data is loading. Silently ignores QuotaExceededError and
 * other write failures.
 */
export function saveAppState(): void {
  const key = activePlanKey()
  if (key === null) return
  // While a data set is loading, the plan list still points at the one being replaced; writing now could recreate keys that were just removed.
  if (useGameDataStore.getState().status.type === 'loading') return
  try {
    localStorage.setItem(key, JSON.stringify(selectAppState(useBlockStore.getState())))
  } catch {
    // Storage quota exceeded or unavailable — ignore.
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export type LoadAppStateResult =
  | { type: 'ok' }
  | { type: 'error'; message: string }

type ParseRawResult = { type: 'ok'; appState: AppState; raw: unknown } | { type: 'error'; message: string }

function parseRawAppState(raw: string, malformedPrefix: string): ParseRawResult {
  try {
    const parsed = JSON.parse(raw) as unknown
    return { type: 'ok', appState: parseAppState(parsed), raw: parsed }
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
  | { type: 'ok'; appState: AppState; unknownIds: string[]; sourceId: string; stamp: PlanDataSetStamp | null; dataSetMismatch: boolean }
  | { type: 'error'; message: string }

/**
 * Parse and validate an exported plan file against the loaded game data
 * (`sourceId` identifies it; `importPlanAsNew` refuses if it changed meanwhile).
 * `stamp` is the data set the file was exported for (null for older files) and
 * `dataSetMismatch` whether it differs from `sourceId`. Never touches the store.
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
  const stamp = parsePlanDataSetStamp(result.raw)
  return {
    type: 'ok',
    appState,
    unknownIds: findUnknownPlanIds(appState, gameData),
    sourceId,
    stamp,
    dataSetMismatch: stamp !== null && !isSameDataSet(stamp.id, sourceId),
  }
}


// ---------------------------------------------------------------------------
// Plan index
// ---------------------------------------------------------------------------

function resetToEmptyPlan(): void {
  const block = makeEmptyBlock('Factory')
  useBlockStore.getState().setAppState({
    blocks: [block],
    activeBlockId: block.id,
    horizonTechnologyIds: [],
    defaultMachineOverrides: {},
  })
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

function freshEntry(name: string): PlanEntry {
  return { id: crypto.randomUUID(), name }
}

/** Write the in-memory index; false when storage refused it. */
function writeIndex(): boolean {
  const { sourceId, index } = usePlansStore.getState()
  if (sourceId === null || index === null) return false
  try {
    localStorage.setItem(planIndexKey(sourceId), JSON.stringify(index))
    return true
  } catch {
    return false
  }
}

/** Drop duplicate ids; null when no plan is left; an unknown active id falls back to the first plan. */
function normalizeIndex(index: PlanIndex): PlanIndex | null {
  const seen = new Set<string>()
  const plans = index.plans.filter(p => !seen.has(p.id) && !!seen.add(p.id))
  if (plans.length === 0) return null
  return { plans, activePlanId: seen.has(index.activePlanId) ? index.activePlanId : plans[0].id }
}

/** Rebuild an index from the plan keys found in storage (used when the index is unreadable). */
function recoverIndex(sourceId: string): PlanIndex | null {
  const prefix = planKeyPrefix(sourceId)
  const ids: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null && key.startsWith(prefix) && !key.endsWith(CORRUPT_SUFFIX)) ids.push(key.slice(prefix.length))
    }
  } catch {
    return null
  }
  ids.sort()
  return normalizeIndex({ activePlanId: '', plans: ids.map((id, i) => ({ id, name: `Plan ${i + 1}` })) })
}

/** The stored index of a data set; null when there is none (an unreadable one is quarantined and rebuilt from the plan keys). */
function readIndex(sourceId: string): PlanIndex | null {
  const key = planIndexKey(sourceId)
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null // localStorage unavailable: nothing to restore or protect.
  }
  if (raw === null) return null
  try {
    const index = normalizeIndex(parsePlanIndex(JSON.parse(raw) as unknown))
    if (index) return index
  } catch (err) {
    if (!(err instanceof SyntaxError || err instanceof AppStateLoadError)) throw err
  }
  quarantine(key, raw)
  return recoverIndex(sourceId)
}

/**
 * Add `raw` (a stored plan, copied as-is so a bad one is quarantined by the
 * normal load path) as the new active plan. `written` is false when storage
 * refused either write; the old value must then be kept.
 */
function adoptRaw(sourceId: string, index: PlanIndex | null, raw: string): { index: PlanIndex; written: boolean } {
  const entry = freshEntry(nextPlanName(index))
  const next: PlanIndex = { activePlanId: entry.id, plans: [...(index?.plans ?? []), entry] }
  try {
    localStorage.setItem(planKey(sourceId, entry.id), raw)
    try {
      localStorage.setItem(planIndexKey(sourceId), JSON.stringify(next))
    } catch (err) {
      localStorage.removeItem(planKey(sourceId, entry.id))
      throw err
    }
    return { index: next, written: true }
  } catch {
    return { index: next, written: false }
  }
}

/**
 * Move a pre-multi-plan value into the plan list as the active plan: the
 * data set's old single-plan key, or (only with no index and no old key) the
 * global pre-per-data-set key. The old key is deleted only after the copy
 * landed. `raw` is set when the copy could not be written, so the plan is
 * still shown this session.
 */
function migrateLegacy(sourceId: string, index: PlanIndex | null): { index: PlanIndex | null; raw?: string } {
  try {
    let key = legacyPlanStorageKey(sourceId)
    let raw = localStorage.getItem(key)
    if (raw === null && index === null) {
      key = LEGACY_APP_STATE_STORAGE_KEY
      raw = localStorage.getItem(key)
    }
    if (raw === null) return { index }
    const adopted = adoptRaw(sourceId, index, raw)
    if (adopted.written) {
      localStorage.removeItem(key)
      return { index: adopted.index }
    }
    return { index: adopted.index, raw }
  } catch {
    return { index } // localStorage unavailable.
  }
}

/**
 * Load the active plan into the block store: the stored one, or an empty plan
 * if it is missing or unreadable (the latter is moved to `<key>:corrupt`
 * first). `rawOverride` stands in for the stored value.
 */
function loadActivePlan(rawOverride?: string): void {
  const key = activePlanKey()
  let raw: string | null = rawOverride ?? null
  if (raw === null && key !== null) {
    try {
      raw = localStorage.getItem(key)
    } catch {
      raw = null // localStorage unavailable: nothing to restore or protect.
    }
  }
  if (raw !== null) {
    const result = parseRawAppState(raw, 'Malformed JSON in localStorage')
    if (result.type === 'ok') {
      useBlockStore.getState().setAppState(result.appState)
      return
    }
    if (key !== null) quarantine(key, raw)
  }
  resetToEmptyPlan()
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Remove the plans stored for custom uploads, except those of `keepSourceId`.
 * Only one upload exists at a time, so its predecessors' plans can never be
 * reached again. Does not touch the plans store.
 */
export function removeCustomPlans(keepSourceId?: string): void {
  const prefixes = [CUSTOM_LEGACY_PLAN_KEY_PREFIX, CUSTOM_PLAN_INDEX_KEY_PREFIX, CUSTOM_PLAN_KEY_PREFIX]
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null || !prefixes.some(p => key.startsWith(p))) continue
      if (keepSourceId === undefined || !isStorageKeyOf(key, keepSourceId)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // localStorage unavailable — ignore.
  }
}

/**
 * Make `sourceId`'s plan list the active one: later autosaves write to its
 * active plan's key, and the block store is replaced by that plan (or an empty
 * one if it is missing or unreadable). Does nothing if that data set is already
 * active. A plan stored in the old single-plan shape is moved into the list.
 *
 * The key is switched before the store is replaced, so the previous data
 * set's plan is never written under the new key (and is not saved first:
 * removed custom-upload keys must not come back).
 */
export function activateDataSet(sourceId: string): void {
  const id = normalizeDatasetId(sourceId)
  if (id === usePlansStore.getState().sourceId) return
  // Only one custom upload exists at a time; drop plans of replaced ones.
  if (isCustomSourceId(id)) removeCustomPlans(id)

  const migrated = migrateLegacy(id, readIndex(id))
  const first = freshEntry('Plan 1')
  const index = migrated.index ?? { activePlanId: first.id, plans: [first] }
  usePlansStore.setState({ sourceId: id, index })
  // A plan whose copy failed (`raw` set) stays in memory only: listing it would add one more entry per reload.
  if (migrated.raw === undefined) writeIndex()
  loadActivePlan(migrated.raw)
}

// ---------------------------------------------------------------------------
// Plan actions
// ---------------------------------------------------------------------------

/**
 * Error unless game data is loaded, the plan list belongs to it and (when
 * given) `sourceId` is the data set the caller's input was checked against.
 */
function guardActive(sourceId?: string): LoadAppStateResult | null {
  const status = useGameDataStore.getState().status
  const listed = usePlansStore.getState().sourceId
  if (status.type !== 'loaded' || listed === null) return { type: 'error', message: 'Load game data first.' }
  const loaded = normalizeDatasetId(status.sourceId)
  if (loaded !== listed || (sourceId !== undefined && normalizeDatasetId(sourceId) !== loaded)) {
    return { type: 'error', message: 'The loaded game data changed; pick the file again.' }
  }
  return null
}

function currentIndex(): PlanIndex {
  const { index } = usePlansStore.getState()
  if (index === null) throw new Error('No plan list is active')
  return index
}

/** Make `plans` the plan list, `activePlanId` the active plan, and persist it. */
function setIndex(plans: PlanEntry[], activePlanId: string): void {
  usePlansStore.setState({ index: { plans, activePlanId } })
  writeIndex()
}

/** Switch to another plan of the active data set. */
export function switchPlan(planId: string): LoadAppStateResult {
  const blocked = guardActive()
  if (blocked) return blocked
  const index = currentIndex()
  if (planId === index.activePlanId) return { type: 'ok' }
  if (!index.plans.some(p => p.id === planId)) return { type: 'error', message: 'That plan no longer exists.' }
  saveAppState()
  setIndex(index.plans, planId)
  loadActivePlan()
  return { type: 'ok' }
}

/** Add an empty plan ("Plan N") and make it active. */
export function createPlan(): LoadAppStateResult {
  const blocked = guardActive()
  if (blocked) return blocked
  const index = currentIndex()
  saveAppState()
  const entry = freshEntry(nextPlanName(index))
  setIndex([...index.plans, entry], entry.id)
  resetToEmptyPlan()
  return { type: 'ok' }
}

/** Copy the active plan (with fresh ids) right after it and make the copy active. */
export function duplicatePlan(): LoadAppStateResult {
  const blocked = guardActive()
  if (blocked) return blocked
  const index = currentIndex()
  saveAppState()
  const copy = clonePlan(selectAppState(useBlockStore.getState()))
  const at = index.plans.findIndex(p => p.id === index.activePlanId)
  const entry = freshEntry(`${index.plans[at].name} (copy)`.slice(0, PLAN_NAME_MAX_LENGTH))
  setIndex([...index.plans.slice(0, at + 1), entry, ...index.plans.slice(at + 1)], entry.id)
  useBlockStore.getState().setAppState(copy)
  return { type: 'ok' }
}

/** Rename a plan; the name is trimmed and cut to the length limit, and must not end up empty. */
export function renamePlan(planId: string, name: string): LoadAppStateResult {
  const blocked = guardActive()
  if (blocked) return blocked
  const index = currentIndex()
  const trimmed = name.trim().slice(0, PLAN_NAME_MAX_LENGTH).trim()
  if (trimmed === '') return { type: 'error', message: 'A plan needs a name.' }
  if (!index.plans.some(p => p.id === planId)) return { type: 'error', message: 'That plan no longer exists.' }
  setIndex(index.plans.map(p => (p.id === planId ? { ...p, name: trimmed } : p)), index.activePlanId)
  return { type: 'ok' }
}

/**
 * Delete a plan. Deleting the active one activates the next (else previous)
 * plan; deleting the only one leaves a fresh empty "Plan 1".
 */
export function deletePlan(planId: string): LoadAppStateResult {
  const blocked = guardActive()
  if (blocked) return blocked
  const index = currentIndex()
  const at = index.plans.findIndex(p => p.id === planId)
  if (at < 0) return { type: 'error', message: 'That plan no longer exists.' }
  const sourceId = usePlansStore.getState().sourceId!
  try {
    localStorage.removeItem(planKey(sourceId, planId))
  } catch {
    // localStorage unavailable — ignore.
  }
  let plans = index.plans.filter(p => p.id !== planId)
  if (plans.length === 0) plans = [freshEntry('Plan 1')]
  const wasActive = planId === index.activePlanId
  const activePlanId = wasActive ? (plans[at] ?? plans[at - 1] ?? plans[0]).id : index.activePlanId
  setIndex(plans, activePlanId)
  if (wasActive) loadActivePlan()
  return { type: 'ok' }
}

/**
 * Add an imported plan as a new active plan, named after `fileName` (or "Plan N").
 * `sourceId` is the data set the plan was checked against. The previously
 * active plan is saved and left untouched; ids are regenerated.
 */
export function importPlanAsNew(appState: AppState, sourceId: string, fileName: string): LoadAppStateResult {
  const blocked = guardActive(sourceId)
  if (blocked) return blocked
  const index = currentIndex()
  saveAppState()
  const entry = freshEntry(planNameFromFileName(fileName) || nextPlanName(index))
  setIndex([...index.plans, entry], entry.id)
  useBlockStore.getState().setAppState(clonePlan(appState))
  return { type: 'ok' }
}

// ---------------------------------------------------------------------------
// Auto-save subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to block store changes and auto-save to localStorage on each
 * change, and swap the active plan list whenever a different data set finishes
 * loading. Returns an unsubscribe function for cleanup.
 *
 * Call this once at app startup. No plan is loaded until game data is.
 */
export function initAppStatePersistence(): () => void {
  const unsubBlocks = useBlockStore.subscribe((state, prevState) => {
    if (
      state.blocks !== prevState.blocks ||
      state.horizonTechnologyIds !== prevState.horizonTechnologyIds ||
      state.defaultMachineOverrides !== prevState.defaultMachineOverrides
    ) {
      saveAppState()
    }
  })
  const unsubGameData = useGameDataStore.subscribe((state) => {
    if (state.status.type === 'loaded') activateDataSet(state.status.sourceId)
  })
  const { status } = useGameDataStore.getState()
  if (status.type === 'loaded') activateDataSet(status.sourceId)

  return () => {
    unsubBlocks()
    unsubGameData()
    usePlansStore.setState({ sourceId: null, index: null })
  }
}
