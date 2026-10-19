import { describe, it, expect } from 'vitest'
import { solve, solveBlock, solveAll, flattenBlock, netBalance } from './index'
import type { GameData, GameRecipeNode, ProductionGoal, RecipeNode, Block, SubPlan } from '../data/types'

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
    subgroup: '',
    order: '',
  }
}

function planNode(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

const ironRecipe = recipe('iron-plate', 1, [], [product('iron-plate', 1)])
const simpleGameData = makeGameData({ recipes: { 'iron-plate': ironRecipe } })
const ironGoal: ProductionGoal = { id: 'g1', itemId: 'iron-plate', rate: 60 }
const simplePlan: { goals: ProductionGoal[]; nodes: RecipeNode[] } = {
  goals: [ironGoal],
  nodes: [planNode('n1', 'iron-plate')],
}

function makeSubPlan(name: string, nodes: RecipeNode[], subPlans: SubPlan[] = []): SubPlan {
  const now = new Date().toISOString()
  return { id: name, name, nodes, subPlans, createdAt: now, updatedAt: now }
}

function makeBlock(rootPlan: SubPlan, goals: ProductionGoal[]): Block {
  return {
    id: 'block-1',
    name: 'Block',
    goals,
    noImportItems: [],
    inputConnections: [],
    rootPlan,
  }
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
      nodes: [{ ...(simplePlan.nodes[0] as GameRecipeNode), pinnedRate: 80 } as RecipeNode],
    }
    const result = solve(pinnedPlan, simpleGameData)
    expect(result.nodes[0].throughput).toBeCloseTo(80, 3)
  })
})

// ---------------------------------------------------------------------------
// no-recipe warning
// ---------------------------------------------------------------------------

