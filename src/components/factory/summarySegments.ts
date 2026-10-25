import type { ConnectionFlow, Product } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { FLOW_TOLERANCE } from '../../solver/index'
import { fmtRate } from './ItemTile'
import { possessive } from './productChangeText'
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
  /** source only: the connection is a request, so the consumer's need drives the source */
  requested?: true
  /** export only: items/min the consumer requested, when the connection is a request */
  requestedRate?: number
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

export interface ProductInfo {
  id: string
  /** The product's extra output; undefined = only what other blocks request. */
  extra: number | undefined
  /** The extra plus what other blocks request of the same item. */
  required: number
  /** undefined before the first solve */
  actual: number | undefined
  short: boolean
  /** What other blocks request of the item (the sum over the request flows). */
  requested: number
  /** Set only when short: how much of the shortfall falls on the extra and on the requests, and which requesters got less than they asked. */
  shortFrom?: { extra: number; requests: number; blockIds: string[] }
  /** Position of the requirement on the bar (0..1); null when actual matches it. */
  tickAt: number | null
}

export interface SlotModel {
  /** Unique within a pane: the product id for products (two products may share an item), the item id otherwise. */
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
  product?: ProductInfo
  /** ingredients only */
  locked?: boolean
  /** products only: nothing requested, no extra, nothing exported or made; drawn as "—" */
  empty?: true
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
    ...(f.kind === 'request' && f.requested !== undefined ? { requestedRate: f.requested } : {}),
  }))
}

const sum = (segments: Segment[]) => segments.reduce((total, s) => total + s.amount, 0)

/**
 * `exports` are this block's deliveries of the product's item, each above
 * FLOW_TOLERANCE. `requests` are the request flows leaving the block for the same item,
 * including those delivering 0, in solve order. What they request is added to the extra
 * (the solver adds it to the product's rate): the slot is short when the output misses the
 * extra plus that amount. A product with no extra, no request, no export and no output is empty.
 */
export function productSlot(
  product: Product,
  actualPerMin: number | undefined,
  exports: ConnectionFlow[],
  unit: RateUnit,
  requests: ConnectionFlow[] = [],
): SlotModel {
  const extra = product.extraRate
  const requestedPerMin = requests.reduce((total, f) => total + (f.requested ?? 0), 0)
  const required = (extra ?? 0) + requestedPerMin
  const asked = required > FLOW_TOLERANCE
  const info = (
    actual: number | undefined,
    short: boolean,
    tickAt: number | null,
    shortFrom?: ProductInfo['shortFrom'],
  ): ProductInfo => ({
    id: product.id,
    extra,
    required,
    actual,
    short,
    requested: requestedPerMin,
    ...(shortFrom ? { shortFrom } : {}),
    tickAt,
  })
  if (!asked && exports.length === 0 && !((actualPerMin ?? 0) > FLOW_TOLERANCE)) {
    return {
      id: product.id,
      itemId: product.itemId,
      rate: 0,
      scale: 0,
      segments: [],
      overlays: [],
      status: null,
      dimmed: true,
      empty: true,
      product: info(actualPerMin, false, null),
    }
  }
  if (actualPerMin === undefined) {
    return {
      id: product.id,
      itemId: product.itemId,
      rate: required,
      scale: required,
      segments: [],
      overlays: [],
      status: null,
      dimmed: false,
      product: info(undefined, false, null),
    }
  }

  const segments = exportSegments(exports)
  const kept = Math.max(0, actualPerMin - sum(segments))
  if (kept > FLOW_TOLERANCE) segments.push({ key: 'kept', kind: 'kept', amount: kept })
  const short = asked && isShortfall(required, actualPerMin, unit)
  if (short) segments.push({ key: 'short', kind: 'short', amount: required - actualPerMin })
  const scale = Math.max(required, sum(segments))
  // The extra gives way first; the rest falls on the requests served last (see `connectionOffer`).
  let shortFrom: ProductInfo['shortFrom']
  if (short) {
    const missing = required - actualPerMin
    const extraPart = Math.min(extra ?? 0, missing)
    const requestPart = missing - extraPart
    // Only requesters the source left wanting: `limited` means the consumer took everything on
    // offer and still imports the item. One under-served for another reason (it took the item
    // from another block first, so it drew less than it asked) is `ok` or `unused`, not blamed.
    const blockIds = requestPart > FLOW_TOLERANCE
      ? requests
          .filter(f => f.status === 'limited' && f.rate < (f.requested ?? 0) - FLOW_TOLERANCE)
          .map(f => f.toBlockId)
      : []
    shortFrom = { extra: extraPart, requests: requestPart, blockIds }
  }
  return {
    id: product.id,
    itemId: product.itemId,
    rate: asked ? actualPerMin : Math.max(0, actualPerMin),
    scale,
    segments,
    overlays: [],
    status: short ? 'short' : null,
    dimmed: false,
    product: info(
      actualPerMin,
      short,
      asked && differsFromTarget(required, actualPerMin, unit) ? required / scale : null,
      shortFrom,
    ),
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
          ...(flow!.kind === 'request' ? { requested: true as const } : {}),
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
    case 'kept': return 'Left'
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
      const tail = `${note}${seg.requested ? ' — requested' : ''}`
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

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * The text of one colour-key entry. Products say who asked for what and where a shortfall
 * comes from; every other entry reads as its label and amount.
 */
export function keyEntryText(
  entry: Segment | Overlay,
  ctx: {
    blockName: string | undefined
    product: ProductInfo | undefined
    fmt: (perMin: number) => string
    nameOf: (blockId: string) => string | undefined
  },
): { label: string; amount?: string; note?: string } {
  const { blockName, product, fmt, nameOf } = ctx
  const amount = 'amount' in entry ? entry.amount : undefined
  const plain = { label: segmentLabel(entry, blockName), ...(amount !== undefined ? { amount: fmt(amount) } : {}) }
  if (!product || amount === undefined) return plain
  switch (entry.kind) {
    case 'export': {
      const requestedRate = (entry as Segment).requestedRate
      if (requestedRate === undefined) return plain
      const name = `${blockName ?? GONE}${entry.loop ? ' ↻' : ''}`
      // Beyond its ask a request can also draw what nobody holds: the label states the ask.
      return amount >= requestedRate - FLOW_TOLERANCE
        ? { label: `${name} requests`, amount: fmt(requestedRate) }
        : { label: `${name}:`, amount: fmt(amount), note: `of ${fmt(requestedRate)} requested` }
    }
    case 'kept':
      // What is left can exceed the extra (a requester drew less than it asked), and a product
      // may have no extra: both read as plain "Left" rather than an over-filled extra.
      return product.extra !== undefined && amount <= product.extra + FLOW_TOLERANCE
        ? { label: 'Extra:', amount: fmt(amount), note: `of ${fmt(product.extra)}` }
        : plain
    case 'short': {
      const from = product.shortFrom
      if (!from) return plain
      const names = from.blockIds.map(id => possessive(nameOf(id) ?? GONE))
      const list = `${joinNames(names)} ${names.length === 1 ? 'request' : 'requests'}`
      const fromExtra = from.extra > FLOW_TOLERANCE
      const note = names.length === 0
        ? fromExtra ? '— comes out of the extra' : undefined
        : fromExtra ? `— comes out of the extra and ${list}` : `— comes out of ${list}`
      return { label: 'Short', amount: fmt(amount), ...(note ? { note } : {}) }
    }
    default:
      return plain
  }
}
