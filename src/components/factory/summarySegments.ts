import type { ConnectionFlow, ProductionGoal } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { FLOW_TOLERANCE } from '../../solver/index'
import { fmtRate } from './ItemTile'
import type { ByproductRow, IngredientRow } from './summaryRows'

/**
 * The connection limit that is holding a flow back, or undefined when the flow
 * is not limited by its own limit (unlimited, or limited by the source's offer).
 */
export function cappingLimit(
  limited: boolean | undefined,
  capped: boolean | undefined,
  maxRate: number | undefined,
): number | undefined {
  return limited && capped ? maxRate : undefined
}

/** Tooltip text for a flow held back by its connection's limit; `shown` is the formatted limit with unit. */
export function cappedTitle(shown: string): string {
  return `Limited by this connection's limit of ${shown}`
}

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
  /** export and source: both ends are members of one loop of blocks */
  loop?: true
  /** source only */
  limited?: boolean
  /** items/min the source offered; source only, for the limited-source title */
  available?: number
  /** source only: the connection's limit, not the source, bounds `available` */
  capped?: true
  /** items/min limit of the connection; set with `capped` */
  maxRate?: number
  /** source only: the connection pulls, so the consumer's demand drives the source */
  pulled?: true
}

/** Marks drawn across the whole bar instead of taking a share of it. */
export type OverlayKind = 'unused' | 'missing-source' | 'self' | 'locked'
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
  /** The goal plus what other blocks pull of the same item; equals `target` when nothing is pulled. */
  required: number
  /** undefined before the first solve */
  actual: number | undefined
  short: boolean
  /** Position of the target on the bar (0..1); null when actual matches the target. */
  tickAt: number | null
}

export interface SlotModel {
  /** Unique within a pane: the goal id for products (two goals may share an item), the item id otherwise. */
  id: string
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
  /** products only: an item no goal names, made because other blocks pull it; read-only. `rate` is what they pull. */
  pulledOnly?: true
  /** pulledOnly only: items/min of the pulled amount the block does not make; > 0 iff `status` is 'short' */
  pulledShort?: number
}

export interface OverviewRow {
  key: string
  kind: SegmentKind | OverlayKind
  blockId?: string
  total: number
  /** A segment under this key belongs to a loop of blocks. */
  loop?: true
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
    ...(f.loop ? { loop: true as const } : {}),
  }))
}

const sum = (segments: Segment[]) => segments.reduce((total, s) => total + s.amount, 0)

/**
 * `exports` are this block's deliveries of the goal's item, each above
 * FLOW_TOLERANCE. `pulledPerMin` is what other blocks pull of the same item on
 * top of the goal (the solver adds it to the goal): the slot is short when the
 * output misses the goal plus that amount.
 */
export function productSlot(
  goal: ProductionGoal,
  actualPerMin: number | undefined,
  exports: ConnectionFlow[],
  unit: RateUnit,
  pulledPerMin = 0,
): SlotModel {
  const target = goal.rate
  const required = target + pulledPerMin
  if (actualPerMin === undefined) {
    return {
      id: goal.id,
      itemId: goal.itemId,
      rate: target,
      scale: target,
      segments: [],
      overlays: [],
      status: null,
      dimmed: false,
      goal: { id: goal.id, target, required, actual: undefined, short: false, tickAt: null },
    }
  }

  const segments = exportSegments(exports)
  const kept = Math.max(0, actualPerMin - sum(segments))
  if (kept > FLOW_TOLERANCE) segments.push({ key: 'kept', kind: 'kept', amount: kept })
  const short = isShortfall(required, actualPerMin, unit)
  if (short) segments.push({ key: 'short', kind: 'short', amount: required - actualPerMin })
  const scale = Math.max(required, sum(segments))
  return {
    id: goal.id,
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
      required,
      actual: actualPerMin,
      short,
      tickAt: differsFromTarget(required, actualPerMin, unit) ? required / scale : null,
    },
  }
}

/**
 * An item this block makes only because other blocks pull it. `pulledPerMin` is
 * what they ask for; `actualPerMin` is what the block really makes of it, and
 * only up to the pulled amount counts here (the surplus is a byproduct).
 * `exports` are this block's deliveries to the pulling consumers, each above
 * FLOW_TOLERANCE. What is made but not delivered is `kept`; what is not made is `short`.
 */
