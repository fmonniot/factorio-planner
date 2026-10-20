import type { ConnectionFlow, ProductionGoal } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { FLOW_TOLERANCE } from '../../solver/index'
import { fmtRate } from './ItemTile'
import type { ByproductRow, IngredientRow } from './summaryRows'

// Pure model for the summary panes: each item becomes a slot whose rate is
// split into allocation segments (who takes it, what stays, what is missing).
// The micro-bar, the detail bar and the overview strip all draw from this.

export type SummaryPaneKind = 'products' | 'byproducts' | 'ingredients'
export type SegmentKind = 'export' | 'source' | 'kept' | 'left' | 'import' | 'short'

export interface Segment {
  /** Overview/trace key: `to:<blockId>` | `from:<blockId>` | 'kept' | 'left' | 'import' | 'short' */
  key: string
  kind: SegmentKind
  /** items/min, always > 0 */
  amount: number
  /** export: the consumer; source: the source */
  blockId?: string
  /** export and source */
  connectionId?: string
  /** source only */
  limited?: boolean
  /** items/min the source offered; source only, for the limited-source title */
  available?: number
}

/** Marks drawn across the whole bar instead of taking a share of it. */
export type OverlayKind = 'unused' | 'missing-source' | 'cycle' | 'locked'
export interface Overlay {
  key: string
  kind: OverlayKind
  blockId?: string
  connectionId?: string
}

export type SlotStatus = 'short' | 'limited' | 'locked' | null

export interface GoalInfo {
  id: string
  target: number
  /** undefined before the first solve */
  actual: number | undefined
  short: boolean
  /** Position of the target on the bar (0..1); null when actual matches the target. */
  tickAt: number | null
}

export interface SlotModel {
  itemId: string
  /** items/min shown on the slot */
  rate: number
  /** items/min the bar spans (0 allowed) */
  scale: number
  segments: Segment[]
  overlays: Overlay[]
  status: SlotStatus
  dimmed: boolean
  /** products only */
  goal?: GoalInfo
  /** ingredients only */
  locked?: boolean
}

export interface OverviewRow {
  key: string
  kind: SegmentKind | OverlayKind
  blockId?: string
  total: number
  /** Number of slots carrying this key. */
  count: number
  limited: boolean
}

// A shortfall only counts when it survives the display rounding, so "short by 0.00/m" never shows.
export function isShortfall(target: number, actual: number, unit: RateUnit): boolean {
  return actual < target - FLOW_TOLERANCE && parseFloat(fmtRate((target - actual) / 60, unit)) > 0
}

export function differsFromTarget(target: number, actual: number, unit: RateUnit): boolean {
  return Math.abs(actual - target) > FLOW_TOLERANCE && parseFloat(fmtRate(Math.abs(target - actual) / 60, unit)) > 0
}

function exportSegments(exports: ConnectionFlow[]): Segment[] {
  return exports.map(f => ({
    key: `to:${f.toBlockId}`,
    kind: 'export',
    amount: f.rate,
    blockId: f.toBlockId,
    connectionId: f.connectionId,
  }))
}

const sum = (segments: Segment[]) => segments.reduce((total, s) => total + s.amount, 0)

/** `exports` are this block's deliveries of the goal's item, each above FLOW_TOLERANCE. */
export function productSlot(
  goal: ProductionGoal,
  actualPerMin: number | undefined,
  exports: ConnectionFlow[],
  unit: RateUnit,
): SlotModel {
  const target = goal.rate
  if (actualPerMin === undefined) {
    return {
      itemId: goal.itemId,
      rate: target,
      scale: target,
      segments: [],
      overlays: [],
      status: null,
      dimmed: false,
      goal: { id: goal.id, target, actual: undefined, short: false, tickAt: null },
    }
  }

  const segments = exportSegments(exports)
  const kept = Math.max(0, actualPerMin - sum(segments))
  if (kept > FLOW_TOLERANCE) segments.push({ key: 'kept', kind: 'kept', amount: kept })
  const short = isShortfall(target, actualPerMin, unit)
  if (short) segments.push({ key: 'short', kind: 'short', amount: target - actualPerMin })
  const scale = Math.max(target, sum(segments))
  return {
    itemId: goal.itemId,
    rate: actualPerMin,
    scale,
    segments,
    overlays: [],
    status: short ? 'short' : null,
    dimmed: false,
    goal: {
      id: goal.id,
      target,
      actual: actualPerMin,
      short,
      tickAt: differsFromTarget(target, actualPerMin, unit) ? target / scale : null,
    },
  }
}

export function byproductSlot(row: ByproductRow, exports: ConnectionFlow[]): SlotModel {
  const segments = exportSegments(exports)
  if (row.leftPerMin !== undefined) segments.push({ key: 'left', kind: 'left', amount: row.leftPerMin })
  return {
    itemId: row.itemId,
    rate: row.leftPerMin ?? 0,
    scale: sum(segments),
    segments,
    overlays: [],
    status: null,
    dimmed: false,
  }
}

