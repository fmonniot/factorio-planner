import { describe, expect, it } from 'vitest'
import type { Block, ServedEntry } from '../data/types'
import { grantByRank, rankedPairs, servedRankOf, waterFill, type RankedEntry } from './servedRank'

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

const pairOf = (blocks: Block[], source = 'A') => rankedPairs(blocks).get(source)?.get('plate')
const ids = (entries: RankedEntry[]) => entries.map(e => (e.kind === 'extra' ? 'extra' : e.blockId))

describe('rankedPairs', () => {
  it('is empty without a servedOrder', () => {
    expect(rankedPairs([block('A'), block('B', { from: ['A'] })]).size).toBe(0)
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

  it('skips a pair with no entry that applies', () => {
    expect(pairOf([block('A', { list: [extra, blk('ghost')] }), block('B', { from: ['A'] })])).toBeUndefined()
  })

  it('skips an entry naming an area: the consumer stays unlisted', () => {
    const blocks = [block('A', { list: [{ kind: 'block', blockId: 'B', areaId: 'x' }, blk('C')] }), block('B', { from: ['A'] }), block('C', { from: ['A'] })]
    const pair = pairOf(blocks)!
    expect(ids(pair.listed)).toEqual(['C'])
    expect(pair.unlisted.map(u => u.blockId)).toEqual(['B'])
  })

  it('gives no pair for a list of area entries only', () => {
    expect(pairOf([block('A', { list: [{ kind: 'block', blockId: 'B', areaId: 'x' }] }), block('B', { from: ['A'] })])).toBeUndefined()
  })

  it('keeps the entries and their order whatever tied and share say', () => {
    const plain = [block('A', { products: [['plate', 5]], list: [blk('B'), blk('C'), extra] }), block('B', { from: ['A'] }), block('C', { from: ['A'] })]
    const flagged = [
      block('A', { products: [['plate', 5]], list: [{ ...blk('B'), share: 3 }, { ...blk('C'), tied: true, share: 1 }, { kind: 'extra', tied: true, share: 5 }] }),
      block('B', { from: ['A'] }),
      block('C', { from: ['A'] }),
    ]
    expect(ids(pairOf(flagged)!.listed)).toEqual(ids(pairOf(plain)!.listed))
  })

  describe('groups', () => {
    const flags = (entries: RankedEntry[]) => entries.map(e => e.tied === true)
    const weights = (entries: RankedEntry[]) => entries.map(e => e.weight)
    const pairFor = (list: ServedEntry[], extraRate?: number, consumers = ['B', 'C', 'D']) =>
      pairOf([block('A', { ...(extraRate !== undefined ? { products: [['plate', extraRate] as [string, number]] } : {}), list }), ...consumers.map(id => block(id, { from: ['A'] }))])
    const tiedTo = (id: string, share?: number): ServedEntry => ({ ...blk(id), tied: true, ...(share !== undefined ? { share } : {}) })
    const shared = (id: string, share: number): ServedEntry => ({ ...blk(id), share })

    it('R1 marks the members after a head', () => {
      const pair = pairFor([blk('B'), tiedTo('C'), blk('D')])!
      expect(ids(pair.listed)).toEqual(['B', 'C', 'D'])
      expect(flags(pair.listed)).toEqual([false, true, false])
      expect(weights(pair.listed)).toEqual([undefined, undefined, undefined])
    })
    it('R2 carries the stored shares as weights', () => {
      expect(weights(pairFor([shared('B', 80), tiedTo('C', 20)])!.listed)).toEqual([80, 20])
    })
    it('R3 counts a member without a share as the mean', () => {
      expect(weights(pairFor([shared('B', 60), tiedTo('C')])!.listed)).toEqual([50, 50])
    })
    it('R4 normalises a partial group', () => {
      const w = weights(pairFor([shared('B', 60), tiedTo('C', 30), tiedTo('D')])!.listed)
      expect(w[0]).toBeCloseTo(44.444, 2)
      expect(w[1]).toBeCloseTo(22.222, 2)
      expect(w[2]).toBeCloseTo(33.333, 2)
    })
    it('R5 promotes the first follower of a skipped head', () => {
      const pair = pairFor([blk('ghost'), tiedTo('C'), tiedTo('D')])!
      expect(ids(pair.listed)).toEqual(['C', 'D'])
      expect(flags(pair.listed)).toEqual([false, true])
    })
    it('R6 keeps the group when a middle member is skipped', () => {
      const pair = pairFor([blk('B'), tiedTo('ghost'), tiedTo('C')])!
      expect(ids(pair.listed)).toEqual(['B', 'C'])
      expect(flags(pair.listed)).toEqual([false, true])
    })
    it('R7 lets a lone survivor lose tied and share', () => {
      const pair = pairFor([shared('B', 5), tiedTo('ghost')])!
      expect(ids(pair.listed)).toEqual(['B'])
      expect(flags(pair.listed)).toEqual([false])
      expect(weights(pair.listed)).toEqual([undefined])
    })
    it('R8 keeps the extra in a group only when it applies', () => {
      expect(flags(pairFor([blk('B'), { kind: 'extra', tied: true }], 5)!.listed)).toEqual([false, true])
      const none = pairFor([blk('B'), { kind: 'extra', tied: true }], 0)!
      expect(ids(none.listed)).toEqual(['B'])
      expect(flags(none.listed)).toEqual([false])
    })
    it('R9 leaves an area head out and the follower becomes a head', () => {
      const pair = pairFor([{ kind: 'block', blockId: 'B', areaId: 'x' }, tiedTo('C')])!
      expect(ids(pair.listed)).toEqual(['C'])
      expect(flags(pair.listed)).toEqual([false])
      expect(pair.unlisted.map(u => u.blockId)).toEqual(['B', 'D'])
    })
    it('R10 drops a repeat', () => {
      const pair = pairFor([blk('B'), tiedTo('C'), tiedTo('B')])!
      expect(ids(pair.listed)).toEqual(['B', 'C'])
      expect(flags(pair.listed)).toEqual([false, true])
    })
    it('R11 keeps the ratio of a group that loses a member', () => {
      const w = weights(pairFor([shared('B', 60), tiedTo('C', 30), tiedTo('ghost', 10)])!.listed)
      expect(w[0]).toBeCloseTo(66.67, 1)
      expect(w[1]).toBeCloseTo(33.33, 1)
    })
    it('R12 adds no key to a list without tied', () => {
      const pair = pairFor([blk('B'), blk('C')])!
      expect(pair.listed).toEqual([
        { kind: 'block', blockId: 'B', connection: { id: 'B-c0', itemId: 'plate', fromBlockId: 'A' } },
        { kind: 'block', blockId: 'C', connection: { id: 'C-c0', itemId: 'plate', fromBlockId: 'A' } },
      ])
      for (const e of pair.listed) expect(Object.keys(e).sort()).toEqual(['blockId', 'connection', 'kind'])
    })
  })

  describe('area entries', () => {
    /** `b` with sub-factories `areas` (each an area) under its root, whose id is `root-<id>`. */
    const withAreas = (b: Block, areas: string[]): Block => ({
      ...b,
      rootPlan: { ...b.rootPlan, subPlans: areas.map(id => ({ id, name: id, nodes: [], subPlans: [], area: true })) },
    } as unknown as Block)
    const area = (blockId: string, areaId: string, over: Partial<ServedEntry> = {}): ServedEntry => ({ kind: 'block', blockId, areaId, ...over })
    const areaIds = (entries: RankedEntry[]) => entries.map(e => (e.kind === 'block' ? e.areaId : undefined))
    const setup = (list: ServedEntry[], areas: string[] | null = ['L', 'B']) => [
      block('A', { list }),
      areas ? withAreas(block('H', { from: ['A'] }), areas) : block('H', { from: ['A'] }),
      block('S', { from: ['A'] }),
    ]

    it('applies when the consumer has that area', () => {
      const pair = pairOf(setup([blk('S'), area('H', 'B'), area('H', 'L')]))!
      expect(ids(pair.listed)).toEqual(['S', 'H', 'H'])
      expect(areaIds(pair.listed)).toEqual([undefined, 'B', 'L'])
      const h = pair.listed[1]
      expect(h.kind === 'block' && h.connection.id).toBe('H-c0')
    })
    it('does not apply for an unknown area id', () => {
      expect(ids(pairOf(setup([blk('S'), area('H', 'ghost')]))!.listed)).toEqual(['S'])
    })
    it('does not apply when the consumer has no areas', () => {
      expect(ids(pairOf(setup([blk('S'), area('H', 'L')], null))!.listed)).toEqual(['S'])
    })
    it('takes the root id as an area when the block has areas', () => {
      expect(areaIds(pairOf(setup([blk('S'), area('H', 'root-H')]))!.listed)).toEqual([undefined, 'root-H'])
    })
    it('lists a consumer named only by area entries and keeps its block entry unlisted, flagged areaNamed', () => {
      const pair = pairOf(setup([area('H', 'L'), area('H', 'B')]))!
      expect(ids(pair.listed)).toEqual(['H', 'H'])
      expect(pair.unlisted.map(u => [u.blockId, u.areaNamed])).toEqual([['H', true], ['S', undefined]])
    })
    it('keeps an area entry and a block entry of one block, and drops a repeated area entry', () => {
      const pair = pairOf(setup([area('H', 'B'), blk('H'), area('H', 'B'), blk('H')]))!
      expect(areaIds(pair.listed)).toEqual(['B', undefined])
      expect(pair.unlisted.map(u => [u.blockId, u.areaNamed])).toEqual([['S', undefined]])
    })
    it('keeps the flag and the weight of a tied area entry in a group', () => {
      const pair = pairOf(setup([blk('S'), area('H', 'L', { share: 25 }), area('H', 'B', { tied: true, share: 75 })]))!
      expect(pair.listed.map(e => [e.kind === 'block' && e.areaId, e.tied === true, e.weight])).toEqual([[undefined, false, undefined], ['L', false, 25], ['B', true, 75]])
    })
  })

  it('ranks each item of a source on its own', () => {
    const a = block('A', { list: [blk('B')] })
    a.servedOrder = { plate: [blk('B')], gear: [blk('B')] }
    const pairs = rankedPairs([a, block('B', { from: ['A'] })])
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

describe('grantByRank groups', () => {
  const entry = (id: string): RankedEntry => ({ kind: 'block', blockId: id, connection: { id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' } })
  const tied = (e: RankedEntry, weight?: number): RankedEntry => ({ ...e, tied: true, ...(weight !== undefined ? { weight } : {}) })
  const weighted = (e: RankedEntry, weight: number): RankedEntry => ({ ...e, weight })
  const shares: Record<string, number> = { 'c-B': 30, 'c-C': 20, 'c-D': 10 }
  const shareOf = (id: string) => shares[id] ?? 0
  const B = entry('B'), C = entry('C'), D = entry('D')
  const got = (g: Map<string, number>, id: string) => g.get(`c-${id}`)!

  it('U1 splits the rest evenly and hands a covered member spare on', () => {
    const { grants, held } = grantByRank(45, [B, tied(C), tied(D)], 0, shareOf)
    expect(got(grants, 'B')).toBeCloseTo(17.5, 9)
    expect(got(grants, 'C')).toBeCloseTo(17.5, 9)
    expect(got(grants, 'D')).toBeCloseTo(10, 9)
    expect(held).toBeCloseTo(45, 9)
    expect(grants.size).toBe(3)
  })
  it('U2 splits by weight', () => {
    const { grants, held } = grantByRank(45, [B, weighted(C, 80), tied(D, 20)], 0, shareOf)
    expect(got(grants, 'B')).toBeCloseTo(30, 9)
    expect(got(grants, 'C')).toBeCloseTo(12, 9)
    expect(got(grants, 'D')).toBeCloseTo(3, 9)
    expect(held).toBeCloseTo(45, 9)
  })
  it('U3 gives the spare to the heavier member', () => {
    const { grants, held } = grantByRank(40, [weighted(C, 80), tied(D, 20)], 0, shareOf)
    expect(got(grants, 'C')).toBeCloseTo(20, 9)
    expect(got(grants, 'D')).toBeCloseTo(10, 9)
    expect(held).toBeCloseTo(30, 9)
  })
  it('U4 ignores weights on a group of one', () => {
    const { grants, held } = grantByRank(45, [weighted(B, 50), weighted(C, 50)], 0, shareOf)
    expect(got(grants, 'B')).toBe(30)
    expect(got(grants, 'C')).toBe(15)
    expect(held).toBe(45)
  })
  it('U5 treats the extra as a member', () => {
    const order = [B, C, tied({ kind: 'extra' })]
    const a = grantByRank(45, order, 10, shareOf)
    expect(got(a.grants, 'B')).toBeCloseTo(30, 9)
    expect(got(a.grants, 'C')).toBeCloseTo(7.5, 9)
    expect(a.grants.size).toBe(2)
    expect(a.held).toBeCloseTo(45, 9)
    const b = grantByRank(100, order, 10, shareOf)
    expect(got(b.grants, 'B')).toBeCloseTo(30, 9)
    expect(got(b.grants, 'C')).toBeCloseTo(20, 9)
    expect(b.held).toBeCloseTo(60, 9)
  })
  it('U6 gives nothing to members with no share', () => {
    const { grants, held } = grantByRank(45, [B, tied(C)], 0, () => 0)
    expect([got(grants, 'B'), got(grants, 'C'), held]).toEqual([0, 0, 0])
  })
  it('U7 gives nothing from no offer', () => {
    for (const offer of [0, -5]) {
      const { grants, held } = grantByRank(offer, [B, tied(C)], 0, shareOf)
      expect([got(grants, 'B'), got(grants, 'C'), held]).toEqual([0, 0, 0])
    }
  })
  it('U8 repeats passes until everyone is covered or the rest is gone', () => {
    const s: Record<string, number> = { 'c-a': 10, 'c-b': 40, 'c-c': 45, 'c-d': 100 }
    const { grants, held } = grantByRank(150, [entry('a'), tied(entry('b')), tied(entry('c')), tied(entry('d'))], 0, id => s[id] ?? 0)
    expect(got(grants, 'a')).toBeCloseTo(10, 9)
    expect(got(grants, 'b')).toBeCloseTo(40, 9)
    expect(got(grants, 'c')).toBeCloseTo(45, 9)
    expect(got(grants, 'd')).toBeCloseTo(55, 9)
    expect(held).toBeCloseTo(150, 9)
  })
  it('U9 serves a group that holds a take in list order', () => {
    const order = [B, tied(C)]
    const all = grantByRank(45, order, 0, shareOf, () => true)
    expect([got(all.grants, 'B'), got(all.grants, 'C')]).toEqual([30, 15])
    for (const isTake of [undefined, () => false]) {
      const g = grantByRank(45, order, 0, shareOf, isTake)
      expect(got(g.grants, 'B')).toBeCloseTo(25, 9)
      expect(got(g.grants, 'C')).toBeCloseTo(20, 9)
    }
    const one = grantByRank(45, order, 0, shareOf, id => id === 'c-C')
    expect([got(one.grants, 'B'), got(one.grants, 'C')]).toEqual([30, 15])
  })
  it('U10 treats a first entry marked tied as a head', () => {
    const { grants } = grantByRank(45, [tied(B), C], 0, shareOf)
    expect([got(grants, 'B'), got(grants, 'C')]).toEqual([30, 15])
  })
  it('U11 uses equal weights when not every member has one', () => {
    const { grants } = grantByRank(30, [weighted(B, 80), tied(C)], 0, shareOf)
    expect(got(grants, 'B')).toBeCloseTo(15, 9)
    expect(got(grants, 'C')).toBeCloseTo(15, 9)
  })
  it('U12 is bit-identical to the sequential loop for lists without tied', () => {
    const old = (offer: number, order: readonly RankedEntry[], extraRate: number) => {
      const total = Math.max(0, offer)
      let rest = total
      const grants = new Map<string, number>()
      for (const e of order) {
        const amount = Math.min(e.kind === 'extra' ? extraRate : Math.max(0, shareOf(e.connection.id)), rest)
        if (e.kind === 'block') grants.set(e.connection.id, amount)
        rest -= amount
      }
      return { grants, held: total - rest }
    }
    const orders = [[B, C, D], [C, { kind: 'extra' } as RankedEntry, B, D], [weighted(B, 20), weighted(C, 80), D]]
    for (const offer of [0, 7, 45, 100, 0.1 + 0.2, 1e-9]) {
      for (const order of orders) {
        const now = grantByRank(offer, order, 10.1, shareOf)
        const was = old(offer, order, 10.1)
        expect(now.grants).toEqual(was.grants)
        expect(now.held).toBe(was.held)
      }
    }
  })
})

describe('grantByRank with areas', () => {
  const conn = (id: string) => ({ id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' })
  const part = (id: string, p: number, extra: Partial<Extract<RankedEntry, { kind: 'block' }>> = {}): RankedEntry =>
    ({ kind: 'block', blockId: id, connection: conn(id), areaId: id === 'H' ? undefined : id, part: p, ...extra })
  const shareOf = (id: string) => (id === 'c-H' ? 20 : id === 'c-S' ? 30 : 0)
  const H1 = part('H', 0.4, { areaId: 'B' }), H2 = part('H', 0.6, { areaId: 'L' })

  it('asks the share times the part, and sums the grants of one connection', () => {
    const rich = grantByRank(100, [H1, H2], 0, shareOf)
    expect(rich.entryGrants).toEqual([8, 12])
    expect(rich.grants.get('c-H')).toBe(20)
    const poor = grantByRank(10, [H1, H2], 0, shareOf)
    expect(poor.entryGrants).toEqual([8, 2])
    expect(poor.grants.get('c-H')).toBe(10)
    expect([...poor.grants.keys()]).toEqual(['c-H'])
    expect(poor.held).toBe(10)
  })
  it('asks the share times the part of two connections', () => {
    const shares: Record<string, number> = { 'c-B': 20, 'c-L': 20 }
    const { entryGrants } = grantByRank(100, [part('B', 0.4), part('L', 0.6)], 0, id => shares[id] ?? 0)
    expect(entryGrants).toEqual([8, 12])
  })
  it('lists the grant of each entry in order, the extra included', () => {
    const { entryGrants, grants } = grantByRank(100, [H1, { kind: 'extra' }, H2], 5, shareOf)
    expect(entryGrants).toEqual([8, 5, 12])
    expect(grants.get('c-H')).toBe(20)
  })
  it('lists the grants of a group and of a group that holds a take', () => {
    const group = [H1, { ...H2, tied: true as const }]
    expect(grantByRank(10, group, 0, shareOf).entryGrants).toEqual([5, 5])
    expect(grantByRank(10, group, 0, shareOf, () => true).entryGrants).toEqual([8, 2])
    expect(grantByRank(10, group, 0, shareOf, () => true).grants.get('c-H')).toBe(10)
  })
  it('gives entryGrants parallel to the order when no entry has a part', () => {
    const e = (id: string): RankedEntry => ({ kind: 'block', blockId: id, connection: conn(id) })
    const { grants, entryGrants } = grantByRank(40, [e('S'), e('H')], 0, shareOf)
    expect(entryGrants).toEqual([30, 10])
    expect([...grants.values()]).toEqual(entryGrants)
  })
})

describe('servedRankOf', () => {
  it('lists a block once when several entries name it', () => {
    const b = (id: string, areaId?: string): RankedEntry => ({ kind: 'block', blockId: id, connection: { id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' }, ...(areaId ? { areaId } : {}) })
    expect(servedRankOf([b('H', 'B'), b('S'), b('H', 'L')])).toEqual({ blockIds: ['H', 'S'], extraPlace: 2 })
  })
  it('places the extra among the blocks', () => {
    const b = (id: string): RankedEntry => ({ kind: 'block', blockId: id, connection: { id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' } })
    expect(servedRankOf([b('B'), { kind: 'extra' }, b('C')])).toEqual({ blockIds: ['B', 'C'], extraPlace: 1 })
    expect(servedRankOf([b('B'), b('C')])).toEqual({ blockIds: ['B', 'C'], extraPlace: 2 })
    expect(servedRankOf([{ kind: 'extra' }, b('B')])).toEqual({ blockIds: ['B'], extraPlace: 0 })
  })
})

describe('waterFill', () => {
  it.each([
    ['W1', 30, [10, 25], undefined, [10, 20]],
    ['W2', 30, [20, 25], [20, 80], [6, 24]],
    ['W3', 30, [20, 12], undefined, [18, 12]],
    ['W4', 25, [30, 10], undefined, [15, 10]],
    ['W5', 100, [10, 20], undefined, [10, 20]],
    ['W6', 0, [5, 5], undefined, [0, 0]],
    ['W7', 30, [0, 25], undefined, [0, 25]],
    ['W8', 30, [25, 20], [1, 2], [10, 20]],
  ] as Array<[string, number, number[], number[] | undefined, number[]]>)('%s: waterFill(%d, %j, %j) = %j', (_name, room, shares, weights, want) => {
    const got = waterFill(room, shares, weights)
    expect(got).toHaveLength(want.length)
    want.forEach((w, i) => expect(got[i], `member ${i}`).toBeCloseTo(w, 9))
  })
})
