import { describe, it, expect } from 'vitest'
import {
  canConnect, offeredRate, takeCandidates, requestCandidates, requestBlockerTitle, connectableItems, productChangeEffects,
} from './connections'
import { makeEmptyBlock } from './blockStore'
import type { Block, ConnectionFlow, SolverResult } from '../data/types'

function block(id: string, opts: { products?: string[]; from?: [string, string][] } = {}): Block {
  return {
    ...makeEmptyBlock(id),
    id,
    products: (opts.products ?? []).map(itemId => ({ id: `g-${id}-${itemId}`, itemId, extraRate: 60 })),
    inputConnections: (opts.from ?? []).map(([itemId, source]) => ({ id: `${id}<${source}:${itemId}`, itemId, fromBlockId: source })),
  }
}

/** A result in which the block makes `produces` and still needs `needs` from outside (items/min). */
function result(produces: Record<string, number> = {}, needs: Record<string, number> = {}): SolverResult {
  return {
    nodes: [{
      recipeNodeId: 'n', inputRates: {}, outputRates: produces,
      throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
    }],
    unsatisfied: Object.entries(needs).map(([itemId, rate]) => ({ itemId, rate })),
    warnings: [],
  }
}

const flow = (over: Partial<ConnectionFlow>): ConnectionFlow => ({
  connectionId: 'c', fromBlockId: 'S', toBlockId: 'T', itemId: 'plate', available: 0, capped: false, rate: 0, status: 'ok', kind: 'take', ...over,
})

describe('canConnect', () => {
  const target = block('T', { products: ['gear'] })
  const blocks = [target, block('S')]

  it('accepts a valid connection', () => {
    expect(canConnect(blocks, target, 'plate', 'S')).toBe(true)
  })

  it('rejects an unknown source and a self-connection', () => {
    expect(canConnect(blocks, target, 'plate', 'ghost')).toBe(false)
    expect(canConnect(blocks, target, 'plate', 'T')).toBe(false)
  })

  it('rejects a duplicate', () => {
    const t = block('T', { from: [['plate', 'S']] })
    expect(canConnect([t, block('S')], t, 'plate', 'S')).toBe(false)
    expect(canConnect([t, block('S')], t, 'gear', 'S')).toBe(true)
  })

  it('accepts a connection that closes a loop', () => {
    const t = block('T')
    const s = block('S', { from: [['plate', 'T']] })
    expect(canConnect([t, s], t, 'plate', 'S')).toBe(true)
  })

  it('rejects a product of the target', () => {
    expect(canConnect(blocks, target, 'gear', 'S')).toBe(false)
  })
})

describe('offeredRate', () => {
  it('is the net balance minus what flows already deliver', () => {
    const results = { S: result({ plate: 100 }) }
    const flows = [
      flow({ rate: 30 }),
      flow({ connectionId: 'c2', rate: 20, toBlockId: 'U' }),
      flow({ connectionId: 'c3', rate: 99, itemId: 'gear' }),
      flow({ connectionId: 'c4', rate: 99, fromBlockId: 'X' }),
    ]
    expect(offeredRate('S', 'plate', results, flows)).toBe(50)
  })

  it('never goes negative when flows add up to more than the source offers', () => {
    expect(offeredRate('S', 'plate', { S: result({ plate: 10 }) }, [flow({ rate: 30 })])).toBe(0)
  })

  it('is 0 without a result', () => {
    expect(offeredRate('S', 'plate', {}, [])).toBe(0)
  })
})

describe('takeCandidates', () => {
  it('lists the blocks that can supply the item, in plan order, with their offer', () => {
    const blocks = [block('S1'), block('T'), block('S2')]
    const results = { S1: result({ plate: 10 }), S2: result({ plate: 20 }), T: result() }
    expect(takeCandidates(blocks, 'T', 'plate', results, []).map(c => [c.block.id, c.offered]))
      .toEqual([['S1', 10], ['S2', 20]])
  })

  it('excludes connected and empty-handed sources, and flags the ones that close a loop', () => {
    const blocks = [
      block('T', { from: [['plate', 'Done']] }),
      block('Done'),
      block('Down', { from: [['plate', 'T']] }),
      block('Empty'),
    ]
    const results = { Done: result({ plate: 10 }), Down: result({ plate: 10 }), Empty: result({ plate: 1e-9 }) }
    expect(takeCandidates(blocks, 'T', 'plate', results, []).map(c => [c.block.id, c.offered, c.closesLoop]))
      .toEqual([['Down', 10, true]])
  })

  it('offers nothing for a product of the target', () => {
    const blocks = [block('T', { products: ['plate'] }), block('S')]
    expect(takeCandidates(blocks, 'T', 'plate', { S: result({ plate: 10 }) }, [])).toEqual([])
  })
})

