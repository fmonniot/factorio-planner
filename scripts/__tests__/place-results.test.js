import { describe, it, expect } from 'vitest'
import { attachPlaceResults } from '../place-results.js'

// Each call returns fresh objects.
function makeItems() {
  return {
    machine: { id: 'machine', name: 'Machine', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '' },
    x: { id: 'x', name: 'X', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '' },
    water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '' },
  }
}

function makeRaw() {
  return {
    item: {
      machine: { name: 'machine', place_result: 'machine' },
      x: { name: 'x', place_result: 'wall' },
    },
  }
}

const SUBTYPES = ['item', 'item-with-entity-data']
const entities = new Set(['machine', 'beacon'])

describe('attachPlaceResults', () => {
  it('sets placeResult when the entity is exported', () => {
    const out = attachPlaceResults(makeItems(), makeRaw(), SUBTYPES, entities)
    expect(out.items.machine.placeResult).toBe('machine')
    expect(out.count).toBe(1)
  })

  it('ignores an entity that is not a machine or beacon', () => {
    const out = attachPlaceResults(makeItems(), makeRaw(), SUBTYPES, entities)
    expect(out.items.x, 'non-machine entity').not.toHaveProperty('placeResult')
  })

  it('sets nothing for an empty or missing place_result', () => {
    const raw = makeRaw()
    raw.item.machine.place_result = ''
    delete raw.item.x.place_result
    const out = attachPlaceResults(makeItems(), raw, SUBTYPES, entities)
    expect(out.items.machine).not.toHaveProperty('placeResult')
    expect(out.items.x).not.toHaveProperty('placeResult')
    expect(out.count).toBe(0)
  })

  it('finds the prototype in another item table', () => {
    const raw = { 'item-with-entity-data': { machine: { name: 'machine', place_result: 'beacon' } } }
    const out = attachPlaceResults(makeItems(), raw, SUBTYPES, entities)
    expect(out.items.machine.placeResult).toBe('beacon')
  })

  it('lets the later table win when an id is in two tables', () => {
    const raw = {
      item: { machine: { name: 'machine', place_result: 'machine' } },
      'item-with-entity-data': { machine: { name: 'machine', place_result: 'beacon' } },
    }
    const out = attachPlaceResults(makeItems(), raw, SUBTYPES, entities)
    expect(out.items.machine.placeResult).toBe('beacon')
  })

  it('removes a stale placeResult', () => {
    const items = makeItems()
    items.x.placeResult = 'machine'
    const out = attachPlaceResults(items, makeRaw(), SUBTYPES, entities)
    expect(out.items.x).not.toHaveProperty('placeResult')
  })

  it('copies fluids unchanged', () => {
    const items = makeItems()
    const out = attachPlaceResults(items, makeRaw(), SUBTYPES, entities)
    expect(out.items.water).toEqual(items.water)
  })

  it('does not mutate its input', () => {
    const items = makeItems()
    const before = structuredClone(items)
    attachPlaceResults(items, makeRaw(), SUBTYPES, entities)
    expect(items).toEqual(before)
  })
})
