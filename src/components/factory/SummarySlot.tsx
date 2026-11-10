import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { fmtItemRate, fmtItemRateText } from './ItemTile'
import { isEnergyItem } from '../../data/electricity'
import { slotHasKey } from './summarySegments'
import type { Overlay, Segment, SlotModel } from './summarySegments'
import { segmentLook } from './segmentLooks'

// ---------------------------------------------------------------------------
// SegmentBar — an item's allocation as the thin stacked bar at the bottom of
// a slot. The strip's full-size bar is a StackedBar.
// ---------------------------------------------------------------------------

interface SegmentBarProps {
  slot: SlotModel
  colorOf: (blockId: string) => string
  /** Overview segment being traced; segments with another key fade. */
  traceKey: string | null
}

export function SegmentBar({ slot, colorOf, traceKey }: SegmentBarProps) {
  const lookOf = (e: Segment | Overlay) =>
    segmentLook(e.kind, e.blockId !== undefined ? colorOf(e.blockId) : undefined, 'limited' in e && e.limited)
  const fade = (key: string) => (traceKey && traceKey !== key ? 0.2 : undefined)

  // A slot with nothing allocated (an unused source, imports forbidden) shows its overlays across the bar.
  const overlayOnly = slot.segments.length === 0 && slot.overlays.length > 0
  const parts: { entry: Segment | Overlay; pct: number }[] = overlayOnly
    ? slot.overlays.map(o => ({ entry: o, pct: 100 / slot.overlays.length }))
    : slot.segments.map(s => ({ entry: s, pct: slot.scale > 0 ? (s.amount / slot.scale) * 100 : 0 }))

  return (
    <span aria-hidden="true" className="flex h-1 gap-px rounded-[1px] overflow-hidden">
      {parts.map(({ entry, pct }, i) => (
        <span key={i} style={{ flex: `0 1 ${pct}%`, background: lookOf(entry).mini, opacity: fade(entry.key) }} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// SummarySlot — one item in a summary pane
// ---------------------------------------------------------------------------

/** Drag-to-reorder wiring for a slot; only the Products pane passes it. */
export interface SlotDnd {
  dragging: boolean
  dropSide: 'before' | 'after' | null
  onDragStart: React.DragEventHandler<HTMLButtonElement>
  onDragEnd: React.DragEventHandler<HTMLButtonElement>
  onDragOver: React.DragEventHandler<HTMLButtonElement>
  onDragLeave: React.DragEventHandler<HTMLButtonElement>
  onDrop: React.DragEventHandler<HTMLButtonElement>
}

/** dataTransfer type of a dragged summary slot. */
export const SLOT_DRAG_TYPE = 'application/x-product-slot'

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
  dnd?: SlotDnd
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
  dnd,
}: SummarySlotProps) {
  const name = item?.name ?? slot.itemId
  const traced = traceKey ? (slotHasKey(slot, traceKey) ? 'in' : 'out') : undefined
  const warn = slot.status === 'short' || slot.status === 'limited'
  const tone = selected
    ? 'border-teal-400 bg-[#0f2a2a]'
    : `${warn ? 'border-amber-700' : 'border-gray-700'} bg-gray-800 hover:bg-gray-700`
  const opacity = (slot.dimmed ? 0.55 : 1) * (traced === 'out' ? 0.3 : 1) * (dnd?.dragging ? 0.4 : 1)
  const badge = slot.status ? BADGES[slot.status] : null
  const ariaRate = isEnergyItem(slot.itemId)
    ? (() => { const r = fmtItemRate(slot.itemId, slot.rate / 60, rateUnit); return `${r.value} ${r.unit}` })()
    : `${fmtItemRate(slot.itemId, slot.rate / 60, rateUnit).value} per ${rateUnit === 'min' ? 'minute' : 'second'}`
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
      aria-label={
        slot.empty
          ? `${name}, nothing requested yet`
          : `${name}, ${ariaRate}${slot.status ? `, ${slot.status}` : ''}`
      }
      title={slot.empty ? `${name} — nothing requested yet` : name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      draggable={dnd ? true : undefined}
      data-dragging={dnd?.dragging || undefined}
      onDragStart={dnd?.onDragStart}
      onDragEnd={dnd?.onDragEnd}
      onDragOver={dnd?.onDragOver}
      onDragLeave={dnd?.onDragLeave}
      onDrop={dnd?.onDrop}
      className={`relative w-[50px] h-[54px] shrink-0 rounded border ${slot.empty ? 'border-dashed ' : ''}${tone}`}
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
        {slot.empty ? '—' : isEnergyItem(slot.itemId) ? fmtItemRateText(slot.itemId, slot.rate / 60, rateUnit) : fmtItemRate(slot.itemId, slot.rate / 60, rateUnit).value}
      </span>
      {badge && (
        <span aria-hidden="true" className={`absolute right-[3px] top-px text-[9px] font-bold leading-none ${badge.className}`}>
          {badge.glyph}
        </span>
      )}
      <span className="absolute left-1 right-1 bottom-[3px]">
        <SegmentBar slot={slot} colorOf={colorOf} traceKey={traceKey} />
      </span>
      {dnd?.dropSide && (
        <span
          aria-hidden="true"
          data-testid="summary-slot-drop-line"
          data-side={dnd.dropSide}
          className={`absolute top-0 bottom-0 w-0.5 bg-blue-500 pointer-events-none ${dnd.dropSide === 'before' ? '-left-[3px]' : '-right-[3px]'}`}
        />
      )}
    </button>
  )
}
