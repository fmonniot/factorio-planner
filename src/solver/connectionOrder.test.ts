import { describe, it, expect, vi } from 'vitest'
import solver from 'javascript-lp-solver'
import { solveAll, solveBlock } from './index'
import { boundOf, boundedStep, improvesImport, improvesLeftover, needsConnectionOrder } from './connectionOrder'
import type { ConnectionOrderInput } from './connectionOrder'
import type { Block, GameData, GameRecipeNode, RecipeNode, SolverGoal, SolverResult, SourceRule } from '../data/types'

// The rules the order of connectionOrder.ts must keep (sourcing priority phase 6, T1's points 6 to 8).
// Every block here is touched: its two passes end with an import of an intermediate while a connection has
// offer to spare. Fixture A of case 22 unless said otherwise: G turns 2 plates into a gear (product 25), P turns
// 1 ingot into 2 plates, S turns 1 ore into 1 ingot and is pinned at 10. Each value is derived in its comment.

type GameRecipe = GameData['recipes'][string]
type Part = GameRecipe['ingredients'][number] & GameRecipe['products'][number]

const item = (itemId: string, amount: number): Part => ({ itemId, type: 'item', amount })
const steam = (amount: number, extra: Partial<Part> = {}): Part => ({ itemId: 'steam', type: 'fluid', amount, ...extra })

function recipe(id: string, ingredients: GameRecipe['ingredients'], products: GameRecipe['products']): GameRecipe {
  return {
    id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [],
    allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  }
}

function gameData(): GameData {
  const recipes = [
    recipe('gear', [item('plate', 2)], [item('gear', 1)]),
    recipe('p12', [item('ingot', 1)], [item('plate', 2)]),
    recipe('p11', [item('ingot', 1)], [item('plate', 1)]),
    recipe('ingot', [item('ore', 1)], [item('ingot', 1)]),
    recipe('burn', [item('plate', 1)], [item('ash', 1)]),
    recipe('make-rod', [item('ore2', 1)], [item('rod', 1)]),
    recipe('widget', [item('rod', 1)], [item('widget', 1)]),
    recipe('hot', [item('ingot', 1)], [steam(2, { temperature: 500 })]),
    recipe('cold', [item('water', 1)], [steam(10, { temperature: 200 })]),
    recipe('turbine', [steam(2, { minimumTemperature: 400 })], [item('power', 1)]),
    recipe('mine-plate', [item('ore', 1)], [item('plate', 1)]),
    recipe('make-coin', [item('ore', 1)], [item('coin', 1)]),
    recipe('use-x', [item('x', 2)], [item('goal', 1), item('w', 10000)]),
    recipe('recycle', [item('w', 10000)], [item('x', 1)]),
    recipe('make-q', [item('ore3', 200)], [item('q', 1)]),
    recipe('use-q', [item('q', 1)], [item('qgoal', 1)]),
    recipe('use-coin', [item('coin', 1)], [item('token', 1)]),
  ]
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: { steam: { id: 'steam', name: 'Steam' } as GameData['items'][string] },
    recipes: Object.fromEntries(recipes.map(r => [r.id, r])),
    machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  }
}

const row = (id: string, recipeId = id, extra: Partial<GameRecipeNode> = {}): GameRecipeNode =>
  ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...extra })

function plan(opts: { p?: 'p12' | 'p11'; extra?: RecipeNode[]; goals?: SolverGoal[]; rules?: Record<string, SourceRule> } = {}) {
  return {
    goals: opts.goals ?? [{ id: 'g', itemId: 'gear', rate: 25 }],
    nodes: [row('G', 'gear'), row('P', opts.p ?? 'p12'), row('S', 'ingot', { pinnedRate: 10 }), ...(opts.extra ?? [])],
    sourceRules: opts.rules ?? {},
  }
}

const runs = (r: SolverResult, id: string) => r.nodes.find(n => n.recipeNodeId === id)!.throughput
const unsat = (r: SolverResult, itemId: string) => r.unsatisfied.find(u => u.itemId === itemId)?.rate ?? 0
const got = (received: Map<string, number>, itemId: string) => received.get(itemId) ?? 0

