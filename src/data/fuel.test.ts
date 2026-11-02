import { describe, it, expect } from 'vitest'
import { acceptedFuels, defaultFuel, resolveRowFuel } from './fuel'
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
