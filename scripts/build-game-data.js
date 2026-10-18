#!/usr/bin/env node
/**
 * build-game-data.js
 *
 * Converts a `factorio --dump-data` JSON dump into the game-data.json bundle
 * consumed by the factorio-planner web app.
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
 * Patch mode: add only the technology data (including research cost) to an
 * existing bundle, leaving everything else untouched. Technology icons are
 * written to icons/technology/ next to the bundle (or under --icons-out when
 * given). Requires the dump to come from
 * the same mod set as the bundle (checked, ignoring `base`):
 *   node scripts/build-game-data.js --patch-technologies \
 *     --dump ... --factorio-dir ... --mods-dir ... \
 *     --output public/data/kompetenz-seablock/game-data.json
 * It also sets `placeResult` on the items that place a machine or beacon of the
 * bundle (the research horizon uses it to gate machines and beacons).
 *
 * Names patch mode: recompute only the `name` fields of an existing bundle
 * (locale placeholders such as `__ITEM__x__` are expanded). Same mod-set check:
 *   node scripts/build-game-data.js --patch-names \
 *     --dump ... --factorio-dir ... --mods-dir ... \
 *     --output public/data/kompetenz-seablock/game-data.json
 *
 * Extraction patch mode: add the mining and offshore-pump recipes and the
 * drills and pumps that run them to an existing bundle (same mod-set check).
 * Safe to re-run. It also refreshes `placeResult` on the items (so drills and
 * pumps are gated by the research horizon) and the default machines of the
 * generated categories:
 *   node scripts/build-game-data.js --patch-extraction \
 *     --dump ... --factorio-dir ... --mods-dir ... \
 *     --output public/data/kompetenz-seablock/game-data.json
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
import sharp from 'sharp'
import { compositeIconLayers, iconCanvasSize, normalizeIcon } from './icon-compositor.js'
import { exportTechnologies, attachTechnologyIcons } from './technologies.js'
import { attachPlaceResults } from './place-results.js'
import { parseEnergyKw, inferEnergyType } from './energy.js'
import { ALL_EFFECTS, exportExtraction, isExtractionCategory } from './extraction.js'
import { buildLocaleMap, resolveLocale, resolveTechnologyName, resolveRecipeName, RESIDUE_RE } from './locale.js'

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
    else if (argv[i] === '--icons-out')   { args.iconsOut = argv[++i]; args.iconsOutGiven = true }
    else if (argv[i] === '--output')      args.output      = argv[++i]
    else if (argv[i] === '--patch-technologies') args.patchTechnologies = true
    else if (argv[i] === '--patch-names') args.patchNames = true
    else if (argv[i] === '--patch-extraction') args.patchExtraction = true
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
 * Icons larger than maxSize px are downscaled to maxSize after compositing.
 *
 * Returns the public URL string (e.g. "/data/nullius/icons/iron-plate.png")
 * or "" if the icon cannot be found.
 */
function makeIconResolver(resolvers, iconsOut, maxSize = Infinity) {
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
        const { outputSize, expectedSize } = iconCanvasSize(proto)
        const raw = await compositeIconLayers(proto.icons, resolvers, outputSize, expectedSize)
        if (!raw) return ''
        let buf = await normalizeIcon(raw, outputSize)
        if (outputSize > maxSize) buf = await sharp(buf).resize(maxSize, maxSize).png().toBuffer()
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
      let buf = await normalizeIcon(raw, iconSize)
      if (iconSize > maxSize) buf = await sharp(buf).resize(maxSize, maxSize).png().toBuffer()
      writeFileSync(outPath, buf)
      written.add(outName)
    }

    return `${publicUrl}/${outName}`
  }
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
  // main_product absent: a single-product recipe's product is its main product
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

const itemName    = (proto, localeMap) => resolveLocale(proto.localised_name, proto.name, localeMap, 'item-name', 'entity-name')
const fluidName   = (proto, localeMap) => resolveLocale(proto.localised_name, proto.name, localeMap, 'fluid-name')
const entityName  = (proto, localeMap) => resolveLocale(proto.localised_name, proto.name, localeMap, 'entity-name')
const moduleName  = (proto, localeMap) => resolveLocale(proto.localised_name, proto.name, localeMap, 'item-name')
const groupName   = (proto, localeMap) => resolveLocale(proto.localised_name, proto.name, localeMap, 'item-group-name')

