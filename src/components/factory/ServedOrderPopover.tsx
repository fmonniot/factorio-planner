import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Block, GameData, ServedEntry, ServedList } from '../../data/types'
import { sameServedEntry, withServedEntryPlaced } from '../../data/servedEntries'
import type { RateUnit } from '../../store/uiStore'
import { fmtItemRateText } from './ItemTile'
import { MINI_BUTTON_CLASS } from './Switch'
import { useDismiss } from './sidePanel/useDismiss'
import { entryOf, hasServedOrder, lineKey, moveTarget, placement, servedLines, splitServed, type ServedLine } from './servedOrder'

// ---------------------------------------------------------------------------
// ServedOrderPopover — the order the solver serves an item's consumers in, and where the source's own extra output
// comes in. Opened from the Served order… action of a selected slot. The ranked lines are the source's stored list
// (move them with the buttons or by dragging); the lines it does not rank are served after them, in the solver's order.
// ---------------------------------------------------------------------------

/** The drag type of a line. */
const DRAG_TYPE = 'application/x-served-line'
const NOT_CREDITED_HINT =
  'The planner reached this block before the list could reserve a share for it, so it is served from what the others leave over, not by its rank.'

interface ServedOrderPopoverProps {
  itemId: string
  list: ServedList
  items: GameData['items']
  blocks: Block[]
  rateUnit: RateUnit
  /** The source's stored list for the item; undefined when it has none (the order shown is the solver's). */
  stored: ServedEntry[] | undefined
  /** Put `entry` at insertion index `toIndex` of the list (`shown` is the order on screen, for a block with no list). */
  onMove: (entry: ServedEntry, toIndex: number, shown: ServedEntry[]) => void
  /** Drop the stored list. */
  onReset: () => void
  /** Viewport coordinates of the button that opened it. */
  x: number
  y: number
  onClose: () => void
}

