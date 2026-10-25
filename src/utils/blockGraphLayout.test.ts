import { describe, it, expect } from 'vitest'
import {
  layoutBlockGraph, edgePath, NODE_W, NODE_H, COL_GAP, ROW_GAP, LABEL_W, LABEL_CHIP_H, BACK_CURVE, BACK_LANE_GAP,
} from './blockGraphLayout'
import type { BlockEdgeLayout, BlockGraphLayout } from './blockGraphLayout'
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

  it('lays out a two-block loop with the back edge in a lane under the blocks', () => {
    const layout = layoutBlockGraph([block('A', ['B']), block('B', ['A'])])
    expect([layout.nodes.A.column, layout.nodes.B.column]).toEqual([0, 1])
    const back = layout.edges.find(e => e.from === 'B')!
    const forward = layout.edges.find(e => e.from === 'A')!
    expect(forward).toMatchObject({ back: false, loop: true })
    expect(back).toMatchObject({ back: true, loop: true })
    const laneY = NODE_H + BACK_LANE_GAP + LABEL_CHIP_H / 2
    expect(back).toMatchObject({
      x1: 2 * NODE_W + COL_GAP, x2: 0, laneY, labelY: laneY, labelX: NODE_W + COL_GAP / 2,
    })
    expect(layout.height).toBe(NODE_H + BACK_LANE_GAP + LABEL_CHIP_H)
    expect(layout.width).toBe(2 * NODE_W + COL_GAP + BACK_CURVE)
  })

  it('keeps every back edge running right to left in a loop with a fan-in', () => {
    const layout = layoutBlockGraph([block('E', ['T']), block('A', ['E']), block('T', ['E', 'A', 'F']), block('F', ['E'])])
    const back = layout.edges.filter(e => e.back)
    expect(back.map(e => e.connectionIds)).toEqual([['E<T:plate']])
    for (const e of back) expect(e.x2, `${e.from} -> ${e.to}`).toBeLessThanOrEqual(e.x1)
    expect(layout.nodes.F.column).toBeLessThan(layout.nodes.T.column)
  })

  it('draws a forward edge and a back edge as paths', () => {
    const forward = layoutBlockGraph([block('A'), block('B', ['A'])]).edges[0]
    expect(edgePath(forward)).toBe('M 200 32 C 248 32, 312 32, 360 32')
    const back = layoutBlockGraph([block('A', ['B']), block('B', ['A'])]).edges.find(e => e.back)!
    expect(edgePath(back)).toBe('M 560 32 C 592 32, 592 90, 560 90 L 0 90 C -32 90, -32 32, 0 32')
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

  describe('edge labels', () => {
    const rect = (e: BlockEdgeLayout) => {
      const h = e.connectionIds.length * LABEL_CHIP_H
      return { l: e.labelX - LABEL_W / 2, r: e.labelX + LABEL_W / 2, t: e.labelY - h / 2, b: e.labelY + h / 2 }
    }
    const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
      a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
    const inNode = (layout: BlockGraphLayout, e: BlockEdgeLayout) => {
      const r = rect(e)
      return Object.values(layout.nodes).some(n =>
        overlap(r, { l: n.x, r: n.x + NODE_W, t: n.y, b: n.y + NODE_H }))
    }

    it('anchors a label in the gutter before the consumer', () => {
      const layout = layoutBlockGraph([block('A'), block('B', ['A'])])
      expect(layout.edges[0].labelX).toBe(layout.edges[0].x2 - COL_GAP / 2)
      expect(layout.edges[0].labelY).toBe(NODE_H / 2)
    })

    it('keeps the label of an edge that skips a column out of the middle node', () => {
      const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['B', 'A'])])
      expect(layout.edges).toHaveLength(3)
      for (const e of layout.edges) expect(inNode(layout, e), `${e.from}>${e.to}`).toBe(false)
    })

    it('separates the labels of crossing edges between the same two columns', () => {
      const layout = layoutBlockGraph([block('A'), block('B'), block('C', ['A', 'B']), block('D', ['A', 'B'])])
      expect(layout.edges).toHaveLength(4)
      const rects = layout.edges.map(rect)
      for (let i = 0; i < rects.length; i++) {
        expect(inNode(layout, layout.edges[i])).toBe(false)
        for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `${i} vs ${j}`).toBe(false)
      }
      expect(layout.height).toBeGreaterThanOrEqual(Math.max(...rects.map(r => r.b)))
    })

    it('keeps a tall label stack on the top row inside the layout', () => {
      const ids = ['a', 'b', 'c', 'd', 'e']
      const layout = layoutBlockGraph([block('A'), block('B', ids.map(id => ['A', id]))])
      const [edge] = layout.edges
      expect(rect(edge).t).toBeGreaterThanOrEqual(0)
      expect(rect(edge).b).toBeLessThanOrEqual(layout.height)
      for (const n of Object.values(layout.nodes)) expect(n.y + NODE_H).toBeLessThanOrEqual(layout.height)
      expect(edge.y1).toBe(layout.nodes.A.y + NODE_H / 2)
      expect(edge.y2).toBe(layout.nodes.B.y + NODE_H / 2)
    })

    it('keeps the back label of a three-block loop out of the nodes', () => {
      const layout = layoutBlockGraph([block('M', ['O']), block('S', ['M']), block('O', ['S'])])
      expect(['M', 'S', 'O'].map(id => layout.nodes[id].column)).toEqual([0, 1, 2])
      const back = layout.edges.filter(e => e.back)
      expect(back.map(e => e.from)).toEqual(['O'])
      expect(inNode(layout, back[0])).toBe(false)
      expect(rect(back[0]).b).toBeLessThanOrEqual(layout.height)
    })

    it('stacks two back edges of one loop in separate lanes', () => {
      // A<B, A<C, B<A, C<B: A receives from B and C, both of which come later in the loop's order.
      const layout = layoutBlockGraph([block('A', ['B', 'C']), block('B', ['A']), block('C', ['B'])])
      const backs = layout.edges.filter(e => e.back)
      expect(backs).toHaveLength(2)
      const [r1, r2] = backs.map(rect)
      expect(overlap(r1, r2)).toBe(false)
      for (const e of backs) expect(inNode(layout, e)).toBe(false)
    })

    it('accounts for stacked chips of a multi-connection edge', () => {
      const layout = layoutBlockGraph([block('A'), block('B'), block('C', [['A', 'x'], ['A', 'y']]), block('D', ['B'])])
      const [r1, r2] = layout.edges.map(rect)
      expect(overlap(r1, r2)).toBe(false)
    })
  })
})
