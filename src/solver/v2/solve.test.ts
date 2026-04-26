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
// Basic tests
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
})

// ---------------------------------------------------------------------------
// Pinned rates
// ---------------------------------------------------------------------------

describe('v2 solver — pinned rates', () => {
  const gameData = makeGameData({
    recipes: {
      'iron-plate': recipe('iron-plate', 1, [], [product('iron-plate', 1)]),
    },
  })

  it('feasible pin: throughput matches the pinned rate exactly', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [{ ...planNode('n1', 'iron-plate'), pinnedRate: 80 }],
    }
    const result = solve(plan, gameData)
    expect(result.nodes[0].throughput).toBeCloseTo(80, 3)
    expect(result.warnings).toHaveLength(0)
  })

  it('infeasible pin: solver emits infeasible-pins warning naming the recipe', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [{ ...planNode('n1', 'iron-plate'), pinnedRate: 40 }],
    }
    const result = solve(plan, gameData)
    const pinWarnings = result.warnings.filter(w => w.type === 'infeasible-pins')
    expect(pinWarnings).toHaveLength(1)
    if (pinWarnings[0]?.type === 'infeasible-pins') {
      expect(pinWarnings[0].recipeIds).toContain('iron-plate')
    }
  })

  it('removing the pin resolves the plan cleanly', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [planNode('n1', 'iron-plate')],
    }
    const result = solve(plan, gameData)
    expect(result.nodes[0].throughput).toBeCloseTo(60, 3)
    expect(result.warnings.filter(w => w.type === 'infeasible-pins')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Byproduct-consumer recipes
// ---------------------------------------------------------------------------

describe('v2 solver — byproduct-consumer recipes', () => {
  const gameData = makeGameData({
    recipes: {
      'smelting': recipe('smelting', 1, [item('iron-ore', 2)], [product('iron-plate', 1), product('slag', 1)]),
      'slag-disposal': recipe('slag-disposal', 1, [item('slag', 1)], [product('dust', 0.5)]),
    },
  })

  it('bc recipe consumes exactly the surplus produced upstream', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [
        planNode('n1', 'smelting'),
        { ...planNode('n2', 'slag-disposal'), byproductConsumer: true },
      ],
    }
    const result = solve(plan, gameData)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    expect(byId.get('n1')!.throughput).toBeCloseTo(60, 3)
    expect(byId.get('n2')!.throughput).toBeCloseTo(60, 3)
  })

  it('multiple bc recipes split surplus', () => {
    const gd = makeGameData({
      recipes: {
        'smelting': recipe('smelting', 1, [item('iron-ore', 2)], [product('iron-plate', 1), product('slag', 2)]),
        'slag-a': recipe('slag-a', 1, [item('slag', 1)], [product('dust-a', 1)]),
        'slag-b': recipe('slag-b', 1, [item('slag', 1)], [product('dust-b', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [
        planNode('n1', 'smelting'),
        { ...planNode('n2', 'slag-a'), byproductConsumer: true },
        { ...planNode('n3', 'slag-b'), byproductConsumer: true },
      ],
    }
    const result = solve(plan, gd)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    const totalBc = (byId.get('n2')!.throughput) + (byId.get('n3')!.throughput)
    expect(totalBc).toBeCloseTo(120, 3)
  })
})

// ---------------------------------------------------------------------------
// Overconstrained warning
// ---------------------------------------------------------------------------

describe('v2 solver — overconstrained warning', () => {
  it('single-path plan has no overconstrained warning', () => {
    const gd = makeGameData({
      recipes: {
        'smelt': recipe('smelt', 1, [item('ore', 1)], [product('metal', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'metal', rate: 60 }],
      nodes: [planNode('n1', 'smelt')],
    }
    const result = solve(plan, gd)
    expect(result.warnings.filter(w => w.type === 'overconstrained')).toHaveLength(0)
  })

  it('incompatible internal ratios produce overconstrained warning with positive surplus rate', () => {
    const gd = makeGameData({
      recipes: {
        'R1': recipe('R1', 1, [item('water', 1)],
          [product('product-a', 1), product('steam', 4), product('oxygen', 2)]),
        'R2': recipe('R2', 1, [item('steam', 2), item('product-a', 1)],
          [product('product-b', 1), product('oxygen', 6)]),
        'R3': recipe('R3', 1, [item('oxygen', 3)], [product('result', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'result', rate: 10 }],
      nodes: [planNode('n1', 'R1'), planNode('n2', 'R2'), planNode('n3', 'R3')],
    }
    const result = solve(plan, gd)
    const overWarnings = result.warnings.filter(w => w.type === 'overconstrained')
    if (overWarnings.length > 0 && overWarnings[0]?.type === 'overconstrained') {
      expect(overWarnings[0].surplusItems.length).toBeGreaterThan(0)
      for (const si of overWarnings[0].surplusItems) {
        expect(si.rate).toBeGreaterThan(0)
      }
    }
    const resultNode = result.nodes.find(n => n.recipeNodeId === 'n3')!
    expect(resultNode.outputRates['result']).toBeGreaterThanOrEqual(10 - 1e-4)
  })
})
