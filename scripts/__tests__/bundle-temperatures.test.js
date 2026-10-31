import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the exported fluid and product temperatures. The Nullius
// bundle lacks them until it is re-dumped (see the backlog), so only the
// invariants that hold either way are asserted for it.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))

describe('bundled temperatures', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} only carries temperatures where they belong`, () => {
      const bundle = load(dir)
      for (const item of Object.values(bundle.items)) {
        const hasD = 'defaultTemperature' in item
        const hasM = 'maxTemperature' in item
        if (item.type !== 'fluid') {
          expect(hasD || hasM, `${item.id} is not a fluid`).toBe(false)
          continue
        }
        expect(hasD, `${item.id} pair`).toBe(hasM)
        if (hasD) expect(item.maxTemperature, `${item.id} max`).toBeGreaterThanOrEqual(item.defaultTemperature)
      }
      for (const recipe of Object.values(bundle.recipes)) {
        for (const p of recipe.products) {
          if (!('temperature' in p)) continue
          expect(p.type, `${recipe.id} product ${p.itemId}`).toBe('fluid')
          const fluid = bundle.items[p.itemId]
          if (fluid?.defaultTemperature !== undefined) {
            expect(p.temperature, `${recipe.id} product ${p.itemId}`).toBeGreaterThanOrEqual(fluid.defaultTemperature)
            expect(p.temperature, `${recipe.id} product ${p.itemId}`).toBeLessThanOrEqual(fluid.maxTemperature)
          }
        }
      }
    })
  }

  it('kompetenz-seablock has the exported temperatures', () => {
    const bundle = load('kompetenz-seablock')
    expect(bundle.items.steam).toMatchObject({ defaultTemperature: 15, maxTemperature: 5000 })
    expect(bundle.items.water.defaultTemperature).toBeDefined()
    const fluids = Object.values(bundle.items).filter(i => i.type === 'fluid' && i.id !== 'power:electricity')
    expect(fluids.length).toBe(211)
    for (const f of fluids) {
      expect(f.defaultTemperature, `${f.id} default`).toEqual(expect.any(Number))
      expect(f.maxTemperature, `${f.id} max`).toEqual(expect.any(Number))
    }
    expect(bundle.items['power:electricity']).not.toHaveProperty('defaultTemperature')
    expect(bundle.items['power:electricity']).not.toHaveProperty('maxTemperature')

    const withTemp = Object.values(bundle.recipes).flatMap(r => r.products.filter(p => 'temperature' in p))
    expect(withTemp.length).toBeGreaterThanOrEqual(40)
    expect(withTemp.length).toBeLessThan(80)
    const steamOf = id => bundle.recipes[id].products.find(p => p.itemId === 'steam')
    expect(steamOf('angels-steam-water').temperature).toBe(165)
    expect(steamOf('bob-sodium-hydroxide-sink').temperature).toBe(465)

    for (const r of Object.values(bundle.recipes)) {
      if (!r.extraction && !r.power) continue
      for (const p of r.products) expect(p, `${r.id} ${p.itemId}`).not.toHaveProperty('temperature')
    }
  })
})
