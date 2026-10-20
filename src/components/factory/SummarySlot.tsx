import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { withAlpha } from '../../data/blockColors'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import { segmentLabel, segmentTitle, slotHasKey } from './summarySegments'
import type { Overlay, Segment, SlotModel } from './summarySegments'

const AMBER = '#f59e0b'

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

function segmentStyle(seg: Segment, variant: 'micro' | 'detail', colorOf: (blockId: string) => string): React.CSSProperties {
  const block = seg.blockId !== undefined ? colorOf(seg.blockId) : undefined
  if (variant === 'micro') {
    switch (seg.kind) {
      case 'export':
      case 'source': return { background: seg.limited ? AMBER : block }
      case 'kept':
      case 'left': return { background: '#4b5563' }
      case 'import': return { background: '#9ca3af' }
      case 'short': return { background: 'rgba(245, 158, 11, .4)' }
    }
  }
  switch (seg.kind) {
    case 'export':
    case 'source': return { background: withAlpha(block!, 0.35), border: `1px solid ${seg.limited ? AMBER : block}` }
    case 'kept':
    case 'left': return { background: '#374151', border: '1px solid #6b7280' }
    case 'import': return { border: '1px solid #d1d5db' }
    case 'short': return { background: 'rgba(245, 158, 11, .15)', border: `1px dashed ${AMBER}` }
  }
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
  const hatched = slot.overlays.some(o => o.kind === 'locked')
  const dashed = slot.overlays.some((o: Overlay) => o.kind !== 'locked')
  const style: React.CSSProperties = {}
  if (dashed) style.outline = '1px dashed #6b7280'
  if (hatched) {
    style.backgroundImage = 'repeating-linear-gradient(45deg, rgba(156,163,175,.35) 0 2px, transparent 2px 5px)'
  }

  return (
    <div
      aria-hidden={detail ? undefined : true}
      className={`relative flex w-full ${detail ? 'h-5 rounded-sm' : 'h-1'}`}
      style={style}
    >
      {slot.segments.map((seg, i) => {
        const pct = slot.scale > 0 ? (seg.amount / slot.scale) * 100 : 0
        const segStyleProps: React.CSSProperties = {
          flex: `0 0 ${pct}%`,
          ...segmentStyle(seg, variant, colorOf),
          opacity: traceKey && traceKey !== seg.key ? 0.25 : undefined,
        }
        if (!detail) return <div key={i} style={segStyleProps} />

        const blockName = seg.blockId !== undefined ? blockNameOf?.(seg.blockId) : undefined
        const common = {
          'data-testid': 'summary-segment',
          'data-kind': seg.kind,
          'data-key': seg.key,
          'data-limited': seg.limited ? 'true' : undefined,
          title: segmentTitle(seg, { itemName, blockName, fmt: fmt!, unit, available: seg.available }),
          style: segStyleProps,
          className: 'min-w-0 overflow-hidden whitespace-nowrap text-[10px] leading-none flex items-center px-1 text-gray-100',
        }
        const label = pct >= 20 ? segmentLabel(seg, blockName) : null
        const linked = (seg.kind === 'export' || seg.kind === 'source') && blockName !== undefined
        if (!linked) return <div key={i} {...common}>{label}</div>
        return (
          <button
            key={i}
            type="button"
            {...common}
            onClick={() => onOpenBlock?.(seg.blockId!)}
            onContextMenu={seg.kind === 'source' && seg.connectionId !== undefined
              ? e => {
                e.preventDefault()
                onConnectionContextMenu?.(seg.connectionId!, e)
              }
              : undefined}
          >
            {label}
          </button>
        )
      })}
      {slot.goal && slot.goal.tickAt !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white"
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
  const border = selected
    ? 'border-teal-500'
    : slot.status === 'short' || slot.status === 'limited'
      ? 'border-amber-500'
      : 'border-gray-700'
  const opacity = traced === 'out' ? 'opacity-30' : slot.dimmed ? 'opacity-50' : ''
  const badge = slot.status ? BADGES[slot.status] : null

  return (
    <button
      type="button"
      data-testid="summary-slot"
      data-item-id={slot.itemId}
      data-status={slot.status ?? undefined}
      data-dimmed={slot.dimmed || undefined}
      data-traced={traced}
      aria-pressed={selected}
      aria-label={`${name}, ${fmtRate(slot.rate / 60, rateUnit)} per ${rateUnit === 'min' ? 'minute' : 'second'}`}
      title={name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`relative w-[50px] h-[54px] shrink-0 rounded border bg-gray-800 hover:bg-gray-700 ${border} ${opacity}`}
    >
      <span className="absolute inset-x-0 top-1 flex justify-center">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt="" className="w-7 h-7 object-contain" />
        ) : (
          <span className="text-[9px] text-gray-400 truncate max-w-[44px]">{name}</span>
        )}
      </span>
      <span
        className="absolute right-0.5 bottom-1.5 font-mono text-[10px] leading-none text-gray-100"
        style={{ textShadow: '0 0 2px #000, 1px 1px 1px #000' }}
      >
        {fmtRate(slot.rate / 60, rateUnit)}
      </span>
      {badge && (
        <span aria-hidden="true" className={`absolute right-0.5 top-0 text-[10px] leading-none ${badge.className}`}>
          {badge.glyph}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 px-px pb-px">
        <SegmentBar slot={slot} colorOf={colorOf} variant="micro" traceKey={traceKey} />
      </span>
    </button>
  )
}
