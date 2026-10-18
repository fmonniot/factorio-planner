import { describe, it, expect } from 'vitest'
import { layoutBlockGraph, NODE_W, NODE_H, COL_GAP, ROW_GAP } from './blockGraphLayout'
import { makeEmptyBlock } from '../store/blockStore'
import type { Block } from '../data/types'

/** Block `id` receiving one connection per entry of `from` (connection ids are `${id}<${source}:${item}`). */
function block(id: string, from: (string | [string, string])[] = []): Block {
  return {
    ...makeEmptyBlock(id),
    id,
    inputConnections: from.map(f => {
      const [source, itemId] = typeof f === 'string' ? [f, 'plate'] : f
      return { id: `${id}<${source}:${itemId}`, itemId, fromBlockId: source }
    }),
  }
}

describe('layoutBlockGraph', () => {
  it('returns an empty layout for an empty plan', () => {
    expect(layoutBlockGraph([])).toEqual({ nodes: {}, edges: [], width: 0, height: 0 })
  })

  it('places a single block at the origin', () => {
    const layout = layoutBlockGraph([block('A')])
    expect(layout.nodes.A).toEqual({ id: 'A', column: 0, row: 0, x: 0, y: 0 })
    expect(layout.width).toBe(NODE_W)
    expect(layout.height).toBe(NODE_H)
  })

  it('puts a chain in consecutive columns', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['B'])])
    expect(['A', 'B', 'C'].map(id => layout.nodes[id].column)).toEqual([0, 1, 2])
  })

  it('uses the longest path for the column', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['B', 'A'])])
    expect(layout.nodes.C.column).toBe(2)
  })

  it('merges several connections between the same pair into one edge', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A', ['A', 'gear']])])
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0].connectionIds).toEqual(['B<A:plate', 'B<A:gear'])
  })

  it('draws no edge for an unknown source or a self-connection', () => {
    const layout = layoutBlockGraph([block('A', ['ghost', 'A']), block('B')])
    expect(layout.edges).toEqual([])
    expect(Object.keys(layout.nodes)).toEqual(['A', 'B'])
  })

  it('lays out a cycle and flags its edges', () => {
    const layout = layoutBlockGraph([block('A', ['B']), block('B', ['A'])])
    expect(Object.keys(layout.nodes)).toHaveLength(2)
    expect(layout.edges).toHaveLength(2)
    expect(layout.edges.every(e => e.cyclic)).toBe(true)
  })

  it('orders a column by the rows of its sources', () => {
    // B (row 1) feeds C and A (row 0) feeds D, so D goes above C.
    const layout = layoutBlockGraph([block('A'), block('B'), block('C', ['B']), block('D', ['A'])])
    expect(layout.nodes.D.row).toBe(0)
    expect(layout.nodes.C.row).toBe(1)
  })

  it('stacks disconnected blocks in column 0 in plan order', () => {
    const layout = layoutBlockGraph([block('A'), block('B'), block('C')])
    expect(['A', 'B', 'C'].map(id => [layout.nodes[id].column, layout.nodes[id].row])).toEqual([[0, 0], [0, 1], [0, 2]])
  })

  it('derives coordinates and size from the node grid', () => {
    const layout = layoutBlockGraph([block('A'), block('B'), block('C', ['A'])])
    expect(layout.nodes.C).toMatchObject({ x: NODE_W + COL_GAP, y: 0 })
    expect(layout.nodes.B).toMatchObject({ x: 0, y: NODE_H + ROW_GAP })
    expect(layout.edges[0]).toMatchObject({
      x1: NODE_W, y1: NODE_H / 2, x2: NODE_W + COL_GAP, y2: NODE_H / 2,
    })
    expect(layout.width).toBe(2 * NODE_W + COL_GAP)
    expect(layout.height).toBe(2 * NODE_H + ROW_GAP)
  })

  it('is deterministic', () => {
    const blocks = [block('A'), block('B', ['A']), block('C', ['A', 'B']), block('D')]
    expect(layoutBlockGraph(blocks)).toEqual(layoutBlockGraph(blocks))
  })
})