describe('takeCandidates — products', () => {
  it('excludes a block that has the item as a product even when it has some left over', () => {
    const blocks = [block('S', { products: ['plate'] }), block('T'), block('Plain')]
    const results = { S: result({ plate: 10 }), Plain: result({ plate: 10 }), T: result() }
    expect(takeCandidates(blocks, 'T', 'plate', results, []).map(c => c.block.id)).toEqual(['Plain'])
  })
})

describe('requestCandidates', () => {
  it('lists the blocks that have the item as a product, whatever they offer', () => {
    const blocks = [block('S1', { products: ['plate'] }), block('T'), block('Plain'), block('S2', { products: ['plate', 'gear'] })]
    expect(requestCandidates(blocks, 'T', 'plate').map(c => [c.block.id, c.closesLoop, c.blocker]))
      .toEqual([['S1', false, undefined], ['S2', false, undefined]])
  })

  it('excludes connected blocks and the target itself', () => {
    const blocks = [
      block('T', { products: ['gear'], from: [['plate', 'Done']] }),
      block('Done', { products: ['plate'] }),
      block('Free', { products: ['plate'] }),
    ]
    expect(requestCandidates(blocks, 'T', 'plate').map(c => c.block.id)).toEqual(['Free'])
    expect(requestCandidates([block('T', { products: ['plate'] })], 'T', 'plate')).toEqual([])
  })

  it('blocks a source that receives the item itself', () => {
    const blocks = [block('T'), block('S', { products: ['plate'], from: [['plate', 'Z']] }), block('Z')]
    const [candidate] = requestCandidates(blocks, 'T', 'plate')
    expect(candidate.blocker).toBe('source-receives')
  })

  it('allows a request that would close a cycle of requests', () => {
    const blocks = [
      block('T', { products: ['gear'] }),
      block('S', { products: ['plate'], from: [['gear', 'T']] }),
    ]
    const [candidate] = requestCandidates(blocks, 'T', 'plate')
    expect(candidate.closesLoop).toBe(true)
    expect('blocker' in candidate).toBe(false)
  })

  it('omits the blocker key when nothing blocks the request', () => {
    const [candidate] = requestCandidates([block('T'), block('S', { products: ['plate'] })], 'T', 'plate')
    expect('blocker' in candidate).toBe(false)
  })
})

describe('requestBlockerTitle', () => {
  it('words the reason with the block and item names', () => {
    expect(requestBlockerTitle('source-receives', 'S', 'Plate')).toBe('S receives Plate itself')
  })
})

describe('connectableItems', () => {
  const results = (needs: Record<string, number>) => ({
    S: result({ plate: 100, gear: 5 }),
    T: result({}, needs),
  })

  it('lists what the target imports and the source offers, in the target\'s order', () => {
    const blocks = [block('S'), block('T')]
    expect(connectableItems(blocks, 'S', 'T', results({ gear: 2, rod: 3, plate: 40 }), []))
      .toEqual([
        { itemId: 'gear', offered: 5, needed: 2, request: false },
        { itemId: 'plate', offered: 100, needed: 40, request: false },
      ])
  })

  it('skips goals, existing connections and negligible imports', () => {
    const blocks = [block('S'), block('T', { products: ['gear'], from: [['plate', 'S']] })]
    expect(connectableItems(blocks, 'S', 'T', results({ gear: 2, plate: 40 }), [])).toEqual([])
    const plain = [block('S'), block('T')]
    expect(connectableItems(plain, 'S', 'T', results({ plate: 1e-9 }), [])).toEqual([])
  })

  it('lists items across a loop', () => {
    const loop = [block('S', { from: [['plate', 'T']] }), block('T')]
    expect(connectableItems(loop, 'S', 'T', results({ plate: 40 }), []))
      .toEqual([{ itemId: 'plate', offered: 100, needed: 40, request: false }])
  })

  it('lists a product of the source even when it offers nothing, but not other items', () => {
    const blocks = [block('S', { products: ['plate'] }), block('T')]
    expect(connectableItems(blocks, 'S', 'T', { T: result({}, { plate: 40, rod: 3 }) }, []))
      .toEqual([{ itemId: 'plate', offered: 0, needed: 40, request: true }])
  })

  it('marks items the source has as a product as requests, with a blocker when one applies', () => {
    const plain = [block('S', { products: ['plate'] }), block('T')]
    expect(connectableItems(plain, 'S', 'T', results({ plate: 40 }), []))
      .toEqual([{ itemId: 'plate', offered: 100, needed: 40, request: true }])
    // S already requests gear from T; T requesting plate from S closes a cycle, which is allowed.
    const cycle = [block('S', { products: ['plate'], from: [['gear', 'T']] }), block('T', { products: ['gear'] })]
    expect(connectableItems(cycle, 'S', 'T', results({ plate: 40 }), []))
      .toEqual([{ itemId: 'plate', offered: 100, needed: 40, request: true }])
    const receives = [block('S', { products: ['plate'], from: [['plate', 'Z']] }), block('T'), block('Z')]
    expect(connectableItems(receives, 'S', 'T', results({ plate: 40 }), []))
      .toEqual([{ itemId: 'plate', offered: 100, needed: 40, request: true, blocker: 'source-receives' }])
  })

  it('is empty when the target has no result', () => {
    expect(connectableItems([block('S'), block('T')], 'S', 'T', { S: result({ plate: 1 }) }, [])).toEqual([])
  })
})

