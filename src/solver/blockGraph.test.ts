import { describe, it, expect } from 'vitest'
import { closesLoop, orderBlocks } from './blockGraph'
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

describe('closesLoop', () => {
  it('is false for a self-connection (rejected elsewhere)', () => {
    expect(closesLoop([block('A')], 'A', 'A')).toBe(false)
  })

  it('is true for the reverse of an existing connection', () => {
    // A → B exists; B → A would close the loop.
    expect(closesLoop([block('A'), block('B', ['A'])], 'B', 'A')).toBe(true)
  })

  it('is true for a connection that closes a longer chain', () => {
    const blocks = [block('A'), block('B', ['A']), block('C', ['B'])]
    expect(closesLoop(blocks, 'C', 'A')).toBe(true)
  })

  it('is false for a second source feeding the same consumer', () => {
    const blocks = [block('A'), block('B', ['A']), block('C')]
    expect(closesLoop(blocks, 'C', 'B')).toBe(false)
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
    const { order, components, selfConnectionIds } = orderBlocks([block('B', ['ghost']), block('A')])
    expect(order.map(b => b.id)).toEqual(['B', 'A'])
    expect(selfConnectionIds.size).toBe(0)
    expect(components.every(c => c.loop === undefined)).toBe(true)
  })

  it('has no loop in an acyclic plan', () => {
    const { components } = orderBlocks([block('B', ['A']), block('A'), block('C', ['A', 'B'])])
    expect(components.every(c => c.loop === undefined)).toBe(true)
  })

  it('groups two blocks that supply each other into a loop', () => {
    const { order, components } = orderBlocks([block('A', ['B']), block('B', ['A'])])
    expect(order.map(b => b.id)).toEqual(['A', 'B'])
    expect(components).toHaveLength(1)
    expect(components[0].loop).toEqual({
      blockIds: ['A', 'B'],
      connectionIds: ['A<B', 'B<A'],
      backConnectionIds: ['A<B'],
    })
  })

  it('starts a loop at the member that receives from outside it', () => {
    const { order, components } = orderBlocks([
      block('A', ['C']),
      block('B', ['A']),
      block('C', ['B', 'X']),
      block('X'),
    ])
    expect(order.map(b => b.id)).toEqual(['X', 'C', 'A', 'B'])
    expect(components[1].loop).toEqual({
      blockIds: ['C', 'A', 'B'],
      connectionIds: ['C<B', 'A<C', 'B<A'],
      backConnectionIds: ['C<B'],
    })
  })

  it('keeps a block that only hangs off a loop out of it', () => {
    const { order, components } = orderBlocks([block('A', ['B']), block('B', ['A']), block('C', ['B'])])
    expect(order.map(b => b.id)).toEqual(['A', 'B', 'C'])
    expect(components).toHaveLength(2)
    expect(components[0].loop?.blockIds).toEqual(['A', 'B'])
    expect(components[1].loop).toBeUndefined()
  })

  it('reports a self-connection and does not make a loop of it', () => {
    const { order, components, selfConnectionIds } = orderBlocks([block('A', ['A'])])
    expect([...selfConnectionIds]).toEqual(['A<A'])
    expect(order.map(b => b.id)).toEqual(['A'])
    expect(components[0].loop).toBeUndefined()
  })
})
