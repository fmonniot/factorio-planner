/**
 * Locale parsing and name resolution for build-game-data.js.
 *
 * Mod locale values may contain Factorio placeholders (`__ITEM__x__`,
 * `__ENTITY__x__`, `__FLUID__x__`, `__TILE__x__`) that the game expands at
 * runtime. They are expanded here so no placeholder reaches the exported names.
 */

/**
 * Parse a Factorio locale .cfg file into a flat key→value map.
 * Format:
 *   [section-name]
 *   key=Value string
 */
export function parseCfg(text) {
  const out = {}
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1)
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1) // preserve trailing spaces in values
    out[section + '.' + key] = val
  }
  return out
}

/**
 * Build a merged locale map from all mods.
 * @param {Record<string, object>} resolvers
 * @returns {Record<string, string>}
 */
export function buildLocaleMap(resolvers) {
  const locale = {}
  for (const resolver of Object.values(resolvers)) {
    let files
    try {
      files = resolver.listFiles('locale/en/')
    } catch {
      continue
    }
    for (const filePath of files) {
      if (!filePath.endsWith('.cfg')) continue
      const buf = resolver.readFile(filePath)
      if (!buf) continue
      const entries = parseCfg(buf.toString('utf8'))
      Object.assign(locale, entries)
    }
  }
  return locale
}

/** Locale sections searched for each placeholder token, in order. */
export const PLACEHOLDER_SCOPES = {
  ITEM:   ['item-name', 'entity-name', 'equipment-name'],
  ENTITY: ['entity-name', 'item-name'],
  FLUID:  ['fluid-name'],
  TILE:   ['tile-name', 'item-name'],
}

export const TOKEN_RE = /__(ITEM|ENTITY|FLUID|TILE)__([A-Za-z0-9][A-Za-z0-9_.-]*?)__/g
/**
 * A leftover of a token we expand (`__ITEM__`, `__ENTITY__`, `__FLUID__`,
 * `__TILE__`), including malformed ones with no closing `__`. Other Factorio
 * tokens (`__CONTROL__x__`, `__REMARK_COLOR_BEGIN__`) and numeric `__1__`
 * are not residue.
 */
export const RESIDUE_RE = /__(ITEM|ENTITY|FLUID|TILE)__/

const MAX_DEPTH = 8

/**
 * Expand `__ITEM__x__`-style placeholders in `text`.
 * An unresolved token becomes its bare id and makes `ok` false; `ok` is also
 * false when a `__WORD__` residue remains (e.g. a malformed token).
 * @returns {{ text: string, ok: boolean }}
 */
export function expandPlaceholders(text, localeMap, stack = []) {
  let ok = true
  const out = text.replace(TOKEN_RE, (_, kind, id) => {
    for (const scope of PLACEHOLDER_SCOPES[kind]) {
      const val = lookupLocale(scope + '.' + id, localeMap, stack)
      if (val !== undefined) return val
    }
    ok = false
    return id
  })
  if (RESIDUE_RE.test(out)) ok = false
  return { text: out, ok }
}

/**
 * Look up a locale key and expand its placeholders. A value whose placeholders
 * cannot be resolved counts as missing (so callers move on to the next scope).
 * @returns {string | undefined}
 */
export function lookupLocale(key, localeMap, stack = []) {
  const val = localeMap[key]
  if (val === undefined) return undefined
  if (stack.includes(key) || stack.length >= MAX_DEPTH) return undefined
  const { text, ok } = expandPlaceholders(val, localeMap, [...stack, key])
  return ok ? text : undefined
}

/**
 * Resolve a LocalisedString strictly: `undefined` when any part (placeholder,
 * key or nested argument) cannot be resolved cleanly.
 */
function resolveStrict(localised, localeMap) {
  if (typeof localised === 'string') {
    const { text, ok } = expandPlaceholders(localised, localeMap)
    return ok ? text : undefined
  }
  if (!Array.isArray(localised)) return undefined
  const [key, ...rest] = localised
  if (typeof key !== 'string') return undefined
  if (key === '') {
    // Concatenation: ["", part1, part2, ...] — every part must resolve.
    const parts = rest.map(p => resolveStrict(p, localeMap))
    return parts.some(p => p === undefined) ? undefined : parts.join('')
  }
  if (rest.length === 0) return lookupLocale(key, localeMap)
  // Format string with args — basic positional substitution.
  const template = lookupLocale(key, localeMap)
  if (template === undefined) return undefined
  let failed = false
  const text = template.replace(/__(\d+)__/g, (_, n) => {
    const arg = rest[parseInt(n, 10) - 1]
    if (arg == null) return `__${n}__`
    const val = resolveStrict(arg, localeMap)
    if (val === undefined) failed = true
    return val ?? ''
  })
  return failed ? undefined : text
}

/**
 * Resolve a Factorio LocalisedString to English.
 * A LocalisedString is either a plain string (placeholders expanded) or an
 * array: a locale key plus positional args (`["format", arg1, arg2]`), or
 * `["", part1, part2, ...]` for concatenation.
 *
 * If any part cannot be resolved cleanly (unknown key, unresolvable
 * placeholder) the whole name counts as unresolved and `fallback` is used.
 */
export function resolveLocale(localised, fallback, localeMap, ...scopes) {
  if (!localised) {
    for (const scope of scopes) {
      const val = lookupLocale(scope + '.' + fallback, localeMap)
      if (val) return val
    }
    return fallback
  }
  return resolveStrict(localised, localeMap) || fallback
}

/**
 * Display name of a technology. Leveled technologies ("mining-productivity-2")
 * usually share one localised name keyed by the base id, so fall back to
 * "<base name> <level>".
 */
export function resolveTechnologyName(proto, localeMap) {
  const name = resolveLocale(proto.localised_name, proto.name, localeMap, 'technology-name')
  if (name !== proto.name) return name
  const m = proto.name.match(/^(.*)-(\d+)$/)
  if (m) {
    const base = resolveLocale(null, m[1], localeMap, 'technology-name')
    if (base !== m[1]) return `${base} ${m[2]}`
  }
  return proto.name
}

/**
 * Replicate Factorio's recipe name resolution:
 * 1. explicit localised_name, 2. recipe-name locale key, 3. main product name.
 */
export function resolveRecipeName(proto, mainProductId, localeMap) {
  let name = resolveLocale(proto.localised_name, proto.name, localeMap, 'recipe-name')
  if (name === proto.name && typeof mainProductId === 'string' && mainProductId !== '') {
    name = resolveLocale(null, mainProductId, localeMap, 'item-name', 'entity-name', 'fluid-name')
  }
  return name
}