describe('connectionOrder: the rules it keeps', () => {
  it('never feeds a byproduct consumer from the supply, with an offer and with an unlimited one', () => {
    // burn (1 plate makes 1 ash) is a byproduct consumer: plate is its ingredient. The 10 ingots make 20 plates,
    // the connection gives the other 30; burn gets no plate, and the unlimited offer stays bounded.
    for (const offer of [100, Infinity]) {
      const { result, received } = solveBlock(plan({ extra: [row('B', 'burn', { byproductConsumer: true })] }), gameData(), new Map([['plate', offer]]))
      expect(got(received, 'plate'), `plate received, offer ${offer}`).toBeCloseTo(30, 6)
      expect(runs(result, 'B'), `burn, offer ${offer}`).toBeCloseTo(0, 6)
      expect(runs(result, 'P'), `P, offer ${offer}`).toBeCloseTo(10, 6)
      expect(unsat(result, 'ingot'), `ingot imported, offer ${offer}`).toBeCloseTo(0, 6)
    }
  })

  it('keeps Receive it first: its supply is used whole, the default connection covers the rest', () => {
    // Ingot on Receive it first, offer 4: 10 + 4 ingots make 28 plates; the plate connection gives 22. Today the
    // block imports 11 ingots and leaves the plate connection idle.
    const { result, received } = solveBlock(plan({ rules: { ingot: { makeHere: 'after-blocks' } } }), gameData(), new Map([['ingot', 4], ['plate', 100]]))
    expect(got(received, 'ingot'), 'ingot received').toBeCloseTo(4, 6)
    expect(got(received, 'plate'), 'plate received').toBeCloseTo(22, 6)
    expect(runs(result, 'P'), 'P').toBeCloseTo(14, 6)
    expect(unsat(result, 'ingot') + unsat(result, 'plate'), 'nothing imported').toBeCloseTo(0, 6)
  })

  it("keeps Don't make more here on another connected item of a touched block", () => {
    // Rod on Don't make more here, 5 widgets: make-rod does not run for it; the rod connection (3) delivers, 2 are
    // imported. The plate side is case 22 A, row b.
    const p = plan({
      goals: [{ id: 'g', itemId: 'gear', rate: 25 }, { id: 'w', itemId: 'widget', rate: 5 }],
      extra: [row('W', 'widget'), row('R', 'make-rod')],
      rules: { rod: { makeHere: 'off' } },
    })
    const { result, received } = solveBlock(p, gameData(), new Map([['plate', 100], ['rod', 3]]))
    expect(got(received, 'plate'), 'plate received').toBeCloseTo(30, 6)
    expect(got(received, 'rod'), 'rod received').toBeCloseTo(3, 6)
    expect(unsat(result, 'rod'), 'rod imported').toBeCloseTo(2, 6)
    expect(runs(result, 'R'), 'make-rod').toBeCloseTo(0, 6)
    expect(unsat(result, 'ingot'), 'ingot imported').toBeCloseTo(0, 6)
  })

  it("leaves a block whose only import is a Don't make more here item as it is, Import on and off", () => {
    // Ingot on Don't make more here: its import is the rule's own (a cheap slack), not an import the order counts,
    // so the block is not touched: 15 ingots imported (or missing with Import off), the plate connection idle.
    for (const importOff of [false, true]) {
      const rule: SourceRule = importOff ? { makeHere: 'off', importOff: true } : { makeHere: 'off' }
      const { result, received } = solveBlock(plan({ rules: { ingot: rule } }), gameData(), new Map([['plate', 100]]))
      expect(got(received, 'plate'), `plate received, Import off ${importOff}`).toBeCloseTo(0, 6)
      expect(unsat(result, 'ingot'), `ingot imported or missing, Import off ${importOff}`).toBeCloseTo(15, 6)
      expect(runs(result, 'P'), `P, Import off ${importOff}`).toBeCloseTo(25, 6)
    }
  })

  it('keeps a lock on the connected item (Import off on plate, offer 12: case 22 A, row d)', () => {
    // 12 plates received, the other 38 need 19 runs and 19 ingots, 9 imported; plate is not imported.
    const { result, received } = solveBlock(plan({ rules: { plate: { importOff: true } } }), gameData(), new Map([['plate', 12]]))
    expect(got(received, 'plate'), 'plate received').toBeCloseTo(12, 6)
    expect(runs(result, 'P'), 'P').toBeCloseTo(19, 6)
    expect(unsat(result, 'ingot'), 'ingot imported').toBeCloseTo(9, 6)
    expect(unsat(result, 'plate'), 'plate not imported').toBeCloseTo(0, 6)
  })

  it('keeps a lock on the connected upstream item (Import off on ingot, 1 makes 1: case 22 A, row g)', () => {
    const { result, received } = solveBlock(plan({ p: 'p11', rules: { ingot: { importOff: true } } }), gameData(), new Map([['ingot', 100]]))
    expect(got(received, 'ingot'), 'ingot received').toBeCloseTo(40, 6)
    expect(runs(result, 'P'), 'P').toBeCloseTo(50, 6)
    expect(unsat(result, 'ingot') + unsat(result, 'plate'), 'nothing imported').toBeCloseTo(0, 6)
  })

  it('a cold boiler does not replace the connection (keys)', () => {
    // 25 power need 50 steam at 400 or more. hot (1 ingot makes 2 steam at 500) makes 20 from the 10 ingots; cold
    // (1 water makes 10 steam at 200) fits no range of the turbine, so the connection gives 30 (the supply of the `steam[400,]` key).
    const p = plan({ goals: [{ id: 'g', itemId: 'power', rate: 25 }] })
    const nodes = [row('T', 'turbine'), row('H', 'hot'), row('C', 'cold'), row('S', 'ingot', { pinnedRate: 10 })]
    const { result, received } = solveBlock({ ...p, nodes }, gameData(), new Map([['steam', 100]]))
    expect(got(received, 'steam'), 'steam received').toBeCloseTo(30, 6)
    expect(runs(result, 'H'), 'hot').toBeCloseTo(10, 6)
    expect(runs(result, 'C'), 'cold').toBeCloseTo(0, 6)
    expect(unsat(result, 'ingot') + unsat(result, 'steam'), 'nothing imported').toBeCloseTo(0, 6)
  })
})