export function ingredientSlot(
  row: IngredientRow,
  flows: Map<string, ConnectionFlow>,
  blockIds: ReadonlySet<string>,
): SlotModel {
  const segments: Segment[] = []
  const overlays: Overlay[] = []
  for (const c of row.connections) {
    const flow = flows.get(c.id)
    const key = `from:${c.fromBlockId}`
    const status = flow?.status ?? (blockIds.has(c.fromBlockId) ? undefined : 'missing-source')
    // No flow for an existing source: the first solve has not landed yet.
    if (status === undefined) continue
    if (status === 'ok' || status === 'limited') {
      if (flow!.rate > FLOW_TOLERANCE) {
        segments.push({
          key,
          kind: 'source',
          amount: flow!.rate,
          blockId: c.fromBlockId,
          connectionId: c.id,
          available: flow!.available,
          ...(status === 'limited' ? { limited: true } : {}),
        })
      }
    } else {
      overlays.push({ key, kind: status, blockId: c.fromBlockId, connectionId: c.id })
    }
  }
  if (row.importPerMin !== undefined && row.importPerMin > 0) {
    segments.push({ key: 'import', kind: 'import', amount: row.importPerMin })
  }
  if (row.locked) overlays.push({ key: 'locked', kind: 'locked' })

  const need = sum(segments)
  return {
    itemId: row.itemId,
    rate: need,
    scale: need,
    segments,
    overlays,
    status: segments.some(s => s.limited) ? 'limited' : row.locked ? 'locked' : null,
    dimmed: row.locked || need <= FLOW_TOLERANCE,
    locked: row.locked,
  }
}

const RANK: Record<string, number> = { kept: 1, left: 1, short: 2, import: 2, locked: 3 }
const rankOf = (key: string) => RANK[key] ?? 0

/** One row per segment key across the pane, blocks first, then what stays, then what is missing. */
export function overviewRows(slots: SlotModel[]): OverviewRow[] {
  const rows = new Map<string, OverviewRow>()
  for (const slot of slots) {
    const seen = new Set<string>()
    const touch = (key: string, kind: OverviewRow['kind'], blockId: string | undefined) => {
      let row = rows.get(key)
      if (!row) {
        row = { key, kind, blockId, total: 0, count: 0, limited: false }
        rows.set(key, row)
      }
      if (!seen.has(key)) {
        seen.add(key)
        row.count += 1
      }
      return row
    }
    // Segments first so a key carried by both a segment and an overlay takes the segment's kind.
    for (const s of slot.segments) {
      const row = touch(s.key, s.kind, s.blockId)
      row.total += s.amount
      if (s.limited) row.limited = true
    }
    for (const o of slot.overlays) touch(o.key, o.kind, o.blockId)
  }
  return [...rows.values()]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rankOf(a.row.key) - rankOf(b.row.key) || a.i - b.i)
    .map(({ row }) => row)
}

export function slotHasKey(slot: SlotModel, key: string): boolean {
  return slot.segments.some(s => s.key === key) || slot.overlays.some(o => o.key === key)
}

const GONE = '(deleted block)'

export function segmentLabel(e: { kind: SegmentKind | OverlayKind }, blockName: string | undefined): string {
  switch (e.kind) {
    case 'export': return `→ ${blockName ?? GONE}`
    case 'source': return `← ${blockName ?? GONE}`
    case 'kept': return 'Kept'
    case 'left': return 'Left'
    case 'import': return 'Imported'
    case 'short': return 'Short'
    case 'unused': return `← ${blockName ?? GONE} · unused`
    case 'cycle': return `← ${blockName ?? GONE} · cycle, ignored`
    case 'missing-source': return GONE
    case 'locked': return 'Imports forbidden'
  }
}

export function segmentTitle(
  e: Segment | Overlay,
  ctx: {
    itemName: string
    blockName: string | undefined
    fmt: (perMin: number) => string
    unit: string
    /** items/min the source offered; limited sources only */
    available?: number
  },
): string {
  const { itemName, blockName, fmt, unit, available } = ctx
  switch (e.kind) {
    case 'export':
      return `Sends ${itemName} to ${blockName ?? GONE} — click to open`
    case 'source':
      return (e as Segment).limited
        ? `Limited: ${blockName ?? GONE} only offers ${fmt(available ?? 0)}${unit} — click to open, right-click to remove`
        : `${itemName} from ${blockName ?? GONE} — click to open, right-click to remove`
    case 'unused':
      return 'Not used: this block makes or needs none from outside — right-click to remove'
    case 'missing-source':
      return `${itemName} — the source block was deleted; right-click to remove this connection`
    case 'cycle':
      return `${itemName} — ignored because the connection forms a cycle — right-click to remove`
    default:
      return segmentLabel(e, blockName)
  }
}
