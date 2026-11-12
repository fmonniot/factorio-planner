import { describe, it, expect } from 'vitest'
import { sourceRulesOf } from '../test/sourceRulesOf'
import { solve, solveBlock, flattenBlock } from './index'
import type { Block, GameData, GameRecipeNode, Machine, SolverGoal, RecipeNode, SolvedArea, SolverResult, SourceRule, SubPlan } from '../data/types'

// Synthetic fixtures mirroring the recipes of spec/test-synthetic.md (Nullius item ids and coefficients).
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
  // Generation machines (power:* categories) draw nothing: their energy is the recipe.
  const generation = category.startsWith('power:')
  return {
    id: `machine-${category}`,
    name: `machine-${category}`,
    type: 'assembling-machine',
    craftingSpeed: 1,
    energyUsageKw: generation ? 0 : 100,
    energyType: generation ? 'void' : 'electric',
    drainKw: 0,
    moduleSlots: generation ? 0 : 4,
    allowedEffects: generation ? [] : ['speed', 'productivity', 'consumption', 'pollution', 'quality'],
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
    recipe('nullius-steam-electrolysis', 'nullius-electrolysis', 1,
      [fluid('nullius-steam', 2000)],
      [fluid('nullius-hydrogen', 800), fluid('nullius-oxygen', 400)]),
    recipe('nullius-decompress-oxygen', 'decompression', 1,
      [fluid('nullius-compressed-oxygen', 125)],
      [fluid('nullius-oxygen', 500)]),
    recipe('nullius-acid-nitric', 'basic-chemistry', 1,
      [fluid('nullius-oxygen', 20), fluid('nullius-ammonia', 10)],
      [fluid('nullius-acid-nitric', 5)]),
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
    // Exporter-generated vanilla power recipes (see scripts/power.js): per second per building.
    recipe('power:boiler:coal', 'power:boiler', 1,
      [fluid('water', 60), item('coal', 0.45)],
      [fluid('steam', 60)]),
    recipe('power:steam-engine:steam', 'power:steam-engine', 1,
      [fluid('steam', 30)],
      [fluid('power:electricity', 0.9)]),
    // Vanilla recipes of case 10 (burner fuel).
    recipe('iron-plate', 'smelting', 3.2, [item('iron-ore', 1)], [item('iron-plate', 1)]),
    recipe('solid-fuel-from-light-oil', 'chemistry', 2, [fluid('light-oil', 10)], [item('solid-fuel', 1)]),
    // Case 11 (spare output before connections), plain ids: A makes the goal with X on the side, U uses X, R makes X.
    recipe('case11-make-goal', 'smelting', 1, [item('case11-ore', 1)], [item('case11-goal', 1), item('case11-x', 1)]),
    recipe('case11-use-x', 'smelting', 1, [item('case11-x', 1)], [item('case11-other', 1)]),
    recipe('case11-make-x', 'smelting', 1, [item('case11-feed', 1)], [item('case11-x', 2)]),
  ]
}