describe('connectionOrder: ties', () => {
  type Tie = { name: string; p: 'p12' | 'p11'; offers: Array<[string, number]>; plate: number; ingot: number; P: number; plateUnsat: number }
  const ties: Tie[] = [
    // 1 makes 1, 30 and 30: no import with 40 received either way; the runs decide, plate first (P 20 against 40).
    { name: 'equal units: 1 makes 1, plate (30) and ingot (30)', p: 'p11', offers: [['plate', 30], ['ingot', 30]], plate: 30, ingot: 10, P: 20, plateUnsat: 0 },
    // 1 makes 2, 12 and 12: 50 = 2·(10 + ingot) + plate, so plate = 30 − 2·ingot; the total 30 − ingot is least at ingot 12.
    { name: 'a short offer on two connections: 1 makes 2, plate (12) and ingot (12)', p: 'p12', offers: [['plate', 12], ['ingot', 12]], plate: 6, ingot: 12, P: 22, plateUnsat: 0 },
    // 1 makes 1, 12 and 12: both used, 16 short; importing plate saves the runs.
    { name: 'both short: 1 makes 1, plate (12) and ingot (12)', p: 'p11', offers: [['plate', 12], ['ingot', 12]], plate: 12, ingot: 12, P: 22, plateUnsat: 16 },
  ]
  for (const t of ties) {
    it(`${t.name}, the same solved twice and with the offers in the other order`, () => {
      const solves = [t.offers, t.offers, [...t.offers].reverse()].map(o => solveBlock(plan({ p: t.p }), gameData(), new Map(o)))
      for (const [i, { result, received }] of solves.entries()) {
        expect(got(received, 'plate'), `plate received, solve ${i}`).toBeCloseTo(t.plate, 6)
        expect(got(received, 'ingot'), `ingot received, solve ${i}`).toBeCloseTo(t.ingot, 6)
        expect(runs(result, 'P'), `P, solve ${i}`).toBeCloseTo(t.P, 6)
        expect(unsat(result, 'plate'), `plate imported, solve ${i}`).toBeCloseTo(t.plateUnsat, 6)
        expect(unsat(result, 'ingot'), `ingot imported, solve ${i}`).toBeCloseTo(0, 6)
      }
      expect(solves[1].result, 'solved twice').toEqual(solves[0].result)
    })
  }
})

