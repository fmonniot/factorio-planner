import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Block, GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { SummarySlot } from './SummarySlot'
import { SummaryDetailStrip } from './SummaryDetailStrip'
import type { StripAction, StripState } from './SummaryDetailStrip'
import { overviewRows } from './summarySegments'
import type { SlotModel, SummaryPaneKind } from './summarySegments'

interface SummaryPaneProps {
  pane: SummaryPaneKind
  label: string
  action?: React.ReactNode
  slots: SlotModel[]
  items: GameData['items']
  blocks: Block[]
  rateUnit: RateUnit
  /** Products: double-clicking a slot edits its target. */
  editable?: boolean
  onSlotContextMenu: (slot: SlotModel, e: React.MouseEvent<HTMLButtonElement>) => void
  renderRates: (slot: SlotModel, edit: { editing: boolean; start: () => void; stop: () => void }) => React.ReactNode
  actionsFor: (slot: SlotModel) => StripAction[]
  onOpenBlock: (blockId: string) => void
  onConnectionContextMenu?: (connectionId: string, e: React.MouseEvent) => void
}

// A pane: header, a grid of item slots, and a fixed-height strip below that
// shows the pane overview, or the detail of the hovered / selected slot.
// Selection, hover and trace are view state: not saved, and the parent keys
// the pane by block so they reset on a block change.
export function SummaryPane({
  pane,
  label,
  action,
  slots,
  items,
  blocks,
  rateUnit,
  editable = false,
  onSlotContextMenu,
  renderRates,
  actionsFor,
  onOpenBlock,
  onConnectionContextMenu,
}: SummaryPaneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [traceKey, setTraceKey] = useState<string | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // True while more slots sit below the visible part of the grid (drives the bottom fade).
  const [hasMore, setHasMore] = useState(false)

  function measure() {
    const el = bodyRef.current
    if (!el) return
    const more = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setHasMore(prev => (prev === more ? prev : more))
  }

  // Content changes (slots added or removed) resize the body, so observe it as well as scrolling.
  // The body's own box stops changing at the height cap, so also re-measure after every render
  // (slots added, another block, slots rewrapping on a unit change).
  useLayoutEffect(measure)

  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // The content wrapper changes size even while the capped body does not.
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [])

  const rows = overviewRows(slots)
  // A trace on a key that no longer exists (connection or block removed) is ignored.
  const activeTrace = traceKey !== null && rows.some(r => r.key === traceKey) ? traceKey : null
  const blockById = useMemo(() => new Map(blocks.map(b => [b.id, b])), [blocks])
  const colorOf = (blockId: string) => blockById.get(blockId)?.color ?? MISSING_BLOCK_COLOR
  const blockNameOf = (blockId: string) => blockById.get(blockId)?.name

  // A selected or hovered item that has since disappeared simply misses the lookup.
  const selected = slots.find(s => s.id === selectedId)
  // Hovering the selected slot keeps showing it as selected.
  const hovered = hoveredId !== selectedId ? slots.find(s => s.id === hoveredId) : undefined

  let state: StripState = 'overview'
  let shown: SlotModel | undefined
  if (editing && selected) {
    state = 'editing'
    shown = selected
  } else if (hovered) {
    state = 'preview'
    shown = hovered
  } else if (selected) {
    state = 'selected'
    shown = selected
  }

  // Escape clears the selection, or the trace when nothing is selected. It listens on the
  // document because browsers that do not focus a clicked button never deliver the key to the pane.
  // An input or a menu that handled the key has marked it defaultPrevented (or stopped it).
  const hasView = selectedId !== null || traceKey !== null
  useEffect(() => {
    if (!hasView) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (selectedId !== null) {
        setSelectedId(null)
        setEditing(false)
      } else {
        setTraceKey(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hasView, selectedId])

  // A hovered item that disappeared never gets a mouseleave, so forget it (state adjusted during render).
  if (hoveredId !== null && !slots.some(s => s.id === hoveredId)) setHoveredId(null)

  return (
    <section
      aria-label={label}
      data-testid="summary-pane"
      data-pane={pane}
      data-overflow={hasMore ? 'true' : undefined}
      className="border border-gray-700 rounded bg-gray-900/40 px-2 py-1.5 flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-gray-600 mb-1 shrink-0">
        <div>
          {label}
          <span className="ml-1 tabular-nums">· {slots.length}</span>
        </div>
        {action}
      </div>
      <div className="relative">
        <div
          ref={bodyRef}
          onScroll={measure}
          data-testid="summary-slot-grid"
          className="max-h-[25vh] min-h-[58px] overflow-y-auto"
        >
          <div ref={contentRef} className="flex flex-wrap gap-1">
            {slots.map(slot => (
              <SummarySlot
                key={slot.id}
                slot={slot}
                item={items[slot.itemId]}
                rateUnit={rateUnit}
                colorOf={colorOf}
                selected={slot.id === selectedId}
                traceKey={activeTrace}
                onClick={() => {
                  setEditing(false)
                  setSelectedId(prev => (prev === slot.id ? null : slot.id))
                }}
                // The two clicks of a double-click toggle the selection off, so select again.
                onDoubleClick={() => {
                  setSelectedId(slot.id)
                  if (editable) setEditing(true)
                }}
                onContextMenu={e => onSlotContextMenu(slot, e)}
                onMouseEnter={() => setHoveredId(slot.id)}
                onMouseLeave={() => setHoveredId(prev => (prev === slot.id ? null : prev))}
              />
            ))}
          </div>
        </div>
        {hasMore && (
          <div className="pointer-events-none absolute inset-x-px bottom-px h-6 rounded-b bg-gradient-to-t from-gray-900 to-transparent" />
        )}
      </div>
      <SummaryDetailStrip
        state={state}
        slot={shown}
        item={shown ? items[shown.itemId] : undefined}
        rateUnit={rateUnit}
        colorOf={colorOf}
        blockNameOf={blockNameOf}
        rows={rows}
        traceKey={activeTrace}
        onToggleTrace={key => setTraceKey(prev => (prev === key ? null : key))}
        rates={shown && renderRates(shown, {
          editing: state === 'editing',
          start: () => {
            setSelectedId(shown.id)
            setEditing(true)
          },
          stop: () => setEditing(false),
        })}
        actions={shown ? actionsFor(shown) : []}
        onBack={() => {
          setSelectedId(null)
          setEditing(false)
        }}
        onOpenBlock={onOpenBlock}
        onConnectionContextMenu={onConnectionContextMenu}
      />
    </section>
  )
}