describe('productChangeEffects', () => {
  const effects = (blocks: Block[], change: 'add' | 'remove', flows: ConnectionFlow[] = [], itemId = 'plate') =>
    productChangeEffects(blocks, 'S', itemId, change, flows)
  const takeFlow = (consumer: string, rate: number, over: Partial<ConnectionFlow> = {}) =>
    flow({ connectionId: `${consumer}<S:plate`, toBlockId: consumer, rate, ...over })

  it('lists the consumers that take the item, in plan order, with their flow rates', () => {
    const blocks = [block('T2', { from: [['plate', 'S']] }), block('S'), block('T1', { from: [['plate', 'S']] })]
    expect(effects(blocks, 'add', [takeFlow('T1', 30), takeFlow('T2', 12)])).toEqual([
      { connectionId: 'T2<S:plate', consumerId: 'T2', consumerName: blocks[0].name, rate: 12 },
      { connectionId: 'T1<S:plate', consumerId: 'T1', consumerName: blocks[2].name, rate: 30 },
    ])
  })

  it('is empty when the block already has the product', () => {
    const blocks = [block('S', { products: ['plate'] }), block('T', { from: [['plate', 'S']] })]
    expect(effects(blocks, 'add')).toEqual([])
  })

  it('ignores the block\'s own connections, other items and other sources', () => {
    const blocks = [
      block('S', { from: [['plate', 'X']] }),
      block('X'),
      block('T', { from: [['gear', 'S'], ['plate', 'X'], ['plate', 'S']] }),
    ]
    expect(effects(blocks, 'add').map(e => e.connectionId)).toEqual(['T<S:plate'])
  })

  it('does not flag a consumer whose request would close a cycle of requests', () => {
    const blocks = [
      block('S', { from: [['gear', 'T']] }),
      block('T', { products: ['gear'], from: [['plate', 'S']] }),
    ]
    const [effect] = effects(blocks, 'add')
    expect(effect.consumerId).toBe('T')
    expect('blocker' in effect).toBe(false)
  })

  it('flags a consumer whose request would be ignored because the block receives the item', () => {
    const blocks = [block('S', { from: [['plate', 'Z']] }), block('Z'), block('T', { from: [['plate', 'S']] })]
    expect(effects(blocks, 'add')).toMatchObject([{ consumerId: 'T', blocker: 'source-receives' }])
  })

  it('lists the requests a removal turns into takes', () => {
    const blocks = [block('S', { products: ['plate'] }), block('T', { from: [['plate', 'S']] })]
    const list = effects(blocks, 'remove', [takeFlow('T', 30, { kind: 'request', requested: 30 })])
    expect(list).toEqual([{ connectionId: 'T<S:plate', consumerId: 'T', consumerName: blocks[1].name, rate: 30 }])
    expect('blocker' in list[0]).toBe(false)
  })

  it('skips connections whose request was already ignored', () => {
    const blocks = [block('S', { products: ['plate'] }), block('T', { from: [['plate', 'S']] })]
    expect(effects(blocks, 'remove', [takeFlow('T', 0, { requestIgnored: 'request-loop' })])).toEqual([])
  })

  it('is empty on removal while another product of the item remains', () => {
    const s = block('S', { products: ['plate'] })
    s.products.push({ id: 'second', itemId: 'plate' })
    expect(effects([s, block('T', { from: [['plate', 'S']] })], 'remove')).toEqual([])
  })

  it('leaves the rate undefined without a flow, and is empty for an unknown block', () => {
    const blocks = [block('S'), block('T', { from: [['plate', 'S']] })]
    expect(effects(blocks, 'add')[0].rate).toBeUndefined()
    expect(productChangeEffects(blocks, 'ghost', 'plate', 'add', [])).toEqual([])
  })
})
