import { describe, it, expect } from 'vitest'
import type { GameData, Recipe } from '../../data/types'
import { fmtTemperatureValue, fmtTemperatureRange, ingredientTemperatureLabels, productTemperatureLabels, fmtTemperatureWarning } from './temperature'

function makeRecipe(ingredients: Recipe['ingredients']): Recipe {
  return {
    id: 'r',
    name: 'R',
    category: 'chemistry',
    craftingTime: 1,
    ingredients,
    products: [{ itemId: 'out', type: 'fluid', amount: 1 }],
    madeIn: [],
    allowProductivity: false,
    hidden: false,
  } as unknown as Recipe
}

describe('fmtTemperatureValue', () => {
  it.each([
    [95, '95'],
    [26.5, '26.5'],
    [26.54, '26.5'],
    [26.96, '27'],
    [-10, '-10'],
    [-0.04, '0'],
  ])('%s -> %s', (v, expected) => {
    expect(fmtTemperatureValue(v), String(v)).toBe(expected)
  })
})

describe('fmtTemperatureRange', () => {
  it.each<[number | undefined, number | undefined, string | undefined]>([
    [95, undefined, '≥95°C'],
    [undefined, 30, '≤30°C'],
    [125, 165, '125–165°C'],
    [50, 50, '50°C'],
    [50.01, 49.99, '50°C'],
    [165, 125, '165–125°C'],
    [undefined, undefined, undefined],
    [-1e308, 30, '≤30°C'],
    [95, 1.7976931348623157e308, '≥95°C'],
    [NaN, 30, '≤30°C'],
    [Infinity, -Infinity, undefined],
    [-10, 30, '-10–30°C'],
  ])('(%s, %s) -> %s', (min, max, expected) => {
    expect(fmtTemperatureRange(min, max), `${min}, ${max}`).toBe(expected)
  })
})

describe('ingredientTemperatureLabels', () => {
  it('labels only the ingredients with a bound', () => {
    const recipe = makeRecipe([
      { itemId: 'saline', type: 'fluid', amount: 60 },
      { itemId: 'semiheavy-1', type: 'fluid', amount: 50, maximumTemperature: 30 },
      { itemId: 'h2s', type: 'fluid', amount: 100, minimumTemperature: 95 },
    ])
    expect(ingredientTemperatureLabels(recipe)).toEqual({ 'semiheavy-1': '≤30°C', h2s: '≥95°C' })
  })

  it('returns an empty record when no ingredient has a bound', () => {
    expect(ingredientTemperatureLabels(makeRecipe([{ itemId: 'a', type: 'item', amount: 1 }]))).toEqual({})
  })

  it('joins different bounds of the same fluid', () => {
    const recipe = makeRecipe([
      { itemId: 'f', type: 'fluid', amount: 1, minimumTemperature: 10 },
      { itemId: 'f', type: 'fluid', amount: 1, maximumTemperature: 50 },
    ])
    expect(ingredientTemperatureLabels(recipe)).toEqual({ f: '≥10°C, ≤50°C' })
  })

  it('does not repeat an identical bound', () => {
    const recipe = makeRecipe([
      { itemId: 'f', type: 'fluid', amount: 1, minimumTemperature: 10 },
      { itemId: 'f', type: 'fluid', amount: 2, minimumTemperature: 10 },
    ])
    expect(ingredientTemperatureLabels(recipe)).toEqual({ f: '≥10°C' })
  })
})

describe('productTemperatureLabels', () => {
  const withProducts = (products: Recipe['products']): Recipe => ({ ...makeRecipe([]), products })

  it('labels only the products with an explicit temperature', () => {
    const recipe = withProducts([
      { itemId: 'steam', type: 'fluid', amount: 60, temperature: 165 },
      { itemId: 'water', type: 'fluid', amount: 1 },
    ])
    expect(productTemperatureLabels(recipe)).toEqual({ steam: '165°C' })
  })

  it('joins different temperatures of one fluid and drops repeats', () => {
    const recipe = withProducts([
      { itemId: 'steam', type: 'fluid', amount: 1, temperature: 165 },
      { itemId: 'steam', type: 'fluid', amount: 1, temperature: 165 },
      { itemId: 'steam', type: 'fluid', amount: 1, temperature: 500 },
    ])
    expect(productTemperatureLabels(recipe)).toEqual({ steam: '165°C, 500°C' })
  })

  it('returns an empty record without explicit temperatures', () => {
    expect(productTemperatureLabels(withProducts([{ itemId: 'a', type: 'item', amount: 1 }]))).toEqual({})
  })
})

describe('fmtTemperatureWarning', () => {
  const gd = {
    items: { steam: { id: 'steam', name: 'Steam', defaultTemperature: 15 } },
    recipes: { turbine: { id: 'turbine', name: 'Steam Turbine' } },
  } as unknown as GameData

  it('names the need and the single supplied temperature', () => {
    expect(fmtTemperatureWarning({ type: 'temperature-mismatch', recipeId: 'turbine', itemId: 'steam', supplied: [165], minimum: 465 }, gd))
      .toBe('Steam Turbine needs Steam at ≥465°C, but this block only makes it at 165°C.')
  })

  it('says so when the supplied temperature is the fluid default', () => {
    expect(fmtTemperatureWarning({ type: 'temperature-mismatch', recipeId: 'turbine', itemId: 'steam', supplied: [15], minimum: 165 }, gd))
      .toContain('15°C (its default)')
  })

  it('joins several supplied temperatures', () => {
    expect(fmtTemperatureWarning({ type: 'temperature-mismatch', recipeId: 'turbine', itemId: 'steam', supplied: [165, 315], minimum: 465 }, gd))
      .toContain('at 165°C, 315°C.')
  })
})