describe('connectionOrder: a touched block in a cycle of requests', () => {
  // H (fixture A) requests plate from S; S requests a coin from H. H's need is 30 (case 22 A, row f), S's is 1.
  const now = new Date().toISOString()
  const block = (id: string, products: Array<[string, number]>, nodes: RecipeNode[], links: Block['inputConnections']): Block => ({
    id, name: id, color: '#60a5fa',
    products: products.map(([itemId, extraRate], i) => ({ id: `p-${id}-${i}`, itemId, extraRate })),
    sourceRules: {}, inputConnections: links,
    rootPlan: { id: `root-${id}`, name: id, nodes, subPlans: [], createdAt: now, updatedAt: now },
  })
  const H = () => block('H', [['gear', 25], ['coin', 0]], [...plan().nodes, row('M', 'make-coin')], [{ id: 'c-H', itemId: 'plate', fromBlockId: 'S' }])
  const S = () => block('S', [['plate', 0], ['token', 1]], [row('MP', 'mine-plate'), row('U', 'use-coin')], [{ id: 'c-S', itemId: 'coin', fromBlockId: 'H' }])
  for (const order of [['H', 'S'], ['S', 'H']]) {
    it(`both requests are met and the cycle settles, tabs ${order.join(' ')}`, () => {
      const byId: Record<string, Block> = { H: H(), S: S() }
      const all = solveAll(order.map(t => byId[t]), gameData())
      const flow = (id: string) => all.flows.find(f => f.connectionId === id)!
      expect(flow('c-H').requested, 'plate requested').toBeCloseTo(30, 6)
      expect(flow('c-H').rate, 'plate delivered').toBeCloseTo(30, 6)
      expect(flow('c-S').requested, 'coin requested').toBeCloseTo(1, 6)
      expect(flow('c-S').rate, 'coin delivered').toBeCloseTo(1, 6)
      expect(runs(all.results.H, 'P'), 'P').toBeCloseTo(10, 6)
      expect(unsat(all.results.H, 'ingot'), 'ingot imported').toBeCloseTo(0, 6)
      expect(all.loops).toHaveLength(1)
      expect(all.loops[0].converged, 'converged').toBe(true)
    })
  }
})

describe('connectionOrder: the retry of a bounded step', () => {
  it('runs the tight bound first, then once with every bound looser, and gives up after that', () => {
    const loosers: number[] = []
    const result = boundedStep(looser => { loosers.push(looser); return { feasible: looser > 1, looser } })
    expect(result?.looser, 'the retry is feasible').toBe(100)
    expect(loosers, 'tight, then looser').toEqual([1, 100])
    expect(boundedStep(() => ({ feasible: false })), 'infeasible twice').toBeUndefined()
    expect(boundedStep(() => ({ feasible: true })), 'feasible at once').toEqual({ feasible: true })
    expect(boundOf(5, 3, 100), 'the looser bound counts the terms').toBeGreaterThan(boundOf(5, 3))
  })

  it('counts a least import as a gain only above the noise', () => {
    expect(improvesImport(10, 10)).toBe(false)
    expect(improvesImport(0, 15)).toBe(true)
  })

  it('counts a least left-over as a gain only above the noise', () => {
    expect(improvesLeftover(1000, 1000)).toBe(false)
    expect(improvesLeftover(1000 - 1e-9, 1000)).toBe(false)
    expect(improvesLeftover(400, 1000)).toBe(true)
    expect(improvesLeftover(0, 15)).toBe(true)
  })
  // Not exercised through a solve on the plain path: no block of the suite makes the tight bound infeasible, so its retry
  // of steps 3 and 4 is tested only through `boundedStep` itself. The area path's is (areas.test.ts, "the retry of a bounded
  // step, through a solve", with `Solve` mocked).
})

