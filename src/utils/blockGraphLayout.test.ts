import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  layoutBlockGraph, edgePath, fitScale, NODE_W, NODE_H, COL_GAP, ROW_GAP, BACK_CURVE, BACK_LANE_TOP, BACK_LANE_GAP,
  DUMMY_H, ISO_GAP, ISO_TOP, GRAPH_PAD,
} from './blockGraphLayout'
import type { BlockEdgeLayout, BlockGraphLayout, Point } from './blockGraphLayout'
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

interface Rect { l: number; r: number; t: number; b: number }
const nodeRect = (n: { x: number; y: number }): Rect => ({ l: n.x, r: n.x + NODE_W, t: n.y, b: n.y + NODE_H })
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
const strictlyInside = (p: Point, r: Rect) => p.x > r.l && p.x < r.r && p.y > r.t && p.y < r.b

/** The vertices of an edge and 20 samples of each cubic segment of its drawn path. */
function sampleEdge(e: BlockEdgeLayout): Point[] {
  const nums = edgePath(e).match(/[MCL]|-?\d+(?:\.\d+)?/g)!
  const pts: Point[] = [...e.points]
  let cur: Point = { x: 0, y: 0 }
  let i = 0
  const read = (): Point => ({ x: Number(nums[i++]), y: Number(nums[i++]) })
  while (i < nums.length) {
    const cmd = nums[i++]
    if (cmd === 'M' || cmd === 'L') {
      cur = read()
    } else {
      const p1 = read()
      const p2 = read()
      const p3 = read()
      for (let s = 1; s < 20; s++) {
        const t = s / 20
        const u = 1 - t
        pts.push({
          x: u ** 3 * cur.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
          y: u ** 3 * cur.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
        })
      }
      cur = p3
    }
  }
  return pts
}

const nodeRects = (layout: BlockGraphLayout) => Object.values(layout.nodes).map(nodeRect)

/** Seeded pseudo-random plan of `n` blocks with forward and backward connections. */
function randomPlan(n: number, seed: number): Block[] {
  let s = seed
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const ids = Array.from({ length: n }, (_, i) => `b${i}`)
  return ids.map(id => {
    const from: [string, string][] = []
    for (const other of ids) {
      if (other !== id && rnd() < 3 / n) from.push([other, 'plate'], ...(rnd() < 0.3 ? [[other, 'gear'] as [string, string]] : []))
    }
    return block(id, from)
  })
}

