import { describe, it, expect } from 'vitest'
import { solveAll } from './index'
import { createSolveCache } from './solveCache'
import type { Block, GameData, GameRecipeNode, Product, RecipeNode, SolverWarning } from '../data/types'

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
  it('warns when the only boiler is below the generator minimum', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'turbine')])], gd)
    const w = mismatches(all.results.A.warnings)
    expect(w, 'one warning').toHaveLength(1)
    expect(w[0].supplied, 'supplied').toEqual([165])
    expect(w[0].minimum, 'minimum').toBe(465)
    expect(w[0].maximum, 'no maximum').toBeUndefined()
    expect(w[0].recipeId).toBe('turbine')
    expect(w[0].itemId).toBe('steam')
  })

  it('stays silent when the boiler fits', () => {
    const gd = gameData([boiler('b165', 165), generator('engine', 165)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b', 'b165'), node('t', 'engine')])], gd)
    expect(mismatches(all.results.A.warnings)).toHaveLength(0)
  })

  it('counts a product without temperature as the fluid default', () => {
    const gd = gameData([boiler('plain'), generator('engine', 165)], STEAM_ITEMS(15))
    const all = solveAll([block('A', [node('b', 'plain'), node('t', 'engine')])], gd)
    const w = mismatches(all.results.A.warnings)
    expect(w).toHaveLength(1)
    expect(w[0].supplied).toEqual([15])
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

  it('lists every supplied temperature when none fits', () => {
    const gd = gameData([boiler('b165', 165), boiler('b315', 315), generator('turbine', 465)], STEAM_ITEMS())
    const all = solveAll([block('A', [node('b1', 'b165', 30), node('b2', 'b315', 30), node('t', 'turbine')])], gd)
    const w = mismatches(all.results.A.warnings)
    expect(w).toHaveLength(1)
    expect(w[0].supplied).toEqual([165, 315])
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

  it('stays silent when the consumer bound is on a fluid nobody gives a temperature (heat)', () => {
    const heater = recipe('heater', [], [{ itemId: 'heat', type: 'fluid', amount: 1 }])
    const exchanger = recipe('exchanger', [{ itemId: 'heat', type: 'fluid', amount: 1, minimumTemperature: 500 }], [{ itemId: 'electricity', type: 'item', amount: 1 }])
    const gd = gameData([heater, exchanger])
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
