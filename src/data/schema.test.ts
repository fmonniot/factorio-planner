import { describe, it, expect } from 'vitest'
import { ItemSchema, RecipeSchema } from './schema'

const base = { id: 'x', name: 'X', type: 'item', iconPath: '/i/x.png' }

describe('ItemSchema.iconColor', () => {
  it('keeps a valid colour', () => {
    expect(ItemSchema.parse({ ...base, iconColor: '#da1212' }).iconColor).toBe('#da1212')
  })

  it('reads a malformed colour as absent instead of failing the item', () => {
    for (const bad of ['#DA1212', '#fff', null, 42]) {
      expect(ItemSchema.parse({ ...base, iconColor: bad }).iconColor).toBeUndefined()
    }
  })
})

describe('RecipeSchema.additionalCategories', () => {
  const recipe = {
    id: 'r', name: 'R', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [],
    allowProductivity: false, order: '',
  }
  it('is absent when the recipe has none', () => {
    expect(RecipeSchema.parse(recipe).additionalCategories).toBeUndefined()
  })
  it('round-trips a list and reads a Lua empty table as an empty list', () => {
    expect(RecipeSchema.parse({ ...recipe, additionalCategories: ['electronics'] }).additionalCategories).toEqual(['electronics'])
    expect(RecipeSchema.parse({ ...recipe, additionalCategories: {} }).additionalCategories).toEqual([])
  })
})
