import { useEffect, useMemo, useRef, useState } from 'react'
import type { Block, GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { SummarySlot, SLOT_DRAG_TYPE } from './SummarySlot'
import type { SlotDnd } from './SummarySlot'
import { SummaryDetailStrip } from './SummaryDetailStrip'
import type { StripAction, StripState } from './SummaryDetailStrip'
import { insertionTarget } from '../../utils/insertionTarget'
import { overviewRows } from './summarySegments'
import { useMoreBelow } from './useMoreBelow'
import type { SlotModel, SummaryPaneKind } from './summarySegments'

/** Distance from the grid's top or bottom edge that scrolls it during a drag, and the step per animation frame. */
const EDGE_PX = 12
const EDGE_STEP_PX = 4

interface SlotEdit {
  editing: boolean
  start: () => void
  stop: () => void
}

interface SummaryPaneProps {
  pane: SummaryPaneKind
  label: string
  action?: React.ReactNode
  slots: SlotModel[]
  items: GameData['items']
  blocks: Block[]
  rateUnit: RateUnit
  /** Products: double-clicking a slot edits its extra output. */
  editable?: boolean
  onSlotContextMenu: (slot: SlotModel, e: React.MouseEvent<HTMLButtonElement>) => void
  renderRates: (slot: SlotModel, edit: SlotEdit) => React.ReactNode
  actionsFor: (slot: SlotModel) => StripAction[]
  /** Products: an entry added to the end of the colour key while the slot is selected. */
  renderKeyExtra?: (slot: SlotModel, edit: SlotEdit) => React.ReactNode
  onOpenBlock: (blockId: string) => void
  onConnectionContextMenu?: (connectionId: string, e: React.MouseEvent) => void
  /** Products: reorder by dragging; moves the slot so it lands before `toIndex` (an index in the current order). */
  onReorder?: (slotId: string, toIndex: number) => void
  /** Extra classes for the pane root (layout inside the summary strip). */
  className?: string
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
  renderKeyExtra,
  onOpenBlock,
  onConnectionContextMenu,
  onReorder,
  className = '',
}: SummaryPaneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [traceKey, setTraceKey] = useState<string | null>(null)
  // The dragged slot: the ref is set at once (drag handlers read it), the state later, so the
  // faded slot is not painted before the browser has captured the drag image.
  const draggingRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragStartTimer = useRef<number | undefined>(undefined)
  // dragenter minus dragleave events inside the grid: zero means the pointer left it (relatedTarget is unreliable).
  const dragDepth = useRef(0)
  const scrollDir = useRef<-1 | 0 | 1>(0)
  const scrollFrame = useRef<number | undefined>(undefined)
  const [drop, setDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null)

  // True while more slots sit below the visible part of the grid (drives the bottom fade).
  const { bodyRef, contentRef, hasMore, onScroll } = useMoreBelow<HTMLDivElement, HTMLDivElement>()

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

  const editOf = (slot: SlotModel): SlotEdit => ({
    editing: state === 'editing',
    start: () => {
      setSelectedId(slot.id)
      setEditing(true)
    },
    stop: () => setEditing(false),
  })

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

  /** Forget the drag: the dragged slot, the drop line and the edge scrolling. */
  function endDrag() {
    window.clearTimeout(dragStartTimer.current)
    window.cancelAnimationFrame(scrollFrame.current ?? 0)
    scrollFrame.current = undefined
    scrollDir.current = 0
    dragDepth.current = 0
    draggingRef.current = null
    setDraggingId(null)
    setDrop(null)
  }

  // A drag whose slot has gone (product removed mid-drag) never gets its dragend, and one that ends
  // outside the grid may not either: clear on the document's dragend and drop, and on unmount.
  const isDragging = draggingId !== null
  useEffect(() => {
    if (!isDragging) return
    document.addEventListener('dragend', endDrag)
    document.addEventListener('drop', endDrag)
    return () => {
      document.removeEventListener('dragend', endDrag)
      document.removeEventListener('drop', endDrag)
    }
  }, [isDragging])
  useEffect(() => () => {
    window.clearTimeout(dragStartTimer.current)
    window.cancelAnimationFrame(scrollFrame.current ?? 0)
  }, [])
  // State adjusted during render; the ref is harmless stale (a drop finds no such slot).
  if (draggingId !== null && !slots.some(s => s.id === draggingId)) {
    setDraggingId(null)
    setDrop(null)
  }

  /** Which half of the slot the pointer is over, or null when a drop here would not move anything. */
  function computeSide(e: React.DragEvent<HTMLButtonElement>, index: number): 'before' | 'after' | null {
    const id = draggingRef.current
    if (id === null) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    const from = slots.findIndex(s => s.id === id)
    return insertionTarget(from, side === 'before' ? index : index + 1, slots.length) === null ? null : side
  }

  // Scroll the grid, a few pixels a frame, while a slot is held near its top or bottom edge.
  function scrollLoop(grid: HTMLElement) {
    if (scrollDir.current === 0) {
      scrollFrame.current = undefined
      return
    }
    grid.scrollBy({ top: scrollDir.current * EDGE_STEP_PX })
    scrollFrame.current = window.requestAnimationFrame(() => scrollLoop(grid))
  }

  function handleGridDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (draggingRef.current === null) return
    const grid = e.currentTarget
    const rect = grid.getBoundingClientRect()
    scrollDir.current = e.clientY - rect.top < EDGE_PX ? -1 : rect.bottom - e.clientY < EDGE_PX ? 1 : 0
    if (scrollDir.current !== 0 && scrollFrame.current === undefined) scrollLoop(grid)
  }

  function handleGridDragEnter() {
    if (draggingRef.current !== null) dragDepth.current += 1
  }

  function handleGridDragLeave() {
    if (draggingRef.current === null) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      scrollDir.current = 0
      setDrop(null)
    }
  }

  function dndFor(slot: SlotModel, index: number): SlotDnd | undefined {
    if (!onReorder) return undefined
    return {
      dragging: draggingId === slot.id,
      dropSide: drop?.id === slot.id ? drop.side : null,
      onDragStart: e => {
        e.dataTransfer.setData(SLOT_DRAG_TYPE, slot.id)
        e.dataTransfer.effectAllowed = 'move'
        draggingRef.current = slot.id
        dragDepth.current = 0
        // After the browser has taken its drag image.
        dragStartTimer.current = window.setTimeout(() => {
          setHoveredId(null)
          setDraggingId(slot.id)
        }, 0)
      },
      onDragEnd: endDrag,
      onDragOver: e => {
        const side = computeSide(e, index)
        if (side) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDrop(prev => (prev?.id === slot.id && prev.side === side ? prev : { id: slot.id, side }))
        } else {
          setDrop(prev => (prev?.id === slot.id ? null : prev))
        }
      },
      onDrop: e => {
        const side = computeSide(e, index)
        const id = draggingRef.current
        endDrag()
        if (!side || id === null) return
        e.preventDefault()
        onReorder(id, side === 'before' ? index : index + 1)
      },
    }
  }

  return (
    <section
      aria-label={label}
      data-testid="summary-pane"
      data-pane={pane}
      data-overflow={hasMore ? 'true' : undefined}
      className={`border border-gray-700 rounded-md flex flex-col min-h-0 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 min-h-8 px-2 pt-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-gray-400 shrink-0">
        <div>
          {label}
          <span className="ml-1 tabular-nums">· {slots.length}</span>
        </div>
        {action}
      </div>
      <div className="relative flex-1 min-h-0">
        {/* One row of slots and half of the next fill the cap (2 + 54 + 4 + 27 + 10 padding), so the grid
            shows a peek at the second row and scrolls for the rest. */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          data-testid="summary-slot-grid"
          onDragOver={onReorder ? handleGridDragOver : undefined}
          onDragEnter={onReorder ? handleGridDragEnter : undefined}
          onDragLeave={onReorder ? handleGridDragLeave : undefined}
          className="max-h-[97px] min-h-[58px] overflow-y-auto px-2 pt-0.5 pb-2.5"
        >
          <div ref={contentRef} className="flex flex-wrap gap-1">
            {slots.map((slot, index) => (
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
                dnd={dndFor(slot, index)}
              />
            ))}
          </div>
        </div>
        {hasMore && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-gray-900/90 to-transparent" />
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
        rates={shown && renderRates(shown, editOf(shown))}
        actions={shown ? actionsFor(shown) : []}
        keyExtra={shown && renderKeyExtra?.(shown, editOf(shown))}
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
