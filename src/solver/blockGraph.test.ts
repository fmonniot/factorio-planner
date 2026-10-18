import { describe, it, expect } from 'vitest'
import { wouldCreateCycle, orderBlocks } from './blockGraph'
import type { Block } from '../data/types'
import { makeEmptyBlock } from '../store/blockStore'

/** Block `id` receives `item` from each block in `from` (connection ids are `${id}<${source}`). */
function block(id: string, from: string[] = []): Block {
  return {
    ...makeEmptyBlock(id),
    id,
    inputConnections: from.map(source => ({ id: `${id}<${source}`, itemId: 'plate', fromBlockId: source })),
  }
}

describe('wouldCreateCycle', () => {
  it('rejects a self-connection', () => {
    expect(wouldCreateCycle([block('A')], 'A', 'A')).toBe(true)
  })

  it('rejects the reverse of an existing connection', () => {
    // A → B exists; B → A would close the loop.
    expect(wouldCreateCycle([block('A'), block('B', ['A'])], 'B', 'A')).toBe(true)
  })

  it('rejects a connection that closes a longer chain', () => {
    const blocks = [block('A'), block('B', ['A']), block('C', ['B'])]
    expect(wouldCreateCycle(blocks, 'C', 'A')).toBe(true)
  })

  it('accepts a second source feeding the same consumer', () => {
    const blocks = [block('A'), block('B', ['A']), block('C')]
    expect(wouldCreateCycle(blocks, 'C', 'B')).toBe(false)
  })
})

describe('orderBlocks', () => {
  it('puts sources before their consumers', () => {
    const { order } = orderBlocks([block('B', ['A']), block('A')])
    expect(order.map(b => b.id)).toEqual(['A', 'B'])
  })

  it('keeps array order between unrelated blocks', () => {
    const { order } = orderBlocks([block('X'), block('Y'), block('Z')])
    expect(order.map(b => b.id)).toEqual(['X', 'Y', 'Z'])
  })

  it('ignores connections whose source is missing', () => {
    const { order, cyclicConnectionIds } = orderBlocks([block('B', ['ghost']), block('A')])
    expect(order.map(b => b.id)).toEqual(['B', 'A'])
    expect(cyclicConnectionIds.size).toBe(0)
  })

  it('reports hand-written cycles and still returns every block', () => {
    const { order, cyclicConnectionIds } = orderBlocks([block('A', ['B']), block('B', ['A'])])
    expect([...cyclicConnectionIds].sort()).toEqual(['A<B', 'B<A'])
    expect(order.map(b => b.id)).toEqual(['A', 'B'])
  })

  it('does not mark a connection that only hangs off a cycle', () => {
    const { order, cyclicConnectionIds } = orderBlocks([block('A', ['B']), block('B', ['A']), block('C', ['B'])])
    expect([...cyclicConnectionIds].sort()).toEqual(['A<B', 'B<A'])
    expect(order.map(b => b.id)).toEqual(['A', 'B', 'C'])
  })
})
