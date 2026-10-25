import { orderBlocks } from '../solver/blockGraph'
import type { Block } from '../data/types'

// ---------------------------------------------------------------------------
// Block graph layout — layered, deterministic, recomputed on every change.
// A column is the longest chain of sources feeding a block, not counting the
// back connections of loops; one barycenter pass orders the rows. A back
// connection is drawn in its own lane under the blocks it spans. Positions
// are never saved.
// ---------------------------------------------------------------------------

export const NODE_W = 200
export const NODE_H = 64
export const COL_GAP = 160
export const ROW_GAP = 40
/** Footprint reserved for one connection chip, and the minimum space between stacked labels. */
export const LABEL_W = 120
export const LABEL_CHIP_H = 28
export const LABEL_GAP = 4
/** An edge with more connections than this shows one summary chip instead of one chip each. */
export const MAX_EDGE_CHIPS = 3
/** Horizontal reach of a forward edge's control points. */
export const EDGE_CURVE = 48
/** Horizontal reach of a back edge's corners, and the space kept between a back lane and what it passes under. */
export const BACK_CURVE = 32
export const BACK_LANE_GAP = 12

export interface BlockNodeLayout {
  id: string
  column: number
  row: number
  x: number
  y: number
}

export interface BlockEdgeLayout {
  from: string
  to: string
  /** Connections of this (source, consumer) pair, in the consumer's order. */
  connectionIds: string[]
  /** More than MAX_EDGE_CHIPS connections: the edge shows one summary chip, not one chip per connection. */
  collapsed: boolean
  /** Some connection of the pair joins two members of one loop. */
  loop: boolean
  /** The pair is a loop's back connection: the source comes later in the loop's order than the consumer. */
  back: boolean
  /** From the source's right-middle to the consumer's left-middle. */
  x1: number
  y1: number
  x2: number
  y2: number
  /**
   * Centre of the label stack (one chip per connection, or one summary chip when collapsed): in the gutter just before the
   * consumer's column, or, for a back edge, on its lane.
   */
  labelX: number
  labelY: number
  /** Back edges only: the y of the lane the edge runs along under the blocks. */
  laneY?: number
}

export interface BlockGraphLayout {
  nodes: Record<string, BlockNodeLayout>
  edges: BlockEdgeLayout[]
  width: number
  height: number
}

interface Pair {
  from: string
  to: string
  connectionIds: string[]
  loop: boolean
  back: boolean
}

/** Height of an edge's label stack: one chip per connection, or a single summary chip when collapsed. */
export function labelStackHeight(e: Pick<BlockEdgeLayout, 'connectionIds' | 'collapsed'>): number {
  return (e.collapsed ? 1 : e.connectionIds.length) * LABEL_CHIP_H
}

