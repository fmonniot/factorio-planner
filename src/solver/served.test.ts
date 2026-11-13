import { describe, expect, it } from 'vitest'
import type { Block, ConnectionFlow } from '../data/types'
import { buildServed } from './served'

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

  it('gives {} for no flows and is safe for odd item ids', () => {
    expect(buildServed([], [block('A')], shareOf, none)).toEqual({})
    const served = buildServed([flow({ itemId: 'constructor' })], [block('A')], shareOf, none)
    expect(Object.entries(served.A).map(([item, list]) => [item, list.consumers.length])).toEqual([['constructor', 1]])
  })
})
