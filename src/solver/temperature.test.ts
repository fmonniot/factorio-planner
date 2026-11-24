import { describe, it, expect } from 'vitest'
import { solveAll, solveBlock, flattenBlock, netBalance } from './index'
import { HEAT_ITEM_ID } from '../data/electricity'
import type { AreaSourceRule, Block, GameData, GameRecipeNode, Product, RecipeNode, SolverResult } from '../data/types'

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

/** A reactor: no ingredients, 1 heat per run at `temperature` (absent: unknown). */
function reactor(id: string, temperature?: number): GameRecipe {
  return recipe(id, [], [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1, ...(temperature === undefined ? {} : { temperature }) }])
}
/** A heat exchanger: 1 heat per run, heat of at least `min`, makes electricity. */
function exchanger(id: string, min: number): GameRecipe {
  return recipe(id, [{ itemId: HEAT_ITEM_ID, type: 'fluid', amount: 1, minimumTemperature: min }], [{ itemId: 'electricity', type: 'item', amount: 1 }])
}

describe('heat temperature in the LP', () => {
  const rate = (r: SolverResult, id: string) => r.nodes.find(n => n.recipeNodeId === id)!.throughput
  const heatUnsat = (r: SolverResult) => r.unsatisfied.filter(u => u.itemId === HEAT_ITEM_ID)
  const heatConv = (r: SolverResult) => (r.conversions ?? []).filter(c => c.itemId === HEAT_ITEM_ID)
  const solve = (nodes: RecipeNode[], gd: GameData, products?: Product[], sourceRules: Block['sourceRules'] = {}) => {
    const b = block('A', nodes, products)
    b.sourceRules = sourceRules
    return solveAll([b], gd).results.A
  }

  it('does not run a reactor cooler than the exchanger minimum: the block imports heat at the range', () => {
    const r = solve([node('r', 'r750'), node('x', 'x765')], gameData([reactor('r750', 750), exchanger('x765', 765)]))
    expect(rate(r, 'r')).toBeCloseTo(0, 6)
    expect(rate(r, 'x')).toBeCloseTo(60, 6)
    expect(heatUnsat(r)).toEqual([{ itemId: HEAT_ITEM_ID, rate: expect.closeTo(60, 6), temp: { min: 765 } }])
    expect(r.warnings).toEqual([])
  })

  it('runs a reactor exactly at the minimum or above it', () => {
    const gd = gameData([reactor('r765', 765), reactor('r1000', 1000), exchanger('x765', 765)])
    for (const [id, t] of [['r765', 765], ['r1000', 1000]] as const) {
      const r = solve([node('r', id), node('x', 'x765')], gd)
      expect(rate(r, 'r'), id).toBeCloseTo(60, 6)
      expect(heatUnsat(r), id).toEqual([])
      expect(heatConv(r), id).toEqual([{ itemId: HEAT_ITEM_ID, from: { at: t }, to: { min: 765 }, rate: expect.closeTo(60, 6) }])
      expect(r.warnings, id).toEqual([])
    }
  })

  it('runs the hot reactor and leaves the cold one idle', () => {
    const r = solve([node('r1', 'r750'), node('r2', 'r1000'), node('x', 'x765')], gameData([reactor('r750', 750), reactor('r1000', 1000), exchanger('x765', 765)]))
    expect(rate(r, 'r2')).toBeCloseTo(60, 6)
    expect(rate(r, 'r1')).toBeCloseTo(0, 6)
  })

  it('keeps a pinned cold reactor, its heat left over at its own temperature', () => {
    const r = solve([node('r1', 'r750', 5), node('r2', 'r1000'), node('x', 'x765')], gameData([reactor('r750', 750), reactor('r1000', 1000), exchanger('x765', 765)]))
    expect(rate(r, 'r1')).toBeCloseTo(5, 6)
    expect(rate(r, 'r2')).toBeCloseTo(60, 6)
    expect(netBalance(r.nodes, r.conversions).get('power:heat@750')).toBeCloseTo(5, 6)
  })

  it('an unknown heat temperature fits every range', () => {
    const r = solve([node('r', 'rx'), node('x', 'x765')], gameData([reactor('rx'), exchanger('x765', 765)]))
    expect(rate(r, 'r')).toBeCloseTo(60, 6)
    expect(heatUnsat(r)).toEqual([])
    expect(heatConv(r)).toEqual([{ itemId: HEAT_ITEM_ID, from: { at: null }, to: { min: 765 }, rate: expect.closeTo(60, 6) }])
  })

  it('keeps ranges apart: a 750 reactor feeds the 315 exchanger only', () => {
    const gd = gameData([reactor('r750', 750), exchanger('x315', 315), exchanger('x765', 765)])
    gd.recipes.x315.products = [{ itemId: 'e1', type: 'item', amount: 1 }]
    gd.recipes.x765.products = [{ itemId: 'e2', type: 'item', amount: 1 }]
    const r = solve([node('r', 'r750'), node('a', 'x315'), node('b', 'x765')], gd, [
      { id: 'g1', itemId: 'e1', extraRate: 60 }, { id: 'g2', itemId: 'e2', extraRate: 60 },
    ])
    expect(rate(r, 'r')).toBeCloseTo(60, 6)
    expect(heatUnsat(r)).toEqual([{ itemId: HEAT_ITEM_ID, rate: expect.closeTo(60, 6), temp: { min: 765 } }])
  })

  it('with Import off the exchanger falls short and warns no-fitting-temperature', () => {
    const r = solve([node('r', 'r750'), node('x', 'x765')], gameData([reactor('r750', 750), exchanger('x765', 765)]), undefined, { [HEAT_ITEM_ID]: { importOff: true } })
    expect(rate(r, 'x')).toBeCloseTo(0, 6)
    expect(r.warnings).toContainEqual({ type: 'no-fitting-temperature', itemId: HEAT_ITEM_ID, min: 765, recipeIds: ['x765'] })
    expect(r.unsatisfied).toContainEqual({ itemId: 'electricity', rate: expect.closeTo(60, 6) })
  })

  describe('over a connection', () => {
    const run = (exchangerId: string) => {
      // A makes a widget as its goal, and its pinned reactor's heat is the surplus on offer.
      const gd = gameData([reactor('r750', 750), exchanger('x765', 765), exchanger('x465', 465), recipe('w', [], [{ itemId: 'widget', type: 'item', amount: 1 }])])
      return solveAll([
        block('A', [node('r', 'r750', 60), node('w', 'w')], [{ id: 'gw', itemId: 'widget', extraRate: 1 }]),
        block('B', [node('x', exchangerId)], undefined, [{ id: 'c1', itemId: HEAT_ITEM_ID, fromBlockId: 'A' }]),
      ], gd)
    }

    it('warns connection-temperature and imports when the offered heat is too cold', () => {
      const all = run('x765')
      expect(all.results.B.warnings).toEqual([{
        type: 'connection-temperature',
        connections: [{ connectionId: 'c1', itemId: HEAT_ITEM_ID, offered: [{ temperature: 750, rate: expect.closeTo(60, 6) }], needed: [{ min: 765, rate: expect.closeTo(60, 6) }] }],
      }])
      expect(heatUnsat(all.results.B)).toEqual([{ itemId: HEAT_ITEM_ID, rate: expect.closeTo(60, 6), temp: { min: 765 } }])
      expect(all.flows.find(f => f.connectionId === 'c1')?.status).toBe('unused')
    })

    it('uses the offered heat when it is hot enough', () => {
      const all = run('x465')
      expect(all.flows.find(f => f.connectionId === 'c1')?.rate).toBeCloseTo(60, 6)
      expect(heatUnsat(all.results.B)).toEqual([])
      expect(all.results.B.warnings).toEqual([])
    })
  })

  describe('between areas', () => {
    const now = new Date().toISOString()
    const twoAreas = (reactorId: string): Block => {
      const area = (id: string, nodes: RecipeNode[]) => ({ id, name: id, nodes, subPlans: [], area: true as const, createdAt: now, updatedAt: now })
      return {
        id: 'A', name: 'A', color: '#60a5fa', products: [{ id: 'g', itemId: 'electricity', extraRate: 60 }], sourceRules: {}, inputConnections: [],
        rootPlan: { id: 'root-A', name: 'root-A', nodes: [], createdAt: now, updatedAt: now, subPlans: [area('L', [node('r', reactorId)]), area('B', [node('x', 'x765')])] },
      }
    }
    const gd = () => gameData([reactor('r750', 750), reactor('r1000', 1000), exchanger('x765', 765)])

    it('a hot enough reactor in another area feeds the exchanger without an import', () => {
      const r = solveAll([twoAreas('r1000')], gd()).results.A
      expect(heatUnsat(r)).toEqual([])
      expect(rate(r, 'r')).toBeCloseTo(60, 6)
    })

    it('a too cold one is idle and the leg into the exchanger area is a range import', () => {
      const r = solveAll([twoAreas('r750')], gd()).results.A
      expect(rate(r, 'r')).toBeCloseTo(0, 6)
      expect((r.areaRoutes ?? []).filter(l => l.itemId === HEAT_ITEM_ID && l.from === undefined)).toEqual([
        expect.objectContaining({ to: 'B', temp: { min: 765 } }),
      ])
    })
  })
})

