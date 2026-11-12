import type { ConnectionFlow, Product } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { FLOW_TOLERANCE, surplusTolerance } from '../../solver/index'
import { fmtPower } from './ItemTile'
import { isEnergyItem } from '../../data/electricity'
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
  /** short only, on an ingredient: the item has Import off and this is what the other sources leave of it ("Missing") */
  missing?: true
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
  /** Whether the output differs from the requirement beyond what the display rounding hides (false before a solve and when nothing is asked). */
  differs: boolean
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
  /** ingredients only: the item has a source rule with an effect, so the slot and its line chip show the marker */
  sourceRule?: true
  /** products only: nothing requested, no extra, nothing exported or made; drawn as "—" */
  empty?: true
}

export interface OverviewRow {
  key: string
  kind: SegmentKind | OverlayKind
  blockId?: string
  /** items/min of the segments under this key, electricity and heat excluded (no common unit) */
  total: number
  /** units/min of the electricity and heat segments under this key, kept out of `total` */
  power: number
  /** A segment under this key belongs to a loop of blocks. */
  loop?: true
  /** Number of slots carrying this key. */
  count: number
  limited: boolean
  /** The segments under this key are an Import-off item's missing amount. */
  missing?: true
}

/**
 * Whether a gap (items/min) survives the display rounding, so "short by 0.00/m" never shows.
 * Electricity and heat are shown in W/kW/MW whatever the rate unit, so it is rounded the same way
 * and the answer does not depend on the toggle.
 */
function visibleGap(gapPerMin: number, unit: RateUnit, itemId?: string): boolean {
  if (isEnergyItem(itemId)) return parseFloat(fmtPower(gapPerMin / 60 * 1000).value) > 0
  const v = unit === 'min' ? gapPerMin : gapPerMin / 60
  return parseFloat(v.toFixed(2)) > 0
}

// A shortfall only counts when it survives the display rounding.
export function isShortfall(target: number, actual: number, unit: RateUnit, itemId?: string): boolean {
  return actual < target - surplusTolerance(Math.max(target, actual)) && visibleGap(target - actual, unit, itemId)
}

