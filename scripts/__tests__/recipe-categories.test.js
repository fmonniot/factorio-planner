import { describe, it, expect } from 'vitest'
import { additionalCategories, recipeMadeIn, attachAdditionalCategories } from '../recipe-categories.js'

describe('additionalCategories', () => {
  it('drops the primary category', () => {
    expect(additionalCategories({ category: 'crafting', additional_categories: ['electronics', 'crafting'] })).toEqual(['electronics'])
    expect(additionalCategories({ category: 'advanced-crafting', additional_categories: ['electronics', 'crafting'] }))
      .toEqual(['crafting', 'electronics'])
  })
  it('treats a missing category as crafting', () => {
    expect(additionalCategories({ additional_categories: ['crafting', 'electronics'] })).toEqual(['electronics'])
  })
  it('is undefined when there is nothing', () => {
    for (const proto of [{}, { additional_categories: [] }, { additional_categories: {} }, { additional_categories: null }, undefined]) {
      expect(additionalCategories(proto)).toBeUndefined()
    }
  })
  it('dedupes and sorts', () => {
    expect(additionalCategories({ category: 'crafting', additional_categories: ['b', 'a', 'a'] })).toEqual(['a', 'b'])
  })
})

describe('recipeMadeIn', () => {
  const map = { crafting: ['asm'], electronics: ['elec', 'asm'] }
  it('is the sorted union over the categories', () => {
    expect(recipeMadeIn(map, 'crafting', ['electronics'])).toEqual(['asm', 'elec'])
  })
  it('equals the primary list, sorted, without additional categories', () => {
    expect(recipeMadeIn(map, 'electronics')).toEqual(['elec', 'asm'].slice().sort())
    expect(recipeMadeIn(map, 'unknown')).toEqual([])
  })
})

describe('attachAdditionalCategories', () => {
  const map = { crafting: ['asm'], electronics: ['elec'] }
  const recipe = (extra = {}) => ({ id: 'r', category: 'crafting', madeIn: ['asm'], allowProductivity: false, ...extra })

  it('adds the field and extends madeIn', () => {
    const out = attachAdditionalCategories({ r: recipe() }, { r: { category: 'crafting', additional_categories: ['electronics'] } }, map)
    expect(out.recipes.r).toEqual(recipe({ madeIn: ['asm', 'elec'], additionalCategories: ['electronics'] }))
    expect(out.count).toBe(1)
    expect(out.checked).toBe(1)
  })
  it('keeps the reference of a recipe without additional categories', () => {
    const r = recipe()
    const out = attachAdditionalCategories({ r }, { r: { category: 'crafting' } }, map)
    expect(out.recipes.r).toBe(r)
    expect(out.count).toBe(0)
  })
  it('is idempotent', () => {
    const raw = { r: { category: 'crafting', additional_categories: ['electronics'] } }
    const once = attachAdditionalCategories({ r: recipe() }, raw, map)
    const twice = attachAdditionalCategories(once.recipes, raw, map)
    expect(twice.recipes).toEqual(once.recipes)
    expect(twice.recipes.r).toBe(once.recipes.r)
  })
  it('removes a stale field and shrinks madeIn', () => {
    const stale = recipe({ madeIn: ['asm', 'elec'], additionalCategories: ['electronics'] })
    const out = attachAdditionalCategories({ r: stale }, { r: { category: 'crafting' } }, map)
    expect(out.recipes.r).toEqual(recipe())
    expect(out.recipes.r).not.toHaveProperty('additionalCategories')
  })
  it('leaves extraction and power recipes alone and uncounted', () => {
    const ext = recipe({ extraction: true })
    const pow = recipe({ power: true })
    const out = attachAdditionalCategories({ ext, pow }, {}, map)
    expect(out.recipes.ext).toBe(ext)
    expect(out.recipes.pow).toBe(pow)
    expect(out.checked).toBe(0)
    expect(out.missing).toEqual([])
  })
  it('lists a recipe missing from the dump and leaves it unchanged', () => {
    const r = recipe()
    const out = attachAdditionalCategories({ r }, {}, map)
    expect(out.missing).toEqual(['r'])
    expect(out.recipes.r).toBe(r)
  })
})
