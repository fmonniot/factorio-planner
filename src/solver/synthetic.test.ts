import { describe, it, expect } from 'vitest'
import { solve } from './index'
import type { GameData, GameRecipeNode, Machine, ProductionGoal, RecipeNode, SolverResult } from '../data/types'

// Synthetic fixtures mirroring the recipes of spec/test-synthetic.md (Nullius export).
// Every category maps to a speed-1 machine, so machineCountExact = throughput × craftingTime / 60.
// Real-data checks are in index.integration.test.ts.

type GameRecipe = GameData['recipes'][string]
type Ingredient = GameRecipe['ingredients'][number]
type Product = GameRecipe['products'][number]

function item(itemId: string, amount: number): Ingredient {
  return { itemId, type: 'item', amount }
}

function fluid(itemId: string, amount: number): Ingredient {
  return { itemId, type: 'fluid', amount }
}

function recipe(
  id: string,
  category: string,
  craftingTime: number,
  ingredients: Ingredient[],
  products: Product[],
): GameRecipe {
  return {
    id,
    name: id,
    category,
    craftingTime,
    ingredients,
    products,
    madeIn: [],
    allowProductivity: true,
    mainProduct: undefined,
    hidden: false,
    subgroup: '',
    order: '',
  }
}

function speedOneMachine(category: string): Machine {
  return {
    id: `machine-${category}`,
    name: `machine-${category}`,
    type: 'assembling-machine',
    craftingSpeed: 1,
    energyUsageKw: 100,
    energyType: 'electric',
    drainKw: 0,
    moduleSlots: 4,
    allowedEffects: ['speed', 'productivity', 'consumption', 'pollution', 'quality'],
    craftingCategories: [category],
    iconPath: '',
    hidden: false,
  }
}

function recipes(): GameRecipe[] {
  return [
    recipe('nullius-iron-ingot', 'dry-smelting', 8,
      [item('iron-ore', 5)],
      [item('nullius-iron-ingot', 2), item('nullius-gravel', 1)]),
    recipe('nullius-iron-plate', 'machine-casting', 3,
      [item('nullius-iron-ingot', 4)],
      [item('nullius-iron-plate', 3)]),
    recipe('nullius-iron-rod', 'machine-casting', 4,
      [item('nullius-iron-ingot', 4)],
      [item('nullius-iron-rod', 5)]),
    recipe('nullius-iron-gear', 'small-crafting', 4,
      [item('nullius-iron-plate', 2), item('nullius-iron-rod', 1)],
      [item('nullius-iron-gear', 2)]),
    recipe('nullius-air-separation-2', 'distillation', 1,
      [fluid('nullius-air', 100)],
      [fluid('nullius-nitrogen', 66), fluid('nullius-residual-gas', 3), fluid('nullius-carbon-dioxide', 30)]),
    recipe('kovarex-enrichment-process', 'centrifuging', 60,
      [item('uranium-235', 40), item('uranium-238', 5)],
      [
        { ...item('uranium-235', 41), ignoredByProductivity: 40 },
        { ...item('uranium-238', 2), ignoredByProductivity: 2 },
      ]),
    recipe('uranium-processing', 'centrifuging', 12,
      [item('uranium-ore', 10)],
      [
        { ...item('uranium-235', 1), probability: 0.007 },
        { ...item('uranium-238', 1), probability: 0.993 },
      ]),
  ]
}

function makeGameData(): GameData {
  const rs = recipes()
  const categories = [...new Set(rs.map(r => r.category))]
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: Object.fromEntries(rs.map(r => [r.id, r])),
    machines: Object.fromEntries(categories.map(c => [`machine-${c}`, speedOneMachine(c)])),
    modules: {
      'productivity-module-3': {
        id: 'productivity-module-3',
        name: 'productivity-module-3',
        iconPath: '',
        category: 'productivity',
        tier: 3,
        effects: { productivity: 0.1, consumption: 0.8, speed: -0.15, quality: 0 },
        limitation: [],
        limitationBlacklist: [],
      },
    },
    beacons: {},
    defaultMachines: Object.fromEntries(categories.map(c => [c, `machine-${c}`])),
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

function planNode(recipeId: string, modules: GameRecipeNode['modules'] = []): GameRecipeNode {
  return { kind: 'game-recipe', id: recipeId, recipeId, modules, byproductPolicy: {} }
}

// `modules` maps a recipe id to the modules slotted in its machines; recipes not listed get none.
function run(
  goals: Array<[string, number]>,
  recipeIds: string[],
  modules: Record<string, GameRecipeNode['modules']> = {},
): SolverResult {
  const plan: { goals: ProductionGoal[]; nodes: RecipeNode[] } = {
    goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })),
    nodes: recipeIds.map(id => planNode(id, modules[id])),
  }
  return solve(plan, makeGameData())
}

function nodeOf(result: SolverResult, recipeId: string) {
  const n = result.nodes.find(x => x.recipeNodeId === recipeId)
  if (!n) throw new Error(`no solved node for ${recipeId}`)
  return n
}

function unsatisfiedRate(result: SolverResult, itemId: string): number | undefined {
  return result.unsatisfied.find(u => u.itemId === itemId)?.rate
}

