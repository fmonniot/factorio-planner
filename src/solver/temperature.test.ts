import { describe, it, expect } from 'vitest'
import { solveAll, solveBlock, flattenBlock } from './index'
import { HEAT_ITEM_ID } from '../data/electricity'
import { temperatureWarnings } from './temperature'
import { createSolveCache } from './solveCache'
import type { AreaSourceRule, Block, ConnectionFlow, GameData, GameRecipeNode, Product, RecipeNode, SolverResult, SolverWarning } from '../data/types'

type GameRecipe = GameData['recipes'][string]

function gameData(recipes: GameRecipe[], items: GameData['items'] = {}): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items,
    recipes: Object.fromEntries(recipes.map(r => [r.id, r])),
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

function recipe(id: string, ingredients: GameRecipe['ingredients'], products: GameRecipe['products']): GameRecipe {
  return {
    id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [],
    allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  }
}

/** A boiler: no ingredients, 1 steam per run, at `temperature` (absent: the fluid default). */
function boiler(id: string, temperature?: number): GameRecipe {
  return recipe(id, [], [{ itemId: 'steam', type: 'fluid', amount: 1, ...(temperature === undefined ? {} : { temperature }) }])
}

/** A generator: 1 steam per run, steam of at least `min` (and at most `max`), makes electricity. */
function generator(id: string, min?: number, max?: number): GameRecipe {
  return recipe(
    id,
    [{ itemId: 'steam', type: 'fluid', amount: 1, ...(min === undefined ? {} : { minimumTemperature: min }), ...(max === undefined ? {} : { maximumTemperature: max }) }],
    [{ itemId: 'electricity', type: 'item', amount: 1 }],
  )
}

const STEAM_ITEMS = (defaultTemperature?: number): GameData['items'] => ({
  steam: { id: 'steam', name: 'Steam', ...(defaultTemperature === undefined ? {} : { defaultTemperature }) } as GameData['items'][string],
})

function node(id: string, recipeId: string, pinnedRate?: number): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...(pinnedRate === undefined ? {} : { pinnedRate }) }
}

function block(id: string, nodes: RecipeNode[], products: Product[] = [{ id: `g-${id}`, itemId: 'electricity', extraRate: 60 }], connections: Block['inputConnections'] = []): Block {
  const now = new Date().toISOString()
  return {
    id, name: id, color: '#60a5fa', products, sourceRules: {}, inputConnections: connections,
    rootPlan: { id: `root-${id}`, name: `root-${id}`, nodes, subPlans: [], createdAt: now, updatedAt: now },
  }
}

function mismatches(warnings: SolverWarning[]) {
  return warnings.filter((w): w is Extract<SolverWarning, { type: 'temperature-mismatch' }> => w.type === 'temperature-mismatch')
}