export function ServedOrderPopover({ itemId, list, items, blocks, rateUnit, stored, onMove, onReset, x, y, onClose }: ServedOrderPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const origin = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState({ x, y })
  const itemName = items[itemId]?.name ?? itemId
  const lineCount = list.consumers.length + (list.extra ? 1 : 0)
  // A move reorders keyed lines and the browser drops the focus of the one that moved: put it back (a selector, on `refocus`).
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const selector = refocus.current
    refocus.current = null
    if (selector) ref.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
  })
  const [announce, setAnnounce] = useState('')
  // What is dragged (a line key), as a ref for the handlers and as state for the faded look; the drop line.
  const dragRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; side: 'before' | 'after' } | null>(null)

  // Focus the dialog on open; Escape gives the focus back to what had it.
  useLayoutEffect(() => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    })
  }, [x, y, lineCount, stored?.length])

  useDismiss(ref, true, () => {
    onClose()
    const target = origin.current
    if (target?.isConnected && target !== document.body) target.focus()
  })

  // A fixed box would float away from its slot: close on scroll and resize.
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose })
  useLayoutEffect(() => {
    const dismiss = () => onCloseRef.current()
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  if (!hasServedOrder(list)) return null
  const amount = (perMin: number) => fmtItemRateText(itemId, perMin / 60, rateUnit)
  const soleConnection = (blockId: string) =>
    blocks.find(b => b.id === blockId)?.inputConnections.filter(c => c.itemId === itemId).length === 1
  const lines = servedLines(list, itemId, rateUnit, soleConnection)
  const { hasList, ranked, unranked } = splitServed(lines, stored)
  const nameOf = (line: ServedLine) =>
    line.kind === 'extra' ? 'Extra output' : (blocks.find(b => b.id === line.blockId)?.name ?? line.blockId ?? '')

  function move(line: ServedLine, before: ServedLine | null, focus: string) {
    const to = placement(ranked, stored, before)
    const entry = entryOf(line)
    const place = (withServedEntryPlaced(to.shown, entry, before && entryOf(before)) ?? to.shown).findIndex(e => sameServedEntry(e, entry)) + 1
    refocus.current = `[data-line-key="${lineKey(line)}"] [data-testid="${focus}"]`
    setAnnounce(`${nameOf(line)} moved to place ${place}.`)
    onMove(entry, to.toIndex, to.shown)
  }
  const step = (line: ServedLine, index: number, delta: -1 | 1) => {
    const next = index + delta
    if (next < 0 || next > ranked.length - 1) return
    const exhausted = next === 0 || next === ranked.length - 1
    const pressed = delta < 0 ? 'served-move-up' : 'served-move-down'
    const other = delta < 0 ? 'served-move-down' : 'served-move-up'
    move(line, moveTarget(ranked, index, delta), exhausted ? other : pressed)
  }

  // Dragging: a line moves to a ranked place (before a ranked line, or last when dropped on the divider).
  function endDrag() {
    dragRef.current = null
    setDragging(null)
    setDrop(null)
  }
  function startDrag(e: React.DragEvent, key: string) {
    if (e.target !== e.currentTarget) return
    e.dataTransfer.setData(DRAG_TYPE, key)
    e.dataTransfer.effectAllowed = 'move'
    dragRef.current = key
    // The faded line is painted after the browser has captured the drag image.
    window.setTimeout(() => { if (dragRef.current === key) setDragging(key) }, 0)
  }
  /** Where a drop on ranked line `index` (or on the divider: index = ranked.length) lands: before which ranked line (null: last). */
  const target = (e: React.DragEvent<HTMLElement>, index: number) => {
    if (index >= ranked.length) return { side: 'before' as const, before: null }
    const r = e.currentTarget.getBoundingClientRect()
    const side = e.clientY < r.top + r.height / 2 ? ('before' as const) : ('after' as const)
    return { side, before: side === 'before' ? ranked[index] : (ranked[index + 1] ?? null) }
  }
  /** Dropping where it already is moves nothing. */
  const moves = (line: ServedLine, before: ServedLine | null) =>
    withServedEntryPlaced(stored ?? ranked.map(entryOf), entryOf(line), before && entryOf(before)) !== undefined
  const onDropOver = (e: React.DragEvent<HTMLElement>, index: number, key: string) => {
    const line = lines.find(l => lineKey(l) === dragRef.current)
    if (!line) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const t = target(e, index)
    setDrop(moves(line, t.before) ? { key, side: t.side } : null)
  }
  const onDropLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
  }
  const onDropped = (e: React.DragEvent<HTMLElement>, index: number) => {
    const line = lines.find(l => lineKey(l) === dragRef.current)
    if (!line) return
    e.preventDefault()
    const t = target(e, index)
    if (moves(line, t.before)) move(line, t.before, 'served-move-up')
    endDrag()
  }

  const dropLine = (key: string) =>
    drop?.key === key && (
      <span
        aria-hidden="true"
        data-testid="served-drop-line"
        data-side={drop.side}
        className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${drop.side === 'before' ? '-top-px' : '-bottom-px'}`}
      />
    )

  const figures = (line: ServedLine) => (
    <>
      {line.kind === 'take' && line.need === undefined ? (
        <span className="text-gray-400">takes what is left</span>
      ) : (
        <span className="font-mono tabular-nums">{line.kind === 'take' ? 'needs' : 'asked'} {amount((line.kind === 'take' ? line.need : line.asked) ?? 0)}</span>
      )}
      <span className="font-mono tabular-nums">got {amount(line.got)}</span>
      {line.short !== undefined && (
        <span data-testid="served-short" className="font-mono tabular-nums text-amber-300">short {amount(line.short)}</span>
      )}
      {line.notCredited && (
        <span data-testid="served-not-credited" title={NOT_CREDITED_HINT} className="rounded bg-amber-900/40 px-1 text-[10px] text-amber-300">no credit</span>
      )}
    </>
  )

  const renderLine = (line: ServedLine, index: number, isRanked: boolean) => {
    const block = line.blockId !== undefined ? blocks.find(b => b.id === line.blockId) : undefined
    const key = lineKey(line)
    return (
      <li
        key={key}
        data-testid="served-line"
        data-kind={line.kind}
        data-block-id={line.blockId}
        data-ranked={isRanked ? 'true' : 'false'}
        data-line-key={key}
        draggable
        onDragStart={e => startDrag(e, key)}
        onDragEnd={endDrag}
        onDragOver={isRanked ? e => onDropOver(e, index, key) : undefined}
        onDragLeave={isRanked ? onDropLeave : undefined}
        onDrop={isRanked ? e => onDropped(e, index) : undefined}
        style={dragging === key ? { opacity: 0.4 } : undefined}
        className="relative flex flex-col gap-0.5 rounded px-1 py-0.5"
      >
        {isRanked && dropLine(key)}
        <div className="flex items-center gap-2">
          <span className="w-4 font-mono tabular-nums text-gray-500">{isRanked ? line.rank : '–'}</span>
          {block && (
            <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: block.color }} />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-gray-100">{nameOf(line)}</span>
          {isRanked ? (
            <>
              <button
                type="button"
                data-testid="served-move-up"
                aria-label="Move up"
                aria-disabled={index === 0}
                onClick={() => step(line, index, -1)}
                className={MINI_BUTTON_CLASS}
              >▲</button>
              <button
                type="button"
                data-testid="served-move-down"
                aria-label="Move down"
                aria-disabled={index === ranked.length - 1}
                onClick={() => step(line, index, 1)}
                className={MINI_BUTTON_CLASS}
              >▼</button>
            </>
          ) : (
            <button
              type="button"
              data-testid="served-add"
              onClick={() => move(line, null, 'served-move-up')}
              className={MINI_BUTTON_CLASS}
            >Add to list</button>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 pl-6">{figures(line)}</div>
      </li>
    )
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Served order of ${itemName}`}
      tabIndex={-1}
      data-testid="served-order-popover"
      data-item-id={itemId}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 flex w-[360px] max-w-[calc(100vw-1rem)] flex-col gap-1.5 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl px-3 py-2.5 text-left outline-none"
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-semibold text-gray-100">Served in this order</div>
        {stored !== undefined && (
          <button
            type="button"
            data-testid="served-reset"
            onClick={() => {
              onReset()
              ref.current?.focus({ preventScroll: true }) // the button goes away
            }}
            className={MINI_BUTTON_CLASS}
          >Reset order</button>
        )}
      </div>
      <div className="text-[11px] text-gray-400">
        {hasList
          ? 'Ranked by you. When the source is short, the lines at the bottom go without first.'
          : "Today's order: the order the solver served them in. Move a line to rank it."}
      </div>
      <ol data-testid="served-ranked" className="flex flex-col gap-1 text-xs text-gray-300">
        {ranked.map((line, i) => renderLine(line, i, true))}
      </ol>
      {unranked.length > 0 && (
        <>
          <div
            role="separator"
            data-testid="served-divider"
            onDragOver={e => onDropOver(e, ranked.length, 'divider')}
            onDragLeave={onDropLeave}
            onDrop={e => onDropped(e, ranked.length)}
            className="relative border-t border-gray-700 pt-1 text-[11px] text-gray-400"
          >
            {dropLine('divider')}
            Not ranked: served after the list
          </div>
          <ol data-testid="served-unranked" className="flex flex-col gap-1 text-xs text-gray-300">
            {unranked.map((line, i) => renderLine(line, i, false))}
          </ol>
        </>
      )}
      <div role="status" className="sr-only">{announce}</div>
    </div>,
    document.body,
  )
}
