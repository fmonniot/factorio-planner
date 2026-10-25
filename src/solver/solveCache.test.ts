import { describe, it, expect } from 'vitest'
import { createSolveCache, planKey, type BlockSolve } from './solveCache'
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
  return { id: 'b', name: 'Block', color: '#60a5fa', products, noImportItems: [], inputConnections: [], rootPlan, ...extra }
}

const keyOf = (nodes: RecipeNode[]) =>
  planKey(flattenBlock(block(subPlan('r', nodes, '2020-01-01T00:00:00.000Z'))))

const gameData = () => ({ items: {} }) as unknown as GameData
const solved = (): BlockSolve => ({ result: { nodes: [], unsatisfied: [], warnings: [] }, received: new Map() })

describe('planKey', () => {
  it('ignores block name, colour, sub-plan names and updatedAt', () => {
    const a = block(subPlan('one', [node('n', 'plate')], '2020-01-01T00:00:00.000Z'))
    const b = block(subPlan('two', [node('n', 'plate')], '2030-01-01T00:00:00.000Z'), { name: 'Other', color: '#000000' })
    expect(planKey(flattenBlock(a))).toBe(planKey(flattenBlock(b)))
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

  it('keeps three entries per block and counts the block once', () => {
    const cache = createSolveCache()
    const gd = gameData()
    const first = solved()
    const second = solved()
    const third = solved()
    cache.set('b', gd, 'k1', caps([]), first)
    cache.set('b', gd, 'k2', caps([]), second)
    cache.set('b', gd, 'k3', caps([]), third)
    expect(cache.size).toBe(1)
    expect(cache.get('b', gd, 'k1', caps([]))).toBe(first)
    expect(cache.get('b', gd, 'k2', caps([]))).toBe(second)
    expect(cache.get('b', gd, 'k3', caps([]))).toBe(third)
  })

  it('evicts the least recently used entry', () => {
    const cache = createSolveCache()
    const gd = gameData()
    cache.set('b', gd, 'A', caps([]), solved())
    cache.set('b', gd, 'B', caps([]), solved())
    cache.set('b', gd, 'C', caps([]), solved())
    expect(cache.get('b', gd, 'A', caps([]))).toBeDefined()
    cache.set('b', gd, 'D', caps([]), solved())
    expect(cache.get('b', gd, 'B', caps([]))).toBeUndefined()
    expect(cache.get('b', gd, 'A', caps([]))).toBeDefined()
    expect(cache.get('b', gd, 'C', caps([]))).toBeDefined()
    expect(cache.get('b', gd, 'D', caps([]))).toBeDefined()
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
