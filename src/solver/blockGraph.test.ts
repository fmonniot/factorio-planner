import { describe, it, expect } from 'vitest'
import { closesLoop, closesPullLoop, orderBlocks } from './blockGraph'
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

describe('closesPullLoop', () => {
  /** Like `block`, but every connection pulls. */
  const puller = (id: string, from: string[] = []): Block => {
    const b = block(id, from)
    return { ...b, inputConnections: b.inputConnections.map(c => ({ ...c, pull: true as const })) }
  }

  it('is true for the reverse of a direct pull', () => {
    // B pulls from A; A pulling from B would make a cycle.
    expect(closesPullLoop([puller('A'), puller('B', ['A'])], 'B', 'A')).toBe(true)
  })

  it('is true through a chain of pulls', () => {
    const blocks = [puller('A'), puller('B', ['A']), puller('C', ['B'])]
    expect(closesPullLoop(blocks, 'C', 'A')).toBe(true)
  })

  it('is false when the reverse connection only pushes', () => {
    expect(closesPullLoop([puller('A'), block('B', ['A'])], 'B', 'A')).toBe(false)
  })

  it('is false for a second source, a self-connection and a missing source', () => {
    const blocks = [puller('A'), puller('B', ['A']), puller('C')]
    expect(closesPullLoop(blocks, 'C', 'B')).toBe(false)
    expect(closesPullLoop(blocks, 'A', 'A')).toBe(false)
    expect(closesPullLoop([puller('A', ['ghost']), puller('B', ['A'])], 'B', 'A')).toBe(true)
    expect(closesPullLoop([puller('A', ['ghost']), puller('B')], 'ghost', 'A')).toBe(false)
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

  it('orders loop members topologically so only the cycle-closing connection runs back', () => {
    // E→A, E→T, A→T, E→F, F→T, T→E: breadth-first would put T before F and make F→T a back connection.
    const { components } = orderBlocks([block('E', ['T']), block('A', ['E']), block('T', ['E', 'A', 'F']), block('F', ['E'])])
    expect(components[0].loop?.blockIds).toEqual(['E', 'A', 'F', 'T'])
    expect(components[0].loop?.backConnectionIds).toEqual(['E<T'])
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
