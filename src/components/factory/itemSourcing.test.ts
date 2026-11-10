import { describe, it, expect } from 'vitest'
import { forbidImportsTitle, itemSourcingActions, ITEM_SOURCING_CHOICES, IMPORT_SWITCH, COMES_FROM_LABEL } from './itemSourcing'
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

describe('the vocabulary', () => {
  it('names the three presets and gives each its help text', () => {
    expect(ITEM_SOURCING_CHOICES.map(c => [c.mode, c.label, c.title])).toEqual([
      [undefined, 'Make it here', 'Made here; connections and imports cover what is missing.'],
      ['byproducts-first', "Only what's already made", 'Uses what this block already makes; the rest is received or imported.'],
      ['connections-first', 'Receive it first', "Taken from this block's connections first; made here for the rest."],
    ])
  })

  it('names the Import switch and gives it its help text', () => {
    expect(IMPORT_SWITCH).toEqual({
      label: 'Import',
      title: 'Bring it in from outside the plan. Off: this block must make or receive all of it.',
    })
    expect(COMES_FROM_LABEL).toBe('Comes from')
  })

  it('shows the new names, with the help text as tooltip, in the menu actions', () => {
    const actions = itemSourcingActions(undefined, () => {})
    expect(actions.map(a => a.label)).toEqual(['Make it here', "Only what's already made", 'Receive it first'])
    expect(actions.map(a => a.title)).toEqual(ITEM_SOURCING_CHOICES.map(c => c.title))
  })

  it('uses none of the retired words in the names', () => {
    const words = [...ITEM_SOURCING_CHOICES.map(c => c.label), IMPORT_SWITCH.label, COMES_FROM_LABEL].join('|').toLowerCase()
    for (const old of ['own recipes first', 'byproducts first', 'connections first', 'forbid imports', 'allow imports']) {
      expect(words).not.toContain(old)
    }
  })
})
