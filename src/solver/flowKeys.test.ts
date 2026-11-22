import { describe, it, expect } from 'vitest'
import { buildClassifiedSystem } from './build'
import { expandToKeys, keyCaps, noFittingTemperature } from './flowKeys'
import type { GameData } from '../data/types'

type R = GameData['recipes'][string]
const fluid = (itemId: string, amount: number, extra: object = {}) => ({ itemId, type: 'fluid' as const, amount, ...extra })
const recipe = (id: string, ingredients: R['ingredients'], products: R['products']): R => ({
  id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [],
  allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
})
const gameData = (recipes: R[]) => ({
  factorioVersion: '2.0.0', modSet: {}, items: {}, recipes: Object.fromEntries(recipes.map(r => [r.id, r])), machines: {}, modules: {}, beacons: {},
  defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
}) as GameData

const boiler = recipe('boiler', [], [fluid('steam', 60, { temperature: 165 })])
const turbine = recipe('turbine', [fluid('steam', 60, { minimumTemperature: 465 })], [{ itemId: 'work', type: 'item', amount: 1 }])
const turbine2 = recipe('turbine2', [fluid('steam', 60, { minimumTemperature: 465 })], [{ itemId: 'work2', type: 'item', amount: 1 }])
const engine = recipe('engine', [fluid('steam', 60)], [{ itemId: 'work3', type: 'item', amount: 1 }])
const system = (goals: [string, number][] = [['work', 1]]) =>
  buildClassifiedSystem(gameData([boiler, turbine, turbine2, engine]), ['boiler', 'turbine', 'turbine2', 'engine'], new Map(goals))

describe('flow keys of a system', () => {
  it('splits the fluid into a made temperature and the ranges taken, and classifies them', () => {
    const sys = system()
    expect([...sys.flow!.keysOf.get('steam')!]).toEqual(['steam@165', 'steam[465,]', 'steam[,]'])
    expect(sys.classification.intermediates.has('steam@165'), 'a temperature something converts').toBe(true)
    expect(sys.classification.intermediates.has('steam[465,]'), 'a range of a fluid the block makes').toBe(true)
    expect([...sys.flow!.conversions.keys()], 'only 165 fits the unbounded row').toEqual(['conv:steam@165→steam[,]'])
  })

  it('expandToKeys replaces a split id by all its keys, minus those with an own entry', () => {
    const sys = system()
    expect([...expandToKeys(sys, ['steam', 'other'])].sort()).toEqual(['other', 'steam@165', 'steam[,]', 'steam[465,]'].sort())
    expect([...expandToKeys(sys, ['steam'], { 'steam[,]': {} })].sort()).toEqual(['steam@165', 'steam[465,]'])
  })

  it('keyCaps gives each range key the offer and skips a goal key', () => {
    const sys = system([['work', 1], ['steam', 5]])
    const caps = keyCaps(sys, new Map([['steam', 100], ['plate', 7]]))
    expect([...caps].sort()).toEqual([['plate', 7], ['steam[465,]', 100]])
  })

  it('noFittingTemperature merges two rows of one range', () => {
    const sys = system()
    const warnings = noFittingTemperature(sys, new Set(['steam[465,]']), id => id)
    expect(warnings).toEqual([{ type: 'no-fitting-temperature', itemId: 'steam', min: 465, recipeIds: ['turbine', 'turbine2'] }])
    expect(noFittingTemperature(sys, new Set(), id => id), 'an importable range needs no warning').toEqual([])
  })
})
