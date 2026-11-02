import { describe, it, expect } from 'vitest'
import { itemFuel, burnerFuel, attachFuel, fuelOverlaps } from '../fuel.js'

// Each call returns fresh objects.
function makeItems() {
  return {
    coal: { id: 'coal', name: 'Coal', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '' },
    plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '' },
    oil: { id: 'oil', name: 'Oil', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '' },
  }
}

function makeMachines() {
  return {
    furnace: { id: 'furnace', type: 'furnace', energyType: 'burner', energyUsageKw: 90 },
    asm: { id: 'asm', type: 'assembling-machine', energyType: 'electric', energyUsageKw: 75 },
    gone: { id: 'gone', type: 'furnace', energyType: 'burner', energyUsageKw: 90 },
  }
}

function makeRaw() {
  return {
    item: {
      coal: { name: 'coal', fuel_value: '4MJ', fuel_category: 'chemical' },
      plate: { name: 'plate' },
    },
    furnace: {
      furnace: { name: 'furnace', energy_source: { type: 'burner', fuel_categories: ['chemical'], effectivity: 0.5 } },
    },
    'assembling-machine': {
      asm: { name: 'asm', energy_source: { type: 'electric' } },
    },
  }
}

const SUBTYPES = ['item']

describe('itemFuel', () => {
  it('parses the fuel value to kJ, with its category', () => {
    expect(itemFuel({ fuel_value: '12MJ', fuel_category: 'chemical' }))
      .toEqual({ fuelValueKj: 12000, fuelCategory: 'chemical' })
  })

  it('keeps the burnt result', () => {
    expect(itemFuel({ fuel_value: '8MJ', fuel_category: 'nuclear', burnt_result: 'spent-cell' }))
      .toEqual({ fuelValueKj: 8000, fuelCategory: 'nuclear', burntResult: 'spent-cell' })
  })

  it('is empty without a positive fuel value', () => {
    expect(itemFuel({ name: 'x' })).toEqual({})
    expect(itemFuel({ fuel_value: '0J', fuel_category: 'chemical' })).toEqual({})
    expect(itemFuel(undefined)).toEqual({})
  })
})

describe('burnerFuel', () => {
  it('reads categories and effectivity of a burner source', () => {
    expect(burnerFuel({ energy_source: { type: 'burner', fuel_categories: ['chemical', 'food'], effectivity: 0.5 } }))
      .toEqual({ fuelCategories: ['chemical', 'food'], effectivity: 0.5 })
  })

  it('falls back to fuel_category, then to chemical, and to effectivity 1', () => {
    expect(burnerFuel({ energy_source: { type: 'burner', fuel_category: 'nuclear' } }))
      .toEqual({ fuelCategories: ['nuclear'], effectivity: 1 })
    expect(burnerFuel({ energy_source: { type: 'burner' } }))
      .toEqual({ fuelCategories: ['chemical'], effectivity: 1 })
  })

  it('is empty for any other energy source', () => {
    expect(burnerFuel({ energy_source: { type: 'electric' } })).toEqual({})
    expect(burnerFuel({ energy_source: { type: 'heat' } })).toEqual({})
    expect(burnerFuel({})).toEqual({})
  })
})

describe('attachFuel', () => {
  it('sets fuel on items and burner machines and leaves the rest as it is', () => {
    const items = makeItems()
    const machines = makeMachines()
    const out = attachFuel(items, machines, makeRaw(), SUBTYPES)
    expect(out.items.coal).toMatchObject({ fuelValueKj: 4000, fuelCategory: 'chemical' })
    expect(out.items.plate).toBe(items.plate)
    expect(out.items.oil).toBe(items.oil)
    expect(out.machines.furnace).toMatchObject({ fuelCategories: ['chemical'], effectivity: 0.5 })
    expect(out.machines.asm).toBe(machines.asm)
    expect(out.counts).toEqual({ items: 1, machines: 1 })
  })

  it('reports burner machines missing from the dump', () => {
    const machines = makeMachines()
    const out = attachFuel(makeItems(), machines, makeRaw(), SUBTYPES)
    expect(out.missingMachines).toEqual(['gone'])
    expect(out.machines.gone).toBe(machines.gone)
  })

  it('is idempotent', () => {
    const once = attachFuel(makeItems(), makeMachines(), makeRaw(), SUBTYPES)
    const twice = attachFuel(once.items, once.machines, makeRaw(), SUBTYPES)
    expect(twice.items).toEqual(once.items)
    expect(twice.machines).toEqual(once.machines)
    expect(twice.items.coal).toBe(once.items.coal)
  })

  it('drops a stale fuel field', () => {
    const items = makeItems()
    items.plate = { ...items.plate, fuelValueKj: 1000, fuelCategory: 'chemical' }
    const out = attachFuel(items, makeMachines(), makeRaw(), SUBTYPES)
    expect(out.items.plate).not.toHaveProperty('fuelValueKj')
    expect(out.items.plate).not.toHaveProperty('fuelCategory')
  })
})

describe('itemFuel default category', () => {
  it('uses chemical when the prototype names no category', () => {
    expect(itemFuel({ fuel_value: '2MJ' })).toEqual({ fuelValueKj: 2000, fuelCategory: 'chemical' })
  })
})

describe('fuelOverlaps', () => {
  it('is true when a burner machine accepts a fuel item', () => {
    const out = attachFuel(makeItems(), makeMachines(), makeRaw(), SUBTYPES)
    expect(fuelOverlaps(out.items, out.machines)).toBe(true)
  })

  it('is false when no burner machine has data, or no category is shared', () => {
    const out = attachFuel(makeItems(), makeMachines(), makeRaw(), SUBTYPES)
    expect(fuelOverlaps(out.items, makeMachines())).toBe(false)
    const nuclear = { furnace: { ...out.machines.furnace, fuelCategories: ['nuclear'] } }
    expect(fuelOverlaps(out.items, nuclear)).toBe(false)
  })
})
