import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ModalPortal } from '../ModalPortal'
import type { Block, GameData, ServedEntry, ServedList } from '../../data/types'
import { expandServedAreas, withServedEntryPlaced, withServedEntryRanked, withServedShare, withServedTied, type ServedPlace } from '../../data/servedEntries'
import type { RateUnit } from '../../store/uiStore'
import { fmtItemRateText } from './ItemTile'
import { MINI_BUTTON_CLASS } from './Switch'
import { useDismiss, useEscapeLayer } from './sidePanel/useDismiss'
import { blockAreas } from '../../solver/areas'
import { dropPlace, dropZone, entryOf, fmtPercent, hasServedOrder, isTiedLine, lineKey, lineName, moveTarget, placement, servedLines, splitServed, underIn, type DropZone, type ServedLine } from './servedOrder'
import { TIPPED_LABEL_CLASS, describedTip, tippedLabel } from '../tipProps'

// ---------------------------------------------------------------------------
// ServedOrderPopover — the order the solver serves an item's consumers in, and where the source's own extra output
// comes in. Opened from the Served order… action of a selected slot. The ranked lines are the source's stored list
// (move them with the buttons or by dragging); the lines it does not rank are served after them, in the solver's order.
// ---------------------------------------------------------------------------

/** The drag type of a line. */
const DRAG_TYPE = 'application/x-served-line'
export const NOT_CREDITED_HINT = 'No credit\nIt is served from what the others leave over, not by its rank.'

/** The title of the `list order` badge. */
export const LIST_ORDER_HINT =
  'List order\nThis group is served one line after the other, not by its percentages.'
/** The tooltip of the title: the one rule worth knowing before opening the list. */
export const SERVED_ORDER_HELP = 'When the source is short, the lines at the bottom go without first.'
const INVALID_SHARE = 'Share must be above 0 and below 100.'
const plural = (n: number) => (n === 1 ? '' : 's')

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
  /** Put `entry` at `place` (a rank of its own, or the group of a line): one undoable step. */
  onPlace: (entry: ServedEntry, place: ServedPlace, shown: ServedEntry[]) => void
  /** Tie `entry` to the line above it, or untie it. */
  onTie: (entry: ServedEntry, tied: boolean, shown: ServedEntry[]) => void
  /** Set `entry`'s percentage of its group. */
  onShare: (entry: ServedEntry, percent: number, shown: ServedEntry[]) => void
  /** Drop the stored list. */
  onReset: () => void
  /** Viewport coordinates of the button that opened it. */
  x: number
  y: number
  onClose: () => void
}