describe('layoutBlockGraph on the 15-block real plan', () => {
  const FIXTURE = 'initiatives/archive/block-graph-scale/real-plan.layout.json'
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    blocks: { id: string; name: string; connections: { id: string; itemId: string; fromBlockId: string }[] }[]
  }
  const blocks: Block[] = fixture.blocks.map(b => ({
    ...makeEmptyBlock(b.name),
    id: b.id,
    inputConnections: b.connections.map(c => ({ ...c })),
  }))
  const layout = layoutBlockGraph(blocks)
  const idOf = (name: string) => fixture.blocks.find(b => b.name === name)!.id
  const nodes = Object.values(layout.nodes)

  it('has the shape of the plan', () => {
    expect(nodes).toHaveLength(15)
    expect(layout.edges).toHaveLength(46)
    expect(layout.edges.reduce((s, e) => s + e.connectionIds.length, 0)).toBe(140)
    expect(nodes.filter(n => n.isolated)).toHaveLength(1)
    expect(new Set(nodes.filter(n => !n.isolated).map(n => n.column)).size).toBe(8)
  })

  it('leaves at most 6 edges running right to left', () => {
    expect(layout.edges.filter(e => e.back).length).toBeLessThanOrEqual(6)
  })

  it('marks an edge back exactly when it does not advance a column, consistently with the order', () => {
    const pos = new Map(layout.order.map((id, i) => [id, i]))
    for (const e of layout.edges) {
      const back = layout.nodes[e.from].column >= layout.nodes[e.to].column
      expect(e.back, `${e.from}>${e.to}`).toBe(back)
      if (pos.get(e.from)! < pos.get(e.to)!) expect(e.back).toBe(false)
    }
  })

  it('puts Sciences after Ores and Metals, with no edge into it running back', () => {
    const sciences = layout.nodes[idOf('Sciences')]
    expect(sciences.column).toBeGreaterThan(layout.nodes[idOf('Ores')].column)
    expect(sciences.column).toBeGreaterThan(layout.nodes[idOf('Metals')].column)
    for (const e of layout.edges.filter(e => e.to === idOf('Sciences'))) expect(e.back).toBe(false)
  })

  it('never overlaps two blocks', () => {
    const rects = nodeRects(layout)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false)
  })

  it('draws no edge point inside a block', () => {
    const rects = nodeRects(layout)
    for (const e of layout.edges) {
      for (const p of sampleEdge(e)) {
        for (const r of rects) expect(strictlyInside(p, r), `${e.from}>${e.to} at ${p.x},${p.y}`).toBe(false)
      }
    }
  })

  it('attaches edges to the sides of their blocks and runs forward ones left to right', () => {
    for (const e of layout.edges) {
      const from = layout.nodes[e.from]
      const to = layout.nodes[e.to]
      const start = e.points[0]
      const end = e.points[e.points.length - 1]
      expect(start.x).toBe(from.x + NODE_W)
      expect(end.x).toBe(to.x)
      expect(start.y).toBeGreaterThan(from.y)
      expect(start.y).toBeLessThan(from.y + NODE_H)
      expect(end.y).toBeGreaterThan(to.y)
      expect(end.y).toBeLessThan(to.y + NODE_H)
      if (e.back) expect(end.x).toBeLessThanOrEqual(start.x)
      else for (let i = 1; i < e.points.length; i++) expect(e.points[i].x).toBeGreaterThanOrEqual(e.points[i - 1].x)
      if (!e.back) expect(end.x).toBeGreaterThan(start.x)
    }
  })

  it('spreads the edges of one side of a block over distinct ports', () => {
    for (const n of nodes) {
      const out = layout.edges.filter(e => e.from === n.id).map(e => e.points[0].y)
      const inn = layout.edges.filter(e => e.to === n.id).map(e => e.points[e.points.length - 1].y)
      expect(new Set(out).size, `${n.id} out`).toBe(out.length)
      expect(new Set(inn).size, `${n.id} in`).toBe(inn.length)
    }
  })

  it('anchors chips outside every block', () => {
    const rects = nodeRects(layout)
    for (const e of layout.edges) for (const r of rects) expect(strictlyInside(e.chip, r), `${e.from}>${e.to}`).toBe(false)
  })

  it('places the isolated block below every block and lane', () => {
    const [iso] = nodes.filter(n => n.isolated)
    const lowest = Math.max(
      ...nodes.filter(n => !n.isolated).map(n => n.y + NODE_H),
      ...layout.edges.flatMap(e => e.points.map(p => p.y)),
    )
    expect(iso.y).toBeGreaterThanOrEqual(lowest + ISO_TOP)
  })

  it('keeps everything inside the layout and its padding', () => {
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + NODE_W).toBeLessThanOrEqual(layout.width)
      expect(n.y + NODE_H).toBeLessThanOrEqual(layout.height)
    }
    for (const e of layout.edges) {
      for (const p of sampleEdge(e)) {
        expect(p.x).toBeGreaterThanOrEqual(-GRAPH_PAD)
        expect(p.x).toBeLessThanOrEqual(layout.width + GRAPH_PAD)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(layout.height)
      }
    }
  })

  it('gives the same layout for the same input and for a copy of it', () => {
    expect(layoutBlockGraph(blocks)).toEqual(layout)
    expect(layoutBlockGraph(structuredClone(blocks))).toEqual(layout)
  })
})

