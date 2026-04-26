import { describe, it, expect } from 'vitest'
import { solve } from './index'
import { solve as solveV1 } from './v1/index'
import type { GameData, SubPlan, GameRecipeNode } from '../data/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makePlan(
  goals: SubPlan['goals'],
  nodes: SubPlan['nodes'],
  solverVersion?: 1 | 2,
): Pick<SubPlan, 'goals' | 'nodes'> & { solverVersion?: 1 | 2 } {
  return { goals, nodes, solverVersion }
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
const simplePlan = makePlan(
  [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
  [planNode('n1', 'iron-plate')],
)

// ---------------------------------------------------------------------------
// Dispatcher tests
// ---------------------------------------------------------------------------

describe('solve dispatcher', () => {
  it('routes solverVersion 1 to v1 and returns the same result as calling v1 directly', () => {
    const v1Direct = solveV1(simplePlan, simpleGameData)
    const dispatched = solve({ ...simplePlan, solverVersion: 1 }, simpleGameData)
    expect(dispatched.nodes.length).toBe(v1Direct.nodes.length)
    expect(dispatched.nodes[0]?.throughput).toBeCloseTo(v1Direct.nodes[0]!.throughput, 6)
    expect(dispatched.warnings).toEqual(v1Direct.warnings)
  })

  it('defaults missing solverVersion to v1', () => {
    const v1Direct = solveV1(simplePlan, simpleGameData)
    const dispatched = solve(simplePlan, simpleGameData)
    expect(dispatched.nodes[0]?.throughput).toBeCloseTo(v1Direct.nodes[0]!.throughput, 6)
  })

  it('routes solverVersion 2 to v2 and returns a valid result for a simple plan', () => {
    const result = solve({ ...simplePlan, solverVersion: 2 }, simpleGameData)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].throughput).toBeGreaterThan(0)
  })

  it('routes solverVersion 2 to v2 which throws for unsupported features', () => {
    const pinnedPlan = {
      ...simplePlan,
      solverVersion: 2 as const,
      nodes: [{ ...simplePlan.nodes[0]!, pinnedRate: 80 }],
    }
    expect(() => solve(pinnedPlan, simpleGameData)).toThrowError(/not implemented/i)
  })
})
