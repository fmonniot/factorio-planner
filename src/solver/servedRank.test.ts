import { describe, expect, it } from 'vitest'
import type { Block, ServedEntry } from '../data/types'
import { grantByRank, rankedPairs, servedRankOf, type RankedEntry } from './servedRank'

const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
const extra: ServedEntry = { kind: 'extra' }

function block(id: string, opts: { from?: string[]; products?: [string, number | undefined][]; list?: ServedEntry[]; item?: string } = {}): Block {
  const item = opts.item ?? 'plate'
  return {
    id, name: id, color: '#60a5fa',
    products: (opts.products ?? []).map(([itemId, extraRate], i) => ({ id: `p${i}`, itemId, ...(extraRate !== undefined ? { extraRate } : {}) })),
    sourceRules: {},
    inputConnections: (opts.from ?? []).map((from, i) => ({ id: `${id}-c${i}`, itemId: item, fromBlockId: from })),
    ...(opts.list ? { servedOrder: { [item]: opts.list } } : {}),
    rootPlan: { id: `root-${id}`, name: 'root', nodes: [], subPlans: [] },
  } as unknown as Block
}

const none = new Set<string>()
const pairOf = (blocks: Block[], loop = none, source = 'A') => rankedPairs(blocks, loop).get(source)?.get('plate')
const ids = (entries: RankedEntry[]) => entries.map(e => (e.kind === 'extra' ? 'extra' : e.blockId))

describe('rankedPairs', () => {
  it('is empty without a servedOrder', () => {
    expect(rankedPairs([block('A'), block('B', { from: ['A'] })], none).size).toBe(0)
  })

  it('keeps the list order and puts the other consumers, in blocks order, in unlisted', () => {
    const blocks = [block('A', { products: [['plate', 5]], list: [blk('C'), extra, blk('B')] }), block('B', { from: ['A'] }), block('C', { from: ['A'] }), block('D', { from: ['A'] }), block('E', { from: ['A'] })]
    const pair = pairOf(blocks)!
    expect(ids(pair.listed)).toEqual(['C', 'extra', 'B'])
    expect(pair.unlisted.map(u => u.blockId)).toEqual(['D', 'E'])
    expect(pair.extraRate).toBe(5)
  })

  it('drops repeats, unknown blocks, blocks with no connection, the source itself and a second connection', () => {
    const blocks = [
      block('A', { products: [['plate', 5]], list: [blk('B'), blk('B'), blk('ghost'), blk('A'), blk('N'), extra, extra, blk('C')] }),
      block('B', { from: ['A', 'A'] }),
      block('C', { from: ['A'] }),
      block('N'),
    ]
    const pair = pairOf(blocks)!
    expect(ids(pair.listed)).toEqual(['B', 'extra', 'C'])
    const b = pair.listed[0]
    expect(b.kind === 'block' && b.connection.id).toBe('B-c0')
  })

  it('keeps the extra only when the source has an extra output of the item', () => {
    const list = [extra, blk('B')]
    expect(ids(pairOf([block('A', { list }), block('B', { from: ['A'] })])!.listed)).toEqual(['B'])
    expect(ids(pairOf([block('A', { products: [['gear', 9]], list }), block('B', { from: ['A'] })])!.listed)).toEqual(['B'])
    expect(ids(pairOf([block('A', { products: [['plate', 5], ['plate', 2]], list }), block('B', { from: ['A'] })])!.listed)).toEqual(['extra', 'B'])
    expect(pairOf([block('A', { products: [['plate', 5], ['plate', 2]], list }), block('B', { from: ['A'] })])!.extraRate).toBe(7)
    expect(ids(pairOf([block('A', { products: [['plate', 0], ['plate', undefined]], list }), block('B', { from: ['A'] })])!.listed)).toEqual(['B'])
  })

  it('skips a pair when its source or one of its consumers is in a loop', () => {
    const blocks = () => [block('A', { list: [blk('B')] }), block('B', { from: ['A'] }), block('C', { from: ['A'] })]
    expect(pairOf(blocks())).toBeDefined()
    expect(pairOf(blocks(), new Set(['A']))).toBeUndefined()
    expect(pairOf(blocks(), new Set(['B']))).toBeUndefined()
    expect(pairOf(blocks(), new Set(['C']))).toBeUndefined() // an unlisted consumer counts too
    expect(pairOf(blocks(), new Set(['Z']))).toBeDefined()
  })

  it('skips a pair with no entry that applies', () => {
    expect(pairOf([block('A', { list: [extra, blk('ghost')] }), block('B', { from: ['A'] })])).toBeUndefined()
  })

  it('ranks each item of a source on its own', () => {
    const a = block('A', { list: [blk('B')] })
    a.servedOrder = { plate: [blk('B')], gear: [blk('B')] }
    const pairs = rankedPairs([a, block('B', { from: ['A'] })], none)
    expect([...pairs.get('A')!.keys()]).toEqual(['plate'])
  })
})

describe('grantByRank', () => {
  const entry = (id: string): RankedEntry => ({ kind: 'block', blockId: id, connection: { id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' } })
  const shares: Record<string, number> = { 'c-B': 30, 'c-C': 20 }
  const shareOf = (id: string) => shares[id] ?? 0

  it('grants down the order, the extra holding its place', () => {
    const { grants, held } = grantByRank(45, [entry('C'), { kind: 'extra' }, entry('B')], 10, shareOf)
    expect(grants.get('c-C')).toBe(20)
    expect(grants.get('c-B')).toBe(15)
    expect(grants.size).toBe(2)
    expect(held).toBe(45)
  })

  it('grants every share in full when the offer is enough', () => {
    const { grants, held } = grantByRank(100, [entry('C'), { kind: 'extra' }, entry('B')], 10, shareOf)
    expect([...grants]).toEqual([['c-C', 20], ['c-B', 30]])
    expect(held).toBe(60)
  })

  it('grants nothing from no offer', () => {
    for (const offer of [0, -5]) {
      const { grants, held } = grantByRank(offer, [entry('C'), { kind: 'extra' }], 10, shareOf)
      expect(grants.get('c-C')).toBe(0)
      expect(held).toBe(0)
    }
  })
})

describe('servedRankOf', () => {
  it('places the extra among the blocks', () => {
    const b = (id: string): RankedEntry => ({ kind: 'block', blockId: id, connection: { id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' } })
    expect(servedRankOf([b('B'), { kind: 'extra' }, b('C')])).toEqual({ blockIds: ['B', 'C'], extraPlace: 1 })
    expect(servedRankOf([b('B'), b('C')])).toEqual({ blockIds: ['B', 'C'], extraPlace: 2 })
    expect(servedRankOf([{ kind: 'extra' }, b('B')])).toEqual({ blockIds: ['B'], extraPlace: 0 })
  })
})