describe('layoutBlockGraph', () => {
  it('returns an empty layout for an empty plan', () => {
    expect(layoutBlockGraph([])).toEqual({ nodes: {}, edges: [], width: 0, height: 0, order: [] })
  })

  it('places a single block in the strip at the origin', () => {
    const layout = layoutBlockGraph([block('A')])
    expect(layout.nodes.A).toEqual({ id: 'A', column: -1, row: 0, x: 0, y: 0, isolated: true })
    expect(layout.width).toBe(NODE_W)
    expect(layout.height).toBe(NODE_H)
    expect(layout.order).toEqual(['A'])
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

  it('draws no edge for an unknown source or a self-connection, and treats those blocks as isolated', () => {
    const layout = layoutBlockGraph([block('A', ['ghost', 'A']), block('B')])
    expect(layout.edges).toEqual([])
    expect(Object.keys(layout.nodes)).toEqual(['A', 'B'])
    expect(layout.nodes.A.isolated && layout.nodes.B.isolated).toBe(true)
  })

  it('lays out a two-block loop with the back edge in a lane under the blocks', () => {
    const layout = layoutBlockGraph([block('A', ['B']), block('B', ['A'])])
    expect([layout.nodes.A.column, layout.nodes.B.column]).toEqual([0, 1])
    const back = layout.edges.find(e => e.from === 'B')!
    const forward = layout.edges.find(e => e.from === 'A')!
    expect(forward).toMatchObject({ back: false, loop: true })
    expect(back).toMatchObject({ back: true, loop: true })
    const lane = NODE_H + BACK_LANE_TOP
    const right = 2 * NODE_W + COL_GAP
    expect(back.points).toEqual([
      { x: right, y: NODE_H / 2 }, { x: right, y: lane }, { x: 0, y: lane }, { x: 0, y: NODE_H / 2 },
    ])
    expect(back.chip).toEqual({ x: right / 2, y: lane })
    expect(layout.height).toBe(lane)
    expect(layout.width).toBe(right)
  })

  it('keeps every back edge running right to left in a loop with a fan-in', () => {
    const layout = layoutBlockGraph([block('E', ['T']), block('A', ['E']), block('T', ['E', 'A', 'F']), block('F', ['E'])])
    const back = layout.edges.filter(e => e.back)
    expect(back.map(e => e.connectionIds)).toEqual([['E<T:plate']])
    for (const e of back) expect(e.points[3].x, `${e.from} -> ${e.to}`).toBeLessThanOrEqual(e.points[0].x)
    expect(layout.nodes.F.column).toBeLessThan(layout.nodes.T.column)
  })

  it('draws a forward edge and a back edge as paths', () => {
    const forward = layoutBlockGraph([block('A'), block('B', ['A'])]).edges[0]
    const x2 = NODE_W + COL_GAP
    const mid = (NODE_W + x2) / 2
    expect(edgePath(forward)).toBe(`M ${NODE_W} ${NODE_H / 2} C ${mid} ${NODE_H / 2}, ${mid} ${NODE_H / 2}, ${x2} ${NODE_H / 2}`)
    const back = layoutBlockGraph([block('A', ['B']), block('B', ['A'])]).edges.find(e => e.back)!
    const right = 2 * NODE_W + COL_GAP
    const lane = NODE_H + BACK_LANE_TOP
    const y = NODE_H / 2
    expect(edgePath(back)).toBe(
      `M ${right} ${y} C ${right + BACK_CURVE} ${y}, ${right + BACK_CURVE} ${lane}, ${right} ${lane} ` +
      `L 0 ${lane} C ${-BACK_CURVE} ${lane}, ${-BACK_CURVE} ${y}, 0 ${y}`,
    )
  })

  it('orders a column by the rows of its sources', () => {
    // B (row 1) feeds C and A (row 0) feeds D, so D goes above C.
    const layout = layoutBlockGraph([block('A'), block('B'), block('C', ['B']), block('D', ['A'])])
    expect(layout.nodes.D.y).toBeLessThan(layout.nodes.C.y)
    expect(layout.nodes.D.row).toBe(0)
    expect(layout.nodes.C.row).toBe(1)
  })

  it('puts disconnected blocks in a strip that wraps', () => {
    const layout = layoutBlockGraph(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => block(id)))
    const cells = Object.values(layout.nodes).map(n => [n.column, n.row, n.x / (NODE_W + ISO_GAP), n.y / (NODE_H + ROW_GAP)])
    expect(cells).toEqual([[-1, 0, 0, 0], [-1, 1, 1, 0], [-1, 2, 2, 0], [-1, 3, 0, 1], [-1, 4, 1, 1], [-1, 5, 2, 1], [-1, 6, 0, 2]])
    expect(layout.width).toBe(3 * NODE_W + 2 * ISO_GAP)
    expect(layout.height).toBe(3 * NODE_H + 2 * ROW_GAP)
  })

  it('derives coordinates and size from the layers', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C')])
    expect(layout.nodes.A).toMatchObject({ column: 0, x: 0 })
    expect(layout.nodes.B).toMatchObject({ column: 1, x: NODE_W + COL_GAP })
    expect(layout.nodes.C).toMatchObject({ isolated: true, x: 0, y: NODE_H + ISO_TOP })
    expect(layout.width).toBe(2 * NODE_W + COL_GAP)
    expect(layout.height).toBe(NODE_H + ISO_TOP + NODE_H)
  })

  it('is deterministic', () => {
    const blocks = [block('A'), block('B', ['A']), block('C', ['A', 'B']), block('D')]
    expect(layoutBlockGraph(blocks)).toEqual(layoutBlockGraph(blocks))
  })

  it('exports the dependency order, isolated blocks last', () => {
    const layout = layoutBlockGraph([block('I'), block('B', ['A']), block('A'), block('J')])
    expect(layout.order).toEqual(['A', 'B', 'I', 'J'])
    expect([...layout.order].sort()).toEqual(['A', 'B', 'I', 'J'])
  })

  // The loop entry the solver picks (S here) is not what the layout wants: it chooses the order that leaves the
  // fewest edges running right to left, so S lands after O and M.
  it('lays out a loop whose entry is not the first block, so the layout set can differ from the solver\'s', () => {
    const layout = layoutBlockGraph([block('X'), block('S', ['X', 'M', 'O']), block('O', ['S']), block('M', ['O'])])
    const back = layout.edges.filter(e => e.back)
    expect(back.map(e => `${e.from}>${e.to}`)).toEqual(['S>O'])
    expect(layout.nodes.S.column).toBeGreaterThan(layout.nodes.O.column)
    expect(layout.nodes.S.column).toBeGreaterThan(layout.nodes.M.column)
  })

  it('routes an edge that skips a column through the gap, away from the block in between', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['B', 'A'])])
    const skip = layout.edges.find(e => e.from === 'A' && e.to === 'C')!
    expect(skip.points).toHaveLength(4)
    const [, d1, d2] = skip.points
    const colX = NODE_W + COL_GAP
    expect([d1.x, d2.x]).toEqual([colX, colX + NODE_W])
    const B = nodeRect(layout.nodes.B)
    expect(d1.y < B.t - DUMMY_H / 2 || d1.y > B.b + DUMMY_H / 2).toBe(true)
    for (const p of sampleEdge(skip)) expect(strictlyInside(p, B)).toBe(false)
  })

  it('orders the ports of a side like the neighbours they lead to', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['A']), block('D', ['A'])])
    const out = layout.edges.filter(e => e.from === 'A').sort((a, b) => a.points[0].y - b.points[0].y)
    const targets = out.map(e => layout.nodes[e.to].y)
    expect(targets).toEqual([...targets].sort((a, b) => a - b))
  })

  it('stacks back lanes with the shorter one above', () => {
    // Two disjoint loops, the second spanning three columns.
    const layout = layoutBlockGraph([
      block('A', ['B']), block('B', ['A']),
      block('C', ['F']), block('D', ['C']), block('E', ['D']), block('F', ['E']),
    ])
    const backs = layout.edges.filter(e => e.back)
    expect(backs).toHaveLength(2)
    const [short, long] = [...backs].sort((a, b) => (a.points[0].x - a.points[3].x) - (b.points[0].x - b.points[3].x))
    expect(long.points[1].y - short.points[1].y).toBe(BACK_LANE_GAP)
  })

  it('puts isolated blocks under the lanes', () => {
    const layout = layoutBlockGraph([block('A', ['B']), block('B', ['A']), block('I')])
    const lane = NODE_H + BACK_LANE_TOP
    expect(layout.nodes.I.y).toBe(lane + ISO_TOP)
    expect(layout.height).toBe(lane + ISO_TOP + NODE_H)
  })

  it('lays out a 40-block random plan with cycles quickly, without overlaps', () => {
    const layout = layoutBlockGraph(randomPlan(40, 7))
    const rects = nodeRects(layout)
    expect(rects).toHaveLength(40)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false)
    for (const e of layout.edges) for (const p of e.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true)
  })

  it('lays out a 120-block chain with skip connections within a bounded time', () => {
    // Every block takes several earlier ones: one long chain with many dummy vertices and segments.
    const plan = Array.from({ length: 120 }, (_, i) =>
      block(`B${i}`, [1, 2 + (i * 7) % 5, 4 + (i * 13) % 9, 8 + (i * 5) % 12, 12 + (i * 11) % 30, 20 + (i * 3) % 40].filter(k => i >= k).map(k => `B${i - k}`)))
    // Wall-clock time is noisy on a shared CI runner (the whole suite runs in parallel), so take the best of a few runs and
    // keep the budget about 6x the ~225 ms a quiet machine needs: it still catches an algorithmic blow-up (seconds), not a busy runner.
    let elapsed = Infinity
    let layout = layoutBlockGraph(plan)
    for (let run = 0; run < 3; run++) {
      const start = performance.now()
      layout = layoutBlockGraph(plan)
      elapsed = Math.min(elapsed, performance.now() - start)
    }
    expect(Object.keys(layout.nodes)).toHaveLength(120)
    expect(elapsed, `layout took ${Math.round(elapsed)} ms at best of 3`).toBeLessThan(1500)
  })

  it('keeps a bigger gap between blocks than between a block and a routed edge', () => {
    const layout = layoutBlockGraph([block('A'), block('B', ['A']), block('C', ['B', 'A']), block('D', ['A'])])
    const col1 = Object.values(layout.nodes).filter(n => n.column === 1).sort((a, b) => a.y - b.y)
    for (let i = 1; i < col1.length; i++) expect(col1[i].y - (col1[i - 1].y + NODE_H)).toBeGreaterThanOrEqual(ROW_GAP)
  })
})

describe('fitScale', () => {
  it('is bound by the width', () => expect(fitScale(1000, 500, 2000, 500)).toBe(0.5))
  it('is bound by the height', () => expect(fitScale(1000, 500, 1000, 1000)).toBe(0.5))
  it('never enlarges', () => expect(fitScale(1000, 500, 400, 200)).toBe(1))
  it('is 1 for zero sizes', () => {
    expect(fitScale(0, 500, 100, 100)).toBe(1)
    expect(fitScale(1000, 500, 0, 0)).toBe(1)
  })
})