describe('connectionOrder: a ratio above 100:1 (T1 report, point 5)', () => {
  // case 22 B with 10000 W per run of use-x instead of 100: 10 goals need 20 X, recycled from 2e5 W (10000 W per X),
  // 1e5 W come from the 10 runs of use-x, the other 1e5 W from the connection. r·k reaches BIG_M here.
  it('1e4:1, W (5e5): the connection covers the 1e5 W, no drift', () => {
    const p = { goals: [{ id: 'g', itemId: 'goal', rate: 10 }], nodes: [row('U', 'use-x'), row('R', 'recycle')], sourceRules: {} }
    const { result, received } = solveBlock(p, gameData(), new Map([['w', 5e5]]))
    expect(runs(result, 'U'), 'U runs').toBeCloseTo(10, 6)
    expect(runs(result, 'R'), 'R runs').toBeCloseTo(20, 6)
    expect(got(received, 'w'), 'W received').toBeCloseTo(1e5, 6)
    expect(unsat(result, 'x'), 'X imported').toBeCloseTo(0, 6)
  })

  it('1e4:1 beside a second chain made at 200 runs per unit (r·k = 2e6 >= BIG_M), q (100) and W (5e5)', () => {
    // 5 qgoal need 5 q: make-q (200 raw ore3 each, 4e-6 of rounding of the solver library on the 1000 imported) or the
    // connection. Raw is no import the order counts, so q keeps being made (own production first) and the W
    // connection replaces the X and W imports. The drift the report predicts for r·k >= BIG_M is not reproduced here.
    const p = {
      goals: [{ id: 'g', itemId: 'goal', rate: 10 }, { id: 'q', itemId: 'qgoal', rate: 5 }],
      nodes: [row('U', 'use-x'), row('R', 'recycle'), row('Q', 'use-q'), row('M', 'make-q')], sourceRules: {},
    }
    const { result, received } = solveBlock(p, gameData(), new Map([['w', 5e5], ['q', 100]]))
    expect(got(received, 'w'), 'W received').toBeCloseTo(1e5, 6)
    expect(got(received, 'q'), 'q received').toBeCloseTo(0, 6)
    expect(runs(result, 'R'), 'R runs').toBeCloseTo(20, 6)
    expect(runs(result, 'M'), 'make-q runs').toBeCloseTo(5, 6)
    expect(unsat(result, 'x') + unsat(result, 'w'), 'no X or W imported').toBeCloseTo(0, 6)
    expect(unsat(result, 'ore3'), 'raw ore3 imported').toBeCloseTo(1000, 5)
  })
})

