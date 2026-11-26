import { describe, it, expect } from 'vitest'
import { solve, solveBlock } from './index'
import { buildClassifiedSystem } from './build'
import { BC_BONUS, BIG_M, BYPRODUCTS_FIRST_SLACK_COST, CONVERT_COST, LEFTOVER_COST, buildLPModel, PIN_PROBE_LIMIT, runLP, solveLP, keepIdleWarning, withOrdinaryFallback } from './solve'
import type { GameData, GameRecipeNode, SolverWarning } from '../data/types'

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
    // The elastic solve keeps the pin: the goal is short by what the pin cannot make.
    expect(result.nodes[0].throughput).toBeCloseTo(40, 6)
    expect(result.unsatisfied).toEqual([{ itemId: 'iron-plate', rate: 20 }])
  })

  describe('elastic goals', () => {
    // gear ← 2 plate; plate is locked (no import) and its only row is pinned.
    const data = makeGameData({
      recipes: {
        plate: recipe('plate', 1, [], [product('plate', 1)]),
        gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
      },
    })
    const system = () => buildClassifiedSystem(data, ['plate', 'gear'], new Map([['gear', 25]]))
    const locked = new Set(['plate'])

    it('reports the shortfall of each goal and keeps a lock', () => {
      const lp = solveLP(system(), new Map([['plate', 30]]), new Set(), locked)
      expect(lp.feasible).toBe(true)
      expect(lp.throughput.get('plate')).toBe(30)
      expect(lp.throughput.get('gear')).toBeCloseTo(15, 6)
      expect(lp.shortfall.get('gear')).toBeCloseTo(10, 6)
      expect(lp.slack.size).toBe(0)
      expect(lp.warnings).toEqual([{ type: 'infeasible-pins', recipeIds: ['plate'] }])
    })

    it('reports no shortfall when the plain LP is feasible', () => {
      const lp = solveLP(system(), new Map([['plate', 60]]), new Set(), locked)
      expect(lp.feasible).toBe(true)
      expect(lp.shortfall.size).toBe(0)
      expect(lp.warnings).toEqual([])
    })

    it('keeps goals and recipes apart whose names sanitise alike', () => {
      // `iron-plate` and `iron_plate` share an LP name, as does the recipe `short-iron-plate` with an
      // item-based shortfall name; each goal still gets its own shortfall.
      const twins = makeGameData({
        recipes: {
          'short-iron-plate': recipe('short-iron-plate', 1, [], [product('iron-plate', 1)]),
          other: recipe('other', 1, [], [product('iron_plate', 1)]),
        },
      })
      const sys = buildClassifiedSystem(twins, ['short-iron-plate', 'other'], new Map([['iron-plate', 30], ['iron_plate', 20]]))
      const lp = solveLP(sys, new Map([['short-iron-plate', 10], ['other', 5]]))
      expect(lp.feasible).toBe(true)
      expect(lp.throughput.get('short-iron-plate')).toBe(10)
      expect(lp.shortfall.get('iron-plate')).toBeCloseTo(20, 6)
      expect(lp.shortfall.get('iron_plate')).toBeCloseTo(15, 6)
    })

    it('stays feasible with many short goals', () => {
      // 40 goals, each from its own pinned row at a third of its rate: the bound on the total shortfall
      // must leave room for the solver's rounding of every term.
      const n = 40
      const recipes = Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, recipe(`r${i}`, 1, [], [product(`i${i}`, 1)])]))
      const sys = buildClassifiedSystem(makeGameData({ recipes }), Object.keys(recipes), new Map(Array.from({ length: n }, (_, i) => [`i${i}`, 1 + i / 7])))
      const lp = solveLP(sys, new Map(Array.from({ length: n }, (_, i) => [`r${i}`, (1 + i / 7) / 3])))
      expect(lp.feasible).toBe(true)
      for (let i = 0; i < n; i++) expect(lp.shortfall.get(`i${i}`)).toBeCloseTo((2 * (1 + i / 7)) / 3, 6)
    })

    it('keeps the plain infeasible result when pins conflict whatever the goals', () => {
      // The gear row is pinned at 25 too: it needs 50 locked plate and only 30 are made, so no shortfall
      // of the gear goal can help.
      const lp = solveLP(system(), new Map([['plate', 30], ['gear', 25]]), new Set(), locked)
      expect(lp.feasible).toBe(false)
      expect(lp.shortfall.size).toBe(0)
      expect(lp.warnings).toEqual([{ type: 'infeasible-pins', recipeIds: ['plate', 'gear'], conflict: true }])
    })

    it('names only the pin that binds', () => {
      const withBolt = makeGameData({
        recipes: {
          plate: recipe('plate', 1, [], [product('plate', 1)]),
          gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
          bolt: recipe('bolt', 1, [], [product('bolt', 1)]),
        },
      })
      const sys = buildClassifiedSystem(withBolt, ['plate', 'gear', 'bolt'], new Map([['gear', 25], ['bolt', 5]]))
      const lp = solveLP(sys, new Map([['plate', 30], ['bolt', 5]]), new Set(), locked)
      expect(lp.warnings).toEqual([{ type: 'infeasible-pins', recipeIds: ['plate'] }])
      expect(lp.shortfall.get('gear')).toBeCloseTo(10, 6)
    })

    it('names both pins when each binds', () => {
      const twoRows = makeGameData({
        recipes: {
          plateA: recipe('plateA', 1, [], [product('plate', 1)]),
          plateB: recipe('plateB', 1, [], [product('plate', 1)]),
          gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
        },
      })
      const sys = buildClassifiedSystem(twoRows, ['plateA', 'plateB', 'gear'], new Map([['gear', 25]]))
      const lp = solveLP(sys, new Map([['plateA', 10], ['plateB', 10]]), new Set(), locked)
      expect(lp.warnings).toEqual([{ type: 'infeasible-pins', recipeIds: ['plateA', 'plateB'] }])
    })

    it('names every pin above the probe limit', () => {
      const n = PIN_PROBE_LIMIT + 1
      const recipes = Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, recipe(`r${i}`, 1, [], [product(`i${i}`, 1)])]))
      const sys = buildClassifiedSystem(makeGameData({ recipes }), Object.keys(recipes), new Map(Array.from({ length: n }, (_, i) => [`i${i}`, 3])))
      const pins = new Map(Array.from({ length: n }, (_, i) => [`r${i}`, 1]))
      const lp = solveLP(sys, pins)
      const w = lp.warnings.find(x => x.type === 'infeasible-pins')
      expect(w && 'recipeIds' in w ? w.recipeIds : []).toHaveLength(n)
      expect(w).not.toHaveProperty('conflict')
    })
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
      sourceRules: { 'wood': { importOff: true as const } },
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

  describe('connections first', () => {
    function system(extra: Record<string, ReturnType<typeof recipe>> = {}) {
      const gameData = makeGameData({
        recipes: {
          gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
          'plate-from-ingot': recipe('plate-from-ingot', 1, [item('ingot', 1)], [product('plate', 1)]),
          'ingot-from-ore': recipe('ingot-from-ore', 1, [item('ore', 1)], [product('ingot', 1)]),
          ...extra,
        },
      })
      return buildClassifiedSystem(
        gameData,
        ['gear', 'plate-from-ingot', 'ingot-from-ore', ...Object.keys(extra)],
        new Map([['gear', 30]]),
      )
    }

    it('takes all of an infinite supply before own production', () => {
      const lp = solveLP(system(), new Map(), new Set(), new Set(), new Map([['plate', Infinity]]), new Set(['plate']))
      expect(lp.feasible).toBe(true)
      expect(lp.supply.get('plate')).toBeCloseTo(60, 4)
      expect(lp.throughput.get('plate-from-ingot')).toBeCloseTo(0, 4)
      expect(lp.slack.size).toBe(0)
    })

    it('does not let supply feed a byproduct-consumer recipe', () => {
      const sys = system({ 'plate-burner': recipe('plate-burner', 1, [item('plate', 1)], [product('ash', 1)]) })
      const lp = solveLP(
        sys, new Map(), new Set(['plate-burner']), new Set(), new Map([['plate', Infinity]]), new Set(['plate']),
      )
      expect(lp.feasible).toBe(true)
      expect(lp.supply.get('plate')).toBeCloseTo(60, 4)
      expect(lp.throughput.get('plate-burner')).toBeCloseTo(0, 4)
    })

    it('makes the rest with own recipes when the cap is finite', () => {
      const lp = solveLP(system(), new Map(), new Set(), new Set(), new Map([['plate', 10]]), new Set(['plate']))
      expect(lp.supply.get('plate')).toBeCloseTo(10, 4)
      expect(lp.throughput.get('plate-from-ingot')).toBeCloseTo(50, 4)
    })
  })
})