function fuelItem(id: string, fuelValueKj: number): GameData['items'][string] {
  return { id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', fuelValueKj, fuelCategory: 'chemical' }
}

// Vanilla burner furnaces: 90 kW, chemical fuel.
function furnace(id: string, craftingSpeed: number): Machine {
  return {
    id, name: id, type: 'furnace', craftingSpeed, energyUsageKw: 90, energyType: 'burner', drainKw: 0, moduleSlots: 0,
    allowedEffects: ['speed', 'productivity', 'consumption'], craftingCategories: ['smelting'], iconPath: '', hidden: false, fuelCategories: ['chemical'],
  }
}

function fuelFluid(id: string, fuelValueKj: number): GameData['items'][string] {
  return { id, name: id, type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '', fuelValueKj }
}

// A furnace burning fluid: 90 kW, speed 1, any fluid with a fuel value.
function fluidFurnace(): Machine {
  return { ...furnace('fluid-furnace', 1), energyType: 'fluid-burner', fuelCategories: undefined }
}

function makeGameData(): GameData {
  const rs = recipes()
  const categories = [...new Set(rs.map(r => r.category))]
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    recipes: Object.fromEntries(rs.map(r => [r.id, r])),
    items: {
      coal: fuelItem('coal', 4000),
      'solid-fuel': fuelItem('solid-fuel', 12000),
      'fuel-gas': fuelFluid('fuel-gas', 300),
      'heavy-fuel': fuelFluid('heavy-fuel', 1200),
    },
    machines: {
      ...Object.fromEntries(categories.map(c => [`machine-${c}`, speedOneMachine(c)])),
      'stone-furnace': furnace('stone-furnace', 1),
      'steel-furnace': furnace('steel-furnace', 2),
      'fluid-furnace': fluidFurnace(),
    },
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
      'speed-and-consumption': {
        id: 'speed-and-consumption',
        name: 'speed-and-consumption',
        iconPath: '',
        category: 'speed',
        tier: 1,
        effects: { speed: 0.2, consumption: 0.5, productivity: 0, quality: 0 },
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

function planNode(recipeId: string, modules: GameRecipeNode['modules'] = [], extra: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id: recipeId, recipeId, modules, byproductPolicy: {}, ...extra }
}

// `modules` maps a recipe id to the modules slotted in its machines; recipes not listed get none.
function run(
  goals: Array<[string, number]>,
  recipeIds: string[],
  modules: Record<string, GameRecipeNode['modules']> = {},
  rows: Record<string, Partial<GameRecipeNode>> = {},
): SolverResult {
  const plan: { goals: SolverGoal[]; nodes: RecipeNode[] } = {
    goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })),
    nodes: recipeIds.map(id => planNode(id, modules[id], rows[id])),
  }
  return solve(plan, makeGameData())
}

// `where` makes the node id of a recipe built in several areas unique.
function rowIn(recipeId: string, where: string): GameRecipeNode {
  return { ...planNode(recipeId), id: `${recipeId}@${where}` }
}

function subPlan(id: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  const now = new Date().toISOString()
  return { id, name: id, nodes, subPlans, ...(area ? { area } : {}), createdAt: now, updatedAt: now }
}

function runBlock(rootPlan: SubPlan, products: Array<[string, number]>): SolverResult {
  const block: Block = {
    id: 'block-1',
    name: 'Block',
    color: '#60a5fa',
    products: products.map(([itemId, extraRate], i) => ({ id: `p${i}`, itemId, extraRate })),
    sourceRules: {},
    inputConnections: [],
    rootPlan,
  }
  return solve(flattenBlock(block), makeGameData())
}

function nodeOf(result: SolverResult, recipeId: string) {
  const n = result.nodes.find(x => x.recipeNodeId === recipeId)
  if (!n) throw new Error(`no solved node for ${recipeId}`)
  return n
}

function unsatisfiedRate(result: SolverResult, itemId: string): number | undefined {
  return result.unsatisfied.find(u => u.itemId === itemId)?.rate
}

