#!/usr/bin/env node
/**
 * build-game-data.js
 *
 * Converts a `factorio --dump-data` JSON dump into the game-data.json bundle
 * consumed by the factorio-planner web app.  Replaces the runtime Lua mod.
 *
 * Usage:
 *   node scripts/build-game-data.js \
 *     --dump      ~/...factorio/script-output/data-raw-dump.json \
 *     --factorio-dir /Applications/factorio.app/Contents \
 *     --mods-dir  ~/...factorio/mods \
 *     --icons-out public/data/nullius/icons \
 *     --output    public/data/nullius/game-data.json
 *
 * macOS defaults (omit flags and the defaults are used):
 *   --dump        ~/Library/Application Support/factorio/script-output/data-raw-dump.json
 *   --factorio-dir /Applications/factorio.app/Contents
 *   --mods-dir    ~/Library/Application Support/factorio/mods
 *   --icons-out   public/data/nullius/icons
 *   --output      public/data/nullius/game-data.json
 * 
 * For a Steam installation, the following command dump the data
 * ~/Library/Application\ Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio --dump-data
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { compositeIconLayers, normalizeIcon } from './icon-compositor.js'

// adm-zip is a CommonJS module; import via createRequire from an ESM context.
const require = createRequire(import.meta.url)
const AdmZip  = require('adm-zip')

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const HOME = homedir()
const FACTORIO_DATA_DIR = `${HOME}/Library/Application Support/factorio/script-output`

const DEFAULTS = {
  dump:         join(FACTORIO_DATA_DIR, 'data-raw-dump.json'),
  factorioDir:  '/Applications/factorio.app/Contents',
  modsDir:      `${HOME}/Library/Application Support/factorio/mods`,
  iconsOut:     'public/data/nullius/icons',
  output:       'public/data/nullius/game-data.json',
}

function parseArgs(argv) {
  const args = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dump')         args.dump        = argv[++i]
    else if (argv[i] === '--factorio-dir') args.factorioDir = argv[++i]
    else if (argv[i] === '--mods-dir')    args.modsDir     = argv[++i]
    else if (argv[i] === '--icons-out')   args.iconsOut    = argv[++i]
    else if (argv[i] === '--output')      args.output      = argv[++i]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

// ---------------------------------------------------------------------------
// ModResolver — abstracts directory vs. zip mod access
// ---------------------------------------------------------------------------

/**
 * Build a resolver for a mod that lives in a plain directory.
 * @param {string} dir absolute path to the mod directory
 */
function dirResolver(dir) {
  return {
    readFile(virtualPath) {
      const full = join(dir, virtualPath)
      if (!existsSync(full)) return null
      return readFileSync(full)
    },
    listFiles(prefix) {
      const base = join(dir, prefix)
      if (!existsSync(base)) return []
      return readdirSync(base, { recursive: true, withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => join(prefix, e.parentPath ? e.parentPath.slice(base.length + 1) : '', e.name))
    },
  }
}

/**
 * Build a resolver for a mod packaged as a .zip file.
 * Factorio zips have a single top-level directory `modname_version/` containing
 * the mod files — we strip that prefix when resolving virtual paths.
 * @param {string} zipPath absolute path to the .zip file
 */
function zipResolver(zipPath) {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()

  // Detect the inner root prefix (e.g. "nullius_0.9.6/").
  let rootPrefix = ''
  for (const e of entries) {
    const parts = e.entryName.split('/')
    if (parts.length >= 2 && parts[0]) {
      rootPrefix = parts[0] + '/'
      break
    }
  }

  return {
    readFile(virtualPath) {
      const inner = rootPrefix + virtualPath
      const entry = zip.getEntry(inner)
      if (!entry) return null
      return entry.getData()
    },
    listFiles(prefix) {
      const inner = rootPrefix + prefix
      return entries
        .filter(e => e.entryName.startsWith(inner) && !e.isDirectory)
        .map(e => e.entryName.slice(rootPrefix.length))
    },
  }
}

// ---------------------------------------------------------------------------
// Build mod resolver map: modName -> resolver
// ---------------------------------------------------------------------------

/**
 * Scan modsDir + factorioDir/data/ and build a map of modName -> resolver.
 * Unzipped directories take priority over .zip archives (mirrors Factorio).
 */
function buildResolverMap(factorioDir, modsDir) {
  const map = {}

  // Built-in mods from the Factorio installation (always plain directories).
  const builtinDataDir = join(factorioDir, 'data')
  if (existsSync(builtinDataDir)) {
    for (const entry of readdirSync(builtinDataDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        map[entry.name] = dirResolver(join(builtinDataDir, entry.name))
      }
    }
  } else {
    process.stderr.write(`[warn] Factorio built-in data dir not found: ${builtinDataDir}\n`)
  }

  // User mods
  if (existsSync(modsDir)) {
    // first pass: directories (take priority).
    // Work with symlink (often used during mod development and/or not released mods)
    for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
      let isDirectory = false;
      if (entry.isSymbolicLink()) {
        const stat = statSync(join(modsDir, entry.name));

        if (stat.isDirectory()) {
          isDirectory = true
        }

      } else if (entry.isDirectory()) {
        isDirectory = true
      }

      if (isDirectory) {
        // Strip version suffix to get mod name: "nullius_0.9.6" -> "nullius"
        const modName = entry.name.replace(/_\d+\.\d+\.\d+$/, '')
        map[modName] = dirResolver(join(modsDir, entry.name))
      } 
    }

    // Second pass: zip files (only add if not already covered by a directory).
    for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && entry.name.endsWith('.zip')) {
        const baseName = entry.name.slice(0, -4) // strip .zip
        const modName  = baseName.replace(/_\d+\.\d+\.\d+$/, '')
        if (!map[modName]) {
          map[modName] = zipResolver(join(modsDir, entry.name))
        }
      }
    }
  } else {
    process.stderr.write(`[warn] Mods dir not found: ${modsDir}\n`)
  }

  return map
}

