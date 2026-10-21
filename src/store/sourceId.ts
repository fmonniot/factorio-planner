// Dependency-free helpers for game data source ids and the plan storage keys
// derived from them. Kept apart from the stores so e2e support code can import
// them without pulling in the app.

const CUSTOM_PREFIX = 'custom:'

const LEGACY_PLAN_KEY_PREFIX = 'factorio-planner:app-state:'
const PLAN_INDEX_KEY_PREFIX = 'factorio-planner:plan-index:'
const PLAN_KEY_PREFIX = 'factorio-planner:plan:'

/** Suffix of the key an unreadable stored value is moved to, so it stays recoverable. */
export const CORRUPT_SUFFIX = ':corrupt'

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

/** The 8-hex mod set fingerprint `customPlanSourceId` appends to a file name. */
const FINGERPRINT_RE = /#[0-9a-f]{8}$/

/** The uploaded file name of a custom source id without its fingerprint, or null for bundled data sets. */
export function customDisplayName(sourceId: string): string | null {
  const filename = customFilename(sourceId)
  return filename === null ? null : filename.replace(FINGERPRINT_RE, '')
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

/** Data set id without trailing slashes (the Seablock id used to end in one). */
export function normalizeDatasetId(id: string): string {
  return id.replace(/\/+$/, '')
}

/**
 * Whether two data set ids denote the same game data. Bundled ids compare
 * after normalisation; two uploads compare by mod set fingerprint, so the file
 * name does not matter. A bundled id never matches an upload.
 */
export function isSameDataSet(a: string, b: string): boolean {
  const na = normalizeDatasetId(a)
  const nb = normalizeDatasetId(b)
  if (na === nb) return true
  if (!isCustomSourceId(na) || !isCustomSourceId(nb)) return false
  const fa = FINGERPRINT_RE.exec(na)
  const fb = FINGERPRINT_RE.exec(nb)
  return fa !== null && fb !== null && fa[0] === fb[0]
}

/**
 * Key of the single plan a data set held before it could hold several. Only
 * read for migration. Trailing slashes are dropped so `kompetenz-seablock/` and
 * `kompetenz-seablock` share a plan.
 */
export function legacyPlanStorageKey(sourceId: string): string {
  return LEGACY_PLAN_KEY_PREFIX + normalizeDatasetId(sourceId)
}

/** Key of a data set's plan index (its plan list and active plan). */
export function planIndexKey(sourceId: string): string {
  return PLAN_INDEX_KEY_PREFIX + normalizeDatasetId(sourceId)
}

/** Prefix shared by the keys of all plans of one data set; ends in `/`. */
export function planKeyPrefix(sourceId: string): string {
  return PLAN_KEY_PREFIX + normalizeDatasetId(sourceId) + '/'
}

/** Key of one saved plan of a data set. */
export function planKey(sourceId: string, planId: string): string {
  return planKeyPrefix(sourceId) + planId
}

/** Prefixes shared by the storage keys of all custom-upload plans. */
export const CUSTOM_LEGACY_PLAN_KEY_PREFIX = legacyPlanStorageKey(CUSTOM_PREFIX)
export const CUSTOM_PLAN_INDEX_KEY_PREFIX = planIndexKey(CUSTOM_PREFIX)
export const CUSTOM_PLAN_KEY_PREFIX = PLAN_KEY_PREFIX + CUSTOM_PREFIX

/**
 * Whether `key` is one of the plan storage keys of `sourceId`: its legacy
 * plan, its index (or a `:corrupt` copy of either), or one of its plans (or a
 * `:corrupt` copy). Exact matching, so an upload whose file name merely starts
 * like another's is not mistaken for it.
 */
export function isStorageKeyOf(key: string, sourceId: string): boolean {
  const bare = key.endsWith(CORRUPT_SUFFIX) ? key.slice(0, -CORRUPT_SUFFIX.length) : key
  return bare === legacyPlanStorageKey(sourceId)
    || bare === planIndexKey(sourceId)
    || key.startsWith(planKeyPrefix(sourceId))
}
