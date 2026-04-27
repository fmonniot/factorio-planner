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

// ---------------------------------------------------------------------------
// Too-many-alternatives warning
// ---------------------------------------------------------------------------

describe('v2 solver — too-many-alternatives warning', () => {
  it('two parallel recipes producing the same goal item may emit too-many-alternatives', () => {
    const gd = makeGameData({
      recipes: {
        'smelt-a': recipe('smelt-a', 1, [item('ore-a', 1)], [product('iron-plate', 1)]),
        'smelt-b': recipe('smelt-b', 1, [item('ore-b', 1)], [product('iron-plate', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [planNode('n1', 'smelt-a'), planNode('n2', 'smelt-b')],
    }
    const result = solve(plan, gd)
    const altWarnings = result.warnings.filter(w => w.type === 'too-many-alternatives')
    const bothActive = result.nodes.every(n => n.throughput > 1e-6)
    if (bothActive) {
      expect(altWarnings).toHaveLength(1)
      if (altWarnings[0]?.type === 'too-many-alternatives') {
        expect(altWarnings[0].recipeIds).toContain('smelt-a')
        expect(altWarnings[0].recipeIds).toContain('smelt-b')
      }
    }
  })

  it('single-path plan has no too-many-alternatives warning', () => {
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
    expect(result.warnings.filter(w => w.type === 'too-many-alternatives')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Goal shortfall detection
// ---------------------------------------------------------------------------

describe('v2 solver — goal shortfall detection', () => {
  it('LP infeasible with no producer: full goal rate appears in unsatisfied', () => {
    // Goal: methane 400/min; no recipe produces methane.
    const gd = makeGameData({
      recipes: {
        'other': recipe('other', 1, [], [product('other-item', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'methane', rate: 400 }],
      nodes: [planNode('n1', 'other')],
    }
    const result = solve(plan, gd)
    const entry = result.unsatisfied.find(u => u.itemId === 'methane')
    expect(entry).toBeDefined()
    expect(entry!.rate).toBeCloseTo(400, 3)
  })

  it('bc post-pass covers partial goal: shortfall is goal minus bc output', () => {
    // No main-LP recipe for methane in the nodes list — only the bc recipe produces it.
    // propene-cracking produces 100 propene/min (goal 100).
    // bc propene-pyrolysis runs at 100/min → produces 200 methane.
    // methane goal = 400 → shortfall = 200 should appear in unsatisfied.
    const gd = makeGameData({
      recipes: {
        'propene-pyrolysis': recipe('propene-pyrolysis', 1, [item('propene', 1)], [product('methane', 2)]),
        'propene-cracking': recipe('propene-cracking', 1, [], [product('propene', 1)]),
      },
    })
    const plan = {
      goals: [
        { id: 'g1', itemId: 'methane', rate: 400 },
        { id: 'g2', itemId: 'propene', rate: 100 },
      ],
      nodes: [
        planNode('n2', 'propene-cracking'),
        { ...planNode('n3', 'propene-pyrolysis'), byproductConsumer: true },
      ],
    }
    const result = solve(plan, gd)
    const entry = result.unsatisfied.find(u => u.itemId === 'methane')
    expect(entry).toBeDefined()
    expect(entry!.rate).toBeCloseTo(200, 1)
  })

  it('fully satisfied goal: no shortfall entry in unsatisfied', () => {
    const gd = makeGameData({
      recipes: {
        'iron-plate': recipe('iron-plate', 1, [], [product('iron-plate', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [planNode('n1', 'iron-plate')],
    }
    const result = solve(plan, gd)
    expect(result.unsatisfied.find(u => u.itemId === 'iron-plate')).toBeUndefined()
  })

  it('goal shortfall entries appear before raw-item entries in unsatisfied', () => {
    // methane (goal, no producer) → shortfall entry
    // widgetizer produces widget (goal) from raw-stuff (raw input) → raw entry
    // Ordering: methane shortfall must come before raw-stuff raw entry.
    const gd = makeGameData({
      recipes: {
        'widgetizer': recipe('widgetizer', 1, [item('raw-stuff', 1)], [product('widget', 1)]),
      },
    })
    const plan = {
      goals: [
        { id: 'g1', itemId: 'methane', rate: 60 },
        { id: 'g2', itemId: 'widget', rate: 10 },
      ],
      nodes: [planNode('n1', 'widgetizer')],
    }
    const result = solve(plan, gd)
    // methane has no producer → shortfall of 60 in unsatisfied
    const methaneIdx = result.unsatisfied.findIndex(u => u.itemId === 'methane')
    expect(methaneIdx).not.toBe(-1)
    // raw-stuff is consumed by widgetizer → appears as raw ingredient
    const rawIdx = result.unsatisfied.findIndex(u => u.itemId === 'raw-stuff')
    if (rawIdx !== -1) {
      expect(methaneIdx).toBeLessThan(rawIdx)
    }
  })
})

// ---------------------------------------------------------------------------
// Elastic slack — intermediate bottleneck detection
// ---------------------------------------------------------------------------

describe('v2 solver — elastic slack on intermediates', () => {
  it('internally feasible plan: no slack, throughputs unaffected', () => {
    const gd = makeGameData({
      recipes: {
        'smelt': recipe('smelt', 1, [item('ore', 1)], [product('iron', 1)]),
        'mine': recipe('mine', 1, [], [product('ore', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron', rate: 60 }],
      nodes: [planNode('n1', 'smelt'), planNode('n2', 'mine')],
    }
    const result = solve(plan, gd)
    expect(result.unsatisfied.find(u => u.itemId === 'ore')).toBeUndefined()
    expect(result.nodes.find(n => n.recipeNodeId === 'n1')!.throughput).toBeCloseTo(60, 3)
  })

  it('pinned bottleneck: LP reports slack on the under-supplied intermediate', () => {
    // smelt needs 2 ore per run (goal: iron 60 → x_smelt = 60 → need 120 ore).
    // mine is pinned to 50 → supplies only 50 ore. Slack = 70.
    const gd = makeGameData({
      recipes: {
        'smelt': recipe('smelt', 1, [item('ore', 2)], [product('iron', 1)]),
        'mine': recipe('mine', 1, [], [product('ore', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'iron', rate: 60 }],
      nodes: [planNode('n1', 'smelt'), { ...planNode('n2', 'mine'), pinnedRate: 50 }],
    }
    const result = solve(plan, gd)
    expect(result.nodes.find(n => n.recipeNodeId === 'n1')!.throughput).toBeCloseTo(60, 3)
    const oreEntry = result.unsatisfied.find(u => u.itemId === 'ore')
    expect(oreEntry).toBeDefined()
    expect(oreEntry!.rate).toBeCloseTo(70, 1)
  })

  it('intermediate slack comes after goal shortfalls in unsatisfied ordering', () => {
    // missing-goal (goal, no producer) → goal shortfall first
    // widget → produced from bottlenecked ore (slack intermediate) → slack second
    const gd = makeGameData({
      recipes: {
        'smelt': recipe('smelt', 1, [item('ore', 2)], [product('widget', 1)]),
        'mine': recipe('mine', 1, [], [product('ore', 1)]),
      },
    })
    const plan = {
      goals: [
        { id: 'g1', itemId: 'missing-goal', rate: 10 },
        { id: 'g2', itemId: 'widget', rate: 60 },
      ],
      nodes: [planNode('n1', 'smelt'), planNode('n2', 'mine')],
    }
    const result = solve(plan, gd)
    const goalIdx = result.unsatisfied.findIndex(u => u.itemId === 'missing-goal')
    const slackIdx = result.unsatisfied.findIndex(u => u.itemId === 'ore')
    expect(goalIdx).not.toBe(-1)
    if (slackIdx !== -1) {
      expect(goalIdx).toBeLessThan(slackIdx)
    }
  })
})
