import { describe, it, expect } from 'vitest'
import { createSolveCache, exactKey, LOOP_SLOTS, SLOTS_PER_BLOCK, planKey, sourcingKey, type BlockSolve, type RequestLoopSolve } from './solveCache'
import { flattenBlock } from './index'
import type { Block, GameData, GameRecipeNode, Product, RecipeNode, SubPlan } from '../data/types'

function node(id: string, recipeId: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...extra }
}

function subPlan(name: string, nodes: RecipeNode[], updatedAt: string, subPlans: SubPlan[] = []): SubPlan {
  return { id: 'root', name, nodes, subPlans, createdAt: updatedAt, updatedAt }
}

function block(rootPlan: SubPlan, extra: Partial<Block> = {}): Block {
  const products: Product[] = [{ id: 'g', itemId: 'plate', extraRate: 60 }]
  return { id: 'b', name: 'Block', color: '#60a5fa', products, sourceRules: {}, inputConnections: [], rootPlan, ...extra }
}

const keyOf = (nodes: RecipeNode[]) =>
  planKey(flattenBlock(block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'))))

const gameData = () => ({ items: {} }) as unknown as GameData
const solved = (): BlockSolve => ({ result: { nodes: [], unsatisfied: [], warnings: [] }, received: new Map() })

describe('planKey', () => {
  it('is the exact key of the three plan parts when there are no areas, and appends the areas otherwise', () => {
    const plan = flattenBlock(block(subPlan('r', [node('n', 'plate')], '2020-01-01T00:00:00.000Z')))
    expect(planKey(plan)).toBe(exactKey([plan.goals, plan.nodes, []]))
    const areas = [{ id: 'root', nodeIds: ['n'] }]
    expect(planKey({ ...plan, areas })).toBe(exactKey([plan.goals, plan.nodes, [], areas]))
  })

  it('ignores block name, colour, sub-plan names and updatedAt', () => {
    const a = block(subPlan('one', [node('n', 'plate')], '2020-01-01T00:00:00.000Z'))
    const b = block(subPlan('two', [node('n', 'plate')], '2030-01-01T00:00:00.000Z'), { name: 'Other', color: '#000000' })
    expect(planKey(flattenBlock(a))).toBe(planKey(flattenBlock(b)))
  })

  it('differs when item sourcing changes; absent equals empty', () => {
    const nodes = [node('n', 'plate')]
    const base = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'))
    const first = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'), { sourceRules: { plate: { makeHere: 'after-blocks' as const } } })
    const byproducts = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'), { sourceRules: { plate: { makeHere: 'off' as const } } })
    expect(planKey(flattenBlock(first))).not.toBe(planKey(flattenBlock(base)))
    expect(planKey(flattenBlock(byproducts))).not.toBe(planKey(flattenBlock(base)))
    expect(planKey(flattenBlock(byproducts))).not.toBe(planKey(flattenBlock(first)))
    expect(planKey({ ...flattenBlock(base), sourceRules: undefined })).toBe(planKey(flattenBlock(base)))
  })

  it('differs when an item has Leftover off', () => {
    const nodes = [node('n', 'plate')]
    const base = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'))
    const off = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'), { sourceRules: { plate: { leftoverOff: true as const } } })
    expect(planKey(flattenBlock(off))).not.toBe(planKey(flattenBlock(base)))
    expect(sourcingKey({ plate: { leftoverOff: true } })).not.toEqual(sourcingKey({ plate: {} }))
    expect(sourcingKey({ plate: { leftoverOff: true } })).not.toEqual(sourcingKey({ plate: { importOff: true } }))
  })

  it('does not depend on the order of the item sourcing entries', () => {
    const nodes = [node('n', 'plate')]
    const ab = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'), { sourceRules: { a: { makeHere: 'off' as const }, b: { makeHere: 'after-blocks' as const } } })
    const ba = block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'), { sourceRules: { b: { makeHere: 'after-blocks' as const }, a: { makeHere: 'off' as const } } })
    expect(planKey(flattenBlock(ab))).toBe(planKey(flattenBlock(ba)))
  })

  it('differs for a one-ulp-ish rate change', () => {
    expect(keyOf([node('n', 'plate', { pinnedRate: 10 })])).not.toBe(keyOf([node('n', 'plate', { pinnedRate: 10.000000001 })]))
  })

  it('distinguishes NaN, Infinity and null', () => {
    const nan = keyOf([node('n', 'plate', { pinnedRate: NaN })])
    const inf = keyOf([node('n', 'plate', { pinnedRate: Infinity })])
    const nul = keyOf([node('n', 'plate', { pinnedRate: null as unknown as number })])
    expect(nan, 'NaN vs Infinity').not.toBe(inf)
    expect(nan, 'NaN vs null').not.toBe(nul)
    expect(inf, 'Infinity vs null').not.toBe(nul)
  })

  it('distinguishes -0 from 0', () => {
    expect(keyOf([node('n', 'plate', { pinnedRate: -0 })])).not.toBe(keyOf([node('n', 'plate', { pinnedRate: 0 })]))
  })

  it('differs when node order changes', () => {
    expect(keyOf([node('a', 'plate'), node('b', 'gear')])).not.toBe(keyOf([node('b', 'gear'), node('a', 'plate')]))
  })
})

describe('createSolveCache', () => {
  const caps = (entries: [string, number][]) => new Map(entries)

  it('hits on equal inputs and returns the stored object', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const s = solved()
    cache.set('b', gd, 'k', caps([['plate', 60]]), s)
    expect(cache.get('b', gd, 'k', caps([['plate', 60]]))).toBe(s)
  })

  it('misses on a different game data object with equal content', () => {
    const cache = createSolveCache()
    cache.set('b', gameData(), 'k', caps([]), solved())
    expect(cache.get('b', gameData(), 'k', caps([]))).toBeUndefined()
  })

  it('misses on a different plan key', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.set('b', gd, 'k', caps([]), solved())
    expect(cache.get('b', gd, 'other', caps([]))).toBeUndefined()
  })

  it('misses on caps in a different order', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.set('b', gd, 'k', caps([['a', 1], ['b', 2]]), solved())
    expect(cache.get('b', gd, 'k', caps([['b', 2], ['a', 1]]))).toBeUndefined()
  })

  it('misses on a cap differing by one ulp', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.set('b', gd, 'k', caps([['plate', 60]]), solved())
    expect(cache.get('b', gd, 'k', caps([['plate', 60 + 2 ** -46]]))).toBeUndefined()
  })

  it('snapshots the caps it was given', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const c = caps([['plate', 60]])
    cache.set('b', gd, 'k', c, solved())
    c.set('plate', 10)
    expect(cache.get('b', gd, 'k', caps([['plate', 60]]))).toBeDefined()
  })

  it('retain drops absent ids, delete and clear work', () => {
    const cache = createSolveCache()
    const gd = gameData()
    for (const id of ['a', 'b', 'c']) cache.set(id, gd, 'k', caps([]), solved())
    cache.retain(new Set(['a', 'b']))
    expect(cache.has('c')).toBe(false)
    expect(cache.size).toBe(2)
    cache.delete('a')
    expect(cache.has('a')).toBe(false)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('keeps SLOTS_PER_BLOCK entries per block and counts the block once', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const all = Array.from({ length: SLOTS_PER_BLOCK }, () => solved())
    all.forEach((s, i) => cache.set('b', gd, `k${i}`, caps([]), s))
    expect(cache.size).toBe(1)
    all.forEach((s, i) => expect(cache.get('b', gd, `k${i}`, caps([]))).toBe(s))
  })

  it('evicts the least recently used entry', () => {
    const cache = createSolveCache()
    const gd = gameData()
    for (let i = 0; i < SLOTS_PER_BLOCK; i++) cache.set('b', gd, `k${i}`, caps([]), solved())
    expect(cache.get('b', gd, 'k0', caps([]))).toBeDefined() // k1 is now the least recently used
    cache.set('b', gd, 'new', caps([]), solved())
    expect(cache.get('b', gd, 'k1', caps([]))).toBeUndefined()
    expect(cache.get('b', gd, 'k0', caps([]))).toBeDefined()
    for (let i = 2; i < SLOTS_PER_BLOCK; i++) expect(cache.get('b', gd, `k${i}`, caps([]))).toBeDefined()
    expect(cache.get('b', gd, 'new', caps([]))).toBeDefined()
  })

  it('replaces an entry with equal inputs instead of adding one', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const replacement = solved()
    cache.set('b', gd, 'A', caps([]), solved())
    cache.set('b', gd, 'B', caps([]), solved())
    cache.set('b', gd, 'A', caps([]), replacement)
    expect(cache.get('b', gd, 'A', caps([]))).toBe(replacement)
    expect(cache.get('b', gd, 'B', caps([]))).toBeDefined()
  })

  it('delete drops every entry of a block', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.set('b', gd, 'A', caps([]), solved())
    cache.set('b', gd, 'B', caps([]), solved())
    cache.delete('b')
    expect(cache.has('b')).toBe(false)
    expect(cache.get('b', gd, 'A', caps([]))).toBeUndefined()
  })
})

