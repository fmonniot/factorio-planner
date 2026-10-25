import { describe, it, expect } from 'vitest'
import { canConnect, offeredRate, sourceCandidates, connectableItems, isGoalItem } from './connections'
import { makeEmptyBlock } from './blockStore'
import type { Block, ConnectionFlow, SolverResult } from '../data/types'

function block(id: string, opts: { goals?: string[]; from?: [string, string][] } = {}): Block {
  return {
    ...makeEmptyBlock(id),
    id,
    goals: (opts.goals ?? []).map(itemId => ({ id: `g-${id}-${itemId}`, itemId, rate: 60 })),
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
  connectionId: 'c', fromBlockId: 'S', toBlockId: 'T', itemId: 'plate', available: 0, capped: false, rate: 0, status: 'ok', ...over,
})

describe('isGoalItem', () => {
  it('is true only for the block\'s own goals', () => {
    const b = block('T', { goals: ['gear'] })
    expect(isGoalItem(b, 'gear')).toBe(true)
    expect(isGoalItem(b, 'plate')).toBe(false)
  })
})

describe('canConnect', () => {
  const target = block('T', { goals: ['gear'] })
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

  it('rejects a goal item of the target', () => {
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

describe('sourceCandidates', () => {
  it('lists the blocks that can supply the item, in plan order, with their offer', () => {
    const blocks = [block('S1'), block('T'), block('S2')]
    const results = { S1: result({ plate: 10 }), S2: result({ plate: 20 }), T: result() }
    expect(sourceCandidates(blocks, 'T', 'plate', results, []).map(c => [c.block.id, c.offered]))
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
    expect(sourceCandidates(blocks, 'T', 'plate', results, []).map(c => [c.block.id, c.offered, c.closesLoop]))
      .toEqual([['Down', 10, true]])
  })

  it('offers nothing for a goal item of the target', () => {
    const blocks = [block('T', { goals: ['plate'] }), block('S')]
    expect(sourceCandidates(blocks, 'T', 'plate', { S: result({ plate: 10 }) }, [])).toEqual([])
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
        { itemId: 'gear', offered: 5, needed: 2 },
        { itemId: 'plate', offered: 100, needed: 40 },
      ])
  })

  it('skips goals, existing connections and negligible imports', () => {
    const blocks = [block('S'), block('T', { goals: ['gear'], from: [['plate', 'S']] })]
    expect(connectableItems(blocks, 'S', 'T', results({ gear: 2, plate: 40 }), [])).toEqual([])
    const plain = [block('S'), block('T')]
    expect(connectableItems(plain, 'S', 'T', results({ plate: 1e-9 }), [])).toEqual([])
  })

  it('lists items across a loop', () => {
    const loop = [block('S', { from: [['plate', 'T']] }), block('T')]
    expect(connectableItems(loop, 'S', 'T', results({ plate: 40 }), []))
      .toEqual([{ itemId: 'plate', offered: 100, needed: 40 }])
  })

  it('is empty when the target has no result', () => {
    expect(connectableItems([block('S'), block('T')], 'S', 'T', { S: result({ plate: 1 }) }, [])).toEqual([])
  })
})