describe('steam temperature in the LP', () => {
  it('a block with cold steam imports the hot range, never warning mismatch', () => {
    const gd = gameData([boiler('b165', 165), generator('turbine', 465)], STEAM_ITEMS())
    const r = solveAll([block('A', [node('b', 'b165'), node('t', 'turbine')])], gd).results.A
    expect(r.warnings).toEqual([])
  })
})

describe('flow keys of a fluid two areas touch', () => {
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

  it('T1, no rule: the cold boiler is not run, the turbine imports its steam at 465 or more', () => {
    const r = solveAll([twoAreas('b165')], data()).results.A
    expect(steam(r)).toBeCloseTo(60, 6)
    expect(r.unsatisfied.find(u => u.itemId === 'steam')?.temp).toEqual({ min: 465 })
    expect(rate(r, 'b')).toBeCloseTo(0, 6)
    expect(rate(r, 't')).toBeCloseTo(60, 6)
    expect(legs(r)).toEqual([{ itemId: 'steam', temp: { min: 465 }, to: 'B', rate: expect.closeTo(60, 6) }])
    expect(r.warnings).toEqual([])
  })

  it('T2, Import off on the block (the fluid is locked): nothing fits the turbine, so it falls short with no-fitting-temperature', () => {
    const r = solveAll([twoAreas('b165', undefined, {}, { steam: { importOff: true } })], data()).results.A
    expect(rate(r, 'b')).toBeCloseTo(0, 6)
    expect(rate(r, 't')).toBeCloseTo(0, 6)
    expect(steam(r)).toBeCloseTo(0, 6)
    expect(r.unsatisfied).toEqual([{ itemId: 'electricity', rate: expect.closeTo(60, 6) }])
    expect(r.warnings.filter(w => w.type === 'no-fitting-temperature')).toEqual([
      { type: 'no-fitting-temperature', itemId: 'steam', min: 465, recipeIds: ['turbine'] },
    ])
    expect(legs(r)).toEqual([])
  })

  it('T3, a fitting boiler pinned at 10: the rest of the turbine steam is imported, with no warning', () => {
    const r = solveAll([twoAreas('b465', 10)], data()).results.A
    expect(steam(r)).toBeCloseTo(50, 6)
    expect(legs(r)).toEqual([
      { itemId: 'steam', temp: { at: 465 }, from: 'L', to: 'B', rate: expect.closeTo(10, 6) },
      { itemId: 'steam', temp: { min: 465 }, to: 'B', rate: expect.closeTo(50, 6) },
    ])
    expect(r.warnings).toHaveLength(0)
  })

  it('T4, a connection offers 30: the 60 of the outside leg name 30 as connected supply', () => {
    const { result, received } = solveBlock(flattenBlock(twoAreas('b165')), data(), new Map([['steam', 30]]))
    expect(received.get('steam')).toBeCloseTo(30, 6)
    expect(steam(result)).toBeCloseTo(30, 6)
    const leg = legs(result).find(l => l.from === undefined && l.to === 'B')!
    expect(leg.rate).toBeCloseTo(60, 6)
    expect(leg.supplied, 'the connected part').toBeCloseTo(30, 6)
  })

  it('T5, a connection offers 30 at 500 by key: it enters the area that takes the range, the rest is imported', () => {
    const keySupply = new Map([['steam', { ranges: [{ min: 465 }], offers: [{ connectionId: 'c', tag: { at: 500 }, offer: 30 }], maxRates: [] as [string, number][] }]])
    const { result, received, receivedParts, receivedKeys } = solveBlock(flattenBlock(twoAreas('b165')), data(), new Map(), keySupply)
    expect(received.get('steam')).toBeCloseTo(30, 6)
    expect(receivedKeys.get('steam@500')).toBeCloseTo(30, 6)
    expect(receivedParts?.get('c')?.get('steam@500')).toBeCloseTo(30, 6)
    expect(steam(result)).toBeCloseTo(30, 6)
    expect(result.conversions).toEqual([{ itemId: 'steam', from: { at: 500 }, to: { min: 465 }, rate: expect.closeTo(30, 6), areaId: 'B', supplied: true }])
  })

  it('a rule on each area reads like the block-wide Import off', () => {
    const wide = solveAll([twoAreas('b165', undefined, {}, { steam: { importOff: true } })], data()).results
    const perArea = solveAll([twoAreas('b165', undefined, { L: { steam: { importOff: true, makeHere: 'after-blocks' } }, B: { steam: { importOff: true } } })], data()).results
    expect(perArea).toEqual(wide)
  })
})

