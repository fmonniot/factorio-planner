import { describe, it, expect } from 'vitest'
import { itemMakers } from './sourcesMakers'
import { makeEmptyBlock } from '../../store/blockStore'
import type { GameData, SolverResult, GameRecipeNode } from '../../data/types'

describe('itemMakers of an area', () => {
  const recipe = (id: string) => ({
    id, name: id, category: 'c', craftingTime: 1, ingredients: [], madeIn: [], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '', products: [{ itemId: 'x', type: 'item' as const, amount: 1 }],
  })
  const data = {
    factorioVersion: '2.0.0', modSet: {}, items: {}, recipes: { a: recipe('a'), b: recipe('b') },
    machines: { m: { id: 'm', name: 'Machine', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric', drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['c'], iconPath: '', hidden: false } },
    modules: {}, beacons: {}, defaultMachines: { c: 'm' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
  const row = (id: string, recipeId: string): GameRecipeNode => ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} })
  const sub = (id: string, nodes: GameRecipeNode[]) => ({ id, name: id, nodes, subPlans: [], area: true, createdAt: '', updatedAt: '' })

  function block() {
    const b = makeEmptyBlock('B')
    b.rootPlan.subPlans = [sub('L', [row('l1', 'a')]), sub('M', [row('m1', 'b')])]
    return b
  }

  it('keeps only the rows of the area', () => {
    expect(itemMakers(block(), data, undefined, 'x', 'L').map(m => m.recipeName)).toEqual(['a'])
    expect(itemMakers(block(), data, undefined, 'x', 'M').map(m => m.recipeName)).toEqual(['b'])
    expect(itemMakers(block(), data, undefined, 'x').map(m => m.recipeName)).toEqual(['a', 'b'])
  })

  it('is empty for an unknown area', () => {
    expect(itemMakers(block(), data, undefined, 'x', 'nope')).toEqual([])
  })
})

describe('itemMakers', () => {
  function gameData(): GameData {
    return {
      factorioVersion: '2.0.0', modSet: {}, items: {},
      recipes: {
        a: {
          id: 'a', name: 'A', category: 'c', craftingTime: 1, ingredients: [], madeIn: [], allowProductivity: false, hidden: false,
          mainProduct: undefined, subgroup: '', order: '',
          products: [{ itemId: 'x', type: 'item', amount: 1 }, { itemId: 'y', type: 'item', amount: 1 }],
        },
      },
      machines: { m: { id: 'm', name: 'Machine', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric', drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['c'], iconPath: '', hidden: false } },
      modules: {}, beacons: {}, defaultMachines: { c: 'm' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
    }
  }
  const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'a', modules: [], byproductPolicy: {} }

  it('marks the co-product of a row as a byproduct and reads the solved rate and machines', () => {
    const block = makeEmptyBlock('B')
    block.rootPlan.nodes = [node]
    const result: SolverResult = {
      nodes: [{ recipeNodeId: 'n1', inputRates: {}, outputRates: { x: 60, y: 30 }, throughput: 60, machineCountExact: 1.5, machineCountCeil: 2, powerKw: 0 }],
      unsatisfied: [], warnings: [],
    }
    expect(itemMakers(block, gameData(), result, 'x')).toEqual([
      { recipeName: 'A', machineName: 'Machine', machineCount: 2, rate: 60, byproduct: false },
    ])
    expect(itemMakers(block, gameData(), result, 'y')[0]).toMatchObject({ byproduct: true, rate: 30 })
    expect(itemMakers(block, gameData(), result, 'z')).toEqual([])
  })
})
