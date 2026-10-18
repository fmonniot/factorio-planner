// Dependency-free helpers for game data source ids and the plan storage keys
// derived from them. Kept apart from the stores so e2e support code can import
// them without pulling in the app.

const CUSTOM_PREFIX = 'custom:'

const PLAN_KEY_PREFIX = 'factorio-planner:app-state:'

/** Source id of an uploaded data set, as shown by the data set selector. */
export function customSourceId(filename: string): string {
  return CUSTOM_PREFIX + filename
}

export function isCustomSourceId(sourceId: string): boolean {
  return sourceId.startsWith(CUSTOM_PREFIX)
}

/** The uploaded file name of a custom source id, or null for bundled data sets. */
export function customFilename(sourceId: string): string | null {
  return isCustomSourceId(sourceId) ? sourceId.slice(CUSTOM_PREFIX.length) : null
}

/**
 * Source id under which a loaded custom data set is stored: the selector's id
 * plus a short fingerprint of its mod set, so two uploads that share a file
 * name but come from different mod sets do not share a plan.
 */
export function customPlanSourceId(filename: string, modSet: Record<string, string>): string {
  const canonical = Object.keys(modSet).sort().map(k => `${k}=${modSet[k]}`).join('\n')
  let hash = 5381
  for (let i = 0; i < canonical.length; i++) hash = ((hash * 33) ^ canonical.charCodeAt(i)) >>> 0
  return `${customSourceId(filename)}#${hash.toString(16).padStart(8, '0')}`
}

/**
 * Storage key of the plan belonging to a data set. Trailing slashes are
 * dropped so `kompetenz-seablock/` and `kompetenz-seablock` share a plan.
 */
export function planStorageKey(sourceId: string): string {
  return PLAN_KEY_PREFIX + sourceId.replace(/\/+$/, '')
}

/** Prefix shared by the storage keys of all custom-upload plans. */
export const CUSTOM_PLAN_KEY_PREFIX = planStorageKey(CUSTOM_PREFIX)
