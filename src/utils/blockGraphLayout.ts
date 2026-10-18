import { orderBlocks } from '../solver/blockGraph'
import type { Block } from '../data/types'

// ---------------------------------------------------------------------------
// Block graph layout — layered, deterministic, recomputed on every change.
// A column is the longest chain of sources feeding a block; one barycenter
// pass orders the rows. Positions are never saved.
// ---------------------------------------------------------------------------

export const NODE_W = 200
export const NODE_H = 64
export const COL_GAP = 160
export const ROW_GAP = 40

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
  /** Every connection of the pair lies on a cycle (only possible in hand-edited plans). */
  cyclic: boolean
  /** From the source's right-middle to the consumer's left-middle. */
  x1: number
  y1: number
  x2: number
  y2: number
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
  cyclic: boolean
}

export function layoutBlockGraph(blocks: Block[]): BlockGraphLayout {
  if (blocks.length === 0) return { nodes: {}, edges: [], width: 0, height: 0 }

  const index = new Map(blocks.map((b, i) => [b.id, i]))
  const { order, cyclicConnectionIds } = orderBlocks(blocks)

  // Group connections by (source, consumer); unknown sources and self-connections get no edge.
  const pairs: Pair[] = []
  const pairByKey = new Map<string, Pair>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!index.has(c.fromBlockId) || c.fromBlockId === b.id) continue
      const key = `${c.fromBlockId}>${b.id}`
      let pair = pairByKey.get(key)
      if (!pair) {
        pair = { from: c.fromBlockId, to: b.id, connectionIds: [], cyclic: true }
        pairByKey.set(key, pair)
        pairs.push(pair)
      }
      pair.connectionIds.push(c.id)
      if (!cyclicConnectionIds.has(c.id)) pair.cyclic = false
    }
  }

  // Longest path over the acyclic pairs, walking sources before consumers.
  const column = new Map(blocks.map(b => [b.id, 0]))
  const incoming = new Map<string, string[]>()
  for (const p of pairs) {
    if (p.cyclic) continue
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
    cyclic: p.cyclic,
    x1: nodes[p.from].x + NODE_W,
    y1: nodes[p.from].y + NODE_H / 2,
    x2: nodes[p.to].x,
    y2: nodes[p.to].y + NODE_H / 2,
  }))

  const maxRows = Math.max(...columns.map(c => c.length))
  return {
    nodes,
    edges,
    width: (maxCol + 1) * (NODE_W + COL_GAP) - COL_GAP,
    height: maxRows * (NODE_H + ROW_GAP) - ROW_GAP,
  }
}
