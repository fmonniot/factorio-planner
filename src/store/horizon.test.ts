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