// ---------------------------------------------------------------------------
// Locale parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Factorio locale .cfg file into a flat key→value map.
 * Format:
 *   [section-name]
 *   key=Value string
 */
function parseCfg(text) {
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
function buildLocaleMap(resolvers) {
  const locale = {}
  for (const [modName, resolver] of Object.entries(resolvers)) {
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

/**
 * Resolve a Factorio LocalisedString to English.
 * A LocalisedString is either:
 *   - a plain string  → return as-is
 *   - an array        → first element is a locale key, rest are positional args
 *     e.g. ["item-name.iron-plate"]  or  ["format", arg1, arg2]
 *
 * We only handle the simple single-key case; complex format strings fall back
 * to the prototype's internal name.
 */
function resolveLocale(localised, fallback, localeMap, ...scopes) {
  if (!localised) {
    for (const scope of scopes) {
      const val = localeMap[scope + '.' + fallback]
      if (val) return val
    }
    return fallback
  }
  if (typeof localised === 'string') return localised || fallback

  if (Array.isArray(localised)) {
    const [key, ...rest] = localised
    if (typeof key === 'string' && key !== '' && rest.length === 0) {
      return localeMap[key] ?? fallback
    }
    // Simple concatenation case: ["", part1, part2, ...]
    if (key === '') {
      return rest.map(p => resolveLocale(p, '', localeMap)).join('') || fallback
    }
    // Format string with args — do a basic positional substitution.
    const template = localeMap[key]
    if (!template) return fallback
    return template.replace(/__(\d+)__/g, (_, n) => {
      const arg = rest[parseInt(n, 10) - 1]
      return arg != null ? resolveLocale(arg, '', localeMap) : `__${n}__`
    })
  }

  return fallback
}

// ---------------------------------------------------------------------------
// Icon resolution
// ---------------------------------------------------------------------------

const MOD_PATH_RE = /^__([^_]+(?:_[^_]+)*)__\/(.+)$/

/**
 * Build an async icon resolver function.
 *
 * For prototypes with a proto.icons[] array, all layers are composited into a
 * single PNG using compositeIconLayers().  For proto.icon (single path), the
 * source file is copied as-is (fast path, no sharp involved).
 *
 * Returns the public URL string (e.g. "/data/nullius/icons/iron-plate.png")
 * or "" if the icon cannot be found.
 */
function makeIconResolver(resolvers, iconsOut) {
  mkdirSync(iconsOut, { recursive: true })

  // Map from output filename -> already written (deduplicate).
  const written = new Set()

  const publicUrl = '/' + iconsOut.replace(/^public\//, '')

  return async function resolveIcon(proto, id) {
    // --- Multi-layer path ---
    if (Array.isArray(proto.icons) && proto.icons.length > 0) {
      const outName = id + '.png'
      const outPath = join(iconsOut, outName)
      if (!written.has(outName)) {
        const outputSize = proto.icon_size ?? 64
        const raw = await compositeIconLayers(proto.icons, resolvers, outputSize)
        if (!raw) return ''
        const buf = await normalizeIcon(raw, outputSize)
        writeFileSync(outPath, buf)
        written.add(outName)
      }
      return `${publicUrl}/${outName}`
    }

    // --- Single-icon fallback: wrap as a one-layer composite so the sprite-sheet
    //     crop (extract to icon_size × icon_size) is applied consistently. ---
    const iconPath = proto.icon
    if (!iconPath) return ''

    const iconSize = proto.icon_size ?? 64
    const outName  = id + '.png'
    const outPath  = join(iconsOut, outName)

    if (!written.has(outName)) {
      const raw = await compositeIconLayers(
        [{ icon: iconPath, icon_size: iconSize, scale: 1 }],
        resolvers,
        iconSize,
      )
      if (!raw) return ''
      const buf = await normalizeIcon(raw, iconSize)
      writeFileSync(outPath, buf)
      written.add(outName)
    }

    return `${publicUrl}/${outName}`
  }
}

// ---------------------------------------------------------------------------
// Energy parsing — mirrors the Lua parse_energy_kw helper
// ---------------------------------------------------------------------------

function parseEnergyKw(s) {
  if (s == null) return 0
  if (typeof s === 'number') return s / 1000
  if (typeof s !== 'string' || s === '') return 0
  const m = s.match(/^([\d.]+)\s*([kKmMgGtT]?[wW])/)
  if (!m) return 0
  const num = parseFloat(m[1])
  const u   = m[2].toUpperCase()
  if (u === 'KW') return num
  if (u === 'MW') return num * 1000
  if (u === 'GW') return num * 1_000_000
  if (u === 'TW') return num * 1_000_000_000
  return num / 1000 // plain W
}

// ---------------------------------------------------------------------------
// Energy type inference
// ---------------------------------------------------------------------------

function inferEnergyType(proto) {
  const t = proto.energy_source?.type
  if (t === 'electric') return 'electric'
  if (t === 'burner')   return 'burner'
  if (t === 'heat')     return 'heat'
  return 'void'
}

// ---------------------------------------------------------------------------
// Ingredient / product normalisation
// ---------------------------------------------------------------------------

/**
 * Factorio 2.0 always uses the table form [{type, name, amount}].
 * Handle old [name, amount] shorthand just in case.
 */
function normaliseIngredient(ing) {
  if (Array.isArray(ing)) {
    // Old shorthand: [name, amount]
    return { itemId: ing[0], type: 'item', amount: ing[1] }
  }
  return {
    itemId:              ing.name,
    type:                ing.type ?? 'item',
    amount:              ing.amount,
    minimumTemperature:  ing.minimum_temperature,
    maximumTemperature:  ing.maximum_temperature,
  }
}

function normaliseProduct(prod) {
  if (Array.isArray(prod)) {
    return { itemId: prod[0], type: 'item', amount: prod[1], probability: 1 }
  }
  return {
    itemId:                prod.name,
    type:                  prod.type ?? 'item',
    amount:                prod.amount ?? prod.amount_max ?? 0,
    probability:           prod.probability,
    amountMin:             prod.amount_min,
    amountMax:             prod.amount_max,
    ignoredByProductivity: prod.ignored_by_productivity,
  }
}

/**
 * Build the products array from a recipe prototype.
 * Handles both new-style `results` and old-style `result` / `result_count`.
 */
function extractProducts(proto) {
  if (proto.results) {
    return Object.values(proto.results).map(normaliseProduct)
  }
  if (proto.result) {
    return [{
      itemId:      proto.result,
      type:        'item',
      amount:      proto.result_count ?? 1,
      probability: 1,
    }]
  }
  return []
}

// ---------------------------------------------------------------------------
// main_product resolution
// ---------------------------------------------------------------------------

function resolveMainProduct(proto, products) {
  const mp = proto.main_product
  if (mp === '') return ''          // explicit multi-output → loader normalises to null
  if (typeof mp === 'string' && mp !== '') return mp
  // main_product absent: infer from products (matches runtime Lua behaviour)
  if (mp == null && products.length === 1) return products[0].itemId
  return undefined   // omit field for true multi-output with no declared primary
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const ITEM_SUBTYPES = [
  'item', 'tool', 'armor', 'ammo', 'capsule', 'gun', 'item-with-entity-data',
  'item-with-label', 'item-with-inventory', 'blueprint-book', 'item-with-tags',
  'selection-tool', 'blueprint', 'copy-paste-tool', 'deconstruction-item',
  'upgrade-item', 'module', 'rail-planner', 'space-platform-starter-pack',
  'space-connection-distance-traveled-trigger-item', 'repair-tool',
  'spidertron-remote',
]

async function exportItems(raw, localeMap, resolveIcon) {
  const items = {}

  for (const subtype of ITEM_SUBTYPES) {
    const table = raw[subtype]
    if (!table) continue
    for (const proto of Object.values(table)) {
      items[proto.name] = {
        id:        proto.name,
        name:      resolveLocale(proto.localised_name, proto.name, localeMap, 'item-name', 'entity-name'),
        type:      'item',
        iconPath:  await resolveIcon(proto, proto.name),
        hidden:    proto.hidden ?? false,
        stackSize: proto.stack_size,
        subgroup:  proto.subgroup ?? '',
        order:     proto.order ?? '',
      }
    }
  }

  for (const proto of Object.values(raw.fluid ?? {})) {
    items[proto.name] = {
      id:       proto.name,
      name:     resolveLocale(proto.localised_name, proto.name, localeMap, 'fluid-name'),
      type:     'fluid',
      iconPath: await resolveIcon(proto, proto.name),
      hidden:   proto.hidden ?? false,
      subgroup: proto.subgroup ?? '',
      order:    proto.order ?? '',
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// Item groups & subgroups
// ---------------------------------------------------------------------------

async function exportItemGroups(raw, localeMap, resolveIcon) {
  const groups = {}
  for (const proto of Object.values(raw['item-group'] ?? {})) {
    groups[proto.name] = {
      id:       proto.name,
      name:     resolveLocale(proto.localised_name, proto.name, localeMap, 'item-group-name'),
      order:    proto.order ?? '',
      iconPath: await resolveIcon(proto, `group-${proto.name}`),
    }
  }
  return groups
}

function exportItemSubgroups(raw) {
  const subgroups = {}
  for (const proto of Object.values(raw['item-subgroup'] ?? {})) {
    subgroups[proto.name] = {
      id:    proto.name,
      group: proto.group ?? '',
      order: proto.order ?? '',
    }
  }
  return subgroups
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

const MACHINE_TYPES = ['assembling-machine', 'furnace', 'rocket-silo']

async function exportMachines(raw, localeMap, resolveIcon) {
  const machines = {}

  for (const machineType of MACHINE_TYPES) {
    const table = raw[machineType]
    if (!table) continue
    for (const proto of Object.values(table)) {
      const drain = proto.energy_source?.drain

      // In data.raw, allowed_effects and crafting_categories are plain arrays.
      const allowedEffects     = (proto.allowed_effects ?? []).slice().sort()
      const craftingCategories = (proto.crafting_categories ?? []).slice().sort()

      machines[proto.name] = {
        id:                proto.name,
        name:              resolveLocale(proto.localised_name, proto.name, localeMap, 'entity-name'),
        type:              machineType,
        craftingSpeed:     proto.crafting_speed ?? 1,
        energyUsageKw:     parseEnergyKw(proto.energy_usage),
        energyType:        inferEnergyType(proto),
        drainKw:           parseEnergyKw(drain),
        moduleSlots:       proto.module_slots ?? 0,
        allowedEffects,
        craftingCategories,
        iconPath:          await resolveIcon(proto, proto.name),
        hidden:            proto.hidden ?? false,
      }
    }
  }

  return machines
}

// ---------------------------------------------------------------------------
// Category map: category -> [machine ids]
// ---------------------------------------------------------------------------

function buildCategoryMap(machines) {
  const map = {}
  for (const [machineId, machine] of Object.entries(machines)) {
    for (const cat of machine.craftingCategories) {
      if (!map[cat]) map[cat] = []
      map[cat].push(machineId)
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

function exportRecipes(raw, localeMap, categoryMap) {
  const recipes = {}

  // Helper: resolve a recipe's subgroup, falling back to the main product's
  // subgroup (mirrors Factorio's runtime behaviour). Walks all item subtypes
  // plus fluid since main_product can refer to either.
  const lookupItemSubgroup = (id) => {
    if (!id) return ''
    for (const subtype of ITEM_SUBTYPES) {
      const proto = raw[subtype]?.[id]
      if (proto) return proto.subgroup ?? ''
    }
    return raw.fluid?.[id]?.subgroup ?? ''
  }

  for (const proto of Object.values(raw.recipe ?? {})) {
    if (proto.parameter) continue

    const ingredients = Object.values(proto.ingredients ?? {}).map(normaliseIngredient)
    const products    = extractProducts(proto)
    const category    = proto.category ?? 'crafting'
    const madeIn      = (categoryMap[category] ?? []).slice().sort()

    // In data.raw, allow_productivity is a direct boolean on the recipe.
    const allowProductivity = proto.allow_productivity ?? false

    const mainProduct = resolveMainProduct(proto, products)

    let subgroup = proto.subgroup ?? ''
    if (!subgroup) {
      const fallbackId = (typeof mainProduct === 'string' && mainProduct !== '')
        ? mainProduct
        : (products.length === 1 ? products[0].itemId : '')
      subgroup = lookupItemSubgroup(fallbackId)
    }

    // Replicate Factorio's recipe name resolution:
    // 1. explicit localised_name, 2. recipe-name locale key, 3. main product name
    let recipeName = resolveLocale(proto.localised_name, proto.name, localeMap, 'recipe-name')
    if (recipeName === proto.name) {
      const mpId = typeof mainProduct === 'string' && mainProduct !== '' ? mainProduct : null
      if (mpId) {
        recipeName = resolveLocale(null, mpId, localeMap, 'item-name', 'entity-name', 'fluid-name')
      }
    }

    const entry = {
      id:               proto.name,
      name:             recipeName,
      category,
      craftingTime:     proto.energy_required ?? 0.5,
      ingredients,
      products,
      madeIn,
      allowProductivity,
      hidden:           proto.hidden ?? false,
      subgroup,
      order:            proto.order ?? '',
    }
    if (mainProduct !== undefined) entry.mainProduct = mainProduct

    recipes[proto.name] = entry
  }

  return recipes
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

async function exportModules(raw, localeMap, resolveIcon) {
  const modules = {}

  for (const proto of Object.values(raw.module ?? {})) {
    const rawEffects = proto.effect ?? {}
    const effects = {}
    for (const [name, data] of Object.entries(rawEffects)) {
      effects[name] = typeof data === 'object' ? (data.bonus ?? 0) : data
    }

    modules[proto.name] = {
      id:                  proto.name,
      name:                resolveLocale(proto.localised_name, proto.name, localeMap, 'item-name'),
      category:            proto.category ?? 'unknown',
      tier:                proto.tier ?? 0,
      effects,
      limitation:          [],
      limitationBlacklist: [],
      iconPath:            await resolveIcon(proto, proto.name),
    }
  }

  return modules
}

// ---------------------------------------------------------------------------
// Beacons
// ---------------------------------------------------------------------------

const ALL_EFFECTS = ['consumption', 'pollution', 'productivity', 'quality', 'speed']

async function exportBeacons(raw, localeMap, resolveIcon) {
  const beacons = {}

  for (const proto of Object.values(raw.beacon ?? {})) {
    // allowed_effects: nil in Factorio means all effects are permitted.
    const allowedEffects = proto.allowed_effects
      ? proto.allowed_effects.slice().sort()
      : ALL_EFFECTS.slice()

    beacons[proto.name] = {
      id:                     proto.name,
      name:                   resolveLocale(proto.localised_name, proto.name, localeMap, 'entity-name'),
      iconPath:               await resolveIcon(proto, proto.name),
      hidden:                 proto.hidden ?? false,
      moduleSlots:            proto.module_slots ?? 0,
      distributionEfficiency: proto.distribution_effectivity ?? 0,
      allowedEffects,
    }
  }

  return beacons
}

// ---------------------------------------------------------------------------
// Default machines
// ---------------------------------------------------------------------------

function computeDefaultMachines(machines, categoryMap) {
  const defaults = {}
  for (const [cat, machineIds] of Object.entries(categoryMap)) {
    let bestId    = null
    let bestSpeed = -1
    for (const mid of machineIds) {
      const speed = machines[mid]?.craftingSpeed ?? 0
      if (speed > bestSpeed) {
        bestSpeed = speed
        bestId    = mid
      }
    }
    if (bestId) defaults[cat] = bestId
  }
  return defaults
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const dumpPath    = resolve(args.dump.replace(/^~/, HOME))
const factorioDir = resolve(args.factorioDir.replace(/^~/, HOME))
const modsDir     = resolve(args.modsDir.replace(/^~/, HOME))
const iconsOut    = resolve(args.iconsOut)
const outputPath  = resolve(args.output)

process.stderr.write(`[build-game-data] Loading dump: ${dumpPath}\n`)
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
const raw  = dump  // --dump-data produces data.raw at the top level

process.stderr.write(`[build-game-data] Building mod resolvers...\n`)
const resolvers = buildResolverMap(factorioDir, modsDir)
process.stderr.write(`[build-game-data] Loaded ${Object.keys(resolvers).length} mod resolvers\n`)

process.stderr.write(`[build-game-data] Parsing locale files...\n`)
const localeMap = buildLocaleMap(resolvers)
process.stderr.write(`[build-game-data] Locale entries: ${Object.keys(localeMap).length}\n`)

const resolveIcon = makeIconResolver(resolvers, iconsOut)

process.stderr.write(`[build-game-data] Exporting machines...\n`)
const machines = await exportMachines(raw, localeMap, resolveIcon)

const categoryMap = buildCategoryMap(machines)

process.stderr.write(`[build-game-data] Exporting items...\n`)
const items = await exportItems(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting recipes...\n`)
const recipes = exportRecipes(raw, localeMap, categoryMap)

process.stderr.write(`[build-game-data] Exporting modules...\n`)
const modules = await exportModules(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting beacons...\n`)
const beacons = await exportBeacons(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting item groups...\n`)
const itemGroups    = await exportItemGroups(raw, localeMap, resolveIcon)
const itemSubgroups = exportItemSubgroups(raw)

const defaultMachines = computeDefaultMachines(machines, categoryMap)

// Build modSet from mod-list.json (lists enabled mods) + info.json versions (from resolvers).
// The base game version is not present in mod-list.json, so we fetch it by running the binary.

// 1. Read the list of enabled mods from mod-list.json.
const modListPath = join(modsDir, 'mod-list.json')
let enabledModNames = null
if (existsSync(modListPath)) {
  try {
    const modList = JSON.parse(readFileSync(modListPath, 'utf8'))
    enabledModNames = new Set(
      (modList.mods ?? []).filter(m => m.enabled !== false).map(m => m.name)
    )
  } catch {
    process.stderr.write(`[warn] Could not parse mod-list.json — including all mods\n`)
  }
}

// 2. For each (enabled) mod, read its version from info.json via the resolver.
const modSet = {}
for (const [modName, resolver] of Object.entries(resolvers)) {
  if (enabledModNames && !enabledModNames.has(modName)) continue
  const buf = resolver.readFile('info.json')
  if (!buf) continue
  try {
    const info = JSON.parse(buf.toString('utf8'))
    if (typeof info.version === 'string') modSet[modName] = info.version
  } catch {}
}

// 3. Get the base game version from the factorio binary (most reliable source).
//    mod-list.json doesn't list base, and built-in mods are not in modsDir.
let factorioVersion = modSet['base'] ?? '?'
const factorioBin = join(factorioDir, 'MacOS', 'factorio')
if (existsSync(factorioBin)) {
  try {
    const versionOutput = execSync(`"${factorioBin}" --version 2>&1`, { encoding: 'utf8', timeout: 10000 })
    const match = versionOutput.match(/Version:\s*(\d+\.\d+\.\d+)/)
    if (match) {
      factorioVersion = match[1]
      modSet['base'] = factorioVersion
    }
  } catch {
    process.stderr.write(`[warn] Could not run factorio binary to determine version; using info.json value\n`)
  }
}

const output = {
  factorioVersion,
  modSet,
  items,
  recipes,
  machines,
  modules,
  beacons,
  defaultMachines,
  itemGroups,
  itemSubgroups,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2))

const count = o => Object.keys(o).length
process.stderr.write(
  `[build-game-data] Done — factorioVersion=${factorioVersion} ` +
  `items=${count(items)} recipes=${count(recipes)} ` +
  `machines=${count(machines)} modules=${count(modules)} beacons=${count(beacons)} ` +
  `itemGroups=${count(itemGroups)} itemSubgroups=${count(itemSubgroups)}\n` +
  `[build-game-data] Output: ${outputPath}\n`
)
