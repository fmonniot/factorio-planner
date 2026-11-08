import { describe, it, expect } from 'vitest'
import { horizonFor } from './horizon'
import type { GameData } from '../data/types'

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

const NO_OVERRIDES: Record<string, string> = {}

function makeGameDataWithMachines(): GameData {
  const machine = (id: string) => ({
    id, name: id, craftingSpeed: 1, craftingCategories: ['crafting'], moduleSlots: 0,
    energyUsageKw: 0, allowedEffects: [], hidden: false, iconPath: '',
  })
  return {
    ...makeGameData(),
    machines: { asm1: machine('asm1'), asm2: machine('asm2') } as unknown as GameData['machines'],
    defaultMachines: { crafting: 'asm1' },
  }
}

describe('horizonFor', () => {
  it('returns the same object for the same gameData, targets array and overrides', () => {
    const d = makeGameData()
    const targets = ['a']
    expect(horizonFor(d, targets, NO_OVERRIDES)).toBe(horizonFor(d, targets, NO_OVERRIDES))
  })
  it('recomputes for a new targets array and for a different gameData', () => {
    const d = makeGameData()
    const first = horizonFor(d, ['a'], NO_OVERRIDES)
    expect(horizonFor(d, ['a'], NO_OVERRIDES)).not.toBe(first)
    const targets = ['a']
    expect(horizonFor(makeGameData(), targets, NO_OVERRIDES)).not.toBe(horizonFor(d, targets, NO_OVERRIDES))
  })
  it('changing only the overrides keeps the recipe ids and changes the default machines', () => {
    const d = makeGameDataWithMachines()
    const targets: string[] = []
    const before = horizonFor(d, targets, NO_OVERRIDES)
    const after = horizonFor(d, targets, { crafting: 'asm2' })
    expect(after).not.toBe(before)
    expect(after.recipeIds).toBe(before.recipeIds)
    expect(before.defaultMachines.crafting).toBe('asm1')
    expect(after.defaultMachines.crafting).toBe('asm2')
  })
  it('keeps the default fuels when only the machine overrides change', () => {
    const fuel = (id: string, fuelValueKj: number) => ({
      id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', fuelValueKj, fuelCategory: 'chemical',
    })
    const d: GameData = {
      ...makeGameDataWithMachines(),
      items: { wood: fuel('wood', 2000), coal: fuel('coal', 4000) } as unknown as GameData['items'],
      recipes: {
        'r-wood': {
          id: 'r-wood', name: 'r-wood', category: 'crafting', craftingTime: 1, ingredients: [],
          products: [{ itemId: 'wood', type: 'item', amount: 1 }],
          madeIn: [], allowProductivity: false, hidden: false, mainProduct: undefined, subgroup: '', order: '',
        },
      },
      technologies: {
        base: { id: 'base', name: 'base', prerequisites: [], unlockedRecipes: [], iconPath: '' },
        forestry: { id: 'forestry', name: 'forestry', prerequisites: [], unlockedRecipes: ['r-wood'], iconPath: '' },
      },
    }
    d.machines.asm1 = { ...d.machines.asm1, energyType: 'burner', fuelCategories: ['chemical'] }
    const targets = ['base']
    expect(horizonFor(d, targets, NO_OVERRIDES).defaultFuels).toEqual({ asm1: 'coal' })
    expect(horizonFor(d, targets, { crafting: 'asm2' }).defaultFuels).toEqual({ asm1: 'coal' })
  })
  it('empty overrides give back the base horizon', () => {
    const d = makeGameDataWithMachines()
    const targets: string[] = []
    const base = horizonFor(d, targets, NO_OVERRIDES)
    horizonFor(d, targets, { crafting: 'asm2' })
    const again = horizonFor(d, targets, {})
    expect(again.defaultMachines).toBe(d.defaultMachines)
    expect(again.recipeIds).toBe(base.recipeIds)
  })
})
