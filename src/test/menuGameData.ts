import type { GameData } from '../data/types'

/**
 * A small loaded data set for the workspace menu tests: one mod beyond the
 * built-in ones, one visible and one hidden recipe, a crafting category with two
 * machines and a smelting category with one. A fresh object on every call.
 */
export function makeMenuGameData(): GameData {
  const machine = (id: string, name: string, category: string) => ({
    id, name, type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 75,
    energyType: 'electric', drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: [category],
    iconPath: '', hidden: false,
  })
  const recipe = (id: string, hidden: boolean) => ({
    id, name: id, category: 'crafting', craftingTime: 1, ingredients: [],
    products: [{ itemId: 'plate', type: 'item', amount: 1 }], madeIn: ['asm1'],
    allowProductivity: false, hidden, mainProduct: undefined, subgroup: '', order: '',
  })
  return {
    factorioVersion: '2.0.0',
    modSet: { base: '2.0.0', 'elevated-rails': '2.0.0', modA: '1.0.0' },
    items: {},
    recipes: { r1: recipe('r1', false), r2: recipe('r2', true) },
    machines: {
      asm1: machine('asm1', 'Assembler 1', 'crafting'),
      asm2: machine('asm2', 'Assembler 2', 'crafting'),
      furnace: machine('furnace', 'Furnace', 'smelting'),
    },
    modules: {},
    beacons: {},
    defaultMachines: { crafting: 'asm1', smelting: 'furnace' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  } as unknown as GameData
}