describe('connectionOrder: the gate', () => {
  const lpCalls = (p: ReturnType<typeof plan>, offers: Array<[string, number]>) => {
    const spy = vi.spyOn(solver, 'Solve')
    try {
      solveBlock(p, gameData(), new Map(offers))
      return spy.mock.calls.length
    } finally {
      spy.mockRestore()
    }
  }
  const free = (): ReturnType<typeof plan> => {
    const p = plan({ p: 'p12' })
    return { ...p, nodes: [row('G', 'gear'), row('P', 'p12'), row('S', 'ingot')] }
  }
  // Case 22 A. LP calls: pass 1 is 1 call, pass 2 (when a connected intermediate has a residual) 1 more. A block whose
  // two passes end with no import of an intermediate, or whose only import is the rule of Don't make more here, keeps
  // that count. A touched block adds the least-import step (1) and, when it finds a gain, the least-received and fill
  // steps (2 more): rows b and g are 1 + 3 = 4 (pass 2 did not run), row p is 2 + 3 = 5 (pass 2 ran), the
  // Don't make more here row adds one refill solve to that (2 + 3 + 1 = 6). A gate that opens and finds no gain
  // stops after the least-import step: 1 + 1 = 2.
  const dmmh = (): ReturnType<typeof plan> => plan({
    goals: [{ id: 'g', itemId: 'gear', rate: 25 }, { id: 'w', itemId: 'widget', rate: 5 }],
    extra: [row('W', 'widget'), row('R', 'make-rod')],
    rules: { rod: { makeHere: 'off' } },
  })
  const coinOnly = (): ReturnType<typeof plan> => plan({ extra: [row('C', 'make-coin'), row('K', 'use-coin')] })
  const rows: Array<[string, () => ReturnType<typeof plan>, Array<[string, number]>, number]> = [
    ['e: no offers', () => plan(), [], 1],
    ['m: S not pinned, plate (100)', free, [['plate', 100]], 1],
    ["ingot on Don't make more here only, plate (100)", () => plan({ rules: { ingot: { makeHere: 'off' } } }), [['plate', 100]], 1],
    ['a: 1 makes 1, plate (100)', () => plan({ p: 'p11' }), [['plate', 100]], 2],
    ['j: 1 makes 2, plate (100) and ingot (100)', () => plan(), [['plate', 100], ['ingot', 100]], 2],
    ['b: 1 makes 2, plate (100)', () => plan(), [['plate', 100]], 4],
    ['g: 1 makes 1, ingot (100)', () => plan({ p: 'p11' }), [['ingot', 100]], 4],
    // Pass 1 imports 40 plates (P runs 10 on S's ingots); pass 2 takes 12, 28 plates stay imported while the ingot offer
    // is untouched: the gate opens, the least import is 0 (P runs 38, 28 ingots from the connection): 2 + 3.
    ['p: 1 makes 1, plate (12) and ingot (100): pass 2 ran, then the three steps', () => plan({ p: 'p11' }), [['plate', 12], ['ingot', 100]], 5],
    // Rod on Don't make more here (5 widgets): pass 1 has a rod residual of 5, so pass 2 runs (3 delivered); the plate
    // connection replaces the 15 ingots (3 steps); the rod slack left in step 4 is measured and refilled (1): 2 + 3 + 1.
    ["q: Don't make more here on rod (3), plate (100): pass 2, three steps and the refill", dmmh, [['plate', 100], ['rod', 3]], 6],
    // The gate opens (15 ingots imported, a coin connection with offer to spare) but coin cannot replace an ingot: the
    // least import is 15 again, no gain, the steps stop after the first: 1 + 1.
    ['r: coin (100), no plate or ingot connection: the gate opens, no gain', coinOnly, [['coin', 100]], 2],
  ]
  it('a block the gate does not open keeps its count, and a touched block adds the least-import step and, with a gain, two more', () => {
    for (const [name, make, offers, calls] of rows) expect(lpCalls(make(), offers), `LP calls, ${name}`).toBe(calls)
  })
})

describe('connectionOrder: the gate on a warning', () => {
  it('stays closed when the solve was unbounded: its rates are arbitrary', () => {
    const today = { feasible: true, shortfall: new Map(), warnings: [{ type: 'unbounded-absorber', recipeIds: [] }] }
    expect(needsConnectionOrder({ today } as unknown as ConnectionOrderInput)).toBe(false)
  })
})

describe('connectionOrder: the gate on a leftover', () => {
  const input = (over: {
    leftover?: Array<[string, number]>; slack?: Array<[string, number]>; supply?: Array<[string, number]>
    firstItems?: string[]; byproductsFirst?: string[]
  } = {}) => ({
    today: {
      feasible: true, shortfall: new Map(), warnings: [], slack: new Map(over.slack ?? []), leftover: new Map(over.leftover ?? [['hot', 1000]]),
      throughput: new Map(), supply: new Map(over.supply ?? []),
    },
    system: { S: new Map(), classification: { intermediates: new Set(['cart']) } },
    totalCaps: new Map([['cart', 100]]),
    firstItems: new Set(over.firstItems ?? []),
    byproductsFirst: new Set(over.byproductsFirst ?? []),
  }) as unknown as ConnectionOrderInput

  it('opens for a left-over and a spare default-rule connection', () => {
    expect(needsConnectionOrder(input())).toBe(true)
  })
  it('stays closed for a left-over at noise level', () => {
    expect(needsConnectionOrder(input({ leftover: [['hot', 1e-9]] }))).toBe(false)
  })
  it('stays closed when the connected item is on Receive it first', () => {
    expect(needsConnectionOrder(input({ firstItems: ['cart'] }))).toBe(false)
  })
  it("stays closed when the connected item is on Don't make more here", () => {
    expect(needsConnectionOrder(input({ byproductsFirst: ['cart'] }))).toBe(false)
  })
  it('stays closed when the offer is fully taken', () => {
    expect(needsConnectionOrder(input({ supply: [['cart', 100]] }))).toBe(false)
  })
  it('stays closed with neither a left-over nor an import', () => {
    expect(needsConnectionOrder(input({ leftover: [] }))).toBe(false)
  })
})
