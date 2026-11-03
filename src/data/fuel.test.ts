import { describe, it, expect } from 'vitest'
import { acceptedFuels, burnsFuel, defaultFuel, resolveRowFuel } from './fuel'
import type { GameData, Item, Machine } from './types'

function item(id: string, extra: Partial<Item> = {}): Item {
  return { id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', ...extra }
}

function burner(extra: Partial<Machine> = {}): Machine {
  return {
    id: 'furnace', name: 'furnace', type: 'furnace', craftingSpeed: 1, energyUsageKw: 90, energyType: 'burner',
    drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['smelting'], iconPath: '', hidden: false,
    fuelCategories: ['chemical'], ...extra,
  }
}

function fluidBurner(extra: Partial<Machine> = {}): Machine {
  return burner({ id: 'fluid-furnace', energyType: 'fluid-burner', fuelCategories: undefined, ...extra })
}

function makeGameData(): GameData {
  const items = [
    item('wood', { fuelValueKj: 2000, fuelCategory: 'chemical' }),
    item('coal', { fuelValueKj: 4000, fuelCategory: 'chemical' }),
    item('solid-fuel', { fuelValueKj: 12000, fuelCategory: 'chemical' }),
    item('alpha-fuel', { fuelValueKj: 4000, fuelCategory: 'chemical' }),
    item('hidden-fuel', { fuelValueKj: 1000, fuelCategory: 'chemical', hidden: true }),
    item('uranium', { fuelValueKj: 8000, fuelCategory: 'nuclear' }),
    item('burnt-fuel', { fuelValueKj: 500, fuelCategory: 'chemical', burntResult: 'ash' }),
    item('plate'),
    item('fuel-oil', { type: 'fluid' }),
    item('crude', { type: 'fluid', fuelValueKj: 100 }),
    item('oil', { type: 'fluid', fuelValueKj: 300 }),
    item('hidden-gas', { type: 'fluid', fuelValueKj: 50, hidden: true }),
  ]
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: Object.fromEntries(items.map(i => [i.id, i])),
    recipes: {},
    machines: { furnace: burner() },
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

describe('acceptedFuels', () => {
  it('keeps visible fuels of an accepted category without burnt result, lowest value first then id', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, gd.machines.furnace).map(i => i.id)).toEqual(['wood', 'alpha-fuel', 'coal', 'solid-fuel'])
  })

  it('follows the machine categories', () => {
    const gd = makeGameData()
    const m = burner({ fuelCategories: ['nuclear'] })
    expect(acceptedFuels(gd, m).map(i => i.id)).toEqual(['uranium'])
  })

  it('is empty for an electric machine or one without fuel data', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, burner({ energyType: 'electric' }))).toEqual([])
    expect(acceptedFuels(gd, burner({ fuelCategories: undefined }))).toEqual([])
    expect(acceptedFuels(gd, burner({ fuelCategories: [] }))).toEqual([])
  })
})

describe('defaultFuel', () => {
  it('is the lowest-value accepted fuel', () => {
    const gd = makeGameData()
    expect(defaultFuel(gd, gd.machines.furnace)?.id).toBe('wood')
  })
})

describe('resolveRowFuel', () => {
  it('returns the explicit choice when the machine accepts it', () => {
    const gd = makeGameData()
    expect(resolveRowFuel(gd, gd.machines.furnace, 'solid-fuel')?.id).toBe('solid-fuel')
  })

  it('falls back to the default for an unknown, unaccepted or missing choice', () => {
    const gd = makeGameData()
    for (const choice of ['nope', 'uranium', 'hidden-fuel', 'burnt-fuel', 'plate', undefined]) {
      expect(resolveRowFuel(gd, gd.machines.furnace, choice)?.id, String(choice)).toBe('wood')
    }
  })

  it('is undefined for an electric machine, no machine, or a burner without fuel data', () => {
    const gd = makeGameData()
    expect(resolveRowFuel(gd, burner({ energyType: 'electric' }), 'coal')).toBeUndefined()
    expect(resolveRowFuel(gd, undefined, 'coal')).toBeUndefined()
    expect(resolveRowFuel(gd, burner({ fuelCategories: undefined }), 'coal')).toBeUndefined()
    expect(resolveRowFuel({ ...gd, items: {} }, gd.machines.furnace, 'coal')).toBeUndefined()
  })
})

describe('acceptedFuels cache', () => {
  it('serves two machines of different categories from the same item table', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, gd.machines.furnace).map(i => i.id)).toContain('coal')
    expect(acceptedFuels(gd, burner({ fuelCategories: ['nuclear'] })).map(i => i.id)).toEqual(['uranium'])
    expect(acceptedFuels(gd, gd.machines.furnace)).not.toContainEqual(expect.objectContaining({ id: 'uranium' }))
  })
})

describe('fluid burners', () => {
  it('burnsFuel is true for burners and fluid burners only', () => {
    expect(burnsFuel(burner())).toBe(true)
    expect(burnsFuel(fluidBurner())).toBe(true)
    expect(burnsFuel(burner({ energyType: 'void' }))).toBe(false)
    expect(burnsFuel(undefined)).toBe(false)
  })

  it('accepts visible fluids with a fuel value, lowest value first, default the lowest', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, fluidBurner()).map(i => i.id)).toEqual(['crude', 'oil'])
    expect(defaultFuel(gd, fluidBurner())?.id).toBe('crude')
  })

  it('is narrowed to the filter fluid', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, fluidBurner({ fuelFluid: 'oil' })).map(i => i.id)).toEqual(['oil'])
    expect(acceptedFuels(gd, fluidBurner({ fuelFluid: 'fuel-oil' }))).toEqual([])
  })

  it('offers nothing without fluid fuel values or for a void machine', () => {
    const gd = makeGameData()
    const bare = { ...gd, items: Object.fromEntries(Object.entries(gd.items).filter(([, i]) => i.type === 'item')) }
    expect(acceptedFuels(bare, fluidBurner())).toEqual([])
    expect(acceptedFuels(gd, burner({ energyType: 'void' }))).toEqual([])
  })

  it('does not leak items to fluid burners or fluids to burners', () => {
    const gd = makeGameData()
    expect(acceptedFuels(gd, fluidBurner()).every(i => i.type === 'fluid')).toBe(true)
    expect(acceptedFuels(gd, gd.machines.furnace).every(i => i.type === 'item')).toBe(true)
  })

  it('resolveRowFuel honours a valid fluid id and falls back for an item id', () => {
    const gd = makeGameData()
    expect(resolveRowFuel(gd, fluidBurner(), 'oil')?.id).toBe('oil')
    expect(resolveRowFuel(gd, fluidBurner(), 'coal')?.id).toBe('crude')
    expect(resolveRowFuel(gd, fluidBurner(), 'hidden-gas')?.id).toBe('crude')
  })
})