export function differsFromTarget(target: number, actual: number, unit: RateUnit, itemId?: string): boolean {
  return Math.abs(actual - target) > surplusTolerance(Math.max(target, actual)) && visibleGap(Math.abs(target - actual), unit, itemId)
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
    differs: boolean,
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
    differs,
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
      product: info(actualPerMin, false, false, null),
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
      product: info(undefined, false, false, null),
    }
  }

  const segments = exportSegments(exports)
  const kept = Math.max(0, actualPerMin - sum(segments))
  if (kept > surplusTolerance(actualPerMin)) segments.push({ key: 'kept', kind: 'kept', amount: kept })
  const short = asked && isShortfall(required, actualPerMin, unit, product.itemId)
  if (short) segments.push({ key: 'short', kind: 'short', amount: required - actualPerMin })
  const scale = Math.max(required, sum(segments))
  const differs = asked && differsFromTarget(required, actualPerMin, unit, product.itemId)
  // The extra gives way first; the rest falls on the requests served last (see `connectionOffer`).
  let shortFrom: ProductInfo['shortFrom']
  if (short) {
    const missing = required - actualPerMin
    const extraPart = Math.min(extra ?? 0, missing)
    const requestPart = missing - extraPart
    // Only requesters the source left wanting: `limited` means the consumer took everything on
    // offer and still imports the item. One under-served for another reason (it took the item
    // from another block first, so it drew less than it asked) is `ok` or `unused`, not blamed.
    const blockIds = requestPart > surplusTolerance(Math.max(required, actualPerMin))
      ? requests
          .filter(f => f.status === 'limited' && f.rate < (f.requested ?? 0) - surplusTolerance(f.requested ?? 0))
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
      differs,
      differs ? required / scale : null,
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

/** `ruleItems`: the items of the block that have a source rule with an effect (`sourceRuleItems`). */
export function ingredientSlot(
  row: IngredientRow,
  flows: Map<string, ConnectionFlow>,
  blockIds: ReadonlySet<string>,
  ruleItems?: ReadonlySet<string>,
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
  // With Import off, what the other sources leave is not imported: it is missing, and the slot is short.
  const missing = row.locked && row.importPerMin !== undefined && row.importPerMin > 0
  if (row.importPerMin !== undefined && row.importPerMin > 0) {
    segments.push(missing
      ? { key: 'missing', kind: 'short', amount: row.importPerMin, missing: true }
      : { key: 'import', kind: 'import', amount: row.importPerMin })
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
    status: missing ? 'short' : segments.some(s => s.limited) ? 'limited' : row.locked ? 'locked' : null,
    dimmed: (row.locked && !missing) || need <= FLOW_TOLERANCE,
    locked: row.locked,
    ...(ruleItems?.has(row.itemId) ? { sourceRule: true as const } : {}),
  }
}

const RANK: Record<string, number> = { kept: 1, left: 1, short: 2, missing: 2, import: 2, locked: 3 }
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
        row = { key, kind, blockId, total: 0, power: 0, count: 0, limited: false }
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
      if (isEnergyItem(slot.itemId)) row.power += s.amount
      else row.total += s.amount
      if (s.loop) row.loop = true
      if (s.limited) row.limited = true
      if (s.missing) row.missing = true
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
  e: { kind: SegmentKind | OverlayKind; loop?: true; missing?: true },
  blockName: string | undefined,
): string {
  const mark = e.loop ? ' ↻' : ''
  switch (e.kind) {
    case 'export': return `→ ${blockName ?? GONE}${mark}`
    case 'source': return `← ${blockName ?? GONE}${mark}`
    case 'kept': return 'Left'
    case 'left': return 'Left'
    case 'import': return 'Imported'
    case 'short': return e.missing ? 'Missing' : 'Short'
    case 'unused': return `← ${blockName ?? GONE} · unused`
    case 'self': return `← ${blockName ?? GONE} · self, ignored`
    case 'missing-source': return GONE
    case 'locked': return 'Import off'
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
  if (entry.kind === 'short' && (entry as Segment).missing && amount !== undefined) {
    return { label: 'Missing', amount: fmt(amount), note: '— Import is off' }
  }
  if (!product || amount === undefined) return plain
  switch (entry.kind) {
    case 'export': {
      const requestedRate = (entry as Segment).requestedRate
      if (requestedRate === undefined) return plain
      const name = `${blockName ?? GONE}${entry.loop ? ' ↻' : ''}`
      // Beyond its ask a request can also draw what nobody holds: the label states the ask.
      return amount >= requestedRate - surplusTolerance(requestedRate)
        ? { label: `${name} requests`, amount: fmt(requestedRate) }
        : { label: `${name}:`, amount: fmt(amount), note: `of ${fmt(requestedRate)} requested` }
    }
    case 'kept':
      // What is left can exceed the extra (a requester drew less than it asked), and a product
      // may have no extra: both read as plain "Left" rather than an over-filled extra.
      return product.extra !== undefined && amount <= product.extra + surplusTolerance(product.extra)
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

/** The name a segment writes in the bar: a key entry's label without its "requests" or colon. */
export function barName(label: string): string {
  return label.replace(/ requests$/, '').replace(/:$/, '')
}

/** The accessible name of a bar segment: what its tooltip says on its first line. */
export function barAccessibleName(name: string, amount?: string, note?: string): string {
  return [name, amount, note].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------
// Stacked-bar layout —the detail strip's bar and the overview bar share it.
// Pure arithmetic: segment widths from weights, and how much text each can carry.
// ---------------------------------------------------------------------------

/** Width of a segment too thin to size by weight; it keeps this much so it stays visible and hoverable. */
export const BAR_MIN_SEGMENT_PX = 3
/** Gap between two segments. */
export const BAR_GAP_PX = 1
/** Estimated width of one character of the 10px monospace amount. */
const BAR_CHAR_PX = 6.2
/** A segment writes its name once it is this much wider than its amount takes. */
const BAR_NAME_EXTRA_PX = 46
/** Same, for the amount: the amount's own width plus this. */
const BAR_AMOUNT_EXTRA_PX = 4
/** A segment with no amount writes its name alone from this width. */
const BAR_NAME_ONLY_PX = 60

export interface BarPartInput {
  /** Share of the bar; only the ratios matter. A part with no weight keeps the minimum width. */
  weight: number
  /** A mark of fixed width that takes no share of the bar. */
  fixedPx?: number
  /** The amount written in the bar, when there is one. */
  amount?: string
  /** The amount with the item count riding along ("381 · 14"); written instead of the amount when it fits. */
  withCount?: string
}

export interface BarPartLayout {
  px: number
  /** Distance of the segment's middle from the bar's left edge. */
  center: number
  /** What is written after the name: the amount, or the amount with its count; undefined when the segment is too narrow. */
  amount: string | undefined
  /** Whether the name is written in the segment. */
  name: boolean
}

/**
 * Sizes the parts of a bar `width` px wide: the gaps and the fixed marks come off first, the rest is
 * shared by weight, and parts under 3 px keep 3 px (the others give that room up, so the bar never
 * spills out; a part the minimums push under 3 px takes 3 px too). The text each part carries follows
 * its width: name and amount when the amount's width plus 46 px fits, the amount alone from its width plus 4 px, nothing below that.
 */
export function layoutBar(parts: BarPartInput[], width: number): BarPartLayout[] {
  const flexible = parts.filter(p => p.fixedPx === undefined)
  const fixed = parts.reduce((total, p) => total + (p.fixedPx ?? 0), 0)
  const avail = Math.max(0, width - Math.max(0, parts.length - 1) * BAR_GAP_PX - fixed)
  const weightSum = flexible.reduce((total, p) => total + Math.max(0, p.weight), 0)
  const share = (p: BarPartInput) => weightSum > 0 ? Math.max(0, p.weight) / weightSum : 1 / flexible.length
  // A part is tiny when its share of what is left, once the tiny ones took their 3 px, is under 3 px;
  // taking those 3 px can push another part under, so this repeats until it settles.
  const tiny = new Set<BarPartInput>()
  const bigShare = () => flexible.reduce((total, p) => total + (tiny.has(p) ? 0 : share(p)), 0) || 1
  const scale = () => Math.max(0, avail - tiny.size * BAR_MIN_SEGMENT_PX) / bigShare()
  for (;;) {
    const s = scale()
    const next = flexible.filter(p => !tiny.has(p) && share(p) * s < BAR_MIN_SEGMENT_PX)
    if (next.length === 0) break
    next.forEach(p => tiny.add(p))
  }
  let x = 0
  return parts.map(p => {
    const px = p.fixedPx ?? (tiny.has(p) ? BAR_MIN_SEGMENT_PX : Math.round(share(p) * scale() * 10) / 10)
    const center = x + px / 2
    x += px + BAR_GAP_PX
    const counted = p.withCount !== undefined && p.withCount !== p.amount && px >= p.withCount.length * BAR_CHAR_PX + 14
    const text = counted ? p.withCount : p.amount
    const hasText = text !== undefined && text !== ''
    const amountW = (hasText ? text.length : 0) * BAR_CHAR_PX + 10
    const showAmount = hasText && px >= amountW + BAR_AMOUNT_EXTRA_PX
    return {
      px,
      center,
      amount: showAmount ? text : undefined,
      name: showAmount ? px >= amountW + BAR_NAME_EXTRA_PX : !hasText && px >= BAR_NAME_ONLY_PX,
    }
  })
}

/** Widest a segment's tooltip is allowed to be; its lines wrap beyond that. */
export const BAR_TIP_MAX_PX = 280

export interface TipPlacement {
  /** The tooltip's maximum width: never more than the bar. */
  maxWidth: number
  /** Which edge of the segment it hangs from, or `shifted` (aligned on the bar's left edge, `left` px from the segment's). */
  align: 'center' | 'left' | 'right' | 'shifted'
  left?: number
}

/**
 * Where the tooltip of the segment laid out as `part` goes so that it stays inside a bar `width` px wide
 * whatever its length (up to `maxWidth`): centred when that fits, else hung from the segment's left
 * edge, else from its right edge, else aligned on the bar's left edge.
 */
export function tipPlacement(part: Pick<BarPartLayout, 'px' | 'center'>, width: number): TipPlacement {
  const maxWidth = Math.min(BAR_TIP_MAX_PX, width)
  const left = part.center - part.px / 2
  const right = part.center + part.px / 2
  if (part.center - maxWidth / 2 >= 0 && part.center + maxWidth / 2 <= width) return { maxWidth, align: 'center' }
  if (left + maxWidth <= width) return { maxWidth, align: 'left' }
  if (right - maxWidth >= 0) return { maxWidth, align: 'right' }
  return { maxWidth, align: 'shifted', left: -left }
}
