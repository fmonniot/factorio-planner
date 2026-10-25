import { describe, it, expect } from 'vitest'
import { canConnect, pullBlocker, pullBlockerTitle, offeredRate, pullCandidates, sourceCandidates, connectableItems, isGoalItem } from './connections'
import { makeEmptyBlock } from './blockStore'
import type { Block, ConnectionFlow, GameData, SolverResult } from '../data/types'

function block(id: string, opts: { goals?: string[]; from?: [string, string][] } = {}): Block {
  return {
    ...makeEmptyBlock(id),
    id,
    products: (opts.goals ?? []).map(itemId => ({ id: `g-${id}-${itemId}`, itemId, extraRate: 60 })),
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

describe('pullCandidates', () => {
  const recipe = (id: string, itemId: string) => ({ id, products: [{ itemId, type: 'item', amount: 1 }], ingredients: [] })
  const gameData = { recipes: { makePlate: recipe('makePlate', 'plate'), makeGear: recipe('makeGear', 'gear') } } as unknown as GameData
  const maker = (id: string, recipeId: string, opts: Parameters<typeof block>[1] = {}, policy: 'discard' | undefined = undefined): Block => {
    const b = block(id, opts)
    return {
      ...b,
      rootPlan: {
        ...b.rootPlan,
        nodes: [{ kind: 'game-recipe', id: `n-${id}`, recipeId, modules: [], byproductPolicy: policy ? { plate: policy } : {} }],
      },
    }
  }
  const ids = (blocks: Block[], targetId = 'T') => pullCandidates(blocks, targetId, 'plate', gameData).map(b => b.id)

  it('lists producers of the item even when they offer nothing yet', () => {
    expect(ids([block('T'), maker('S', 'makePlate')])).toEqual(['S'])
  })

  it('excludes the target, non-producers, receivers of the item and discarders', () => {
    const blocks = [
      maker('T', 'makePlate'),
      maker('G', 'makeGear'),
      maker('R', 'makePlate', { from: [['plate', 'Z']] }),
      maker('Z', 'makePlate'),
      maker('D', 'makePlate', {}, 'discard'),
    ]
    expect(ids(blocks)).toEqual(['Z'])
  })

  it('excludes a block that would close a cycle of pulls and a goal item of the target', () => {
    const t = { ...maker('T', 'makeGear'), inputConnections: [] }
    const s = { ...maker('S', 'makePlate'), inputConnections: [{ id: 'c', itemId: 'gear', fromBlockId: 'T', pull: true as const }] }
    expect(ids([t, s])).toEqual([])
    expect(ids([block('T', { goals: ['plate'] }), maker('S', 'makePlate')])).toEqual([])
  })

  it('keeps plan order and ignores an unknown target', () => {
    expect(ids([maker('B', 'makePlate'), block('T'), maker('A', 'makePlate')])).toEqual(['B', 'A'])
    expect(ids([maker('A', 'makePlate')], 'ghost')).toEqual([])
  })
})

describe('pullBlocker', () => {
  const recipe = (id: string, itemId: string) => ({ id, products: [{ itemId, type: 'item', amount: 1 }], ingredients: [] })
  const gameData = { recipes: { makePlate: recipe('makePlate', 'plate'), makeGear: recipe('makeGear', 'gear') } } as unknown as GameData
  const maker = (id: string, recipeId: string, opts: Parameters<typeof block>[1] = {}): Block => {
    const b = block(id, opts)
    return {
      ...b,
      rootPlan: {
        ...b.rootPlan,
        nodes: [{ kind: 'game-recipe', id: `n-${id}`, recipeId, modules: [], byproductPolicy: {} }],
      },
    }
  }
  const blocker = (blocks: Block[], from = 'S') =>
    pullBlocker(blocks, blocks.find(b => b.id === 'T')!, 'plate', from, gameData)

  it('is undefined for a producer that receives nothing and closes no cycle', () => {
    expect(blocker([block('T'), maker('S', 'makePlate')])).toBeUndefined()
  })

  it('reports the source has no recipe for the item, or is missing', () => {
    expect(blocker([block('T'), maker('S', 'makeGear')])).toBe('no-producer')
    expect(blocker([block('T')])).toBe('no-producer')
  })

  it('reports a source that receives the item itself', () => {
    expect(blocker([block('T'), maker('S', 'makePlate', { from: [['plate', 'Z']] }), maker('Z', 'makePlate')])).toBe('source-receives')
  })

  it('reports a cycle when the source already pulls from the target', () => {
    const t = block('T', { from: [['plate', 'S']] })
    const s = maker('S', 'makePlate', { from: [['gear', 'T']] })
    s.inputConnections = s.inputConnections.map(c => ({ ...c, pull: true as const }))
    expect(blocker([t, s])).toBe('pull-loop')
  })

  it('counts a back pull the solver would ignore as a cycle (known limitation: the store has no game data)', () => {
    const s = maker('S', 'makePlate', { from: [['gear', 'T']] })
    s.inputConnections = s.inputConnections.map(c => ({ ...c, pull: true as const }))
    // T makes no gear, so S's pull would be ignored as no-producer, yet pulling plate from S is still refused.
    expect(blocker([maker('T', 'makePlate'), s])).toBe('pull-loop')
  })

  it('words each reason with the block and item names', () => {
    expect(pullBlockerTitle('pull-loop', 'S', 'T', 'Plate')).toBe('S already pulls from T, directly or through other blocks')
    expect(pullBlockerTitle('no-producer', 'S', 'T', 'Plate')).toBe('S has no recipe that makes Plate')
    expect(pullBlockerTitle('source-receives', 'S', 'T', 'Plate')).toBe('S receives Plate itself')
  })
})
