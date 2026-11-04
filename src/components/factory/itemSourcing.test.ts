import { describe, it, expect } from 'vitest'
import { forbidImportsTitle } from './itemSourcing'
import { makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import type { GameData } from '../../data/types'

const gameData = {
  items: { plate: { id: 'plate', name: 'Plate' }, ore: { id: 'ore', name: 'Ore' } },
  recipes: {
    smelt: {
      id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    },
  },
} as unknown as GameData

function block(locked: string[] = [], withRow = true) {
  const b = makeEmptyBlock('B')
  b.noImportItems = locked
  if (withRow) b.rootPlan.nodes = [makeRecipeNode('smelt')]
  return b
}

describe('forbidImportsTitle', () => {
  it('is undefined for an item a row of the block makes', () => {
    expect(forbidImportsTitle(block(), gameData, 'plate')).toBeUndefined()
  })

  it('names the item for one no row makes (an ingredient, fuel, or a goal with no row)', () => {
    expect(forbidImportsTitle(block(), gameData, 'ore')).toMatch(/No recipe in this block makes Ore/)
    expect(forbidImportsTitle(block([], false), gameData, 'plate')).toMatch(/makes Plate/)
  })

  it('is undefined for a locked item, so the lock can be lifted', () => {
    expect(forbidImportsTitle(block(['ore']), gameData, 'ore')).toBeUndefined()
  })

  it('is undefined without a block or game data', () => {
    expect(forbidImportsTitle(undefined, gameData, 'ore')).toBeUndefined()
    expect(forbidImportsTitle(block(), undefined, 'ore')).toBeUndefined()
  })
})
