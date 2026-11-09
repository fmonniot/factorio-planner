// Adds `iconColor` to every item of a game-data bundle from its icon PNG.
// Usage: node scripts/patch-icon-colors.mjs <game-data.json> [--icons <dir>]
// <dir> defaults to the `icons` folder next to the bundle. Safe to re-run.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { addIconColors } from './icon-color.js'

const args = process.argv.slice(2)
const iconsAt = args.indexOf('--icons')
const iconsArg = iconsAt >= 0 ? args.splice(iconsAt, 2)[1] : undefined
const bundlePath = args[0]
if (!bundlePath || args.length !== 1 || (iconsAt >= 0 && !iconsArg)) {
  process.stderr.write('Usage: node scripts/patch-icon-colors.mjs <game-data.json> [--icons <dir>]\n')
  process.exit(1)
}

const file = resolve(bundlePath)
const iconsDir = iconsArg ? resolve(iconsArg) : join(dirname(file), 'icons')
const bundle = JSON.parse(readFileSync(file, 'utf8'))
const { set, skipped } = await addIconColors(bundle.items, iconsDir)
writeFileSync(file, JSON.stringify(bundle, null, 2))
process.stdout.write(`${file}: iconColor set on ${set} items, ${skipped} skipped (no icon file)\n`)
