import type { Block, ConnectionFlow, GameData, SolverResult } from '../../data/types'
import { FLOW_TOLERANCE, grossFlow, netBalance, surplusTolerance } from '../../solver/index'
import { blockMatrix, itemGroupOf, type MatrixArea } from './areaMatrix'

// ---------------------------------------------------------------------------
// The plan-level matrix: items as rows, blocks as columns. A block's net is its boundary balance
// (`netBalance` of its solved nodes, the quantity the solver offers to other blocks, before any
// discard of byproducts); its area cells are the area nets of the block's own matrix, so with a
// discarded byproduct the area cells may not add up to the net.
// ---------------------------------------------------------------------------

export interface PlanMatrixBlock {
  blockId: string
  name: string
  color: string
  /** [] = a block without areas */
  areas: MatrixArea[]
}

export interface PlanMatrixRow {
  itemId: string
  name: string
  groupId: string
  /** blockId -> signed boundary net (+ leaves the block, − enters it) */
  net: Record<string, number>
  /** blockId -> areaId -> signed area net */
  areaCells: Record<string, Record<string, number>>
  delivered: number
  notTaken: number
  notSupplied: number
  total: number
  /** the active flows of this item */
  flows: ConnectionFlow[]
}

const isActive = (f: ConnectionFlow) => f.rate > FLOW_TOLERANCE && f.status !== 'missing-source' && f.status !== 'self'

/** What the blocks produce and consume of each item across their boundaries, and what the connections carry. */
export function planMatrix(
  blocks: Block[],
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
  gameData: GameData,
  machines: Set<string>,
  opts: { crossingOnly: boolean },
): { blocks: PlanMatrixBlock[]; rows: PlanMatrixRow[] } {
  const active = flows.filter(isActive)
  const withNodes = blocks.filter(b => (results[b.id]?.nodes.length ?? 0) > 0)

  const nets = new Map<string, Map<string, number>>() // blockId -> itemId -> net (tolerance applied)
  const cells = new Map<string, Record<string, Record<string, number>>>() // blockId -> itemId -> areaId -> v
  const matrices = new Map<string, MatrixArea[]>()
  for (const b of withNodes) {
    const result = results[b.id]
    const gross = grossFlow(result.nodes)
    const net = new Map<string, number>()
    for (const [itemId, v] of netBalance(result.nodes)) {
      if (Math.abs(v) > surplusTolerance(gross.get(itemId) ?? 0)) net.set(itemId, v)
    }
    nets.set(b.id, net)
    const m = blockMatrix(b, result, gameData, machines)
    matrices.set(b.id, m?.areas ?? [])
    const byItem: Record<string, Record<string, number>> = {}
    for (const r of m?.rows ?? []) byItem[r.itemId] = r.cells
    cells.set(b.id, byItem)
  }

  const flowsOf = new Map<string, ConnectionFlow[]>()
  for (const f of active) {
    const list = flowsOf.get(f.itemId)
    if (list) list.push(f)
    else flowsOf.set(f.itemId, [f])
  }

  const ends = new Set(active.flatMap(f => [f.fromBlockId, f.toBlockId]))
  const shown = opts.crossingOnly ? blocks.filter(b => ends.has(b.id)) : withNodes
  const shownIds = new Set(shown.map(b => b.id))

  const itemIds = new Set<string>()
  if (opts.crossingOnly) {
    for (const [itemId, list] of flowsOf) if (list.reduce((n, f) => n + f.rate, 0) > FLOW_TOLERANCE) itemIds.add(itemId)
  } else {
    for (const b of shown) {
      for (const itemId of nets.get(b.id)?.keys() ?? []) itemIds.add(itemId)
      for (const itemId of Object.keys(cells.get(b.id) ?? {})) itemIds.add(itemId)
    }
  }

  const rows: PlanMatrixRow[] = []
  for (const itemId of itemIds) {
    const itemFlows = flowsOf.get(itemId) ?? []
    const delivered = itemFlows.reduce((n, f) => n + f.rate, 0)
    let pos = 0
    let neg = 0
    const net: Record<string, number> = {}
    const areaCells: Record<string, Record<string, number>> = {}
    // Not taken and not supplied count every block with a solve, shown or not, so they do not depend on
    // the crossing filter; only the shown blocks get a column.
    for (const b of withNodes) {
      const v = nets.get(b.id)?.get(itemId) ?? 0
      if (v > 0) pos += v
      else if (v < 0) neg -= v
      if (!shownIds.has(b.id)) continue
      if (v !== 0) net[b.id] = v
      const c = cells.get(b.id)?.[itemId]
      if (c) areaCells[b.id] = c
    }
    rows.push({
      itemId,
      name: gameData.items[itemId]?.name ?? itemId,
      groupId: itemGroupOf(itemId, gameData, machines).id,
      net,
      areaCells,
      delivered,
      notTaken: Math.max(0, pos - delivered),
      notSupplied: Math.max(0, neg - delivered),
      total: Math.max(pos, neg),
      flows: itemFlows,
    })
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return {
    blocks: shown.map(b => ({ blockId: b.id, name: b.name, color: b.color, areas: matrices.get(b.id) ?? [] })),
    rows,
  }
}

/** The areas of a block that move the item the way the block's net goes, largest first. */
export function primaryAreas(row: PlanMatrixRow, b: PlanMatrixBlock): { areaId: string; name: string; rate: number }[] {
  const net = row.net[b.blockId] ?? 0
  const cells = row.areaCells[b.blockId] ?? {}
  if (net === 0) return []
  return b.areas
    .filter(a => (net > 0 ? (cells[a.areaId] ?? 0) > 0 : (cells[a.areaId] ?? 0) < 0))
    .map(a => ({ areaId: a.areaId, name: a.name, rate: cells[a.areaId] }))
    .sort((x, y) => Math.abs(y.rate) - Math.abs(x.rate))
}
