import { describe, it, expect } from 'vitest'
import { backOffersSettled, productGoals, solveAll } from './index'
import { createSolveCache } from './solveCache'
import type { LoopShape } from './blockGraph'
import type { Block, GameData, GameRecipeNode, Product } from '../data/types'

// Connections of a split fluid (steam made at 500 and 165, taken at 465 or more and at any temperature), through solveAll.
// The cases of spec/test-synthetic.md (26, 27) are in synthetic.test.ts; these are the plumbing around them.

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
    recipe('boil-500', [item('fuel', 1)], [fluid('steam', 30, { temperature: 500 })]),
    recipe('boil-165', [item('fuel', 1)], [fluid('steam', 60, { temperature: 165 })]),
    recipe('turbine', [fluid('steam', 60, { minimumTemperature: 465 })], [item('work', 1)]),
    recipe('engine', [fluid('steam', 60)], [item('work2', 1)]),
    // A cycle of requests: the consumer of work needs steam, the steam block needs work.
    recipe('use-work', [item('work', 1)], [item('goal', 1)]),
  ].map(r => [r.id, r])),
}) as GameData

const node = (recipeId: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode => ({ kind: 'game-recipe', id: recipeId, recipeId, modules: [], byproductPolicy: {}, ...extra })
const now = new Date().toISOString()
const block = (id: string, products: Array<[string, number]>, nodes: GameRecipeNode[], inputConnections: Block['inputConnections'] = []): Block => ({
  id, name: id, color: '#60a5fa', sourceRules: {}, inputConnections,
  products: products.map(([itemId, extraRate], i): Product => ({ id: `p-${id}-${i}`, itemId, extraRate })),
  rootPlan: { id: `root-${id}`, name: id, nodes, subPlans: [], createdAt: now, updatedAt: now },
})
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

describe('productGoals with a request per range', () => {
  const products: Product[] = [{ id: 'p0', itemId: 'steam', extraRate: 100 }, { id: 'p1', itemId: 'steam', extraRate: 5 }, { id: 'p2', itemId: 'other', extraRate: 7 }]
  it('the request of any temperature joins the first product, each other range is a goal of its own with temp', () => {
    const goals = productGoals(products, new Map([['steam[,]', 50], ['steam[465,]', 30], ['other', 3]]))
    expect(goals).toEqual([
      { id: 'p0', itemId: 'steam', rate: 150 },
      { id: 'p0\0steam[465,]', itemId: 'steam', rate: 30, temp: { min: 465 } },
      { id: 'p1', itemId: 'steam', rate: 5 },
      { id: 'p2', itemId: 'other', rate: 10 },
    ])
  })
  it('a plain request is unchanged: it adds to the first product only', () => {
    expect(productGoals([{ id: 'p', itemId: 'x', extraRate: 0 }], new Map([['x', 4]]))).toEqual([{ id: 'p', itemId: 'x', rate: 4 }])
    expect(productGoals([{ id: 'p', itemId: 'x', extraRate: 0 }], new Map([['x', 1e-9]]))).toEqual([])
  })
})

describe('backOffersSettled with a split fluid', () => {
  const loop = { backConnectionIds: ['c'] } as LoopShape
  const members = [{ id: 'B', inputConnections: [{ id: 'c', fromBlockId: 'A', itemId: 'steam' }] }] as unknown as Block[]
  const offers = (a: number, b: number) => new Map([['A', new Map([['steam@500', { net: a, tol: 0.001 }], ['steam@165', { net: b, tol: 0.001 }]])]])
  it('compares every key of the item', () => {
    expect(backOffersSettled(loop, members, offers(100, 50), offers(100, 50))).toBe(true)
    expect(backOffersSettled(loop, members, offers(100, 50), offers(100, 60))).toBe(false)
    expect(backOffersSettled(loop, members, offers(100, 50), new Map([['A', new Map([['steam@500', { net: 100, tol: 0.001 }]])]]))).toBe(false)
  })
})

describe('a cycle of requests that carries steam per range', () => {
  // A makes the goal from work and the steam; B makes work from steam at 465 or more. A requests work of B, B requests steam of A.
  const a = () => block('A', [['goal', 60], ['steam', 0]], [node('use-work'), node('boil-500')], [{ id: 'c-work', itemId: 'work', fromBlockId: 'B' }])
  const b = () => block('B', [['work', 0]], [node('turbine')], [{ id: 'c-steam', itemId: 'steam', fromBlockId: 'A' }])
  for (const order of [['A', 'B'], ['B', 'A']]) {
    it(`converges per key, tabs ${order.join(' ')}`, () => {
      const byId: Record<string, Block> = { A: a(), B: b() }
      const all = solveAll(order.map(t => byId[t]), gameData())
      expect(all.requestLoops).toHaveLength(1)
      expect(all.requestLoops[0].converged).toBe(true)
      const steam = all.flows.find(f => f.connectionId === 'c-steam')!
      expect(r6(steam.rate)).toBe(3600)
      expect(steam.parts!.map(p => ({ temp: p.temp, rate: r6(p.rate), requested: r6(p.requested ?? -1) }))).toEqual([{ temp: { min: 465 }, rate: 3600, requested: 3600 }])
      expect(all.results.A.nodes.find(n => n.recipeNodeId === 'boil-500')!.throughput).toBeCloseTo(120, 5)
      expect(all.results.B.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
    })
  }

  it('a warm solve gives the same flows as a cold one', () => {
    const cache = createSolveCache()
    const cold = solveAll([a(), b()], gameData(), cache)
    const warm = solveAll([a(), b()], gameData(), cache)
    expect(warm.flows).toEqual(cold.flows)
    expect(warm.served).toEqual(cold.served)
  })
})

describe('a take that covers part of a request, per range (takes first)', () => {
  // B takes steam from S1 (a source that does not make steam as a product: a take) and requests it of S2. The take covers what it can
  // of the ranges B needs; only the rest is requested.
  it('asks the request source only for what the take leaves uncovered', () => {
    const take = block('S1', [['fuel', 1]], [node('boil-500', { pinnedRate: 20 })]) // 600 steam at 500, no steam product
    const src2 = block('S2', [['steam', 0]], [node('boil-500')])
    const b = block('B', [['work', 30]], [node('turbine')], [
      { id: 'c-take', itemId: 'steam', fromBlockId: 'S1' },
      { id: 'c-req', itemId: 'steam', fromBlockId: 'S2' },
    ])
    const all = solveAll([take, src2, b], gameData())
    const t = all.flows.find(f => f.connectionId === 'c-take')!
    const r = all.flows.find(f => f.connectionId === 'c-req')!
    expect(t.kind).toBe('take')
    expect(r.kind).toBe('request')
    // The turbine needs 1800 at >= 465: S1's 600 at 500 cover a third, S2 is asked for the other 1200.
    expect(r6(t.rate)).toBe(600)
    expect(r6(r.requested ?? 0)).toBe(1200)
    expect(all.results.B.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
  })
})

describe('connection-temperature', () => {
  it('is not raised when one offered key fits a range the block imports', () => {
    const src = block('A', [['fuel', 1]], [node('boil-165', { pinnedRate: 10 }), node('boil-500', { pinnedRate: 10 })])
    const b = block('B', [['work', 30]], [node('turbine')], [{ id: 'c', itemId: 'steam', fromBlockId: 'A' }])
    const all = solveAll([src, b], gameData())
    expect(all.flows.find(f => f.connectionId === 'c')!.parts!.some(p => p.rate > 0)).toBe(true)
    expect(all.results.B.warnings.filter(w => w.type === 'connection-temperature')).toEqual([])
  })
})

describe('a consumer with areas', () => {
  // B's turbine and engine are separate areas: each area takes its own range of the connected steam.
  const area = (id: string, nodes: GameRecipeNode[]) => ({ id, name: id, nodes, subPlans: [], area: true as const, createdAt: now, updatedAt: now })
  const consumer = (connections: Block['inputConnections']): Block => ({
    ...block('B', [['work', 30], ['work2', 30]], [], connections),
    rootPlan: { id: 'root-B', name: 'B', nodes: [], createdAt: now, updatedAt: now, subPlans: [area('T', [node('turbine')]), area('E', [node('engine')])] },
  })

  it('a request: each area is served its range, no import', () => {
    const src = block('A', [['steam', 0]], [node('boil-500'), node('boil-165')])
    const all = solveAll([src, consumer([{ id: 'c', itemId: 'steam', fromBlockId: 'A' }])], gameData())
    const f = all.flows.find(x => x.connectionId === 'c')!
    expect(r6(f.requested ?? 0)).toBe(3600)
    expect(r6(f.rate)).toBe(3600)
    expect(all.results.B.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
    expect(all.errors).toEqual({})
  })

  it('a take: the keys the source offers go to the areas that take them', () => {
    const src = block('A', [['fuel', 1]], [node('boil-500', { pinnedRate: 60 }), node('boil-165', { pinnedRate: 30 })])
    const all = solveAll([src, consumer([{ id: 'c', itemId: 'steam', fromBlockId: 'A' }])], gameData())
    const f = all.flows.find(x => x.connectionId === 'c')!
    expect(r6(f.rate)).toBe(3600)
    expect(f.parts!.filter(p => p.rate > 0).map(p => ({ temp: p.temp, rate: r6(p.rate) }))).toEqual([
      { temp: { at: 165 }, rate: 1800 },
      { temp: { at: 500 }, rate: 1800 },
    ])
    expect(all.results.B.unsatisfied.filter(u => u.itemId === 'steam')).toEqual([])
    expect(all.errors).toEqual({})
  })
})
