import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { iconColor } from '../icon-color.js'

// Regression guard: committed bundles carry an `iconColor` for every item with an
// icon, and it matches the icon on disk. The `--patch-*` modes of the build script
// rewrite items without it: re-run scripts/patch-icon-colors.mjs after them.
const DATA_DIR = join(import.meta.dirname, '../../public/data')

describe('bundled icon colours', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  for (const dir of bundles) {
    const items = Object.values(JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8')).items)
    const iconFile = item => join(DATA_DIR, dir, 'icons', basename(item.iconPath))
    const withIcon = items.filter(i => i.iconPath && existsSync(iconFile(i)))

    // An icon with no opaque pixel (nullius-yellowcake) has no colour.
    it(`${dir} has an iconColor on every item whose icon exists`, async () => {
      const bad = []
      for (const i of withIcon) {
        if (/^#[0-9a-f]{6}$/.test(i.iconColor ?? '')) continue
        if (await iconColor(readFileSync(iconFile(i))) !== undefined) bad.push(i)
      }
      expect(bad.slice(0, 5).map(i => i.id), 'items without a valid iconColor').toEqual([])
    })

    it(`${dir} iconColors match the icons`, async () => {
      for (const item of [...withIcon].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20)) {
        expect(item.iconColor, item.id).toBe(await iconColor(readFileSync(iconFile(item))))
      }
    })
  }
})
