import { describe, it, expect } from 'vitest'
import { solveBlock } from './index'
import { buildClassifiedSystem, type FluidKeySupply, type KeySupply } from './build'
import { buildLPModel, CONVERT_COST, SUPPLY_DEPTH, SUPPLY_TIE_COST } from './solve'
import { keySupplyKey } from './solveCache'
import { createSolveCache } from './solveCache'
import type { GameData, GameRecipeNode, SolverGoal } from '../data/types'
import type { SolverPlan } from './blockResult'

// Direct solveBlock calls with the supplied keys of a split fluid (`keySupply`), the way `solveAll` builds them: steam at 500 and 165
// offered by connections to a block with a turbine (>= 465) and an engine (any temperature).

type R = GameData['recipes'][string]
const fluid = (itemId: string, amount: number, extra: object = {}) => ({ itemId, type: 'fluid' as const, amount, ...extra })
const item = (itemId: string, amount: number) => ({ itemId, type: 'item' as const, amount })
const recipe = (id: string, ingredients: R['ingredients'], products: R['products']): R => ({
  id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [],
  allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
})
const gameData = (): GameData => ({
  factorioVersion: '2.0.0', modSet: {}, items: {}, machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  recipes: Object.fromEntries([
    recipe('boil-165', [item('fuel', 1)], [fluid('steam', 60, { temperature: 165 })]),
    recipe('turbine', [fluid('steam', 60, { minimumTemperature: 465 })], [item('work', 1)]),
    recipe('engine', [fluid('steam', 60)], [item('work2', 1)]),
    recipe('own-steam-use', [fluid('steam', 60)], [item('steam-goal', 1)]),
  ].map(r => [r.id, r])),
}) as GameData

