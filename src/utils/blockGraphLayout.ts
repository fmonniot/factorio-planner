import { orderBlocks } from '../solver/blockGraph'
import type { Block } from '../data/types'

// ---------------------------------------------------------------------------
// Block graph layout — layered, deterministic, recomputed on every change.
// Blocks are ordered to leave as few connections as possible running against
// the order (Eades-Lin-Smyth, then local moves); a column is the longest path
// over the connections that run with it. A connection that skips a column gets
// one dummy vertex per skipped column, so it is routed through the gaps instead
// of across the blocks in between; rows come from barycenter sweeps, a
// transposition pass and a relaxation with minimum gaps. Edges leave and enter
// a block spread along its sides. A connection drawn right to left runs along
// a lane under the graph. Blocks with no connection go in a strip underneath.
// Positions are never saved.
// ---------------------------------------------------------------------------

export const NODE_W = 176
export const NODE_H = 56
export const COL_GAP = 144
export const ROW_GAP = 24
/** Height of a dummy vertex, and the minimum space between it and a neighbour in its column. */
export const DUMMY_H = 12
export const DUMMY_GAP = 6
/** Distance kept between a block's corner and its first and last port. */
export const PORT_INSET = 8
/** Horizontal reach of a back edge's corners (the graph's padding leaves room for it). */
export const BACK_CURVE = 24
/** Space between the graph and the first back lane, and between two lanes. */
export const BACK_LANE_TOP = 24
export const BACK_LANE_GAP = 12
/** Isolated blocks: space between two of them, between them and the graph, and the minimum per row. */
export const ISO_GAP = 24
export const ISO_TOP = 48
export const ISO_MIN_PER_ROW = 3
/** Room around the layout that the drawing keeps for a back edge's corners. */
export const GRAPH_PAD = 24

export interface Point {
  x: number
  y: number
}

export interface BlockNodeLayout {
  id: string
  /** Layer of a connected block; -1 for an isolated one. */
  column: number
  /** Index among the blocks of the column; for an isolated block, its index in the strip. */
  row: number
  x: number
  y: number
  /** No connection to or from another block: drawn in the strip under the graph. */
  isolated: boolean
}

export interface BlockEdgeLayout {
  from: string
  to: string
  /** Connections of this (source, consumer) pair, in the consumer's order. */
  connectionIds: string[]
  /** Some connection of the pair joins two members of one loop. */
  loop: boolean
  /** The pair is drawn right to left (its source sits in the same column as its consumer or after it). */
  back: boolean
  /**
   * Forward: the source's right port, then for each column it skips the left and right ends of the dummy slot, then the
   * consumer's left port. Back: the source's right port, its lane, the lane above the consumer's left port, that port.
   */
  points: Point[]
  /** Where the edge's summary chip is centred: on the last segment of a forward edge, on the lane of a back edge. */
  chip: Point
}

export interface BlockGraphLayout {
  nodes: Record<string, BlockNodeLayout>
  edges: BlockEdgeLayout[]
  width: number
  height: number
  /** Dependency order: the ordering of the connected blocks, then the isolated ones in plan order. */
  order: string[]
}

interface Pair {
  from: string
  to: string
  connectionIds: string[]
  loop: boolean
}

interface Vertex {
  id: string
  layer: number
  dummy: boolean
}

/** Eades-Lin-Smyth ordering: sinks go right, sources go left, then the block with the most surplus of out-edges. */
function eadesLinSmyth(nodes: string[], edges: Pair[]): string[] {
  const out = new Map(nodes.map(n => [n, new Set<string>()]))
  const inn = new Map(nodes.map(n => [n, new Set<string>()]))
  for (const e of edges) {
    out.get(e.from)!.add(e.to)
    inn.get(e.to)!.add(e.from)
  }
  const left: string[] = []
  const right: string[] = []
  const rem = new Set(nodes)
  const del = (n: string) => {
    rem.delete(n)
    for (const m of out.get(n)!) inn.get(m)!.delete(n)
    for (const m of inn.get(n)!) out.get(m)!.delete(n)
  }
  while (rem.size) {
    let moved = true
    while (moved) {
      moved = false
      for (const n of [...rem]) {
        if (out.get(n)!.size === 0) {
          right.unshift(n)
          del(n)
          moved = true
        }
      }
      for (const n of [...rem]) {
        if (rem.has(n) && inn.get(n)!.size === 0) {
          left.push(n)
          del(n)
          moved = true
        }
      }
    }
    if (rem.size) {
      let best: string | null = null
      let bestValue = -Infinity
      for (const n of rem) {
        const v = out.get(n)!.size - inn.get(n)!.size
        if (v > bestValue) {
          bestValue = v
          best = n
        }
      }
      left.push(best!)
      del(best!)
    }
  }
  return [...left, ...right]
}

