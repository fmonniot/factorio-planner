import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { StackedBar } from './StackedBar'
import type { BarSegment } from './StackedBar'
import { segmentLook } from './segmentLooks'
import { fmtRate, fmtItemRateText, fmtEnergyText } from './ItemTile'
import { isEnergyItem } from '../../data/electricity'
import { barName, keyEntryText, segmentLabel, segmentTitle } from './summarySegments'
import type { Overlay, OverviewRow, Segment, SegmentKind, OverlayKind, SlotModel } from './summarySegments'

export type StripState = 'overview' | 'preview' | 'selected' | 'editing'

export interface StripAction {
  label: string
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
  disabled?: boolean
  /** Tooltip, used to say why the action is disabled. */
  title?: string
}

interface SummaryDetailStripProps {
  state: StripState
  /** The slot shown in the preview, selected and editing states. */
  slot: SlotModel | undefined
  item: Item | undefined
  rateUnit: RateUnit
  colorOf: (blockId: string) => string
  /** Name of a block; undefined when it no longer exists. */
  blockNameOf: (blockId: string) => string | undefined
  rows: OverviewRow[]
  traceKey: string | null
  onToggleTrace: (key: string) => void
  /** The slot's header rates (the pane decides what they say and whether they are editable). */
  rates: React.ReactNode
  actions: StripAction[]
  /** Editable states only: one more entry at the end of the actions line. */
  keyExtra?: React.ReactNode
  /** Selected state only: a block of controls under the actions line (the Ingredients pane's Comes from). */
  controls?: React.ReactNode
  /** The pane holds controls for its selected slot: the strip keeps room for them while another slot is previewed. */
  tall?: boolean
  onBack: () => void
  onOpenBlock: (blockId: string) => void
  onConnectionContextMenu?: (connectionId: string, e: React.MouseEvent) => void
}

/** Width of the mark an overlay leaves on a bar that has real segments too. */
const OVERLAY_MARK_PX = 10
/** Entries whose tooltip has a second line: what a click does, why a source is limited. */
const EXPLAINED_KINDS: ReadonlySet<string> = new Set(['export', 'source', 'unused', 'missing-source', 'self'])