describe('solver synthetic cases', () => {
  it('case 1: linear chain with byproduct', () => {
    const r = run([['nullius-iron-plate', 60]], ['nullius-iron-plate', 'nullius-iron-ingot'])
    const plate = nodeOf(r, 'nullius-iron-plate')
    const ingot = nodeOf(r, 'nullius-iron-ingot')
    expect(plate.throughput).toBeCloseTo(20, 3)
    expect(plate.machineCountExact).toBeCloseTo(1, 3)
    expect(ingot.throughput).toBeCloseTo(40, 3)
    expect(ingot.machineCountExact).toBeCloseTo(5.333, 3)
    expect(ingot.inputRates['iron-ore']).toBeCloseTo(200, 3)
    expect(unsatisfiedRate(r, 'iron-ore')).toBeCloseTo(200, 3)
    expect(ingot.outputRates['nullius-gravel']).toBeCloseTo(40, 3)
    expect(unsatisfiedRate(r, 'nullius-gravel'), 'gravel is a byproduct, not a shortfall').toBeUndefined()
  })

  it('case 2: shared intermediate', () => {
    const r = run(
      [['nullius-iron-gear', 30]],
      ['nullius-iron-gear', 'nullius-iron-plate', 'nullius-iron-rod', 'nullius-iron-ingot'],
    )
    const expected: Array<[string, number, number]> = [
      ['nullius-iron-gear', 15, 1],
      ['nullius-iron-plate', 10, 0.5],
      ['nullius-iron-rod', 3, 0.2],
      ['nullius-iron-ingot', 26, 3.467],
    ]
    for (const [id, throughput, count] of expected) {
      expect(nodeOf(r, id).throughput, `${id} throughput`).toBeCloseTo(throughput, 3)
      expect(nodeOf(r, id).machineCountExact, `${id} machine count`).toBeCloseTo(count, 3)
    }
    expect(unsatisfiedRate(r, 'iron-ore')).toBeCloseTo(130, 3)
    expect(nodeOf(r, 'nullius-iron-ingot').outputRates['nullius-gravel']).toBeCloseTo(26, 3)
  })

  describe('case 3: multi-output recipe', () => {
    function expectSingleAirSeparation(r: SolverResult) {
      expect(r.nodes).toHaveLength(1)
      const n = nodeOf(r, 'nullius-air-separation-2')
      expect(n.throughput).toBeCloseTo(10, 3)
      expect(n.machineCountExact).toBeCloseTo(0.167, 3)
      expect(n.inputRates['nullius-air']).toBeCloseTo(1000, 3)
      expect(n.outputRates['nullius-residual-gas']).toBeCloseTo(30, 3)
      expect(n.outputRates['nullius-carbon-dioxide']).toBeCloseTo(300, 3)
      expect(unsatisfiedRate(r, 'nullius-air')).toBeCloseTo(1000, 3)
    }

    it('single goal', () => {
      expectSingleAirSeparation(run([['nullius-nitrogen', 660]], ['nullius-air-separation-2']))
    })

    it('3b: two goals served by one execution', () => {
      expectSingleAirSeparation(
        run([['nullius-nitrogen', 660], ['nullius-carbon-dioxide', 300]], ['nullius-air-separation-2']),
      )
    })
  })

  it('case 4: cycle (Kovarex)', () => {
    const r = run([['uranium-235', 5]], ['kovarex-enrichment-process'])
    const n = nodeOf(r, 'kovarex-enrichment-process')
    expect(n.throughput).toBeCloseTo(5, 3)
    expect(n.machineCountExact).toBeCloseTo(5, 3)
    expect(unsatisfiedRate(r, 'uranium-238')).toBeCloseTo(15, 3)
    expect(unsatisfiedRate(r, 'uranium-235')).toBeUndefined()
  })

  it('case 5: probability outputs', () => {
    const r = run([['uranium-235', 1]], ['uranium-processing'])
    const n = nodeOf(r, 'uranium-processing')
    expect(n.throughput).toBeCloseTo(142.857, 3)
    expect(n.machineCountExact).toBeCloseTo(28.571, 3)
    expect(n.inputRates['uranium-ore']).toBeCloseTo(1428.571, 3)
    expect(n.outputRates['uranium-238']).toBeCloseTo(141.857, 3)
  })

  it('case 6: productivity with ignoredByProductivity', () => {
    const base = run([['uranium-235', 5]], ['kovarex-enrichment-process'])
    const r = run(
      [['uranium-235', 5]],
      ['kovarex-enrichment-process'],
      { 'kovarex-enrichment-process': [{ moduleId: 'productivity-module-3', count: 4 }] },
    )
    const n = nodeOf(r, 'kovarex-enrichment-process')
    expect(n.throughput).toBeCloseTo(3.571, 3)
    // The vanilla productivity-module-3 (present in the Nullius export) has speed -0.15, so four
    // of them slow the machine by 60%: the machine count is throughput / 0.4, not the throughput.
    // Nullius's own nullius-productivity-module-3 has no speed penalty.
    expect(n.machineCountExact).toBeCloseTo(5 / 1.4 / 0.4, 3)
    expect(unsatisfiedRate(r, 'uranium-238')).toBeCloseTo(10.714, 3)
    expect(n.throughput / nodeOf(base, 'kovarex-enrichment-process').throughput).toBeCloseTo(1 / 1.4, 3)
  })
})