// The plan of cases 11 and 12: A (in an area of its own when `withAreas`) makes the goal with X on the side, U uses X, R makes X.
function case11Block(withAreas: boolean, rule: SourceRule, connections = true): Block {
  const a = rowIn('case11-make-goal', 'S')
  const u = rowIn('case11-use-x', 'root')
  const r = rowIn('case11-make-x', 'root')
  const rootPlan = withAreas
    ? subPlan('root', [u, r], [subPlan('S', [a], [], true)])
    : subPlan('root', [a, u, r])
  return {
    id: 'block-11',
    name: 'Block',
    color: '#60a5fa',
    products: [{ id: 'p0', itemId: 'case11-goal', extraRate: 30 }, { id: 'p1', itemId: 'case11-other', extraRate: 50 }],
    sourceRules: { 'case11-x': rule },
    inputConnections: connections ? [{ id: 'c1', itemId: 'case11-x', fromBlockId: 'upstream' }] : [],
    rootPlan,
  }
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

  describe('case 7: intermediate built in two areas', () => {
    // Top level {gear, ingot}; Plate line (area) {plate, ingot}; Rod line (area) {rod}.
    const plateLine = subPlan('plate-line', [rowIn('nullius-iron-plate', 'plate-line'), rowIn('nullius-iron-ingot', 'plate-line')], [], true)
    const rodLine = subPlan('rod-line', [rowIn('nullius-iron-rod', 'rod-line')], [], true)
    const top = subPlan(
      'top',
      [
        rowIn('nullius-iron-gear', 'top'),
        rowIn('nullius-iron-ingot', 'top'),
        { kind: 'subplan', id: 'h1', subPlanId: plateLine.id },
        { kind: 'subplan', id: 'h2', subPlanId: rodLine.id },
      ],
      [plateLine, rodLine],
    )
    const r = runBlock(top, [['nullius-iron-gear', 60]])
    const area = (id: string): SolvedArea => r.areas!.find(a => a.areaId === id)!
    const rate = (flows: SolvedArea['sends'], itemId: string) => flows.find(f => f.itemId === itemId)

    it('sizes every row for its own area', () => {
      const expected: Array<[string, number, number, number]> = [
        ['nullius-iron-gear@top', 30, 2, 2],
        ['nullius-iron-plate@plate-line', 20, 1, 1],
        ['nullius-iron-rod@rod-line', 6, 0.4, 1],
        ['nullius-iron-ingot@plate-line', 40, 5.333, 6],
        ['nullius-iron-ingot@top', 12, 1.6, 2],
      ]
      for (const [id, throughput, count, ceil] of expected) {
        expect(nodeOf(r, id).throughput, `${id} throughput`).toBeCloseTo(throughput, 3)
        expect(nodeOf(r, id).machineCountExact, `${id} machine count`).toBeCloseTo(count, 3)
        expect(nodeOf(r, id).machineCountCeil, `${id} buildings`).toBe(ceil)
      }
      expect(unsatisfiedRate(r, 'iron-ore')).toBeCloseTo(260, 3)
      expect(r.warnings).toEqual([])
    })

    it('reports what each area receives and sends', () => {
      expect(rate(area('top').receives, 'nullius-iron-plate')!.rate).toBeCloseTo(60, 3)
      expect(rate(area('top').receives, 'nullius-iron-rod')!.rate).toBeCloseTo(30, 3)
      expect(rate(area('top').receives, 'iron-ore')).toMatchObject({ boundary: true })
      expect(rate(area('top').receives, 'iron-ore')!.rate).toBeCloseTo(60, 3)
      expect(rate(area('top').sends, 'nullius-iron-gear')).toMatchObject({ boundary: true })
      expect(rate(area('top').sends, 'nullius-iron-gear')!.rate).toBeCloseTo(60, 3)
      expect(rate(area('top').sends, 'nullius-iron-ingot')).toMatchObject({ boundary: false })
      expect(rate(area('top').sends, 'nullius-iron-ingot')!.rate).toBeCloseTo(24, 3)
      expect(rate(area('top').sends, 'nullius-gravel')!.rate).toBeCloseTo(12, 3)
      expect(rate(area('plate-line').receives, 'iron-ore')!.rate).toBeCloseTo(200, 3)
      expect(rate(area('plate-line').sends, 'nullius-iron-plate')!.rate).toBeCloseTo(60, 3)
      expect(rate(area('plate-line').sends, 'nullius-gravel')!.rate).toBeCloseTo(40, 3)
      expect(rate(area('rod-line').receives, 'nullius-iron-ingot')).toMatchObject({ boundary: false })
      expect(rate(area('rod-line').receives, 'nullius-iron-ingot')!.rate).toBeCloseTo(24, 3)
      expect(rate(area('rod-line').sends, 'nullius-iron-rod')!.rate).toBeCloseTo(30, 3)
    })
  })

  describe('case 9: power generation', () => {
    // 10 MW = 600 electricity/min. An engine makes 0.9 per craft at one craft per second per building.
    const r = run([['power:electricity', 600]], ['power:steam-engine:steam', 'power:boiler:coal'])

    it('sizes the engines and the boilers', () => {
      const engine = nodeOf(r, 'power:steam-engine:steam')
      const boiler = nodeOf(r, 'power:boiler:coal')
      expect(engine.throughput).toBeCloseTo(666.667, 3)
      expect(engine.machineCountExact).toBeCloseTo(11.111, 3)
      expect(engine.machineCountCeil).toBe(12)
      expect(engine.powerKw).toBe(0)
      expect(boiler.throughput).toBeCloseTo(333.333, 3)
      expect(boiler.machineCountExact).toBeCloseTo(5.556, 3)
      expect(boiler.machineCountCeil).toBe(6)
      expect(boiler.powerKw).toBe(0)
    })

    it('balances the steam and leaves only coal and water to import', () => {
      expect(nodeOf(r, 'power:steam-engine:steam').inputRates['steam']).toBeCloseTo(20000, 3)
      expect(nodeOf(r, 'power:boiler:coal').outputRates['steam']).toBeCloseTo(20000, 3)
      expect(unsatisfiedRate(r, 'coal')).toBeCloseTo(150, 3)
      expect(unsatisfiedRate(r, 'water')).toBeCloseTo(20000, 3)
      expect(unsatisfiedRate(r, 'steam') ?? 0).toBe(0)
      expect(r.warnings).toEqual([])
    })
  })

  describe('case 10: burner fuel', () => {
    const plates: Array<[string, number]> = [['iron-plate', 60]]

    it('10a: stone furnaces burn the default (lowest-value) fuel instead of drawing power', () => {
      const r = run(plates, ['iron-plate'], {}, { 'iron-plate': { machineId: 'stone-furnace' } })
      const n = nodeOf(r, 'iron-plate')
      expect(n.throughput).toBeCloseTo(60, 3)
      expect(n.machineCountExact).toBeCloseTo(3.2, 3)
      expect(n.inputRates['coal']).toBeCloseTo(4.32, 3)
      expect(n.fuelItemId).toBe('coal')
      expect(n.powerKw).toBe(0)
      expect(unsatisfiedRate(r, 'coal')).toBeCloseTo(4.32, 3)
      expect(r.warnings).toEqual([])
    })

    it('10b: steel furnaces on solid fuel made in the plan', () => {
      const r = run(plates, ['iron-plate', 'solid-fuel-from-light-oil'], {},
        { 'iron-plate': { machineId: 'steel-furnace', fuelItemId: 'solid-fuel' } })
      const furnaces = nodeOf(r, 'iron-plate')
      expect(furnaces.machineCountExact).toBeCloseTo(1.6, 3)
      expect(furnaces.inputRates['solid-fuel']).toBeCloseTo(0.72, 3)
      expect(furnaces.powerKw).toBe(0)
      expect(nodeOf(r, 'solid-fuel-from-light-oil').throughput).toBeCloseTo(0.72, 3)
      expect(unsatisfiedRate(r, 'light-oil')).toBeCloseTo(7.2, 3)
      expect(unsatisfiedRate(r, 'solid-fuel') ?? 0).toBe(0)
      expect(unsatisfiedRate(r, 'coal')).toBeUndefined()
      expect(r.warnings).toEqual([])
    })

    it('10c: speed and consumption modules scale the fuel per execution by (1 + consumption) / (1 + speed)', () => {
      const r = run(plates, ['iron-plate'], { 'iron-plate': [{ moduleId: 'speed-and-consumption', count: 1 }] },
        { 'iron-plate': { machineId: 'stone-furnace' } })
      const n = nodeOf(r, 'iron-plate')
      expect(n.machineCountExact).toBeCloseTo(2.667, 3)
      expect(n.inputRates['coal']).toBeCloseTo(5.4, 3)
    })

    it('10d: a fluid-burning furnace burns the default (lowest-value) fluid per unit, no power draw', () => {
      const r = run(plates, ['iron-plate'], {}, { 'iron-plate': { machineId: 'fluid-furnace' } })
      const n = nodeOf(r, 'iron-plate')
      expect(n.machineCountExact).toBeCloseTo(3.2, 3)
      expect(n.inputRates['fuel-gas']).toBeCloseTo(57.6, 3)
      expect(n.fuelItemId).toBe('fuel-gas')
      expect(n.powerKw).toBe(0)
      expect(unsatisfiedRate(r, 'fuel-gas')).toBeCloseTo(57.6, 3)
      expect(r.warnings).toEqual([])
    })

    it('10d: an explicit fluid choice is burnt instead', () => {
      const r = run(plates, ['iron-plate'], {}, { 'iron-plate': { machineId: 'fluid-furnace', fuelItemId: 'heavy-fuel' } })
      const n = nodeOf(r, 'iron-plate')
      expect(n.inputRates['heavy-fuel']).toBeCloseTo(14.4, 3)
      expect(unsatisfiedRate(r, 'heavy-fuel')).toBeCloseTo(14.4, 3)
      expect(unsatisfiedRate(r, 'fuel-gas')).toBeUndefined()
    })
  })

  describe('case 8: byproducts first', () => {
    // Electrolysis makes H2 (the goal) and O2 on the side; decompression is the only other source of O2.
    const recipeIds = ['nullius-steam-electrolysis', 'nullius-decompress-oxygen', 'nullius-acid-nitric']
    const goals: Array<[string, number]> = [['nullius-hydrogen', 800], ['nullius-acid-nitric', 125]]
    const solveWith = (sourcing: Record<string, 'byproducts-first' | 'connections-first'>) => {
      const plan: { goals: SolverGoal[]; nodes: RecipeNode[]; sourceRules: Block['sourceRules'] } = {
        goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })),
        nodes: recipeIds.map(id => planNode(id)),
        sourceRules: sourceRulesOf(sourcing),
      }
      return solve(plan, makeGameData())
    }

    it('runs the decompression for the oxygen the electrolysis does not cover by default', () => {
      const r = solveWith({})
      expect(nodeOf(r, 'nullius-steam-electrolysis').throughput).toBeCloseTo(1, 3)
      expect(nodeOf(r, 'nullius-acid-nitric').throughput).toBeCloseTo(25, 3)
      expect(nodeOf(r, 'nullius-decompress-oxygen').throughput).toBeCloseTo(0.2, 3)
      expect(unsatisfiedRate(r, 'nullius-compressed-oxygen')).toBeCloseTo(25, 3)
      expect(unsatisfiedRate(r, 'nullius-oxygen') ?? 0).toBe(0)
    })

    it('imports the missing oxygen instead of running the decompression', () => {
      const r = solveWith({ 'nullius-oxygen': 'byproducts-first' })
      expect(nodeOf(r, 'nullius-steam-electrolysis').throughput).toBeCloseTo(1, 3)
      expect(nodeOf(r, 'nullius-acid-nitric').throughput).toBeCloseTo(25, 3)
      expect(nodeOf(r, 'nullius-decompress-oxygen').throughput).toBeCloseTo(0, 3)
      expect(unsatisfiedRate(r, 'nullius-oxygen')).toBeCloseTo(100, 3)
      expect(unsatisfiedRate(r, 'nullius-compressed-oxygen') ?? 0).toBe(0)
    })
  })

  describe('case 11: spare output before connections', () => {
    // A runs for the goal and makes 30 X / min on the side; U uses 50 X / min; R can make X (2 X per run, so that it is cheaper than running A harder for X); X is connections-first
    // with one connection. Guaranteed: the received rate is min(offer, 50 - 30), because `blockDiagnostics`
    // reports the deficit after own production, and that R covers a shortfall of the connection. Observed: that R
    // stays idle when the offer covers the deficit (supply costs 0 against 1 per run).
    const connected = (offer: number) => new Map([['case11-x', offer]])
    const cases: Array<[string, number, number, number]> = [
      // offer, received, R throughput (2 X per run: running A harder for X would tie with R at 1 X per run)
      ['a: offer 100', 100, 20, 0],
      ['b: unlimited offer (request probe)', Infinity, 20, 0],
      ['c: offer 5', 5, 5, 7.5],
    ]
    for (const withAreas of [false, true]) {
      describe(withAreas ? 'with areas' : 'without areas', () => {
        for (const [name, offer, received, makeX] of cases) {
          it(name, () => {
            const { result, received: got } = solveBlock(flattenBlock(case11Block(withAreas, { makeHere: 'after-blocks' })), makeGameData(), connected(offer))
            const id = (recipeId: string) => nodeOf(result, `${recipeId}@${recipeId === 'case11-make-goal' ? 'S' : 'root'}`)
            // Guaranteed.
            expect(got.get('case11-x'), 'received').toBeCloseTo(received, 3)
            expect(id('case11-make-goal').throughput).toBeCloseTo(30, 3)
            expect(id('case11-use-x').throughput).toBeCloseTo(50, 3)
            // Observed for a and b (R idle); guaranteed for c's received rate, observed for R covering the rest.
            expect(id('case11-make-x').throughput, 'R runs for X').toBeCloseTo(makeX, 3)
            expect(unsatisfiedRate(result, 'case11-x') ?? 0, 'X is not imported').toBeCloseTo(0, 3)
          })
        }
      })
    }
  })

  describe("case 12: don't make more here, Import off", () => {
    // Case 11's plan with X set to { makeHere: 'off', importOff: true }: R never runs for X, and what the
    // connection does not deliver is reported as `unsatisfied` (missing) instead of being made.
    const rule: SourceRule = { makeHere: 'off', importOff: true }
    const cases: Array<[string, number | undefined, number, number]> = [
      // offer (undefined: no connection), received, missing
      ['a: no connection', undefined, 0, 20],
      ['b: offer 100', 100, 20, 0],
      ['c: unlimited offer (request probe)', Infinity, 20, 0],
      ['d: offer 5', 5, 5, 15],
    ]
    for (const withAreas of [false, true]) {
      describe(withAreas ? 'with areas' : 'without areas', () => {
        for (const [name, offer, received, missing] of cases) {
          it(name, () => {
            const supply = new Map(offer === undefined ? [] : [['case11-x', offer]])
            const { result, received: got } = solveBlock(flattenBlock(case11Block(withAreas, rule, offer !== undefined)), makeGameData(), supply)
            const id = (recipeId: string) => nodeOf(result, `${recipeId}@${recipeId === 'case11-make-goal' ? 'S' : 'root'}`)
            expect(got.get('case11-x') ?? 0, 'received').toBeCloseTo(received, 3)
            expect(id('case11-make-goal').throughput).toBeCloseTo(30, 3)
            expect(id('case11-use-x').throughput).toBeCloseTo(50, 3)
            expect(id('case11-make-x').throughput, 'R runs for X').toBeCloseTo(0, 3)
            expect(unsatisfiedRate(result, 'case11-x') ?? 0, 'X missing').toBeCloseTo(missing, 3)
            // The solve is the one of Import on: only the reading of the rest differs.
            const on = solveBlock(flattenBlock(case11Block(withAreas, { makeHere: 'off' }, offer !== undefined)), makeGameData(), supply)
            expect(result, 'same solve as Import on').toEqual(on.result)
            expect(got, 'same received as Import on').toEqual(on.received)
          })
        }
        for (const [name, rule] of [['Import off alone', { importOff: true }], ['Receive it first + Import off', { makeHere: 'after-blocks', importOff: true }]] as const) {
          it(`${name} keeps the hard row: R runs for X`, () => {
            const { result } = solveBlock(flattenBlock(case11Block(withAreas, rule, false)), makeGameData(), new Map())
            expect(nodeOf(result, 'case11-make-x@root').throughput, 'R runs for X').toBeCloseTo(10, 3)
            expect(unsatisfiedRate(result, 'case11-x') ?? 0).toBeCloseTo(0, 3)
          })
        }
      })
    }
  })
})
