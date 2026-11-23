import { edgeKey, pairStatus } from './graphConnection'
import type { EdgeStatus } from './graphConnection'
import type { BlockMatrixOrder } from '../../store/uiStore'

// The cell model of the block graph's matrix view: rows supply, columns receive. Pure; the view only draws it.

/** One (source, consumer) pair, as the graph layout's edges give it. */
export interface MatrixPair {
  from: string
  to: string
  connectionIds: string[]
  /** The solver's notion: the pair is part of a loop. */
  loop: boolean
}

export interface MatrixCell {
  key: string
  from: string
  to: string
  row: number
  col: number
  connectionIds: string[]
  count: number
  status: EdgeStatus
  limited: number
  unused: number
  /** Every connection is unused; false when any is still pending. */
  allUnused: boolean
  /** Part of a loop, by the solver: drawn `↻`. */
  loop: boolean
  /** Below the diagonal in the order shown: it runs against that order (hatched). */
  back: boolean
}

export interface BlockMatrix {
  order: string[]
  /** The filled cells, row-major. */
  cells: MatrixCell[]
  cellAt: (row: number, col: number) => MatrixCell | undefined
  /** Per row: the distinct blocks it supplies. */
  supplies: number[]
  /** Per column: the distinct blocks it receives from. */
  receives: number[]
  filled: number
  backCount: number
  loopCount: number
}

/** The blocks' order: the tabs' (`plan`), or the layout's dependency order, dropping unknown ids and appending missing blocks. */
export function matrixOrderOf(kind: BlockMatrixOrder, blocks: readonly { id: string }[], dependencyOrder: readonly string[]): string[] {
  const ids = blocks.map(b => b.id)
  if (kind === 'plan') return ids
  const known = new Set(ids)
  const order = dependencyOrder.filter(id => known.has(id))
  const seen = new Set(order)
  return [...order, ...ids.filter(id => !seen.has(id))]
}

export function buildBlockMatrix(
  order: string[], pairs: readonly MatrixPair[], statusOf: (connectionId: string) => EdgeStatus,
): BlockMatrix {
  const index = new Map(order.map((id, i) => [id, i]))
  const cells: MatrixCell[] = []
  for (const p of pairs) {
    const row = index.get(p.from)
    const col = index.get(p.to)
    if (row === undefined || col === undefined || row === col) continue
    const statuses = p.connectionIds.map(statusOf)
    cells.push({
      key: edgeKey(p),
      from: p.from,
      to: p.to,
      row,
      col,
      connectionIds: p.connectionIds,
      count: p.connectionIds.length,
      status: pairStatus(statuses),
      limited: statuses.filter(s => s === 'limited').length,
      unused: statuses.filter(s => s === 'unused').length,
      allUnused: statuses.length > 0 && statuses.every(s => s === 'unused'),
      loop: p.loop,
      back: row > col,
    })
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col)
  const byPos = new Map(cells.map(c => [c.row * order.length + c.col, c]))
  const supplies = order.map(() => 0)
  const receives = order.map(() => 0)
  for (const c of cells) {
    supplies[c.row]++
    receives[c.col]++
  }
  return {
    order,
    cells,
    cellAt: (row, col) => byPos.get(row * order.length + col),
    supplies,
    receives,
    filled: cells.length,
    backCount: cells.filter(c => c.back).length,
    loopCount: cells.filter(c => c.loop).length,
  }
}

/** Strength of a cell's tint in the source colour (percent): grows with the number of items, capped at 14. */
export function cellTintPercent(count: number): number {
  return Math.round(15 + 30 * Math.min(count, 14) / 14)
}
