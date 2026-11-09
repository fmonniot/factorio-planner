import { describe, it, expect } from 'vitest'
import { matchesName, matchesItem, matchesRecipe } from './search'
import type { Item, Recipe } from './types'

describe('matchesName', () => {
  it('matches everything for an empty query', () => {
    expect(matchesName('', 'iron-plate', 'Iron Plate')).toBe(true)
  })
  it('is case-insensitive on the name', () => {
    expect(matchesName('IRON', 'x', 'Iron Plate')).toBe(true)
  })
  it('matches on the id', () => {
    expect(matchesName('iron-pl', 'iron-plate', 'Plate of Fe')).toBe(true)
    expect(matchesName('iron', 'iron-plate')).toBe(true)
  })
  it('does not match unrelated text', () => {
    expect(matchesName('copper', 'iron-plate', 'Iron Plate')).toBe(false)
  })
})

describe('matchesItem / matchesRecipe', () => {
  it('delegate to the name and the id', () => {
    const item = { id: 'iron-plate', name: 'Iron Plate' } as Item
    const recipe = { id: 'gear', name: 'Gear Wheel' } as Recipe
    expect(matchesItem('plate', item)).toBe(true)
    expect(matchesItem('gear', item)).toBe(false)
    expect(matchesRecipe('WHEEL', recipe)).toBe(true)
    expect(matchesRecipe('plate', recipe)).toBe(false)
  })
})