describe('a request for a range an area row also takes', () => {
  // The area has a boiler (steam at 165) and a generator that takes steam of at most 200. A request for steam of at most 200 is on the same
  // range as the generator's key in that area; the request's conversion must not be taken for the generator's one.
  const now = new Date().toISOString()
  const data = () => gameData([boiler('b165', 165), generator('gen', undefined, 200)], STEAM_ITEMS())
  const inArea = (areaNodes: RecipeNode[]): Block => ({
    id: 'A', name: 'A', color: '#60a5fa', products: [], sourceRules: {}, inputConnections: [],
    rootPlan: { id: 'root-A', name: 'root-A', nodes: [], createdAt: now, updatedAt: now,
      subPlans: [{ id: 'L', name: 'L', nodes: areaNodes, subPlans: [], area: true as const, createdAt: now, updatedAt: now }] },
  })

  it('delivers the range from the area that makes it, without a no-recipe warning', () => {
    const plan = flattenBlock(inArea([node('b', 'b165'), node('g', 'gen')]))
    plan.goals = [{ id: 'req', itemId: 'steam', rate: 10, temp: { max: 200 } }]
    const { result } = solveBlock(plan, data())
    expect(result.warnings.filter(w => w.type === 'no-recipe')).toEqual([])
    expect(result.nodes.find(n => n.recipeNodeId === 'b')!.throughput).toBeCloseTo(10, 6)
    expect(result.unsatisfied).toEqual([])
  })
})
