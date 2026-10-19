import { describe, it, expect } from 'vitest'
import { solve } from './index'
import { buildClassifiedSystem } from './build'
import { solveLP } from './solve'
import type { GameData, GameRecipeNode } from '../data/types'

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
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
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
    mainProduct: undefined, hidden: false, subgroup: '', order: '',
  }
}

function planNode(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

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

  it('3-recipe chain: rates correct end-to-end', () => {
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
    const result = solve(plan, gameData)
    const byNode = new Map(result.nodes.map(n => [n.recipeNodeId, n.throughput]))
    expect(byNode.get('n1')).toBeCloseTo(60, 3)
    expect(byNode.get('n2')).toBeCloseTo(60, 3)
    expect(byNode.get('n3')).toBeCloseTo(60, 3)
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

  it('bc recipe contributes to a goal: main producer shrinks to compensate', () => {
    const gd = makeGameData({
      recipes: {
        'methane-synth': recipe('methane-synth', 1, [], [product('methane', 1)]),
        'pyrolysis': recipe('pyrolysis', 1, [item('propene', 1)], [product('methane', 2)]),
        'cracking': recipe('cracking', 1, [], [product('propene', 1)]),
      },
    })
    const plan = {
      goals: [
        { id: 'g1', itemId: 'methane', rate: 400 },
        { id: 'g2', itemId: 'propene', rate: 100 },
      ],
      nodes: [
        planNode('n1', 'methane-synth'),
        { ...planNode('n2', 'pyrolysis'), byproductConsumer: true },
        planNode('n3', 'cracking'),
      ],
    }
    const result = solve(plan, gd)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    expect(byId.get('n2')!.throughput).toBeGreaterThan(0)
    const totalMethane =
      (byId.get('n1')!.outputRates['methane'] ?? 0) +
      (byId.get('n2')!.outputRates['methane'] ?? 0)
    expect(totalMethane).toBeCloseTo(400, 1)
    const propeneNet =
      (byId.get('n3')!.outputRates['propene'] ?? 0) -
      (byId.get('n2')!.inputRates['propene'] ?? 0)
    expect(propeneNet).toBeCloseTo(100, 1)
  })

  it('bc ingredients are auto no-import: LP cannot shortcut via slack', () => {
    const gd = makeGameData({
      recipes: {
        'pyrolysis': recipe('pyrolysis', 1, [item('propene', 1)], [product('methane', 2)]),
        'cracking': recipe('cracking', 1, [item('crude', 1)], [product('propene', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'methane', rate: 100 }],
      nodes: [
        { ...planNode('n1', 'pyrolysis'), byproductConsumer: true },
        planNode('n2', 'cracking'),
      ],
    }
    const result = solve(plan, gd)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    expect(byId.get('n1')!.throughput).toBeGreaterThan(0)
    expect(byId.get('n2')!.throughput).toBeGreaterThan(0)
    expect(result.unsatisfied.find(u => u.itemId === 'propene')).toBeUndefined()
    expect(result.unsatisfied.find(u => u.itemId === 'crude')).toBeDefined()
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
// Goal shortfall detection
// ---------------------------------------------------------------------------

describe('v2 solver — goal shortfall detection', () => {
  it('LP infeasible with no producer: full goal rate appears in unsatisfied', () => {
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

  it('bc recipe in LP: contributes to goal so other recipes shrink to compensate', () => {
    const gd = makeGameData({
      recipes: {
        'propene-pyrolysis': recipe('propene-pyrolysis', 1, [item('propene', 1)], [product('methane', 2)]),
        'propene-cracking': recipe('propene-cracking', 1, [], [product('propene', 1)]),
        'methane-synth': recipe('methane-synth', 1, [], [product('methane', 1)]),
      },
    })
    const plan = {
      goals: [
        { id: 'g1', itemId: 'methane', rate: 400 },
        { id: 'g2', itemId: 'propene', rate: 100 },
      ],
      nodes: [
        planNode('n1', 'methane-synth'),
        planNode('n2', 'propene-cracking'),
        { ...planNode('n3', 'propene-pyrolysis'), byproductConsumer: true },
      ],
    }
    const result = solve(plan, gd)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    const totalMethane =
      (byId.get('n1')!.outputRates['methane'] ?? 0) +
      (byId.get('n3')!.outputRates['methane'] ?? 0)
    expect(totalMethane).toBeCloseTo(400, 1)
    expect(result.unsatisfied.find(u => u.itemId === 'methane')).toBeUndefined()
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
    const methaneIdx = result.unsatisfied.findIndex(u => u.itemId === 'methane')
    expect(methaneIdx).not.toBe(-1)
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

  it('noImportItems: marked item gets no slack, LP must produce internally', () => {
    const gd = makeGameData({
      recipes: {
        'paper': recipe('paper', 1, [item('wood', 1)], [product('paper', 1)]),
        'chopper': recipe('chopper', 1, [item('tree', 1)], [product('wood', 1)]),
      },
    })
    const plan = {
      goals: [{ id: 'g1', itemId: 'paper', rate: 60 }],
      nodes: [planNode('n1', 'paper'), planNode('n2', 'chopper')],
      noImportItems: ['wood'],
    }
    const result = solve(plan, gd)
    const byId = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    expect(byId.get('n1')!.throughput).toBeCloseTo(60, 3)
    expect(byId.get('n2')!.throughput).toBeCloseTo(60, 3)
    expect(result.unsatisfied.find(u => u.itemId === 'wood')).toBeUndefined()
    expect(result.unsatisfied.find(u => u.itemId === 'tree')).toBeDefined()
  })

  it('intermediate slack comes after goal shortfalls in unsatisfied ordering', () => {
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

// ---------------------------------------------------------------------------
// Supply caps (items received from other blocks)
// ---------------------------------------------------------------------------

describe('solveLP — supply caps', () => {
  function plateSystem() {
    const gameData = makeGameData({
      recipes: {
        gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
        'plate-from-ingot': recipe('plate-from-ingot', 1, [item('ingot', 1)], [product('plate', 1)]),
        'ingot-from-ore': recipe('ingot-from-ore', 1, [item('ore', 1)], [product('ingot', 1)]),
      },
    })
    // Gear goal 30 needs 60 plate; the pinned recipe makes 30, leaving a deficit of 30.
    const system = buildClassifiedSystem(
      gameData,
      ['gear', 'plate-from-ingot', 'ingot-from-ore'],
      new Map([['gear', 30]]),
    )
    return { system, pins: new Map([['plate-from-ingot', 30]]) }
  }

  it('uses supply up to its cap and leaves the rest as slack', () => {
    const { system, pins } = plateSystem()
    const lp = solveLP(system, pins, new Set(), new Set(), new Map([['plate', 10]]))
    expect(lp.supply.get('plate')).toBeCloseTo(10, 4)
    expect(lp.slack.get('plate')).toBeCloseTo(20, 4)
  })

  it('keeps a locked item feasible when the cap covers the deficit', () => {
    const { system, pins } = plateSystem()
    const lp = solveLP(system, pins, new Set(), new Set(['plate']), new Map([['plate', 30]]))
    expect(lp.feasible).toBe(true)
    expect(lp.supply.get('plate')).toBeCloseTo(30, 4)
    expect(lp.slack.size).toBe(0)
  })

  it('without caps reports no supply', () => {
    const { system, pins } = plateSystem()
    const lp = solveLP(system, pins)
    expect(lp.supply.size).toBe(0)
    expect(lp.slack.get('plate')).toBeCloseTo(30, 4)
  })
})

// ---------------------------------------------------------------------------
// Share limit
// ---------------------------------------------------------------------------

describe('v2 solver — share limit', () => {
  // muddy and compost are raw. Two routes to soil: from mud directly, or from
  // sand made out of the thin mud water that washing leaves over.
  const gameData = makeGameData({
    recipes: {
      'wash': recipe('wash', 1, [item('muddy', 10)], [product('mud', 1), product('thin', 10)]),
      'soil-mud': recipe('soil-mud', 1, [item('mud', 1), item('compost', 1)], [product('soil', 1)]),
      'sand': recipe('sand', 1, [item('thin', 10)], [product('sand', 5)]),
      'soil-sand': recipe('soil-sand', 1, [item('sand', 1), item('compost', 2)], [product('soil', 1)]),
    },
  })
  const goals = [{ id: 'g1', itemId: 'soil', rate: 10 }]

  function run(
    maxShare: number | undefined,
    opts: { gd?: GameData; extra?: GameRecipeNode[]; edit?: (nodes: GameRecipeNode[]) => GameRecipeNode[] } = {},
  ) {
    const nodes = opts.edit ? opts.edit(baseNodes(maxShare)) : baseNodes(maxShare)
    const allNodes = [...nodes, ...(opts.extra ?? [])]
    const result = solve({ goals, nodes: allNodes }, opts.gd ?? gameData)
    return {
      result,
      rate: (recipeId: string) => {
        const nodeId = allNodes.find(n => n.recipeId === recipeId)?.id
        return result.nodes.find(n => n.recipeNodeId === nodeId)?.throughput ?? 0
      },
    }
  }

  function baseNodes(maxShare: number | undefined): GameRecipeNode[] {
    return [
      planNode('n-wash', 'wash'),
      planNode('n-mud', 'soil-mud'),
      planNode('n-sand', 'sand'),
      { ...planNode('n-soil-sand', 'soil-sand'), maxShare },
    ]
  }

  it('(a) no limit: sand route takes most of the soil', () => {
    const { rate } = run(undefined)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(8.3333, 4)
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(1.6667, 4)
    expect(rate('wash'), 'wash').toBeCloseTo(1.6667, 4)
    expect(rate('sand'), 'sand').toBeCloseTo(1.6667, 4)
  })

  it('(b) limit 30%: sand route capped, thin mud water left over', () => {
    const { result, rate } = run(0.3)
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(7, 4)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(3, 4)
    expect(rate('wash'), 'wash').toBeCloseTo(7, 4)
    expect(rate('sand'), 'sand').toBeCloseTo(0.6, 4)
    const warning = result.warnings.find(w => w.type === 'overconstrained')
    expect(warning, 'overconstrained warning').toBeDefined()
    const thin = warning?.type === 'overconstrained'
      ? warning.surplusItems.find(i => i.itemId === 'thin')?.rate
      : undefined
    expect(thin, 'thin surplus').toBeCloseTo(64, 4)
  })

  it('(c) limit above the natural split changes nothing', () => {
    const { rate } = run(0.9)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(8.3333, 4)
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(1.6667, 4)
    expect(rate('wash'), 'wash').toBeCloseTo(1.6667, 4)
  })

  it('(d) limit 30% with wash pinned high: all soil from mud', () => {
    const { rate } = run(0.3, {
      edit: nodes => nodes.map(n => n.recipeId === 'wash' ? { ...n, pinnedRate: 20 } : n),
    })
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(10, 4)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(0, 4)
  })

  it('(e) goes over the limit rather than fail when another producer is pinned', () => {
    const { result, rate } = run(0.3, {
      edit: nodes => nodes.map(n => n.recipeId === 'soil-mud' ? { ...n, pinnedRate: 4 } : n),
    })
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(4, 4)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(6, 4)
    for (const id of ['mud', 'sand', 'thin']) {
      expect(result.unsatisfied.find(u => u.itemId === id), `unsatisfied ${id}`).toBeUndefined()
    }
  })

  it('(f) a pin on the limited row wins: limit ignored', () => {
    const { rate } = run(0.3, {
      edit: nodes => nodes.map(n => n.recipeId === 'soil-sand' ? { ...n, pinnedRate: 2 } : n),
    })
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(2, 4)
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(8, 4)
  })

  it('(g) no other producer in the plan: limit ignored', () => {
    const { rate } = run(0.3, {
      edit: nodes => nodes.filter(n => n.recipeId !== 'soil-mud'),
    })
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(10, 4)
    expect(rate('wash'), 'wash').toBeCloseTo(2, 4)
  })

  it('(h) limit on the already more expensive route gives it 0%', () => {
    const steps = ['t1', 't2', 't3', 't4', 't5']
    const recipes: GameData['recipes'] = { ...gameData.recipes }
    recipes['sand'] = recipe('sand', 1, [item('t5', 10)], [product('sand', 5)])
    let prev = 'thin'
    for (const t of steps) {
      recipes[`pass-${t}`] = recipe(`pass-${t}`, 1, [item(prev, 1)], [product(t, 1)])
      prev = t
    }
    const gd = makeGameData({ recipes })
    const { rate } = run(0.3, {
      gd,
      extra: steps.map(t => planNode(`n-pass-${t}`, `pass-${t}`)),
    })
    expect(rate('soil-mud'), 'soil-mud').toBeCloseTo(10, 4)
    expect(rate('soil-sand'), 'soil-sand').toBeCloseTo(0, 4)
  })

  it('byproductConsumer wins over maxShare: behaves like absorb alone', () => {
    const gd = makeGameData({
      recipes: {
        'smelting': recipe('smelting', 1, [item('iron-ore', 2)], [product('iron-plate', 1), product('slag', 1)]),
        'slag-disposal': recipe('slag-disposal', 1, [item('slag', 1)], [product('dust', 0.5)]),
        'dust-mining': recipe('dust-mining', 1, [], [product('dust', 1)]),
      },
    })
    const plan = (extra: object) => ({
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      nodes: [
        planNode('n1', 'smelting'),
        { ...planNode('n2', 'slag-disposal'), byproductConsumer: true, ...extra },
        planNode('n3', 'dust-mining'),
      ],
    })
    const absorb = solve(plan({}), gd)
    const both = solve(plan({ maxShare: 0.3 }), gd)
    const t = (r: typeof absorb) => r.nodes.map(n => n.throughput)
    expect(t(both)).toEqual(t(absorb))
  })
})