export function pulledSlot(
  itemId: string,
  pulledPerMin: number,
  actualPerMin: number,
  exports: ConnectionFlow[],
  unit: RateUnit,
): SlotModel {
  const made = Math.min(actualPerMin, pulledPerMin)
  const segments = exportSegments(exports)
  const kept = made - sum(segments)
  if (kept > FLOW_TOLERANCE) segments.push({ key: 'kept', kind: 'kept', amount: kept })
  const short = isShortfall(pulledPerMin, made, unit)
  if (short) segments.push({ key: 'short', kind: 'short', amount: pulledPerMin - made })
  return {
    id: `pull:${itemId}`,
    itemId,
    rate: pulledPerMin,
    scale: sum(segments),
    segments,
    overlays: [],
    status: short ? 'short' : null,
    dimmed: false,
    pulledOnly: true,
    ...(short ? { pulledShort: pulledPerMin - made } : {}),
  }
}

export function byproductSlot(row: ByproductRow, exports: ConnectionFlow[]): SlotModel {
  const segments = exportSegments(exports)
  if (row.leftPerMin !== undefined) segments.push({ key: 'left', kind: 'left', amount: row.leftPerMin })
  return {
    id: row.itemId,
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
          ...(flow!.loop ? { loop: true as const } : {}),
          ...(flow!.demand !== undefined ? { pulled: true as const } : {}),
          available: flow!.available,
          ...(status === 'limited' ? { limited: true } : {}),
          ...(cappingLimit(status === 'limited', flow!.capped, c.maxRate) !== undefined
            ? { capped: true as const, maxRate: c.maxRate }
            : {}),
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
    id: row.itemId,
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
  // Keys whose row was created by an overlay and not yet seen on a segment.
  const overlayOnly = new Set<string>()
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
    // A key carried by both a segment and an overlay takes the segment's kind, even when an
    // overlay in an earlier slot created the row.
    for (const s of slot.segments) {
      const row = touch(s.key, s.kind, s.blockId)
      if (overlayOnly.delete(s.key)) {
        row.kind = s.kind
        row.blockId = s.blockId
      }
      row.total += s.amount
      if (s.loop) row.loop = true
      if (s.limited) row.limited = true
    }
    for (const o of slot.overlays) {
      if (!rows.has(o.key)) overlayOnly.add(o.key)
      touch(o.key, o.kind, o.blockId)
    }
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

export function segmentLabel(
  e: { kind: SegmentKind | OverlayKind; loop?: true },
  blockName: string | undefined,
): string {
  const mark = e.loop ? ' ↻' : ''
  switch (e.kind) {
    case 'export': return `→ ${blockName ?? GONE}${mark}`
    case 'source': return `← ${blockName ?? GONE}${mark}`
    case 'kept': return 'Kept'
    case 'left': return 'Left'
    case 'import': return 'Imported'
    case 'short': return 'Short'
    case 'unused': return `← ${blockName ?? GONE} · unused`
    case 'self': return `← ${blockName ?? GONE} · self, ignored`
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
  const note = 'loop' in e && e.loop ? ' — part of a loop' : ''
  switch (e.kind) {
    case 'export':
      return `Sends ${itemName} to ${blockName ?? GONE}${note} — click to open`
    case 'source': {
      const seg = e as Segment
      const tail = `${note}${seg.pulled ? ' — pulled' : ''}`
      const cap = cappingLimit(seg.limited, seg.capped, seg.maxRate)
      if (cap !== undefined) {
        return `${cappedTitle(`${fmt(cap)}${unit}`)}${tail} — click to open, right-click to remove`
      }
      return seg.limited
        ? `Limited: ${blockName ?? GONE} only offers ${fmt(available ?? 0)}${unit}${tail} — click to open, right-click to remove`
        : `${itemName} from ${blockName ?? GONE}${tail} — click to open, right-click to remove`
    }
    case 'unused':
      return 'Not used: this block makes or needs none from outside — right-click to remove'
    case 'missing-source':
      return `${itemName} — the source block was deleted; right-click to remove this connection`
    case 'self':
      return `${itemName} — ignored because a block cannot supply itself — right-click to remove`
    default:
      return segmentLabel(e, blockName)
  }
}
