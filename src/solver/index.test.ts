import { describe, it, expect, vi } from 'vitest'
import { solve, solveBlock, solveAll, flattenBlock, netBalance, connectionOffer } from './index'
import { createSolveCache } from './solveCache'
import type { GameData, GameRecipeNode, Product, SolverGoal, RecipeNode, Block, SubPlan } from '../data/types'

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
const ironGoal: SolverGoal = { id: 'g1', itemId: 'iron-plate', rate: 60 }
const ironProduct: Product = { id: 'g1', itemId: 'iron-plate', extraRate: 60 }
const simplePlan: { goals: SolverGoal[]; nodes: RecipeNode[] } = {
  goals: [ironGoal],
  nodes: [planNode('n1', 'iron-plate')],
}

function makeSubPlan(name: string, nodes: RecipeNode[], subPlans: SubPlan[] = []): SubPlan {
  const now = new Date().toISOString()
  return { id: name, name, nodes, subPlans, createdAt: now, updatedAt: now }
}

function makeBlock(rootPlan: SubPlan, products: Product[]): Block {
  return {
    id: 'block-1',
    name: 'Block',
    color: '#60a5fa',
    products,
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
// allowProductivity
// ---------------------------------------------------------------------------

describe('solve — allowProductivity', () => {
  const prodModule: GameData['modules'][string] = {
    id: 'productivity-module-3', name: 'productivity-module-3', tier: 3,
    category: 'productivity', iconPath: '', limitation: [], limitationBlacklist: [],
    effects: { productivity: 0.1, consumption: 0.8, speed: -0.15, quality: 0 },
  }

  function planWithProdModules(allowProductivity: boolean) {
    const gd = makeGameData({
      recipes: {
        'iron-plate': {
          ...recipe('iron-plate', 1, [product('iron-ore', 1)], [product('iron-plate', 1)]),
          allowProductivity,
        },
      },
      modules: { 'productivity-module-3': prodModule },
    })
    const node: GameRecipeNode = {
      ...planNode('n1', 'iron-plate'),
      modules: [{ moduleId: 'productivity-module-3', count: 4 }],
    }
    return { gd, plan: { goals: [ironGoal], nodes: [node as RecipeNode] } }
  }

  it('applies productivity modules when the recipe allows productivity', () => {
    const { gd, plan } = planWithProdModules(true)
    const result = solve(plan, gd)
    // +40 % output: 60 plates/min needs 60 / 1.4 executions/min.
    expect(result.nodes[0].throughput).toBeCloseTo(60 / 1.4, 3)
  })

  it('ignores productivity modules when the recipe disallows productivity', () => {
    const { gd, plan } = planWithProdModules(false)
    const result = solve(plan, gd)
    expect(result.nodes[0].throughput).toBeCloseTo(60, 3)
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

    const flatBlock = makeBlock(makeSubPlan('Root', [ironNode]), [ironProduct])

    // Same recipe, but moved into a child subplan referenced from root via a SubPlanNode handle.
    const child = makeSubPlan('Iron Smelting', [ironNode])
    const wrappedBlock = makeBlock(
      {
        ...makeSubPlan('Root', []),
        nodes: [{ kind: 'subplan', id: 'sp-handle', subPlanId: child.id }],
        subPlans: [child],
      },
      [ironProduct],
    )

    const flatResult = solve(flattenBlock(flatBlock), simpleGameData)
    const wrappedResult = solve(flattenBlock(wrappedBlock), simpleGameData)

    expect(wrappedResult.nodes).toHaveLength(1)
    expect(wrappedResult.nodes[0].throughput).toBeCloseTo(flatResult.nodes[0].throughput, 6)
    expect(wrappedResult.nodes[0].recipeNodeId).toBe('n1')
  })

  it('flattenBlock turns products into goals: extra only, products without extra dropped', () => {
    const block = makeBlock(makeSubPlan('Root', []), [
      { id: 'p1', itemId: 'plate', extraRate: 60 },
      { id: 'p2', itemId: 'gear' },
    ])
    expect(flattenBlock(block).goals).toEqual([{ id: 'p1', itemId: 'plate', rate: 60 }])
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
      [ironProduct],
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
const twinRecipe = recipe('twin', 1, [], [product('slag', 1), product('plate', 1)])
const ingotFromOreRecipe = recipe('ingotFromOre', 1, [{ itemId: 'ore', type: 'item', amount: 1 }], [product('ingot', 1)])

function connectionGameData(): GameData {
  return makeGameData({
    recipes: {
      plate: plateRecipe,
      gear: gearRecipe,
      ingot: ingotRecipe,
      plateFromIngot: plateFromIngotRecipe,
      ingotFromOre: ingotFromOreRecipe,
      twin: twinRecipe,
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
  const gearGoal: SolverGoal[] = [{ id: 'g', itemId: 'gear', rate: 25 }]

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
  function block(id: string, products: Product[], nodes: RecipeNode[], connections: Block['inputConnections'] = []): Block {
    return { ...makeBlock(makeSubPlan(`root-${id}`, nodes), products), id, name: id, inputConnections: connections }
  }
  // A's goal is slag, which the twin recipe makes together with plate: the plate is leftover output a
  // connection takes, not a product, so connections to A take existing output.
  const plateGoal = (rate: number): Product[] => [{ id: 'gp', itemId: 'slag', extraRate: rate }]
  const gearGoal = (rate: number): Product[] => [{ id: 'gg', itemId: 'gear', extraRate: rate }]
  const link = (id: string, from: string, itemId = 'plate') => ({ id, itemId, fromBlockId: from })
  const flowOf = (all: ReturnType<typeof solveAll>, id: string) => all.flows.find(f => f.connectionId === id)!

  it('feeds the consumer from the source and reports an ok flow', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(60, 4)
    expect(f.available).toBeCloseTo(60, 4)
    expect(f.status).toBe('ok')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
    expect(all.loops).toEqual([])
  })

  it('marks the flow limited when the source offers less than needed', () => {
    const all = solveAll([
      block('A', plateGoal(40), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(40, 4)
    expect(f.status).toBe('limited')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(20, 4)
  })

  it('stops a connection at its limit and reports the shortfall as imported', () => {
    const all = solveAll([
      block('A', plateGoal(100), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [{ ...link('c1', 'A'), maxRate: 20 }]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ available: 20, capped: true, status: 'limited' })
    expect(flowOf(all, 'c1').rate).toBeCloseTo(20, 4)
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(40, 4)
  })

  it('keeps a limit above the need ok but capped', () => {
    const all = solveAll([
      block('A', plateGoal(200), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [{ ...link('c1', 'A'), maxRate: 100 }]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ capped: true, status: 'ok' })
    expect(flowOf(all, 'c1').rate).toBeCloseTo(60, 4)
  })

  it('does not call a limit above the source offer capped', () => {
    const all = solveAll([
      block('A', plateGoal(30), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [{ ...link('c1', 'A'), maxRate: 50 }]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.available).toBeCloseTo(30, 4)
    expect(f.capped).toBe(false)
    expect(f.status).toBe('limited')
  })

  it('leaves what a limit holds back on offer for the next consumer', () => {
    const all = solveAll([
      block('A', plateGoal(40), [planNode('p', 'twin')]),
      block('B', gearGoal(15), [planNode('g', 'gear')], [{ ...link('cb', 'A'), maxRate: 10 }]),
      block('C', gearGoal(15), [planNode('g', 'gear')], [link('cc', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'cb').rate).toBeCloseTo(10, 4)
    expect(flowOf(all, 'cc').rate).toBeCloseTo(30, 4)
    expect(flowOf(all, 'cc').available).toBeCloseTo(30, 4)
  })

  it('applies a limit below the residual of an item the consumer also makes', () => {
    const all = solveAll([
      block('A', plateGoal(100), [planNode('p', 'twin')]),
      block('B', gearGoal(25), [planNode('g', 'gear'), pinned('p', 'plateFromIngot', 20)], [{ ...link('c1', 'A'), maxRate: 10 }]),
    ], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(10, 4)
    expect(f.capped).toBe(true)
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(20, 4)
    expect(all.results.B.warnings.some(w => w.type === 'infeasible-pins')).toBe(false)
  })

  it('marks the flow unused when the consumer makes the item itself', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'twin')]),
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
    const all = solveAll([block('A', plateGoal(10), [planNode('p', 'twin')]), locked], connectionGameData())
    const f = flowOf(all, 'c1')
    expect(f.rate).toBeCloseTo(10, 4)
    expect(f.status).toBe('limited')
    expect(all.results.B.warnings.some(w => w.type === 'infeasible-pins')).toBe(false)
  })

  it('marks a repeated (source, item) connection unused instead of limited', () => {
    const all = solveAll([
      block('A', plateGoal(10), [planNode('p', 'twin')]),
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
      block('A', plateGoal(40), [planNode('p', 'twin')]),
      block('B', gearGoal(15), [planNode('g', 'gear')], [link('cb', 'A')]),
      block('C', gearGoal(15), [planNode('g', 'gear')], [link('cc', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'cb').rate).toBeCloseTo(30, 4)
    expect(flowOf(all, 'cc').rate).toBeCloseTo(10, 4)
    expect(flowOf(all, 'cc').available).toBeCloseTo(10, 4)
  })

  it('drains several sources of one item in connection order', () => {
    const all = solveAll([
      block('A1', plateGoal(20), [planNode('p', 'twin')]),
      block('A2', plateGoal(50), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A1'), link('c2', 'A2')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1').rate).toBeCloseTo(20, 4)
    expect(flowOf(all, 'c2').rate).toBeCloseTo(40, 4)
  })

  it('solves a source listed after its consumer first', () => {
    const all = solveAll([
      block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
      block('A', plateGoal(60), [planNode('p', 'twin')]),
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

  it('ignores a block connected to itself but still solves it', () => {
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'twin')], [link('c1', 'A')]),
    ], connectionGameData())
    expect(flowOf(all, 'c1')).toMatchObject({ status: 'self', rate: 0, available: 0 })
    expect(all.results.A.nodes).toHaveLength(1)
    expect(all.loops).toEqual([])
  })

  it('records a failing block in errors and still solves the others', () => {
    const broken = { ...planNode('g', 'gear'), modules: undefined } as unknown as RecipeNode
    const all = solveAll([
      block('A', plateGoal(60), [planNode('p', 'twin')]),
      block('B', gearGoal(30), [broken], [link('c1', 'A')]),
    ], connectionGameData())
    expect(all.errors.B).toBeTruthy()
    expect(all.errors.A).toBeUndefined()
    expect(all.results.B).toEqual({ nodes: [], unsatisfied: [], warnings: [] })
    expect(all.results.A.nodes).toHaveLength(1)
    expect(flowOf(all, 'c1').rate).toBe(0)
  })

  describe('with a solve cache', () => {
    const A = () => block('A', plateGoal(60), [planNode('p', 'twin')])
    const B = () => block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')])
    const broken = () => ({ ...planNode('g', 'gear'), modules: undefined } as unknown as RecipeNode)

    const scenarios: Record<string, () => Block[]> = {
      'feed ok': () => [A(), B()],
      'limited source': () => [
        block('A', plateGoal(40), [planNode('p', 'twin')]),
        block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A')]),
      ],
      'maxRate below need': () => [
        A(),
        block('B', gearGoal(30), [planNode('g', 'gear')], [{ ...link('c1', 'A'), maxRate: 20 }]),
      ],
      'two consumers of one source': () => [
        block('A', plateGoal(40), [planNode('p', 'twin')]),
        block('B', gearGoal(15), [planNode('g', 'gear')], [link('cb', 'A')]),
        block('C', gearGoal(15), [planNode('g', 'gear')], [link('cc', 'A')]),
      ],
      'two sources of one item': () => [
        block('A1', plateGoal(20), [planNode('p', 'twin')]),
        block('A2', plateGoal(50), [planNode('p', 'twin')]),
        block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'A1'), link('c2', 'A2')]),
      ],
      'missing source': () => [block('B', gearGoal(30), [planNode('g', 'gear')], [link('c1', 'ghost')])],
      loop: () => [
        block('A', plateGoal(60), [planNode('p', 'twin')], [link('c1', 'B', 'gear')]),
        block('B', gearGoal(30), [planNode('g', 'gear')], [link('c2', 'A')]),
      ],
      'failing block': () => [A(), block('B', gearGoal(30), [broken()], [link('c1', 'A')])],
    }

    for (const [name, make] of Object.entries(scenarios)) {
      it(`gives the same results as no cache: ${name}`, () => {
        const gd = connectionGameData()
        const cache = createSolveCache()
        const expected = solveAll(make(), gd)
        const first = solveAll(make(), gd, cache)
        expect(first).toEqual(expected)
        const second = solveAll(make(), gd, cache)
        expect(second).toEqual(expected)
        for (const id of Object.keys(first.results)) {
          if (!cache.has(id)) continue // failed solves are deliberately not cached
          expect(second.results[id], 'second run reuses every block').toBe(first.results[id])
        }
      })
    }

    it('reuses an untouched block when another block is edited', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const C = block('C', gearGoal(30), [planNode('g', 'gear')])
      const first = solveAll([A(), C], gd, cache)
      const second = solveAll([A(), { ...C, products: gearGoal(20) }], gd, cache)
      expect(second.results.A, 'untouched block reused').toBe(first.results.A)
      expect(second.results.C).not.toBe(first.results.C)
    })

    it('ignores renames, recolours and updatedAt stamps', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const first = solveAll([A(), B()], gd, cache)
      const b = B()
      const renamed = {
        ...b,
        name: 'x',
        color: '#000000',
        rootPlan: { ...b.rootPlan, updatedAt: '2000-01-01T00:00:00.000Z' },
      }
      const second = solveAll([A(), renamed], gd, cache)
      expect(second.results.A).toBe(first.results.A)
      expect(second.results.B).toBe(first.results.B)
    })

    it('re-solves both blocks when an upstream edit changes the offers', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const first = solveAll([A(), B()], gd, cache)
      const second = solveAll([{ ...A(), products: plateGoal(40) }, B()], gd, cache)
      expect(second.results.A).not.toBe(first.results.A)
      expect(second.results.B).not.toBe(first.results.B)
      expect(flowOf(second, 'c1').rate).toBeCloseTo(40, 4)
    })

    it('keeps the consumer when an upstream edit leaves the offers unchanged', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const first = solveAll([A(), B()], gd, cache)
      const edited = block('A', plateGoal(60), [{ ...planNode('p', 'twin'), machineId: 'ghost' }])
      const second = solveAll([edited, B()], gd, cache)
      expect(second.results.A).not.toBe(first.results.A)
      expect(second.results.B).toBe(first.results.B)
      expect(second.flows).toEqual(first.flows)
    })

    it('keeps the source when only the consumer changes', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const first = solveAll([A(), B()], gd, cache)
      const second = solveAll([A(), { ...B(), products: gearGoal(20) }], gd, cache)
      expect(second.results.A).toBe(first.results.A)
      expect(second.results.B).not.toBe(first.results.B)
    })

    it('re-solves a sibling whose supply changed', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const blocks = (bRate: number) => [
        block('A', plateGoal(40), [planNode('p', 'twin')]),
        block('B', gearGoal(bRate), [planNode('g', 'gear')], [link('cb', 'A')]),
        block('C', gearGoal(15), [planNode('g', 'gear')], [link('cc', 'A')]),
      ]
      const first = solveAll(blocks(15), gd, cache)
      const second = solveAll(blocks(10), gd, cache)
      expect(second.results.A).toBe(first.results.A)
      expect(second.results.B).not.toBe(first.results.B)
      expect(second.results.C).not.toBe(first.results.C)
      expect(flowOf(second, 'cc').available).toBeCloseTo(20, 4)
    })

    it('recomputes flows after a connection-only edit', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const first = solveAll([A(), B()], gd, cache)
      const limited = block('B', gearGoal(30), [planNode('g', 'gear')], [{ ...link('c1', 'A'), maxRate: 20 }])
      const second = solveAll([A(), limited], gd, cache)
      expect(second.results.A).toBe(first.results.A)
      expect(second.results.B).not.toBe(first.results.B)
      expect(flowOf(second, 'c1')).toMatchObject({ available: 20, capped: true })
    })

    it('re-solves everything when the game data object changes', () => {
      const cache = createSolveCache()
      const first = solveAll([A(), B()], connectionGameData(), cache)
      const second = solveAll([A(), B()], connectionGameData(), cache)
      expect(second.results.A).not.toBe(first.results.A)
      expect(second.results.B).not.toBe(first.results.B)
    })

    it('never caches an error', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      const bad = () => [A(), block('B', gearGoal(30), [broken()], [link('c1', 'A')])]
      solveAll(bad(), gd, cache)
      expect(cache.has('B')).toBe(false)
      expect(solveAll(bad(), gd, cache).errors.B).toBeTruthy()
      expect(cache.has('B')).toBe(false)

      const cache2 = createSolveCache()
      const good = solveAll([A(), B()], gd, cache2)
      solveAll(bad(), gd, cache2)
      expect(cache2.has('B')).toBe(false)
      const restored = solveAll([A(), B()], gd, cache2)
      expect(restored.results.B).not.toBe(good.results.B)
    })

    it('drops entries of removed blocks', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      solveAll([A(), B()], gd, cache)
      solveAll([A()], gd, cache)
      expect(cache.has('B')).toBe(false)
      expect(cache.size).toBe(1)
    })

    it('leaves no entry for a block with goals but no nodes', () => {
      const gd = connectionGameData()
      const cache = createSolveCache()
      solveAll([block('E', plateGoal(10), [planNode('p', 'twin')])], gd, cache)
      expect(cache.has('E')).toBe(true)
      solveAll([block('E', plateGoal(10), [])], gd, cache)
      expect(cache.has('E')).toBe(false)
    })
  })

  describe('loops', () => {
    // Metals -> Sciences -> Ores -> Metals: smelting metal, researching with it, sorting the waste back into ore.
    const loopGameData = () => makeGameData({
      recipes: {
        smelt: recipe('smelt', 1, [{ itemId: 'ore', type: 'item', amount: 1 }], [product('metal', 1), product('heat', 1)]),
        research: recipe('research', 1, [{ itemId: 'metal', type: 'item', amount: 2 }], [product('science', 1), product('waste', 1)]),
        sort: recipe('sort', 1, [{ itemId: 'waste', type: 'item', amount: 1 }], [product('ore', 1), product('dust', 1)]),
        mine: recipe('mine', 1, [], [product('ore', 1), product('rock', 1)]),
      },
    })
    const goal = (itemId: string, rate: number): Product[] => [{ id: `g-${itemId}`, itemId, extraRate: rate }]
    const metals = (connections: Block['inputConnections'] = [{ id: 'c_om', itemId: 'ore', fromBlockId: 'Ores' }], rate = 60) =>
      block('Metals', goal('heat', rate), [planNode('n', 'smelt')], connections)
    const sciences = (rate = 30) =>
      block('Sciences', goal('science', rate), [planNode('n', 'research')], [{ id: 'c_ms', itemId: 'metal', fromBlockId: 'Metals' }])
    const ores = (rate = 30) =>
      block('Ores', goal('dust', rate), [planNode('n', 'sort')], [{ id: 'c_so', itemId: 'waste', fromBlockId: 'Sciences' }])
    const flow = (all: ReturnType<typeof solveAll>, id: string) => {
      const f = flowOf(all, id)
      return { rate: f.rate, available: f.available, status: f.status, loop: f.loop }
    }
    const near = (actual: { rate: number; available: number; status: string; loop?: true }, expected: { rate: number; available: number; status: string; loop?: true }) => {
      expect(actual.rate).toBeCloseTo(expected.rate, 4)
      expect(actual.available).toBeCloseTo(expected.available, 4)
      expect(actual.status).toBe(expected.status)
      expect(actual.loop).toBe(expected.loop)
    }

    it('settles a three-block loop in two rounds', () => {
      const all = solveAll([metals(), sciences(), ores()], loopGameData())
      near(flow(all, 'c_ms'), { rate: 60, available: 60, status: 'ok', loop: true })
      near(flow(all, 'c_so'), { rate: 30, available: 30, status: 'ok', loop: true })
      near(flow(all, 'c_om'), { rate: 30, available: 30, status: 'limited', loop: true })
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBeCloseTo(30, 4)
      expect(all.results.Sciences.unsatisfied).toEqual([])
      expect(all.results.Ores.unsatisfied).toEqual([])
      expect(all.loops).toEqual([{
        blockIds: ['Metals', 'Sciences', 'Ores'],
        connectionIds: ['c_om', 'c_ms', 'c_so'],
        backConnectionIds: ['c_om'],
        rounds: 2,
        converged: true,
      }])
      for (const r of Object.values(all.results)) {
        expect(r.warnings.some(w => w.type === 'loop-not-converged')).toBe(false)
      }
    })

    it('gives the same flows whichever block is listed first', () => {
      const all = solveAll([ores(), sciences(), metals()], loopGameData())
      near(flow(all, 'c_ms'), { rate: 60, available: 60, status: 'ok', loop: true })
      near(flow(all, 'c_so'), { rate: 30, available: 30, status: 'ok', loop: true })
      near(flow(all, 'c_om'), { rate: 30, available: 30, status: 'limited', loop: true })
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBeCloseTo(30, 4)
      expect(all.loops).toEqual([{
        blockIds: ['Ores', 'Metals', 'Sciences'],
        connectionIds: ['c_so', 'c_om', 'c_ms'],
        backConnectionIds: ['c_so'],
        rounds: 2,
        converged: true,
      }])
    })

    it('lets a loop member export more than the loop takes', () => {
      const all = solveAll([metals(), sciences(), ores(90)], loopGameData())
      near(flow(all, 'c_so'), { rate: 30, available: 30, status: 'limited', loop: true })
      expect(rate(all.results.Ores.unsatisfied, 'waste')).toBeCloseTo(60, 4)
      near(flow(all, 'c_om'), { rate: 60, available: 90, status: 'ok', loop: true })
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBe(0)
    })

    it('honours a limit on the back connection', () => {
      const limited = metals([{ id: 'c_om', itemId: 'ore', fromBlockId: 'Ores', maxRate: 40 }])
      const all = solveAll([limited, sciences(), ores(90)], loopGameData())
      expect(flowOf(all, 'c_om')).toMatchObject({ available: 40, capped: true, status: 'limited' })
      expect(flowOf(all, 'c_om').rate).toBeCloseTo(40, 4)
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBeCloseTo(20, 4)
    })

    it('serves a block outside the loop from what the loop leaves over', () => {
      const extra = block('Extra', goal('heat', 50), [planNode('n', 'smelt')], [{ id: 'c_oe', itemId: 'ore', fromBlockId: 'Ores' }])
      const all = solveAll([metals(), sciences(), ores(90), extra], loopGameData())
      near(flow(all, 'c_om'), { rate: 60, available: 90, status: 'ok', loop: true })
      near(flow(all, 'c_oe'), { rate: 30, available: 30, status: 'limited', loop: undefined })
      expect(rate(all.results.Extra.unsatisfied, 'ore')).toBeCloseTo(20, 4)
    })

    it('reads upstream supply afresh every round and enters the loop where the supply arrives', () => {
      const mine = block('Mine', goal('rock', 20), [planNode('n', 'mine')])
      const entered = metals([
        { id: 'c_um', itemId: 'ore', fromBlockId: 'Mine' },
        { id: 'c_om', itemId: 'ore', fromBlockId: 'Ores' },
      ])
      const all = solveAll([mine, sciences(), ores(), entered], loopGameData())
      near(flow(all, 'c_um'), { rate: 20, available: 20, status: 'limited', loop: undefined })
      near(flow(all, 'c_om'), { rate: 30, available: 30, status: 'limited', loop: true })
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBeCloseTo(10, 4)
      expect(all.loops[0].blockIds[0]).toBe('Metals')
    })

    it('keeps the last round and warns when the loop does not settle', () => {
      const all = solveAll([metals(), sciences(), ores()], loopGameData(), undefined, { loopRoundLimit: 1 })
      expect(all.loops[0]).toMatchObject({ rounds: 1, converged: false })
      for (const id of ['Metals', 'Sciences', 'Ores']) {
        expect(all.results[id].warnings).toContainEqual({
          type: 'loop-not-converged',
          blockIds: ['Metals', 'Sciences', 'Ores'],
          rounds: 1,
        })
      }
      near(flow(all, 'c_om'), { rate: 0, available: 0, status: 'limited', loop: true })
      expect(rate(all.results.Metals.unsatisfied, 'ore')).toBeCloseTo(60, 4)
    })

    it('keeps result identity between solves of an unsettled loop', () => {
      const cache = createSolveCache()
      const gd = loopGameData()
      const first = solveAll([metals(), sciences(), ores()], gd, cache, { loopRoundLimit: 1 })
      const second = solveAll([metals(), sciences(), ores()], gd, cache, { loopRoundLimit: 1 })
      for (const id of ['Metals', 'Sciences', 'Ores']) {
        expect(second.results[id], id).toBe(first.results[id])
      }
    })

    it('does not mutate cached results when it adds the warning', () => {
      const cache = createSolveCache()
      const gd = loopGameData()
      solveAll([metals(), sciences(), ores()], gd, cache, { loopRoundLimit: 1 })
      const settled = solveAll([metals(), sciences(), ores()], gd, cache)
      for (const r of Object.values(settled.results)) {
        expect(r.warnings.some(w => w.type === 'loop-not-converged')).toBe(false)
      }
    })

    it('settles in one round when the back connection carries nothing', () => {
      const first = block('Metals', goal('heat', 60), [planNode('n', 'smelt')], [{ id: 'c_back', itemId: 'ore', fromBlockId: 'Sciences' }])
      const second = block('Sciences', goal('science', 30), [planNode('n', 'research')], [{ id: 'c_fwd', itemId: 'metal', fromBlockId: 'Metals' }])
      const all = solveAll([first, second], loopGameData())
      expect(all.loops).toMatchObject([{ rounds: 1, converged: true }])
      expect(flowOf(all, 'c_back')).toMatchObject({ rate: 0, available: 0, loop: true })
    })

    it('reuses a settled loop from the cache and re-solves only what an edit reaches', () => {
      const cache = createSolveCache()
      const gd = loopGameData()
      const first = solveAll([metals(), sciences(), ores()], gd, cache)
      const second = solveAll([metals(), sciences(20), ores()], gd, cache)
      expect(second.results.Metals, 'unchanged supply').toBe(first.results.Metals)
      expect(second.results.Sciences).not.toBe(first.results.Sciences)
      expect(second.results.Ores).not.toBe(first.results.Ores)
      expect(flowOf(second, 'c_so').rate).toBeCloseTo(20, 4)
      expect(flowOf(second, 'c_om').rate).toBeCloseTo(30, 4)
    })
  })

})

describe('connectionOffer', () => {
  it.each([
    ['take, surplus', 50, 30, 0, 20],
    ['take, short', 20, 30, 0, 0],
    ['request, surplus beyond every request', 60, 50, 30, 40],
    ['first requester, short source', 45, 50, 30, 30],
    ['last requester', 15, 20, 20, 15],
    ['left below share', 10, 50, 30, 10],
    ["test 12's later source", 20, 20, 0, 0],
  ])('%s', (_name, left, pending, share, offer) => {
    expect(connectionOffer(left, pending, share)).toBeCloseTo(offer, 9)
  })
})

describe('solveAll — requests', () => {
  const machineRecipe = recipe('machine', 1, [{ itemId: 'gear', type: 'item', amount: 1 }], [product('machine', 1)])
  const requestGameData = (): GameData => {
    const data = connectionGameData()
    data.recipes.machine = machineRecipe
    return data
  }
  function block(id: string, products: Product[], nodes: RecipeNode[], connections: Block['inputConnections'] = [], extra: Partial<Block> = {}): Block {
    return { ...makeBlock(makeSubPlan(`root-${id}`, nodes), products), id, name: id, inputConnections: connections, ...extra }
  }
  const prod = (itemId: string, extra?: number): Product => ({ id: `p-${itemId}`, itemId, ...(extra !== undefined ? { extraRate: extra } : {}) })
  const link = (id: string, from: string, itemId = 'plate', extra: object = {}) => ({ id, itemId, fromBlockId: from, ...extra })
  const flowOf = (all: ReturnType<typeof solveAll>, id: string) => all.flows.find(f => f.connectionId === id)!
  const throughput = (all: ReturnType<typeof solveAll>, id: string) => all.results[id].nodes.reduce((sum, n) => sum + n.throughput, 0)
  const smelter = (id = 'A', products: Product[] = [prod('plate')]) => block(id, products, [planNode('p', 'plate')])
  const gearmaker = (id: string, rate: number, connections: Block['inputConnections']) =>
    block(id, [prod('gear', rate)], [planNode('g', 'gear')], connections)

  it('drives a source whose product has no extra', () => {
    const all = solveAll([smelter(), gearmaker('B', 25, [link('c1', 'A')])], requestGameData())
    expect(throughput(all, 'A')).toBeCloseTo(50, 4)
    const f = flowOf(all, 'c1')
    expect(f.kind).toBe('request')
    expect(f.requested).toBeCloseTo(50, 4)
    expect(f.rate).toBeCloseTo(50, 4)
    expect(f.status).toBe('ok')
    expect(f.requestIgnored).toBeUndefined()
    expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
  })

  it('adds the request to the extra of the same product', () => {
    const all = solveAll([smelter('A', [prod('plate', 10)]), gearmaker('B', 25, [link('c1', 'A')])], requestGameData())
    expect(throughput(all, 'A')).toBeCloseTo(60, 4)
    expect(flowOf(all, 'c1').rate).toBeCloseTo(50, 4)
    expect(netBalance(all.results.A.nodes).get('plate')! - flowOf(all, 'c1').rate).toBeCloseTo(10, 4)
  })

  it('limits the request to the connection limit', () => {
    const all = solveAll([smelter(), gearmaker('B', 25, [link('c1', 'A', 'plate', { maxRate: 30 })])], requestGameData())
    const f = flowOf(all, 'c1')
    expect(f.requested).toBeCloseTo(30, 4)
    expect(throughput(all, 'A')).toBeCloseTo(30, 4)
    expect(f.rate).toBeCloseTo(30, 4)
    expect(f.capped).toBe(true)
    expect(f.status).toBe('limited')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(20, 4)
  })

  it('does not call a limit the bound when it is above the request', () => {
    const all = solveAll([smelter(), gearmaker('B', 25, [link('c1', 'A', 'plate', { maxRate: 100 })])], requestGameData())
    const f = flowOf(all, 'c1')
    expect(f.requested).toBeCloseTo(50, 4)
    expect(f.rate).toBeCloseTo(50, 4)
    expect(f.capped).toBe(false)
    expect(f.status).toBe('ok')
  })

  it('takes existing output when the item is not a product of the source', () => {
    const source = block('A', [prod('slag', 40)], [planNode('p', 'twin')])
    const all = solveAll([source, gearmaker('B', 25, [link('c1', 'A')])], requestGameData())
    const f = flowOf(all, 'c1')
    expect(f.kind).toBe('take')
    expect('requested' in f).toBe(false)
    expect('requestIgnored' in f).toBe(false)
    expect(f.rate).toBeCloseTo(40, 4)
    expect(f.status).toBe('limited')
    expect(throughput(all, 'A')).toBeCloseTo(40, 4)
  })

  it('sums the requests of several consumers', () => {
    const all = solveAll([
      smelter(),
      gearmaker('B', 25, [link('cb', 'A')]),
      gearmaker('C', 10, [link('cc', 'A')]),
    ], requestGameData())
    expect(throughput(all, 'A')).toBeCloseTo(70, 4)
    expect(flowOf(all, 'cb').rate).toBeCloseTo(50, 4)
    expect(flowOf(all, 'cc').rate).toBeCloseTo(20, 4)
  })

  it('passes requests along a chain', () => {
    const all = solveAll([
      smelter(),
      block('B', [prod('gear')], [planNode('g', 'gear')], [link('cb', 'A')]),
      block('C', [prod('machine', 10)], [planNode('m', 'machine')], [link('cc', 'B', 'gear')]),
    ], requestGameData())
    expect(flowOf(all, 'cc').requested).toBeCloseTo(10, 4)
    expect(flowOf(all, 'cb').requested).toBeCloseTo(20, 4)
    expect(throughput(all, 'B')).toBeCloseTo(10, 4)
    expect(throughput(all, 'A')).toBeCloseTo(20, 4)
  })

  it('asks only for what a locked consumer cannot make with its pinned recipe', () => {
    const consumer = block(
      'B',
      [prod('gear', 25)],
      [planNode('g', 'gear'), pinned('f', 'plateFromIngot', 20)],
      [link('c1', 'A')],
      { noImportItems: ['plate'] },
    )
    const all = solveAll([smelter(), consumer], requestGameData())
    expect(flowOf(all, 'c1').requested).toBeCloseTo(30, 4)
    expect(throughput(all, 'A')).toBeCloseTo(30, 4)
    expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
  })

  it('leaves a request unserved when the source has no recipe for the item', () => {
    const all = solveAll([
      block('A', [prod('plate')], [planNode('i', 'ingot')]),
      gearmaker('B', 25, [link('c1', 'A')]),
    ], requestGameData())
    const f = flowOf(all, 'c1')
    expect(f.requested).toBeCloseTo(50, 4)
    expect(f.rate).toBe(0)
    expect(f.status).toBe('limited')
    expect(all.results.A.warnings).toContainEqual({ type: 'no-recipe', itemId: 'plate' })
    expect(rate(all.results.A.unsatisfied, 'plate')).toBeCloseTo(50, 4)
  })

  it('leaves every request unserved, and the extra with it, when the source makes nothing (full shortfall)', () => {
    const all = solveAll([
      block('A', [prod('plate', 10)], [planNode('i', 'ingot')]),
      gearmaker('B', 25, [link('cb', 'A')]),
      gearmaker('C', 10, [link('cc', 'A')]),
    ], requestGameData())
    expect(flowOf(all, 'cb').requested).toBeCloseTo(50, 4)
    expect(flowOf(all, 'cc').requested).toBeCloseTo(20, 4)
    expect(flowOf(all, 'cb').rate).toBe(0)
    expect(flowOf(all, 'cc').rate).toBe(0)
    expect(flowOf(all, 'cb').status).toBe('limited')
    expect(flowOf(all, 'cc').status).toBe('limited')
    expect(rate(all.results.A.unsatisfied, 'plate')).toBeCloseTo(80, 4)
  })

  it('gives a source with nothing to make the empty result', () => {
    const empty = { nodes: [], unsatisfied: [], warnings: [] }
    const cache = createSolveCache()
    const all = solveAll([smelter()], requestGameData(), cache)
    expect(all.results.A).toEqual(empty)
    expect(cache.has('A')).toBe(false)
  })

  it('ignores products without extra when nothing requests them', () => {
    const source = block('A', [prod('machine'), prod('plate', 10)], [planNode('p', 'plate')])
    const all = solveAll([source], requestGameData())
    expect(all.results.A.warnings.some(w => w.type === 'no-recipe')).toBe(false)
    expect(all.results.A.unsatisfied.some(u => u.itemId === 'machine')).toBe(false)
    expect(throughput(all, 'A')).toBeCloseTo(10, 4)
  })

  it('keeps a request away from a take consumer and from a later source of the same item', () => {
    const all = solveAll([
      block('A1', [prod('plate')], [planNode('i', 'ingot')]),
      block('A2', [prod('plate')], [planNode('p', 'plate')]),
      block('B', [prod('gear', 25)], [planNode('g', 'gear')], [link('b1', 'A1'), link('b2', 'A2')]),
      block('C', [prod('gear', 10)], [planNode('g', 'gear')], [link('c1', 'A2')]),
    ], requestGameData())
    expect(flowOf(all, 'b1').requested).toBeCloseTo(50, 4)
    expect(flowOf(all, 'b2').requested).toBeCloseTo(0, 4)
    expect(flowOf(all, 'b2').rate).toBe(0)
    expect(flowOf(all, 'c1').rate).toBeCloseTo(20, 4)
    expect(rate(all.results.C.unsatisfied, 'plate')).toBe(0)
    expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(50, 4)
  })

  it('takes existing output when the source receives the item itself', () => {
    const all = solveAll([
      block('Z', [prod('slag', 100)], [planNode('p', 'twin')]),
      block('A', [prod('plate')], [planNode('p', 'plate')], [link('cz', 'Z')]),
      gearmaker('B', 25, [link('c1', 'A')]),
    ], requestGameData())
    expect(flowOf(all, 'c1').kind).toBe('take')
    expect(flowOf(all, 'c1').requestIgnored).toBe('source-receives')
    expect(all.results.A.nodes).toEqual([])
  })

  it('ignores a request repeating an earlier (source, item) pair', () => {
    const all = solveAll([smelter(), gearmaker('B', 25, [link('c1', 'A'), link('c2', 'A')])], requestGameData())
    expect(flowOf(all, 'c1').requested).toBeCloseTo(50, 4)
    expect(flowOf(all, 'c2').requestIgnored).toBe('duplicate')
    expect(flowOf(all, 'c2').kind).toBe('take')
    expect(flowOf(all, 'c2').status).toBe('unused')
  })

  describe('cycles of requests', () => {
    // fx/fy turn half an item of one kind into one of the other: around the cycle every x asked
    // of A costs 0.25 x more (gain 0.25). gx/gy are 1:1 (gain 1).
    const cycleData = (): GameData => {
      const data = requestGameData()
      const need = (itemId: string, amount: number) => [{ itemId, type: 'item' as const, amount }]
      data.recipes.fx = recipe('fx', 1, need('y', 0.5), [product('x', 1)])
      data.recipes.fy = recipe('fy', 1, need('x', 0.5), [product('y', 1)])
      data.recipes.gx = recipe('gx', 1, need('y', 1), [product('x', 1)])
      data.recipes.gy = recipe('gy', 1, need('x', 1), [product('y', 1)])
      return data
    }
    const pair = (recipes: [string, string], extra = 60, cb: object = {}, aExtra: Partial<Block> = {}) => [
      block('A', [prod('x', extra)], [planNode('n', recipes[0])], [link('ca', 'B', 'y')], aExtra),
      block('B', [prod('y')], [planNode('n', recipes[1])], [link('cb', 'A', 'x', cb)]),
    ]

    it('solves a cycle of requests in rounds', () => {
      const all = solveAll(pair(['fx', 'fy']), cycleData())
      expect(flowOf(all, 'ca')).toMatchObject({ kind: 'request', status: 'ok' })
      expect(flowOf(all, 'ca').requested).toBeCloseTo(40, 4)
      expect(flowOf(all, 'cb').requested).toBeCloseTo(20, 4)
      expect(flowOf(all, 'ca').rate).toBeCloseTo(40, 4)
      expect(flowOf(all, 'cb').rate).toBeCloseTo(20, 4)
      expect(flowOf(all, 'cb').status).toBe('ok')
      expect(throughput(all, 'A')).toBeCloseTo(80, 4)
      expect(throughput(all, 'B')).toBeCloseTo(40, 4)
      expect(netBalance(all.results.A.nodes).get('x')! - flowOf(all, 'cb').rate).toBeCloseTo(60, 4)
      expect(all.requestLoops).toEqual([
        { blockIds: ['A', 'B'], connectionIds: ['cb', 'ca'], backConnectionIds: ['cb'], rounds: 3, converged: true },
      ])
      expect(all.loops).toHaveLength(1)
      expect(all.loops[0]).toMatchObject({ rounds: 2, converged: true })
      for (const id of ['A', 'B']) {
        expect(all.results[id].warnings.some(w => w.type === 'request-loop-not-converged')).toBe(false)
      }
    })

    it('keeps round 1 and takes existing output when the cycle does not settle', () => {
      const all = solveAll(pair(['gx', 'gy']), cycleData())
      expect(all.requestLoops).toHaveLength(1)
      expect(all.requestLoops[0]).toMatchObject({ rounds: 4, converged: false })
      expect(flowOf(all, 'ca').requested).toBeCloseTo(60, 4)
      expect(flowOf(all, 'cb')).toMatchObject({ kind: 'take', requestIgnored: 'request-loop' })
      expect(flowOf(all, 'cb').rate).toBeCloseTo(60, 4)
      expect(throughput(all, 'A')).toBeCloseTo(60, 4)
      expect(throughput(all, 'B')).toBeCloseTo(60, 4)
      for (const id of ['A', 'B']) {
        expect(all.results[id].warnings).toContainEqual({ type: 'request-loop-not-converged', blockIds: ['A', 'B'], rounds: 4 })
      }
    })

    it('gives the whole need to the other requests of a member when the cycle does not settle', () => {
      const data = cycleData()
      data.recipes.ox = recipe('ox', 1, [], [product('x', 1)])
      const [a, b] = pair(['gx', 'gy'])
      const blocks = [
        a,
        { ...b, inputConnections: [...b.inputConnections, link('co', 'O', 'x')] },
        block('O', [prod('x')], [planNode('o', 'ox')]),
      ]
      const all = solveAll(blocks, data)
      expect(all.requestLoops[0]).toMatchObject({ converged: false })
      expect(flowOf(all, 'cb').requestIgnored).toBe('request-loop')
      expect(flowOf(all, 'co').requested).toBeCloseTo(60, 4)
      expect(flowOf(all, 'co').rate).toBeCloseTo(60, 4)
      expect(flowOf(all, 'cb').rate).toBeCloseTo(0, 4)
      expect(throughput(all, 'O')).toBeCloseTo(60, 4)
      expect(rate(all.results.B.unsatisfied, 'x')).toBe(0)
    })

    it('settles a cycle whose demand grows until a request limit', () => {
      const all = solveAll(pair(['gx', 'gy'], 60, { maxRate: 180 }), cycleData())
      expect(all.requestLoops[0]).toMatchObject({ rounds: 4, converged: true })
      expect(flowOf(all, 'cb').requested).toBeCloseTo(180, 4)
      expect(flowOf(all, 'ca').requested).toBeCloseTo(240, 4)
    })

    it('stops at the round limit and keeps round 1', () => {
      const all = solveAll(pair(['fx', 'fy']), cycleData(), undefined, { requestRoundLimit: 2 })
      expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: false })
      expect(flowOf(all, 'ca').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'cb').requestIgnored).toBe('request-loop')
      expect(flowOf(all, 'cb').rate).toBeCloseTo(15, 4)
    })

    it('settles a cycle that would not by itself once a request has a limit', () => {
      const all = solveAll(pair(['gx', 'gy'], 60, { maxRate: 30 }), cycleData())
      expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: true })
      expect(flowOf(all, 'ca').requested).toBeCloseTo(90, 4)
      expect(flowOf(all, 'cb')).toMatchObject({ kind: 'request', capped: true, status: 'limited' })
      expect(flowOf(all, 'cb').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'cb').rate).toBeCloseTo(30, 4)
      expect(rate(all.results.B.unsatisfied, 'x')).toBeCloseTo(60, 4)
    })

    it('remembers a settled cycle and re-solves it when an input changes', () => {
      const gd = cycleData()
      const cache = createSolveCache()
      const first = solveAll(pair(['fx', 'fy']), gd, cache)
      const lookup = vi.spyOn(cache, 'getRequestLoop')
      const second = solveAll(pair(['fx', 'fy']), gd, cache)
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(lookup.mock.results[0].value).toBeDefined()
      expect(second.results.A).toBe(first.results.A)
      expect(second.results.B).toBe(first.results.B)
      expect(second.requestLoops).toEqual(first.requestLoops)

      const edited = solveAll(pair(['fx', 'fy'], 30), gd, cache)
      expect(lookup.mock.results[1].value).toBeUndefined()
      expect(flowOf(edited, 'ca').requested).toBeCloseTo(20, 4)
      expect(flowOf(edited, 'cb').requested).toBeCloseTo(10, 4)

      const blocks = pair(['fx', 'fy'])
      blocks[1] = { ...blocks[1], rootPlan: makeSubPlan('root-B', [pinned('n', 'fy', 100)]) }
      solveAll(blocks, gd, cache)
      expect(lookup.mock.results[2].value).toBeUndefined()
    })

    it('keeps the warning copy of an unsettled cycle stable across cached solves', () => {
      const gd = cycleData()
      const cache = createSolveCache()
      const first = solveAll(pair(['gx', 'gy']), gd, cache)
      const second = solveAll(pair(['gx', 'gy']), gd, cache)
      expect(second.results.A).toBe(first.results.A)
      expect(second.requestLoops[0]).toMatchObject({ rounds: 4, converged: false })
    })
  })

  describe('takes before requests', () => {
    // T leaves 20 plate over (its goal is slag); A makes plate on request.
    const twinSource = () => block('T', [prod('slag', 20)], [planNode('t', 'twin')])
    const consumer = (id: string, gears: number, connections: Block['inputConnections']) => gearmaker(id, gears, connections)
    const take = (extra: object = {}) => link('ct', 'T', 'plate', extra)
    const request = (extra: object = {}) => link('cr', 'A', 'plate', extra)

    it.each([['take first', true], ['request first', false]])('asks only for what the take does not cover (%s)', (_name, takeFirst) => {
      const links = takeFirst ? [take(), request()] : [request(), take()]
      const all = solveAll([twinSource(), smelter(), consumer('B', 25, links)], requestGameData())
      expect(flowOf(all, 'cr').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'ct').kind).toBe('take')
      expect(flowOf(all, 'ct').rate).toBeCloseTo(20, 4)
      expect(flowOf(all, 'cr').rate).toBeCloseTo(30, 4)
      expect(throughput(all, 'A')).toBeCloseTo(30, 4)
      expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
    })

    it('credits no more than the take limit', () => {
      const all = solveAll([twinSource(), smelter(), consumer('B', 25, [take({ maxRate: 5 }), request()])], requestGameData())
      expect(flowOf(all, 'cr').requested).toBeCloseTo(45, 4)
      expect(flowOf(all, 'ct').rate).toBeCloseTo(5, 4)
    })

    it('limits the request after the take is credited', () => {
      const all = solveAll([twinSource(), smelter(), consumer('B', 25, [take(), request({ maxRate: 20 })])], requestGameData())
      expect(flowOf(all, 'cr').requested).toBeCloseTo(20, 4)
      expect(rate(all.results.B.unsatisfied, 'plate')).toBeCloseTo(10, 4)
    })

    it('credits the leftover of a take source to the consumers in solve order', () => {
      const all = solveAll([
        twinSource(),
        smelter(),
        consumer('B', 25, [take(), request()]),
        consumer('C', 10, [link('ct2', 'T', 'plate'), link('cr2', 'A', 'plate')]),
      ], requestGameData())
      expect(flowOf(all, 'cr').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'cr2').requested).toBeCloseTo(20, 4)
      expect(flowOf(all, 'ct').rate).toBeCloseTo(20, 4)
      expect(flowOf(all, 'ct2').rate).toBeCloseTo(0, 4)
      expect(throughput(all, 'A')).toBeCloseTo(50, 4)
    })

    it('gives no credit when the take source depends on the consumer own requests', () => {
      const data = requestGameData()
      data.recipes.polish = recipe('polish', 1, [{ itemId: 'slag', type: 'item', amount: 1 }], [product('polish', 1)])
      const b = block(
        'B',
        [prod('gear', 25), prod('polish', 10)],
        [planNode('g', 'gear'), planNode('s', 'polish')],
        [take(), request(), link('cs', 'T', 'slag')],
      )
      const all = solveAll([twinSource(), smelter(), b], data)
      expect(flowOf(all, 'cr').requested).toBeCloseTo(50, 4)
      // The take got no credit, so it does not draw ahead of the request: what A made for B is used.
      expect(flowOf(all, 'cr').rate).toBeCloseTo(50, 4)
      expect(flowOf(all, 'ct').rate).toBeCloseTo(0, 4)
      expect(throughput(all, 'A')).toBeCloseTo(50, 4)
    })

    it('reserves a credited take against a take consumer solved before it', () => {
      const all = solveAll([
        twinSource(),
        smelter(),
        consumer('D', 10, [link('dt', 'T', 'plate')]),
        consumer('C', 25, [take(), request()]),
      ], requestGameData())
      expect(flowOf(all, 'cr').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'ct').rate).toBeCloseTo(20, 4)
      expect(flowOf(all, 'dt').rate).toBeCloseTo(0, 4)
      expect(rate(all.results.C.unsatisfied, 'plate')).toBe(0)
      expect(rate(all.results.D.unsatisfied, 'plate')).toBeCloseTo(20, 4)
    })

    it('credits a take source whose own supply is short with what it still offers', () => {
      const data = requestGameData()
      data.recipes.twinOre = recipe('twinOre', 1, [{ itemId: 'ore', type: 'item', amount: 1 }], [product('slag', 1), product('plate', 1)])
      const all = solveAll([
        block('U', [prod('ore')], [planNode('i', 'ingot')]),
        block('T', [prod('slag', 20)], [planNode('t', 'twinOre')], [link('tu', 'U', 'ore')]),
        smelter(),
        consumer('B', 25, [take(), request()]),
      ], data)
      expect(flowOf(all, 'tu').rate).toBe(0)
      expect(flowOf(all, 'cr').requested).toBeCloseTo(30, 4)
      expect(flowOf(all, 'ct').rate).toBeCloseTo(20, 4)
      expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
    })
  })

  it('serves a request inside a loop that closes through a take', () => {
    const all = solveAll([
      block('A', [prod('plate')], [planNode('p', 'plate')], [link('cg', 'B', 'gear')]),
      block('B', [prod('machine', 25)], [planNode('g', 'gear'), planNode('m', 'machine')], [link('c1', 'A')]),
    ], requestGameData())
    expect(all.loops).toHaveLength(1)
    expect(all.loops[0].converged).toBe(true)
    expect(all.requestLoops).toEqual([])
    expect(flowOf(all, 'c1').requested).toBeCloseTo(50, 4)
    expect(flowOf(all, 'c1').rate).toBeCloseTo(50, 4)
    expect(flowOf(all, 'cg').kind).toBe('take')
    expect(rate(all.results.B.unsatisfied, 'plate')).toBe(0)
  })

  it('reuses cached results and re-solves the source when the consumer product changes', () => {
    const gd = requestGameData()
    const cache = createSolveCache()
    const blocks = (gears: number) => [smelter(), gearmaker('B', gears, [link('c1', 'A')])]
    const first = solveAll(blocks(25), gd, cache)
    const second = solveAll(blocks(25), gd, cache)
    expect(second.results.A).toBe(first.results.A)
    expect(second.results.B).toBe(first.results.B)
    const third = solveAll(blocks(10), gd, cache)
    expect(third.results.A).not.toBe(first.results.A)
    expect(throughput(third, 'A')).toBeCloseTo(20, 4)
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

describe('solve — duplicate recipe nodes', () => {
  const machine = () => ({
    id: 'asm', name: 'asm', type: 'assembling-machine' as const, craftingSpeed: 2, energyUsageKw: 100,
    energyType: 'electric' as const, drainKw: 0, moduleSlots: 2, allowedEffects: ['speed' as const],
    craftingCategories: ['crafting'], iconPath: '', hidden: false,
  })
  const data = () => makeGameData({
    recipes: { 'iron-plate': structuredClone(ironRecipe) },
    machines: { asm: machine() },
    defaultMachines: { crafting: 'asm' },
  })
  const goalOf = (rate: number): SolverGoal[] => [{ id: 'g1', itemId: 'iron-plate', rate }]

  it('uses the first node and zeroes the later duplicate', () => {
    const single = solve({ goals: goalOf(60), nodes: [pinned('a', 'iron-plate', 30)] }, data())
    const result = solve(
      { goals: goalOf(60), nodes: [pinned('a', 'iron-plate', 30), pinned('b', 'iron-plate', 90)] },
      data(),
    )
    const [first, second] = result.nodes
    expect(first.throughput).toBeCloseTo(single.nodes[0].throughput, 6)
    expect(second.recipeNodeId).toBe('b')
    expect(second.throughput).toBe(0)
    expect(second.machineCountCeil).toBe(0)
    expect(second.powerKw).toBe(0)
    expect(second.inputRates).toEqual({})
    expect(second.outputRates).toEqual({})
    expect(result.nodes.reduce((sum, n) => sum + n.powerKw, 0)).toBeCloseTo(single.nodes[0].powerKw, 6)
    expect(result.warnings).toContainEqual({ type: 'duplicate-recipe', recipeId: 'iron-plate', count: 2 })
  })
})