describe('byproducts first', () => {
  function system() {
    const gameData = makeGameData({
      recipes: {
        gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
        'plate-from-ingot': recipe('plate-from-ingot', 1, [item('ingot', 1)], [product('plate', 1)]),
        'ingot-from-ore': recipe('ingot-from-ore', 1, [item('ore', 1)], [product('ingot', 1)]),
      },
    })
    return buildClassifiedSystem(gameData, ['gear', 'plate-from-ingot', 'ingot-from-ore'], new Map([['gear', 30]]))
  }

  it('gives the item a cheap slack and leaves other slacks at BIG_M', () => {
    const lp = buildLPModel(system(), new Map(), new Set(), new Set(), new Map(), new Set(), new Set(['plate']))
    expect(lp.variables.slack_plate.__obj__).toBe(BYPRODUCTS_FIRST_SLACK_COST)
    expect(lp.variables.slack_ingot.__obj__).toBe(BIG_M)
  })

  it('creates no slack for a locked item', () => {
    const lp = buildLPModel(system(), new Map(), new Set(), new Set(['plate']), new Map(), new Set(), new Set(['plate']))
    expect(lp.variables.slack_plate).toBeUndefined()
  })
})

describe('leftover off', () => {
  function system() {
    const gameData = makeGameData({
      recipes: {
        gear: recipe('gear', 1, [item('plate', 2)], [product('gear', 1)]),
        'plate-from-ingot': recipe('plate-from-ingot', 1, [item('ingot', 1)], [product('plate', 1)]),
        'ingot-from-ore': recipe('ingot-from-ore', 1, [item('ore', 1)], [product('ingot', 1)]),
      },
    })
    return buildClassifiedSystem(gameData, ['gear', 'plate-from-ingot', 'ingot-from-ore'], new Map([['gear', 30]]))
  }
  const build = (ids: string[], elastic = false) =>
    buildLPModel(system(), new Map(), new Set(), new Set(), new Map(), new Set(), new Set(), elastic, new Set(), { leftoverOff: new Set(ids) })
  const rowOf = (lp: ReturnType<typeof build>, name: string) => Object.keys(lp.variables[name]).find(k => k !== '__obj__')!

  it('makes an intermediate row an equality with a priced variable that has no import, stage-one or order price', () => {
    const lp = build(['plate'])
    const row = rowOf(lp, 'leftover_plate')
    expect(lp.constraints[row]).toEqual({ equal: 0 })
    expect(lp.variables.leftover_plate).toEqual({ __obj__: LEFTOVER_COST, [row]: -1 })
    expect(lp.itemToLeftover.get('plate')).toBe('leftover_plate')
    expect(lp.variables.slack_plate.__obj__).toBe(BIG_M)
  })

  it('makes a goal row an equality at the goal rate', () => {
    const lp = build(['gear'])
    expect(lp.constraints[rowOf(lp, 'leftover_gear')]).toEqual({ equal: 30 })
  })

  it('leaves an item outside the set with its inequality', () => {
    const lp = build(['plate'])
    expect(lp.variables.leftover_ingot).toBeUndefined()
    expect(lp.constraints[rowOf(lp, 'slack_ingot')]).toEqual({ min: 0 })
  })

  it('reports the left-over of the solve, and none without a rule', () => {
    // make gives a gear and 2 plates per run; use-plate is in the system (so plate has a row) but use-plate is pinned at 0: 60 plates are left over.
    const gameData = makeGameData({
      recipes: {
        make: recipe('make', 1, [item('ore', 1)], [product('gear', 1), product('plate', 2)]),
        'use-plate': recipe('use-plate', 1, [item('plate', 1)], [product('gadget', 1)]),
      },
    })
    const sys = buildClassifiedSystem(gameData, ['make', 'use-plate'], new Map([['gear', 30]]))
    const none = new Set<string>()
    const pinned = new Map([['use-plate', 0]])
    const withRule = solveLP(sys, pinned, none, none, new Map(), none, none, none, { leftoverOff: new Set(['plate']) })
    expect(withRule.leftover.get('plate')).toBeCloseTo(60, 6)
    expect(solveLP(sys, pinned, none, none, new Map(), none, none, none).leftover.size).toBe(0)
  })

  it('gives a raw item (no row) no variable', () => {
    const lp = build(['ore'])
    expect(lp.itemToLeftover.size).toBe(0)
  })

  it('keeps the shortfall variable of an elastic goal row next to the leftover', () => {
    const lp = build(['gear'], true)
    const row = rowOf(lp, 'leftover_gear')
    const short = Object.values(lp.variables).find(v => v.__short === 1)!
    expect(short[row]).toBe(1)
    expect(lp.variables.leftover_gear[row]).toBe(-1)
  })
})

