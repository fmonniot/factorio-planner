import { describe, it, expect } from 'vitest'
import { solve } from './index'
import { solve as solveV1 } from '../v1/index'
import type { GameData, GameRecipeNode } from '../../data/types'

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

function item(itemId: string, amount: number) {
  return { itemId, type: 'item' as const, amount }
}

function product(itemId: string, amount: number) {
  return { itemId, type: 'item' as const, amount }
}

function recipe(
  id: string,
  craftingTime: number,
  ingredients: { itemId: string; type: 'item'; amount: number }[],
  products: { itemId: string; type: 'item'; amount: number }[],
): GameData['recipes'][string] {
  return {
    id, name: id, category: 'crafting', craftingTime,
    ingredients, products, madeIn: [], allowProductivity: false,
    mainProduct: undefined, hidden: false,
  }
}

function planNode(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

const TOLERANCE = 1e-4

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('v2 solver — basic cases', () => {
  it('trivial 1-recipe / 1-goal plan: rates correct', () => {
    const gameData = makeGameData({
      recipes: {
        'iron-plate': recipe('iron-plate', 1, [], [product('iron-plate', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [planNode('n1', 'iron-plate')],
    }
    const result = solve(plan, gameData)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].throughput).toBeCloseTo(60, 3)
    expect(result.nodes[0].outputRates['iron-plate']).toBeCloseTo(60, 3)
  })

  it('2-recipe chain: rates correct', () => {
    const gameData = makeGameData({
      recipes: {
        'iron-plate': recipe('iron-plate', 1, [item('iron-ore', 1)], [product('iron-plate', 1)]),
        'iron-ore': recipe('iron-ore', 1, [], [product('iron-ore', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 120 }],
      nodes: [planNode('n1', 'iron-plate'), planNode('n2', 'iron-ore')],
    }
    const result = solve(plan, gameData)
    const byRecipe = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    expect(byRecipe.get('n1')!.throughput).toBeCloseTo(120, 3)
    expect(byRecipe.get('n2')!.throughput).toBeCloseTo(120, 3)
  })

  it('plan that v1 also solves correctly: v2 matches v1 within tolerance', () => {
    const gameData = makeGameData({
      recipes: {
        'wire': recipe('wire', 1, [item('copper-cable', 2)], [product('wire', 1)]),
        'copper-cable': recipe('copper-cable', 1, [item('copper-plate', 1)], [product('copper-cable', 2)]),
        'copper-plate': recipe('copper-plate', 1, [], [product('copper-plate', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'wire', rate: 60 }],
      nodes: [
        planNode('n1', 'wire'),
        planNode('n2', 'copper-cable'),
        planNode('n3', 'copper-plate'),
      ],
    }
    const v2 = solve(plan, gameData)
    const v1 = solveV1(plan, gameData)

    const v2Map = new Map(v2.nodes.map(n => [n.recipeNodeId, n.throughput]))
    const v1Map = new Map(v1.nodes.map(n => [n.recipeNodeId, n.throughput]))

    for (const nodeId of ['n1', 'n2', 'n3']) {
      const v2Rate = v2Map.get(nodeId)!
      const v1Rate = v1Map.get(nodeId)!
      const rel = v1Rate === 0 ? Math.abs(v2Rate) : Math.abs(v2Rate - v1Rate) / v1Rate
      expect(rel, `node ${nodeId} relative difference`).toBeLessThanOrEqual(TOLERANCE)
    }
  })

  it('throws when plan has byproduct-consumer recipes', () => {
    const gameData = makeGameData({
      recipes: {
        'iron-plate': recipe('iron-plate', 1, [], [product('iron-plate', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [{ ...planNode('n1', 'iron-plate'), byproductConsumer: true }],
    }
    expect(() => solve(plan, gameData)).toThrow(/not implemented/)
  })
})
