import { describe, it, expect } from 'vitest'
import { recipeIconItem } from './recipeIcon'
import type { GameData } from './types'

function item(id: string, iconPath: string): GameData['items'][string] {
  return { id, name: id, type: 'item', iconPath, hidden: false, subgroup: '', order: '' }
}

function makeData(): GameData {
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: { a: item('a', 'a.png'), b: item('b', 'b.png'), bare: item('bare', '') },
    recipes: {}, machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {},
    technologies: {}, startingRecipes: [],
  }
}

function recipe(products: string[], mainProduct?: string): GameData['recipes'][string] {
  return {
    id: 'r', name: 'r', category: 'crafting', craftingTime: 1, ingredients: [],
    products: products.map(itemId => ({ itemId, type: 'item' as const, amount: 1 })),
    madeIn: [], allowProductivity: false, hidden: false, mainProduct, subgroup: '', order: '',
  }
}

describe('recipeIconItem', () => {
  it('prefers the main product when it has an icon', () => {
    expect(recipeIconItem(makeData(), recipe(['a', 'b'], 'b'))?.id).toBe('b')
  })
  it('falls back to the first product with an icon', () => {
    expect(recipeIconItem(makeData(), recipe(['bare', 'a', 'b'], 'bare'))?.id).toBe('a')
  })
  it('is undefined when no product has an icon', () => {
    expect(recipeIconItem(makeData(), recipe(['bare', 'missing']))).toBeUndefined()
  })
})