describe('absorber chains', () => {
  // grow makes the goal and trees; saw (flagged) takes a tree and a saw and gives back most of the saw; make-saw (a feeder) makes a saw
  // from a plate; make-plate makes plates from a roll; use-plate (ordinary) takes a plate.
  function system() {
    const gameData = makeGameData({
      recipes: {
        grow: recipe('grow', 1, [item('seed', 1)], [product('goal', 1), product('tree', 2)]),
        saw: recipe('saw', 1, [item('tree', 1), item('saw', 1)], [product('wood', 8), product('saw', 0.9)]),
        'make-saw': recipe('make-saw', 1, [item('plate', 1)], [product('saw', 1)]),
        'make-plate': recipe('make-plate', 1, [item('roll', 1)], [product('plate', 4)]),
        'use-plate': recipe('use-plate', 1, [item('plate', 1)], [product('gadget', 1)]),
      },
    })
    return buildClassifiedSystem(gameData, ['grow', 'saw', 'make-saw', 'make-plate', 'use-plate'], new Map([['goal', 10], ['gadget', 1]]))
  }

  it('rewards the flagged row, charges a tiny cost to the rows that only feed it and every other row 1', () => {
    const lp = buildLPModel(system(), new Map(), new Set(['saw']))
    expect(lp.absorbers.chain.has('saw'), 'saw in the chain').toBe(true)
    const cost = (id: string) => lp.variables[lp.recipeToVar.get(id)!].__obj__
    expect(cost('saw')).toBe(BC_BONUS)
    expect(cost('make-saw'), 'feeder').toBeGreaterThan(0)
    expect(cost('make-saw'), 'feeder').toBeLessThan(-BC_BONUS / 10)
    expect(cost('make-plate'), 'an ordinary row also uses the plate').toBe(1)
    expect(cost('grow')).toBe(1)
  })

  it('leaves only the flagged rows out of the supply-use row of a connections-first item', () => {
    const useOf = (flagged: string[], id: string) => {
      const lp = buildLPModel(system(), new Map(), new Set(flagged), new Set(), new Map([['plate', 100]]), new Set(['plate']))
      return lp.variables[lp.recipeToVar.get(id)!].supuse_plate
    }
    expect(useOf(['saw'], 'make-saw'), 'the feeder takes supply').toBe(-1)
    expect(useOf(['saw'], 'use-plate'), 'an ordinary row').toBe(-1)
    expect(useOf(['saw', 'make-saw'], 'make-saw'), 'a flagged row').toBeUndefined()
  })

  it('lets a connections-first supply feed a feeder, bounded with an unlimited offer', () => {
    const caps = new Map([['plate', Infinity]])
    const first = new Set(['plate'])
    const lp = buildLPModel(system(), new Map(), new Set(['saw']), new Set(), caps, first)
    expect(runLP('__obj__', lp.constraints, lp.variables).bounded, 'bounded').not.toBe(false)
    const result = solveLP(system(), new Map(), new Set(['saw']), new Set(), caps, first)
    expect(result.throughput.get('saw'), 'saw').toBeCloseTo(20, 6)
    expect(result.throughput.get('make-saw'), 'make-saw').toBeCloseTo(2, 6)
    expect(result.throughput.get('make-plate'), 'make-plate').toBeCloseTo(0, 6)
    expect(result.supply.get('plate'), 'plate received').toBeCloseTo(3, 6)
    expect(result.warnings.some(w => w.type === 'unbounded-absorber')).toBe(false)
  })

  // Rows as [id, ingredients, products]; the system is classified by `buildClassifiedSystem`, as in a block solve.
  type Row = [id: string, ingredients: Record<string, number>, products: Record<string, number>]
  function lpOf(
    rows: Row[], goals: Record<string, number>, flagged: string[], byproductsFirst: string[] = [],
    caps: Map<string, number> = new Map(), first: string[] = [], marked: string[] = [],
  ) {
    const recipes: GameData['recipes'] = {}
    for (const [id, ing, prod] of rows) {
      recipes[id] = recipe(id, 1, Object.entries(ing).map(([i, n]) => item(i, n)), Object.entries(prod).map(([i, n]) => product(i, n)))
    }
    const system = buildClassifiedSystem(makeGameData({ recipes }), rows.map(r => r[0]), new Map(Object.entries(goals)))
    const bf = new Set(byproductsFirst)
    const lp = buildLPModel(system, new Map(), new Set(flagged), new Set(), caps, new Set(first), bf, false, new Set(), { markedFeeders: new Set(marked) })
    const raw = runLP('__obj__', lp.constraints, lp.variables)
    const result = solveLP(system, new Map(), new Set(flagged), new Set(), caps, new Set(first), bf, new Set(marked))
    return { raw, result, lp }
  }
  const GROW: Row = ['grow', { seed: 1 }, { goal: 1, tree: 2 }]
  const SAWING: Row = ['sawr', { tree: 1, saw: 1 }, { wood: 8, saw: 0.9 }]

  it('warns when a rewarded row earns more per run than the trees it takes cost', () => {
    // 150 trees per run: chopping one earns 0.01, so a grow run's 150 chops earn 1.5 against its cost of 1; the objective has no minimum.
    const forest = (trees: number): Row[] => [['grow', { seed: 1 }, { goal: 1, tree: trees }], ['chop', { tree: 1 }, { wood: 1 }]]
    const { raw, result } = lpOf(forest(150), { goal: 10 }, ['chop'])
    expect(raw.bounded, 'raw bounded').toBe(false)
    expect(result.feasible).toBe(true)
    expect(result.warnings).toEqual([{ type: 'unbounded-absorber', recipeIds: ['chop'] }])
  })

  it('does not warn below the limit of 100 trees per run', () => {
    const rows: Row[] = [['grow', { seed: 1 }, { goal: 1, tree: 99 }], ['chop', { tree: 1 }, { wood: 1 }]]
    const { raw, result } = lpOf(rows, { goal: 10 }, ['chop'])
    expect(raw.bounded, 'raw bounded').not.toBe(false)
    expect(result.warnings.filter(w => w.type === 'unbounded-absorber')).toEqual([])
    expect(result.throughput.get('chop'), 'chop').toBeCloseTo(990, 3)
    expect(result.throughput.get('grow'), 'grow').toBeCloseTo(10, 3)
  })

  it('the 150-tree forest is bounded and leaves the saw idle once the rewards are off', () => {
    const rows: Row[] = [['grow', { seed: 1 }, { goal: 1, tree: 150 }], ['chop', { tree: 1 }, { wood: 1 }]]
    const { raw, result } = lpOf(rows, { goal: 10 }, [])
    expect(raw.bounded, 'raw bounded').not.toBe(false)
    expect(result.warnings.filter(w => w.type === 'unbounded-absorber')).toEqual([])
    expect(result.throughput.get('grow'), 'grow').toBeCloseTo(10, 6)
    expect(result.throughput.get('chop') ?? 0, 'chop').toBeCloseTo(0, 6)
  })

  it('keeps the whole chain out when the supply would take a reward away', () => {
    // An ordinary row (mine) makes the roll and burn also takes it; a supply of roll must not reach make-plate, or make-saw would lose its reward.
    const rows: Row[] = [
      GROW, ['make-saw', { plate: 1 }, { saw: 1 }], ['make-plate', { roll: 1 }, { plate: 4 }],
      ['mine', { rock: 1 }, { roll: 1 }], ['burn', { roll: 1 }, { ash: 1 }],
    ]
    for (const cap of [100, Infinity]) {
      const { raw, result, lp } = lpOf(rows, { goal: 10 }, ['make-saw'], [], new Map([['roll', cap]]), ['roll'])
      expect([...lp.absorbers.noSupply].sort(), 'noSupply').toEqual(['make-plate', 'make-saw'])
      expect(raw.bounded, 'bounded').not.toBe(false)
      expect(result.throughput.get('make-saw'), 'make-saw').toBeCloseTo(0, 6)
      expect(result.supply.get('roll'), 'roll received').toBeUndefined()
      expect(lp.shareVars.size, 'no share without a marked feeder').toBe(0)
    }
  })

  // Case 23 n: a marked make-plate also feeds use-plate, which makes the gadget goal; the fallback holds (the roll anchors make-plate).
  const ROWS_N: Row[] = [
    GROW, ['make-saw', { plate: 1 }, { saw: 1 }], ['make-plate', { roll: 1 }, { plate: 4 }], ['use-plate', { plate: 1 }, { gadget: 1 }],
    ['mine', { rock: 1 }, { roll: 1 }], ['burn', { roll: 1 }, { ash: 1 }],
  ]

  it('the fallback still gives a marked feeder supply for its ordinary use', () => {
    for (const cap of [100, Infinity]) {
      const { raw, result, lp } = lpOf(ROWS_N, { goal: 10, gadget: 4 }, ['make-saw'], [], new Map([['roll', cap]]), ['roll'], ['make-plate'])
      expect(raw.bounded, 'bounded').not.toBe(false)
      expect(result.throughput.get('make-plate'), 'make-plate').toBeCloseTo(1, 6)
      expect(result.throughput.get('use-plate'), 'use-plate').toBeCloseTo(4, 6)
      expect(result.throughput.get('mine'), 'mine').toBeCloseTo(0, 6)
      expect(result.throughput.get('make-saw'), 'make-saw').toBeCloseTo(0, 6)
      expect(result.supply.get('roll'), 'roll received').toBeCloseTo(1, 6)
      expect(lp.variables[lp.recipeToVar.get('make-plate')!].supuse_roll, 'the column itself').toBeUndefined()
      expect(lp.variables[lp.shareVars.get('make-plate')!].supuse_roll, 'its share').toBe(-1)
    }
  })

  it('a product another row also makes gets no share: free supply must not feed the chain', () => {
    // grow also makes 0.4 plate per run, so U's 4 plates arrive as a byproduct. Without the mark nothing runs and nothing is received;
    // a share on make-plate would let the roll supply make 4 plates that make-saw takes for its reward.
    const rows: Row[] = ROWS_N.map(r => r[0] === 'grow' ? ['grow', { seed: 1 }, { goal: 1, tree: 2, plate: 0.4 }] as Row : r)
    for (const cap of [100, Infinity]) {
      const { raw, result } = lpOf(rows, { goal: 10, gadget: 4 }, ['make-saw'], [], new Map([['roll', cap]]), ['roll'], ['make-plate'])
      expect(raw.bounded, 'bounded').not.toBe(false)
      expect(result.throughput.get('make-saw'), 'make-saw').toBeCloseTo(0, 6)
      expect(result.throughput.get('make-plate'), 'make-plate').toBeCloseTo(0, 6)
      expect(result.throughput.get('use-plate'), 'use-plate').toBeCloseTo(4, 6)
      expect(result.supply.get('roll') ?? 0, 'roll received').toBeCloseTo(0, 6)
    }
  })

  it('the share reaches the unmarked feeder upstream of a marked feeder', () => {
    const rows: Row[] = [
      GROW, ['make-saw', { plate: 1 }, { saw: 1 }], ['make-plate', { sheet: 1 }, { plate: 4 }], ['make-sheet', { roll: 1 }, { sheet: 1 }],
      ['use-plate', { plate: 1 }, { gadget: 1 }], ['mine', { rock: 1 }, { roll: 1 }], ['burn', { roll: 1 }, { ash: 1 }],
    ]
    const { result } = lpOf(rows, { goal: 10, gadget: 4 }, ['make-saw'], [], new Map([['roll', 100]]), ['roll'], ['make-plate'])
    expect(result.throughput.get('make-sheet'), 'make-sheet').toBeCloseTo(1, 6)
    expect(result.throughput.get('make-plate'), 'make-plate').toBeCloseTo(1, 6)
    expect(result.throughput.get('mine'), 'mine').toBeCloseTo(0, 6)
    expect(result.supply.get('roll'), 'roll received').toBeCloseTo(1, 6)
  })

  it('a goal on the marked feeder product counts as ordinary use', () => {
    const rows: Row[] = [
      GROW, ['make-saw', { plate: 1 }, { saw: 1 }], ['make-plate', { roll: 1 }, { plate: 4 }],
      ['mine', { rock: 1 }, { roll: 1 }], ['burn', { roll: 1 }, { ash: 1 }],
    ]
    const { result } = lpOf(rows, { goal: 10, plate: 4 }, ['make-saw'], [], new Map([['roll', 100]]), ['roll'], ['make-plate'])
    expect(result.throughput.get('make-plate'), 'make-plate').toBeCloseTo(1, 6)
    expect(result.throughput.get('mine'), 'mine').toBeCloseTo(0, 6)
    expect(result.supply.get('roll'), 'roll received').toBeCloseTo(1, 6)
    expect(result.throughput.get('make-saw'), 'make-saw').toBeCloseTo(0, 6)
  })

  it('stays bounded when an item with a byproducts-first rule feeds the chain', () => {
    const rows: Row[] = [
      ['grow', { seed: 1 }, { goal: 1, plate: 1 }],
      ['make-saw', { plate: 1 }, { saw: 1 }],
      ['sawr', { saw: 1, log: 1 }, { wood: 8, saw: 0.9 }],
    ]
    const { raw, result } = lpOf(rows, { goal: 10 }, ['sawr'], ['plate'])
    expect(raw.bounded, 'bounded').not.toBe(false)
    expect(result.throughput.get('sawr'), 'sawr').toBeCloseTo(0, 6)
  })

  it('a flagged row that makes what an ordinary row uses does not pull its feeders ahead of ordinary production', () => {
    const rows: Row[] = [
      ['p', { ore: 1 }, { plate: 1 }],
      ['u', { plate: 1 }, { gadget: 1 }],
      ['rr', { x: 2 }, { plate: 1 }],
      ['f', { roll: 1 }, { x: 1 }],
    ]
    const { result } = lpOf(rows, { gadget: 10 }, ['rr'])
    expect(result.throughput.get('p'), 'p').toBeCloseTo(10, 6)
    expect(result.throughput.get('rr'), 'rr').toBeCloseTo(0, 6)
    expect(result.throughput.get('f'), 'f').toBeCloseTo(0, 6)
  })

  it('hands the chain to the diagnostics through the result', () => {
    const { result } = lpOf([GROW, SAWING, ['make-saw', { roll: 1 }, { saw: 1 }]], { goal: 10 }, ['sawr'])
    expect([...result.absorbers.chain].sort()).toEqual(['make-saw', 'sawr'])
  })

  it('picks the same feeder whatever the order of the rows', () => {
    const a: Row = ['make-saw-a', { roll: 1 }, { saw: 1 }]
    const b: Row = ['make-saw-b', { ore: 100 }, { saw: 1 }]
    for (const rows of [[GROW, SAWING, a, b], [GROW, SAWING, b, a]]) {
      const { result } = lpOf(rows, { goal: 10 }, ['sawr'])
      expect(result.throughput.get('sawr'), 'sawr').toBeCloseTo(20, 6)
      expect(result.throughput.get('make-saw-a'), 'a').toBeCloseTo(2, 6)
      expect(result.throughput.get('make-saw-b'), 'b').toBeCloseTo(0, 6)
    }
  })
})

