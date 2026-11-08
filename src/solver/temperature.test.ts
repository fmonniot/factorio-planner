import { describe, it, expect } from 'vitest'
import { solveAll } from './index'
import { HEAT_ITEM_ID } from '../data/electricity'
import { temperatureWarnings } from './temperature'
import { createSolveCache } from './solveCache'
import type { Block, ConnectionFlow, GameData, GameRecipeNode, Product, RecipeNode, SolverResult, SolverWarning } from '../data/types'

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
    id, name: id, color: '#60a5fa', products, noImportItems: [], itemSourcing: {}, inputConnections: connections,
    rootPlan: { id: `root-${id}`, name: `root-${id}`, nodes, subPlans: [], createdAt: now, updatedAt: now },
  }
}

function mismatches(warnings: SolverWarning[]) {
  return warnings.filter((w): w is Extract<SolverWarning, { type: 'temperature-mismatch' }> => w.type === 'temperature-mismatch')
}

describe('temperature-mismatch warning', () => {
  it('imports the fluid when the only boiler is below the generator minimum', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.some(u => u.itemId === 'steam'), 'steam is imported').toBe(true)
    expect(all.results.A.nodes[0].throughput, 'the cold boiler is not run').toBe(0)
    expect(mismatches(all.results.A.warnings), 'the LP already avoided it').toHaveLength(0)
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
  })

  it('stays silent when the supplier has no temperature at all', () => {
    const gd = gameData([boiler('plain'), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'plain'), node('t', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('stays silent when the fluid is still imported', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    // The boiler is pinned well below what the turbine needs: the rest of the steam is imported.
    const all = solveAll([block('A', [node('b', 'b165', 10), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.some(u => u.itemId === 'steam'), 'steam is imported').toBe(true)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('stays silent when one of two producers fits', () => {
    const gd = gameData([boiler('b165', 165), boiler('b465', 465), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b1', 'b165', 30), node('b2', 'b465', 30), node('t', 'turbine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('imports the fluid even when pinned boilers make it at no fitting temperature', () => {
    const gd = gameData([boiler('b165', 165), boiler('b315', 315), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b1', 'b165', 30), node('b2', 'b315', 30), node('t', 'turbine')])], gd)
    expect(all.results.A.unsatisfied.find(u => u.itemId === 'steam')?.rate, 'the turbine\'s steam is imported').toBeCloseTo(60)
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

  it('stays silent when the source also imports the fluid', () => {
    const results = { A: solved('a', {}), B: { ...solved('b', { steam: 100 }), unsatisfied: [{ itemId: 'steam', rate: 20 }] }, C: solved('c', { electricity: 1 }, { steam: 40 }) }
    const out = temperatureWarnings(blocks, results, [flow('c2', 'B', 'C')], gd, recipes({ A: 'b500', B: 'b165', C: 'turbine' }))
    expect(out.has('C'), 'imported steam has an unknown temperature').toBe(false)
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
    const steamGoal: Product[] = [{ id: 'gs', itemId: 'steam', extraRate: 60 }]
    const all = solveAll([
      block('A', [node('b', 'b165')], steamGoal),
      block('B', [node('t1', 'turbine'), node('t2', 'turbine')], undefined, [{ id: 'c1', itemId: 'steam', fromBlockId: 'A' }]),
    ], gd)
    expect(mismatches(all.results.B.warnings)).toHaveLength(1)
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
    const steamGoal: Product[] = [{ id: 'gs', itemId: 'steam', extraRate: 60 }]
    const blocks = [
      block('Src', [node('b', 'b165')], steamGoal),
      block('Bad', [node('t', 'turbine')], undefined, [{ id: 'c1', itemId: 'steam', fromBlockId: 'Src' }]),
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