describe('exactKey', () => {
  it('keeps NaN, Infinity and -0 apart', () => {
    const keys = [NaN, Infinity, -Infinity, -0, 0, null].map(v => exactKey([v]))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('request loop entries', () => {
  const loopSolve = (): RequestLoopSolve => ({
    shares: new Map([['c', 20]]), credits: new Map([['ct', 5]]), credited: [['t', 'plate', 5]],
    needs: new Map([['ct', 8]]), uncredited: new Set(), rounds: 3, converged: true,
  })

  it('keeps two cycle outcomes per member list', () => {
    expect(LOOP_SLOTS).toBe(2)
    const cache = createSolveCache()
    const gd = gameData()
    const [e1, e2, e3] = [loopSolve(), loopSolve(), loopSolve()]
    cache.setRequestLoop(['a', 'b'], gd, 'k1', e1)
    cache.setRequestLoop(['a', 'b'], gd, 'k2', e2)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k1')).toBe(e1)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k2')).toBe(e2)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k1')).toBe(e1) // k2 is now the least recently used
    cache.setRequestLoop(['a', 'b'], gd, 'k3', e3)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k2')).toBeUndefined()
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k1')).toBe(e1)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k3')).toBe(e3)
  })

  it('round-trips an entry for the same members, key and game data', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const entry = loopSolve()
    cache.setRequestLoop(['a', 'b'], gd, 'k', entry)
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k')).toBe(entry)
  })

  it('misses on another key, game data object or member list', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.setRequestLoop(['a', 'b'], gd, 'k', loopSolve())
    expect(cache.getRequestLoop(['a', 'b'], gd, 'other')).toBeUndefined()
    expect(cache.getRequestLoop(['a', 'b'], gameData(), 'k')).toBeUndefined()
    expect(cache.getRequestLoop(['b', 'a'], gd, 'k')).toBeUndefined()
  })

  it('retain drops entries with a missing member and clear drops all', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.setRequestLoop(['a', 'b'], gd, 'k', loopSolve())
    cache.setRequestLoop(['c', 'd'], gd, 'k', loopSolve())
    cache.retain(new Set(['a', 'b', 'c']))
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k')).toBeDefined()
    expect(cache.getRequestLoop(['c', 'd'], gd, 'k')).toBeUndefined()
    cache.clear()
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k')).toBeUndefined()
  })

  it('retain drops entries not read or written since the last retain', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.setRequestLoop(['a', 'b'], gd, 'k', loopSolve())
    cache.setRequestLoop(['c', 'd'], gd, 'k', loopSolve())
    cache.retain(new Set(['a', 'b', 'c', 'd']))
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k')).toBeDefined()
    cache.retain(new Set(['a', 'b', 'c', 'd']))
    expect(cache.getRequestLoop(['a', 'b'], gd, 'k')).toBeDefined()
    expect(cache.getRequestLoop(['c', 'd'], gd, 'k')).toBeUndefined()
  })

  it('does not count towards size or has', () => {
    const cache = createSolveCache()
    cache.setRequestLoop(['a', 'b'], gameData(), 'k', loopSolve())
    expect(cache.size).toBe(0)
    expect(cache.has('a')).toBe(false)
  })
})