/** ELS followed by local moves: move one block to another position whenever that leaves strictly fewer back edges. */
function feedbackOrder(nodes: string[], edges: Pair[]): string[] {
  let order = eadesLinSmyth(nodes, edges)
  const nodeIndex = new Map(nodes.map((n, i) => [n, i]))
  const ends = edges.map(e => [nodeIndex.get(e.from)!, nodeIndex.get(e.to)!] as const)
  const pos = new Array<number>(nodes.length)
  const backCount = (o: string[]) => {
    for (let i = 0; i < o.length; i++) pos[nodeIndex.get(o[i])!] = i
    let c = 0
    for (const [a, b] of ends) if (pos[a] > pos[b]) c++
    return c
  }
  let current = backCount(order)
  for (let pass = 0; pass < 10; pass++) {
    let improved = false
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (i === j) continue
        const moved = order.slice()
        const [x] = moved.splice(i, 1)
        moved.splice(j, 0, x)
        const count = backCount(moved)
        if (count < current) {
          order = moved
          current = count
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return order
}

export function layoutBlockGraph(blocks: Block[]): BlockGraphLayout {
  if (blocks.length === 0) return { nodes: {}, edges: [], width: 0, height: 0, order: [] }

  const index = new Map(blocks.map((b, i) => [b.id, i]))
  const { components } = orderBlocks(blocks)
  const loopConnectionIds = new Set(components.flatMap(c => c.loop?.connectionIds ?? []))

  // Group connections by (source, consumer); unknown sources and self-connections get no edge.
  const pairs: Pair[] = []
  const pairByKey = new Map<string, Pair>()
  for (const b of blocks) {
    for (const c of b.inputConnections) {
      if (!index.has(c.fromBlockId) || c.fromBlockId === b.id) continue
      const key = `${c.fromBlockId}>${b.id}`
      let pair = pairByKey.get(key)
      if (!pair) {
        pair = { from: c.fromBlockId, to: b.id, connectionIds: [], loop: false }
        pairByKey.set(key, pair)
        pairs.push(pair)
      }
      pair.connectionIds.push(c.id)
      if (loopConnectionIds.has(c.id)) pair.loop = true
    }
  }

  const connected = new Set<string>()
  for (const p of pairs) {
    connected.add(p.from)
    connected.add(p.to)
  }
  const active = blocks.map(b => b.id).filter(id => connected.has(id))
  const isolated = blocks.map(b => b.id).filter(id => !connected.has(id))

  const order = feedbackOrder(active, pairs)
  const pos = new Map(order.map((n, i) => [n, i]))

  // Layers: longest path over the pairs that run with the order, sources first.
  const layer = new Map(active.map(n => [n, 0]))
  const incomingByTarget = new Map<string, string[]>()
  for (const p of pairs) {
    if (pos.get(p.from)! > pos.get(p.to)!) continue
    const list = incomingByTarget.get(p.to)
    if (list) list.push(p.from)
    else incomingByTarget.set(p.to, [p.from])
  }
  for (const n of order) {
    for (const from of incomingByTarget.get(n) ?? []) layer.set(n, Math.max(layer.get(n)!, layer.get(from)! + 1))
  }
  const layerCount = active.length ? Math.max(...layer.values()) + 1 : 0
  const isBack = (p: Pair) => layer.get(p.from)! >= layer.get(p.to)!

  // Vertices: the blocks, plus a dummy per skipped layer of each forward pair.
  const vertices = new Map<string, Vertex>()
  for (const n of active) vertices.set(n, { id: n, layer: layer.get(n)!, dummy: false })
  const segments: [string, string][] = []
  const chains: string[][] = [] // per pair index; empty for a back edge
  pairs.forEach((p, pi) => {
    if (isBack(p)) {
      chains.push([])
      return
    }
    const chain = [p.from]
    let prev = p.from
    for (let l = layer.get(p.from)! + 1; l < layer.get(p.to)!; l++) {
      const id = `d${pi}_${l}`
      vertices.set(id, { id, layer: l, dummy: true })
      segments.push([prev, id])
      chain.push(id)
      prev = id
    }
    segments.push([prev, p.to])
    chain.push(p.to)
    chains.push(chain)
  })

  // Crossing minimisation: barycenter sweeps keeping the best, then transpositions.
  const layers: string[][] = Array.from({ length: layerCount }, () => [])
  const rank = (id: string) => {
    const v = vertices.get(id)!
    if (!v.dummy) return pos.get(id)!
    return active.length + Number(id.slice(1, id.indexOf('_')))
  }
  for (const v of vertices.values()) layers[v.layer].push(v.id)
  for (const l of layers) l.sort((a, b) => rank(a) - rank(b))
  const adjUp = new Map<string, string[]>()
  const adjDn = new Map<string, string[]>()
  for (const id of vertices.keys()) {
    adjUp.set(id, [])
    adjDn.set(id, [])
  }
  for (const [a, b] of segments) {
    adjDn.get(a)!.push(b)
    adjUp.get(b)!.push(a)
  }
  // Crossing counts run on integer vertex numbers: they dominate the cost on big plans.
  const vnum = new Map([...vertices.keys()].map((id, i) => [id, i]))
  const rowOfNum = new Int32Array(vnum.size)
  const segmentsByGap: [number, number][][] = Array.from({ length: Math.max(0, layerCount - 1) }, () => [])
  for (const [a, b] of segments) segmentsByGap[vertices.get(a)!.layer].push([vnum.get(a)!, vnum.get(b)!])

  const rows = {
    get: (id: string) => rowOfNum[vnum.get(id)!],
    set: (id: string, r: number) => void (rowOfNum[vnum.get(id)!] = r),
  }
  const refreshRows = () => layers.forEach(l => l.forEach((id, i) => rows.set(id, i)))
  const gapCrossings = (g: number) => {
    const ss = segmentsByGap[g]
    let c = 0
    for (let i = 0; i < ss.length; i++) {
      const ra = rowOfNum[ss[i][0]]
      const rb = rowOfNum[ss[i][1]]
      for (let j = i + 1; j < ss.length; j++) {
        if ((ra - rowOfNum[ss[j][0]]) * (rb - rowOfNum[ss[j][1]]) < 0) c++
      }
    }
    return c
  }
  const crossings = () => {
    let c = 0
    for (let g = 0; g < segmentsByGap.length; g++) c += gapCrossings(g)
    return c
  }
  refreshRows()
  let best = layers.map(l => l.slice())
  let bestC = crossings()
  for (let sweep = 0; sweep < 24; sweep++) {
    const down = sweep % 2 === 0
    const idxs = down
      ? Array.from({ length: layerCount }, (_, i) => i).slice(1)
      : Array.from({ length: layerCount }, (_, i) => i).reverse().slice(1)
    for (const l of idxs) {
      const nb = down ? adjUp : adjDn
      const bc = new Map<string, number>()
      layers[l].forEach((id, i) => {
        const ns = nb.get(id)!
        bc.set(id, ns.length ? ns.reduce((s, x) => s + rows.get(x)!, 0) / ns.length : i)
      })
      layers[l].sort((a, b) => bc.get(a)! - bc.get(b)!)
      layers[l].forEach((id, i) => rows.set(id, i))
    }
    const c = crossings()
    if (c < bestC) {
      bestC = c
      best = layers.map(l => l.slice())
    }
  }
  best.forEach((l, i) => (layers[i] = l.slice()))
  refreshRows()
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (let l = 0; l < layerCount; l++) {
      for (let i = 0; i + 1 < layers[l].length; i++) {
        const a = layers[l][i]
        const b = layers[l][i + 1]
        // Only segments of a and of b can change their crossings: a above b crosses where a's neighbour is below b's.
        let before = 0
        let after = 0
        for (const adj of [adjUp, adjDn]) {
          for (const u of adj.get(a)!) {
            const ru = rows.get(u)
            for (const w of adj.get(b)!) {
              const rw = rows.get(w)
              if (ru > rw) before++
              else if (ru < rw) after++
            }
          }
        }
        if (after < before) {
          layers[l][i] = b
          layers[l][i + 1] = a
          rows.set(b, i)
          rows.set(a, i + 1)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // Rows: stack each layer, then move each vertex toward its neighbours' mean, only ever pushing it down to keep order and minimum gaps.
  const heightOf = (id: string) => (vertices.get(id)!.dummy ? DUMMY_H : NODE_H)
  const gapOf = (a: string, b: string) => (vertices.get(a)!.dummy || vertices.get(b)!.dummy ? DUMMY_GAP : ROW_GAP)
  const y = new Map<string, number>() // vertex centre
  for (const l of layers) {
    let yy = 0
    l.forEach((id, i) => {
      if (i) yy += gapOf(l[i - 1], id)
      y.set(id, yy + heightOf(id) / 2)
      yy += heightOf(id)
    })
  }
  for (let it = 0; it < 12; it++) {
    const forward = it % 2 === 1
    const idxs = Array.from({ length: layerCount }, (_, i) => i)
    if (!forward) idxs.reverse()
    for (const l of idxs) {
      const ids = layers[l]
      const want = ids.map(id => {
        const ns = adjUp.get(id)!.concat(adjDn.get(id)!)
        return ns.length ? ns.reduce((s, x) => s + y.get(x)!, 0) / ns.length : y.get(id)!
      })
      for (let i = 0; i < ids.length; i++) {
        const minY = i === 0
          ? -Infinity
          : y.get(ids[i - 1])! + heightOf(ids[i - 1]) / 2 + gapOf(ids[i - 1], ids[i]) + heightOf(ids[i]) / 2
        y.set(ids[i], Math.max(want[i], minY))
      }
    }
  }
  let minTop = Infinity
  for (const id of vertices.keys()) minTop = Math.min(minTop, y.get(id)! - heightOf(id) / 2)
  if (!Number.isFinite(minTop)) minTop = 0
  for (const id of vertices.keys()) y.set(id, y.get(id)! - minTop)

  const colX = (l: number) => l * (NODE_W + COL_GAP)
  const top = (id: string) => y.get(id)! - NODE_H / 2

  const nodes: Record<string, BlockNodeLayout> = {}
  for (const l of layers) {
    let r = 0
    for (const id of l) {
      if (vertices.get(id)!.dummy) continue
      nodes[id] = { id, column: vertices.get(id)!.layer, row: r++, x: colX(vertices.get(id)!.layer), y: top(id), isolated: false }
    }
  }

  // Ports: along each side, in the order of the neighbouring vertex's y; back edges last.
  const neighbourY = (pi: number, side: 'out' | 'in') => {
    const chain = chains[pi]
    return y.get(side === 'out' ? chain[1] : chain[chain.length - 2])!
  }
  const portY = new Map<string, number>() // `${side}:${pairIndex}`
  for (const id of active) {
    for (const side of ['out', 'in'] as const) {
      const mine = pairs
        .map((p, pi) => ({ p, pi }))
        .filter(({ p }) => (side === 'out' ? p.from : p.to) === id)
      mine.sort((a, b) => {
        const ab = isBack(a.p)
        const bb = isBack(b.p)
        if (ab !== bb) return ab ? 1 : -1
        if (!ab) return neighbourY(a.pi, side) - neighbourY(b.pi, side) || a.pi - b.pi
        return a.pi - b.pi
      })
      mine.forEach(({ pi }, k) => {
        portY.set(`${side}:${pi}`, top(id) + PORT_INSET + (NODE_H - 2 * PORT_INSET) * (k + 0.5) / mine.length)
      })
    }
  }

  // Back lanes lie under every block and dummy, shorter ones above longer ones.
  let bottom = 0
  for (const id of vertices.keys()) bottom = Math.max(bottom, y.get(id)! + heightOf(id) / 2)
  const startOf = (pi: number): Point => ({ x: nodes[pairs[pi].from].x + NODE_W, y: portY.get(`out:${pi}`)! })
  const endOf = (pi: number): Point => ({ x: nodes[pairs[pi].to].x, y: portY.get(`in:${pi}`)! })
  const backIndexes = pairs.map((_, pi) => pi).filter(pi => isBack(pairs[pi]))
  backIndexes.sort((a, b) =>
    Math.abs(endOf(a).x - startOf(a).x) - Math.abs(endOf(b).x - startOf(b).x) || a - b)
  const laneOf = new Map(backIndexes.map((pi, k) => [pi, bottom + BACK_LANE_TOP + k * BACK_LANE_GAP]))
  let graphBottom = bottom
  if (backIndexes.length) graphBottom = bottom + BACK_LANE_TOP + (backIndexes.length - 1) * BACK_LANE_GAP

  const edges: BlockEdgeLayout[] = pairs.map((p, pi) => {
    const start = startOf(pi)
    const end = endOf(pi)
    if (isBack(p)) {
      const lane = laneOf.get(pi)!
      return {
        from: p.from, to: p.to, connectionIds: p.connectionIds, loop: p.loop, back: true,
        points: [start, { x: start.x, y: lane }, { x: end.x, y: lane }, end],
        chip: { x: (start.x + end.x) / 2, y: lane },
      }
    }
    const points: Point[] = [start]
    for (const id of chains[pi].slice(1, -1)) {
      const x = colX(vertices.get(id)!.layer)
      points.push({ x, y: y.get(id)! }, { x: x + NODE_W, y: y.get(id)! })
    }
    points.push(end)
    const a = points[points.length - 2]
    return {
      from: p.from, to: p.to, connectionIds: p.connectionIds, loop: p.loop, back: false,
      points,
      chip: { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 },
    }
  })

  // Isolated blocks: a row-wrapped strip under the graph and its lanes.
  const connectedWidth = layerCount ? layerCount * (NODE_W + COL_GAP) - COL_GAP : 0
  const perRow = Math.max(ISO_MIN_PER_ROW, Math.floor((connectedWidth + ISO_GAP) / (NODE_W + ISO_GAP)))
  const stripTop = active.length ? graphBottom + ISO_TOP : 0
  isolated.forEach((id, i) => {
    nodes[id] = {
      id, column: -1, row: i,
      x: (i % perRow) * (NODE_W + ISO_GAP),
      y: stripTop + Math.floor(i / perRow) * (NODE_H + ROW_GAP),
      isolated: true,
    }
  })
  const stripWidth = isolated.length ? Math.min(isolated.length, perRow) * (NODE_W + ISO_GAP) - ISO_GAP : 0
  const stripBottom = isolated.length
    ? stripTop + Math.ceil(isolated.length / perRow) * (NODE_H + ROW_GAP) - ROW_GAP
    : 0

  return {
    nodes,
    edges,
    width: Math.max(connectedWidth, stripWidth),
    height: Math.max(graphBottom, stripBottom),
    order: [...order, ...isolated],
  }
}

/**
 * SVG path of an edge. A forward edge joins its points with cubic curves that leave and arrive
 * horizontally. A back edge leaves the source's right side, drops to its lane, runs left and
 * rises into the consumer's left side; its corners reach BACK_CURVE past both ends, so it
 * overhangs the layout by BACK_CURVE (GRAPH_PAD leaves room for that).
 */
export function edgePath(e: BlockEdgeLayout): string {
  const pts = e.points
  if (e.back) {
    const [start, , , end] = pts
    const lane = pts[1].y
    return `M ${start.x} ${start.y} C ${start.x + BACK_CURVE} ${start.y}, ${start.x + BACK_CURVE} ${lane}, ${start.x} ${lane} ` +
      `L ${end.x} ${lane} C ${end.x - BACK_CURVE} ${lane}, ${end.x - BACK_CURVE} ${end.y}, ${end.x} ${end.y}`
  }
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const midX = (a.x + b.x) / 2
    d += ` C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`
  }
  return d
}

/** Scale that fits content into a view, never enlarging; 1 when any size is not positive. */
export function fitScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
  if (viewW <= 0 || viewH <= 0 || contentW <= 0 || contentH <= 0) return 1
  return Math.min(1, viewW / contentW, viewH / contentH)
}
