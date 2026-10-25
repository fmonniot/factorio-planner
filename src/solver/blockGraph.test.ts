import { describe, it, expect } from 'vitest'
import { closesLoop, closesRequestLoop, hasProduct, orderBlocks } from './blockGraph'
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

describe('hasProduct', () => {
  const withProducts = (products: Block['products']): Block => ({ ...makeEmptyBlock('A'), products })

  it('is true for a product with and without extra output', () => {
    expect(hasProduct(withProducts([{ id: 'p', itemId: 'plate', extraRate: 10 }]), 'plate')).toBe(true)
    expect(hasProduct(withProducts([{ id: 'p', itemId: 'plate' }]), 'plate')).toBe(true)
  })

  it('is false for another item', () => {
    expect(hasProduct(withProducts([{ id: 'p', itemId: 'gear' }]), 'plate')).toBe(false)
  })
})

describe('closesRequestLoop', () => {
  /** Like `block`, but it also has `plate` as a product, so connections to it are requests. */
  const maker = (id: string, from: string[] = []): Block => ({
    ...block(id, from),
    products: [{ id: `${id}-plate`, itemId: 'plate' }],
  })

  it('is true for the reverse of a direct request', () => {
    // B requests from A; A requesting from B would make a cycle.
    expect(closesRequestLoop([maker('A'), block('B', ['A'])], 'B', 'A')).toBe(true)
  })

  it('is true through a chain of requests', () => {
    const blocks = [maker('A'), maker('B', ['A']), block('C', ['B'])]
    expect(closesRequestLoop(blocks, 'C', 'A')).toBe(true)
  })

  it('is false when the reverse connection only takes existing output', () => {
    expect(closesRequestLoop([block('A'), block('B', ['A'])], 'B', 'A')).toBe(false)
  })

  it('is false for a second source, a self-connection and a missing source', () => {
    const blocks = [maker('A'), block('B', ['A']), maker('C')]
    expect(closesRequestLoop(blocks, 'C', 'B')).toBe(false)
    expect(closesRequestLoop(blocks, 'A', 'A')).toBe(false)
    expect(closesRequestLoop([maker('A', ['ghost']), block('B', ['A'])], 'B', 'A')).toBe(true)
    expect(closesRequestLoop([maker('A', ['ghost']), block('B')], 'ghost', 'A')).toBe(false)
    expect(closesRequestLoop([maker('A', ['A']), block('B')], 'A', 'B')).toBe(false)
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