async function exportItems(raw, localeMap, resolveIcon) {
  const items = {}

  for (const subtype of ITEM_SUBTYPES) {
    const table = raw[subtype]
    if (!table) continue
    for (const proto of Object.values(table)) {
      items[proto.name] = {
        id:        proto.name,
        name:      itemName(proto, localeMap),
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
      name:     fluidName(proto, localeMap),
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
      name:     groupName(proto, localeMap),
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
        name:              entityName(proto, localeMap),
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

    const entry = {
      id:               proto.name,
      name:             resolveRecipeName(proto, mainProduct, localeMap),
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
      name:                moduleName(proto, localeMap),
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

async function exportBeacons(raw, localeMap, resolveIcon) {
  const beacons = {}

  for (const proto of Object.values(raw.beacon ?? {})) {
    // allowed_effects: nil in Factorio means all effects are permitted.
    const allowedEffects = proto.allowed_effects
      ? proto.allowed_effects.slice().sort()
      : ALL_EFFECTS.slice()

    beacons[proto.name] = {
      id:                     proto.name,
      name:                   entityName(proto, localeMap),
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

/**
 * Build modSet from mod-list.json (lists enabled mods) + info.json versions (from resolvers).
 * The base game version is not present in mod-list.json, so we fetch it by running the binary.
 */
function computeModSet() {
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

  return { modSet, factorioVersion }
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

const { modSet, factorioVersion } = computeModSet()

/** Warn about ids of `added` that already exist in `target` (Object.assign would overwrite them). */
function warnCollisions(target, added) {
  for (const id of Object.keys(added)) {
    if (id in target) process.stderr.write(`[warn] extraction id collides with an existing entry and replaces it: ${id}\n`)
  }
}

/** Exit with the printed diff if the bundle's mod set differs from the dump's (ignoring `base`). */
function assertSameModSet(existing, modSet) {
  const diffs = []
  const oldSet = existing.modSet ?? {}
  for (const name of new Set([...Object.keys(oldSet), ...Object.keys(modSet)])) {
    if (name === 'base') continue
    if (oldSet[name] !== modSet[name]) {
      diffs.push(`  ${name}: bundle=${oldSet[name] ?? '(missing)'} dump=${modSet[name] ?? '(missing)'}`)
    }
  }
  if (diffs.length > 0) {
    process.stderr.write(`[build-game-data] Mod set mismatch between bundle and dump:\n${diffs.join('\n')}\n`)
    process.exit(1)
  }
}

/**
 * Recompute only the `name` of every entry in an existing bundle.
 * Entries missing from the dump keep their name.
 * @returns {{ bundle: object, changes: string[], changedWithoutPlaceholder: number, missing: number }}
 */
function patchNames(existing, raw, localeMap) {
  const changes = []
  let changedWithoutPlaceholder = 0
  let missing = 0

  const patchSection = (section, lookup) => {
    const out = {}
    for (const [id, entry] of Object.entries(existing[section] ?? {})) {
      if (entry.extraction) {
        out[id] = entry
        continue
      }
      const name = lookup(id, entry)
      if (name === undefined) {
        missing++
        out[id] = entry
        continue
      }
      if (name !== entry.name) {
        changes.push(`${section} ${id}: ${entry.name} -> ${name}`)
        if (!RESIDUE_RE.test(entry.name)) changedWithoutPlaceholder++
      }
      out[id] = { ...entry, name }
    }
    return out
  }

  const findItemProto = (id) => {
    for (const subtype of ITEM_SUBTYPES) {
      if (raw[subtype]?.[id]) return raw[subtype][id]
    }
    return undefined
  }

  const bundle = { ...existing }
  bundle.items = patchSection('items', (id, entry) => {
    if (entry.type === 'fluid') {
      const proto = raw.fluid?.[id]
      return proto && fluidName(proto, localeMap)
    }
    const proto = findItemProto(id)
    return proto && itemName(proto, localeMap)
  })
  bundle.machines = patchSection('machines', (id, entry) => {
    const proto = raw[entry.type]?.[id]
    return proto && entityName(proto, localeMap)
  })
  bundle.recipes = patchSection('recipes', (id) => {
    const proto = raw.recipe?.[id]
    if (!proto) return undefined
    const mainProduct = resolveMainProduct(proto, extractProducts(proto))
    return resolveRecipeName(proto, mainProduct, localeMap)
  })
  bundle.modules = patchSection('modules', (id) => {
    const proto = raw.module?.[id]
    return proto && moduleName(proto, localeMap)
  })
  bundle.beacons = patchSection('beacons', (id) => {
    const proto = raw.beacon?.[id]
    return proto && entityName(proto, localeMap)
  })
  bundle.itemGroups = patchSection('itemGroups', (id) => {
    const proto = raw['item-group']?.[id]
    return proto && groupName(proto, localeMap)
  })
  bundle.technologies = patchSection('technologies', (id) => {
    const proto = raw.technology?.[id]
    return proto && resolveTechnologyName(proto, localeMap)
  })

  return { bundle, changes, changedWithoutPlaceholder, missing }
}

if (args.patchNames) {
  const existing = JSON.parse(readFileSync(outputPath, 'utf8'))
  assertSameModSet(existing, modSet)
  const recipeIds = Object.keys(existing.recipes)
  const missingRecipes = recipeIds.filter(id => !raw.recipe?.[id]).length
  if (missingRecipes > recipeIds.length * 0.01) {
    process.stderr.write(
      `[build-game-data] ${missingRecipes}/${recipeIds.length} bundle recipes are missing from the dump; wrong dump?\n`
    )
    process.exit(1)
  }
  const { bundle, changes, changedWithoutPlaceholder, missing } = patchNames(existing, raw, localeMap)
  for (const line of changes) process.stderr.write(`${line}\n`)
  writeFileSync(outputPath, JSON.stringify(bundle, null, 2))
  process.stderr.write(
    `[build-game-data] Patched names in ${outputPath}: changed=${changes.length} ` +
    `changedWithoutPlaceholder=${changedWithoutPlaceholder} missingFromDump=${missing}\n`
  )
  process.exit(0)
}

if (args.patchExtraction) {
  const existing = JSON.parse(readFileSync(outputPath, 'utf8'))
  assertSameModSet(existing, modSet)
  const extraction = await exportExtraction(raw, {
    entityName: p => entityName(p, localeMap),
    fluidName: p => fluidName(p, localeMap),
    resolveIcon: makeIconResolver(resolvers, args.iconsOutGiven ? iconsOut : join(dirname(outputPath), 'icons')),
    itemSubtypes: ITEM_SUBTYPES,
  })
  // Drop what an earlier run generated, so re-running is safe.
  const recipes = Object.fromEntries(Object.entries(existing.recipes).filter(([, r]) => r.extraction !== true))
  const machines = Object.fromEntries(
    Object.entries(existing.machines).filter(([, m]) => m.type !== 'mining-drill' && m.type !== 'offshore-pump'),
  )
  warnCollisions(machines, extraction.machines)
  warnCollisions(recipes, extraction.recipes)
  Object.assign(machines, extraction.machines)
  Object.assign(recipes, extraction.recipes)
  const defaultMachines = Object.fromEntries(
    Object.entries(existing.defaultMachines).filter(([category]) => !isExtractionCategory(category)),
  )
  Object.assign(defaultMachines, computeDefaultMachines(machines, buildCategoryMap(extraction.machines)))
  const { items, count: placeResultCount } = attachPlaceResults(
    existing.items, raw, ITEM_SUBTYPES,
    new Set([...Object.keys(machines), ...Object.keys(existing.beacons ?? {})]),
  )
  writeFileSync(outputPath, JSON.stringify({ ...existing, items, recipes, machines, defaultMachines }, null, 2))
  process.stderr.write(
    `[build-game-data] Patched ${outputPath}: extractionRecipes=${Object.keys(extraction.recipes).length} ` +
    `extractionMachines=${Object.keys(extraction.machines).length} placeResults=${placeResultCount}\n`
  )
  process.exit(0)
}

if (args.patchTechnologies) {
  const existing = JSON.parse(readFileSync(outputPath, 'utf8'))
  assertSameModSet(existing, modSet)
  const recipeIds = new Set(Object.keys(existing.recipes))
  const missing = [...recipeIds].filter(id => !raw.recipe?.[id]).length
  if (missing > 0) process.stderr.write(`[warn] ${missing} bundle recipes are missing from the dump\n`)
  const exported = exportTechnologies(
    raw, recipeIds, p => resolveTechnologyName(p, localeMap),
  )
  const { startingRecipes } = exported
  const techIconsOut = args.iconsOutGiven
    ? join(iconsOut, 'technology')
    : join(dirname(outputPath), 'icons', 'technology')
  const technologies = await attachTechnologyIcons(
    exported.technologies, raw, makeIconResolver(resolvers, techIconsOut, 128),
  )
  const { items, count: placeResultCount } = attachPlaceResults(
    existing.items, raw, ITEM_SUBTYPES,
    new Set([...Object.keys(existing.machines), ...Object.keys(existing.beacons ?? {})]),
  )
  writeFileSync(outputPath, JSON.stringify({ ...existing, items, technologies, startingRecipes }, null, 2))
  process.stderr.write(
    `[build-game-data] Patched ${outputPath}: technologies=${Object.keys(technologies).length} ` +
    `technologyIcons=${Object.values(technologies).filter(t => t.iconPath).length} ` +
    `startingRecipes=${startingRecipes.length} placeResults=${placeResultCount}\n`
  )
  process.exit(0)
}

const resolveIcon = makeIconResolver(resolvers, iconsOut)

process.stderr.write(`[build-game-data] Exporting machines...\n`)
const machines = await exportMachines(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting extraction recipes and machines...\n`)
const extraction = await exportExtraction(raw, {
  entityName: p => entityName(p, localeMap),
  fluidName: p => fluidName(p, localeMap),
  resolveIcon,
  itemSubtypes: ITEM_SUBTYPES,
})
warnCollisions(machines, extraction.machines)
Object.assign(machines, extraction.machines)

const categoryMap = buildCategoryMap(machines)

process.stderr.write(`[build-game-data] Exporting items...\n`)
const items = await exportItems(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting recipes...\n`)
const recipes = exportRecipes(raw, localeMap, categoryMap)
warnCollisions(recipes, extraction.recipes)
Object.assign(recipes, extraction.recipes)

process.stderr.write(`[build-game-data] Exporting modules...\n`)
const modules = await exportModules(raw, localeMap, resolveIcon)

process.stderr.write(`[build-game-data] Exporting beacons...\n`)
const beacons = await exportBeacons(raw, localeMap, resolveIcon)

const placeable = new Set([...Object.keys(machines), ...Object.keys(beacons)])
const { items: placedItems, count: placeResultCount } = attachPlaceResults(items, raw, ITEM_SUBTYPES, placeable)

process.stderr.write(`[build-game-data] Exporting item groups...\n`)
const itemGroups    = await exportItemGroups(raw, localeMap, resolveIcon)
const itemSubgroups = exportItemSubgroups(raw)

const defaultMachines = computeDefaultMachines(machines, categoryMap)

const exportedTechnologies = exportTechnologies(
  raw, new Set(Object.keys(recipes)), p => resolveTechnologyName(p, localeMap),
)
const { startingRecipes } = exportedTechnologies
// Own folder: a technology can share its id with an item (automation-science-pack).
const technologies = await attachTechnologyIcons(
  exportedTechnologies.technologies, raw, makeIconResolver(resolvers, join(iconsOut, 'technology'), 128),
)

const output = {
  factorioVersion,
  modSet,
  items: placedItems,
  recipes,
  machines,
  modules,
  beacons,
  defaultMachines,
  itemGroups,
  itemSubgroups,
  technologies,
  startingRecipes,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2))

const count = o => Object.keys(o).length
process.stderr.write(
  `[build-game-data] Done — factorioVersion=${factorioVersion} ` +
  `items=${count(items)} recipes=${count(recipes)} ` +
  `machines=${count(machines)} modules=${count(modules)} beacons=${count(beacons)} ` +
  `itemGroups=${count(itemGroups)} itemSubgroups=${count(itemSubgroups)} ` +
  `technologies=${count(technologies)} startingRecipes=${startingRecipes.length} ` +
  `placeResults=${placeResultCount} ` +
  `extractionRecipes=${count(extraction.recipes)}\n` +
  `[build-game-data] Output: ${outputPath}\n`
)