describe('temperature-mismatch warning', () => {
  it('imports the fluid, and says why, when the only boiler is below the generator minimum', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.find(u => u.itemId === 'steam')?.rate, 'steam is imported').toBeCloseTo(60)
    expect(all.results.A.nodes[0].throughput, 'the cold boiler is not run').toBe(0)
    const w = mismatches(all.results.A.warnings)
    expect(w, 'one warning').toHaveLength(1)
    expect(w[0]).toMatchObject({ recipeId: 'turbine', itemId: 'steam', supplied: [165], minimum: 465 })
    expect(w[0].imported, 'the import it causes').toBeCloseTo(60)
    expect(w[0].unused, 'the idle boiler leaves nothing unused').toBeUndefined()
    expect(w[0].maximum, 'no maximum').toBeUndefined()
  })

  it('stays silent when the boiler fits', () => {
    const gd = gameData([boiler('b165', 165), generator('engine', 165)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'engine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('counts a product without temperature as the fluid default', () => {
    const gd = gameData([boiler('plain'), generator('engine', 165)], STEAM_ITEMS(15))
    const all = solveAll([block('A', [node('b', 'plain'), node('t', 'engine')])], gd)
    expect(all.results.A.unsatisfied.some(u => u.itemId === 'steam'), 'the 15° default does not fit').toBe(true)
    expect(mismatches(all.results.A.warnings).map(w => w.supplied)).toEqual([[15]])
  })

  it('stays silent when the supplier has no temperature at all', () => {
    const gd = gameData([boiler('plain'), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'plain'), node('t', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('reports the steam a pinned cold boiler makes for nothing', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165', 10), node('t', 'turbine')])], gd)
    const w = mismatches(all.results.A.warnings)
    expect(w, 'one warning').toHaveLength(1)
    expect(w[0].imported, 'all the turbine steam is imported').toBeCloseTo(60)
    expect(w[0].unused, 'the boiler output is left unused').toBeCloseTo(10)
  })

  it('stays silent when the fluid is imported for a reason other than its temperature', () => {
    // The 465° boiler fits, but it is pinned below what the turbine takes: the rest is imported.
    const gd = gameData([boiler('b465', 465), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b465', 10), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.find(u => u.itemId === 'steam')?.rate, 'steam is imported').toBeCloseTo(50)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('does not count a boiler that discards its steam', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const discarding: GameRecipeNode = { ...node('b', 'b165', 10), byproductPolicy: { steam: 'discard' } }
    const all = solveAll([block('A', [discarding, node('t', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings), 'no producer left to blame').toHaveLength(0)
  })

  it('warns as before, without an import, when the fluid is also a goal', () => {
    // No producer fits the turbine, so a goal fluid gets no temperature rows (it has no import to fall back on): the cold boiler runs.
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const goals: Product[] = [{ id: 'ge', itemId: 'electricity', extraRate: 60 }, { id: 'gs', itemId: 'steam', extraRate: 10 }]
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'turbine')], goals)], gd)
    const w = mismatches(all.results.A.warnings)
    expect(w).toHaveLength(1)
    expect(w[0].imported, 'not imported').toBeUndefined()
    expect(w[0].supplied).toEqual([165])
  })

  it('runs the fitting boiler for a fluid that cannot be imported', () => {
    const gd = gameData([boiler('b165', 165), boiler('b465', 465), generator('turbine', 465)], STEAM_ITEMS())
    const b = block('A', [node('b1', 'b165'), node('b2', 'b465'), node('t', 'turbine')])
    b.sourceRules = { steam: { importOff: true } } as Block['sourceRules']
    const all = solveAll([b], gd)
    const byId = (id: string) => all.results.A.nodes.find(n => n.recipeNodeId === id)!.throughput
    expect(byId('b2'), 'the 465° boiler').toBeCloseTo(60)
    expect(byId('b1'), 'the 165° boiler is not needed').toBeCloseTo(0)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('runs only the boiler inside a bounded range for a fluid that cannot be imported', () => {
    const gd = gameData([boiler('b165', 165), boiler('b315', 315), boiler('b465', 465), generator('turbine', 300, 400)], STEAM_ITEMS())
    const b = block('A', [node('b1', 'b165'), node('b2', 'b315'), node('b3', 'b465'), node('t', 'turbine')])
    b.sourceRules = { steam: { importOff: true } } as Block['sourceRules']
    const all = solveAll([b], gd)
    const byId = (id: string) => all.results.A.nodes.find(n => n.recipeNodeId === id)!.throughput
    expect(byId('b2'), 'the 315° boiler').toBeCloseTo(60)
    expect(byId('b1') + byId('b3'), 'the others').toBeCloseTo(0)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('stays silent when one of two producers fits', () => {
    const gd = gameData([boiler('b165', 165), boiler('b465', 465), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b1', 'b165', 30), node('b2', 'b465', 30), node('t', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('lists every temperature made when none fits', () => {
    const gd = gameData([boiler('b165', 165), boiler('b315', 315), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b1', 'b165', 30), node('b2', 'b315', 30), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.find(u => u.itemId === 'steam')?.rate, 'the turbine\'s steam is imported').toBeCloseTo(60)
    const w = mismatches(all.results.A.warnings)
    expect(w).toHaveLength(1)
    expect(w[0].supplied).toEqual([165, 315])
    expect(w[0].unused, 'both pinned boilers\' steam').toBeCloseTo(60)
  })

  it('judges what a source that imports the fluid offers by its own rows', () => {
    // A runs a pinned 165° boiler next to a turbine that imports its steam; the boiler's steam is offered on.
    const gd = gameData([boiler('b165', 165), generator('turbine', 465), generator('engine', 165)], STEAM_ITEMS())
    const all = solveAll([
      block('A', [node('b', 'b165', 100), node('t', 'turbine')]),
      block('B', [node('t', 'turbine')], [{ id: 'gb', itemId: 'electricity', extraRate: 20 }], [{ id: 'c1', itemId: 'steam', fromBlockId: 'A' }]),
    ], gd)
    expect(all.flows.find(f => f.connectionId === 'c1')!.rate, 'A offers its own steam').toBeGreaterThan(0)
    const w = mismatches(all.results.B.warnings)
    expect(w.map(x => x.supplied), 'B gets 165° steam').toEqual([[165]])
  })

  it('warns on the consumer block of a connection, not on the source', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const steamGoal: Product[] = [{ id: 'gs', itemId: 'steam', extraRate: 60 }]
    const all = solveAll([
      block('A', [node('b', 'b165')], steamGoal),
      block('B', [node('t', 'turbine')], undefined, [{ id: 'c1', itemId: 'steam', fromBlockId: 'A' }]),
    ], gd)
    expect(all.flows.find(f => f.connectionId === 'c1')!.rate, 'steam flows').toBeGreaterThan(0)
    expect(mismatches(all.results.A.warnings), 'source').toHaveLength(0)
    const w = mismatches(all.results.B.warnings)
    expect(w, 'consumer').toHaveLength(1)
    expect(w[0].supplied).toEqual([165])
  })

})

/** A reactor: no ingredients, 1 heat per run at `temperature` (absent: unknown). */
function reactor(id: string, temperature?: number): GameRecipe {
  return recipe(id, [], [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1, ...(temperature === undefined ? {} : { temperature }) }])
}
/** A heat exchanger: 1 heat per run, heat of at least `min`, makes electricity. */
function exchanger(id: string, min: number): GameRecipe {
  return recipe(id, [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1, minimumTemperature: min }], [{ itemId: 'electricity', type: 'item', amount: 1 }])
}

describe('heat', () => {
  it('warns, without changing the plan, when the reactor is cooler than the exchanger needs', () => {
    const gd = gameData([reactor('r750', 750), exchanger('x765', 765)])
    const all = solveAll([block('A', [node('r', 'r750'), node('x', 'x765')])], gd)
    expect(mismatches(all.results.A.warnings)).toEqual([
      expect.objectContaining({ recipeId: 'x765', itemId: HEAT_ITEM_ID, supplied: [750], minimum: 765 }),
    ])
  })

  it('accepts a reactor exactly at the exchanger minimum or above it', () => {
    const gd = gameData([reactor('r765', 765), reactor('r1000', 1000), exchanger('x765', 765)])
    for (const r of ['r765', 'r1000']) {
      const all = solveAll([block('A', [node('r', r), node('x', 'x765')])], gd)
      expect(mismatches(all.results.A.warnings), r).toHaveLength(0)
    }
  })

  it('stays silent when one of several reactors is hot enough', () => {
    const gd = gameData([reactor('r750', 750), reactor('r1000', 1000), exchanger('x765', 765)])
    const all = solveAll([block('A', [node('r1', 'r750', 5), node('r2', 'r1000', 5), node('x', 'x765')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('stays silent when the reactor has no temperature', () => {
    const gd = gameData([reactor('rx'), exchanger('x765', 765)])
    const all = solveAll([block('A', [node('r', 'rx'), node('x', 'x765')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('warns on the exchanger block of a connection, not on the reactor block', () => {
    const gd = gameData([reactor('r750', 750), exchanger('x765', 765)])
    const heatGoal: Product[] = [{ id: 'gh', itemId: HEAT_ITEM_ID, extraRate: 1 }]
    const all = solveAll([
      block('A', [node('r', 'r750')], heatGoal),
      block('B', [node('x', 'x765')], undefined, [{ id: 'c1', itemId: HEAT_ITEM_ID, fromBlockId: 'A' }]),
    ], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
    const w = mismatches(all.results.B.warnings)
    expect(w).toHaveLength(1)
    expect(w[0].supplied).toEqual([750])
  })
})

/**
 * The solver only offers a block's own net output, so a source that both makes a fluid and hands on
 * what it received cannot be built from real blocks; these call `temperatureWarnings` with hand-made results.
 */
describe('temperatureWarnings on connections', () => {
  const gd = gameData([boiler('b165', 165), boiler('b500', 500), generator('turbine', 465)], STEAM_ITEMS())
  const solved = (id: string, outputs: Record<string, number>, inputs: Record<string, number> = {}, unsatisfied: SolverResult['unsatisfied'] = []): SolverResult => ({
    nodes: [{ recipeNodeId: id, inputRates: inputs, outputRates: outputs, throughput: 1, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 }],
    unsatisfied,
    warnings: [],
  })
  const flow = (id: string, from: string, to: string): ConnectionFlow => ({
    connectionId: id, fromBlockId: from, toBlockId: to, itemId: 'steam', available: 40, capped: false, rate: 40, status: 'ok', kind: 'take',
  })
  const blocks = ['A', 'B', 'C'].map(id => block(id, []))
  const recipes = (m: Record<string, string>) => new Map(Object.entries(m).map(([block, r]) => [block, new Map([[block.toLowerCase(), r]])]))

  it('warns when the source makes the fluid only below the bound', () => {
    const results = { A: solved('b', { steam: 40 }), B: solved('b', { steam: 40 }), C: solved('c', { electricity: 1 }, { steam: 40 }) }
    const out = temperatureWarnings(blocks, results, [flow('c1', 'B', 'C')], gd, recipes({ A: 'b500', B: 'b165', C: 'turbine' }))
    expect(out.get('C'), 'warned').toHaveLength(1)
  })

  it('stays silent when the source also receives the fluid over a connection', () => {
    const results = { A: solved('a', { steam: 60 }), B: solved('b', { steam: 100 }), C: solved('c', { electricity: 1 }, { steam: 40 }) }
    const flows = [flow('c1', 'A', 'B'), flow('c2', 'B', 'C')]
    const out = temperatureWarnings(blocks, results, flows, gd, recipes({ A: 'b500', B: 'b165', C: 'turbine' }))
    expect(out.has('C'), 'B may forward A steam at 500°C').toBe(false)
  })

  it('judges a source that also imports the fluid by its own rows', () => {
    // The LP never imports what a block then has left over, so what B offers is its own 165° steam.
    const results = { A: solved('a', {}), B: { ...solved('b', { steam: 100 }), unsatisfied: [{ itemId: 'steam', rate: 20 }] }, C: solved('c', { electricity: 1 }, { steam: 40 }) }
    const out = temperatureWarnings(blocks, results, [flow('c2', 'B', 'C')], gd, recipes({ A: 'b500', B: 'b165', C: 'turbine' }))
    expect(out.get('C')?.map(w => w.supplied), 'B offers its 165° steam').toEqual([[165]])
  })

  it('stays silent when the source has no producer of the fluid', () => {
    const results = { A: solved('a', { widget: 1 }), B: solved('b', { widget: 1 }), C: solved('c', { electricity: 1 }, { steam: 40 }) }
    const out = temperatureWarnings(blocks, results, [flow('c2', 'B', 'C')], gd, recipes({ A: 'b500', B: 'b165', C: 'turbine' }))
    expect(out.has('C'), 'no producer').toBe(false)
  })
})

describe('temperature-mismatch warning (more)', () => {
  it('stays silent when the connection carries nothing', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const steamGoal: Product[] = [{ id: 'gs', itemId: 'steam', extraRate: 60 }]
    const all = solveAll([
      block('A', [node('b', 'b165')], steamGoal),
      block('B', [node('t', 'turbine')], [{ id: 'g', itemId: 'electricity', extraRate: 0 }], [{ id: 'c1', itemId: 'steam', fromBlockId: 'A' }]),
    ], gd)
    expect(mismatches(all.results.B.warnings)).toHaveLength(0)
  })

  it('warns once for duplicate rows of a recipe', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t1', 'turbine'), node('t2', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(1)
  })

  it('stays silent when the consumer bound is on a fluid nobody gives a temperature', () => {
    const heater = recipe('heater', [], [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1 }])
    const consumer = recipe('exchanger', [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1, minimumTemperature: 500 }], [{ itemId: 'electricity', type: 'item', amount: 1 }])
    const gd = gameData([heater, consumer])
    const all = solveAll([block('A', [node('h', 'heater'), node('e', 'exchanger')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('keeps result identity across solves with the same cache', () => {
    const gd = gameData([boiler('b165', 165), boiler('b465', 465), generator('turbine', 465), generator('engine', 165)], STEAM_ITEMS())
    const blocks = [
      block('Bad', [node('b', 'b165'), node('t', 'turbine')]),
      block('Good', [node('b', 'b465'), node('t', 'engine')]),
    ]
    const cache = createSolveCache()
    const first = solveAll(blocks, gd, cache)
    const second = solveAll(blocks, gd, cache)
    expect(mismatches(first.results.Bad.warnings)).toHaveLength(1)
    expect(second.results.Bad, 'warned block keeps identity').toBe(first.results.Bad)
    expect(second.results.Good, 'clean block keeps identity').toBe(first.results.Good)
  })
})

describe('module-not-allowed after temperature-mismatch', () => {
  it('emits the module warning after the temperature one', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    gd.machines.asm = {
      id: 'asm', name: 'Asm', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric', drainKw: 0,
      moduleSlots: 2, allowedEffects: ['productivity'], allowedModuleCategories: ['speed'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
    }
    gd.modules.agri = { id: 'agri', name: 'Agriculture', category: 'angels-bio-yield', tier: 1, effects: { productivity: 0.1 }, limitation: [], limitationBlacklist: [], iconPath: '' }
    const turbine = { ...node('t', 'turbine'), machineId: 'asm', modules: [{ moduleId: 'agri', count: 1 }] }
    const types = solveAll([block('A', [node('b', 'b165'), turbine])], gd).results.A.warnings.map(w => w.type)
    expect(types.filter(t => t === 'temperature-mismatch' || t === 'module-not-allowed')).toEqual(['temperature-mismatch', 'module-not-allowed'])
  })
})

describe('temperature rows of a fluid two areas touch', () => {
  // L runs the boiler, B the turbine; steam is traded by both areas, and the turbine takes steam of 465 or more. The tests of T1 to T3 are the
  // values the model gave before area rules (they pass on that model and must stay); T4 and the rule test are new with it.
  const now = new Date().toISOString()
  type Rules = Record<string, Record<string, AreaSourceRule>>
  function twoAreas(boilerId: string, pin?: number, rules: Rules = {}, blockRules: Block['sourceRules'] = {}): Block {
    const area = (id: string, nodes: RecipeNode[]) => ({
      id, name: id, nodes, subPlans: [], area: true as const, createdAt: now, updatedAt: now,
      ...(rules[id] ? { sourceRules: rules[id] } : {}),
    })
    return {
      id: 'A', name: 'A', color: '#60a5fa',
      products: [{ id: 'g', itemId: 'electricity', extraRate: 60 }],
      sourceRules: blockRules, inputConnections: [],
      rootPlan: { id: 'root-A', name: 'root-A', nodes: [], createdAt: now, updatedAt: now,
        subPlans: [area('L', [node('b', boilerId, pin)]), area('B', [node('t', 'turbine')])] },
    }
  }
  const data = () => gameData([boiler('b165', 165), boiler('b465', 465), generator('turbine', 465)], STEAM_ITEMS())
  const steam = (r: SolverResult) => r.unsatisfied.find(u => u.itemId === 'steam')?.rate ?? 0
  const rate = (r: SolverResult, id: string) => r.nodes.find(n => n.recipeNodeId === id)!.throughput
  const legs = (r: SolverResult) => (r.areaRoutes ?? []).filter(l => l.itemId === 'steam')

  it('T1, no rule: the cold boiler is not run, the turbine imports its steam and the warning says why', () => {
    const r = solveAll([twoAreas('b165')], data()).results.A
    expect(steam(r)).toBeCloseTo(60, 6)
    expect(rate(r, 'b')).toBeCloseTo(0, 6)
    expect(rate(r, 't')).toBeCloseTo(60, 6)
    expect(legs(r)).toEqual([{ itemId: 'steam', to: 'B', rate: expect.closeTo(60, 6) }])
    expect(mismatches(r.warnings)).toHaveLength(1)
    expect(mismatches(r.warnings)[0].imported).toBeCloseTo(60, 6)
  })

  it('T2, Import off on the block (the fluid is locked): the cold boiler runs and the warning has no import', () => {
    const r = solveAll([twoAreas('b165', undefined, {}, { steam: { importOff: true } })], data()).results.A
    expect(rate(r, 'b')).toBeCloseTo(60, 6)
    expect(rate(r, 't')).toBeCloseTo(60, 6)
    expect(steam(r)).toBeCloseTo(0, 6)
    expect(legs(r)).toEqual([{ itemId: 'steam', from: 'L', to: 'B', rate: expect.closeTo(60, 6) }])
    const w = mismatches(r.warnings)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ recipeId: 'turbine', supplied: [165], minimum: 465 })
    expect(w[0].imported).toBeUndefined()
  })

  it('T3, a fitting boiler pinned at 10: the rest of the turbine steam is imported, with no warning', () => {
    const r = solveAll([twoAreas('b465', 10)], data()).results.A
    expect(steam(r)).toBeCloseTo(50, 6)
    expect(legs(r)).toEqual([
      { itemId: 'steam', from: 'L', to: 'B', rate: expect.closeTo(10, 6) },
      { itemId: 'steam', to: 'B', rate: expect.closeTo(50, 6) },
    ])
    expect(mismatches(r.warnings)).toHaveLength(0)
  })

  it('T4, a connection offers 30: the 60 of the outside leg name 30 as connected supply', () => {
    const { result, received } = solveBlock(flattenBlock(twoAreas('b165')), data(), new Map([['steam', 30]]))
    expect(received.get('steam')).toBeCloseTo(30, 6)
    expect(steam(result)).toBeCloseTo(30, 6)
    const leg = legs(result).find(l => l.from === undefined && l.to === 'B')!
    expect(leg.rate).toBeCloseTo(60, 6)
    expect(leg.supplied, 'the connected part').toBeCloseTo(30, 6)
  })

  it('a rule on each area reads like the block-wide Import off', () => {
    const wide = solveAll([twoAreas('b165', undefined, {}, { steam: { importOff: true } })], data()).results
    const perArea = solveAll([twoAreas('b165', undefined, { L: { steam: { importOff: true, makeHere: 'after-blocks' } }, B: { steam: { importOff: true } } })], data()).results
    expect(perArea).toEqual(wide)
  })
})