describe('flow keys of a split fluid in the LP', () => {
  type R = GameData['recipes'][string]
  const fluid = (itemId: string, amount: number, extra: object = {}) => ({ itemId, type: 'fluid' as const, amount, ...extra })
  const fluidRecipe = (id: string, ingredients: R['ingredients'], products: R['products']): R => ({
    id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [], allowProductivity: false,
    mainProduct: undefined, hidden: false, subgroup: '', order: '',
  })
  const out = (itemId: string) => [product(itemId, 1) as unknown as R['products'][number]]
  const system = (recipes: R[], goals: [string, number][], supplyCaps?: Map<string, number>) => {
    const gd = makeGameData({ recipes: Object.fromEntries(recipes.map(r => [r.id, r])) })
    return buildClassifiedSystem(gd, recipes.map(r => r.id), new Map(goals), new Map(), { supplyCaps })
  }
  // `hot` makes 100 used at 300; the filter takes 100 at 50 or less; the heater takes 100 at 250 or more.
  const hot = () => fluidRecipe('hot', [], [fluid('used', 100, { temperature: 300 })])
  const filter = () => fluidRecipe('filter', [fluid('used', 100, { maximumTemperature: 50 })], out('clean'))
  const heater = () => fluidRecipe('heater', [fluid('used', 100, { minimumTemperature: 250 })], out('warm'))

  it('a temperature key has no slack even when the fluid can be imported; its range keys do', () => {
    const sys = system([hot(), filter(), heater()], [['clean', 60], ['warm', 10]])
    const lp = buildLPModel(sys)
    expect(lp.itemToSlack.has('used@300'), 'no slack on a made temperature').toBe(false)
    expect(lp.itemToSlack.has('used[,50]'), 'slack on a range').toBe(true)
    expect(lp.itemToSlack.has('used[250,]'), 'slack on a range').toBe(true)
  })

  it('a conversion costs CONVERT_COST and never runs into a surplus', () => {
    const sys = system([hot(), heater()], [['warm', 1]])
    const conv = [...sys.flow!.conversions.keys()]
    expect(conv).toEqual(['conv:used@300→used[250,]'])
    const lp = buildLPModel(sys, new Map([['hot', 2]]))
    expect(lp.variables[lp.recipeToVar.get(conv[0])!].__obj__).toBe(CONVERT_COST)
    const r = solveLP(sys, new Map([['hot', 2]]))
    // The two runs of `hot` make 200 at 300; the heater needs 100: the conversion moves only that, the rest is surplus.
    expect(r.throughput.get(conv[0])).toBeCloseTo(100, 6)
  })

  describe('the offer of a split fluid is shared by its range keys', () => {
    const recipes = () => [hot(), filter(), heater()]
    const plan = (sourceRules: Record<string, { importOff?: true }> = {}) => ({
      goals: [{ id: 'g0', itemId: 'clean', rate: 1 }, { id: 'g1', itemId: 'warm', rate: 1 }],
      nodes: [planNode('n1', 'filter'), planNode('n2', 'heater')], sourceRules,
    })
    const gd = () => makeGameData({ recipes: Object.fromEntries(recipes().map(r => [r.id, r])) })
    const offer = new Map([['used', 150]])

    it('the group row bounds what the keys receive together', () => {
      // The filter and the heater need 100 each at their ranges and nothing in the block fits; the offer is 150 for both.
      const { result, received } = solveBlock(plan(), gd(), offer)
      expect(received.get('used'), 'received over the keys').toBeCloseTo(150, 6)
      const imported = result.unsatisfied.filter(u => u.itemId === 'used').reduce((t, u) => t + u.rate, 0)
      expect(imported, 'the rest is imported').toBeCloseTo(50, 6)
    })

    it('with Import off the offer is below the residual, so the keys are unlocked and the shortfall is imported', () => {
      const { result, received } = solveBlock(plan({ used: { importOff: true } }), gd(), offer)
      expect(received.get('used')).toBeCloseTo(150, 6)
      expect(result.unsatisfied.filter(u => u.itemId === 'used').reduce((t, u) => t + u.rate, 0)).toBeCloseTo(50, 6)
    })
  })
})

