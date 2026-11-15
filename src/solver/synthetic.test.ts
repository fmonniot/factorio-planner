import { describe, it, expect, vi } from 'vitest'
import { sourceRulesOf } from '../test/sourceRulesOf'
import { solve, solveAll, solveBlock, flattenBlock } from './index'
import { createSolveCache } from './solveCache'
import type { Block, GameData, ServedEntry, GameRecipeNode, Machine, SolverGoal, RecipeNode, SolvedArea, SolverResult, SourceRule, SubPlan } from '../data/types'

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
    // Case 16 (served order inside a loop of blocks) and case 17 (inside a cycle of requests).
    recipe('case16-make', 'smelting', 1, [item('case16-y', 1)], [item('case16-goal', 1), item('case16-x', 1)]),
    recipe('case16-use', 'smelting', 1, [item('case16-x', 1)], [item('case16-other', 1), item('case16-y', 1)]),
    recipe('case17-make-p', 'smelting', 1, [item('case11-x', 1)], [item('case17-p', 1)]),
    recipe('case17-use-q', 'smelting', 1, [item('case17-q', 1)], [item('case17-r', 1)]),
    recipe('case17-make-q', 'smelting', 1, [item('case11-x', 1)], [item('case17-q', 1)]),
    recipe('case17-use-p', 'smelting', 1, [item('case17-p', 1)], [item('case17-s', 1)]),
    recipe('case13-make-plate', 'smelting', 1, [item('case13-ore', 1)], [item('case13-plate', 1)]),
    recipe('case13-use-plate', 'smelting', 1, [item('case13-plate', 1)], [item('case13-gear', 1)]),
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
  describe('case 13: a source that holds its capacity', () => {
    // A pinned row is the only producer of the goal item. When the pin cannot meet the goal, the plain LP
    // is infeasible and the elastic solve keeps the pin: the goal reports what it lacks.
    const plateBlock = (withAreas: boolean, pin: number, goal: number): Block => {
      const row = { ...rowIn('case13-make-plate', withAreas ? 'S' : 'root'), pinnedRate: pin }
      return {
        id: 'source',
        name: 'Source',
        color: '#60a5fa',
        products: [{ id: 'p0', itemId: 'case13-plate', extraRate: goal }],
        sourceRules: {},
        inputConnections: [],
        rootPlan: withAreas ? subPlan('root', [], [subPlan('S', [row], [], true)]) : subPlan('root', [row]),
      }
    }
    const cases: Array<[string, number, number, number, number, boolean]> = [
      // pin, goal, row runs at, plate short, infeasible-pins
      ['a: pin below the goal', 10, 30, 10, 20, true],
      ['b: pin at the goal', 10, 10, 10, 0, false],
      ['c: pin above the goal', 40, 30, 40, 0, false],
    ]
    for (const withAreas of [false, true]) {
      describe(withAreas ? 'with areas' : 'without areas', () => {
        for (const [name, pin, goal, runs, short, warns] of cases) {
          it(name, () => {
            const { result } = solveBlock(flattenBlock(plateBlock(withAreas, pin, goal)), makeGameData())
            const id = `case13-make-plate@${withAreas ? 'S' : 'root'}`
            expect(nodeOf(result, id).throughput, 'the pin holds').toBeCloseTo(runs, 6)
            expect(unsatisfiedRate(result, 'case13-plate') ?? 0, 'plate short').toBeCloseTo(short, 6)
            expect(result.warnings.some(w => w.type === 'infeasible-pins'), 'infeasible-pins').toBe(warns)
          })
        }
      })
    }

    it('d: serves the requests in solve order and the extra last when the source is short (solveAll)', () => {
      // Source: extra 10 and requests of 30 (B, solved first) and 20 (C); the pin makes 45 of the 60 asked.
      const source: Block = { ...plateBlock(false, 45, 10), id: 'A', name: 'A' }
      const consumer = (id: string, gears: number): Block => ({
        id,
        name: id,
        color: '#60a5fa',
        products: [{ id: `p-${id}`, itemId: 'case13-gear', extraRate: gears }],
        sourceRules: {},
        inputConnections: [{ id: `c-${id}`, itemId: 'case13-plate', fromBlockId: 'A' }],
        rootPlan: subPlan(`root-${id}`, [planNode('case13-use-plate')]),
      })
      const all = solveAll([source, consumer('B', 30), consumer('C', 20)], makeGameData())
      const flow = (id: string) => all.flows.find(f => f.connectionId === id)!
      expect(nodeOf(all.results.A, 'case13-make-plate@root').throughput, 'A makes 45').toBeCloseTo(45, 6)
      expect(unsatisfiedRate(all.results.A, 'case13-plate'), 'A is short by 15').toBeCloseTo(15, 6)
      expect(flow('c-B').requested).toBeCloseTo(30, 6)
      expect(flow('c-B').rate, 'B gets its 30').toBeCloseTo(30, 6)
      expect(flow('c-B').status).toBe('ok')
      expect(flow('c-C').requested).toBeCloseTo(20, 6)
      expect(flow('c-C').rate, 'C gets 15 of 20').toBeCloseTo(15, 6)
      expect(flow('c-C').status).toBe('limited')
      expect(unsatisfiedRate(all.results.C, 'case13-plate'), 'C imports the other 5').toBeCloseTo(5, 6)
      // The extra gives way first: nothing of A's 45 is left for it.
      expect(all.results.A.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case13-make-plate'] })
    })

    it('e: reports the order it served in', () => {
      const source: Block = { ...plateBlock(false, 45, 10), id: 'A', name: 'A' }
      const consumer = (id: string, gears: number): Block => ({
        id,
        name: id,
        color: '#60a5fa',
        products: [{ id: `p-${id}`, itemId: 'case13-gear', extraRate: gears }],
        sourceRules: {},
        inputConnections: [{ id: `c-${id}`, itemId: 'case13-plate', fromBlockId: 'A' }],
        rootPlan: subPlan(`root-${id}`, [planNode('case13-use-plate')]),
      })
      const all = solveAll([source, consumer('B', 30), consumer('C', 20)], makeGameData())
      const list = all.served.A['case13-plate']
      expect(list.consumers).toHaveLength(2)
      expect(list.consumers[0]).toMatchObject({ blockId: 'B', kind: 'request' })
      expect(list.consumers[0].share).toBeCloseTo(30, 6)
      expect(list.consumers[0].got).toBeCloseTo(30, 6)
      expect(list.consumers[1]).toMatchObject({ blockId: 'C', kind: 'request' })
      expect(list.consumers[1].share).toBeCloseTo(20, 6)
      expect(list.consumers[1].got).toBeCloseTo(15, 6)
      expect(list.extra?.place).toBe(2)
      expect(list.extra?.asked).toBeCloseTo(10, 6)
      expect(list.extra?.got).toBeCloseTo(0, 6)
    })

    it.each([false, true])('e: names the pin that holds the plate short, without conflict (areas: %s)', withAreas => {
      const { result } = solveBlock(flattenBlock(plateBlock(withAreas, 10, 30)), makeGameData())
      expect(result.warnings.filter(w => w.type === 'infeasible-pins')).toEqual([
        { type: 'infeasible-pins', recipeIds: ['case13-make-plate'] },
      ])
    })
  })

  // Cases 14 and 15: the served list of a source.
  const listOf = (...names: string[]): ServedEntry[] =>
    names.map((n): ServedEntry => (n === 'extra' ? { kind: 'extra' } : { kind: 'block', blockId: n }))
  const flowIn = (all: ReturnType<typeof solveAll>, id: string) => all.flows.find(f => f.connectionId === id)!
  const mk = (
    id: string,
    products: Array<[string, number]>,
    rows: RecipeNode[],
    links: Block['inputConnections'] = [],
    servedOrder?: ServedEntry[],
    itemId?: string,
  ): Block => ({
    id,
    name: id,
    color: '#60a5fa',
    products: products.map(([i, extraRate], k) => ({ id: `p-${id}-${k}`, itemId: i, extraRate })),
    sourceRules: {},
    inputConnections: links,
    rootPlan: subPlan(`root-${id}`, rows),
    ...(servedOrder && itemId ? { servedOrder: { [itemId]: servedOrder } } : {}),
  })

  describe('case 14: served order of a byproduct', () => {
    const X = 'case11-x'
    const T = (list?: ServedEntry[]) => mk('T', [['case11-goal', 30]], [planNode('case11-make-goal')], [], list, X)
    const H = (id: string, other: number) =>
      mk(id, [['case11-other', other]], [planNode('case11-use-x')], [{ id: `c-${id}`, itemId: X, fromBlockId: 'T' }])
    const check = (all: ReturnType<typeof solveAll>, id: string, rate: number, status: string, imported: number) => {
      const f = flowIn(all, `c-${id}`)
      expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
      expect(f.status, `${id} status`).toBe(status)
      expect(unsatisfiedRate(all.results[id], X) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
      expect(all.results[id].warnings, `${id} warnings`).toEqual([])
    }
    const cases: Array<[string, string[], string[], [number, string, number], [number, string, number]]> = [
      // name, tabs, list, H1 (rate, status, imported), H2
      ['a: no list, H1 first', ['T', 'H1', 'H2'], [], [20, 'ok', 0], [10, 'limited', 15]],
      ['a: no list, H2 first', ['T', 'H2', 'H1'], [], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: H2, H1 in tab order T, H1, H2', ['T', 'H1', 'H2'], ['H2', 'H1'], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: H2, H1 in tab order T, H2, H1', ['T', 'H2', 'H1'], ['H2', 'H1'], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: H1, H2 in tab order T, H1, H2', ['T', 'H1', 'H2'], ['H1', 'H2'], [20, 'ok', 0], [10, 'limited', 15]],
      ['b: H1, H2 in tab order T, H2, H1', ['T', 'H2', 'H1'], ['H1', 'H2'], [20, 'ok', 0], [10, 'limited', 15]],
    ]
    for (const [name, tabs, list, h1, h2] of cases) {
      it(name, () => {
        const byId: Record<string, Block> = { T: T(list.length ? listOf(...list) : undefined), H1: H('H1', 20), H2: H('H2', 25) }
        const all = solveAll(tabs.map(t => byId[t]), makeGameData())
        check(all, 'H1', ...h1)
        check(all, 'H2', ...h2)
        expect(nodeOf(all.results.T, 'case11-make-goal').throughput).toBeCloseTo(30, 6)
        expect(all.results.T.warnings).toEqual([])
      })
    }

    it('b: reports the order, shares and amounts', () => {
      const all = solveAll([T(listOf('H2', 'H1')), H('H1', 20), H('H2', 25)], makeGameData())
      const list = all.served.T[X]
      expect(list.consumers.map(c => c.blockId)).toEqual(['H2', 'H1'])
      expect(list.consumers.map(c => c.kind)).toEqual(['take', 'take'])
      expect(list.consumers[0].share).toBeCloseTo(25, 6)
      expect(list.consumers[0].got).toBeCloseTo(25, 6)
      expect(list.consumers[1].share).toBeCloseTo(5, 6)
      expect(list.consumers[1].got).toBeCloseTo(5, 6)
      expect(list.extra).toBeUndefined()
    })

    describe('c: a takes-first consumer asks its other source for the rest', () => {
      const blocks = (list?: ServedEntry[]): Block[] => [
        T(list),
        mk('A', [[X, 0]], [planNode('case11-make-x')]),
        H('H', 20),
        mk('B', [['case11-other', 25]], [planNode('case11-use-x')], [
          { id: 'c-BT', itemId: X, fromBlockId: 'T' },
          { id: 'c-BA', itemId: X, fromBlockId: 'A' },
        ]),
      ]
      it('no list: B takes 25 from T, asks A for nothing, H is left 5', () => {
        const all = solveAll(blocks(), makeGameData())
        check(all, 'H', 5, 'limited', 15)
        expect(flowIn(all, 'c-BT').rate).toBeCloseTo(25, 6)
        expect(flowIn(all, 'c-BT').status).toBe('ok')
        expect(flowIn(all, 'c-BA')).toMatchObject({ rate: 0, status: 'unused', requested: 0 })
        expect(unsatisfiedRate(all.results.B, X) ?? 0).toBeCloseTo(0, 6)
        expect(all.served.T[X].consumers.find(c => c.blockId === 'B')!.share).toBeCloseTo(25, 6)
        expect(all.results.A.nodes).toEqual([])
      })
      it('list H, B: H 20, B 10 from T and 15 from A', () => {
        const all = solveAll(blocks(listOf('H', 'B')), makeGameData())
        check(all, 'H', 20, 'ok', 0)
        expect(flowIn(all, 'c-BT').rate).toBeCloseTo(10, 6)
        expect(flowIn(all, 'c-BT').status).toBe('ok')
        expect(flowIn(all, 'c-BA').rate).toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-BA').requested).toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-BA').status).toBe('ok')
        expect(unsatisfiedRate(all.results.B, X) ?? 0).toBeCloseTo(0, 6)
        expect(nodeOf(all.results.A, 'case11-make-x').throughput).toBeCloseTo(7.5, 6)
        const shares = Object.fromEntries(all.served.T[X].consumers.map(c => [c.blockId, c.share]))
        expect(shares.H).toBeCloseTo(20, 6)
        expect(shares.B).toBeCloseTo(10, 6)
      })
    })
  })

  describe('case 15: served order of a short product', () => {
    const P = 'case13-plate'
    const A = (list?: ServedEntry[]): Block =>
      mk('A', [[P, 10]], [{ ...rowIn('case13-make-plate', 'root'), pinnedRate: 45 }], [], list, P)
    const C = (id: string, gears: number): Block =>
      mk(id, [['case13-gear', gears]], [planNode('case13-use-plate')], [{ id: `c-${id}`, itemId: P, fromBlockId: 'A' }])
    const E = (): Block => mk('E', [['case13-gear', 5]], [planNode('case13-use-plate')])
    const asked: Record<string, number> = { B: 30, C: 20, D: 10 }
    type Want = Record<string, [number, string, number]> // id → rate, status, imported
    const cases: Array<[string, string[], string[], Want, string[], number, number]> = [
      // name, tabs, list, want, served order, extra got, extra place
      ['a: no list, A B C', ['A', 'B', 'C'], [], { B: [30, 'ok', 0], C: [15, 'limited', 5] }, ['B', 'C'], 0, 2],
      ['b: no list, A C B', ['A', 'C', 'B'], [], { B: [25, 'limited', 5], C: [20, 'ok', 0] }, ['C', 'B'], 0, 2],
      ['c: B, C in tab order A B C', ['A', 'B', 'C'], ['B', 'C'], { B: [30, 'ok', 0], C: [15, 'limited', 5] }, ['B', 'C'], 0, 2],
      ['c: B, C in tab order A C B', ['A', 'C', 'B'], ['B', 'C'], { B: [30, 'ok', 0], C: [15, 'limited', 5] }, ['B', 'C'], 0, 2],
      ['d: C, B in tab order A B C', ['A', 'B', 'C'], ['C', 'B'], { B: [25, 'limited', 5], C: [20, 'ok', 0] }, ['C', 'B'], 0, 2],
      ['d: C, B in tab order A C B', ['A', 'C', 'B'], ['C', 'B'], { B: [25, 'limited', 5], C: [20, 'ok', 0] }, ['C', 'B'], 0, 2],
      ['e: B, extra, C in tab order A B C', ['A', 'B', 'C'], ['B', 'extra', 'C'], { B: [30, 'ok', 0], C: [5, 'limited', 15] }, ['B', 'C'], 10, 1],
      ['e: B, extra, C in tab order A C B', ['A', 'C', 'B'], ['B', 'extra', 'C'], { B: [30, 'ok', 0], C: [5, 'limited', 15] }, ['B', 'C'], 10, 1],
      ['f: entries that do not apply, A B C E', ['A', 'B', 'C', 'E'], ['E', 'ghost', 'C', 'B'], { B: [25, 'limited', 5], C: [20, 'ok', 0] }, ['C', 'B'], 0, 2],
      ['f: entries that do not apply, A C B E', ['A', 'C', 'B', 'E'], ['E', 'ghost', 'C', 'B'], { B: [25, 'limited', 5], C: [20, 'ok', 0] }, ['C', 'B'], 0, 2],
      ['g: no list', ['A', 'B', 'C', 'D'], [], { B: [30, 'ok', 0], C: [15, 'limited', 5], D: [0, 'limited', 10] }, ['B', 'C', 'D'], 0, 3],
      ['g: list D', ['A', 'B', 'C', 'D'], ['D'], { B: [30, 'ok', 0], C: [5, 'limited', 15], D: [10, 'ok', 0] }, ['D', 'B', 'C'], 0, 3],
    ]
    for (const [name, tabs, list, want, order, extraGot, place] of cases) {
      it(name, () => {
        const byId: Record<string, Block> = { A: A(list.length ? listOf(...list) : undefined), B: C('B', 30), C: C('C', 20), D: C('D', 10), E: E() }
        const all = solveAll(tabs.map(t => byId[t]), makeGameData())
        expect(nodeOf(all.results.A, 'case13-make-plate@root').throughput, 'A runs at its pin').toBeCloseTo(45, 6)
        expect(all.results.A.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case13-make-plate'] })
        for (const [id, [rate, status, imported]] of Object.entries(want)) {
          const f = flowIn(all, `c-${id}`)
          expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
          expect(f.status, `${id} status`).toBe(status)
          expect(f.requested, `${id} requested`).toBeCloseTo(asked[id], 6)
          expect(unsatisfiedRate(all.results[id], P) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
        }
        const served = all.served.A[P]
        expect(served.consumers.map(c => c.blockId)).toEqual(order)
        for (const c of served.consumers) {
          expect(c.share, `${c.blockId} share`).toBeCloseTo(asked[c.blockId], 6)
          expect(c.got, `${c.blockId} got`).toBeCloseTo(want[c.blockId][0], 6)
        }
        expect(served.extra?.place, 'extra place').toBe(place)
        expect(served.extra?.got, 'extra got').toBeCloseTo(extraGot, 6)
      })
    }

    it("c: a list in today's order changes nothing", () => {
      const plain = solveAll([A(), C('B', 30), C('C', 20)], makeGameData())
      const ranked = solveAll([A(listOf('B', 'C')), C('B', 30), C('C', 20)], makeGameData())
      expect(ranked.results).toEqual(plain.results)
      expect(ranked.flows).toEqual(plain.flows)
      expect(ranked.served).toEqual(plain.served)
    })
  })

  describe('case 16: served order inside a loop of blocks', () => {
    const X = 'case16-x'
    const Y = 'case16-y'
    const S = (list?: ServedEntry[]): Block =>
      mk('S', [['case16-goal', 30]], [planNode('case16-make')], [
        { id: 'c-S1', itemId: Y, fromBlockId: 'C1' },
        { id: 'c-S2', itemId: Y, fromBlockId: 'C2' },
      ], list, X)
    const C = (id: string, n: number): Block =>
      mk(id, [['case16-other', n]], [planNode('case16-use')], [{ id: `c-${id.slice(1)}`, itemId: X, fromBlockId: 'S' }])
    type Want = [number, string, number] // rate, status, imported
    const cases: Array<[string, string[], string[], string[], Want, Want]> = [
      // name, tabs, list, loop members, C1, C2
      ['a: no list, S C1 C2', ['S', 'C1', 'C2'], [], ['S', 'C1', 'C2'], [20, 'ok', 0], [10, 'limited', 15]],
      ['a: no list, C1 C2 S', ['C1', 'C2', 'S'], [], ['C1', 'S', 'C2'], [20, 'ok', 0], [10, 'limited', 15]],
      ['a: no list, C2 C1 S', ['C2', 'C1', 'S'], [], ['C2', 'S', 'C1'], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: C2, C1 in tabs S C1 C2', ['S', 'C1', 'C2'], ['C2', 'C1'], ['S', 'C1', 'C2'], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: C2, C1 in tabs C1 C2 S', ['C1', 'C2', 'S'], ['C2', 'C1'], ['C1', 'S', 'C2'], [5, 'limited', 15], [25, 'ok', 0]],
      ['b: C2, C1 in tabs C2 C1 S', ['C2', 'C1', 'S'], ['C2', 'C1'], ['C2', 'S', 'C1'], [5, 'limited', 15], [25, 'ok', 0]],
      ['c: C1, C2 in tabs S C1 C2', ['S', 'C1', 'C2'], ['C1', 'C2'], ['S', 'C1', 'C2'], [20, 'ok', 0], [10, 'limited', 15]],
      ['c: C1, C2 in tabs C1 C2 S', ['C1', 'C2', 'S'], ['C1', 'C2'], ['C1', 'S', 'C2'], [20, 'ok', 0], [10, 'limited', 15]],
      ['c: C1, C2 in tabs C2 C1 S', ['C2', 'C1', 'S'], ['C1', 'C2'], ['C2', 'S', 'C1'], [20, 'ok', 0], [10, 'limited', 15]],
    ]
    const blocksOf = (tabs: string[], list: string[]): Block[] => {
      const byId: Record<string, Block> = { S: S(list.length ? listOf(...list) : undefined), C1: C('C1', 20), C2: C('C2', 25) }
      return tabs.map(t => byId[t])
    }
    for (const [name, tabs, list, members, c1, c2] of cases) {
      it(name, () => {
        const all = solveAll(blocksOf(tabs, list), makeGameData())
        expect(all.loops[0].blockIds).toEqual(members)
        expect(all.loops[0]).toMatchObject({ rounds: 2, converged: true })
        for (const [id, [rate, status, imported]] of [['C1', c1], ['C2', c2]] as Array<[string, Want]>) {
          const f = flowIn(all, `c-${id.slice(1)}`)
          expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
          expect(f.status, `${id} status`).toBe(status)
          expect(unsatisfiedRate(all.results[id], X) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
          expect(all.results[id].warnings, `${id} warnings`).toEqual([])
        }
        expect(nodeOf(all.results.S, 'case16-make').throughput).toBeCloseTo(30, 6)
        expect(unsatisfiedRate(all.results.S, Y) ?? 0).toBeCloseTo(0, 6)
        expect(all.results.S.warnings).toEqual([])
        expect(flowIn(all, 'c-S1').rate).toBeCloseTo(20, 6)
        expect(flowIn(all, 'c-S1').status).toBe('ok')
        expect(flowIn(all, 'c-S2').rate).toBeCloseTo(10, 6)
        expect(flowIn(all, 'c-S2').status).toBe('ok')
        if (list.length) {
          const got = all.served.S[X]
          expect(got.consumers.map(c => c.blockId)).toEqual(list)
          expect(got.consumers.map(c => c.kind)).toEqual(['take', 'take'])
          const want = list[0] === 'C2' ? [25, 5] : [20, 10]
          got.consumers.forEach((c, i) => {
            expect(c.share, `${c.blockId} share`).toBeCloseTo(want[i], 6)
            expect(c.got, `${c.blockId} got`).toBeCloseTo(want[i], 6)
          })
          expect(got.extra).toBeUndefined()
        }
      })
    }

    it('d: a round limit of 1 keeps the reserved shares of a list read over a back connection', () => {
      // Tabs C1, C2, C3, S, list (C3, C2, C1), loopRoundLimit 1. C1 reads S over a back connection, so the loop is
      // C1, S, C2, C3 and round 1 has no previous offer to grant from: the list's credits stay reserved.
      // Credits: C3 min(30, 25) = 25, C2 min(30 - 25, 25) = 5, C1 min(0, 20) = 0. S offers 30. C2 is solved before C3
      // and is offered its reserve 5 plus what nobody reserves (30 - 25 - 5 = 0): 5. C3 then gets its 25.
      const S3 = S(listOf('C3', 'C2', 'C1'))
      const blocks = [C('C1', 20), C('C2', 25), C('C3', 25), { ...S3, inputConnections: [...S3.inputConnections, { id: 'c-S3', itemId: Y, fromBlockId: 'C3' }] }]
      const all = solveAll(blocks, makeGameData(), undefined, { loopRoundLimit: 1 })
      expect(all.loops[0]).toMatchObject({ blockIds: ['C1', 'S', 'C2', 'C3'], rounds: 1, converged: false })
      expect(flowIn(all, 'c-2').rate).toBeCloseTo(5, 6)
      expect(flowIn(all, 'c-3').rate).toBeCloseTo(25, 6)
    })

    it('a warm solve reuses every result (no fourth cache slot)', () => {
      const cache = createSolveCache()
      const gd = makeGameData()
      const first = solveAll(blocksOf(['C1', 'C2', 'S'], ['C2', 'C1']), gd, cache)
      const second = solveAll(blocksOf(['C1', 'C2', 'S'], ['C2', 'C1']), gd, cache)
      for (const id of ['S', 'C1', 'C2']) expect(second.results[id], id).toBe(first.results[id])
    })

    describe('e: its two takes replaced by requests in one group, S pinned at 30', () => {
      // S also has X as a product (so C1 and C2 request it) and its row is pinned at 30: the source is short.
      // C1 and C2 make Y per the goal they run for (20 and 25), whatever X they get; S needs 30 Y (its pin),
      // taken in connection order from c-S1 (20) then c-S2 (10), as in the cases above. No request cycle.
      const SP = (list: ServedEntry[]): Block => ({
        ...mk('S', [['case16-goal', 30], [X, 0]], [{ ...planNode('case16-make'), pinnedRate: 30 }], [
          { id: 'c-S1', itemId: Y, fromBlockId: 'C1' },
          { id: 'c-S2', itemId: Y, fromBlockId: 'C2' },
        ]),
        servedOrder: { [X]: list },
      })
      const group = (a: { share?: number }, b: { share?: number }): ServedEntry[] => [
        { kind: 'block', blockId: 'C1', ...a },
        { kind: 'block', blockId: 'C2', tied: true, ...b },
      ]
      const cases: Array<[string, ServedEntry[], Want, Want]> = [
        // name, list, C1, C2
        ['e1: C1, C2 tied: 15 each', group({}, {}), [15, 'limited', 5], [15, 'limited', 10]],
        ['e2: shares 80, 20: C1 covered at 20, C2 gets the rest', group({ share: 80 }, { share: 20 }), [20, 'ok', 0], [10, 'limited', 15]],
        ['e3: shares 20, 80', group({ share: 20 }, { share: 80 }), [6, 'limited', 14], [24, 'limited', 1]],
      ]
      const tabOrders: Array<[string[], string[]]> = [
        [['S', 'C1', 'C2'], ['S', 'C1', 'C2']],
        [['C1', 'C2', 'S'], ['C1', 'S', 'C2']],
        [['C2', 'C1', 'S'], ['C2', 'S', 'C1']],
      ]
      for (const [name, list, c1, c2] of cases) {
        for (const [tabs, members] of tabOrders) {
          it(`${name} in tabs ${tabs.join(' ')}`, () => {
            const byId: Record<string, Block> = { S: SP(list), C1: C('C1', 20), C2: C('C2', 25) }
            const all = solveAll(tabs.map(t => byId[t]), makeGameData())
            expect(all.loops[0].blockIds).toEqual(members)
            expect(all.loops[0]).toMatchObject({ rounds: 2, converged: true })
            for (const [id, [rate, status, imported]] of [['C1', c1], ['C2', c2]] as Array<[string, Want]>) {
              const f = flowIn(all, `c-${id.slice(1)}`)
              expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
              expect(f.status, `${id} status`).toBe(status)
              expect(unsatisfiedRate(all.results[id], X) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
              expect(all.results[id].warnings, `${id} warnings`).toEqual([])
            }
            expect(nodeOf(all.results.S, 'case16-make').throughput).toBeCloseTo(30, 6)
            expect(unsatisfiedRate(all.results.S, Y) ?? 0).toBeCloseTo(0, 6)
            expect(all.results.S.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case16-make'] })
            expect(flowIn(all, 'c-S1').rate).toBeCloseTo(20, 6)
            expect(flowIn(all, 'c-S1').status).toBe('ok')
            expect(flowIn(all, 'c-S2').rate).toBeCloseTo(10, 6)
            expect(flowIn(all, 'c-S2').status).toBe('ok')
            const got = all.served.S[X]
            expect(got.consumers.map(c => c.blockId)).toEqual(['C1', 'C2'])
            expect(got.consumers.map(c => c.kind)).toEqual(['request', 'request'])
            expect(got.consumers.map(c => c.share)).toEqual([20, 25])
            got.consumers.forEach((c, i) => expect(c.got, `${c.blockId} got`).toBeCloseTo([c1, c2][i][0], 6))
            expect(got.extra).toBeUndefined()
          })
        }
      }
    })
  })

  describe('case 17: served order inside a cycle of requests', () => {
    const X = 'case11-x'
    const T = (list?: ServedEntry[]): Block => mk('T', [['case11-goal', 15]], [planNode('case11-make-goal')], [], list, X)
    const V = (): Block => mk('V', [[X, 0]], [planNode('case11-make-x')])
    const K1 = (extra: Block['inputConnections'] = [{ id: 'c-K1T', itemId: X, fromBlockId: 'T' }], list?: ServedEntry[]): Block =>
      mk('K1', [['case17-r', 10], ['case17-p', 0]], [planNode('case17-make-p'), planNode('case17-use-q')], [
        ...extra,
        { id: 'c-K1V', itemId: X, fromBlockId: 'V' },
        { id: 'c-K1q', itemId: 'case17-q', fromBlockId: 'K2' },
      ], list, 'case17-p')
    const K2 = (): Block =>
      mk('K2', [['case17-s', 10], ['case17-q', 0]], [planNode('case17-make-q'), planNode('case17-use-p')], [
        { id: 'c-K2T', itemId: X, fromBlockId: 'T' },
        { id: 'c-K2V', itemId: X, fromBlockId: 'V' },
        { id: 'c-K2p', itemId: 'case17-p', fromBlockId: 'K1' },
      ])
    const blocksOf = (tabs: string[], list: string[]): Block[] => {
      const byId: Record<string, Block> = { T: T(list.length ? listOf(...list) : undefined), V: V(), K1: K1(), K2: K2() }
      return tabs.map(t => byId[t])
    }
    // name, tabs, list, cycle, c-K1T, c-K1V requested, c-K2T, c-K2V requested
    const cases: Array<[string, string[], string[], string[], number, number, number, number]> = [
      ['a: no list, T V K1 K2', ['T', 'V', 'K1', 'K2'], [], ['K1', 'K2'], 10, 0, 5, 5],
      ['a: no list, T V K2 K1', ['T', 'V', 'K2', 'K1'], [], ['K2', 'K1'], 5, 5, 10, 0],
      ['b: K2, K1 in tabs T V K1 K2', ['T', 'V', 'K1', 'K2'], ['K2', 'K1'], ['K1', 'K2'], 5, 5, 10, 0],
      ['b: K2, K1 in tabs T V K2 K1', ['T', 'V', 'K2', 'K1'], ['K2', 'K1'], ['K2', 'K1'], 5, 5, 10, 0],
      ['c: K1, K2 in tabs T V K1 K2', ['T', 'V', 'K1', 'K2'], ['K1', 'K2'], ['K1', 'K2'], 10, 0, 5, 5],
      ['c: K1, K2 in tabs T V K2 K1', ['T', 'V', 'K2', 'K1'], ['K1', 'K2'], ['K2', 'K1'], 10, 0, 5, 5],
    ]
    for (const [name, tabs, list, cycle, k1t, k1v, k2t, k2v] of cases) {
      it(name, () => {
        const all = solveAll(blocksOf(tabs, list), makeGameData())
        expect(all.requestLoops[0].blockIds).toEqual(cycle)
        expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: true })
        const rate = (id: string, want: number, requested?: number) => {
          const f = flowIn(all, id)
          expect(f.rate, `${id} rate`).toBeCloseTo(want, 6)
          expect(f.status, `${id} status`).toBe(want > 0 ? 'ok' : 'unused')
          if (requested !== undefined) expect(f.requested, `${id} requested`).toBeCloseTo(requested, 6)
        }
        rate('c-K1T', k1t)
        rate('c-K1V', k1v, k1v)
        rate('c-K2T', k2t)
        rate('c-K2V', k2v, k2v)
        rate('c-K1q', 10, 10)
        rate('c-K2p', 10, 10)
        expect(nodeOf(all.results.V, 'case11-make-x').throughput).toBeCloseTo(2.5, 6)
        for (const id of ['K1', 'K2']) {
          expect(unsatisfiedRate(all.results[id], X) ?? 0, `${id} imports X`).toBeCloseTo(0, 6)
          expect(all.results[id].warnings, `${id} warnings`).toEqual([])
        }
        const got = all.served.T[X]
        const order = list.length ? list : cycle
        expect(got.consumers.map(c => c.blockId)).toEqual(order)
        const share: Record<string, number> = { K1: k1t, K2: k2t }
        for (const c of got.consumers) expect(c.share, `${c.blockId} share`).toBeCloseTo(share[c.blockId], 6)
      })
    }

    describe('d: an unsettled cycle', () => {
      const K3 = (): Block =>
        mk('K3', [['case17-s', 5]], [planNode('case17-use-p')], [{ id: 'c-K3p', itemId: 'case17-p', fromBlockId: 'K1' }])
      const solve3 = (list: string[]) => {
        return solveAll([T(), V(), K1(undefined, list.length ? listOf(...list) : undefined), K2(), K3()], makeGameData(), undefined, { requestRoundLimit: 1 })
      }
      it.each([[[]], [['K2', 'K3']], [['K3', 'K2']]] as string[][][])('list %j', list => {
        const all = solve3(list)
        expect(all.requestLoops[0]).toMatchObject({ converged: false, rounds: 1 })
        expect(flowIn(all, 'c-K2p')).toMatchObject({ kind: 'take', requestIgnored: 'request-loop', status: 'limited' })
        expect(flowIn(all, 'c-K2p').rate).toBeCloseTo(0, 6)
        expect(flowIn(all, 'c-K3p')).toMatchObject({ kind: 'request', status: 'ok' })
        expect(flowIn(all, 'c-K3p').requested).toBeCloseTo(5, 6)
        expect(flowIn(all, 'c-K3p').rate).toBeCloseTo(5, 6)
        expect(all.served.K1['case17-p'].consumers.map(c => c.blockId)).toEqual(list.length ? list : ['K2', 'K3'])
      })
      it('the flows are equal across the three runs', () => {
        const flows = [[], ['K2', 'K3'], ['K3', 'K2']].map(l => solve3(l).flows)
        expect(flows[1]).toEqual(flows[0])
        expect(flows[2]).toEqual(flows[0])
      })
    })

    it('f: back credits in a cycle that does not settle', () => {
      // K3 asks K1 for 10 p (10 X). List (K2, K1) on T, requestRoundLimit 1, cycle K1, K2. Round 1 reads K2's back credit as 0,
      // so K1 is credited min(15, 10) = 10 and K2 10: 20 of T's 15. The fallback round must read K2's credit (10) as K1's
      // back credit: K1 min(15 - 10, 10) = 5 and asks V for the other 5; K2 10 and asks V nothing.
      const K3 = (): Block =>
        mk('K3', [['case17-s', 10]], [planNode('case17-use-p')], [{ id: 'c-K3p', itemId: 'case17-p', fromBlockId: 'K1' }])
      const all = solveAll([T(listOf('K2', 'K1')), V(), K1(), K2(), K3()], makeGameData(), undefined, { requestRoundLimit: 1 })
      expect(all.requestLoops[0]).toMatchObject({ blockIds: ['K1', 'K2'], converged: false, rounds: 1 })
      expect(flowIn(all, 'c-K1V').requested).toBeCloseTo(5, 6)
      expect(flowIn(all, 'c-K1V').rate).toBeCloseTo(5, 6)
      expect(flowIn(all, 'c-K2V').requested ?? 0).toBeCloseTo(0, 6)
      expect(flowIn(all, 'c-K1T').rate).toBeCloseTo(5, 6)
      expect(flowIn(all, 'c-K2T').rate).toBeCloseTo(10, 6)
      expect(unsatisfiedRate(all.results.K1, X) ?? 0, 'K1 imports X').toBeCloseTo(0, 6)
      expect(unsatisfiedRate(all.results.K2, X) ?? 0, 'K2 imports X').toBeCloseTo(0, 6)
    })

    it('e: a list never changes member order', () => {
      const W = (list?: ServedEntry[]): Block => mk('W', [['case11-goal', 5]], [planNode('case11-make-goal')], [], list, X)
      // K1 only takes X from W (no request of X): without the list nothing but K2 reaches the cycle from outside.
      const k1 = (): Block => {
        const k = K1([{ id: 'c-K1W', itemId: X, fromBlockId: 'W' }])
        return { ...k, inputConnections: k.inputConnections.filter(c => c.id !== 'c-K1V') }
      }
      const blocks = (list?: ServedEntry[]): Block[] => [T(), V(), W(list), k1(), K2()]
      const plain = solveAll(blocks(), makeGameData())
      const ranked = solveAll(blocks(listOf('K1')), makeGameData())
      expect(plain.requestLoops[0].blockIds).toEqual(['K2', 'K1'])
      expect(ranked.requestLoops[0].blockIds).toEqual(plain.requestLoops[0].blockIds)
      expect(ranked.requestLoops[0].backConnectionIds).toEqual(plain.requestLoops[0].backConnectionIds)
    })

    describe('the cycle memo', () => {
      it('a list reorder gives what a cold solve gives', () => {
        const cache = createSolveCache()
        const gd = makeGameData()
        solveAll(blocksOf(['T', 'V', 'K1', 'K2'], ['K1', 'K2']), gd, cache)
        const warm = solveAll(blocksOf(['T', 'V', 'K1', 'K2'], ['K2', 'K1']), gd, cache)
        const cold = solveAll(blocksOf(['T', 'V', 'K1', 'K2'], ['K2', 'K1']), gd)
        expect(warm.flows).toEqual(cold.flows)
        expect(warm.results).toEqual(cold.results)
        expect(warm.requestLoops).toEqual(cold.requestLoops)
        expect(flowIn(warm, 'c-K1V').requested).toBeCloseTo(5, 6)
      })
      it('a take listed below the cycle is not part of the key', () => {
        const H = (n: number): Block => mk('H', [['case11-other', n]], [planNode('case11-use-x')], [{ id: 'c-H', itemId: X, fromBlockId: 'T' }])
        const blocks = (n: number): Block[] => [T(listOf('K2', 'K1', 'H')), V(), K1(), K2(), H(n)]
        const cache = createSolveCache()
        const gd = makeGameData()
        solveAll(blocks(5), gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const warm = solveAll(blocks(10), gd, cache)
        expect(lookup.mock.results[0].value, 'the cycle is not solved again').toBeDefined()
        expect(warm.flows).toEqual(solveAll(blocks(10), gd).flows)
      })
      it('the credit of a take outside the cycle is part of the key', () => {
        const H = (n: number): Block => mk('H', [['case11-other', n]], [planNode('case11-use-x')], [{ id: 'c-H', itemId: X, fromBlockId: 'T' }])
        const blocks = (n: number): Block[] => [T(listOf('H', 'K2', 'K1')), V(), K1(), K2(), H(n)]
        const cache = createSolveCache()
        const gd = makeGameData()
        solveAll(blocks(5), gd, cache)
        const warm = solveAll(blocks(10), gd, cache)
        const cold = solveAll(blocks(10), gd)
        expect(warm.flows).toEqual(cold.flows)
        expect(warm.results).toEqual(cold.results)
        expect(flowIn(warm, 'c-K2V').requested).toBeCloseTo(5, 6)
        expect(flowIn(warm, 'c-K1V').requested).toBeCloseTo(10, 6)
      })
    })
  })

  describe('case 18: shares on a short product', () => {
    // Case 15's fixture: A is pinned at 45 plate/min and makes an extra of 10 on top; B, C, D ask 30, 20, 10.
    const P = 'case13-plate'
    const A = (list?: ServedEntry[]): Block =>
      mk('A', [[P, 10]], [{ ...rowIn('case13-make-plate', 'root'), pinnedRate: 45 }], [], list, P)
    const C = (id: string, gears: number): Block =>
      mk(id, [['case13-gear', gears]], [planNode('case13-use-plate')], [{ id: `c-${id}`, itemId: P, fromBlockId: 'A' }])
    const asked: Record<string, number> = { B: 30, C: 20, D: 10 }
    const groupOf = (spec: Array<[name: string, opts?: { tied?: true; share?: number }]>): ServedEntry[] =>
      spec.map(([name, opts]): ServedEntry => (name === 'extra' ? { kind: 'extra', ...opts } : { kind: 'block', blockId: name, ...opts }))
    type Want = [number, string, number] // rate, status, imported
    const T: { tied: true } = { tied: true }
    const cases: Array<[string, ServedEntry[], Record<string, Want>, string[], number, number]> = [
      // a: B 30, rest 15; the group {C, D} is offered 7.5 each and both lack more.
      ['a: B, {C, D}', groupOf([['B'], ['C'], ['D', T]]), { B: [30, 'ok', 0], C: [7.5, 'limited', 12.5], D: [7.5, 'limited', 2.5] }, ['B', 'C', 'D'], 0, 3],
      // b: rest 15; C weight 80 gets 12, D weight 20 gets 3.
      ['b: B, {C 80, D 20}', groupOf([['B'], ['C', { share: 80 }], ['D', { tied: true, share: 20 }]]), { B: [30, 'ok', 0], C: [12, 'limited', 8], D: [3, 'limited', 7] }, ['B', 'C', 'D'], 0, 3],
      // c: R = 45, the group {B, D} is offered 22.5 each; D takes 10, B takes 22.5, rest 12.5; only B is short (7.5), takes it, rest 5; C takes min(20, 5) = 5.
      ['c: {B, D}, C', groupOf([['B'], ['D', T], ['C']]), { B: [30, 'ok', 0], C: [5, 'limited', 15], D: [10, 'ok', 0] }, ['B', 'D', 'C'], 0, 3],
      // d: one group of three: 15 each; D takes 10 and passes 5; B and C get 2.5 more each.
      ['d: {B, C, D}', groupOf([['B'], ['C', T], ['D', T]]), { B: [17.5, 'limited', 12.5], C: [17.5, 'limited', 2.5], D: [10, 'ok', 0] }, ['B', 'C', 'D'], 0, 3],
      // e: B 30, rest 15; {C, extra} offered 7.5 each: C 7.5, the extra holds 7.5; D (unlisted) gets 0; extra got min(10, 45 - 30 - 7.5) = 7.5.
      ['e: B, {C, extra}', groupOf([['B'], ['C'], ['extra', T]]), { B: [30, 'ok', 0], C: [7.5, 'limited', 12.5], D: [0, 'limited', 10] }, ['B', 'C', 'D'], 7.5, 2],
    ]
    const tabOrders = [['A', 'B', 'C', 'D'], ['A', 'D', 'C', 'B']]
    const check = (all: ReturnType<typeof solveAll>, want: Record<string, Want>, order: string[], extraGot: number, place: number) => {
      expect(nodeOf(all.results.A, 'case13-make-plate@root').throughput, 'A runs at its pin').toBeCloseTo(45, 6)
      expect(all.results.A.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case13-make-plate'] })
      for (const [id, [rate, status, imported]] of Object.entries(want)) {
        const f = flowIn(all, `c-${id}`)
        expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
        expect(f.status, `${id} status`).toBe(status)
        expect(f.requested, `${id} requested`).toBeCloseTo(asked[id], 6)
        expect(unsatisfiedRate(all.results[id], P) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
      }
      const served = all.served.A[P]
      expect(served.consumers.map(c => c.blockId)).toEqual(order)
      for (const c of served.consumers) {
        expect(c.kind, `${c.blockId} kind`).toBe('request')
        expect(c.share, `${c.blockId} share`).toBeCloseTo(asked[c.blockId], 6)
        expect(c.got, `${c.blockId} got`).toBeCloseTo(want[c.blockId][0], 6)
      }
      expect(served.extra?.asked, 'extra asked').toBeCloseTo(10, 6)
      expect(served.extra?.place, 'extra place').toBe(place)
      expect(served.extra?.got, 'extra got').toBeCloseTo(extraGot, 6)
    }
    const run18 = (tabs: string[], list: ServedEntry[]) => {
      const byId: Record<string, Block> = { A: A(list), B: C('B', 30), C: C('C', 20), D: C('D', 10) }
      return solveAll(tabs.map(t => byId[t]), makeGameData())
    }
    for (const [name, list, want, order, extraGot, place] of cases) {
      for (const tabs of tabOrders) {
        it(`${name} in tab order ${tabs.join(' ')}`, () => check(run18(tabs, list), want, order, extraGot, place))
      }
    }

    // A stale head or middle entry never merges or splits groups: the numbers are row a's.
    const rowA = cases[0][2]
    it('g: a stale head promotes its first follower', () => {
      const list: ServedEntry[] = [{ kind: 'block', blockId: 'B' }, { kind: 'block', blockId: 'ghost' }, { kind: 'block', blockId: 'C' }, { kind: 'block', blockId: 'D', tied: true }]
      check(run18(['A', 'B', 'C', 'D'], list), rowA, ['B', 'C', 'D'], 0, 3)
    })
    it('h: a stale middle entry leaves the group as it was', () => {
      const list: ServedEntry[] = [{ kind: 'block', blockId: 'B' }, { kind: 'block', blockId: 'C' }, { kind: 'block', blockId: 'ghost', tied: true }, { kind: 'block', blockId: 'D', tied: true }]
      check(run18(['A', 'B', 'C', 'D'], list), rowA, ['B', 'C', 'D'], 0, 3)
    })

    it('i: a group of takes stays in list order', () => {
      const X = 'case11-x'
      const Tk = (list: ServedEntry[]) => mk('T', [['case11-goal', 30]], [planNode('case11-make-goal')], [], list, X)
      const H = (id: string, other: number) =>
        mk(id, [['case11-other', other]], [planNode('case11-use-x')], [{ id: `c-${id}`, itemId: X, fromBlockId: 'T' }])
      const list: ServedEntry[] = [{ kind: 'block', blockId: 'H2' }, { kind: 'block', blockId: 'H1', tied: true }]
      for (const tabs of [['T', 'H1', 'H2'], ['T', 'H2', 'H1']]) {
        const byId: Record<string, Block> = { T: Tk(list), H1: H('H1', 20), H2: H('H2', 25) }
        const all = solveAll(tabs.map(t => byId[t]), makeGameData())
        expect(flowIn(all, 'c-H2').rate, 'H2').toBeCloseTo(25, 6)
        expect(flowIn(all, 'c-H2').status).toBe('ok')
        expect(flowIn(all, 'c-H1').rate, 'H1').toBeCloseTo(5, 6)
        expect(flowIn(all, 'c-H1').status).toBe('limited')
        expect(unsatisfiedRate(all.results.H1, X) ?? 0).toBeCloseTo(15, 6)
      }
    })
  })
})
