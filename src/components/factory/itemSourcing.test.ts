import { describe, it, expect } from 'vitest'
import { ITEM_SOURCING_CHOICES, IMPORT_SWITCH, COMES_FROM_LABEL, SOURCE_RULE_NAMES } from './itemSourcing'

describe('the vocabulary', () => {
  it('names the three presets and gives each its help text', () => {
    expect(ITEM_SOURCING_CHOICES.map(c => [c.mode, c.label, c.title])).toEqual([
      [undefined, 'Make it here', 'Made here; connections and imports cover what is missing.'],
      ['connections-first', 'Receive it first', "Taken from this block's connections first; made here for the rest."],
      ['byproducts-first', "Only what's already made", 'Uses what this block already makes; the rest is received or imported.'],
    ])
  })

  it('names the Import switch and gives it its help text', () => {
    expect(IMPORT_SWITCH).toEqual({
      label: 'Import',
      title: 'Bring it in from outside the plan. Off: this block must make or receive all of it.',
    })
    expect(COMES_FROM_LABEL).toBe('Comes from')
  })

  it('names the three kinds of rule after the preset, or the Import switch turned off', () => {
    expect(SOURCE_RULE_NAMES).toEqual({
      'connections-first': 'Receive it first',
      'byproducts-first': "Only what's already made",
      'import-off': 'Import off',
    })
  })

  it('uses none of the retired words in the names', () => {
    const words = [...ITEM_SOURCING_CHOICES.map(c => c.label), IMPORT_SWITCH.label, COMES_FROM_LABEL].join('|').toLowerCase()
    for (const old of ['own recipes first', 'byproducts first', 'connections first', 'forbid imports', 'allow imports']) {
      expect(words).not.toContain(old)
    }
  })
})
