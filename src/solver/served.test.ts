import { describe, expect, it } from 'vitest'
import type { Block, ConnectionFlow } from '../data/types'
import { buildServed } from './served'
import type { AreaReport } from './servedAreas'
import type { RankedEntry } from './servedRank'

function flow(over: Partial<ConnectionFlow> = {}): ConnectionFlow {
  return {
    connectionId: 'c1', fromBlockId: 'A', toBlockId: 'B', itemId: 'plate', available: 10, capped: false, rate: 10,
    status: 'ok', kind: 'request', ...over,
  }
}

function block(id: string, products: [string, number | undefined][] = []): Block {
  return {
    id, name: id, color: '#60a5fa',
    products: products.map(([itemId, extraRate], i) => ({ id: `p${i}`, itemId, ...(extraRate !== undefined ? { extraRate } : {}) })),
    sourceRules: {}, inputConnections: [],
    rootPlan: { id: `root-${id}`, name: 'root', nodes: [], subPlans: [] },
  } as unknown as Block
}

const none = new Map<string, Map<string, number>>()
const shareOf = (id: string) => (id === 'c2' ? 7 : 3)

describe('buildServed', () => {
  it('follows the order of the flows', () => {
    const served = buildServed(
      [flow({ connectionId: 'c2', toBlockId: 'C', rate: 4 }), flow({ connectionId: 'c1', toBlockId: 'B', rate: 6, kind: 'take' })],
      [block('A')], shareOf, none,
    )
    expect(served.A.plate.consumers).toEqual([
      { blockId: 'C', connectionId: 'c2', kind: 'request', share: 7, got: 4 },
      { blockId: 'B', connectionId: 'c1', kind: 'take', share: 3, got: 6 },
    ])
    expect(served.A.plate.extra).toBeUndefined()
  })

  it('reports need and notCredited on takes only, from takeInfo', () => {
    const served = buildServed(
      [flow({ connectionId: 'c1', toBlockId: 'B', kind: 'take', rate: 0 }), flow({ connectionId: 'c2', toBlockId: 'C' }), flow({ connectionId: 'c3', toBlockId: 'D', kind: 'take' })],
      [block('A')], shareOf, none, undefined,
      { needs: new Map([['c1', 8], ['c2', 5]]), uncredited: new Set(['c1', 'c2']) },
    )
    const [b, c, d] = served.A.plate.consumers
    expect(b).toMatchObject({ need: 8, notCredited: true })
    expect(c.need).toBeUndefined()
    expect(c.notCredited).toBeUndefined()
    expect(d.need).toBeUndefined()
    expect(d.notCredited).toBeUndefined()
  })

  it('reports groupInListOrder on takes from takeInfo, never on requests', () => {
    const served = buildServed(
      [flow({ connectionId: 'c1', toBlockId: 'B', kind: 'take', rate: 0 }), flow({ connectionId: 'c2', toBlockId: 'C' }), flow({ connectionId: 'c3', toBlockId: 'D', kind: 'take' })],
      [block('A')], shareOf, none, undefined,
      { needs: new Map(), uncredited: new Set(['c1']), inListOrder: new Set(['c1', 'c2']) },
    )
    const [b, c, d] = served.A.plate.consumers
    expect(b).toMatchObject({ notCredited: true, groupInListOrder: true })
    expect(c, 'a request never carries it').not.toHaveProperty('groupInListOrder')
    expect(d, 'a take outside the set does not').not.toHaveProperty('groupInListOrder')
  })

  it('leaves need and notCredited absent without takeInfo', () => {
    const served = buildServed([flow({ kind: 'take' })], [block('A')], shareOf, none)
    expect(served.A.plate.consumers[0]).not.toHaveProperty('need')
    expect(served.A.plate.consumers[0]).not.toHaveProperty('notCredited')
  })

  it('lists a consumer block once, under its first connection', () => {
    const served = buildServed([flow(), flow({ connectionId: 'c2', rate: 0 })], [block('A')], shareOf, none)
    expect(served.A.plate.consumers.map(c => c.connectionId)).toEqual(['c1'])
  })

  it('skips self and missing-source flows', () => {
    const served = buildServed(
      [flow({ status: 'self' }), flow({ connectionId: 'c2', status: 'missing-source', fromBlockId: 'ghost' }), flow({ connectionId: 'c3', fromBlockId: 'X', status: 'unused', rate: 0 })],
      [block('A'), block('X')], shareOf, none,
    )
    expect(Object.keys(served)).toEqual(['X'])
  })

  it('adds the extra last when the source has an extra output of the item', () => {
    const consumers = [flow(), flow({ connectionId: 'c2', toBlockId: 'C' })]
    const a = block('A', [['plate', 5], ['plate', 2], ['gear', 9]])
    const left = (n: number | undefined) => new Map([['A', new Map(n === undefined ? [] : [['plate', n]])]])
    expect(buildServed(consumers, [a], shareOf, left(3)).A.plate.extra).toEqual({ place: 2, asked: 7, got: 3 })
    expect(buildServed(consumers, [a], shareOf, left(100)).A.plate.extra).toEqual({ place: 2, asked: 7, got: 7 })
    expect(buildServed(consumers, [a], shareOf, left(undefined)).A.plate.extra).toEqual({ place: 2, asked: 7, got: 0 })
  })

  it('has no extra without a positive extra rate', () => {
    const served = buildServed([flow()], [block('A', [['plate', 0], ['plate', undefined]])], shareOf, none)
    expect(served.A.plate.extra).toBeUndefined()
  })

  it('orders a ranked pair by its list and puts the extra at its place', () => {
    const consumers = [flow(), flow({ connectionId: 'c2', toBlockId: 'C' })]
    const a = block('A', [['plate', 5]])
    const left = new Map([['A', new Map([['plate', 4]])]])
    const rankOf = (source: string, item: string) => (source === 'A' && item === 'plate' ? { blockIds: ['C', 'B'], extraPlace: 1 } : undefined)
    const served = buildServed(consumers, [a], shareOf, left, rankOf)
    expect(served.A.plate.consumers.map(c => c.blockId)).toEqual(['C', 'B'])
    expect(served.A.plate.extra).toEqual({ place: 1, asked: 5, got: 4 })
  })

  it('puts a consumer the rank does not name after the ranked ones, and caps the place', () => {
    const consumers = [flow({ toBlockId: 'X' }), flow({ connectionId: 'c2', toBlockId: 'C' }), flow({ connectionId: 'c3', toBlockId: 'B' })]
    const a = block('A', [['plate', 5]])
    const served = buildServed(consumers, [a], shareOf, none, () => ({ blockIds: ['B', 'C'], extraPlace: 7 }))
    expect(served.A.plate.consumers.map(c => c.blockId)).toEqual(['B', 'C', 'X'])
    expect(served.A.plate.extra?.place).toBe(3)
  })

  it('an unranked pair keeps the flow order and the extra last', () => {
    const consumers = [flow({ toBlockId: 'C' }), flow({ connectionId: 'c2', toBlockId: 'B' })]
    const served = buildServed(consumers, [block('A', [['plate', 5]])], shareOf, none, () => undefined)
    expect(served.A.plate.consumers.map(c => c.blockId)).toEqual(['C', 'B'])
    expect(served.A.plate.extra?.place).toBe(2)
  })

  it('gives {} for no flows and is safe for odd item ids', () => {
    expect(buildServed([], [block('A')], shareOf, none)).toEqual({})
    const served = buildServed([flow({ itemId: 'constructor' })], [block('A')], shareOf, none)
    expect(Object.entries(served.A).map(([item, list]) => [item, list.consumers.length])).toEqual([['constructor', 1]])
  })

  describe('with an area report', () => {
    const conn = (id: string) => ({ id, itemId: 'plate', fromBlockId: 'A' })
    const entry = (blockId: string, id: string, extra: Partial<Extract<RankedEntry, { kind: 'block' }>> = {}): RankedEntry =>
      ({ kind: 'block', blockId, connection: conn(id), ...extra })
    const flows = () => [flow({ rate: 15 }), flow({ connectionId: 'c2', toBlockId: 'C', rate: 4 })]
    const share = (id: string) => (id === 'c1' ? 20 : 7)
    const a = () => block('A', [['plate', 5]])
    const left = new Map([['A', new Map([['plate', 4]])]])
    const rankOf = () => ({ blockIds: ['B', 'C'], extraPlace: 1 })
    const report = (entries: RankedEntry[], granted: number[], needs: Record<string, { areaId: string; need: number }[]> = {}): AreaReport => ({
      needsOf: id => needs[id] ?? [],
      entriesOf: () => ({ entries, granted }),
    })
    const HB = entry('B', 'c1', { areaId: 'B', areas: [{ areaId: 'B', need: 8 }], total: 20, part: 0.4 })
    const Hrest = entry('B', 'c1', { areas: [{ areaId: 'L', need: 12 }], total: 20, part: 0.6 })

    it('reports one line per entry, in entry order, with the area and the place of the extra among the lines', () => {
      const entries = [HB, { kind: 'extra' } as RankedEntry, entry('C', 'c2'), Hrest]
      const served = buildServed(flows(), [a()], share, left, rankOf, undefined, report(entries, [8, 3, 4, 7]))
      const list = served.A.plate
      expect(list.consumers.map(c => [c.blockId, c.areaId, c.share, c.got])).toEqual([['B', 'B', 8, 8], ['C', undefined, 7, 4], ['B', 'L', 12, 7]])
      expect(list.consumers[1]).not.toHaveProperty('areaId')
      expect(list.extra).toEqual({ place: 1, asked: 5, got: 4 })
    })
    it('gives the old output when there is no report, or the entries split nothing', () => {
      const plain = buildServed(flows(), [a()], share, left, rankOf)
      const unsplit = report([entry('B', 'c1'), entry('C', 'c2'), { kind: 'extra' }], [15, 4, 0])
      expect(buildServed(flows(), [a()], share, left, rankOf, undefined, unsplit)).toEqual(plain)
      expect(buildServed(flows(), [a()], share, left, rankOf, undefined, { needsOf: () => [], entriesOf: () => undefined })).toEqual(plain)
    })
  })
})