export function ServedOrderPopover({ itemId, list, items, blocks, rateUnit, stored, onMove, onReset, onPlace, onTie, onShare, x, y, onClose }: ServedOrderPopoverProps) {
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
  const [announce, setAnnounce] = useState({ text: '', n: 0 })
  // What is dragged (a line key), as a ref for the handlers and as state for the faded look; the drop line.
  const dragRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  // The key of the line whose percent field has the focus: such a line is not draggable, so its text can be selected.
  const [fieldKey, setFieldKey] = useState<string | null>(null)

  // Focus the dialog on open; Escape gives the focus back to what had it.
  useLayoutEffect(() => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
  }, [])

  // Keep the box inside the window, whenever its anchor or its size changes (badges wrap, a divider or hint appears).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const clamp = () => {
      const { width, height } = el.getBoundingClientRect()
      const next = {
        x: Math.max(0, Math.min(x, window.innerWidth - width)),
        y: Math.max(0, Math.min(y, window.innerHeight - height)),
      }
      setPos(p => (p.x === next.x && p.y === next.y ? p : next))
    }
    clamp()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(clamp)
    observer.observe(el)
    return () => observer.disconnect()
  }, [x, y, lineCount])

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
    // A scroll inside the popover (its own list) is not the page moving away from the slot.
    const dismissOnScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      dismiss()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismissOnScroll, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismissOnScroll, true)
    }
  }, [])

  if (!hasServedOrder(list)) return null
  const amount = (perMin: number) => fmtItemRateText(itemId, perMin / 60, rateUnit)
  const lines = servedLines(list, itemId, rateUnit)
  // An area that exists but needs nothing has no line; the solver still counts its entry in its group, so the lines do too.
  const hasArea = (blockId: string, areaId: string) => {
    const root = blocks.find(b => b.id === blockId)?.rootPlan
    return root !== undefined && (blockAreas(root)?.some(a => a.id === areaId) ?? false)
  }
  const { ranked, unranked } = splitServed(lines, stored, hasArea)
  const nameOf = (line: ServedLine) => lineName(line, blocks.find(b => b.id === line.blockId))

  const shown = ranked.map(entryOf)
  // Every prediction runs on the list the store will edit: a plain block entry the lines draw as areas is expanded first.
  const base = stored === undefined ? shown : expandServedAreas(stored, shown)
  /** The ranked lines once the list is `next` (computed once per edit), and `line` in them. */
  const rankedOf = (next: ServedEntry[]) => splitServed(lines, next, hasArea).ranked
  const find = (rankedAfter: readonly ServedLine[], line: ServedLine) => rankedAfter.find(l => lineKey(l) === lineKey(line))
  // The store edits the RAW stored list, the lines show it through the solver's stale rule. `view` is the list as drawn
  // (heads and tied flags as displayed): an edit the raw list would not make as shown is refused, never half done.
  const view = ranked.map((l): ServedEntry => (isTiedLine(l) ? { ...entryOf(l), tied: true } : entryOf(l)))
  const says = (text: string) => setAnnounce(a => ({ text, n: a.n + 1 }))
  const keepFocus = (line: ServedLine, selector: string | null) => {
    refocus.current = selector ? `[data-line-key="${lineKey(line)}"] [data-testid="${selector}"]` : null
  }
  /** Where `line` ends up in the ranked lines once the list is `next`: its index and how many lines there are. */
  const focusAfter = (rankedAfter: readonly ServedLine[], line: ServedLine, prefer: 'served-move-up' | 'served-move-down') => {
    const at = rankedAfter.findIndex(l => lineKey(l) === lineKey(line))
    const count = rankedAfter.length
    const canUp = at > 0
    const canDown = at < count - 1
    keepFocus(line, prefer === 'served-move-down' ? (canDown ? 'served-move-down' : canUp ? 'served-move-up' : null) : (canUp ? 'served-move-up' : canDown ? 'served-move-down' : null))
  }

  /** `prefer`: the button that was pressed (a drag or Add: Move up). Focus goes to an enabled button of the line, else the dialog. */
  function move(line: ServedLine, before: ServedLine | null, prefer: 'served-move-up' | 'served-move-down') {
    const to = placement(ranked, stored, before)
    const entry = entryOf(line)
    const next = withServedEntryPlaced(base, entry, before && entryOf(before))
    if (next === undefined) return // the store would ignore it too
    const rankedAfter = rankedOf(next)
    const me = find(rankedAfter, line)
    focusAfter(rankedAfter, line, prefer)
    if (me) {
      const others = rankedAfter.filter(l => l.rank === me.rank).length - 1
      says(`${nameOf(line)} moved to place ${me.rank}${others > 0 ? `, shared with ${others} other line${plural(others)}` : ''}.`)
    }
    onMove(entry, to.toIndex, to.shown)
  }
  /** A drop: an edge gives the line a rank of its own, the middle puts it in the group of `targetName`'s line. */
  function place(line: ServedLine, where: ServedPlace, kind: 'edge' | 'join', targetName: string) {
    const entry = entryOf(line)
    const next = withServedEntryRanked(base, entry, where)
    if (next === undefined) {
      // The lines say it moves, the raw list says it is done (a stale entry in the way): nothing the store could do.
      says(`${nameOf(line)} could not be moved.`)
      return
    }
    const rankedAfter = rankedOf(next)
    const me = find(rankedAfter, line)
    if (!me || !landed(rankedAfter, me, where)) {
      says(`${nameOf(line)} could not be moved.`)
      return
    }
    focusAfter(rankedAfter, line, 'served-move-up')
    says(kind === 'join' ? `${nameOf(line)} now shares place ${me.rank} with ${targetName}.` : `${nameOf(line)} moved to its own place ${me.rank}.`)
    onPlace(entry, where, shown)
  }
  /** The line ended up where the drop meant: in its target's group, or at a rank of its own right before `before`. */
  function landed(rankedAfter: readonly ServedLine[], me: ServedLine, where: ServedPlace) {
    if (where.kind === 'join') {
      const t = rankedAfter.find(l => lineKey(l) === lineKey(where.target))
      return isTiedLine(me) && t !== undefined && t.rank === me.rank
    }
    if (isTiedLine(me)) return false
    const before = where.before
    if (before === null) return me.rank === rankedAfter[rankedAfter.length - 1].rank
    if (lineKey(before) === lineKey(me)) return true // its own top edge: a head is all it takes
    const b = rankedAfter.find(l => lineKey(l) === lineKey(before))
    return b === undefined || b.rank === me.rank + 1
  }
  function tie(line: ServedLine, index: number) {
    if (index === 0) return
    const entry = entryOf(line)
    const isTied = isTiedLine(line)
    const next = withServedTied(base, entry, !isTied)
    const rankedAfter = next && rankedOf(next)
    const me = rankedAfter && find(rankedAfter, line)
    if (!me || (!isTied) !== isTiedLine(me)) {
      says(`${nameOf(line)} could not share with the line above.`)
      return
    }
    if (!isTied) {
      const carried = underIn(rankedAfter!, me)
      says(`${nameOf(line)} now shares place ${me.rank} with ${nameOf(ranked[index - 1])}.${carried > 0 ? ` The ${carried} line${plural(carried)} under it went with it.` : ''}`)
    } else {
      const under = underIn(rankedAfter!, me)
      says(under === 0
        ? `${nameOf(line)} left its group and has its own place ${me.rank}.`
        : `${nameOf(line)} and the ${under} line${plural(under)} under it left the group; they share place ${me.rank}.`)
    }
    keepFocus(line, 'served-tie')
    onTie(entry, !isTied, shown)
  }
  function share(line: ServedLine, percent: number) {
    const entry = entryOf(line)
    const next = withServedShare(base, entry, percent)
    const me = next && find(rankedOf(next), line)
    // The raw group may hold a stale entry the lines skip: its percentages are then not the ones asked for.
    if (!me?.group || Math.abs(me.group.percent - percent) > 1e-4) {
      says(`${nameOf(line)} could not change its share.`)
      return
    }
    says(`${nameOf(line)} now has ${fmtPercent(me.group.percent)} percent of place ${me.rank}.`)
    onShare(entry, percent, shown)
  }
  const step = (line: ServedLine, index: number, delta: -1 | 1) => {
    const next = index + delta
    if (next < 0 || next > ranked.length - 1) return
    move(line, moveTarget(ranked, index, delta), delta < 0 ? 'served-move-up' : 'served-move-down')
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
  /** Where a drop on ranked line `index` (or on the divider: index = ranked.length) lands. */
  const target = (e: React.DragEvent<HTMLElement>, index: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    const zone: DropZone = index >= ranked.length ? 'top' : dropZone(e.clientY - r.top, r.height)
    return { zone, place: dropPlace(ranked, index, zone) }
  }
  /** Dropping where it already is, as the lines show it, moves nothing (and draws no mark). */
  const moves = (line: ServedLine, where: ServedPlace) => withServedEntryRanked(view, entryOf(line), where) !== undefined
  const onDropOver = (e: React.DragEvent<HTMLElement>, index: number, key: string) => {
    const line = lines.find(l => lineKey(l) === dragRef.current)
    if (!line) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const t = target(e, index)
    const next = moves(line, t.place) ? { key, zone: index >= ranked.length ? 'divider' as const : t.zone, place: t.place, rank: ranked[index]?.rank } : null
    // dragover fires every ~50 ms: the same mark keeps the same state, so nothing re-renders.
    setDrop(prev => (sameDrop(prev, next) ? prev : next))
  }
  const onDropLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
  }
  const onDropped = (e: React.DragEvent<HTMLElement>, index: number) => {
    const line = lines.find(l => lineKey(l) === dragRef.current)
    if (!line) return
    e.preventDefault()
    const t = target(e, index)
    if (moves(line, t.place)) place(line, t.place, t.zone === 'middle' ? 'join' : 'edge', ranked[index] ? nameOf(ranked[index]) : '')
    endDrag()
  }

  const dropLine = (key: string) => {
    if (drop?.key !== key || drop.zone === 'middle') return null
    const side = drop.zone === 'bottom' ? 'after' : 'before'
    return (
      <span
        aria-hidden="true"
        data-testid="served-drop-line"
        data-side={side}
        className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${side === 'before' ? '-top-px' : '-bottom-px'}`}
      />
    )
  }

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
        <span data-testid="served-not-credited" role="img" aria-label="no credit" {...describedTip(NOT_CREDITED_HINT)} className="rounded bg-amber-900/40 px-1 text-[10px] text-amber-300">no credit</span>
      )}
      {line.group?.listOrder && (
        <span data-testid="served-list-order" role="img" aria-label="list order" {...describedTip(LIST_ORDER_HINT)} className="rounded bg-amber-900/40 px-1 text-[10px] text-amber-300">list order</span>
      )}
    </>
  )

  const renderLine = (line: ServedLine, index: number, isRanked: boolean) => {
    const block = line.blockId !== undefined ? blocks.find(b => b.id === line.blockId) : undefined
    const key = lineKey(line)
    const group = line.group
    const pressed = isTiedLine(line)
    const sameAbove = isRanked && group !== undefined && ranked[index - 1]?.rank === line.rank
    const sameBelow = isRanked && group !== undefined && ranked[index + 1]?.rank === line.rank
    const firstOfRank = !(isRanked && ranked[index - 1]?.rank === line.rank)
    const position = group ? (!sameAbove ? 'first' : !sameBelow ? 'last' : 'middle') : undefined
    const bracket = group
      ? `border-l-2 border-blue-400/60 pl-1.5 ${position === 'first' ? 'border-t-2 rounded-tl-md' : ''} ${position === 'last' ? 'border-b-2 rounded-bl-md' : ''}`
      : ''
    return (
      <li
        key={key}
        data-testid="served-line"
        data-kind={line.kind}
        data-block-id={line.blockId}
        data-area-id={line.areaId}
        data-span-size={line.span?.size}
        data-span-index={line.span?.index}
        data-ranked={isRanked ? 'true' : 'false'}
        data-line-key={key}
        data-rank={isRanked ? line.rank : undefined}
        data-group-size={group?.size}
        data-group-index={group?.index}
        data-group-position={position}
        draggable={fieldKey !== key}
        onDragStart={e => startDrag(e, key)}
        onDragEnd={endDrag}
        onDragOver={isRanked ? e => onDropOver(e, index, key) : undefined}
        onDragLeave={isRanked ? onDropLeave : undefined}
        onDrop={isRanked ? e => onDropped(e, index) : undefined}
        style={dragging === key ? { opacity: 0.4 } : undefined}
        className={`relative flex flex-col gap-0.5 rounded px-1 py-0.5 ${bracket}`}
      >
        {isRanked && dropLine(key)}
        {isRanked && drop?.zone === 'middle' && drop.rank === line.rank && (
          <span aria-hidden="true" data-testid="served-drop-join" className="absolute inset-0 rounded ring-2 ring-blue-500 pointer-events-none" />
        )}
        <div className="flex items-center gap-2">
          <span data-testid="served-rank" className="w-4 font-mono tabular-nums text-gray-500">{isRanked ? (firstOfRank ? line.rank : '') : '–'}</span>
          {block && (
            <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: block.color }} />
          )}
          <span data-testid="served-line-name" className="min-w-0 flex-1 truncate font-medium text-gray-100">{nameOf(line)}</span>
          {group && line.span?.index === 0 && (
            <span
              data-testid="served-share-entry"
              role="img"
              aria-label={`${fmtPercent(group.percent)} %`}
              {...describedTip('The areas of this block share one place; move or share one of them to rank them apart.')}
              className="font-mono text-[11px] tabular-nums text-gray-300"
            >{fmtPercent(group.percent)} %</span>
          )}
          {group && line.span === undefined && (
            <>
              <ShareField
                label={`Share of ${nameOf(line)} in its group (%)`}
                percent={group.percent}
                onCommit={p => share(line, p)}
                onInvalid={() => says(INVALID_SHARE)}
                onFocusChange={f => setFieldKey(cur => (f ? key : cur === key ? null : cur))}
              />
              <span aria-hidden="true" className="-ml-1.5 text-gray-500">%</span>
            </>
          )}
          {isRanked ? (
            <>
              <button
                type="button"
                data-testid="served-tie"
                aria-label="Share with the line above"
                aria-pressed={pressed}
                aria-disabled={index === 0}
                data-tip=""
                onClick={() => tie(line, index)}
                className={`${MINI_BUTTON_CLASS} ${pressed ? 'border-blue-400 bg-blue-950 text-blue-200' : ''}`}
              >Share</button>
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

  return (
    <ModalPortal>
    <div
      ref={ref}
      role="dialog"
      aria-label={`Served order of ${itemName}`}
      tabIndex={-1}
      data-testid="served-order-popover"
      data-item-id={itemId}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 flex max-h-[calc(100vh-1rem)] w-[420px] max-w-[calc(100vw-1rem)] flex-col overflow-y-auto gap-1.5 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl px-3 py-2.5 text-left outline-none"
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-semibold text-gray-100">
          <span data-testid="served-order-title" {...tippedLabel(SERVED_ORDER_HELP)} className={TIPPED_LABEL_CLASS}>Served in this order</span>
        </div>
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
      {ranked.some(l => l.span) && (
        <div className="text-[11px] text-gray-400">
          Lines of one place that are not in a bracket (a block's areas) are served in table order. Move or share one to rank them apart.
        </div>
      )}
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
      {/* Keyed on the message count: an identical message is a new node, so it is announced again. */}
      <div key={announce.n} role="status" className="sr-only">{announce.text}</div>
    </div>
    </ModalPortal>
  )
}

type Drop = { key: string; zone: DropZone | 'divider'; place: ServedPlace; rank?: number }
const sameEntry = (a: ServedEntry | null, b: ServedEntry | null) => a === b || (a !== null && b !== null && lineKey(a) === lineKey(b))
function sameDrop(a: Drop | null, b: Drop | null) {
  if (a === null || b === null) return a === b
  if (a.key !== b.key || a.zone !== b.zone || a.rank !== b.rank || a.place.kind !== b.place.kind) return false
  return a.place.kind === 'rank' ? sameEntry(a.place.before, (b.place as typeof a.place).before) : sameEntry(a.place.target, (b.place as typeof a.place).target)
}

/** The percent field of a grouped line: a draft while it is edited, committed on Enter or blur; Escape or an invalid value reverts. */
function ShareField({ label, percent, onCommit, onInvalid, onFocusChange }: {
  label: string
  percent: number
  onCommit: (percent: number) => void
  onInvalid: () => void
  onFocusChange: (focused: boolean) => void
}) {
  const shown = fmtPercent(percent)
  const [draft, setDraft] = useState<string | null>(null)
  // The first Esc reverts the draft, the next one reaches the popover.
  useEscapeLayer(draft !== null, () => setDraft(null))
  // A field that goes away while focused (its group dissolves) fires no blur: tell the line it is gone.
  const focusChange = useRef(onFocusChange)
  useLayoutEffect(() => { focusChange.current = onFocusChange })
  useEffect(() => () => focusChange.current(false), [])
  function commit() {
    if (draft === null) return
    const text = draft.trim()
    const value = Number(text)
    setDraft(null)
    if (text === '' || !Number.isFinite(value) || value <= 0 || value >= 100) {
      onInvalid()
      return
    }
    if (Math.abs(value - Number(shown)) < 1e-9) return // not an edit: stores nothing
    onCommit(value)
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      max={100}
      aria-label={label}
      data-testid="served-share"
      value={draft ?? shown}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => onFocusChange(true)}
      onBlur={() => { commit(); onFocusChange(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      className="w-14 rounded border border-gray-700 bg-gray-900 px-1 text-right font-mono text-[11px] tabular-nums text-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}