describe('solve — no-recipe warning', () => {
  it('emits no-recipe warning when a goal item has no producer recipe in the plan', () => {
    const gd = makeGameData({ recipes: { 'iron-plate': ironRecipe } })
    // Goal for copper-plate but no recipe node that produces it.
    const plan = {
      goals: [{ id: 'g1', itemId: 'copper-plate', rate: 60 }],
      nodes: [planNode('n1', 'iron-plate')],
    }
    const result = solve(plan, gd)
    const w = result.warnings.filter(w => w.type === 'no-recipe')
    expect(w).toHaveLength(1)
    if (w[0]?.type === 'no-recipe') expect(w[0].itemId).toBe('copper-plate')
  })

  it('does not emit no-recipe when a recipe node exists for the goal', () => {
    const result = solve(simplePlan, simpleGameData)
    expect(result.warnings.some(w => w.type === 'no-recipe')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// flattenBlock + wrap-in-subplan parity
//
// Regression: moving a recipe into a subplan (purely for organisation) must
// not change solver output. Subplans are a UI/persistence grouping only.
// ---------------------------------------------------------------------------

describe('flattenBlock + solve(block) — subplan grouping is solver-transparent', () => {
  it('a flat block and a block with the same recipe wrapped in a subplan produce identical throughput', () => {
    const ironNode = planNode('n1', 'iron-plate')

    const flatBlock = makeBlock(makeSubPlan('Root', [ironNode]), [ironGoal])

    // Same recipe, but moved into a child subplan referenced from root via a SubPlanNode handle.
    const child = makeSubPlan('Iron Smelting', [ironNode])
    const wrappedBlock = makeBlock(
      {
        ...makeSubPlan('Root', []),
        nodes: [{ kind: 'subplan', id: 'sp-handle', subPlanId: child.id }],
        subPlans: [child],
      },
      [ironGoal],
    )

    const flatResult = solve(flattenBlock(flatBlock), simpleGameData)
    const wrappedResult = solve(flattenBlock(wrappedBlock), simpleGameData)

    expect(wrappedResult.nodes).toHaveLength(1)
    expect(wrappedResult.nodes[0].throughput).toBeCloseTo(flatResult.nodes[0].throughput, 6)
    expect(wrappedResult.nodes[0].recipeNodeId).toBe('n1')
  })

  it('flattenBlock walks nested subplans and surfaces every game-recipe node', () => {
    const a = planNode('a', 'iron-plate')
    const b = planNode('b', 'iron-plate')
    const c = planNode('c', 'iron-plate')
    const grandchild = makeSubPlan('Grandchild', [c])
    const child = makeSubPlan('Child', [b], [grandchild])
    const block = makeBlock(
      {
        ...makeSubPlan('Root', [a]),
        subPlans: [child],
      },
      [ironGoal],
    )
    const plan = flattenBlock(block)
    const ids = plan.nodes.map(n => n.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// Connections between blocks
// ---------------------------------------------------------------------------

const plateRecipe = recipe('plate', 1, [], [product('plate', 1)])
const gearRecipe = recipe('gear', 1, [{ itemId: 'plate', type: 'item', amount: 2 }], [product('gear', 1)])
const ingotRecipe = recipe('ingot', 1, [], [product('ingot', 1)])
const plateFromIngotRecipe = recipe('plateFromIngot', 1, [{ itemId: 'ingot', type: 'item', amount: 1 }], [product('plate', 1)])
const ingotFromOreRecipe = recipe('ingotFromOre', 1, [{ itemId: 'ore', type: 'item', amount: 1 }], [product('ingot', 1)])

function connectionGameData(): GameData {
  return makeGameData({
    recipes: {
      plate: plateRecipe,
      gear: gearRecipe,
      ingot: ingotRecipe,
      plateFromIngot: plateFromIngotRecipe,
      ingotFromOre: ingotFromOreRecipe,
    },
  })
}

function pinned(id: string, recipeId: string, pinnedRate: number): RecipeNode {
  return { ...planNode(id, recipeId), pinnedRate }
}

function rate(items: { itemId: string; rate: number }[], itemId: string): number {
  return items.find(u => u.itemId === itemId)?.rate ?? 0
}

describe('solveBlock — own production first', () => {
  const gearGoal: ProductionGoal[] = [{ id: 'g', itemId: 'gear', rate: 25 }]

  it('supply covers only what a pinned own recipe leaves over', () => {
    const plan = { goals: gearGoal, nodes: [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)] }
    const { result, received } = solveBlock(plan, connectionGameData(), new Map([['plate', 100]]))
    const own = result.nodes.find(n => n.recipeNodeId === 'p')!
    expect(own.throughput).toBeCloseTo(20, 4)
    expect(received.get('plate')).toBeCloseTo(30, 4)
    expect(rate(result.unsatisfied, 'plate'), 'plate is fully covered').toBe(0)
    expect(rate(result.unsatisfied, 'ingot')).toBeCloseTo(20, 4)
  })

  it('does not take supply when the own recipe can cover the need', () => {
    const plan = { goals: gearGoal, nodes: [planNode('g', 'gear'), planNode('p', 'plateFromIngot')] }
    const { result, received } = solveBlock(plan, connectionGameData(), new Map([['plate', 100]]))
    expect(result.nodes.find(n => n.recipeNodeId === 'p')!.throughput).toBeCloseTo(50, 4)
    expect(received.get('plate') ?? 0).toBe(0)
    expect(rate(result.unsatisfied, 'ingot')).toBeCloseTo(50, 4)
  })

  // Pins today's behaviour of the "own production that needs an import" rule, which
  // depends on the recipe ratio (see spec/solver.md). `ingotFromOre` is pinned at 10,
  // so ingot is short, and plate can only come from the ingot.
  describe('own production that needs an upstream import', () => {
    const gd = (ingotPerPlate: number, platesPerRun: number): GameData => {
      const data = connectionGameData()
      data.recipes.plateFromIngot = recipe(
        'plateFromIngot', 1,
        [{ itemId: 'ingot', type: 'item', amount: ingotPerPlate }],
        [product('plate', platesPerRun)],
      )
      return data
    }
    const plan = {
      goals: gearGoal,
      nodes: [planNode('g', 'gear'), planNode('p', 'plateFromIngot'), pinned('i', 'ingotFromOre', 10)],
    }

    it('1 ingot -> 1 plate: slack on plate is cheaper, so supply replaces the import', () => {
      const { result, received } = solveBlock(plan, gd(1, 1), new Map([['plate', 100]]))
      expect(received.get('plate')).toBeCloseTo(40, 4)
      expect(rate(result.unsatisfied, 'ingot')).toBe(0)
    })

    it('1 ingot -> 2 plates: the upstream import stays and the supply is not used', () => {
      const { result, received } = solveBlock(plan, gd(1, 2), new Map([['plate', 100]]))
      expect(received.size).toBe(0)
      expect(rate(result.unsatisfied, 'ingot')).toBeCloseTo(15, 4)
    })
  })

  it('takes supply for an item the block cannot make and imports the rest', () => {
    const plan = { goals: gearGoal, nodes: [planNode('g', 'gear')] }
    const { result, received } = solveBlock(plan, connectionGameData(), new Map([['plate', 40]]))
    expect(received.get('plate')).toBeCloseTo(40, 4)
    expect(rate(result.unsatisfied, 'plate')).toBeCloseTo(10, 4)
  })

  it('takes the deficit, not the cap, when the cap is far above the need', () => {
    const plan = { goals: gearGoal, nodes: [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)] }
    const { received } = solveBlock(plan, connectionGameData(), new Map([['plate', 1e6]]))
    expect(received.get('plate')).toBeCloseTo(30, 4)

    const rawOnly = solveBlock({ goals: gearGoal, nodes: [planNode('g', 'gear')] }, connectionGameData(), new Map([['plate', 1e6]]))
    expect(rawOnly.received.get('plate')).toBeCloseTo(50, 4)
    expect(rawOnly.result.unsatisfied).toEqual([])
  })

  it('lets connected supply cover a locked item', () => {
    const plan = {
      goals: gearGoal,
      nodes: [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)],
      noImportItems: ['plate'],
    }
    const { result, received } = solveBlock(plan, connectionGameData(), new Map([['plate', 100]]))
    expect(received.get('plate')).toBeCloseTo(30, 4)
    expect(result.nodes.find(n => n.recipeNodeId === 'g')!.throughput).toBeCloseTo(25, 4)
  })

  it('keeps pins and reports the real delivery when a locked item is only partly offered', () => {
    const plan = {
      goals: gearGoal,
      nodes: [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)],
      noImportItems: ['plate'],
    }
    const { result, received } = solveBlock(plan, connectionGameData(), new Map([['plate', 10]]))
    expect(result.warnings.some(w => w.type === 'infeasible-pins')).toBe(false)
    expect(result.nodes.find(n => n.recipeNodeId === 'p')!.throughput).toBeCloseTo(20, 4)
    expect(result.nodes.find(n => n.recipeNodeId === 'g')!.throughput).toBeCloseTo(25, 4)
    expect(received.get('plate')).toBeCloseTo(10, 4)
    // The rest of the lock cannot be honoured and shows up as an import.
    expect(rate(result.unsatisfied, 'plate')).toBeCloseTo(20, 4)
  })

  it('is identical to solve() without caps', () => {
    const plan = { goals: gearGoal, nodes: [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)] }
    const gd = connectionGameData()
    const { result, received } = solveBlock(plan, gd)
    expect(result).toEqual(solve(plan, gd))
    expect(received.size).toBe(0)
  })
})

describe('netBalance', () => {
  it('is produced minus consumed per item', () => {
    const net = netBalance([
      { inputRates: { a: 2 }, outputRates: { b: 5 } },
      { inputRates: { b: 1 }, outputRates: { a: 1 } },
    ])
    expect(net.get('a')).toBe(-1)
    expect(net.get('b')).toBe(4)
  })
})

describe('solveAll', () => {
  function block(id: string, goals: ProductionGoal[], nodes: RecipeNode[], connections: Block['inputConnections'] = []): Block {
    return { ...makeBlock(makeSubPlan(`root-${id}`, nodes), goals), id, name: id, inputConnections: connections }
  }
  const plateGoal = (rate: number): ProductionGoal[] => [{ id: 'gp', itemId: 'plate', rate }]
  const gearGoal = (rate: number): ProductionGoal[] => [{ id: 'gg', itemId: 'gear', rate }]
  const link = (id: string, from: string, itemId = 'plate') => ({ id, itemId, fromBlockId: from })
  const flowOf = (all: ReturnType<typeof solveAll>, id: string) => all.flows.find(f => f.connectionId === id)!

  it('feeds the consumer from the source and reports an ok flow', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(60, 4)
    expect(f.available).toBeCloseTo(60, 4)
    expect(f.status).toBe('ok')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
  })

  it('marks the flow limited when the source offers less than needed', () => {
    const all = solveAll([
      block('A', plateGoal(40), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(40, 4)
    expect(f.status).toBe('limited')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(20, 4)
  })

  it('marks the flow unused when the consumer makes the item itself', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [planNode('g', 'gear'), planNode('m', 'plateFromIngot')], [link('c1', 'A')]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBe(0)
    expect(f.status).toBe('unused')
  })

  it('reports a limited flow, not ok, for a locked item that is only partly offered', () => {
    const locked: Block = {
      ...block('B', gearGoal(25), [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)], [link('c1', 'A')]),
      noImportItems: ['plate'],
    }
    const all = solveAll([block('A', plateGoal(10), [planNode('p', 'plate')]), locked], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(10, 4)
    expect(f.status).toBe('limited')
    expect(all.results.B.warnings.some(w => w.type === 'infeasible-pins')).toBe(false)
  })

  it('marks a repeated (source, item) connection unused instead of limited', () => {
    const all = solveAll([
      block('A', plateGoal(10), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A'), link('c2', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1').status).toBe('limited')
    expect(flowOf(all, 'c2')).toMatchObject({ rate: 0, available: 0, status: 'unused' })
  })

  it('does not feed a goal item: the shortfall stays and the flow is unused', () => {
    const all = solveAll([
      block('A', gearGoal(30), [planNode('p', 'plate'), planNode('g', 'gear')]),
      block('B', gearGoal(25), [planNode('x', 'plate')], [link('c1', 'A', 'gear')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ rate: 0, status: 'unused' })
    expect(rate(all.results.B.unsatisfied, 'gear')).toBeCloseTo(25, 4)
  })

  it('serves several consumers of one source in solve order', () => {
    const all = solveAll([
      block('A', plateGoal(40), [planNode('p', 'plate')]),
      block('B', gearGoal(15), [planNode('g', 'gear')], [link('cb', 'A')]),
      block('C', gearGoal(15), [planNode('g', 'gear')], [link('cc', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'cb').rate).toBeCloseTo(30, 4)
    expect(flowOf(all, 'cc').rate).toBeCloseTo(10, 4)
    expect(flowOf(all, 'cc').available).toBeCloseTo(10, 4)
  })

  it('drains several sources of one item in connection order', () => {
    const all = solveAll([
      block('A1', plateGoal(20), [planNode('p', 'plate')]),
      block('A2', plateGoal(50), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A1'), link('c2', 'A2')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1').rate).toBeCloseTo(20, 4)
    expect(flowOf(all, 'c2').rate).toBeCloseTo(40, 4)
  })

  it('solves a source listed after its consumer first', () => {
    const all = solveAll([
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
      block('A', plateGoal(60), [planNode('p', 'plate')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1').rate).toBeCloseTo(60, 4)
  })

  it('ignores connections to a missing source', () => {
    const all = solveAll([
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'ghost')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ status: 'missing-source', rate: 0, available: 0 })
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(60, 4)
  })

  it('ignores connections inside a cycle but still solves both blocks', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'plate')], [link('c1', 'B', 'gear')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c2', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ status: 'cycle', rate: 0 })
    expect(flowOf(all, 'c2')).toMatchObject({ status: 'cycle', rate: 0 })
    expect(all.results.A.nodes).toHaveLength(1)
    expect(all.results.B.nodes).toHaveLength(1)
  })

  it('records a failing block in errors and still solves the others', () => {
    const broken = { ...planNode('g', 'gear'), modules: undefined } as unknown as RecipeNode
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'plate')]),
      block('B', gearGoal(30), [broken], [link('c1', 'A')]),
    ], connectionGameData())
    expect(all.errors.B).toBeTruthy()
    expect(all.errors.A).toBeUndefined()
    expect(all.results.B).toEqual({ nodes: [], unsatisfied: [], warnings: [] })
    expect(all.results.A.nodes).toHaveLength(1)
    expect(flowOf(all, 'c1').rate).toBe(0)
  })
})

describe('solve — a node with no resolvable machine', () => {
  const machine = () => ({
    id: 'asm', name: 'asm', type: 'assembling-machine' as const, craftingSpeed: 2, energyUsageKw: 100,
    energyType: 'electric' as const, drainKw: 0, moduleSlots: 2, allowedEffects: ['speed' as const],
    craftingCategories: ['crafting'], iconPath: '', hidden: false,
  })
  const speedModule = () => ({
    id: 'speed', name: 'speed', category: 'speed', tier: 1, effects: { speed: 0.5 },
    limitation: [], limitationBlacklist: [], iconPath: '',
  })
  function data(withDefault: boolean): GameData {
    return makeGameData({
      recipes: { 'iron-plate': structuredClone(ironRecipe) },
      machines: { asm: machine() },
      modules: { speed: speedModule() },
      defaultMachines: withDefault ? { crafting: 'asm' } : {},
    })
  }

  it('has zero machine count and power and unchanged rates', () => {
    const withMachine = solve(simplePlan, data(true)).nodes[0]
    const result = solve(simplePlan, data(false))
    const n = result.nodes[0]
    expect(withMachine.machineCountExact).toBeGreaterThan(0)
    expect(n.machineCountExact).toBe(0)
    expect(n.machineCountCeil).toBe(0)
    expect(n.powerKw).toBe(0)
    expect(Number.isFinite(n.machineCountExact), 'no NaN').toBe(true)
    expect(n.throughput).toBe(withMachine.throughput)
    expect(n.inputRates).toEqual(withMachine.inputRates)
    expect(n.outputRates).toEqual(withMachine.outputRates)
    const reference = solve(simplePlan, data(true))
    expect(result.unsatisfied).toEqual(reference.unsatisfied)
    expect(result.warnings).toEqual(reference.warnings)
  })

  it('stays at zero with a speed module and a beacon', () => {
    const node: RecipeNode = {
      ...(planNode('n1', 'iron-plate') as GameRecipeNode),
      modules: [{ moduleId: 'speed', count: 1 }],
      beaconConfig: { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 },
    }
    const n = solve({ goals: [ironGoal], nodes: [node] }, data(false)).nodes[0]
    expect(n.machineCountExact).toBe(0)
    expect(n.machineCountCeil).toBe(0)
    expect(n.powerKw).toBe(0)
    expect(Number.isFinite(n.machineCountExact), 'no NaN').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Extraction recipes (mining drills, offshore pumps)
// ---------------------------------------------------------------------------

describe('solve — extraction recipes', () => {
  const drill = () => ({
    id: 'drill', name: 'drill', type: 'mining-drill' as const, craftingSpeed: 0.5, energyUsageKw: 90,
    energyType: 'electric' as const, drainKw: 0, moduleSlots: 0, allowedEffects: [],
    craftingCategories: ['mining:basic-solid', 'mining-with-fluid:basic-solid'], iconPath: '', hidden: false,
  })
  const pump = () => ({
    id: 'pump', name: 'pump', type: 'offshore-pump' as const, craftingSpeed: 20, energyUsageKw: 0,
    energyType: 'void' as const, drainKw: 0, moduleSlots: 0, allowedEffects: [],
    craftingCategories: ['offshore:water'], iconPath: '', hidden: false,
  })
  const extraction = (
    id: string,
    category: string,
    craftingTime: number,
    ingredients: GameData['recipes'][string]['ingredients'],
    products: GameData['recipes'][string]['products'],
  ) => ({ ...recipe(id, craftingTime, ingredients, products), category, extraction: true })

  function extractionData(): GameData {
    return makeGameData({
      recipes: {
        'iron-plate': recipe('iron-plate', 1, [product('iron-ore', 1)], [product('iron-plate', 1)]),
        'mining:iron-ore': extraction('mining:iron-ore', 'mining:basic-solid', 1, [], [product('iron-ore', 1)]),
        'mining:uranium-ore': extraction(
          'mining:uranium-ore', 'mining-with-fluid:basic-solid', 2,
          [{ itemId: 'sulfuric-acid', type: 'fluid', amount: 1 }], [product('uranium-ore', 1)],
        ),
        'offshore:water': extraction(
          'offshore:water', 'offshore:water', 1, [], [{ itemId: 'water', type: 'fluid', amount: 60 }],
        ),
      },
      machines: { drill: drill(), pump: pump() },
      defaultMachines: {
        'mining:basic-solid': 'drill',
        'mining-with-fluid:basic-solid': 'drill',
        'offshore:water': 'pump',
      },
    })
  }

  const node = (result: ReturnType<typeof solve>, id: string) => result.nodes.find(n => n.recipeNodeId === id)!

  it('mines the ore a smelting row needs, so it is no longer imported', () => {
    const plan = { goals: [ironGoal], nodes: [planNode('smelt', 'iron-plate'), planNode('mine', 'mining:iron-ore')] }
    const result = solve(plan, extractionData())
    expect(node(result, 'mine').throughput).toBeCloseTo(60, 4)
    expect(node(result, 'mine').machineCountExact).toBeCloseTo(2, 4)
    expect(rate(result.unsatisfied, 'iron-ore')).toBe(0)
    expect(result.warnings.some(w => w.type === 'no-recipe')).toBe(false)
  })

  it('keeps an ore without a mining row raw', () => {
    const plan = { goals: [ironGoal], nodes: [planNode('smelt', 'iron-plate')] }
    const result = solve(plan, extractionData())
    expect(rate(result.unsatisfied, 'iron-ore')).toBeCloseTo(60, 4)
  })

  it('sizes an offshore pump from its pumping speed', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'water', rate: 72000 }],
      nodes: [planNode('pump', 'offshore:water')],
    }
    const n = node(solve(plan, extractionData()), 'pump')
    expect(n.machineCountExact).toBeCloseTo(1, 4)
    expect(n.powerKw).toBe(0)
  })

  it('treats the fluid a mining recipe needs as a raw input', () => {
    const plan = {
      goals: [{ id: 'g1', itemId: 'uranium-ore', rate: 30 }],
      nodes: [planNode('mine', 'mining:uranium-ore')],
    }
    const result = solve(plan, extractionData())
    expect(rate(result.unsatisfied, 'sulfuric-acid')).toBeCloseTo(30, 4)
    expect(node(result, 'mine').machineCountExact).toBeCloseTo(2, 4)
  })

  it('does not import a locked ore that has a mining row', () => {
    const plan = {
      goals: [ironGoal],
      nodes: [planNode('smelt', 'iron-plate'), { ...(planNode('mine', 'mining:iron-ore') as GameRecipeNode), pinnedRate: 30 }],
      noImportItems: ['iron-ore'],
    }
    const result = solve(plan, extractionData())
    // The pin cannot meet the goal without importing ore, so the solver reports it
    // as infeasible and mines the ore itself instead of importing it.
    expect(result.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['mining:iron-ore'] })
    expect(node(result, 'mine').throughput).toBeCloseTo(60, 4)
    expect(rate(result.unsatisfied, 'iron-ore')).toBe(0)
  })
})

describe('solveBlock — share limit', () => {
  const gd = makeGameData({
    recipes: {
      'wash': recipe('wash', 1, [{ itemId: 'muddy', type: 'item', amount: 10 }], [product('mud', 1), product('thin', 10)]),
      'soil-mud': recipe('soil-mud', 1, [{ itemId: 'mud', type: 'item', amount: 1 }, { itemId: 'compost', type: 'item', amount: 1 }], [product('soil', 1)]),
      'sand': recipe('sand', 1, [{ itemId: 'thin', type: 'item', amount: 10 }], [product('sand', 5)]),
      'soil-sand': recipe('soil-sand', 1, [{ itemId: 'sand', type: 'item', amount: 1 }, { itemId: 'compost', type: 'item', amount: 2 }], [product('soil', 1)]),
    },
  })
  const goals: ProductionGoal[] = [{ id: 'g1', itemId: 'soil', rate: 10 }]
  const base = [planNode('wash', 'wash'), planNode('mud', 'soil-mud'), planNode('sand', 'sand')]
  const limited = (id: string, maxShare: number): RecipeNode => ({ ...planNode(id, 'soil-sand'), maxShare })
  const rateOf = (result: ReturnType<typeof solve>, id: string) =>
    result.nodes.find(n => n.recipeNodeId === id)?.throughput ?? 0

  it('own production first: a limited row does not draw on connected supply', () => {
    const { result, received } = solveBlock(
      { goals, nodes: [...base, limited('ss', 0.3)] },
      gd,
      new Map([['mud', 10]]),
    )
    expect(rateOf(result, 'mud')).toBeCloseTo(7, 4)
    expect(rateOf(result, 'ss')).toBeCloseTo(3, 4)
    expect(received.size).toBe(0)
  })

  it('with duplicate rows, the last flagged one decides', () => {
    const { result } = solveBlock(
      { goals, nodes: [...base, planNode('ss1', 'soil-sand'), limited('ss2', 0.3)] },
      gd,
    )
    expect(rateOf(result, 'mud')).toBeCloseTo(7, 4)
  })
})
