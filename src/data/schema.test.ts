import { describe, it, expect } from 'vitest'
import { ItemSchema, RecipeSchema, MachineSchema, BeaconEntitySchema, GameRecipeNodeSchema, GameDataSchema } from './schema'

const base = { id: 'x', name: 'X', type: 'item', iconPath: '/i/x.png' }

describe('ItemSchema.iconColor', () => {
  it('keeps a valid colour', () => {
    expect(ItemSchema.parse({ ...base, iconColor: '#da1212' }).iconColor).toBe('#da1212')
  })

  it('reads a malformed colour as absent instead of failing the item', () => {
    for (const bad of ['#DA1212', '#fff', null, 42]) {
      expect(ItemSchema.parse({ ...base, iconColor: bad }).iconColor).toBeUndefined()
    }
  })
})

describe('allowedModuleCategories', () => {
  const machine = {
    id: 'm', name: 'M', type: 'assembling-machine', energyUsageKw: 1, energyType: 'electric', drainKw: 0,
    moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: [], iconPath: '',
  }
  const beacon = { id: 'b', name: 'B', iconPath: '', moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed'] }

  it('parses with and without the field (absent = every category)', () => {
    expect(MachineSchema.parse(machine).allowedModuleCategories).toBeUndefined()
    expect(MachineSchema.parse({ ...machine, allowedModuleCategories: ['speed'] }).allowedModuleCategories).toEqual(['speed'])
    expect(MachineSchema.parse({ ...machine, allowedModuleCategories: [] }).allowedModuleCategories).toEqual([])
    expect(BeaconEntitySchema.parse(beacon).allowedModuleCategories).toBeUndefined()
    expect(BeaconEntitySchema.parse({ ...beacon, allowedModuleCategories: ['speed'] }).allowedModuleCategories).toEqual(['speed'])
  })

  it('rejects a list that is not strings', () => {
    expect(MachineSchema.safeParse({ ...machine, allowedModuleCategories: [1] }).success).toBe(false)
    expect(BeaconEntitySchema.safeParse({ ...beacon, allowedModuleCategories: 'speed' }).success).toBe(false)
  })
})

describe('RecipeSchema.additionalCategories', () => {
  const recipe = {
    id: 'r', name: 'R', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [],
    allowProductivity: false, order: '',
  }
  it('is absent when the recipe has none', () => {
    expect(RecipeSchema.parse(recipe).additionalCategories).toBeUndefined()
  })
  it('round-trips a list and reads a Lua empty table as an empty list', () => {
    expect(RecipeSchema.parse({ ...recipe, additionalCategories: ['electronics'] }).additionalCategories).toEqual(['electronics'])
    expect(RecipeSchema.parse({ ...recipe, additionalCategories: {} }).additionalCategories).toEqual([])
  })
})

describe('GameRecipeNodeSchema.absorberFeeder', () => {
  const node = { kind: 'game-recipe', id: 'n', recipeId: 'r', modules: [], byproductPolicy: {} }
  it('survives parsing; absent stays absent', () => {
    expect(GameRecipeNodeSchema.parse({ ...node, absorberFeeder: true }).absorberFeeder).toBe(true)
    expect('absorberFeeder' in GameRecipeNodeSchema.parse(node)).toBe(false)
  })
})

describe('GameDataSchema item ids', () => {
  const gameData = (ids: string[]) => ({
    factorioVersion: '2.0.0', modSet: {},
    items: Object.fromEntries(ids.map(id => [id, { ...base, id }])),
    recipes: {}, machines: {}, modules: {}, defaultMachines: {},
  })

  it('rejects an id that flow keys reserve', () => {
    for (const id of ['bad@id', 'a[b', 'c]']) {
      expect(GameDataSchema.safeParse(gameData([id])).success, id).toBe(false)
    }
  })

  it('accepts ordinary ids', () => {
    expect(GameDataSchema.safeParse(gameData(['iron-plate', 'power:heat', 'nullius-iron_gear'])).success).toBe(true)
  })
})
