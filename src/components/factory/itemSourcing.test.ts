import { describe, it, expect } from 'vitest'
import { ITEM_SOURCING_CHOICES, IMPORT_SWITCH, COMES_FROM_LABEL, SOURCE_RULE_NAMES, SOURCES_BUTTON_LABEL, SOURCES_LINES } from './itemSourcing'

describe('the vocabulary', () => {
  it('names the three presets and gives each its help text', () => {
    expect(ITEM_SOURCING_CHOICES.map(c => [c.mode, c.label, c.title])).toEqual([
      [undefined, 'Make it here', 'Made here; connections and imports cover what is missing.'],
      ['connections-first', 'Receive it first', "Taken from this block's connections first; made here for the rest."],
      ['byproducts-first', "Don't make more here", 'Runs no row for this item: uses what this block already makes, then its connections, then Import.'],
    ])
  })

  it('names the Import switch and gives it its help text', () => {
    expect(IMPORT_SWITCH).toEqual({
      label: 'Import',
      title: 'Bring it in from outside the plan. Off: what the other sources leave is shown as missing.',
    })
    expect(COMES_FROM_LABEL).toBe('Comes from')
  })

  it('names the three kinds of rule after the preset, or the Import switch turned off', () => {
    expect(SOURCE_RULE_NAMES).toEqual({
      'connections-first': 'Receive it first',
      'byproducts-first': "Don't make more here",
      'import-off': 'Import off',
    })
  })

  it('names the Sources list, its button and its lines, each with its help text', () => {
    expect(SOURCES_BUTTON_LABEL).toBe('Sources…')
    expect(Object.entries(SOURCES_LINES).map(([line, { label }]) => [line, label])).toEqual([
      ['made-here', 'Already made here'],
      ['make-here', 'Make more here'],
      ['other-areas', 'Other areas'],
      ['other-blocks', 'Other blocks'],
      ['import', 'Import'],
    ])
    expect(SOURCES_LINES.import).toBe(IMPORT_SWITCH)
  })

  it('uses none of the retired words in the names', () => {
    const words = [
      ...ITEM_SOURCING_CHOICES.map(c => c.label), IMPORT_SWITCH.label, COMES_FROM_LABEL, SOURCES_BUTTON_LABEL,
      ...Object.values(SOURCES_LINES).map(l => l.label),
    ].join('|').toLowerCase()
    for (const old of ['own recipes first', 'byproducts first', 'connections first', 'forbid imports', 'allow imports']) {
      expect(words).not.toContain(old)
    }
  })
})
