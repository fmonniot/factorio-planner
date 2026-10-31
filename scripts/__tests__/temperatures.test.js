import { describe, it, expect } from 'vitest'
import {
  fluidTemperatures, productTemperature, attachFluidTemperatures, attachProductTemperatures,
} from '../temperatures.js'

describe('fluidTemperatures', () => {
  it('reads default and max', () => {
    expect(fluidTemperatures({ default_temperature: 15, max_temperature: 5000 }))
      .toEqual({ defaultTemperature: 15, maxTemperature: 5000 })
  })
  it('defaults max to default', () => {
    expect(fluidTemperatures({ default_temperature: 25 })).toEqual({ defaultTemperature: 25, maxTemperature: 25 })
  })
  it('keeps zero and negative values', () => {
    expect(fluidTemperatures({ default_temperature: 0 })).toEqual({ defaultTemperature: 0, maxTemperature: 0 })
    expect(fluidTemperatures({ default_temperature: -200 })).toEqual({ defaultTemperature: -200, maxTemperature: -200 })
  })
  it('returns nothing without a finite default', () => {
    for (const proto of [{}, undefined, { default_temperature: 'x' }]) {
      const out = fluidTemperatures(proto)
      expect(out).not.toHaveProperty('defaultTemperature')
      expect(out).not.toHaveProperty('maxTemperature')
    }
  })
})

describe('productTemperature', () => {
  it('reads the temperature of a fluid product', () => {
    expect(productTemperature({ type: 'fluid', name: 'steam', temperature: 165 })).toBe(165)
    expect(productTemperature({ type: 'fluid', name: 'steam', temperature: 0 })).toBe(0)
  })
  it('is undefined otherwise', () => {
    expect(productTemperature({ type: 'fluid', name: 'steam' })).toBeUndefined()
    expect(productTemperature({ type: 'item', name: 'x', temperature: 5 })).toBeUndefined()
    expect(productTemperature(['iron-plate', 1])).toBeUndefined()
    expect(productTemperature({ type: 'fluid', name: 'steam', temperature: NaN })).toBeUndefined()
  })
})

const items = () => ({
  steam: { id: 'steam', type: 'fluid', order: 'a' },
  plate: { id: 'plate', type: 'item' },
  'power:electricity': { id: 'power:electricity', type: 'item' },
  mystery: { id: 'mystery', type: 'fluid' },
})

describe('attachFluidTemperatures', () => {
  const raw = () => ({ steam: { default_temperature: 15, max_temperature: 5000 } })

  it('adds both fields to fluids and leaves the rest alone', () => {
    const input = items()
    const { items: out, count } = attachFluidTemperatures(input, raw())
    expect(out.steam).toEqual({ id: 'steam', type: 'fluid', order: 'a', defaultTemperature: 15, maxTemperature: 5000 })
    expect(out.plate).toBe(input.plate)
    expect(out['power:electricity']).toBe(input['power:electricity'])
    expect(out.mystery).toBe(input.mystery)
    expect(count).toBe(1)
    expect(input.steam).not.toHaveProperty('defaultTemperature')
  })
  it('removes stale fields when the prototype has none', () => {
    const input = { steam: { id: 'steam', type: 'fluid', defaultTemperature: 1, maxTemperature: 2 } }
    const { items: out, count } = attachFluidTemperatures(input, { steam: {} })
    expect(out.steam).toEqual({ id: 'steam', type: 'fluid' })
    expect(count).toBe(0)
  })
  it('is idempotent', () => {
    const once = attachFluidTemperatures(items(), raw()).items
    expect(attachFluidTemperatures(once, raw()).items).toEqual(once)
  })
})

const recipes = () => ({
  boil: {
    id: 'boil',
    products: [{ itemId: 'water', type: 'fluid', amount: 1 }, { itemId: 'steam', type: 'fluid', amount: 2 }],
  },
  old: { id: 'old', products: [{ itemId: 'x', type: 'item', amount: 1 }] },
  gen: { id: 'gen', extraction: true, products: [{ itemId: 'ore', type: 'item', amount: 1 }] },
  pow: { id: 'pow', power: true, products: [{ itemId: 'steam', type: 'fluid', amount: 1 }] },
})
const rawRecipes = () => ({
  boil: { results: [{ type: 'fluid', name: 'water', amount: 1 }, { type: 'fluid', name: 'steam', amount: 2, temperature: 165 }] },
  old: { result: 'x' },
})

describe('attachProductTemperatures', () => {
  it('sets only the product that states a temperature', () => {
    const input = recipes()
    const r = attachProductTemperatures(input, rawRecipes())
    expect(r.recipes.boil.products[1].temperature).toBe(165)
    expect(r.recipes.boil.products[0]).not.toHaveProperty('temperature')
    expect(r.count).toBe(1)
    expect(r.missing).toEqual([])
    expect(r.mismatched).toEqual([])
    expect(input.boil.products[1]).not.toHaveProperty('temperature')
  })
  it('handles old-style result and object-keyed results', () => {
    const raw = rawRecipes()
    raw.boil.results = { 1: raw.boil.results[0], 2: raw.boil.results[1] }
    const r = attachProductTemperatures(recipes(), raw)
    expect(r.recipes.old.products[0]).not.toHaveProperty('temperature')
    expect(r.recipes.boil.products[1].temperature).toBe(165)
    expect(r.mismatched).toEqual([])
  })
  it('leaves recipes with a different product count unchanged', () => {
    const input = recipes()
    const raw = rawRecipes()
    raw.boil.results.pop()
    const r = attachProductTemperatures(input, raw)
    expect(r.mismatched).toEqual(['boil'])
    expect(r.recipes.boil).toEqual(input.boil)
  })
  it('leaves recipes with a different product name unchanged', () => {
    const input = recipes()
    const raw = rawRecipes()
    raw.boil.results[1].name = 'other'
    const r = attachProductTemperatures(input, raw)
    expect(r.mismatched).toEqual(['boil'])
    expect(r.recipes.boil).toEqual(input.boil)
  })
  it('reports recipes absent from the dump', () => {
    const raw = rawRecipes()
    delete raw.old
    const r = attachProductTemperatures(recipes(), raw)
    expect(r.missing).toEqual(['old'])
  })
  it('does not touch or count generated recipes', () => {
    const input = recipes()
    const r = attachProductTemperatures(input, rawRecipes())
    expect(r.recipes.gen).toBe(input.gen)
    expect(r.recipes.pow).toBe(input.pow)
    expect(r.checked).toBe(2)
  })
  it('removes a stale temperature the dump does not state', () => {
    const input = recipes()
    input.old.products[0].temperature = 99
    const r = attachProductTemperatures(input, rawRecipes())
    expect(r.recipes.old.products[0]).not.toHaveProperty('temperature')
  })
  it('is idempotent', () => {
    const once = attachProductTemperatures(recipes(), rawRecipes()).recipes
    const twice = attachProductTemperatures(once, rawRecipes())
    expect(twice.recipes).toEqual(once)
    expect(twice.count).toBe(1)
  })
})
