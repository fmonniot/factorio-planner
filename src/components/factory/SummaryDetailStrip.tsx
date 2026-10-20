import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { SegmentBar } from './SummarySlot'
import { lookStyle, segmentLook } from './segmentLooks'
import { fmtRate } from './ItemTile'
import { segmentLabel, segmentTitle } from './summarySegments'
import { useMoreBelow } from './useMoreBelow'
import type { Overlay, OverviewRow, Segment, SegmentKind, OverlayKind, SlotModel } from './summarySegments'

export type StripState = 'overview' | 'preview' | 'selected' | 'editing'

export interface StripAction {
  label: string
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
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
  onBack: () => void
  onOpenBlock: (blockId: string) => void
  onConnectionContextMenu?: (connectionId: string, e: React.MouseEvent) => void
}

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
  onBack,
  onOpenBlock,
  onConnectionContextMenu,
}: SummaryDetailStripProps) {
  // The strip's height leaves room for three overview rows and a peek at the fourth.
  const { bodyRef: rowsRef, contentRef: rowsContentRef, hasMore: rowsHaveMore, onScroll: onRowsScroll } =
    useMoreBelow<HTMLDivElement, HTMLDivElement>()
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)
  const lookOf = (kind: SegmentKind | OverlayKind, blockId: string | undefined, limited?: boolean) =>
    segmentLook(kind, blockId !== undefined ? colorOf(blockId) : undefined, limited)
  // 110px fits the overview's heading and three rows with a sliver of the fourth, and the
  // detail's header, bar, one line of colour key and the actions.
  const root = 'h-[110px] shrink-0 overflow-hidden border-t border-gray-700 bg-gray-800 rounded-b-md px-2.5 pt-2 pb-1.5 flex flex-col text-[11px]'

  if (state === 'overview' || !slot) {
    const maxTotal = Math.max(...rows.map(r => r.total), 0)
    return (
      <div data-testid="summary-detail" data-state="overview" className={`${root} gap-[7px]`}>
        <div className="flex items-center justify-between h-5 shrink-0">
          <span className="text-xs font-semibold text-gray-100">Overview</span>
          {rows.length > 0 && (
            <span className="text-[10px] text-gray-500">{traceKey ? 'click again to clear' : 'click a row to trace it'}</span>
          )}
        </div>
        {rows.length === 0 && <div className="text-gray-500">Nothing here yet</div>}
        <div className="relative flex-1 min-h-0">
          <div
            ref={rowsRef}
            onScroll={onRowsScroll}
            data-testid="summary-overview-rows"
            data-overflow={rowsHaveMore ? 'true' : undefined}
            className="h-full overflow-y-auto"
          >
            <div ref={rowsContentRef} className="flex flex-col gap-0.5">
              {rows.map(row => {
                const look = lookOf(row.kind, row.blockId, row.limited)
                const on = traceKey === row.key
                const total = row.kind === 'unused'
                  ? 'unused'
                  : row.total > 0 ? fmt(row.total) : '—'
                const width = row.total > 0 && maxTotal > 0 ? Math.max((row.total / maxTotal) * 100, 2) : 0
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-testid="summary-overview-row"
                    data-key={row.key}
                    data-limited={row.limited ? 'true' : undefined}
                    aria-pressed={on}
                    onClick={() => onToggleTrace(row.key)}
                    className={`shrink-0 grid grid-cols-[10px_96px_minmax(0,1fr)_56px_22px] gap-x-2 items-center h-5 px-1 rounded-[3px] border text-left hover:bg-gray-900 ${on ? 'bg-gray-900 text-gray-100' : 'border-transparent'} ${row.limited ? 'text-amber-400' : on ? '' : 'text-gray-300'}`}
                    style={{
                      borderColor: on ? (row.blockId !== undefined ? colorOf(row.blockId) : '#9ca3af') : undefined,
                      opacity: traceKey && !on ? 0.6 : undefined,
                    }}
                  >
                    <span aria-hidden="true" className="w-2 h-2 rounded-[2px]" style={lookStyle(look)} />
                    <span className="truncate">
                      {segmentLabel(row, row.blockId !== undefined ? blockNameOf(row.blockId) : undefined)}
                    </span>
                    <span aria-hidden="true" className="flex h-2">
                      <span className="rounded-[2px]" style={{ ...lookStyle(look), width: `${width}%` }} />
                    </span>
                    <span className="text-right font-mono tabular-nums text-gray-200">{total}</span>
                    <span className="text-right tabular-nums text-gray-500">{row.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {rowsHaveMore && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-gray-800/90 to-transparent" />
          )}
        </div>
      </div>
    )
  }

  const itemName = item?.name ?? slot.itemId
  const entries: (Segment | Overlay)[] = [...slot.segments, ...slot.overlays]
  const editable = state === 'selected' || state === 'editing'

  return (
    <div data-testid="summary-detail" data-state={state} className={`${root} gap-[5px]`}>
      <div className="flex items-center gap-2 h-5 shrink-0 min-w-0">
        {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-[18px] h-[18px] object-contain shrink-0" />}
        <span className="text-xs font-semibold text-gray-100 truncate">{itemName}</span>
        {!editable && (
          <span className="shrink-0 text-[10px] text-gray-500 border border-gray-700 rounded-[3px] px-1">preview</span>
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
        <SegmentBar
          slot={slot}
          colorOf={colorOf}
          variant="detail"
          traceKey={traceKey}
          itemName={itemName}
          blockNameOf={blockNameOf}
          fmt={fmt}
          unit={unit}
          onOpenBlock={onOpenBlock}
          onConnectionContextMenu={onConnectionContextMenu}
        />
      </div>
      <ul className="flex flex-wrap content-start gap-x-3 gap-y-1 flex-1 min-h-0 overflow-y-auto leading-tight">
        {entries.map((entry, i) => {
          const blockName = entry.blockId !== undefined ? blockNameOf(entry.blockId) : undefined
          const amount = 'amount' in entry ? entry.amount : undefined
          const limited = 'limited' in entry && entry.limited
          const available = 'available' in entry ? entry.available : undefined
          const title = segmentTitle(entry, { itemName, blockName, fmt, unit, available })
          const look = lookOf(entry.kind, entry.blockId, limited)
          const body = (
            <>
              <span aria-hidden="true" className="shrink-0 w-2 h-2 rounded-[2px]" style={lookStyle(look)} />
              <span style={{ color: look.legend }}>
                {segmentLabel(entry, blockName)}
              </span>
              {amount !== undefined && (
                <span className="font-mono tabular-nums text-gray-200">{fmt(amount)}</span>
              )}
            </>
          )
          const cls = 'inline-flex items-center gap-[5px] text-left'
          const removable = entry.kind !== 'export' && entry.connectionId !== undefined && onConnectionContextMenu
          const onContextMenu = removable
            ? (e: React.MouseEvent) => {
              e.preventDefault()
              onConnectionContextMenu(entry.connectionId!, e)
            }
            : undefined
          return (
            <li
              key={i}
              data-testid="summary-key-entry"
              data-key={entry.key}
              data-kind={entry.kind}
              title={title}
            >
              {blockName !== undefined && entry.blockId !== undefined ? (
                <button
                  type="button"
                  onClick={() => onOpenBlock(entry.blockId!)}
                  onContextMenu={onContextMenu}
                  className={`${cls} rounded hover:underline`}
                >
                  {body}
                </button>
              ) : (
                <div onContextMenu={onContextMenu} tabIndex={onContextMenu ? 0 : undefined} className={cls}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      {editable && actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {actions.map(a => (
            <button
              key={a.label}
              type="button"
              onClick={a.onSelect}
              className={`bg-gray-900 border border-gray-700 rounded px-2 py-[3px] hover:border-gray-500 ${a.danger ? 'text-red-400' : 'text-gray-300'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