const node = (recipeId: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode => ({ kind: 'game-recipe', id: recipeId, recipeId, modules: [], byproductPolicy: {}, ...extra })
const plan = (goals: [string, number][], nodes: GameRecipeNode[], sourceRules: SolverPlan['sourceRules'] = {}): SolverPlan => ({
  goals: goals.map(([itemId, rate], i): SolverGoal => ({ id: `g${i}`, itemId, rate })), nodes, sourceRules,
})
const ranges = [{ min: 465 }, {}]
const supply = (offers: FluidKeySupply['offers'], maxRates: FluidKeySupply['maxRates'] = []): KeySupply =>
  new Map([['steam', { ranges, offers, maxRates }]])
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

describe('supplied keys in one block', () => {
  it('two connections: each is bounded by its own offers, and the maxRate bounds the sum of a connection over its keys', () => {
    const ks = supply([
      { connectionId: 'c1', tag: { at: 500 }, offer: 1000 },
      { connectionId: 'c1', tag: { at: 165 }, offer: 1000 },
      { connectionId: 'c2', tag: { at: 500 }, offer: 1000 },
    ], [['c1', 1500]])
    const { result, received, receivedParts } = solveBlock(plan([['work', 30], ['work2', 30]], [node('turbine'), node('engine')]), gameData(), new Map(), ks)
    // Needs 3600 (turbine 1800 at >= 465, engine 1800 at any); c1 gives at most 1500, c2 1000: 1100 is imported.
    expect(r6(received.get('steam') ?? 0)).toBe(2500)
    const c1 = [...receivedParts!.get('c1')!.values()].reduce((a, b) => a + b, 0)
    const c2 = [...receivedParts!.get('c2')!.values()].reduce((a, b) => a + b, 0)
    expect(r6(c1)).toBe(1500)
    expect(r6(c2)).toBe(1000)
    expect(receivedParts!.get('c1')!.get('steam@500')!).toBeLessThanOrEqual(1000 + 1e-6)
    expect(result.unsatisfied.filter(u => u.itemId === 'steam').reduce((a, u) => a + u.rate, 0)).toBeCloseTo(1100, 4)
  })

  it('a supplied key is converted into the range that fits: the 165 steam never feeds the turbine', () => {
    const ks = supply([{ connectionId: 'c1', tag: { at: 165 }, offer: 5000 }])
    const { result, receivedParts } = solveBlock(plan([['work', 30]], [node('turbine')]), gameData(), new Map(), ks)
    expect(result.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([{ itemId: 'steam', rate: expect.closeTo(1800, 6), temp: { min: 465 } }])
    expect(receivedParts).toBeUndefined()
  })

  it('the fluid cap row: own production comes first, supply fills only the residual', () => {
    const ks = supply([{ connectionId: 'c1', tag: { at: 165 }, offer: 5000 }])
    // The engine needs 1800; the boiler makes 60 per run pinned at 10 = 600 at 165, so 1200 is left to receive.
    const { result, received } = solveBlock(
      plan([['work2', 30]], [node('boil-165', { pinnedRate: 10 }), node('engine')]), gameData(), new Map(), ks,
    )
    expect(r6(received.get('steam') ?? 0)).toBe(1200)
    expect(result.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
  })

  it('a supplied key never feeds the goal key: the goal is made, a row takes the supply', () => {
    const ks = supply([{ connectionId: 'c1', tag: { at: 500 }, offer: 5000 }])
    // The goal (600 at any temperature) is the boiler's 165 steam; the turbine takes the 500 supply, which also fits any temperature.
    const { result, received, receivedKeys } = solveBlock(plan([['steam', 600], ['work', 30]], [node('boil-165', { pinnedRate: 10 }), node('turbine')]), gameData(), new Map(), ks)
    expect(r6(received.get('steam') ?? 0)).toBe(1800)
    expect(r6(receivedKeys.get('steam@500') ?? 0)).toBe(1800)
    expect(result.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
    expect(result.nodes.find(n => n.recipeNodeId === 'boil-165')!.throughput).toBeCloseTo(10, 6)
  })

  it('Receive it first: the supply is used before the block makes its own steam', () => {
    const ks = supply([{ connectionId: 'c1', tag: { at: 165 }, offer: 5000 }])
    const own = plan([['work2', 30]], [node('boil-165'), node('engine')], { steam: { makeHere: 'after-blocks' } })
    const { received, result } = solveBlock(own, gameData(), new Map(), ks)
    expect(r6(received.get('steam') ?? 0)).toBe(1800)
    expect(result.nodes.find(n => n.recipeNodeId === 'boil-165')!.throughput).toBeCloseTo(0, 6)
  })

  it('Receive it first: a marked feeder keeps the supply for what an ordinary row uses of its product (fallback)', () => {
    // press (marked) takes 60 steam of any temperature for 4 plates; saw (flagged) and use take plates. boil-165 and vent are ordinary,
    // so boil-165 is not a feeder and the steam is bounded. The 165 offer anchors press only through supply, so the fallback holds.
    const gd = gameData()
    for (const r of [
      recipe('vent', [fluid('steam', 60)], [item('ash', 1)]),
      recipe('press', [fluid('steam', 60)], [item('plate', 4)]),
      recipe('saw', [item('plate', 1)], [item('saw', 1)]),
      recipe('use', [item('plate', 1)], [item('gadget', 1)]),
    ]) gd.recipes[r.id] = r
    const ks = supply([{ connectionId: 'c1', tag: { at: 165 }, offer: 1000 }])
    const p = plan(
      [['gadget', 4]],
      [node('boil-165'), node('vent'), node('press', { absorberFeeder: true }), node('saw', { byproductConsumer: true }), node('use')],
      { steam: { makeHere: 'after-blocks' } },
    )
    const { received, result } = solveBlock(p, gd, new Map(), ks)
    const rate = (id: string) => result.nodes.find(n => n.recipeNodeId === id)!.throughput
    expect(rate('press'), 'press').toBeCloseTo(1, 6)
    expect(rate('boil-165'), 'boil-165').toBeCloseTo(0, 6)
    expect(rate('saw'), 'saw').toBeCloseTo(0, 6)
    expect(r6(received.get('steam') ?? 0)).toBe(60)
  })

  it('the 26 b shape: a supplied conversion pays the depth of its range (R1)', () => {
    const ks = supply([
      { connectionId: 'c1', tag: { at: 500 }, offer: 3600 },
      { connectionId: 'c1', tag: { at: 165 }, offer: 1800 },
    ])
    const sys = buildClassifiedSystem(gameData(), ['turbine', 'engine'], new Map([['work', 30], ['work2', 30]]), new Map(), { keySupply: ks })
    const lp = buildLPModel(sys, new Map(), new Set(), new Set(), new Map([['steam@500#in', 3600], ['steam@165#in', 1800]]), new Set(), new Set(), false)
    const cost = (conv: string) => lp.variables[lp.recipeToVar.get(conv)!].__obj__
    const unit = SUPPLY_TIE_COST
    // N = 2; depth [465,] = 2, [,] = 1.
    expect(cost('conv:steam@500#in→steam[465,]')).toBeCloseTo(CONVERT_COST + unit * SUPPLY_DEPTH * 2 * 0, 12)
    expect(cost('conv:steam@500#in→steam[,]')).toBeCloseTo(CONVERT_COST + unit * SUPPLY_DEPTH * 2 * 1, 12)
    expect(cost('conv:steam@165#in→steam[,]')).toBeCloseTo(CONVERT_COST + unit * SUPPLY_DEPTH * 2 * 1, 12)
    // Supply costs the tie-break times the versatility (@500 fits 2 ranges, @165 one).
    const supplyCost = (name: string) => lp.variables[lp.keySupplyVars.find(v => v.key === name)!.name].__obj__
    expect(supplyCost('steam@500#in')).toBeCloseTo(2 * unit, 14)
    expect(supplyCost('steam@165#in')).toBeCloseTo(1 * unit, 14)
    // X (T 1800 at 500, E 900 at 165) beats Y (T 900 at 500, E 1800 at 165 and 900 of T imported) by the doc's 6300 against 7200 units.
    const x = 1800 * (cost('conv:steam@500#in→steam[465,]') + 2 * unit) + 900 * (cost('conv:steam@165#in→steam[,]') + unit)
    const y = 900 * (cost('conv:steam@500#in→steam[465,]') + 2 * unit) + 1800 * (cost('conv:steam@165#in→steam[,]') + unit)
    if (SUPPLY_DEPTH === 1) expect(x).toBeLessThan(y)
  })

  it('Leftover off on a split fluid: its temperature and range keys get a left-over variable, its supplied #in keys do not', () => {
    const ks = supply([
      { connectionId: 'c1', tag: { at: 500 }, offer: 3600 },
      { connectionId: 'c1', tag: { at: 165 }, offer: 1800 },
    ])
    const sys = buildClassifiedSystem(gameData(), ['boil-165', 'turbine', 'engine'], new Map([['work', 30], ['work2', 30]]), new Map(), { keySupply: ks })
    const caps = new Map([['steam@500#in', 3600], ['steam@165#in', 1800]])
    const lp = buildLPModel(sys, new Map(), new Set(), new Set(), caps, new Set(), new Set(), false, new Set(), { leftoverOff: new Set(['steam']) })
    const keys = [...lp.itemToLeftover.keys()]
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every(k => sys.flow!.info.get(k)!.itemId === 'steam' && !sys.flow!.info.get(k)!.supplied)).toBe(true)
    expect(keys.some(k => k.includes('#in'))).toBe(false)
    expect(keys.some(k => k.startsWith('steam@165'))).toBe(true)
    const off = buildLPModel(sys, new Map(), new Set(), new Set(), caps, new Set(), new Set(), false, new Set(), { leftoverOff: new Set(['work']) })
    expect([...off.itemToLeftover.keys()].some(k => k.startsWith('steam'))).toBe(false)
  })
})

describe('solve cache key of the supplied keys', () => {
  const base = supply([{ connectionId: 'c1', tag: { at: 500 }, offer: 100 }], [['c1', 50]])
  it("'' without supplied keys", () => {
    expect(keySupplyKey(new Map())).toBe('')
  })
  it('equal supplies give equal keys; a changed offer, maxRate or range gives another', () => {
    expect(keySupplyKey(base)).toBe(keySupplyKey(supply([{ connectionId: 'c1', tag: { at: 500 }, offer: 100 }], [['c1', 50]])))
    expect(keySupplyKey(base)).not.toBe(keySupplyKey(supply([{ connectionId: 'c1', tag: { at: 500 }, offer: 101 }], [['c1', 50]])))
    expect(keySupplyKey(base)).not.toBe(keySupplyKey(supply([{ connectionId: 'c1', tag: { at: 500 }, offer: 100 }], [['c1', 60]])))
    expect(keySupplyKey(base)).not.toBe(keySupplyKey(new Map([['steam', { ...base.get('steam')!, ranges: [...ranges, { max: 50 }] }]])))
  })
  it('the cache hits on an equal supply key and misses on another', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const solved = { result: { nodes: [], unsatisfied: [], warnings: [] }, received: new Map<string, number>() }
    cache.set('B', gd, 'k', new Map(), solved, keySupplyKey(base))
    expect(cache.get('B', gd, 'k', new Map(), keySupplyKey(base))).toBe(solved)
    expect(cache.get('B', gd, 'k', new Map(), 'other')).toBeUndefined()
    expect(cache.get('B', gd, 'k', new Map())).toBeUndefined()
  })
})
