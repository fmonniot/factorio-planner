import { describe, it, expect } from 'vitest'
import { itemFuel, fluidFuel, burnerFuel, attachFuel, fuelOverlaps } from '../fuel.js'

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
    expect(out.counts).toEqual({ items: 1, machines: 1, fluids: 0, fluidMachines: 0 })
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

function makeFluidRaw() {
  return {
    ...makeRaw(),
    fluid: {
      oil: { name: 'oil', fuel_value: '300kJ' },
      water: { name: 'water' },
    },
    furnace: {
      ...makeRaw().furnace,
      'fluid-furnace': { name: 'fluid-furnace', energy_source: { type: 'fluid', burns_fluid: true, effectivity: 0.5 } },
    },
    'assembling-machine': {
      asm: { name: 'asm', energy_source: { type: 'electric' } },
      steamer: { name: 'steamer', energy_source: { type: 'fluid', burns_fluid: false } },
    },
  }
}

function makeFluidBundle() {
  return {
    items: { ...makeItems(), water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '' } },
    machines: {
      ...makeMachines(),
      'fluid-furnace': { id: 'fluid-furnace', type: 'furnace', energyType: 'void', energyUsageKw: 90 },
      steamer: { id: 'steamer', type: 'assembling-machine', energyType: 'void', energyUsageKw: 90 },
      boiler: { id: 'boiler', type: 'furnace', energyType: 'void', energyUsageKw: 0 },
    },
  }
}

describe('fluidFuel', () => {
  it('parses the fuel value to kJ per unit', () => {
    expect(fluidFuel({ fuel_value: '1.5MJ' })).toEqual({ fuelValueKj: 1500 })
  })

  it('is empty without a positive fuel value', () => {
    expect(fluidFuel({ name: 'water' })).toEqual({})
    expect(fluidFuel({ fuel_value: '0J' })).toEqual({})
    expect(fluidFuel(undefined)).toEqual({})
  })
})

describe('burnerFuel with a fluid source', () => {
  it('reads effectivity and the filter fluid', () => {
    const source = { type: 'fluid', burns_fluid: true, effectivity: 0.5, fluid_box: { filter: 'oil' } }
    expect(burnerFuel({ energy_source: source })).toEqual({ effectivity: 0.5, fuelFluid: 'oil' })
  })

  it('has no fuelFluid without a filter, and effectivity defaults to 1', () => {
    expect(burnerFuel({ energy_source: { type: 'fluid', burns_fluid: true, fluid_box: { filter: '' } } }))
      .toEqual({ effectivity: 1 })
  })

  it('is empty for a fluid source that does not burn', () => {
    expect(burnerFuel({ energy_source: { type: 'fluid', burns_fluid: false } })).toEqual({})
    expect(burnerFuel({ energy_source: { type: 'fluid' } })).toEqual({})
  })
})

describe('attachFuel with fluid burners', () => {
  it('sets fluid fuel values and turns a void burning machine into a fluid-burner', () => {
    const bundle = makeFluidBundle()
    const out = attachFuel(bundle.items, bundle.machines, makeFluidRaw(), ['item'])
    expect(out.items.oil).toMatchObject({ fuelValueKj: 300 })
    expect(out.items.water).toBe(bundle.items.water)
    expect(out.machines['fluid-furnace']).toMatchObject({ energyType: 'fluid-burner', effectivity: 0.5 })
    expect(out.machines['fluid-furnace']).not.toHaveProperty('fuelCategories')
    expect(out.machines.steamer).toBe(bundle.machines.steamer)
    expect(out.machines.boiler).toBe(bundle.machines.boiler)
    expect(out.counts).toMatchObject({ fluids: 1, fluidMachines: 1 })
    expect(out.missingMachines).toEqual(['gone'])
  })

  it('is idempotent and keeps references when unchanged', () => {
    const bundle = makeFluidBundle()
    const once = attachFuel(bundle.items, bundle.machines, makeFluidRaw(), ['item'])
    const twice = attachFuel(once.items, once.machines, makeFluidRaw(), ['item'])
    expect(twice.items).toEqual(once.items)
    expect(twice.machines).toEqual(once.machines)
    expect(twice.items.oil).toBe(once.items.oil)
  })

  it('drops a stale fluid fuel value', () => {
    const bundle = makeFluidBundle()
    bundle.items.water = { ...bundle.items.water, fuelValueKj: 10 }
    const out = attachFuel(bundle.items, bundle.machines, makeFluidRaw(), ['item'])
    expect(out.items.water).not.toHaveProperty('fuelValueKj')
  })

  it('never touches an electric machine', () => {
    const bundle = makeFluidBundle()
    const out = attachFuel(bundle.items, bundle.machines, makeFluidRaw(), ['item'])
    expect(out.machines.asm).toBe(bundle.machines.asm)
  })
})

describe('fuelOverlaps with fluids', () => {
  it('is true for a fluid-burner and a fluid fuel, false without a fluid fuel', () => {
    const bundle = makeFluidBundle()
    const out = attachFuel(bundle.items, { 'fluid-furnace': bundle.machines['fluid-furnace'] }, makeFluidRaw(), ['item'])
    expect(fuelOverlaps(out.items, out.machines)).toBe(true)
    expect(fuelOverlaps(bundle.items, out.machines)).toBe(false)
  })
})
