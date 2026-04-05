#!/usr/bin/env node
/**
 * verify-game-data.js
 *
 * Compares a newly generated game-data.json against a reference backup.
 * REPORT ONLY — never modifies files. Any mismatch requires user approval
 * before corrections are made to build-game-data.js.
 *
 * Usage:
 *   node scripts/verify-game-data.js \
 *     --reference data/samples/nullius/game-data.json.backup \
 *     --actual    data/samples/nullius/game-data.json
 *
 * Exits 0 if no structural issues are found, non-zero otherwise.
 * "Structural issues" = missing/extra ids or entries with changed non-icon/name fields.
 * Improved iconPath and name values are reported but not treated as failures.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reference') args.reference = argv[++i]
    else if (argv[i] === '--actual') args.actual = argv[++i]
  }
  if (!args.reference || !args.actual) {
    process.stderr.write(
      'Usage: node scripts/verify-game-data.js --reference <path> --actual <path>\n'
    )
    process.exit(1)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const refPath = resolve(args.reference.replace(/^~/, HOME))
const actPath = resolve(args.actual.replace(/^~/, HOME))

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

process.stderr.write(`Loading reference: ${refPath}\n`)
const ref = JSON.parse(readFileSync(refPath, 'utf8'))

process.stderr.write(`Loading actual:    ${actPath}\n`)
const act = JSON.parse(readFileSync(actPath, 'utf8'))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let failures = 0
let warnings = 0

function fail(msg) {
  console.log(`[FAIL] ${msg}`)
  failures++
}

function warn(msg) {
  console.log(`[WARN] ${msg}`)
  warnings++
}

function info(msg) {
  console.log(`[INFO] ${msg}`)
}

/**
 * Compare two records (items / recipes / machines / modules).
 * Fields in `improvedFields` are expected to change (icon, name) — differences
 * there are logged as INFO, not failures.
 */
function compareSection(sectionName, refSection, actSection, improvedFields = ['iconPath', 'name']) {
  const refIds = new Set(Object.keys(refSection))
  const actIds = new Set(Object.keys(actSection))

  const missing = [...refIds].filter(id => !actIds.has(id))
  const extra   = [...actIds].filter(id => !refIds.has(id))

  if (missing.length > 0) {
    fail(`${sectionName}: ${missing.length} id(s) missing from actual:`)
    for (const id of missing.slice(0, 20)) console.log(`         - ${id}`)
    if (missing.length > 20) console.log(`         ... and ${missing.length - 20} more`)
  }

  if (extra.length > 0) {
    fail(`${sectionName}: ${extra.length} extra id(s) in actual not in reference:`)
    for (const id of extra.slice(0, 20)) console.log(`         + ${id}`)
    if (extra.length > 20) console.log(`         ... and ${extra.length - 20} more`)
  }

  // Per-entry field comparison for shared ids.
  const shared = [...refIds].filter(id => actIds.has(id))
  const structDiffs = []
  const improvementDiffs = []

  for (const id of shared) {
    const r = refSection[id]
    const a = actSection[id]

    for (const key of new Set([...Object.keys(r), ...Object.keys(a)])) {
      const rv = JSON.stringify(r[key] ?? null)
      const av = JSON.stringify(a[key] ?? null)
      if (rv === av) continue

      if (improvedFields.includes(key)) {
        improvementDiffs.push({ id, key, ref: r[key], act: a[key] })
      } else {
        structDiffs.push({ id, key, ref: r[key], act: a[key] })
      }
    }
  }

  if (structDiffs.length > 0) {
    fail(`${sectionName}: ${structDiffs.length} structural field difference(s):`)
    for (const d of structDiffs.slice(0, 30)) {
      console.log(`         ${d.id}.${d.key}: ${JSON.stringify(d.ref)} → ${JSON.stringify(d.act)}`)
    }
    if (structDiffs.length > 30) console.log(`         ... and ${structDiffs.length - 30} more`)
  }

  // Count improvements.
  const iconImproved = improvementDiffs.filter(d => d.key === 'iconPath' && d.ref === '' && d.act !== '').length
  const nameImproved = improvementDiffs.filter(d => d.key === 'name' && d.ref === d.id && d.act !== d.id).length
  const iconRegressed = improvementDiffs.filter(d => d.key === 'iconPath' && d.ref !== '' && d.act === '').length
  const otherDiffs    = improvementDiffs.filter(d => !['iconPath', 'name'].includes(d.key))

  const total = Object.keys(refSection).length

  if (iconImproved > 0)  info(`${sectionName}: ${iconImproved}/${total} entries gained iconPath`)
  if (nameImproved > 0)  info(`${sectionName}: ${nameImproved}/${total} entries gained localised name`)
  if (iconRegressed > 0) warn(`${sectionName}: ${iconRegressed} entries lost iconPath`)
  if (otherDiffs.length > 0) {
    warn(`${sectionName}: ${otherDiffs.length} unexpected diff(s) in tracked fields:`)
    for (const d of otherDiffs.slice(0, 10)) {
      console.log(`         ${d.id}.${d.key}: ${JSON.stringify(d.ref)} → ${JSON.stringify(d.act)}`)
    }
  }

  info(`${sectionName}: ref=${refIds.size} act=${actIds.size} shared=${shared.length} missing=${missing.length} extra=${extra.length}`)
}

// ---------------------------------------------------------------------------
// Run comparisons
// ---------------------------------------------------------------------------

console.log('\n=== factorioVersion ===')
if (ref.factorioVersion !== act.factorioVersion) {
  warn(`factorioVersion: ${ref.factorioVersion} → ${act.factorioVersion}`)
} else {
  info(`factorioVersion: ${act.factorioVersion}`)
}

console.log('\n=== items ===')
compareSection('items', ref.items ?? {}, act.items ?? {})

console.log('\n=== recipes ===')
compareSection('recipes', ref.recipes ?? {}, act.recipes ?? {})

console.log('\n=== machines ===')
compareSection('machines', ref.machines ?? {}, act.machines ?? {})

console.log('\n=== modules ===')
compareSection('modules', ref.modules ?? {}, act.modules ?? {})

console.log('\n=== defaultMachines ===')
{
  const refDM = ref.defaultMachines ?? {}
  const actDM = act.defaultMachines ?? {}
  const allCats = new Set([...Object.keys(refDM), ...Object.keys(actDM)])
  let dmFails = 0
  for (const cat of allCats) {
    if (refDM[cat] !== actDM[cat]) {
      fail(`defaultMachines[${cat}]: ${refDM[cat]} → ${actDM[cat]}`)
      dmFails++
    }
  }
  if (dmFails === 0) info(`defaultMachines: all ${allCats.size} categories match`)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== Summary ===')
console.log(`Failures: ${failures}`)
console.log(`Warnings: ${warnings}`)

if (failures > 0) {
  console.log('\nStructural mismatches found. Review above and get user approval before modifying build-game-data.js.')
  process.exit(1)
} else if (warnings > 0) {
  console.log('\nNo structural failures. Warnings above are non-blocking.')
  process.exit(0)
} else {
  console.log('\nAll checks passed.')
  process.exit(0)
}
