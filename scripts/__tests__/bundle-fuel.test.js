import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the exported burner fuel data: the invariants are asserted for every bundle and the
// exact expectations for kompetenz-seablock, which was patched with `--patch-fuel`.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))

describe('bundled burner fuel', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} only carries fuel fields where they belong`, () => {
      const bundle = load(dir)
      for (const item of Object.values(bundle.items)) {
        const hasValue = 'fuelValueKj' in item
        if (item.type !== 'item') {
          expect(hasValue || 'fuelCategory' in item, `${item.id} is not an item`).toBe(false)
          continue
        }
        expect('fuelCategory' in item, `${item.id} pair`).toBe(hasValue)
        if (hasValue) expect(item.fuelValueKj, `${item.id} value`).toBeGreaterThan(0)
        if ('burntResult' in item) expect(hasValue, `${item.id} burnt result`).toBe(true)
      }
      for (const machine of Object.values(bundle.machines)) {
        if (machine.energyType !== 'burner') {
          expect(machine, machine.id).not.toHaveProperty('fuelCategories')
          expect(machine, machine.id).not.toHaveProperty('effectivity')
        }
        if ('fuelCategories' in machine) expect(machine.fuelCategories.length, machine.id).toBeGreaterThan(0)
      }
    })
  }

  it('kompetenz-seablock has fuel for every burner machine and boiler fuel', () => {
    const bundle = load('kompetenz-seablock')
    const burners = Object.values(bundle.machines).filter(m => m.energyType === 'burner')
    expect(burners.length).toBe(11)
    for (const m of burners) expect(m.fuelCategories, m.id).toEqual(expect.any(Array))
    expect(bundle.items['solid-fuel']).toMatchObject({ fuelValueKj: 12000, fuelCategory: 'chemical' })
    for (const r of Object.values(bundle.recipes)) {
      if (!r.id.startsWith('power:boiler:')) continue
      const fuel = r.ingredients.find(i => i.type === 'item')
      expect(bundle.items[fuel.itemId].fuelValueKj, r.id).toBeGreaterThan(0)
    }
  })
})
