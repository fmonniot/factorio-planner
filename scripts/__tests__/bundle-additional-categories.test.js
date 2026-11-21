import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the recipes' additional crafting categories: the invariants are asserted for every bundle and
// the exact expectations for kompetenz-seablock, which was patched with `--patch-additional-categories`.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))

describe('bundled additional crafting categories', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  it('finds the bundles', () => {
    expect(bundles).toContain('kompetenz-seablock')
  })

  for (const dir of bundles) {
    it(`${dir} lists, for each recipe, the machines of its category and its additional categories`, () => {
      const bundle = load(dir)
      const machines = Object.values(bundle.machines)
      for (const recipe of Object.values(bundle.recipes)) {
        const extra = recipe.additionalCategories
        if (extra !== undefined) {
          expect(extra.length, `${recipe.id} not empty`).toBeGreaterThan(0)
          expect(extra, `${recipe.id} sorted and unique`).toEqual([...new Set(extra)].sort())
          expect(extra, `${recipe.id} primary`).not.toContain(recipe.category)
        }
        if (recipe.extraction || recipe.power) continue
        const cats = [recipe.category, ...(extra ?? [])]
        const expected = machines.filter(m => m.craftingCategories.some(c => cats.includes(c))).map(m => m.id).sort()
        expect(recipe.madeIn, `${recipe.id} madeIn`).toEqual(expected)
      }
    })
  }

  describe('kompetenz-seablock', () => {
    const bundle = load('kompetenz-seablock')
    const electronics = ['bob-electronics-machine-1', 'bob-electronics-machine-2', 'bob-electronics-machine-3']

    it('lets the electronics machines make the circuits', () => {
      // electronic-circuit is an advanced-crafting recipe, which also lists crafting.
      expect(bundle.recipes['bob-basic-circuit-board'].additionalCategories).toEqual(['electronics'])
      expect(bundle.recipes['electronic-circuit'].additionalCategories).toEqual(['crafting', 'electronics'])
      for (const id of ['bob-basic-circuit-board', 'electronic-circuit']) {
        expect(bundle.recipes[id].madeIn, id).toEqual(expect.arrayContaining([...electronics, 'bob-assembling-machine-6']))
      }
    })

    it('lets them make a fluid recipe with the electronics-with-fluid category', () => {
      const fluid = Object.values(bundle.recipes).find(
        r => r.category === 'crafting-with-fluid' && r.additionalCategories?.includes('electronics-with-fluid'),
      )
      expect(fluid).toBeDefined()
      expect(fluid.madeIn).toEqual(expect.arrayContaining(electronics))
    })

    it('has 108 recipes with additional categories', () => {
      expect(Object.values(bundle.recipes).filter(r => r.additionalCategories).length).toBe(108)
    })
  })
})
