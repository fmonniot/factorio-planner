import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the exported beacon power: the invariants are asserted for every bundle and the exact values
// for kompetenz-seablock, which was patched with `--patch-beacon-energy`. The Nullius bundle is not patched yet.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))
const KNOWN = new Set([
  'id', 'name', 'iconPath', 'hidden', 'moduleSlots', 'distributionEfficiency', 'allowedEffects', 'allowedModuleCategories',
  'energyUsageKw', 'drainKw',
])

describe('bundled beacon energy', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} beacons use known keys, and carry both power fields together as non-negative numbers`, () => {
      for (const b of Object.values(load(dir).beacons ?? {})) {
        for (const key of Object.keys(b)) expect(KNOWN.has(key), `${b.id}.${key}`).toBe(true)
        expect('energyUsageKw' in b, b.id).toBe('drainKw' in b)
        for (const key of ['energyUsageKw', 'drainKw']) {
          if (!(key in b)) continue
          expect(typeof b[key], `${b.id}.${key}`).toBe('number')
          expect(b[key], `${b.id}.${key}`).toBeGreaterThanOrEqual(0)
        }
      }
    })
  }

  it('kompetenz-seablock pins the electric beacons and leaves the void one without', () => {
    const { beacons } = load('kompetenz-seablock')
    expect(beacons.beacon).toMatchObject({ energyUsageKw: 480, drainKw: 0 })
    expect(beacons['bob-beacon-2']).toMatchObject({ energyUsageKw: 960, drainKw: 0 })
    expect(beacons['bob-beacon-3']).toMatchObject({ energyUsageKw: 1920, drainKw: 0 })
    expect(beacons['ee-super-beacon']).not.toHaveProperty('energyUsageKw')
    expect(beacons['ee-super-beacon']).not.toHaveProperty('drainKw')
  })
})
