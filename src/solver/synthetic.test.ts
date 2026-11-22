import { describe, it, expect, vi } from 'vitest'
import { sourceRulesOf } from '../test/sourceRulesOf'
import { solve, solveAll, solveBlock, flattenBlock, netBalance } from './index'
import { createSolveCache } from './solveCache'
import { areaNeedsOf } from './servedAreas'
import { areaRuleOf } from './areas'
import { outsideLegParts } from './areaRoutes'
import type { AreaRoute, AreaSourceRule, Block, GameData, ServedEntry, GameRecipeNode, Machine, SolverGoal, RecipeNode, SolvedArea, SolverResult, SourceRule, SubPlan } from '../data/types'

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

// A fluid with a temperature: `temperature` on what a recipe makes, `minimumTemperature` / `maximumTemperature` on what it takes.
function warm(itemId: string, amount: number, temperature?: number, minimumTemperature?: number, maximumTemperature?: number): Ingredient & Product {
  return {
    itemId, type: 'fluid', amount,
    ...(temperature === undefined ? {} : { temperature }),
    ...(minimumTemperature === undefined ? {} : { minimumTemperature }),
    ...(maximumTemperature === undefined ? {} : { maximumTemperature }),
  }
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
    // Case 21 (area rules): a second and a third item the areas trade, with no rule on them.
    recipe('case21-make-y', 'smelting', 1, [item('case21-ore', 1)], [item('case21-y', 1)]),
    recipe('case21-use-y', 'smelting', 1, [item('case21-y', 1)], [item('case21-z', 1)]),
    recipe('case21-make-coin', 'smelting', 1, [item('case21-ore', 1)], [item('case21-coin', 1)]),
    recipe('case21-use-coin', 'smelting', 1, [item('case21-coin', 1)], [item('case21-token', 1)]),
    // Case 22 (a connection replaces an import). A: G turns 2 plates into a gear, P turns ingots into plates at
    // three ratios, S turns 1 ore into 1 ingot; a source block mines plate from ore. B: U turns 2 X into the goal
    // and 100 W, R turns 100 W back into 1 X (a loop that loses). D: H makes tools and a z byproduct, Q presses z into coin and plate.
    recipe('case22-gear', 'smelting', 1, [item('case22-plate', 2)], [item('case22-gear', 1)]),
    recipe('case22-plate-1-1', 'smelting', 1, [item('case22-ingot', 1)], [item('case22-plate', 1)]),
    recipe('case22-plate-1-2', 'smelting', 1, [item('case22-ingot', 1)], [item('case22-plate', 2)]),
    recipe('case22-plate-2-1', 'smelting', 1, [item('case22-ingot', 2)], [item('case22-plate', 1)]),
    recipe('case22-ingot', 'smelting', 1, [item('case22-ore', 1)], [item('case22-ingot', 1)]),
    recipe('case22-mine-plate', 'smelting', 1, [item('case22-ore', 1)], [item('case22-plate', 1)]),
    recipe('case22-use-x', 'smelting', 1, [item('case22-x', 2)], [item('case22-goal', 1), item('case22-w', 100)]),
    recipe('case22-recycle', 'smelting', 1, [item('case22-w', 100)], [item('case22-x', 1)]),
    recipe('case22-tool', 'smelting', 1, [item('case22-plate', 2)], [item('case22-tool', 1), item('case22-z', 2)]),
    recipe('case22-press', 'smelting', 1, [item('case22-z', 1), item('case22-ore', 1)], [item('case22-coin', 1), item('case22-plate', 1)]),
    // Case 23 (an absorber chain): G grows the goal and 2 trees from a seed, S saws a tree into 8 wood and gives back 0.9 of the saw it
    // takes, K makes a saw from a plate, P makes 4 plates from a roll; U turns a plate into a gadget, B burns a roll into ash.
    recipe('case23-grow', 'smelting', 1, [item('case23-seed', 1)], [item('case23-goal', 1), item('case23-tree', 2)]),
    recipe('case23-saw-wood', 'smelting', 1, [item('case23-tree', 1), item('case23-saw', 1)], [item('case23-wood', 8), { ...item('case23-saw', 1), probability: 0.9 }]),
    recipe('case23-make-saw', 'smelting', 1, [item('case23-plate', 1)], [item('case23-saw', 1)]),
    recipe('case23-make-plate', 'smelting', 1, [item('case23-roll', 1)], [item('case23-plate', 4)]),
    recipe('case23-use-plate', 'smelting', 1, [item('case23-plate', 1)], [item('case23-gadget', 1)]),
    recipe('case23-burn-roll', 'smelting', 1, [item('case23-roll', 1)], [item('case23-ash', 1)]),
    recipe('case23-mine-roll', 'smelting', 1, [item('case23-rock', 1)], [item('case23-roll', 1)]),
    recipe('case23-use-wood', 'smelting', 1, [item('case23-wood', 1)], [item('case23-lumber', 1)]),
    // Case 24 (a cooling chain on a fluid with Import off): the heater makes 100 used at 300, each cooler takes 100 within its bounds and makes
    // 100 colder, the filter takes 100 at 50 or less.
    recipe('case24-heat', 'smelting', 1, [item('case24-ore', 1)], [warm('case24-used', 100, 300)]),
    recipe('case24-cool-300', 'smelting', 1, [warm('case24-used', 100, undefined, 250, 350)], [warm('case24-used', 100, 200)]),
    recipe('case24-cool-200', 'smelting', 1, [warm('case24-used', 100, undefined, 150, 250)], [warm('case24-used', 100, 100)]),
    recipe('case24-cool-100', 'smelting', 1, [warm('case24-used', 100, undefined, 50, 150)], [warm('case24-used', 100, 25)]),
    recipe('case24-filter', 'smelting', 1, [warm('case24-used', 100, undefined, undefined, 50)], [item('case24-clean', 1)]),
    // Case 25 (keys inside a block): steam made at 165, 500 and at no temperature, taken at 465 or more or at any temperature.
    recipe('case25-boil-165', 'smelting', 1, [item('case25-fuel', 1)], [warm('case25-steam', 60, 165)]),
    recipe('case25-boil-500', 'smelting', 1, [item('case25-fuel', 1)], [warm('case25-steam', 30, 500)]),
    recipe('case25-boil-any', 'smelting', 1, [item('case25-fuel', 1)], [warm('case25-steam', 60)]),
    recipe('case25-turbine', 'smelting', 1, [warm('case25-steam', 60, undefined, 465)], [item('case25-work', 1)]),
    recipe('case25-engine', 'smelting', 1, [warm('case25-steam', 60)], [item('case25-work2', 1)]),
    recipe('case25-reheat', 'smelting', 1, [warm('case25-steam', 60, undefined, 465)], [warm('case25-steam', 60, 165), item('case25-work', 1)]),
    // Case 26 and 27 (connections carry keys): W makes the widget with 500 steam, W2 makes widget2 with 165 steam.
    recipe('case26-make-widget', 'smelting', 1, [item('case25-fuel', 1)], [item('case26-widget', 1), warm('case25-steam', 60, 500)]),
    recipe('case26-make-widget2', 'smelting', 1, [item('case25-fuel', 1)], [item('case26-widget2', 1), warm('case25-steam', 60, 165)]),
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
      // Groups of takes: the flags, weights and areas of a list are part of the key.
      const ent = (blockId: string, o: { tied?: true; share?: number; areaId?: string } = {}): ServedEntry => ({ kind: 'block', blockId, ...o })
      const lists = (a: ServedEntry[], b: ServedEntry[]) => {
        const gd = makeGameData()
        const cache = createSolveCache()
        solveAll([T(a), V(), K1(), K2()], gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const warm = solveAll([T(b), V(), K1(), K2()], gd, cache)
        return { lookup, warm, cold: solveAll([T(b), V(), K1(), K2()], gd) }
      }
      it('M1: tying two entries is part of the key', () => {
        const { lookup, warm, cold } = lists([ent('K2'), ent('K1')], [ent('K2'), ent('K1', { tied: true })])
        expect(lookup.mock.results[0].value, 'the cycle is solved again').toBeUndefined()
        expect(warm.flows).toEqual(cold.flows)
        expect(warm.served).toEqual(cold.served)
        expect(warm.served.T[X].consumers.every(c => c.groupInListOrder === true), 'the group is served in list order').toBe(true)
      })
      it('M2: the weights of a group are part of the key', () => {
        const { lookup, warm, cold } = lists(
          [ent('K2', { share: 60 }), ent('K1', { tied: true, share: 40 })],
          [ent('K2', { share: 40 }), ent('K1', { tied: true, share: 60 })],
        )
        expect(lookup.mock.results[0].value, 'the cycle is solved again').toBeUndefined()
        expect(warm.flows).toEqual(cold.flows)
        expect(warm.served).toEqual(cold.served)
      })
      it('M3: a list on a source the cycle only requests from is not part of the key', () => {
        const VL = (list: ServedEntry[]): Block => mk('V', [[X, 0]], [planNode('case11-make-x')], [], list, X)
        const gd = makeGameData()
        const blocks = (list: ServedEntry[]): Block[] => [T(listOf('K2', 'K1')), VL(list), K1(), K2()]
        const cache = createSolveCache()
        solveAll(blocks([ent('K1'), ent('K2', { tied: true })]), gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const next = [ent('K1', { share: 80 }), ent('K2', { tied: true, share: 20 })]
        const warm = solveAll(blocks(next), gd, cache)
        expect(lookup.mock.results[0].value, 'the cycle is not solved again').toBeDefined()
        const cold = solveAll(blocks(next), gd)
        expect(warm.flows).toEqual(cold.flows)
        expect(warm.served).toEqual(cold.served)
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
      // B, {ghost, C, D}: the stale head leaves, C heads {C, D} (it does not join B's group): B 30, C 7.5, D 7.5 (row a).
      // Merged into B's group it would read {B, C, D} and give B 17.5 (row d).
      const list: ServedEntry[] = [
        { kind: 'block', blockId: 'B' },
        { kind: 'block', blockId: 'ghost' },
        { kind: 'block', blockId: 'C', tied: true },
        { kind: 'block', blockId: 'D', tied: true },
      ]
      check(run18(['A', 'B', 'C', 'D'], list), rowA, ['B', 'C', 'D'], 0, 3)
    })
    it('h: a stale middle entry leaves the group as it was', () => {
      const list: ServedEntry[] = [{ kind: 'block', blockId: 'B' }, { kind: 'block', blockId: 'C' }, { kind: 'block', blockId: 'ghost', tied: true }, { kind: 'block', blockId: 'D', tied: true }]
      check(run18(['A', 'B', 'C', 'D'], list), rowA, ['B', 'C', 'D'], 0, 3)
    })

    it('i: a group of takes is shared by need', () => {
      // T leaves 30 X; H2 needs 25 and H1 20. The group {H2, H1} is offered 15 each and both stay short: credits 15 and 15, grants 15 and 15.
      // (Under phase 3 the group was served in list order: H2 25, H1 5.)
      const X = 'case11-x'
      const Tk = (list: ServedEntry[]) => mk('T', [['case11-goal', 30]], [planNode('case11-make-goal')], [], list, X)
      const H = (id: string, other: number) =>
        mk(id, [['case11-other', other]], [planNode('case11-use-x')], [{ id: `c-${id}`, itemId: X, fromBlockId: 'T' }])
      const list: ServedEntry[] = [{ kind: 'block', blockId: 'H2' }, { kind: 'block', blockId: 'H1', tied: true }]
      for (const tabs of [['T', 'H1', 'H2'], ['T', 'H2', 'H1']]) {
        const byId: Record<string, Block> = { T: Tk(list), H1: H('H1', 20), H2: H('H2', 25) }
        const all = solveAll(tabs.map(t => byId[t]), makeGameData())
        expect(flowIn(all, 'c-H2').rate, 'H2').toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-H2').status).toBe('limited')
        expect(flowIn(all, 'c-H1').rate, 'H1').toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-H1').status).toBe('limited')
        expect(unsatisfiedRate(all.results.H2, X) ?? 0).toBeCloseTo(10, 6)
        expect(unsatisfiedRate(all.results.H1, X) ?? 0).toBeCloseTo(5, 6)
      }
    })

    it('j: a group holding an ignored request is shared by need, the extra a member', () => {
      // A is pinned at 25 plate/min with an extra of 10, and itself receives plate from Z (which has none to give), so every request of
      // A is ignored (source-receives) and B, C, D are takes. List {B, extra}: C, D unlisted.
      // A's estimate is 25 (the goal is the extra, 10). B needs 30: the group {B 30, extra 10} is offered 12.5 each; the extra takes 10
      // and B gets 12.5, then the 2.5 left: credit 15. Grants waterFill(25, [15, 10]) = [15, 10]; C and D get 0, the extra gets 10.
      // (Under phase 3: B 25, the extra 0.)
      const Ap = mk('A', [[P, 10]], [{ ...rowIn('case13-make-plate', 'root'), pinnedRate: 25 }], [{ id: 'c-AZ', itemId: P, fromBlockId: 'Z' }], [{ kind: 'block', blockId: 'B' }, { kind: 'extra', tied: true }], P)
      const Z = mk('Z', [[P, 0]], [])
      for (const tabs of [['Z', 'A', 'B', 'C', 'D'], ['Z', 'A', 'D', 'C', 'B']]) {
        const byId: Record<string, Block> = { Z, A: Ap, B: C('B', 30), C: C('C', 20), D: C('D', 10) }
        const all = solveAll(tabs.map(t => byId[t]), makeGameData())
        expect(flowIn(all, 'c-B').requestIgnored).toBe('source-receives')
        expect(flowIn(all, 'c-B').rate, 'B').toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-C').rate, 'C').toBeCloseTo(0, 6)
        expect(flowIn(all, 'c-D').rate, 'D').toBeCloseTo(0, 6)
        expect(all.served.A[P].extra?.got, 'extra got').toBeCloseTo(10, 6)
      }
    })
  })
  describe('case 19: areas of a consumer', () => {
    // Case 13's recipes. A makes plate (its row pinned); S requests 30 gears' worth; H requests 20, of which area L needs 12 and area B needs 8.
    const P = 'case13-plate'
    const A = (pin: number, list?: ServedEntry[]): Block =>
      mk('A', [[P, 0]], [{ ...rowIn('case13-make-plate', 'root'), pinnedRate: pin }], [], list, P)
    const S = (): Block =>
      mk('S', [['case13-gear', 30]], [planNode('case13-use-plate')], [{ id: 'c-S', itemId: P, fromBlockId: 'A' }])
    const areaBlock = (id: string, conn: string, source: string, product: [string, number], areas: Array<[string, RecipeNode]>): Block => ({
      id,
      name: id,
      color: '#60a5fa',
      products: [{ id: `p-${id}`, itemId: product[0], extraRate: product[1] }],
      sourceRules: {},
      inputConnections: [{ id: conn, itemId: P, fromBlockId: source }],
      rootPlan: subPlan(`root-${id}`, [], areas.map(([aid, row]) => subPlan(aid, [row], [], true))),
    })
    const pinned = (recipeId: string, where: string, rate: number): GameRecipeNode => ({ ...rowIn(recipeId, where), pinnedRate: rate })
    const H = (): Block =>
      areaBlock('H', 'c-H', 'A', ['case13-gear', 20], [['L', pinned('case13-use-plate', 'L', 12)], ['B', pinned('case13-use-plate', 'B', 8)]])
    const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
    const ar = (blockId: string, areaId: string, tied?: true): ServedEntry => ({ kind: 'block', blockId, areaId, ...(tied ? { tied } : {}) })
    const byId = (list?: ServedEntry[], pin = 45): Record<string, Block> => ({ A: A(pin, list), S: S(), H: H() })
    type Line = [blockId: string, areaId: string | undefined, share: number, got: number]
    const linesOf = (all: ReturnType<typeof solveAll>, itemId = P, source = 'A'): Line[] =>
      all.served[source][itemId].consumers.map(c => [c.blockId, c.areaId, c.share, c.got])
    const expectLines = (all: ReturnType<typeof solveAll>, want: Line[]) => {
      const got = linesOf(all)
      expect(got.map(l => [l[0], l[1]]), 'lines').toEqual(want.map(l => [l[0], l[1]]))
      got.forEach((l, i) => {
        expect(l[2], `${l[0]}/${l[1]} share`).toBeCloseTo(want[i][2], 6)
        expect(l[3], `${l[0]}/${l[1]} got`).toBeCloseTo(want[i][3], 6)
      })
      for (const c of all.served.A[P].consumers) if (c.blockId === 'S') expect(c).not.toHaveProperty('areaId')
    }
    const common = (all: ReturnType<typeof solveAll>, pin: number, cS: number, cH: number) => {
      expect(nodeOf(all.results.A, 'case13-make-plate@root').throughput, 'A runs at its pin').toBeCloseTo(pin, 6)
      expect(all.results.A.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case13-make-plate'] })
      expect(nodeOf(all.results.H, 'case13-use-plate@L').throughput).toBeCloseTo(12, 6)
      expect(nodeOf(all.results.H, 'case13-use-plate@B').throughput).toBeCloseTo(8, 6)
      expect(flowIn(all, 'c-S').rate, 'c-S').toBeCloseTo(cS, 6)
      expect(flowIn(all, 'c-H').rate, 'c-H').toBeCloseTo(cH, 6)
      expect(unsatisfiedRate(all.results.H, P) ?? 0, 'H imports').toBeCloseTo(20 - cH, 6)
      expect(all.served.A[P].extra).toBeUndefined()
    }
    const tabs = (order: string[], list?: ServedEntry[], pin = 45) => order.map(t => byId(list, pin)[t])
    const ASH = ['A', 'S', 'H'], AHS = ['A', 'H', 'S']
    const HL = ar('H', 'L'), HB = ar('H', 'B')
    const rows: Array<[string, number, ServedEntry[] | undefined, number, number, Line[], string[][]]> = [
      // name, A's pin, list, c-S, c-H, lines, tab orders
      ['a: no list', 45, undefined, 30, 15, [['S', undefined, 30, 30], ['H', 'L', 12, 12], ['H', 'B', 8, 3]], [ASH]],
      ['b: S, H', 45, [blk('S'), blk('H')], 30, 15, [['S', undefined, 30, 30], ['H', 'L', 12, 12], ['H', 'B', 8, 3]], [ASH, AHS]],
      ['c: S, H/B, H/L', 45, [blk('S'), HB, HL], 30, 15, [['S', undefined, 30, 30], ['H', 'B', 8, 8], ['H', 'L', 12, 7]], [ASH, AHS]],
      ['d: S, {H/L, H/B}', 45, [blk('S'), HL, ar('H', 'B', true)], 30, 15, [['S', undefined, 30, 30], ['H', 'L', 12, 7.5], ['H', 'B', 8, 7.5]], [ASH, AHS]],
      ['e: H/L, S, H/B', 45, [HL, blk('S'), HB], 30, 15, [['H', 'L', 12, 12], ['S', undefined, 30, 30], ['H', 'B', 8, 3]], [ASH, AHS]],
      ['f: {S, H/L}, H/B at pin 36', 36, [blk('S'), { ...HL, tied: true }, HB], 24, 12, [['S', undefined, 30, 24], ['H', 'L', 12, 12], ['H', 'B', 8, 0]], [ASH, AHS]],
      ['g: H/B, S, H', 45, [HB, blk('S'), blk('H')], 30, 15, [['H', 'B', 8, 8], ['S', undefined, 30, 30], ['H', 'L', 12, 7]], [ASH, AHS]],
      ['h: H/L, H/B, S', 45, [HL, HB, blk('S')], 25, 20, [['H', 'L', 12, 12], ['H', 'B', 8, 8], ['S', undefined, 30, 25]], [ASH, AHS]],
    ]
    for (const [name, pin, list, cS, cH, lines, orders] of rows) {
      for (const order of orders) {
        it(`${name} in tab order ${order.join(' ')}`, () => {
          const all = solveAll(tabs(order, list, pin), makeGameData())
          common(all, pin, cS, cH)
          expectLines(all, lines)
        })
      }
    }

    it('reads the needs of H from its request probe: L 12 and B 8, in table order', () => {
      const { result } = solveBlock(flattenBlock(H()), makeGameData(), new Map([[P, Infinity]]))
      expect(areaNeedsOf(result.areaRoutes)!.get(P)).toEqual([{ areaId: 'L', need: 12 }, { areaId: 'B', need: 8 }])
    })

    it('warm equals cold: a second solve through the solve cache reports the same lists', () => {
      const gd = makeGameData()
      const list = [blk('S'), HB, HL]
      const cold = solveAll(tabs(ASH, list), gd)
      const cache = createSolveCache()
      solveAll(tabs(ASH, list), gd, cache)
      const warm = solveAll(tabs(ASH, list), gd, cache)
      expect(warm.served).toEqual(cold.served)
      expect(warm.flows).toEqual(cold.flows)
    })

    it('is bit-identical with one needy area: the same output as a block without areas', () => {
      const one = (withArea: boolean): Block => {
        const row = pinned('case13-use-plate', 'L', 12)
        const b = areaBlock('H', 'c-H', 'A', ['case13-gear', 12], [['L', row]])
        return withArea ? b : { ...b, rootPlan: subPlan('root-H', [row]) }
      }
      const run = (withArea: boolean) => solveAll([A(36, [blk('S'), blk('H')]), S(), one(withArea)], makeGameData())
      const withArea = run(true)
      const without = run(false)
      expect(withArea.served).toEqual(without.served)
      expect(withArea.flows).toEqual(without.flows)
      expect(flowIn(withArea, 'c-S').rate).toBeCloseTo(30, 6)
      expect(flowIn(withArea, 'c-H').rate).toBeCloseTo(6, 6)
      expectLines(withArea, [['S', undefined, 30, 30], ['H', undefined, 12, 6]])
      for (const c of withArea.served.A[P].consumers) expect(c).not.toHaveProperty('areaId')
    })

    describe('stale area entries', () => {
      it('an area entry for an area H does not have is skipped: row b', () => {
        const all = solveAll(tabs(ASH, [blk('S'), ar('H', 'ghost'), blk('H')]), makeGameData())
        common(all, 45, 30, 15)
        expectLines(all, [['S', undefined, 30, 30], ['H', 'L', 12, 12], ['H', 'B', 8, 3]])
      })
      it('an area entry for L, the only area that needs the item, keeps one line for H and does not crash', () => {
        // B makes the plate it uses, so only L needs plate from outside: 12 - 8 = 4.
        const quiet = areaBlock('H', 'c-H', 'A', ['case13-gear', 12], [['L', pinned('case13-use-plate', 'L', 12)], ['B', pinned('case13-make-plate', 'B', 8)]])
        const all = solveAll([A(45, [blk('S'), HL, blk('H')]), S(), quiet], makeGameData())
        const lines = linesOf(all).filter(l => l[0] === 'H')
        expect(lines.map(l => l[1])).toEqual(['L'])
        expect(lines[0][3]).toBeCloseTo(flowIn(all, 'c-H').rate, 6)
        expect(lines[0][2]).toBeCloseTo(flowIn(all, 'c-H').requested!, 6)
      })
    })

    it('an area entry for an area that needs nothing is a zero entry: no line, no grant, H keeps its line', () => {
      // B makes 8 plate and L uses 12: only L needs plate from outside, 12 - 8 = 4. List [S, H/B, H]: S 30 of 30; H/B is a zero entry
      // (share 0, grant 0, no line); H's block entry covers the rest, L: share 4 (c-H requests 4), grant 4. A (pin 45) has room.
      const quiet = areaBlock('H', 'c-H', 'A', ['case13-gear', 12], [['L', pinned('case13-use-plate', 'L', 12)], ['B', pinned('case13-make-plate', 'B', 8)]])
      const all = solveAll([A(45, [blk('S'), HB, blk('H')]), S(), quiet], makeGameData())
      expect(flowIn(all, 'c-S').rate, 'c-S').toBeCloseTo(30, 6)
      expect(flowIn(all, 'c-H').rate, 'c-H').toBeCloseTo(4, 6)
      expectLines(all, [['S', undefined, 30, 30], ['H', 'L', 4, 4]])
    })

    describe('i: a consumer whose areas trade the item', () => {
      // H2 has areas P (makes 5 plate), Q (uses 12) and R (uses 8): the block imports 15; the pairing sends P's 5 to Q, so Q needs 7 and R 8.
      const H2 = (): Block =>
        areaBlock('H2', 'c-H2', 'A', ['case13-gear', 20], [
          ['P', pinned('case13-make-plate', 'P', 5)],
          ['Q', pinned('case13-use-plate', 'Q', 12)],
          ['R', pinned('case13-use-plate', 'R', 8)],
        ])
      const solve2 = (list?: ServedEntry[]) => solveAll([A(10, list), H2()], makeGameData())
      it('needs Q 7 and R 8 (area P needs nothing)', () => {
        const { result } = solveBlock(flattenBlock(H2()), makeGameData(), new Map([[P, Infinity]]))
        expect(areaNeedsOf(result.areaRoutes)!.get(P)).toEqual([{ areaId: 'Q', need: 7 }, { areaId: 'R', need: 8 }])
      })
      const cases: Array<[string, ServedEntry[] | undefined, Line[]]> = [
        ['R, Q', [ar('H2', 'R'), ar('H2', 'Q')], [['H2', 'R', 8, 8], ['H2', 'Q', 7, 2]]],
        ['Q, R', [ar('H2', 'Q'), ar('H2', 'R')], [['H2', 'Q', 7, 7], ['H2', 'R', 8, 3]]],
        ['no list', undefined, [['H2', 'Q', 7, 7], ['H2', 'R', 8, 3]]],
      ]
      for (const [name, list, lines] of cases) {
        it(`list ${name}`, () => {
          const all = solve2(list)
          expect(flowIn(all, 'c-H2').rate, 'c-H2').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-H2').status).toBe('limited')
          expectLines(all, lines)
          expect(linesOf(all).some(l => l[1] === 'P'), 'no P line').toBe(false)
        })
      }
    })

    describe('j: a take into a block with areas, ranked per area', () => {
      const X = 'case11-x'
      const T = (list?: ServedEntry[]): Block => mk('T', [['case11-goal', 30]], [planNode('case11-make-goal')], [], list, X)
      const J = (): Block => mk('J', [['case11-other', 25]], [planNode('case11-use-x')], [{ id: 'c-J', itemId: X, fromBlockId: 'T' }])
      const H3 = (): Block => ({
        ...areaBlock('H3', 'c-H3', 'T', ['case11-other', 20], [['L', pinned('case11-use-x', 'L', 12)], ['B', pinned('case11-use-x', 'B', 8)]]),
        inputConnections: [{ id: 'c-H3', itemId: X, fromBlockId: 'T' }],
      })
      const tabsOf = (order: string[], list?: ServedEntry[]): Block[] => order.map(t => ({ T: T(list), J: J(), H3: H3() })[t]!)
      const h3 = (areaId?: string, tied?: true): ServedEntry => ({ kind: 'block', blockId: 'H3', ...(areaId ? { areaId } : {}), ...(tied ? { tied } : {}) })
      const run = (order: string[], list?: ServedEntry[]) => solveAll(tabsOf(order, list), makeGameData())
      for (const order of [['T', 'J', 'H3'], ['T', 'H3', 'J']]) {
        it(`j1: J, H3/B, H3/L in tab order ${order.join(' ')}`, () => {
          const all = run(order, [blk('J'), h3('B'), h3('L')])
          const f = flowIn(all, 'c-J')
          expect(f.rate, 'c-J').toBeCloseTo(25, 6)
          expect(f.status).toBe('ok')
          expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-H3').status).toBe('limited')
          expect(unsatisfiedRate(all.results.H3, X) ?? 0, 'H3 imports').toBeCloseTo(15, 6)
          expectLinesOf(all, [['J', undefined, 25, 25], ['H3', 'B', 2, 2], ['H3', 'L', 3, 3]])
          const consumers = all.served.T[X].consumers
          expect(consumers.map(c => c.kind)).toEqual(['take', 'take', 'take'])
          expect(consumers.map(c => c.need)).toEqual([25, 8, 12])
          for (const c of consumers) expect(c).not.toHaveProperty('notCredited')
        })
        it(`j2 limitation: a take listed between two entries of its block is credited at the first one, in tab order ${order.join(' ')}`, () => {
          // H3's credit (20) is taken at its first entry, so J is credited 10 and gets 10; a rank-faithful solve would give J 22.
          const all = run(order, [h3('B'), blk('J'), blk('H3')])
          expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-H3').status).toBe('ok')
          expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-J').status).toBe('limited')
          expectLinesOf(all, [['H3', 'B', 8, 8], ['J', undefined, 10, 10], ['H3', 'L', 12, 12]])
        })
      }
      it('j4 limitation: a first entry for an area that needs nothing still holds the credit of the whole consumer', () => {
        // T leaves 10 X. C has area A (needs nothing) and area B (use-x pinned 10: needs 10); J needs 10. List [C/A, J, C].
        // The credit of C is taken at its first entry (C/A, position 0): min(10, 10) = 10, so J, ranked above C's only needy area,
        // is credited 0 and gets 0 (a rank-faithful solve would give J 10, C 0). The order is decided before the needs are known.
        const T10 = mk('T', [['case11-goal', 10]], [planNode('case11-make-goal')], [], [{ kind: 'block', blockId: 'C', areaId: 'A' }, blk('J'), blk('C')], X)
        const J10 = mk('J', [['case11-other', 10]], [planNode('case11-use-x')], [{ id: 'c-J', itemId: X, fromBlockId: 'T' }])
        const C = {
          ...areaBlock('C', 'c-C', 'T', ['case11-other', 10], [['A', pinned('case11-use-x', 'A', 0)], ['B', pinned('case11-use-x', 'B', 10)]]),
          inputConnections: [{ id: 'c-C', itemId: X, fromBlockId: 'T' }],
        }
        const all = solveAll([T10, J10, C], makeGameData())
        expect(flowIn(all, 'c-C').rate, 'c-C').toBeCloseTo(10, 6)
        expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(0, 6)
      })
      it('j5: a block entry after both of its area entries is credited once: list H3/B, H3/L, J', () => {
        // T leaves 30. H3's credit is taken at its first entry: min(30, 20) = 20; H3/L (same connection) adds nothing, so J is
        // credited min(30 - 20, 25) = 10. Shares: B 20 * 8/20 = 8, L 12, J 10; grants 8, 12, 10 (all 30). c-H3 20 ok, c-J 10 limited.
        for (const order of [['T', 'J', 'H3'], ['T', 'H3', 'J']]) {
          const all = run(order, [h3('B'), h3('L'), blk('J')])
          expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-J').status).toBe('limited')
          expectLinesOf(all, [['H3', 'B', 8, 8], ['H3', 'L', 12, 12], ['J', undefined, 10, 10]])
        }
      })
      it('j6: a consumer named only by area entries and a takes-first consumer the list does not name', () => {
        // C (areas L 12, B 8) takes X from T and requests it from V; U (needs 10) does the same and is not named; J needs 5.
        // T leaves 30; list [C/B, J]. C at its first entry: min(30, 20) = 20; J: 30 - 20 = 10, min(10, 5) = 5; U (unlisted, after
        // the listed ones, C counted once): 30 - 20 - 5 = 5, min(5, 10) = 5, and asks V for the other 5. C asks V for 20 - 20 = 0.
        // Grants: C/B 20 * 8/20 = 8, J 5, then C's block entry (rest L) 12, then U 5: 30 in all.
        const V = mk('V', [[X, 0]], [planNode('case11-make-x')])
        const J5 = mk('J', [['case11-other', 5]], [planNode('case11-use-x')], [{ id: 'c-J', itemId: X, fromBlockId: 'T' }])
        const U = mk('U', [['case11-other', 10]], [planNode('case11-use-x')], [{ id: 'c-U', itemId: X, fromBlockId: 'T' }, { id: 'c-UV', itemId: X, fromBlockId: 'V' }])
        const C = {
          ...H3(), id: 'C', name: 'C',
          inputConnections: [{ id: 'c-C', itemId: X, fromBlockId: 'T' }, { id: 'c-CV', itemId: X, fromBlockId: 'V' }],
        } as Block
        const list: ServedEntry[] = [{ kind: 'block', blockId: 'C', areaId: 'B' }, blk('J')]
        for (const order of [['T', 'V', 'J', 'U', 'C'], ['T', 'V', 'C', 'U', 'J']]) {
          const bs: Record<string, Block> = { T: T(list), V, J: J5, U, C }
          const all = solveAll(order.map(t => bs[t]), makeGameData())
          expect(flowIn(all, 'c-C').rate, 'c-C').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-U').rate, 'c-U').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-UV').rate, 'c-UV').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-CV').rate, 'c-CV').toBeCloseTo(0, 6)
        }
      })
      it('j3: no list, an unlisted take-only consumer with two needy areas reports an area line each', () => {
        const all = run(['T', 'J', 'H3'])
        const lines = all.served.T[X].consumers.filter(c => c.blockId === 'H3')
        expect(lines.map(c => c.areaId)).toEqual(['L', 'B'])
        expect(lines.reduce((a, c) => a + c.got, 0)).toBeCloseTo(flowIn(all, 'c-H3').rate, 6)
      })
      it('j3: a list naming only J leaves the take-only H3 unlisted: its areas come from the final solve', () => {
        // T leaves 30. J is credited min(30, 25) = 25; H3 requests nothing, so it has no credit and no share, and gets the 5 left.
        // H3's rows are pinned (L 12, B 8): the final solve needs L 12, B 8. The 5 go to L first (table order): L 5, B 0; shares 0.
        const all = run(['T', 'J', 'H3'], [blk('J')])
        expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(25, 6)
        expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(5, 6)
        expectLinesOf(all, [['J', undefined, 25, 25], ['H3', 'L', 0, 5], ['H3', 'B', 0, 0]])
      })
      it('j3: a warm solve of the unlisted area consumer reads the solve cache only', () => {
        const gd = makeGameData()
        const cache = createSolveCache()
        solveAll(tabsOf(['T', 'J', 'H3']), gd, cache)
        const set = vi.spyOn(cache, 'set')
        const warm = solveAll(tabsOf(['T', 'J', 'H3']), gd, cache)
        expect(set, 'no block is solved again').not.toHaveBeenCalled()
        expect(warm.served).toEqual(solveAll(tabsOf(['T', 'J', 'H3']), gd).served)
      })
      const expectLinesOf = (all: ReturnType<typeof solveAll>, want: Line[]) => {
        const got = linesOf(all, X, 'T')
        expect(got.map(l => [l[0], l[1]]), 'lines').toEqual(want.map(l => [l[0], l[1]]))
        got.forEach((l, i) => {
          expect(l[2], `${l[0]}/${l[1]} share`).toBeCloseTo(want[i][2], 6)
          expect(l[3], `${l[0]}/${l[1]} got`).toBeCloseTo(want[i][3], 6)
        })
      }
    })

    describe('k: a member of a cycle of requests with areas', () => {
      // Case 17's cycle (T, V, K1, K2) with K1 split in two areas: A1 makes p (X needed 10) and A2 uses X (6).
      const X = 'case11-x'
      const T = (list?: ServedEntry[]): Block => mk('T', [['case11-goal', 15]], [planNode('case11-make-goal')], [], list, X)
      const V = (): Block => mk('V', [[X, 0]], [planNode('case11-make-x')])
      const K1 = (): Block => ({
        ...mk('K1', [['case17-r', 10], ['case17-p', 0], ['case11-other', 6]], [], [
          { id: 'c-K1T', itemId: X, fromBlockId: 'T' },
          { id: 'c-K1V', itemId: X, fromBlockId: 'V' },
          { id: 'c-K1q', itemId: 'case17-q', fromBlockId: 'K2' },
        ]),
        rootPlan: subPlan('root-K1', [planNode('case17-use-q')], [
          subPlan('A1', [rowIn('case17-make-p', 'A1')], [], true),
          subPlan('A2', [rowIn('case11-use-x', 'A2')], [], true),
        ]),
      })
      const K2 = (): Block =>
        mk('K2', [['case17-s', 10], ['case17-q', 0]], [planNode('case17-make-q'), planNode('case17-use-p')], [
          { id: 'c-K2T', itemId: X, fromBlockId: 'T' },
          { id: 'c-K2V', itemId: X, fromBlockId: 'V' },
          { id: 'c-K2p', itemId: 'case17-p', fromBlockId: 'K1' },
        ])
      const blocks = (): Block[] => [T(), V(), K1(), K2()]
      const check = (all: ReturnType<typeof solveAll>) => {
        expect(all.requestLoops[0].blockIds).toEqual(['K1', 'K2'])
        expect(all.requestLoops[0].converged).toBe(true)
        const lines = all.served.T[X].consumers.filter(c => c.blockId === 'K1')
        expect(lines.map(c => c.areaId)).toEqual(['A1', 'A2'])
        expect(lines[0].share / lines[1].share, 'shares in proportion to need').toBeCloseTo(10 / 6, 6)
        expect(lines.reduce((a, c) => a + c.got, 0), 'got').toBeCloseTo(flowIn(all, 'c-K1T').rate, 6)
      }
      it('ranks the areas of K1 by the needs of the cycle memo: list K1/A2, K1/A1, K2 on T', () => {
        // T leaves 15 X. Settled round: K1 needs 10 (A1) + 6 (A2) = 16, K2 needs 10. Credits down the list: K1 (first entry) min(15, 16) = 15,
        // K2 min(15 - 15, 10) = 0. Shares of c-K1T: A2 15 * 6/16 = 5.625, A1 15 * 10/16 = 9.375; K2 0. Grants A2 5.625, A1 9.375.
        // c-K1T 15, c-K2T 0; K1 asks V for the 1 it lacks, K2 for 10. Lines in list order: A2 5.625/5.625, A1 9.375/9.375.
        const list: ServedEntry[] = [{ kind: 'block', blockId: 'K1', areaId: 'A2' }, { kind: 'block', blockId: 'K1', areaId: 'A1' }, { kind: 'block', blockId: 'K2' }]
        const all = solveAll([T(list), V(), K1(), K2()], makeGameData())
        expect(all.requestLoops[0].converged).toBe(true)
        expect(flowIn(all, 'c-K1T').rate, 'c-K1T').toBeCloseTo(15, 6)
        expect(flowIn(all, 'c-K2T').rate, 'c-K2T').toBeCloseTo(0, 6)
        const lines = all.served.T[X].consumers.filter(c => c.blockId === 'K1')
        expect(lines.map(c => c.areaId)).toEqual(['A2', 'A1'])
        expect(lines.map(c => c.share)[0]).toBeCloseTo(5.625, 6)
        expect(lines.map(c => c.share)[1]).toBeCloseTo(9.375, 6)
        expect(lines.map(c => c.got)[0]).toBeCloseTo(5.625, 6)
        expect(lines.map(c => c.got)[1]).toBeCloseTo(9.375, 6)
      })
      it('a warm solve of the ranked areas reads the memo of the cycle and reports the same lists', () => {
        const list: ServedEntry[] = [{ kind: 'block', blockId: 'K1', areaId: 'A2' }, { kind: 'block', blockId: 'K1', areaId: 'A1' }, { kind: 'block', blockId: 'K2' }]
        const gd = makeGameData()
        const mkBlocks = () => [T(list), V(), K1(), K2()]
        const cold = solveAll(mkBlocks(), gd)
        const cache = createSolveCache()
        solveAll(mkBlocks(), gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const warm = solveAll(mkBlocks(), gd, cache)
        expect(lookup.mock.results[0].value, 'the cycle is not solved again').toBeDefined()
        expect(warm.served).toEqual(cold.served)
        expect(warm.flows).toEqual(cold.flows)
      })
      it('M4: the order of the area entries of K1 is part of the key', () => {
        const a: ServedEntry[] = [{ kind: 'block', blockId: 'K1', areaId: 'A2' }, { kind: 'block', blockId: 'K1', areaId: 'A1' }, { kind: 'block', blockId: 'K2' }]
        const b: ServedEntry[] = [{ kind: 'block', blockId: 'K1', areaId: 'A1' }, { kind: 'block', blockId: 'K1', areaId: 'A2' }, { kind: 'block', blockId: 'K2' }]
        const gd = makeGameData()
        const cache = createSolveCache()
        solveAll([T(a), V(), K1(), K2()], gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const warm = solveAll([T(b), V(), K1(), K2()], gd, cache)
        expect(lookup.mock.results[0].value, 'the cycle is solved again').toBeUndefined()
        const cold = solveAll([T(b), V(), K1(), K2()], gd)
        expect(warm.served).toEqual(cold.served)
        expect(warm.flows).toEqual(cold.flows)
      })
      it('splits the take of K1 by the needs of its areas', () => {
        check(solveAll(blocks(), makeGameData()))
      })
      it('warm equals cold, the second solve reading the memo of the cycle', () => {
        const gd = makeGameData()
        const cold = solveAll(blocks(), gd)
        const cache = createSolveCache()
        solveAll(blocks(), gd, cache)
        const lookup = vi.spyOn(cache, 'getRequestLoop')
        const warm = solveAll(blocks(), gd, cache)
        expect(lookup.mock.results[0].value, 'the cycle is not solved again').toBeDefined()
        check(warm)
        expect(warm.served).toEqual(cold.served)
        expect(warm.flows).toEqual(cold.flows)
      })
    })
  })
  describe('case 20: groups of takes', () => {
    // Case 11's recipes: T makes 30 goal and 30 X; each H takes X and makes `other` from it. A group of takes is credited by
    // need (see spec/test-synthetic.md): the members' needs are probed ahead, then the source's X is water-filled by weight.
    const X = 'case11-x'
    const P = 'case13-plate'
    const ent = (blockId: string, o: { tied?: true; share?: number; areaId?: string } = {}): ServedEntry => ({ kind: 'block', blockId, ...o })
    const tied = (blockId: string, share?: number): ServedEntry => ent(blockId, { tied: true, ...(share !== undefined ? { share } : {}) })
    const T = (list?: ServedEntry[]): Block => mk('T', [['case11-goal', 30]], [planNode('case11-make-goal')], [], list, X)
    const H = (id: string, other: number, maxRate?: number): Block =>
      mk(id, [['case11-other', other]], [planNode('case11-use-x')], [{ id: `c-${id}`, itemId: X, fromBlockId: 'T', ...(maxRate !== undefined ? { maxRate } : {}) }])
    type Want = [rate: number, status: string, imported: number]
    const linesOf = (all: ReturnType<typeof solveAll>, source = 'T', itemId = X) => all.served[source][itemId].consumers
    const expectFlow = (all: ReturnType<typeof solveAll>, id: string, [rate, status, imported]: Want, item = X) => {
      const f = flowIn(all, `c-${id}`)
      expect(f.rate, `${id} rate`).toBeCloseTo(rate, 6)
      expect(f.status, `${id} status`).toBe(status)
      expect(unsatisfiedRate(all.results[id], item) ?? 0, `${id} imports`).toBeCloseTo(imported, 6)
    }
    const noFlags = (all: ReturnType<typeof solveAll>) => {
      for (const c of linesOf(all)) {
        expect(c, `${c.blockId} groupInListOrder`).not.toHaveProperty('groupInListOrder')
        expect(c, `${c.blockId} notCredited`).not.toHaveProperty('notCredited')
      }
    }
    const expectLine = (all: ReturnType<typeof solveAll>, blockId: string, share: number, need: number | undefined, areaId?: string) => {
      const c = linesOf(all).find(l => l.blockId === blockId && l.areaId === areaId)
      expect(c, `${blockId}/${areaId} line`).toBeDefined()
      expect(c!.share, `${blockId} share`).toBeCloseTo(share, 6)
      if (need !== undefined) expect(c!.need, `${blockId} need`).toBeCloseTo(need, 6)
    }
    const tabsOf = (order: string[], byId: Record<string, Block>): Block[] => order.map(t => byId[t])

    describe('a: two takes of one byproduct', () => {
      const rows: Array<[string, ServedEntry[], number, number, number | undefined, [number, number], Want, Want]> = [
        // name, list, H1 n, H2 n, c-H2 maxRate, credits (= grants) H1 H2, H1, H2
        ['a1: {H1, H2}', [ent('H1'), tied('H2')], 10, 25, undefined, [10, 20], [10, 'ok', 0], [20, 'limited', 5]],
        ['a2: {H2, H1}', [ent('H2'), tied('H1')], 10, 25, undefined, [10, 20], [10, 'ok', 0], [20, 'limited', 5]],
        ['a3: {H1 80, H2 20}', [ent('H1', { share: 80 }), tied('H2', 20)], 10, 25, undefined, [10, 20], [10, 'ok', 0], [20, 'limited', 5]],
        ['a4: {H1 20, H2 80}', [ent('H1', { share: 20 }), tied('H2', 80)], 10, 25, undefined, [6, 24], [6, 'limited', 4], [24, 'limited', 1]],
        ['a5: {H1, H2}, both short', [ent('H1'), tied('H2')], 20, 25, undefined, [15, 15], [15, 'limited', 5], [15, 'limited', 10]],
        ['a6: {H1, H2}, c-H2 capped at 12', [ent('H1'), tied('H2')], 20, 25, 12, [18, 12], [18, 'limited', 2], [12, 'limited', 13]],
      ]
      for (const [name, list, n1, n2, cap, credits, h1, h2] of rows) {
        for (const tabs of [['T', 'H1', 'H2'], ['T', 'H2', 'H1']]) {
          it(`${name} in tabs ${tabs.join(' ')}`, () => {
            const all = solveAll(tabsOf(tabs, { T: T(list), H1: H('H1', n1), H2: H('H2', n2, cap) }), makeGameData())
            expectFlow(all, 'H1', h1)
            expectFlow(all, 'H2', h2)
            expect(nodeOf(all.results.T, 'case11-make-goal').throughput).toBeCloseTo(30, 6)
            const order = list.map(e => (e.kind === 'block' ? e.blockId : ''))
            expect(linesOf(all).map(c => c.blockId)).toEqual(order)
            expect(linesOf(all).map(c => c.kind)).toEqual(['take', 'take'])
            expectLine(all, 'H1', credits[0], n1)
            expectLine(all, 'H2', credits[1], n2)
            for (const c of linesOf(all)) expect(c.got, `${c.blockId} got`).toBeCloseTo(c.blockId === 'H1' ? h1[0] : h2[0], 6)
            noFlags(all)
          })
        }
      }

      it('a7: a block with areas is one member, its credit split by the needs of its areas', () => {
        // J needs 25. H3 has areas L (pinned 12) and B (pinned 8). List [J, H3/L tied, H3/B tied]: members J (weight 1) and H3 (weight 2).
        // waterFill(30, [25, 20], [1, 2]): offers 10 and 20; J short; H3 covered at exactly 20. Credits J 10, H3 20; H3's credit splits 12 and 8.
        const J = mk('J', [['case11-other', 25]], [planNode('case11-use-x')], [{ id: 'c-J', itemId: X, fromBlockId: 'T' }])
        const pinnedUse = (where: string, rate: number): GameRecipeNode => ({ ...rowIn('case11-use-x', where), pinnedRate: rate })
        const H3: Block = {
          ...mk('H3', [['case11-other', 20]], [], [{ id: 'c-H3', itemId: X, fromBlockId: 'T' }]),
          rootPlan: subPlan('root-H3', [], [subPlan('L', [pinnedUse('L', 12)], [], true), subPlan('B', [pinnedUse('B', 8)], [], true)]),
        }
        const list: ServedEntry[] = [ent('J'), ent('H3', { tied: true, areaId: 'L' }), ent('H3', { tied: true, areaId: 'B' })]
        for (const tabs of [['T', 'J', 'H3'], ['T', 'H3', 'J']]) {
          const all = solveAll(tabsOf(tabs, { T: T(list), J, H3 }), makeGameData())
          expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-J').status).toBe('limited')
          expect(unsatisfiedRate(all.results.J, X) ?? 0, 'J imports').toBeCloseTo(15, 6)
          expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-H3').status).toBe('ok')
          expect(unsatisfiedRate(all.results.H3, X) ?? 0, 'H3 imports').toBeCloseTo(0, 6)
          const lines = linesOf(all).map(c => [c.blockId, c.areaId, c.share, c.got] as const)
          expect(lines.map(l => [l[0], l[1]])).toEqual([['J', undefined], ['H3', 'L'], ['H3', 'B']])
          expect(lines.map(l => l[2])).toEqual([expect.closeTo(10, 6), expect.closeTo(12, 6), expect.closeTo(8, 6)])
          expect(lines.map(l => l[3])).toEqual([expect.closeTo(10, 6), expect.closeTo(12, 6), expect.closeTo(8, 6)])
          expect(linesOf(all)[0].need).toBeCloseTo(25, 6)
          noFlags(all)
        }
      })

      describe('a8: a readiness edge makes the group share', () => {
        const H2 = (): Block =>
          mk('H2', [['case11-other', 25], [P, 0]], [planNode('case11-use-x'), planNode('case13-make-plate')], [{ id: 'c-H2', itemId: X, fromBlockId: 'T' }])
        const R = (): Block =>
          mk('R', [['case13-gear', 5]], [planNode('case13-use-plate')], [{ id: 'c-RH2', itemId: P, fromBlockId: 'H2' }])
        for (const tabs of [['T', 'H1', 'R', 'H2'], ['T', 'H2', 'R', 'H1']]) {
          it(`in tabs ${tabs.join(' ')}`, () => {
            const all = solveAll(tabsOf(tabs, { T: T([ent('H1'), tied('H2')]), H1: H('H1', 20), R: R(), H2: H2() }), makeGameData())
            expectFlow(all, 'H1', [15, 'limited', 5])
            expectFlow(all, 'H2', [15, 'limited', 10])
            expect(flowIn(all, 'c-RH2').requested, 'plate requested').toBeCloseTo(5, 6)
            expect(flowIn(all, 'c-RH2').rate).toBeCloseTo(5, 6)
            expect(flowIn(all, 'c-RH2').status).toBe('ok')
            noFlags(all)
          })
        }
      })
    })

    describe('b: a takes-first member asks its other source for the rest', () => {
      const blocks = (list: ServedEntry[]): Record<string, Block> => ({
        T: T(list),
        A: mk('A', [[X, 0]], [planNode('case11-make-x')]),
        H: H('H', 20),
        B: mk('B', [['case11-other', 25]], [planNode('case11-use-x')], [
          { id: 'c-BT', itemId: X, fromBlockId: 'T' },
          { id: 'c-BA', itemId: X, fromBlockId: 'A' },
        ]),
      })
      const rows: Array<[string, ServedEntry[], string[], Want, [number, number], number, number, number]> = [
        // name, list, served order, H, c-BT (share, need), c-BA requested = rate, make-x throughput
        ['b1: {H, B}', [ent('H'), tied('B')], ['H', 'B'], [15, 'limited', 5], [15, 25], 10, 5, 15],
        ['b2: {B, H}', [ent('B'), tied('H')], ['B', 'H'], [15, 'limited', 5], [15, 25], 10, 5, 15],
        ['b3: {H 20, B 80}', [ent('H', { share: 20 }), tied('B', 80)], ['H', 'B'], [6, 'limited', 14], [24, 25], 1, 0.5, 6],
      ]
      for (const [name, list, order, h, [btShare, btNeed], ba, makeX, hShare] of rows) {
        for (const tabs of [['T', 'A', 'H', 'B'], ['T', 'B', 'H', 'A']]) {
          it(`${name} in tabs ${tabs.join(' ')}`, () => {
            const all = solveAll(tabsOf(tabs, blocks(list)), makeGameData())
            expectFlow(all, 'H', h)
            expect(flowIn(all, 'c-BT').rate, 'c-BT').toBeCloseTo(btShare, 6)
            expect(flowIn(all, 'c-BT').status).toBe('ok')
            expect(flowIn(all, 'c-BA').requested, 'c-BA requested').toBeCloseTo(ba, 6)
            expect(flowIn(all, 'c-BA').rate, 'c-BA').toBeCloseTo(ba, 6)
            expect(flowIn(all, 'c-BA').status).toBe('ok')
            expect(nodeOf(all.results.A, 'case11-make-x').throughput, 'make-x').toBeCloseTo(makeX, 6)
            expect(unsatisfiedRate(all.results.B, X) ?? 0, 'B imports').toBeCloseTo(0, 6)
            expect(linesOf(all).map(c => c.blockId)).toEqual(order)
            expectLine(all, 'H', hShare, 20)
            expectLine(all, 'B', btShare, btNeed)
            noFlags(all)
          })
        }
      }
    })

    describe('c: the fallback, a group served in list order and flagged', () => {
      const H2 = (): Block =>
        mk('H2', [['case11-other', 25], [P, 0]], [planNode('case11-use-x'), planNode('case13-make-plate')], [{ id: 'c-H2', itemId: X, fromBlockId: 'T' }])
      const H1R = (): Block =>
        mk('H1', [['case11-other', 20]], [planNode('case11-use-x')], [
          { id: 'c-H1', itemId: X, fromBlockId: 'T' },
          { id: 'c-H1R', itemId: X, fromBlockId: 'R' },
        ])
      const R = (): Block =>
        mk('R', [[X, 0], ['case13-gear', 5]], [planNode('case11-make-x'), planNode('case13-use-plate')], [{ id: 'c-RH2', itemId: P, fromBlockId: 'H2' }])
      const flagged = (all: ReturnType<typeof solveAll>, id: string) => linesOf(all).find(c => c.blockId === id)!
      const tabOrders = [['T', 'H1', 'R', 'H2'], ['T', 'H2', 'R', 'H1']]

      for (const tabs of tabOrders) {
        it(`c1: a need not known in time, list {H1, H2}, tabs ${tabs.join(' ')}`, () => {
          const all = solveAll(tabsOf(tabs, { T: T([ent('H1'), tied('H2')]), H1: H1R(), R: R(), H2: H2() }), makeGameData())
          expect(flowIn(all, 'c-H1').rate, 'c-H1').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-H1').status).toBe('ok')
          expect(unsatisfiedRate(all.results.H1, X) ?? 0, 'H1 imports').toBeCloseTo(0, 6)
          expect(flowIn(all, 'c-H1R')).toMatchObject({ rate: 0, status: 'unused', requested: 0 })
          expectFlow(all, 'H2', [10, 'limited', 15])
          expect(flowIn(all, 'c-RH2').requested, 'plate requested').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-RH2').rate).toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-RH2').status).toBe('ok')
          expectLine(all, 'H1', 20, 20)
          expectLine(all, 'H2', 10, 25)
          for (const id of ['H1', 'H2']) {
            expect(flagged(all, id).groupInListOrder, `${id} flag`).toBe(true)
            expect(flagged(all, id)).not.toHaveProperty('notCredited')
          }
        })
        it(`c1b: the same fixture, list {H2, H1}, tabs ${tabs.join(' ')}`, () => {
          const all = solveAll(tabsOf(tabs, { T: T([ent('H2'), tied('H1')]), H1: H1R(), R: R(), H2: H2() }), makeGameData())
          expectFlow(all, 'H2', [25, 'ok', 0])
          expect(flowIn(all, 'c-H1')).toMatchObject({ rate: 0, status: 'unused' })
          expect(flowIn(all, 'c-H1R')).toMatchObject({ status: 'ok' })
          expect(flowIn(all, 'c-H1R').requested, 'c-H1R requested').toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-H1R').rate).toBeCloseTo(20, 6)
          expect(nodeOf(all.results.R, 'case11-make-x').throughput, 'make-x').toBeCloseTo(10, 6)
          expect(unsatisfiedRate(all.results.H1, X) ?? 0, 'H1 imports').toBeCloseTo(0, 6)
          expectLine(all, 'H2', 25, 25)
          expectLine(all, 'H1', 0, 20)
          expect(flagged(all, 'H2').groupInListOrder).toBe(true)
          expect(flagged(all, 'H2')).not.toHaveProperty('notCredited')
          expect(flagged(all, 'H1')).toMatchObject({ groupInListOrder: true, notCredited: true })
        })
      }

      // Case 17's fixture: T makes 15 X, V makes X on request, K1 and K2 request each other's product and each needs 10 X.
      const T17 = (list?: ServedEntry[]): Block => mk('T', [['case11-goal', 15]], [planNode('case11-make-goal')], [], list, X)
      const V = (): Block => mk('V', [[X, 0]], [planNode('case11-make-x')])
      const K1 = (): Block =>
        mk('K1', [['case17-r', 10], ['case17-p', 0]], [planNode('case17-make-p'), planNode('case17-use-q')], [
          { id: 'c-K1T', itemId: X, fromBlockId: 'T' },
          { id: 'c-K1V', itemId: X, fromBlockId: 'V' },
          { id: 'c-K1q', itemId: 'case17-q', fromBlockId: 'K2' },
        ])
      const K2 = (): Block =>
        mk('K2', [['case17-s', 10], ['case17-q', 0]], [planNode('case17-make-q'), planNode('case17-use-p')], [
          { id: 'c-K2T', itemId: X, fromBlockId: 'T' },
          { id: 'c-K2V', itemId: X, fromBlockId: 'V' },
          { id: 'c-K2p', itemId: 'case17-p', fromBlockId: 'K1' },
        ])
      for (const tabs of [['T', 'V', 'K1', 'K2'], ['T', 'V', 'K2', 'K1']]) {
        it(`c2: a group whose source feeds a cycle of requests, tabs ${tabs.join(' ')}`, () => {
          // Case 17 b: K2 is served first (10), K1 gets the other 5 and asks V for 5; the phase 3 computation, and the lines say so.
          const all = solveAll(tabsOf(tabs, { T: T17([ent('K2'), tied('K1')]), V: V(), K1: K1(), K2: K2() }), makeGameData())
          expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: true })
          expect(flowIn(all, 'c-K1T').rate, 'c-K1T').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-K1V').requested, 'c-K1V').toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-K1V').rate).toBeCloseTo(5, 6)
          expect(flowIn(all, 'c-K2T').rate, 'c-K2T').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-K2V')).toMatchObject({ rate: 0, status: 'unused' })
          expect(linesOf(all).map(c => c.blockId)).toEqual(['K2', 'K1'])
          expectLine(all, 'K2', 10, undefined)
          expectLine(all, 'K1', 5, undefined)
          for (const id of ['K1', 'K2']) {
            expect(flagged(all, id).groupInListOrder, `${id} flag`).toBe(true)
            expect(flagged(all, id)).not.toHaveProperty('notCredited')
          }
        })
        it(`c3: the group is on the pair, not on its members: H and G, K2 and K1 below, tabs ${tabs.join(' ')}`, () => {
          // The consumers of the pair include K1 and K2 (members of a cycle of requests), so {H, G} is served in list order too.
          const list: ServedEntry[] = [ent('H'), tied('G'), ent('K2'), ent('K1')]
          const all = solveAll([...tabsOf(tabs, { T: T17(list), V: V(), K1: K1(), K2: K2() }), H('H', 10), H('G', 10)], makeGameData())
          expectFlow(all, 'H', [10, 'ok', 0])
          expectFlow(all, 'G', [5, 'limited', 5])
          expect(flowIn(all, 'c-K1T').rate, 'c-K1T').toBeCloseTo(0, 6)
          expect(flowIn(all, 'c-K2T').rate, 'c-K2T').toBeCloseTo(0, 6)
          expect(flowIn(all, 'c-K1V').requested, 'c-K1V').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-K1V').rate).toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-K2V').requested, 'c-K2V').toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-K2V').rate).toBeCloseTo(10, 6)
          expect(nodeOf(all.results.V, 'case11-make-x').throughput, 'make-x').toBeCloseTo(10, 6)
          expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: true })
          for (const id of ['H', 'G']) expect(flagged(all, id).groupInListOrder, `${id} flag`).toBe(true)
          for (const id of ['K1', 'K2']) {
            expect(flagged(all, id)).not.toHaveProperty('groupInListOrder')
            expect(flagged(all, id)).not.toHaveProperty('notCredited')
          }
        })
      }
    })

    it('d: a list with no tied entry is unchanged: case 14 b, no line carries the flag', () => {
      const all = solveAll([T([ent('H2'), ent('H1')]), H('H1', 20), H('H2', 25)], makeGameData())
      expectFlow(all, 'H2', [25, 'ok', 0])
      expectFlow(all, 'H1', [5, 'limited', 15])
      noFlags(all)
    })

    describe('e: a group of takes in a loop of blocks', () => {
      // Case 16's fixture: S makes 30 goal and X, C1 and C2 take X and make Y back to S. List {C1, C2} on S's X.
      const Y = 'case16-y'
      const S = (list: ServedEntry[]): Block =>
        mk('S', [['case16-goal', 30]], [planNode('case16-make')], [
          { id: 'c-S1', itemId: Y, fromBlockId: 'C1' },
          { id: 'c-S2', itemId: Y, fromBlockId: 'C2' },
        ], list, 'case16-x')
      const C = (id: string, n: number): Block =>
        mk(id, [['case16-other', n]], [planNode('case16-use')], [{ id: `c-${id.slice(1)}`, itemId: 'case16-x', fromBlockId: 'S' }])
      const orders: Array<[string[], string[]]> = [
        [['S', 'C1', 'C2'], ['S', 'C1', 'C2']],
        [['C1', 'C2', 'S'], ['C1', 'S', 'C2']],
        [['C2', 'C1', 'S'], ['C2', 'S', 'C1']],
      ]
      for (const [tabs, members] of orders) {
        it(`tabs ${tabs.join(' ')}`, () => {
          const all = solveAll(tabsOf(tabs, { S: S([ent('C1'), tied('C2')]), C1: C('C1', 20), C2: C('C2', 25) }), makeGameData())
          expect(all.loops[0].blockIds).toEqual(members)
          expect(all.loops[0]).toMatchObject({ rounds: 2, converged: true })
          for (const [id, conn, want] of [['C1', 'c-1', [15, 'limited', 5]], ['C2', 'c-2', [15, 'limited', 10]]] as Array<[string, string, Want]>) {
            const f = flowIn(all, conn)
            expect(f.rate, `${id} rate`).toBeCloseTo(want[0], 6)
            expect(f.status, `${id} status`).toBe(want[1])
            expect(unsatisfiedRate(all.results[id], 'case16-x') ?? 0, `${id} imports`).toBeCloseTo(want[2], 6)
          }
          expect(flowIn(all, 'c-S1').rate).toBeCloseTo(20, 6)
          expect(flowIn(all, 'c-S1').status).toBe('ok')
          expect(flowIn(all, 'c-S2').rate).toBeCloseTo(10, 6)
          expect(flowIn(all, 'c-S2').status).toBe('ok')
          const lines = all.served.S['case16-x'].consumers
          expect(lines.map(c => c.blockId)).toEqual(['C1', 'C2'])
          expect(lines.map(c => c.share)).toEqual([expect.closeTo(15, 6), expect.closeTo(15, 6)])
          expect(lines.map(c => c.need)).toEqual([expect.closeTo(20, 6), expect.closeTo(25, 6)])
          for (const c of lines) {
            expect(c).not.toHaveProperty('groupInListOrder')
            expect(c).not.toHaveProperty('notCredited')
          }
        })
      }
    })

    describe('g: a readiness edge never refuses a rank edge of another list', () => {
      // T lists {H1, H2} on X (case 20 a8's fixture: R requests plate from H2, so the group wants the edge R -> H1). S also makes X, in
      // short supply (6), and lists [H1, R] on it with no tie: the rank edge H1 -> R must stand, so R reads what H1 leaves of S.
      // Hand values: R is not processed when H1 is reached (the edge R -> H1 is refused), so the group of T is served in list order:
      // H1 takes its whole need 20 from T, H2 the 10 left (needs 25, imports 15). H1 then needs nothing of S, so S's 6 X go to R,
      // which needs 4 (other 4): credit min(6 - 0, 4) = 4, R imports 0, no flag on R's line of S (without the rank edge R is credited
      // before H1 and its line says notCredited).
      const S = (): Block => mk('S', [['case11-goal', 6]], [planNode('case11-make-goal')], [], [ent('H1'), ent('R')], X)
      const H1 = (): Block => mk('H1', [['case11-other', 20]], [planNode('case11-use-x')], [{ id: 'c-H1', itemId: X, fromBlockId: 'T' }, { id: 'c-H1S', itemId: X, fromBlockId: 'S' }])
      const H2 = (): Block =>
        mk('H2', [['case11-other', 25], [P, 0]], [planNode('case11-use-x'), planNode('case13-make-plate')], [{ id: 'c-H2', itemId: X, fromBlockId: 'T' }])
      const R = (): Block =>
        mk('R', [['case11-other', 4], ['case13-gear', 5]], [planNode('case11-use-x'), planNode('case13-use-plate')], [
          { id: 'c-RH2', itemId: P, fromBlockId: 'H2' },
          { id: 'c-RS', itemId: X, fromBlockId: 'S' },
        ])
      for (const tabs of [['T', 'S', 'H1', 'R', 'H2'], ['T', 'S', 'H2', 'R', 'H1']]) {
        it(`tabs ${tabs.join(' ')}`, () => {
          const all = solveAll(tabsOf(tabs, { T: T([ent('H1'), tied('H2')]), S: S(), H1: H1(), R: R(), H2: H2() }), makeGameData())
          expectFlow(all, 'H1', [20, 'ok', 0])
          expect(flowIn(all, 'c-H1S').rate, 'c-H1S').toBeCloseTo(0, 6)
          expectFlow(all, 'H2', [10, 'limited', 15])
          expect(flowIn(all, 'c-RS').rate, 'c-RS').toBeCloseTo(4, 6)
          expect(unsatisfiedRate(all.results.R, X) ?? 0, 'R imports').toBeCloseTo(0, 6)
          expect(flowIn(all, 'c-RH2').rate, 'plate').toBeCloseTo(5, 6)
          const r = linesOf(all, 'S').find(c => c.blockId === 'R')!
          expect(r.share, 'R share of S').toBeCloseTo(4, 6)
          expect(r, 'R line of S').not.toHaveProperty('notCredited')
          expect(linesOf(all).every(c => c.groupInListOrder === true), 'the group of T is in list order').toBe(true)
        })
      }
    })

    describe('h: a member with entries below its group: the group is served in list order', () => {
      // a7's fixture with the list [J, H3/L tied], [H3/B]: J needs 25, H3 20 (areas L 12, B 8), T leaves 30. H3 has an entry below the
      // group, so its demand (the whole 20) would be credited inside the group for B too: the group is served in list order instead.
      // Hand values: J is credited min(30, 25) = 25; H3, at its first entry, min(30 - 25, 20) = 5, split by area need 12:8 into L 3 and B 2.
      // Grants in list order: J 25, L 3, B 2. J imports 0, H3 imports 15. Every line of J and H3 carries groupInListOrder.
      const J = (): Block => mk('J', [['case11-other', 25]], [planNode('case11-use-x')], [{ id: 'c-J', itemId: X, fromBlockId: 'T' }])
      const pinnedUse = (where: string, rate: number): GameRecipeNode => ({ ...rowIn('case11-use-x', where), pinnedRate: rate })
      const H3 = (): Block => ({
        ...mk('H3', [['case11-other', 20]], [], [{ id: 'c-H3', itemId: X, fromBlockId: 'T' }]),
        rootPlan: subPlan('root-H3', [], [subPlan('L', [pinnedUse('L', 12)], [], true), subPlan('B', [pinnedUse('B', 8)], [], true)]),
      })
      for (const tabs of [['T', 'J', 'H3'], ['T', 'H3', 'J']]) {
        it(`tabs ${tabs.join(' ')}`, () => {
          const list: ServedEntry[] = [ent('J'), ent('H3', { tied: true, areaId: 'L' }), ent('H3', { areaId: 'B' })]
          const all = solveAll(tabsOf(tabs, { T: T(list), J: J(), H3: H3() }), makeGameData())
          expect(flowIn(all, 'c-J').rate, 'c-J').toBeCloseTo(25, 6)
          expect(unsatisfiedRate(all.results.J, X) ?? 0, 'J imports').toBeCloseTo(0, 6)
          expect(flowIn(all, 'c-H3').rate, 'c-H3').toBeCloseTo(5, 6)
          expect(unsatisfiedRate(all.results.H3, X) ?? 0, 'H3 imports').toBeCloseTo(15, 6)
          expectLine(all, 'J', 25, 25)
          expectLine(all, 'H3', 3, undefined, 'L')
          expectLine(all, 'H3', 2, undefined, 'B')
          for (const c of linesOf(all)) expect(c.groupInListOrder, `${c.blockId}/${c.areaId} flag`).toBe(true)
        })
      }
    })

    it('i: a member that takes the item from another source first is served in list order (F2)', () => {
      // A makes 8 X as a byproduct and H1 takes it before T's. List {H1, H2} on T's 30. Hand values: H1 takes 8 of A and needs 12 of T's, so the group
      // (served in list order) credits H1 min(30, 12) = 12 and H2 the 18 left (needs 25, imports 7); both lines carry the flag.
      // Shared by need instead, H1 would ask 20 and H2 would get 15.
      const A = mk('A', [['case11-goal', 8]], [planNode('case11-make-goal')])
      const H1 = mk('H1', [['case11-other', 20]], [planNode('case11-use-x')], [{ id: 'c-H1A', itemId: X, fromBlockId: 'A' }, { id: 'c-H1', itemId: X, fromBlockId: 'T' }])
      const all = solveAll([T([ent('H1'), tied('H2')]), A, H1, H('H2', 25)], makeGameData())
      expect(flowIn(all, 'c-H1A').rate, 'c-H1A').toBeCloseTo(8, 6)
      expect(flowIn(all, 'c-H1').rate, 'c-H1').toBeCloseTo(12, 6)
      expectFlow(all, 'H2', [18, 'limited', 7])
      expect(unsatisfiedRate(all.results.H1, X) ?? 0, 'H1 imports').toBeCloseTo(0, 6)
      for (const c of linesOf(all)) {
        expect(c.groupInListOrder, `${c.blockId} flag`).toBe(true)
        expect(c).not.toHaveProperty('notCredited')
      }
    })

    describe('j: a take ranked below a group shared by need', () => {
      // List [{H1, H2}, H3] on X. H1 needs 10, H2 25, H3 20.
      // T leaves 30: waterFill(30, [10, 25]) = 10, 20; the group holds 30, H3 is left 30 - 30 = 0: credit 0, imports 20, no flag.
      // T leaves 40: waterFill(40, [10, 25]) = 10, 25; the group holds 35, H3 is left 40 - 35 = 5: credit 5, imports 15.
      const rows: Array<[number, Want, Want, Want]> = [
        [30, [10, 'ok', 0], [20, 'limited', 5], [0, 'limited', 20]],
        [40, [10, 'ok', 0], [25, 'ok', 0], [5, 'limited', 15]],
      ]
      for (const [leaves, h1, h2, h3] of rows) {
        it(`T leaves ${leaves}`, () => {
          const t = mk('T', [['case11-goal', leaves]], [planNode('case11-make-goal')], [], [ent('H1'), tied('H2'), ent('H3')], X)
          const all = solveAll([t, H('H1', 10), H('H2', 25), H('H3', 20)], makeGameData())
          expectFlow(all, 'H1', h1)
          expectFlow(all, 'H2', h2)
          expectFlow(all, 'H3', h3)
          expectLine(all, 'H3', h3[0], 20)
          noFlags(all)
        })
      }
    })

    it('k: a member is solved once, whatever the number of groups it is in, without a cache entry to read', () => {
      // A cache that never hits and counts its sets sees every solve. Row b1's blocks: each is probed once by the request pass (B ahead of
      // its turn, reused at its turn) and solved once by the supply pass, so 2 each.
      const gd = makeGameData()
      const base = createSolveCache()
      const solves = new Map<string, number>()
      const counting = { ...base, get: () => undefined, set: (id: string) => void solves.set(id, (solves.get(id) ?? 0) + 1) }
      solveAll([
        T([ent('H'), tied('B')]), mk('A', [[X, 0]], [planNode('case11-make-x')]), H('H', 20),
        mk('B', [['case11-other', 25]], [planNode('case11-use-x')], [{ id: 'c-BT', itemId: X, fromBlockId: 'T' }, { id: 'c-BA', itemId: X, fromBlockId: 'A' }]),
      ], gd, counting as typeof base)
      expect(solves.get('B'), 'B').toBe(2)
      expect(solves.get('H'), 'H').toBe(2)
    })

    it('f: a warm solve of row b1 sets no cache entry and reports what a cold solve reports', () => {
      const gd = makeGameData()
      const blocks = (): Block[] => [
        T([ent('H'), tied('B')]), mk('A', [[X, 0]], [planNode('case11-make-x')]), H('H', 20),
        mk('B', [['case11-other', 25]], [planNode('case11-use-x')], [{ id: 'c-BT', itemId: X, fromBlockId: 'T' }, { id: 'c-BA', itemId: X, fromBlockId: 'A' }]),
      ]
      const cache = createSolveCache()
      solveAll(blocks(), gd, cache)
      const set = vi.spyOn(cache, 'set')
      const warm = solveAll(blocks(), gd, cache)
      expect(set, 'no block is solved again').not.toHaveBeenCalled()
      const cold = solveAll(blocks(), gd)
      expect(warm.served).toEqual(cold.served)
      expect(warm.flows).toEqual(cold.flows)
    })
  })
  describe('case 21: area rules', () => {
    // Case 13's recipes (1 ore makes 1 plate, 1 plate makes 1 gear) and case 11's (A makes the goal with X on the side, U uses X, R makes 2 X).
    // An area's rule for an item replaces the block's rule in that area, whole (see spec/test-synthetic.md and spec/solver.md, "Area rules").
    // Values are derived by hand in initiatives/archive/sourcing-priority/phase-5.md; none is edited to match the solver.
    const PLATE = 'case13-plate'
    const X = 'case11-x'
    const Y = 'case21-y'
    type AreaRules = Record<string, Record<string, AreaSourceRule>>
    const sp = (id: string, nodes: RecipeNode[], rules?: Record<string, AreaSourceRule>): SubPlan =>
      ({ ...subPlan(id, nodes, [], true), ...(rules ? { sourceRules: rules } : {}) })
    const pin = (recipeId: string, where: string, rate: number): GameRecipeNode => ({ ...rowIn(recipeId, where), pinnedRate: rate })
    const house = (id: string, rootPlan: SubPlan, products: Array<[string, number]>, sourceRules: Block['sourceRules'], links: Block['inputConnections']): Block => ({
      id, name: id, color: '#60a5fa',
      products: products.map(([itemId, extraRate], i) => ({ id: `p-${id}-${i}`, itemId, extraRate })),
      sourceRules, inputConnections: links, rootPlan,
    })
    const offerLink = (from: string): Block['inputConnections'] => [{ id: 'c-H', itemId: PLATE, fromBlockId: from }]

    // A: L uses 12 plate (pinned), B uses 8 (pinned); both have a plate row. `withY` adds an item no rule names, traded by two areas.
    const blockA = (blockRule: SourceRule | undefined, rules: AreaRules, withY: boolean, links: Block['inputConnections'] = []): Block => {
      const l = sp('L', [pin('case13-use-plate', 'L', 12), rowIn('case13-make-plate', 'L'), ...(withY ? [rowIn('case21-use-y', 'L')] : [])], rules.L)
      const b = sp('B', [pin('case13-use-plate', 'B', 8), rowIn('case13-make-plate', 'B'), ...(withY ? [rowIn('case21-make-y', 'B')] : [])], rules.B)
      return house('H', subPlan('root', [], [l, b]), [['case13-gear', 20], ...(withY ? [['case21-z', 6] as [string, number]] : [])],
        blockRule ? { [PLATE]: blockRule } : {}, links)
    }
    // C: T makes 30 goal and 30 X; C1 uses 40 X (pinned); C2 uses 50 X (pinned) and can make X.
    const blockC = (blockRule: SourceRule | undefined, rules: AreaRules, withY: boolean): Block => {
      const t = sp('T', [rowIn('case11-make-goal', 'T'), ...(withY ? [rowIn('case21-make-y', 'T')] : [])], rules.T)
      const c1 = sp('C1', [pin('case11-use-x', 'C1', 40), ...(withY ? [rowIn('case21-use-y', 'C1')] : [])], rules.C1)
      const c2 = sp('C2', [pin('case11-use-x', 'C2', 50), rowIn('case11-make-x', 'C2')], rules.C2)
      return house('H', subPlan('root', [], [t, c1, c2]), [['case11-goal', 30], ['case11-other', 90], ...(withY ? [['case21-z', 6] as [string, number]] : [])],
        blockRule ? { [X]: blockRule } : {}, [])
    }
    // B: L uses 12 plate (pinned) and has no plate row; M1 and M2, in that order, each have a plate row.
    const blockB = (rules: AreaRules): Block => {
      const l = sp('L', [pin('case13-use-plate', 'L', 12)], rules.L)
      const m1 = sp('M1', [rowIn('case13-make-plate', 'M1')], rules.M1)
      const m2 = sp('M2', [rowIn('case13-make-plate', 'M2')], rules.M2)
      return house('H', subPlan('root', [], [l, m1, m2]), [['case13-gear', 12]], {}, [])
    }
    const solveA = (b: Block, offer?: number) =>
      solveBlock(flattenBlock(b), makeGameData(), new Map(offer === undefined ? [] : [[PLATE, offer]]))
    const rateOf = (result: SolverResult, nodeId: string) => nodeOf(result, nodeId).throughput
    const unsat = (result: SolverResult, itemId: string) => unsatisfiedRate(result, itemId) ?? 0
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6
    const legsOf = (result: SolverResult, itemId: string): AreaRoute[] => (result.areaRoutes ?? []).filter(r => r.itemId === itemId)
    // A leg as [from, to, rate, supplied]; `supplied` absent where the table has a dash.
    type Leg = [from: string | undefined, to: string | undefined, rate: number, supplied?: number]
    const legKey = (from?: string, to?: string) => `${from ?? '~'}>${to ?? '~'}`
    const expectLegs = (result: SolverResult, itemId: string, want: Leg[]) => {
      const got = [...legsOf(result, itemId)].sort((a, b) => (legKey(a.from, a.to) < legKey(b.from, b.to) ? -1 : 1))
      const exp = [...want].sort((a, b) => (legKey(a[0], a[1]) < legKey(b[0], b[1]) ? -1 : 1))
      expect(got.map(l => [l.from, l.to]), `${itemId} legs`).toEqual(exp.map(l => [l[0], l[1]]))
      got.forEach((l, i) => {
        expect(l.rate, `${itemId} leg ${legKey(l.from, l.to)} rate`).toBeCloseTo(exp[i][2], 6)
        if (exp[i][3] === undefined) expect(l, `${itemId} leg ${legKey(l.from, l.to)} supplied`).not.toHaveProperty('supplied')
        else expect(l.supplied, `${itemId} leg ${legKey(l.from, l.to)} supplied`).toBeCloseTo(exp[i][3]!, 6)
      })
    }
    // What each outside leg into an area is made of, under the area's own rule: [area, received, imported, missing].
    const expectParts = (b: Block, result: SolverResult, itemId: string, want: Array<[string, number, number, number]>) => {
      const flat = flattenBlock(b)
      const outside = legsOf(result, itemId).filter(l => l.from === undefined && l.to !== undefined)
      expect(outside.map(l => l.to), `${itemId} outside legs`).toEqual(want.map(w => w[0]))
      outside.forEach((l, i) => {
        const area = flat.areas!.find(a => a.id === l.to)!
        const parts = outsideLegParts(l, areaRuleOf(area, b.sourceRules, itemId))
        expect(parts.received, `${l.to} received`).toBeCloseTo(want[i][1], 6)
        expect(parts.imported, `${l.to} imported`).toBeCloseTo(want[i][2], 6)
        expect(parts.missing, `${l.to} missing`).toBeCloseTo(want[i][3], 6)
      })
    }

    describe('A: a central block and an area with its own row', () => {
      const first: AreaSourceRule = { makeHere: 'after-blocks' }
      const off: AreaSourceRule = { makeHere: 'off' }
      type Row = {
        name: string; blockRule?: SourceRule; rules: AreaRules; offer?: number
        received: number; l: number; b: number; plateUnsat: number
        legs: Leg[]; parts: Array<[string, number, number, number]>
      }
      const rows: Row[] = [
        { name: 'a: none (measured)', rules: {}, offer: 100, received: 0, l: 12, b: 8, plateUnsat: 0, legs: [], parts: [] },
        { name: 'b: block Receive it first (measured)', blockRule: first, rules: {}, offer: 100, received: 20, l: 0, b: 0, plateUnsat: 0,
          legs: [[undefined, 'L', 12, 12], [undefined, 'B', 8, 8]], parts: [['L', 12, 0, 0], ['B', 8, 0, 0]] },
        { name: 'c: L Receive it first', rules: { L: { [PLATE]: first } }, offer: 100, received: 12, l: 0, b: 8, plateUnsat: 0,
          legs: [[undefined, 'L', 12, 12]], parts: [['L', 12, 0, 0]] },
        { name: 'd: block Receive it first; B {}', blockRule: first, rules: { B: { [PLATE]: {} } }, offer: 100, received: 12, l: 0, b: 8, plateUnsat: 0,
          legs: [[undefined, 'L', 12, 12]], parts: [['L', 12, 0, 0]] },
        { name: 'e: L Receive it first, offer 5', rules: { L: { [PLATE]: first } }, offer: 5, received: 5, l: 7, b: 8, plateUnsat: 0,
          legs: [[undefined, 'L', 5, 5]], parts: [['L', 5, 0, 0]] },
        { name: 'f: L Receive it first, unlimited offer (the probe)', rules: { L: { [PLATE]: first } }, offer: Infinity, received: 12, l: 0, b: 8, plateUnsat: 0,
          legs: [[undefined, 'L', 12, 12]], parts: [['L', 12, 0, 0]] },
        { name: "g: L Don't make more here, no offer", rules: { L: { [PLATE]: off } }, received: 0, l: 0, b: 8, plateUnsat: 12,
          legs: [[undefined, 'L', 12]], parts: [['L', 0, 12, 0]] },
        { name: "h: L Don't make more here, offer 100", rules: { L: { [PLATE]: off } }, offer: 100, received: 12, l: 0, b: 8, plateUnsat: 0,
          legs: [[undefined, 'L', 12, 12]], parts: [['L', 12, 0, 0]] },
        { name: "i: L Don't make more here, offer 5", rules: { L: { [PLATE]: off } }, offer: 5, received: 5, l: 0, b: 8, plateUnsat: 7,
          legs: [[undefined, 'L', 12, 5]], parts: [['L', 5, 7, 0]] },
        { name: "j: L Don't make more here, Import off", rules: { L: { [PLATE]: { makeHere: 'off', importOff: true } } }, received: 0, l: 0, b: 8, plateUnsat: 12,
          legs: [[undefined, 'L', 12]], parts: [['L', 0, 0, 12]] },
        { name: "k: block Don't make more here; L {}", blockRule: off, rules: { L: { [PLATE]: {} } }, received: 0, l: 12, b: 0, plateUnsat: 8,
          legs: [[undefined, 'B', 8]], parts: [['B', 0, 8, 0]] },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const b = blockA(row.blockRule, row.rules, false)
          const { result, received } = solveA(b, row.offer)
          expect(received.get(PLATE) ?? 0, 'received').toBeCloseTo(row.received, 6)
          expect(rateOf(result, 'case13-make-plate@L'), "L's plate row").toBeCloseTo(row.l, 6)
          expect(rateOf(result, 'case13-make-plate@B'), "B's plate row").toBeCloseTo(row.b, 6)
          expect(unsat(result, PLATE), 'plate imported or missing').toBeCloseTo(row.plateUnsat, 6)
          expect(rateOf(result, 'case13-use-plate@L')).toBeCloseTo(12, 6)
          expect(rateOf(result, 'case13-use-plate@B')).toBeCloseTo(8, 6)
          expectLegs(result, PLATE, row.legs)
          expectParts(b, result, PLATE, row.parts)
        })
        // The regression pin (one-path equivalence): Y is traded by two areas and no rule names it, so it goes through the per-area shape;
        // these are the values today's pooled model gives, and the plate's rule must not move them or the plate figures.
        it(`${row.name}, with a second item Y no rule names: Y and the plate do not move`, () => {
          const bare = solveA(blockA(row.blockRule, row.rules, false), row.offer)
          const withY = solveA(blockA(row.blockRule, row.rules, true), row.offer)
          expect(rateOf(withY.result, 'case21-make-y@B'), 'make-y').toBeCloseTo(6, 6)
          expect(rateOf(withY.result, 'case21-use-y@L'), 'use-y').toBeCloseTo(6, 6)
          expect(legsOf(withY.result, Y)).toEqual([{ itemId: Y, from: 'B', to: 'L', rate: expect.closeTo(6, 6) }])
          expect(unsat(withY.result, 'case21-ore'), 'ore').toBeCloseTo(6, 6)
          const sends = withY.result.areas!.find(a => a.areaId === 'B')!.sends.find(s => s.itemId === Y)
          const receives = withY.result.areas!.find(a => a.areaId === 'L')!.receives.find(s => s.itemId === Y)
          expect(sends?.rate, 'B sends Y').toBeCloseTo(6, 6)
          expect(sends?.boundary).toBe(false)
          expect(receives?.rate, 'L receives Y').toBeCloseTo(6, 6)
          expect(receives?.boundary).toBe(false)
          const plate = (x: typeof bare) => ({
            received: r6(x.received.get(PLATE) ?? 0),
            rows: ['L', 'B'].map(w => r6(rateOf(x.result, `case13-make-plate@${w}`))),
            unsat: r6(unsat(x.result, PLATE)),
            legs: legsOf(x.result, PLATE).map(l => ({ ...l, rate: r6(l.rate), ...(l.supplied !== undefined ? { supplied: r6(l.supplied) } : {}) })),
          })
          expect(plate(withY)).toEqual(plate(bare))
        })
      }
    })

    describe('B: choosing the supplying area', () => {
      type Row = {
        name: string; rules: AreaRules; offer?: number
        m1: number; m2: number; plateUnsat: number; received: number
        legs: Leg[]; parts?: Array<[string, number, number, number]>
      }
      const rows: Row[] = [
        { name: 'a: no switch', rules: {}, m1: 12, m2: 0, plateUnsat: 0, received: 0, legs: [['M1', 'L', 12]] },
        { name: 'b: L switches M1 off', rules: { L: { [PLATE]: { areasOff: ['M1'] } } }, m1: 0, m2: 12, plateUnsat: 0, received: 0, legs: [['M2', 'L', 12]] },
        { name: 'c: L switches M1 and M2 off', rules: { L: { [PLATE]: { areasOff: ['M1', 'M2'] } } }, m1: 0, m2: 0, plateUnsat: 12, received: 0,
          legs: [[undefined, 'L', 12]], parts: [['L', 0, 12, 0]] },
        { name: 'd: L switches M1 and M2 off, offer 100', rules: { L: { [PLATE]: { areasOff: ['M1', 'M2'] } } }, offer: 100, m1: 0, m2: 0, plateUnsat: 0, received: 12,
          legs: [[undefined, 'L', 12, 12]], parts: [['L', 12, 0, 0]] },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const b = blockB(row.rules)
          const { result, received } = solveA(b, row.offer)
          expect(received.get(PLATE) ?? 0, 'received').toBeCloseTo(row.received, 6)
          expect(rateOf(result, 'case13-make-plate@M1'), "M1's plate row").toBeCloseTo(row.m1, 6)
          expect(rateOf(result, 'case13-make-plate@M2'), "M2's plate row").toBeCloseTo(row.m2, 6)
          expect(unsat(result, PLATE), 'plate imported or missing').toBeCloseTo(row.plateUnsat, 6)
          expect(rateOf(result, 'case13-use-plate@L')).toBeCloseTo(12, 6)
          expectLegs(result, PLATE, row.legs)
          if (row.parts) expectParts(b, result, PLATE, row.parts)
        })
      }
    })

    describe('C: one consumer takes the byproduct', () => {
      type Row = { name: string; blockRule?: SourceRule; rules: AreaRules; r: number; xUnsat: number; legs?: Leg[]; parts?: Array<[string, number, number, number]> }
      const rows: Row[] = [
        { name: 'a: none', rules: {}, r: 30, xUnsat: 0 },
        { name: "b: block Don't make more here", blockRule: { makeHere: 'off' }, rules: {}, r: 0, xUnsat: 60 },
        { name: "c: C1 Don't make more here", rules: { C1: { [X]: { makeHere: 'off' } } }, r: 10, xUnsat: 40,
          legs: [['T', 'C2', 30], [undefined, 'C1', 40]], parts: [['C1', 0, 40, 0]] },
        { name: "d: C1 Don't make more here, C2 switches T off", rules: { C1: { [X]: { makeHere: 'off' } }, C2: { [X]: { areasOff: ['T'] } } }, r: 25, xUnsat: 10,
          legs: [['T', 'C1', 30], [undefined, 'C1', 10]], parts: [['C1', 0, 10, 0]] },
        { name: "e: C1 Don't make more here and Import off, C2 switches T off", rules: { C1: { [X]: { makeHere: 'off', importOff: true } }, C2: { [X]: { areasOff: ['T'] } } }, r: 25, xUnsat: 10,
          legs: [['T', 'C1', 30], [undefined, 'C1', 10]], parts: [['C1', 0, 0, 10]] },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const b = blockC(row.blockRule, row.rules, false)
          const { result } = solveBlock(flattenBlock(b), makeGameData())
          expect(rateOf(result, 'case11-make-goal@T')).toBeCloseTo(30, 6)
          expect(rateOf(result, 'case11-use-x@C1')).toBeCloseTo(40, 6)
          expect(rateOf(result, 'case11-use-x@C2')).toBeCloseTo(50, 6)
          expect(rateOf(result, 'case11-make-x@C2'), 'R runs').toBeCloseTo(row.r, 6)
          expect(unsat(result, X), 'X imported or missing').toBeCloseTo(row.xUnsat, 6)
          if (row.legs) expectLegs(result, X, row.legs)
          if (row.parts) expectParts(b, result, X, row.parts)
          if (row.name.startsWith('a')) for (const l of legsOf(result, X)) expect(l, 'no supplied leg').not.toHaveProperty('supplied')
        })
        it(`${row.name}, with a second item Y no rule names: Y and X do not move`, () => {
          const bare = solveBlock(flattenBlock(blockC(row.blockRule, row.rules, false)), makeGameData()).result
          const withY = solveBlock(flattenBlock(blockC(row.blockRule, row.rules, true)), makeGameData()).result
          expect(rateOf(withY, 'case21-make-y@T'), 'make-y').toBeCloseTo(6, 6)
          expect(rateOf(withY, 'case21-use-y@C1'), 'use-y').toBeCloseTo(6, 6)
          expect(legsOf(withY, Y)).toEqual([{ itemId: Y, from: 'T', to: 'C1', rate: expect.closeTo(6, 6) }])
          expect(unsat(withY, 'case21-ore'), 'ore').toBeCloseTo(6, 6)
          const sends = withY.areas!.find(a => a.areaId === 'T')!.sends.find(s => s.itemId === Y)
          const receives = withY.areas!.find(a => a.areaId === 'C1')!.receives.find(s => s.itemId === Y)
          expect(sends?.rate, 'T sends Y').toBeCloseTo(6, 6)
          expect(sends?.boundary).toBe(false)
          expect(receives?.rate, 'C1 receives Y').toBeCloseTo(6, 6)
          expect(receives?.boundary).toBe(false)
          const x = (r: SolverResult) => ({
            r: r6(rateOf(r, 'case11-make-x@C2')),
            unsat: r6(unsat(r, X)),
            legs: legsOf(r, X).map(l => ({ ...l, rate: r6(l.rate) })),
          })
          expect(x(withY)).toEqual(x(bare))
        })
      }
    })

    describe('f, the list and the cycle: block H as a consumer of other blocks', () => {
      const P = PLATE
      const L1: Record<string, Record<string, AreaSourceRule>> = { L: { [P]: { makeHere: 'after-blocks' } } }
      const S = (list?: ServedEntry[]): Block => mk('S', [[P, 0]], [rowIn('case13-make-plate', 'root')], [], list, P)
      const orders = [['S', 'H'], ['H', 'S']]

      for (const order of orders) {
        it(`f as a request: L Receive it first makes S the supplier, tabs ${order.join(' ')}`, () => {
          const byId: Record<string, Block> = { S: S(), H: blockA(undefined, L1, false, offerLink('S')) }
          const all = solveAll(order.map(t => byId[t]), makeGameData())
          const f = flowIn(all, 'c-H')
          expect(f.kind).toBe('request')
          expect(f.requested, 'requested').toBeCloseTo(12, 6)
          expect(f.rate, 'rate').toBeCloseTo(12, 6)
          expect(f.status).toBe('ok')
          expect(nodeOf(all.results.S, 'case13-make-plate@root').throughput, 'S makes').toBeCloseTo(12, 6)
          expect(nodeOf(all.results.H, 'case13-make-plate@L').throughput, 'L').toBeCloseTo(0, 6)
          expect(nodeOf(all.results.H, 'case13-make-plate@B').throughput, 'B').toBeCloseTo(8, 6)
          expectLegs(all.results.H, P, [[undefined, 'L', 12, 12]])
        })
        it(`f as a request: with no rule nothing is asked, tabs ${order.join(' ')}`, () => {
          const byId: Record<string, Block> = { S: S(), H: blockA(undefined, {}, false, offerLink('S')) }
          const all = solveAll(order.map(t => byId[t]), makeGameData())
          const f = flowIn(all, 'c-H')
          expect(f.requested ?? 0, 'requested').toBeCloseTo(0, 6)
          expect(f.rate, 'rate').toBeCloseTo(0, 6)
          expect(f.status).toBe('unused')
          expect(nodeOf(all.results.H, 'case13-make-plate@L').throughput, 'L').toBeCloseTo(12, 6)
        })
      }

      describe('a served list on the source that ranks B above L: an area need follows its rule', () => {
        const list: ServedEntry[] = [{ kind: 'block', blockId: 'H', areaId: 'B' }, { kind: 'block', blockId: 'H', areaId: 'L' }]
        const linesOfH = (all: ReturnType<typeof solveAll>) => all.served.S[P].consumers.filter(c => c.blockId === 'H')
        for (const order of orders) {
          it(`row c, tabs ${order.join(' ')}: the lines are exactly L's 12`, () => {
            const byId: Record<string, Block> = { S: S(list), H: blockA(undefined, L1, false, offerLink('S')) }
            const all = solveAll(order.map(t => byId[t]), makeGameData())
            expect(linesOfH(all).map(c => [c.blockId, c.areaId, r6(c.share), r6(c.got)])).toEqual([['H', 'L', 12, 12]])
          })
          it(`row a, tabs ${order.join(' ')}: no H line has a share or got anything`, () => {
            const byId: Record<string, Block> = { S: S(list), H: blockA(undefined, {}, false, offerLink('S')) }
            const all = solveAll(order.map(t => byId[t]), makeGameData())
            for (const c of linesOfH(all)) {
              expect(c.share, `${c.areaId} share`).toBeCloseTo(0, 6)
              expect(c.got, `${c.areaId} got`).toBeCloseTo(0, 6)
            }
          })
        }
        it('the request probe reads L 12 in row c and nothing in row a', () => {
          const probe = (rules: AreaRules) => areaNeedsOf(solveBlock(flattenBlock(blockA(undefined, rules, false)), makeGameData(), new Map([[P, Infinity]])).result.areaRoutes)?.get(P)
          expect(probe(L1)).toEqual([{ areaId: 'L', need: 12 }])
          expect(probe({})).toBeUndefined()
        })
      })

      describe('a cycle of requests: H takes plate from S, S takes coin from H', () => {
        // H also makes a coin per unit S asks for (1 token needs 1 coin, which takes 1 ore); S makes the plate H's area L asks for.
        const Hc = (rules: AreaRules): Block => {
          const b = blockA(undefined, rules, false, offerLink('S'))
          return { ...b, products: [...b.products, { id: 'p-H-coin', itemId: 'case21-coin', extraRate: 0 }], rootPlan: { ...b.rootPlan, nodes: [rowIn('case21-make-coin', 'root')] } }
        }
        const Sc = (): Block =>
          mk('S', [[P, 0], ['case21-token', 1]], [rowIn('case13-make-plate', 'root'), rowIn('case21-use-coin', 'root')], [{ id: 'c-S', itemId: 'case21-coin', fromBlockId: 'H' }])
        for (const order of orders) {
          it(`row c, tabs ${order.join(' ')}: both requests are met in one loop`, () => {
            const byId: Record<string, Block> = { S: Sc(), H: Hc(L1) }
            const all = solveAll(order.map(t => byId[t]), makeGameData())
            expect(flowIn(all, 'c-H')).toMatchObject({ status: 'ok' })
            expect(flowIn(all, 'c-H').requested).toBeCloseTo(12, 6)
            expect(flowIn(all, 'c-H').rate).toBeCloseTo(12, 6)
            expect(flowIn(all, 'c-S')).toMatchObject({ status: 'ok' })
            expect(flowIn(all, 'c-S').requested).toBeCloseTo(1, 6)
            expect(flowIn(all, 'c-S').rate).toBeCloseTo(1, 6)
            expect(nodeOf(all.results.H, 'case21-make-coin@root').throughput, "H's coin row").toBeCloseTo(1, 6)
            expect(nodeOf(all.results.H, 'case13-make-plate@L').throughput, 'L').toBeCloseTo(0, 6)
            expect(nodeOf(all.results.H, 'case13-make-plate@B').throughput, 'B').toBeCloseTo(8, 6)
            expect(nodeOf(all.results.S, 'case13-make-plate@root').throughput, "S's plate row").toBeCloseTo(12, 6)
            expect(all.loops).toHaveLength(1)
            expect([...all.loops[0].blockIds].sort()).toEqual(['H', 'S'])
            expect(all.loops[0].converged).toBe(true)
          })
          it(`row a, tabs ${order.join(' ')}: with no rule L makes its plate and c-H is unused`, () => {
            const byId: Record<string, Block> = { S: Sc(), H: Hc({}) }
            const all = solveAll(order.map(t => byId[t]), makeGameData())
            expect(flowIn(all, 'c-H')).toMatchObject({ status: 'unused' })
            expect(flowIn(all, 'c-H').rate).toBeCloseTo(0, 6)
            expect(nodeOf(all.results.H, 'case13-make-plate@L').throughput, 'L').toBeCloseTo(12, 6)
          })
        }
      })
    })
  })

  describe('case 22: a connection replaces an import', () => {
    // With the default rule a block does not import an intermediate while a connection could replace that
    // import, whichever of the two items the connection is on (initiatives/archive/sourcing-priority/phase-6.md, D1 and D4).
    // Values are derived by hand in phase-6.md; the rows marked measured are the solver of before the phase.
    // None is edited to match the solver.
    const PLATE = 'case22-plate'
    const INGOT = 'case22-ingot'
    type Ratio = '1-1' | '1-2' | '2-1'
    const unsat = (result: SolverResult, itemId: string) => unsatisfiedRate(result, itemId) ?? 0

    // Fixture A: product 25 gears (50 plates); P at `ratio`; S pinned at 10 unless `sFree`.
    const fixtureA = (ratio: Ratio, opts: { sFree?: boolean; rules?: Block['sourceRules'] } = {}): { goals: SolverGoal[]; nodes: RecipeNode[]; sourceRules: Block['sourceRules'] } => ({
      goals: [{ id: 'g0', itemId: 'case22-gear', rate: 25 }],
      nodes: [
        planNode('case22-gear'),
        { ...planNode(`case22-plate-${ratio}`), id: 'P' },
        opts.sFree ? planNode('case22-ingot') : planNode('case22-ingot', [], { pinnedRate: 10 }),
      ],
      sourceRules: opts.rules ?? {},
    })

    describe('A: a pinned upstream row', () => {
      type Row = {
        name: string; ratio: Ratio; offers: Array<[string, number]>; sFree?: boolean; rules?: Block['sourceRules']
        plate: number; ingot: number; p: number; plateUnsat: number; ingotUnsat: number
      }
      const rows: Row[] = [
        { name: 'a: 1 makes 1, plate (100) (measured)', ratio: '1-1', offers: [[PLATE, 100]], plate: 40, ingot: 0, p: 10, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'b: 1 makes 2, plate (100)', ratio: '1-2', offers: [[PLATE, 100]], plate: 30, ingot: 0, p: 10, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'c: 2 make 1, plate (100) (measured)', ratio: '2-1', offers: [[PLATE, 100]], plate: 45, ingot: 0, p: 5, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'd: 1 makes 2, plate (12)', ratio: '1-2', offers: [[PLATE, 12]], plate: 12, ingot: 0, p: 19, plateUnsat: 0, ingotUnsat: 9 },
        { name: 'e: 1 makes 2, none (measured)', ratio: '1-2', offers: [], plate: 0, ingot: 0, p: 25, plateUnsat: 0, ingotUnsat: 15 },
        { name: 'f: 1 makes 2, plate (unlimited, the probe)', ratio: '1-2', offers: [[PLATE, Infinity]], plate: 30, ingot: 0, p: 10, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'g: 1 makes 1, ingot (100)', ratio: '1-1', offers: [[INGOT, 100]], plate: 0, ingot: 40, p: 50, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'h: 1 makes 2, ingot (100) (measured)', ratio: '1-2', offers: [[INGOT, 100]], plate: 0, ingot: 15, p: 25, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'i: 2 make 1, ingot (100)', ratio: '2-1', offers: [[INGOT, 100]], plate: 0, ingot: 90, p: 50, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'j: 1 makes 2, plate (100) and ingot (100) (measured)', ratio: '1-2', offers: [[PLATE, 100], [INGOT, 100]], plate: 0, ingot: 15, p: 25, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'k: 1 makes 1, plate (100) and ingot (100) (measured)', ratio: '1-1', offers: [[PLATE, 100], [INGOT, 100]], plate: 40, ingot: 0, p: 10, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'l: 1 makes 2, Import off on ingot, plate (100) (measured)', ratio: '1-2', offers: [[PLATE, 100]], rules: { [INGOT]: { importOff: true } }, plate: 30, ingot: 0, p: 10, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'm: 1 makes 2, S not pinned, plate (100) (measured)', ratio: '1-2', offers: [[PLATE, 100]], sFree: true, plate: 0, ingot: 0, p: 25, plateUnsat: 0, ingotUnsat: 0 },
        { name: 'n: 1 makes 2, plate on Receive it first, plate (100) (measured)', ratio: '1-2', offers: [[PLATE, 100]], rules: { [PLATE]: { makeHere: 'after-blocks' } }, plate: 50, ingot: 0, p: 0, plateUnsat: 0, ingotUnsat: 0 },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const { result, received } = solveBlock(fixtureA(row.ratio, { sFree: row.sFree, rules: row.rules }), makeGameData(), new Map(row.offers))
          expect(received.get(PLATE) ?? 0, 'plate received').toBeCloseTo(row.plate, 6)
          expect(received.get(INGOT) ?? 0, 'ingot received').toBeCloseTo(row.ingot, 6)
          expect(nodeOf(result, 'P').throughput, 'P runs').toBeCloseTo(row.p, 6)
          expect(unsat(result, PLATE), 'plate imported').toBeCloseTo(row.plateUnsat, 6)
          expect(unsat(result, INGOT), 'ingot imported').toBeCloseTo(row.ingotUnsat, 6)
          expect(nodeOf(result, 'case22-gear').throughput, 'G runs').toBeCloseTo(25, 6)
          if (!row.sFree) expect(nodeOf(result, 'case22-ingot').throughput, 'S runs').toBeCloseTo(10, 6)
        })
      }

      // Not a value of the table: phase-6.md does not say what row n warns. The solver reports `overconstrained` there (S's 10
      // ingots are left unused as P does not run); this pins that observed behaviour only, and is not derived.
      it('observed, not derived: row n reports overconstrained (S makes ingots nothing uses)', () => {
        const { result } = solveBlock(fixtureA('1-2', { rules: { [PLATE]: { makeHere: 'after-blocks' } } }), makeGameData(), new Map([[PLATE, 100]]))
        expect(result.warnings.map(w => w.type)).toContain('overconstrained')
      })

      // Row f in solveAll: a source block that has plate as a product is asked for what the probe takes.
      const source = (): Block => mk('S', [[PLATE, 0]], [planNode('case22-mine-plate')])
      const consumer = (): Block => ({
        id: 'H', name: 'H', color: '#60a5fa',
        products: [{ id: 'p-H-0', itemId: 'case22-gear', extraRate: 25 }],
        sourceRules: {},
        inputConnections: [{ id: 'c-H', itemId: PLATE, fromBlockId: 'S' }],
        rootPlan: subPlan('root-H', fixtureA('1-2').nodes),
      })
      for (const order of [['S', 'H'], ['H', 'S']]) {
        it(`f as a request: the source is asked for 30, tabs ${order.join(' ')}`, () => {
          const byId: Record<string, Block> = { S: source(), H: consumer() }
          const all = solveAll(order.map(t => byId[t]), makeGameData())
          const f = flowIn(all, 'c-H')
          expect(f.kind).toBe('request')
          expect(f.requested, 'requested').toBeCloseTo(30, 6)
          expect(f.rate, 'rate').toBeCloseTo(30, 6)
          expect(nodeOf(all.results.S, 'case22-mine-plate').throughput, 'S mines').toBeCloseTo(30, 6)
          expect(nodeOf(all.results.H, 'P').throughput, 'P runs').toBeCloseTo(10, 6)
          expect(unsat(all.results.H, INGOT), 'ingot imported').toBeCloseTo(0, 6)
        })
      }
    })

    describe('C: areas', () => {
      // Fixture A with G in area L and P and S in area M: plate is touched by both areas, ingot by M only.
      const block = (ratio: Ratio): Block => {
        const a = fixtureA(ratio)
        const sp = (id: string, nodes: RecipeNode[]) => subPlan(id, nodes, [], true)
        return {
          id: 'H', name: 'H', color: '#60a5fa',
          products: [{ id: 'p-H-0', itemId: 'case22-gear', extraRate: 25 }],
          sourceRules: {}, inputConnections: [],
          rootPlan: subPlan('root', [], [sp('L', [a.nodes[0]]), sp('M', [a.nodes[1], a.nodes[2]])]),
        }
      }
      type Row = { name: string; ratio: Ratio; offers: Array<[string, number]>; plate: number; ingot: number; p: number; leg?: number }
      const rows: Row[] = [
        { name: 'a: 1 makes 2, plate (100)', ratio: '1-2', offers: [[PLATE, 100]], plate: 30, ingot: 0, p: 10, leg: 30 },
        { name: 'b: 1 makes 1, ingot (100)', ratio: '1-1', offers: [[INGOT, 100]], plate: 0, ingot: 40, p: 50 },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const { result, received } = solveBlock(flattenBlock(block(row.ratio)), makeGameData(), new Map(row.offers))
          expect(received.get(PLATE) ?? 0, 'plate received').toBeCloseTo(row.plate, 6)
          expect(received.get(INGOT) ?? 0, 'ingot received').toBeCloseTo(row.ingot, 6)
          expect(nodeOf(result, 'P').throughput, 'P runs').toBeCloseTo(row.p, 6)
          expect(unsat(result, PLATE), 'plate imported').toBeCloseTo(0, 6)
          expect(unsat(result, INGOT), 'ingot imported').toBeCloseTo(0, 6)
          const leg = (result.areaRoutes ?? []).find(r => r.itemId === PLATE && r.from === undefined && r.to === 'L')
          if (row.leg === undefined) expect(leg, 'no outside leg of plate into L').toBeUndefined()
          else {
            expect(leg?.rate, 'outside leg of plate into L').toBeCloseTo(row.leg, 6)
            expect(leg?.supplied, 'all of it supplied').toBeCloseTo(row.leg, 6)
          }
        })
      }

      // Row c: G in L, P (1 makes 1) in M and S unpinned in a third area N; M's own rule keeps N's ingots out (areasOff), so
      // S would only waste runs. The ingot connection (100) replaces the import of 50 plates: ingot is a pair item.
      it('c: M takes no ingot from N, ingot (100): the connection feeds M, S does not run', () => {
        const a = fixtureA('1-1', { sFree: true })
        const sp = (id: string, nodes: RecipeNode[], rules?: SubPlan['sourceRules']) => ({ ...subPlan(id, nodes, [], true), ...(rules ? { sourceRules: rules } : {}) })
        const b: Block = {
          id: 'H', name: 'H', color: '#60a5fa',
          products: [{ id: 'p-H-0', itemId: 'case22-gear', extraRate: 25 }],
          sourceRules: {}, inputConnections: [],
          rootPlan: subPlan('root', [], [sp('L', [a.nodes[0]]), sp('M', [a.nodes[1]], { [INGOT]: { areasOff: ['N'] } }), sp('N', [a.nodes[2]])]),
        }
        const { result, received } = solveBlock(flattenBlock(b), makeGameData(), new Map([[INGOT, 100]]))
        expect(received.get(INGOT) ?? 0, 'ingot received').toBeCloseTo(50, 6)
        expect(received.get(PLATE) ?? 0, 'plate received').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'P').throughput, 'P runs').toBeCloseTo(50, 6)
        expect(nodeOf(result, 'case22-ingot').throughput, 'S runs').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'case22-gear').throughput, 'G runs').toBeCloseTo(25, 6)
        expect(unsat(result, PLATE), 'plate imported').toBeCloseTo(0, 6)
        expect(unsat(result, INGOT), 'ingot imported').toBeCloseTo(0, 6)
        const into = (itemId: string) => (result.areaRoutes ?? []).find(r => r.itemId === itemId && r.from === undefined && r.to === 'M')
        expect(into(INGOT)?.rate, 'outside leg of ingot into M').toBeCloseTo(50, 6)
        expect(into(INGOT)?.supplied, 'supplied').toBeCloseTo(50, 6)
        expect(into(PLATE), 'no outside leg of plate').toBeUndefined()
      })
    })

    describe('B: a loop that loses', () => {
      const X = 'case22-x'
      const W = 'case22-w'
      const fixtureB = () => ({
        goals: [{ id: 'g0', itemId: 'case22-goal', rate: 10 }],
        nodes: [planNode('case22-use-x'), planNode('case22-recycle')],
      })
      type Row = { name: string; offers: Array<[string, number]>; x: number; w: number; r: number; xUnsat: number; wUnsat: number }
      const rows: Row[] = [
        { name: 'a: none (measured)', offers: [], x: 0, w: 0, r: 10, xUnsat: 10, wUnsat: 0 },
        { name: 'b: X (100) (measured)', offers: [[X, 100]], x: 10, w: 0, r: 10, xUnsat: 0, wUnsat: 0 },
        { name: 'c: X (4) (measured)', offers: [[X, 4]], x: 4, w: 0, r: 10, xUnsat: 6, wUnsat: 0 },
        { name: 'd: W (5000)', offers: [[W, 5000]], x: 0, w: 1000, r: 20, xUnsat: 0, wUnsat: 0 },
        { name: 'e: X (100) and W (5000) (measured)', offers: [[X, 100], [W, 5000]], x: 10, w: 0, r: 10, xUnsat: 0, wUnsat: 0 },
      ]
      for (const row of rows) {
        it(row.name, () => {
          const { result, received } = solveBlock(fixtureB(), makeGameData(), new Map(row.offers))
          expect(received.get(X) ?? 0, 'X received').toBeCloseTo(row.x, 6)
          expect(received.get(W) ?? 0, 'W received').toBeCloseTo(row.w, 6)
          expect(nodeOf(result, 'case22-recycle').throughput, 'R runs').toBeCloseTo(row.r, 6)
          expect(nodeOf(result, 'case22-use-x').throughput, 'U runs').toBeCloseTo(10, 6)
          expect(unsat(result, X), 'X imported').toBeCloseTo(row.xUnsat, 6)
          expect(unsat(result, W), 'W imported').toBeCloseTo(row.wUnsat, 6)
        })
      }
    })

    describe('D: a touched block among other blocks', () => {
      const Z = 'case22-z'
      const H = (): Block => mk('H', [['case22-tool', 25]],
        [planNode('case22-tool'), { ...planNode('case22-plate-1-2'), id: 'P' }, planNode('case22-ingot', [], { pinnedRate: 10 })],
        [{ id: 'c-H', itemId: PLATE, fromBlockId: 'Q' }])
      const Q = (coin: number): Block => mk('Q', [['case22-coin', coin]], [planNode('case22-press')],
        [{ id: 'c-Q', itemId: Z, fromBlockId: 'H' }])
      const check = (all: ReturnType<typeof solveAll>, rate: number, p: number, ingot: number) => {
        expect(flowIn(all, 'c-H').kind, 'plate is a take').toBe('take')
        expect(flowIn(all, 'c-Q').kind, 'z is a take').toBe('take')
        expect(flowIn(all, 'c-H').rate, 'plate taken').toBeCloseTo(rate, 6)
        expect(flowIn(all, 'c-Q').rate, 'z taken').toBeCloseTo(rate, 6)
        expect(nodeOf(all.results.H, 'P').throughput, 'P runs').toBeCloseTo(p, 6)
        expect(nodeOf(all.results.H, 'case22-tool').throughput, 'tool runs').toBeCloseTo(25, 6)
        expect(nodeOf(all.results.Q, 'case22-press').throughput, 'press runs').toBeCloseTo(rate, 6)
        expect(unsat(all.results.H, INGOT), 'ingot imported').toBeCloseTo(ingot, 6)
        expect(unsat(all.results.H, PLATE), 'plate imported').toBeCloseTo(0, 6)
      }
      // Row a (coin 30): the tool runs 25 (50 plates, 50 z); the press takes 30 z and offers 30 plates. H takes 30 (P 10 makes 20, the
      // 10 ingots), imports no ingot and no plate.
      for (const order of [['H', 'Q'], ['Q', 'H']]) {
        it(`a: coin 30, the loop settles, tabs ${order.join(' ')}`, () => {
          const byId: Record<string, Block> = { H: H(), Q: Q(30) }
          const all = solveAll(order.map(t => byId[t]), makeGameData())
          check(all, 30, 10, 0)
          expect(all.loops).toHaveLength(1)
          expect([...all.loops[0].blockIds].sort()).toEqual(['H', 'Q'])
          expect(all.loops[0].converged, 'converged').toBe(true)
        })
      }

      // Row b: a warm solve reuses both results; coin 12 offers 12 plates, so 2x + u = 50, u <= 12 => P 19 and 9 ingots imported.
      it('b: warm solve reuses the results; coin 12 changes them (row d: P 19, ingot 9)', () => {
        const cache = createSolveCache()
        const gd = makeGameData()
        const first = solveAll([H(), Q(30)], gd, cache)
        const second = solveAll([H(), Q(30)], gd, cache)
        expect(second.results.H).toBe(first.results.H)
        expect(second.results.Q).toBe(first.results.Q)
        const third = solveAll([H(), Q(12)], gd, cache)
        check(third, 12, 19, 9)
        expect(third.results.H).not.toBe(first.results.H)
      })
    })

    describe('D: a served list on a source whose consumer is touched', () => {
      const S = (list: ServedEntry[]): Block =>
        mk('S', [[PLATE, 10]], [{ ...planNode('case22-mine-plate'), pinnedRate: 35 }], [], list, PLATE)
      const H = (): Block => mk('H', [['case22-gear', 25]],
        [planNode('case22-gear'), { ...planNode('case22-plate-1-2'), id: 'P' }, planNode('case22-ingot', [], { pinnedRate: 10 })],
        [{ id: 'c-H', itemId: PLATE, fromBlockId: 'S' }])
      const C = (): Block => mk('C', [['case22-gear', 5]], [planNode('case22-gear')], [{ id: 'c-C', itemId: PLATE, fromBlockId: 'S' }])
      // H asks 30 (row f), C 10, the extra 10: 50 against S's 35.
      const cases: Array<[string, string[], string[], { h: [number, number, number, number]; c: [number, number, number]; got: [number, number] }]> = [
        // h: requested, rate, P, ingot imported; c: requested, rate, plate imported; got: H then C in the list's order
        ['list H, C', ['H', 'C'], ['S', 'H', 'C'], { h: [30, 30, 10, 0], c: [10, 5, 5], got: [30, 5] }],
        ['list H, C', ['H', 'C'], ['C', 'H', 'S'], { h: [30, 30, 10, 0], c: [10, 5, 5], got: [30, 5] }],
        // With 25 offered: 2x + u + s = 50, u <= 25, x <= 10 + i; least import 5 - i at i = 2.5, s 0; then u = 25 and P 12.5.
        ['list C, H', ['C', 'H'], ['S', 'H', 'C'], { h: [30, 25, 12.5, 2.5], c: [10, 10, 0], got: [10, 25] }],
        ['list C, H', ['C', 'H'], ['C', 'H', 'S'], { h: [30, 25, 12.5, 2.5], c: [10, 10, 0], got: [10, 25] }],
      ]
      for (const [name, list, tabs, want] of cases) {
        it(`${name}, tabs ${tabs.join(' ')}`, () => {
          const byId: Record<string, Block> = { S: S(listOf(...list, 'extra')), H: H(), C: C() }
          const all = solveAll(tabs.map(t => byId[t]), makeGameData())
          expect(nodeOf(all.results.S, 'case22-mine-plate').throughput, 'S at its pin').toBeCloseTo(35, 6)
          expect(all.results.S.warnings).toContainEqual({ type: 'infeasible-pins', recipeIds: ['case22-mine-plate'] })
          const h = flowIn(all, 'c-H')
          expect(h.requested, 'H requested').toBeCloseTo(want.h[0], 6)
          expect(h.rate, 'H rate').toBeCloseTo(want.h[1], 6)
          expect(nodeOf(all.results.H, 'P').throughput, 'P runs').toBeCloseTo(want.h[2], 6)
          expect(unsat(all.results.H, INGOT), 'H ingot imported').toBeCloseTo(want.h[3], 6)
          expect(unsat(all.results.H, PLATE), 'H plate imported').toBeCloseTo(0, 6)
          const c = flowIn(all, 'c-C')
          expect(c.requested, 'C requested').toBeCloseTo(want.c[0], 6)
          expect(c.rate, 'C rate').toBeCloseTo(want.c[1], 6)
          expect(unsat(all.results.C, PLATE), 'C plate imported').toBeCloseTo(want.c[2], 6)
          const served = all.served.S[PLATE]
          expect(served.consumers.map(x => x.blockId)).toEqual(list)
          const shares = list[0] === 'H' ? [30, 10] : [10, 30]
          expect(served.consumers.map(x => x.share).map(x => Math.round(x * 1e6) / 1e6)).toEqual(shares)
          expect(served.consumers.map(x => Math.round(x.got * 1e6) / 1e6)).toEqual(want.got)
          expect(served.extra?.got, 'extra got').toBeCloseTo(0, 6)
        })
      }
    })
  })

  describe('case 23: an absorber chain', () => {
    // A row that absorbs a byproduct (S, the saw) runs on the surplus of tree; the rows that only feed it (K, P) run along with it, and
    // wood, which only S makes, is a pure byproduct. Values are derived by hand in spec/test-synthetic.md; none is edited to match the solver.
    const TREE = 'case23-tree'
    const flag = (recipeId: string): GameRecipeNode => planNode(recipeId, [], { byproductConsumer: true })
    const unsat = (result: SolverResult, itemId: string) => unsatisfiedRate(result, itemId) ?? 0
    const GOAL: Array<[string, number]> = [['case23-goal', 10]]
    const nodesOf = (flagged: string[], rest: string[]): RecipeNode[] =>
      [...flagged.map(flag), ...rest.map(id => planNode(id))]
    const solveRows = (goals: Array<[string, number]>, nodes: RecipeNode[]): SolverResult =>
      solve({ goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })), nodes }, makeGameData())

    const feeders = (r: SolverResult) => r.nodes.filter(n => n.feedsAbsorber).map(n => n.recipeNodeId).sort()

    const expectChain = (r: SolverResult) => {
      expect(nodeOf(r, 'case23-grow').throughput, 'grow').toBeCloseTo(10, 6)
      expect(nodeOf(r, 'case23-saw-wood').throughput, 'saw-wood').toBeCloseTo(20, 6)
      expect(nodeOf(r, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(2, 6)
      expect(nodeOf(r, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(0.5, 6)
      expect(nodeOf(r, 'case23-saw-wood').outputRates['case23-wood'], 'wood').toBeCloseTo(160, 6)
      expect(r.warnings.map(w => w.type), 'no warning').toEqual([])
      expect(unsat(r, 'case23-seed'), 'seed').toBeCloseTo(10, 6)
      expect(unsat(r, 'case23-roll'), 'roll').toBeCloseTo(0.5, 6)
    }

    it('a: the saw row and the saw maker are flagged', () => {
      const r = solveRows(GOAL, nodesOf(['case23-saw-wood', 'case23-make-saw'], ['case23-grow', 'case23-make-plate']))
      expectChain(r)
      expect(feeders(r), 'feeders').toEqual(['case23-make-plate'])
    })

    it('b: only the saw row is flagged, the saw maker is a feeder', () => {
      const r = solveRows(GOAL, nodesOf(['case23-saw-wood'], ['case23-grow', 'case23-make-saw', 'case23-make-plate']))
      expectChain(r)
      expect(feeders(r), 'feeders').toEqual(['case23-make-plate', 'case23-make-saw'])
    })

    it('c: all three are flagged', () => {
      const r = solveRows(GOAL, nodesOf(['case23-saw-wood', 'case23-make-saw', 'case23-make-plate'], ['case23-grow']))
      expectChain(r)
      expect(feeders(r), 'feeders').toEqual([])
    })

    it('d: an ordinary row also uses the plate, so the plate row is not a feeder', () => {
      const r = solveRows([...GOAL, ['case23-gadget', 4]],
        nodesOf(['case23-saw-wood', 'case23-make-saw'], ['case23-grow', 'case23-make-plate', 'case23-use-plate']))
      expect(nodeOf(r, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(1, 6)
      expect(nodeOf(r, 'case23-saw-wood').throughput, 'saw-wood').toBeCloseTo(0, 6)
      expect(nodeOf(r, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(0, 6)
      const over = r.warnings.find(w => w.type === 'overconstrained')
      expect(over?.type === 'overconstrained' ? over.surplusItems.map(i => [i.itemId, i.rate]) : undefined, 'tree is left over').toEqual([[TREE, 20]])
      expect(feeders(r), 'feeders').toEqual([])
    })

    it('d2: a live feeder that runs 0 times is not marked', () => {
      const r = solveRows([...GOAL, ['case23-gadget', 4]],
        nodesOf(['case23-saw-wood'], ['case23-grow', 'case23-make-saw', 'case23-make-plate', 'case23-use-plate']))
      expect(nodeOf(r, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(0, 6)
      expect(feeders(r), 'feeders').toEqual([])
    })

    it('e: a flagged row that takes only a raw item does not run', () => {
      const r = solveRows(GOAL, nodesOf(['case23-burn-roll'], ['case23-grow']))
      expect(nodeOf(r, 'case23-burn-roll').throughput, 'burn-roll').toBeCloseTo(0, 6)
      expect(nodeOf(r, 'case23-grow').throughput, 'grow').toBeCloseTo(10, 6)
      expect(r.warnings.map(w => w.type), 'no warning').toEqual([])
    })

    it('f: the three rows in an area of their own', () => {
      const wood = subPlan('Wood', [
        { ...rowIn('case23-saw-wood', 'Wood'), byproductConsumer: true },
        { ...rowIn('case23-make-saw', 'Wood'), byproductConsumer: true },
        rowIn('case23-make-plate', 'Wood'),
      ], [], true)
      const block: Block = {
        id: 'H', name: 'H', color: '#60a5fa',
        products: [{ id: 'p0', itemId: 'case23-goal', extraRate: 10 }],
        sourceRules: {}, inputConnections: [],
        rootPlan: subPlan('root', [rowIn('case23-grow', 'root')], [wood]),
      }
      const r = solve(flattenBlock(block), makeGameData())
      expect(nodeOf(r, 'case23-grow@root').throughput, 'grow').toBeCloseTo(10, 6)
      expect(nodeOf(r, 'case23-saw-wood@Wood').throughput, 'saw-wood').toBeCloseTo(20, 6)
      expect(nodeOf(r, 'case23-make-saw@Wood').throughput, 'make-saw').toBeCloseTo(2, 6)
      expect(nodeOf(r, 'case23-make-plate@Wood').throughput, 'make-plate').toBeCloseTo(0.5, 6)
      expect(feeders(r), 'feeders').toEqual(['case23-make-plate@Wood'])
      const area = r.areas!.find(a => a.areaId === 'Wood')!
      expect(area.receives.find(f => f.itemId === TREE)?.rate, 'Wood receives tree').toBeCloseTo(20, 6)
      const leg = (r.areaRoutes ?? []).find(x => x.itemId === TREE && x.to === 'Wood')
      expect(leg?.from, 'tree comes from the root').toBe('root')
      expect(leg?.rate, 'tree leg').toBeCloseTo(20, 6)
      expect(r.warnings.map(w => w.type), 'no warning').toEqual([])
    })

    it('i: a recipe present twice marks only its representative row', () => {
      const r = solveRows(GOAL, [
        flag('case23-saw-wood'), planNode('case23-grow'), planNode('case23-make-plate'),
        planNode('case23-make-saw'), planNode('case23-make-saw', [], { id: 'case23-make-saw-2' }),
      ])
      const first = nodeOf(r, 'case23-make-saw')
      const second = nodeOf(r, 'case23-make-saw-2')
      expect(first.feedsAbsorber, 'representative is marked').toBe(true)
      expect(first.throughput, 'representative runs').toBeCloseTo(2, 6)
      expect(second.throughput, 'duplicate is a zero node').toBe(0)
      expect('feedsAbsorber' in second, 'duplicate carries no field').toBe(false)
    })

    describe('g: between blocks', () => {
      // S is row a with a connection from M for roll; C takes wood from S. The wood only reads S's offer: the rows of S are the same with and without C.
      const block = (id: string, products: Array<[string, number]>, nodes: RecipeNode[], links: Block['inputConnections'] = []): Block => ({
        id, name: id, color: '#60a5fa',
        products: products.map(([itemId, extraRate], i) => ({ id: `p-${id}-${i}`, itemId, extraRate })),
        sourceRules: {}, inputConnections: links, rootPlan: subPlan(`root-${id}`, nodes),
      })
      const source = () => block('S', [['case23-goal', 10]],
        nodesOf(['case23-saw-wood', 'case23-make-saw'], ['case23-grow', 'case23-make-plate']),
        [{ id: 'c-roll', itemId: 'case23-roll', fromBlockId: 'M' }])
      const mine = () => block('M', [['case23-roll', 0]], [planNode('case23-mine-roll')])
      const consumer = () => block('C', [['case23-lumber', 50]], [planNode('case23-use-wood')],
        [{ id: 'c-wood', itemId: 'case23-wood', fromBlockId: 'S' }])
      const rowsOf = (all: ReturnType<typeof solveAll>) =>
        all.results.S.nodes.map(n => [n.recipeNodeId, n.throughput] as const).sort(([a], [b]) => a.localeCompare(b))

      it('the source runs the same rows with and without a taker of wood; wood and roll flow', () => {
        const without = solveAll([source(), mine()], makeGameData())
        const all = solveAll([source(), mine(), consumer()], makeGameData())
        expect(rowsOf(all), 'rows of S').toEqual(rowsOf(without))
        expect(nodeOf(all.results.S, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(0.5, 6)
        const wood = all.flows.find(f => f.connectionId === 'c-wood')!
        expect(wood.status, 'wood').toBe('ok')
        expect(wood.kind, 'wood is a take').toBe('take')
        expect(wood.rate, 'wood rate').toBeCloseTo(50, 6)
        const roll = all.flows.find(f => f.connectionId === 'c-roll')!
        expect(roll.kind, 'roll is a request').toBe('request')
        expect(roll.requested, 'roll requested').toBeCloseTo(0.5, 6)
        expect(nodeOf(all.results.M, 'case23-mine-roll').throughput, 'M mines').toBeCloseTo(0.5, 6)
      })
    })

    describe('h: connected supply of an item two areas trade', () => {
      // The block receives plate first (offer 100). Wood has S flagged, K, and U (ordinary, pinned at 4); P is in an area of its own.
      const plateBlock = (kFlagged: boolean): Block => {
        const wood = subPlan('Wood', [
          { ...rowIn('case23-saw-wood', 'Wood'), byproductConsumer: true },
          { ...rowIn('case23-make-saw', 'Wood'), ...(kFlagged ? { byproductConsumer: true } : {}) },
          { ...rowIn('case23-use-plate', 'Wood'), pinnedRate: 4 },
        ], [], true)
        const plates = subPlan('Plates', [rowIn('case23-make-plate', 'Plates')], [], true)
        return {
          id: 'H', name: 'H', color: '#60a5fa',
          products: [{ id: 'p0', itemId: 'case23-goal', extraRate: 10 }],
          sourceRules: { 'case23-plate': { makeHere: 'after-blocks' } }, inputConnections: [],
          rootPlan: subPlan('root', [rowIn('case23-grow', 'root')], [wood, plates]),
        }
      }
      const solvePlates = (kFlagged: boolean) => solveBlock(flattenBlock(plateBlock(kFlagged)), makeGameData(), new Map([['case23-plate', 100]]))

      it('connected supply feeds a feeder of the chain, never a flagged row', () => {
        const { result, received } = solvePlates(false)
        expect(received.get('case23-plate'), 'plate received').toBeCloseTo(6, 6)
        expect(nodeOf(result, 'case23-saw-wood@Wood').throughput, 'saw-wood').toBeCloseTo(20, 6)
        expect(nodeOf(result, 'case23-make-saw@Wood').throughput, 'make-saw').toBeCloseTo(2, 6)
        expect(nodeOf(result, 'case23-make-plate@Plates').throughput, 'make-plate').toBeCloseTo(0, 6)
        expect(feeders(result), 'feeders').toEqual(['case23-make-saw@Wood'])
      })

      it('h2: a flagged K takes none of the supply', () => {
        const { result, received } = solvePlates(true)
        expect(received.get('case23-plate') ?? 0, 'plate received').toBeCloseTo(4, 6)
        expect(nodeOf(result, 'case23-make-saw@Wood').throughput, 'make-saw').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'case23-saw-wood@Wood').throughput, 'saw-wood').toBeCloseTo(0, 6)
      })
    })

    // j, k: no areas. The rows sit in the root of a block that receives an item first.
    const flatBlock = (nodes: GameRecipeNode[], sourceRule: string, goals: Array<[string, number]> = GOAL): Block => ({
      id: 'J', name: 'J', color: '#60a5fa',
      products: goals.map(([itemId, extraRate], i) => ({ id: `p${i}`, itemId, extraRate })),
      sourceRules: { [sourceRule]: { makeHere: 'after-blocks' } }, inputConnections: [],
      rootPlan: subPlan('root', nodes),
    })

    it('j: a plate supply feeds the saw maker of a flagged saw row, without a plate row', () => {
      const nodes = [planNode('case23-grow'), flag('case23-saw-wood'), planNode('case23-make-saw'), planNode('case23-make-plate')]
      const { result, received } = solveBlock(flattenBlock(flatBlock(nodes, 'case23-plate')), makeGameData(), new Map([['case23-plate', 100]]))
      expect(received.get('case23-plate'), 'plate received').toBeCloseTo(2, 6)
      expect(nodeOf(result, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(0, 6)
      expect(nodeOf(result, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(2, 6)
      expect(nodeOf(result, 'case23-saw-wood').throughput, 'saw-wood').toBeCloseTo(20, 6)
      expect(unsat(result, 'case23-roll'), 'roll imported').toBeCloseTo(0, 6)
      expect(feeders(result), 'feeders').toEqual(['case23-make-saw'])
    })

    it('k: a roll supply never reaches the plate row that only feeds a flagged saw maker, whatever the offer', () => {
      // An ordinary row (burn-roll) also takes roll, so mine-roll is an ordinary row and roll is bounded.
      for (const offer of [100, Infinity]) {
        const nodes = [
          planNode('case23-grow'), flag('case23-make-saw'), planNode('case23-make-plate'), planNode('case23-mine-roll'), planNode('case23-burn-roll'),
        ]
        const { result, received } = solveBlock(flattenBlock(flatBlock(nodes, 'case23-roll')), makeGameData(), new Map([['case23-roll', offer]]))
        expect(nodeOf(result, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'case23-mine-roll').throughput, 'mine-roll').toBeCloseTo(0, 6)
        expect(nodeOf(result, 'case23-grow').throughput, 'grow').toBeCloseTo(10, 6)
        expect(received.get('case23-roll') ?? 0, `roll received (offer ${offer})`).toBeCloseTo(0, 6)
      }
    })

    describe('l, m: a row marked to feed absorbing rows', () => {
      const mark = (recipeId: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode => planNode(recipeId, [], { absorberFeeder: true, ...extra })
      const rows = (plate: GameRecipeNode): RecipeNode[] => [
        flag('case23-saw-wood'), planNode('case23-make-saw'), plate, planNode('case23-grow'), planNode('case23-use-plate'),
      ]

      it('l: d2 (only S flagged) with Feed absorbing rows on the plate row', () => {
        const r = solveRows([...GOAL, ['case23-gadget', 4]], rows(mark('case23-make-plate')))
        expect(nodeOf(r, 'case23-grow').throughput, 'grow').toBeCloseTo(10, 6)
        expect(nodeOf(r, 'case23-saw-wood').throughput, 'saw-wood').toBeCloseTo(20, 6)
        expect(nodeOf(r, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(2, 6)
        expect(nodeOf(r, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(1.5, 6)
        expect(nodeOf(r, 'case23-use-plate').throughput, 'use-plate').toBeCloseTo(4, 6)
        expect(nodeOf(r, 'case23-saw-wood').outputRates['case23-wood'], 'wood').toBeCloseTo(160, 6)
        expect(unsat(r, 'case23-roll'), 'roll').toBeCloseTo(1.5, 6)
        expect(unsat(r, 'case23-seed'), 'seed').toBeCloseTo(10, 6)
        expect(r.warnings.map(w => w.type), 'no warning').toEqual([])
        // K runs 2 and only feeds S, so it is marked too, as in b.
        expect(feeders(r), 'feeders').toEqual(['case23-make-plate', 'case23-make-saw'])
      })

      it('m: l with the plate row pinned at 1 behaves as d', () => {
        const r = solveRows([...GOAL, ['case23-gadget', 4]], rows(mark('case23-make-plate', { pinnedRate: 1 })))
        expect(nodeOf(r, 'case23-make-plate').throughput, 'make-plate').toBeCloseTo(1, 6)
        expect(nodeOf(r, 'case23-saw-wood').throughput, 'saw-wood').toBeCloseTo(0, 6)
        expect(nodeOf(r, 'case23-make-saw').throughput, 'make-saw').toBeCloseTo(0, 6)
        expect(nodeOf(r, 'case23-use-plate').throughput, 'use-plate').toBeCloseTo(4, 6)
        const over = r.warnings.find(w => w.type === 'overconstrained')
        expect(over?.type === 'overconstrained' ? over.surplusItems.map(i => [i.itemId, i.rate]) : undefined, 'tree is left over').toEqual([[TREE, 20]])
        expect(feeders(r), 'feeders').toEqual([])
      })
    })
  })

  describe('case 24: a cooling chain on a fluid with Import off', () => {
    // The fluid cannot be imported; every temperature the rows make is a key of its own and a conversion column moves it to a range it fits.
    // Values are derived by hand in spec/test-synthetic.md; none is edited to match the solver.
    const USED = 'case24-used'
    const HEAT = 'case24-heat'
    const COOLERS = ['case24-cool-300', 'case24-cool-200', 'case24-cool-100']
    const FILTER = 'case24-filter'
    const rule: SourceRule = { importOff: true }
    const mismatches = (r: SolverResult) => r.warnings.filter(w => w.type === 'temperature-mismatch')
    const rowsOf = (recipeIds: string[], pins: Record<string, number> = {}, where: (id: string) => string = () => 'root') =>
      recipeIds.map(id => rowIn(id, where(id))).map(n => ({ ...n, ...(pins[n.recipeId] === undefined ? {} : { pinnedRate: pins[n.recipeId] }) }))
    const block = (rootPlan: SubPlan, sourceRule: SourceRule = rule): Block => ({
      id: 'block-24', name: 'Block', color: '#60a5fa',
      products: [{ id: 'p0', itemId: 'case24-clean', extraRate: 60 }],
      sourceRules: { [USED]: sourceRule }, inputConnections: [], rootPlan,
    })
    const solveOne = (b: Block): SolverResult => solveAll([b], makeGameData()).results[b.id]
    const flat = (recipeIds: string[], pins: Record<string, number> = {}, sourceRule: SourceRule = rule) =>
      solveOne(block(subPlan('root', rowsOf(recipeIds, pins)), sourceRule))
    const rate = (r: SolverResult, recipeId: string, where = 'root') => nodeOf(r, `${recipeId}@${where}`).throughput
    const ALL = [HEAT, ...COOLERS, FILTER]
    const noFitting = (r: SolverResult) => r.warnings.filter(w => w.type === 'no-fitting-temperature')

    it('a: runs every step of the chain, one conversion per step', () => {
      const r = flat(ALL)
      for (const id of ALL) expect(rate(r, id), id).toBeCloseTo(60, 6)
      expect(unsatisfiedRate(r, USED), 'used is not imported').toBeUndefined()
      expect(unsatisfiedRate(r, 'case24-ore'), 'ore').toBeCloseTo(60, 6)
      expect(r.conversions, 'four conversions of 6000').toHaveLength(4)
      for (const c of r.conversions ?? []) expect(c.rate, 'conversion rate').toBeCloseTo(6000, 6)
      expect(mismatches(r), 'no mismatch').toEqual([])
      expect(noFitting(r), 'no missing temperature').toEqual([])
    })

    it('b: without the first cooler nothing fits the filter: shortfall 60 and no-fitting-temperature', () => {
      const r = flat([HEAT, 'case24-cool-300', 'case24-cool-200', FILTER])
      for (const id of [HEAT, 'case24-cool-300', 'case24-cool-200', FILTER]) expect(rate(r, id), id).toBeCloseTo(0, 6)
      expect(r.unsatisfied, 'goal shortfall only').toEqual([{ itemId: 'case24-clean', rate: expect.closeTo(60, 6) }])
      expect(r.warnings, 'one warning').toEqual([
        { type: 'no-fitting-temperature', itemId: USED, max: 50, recipeIds: [FILTER] },
      ])
      expect(mismatches(r), 'no mismatch').toEqual([])
    })

    it('b2: b with Import on imports the fluid for a filter at 50 or less', () => {
      const r = flat([HEAT, 'case24-cool-300', 'case24-cool-200', FILTER], {}, {})
      expect(rate(r, FILTER), 'filter').toBeCloseTo(60, 6)
      for (const id of [HEAT, 'case24-cool-300', 'case24-cool-200']) expect(rate(r, id), id).toBeCloseTo(0, 6)
      expect(r.unsatisfied, 'one import').toEqual([{ itemId: USED, rate: expect.closeTo(6000, 6), temp: { max: 50 } }])
      expect(r.warnings, 'no warning').toEqual([])
    })

    it('c: with Import on, the same chain as a', () => {
      const r = flat(ALL, {}, {})
      for (const id of ALL) expect(rate(r, id), id).toBeCloseTo(60, 6)
      expect(unsatisfiedRate(r, USED), 'used is not imported').toBeUndefined()
      expect(mismatches(r), 'no mismatch').toEqual([])
    })

    it('d: a cooler pinned too low is infeasible pins with a conflict', () => {
      const r = flat(ALL, { 'case24-cool-100': 10, [FILTER]: 60 })
      const w = r.warnings.find(x => x.type === 'infeasible-pins')
      expect(w, 'infeasible pins').toBeDefined()
      expect(w).toMatchObject({ type: 'infeasible-pins', conflict: true })
      expect(w?.type === 'infeasible-pins' ? [...w.recipeIds].sort() : undefined).toEqual(['case24-cool-100', FILTER])
      expect(mismatches(r), 'no mismatch').toEqual([])
    })

    describe('e, f: the cooling rows in an area of their own', () => {
      const areaPlan = (pins: Record<string, number> = {}) => {
        const cool = rowsOf([HEAT, ...COOLERS], pins, () => 'Cool')
        const filter = rowsOf([FILTER], pins)
        return subPlan('root', filter, [subPlan('Cool', cool, [], true)])
      }

      it('e: the same rates, the 25 degree fluid leaves the area', () => {
        const r = solveOne(block(areaPlan()))
        for (const id of [HEAT, ...COOLERS]) expect(rate(r, id, 'Cool'), id).toBeCloseTo(60, 6)
        expect(rate(r, FILTER), 'filter').toBeCloseTo(60, 6)
        const leg = (r.areaRoutes ?? []).find(x => x.itemId === USED && x.from === 'Cool' && x.to === 'root')
        expect(leg?.rate, 'used from Cool to the root').toBeCloseTo(6000, 6)
        expect(leg?.temp, 'at 25').toEqual({ at: 25 })
        expect(mismatches(r), 'no mismatch').toEqual([])
      })

      it('f: d in areas', () => {
        const r = solveOne(block(areaPlan({ 'case24-cool-100': 10, [FILTER]: 60 })))
        const w = r.warnings.find(x => x.type === 'infeasible-pins')
        expect(w).toMatchObject({ type: 'infeasible-pins', conflict: true })
        expect(w?.type === 'infeasible-pins' ? [...w.recipeIds].sort() : undefined).toEqual(['case24-cool-100', FILTER])
        expect(mismatches(r), 'no mismatch').toEqual([])
      })
    })

    // g, h: a block that also imports plate, which a connection (100) replaces (case 22 row A-b: P runs 10, 30 plates received).
    // The connection order builds the same keys, so the chain still runs.
    describe('g, h: with a connection replacing an import', () => {
      const PLATE = 'case22-plate'
      const gear = () => planNode('case22-gear')
      const plateP = () => ({ ...planNode('case22-plate-1-2'), id: 'P' })
      const ingot = () => planNode('case22-ingot', [], { pinnedRate: 10 })
      const offers = new Map([[PLATE, 100]])
      const checkOrder = (result: SolverResult, received: Map<string, number>, chain: (id: string) => number) => {
        expect(received.get(PLATE) ?? 0, 'plate received').toBeCloseTo(30, 6)
        expect(nodeOf(result, 'P').throughput, 'P runs').toBeCloseTo(10, 6)
        expect(nodeOf(result, 'case22-gear').throughput, 'G runs').toBeCloseTo(25, 6)
        expect(chain(HEAT), 'heat').toBeCloseTo(60, 6)
        expect(chain(FILTER), 'filter').toBeCloseTo(60, 6)
        return chain
      }

      it('g: the order keeps the cooling rows (plain)', () => {
        const nodes = [gear(), plateP(), ingot(), ...ALL.map(id => planNode(id))]
        const plan = { goals: [{ id: 'g0', itemId: 'case22-gear', rate: 25 }, { id: 'g1', itemId: 'case24-clean', rate: 60 }], nodes, sourceRules: { [USED]: rule } }
        const { result, received } = solveBlock(plan, makeGameData(), offers)
        const chain = checkOrder(result, received, id => nodeOf(result, id).throughput)
        for (const id of COOLERS) expect(chain(id), id).toBeCloseTo(60, 6)
      })

      it('h: the same in areas', () => {
        const sp = (id: string, ns: RecipeNode[]) => subPlan(id, ns, [], true)
        const b: Block = {
          id: 'H', name: 'H', color: '#60a5fa',
          products: [{ id: 'p-H-0', itemId: 'case22-gear', extraRate: 25 }, { id: 'p-H-1', itemId: 'case24-clean', extraRate: 60 }],
          sourceRules: { [USED]: rule }, inputConnections: [],
          rootPlan: subPlan('root', [], [sp('L', [gear()]), sp('M', [plateP(), ingot()]), sp('Cool', ALL.map(id => planNode(id)))]),
        }
        const { result, received } = solveBlock(flattenBlock(b), makeGameData(), offers)
        const chain = checkOrder(result, received, id => nodeOf(result, id).throughput)
        for (const id of COOLERS) expect(chain(id), id).toBeCloseTo(60, 6)
      })
    })
  })

  describe('case 25: keys inside a block', () => {
    // Steam is made at 165, at 500 and at no temperature; the turbine takes it at 465 or more, the engine at any temperature.
    // Values are derived by hand in spec/test-synthetic.md; none is edited to match the solver.
    const STEAM = 'case25-steam'
    const B1 = 'case25-boil-165'
    const B2 = 'case25-boil-500'
    const U = 'case25-boil-any'
    const T = 'case25-turbine'
    const E = 'case25-engine'
    const R = 'case25-reheat'
    const rows = (ids: string[], pins: Record<string, number> = {}) =>
      ids.map(id => planNode(id, [], pins[id] === undefined ? {} : { pinnedRate: pins[id] }))
    const go = (goals: Array<[string, number]>, ids: string[], pins: Record<string, number> = {}, sourceRules: Record<string, SourceRule> = {}) =>
      solve({ goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })), nodes: rows(ids, pins), sourceRules }, makeGameData())
    const convs = (r: SolverResult) => (r.conversions ?? []).map(c => ({ from: c.from, to: c.to, rate: Math.round(c.rate * 1e6) / 1e6 }))
    const hasSteamImport = (r: SolverResult) => r.unsatisfied.some(u => u.itemId === STEAM)

    it('a: a boiler pinned too cold: the turbine imports, the 165 steam is a byproduct', () => {
      const r = go([['case25-work', 60]], [B1, T], { [B1]: 60 })
      expect(nodeOf(r, T).throughput, 'turbine').toBeCloseTo(60, 6)
      expect(r.unsatisfied, 'steam and fuel').toHaveLength(2)
      expect(r.unsatisfied.find(u => u.itemId === STEAM)).toEqual({ itemId: STEAM, rate: expect.closeTo(3600, 6), temp: { min: 465 } })
      expect(unsatisfiedRate(r, 'case25-fuel')).toBeCloseTo(60, 6)
      expect(netBalance(r.nodes, r.conversions).get(`${STEAM}@165`)).toBeCloseTo(3600, 6)
      expect(r.conversions, 'no conversion').toBeUndefined()
      expect(r.warnings, 'no warning').toEqual([])
    })

    it('b: the 500 steam feeds the turbine, the 165 boiler stays off', () => {
      const r = go([['case25-work', 60]], [B1, B2, T])
      expect(nodeOf(r, B2).throughput, 'B2').toBeCloseTo(120, 6)
      expect(nodeOf(r, B1).throughput, 'B1').toBeCloseTo(0, 6)
      expect(hasSteamImport(r), 'no steam import').toBe(false)
      expect(unsatisfiedRate(r, 'case25-fuel')).toBeCloseTo(120, 6)
      expect(convs(r)).toEqual([{ from: { at: 500 }, to: { min: 465 }, rate: 3600 }])
    })

    it('c: the 500 steam feeds both a bounded and an unbounded row', () => {
      const r = go([['case25-work', 60], ['case25-work2', 60]], [B2, T, E])
      expect(nodeOf(r, B2).throughput, 'B2').toBeCloseTo(240, 6)
      expect(convs(r)).toHaveLength(2)
      expect(convs(r)).toContainEqual({ from: { at: 500 }, to: { min: 465 }, rate: 3600 })
      expect(convs(r)).toContainEqual({ from: { at: 500 }, to: {}, rate: 3600 })
    })

    it('d: steam made at no temperature fits every range', () => {
      const r = go([['case25-work', 60]], [U, T])
      expect(nodeOf(r, U).throughput, 'U').toBeCloseTo(60, 6)
      expect(hasSteamImport(r), 'no steam import').toBe(false)
      expect(convs(r)).toEqual([{ from: { at: null }, to: { min: 465 }, rate: 3600 }])
    })

    it('e: a recipe that takes steam and returns it colder no longer nets to zero', () => {
      const r = go([['case25-work', 60]], [B2, R])
      expect(nodeOf(r, R).throughput, 'R').toBeCloseTo(60, 6)
      expect(nodeOf(r, B2).throughput, 'B2').toBeCloseTo(120, 6)
      expect(netBalance(r.nodes, r.conversions).get(`${STEAM}@165`)).toBeCloseTo(3600, 6)
      expect(hasSteamImport(r), 'no steam import').toBe(false)
    })

    it('f: with Import off nothing can feed the turbine: shortfall and no-fitting-temperature', () => {
      const r = go([['case25-work', 60]], [B1, T], {}, { [STEAM]: { importOff: true } })
      expect(nodeOf(r, T).throughput, 'T').toBeCloseTo(0, 6)
      expect(nodeOf(r, B1).throughput, 'B1').toBeCloseTo(0, 6)
      expect(r.unsatisfied).toEqual([{ itemId: 'case25-work', rate: expect.closeTo(60, 6) }])
      expect(r.warnings).toEqual([
        { type: 'no-fitting-temperature', itemId: STEAM, min: 465, recipeIds: [T] },
      ])
    })

    it('g: a byproduct consumer that takes a range nothing fits just runs at 0, with no warning', () => {
      const nodes = [B1, T, E].map(id => (id === T ? planNode(id, [], { byproductConsumer: true }) : planNode(id)))
      const r = solve({ goals: [{ id: 'g0', itemId: 'case25-work2', rate: 60 }], nodes }, makeGameData())
      expect(nodeOf(r, E).throughput, 'E').toBeCloseTo(60, 6)
      expect(nodeOf(r, T).throughput, 'T').toBeCloseTo(0, 6)
      expect(r.unsatisfied.find(u => u.itemId === 'case25-work2'), 'goal met').toBeUndefined()
      expect(r.warnings.filter(w => w.type === 'no-fitting-temperature')).toEqual([])
    })
  })

  describe('case 26: connections carry temperature keys', () => {
    // A makes steam at 500 (W) and 165 (W2); B takes it for a turbine (>= 465) and an engine (any). Values are derived by hand
    // in spec/test-synthetic.md; none is edited to match the solver.
    const STEAM = 'case25-steam'
    const W = 'case26-make-widget'
    const W2 = 'case26-make-widget2'
    const T = 'case25-turbine'
    const E = 'case25-engine'
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6
    const partsOf = (f: ReturnType<typeof flowIn>) => f.parts?.map(p => ({ temp: p.temp, rate: r6(p.rate), available: r6(p.available) }))
    const sourceA = () => mk('A', [['case26-widget', 60]], [planNode(W), planNode(W2, [], { pinnedRate: 30 })])
    const takerB = (maxRate?: number) =>
      mk('B', [['case25-work', 30], ['case25-work2', 30]], [planNode(T), planNode(E)], [{ id: 'c-B', itemId: STEAM, fromBlockId: 'A', ...(maxRate === undefined ? {} : { maxRate }) }])
    const steamImports = (r: SolverResult) => r.unsatisfied.filter(u => u.itemId === STEAM).map(u => ({ temp: u.temp, rate: r6(u.rate) }))

    it('a: B takes 1800 at 500 for the turbine and 1800 at 165 for the engine', () => {
      const all = solveAll([sourceA(), takerB()], makeGameData())
      const f = flowIn(all, 'c-B')
      expect(f.rate, 'rate').toBeCloseTo(3600, 6)
      expect(f.status).toBe('ok')
      expect(partsOf(f)).toEqual([
        { temp: { at: 165 }, rate: 1800, available: 1800 },
        { temp: { at: 500 }, rate: 1800, available: 3600 },
      ])
      expect(steamImports(all.results.B), 'no steam import').toEqual([])
      expect(nodeOf(all.results.B, T).throughput, 'T').toBeCloseTo(30, 6)
      expect(nodeOf(all.results.B, E).throughput, 'E').toBeCloseTo(30, 6)
    })

    it('b: maxRate 2700 leaves 900 to import; the turbine keeps the 500 steam', () => {
      const all = solveAll([sourceA(), takerB(2700)], makeGameData())
      const f = flowIn(all, 'c-B')
      expect(f.rate, 'rate').toBeCloseTo(2700, 6)
      expect(f.available, 'available').toBeCloseTo(2700, 6)
      expect(f.status).toBe('limited')
      expect(f.capped).toBe(true)
      expect(partsOf(f)!.map(p => ({ temp: p.temp, rate: p.rate }))).toEqual([
        { temp: { at: 165 }, rate: 900 },
        { temp: { at: 500 }, rate: 1800 },
      ])
      expect(steamImports(all.results.B)).toEqual([{ temp: {}, rate: 900 }])
    })

    it('c: a request carries one range key per range', () => {
      const a = mk('A', [[STEAM, 0]], [planNode('case25-boil-165'), planNode('case25-boil-500')])
      const b = mk('B', [['case25-work', 30], ['case25-work2', 30]], [planNode(T), planNode(E)], [{ id: 'c-B', itemId: STEAM, fromBlockId: 'A' }])
      const all = solveAll([a, b], makeGameData())
      const f = flowIn(all, 'c-B')
      expect(f.kind).toBe('request')
      expect(f.requested, 'requested').toBeCloseTo(3600, 6)
      expect(f.rate, 'rate').toBeCloseTo(3600, 6)
      expect(f.parts!.map(p => ({ temp: p.temp, rate: r6(p.rate), requested: r6(p.requested ?? -1) }))).toEqual([
        { temp: {}, rate: 1800, requested: 1800 },
        { temp: { min: 465 }, rate: 1800, requested: 1800 },
      ])
      expect(nodeOf(all.results.A, 'case25-boil-500').throughput, 'B2').toBeCloseTo(60, 6)
      expect(nodeOf(all.results.A, 'case25-boil-165').throughput, 'B1').toBeCloseTo(30, 6)
      expect(steamImports(all.results.B), 'no steam import').toEqual([])
    })

    it('d: steam at 165 fits nothing the turbine takes: unused, a connection-temperature warning', () => {
      const a = mk('A', [['case26-widget2', 30]], [planNode(W2)])
      const b = mk('B', [['case25-work', 30]], [planNode(T)], [{ id: 'c-B', itemId: STEAM, fromBlockId: 'A' }])
      const all = solveAll([a, b], makeGameData())
      const f = flowIn(all, 'c-B')
      expect(f.rate, 'rate').toBeCloseTo(0, 6)
      expect(f.status).toBe('unused')
      expect(steamImports(all.results.B)).toEqual([{ temp: { min: 465 }, rate: 1800 }])
      expect(all.results.B.warnings).toEqual([
        {
          type: 'connection-temperature',
          connections: [{
            connectionId: 'c-B', itemId: STEAM,
            offered: [{ temperature: 165, rate: expect.closeTo(1800, 6) }],
            needed: [{ min: 465, rate: expect.closeTo(1800, 6) }],
          }],
        },
      ])
    })
  })

  describe('case 27: fit before rank', () => {
    // A offers 1800 at 500 (W, 30) and 1800 at 165 (W2 pinned); C1 has an engine (any temperature), C2 a turbine (>= 465).
    const STEAM = 'case25-steam'
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6
    const flowParts = (f: ReturnType<typeof flowIn>) => f.parts?.map(p => ({ temp: p.temp, rate: r6(p.rate), available: r6(p.available) }))
    const servedParts = (all: ReturnType<typeof solveAll>, id: string) =>
      all.served.A[STEAM].consumers.find(c => c.blockId === id)!.parts!
        .filter(p => p.share > 1e-6 || p.got > 1e-6).map(p => ({ temp: p.temp, share: r6(p.share), got: r6(p.got) }))
    const shares = (all: ReturnType<typeof solveAll>) => all.served.A[STEAM].consumers.map(c => [c.blockId, r6(c.share)])
    const blocks = (w2Pin: number, list?: ServedEntry[]): Record<string, Block> => ({
      A: mk('A', [['case26-widget', 30]], [planNode('case26-make-widget'), planNode('case26-make-widget2', [], { pinnedRate: w2Pin })], [], list, STEAM),
      C1: mk('C1', [['case25-work2', 30]], [planNode('case25-engine')], [{ id: 'c-C1', itemId: STEAM, fromBlockId: 'A' }]),
      C2: mk('C2', [['case25-work', 30]], [planNode('case25-turbine')], [{ id: 'c-C2', itemId: STEAM, fromBlockId: 'A' }]),
    })
    const imports = (all: ReturnType<typeof solveAll>, id: string) =>
      all.results[id].unsatisfied.filter(u => u.itemId === STEAM).map(u => ({ temp: u.temp, rate: r6(u.rate) }))
    const C1_THEN_C2 = [{ kind: 'block', blockId: 'C1' }, { kind: 'block', blockId: 'C2' }] satisfies ServedEntry[]

    it('a: a list C1, C2: C1 takes the 165 steam, C2 the 500 steam', () => {
      const all = solveAll(['A', 'C1', 'C2'].map(t => blocks(30, C1_THEN_C2)[t]), makeGameData())
      expect(flowIn(all, 'c-C1').rate).toBeCloseTo(1800, 6)
      expect(flowIn(all, 'c-C2').rate).toBeCloseTo(1800, 6)
      expect(flowParts(flowIn(all, 'c-C1'))!.filter(p => p.rate > 0)).toEqual([{ temp: { at: 165 }, rate: 1800, available: 1800 }])
      expect(flowParts(flowIn(all, 'c-C2'))!.filter(p => p.rate > 0)).toEqual([{ temp: { at: 500 }, rate: 1800, available: 1800 }])
      expect(imports(all, 'C1')).toEqual([])
      expect(imports(all, 'C2')).toEqual([])
      expect(shares(all)).toEqual([['C1', 1800], ['C2', 1800]])
      expect(servedParts(all, 'C1')).toEqual([{ temp: { at: 165 }, share: 1800, got: 1800 }])
      expect(servedParts(all, 'C2')).toEqual([{ temp: { at: 500 }, share: 1800, got: 1800 }])
    })

    it('b: 900 at 165: C1 is served first and takes 900 of each, C2 imports 900', () => {
      const all = solveAll(['A', 'C1', 'C2'].map(t => blocks(15, C1_THEN_C2)[t]), makeGameData())
      expect(flowIn(all, 'c-C1').rate).toBeCloseTo(1800, 6)
      expect(flowIn(all, 'c-C1').status).toBe('ok')
      expect(flowIn(all, 'c-C2').rate).toBeCloseTo(900, 6)
      expect(flowIn(all, 'c-C2').status).toBe('limited')
      expect(flowParts(flowIn(all, 'c-C1'))).toEqual([
        { temp: { at: 165 }, rate: 900, available: 900 },
        { temp: { at: 500 }, rate: 900, available: 900 },
      ])
      expect(flowParts(flowIn(all, 'c-C2'))).toEqual([{ temp: { at: 500 }, rate: 900, available: 900 }])
      expect(imports(all, 'C1')).toEqual([])
      expect(imports(all, 'C2')).toEqual([{ temp: { min: 465 }, rate: 900 }])
      expect(shares(all)).toEqual([['C1', 1800], ['C2', 900]])
      expect(servedParts(all, 'C1')).toEqual([{ temp: { at: 165 }, share: 900, got: 900 }, { temp: { at: 500 }, share: 900, got: 900 }])
      expect(servedParts(all, 'C2')).toEqual([{ temp: { at: 500 }, share: 900, got: 900 }])
    })

    for (const tabs of [['A', 'C1', 'C2'], ['A', 'C2', 'C1']]) {
      it(`c: no list, tabs ${tabs.join(' ')}: the least versatile key goes first`, () => {
        const all = solveAll(tabs.map(t => blocks(30)[t]), makeGameData())
        expect(flowIn(all, 'c-C1').rate).toBeCloseTo(1800, 6)
        expect(flowIn(all, 'c-C2').rate).toBeCloseTo(1800, 6)
        expect(flowParts(flowIn(all, 'c-C1'))!.filter(p => p.rate > 0)).toEqual([{ temp: { at: 165 }, rate: 1800, available: 1800 }])
        expect(flowParts(flowIn(all, 'c-C2'))!.filter(p => p.rate > 0)).toEqual([{ temp: { at: 500 }, rate: 1800, available: 1800 }])
        expect(imports(all, 'C1')).toEqual([])
        expect(imports(all, 'C2')).toEqual([])
        if (tabs[1] === 'C1') {
          // C1 is solved first with no reservation: it sees both keys and leaves the 500 steam unused.
          expect(flowParts(flowIn(all, 'c-C1'))).toEqual([
            { temp: { at: 165 }, rate: 1800, available: 1800 },
            { temp: { at: 500 }, rate: 0, available: 1800 },
          ])
        }
      })
    }

    it('d: b with C1 and C2 tied 50/50: each gets 1350', () => {
      const tied = [{ kind: 'block', blockId: 'C1', share: 50 }, { kind: 'block', blockId: 'C2', tied: true, share: 50 }] satisfies ServedEntry[]
      const all = solveAll(['A', 'C1', 'C2'].map(t => blocks(15, tied)[t]), makeGameData())
      expect(flowIn(all, 'c-C1').rate).toBeCloseTo(1350, 6)
      expect(flowIn(all, 'c-C2').rate).toBeCloseTo(1350, 6)
      expect(flowIn(all, 'c-C1').status).toBe('limited')
      expect(flowIn(all, 'c-C2').status).toBe('limited')
      expect(flowParts(flowIn(all, 'c-C1'))!.map(p => ({ temp: p.temp, rate: p.rate }))).toEqual([
        { temp: { at: 165 }, rate: 900 },
        { temp: { at: 500 }, rate: 450 },
      ])
      expect(flowParts(flowIn(all, 'c-C2'))!.filter(p => p.rate > 0)).toEqual([{ temp: { at: 500 }, rate: 1350, available: 1350 }])
      expect(imports(all, 'C1')).toEqual([{ temp: {}, rate: 450 }])
      expect(imports(all, 'C2')).toEqual([{ temp: { min: 465 }, rate: 450 }])
      expect(shares(all)).toEqual([['C1', 1350], ['C2', 1350]])
      expect(servedParts(all, 'C1')).toEqual([{ temp: { at: 165 }, share: 900, got: 900 }, { temp: { at: 500 }, share: 450, got: 450 }])
      expect(servedParts(all, 'C2')).toEqual([{ temp: { at: 500 }, share: 1350, got: 1350 }])
    })
  })
})
