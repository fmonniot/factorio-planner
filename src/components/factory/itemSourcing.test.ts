import { describe, it, expect } from 'vitest'
import { makeEmptyBlock } from '../../store/blockStore'
import { areaRuleLabel, ruleLabel, sourcesLineOrder, ITEM_SOURCING_CHOICES, IMPORT_SWITCH, COMES_FROM_LABEL, SOURCE_RULE_NAMES, SOURCES_BUTTON_LABEL, SOURCES_LINES, ruleChipOf } from './itemSourcing'

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
      'leftover-off': 'Leftover off',
      'make-here': 'Make it here',
      'import-on': 'Import on',
      'takes-nothing': 'Takes nothing',
    })
    expect(areaRuleLabel('Line L', SOURCE_RULE_NAMES['connections-first'])).toBe('Line L: Receive it first')
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

describe('sourcesLineOrder, one line per supplying area', () => {
  const M = ['M1', 'M2']
  it('puts one area line per supplier where Other areas was', () => {
    expect(sourcesLineOrder(undefined, true, 'above', M)).toEqual(['made-here', 'make-here', 'area:M1', 'area:M2', 'block', 'import'])
    expect(sourcesLineOrder('after-blocks', true, 'below', M)).toEqual(['made-here', 'block', 'make-here', 'area:M1', 'area:M2', 'import'])
    expect(sourcesLineOrder('off', true, 'above', M)).toEqual(['made-here', 'area:M1', 'area:M2', 'make-here', 'block', 'import'])
    expect(sourcesLineOrder('off', true, 'below', M)).toEqual(['made-here', 'area:M1', 'area:M2', 'block', 'make-here', 'import'])
  })
  it('keeps the single Other areas line without suppliers', () => {
    expect(sourcesLineOrder(undefined, true, 'above', [])).toEqual(['made-here', 'make-here', 'other-areas', 'block', 'import'])
    expect(sourcesLineOrder(undefined, true, 'above', undefined)).toEqual(['made-here', 'make-here', 'other-areas', 'block', 'import'])
  })
})

describe('ruleLabel', () => {
  const root = makeEmptyBlock('B').rootPlan
  const sub = (id: string) => ({ id, name: `Line ${id}`, nodes: [], subPlans: [], area: true as const, createdAt: '', updatedAt: '' })
  const plan = { ...root, subPlans: [sub('L'), sub('M1')] }
  it('names a block part, an area part and a switch', () => {
    expect(ruleLabel({ kind: 'import-off' }, plan)).toBe('Import off')
    expect(ruleLabel({ kind: 'leftover-off' }, plan)).toBe('Leftover off')
    expect(ruleLabel({ kind: 'connections-first', areaId: 'L' }, plan)).toBe('Line L: Receive it first')
    expect(ruleLabel({ kind: 'takes-nothing', areaId: 'L', otherAreaId: 'M1' }, plan)).toBe('Line L: takes nothing from Line M1')
  })
})

describe('ruleChipOf', () => {
  it('reads the preset at block scope', () => {
    expect(ruleChipOf(undefined, { ownRule: false })).toEqual({ text: 'Make it here', owner: 'block', preset: undefined })
    expect(ruleChipOf({ makeHere: 'after-blocks' }, { ownRule: false })).toEqual({ text: 'Receive it first', owner: 'block', preset: 'connections-first' })
    expect(ruleChipOf({ makeHere: 'off' }, { ownRule: false })).toEqual({ text: "Don't make more here", owner: 'block', preset: 'byproducts-first' })
  })

  it('adds Import off', () => {
    expect(ruleChipOf({ importOff: true }, { ownRule: false }).text).toBe('Make it here · Import off')
    expect(ruleChipOf({ makeHere: 'off', importOff: true }, { ownRule: false }).text).toBe("Don't make more here · Import off")
  })

  it('prefixes whose rule it is at area scope', () => {
    expect(ruleChipOf({ makeHere: 'after-blocks' }, { area: 'A', ownRule: false })).toEqual({ text: "Block's rule · Receive it first", owner: 'follows', preset: 'connections-first' })
    expect(ruleChipOf({ importOff: true }, { area: 'A', ownRule: true })).toEqual({ text: 'Own rule · Make it here · Import off', owner: 'own', preset: undefined })
  })
})