export function SummaryDetailStrip({
  state,
  slot,
  item,
  rateUnit,
  colorOf,
  blockNameOf,
  rows,
  traceKey,
  onToggleTrace,
  rates,
  actions,
  keyExtra,
  controls,
  tall = false,
  onBack,
  onOpenBlock,
  onConnectionContextMenu,
}: SummaryDetailStripProps) {
  // An electricity or heat slot is shown in power units, unit included. The overview totals items and
  // shows electricity and heat apart, in power units.
  const power = state !== 'overview' && slot !== undefined && isEnergyItem(slot.itemId)
  const unit = power ? '' : rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => power ? fmtItemRateText(slot!.itemId, perMin / 60, rateUnit) : fmtRate(perMin / 60, rateUnit)
  const lookOf = (kind: SegmentKind | OverlayKind, blockId: string | undefined, limited?: boolean) =>
    segmentLook(kind, blockId !== undefined ? colorOf(blockId) : undefined, limited)
  // A fixed 72px: the item's header, a 16px bar and the actions line, or the overview's heading and
  // bar. The tooltips open upward over the slots, so the strip does not clip. A pane that has controls for its
  // selected slot keeps a minimum height that holds them, in every state, so the panes do not jump when the
  // pointer passes over another slot.
  const root = `${tall ? 'min-h-[156px]' : 'h-[72px]'} shrink-0 border-t border-gray-700 bg-gray-800 rounded-b-md px-2.5 flex flex-col text-[11px]`

  if (state === 'overview' || !slot) {
    const maxTotal = Math.max(...rows.map(r => r.total), 0)
    const maxPower = Math.max(...rows.map(r => r.power), 0)
    const segments: BarSegment[] = rows.map(row => {
      const look = lookOf(row.kind, row.blockId, row.limited)
      const on = traceKey === row.key
      const name = segmentLabel(row, row.blockId !== undefined ? blockNameOf(row.blockId) : undefined)
      const amount = row.kind === 'unused'
        ? undefined
        : row.total > 0 ? fmt(row.total)
          : row.power > 0 ? fmtEnergyText(row.power / 60) : undefined
      const mixed = row.total > 0 && row.power > 0
        ? `${fmt(row.total)}${unit} of items + ${fmtEnergyText(row.power / 60)}`
        : undefined
      // Items are sized by their total; electricity and heat, which have no common unit with them, by theirs.
      const weight = row.total > 0 ? (maxTotal > 0 ? row.total / maxTotal : 0)
        : row.power > 0 ? (maxPower > 0 ? row.power / maxPower : 0) : 0
      return {
        key: row.key,
        look,
        weight,
        name,
        amount,
        withCount: amount !== undefined ? `${amount} · ${row.count}` : undefined,
        tipName: name,
        tipAmount: mixed ?? amount,
        note: `${row.count} ${row.count === 1 ? 'item' : 'items'}`,
        pressed: on,
        faded: traceKey !== null && !on,
        dataKind: row.kind,
        limited: row.limited,
        testId: 'summary-overview-segment',
        onClick: () => onToggleTrace(row.key),
      }
    })
    return (
      <div data-testid="summary-detail" data-state="overview" className={`${root} ${rows.length > 0 ? 'pt-[5px] pb-[3px] gap-[3px]' : 'pt-1.5 pb-1 gap-[5px]'}`}>
        <div className="flex items-center justify-between h-5 shrink-0">
          <span className="text-xs font-semibold text-gray-100">Overview</span>
          {rows.length > 0 && (
            <span className="text-[10px] text-gray-400">{traceKey ? 'click again to clear' : 'click a segment to trace it'}</span>
          )}
        </div>
        {rows.length === 0 ? <div className="text-gray-500">Nothing here yet</div> : <StackedBar segments={segments} label="Overview" />}
      </div>
    )
  }

  const itemName = item?.name ?? slot.itemId
  const editable = state === 'selected' || state === 'editing'
  const entries: (Segment | Overlay)[] = [...slot.segments, ...slot.overlays]
  // A slot with nothing allocated (an unused source, Import off) shows its overlays across the bar;
  // on a slot that has segments they are marks at its end.
  const overlayOnly = slot.segments.length === 0 && slot.overlays.length > 0
  const segments: BarSegment[] = entries.map(entry => {
    const blockName = entry.blockId !== undefined ? blockNameOf(entry.blockId) : undefined
    const limited = 'limited' in entry && entry.limited === true
    const available = 'available' in entry ? entry.available : undefined
    const text = keyEntryText(entry, { blockName, product: slot.product, fmt, nameOf: blockNameOf })
    const isOverlay = !('amount' in entry)
    const linked = blockName !== undefined && entry.blockId !== undefined
    const removable = entry.kind !== 'export' && entry.connectionId !== undefined && onConnectionContextMenu
    return {
      key: entry.key,
      look: lookOf(entry.kind, entry.blockId, limited),
      weight: isOverlay ? (overlayOnly ? 1 : 0) : entry.amount,
      ...(isOverlay && !overlayOnly ? { fixedPx: OVERLAY_MARK_PX } : {}),
      name: barName(text.label),
      amount: text.amount,
      tipName: text.label,
      tipAmount: text.amount,
      note: text.note,
      detail: EXPLAINED_KINDS.has(entry.kind)
        ? segmentTitle(entry, { itemName, blockName, fmt, unit, available })
        : undefined,
      dataKind: entry.kind,
      limited,
      testId: 'summary-segment',
      onClick: linked ? () => onOpenBlock(entry.blockId!) : undefined,
      onContextMenu: removable
        ? (e: React.MouseEvent) => {
          e.preventDefault()
          onConnectionContextMenu(entry.connectionId!, e)
        }
        : undefined,
    }
  })
  const showActions = editable && (actions.length > 0 || !!keyExtra)

  return (
    <div data-testid="summary-detail" data-state={state} className={`${root} pt-[5px] pb-[3px] gap-[3px]`}>
      <div className="flex items-center gap-2 h-5 shrink-0 min-w-0">
        {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-[18px] h-[18px] object-contain shrink-0" />}
        <span className="text-xs font-semibold text-gray-100 truncate">{itemName}</span>
        {!editable && (
          <span className="shrink-0 text-[10px] text-gray-400 border border-gray-700 rounded-[3px] px-1">preview</span>
        )}
        <span className="flex items-center justify-end gap-1 min-w-0 flex-1">{rates}</span>
        {editable && (
          <button
            type="button"
            aria-label="Back to overview"
            onClick={onBack}
            className="shrink-0 inline-flex text-gray-400 hover:text-gray-100 pl-1"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="shrink-0">
        <StackedBar segments={segments} tickAt={slot.product?.tickAt ?? null} label={`${itemName} allocation`} />
      </div>
      {showActions && (
        <div className="flex items-center gap-1.5 shrink-0 h-[22px]">
          {actions.map(a => (
            <button
              key={a.label}
              type="button"
              onClick={a.onSelect}
              disabled={a.disabled}
              title={a.title}
              className={`bg-gray-900 border border-gray-700 rounded px-2 py-0.5 leading-4 whitespace-nowrap hover:border-gray-500 disabled:opacity-40 disabled:cursor-default disabled:hover:border-gray-700 ${a.danger ? 'text-red-400' : 'text-gray-300'}`}
            >
              {a.label}
            </button>
          ))}
          {keyExtra && <span data-testid="summary-key-extra" className="inline-flex">{keyExtra}</span>}
        </div>
      )}
      {state === 'selected' && controls}
    </div>
  )
}
