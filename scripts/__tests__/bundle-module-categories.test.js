import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the exported module categories: the invariants are asserted for every bundle and the exact
// expectations for kompetenz-seablock, which was patched with `--patch-module-categories`.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))

describe('bundled module categories', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} only carries the field on entities with module slots, as sorted unique strings`, () => {
      const bundle = load(dir)
      for (const entity of [...Object.values(bundle.machines), ...Object.values(bundle.beacons ?? {})]) {
        if (!('allowedModuleCategories' in entity)) continue
        expect(entity.moduleSlots, entity.id).toBeGreaterThan(0)
        const list = entity.allowedModuleCategories
        expect(list.every(c => typeof c === 'string'), entity.id).toBe(true)
        expect(list, entity.id).toEqual([...new Set(list)].sort())
      }
    })
  }

  it('kompetenz-seablock lists categories on 144 machines, all rejecting angels-bio-yield', () => {
    const bundle = load('kompetenz-seablock')
    const listed = Object.values(bundle.machines).filter(m => 'allowedModuleCategories' in m)
    expect(listed.length).toBe(144)
    for (const m of listed) expect(m.allowedModuleCategories, m.id).not.toContain('angels-bio-yield')
  })

  it('kompetenz-seablock leaves the Angels bio machines and the beacons without a list', () => {
    const bundle = load('kompetenz-seablock')
    const bio = Object.values(bundle.machines).filter(m => m.moduleSlots > 0 && !('allowedModuleCategories' in m))
    expect(bio.length).toBe(12)
    for (const b of Object.values(bundle.beacons)) expect(b, b.id).not.toHaveProperty('allowedModuleCategories')
  })
})