export function layoutBlockGraph(blocks: Block[]): BlockGraphLayout {
  if (blocks.length === 0) return { nodes: {}, edges: [], width: 0, height: 0 }

  const index = new Map(blocks.map((b, i) => [b.id, i]))
  const { order, components } = orderBlocks(blocks)
  const loopConnectionIds = new Set(components.flatMap(c => c.loop?.connectionIds ?? []))
  const backConnectionIds = new Set(components.flatMap(c => c.loop?.backConnectionIds ?? []))

  // Group connections by (source, consumer); unknown sources and self-connections get no edge.
  const pairs: Pair[] = []
  const pairByKey = new Map<string, Pair>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!index.has(c.fromBlockId) || c.fromBlockId === b.id) continue
      const key = `${c.fromBlockId}>${b.id}`
      let pair = pairByKey.get(key)
      if (!pair) {
        pair = { from: c.fromBlockId, to: b.id, connectionIds: [], loop: false, back: false }
        pairByKey.set(key, pair)
        pairs.push(pair)
      }
      pair.connectionIds.push(c.id)
      if (loopConnectionIds.has(c.id)) pair.loop = true
      if (backConnectionIds.has(c.id)) pair.back = true
    }
  }

  // Longest path over the forward pairs, walking sources before consumers.
  const column = new Map(blocks.map(b => [b.id, 0]))
  const incoming = new Map<string, string[]>()
  for (const p of pairs) {
    if (p.back) continue
    const list = incoming.get(p.to)
    if (list) list.push(p.from)
    else incoming.set(p.to, [p.from])
  }
  for (const b of order) {
    for (const from of incoming.get(b.id) ?? []) {
      column.set(b.id, Math.max(column.get(b.id)!, column.get(from)! + 1))
    }
  }

  // Rows: array order per column, then one barycenter pass from column 1 rightwards.
  const maxCol = Math.max(...column.values())
  const columns: string[][] = Array.from({ length: maxCol + 1 }, () => [])
  for (const b of blocks) columns[column.get(b.id)!].push(b.id)
  const row = new Map<string, number>()
  columns[0].forEach((id, r) => row.set(id, r))
  for (let col = 1; col <= maxCol; col++) {
    const current = new Map(columns[col].map((id, r) => [id, r]))
    const key = (id: string) => {
      const preds = incoming.get(id)
      if (!preds) return current.get(id)!
      return preds.reduce((sum, p) => sum + row.get(p)!, 0) / preds.length
    }
    columns[col].sort((a, b) =>
      key(a) - key(b) || current.get(a)! - current.get(b)! || index.get(a)! - index.get(b)!)
    columns[col].forEach((id, r) => row.set(id, r))
  }

  const nodes: Record<string, BlockNodeLayout> = {}
  for (const b of blocks) {
    const col = column.get(b.id)!
    const r = row.get(b.id)!
    nodes[b.id] = { id: b.id, column: col, row: r, x: col * (NODE_W + COL_GAP), y: r * (NODE_H + ROW_GAP) }
  }

  const edges: BlockEdgeLayout[] = pairs.map(p => ({
    from: p.from,
    to: p.to,
    connectionIds: p.connectionIds,
    collapsed: p.connectionIds.length > MAX_EDGE_CHIPS,
    loop: p.loop,
    back: p.back,
    x1: nodes[p.from].x + NODE_W,
    y1: nodes[p.from].y + NODE_H / 2,
    x2: nodes[p.to].x,
    y2: nodes[p.to].y + NODE_H / 2,
    labelX: 0,
    labelY: 0,
  }))

  // Labels sit in the gutter before the consumer's column, which holds no node, on the
  // straight line between the endpoints; labels sharing a gutter are pushed apart.
  const stackH = labelStackHeight
  const byGutter = new Map<number, BlockEdgeLayout[]>()
  for (const e of edges) {
    if (e.back) continue
    e.labelX = e.x2 - COL_GAP / 2
    const t = e.x2 === e.x1 ? 1 : (e.labelX - e.x1) / (e.x2 - e.x1)
    e.labelY = e.y1 + (e.y2 - e.y1) * t
    const list = byGutter.get(e.x2)
    if (list) list.push(e)
    else byGutter.set(e.x2, [e])
  }
  let labelsTop = 0
  let labelsBottom = 0
  for (const list of byGutter.values()) {
    list.sort((a, b) => a.labelY - b.labelY) // stable: ties keep pair order
    for (let i = 1; i < list.length; i++) {
      const min = list[i - 1].labelY + (stackH(list[i - 1]) + stackH(list[i])) / 2 + LABEL_GAP
      if (list[i].labelY < min) list[i].labelY = min
    }
    for (const e of list) {
      labelsTop = Math.min(labelsTop, e.labelY - stackH(e) / 2)
      labelsBottom = Math.max(labelsBottom, e.labelY + stackH(e) / 2)
    }
  }

  // Back edges run along a lane under every block and forward label in the columns they
  // span, one lane below another when their spans overlap.
  const colStep = NODE_W + COL_GAP
  const placed: { left: number; right: number; bottom: number }[] = []
  for (const e of edges) {
    if (!e.back) continue
    const lo = Math.min(nodes[e.from].column, nodes[e.to].column)
    const hi = Math.max(nodes[e.from].column, nodes[e.to].column)
    const left = lo * colStep - COL_GAP
    const right = hi * colStep + NODE_W
    let spanBottom = 0
    for (const n of Object.values(nodes)) {
      if (n.column >= lo && n.column <= hi) spanBottom = Math.max(spanBottom, n.y + NODE_H)
    }
    for (const f of edges) {
      if (f.back || f.labelX < left || f.labelX > right) continue
      spanBottom = Math.max(spanBottom, f.labelY + stackH(f) / 2)
    }
    let top = spanBottom + BACK_LANE_GAP
    for (const p of placed) {
      if (p.left <= right && p.right >= left) top = Math.max(top, p.bottom + BACK_LANE_GAP)
    }
    placed.push({ left, right, bottom: top + stackH(e) })
    e.labelX = (e.x1 + e.x2) / 2
    e.labelY = top + stackH(e) / 2
    e.laneY = e.labelY
    labelsBottom = Math.max(labelsBottom, top + stackH(e))
  }

  // A tall stack on a top-row edge reaches above the first row: move everything down so
  // it stays inside the layout (the viewport cannot scroll to negative coordinates).
  const shift = -labelsTop
  if (shift > 0) {
    for (const n of Object.values(nodes)) n.y += shift
    for (const e of edges) {
      e.y1 += shift
      e.y2 += shift
      e.labelY += shift
      if (e.laneY !== undefined) e.laneY += shift
    }
    labelsBottom += shift
  }

  const maxRows = Math.max(...columns.map(c => c.length))
  return {
    nodes,
    edges,
    width: (maxCol + 1) * (NODE_W + COL_GAP) - COL_GAP + (edges.some(e => e.back) ? BACK_CURVE : 0),
    height: Math.max(maxRows * (NODE_H + ROW_GAP) - ROW_GAP + shift, labelsBottom),
  }
}

/**
 * SVG path of an edge. A forward edge is one cubic curve. A back edge leaves the
 * source's right side, drops to its lane, runs left under the blocks and rises into
 * the consumer's left side; its corners reach BACK_CURVE past both ends, so it
 * overhangs the layout by BACK_CURVE (the graph's padding leaves room for that).
 */
export function edgePath(e: BlockEdgeLayout): string {
  const { x1, y1, x2, y2 } = e
  if (e.back && e.laneY !== undefined) {
    const lane = e.laneY
    return `M ${x1} ${y1} C ${x1 + BACK_CURVE} ${y1}, ${x1 + BACK_CURVE} ${lane}, ${x1} ${lane} ` +
      `L ${x2} ${lane} C ${x2 - BACK_CURVE} ${lane}, ${x2 - BACK_CURVE} ${y2}, ${x2} ${y2}`
  }
  return `M ${x1} ${y1} C ${x1 + EDGE_CURVE} ${y1}, ${x2 - EDGE_CURVE} ${y2}, ${x2} ${y2}`
}
