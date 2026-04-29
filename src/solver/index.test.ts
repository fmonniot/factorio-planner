import { describe, it, expect } from 'vitest'
import { solve } from './index'
import type { GameData, SubPlan, GameRecipeNode } from '../data/types'

function makeGameData(overrides: Partial<GameData> = {}): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    defaultMachines: {},
    ...overrides,
  }
}

function product(itemId: string, amount: number) {
  return { itemId, type: 'item' as const, amount }
}

function recipe(
  id: string,
  craftingTime: number,
  ingredients: GameData['recipes'][string]['ingredients'],
  products: GameData['recipes'][string]['products'],
): GameData['recipes'][string] {
  return {
    id,
    name: id,
    category: 'crafting',
    craftingTime,
    ingredients,
    products,
    madeIn: [],
    allowProductivity: false,
    mainProduct: undefined,
    hidden: false,
  }
}

function planNode(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

const ironRecipe = recipe('iron-plate', 1, [], [product('iron-plate', 1)])
const simpleGameData = makeGameData({ recipes: { 'iron-plate': ironRecipe } })
const simplePlan: Pick<SubPlan, 'goals' | 'nodes'> = {
  goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
  nodes: [planNode('n1', 'iron-plate')],
}

describe('solve', () => {
  it('returns a node with positive throughput for a simple plan', () => {
    const result = solve(simplePlan, simpleGameData)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].throughput).toBeGreaterThan(0)
  })

  it('respects a pinned rate', () => {
    const pinnedPlan = {
      ...simplePlan,
      nodes: [{ ...simplePlan.nodes[0]!, pinnedRate: 80 }],
    }
    const result = solve(pinnedPlan, simpleGameData)
    expect(result.nodes[0].throughput).toBeCloseTo(80, 3)
  })
})
