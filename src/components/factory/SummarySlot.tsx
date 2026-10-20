import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import { segmentLabel, segmentTitle, slotHasKey } from './summarySegments'
import type { Overlay, Segment, SlotModel } from './summarySegments'
import { lookStyle, segmentLook } from './segmentLooks'

// ---------------------------------------------------------------------------
// SegmentBar — an item's allocation as a stacked bar. The micro variant sits
// at the bottom of a slot; the detail variant is the strip's full-size bar.
// ---------------------------------------------------------------------------

interface SegmentBarProps {
  slot: SlotModel
  colorOf: (blockId: string) => string
  variant: 'micro' | 'detail'
  /** Overview row being traced; segments with another key fade. */
  traceKey: string | null
  // Detail variant only:
  itemName?: string
  /** Name of a block; undefined when it no longer exists. */
  blockNameOf?: (blockId: string) => string | undefined
  fmt?: (perMin: number) => string
  unit?: string
  onOpenBlock?: (blockId: string) => void
  onConnectionContextMenu?: (connectionId: string, e: React.MouseEvent) => void
}

export function SegmentBar({
  slot,
  colorOf,
  variant,
  traceKey,
  itemName = '',
  blockNameOf,
  fmt,
  unit = '',
  onOpenBlock,
  onConnectionContextMenu,
}: SegmentBarProps) {
  const detail = variant === 'detail'
  const lookOf = (e: Segment | Overlay) =>
    segmentLook(e.kind, e.blockId !== undefined ? colorOf(e.blockId) : undefined, 'limited' in e && e.limited)
  const fade = (key: string) => (traceKey && traceKey !== key ? (detail ? 0.25 : 0.2) : undefined)

  // A slot with nothing allocated (an unused source, imports forbidden) shows its overlays across the bar.
  const overlayOnly = slot.segments.length === 0 && slot.overlays.length > 0
  const parts: { entry: Segment | Overlay; pct: number }[] = overlayOnly
    ? slot.overlays.map(o => ({ entry: o, pct: 100 / slot.overlays.length }))
    : slot.segments.map(s => ({ entry: s, pct: slot.scale > 0 ? (s.amount / slot.scale) * 100 : 0 }))

  if (!detail) {
    return (
      <span aria-hidden="true" className="flex h-1 gap-px rounded-[1px] overflow-hidden">
        {parts.map(({ entry, pct }, i) => (
          <span key={i} style={{ flex: `0 1 ${pct}%`, background: lookOf(entry).mini, opacity: fade(entry.key) }} />
        ))}
      </span>
    )
  }

  // Overlays on a slot that still has segments mark the whole bar.
  const marked = !overlayOnly && slot.overlays.length > 0
  return (
    <div
      className="relative flex w-full h-5 gap-px rounded-[3px] overflow-hidden"
      style={marked ? { outline: '1px dashed #6b7280', outlineOffset: -1 } : undefined}
    >
      {parts.map(({ entry, pct }, i) => {
        const look = lookOf(entry)
        const blockName = entry.blockId !== undefined ? blockNameOf?.(entry.blockId) : undefined
        const amount = 'amount' in entry ? entry.amount : undefined
        const available = 'available' in entry ? entry.available : undefined
        const common = {
          'data-testid': 'summary-segment',
          'data-kind': entry.kind,
          'data-key': entry.key,
          'data-limited': 'limited' in entry && entry.limited ? 'true' : undefined,
          title: segmentTitle(entry, { itemName, blockName, fmt: fmt!, unit, available }),
          style: { flex: `0 1 ${pct}%`, ...lookStyle(look), color: look.text, opacity: fade(entry.key) },
          className: 'min-w-0 overflow-hidden whitespace-nowrap text-[11px] leading-none flex items-center px-1.5',
        }
        const label = pct >= 20
          ? `${segmentLabel(entry, blockName)}${amount !== undefined ? ` ${fmt!(amount)}` : ''}`
          : null
        const linked = (entry.kind === 'export' || entry.kind === 'source') && blockName !== undefined
        if (!linked) return <div key={i} {...common}>{label}</div>
        return (
          <button
            key={i}
            type="button"
            {...common}
            onClick={() => onOpenBlock?.(entry.blockId!)}
            onContextMenu={entry.kind === 'source' && entry.connectionId !== undefined
              ? e => {
                e.preventDefault()
                onConnectionContextMenu?.(entry.connectionId!, e)
              }
              : undefined}
          >
            {label}
          </button>
        )
      })}
      {slot.goal && slot.goal.tickAt !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 -ml-px bg-gray-200"
          style={{ left: `${slot.goal.tickAt * 100}%` }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummarySlot — one item in a summary pane
// ---------------------------------------------------------------------------

interface SummarySlotProps {
  slot: SlotModel
  item: Item | undefined
  rateUnit: RateUnit
  colorOf: (blockId: string) => string
  selected: boolean
  traceKey: string | null
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu: React.MouseEventHandler<HTMLButtonElement>
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const BADGES = {
  short: { glyph: '▼', className: 'text-amber-400' },
  limited: { glyph: '!', className: 'text-amber-400' },
  locked: { glyph: '⊘', className: 'text-gray-400' },
} as const

export function SummarySlot({
  slot,
  item,
  rateUnit,
  colorOf,
  selected,
  traceKey,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
}: SummarySlotProps) {
  const name = item?.name ?? slot.itemId
  const traced = traceKey ? (slotHasKey(slot, traceKey) ? 'in' : 'out') : undefined
  const warn = slot.status === 'short' || slot.status === 'limited'
  const tone = selected
    ? 'border-teal-400 bg-[#0f2a2a]'
    : `${warn ? 'border-amber-700' : 'border-gray-700'} bg-gray-800 hover:bg-gray-700`
  const opacity = (slot.dimmed ? 0.55 : 1) * (traced === 'out' ? 0.3 : 1)
  const badge = slot.status ? BADGES[slot.status] : null
  const countColor = slot.status === 'short' ? 'text-amber-400' : slot.rate > 0 ? 'text-gray-100' : 'text-gray-400'

  return (
    <button
      type="button"
      data-testid="summary-slot"
      data-item-id={slot.itemId}
      data-status={slot.status ?? undefined}
      data-dimmed={slot.dimmed || undefined}
      data-traced={traced}
      aria-pressed={selected}
      aria-label={`${name}, ${fmtRate(slot.rate / 60, rateUnit)} per ${rateUnit === 'min' ? 'minute' : 'second'}${slot.status ? `, ${slot.status}` : ''}`}
      title={name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`relative w-[50px] h-[54px] shrink-0 rounded border ${tone}`}
      style={opacity < 1 ? { opacity } : undefined}
    >
      <span className="absolute inset-x-0 top-1.5 flex justify-center">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt="" className="w-6 h-6 object-contain" />
        ) : (
          <span className="text-[9px] text-gray-400 truncate max-w-[44px]">{name}</span>
        )}
      </span>
      <span
        className={`absolute right-1 bottom-[9px] font-mono font-semibold text-[10px] leading-none ${countColor}`}
        style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}
      >
        {fmtRate(slot.rate / 60, rateUnit)}
      </span>
      {badge && (
        <span aria-hidden="true" className={`absolute right-[3px] top-px text-[9px] font-bold leading-none ${badge.className}`}>
          {badge.glyph}
        </span>
      )}
      <span className="absolute left-1 right-1 bottom-[3px]">
        <SegmentBar slot={slot} colorOf={colorOf} variant="micro" traceKey={traceKey} />
      </span>
    </button>
  )
}
