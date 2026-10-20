import type { Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { KEPT_COLOR, SHORT_COLOR, SegmentBar } from './SummarySlot'
import { fmtRate } from './ItemTile'
import { segmentLabel, segmentTitle } from './summarySegments'
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

/** Swatch style of a segment or overview row; blocks use their own colour. */
function swatchStyle(
  kind: SegmentKind | OverlayKind,
  blockId: string | undefined,
  colorOf: (blockId: string) => string,
): React.CSSProperties {
  switch (kind) {
    case 'export':
    case 'source':
    case 'unused':
    case 'cycle':
    case 'missing-source':
      return { background: blockId !== undefined ? colorOf(blockId) : MISSING_BLOCK_COLOR }
    case 'kept':
    case 'left': return { background: KEPT_COLOR }
    case 'import': return { border: '1px solid #d1d5db' }
    case 'short': return { background: SHORT_COLOR }
    case 'locked':
      return { backgroundImage: 'repeating-linear-gradient(45deg, rgba(156,163,175,.7) 0 2px, transparent 2px 5px)' }
  }
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
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)
  const root = 'h-[136px] shrink-0 overflow-hidden border-t border-gray-800 mt-1 pt-1 text-[10px]'

  if (state === 'overview' || !slot) {
    const maxTotal = Math.max(...rows.map(r => r.total), 0)
    return (
      <div data-testid="summary-detail" data-state="overview" className={`${root} overflow-y-auto`}>
        {rows.length === 0 && <div className="text-gray-500">Nothing here yet</div>}
        {rows.map(row => (
          <button
            key={row.key}
            type="button"
            data-testid="summary-overview-row"
            data-key={row.key}
            data-limited={row.limited ? 'true' : undefined}
            aria-pressed={traceKey === row.key}
            onClick={() => onToggleTrace(row.key)}
            className={`w-full flex items-center gap-1.5 px-1 py-0.5 rounded text-left hover:bg-gray-800 ${traceKey === row.key ? 'bg-gray-800' : ''}`}
          >
            <span className="shrink-0 w-2.5 h-2.5 rounded-sm" style={swatchStyle(row.kind, row.blockId, colorOf)} />
            <span className={`w-24 shrink-0 truncate ${row.limited ? 'text-amber-400' : 'text-gray-300'}`}>
              {segmentLabel(row, row.blockId !== undefined ? blockNameOf(row.blockId) : undefined)}
            </span>
            <span className="flex-1 min-w-0 h-1.5">
              <span
                className="block h-full rounded-sm"
                style={{ ...swatchStyle(row.kind, row.blockId, colorOf), width: `${maxTotal > 0 ? (row.total / maxTotal) * 100 : 0}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right font-mono tabular-nums text-gray-300">
              {row.total > 0 ? fmt(row.total) : ''}
            </span>
            <span className="w-10 shrink-0 text-gray-500 tabular-nums">· {row.count}</span>
          </button>
        ))}
      </div>
    )
  }

  const itemName = item?.name ?? slot.itemId
  const entries: (Segment | Overlay)[] = [...slot.segments, ...slot.overlays]
  const editable = state === 'selected' || state === 'editing'

  return (
    <div data-testid="summary-detail" data-state={state} className={`${root} flex flex-col gap-1`}>
      <div className="flex items-center gap-1.5 shrink-0 min-w-0">
        {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-5 h-5 object-contain shrink-0" />}
        <span className="font-semibold text-gray-200 truncate">{itemName}</span>
        <span className="flex items-center gap-1 min-w-0 flex-1">{rates}</span>
        {editable ? (
          <button
            type="button"
            aria-label="Back to overview"
            onClick={onBack}
            className="shrink-0 text-gray-500 hover:text-gray-200 px-1 leading-none"
          >
            ×
          </button>
        ) : (
          <span className="shrink-0 text-gray-500 uppercase">preview</span>
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
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {entries.map((entry, i) => {
          const blockName = entry.blockId !== undefined ? blockNameOf(entry.blockId) : undefined
          const amount = 'amount' in entry ? entry.amount : undefined
          const limited = 'limited' in entry && entry.limited
          const available = 'available' in entry ? entry.available : undefined
          const title = segmentTitle(entry, { itemName, blockName, fmt, unit, available })
          const body = (
            <>
              <span className="shrink-0 w-2.5 h-2.5 rounded-sm" style={swatchStyle(entry.kind, entry.blockId, colorOf)} />
              <span className={`truncate ${limited ? 'text-amber-400' : 'text-gray-300'}`}>{segmentLabel(entry, blockName)}</span>
              {amount !== undefined && (
                <span className="ml-auto font-mono tabular-nums text-gray-400">{fmt(amount)}</span>
              )}
            </>
          )
          const cls = 'w-full flex items-center gap-1.5 px-1 py-px text-left'
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
                  className={`${cls} hover:bg-gray-800 rounded`}
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
        <div className="flex flex-wrap gap-1 shrink-0">
          {actions.map(a => (
            <button
              key={a.label}
              type="button"
              onClick={a.onSelect}
              className={`border border-gray-700 rounded px-1.5 py-px hover:border-gray-500 ${a.danger ? 'text-red-400' : 'text-gray-300'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
