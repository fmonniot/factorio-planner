import { describe, it, expect } from 'vitest'
import { solve, flattenBlock } from './index'
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
    gameDataVersion: '',
    goals,
    noImportItems: [],
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
