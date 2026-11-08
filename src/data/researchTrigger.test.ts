import { describe, it, expect } from 'vitest'
import { describeTrigger, type TriggerLookup } from './researchTrigger'

function makeLookup(): TriggerLookup {
  return {
    items: {
      wood: { id: 'wood', name: 'Wood', type: 'item', iconPath: '/i/wood.png', hidden: false, subgroup: '', order: '' },
      'steel-plate': { id: 'steel-plate', name: 'Steel plate', type: 'item', iconPath: '/i/steel.png', hidden: false, subgroup: '', order: '' },
      'crude-oil': { id: 'crude-oil', name: 'Crude oil', type: 'fluid', iconPath: '/i/oil.png', hidden: false, subgroup: '', order: '' },
      water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '' },
      satellite: { id: 'satellite', name: 'Satellite', type: 'item', iconPath: '/i/sat.png', hidden: false, subgroup: '', order: '' },
    },
    machines: {
      boiler: {
        id: 'boiler', name: 'Boiler', type: 'boiler', craftingSpeed: 1, energyUsageKw: 1, energyType: 'burner',
        drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: [], iconPath: '/i/boiler.png', hidden: false,
      },
    },
    beacons: {},
  }
}

describe('describeTrigger', () => {
  it('describes craft-item with and without a count', () => {
    const l = makeLookup()
    expect(describeTrigger({ type: 'craft-item', item: 'wood' }, l)).toEqual({
      short: 'Craft Wood', full: 'Researched by crafting Wood', iconPath: '/i/wood.png',
    })
    expect(describeTrigger({ type: 'craft-item', item: 'wood', count: 1 }, l)?.short, 'count 1').toBe('Craft Wood')
    expect(describeTrigger({ type: 'craft-item', item: 'steel-plate', count: 10 }, l)).toEqual({
      short: 'Craft 10 × Steel plate', full: 'Researched by crafting 10 × Steel plate', iconPath: '/i/steel.png',
    })
  })
  it('describes mine-entity with the fluid icon', () => {
    expect(describeTrigger({ type: 'mine-entity', entity: 'crude-oil' }, makeLookup())).toEqual({
      short: 'Mine Crude oil', full: 'Researched by mining Crude oil', iconPath: '/i/oil.png',
    })
  })
  it('describes build-entity, using the machine icon for an entity found only in machines', () => {
    const l = makeLookup()
    expect(describeTrigger({ type: 'build-entity', entity: 'boiler', count: 2 }, l)).toEqual({
      short: 'Build 2 × Boiler', full: 'Researched by building 2 × Boiler', iconPath: '/i/boiler.png',
    })
    expect(describeTrigger({ type: 'build-entity', entity: 'boiler' }, l)?.short, 'no count').toBe('Build Boiler')
  })
  it('describes capture-spawner with and without an entity', () => {
    const l = makeLookup()
    expect(describeTrigger({ type: 'capture-spawner', entity: 'biter-spawner' }, l)).toEqual({
      short: 'Capture Biter spawner', full: 'Researched by capturing Biter spawner', iconPath: undefined,
    })
    expect(describeTrigger({ type: 'capture-spawner' }, l)).toEqual({
      short: 'Capture a spawner', full: 'Researched by capturing a spawner', iconPath: undefined,
    })
  })
  it('describes craft-fluid; an empty iconPath gives no icon', () => {
    expect(describeTrigger({ type: 'craft-fluid', fluid: 'water', count: 100 }, makeLookup())).toEqual({
      short: 'Craft 100 × Water', full: 'Researched by crafting 100 × Water', iconPath: undefined,
    })
  })
  it('describes send-item-to-orbit', () => {
    expect(describeTrigger({ type: 'send-item-to-orbit', item: 'satellite' }, makeLookup())).toEqual({
      short: 'Send Satellite to orbit', full: 'Researched by sending Satellite to orbit', iconPath: '/i/sat.png',
    })
  })
  it('describes create-space-platform without an icon', () => {
    expect(describeTrigger({ type: 'create-space-platform' }, makeLookup())).toEqual({
      short: 'Create a space platform', full: 'Researched by creating a space platform', iconPath: undefined,
    })
  })
  it('humanizes an unknown id and gives it no icon', () => {
    const d = describeTrigger({ type: 'craft-item', item: 'rare-metal', count: 3 }, makeLookup())
    expect(d?.short).toBe('Craft 3 × Rare metal')
    expect(d?.iconPath).toBeUndefined()
  })
  it('returns null for undefined, unknown types and missing required fields', () => {
    const l = makeLookup()
    expect(describeTrigger(undefined, l), 'undefined').toBeNull()
    expect(describeTrigger({ type: 'scripted' }, l), 'unknown').toBeNull()
    expect(describeTrigger({ type: 'craft-item' }, l), 'no item').toBeNull()
    expect(describeTrigger({ type: 'mine-entity' }, l), 'no entity').toBeNull()
    expect(describeTrigger({ type: 'craft-fluid' }, l), 'no fluid').toBeNull()
  })
})