describe('withOrdinaryFallback', () => {
  const unbounded: SolverWarning = { type: 'unbounded-absorber', recipeIds: ['chop'] }
  const pins: SolverWarning = { type: 'infeasible-pins', recipeIds: ['grow'] }
  // A stub pass sequence: `results[0]` for the run with the rewards on, `results[1]` for the ordinary re-solve.
  const stub = (...results: { feasible: boolean; warnings: SolverWarning[] }[]) => {
    const calls: boolean[] = []
    return { calls, run: (ordinary: boolean) => { calls.push(ordinary); return results[calls.length - 1] } }
  }

  it('runs once when the first result is bounded', () => {
    const { calls, run } = stub({ feasible: true, warnings: [] })
    const { lp, ordinary } = withOrdinaryFallback(run)
    expect(calls).toEqual([false])
    expect(ordinary).toBe(false)
    expect(lp.warnings).toEqual([])
  })

  it('swaps unbounded-absorber for absorber-idle (same rows) when the ordinary run is feasible', () => {
    const { calls, run } = stub({ feasible: true, warnings: [unbounded] }, { feasible: true, warnings: [pins] })
    const { lp, ordinary } = withOrdinaryFallback(run)
    expect(calls).toEqual([false, true])
    expect(ordinary).toBe(true)
    expect(lp.warnings, 'after the leading infeasible-pins').toEqual([pins, { type: 'absorber-idle', recipeIds: ['chop'] }])
  })

  it('puts absorber-idle first when there are no pins', () => {
    const { run } = stub({ feasible: true, warnings: [unbounded] }, { feasible: true, warnings: [{ type: 'overconstrained', surplusItems: [] }] })
    expect(withOrdinaryFallback(run).lp.warnings.map(w => w.type)).toEqual(['absorber-idle', 'overconstrained'])
  })

  it('returns the first result when the ordinary run is infeasible', () => {
    const first = { feasible: true, warnings: [unbounded] }
    const { calls, run } = stub(first, { feasible: false, warnings: [] })
    const { lp, ordinary } = withOrdinaryFallback(run)
    expect(calls).toEqual([false, true])
    expect(ordinary).toBe(false)
    expect(lp).toBe(first)
  })

  it('returns the first result when the ordinary run is still unbounded', () => {
    const first = { feasible: true, warnings: [unbounded] }
    const { run } = stub(first, { feasible: true, warnings: [unbounded] })
    const { lp, ordinary } = withOrdinaryFallback(run)
    expect(ordinary).toBe(false)
    expect(lp).toBe(first)
  })

  it('keepIdleWarning puts the warning back on a result of the connection order', () => {
    const idle: SolverWarning = { type: 'absorber-idle', recipeIds: ['chop'] }
    const before = { feasible: true, warnings: [idle] }
    expect(keepIdleWarning(before, { feasible: true, warnings: [] }).warnings).toEqual([idle])
    expect(keepIdleWarning(before, before).warnings, 'same result: no duplicate').toEqual([idle])
  })

  it('keepIdleWarning puts it after a leading infeasible-pins, as withOrdinaryFallback does', () => {
    const idle: SolverWarning = { type: 'absorber-idle', recipeIds: ['chop'] }
    const pins: SolverWarning = { type: 'infeasible-pins', recipeIds: ['plate'] }
    const over: SolverWarning = { type: 'overconstrained', itemIds: [] } as unknown as SolverWarning
    const before = { feasible: true, warnings: [idle] }
    expect(keepIdleWarning(before, { feasible: true, warnings: [pins, over] }).warnings).toEqual([pins, idle, over])
  })
})
