import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { blockAreas } from '../../solver/areas'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResult } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { fmtItemRateText } from './ItemTile'
import { SOURCES_LINES, sourcesLineOrder } from './itemSourcing'
import type { LineKey, Side } from './itemSourcing'
import { itemMakers } from './sourcingText'
import type { ItemMaker } from './sourcingText'
import { Tip } from './Tip'
import { MINI_BUTTON_CLASS, Switch } from './Switch'

// ---------------------------------------------------------------------------
// SourcesList — the Sources list of one item of the active block (phase 2 of sourcing priority): every place the item may
// come from, top to bottom in the order it is tried. It is a second view of the item's stored rule, beside the three presets:
// moving *Make more here* below the block lines is Receive it first, switching it off is Don't make more here, and the Import
// line holds the same switch as the Comes from control. This ticket draws the fixed lines and one read-only placeholder
// where the block lines go (`BlockLines`); the block lines themselves, with the Receive from… line, replace it later.
// ---------------------------------------------------------------------------

const EPS = 1e-6

/** Whether the focus came by the keyboard (an engine without `:focus-visible` counts as keyboard). */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/** The drag type of the *Make more here* line. */
const DRAG_TYPE = 'application/x-sources-line'

/** What a line is, for the shared frame: its key, name (a block line has none), help, reading, controls and state. */
interface LineProps {
  line: LineKey
  /** The id of the line's tooltip: the line's description, and its controls'. */
  helpId: string
  name?: string
  help: string
  reading?: string
  /** The line has no effect now (greyed). */
  off?: boolean
  controls?: React.ReactNode
  /** Extra attributes and handlers of the frame (drag and drop). */
  frame?: React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean }
  /** The drop line drawn on one edge of this line. */
  dropSide?: 'before' | 'after' | null
  focused: boolean
  onFocusLine: (e: React.FocusEvent<HTMLLIElement>) => void
  onBlurLine: (e: React.FocusEvent<HTMLLIElement>) => void
}

/**
 * One line: its name, what it reads, its controls. The line takes the focus (so the keyboard reaches the read-only ones), and
 * shows its help as a tooltip on hover and focus and as a help line under it while it holds the focus.
 */
function Line({ line, helpId, name, help, reading, off, controls, frame, dropSide, focused, onFocusLine, onBlurLine }: LineProps) {
  return (
    <li
      tabIndex={0}
      data-testid="sources-line"
      data-line={line}
      data-off={off || undefined}
      aria-describedby={helpId}
      onFocus={onFocusLine}
      onBlur={onBlurLine}
      {...frame}
      className={`group relative flex flex-col gap-0.5 rounded px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${off ? 'text-gray-500' : 'text-gray-200'}`}
    >
      {dropSide && (
        <span
          aria-hidden="true"
          data-testid="sources-drop-line"
          data-side={dropSide}
          className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${dropSide === 'before' ? '-top-px' : '-bottom-px'}`}
        />
      )}
      <div className="flex items-center gap-2 min-h-5">
        {name && <span className="text-[11px] font-medium shrink-0">{name}</span>}
        <span data-testid="sources-reading" className={`min-w-0 flex-1 text-[11px] leading-snug break-words ${off ? 'text-gray-500' : 'text-gray-400'}`}>{reading}</span>
        {controls}
      </div>
      <Tip id={helpId} align="start" hoverOnly>{help}</Tip>
      {/* The tooltip is the line's one description (aria-describedby); the help line repeats it for the eye only. */}
      {focused && <p data-testid="sources-help" aria-hidden="true" className="text-[11px] leading-snug text-gray-400">{help}</p>}
    </li>
  )
}

/** "{recipe} ({n} × {machine})", as the sentences name a row; the recipe alone without a solve or while the row is idle. */
const makerLabel = (m: ItemMaker, solved: boolean) => solved && m.machineCount > 0 ? `${m.recipeName} (${m.machineCount} × ${m.machineName})` : m.recipeName

export function SourcesList({ itemId, id }: { itemId: string; id?: string }) {
  const block = useBlockStore(selectActiveBlock)
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const gameData = useGameDataStore(selectGameData)
  const result = useSolverStore(selectBlockResult(block?.id))
  const unit = useUiStore(s => s.rateUnit)

  const rule = block?.sourceRules[itemId]
  const makeHere = rule?.makeHere
  // Where *Make more here* was drawn last: it keeps that place while it is switched off. Session state in the ui store, not part
  // of the stored rule, so that every surface that shows the list agrees and a closed list remembers it.
  const blockId = block?.id
  const storedSide = useUiStore(s => (blockId ? s.sourcesSides[`${blockId}:${itemId}`] : undefined))
  const setSourcesSide = useUiStore(s => s.setSourcesSide)
  const drawnSide: Side | undefined = makeHere === 'after-blocks' ? 'below' : makeHere === undefined ? 'above' : undefined
  const lastSide: Side = drawnSide ?? storedSide ?? 'above'
  useEffect(() => {
    if (blockId && drawnSide) setSourcesSide(blockId, itemId, drawnSide)
  }, [blockId, itemId, drawnSide, setSourcesSide])
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  // A move reorders the keyed lines and the browser drops the focus of the one that moved: put it back (on `refocus`).
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const testId = refocus.current
    refocus.current = null
    if (testId) listRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus()
  })

  const [focusedLine, setFocusedLine] = useState<LineKey | null>(null)
  const [dragging, setDragging] = useState(false)
  const [drop, setDrop] = useState<'before' | 'after' | null>(null)
  // The drag state is read by handlers that run before a render: a ref carries it.
  const draggingRef = useRef(false)

  const rootPlan = block?.rootPlan
  const hasAreas = useMemo(() => rootPlan !== undefined && blockAreas(rootPlan) !== undefined, [rootPlan])
  const makers = useMemo(
    () => (block && gameData ? itemMakers(block, gameData, result, itemId) : []),
    [block, gameData, result, itemId],
  )
  if (!block || !gameData) return null

  const name = gameData.items[itemId]?.name ?? itemId
  const solved = result !== undefined
  const rate = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)
  const off = makeHere === 'off'
  const importOn = !rule?.importOff

  // Already made here: under Don't make more here every row that makes the item, otherwise the rows not dedicated to it.
  const made = solved
    ? makers.filter(m => (off || m.byproduct) && m.rate > EPS).map(m => `${m.recipeName} ${rate(m.rate)}`)
    : makers.filter(m => m.byproduct).map(m => m.recipeName)
  const madeText = made.length > 0 ? made.join(', ') : 'nothing yet'
  const dedicated = makers.filter(m => !m.byproduct)
  const makeText = dedicated.length > 0 ? dedicated.map(m => makerLabel(m, solved)).join(', ') : 'no row here makes it'
  const connections = block.inputConnections.filter(c => c.itemId === itemId).length
  const blockText = connections > 0 ? `${connections} ${connections === 1 ? 'connection' : 'connections'}` : `No connection for ${name}.`
  const unsatisfied = result?.unsatisfied.find(u => u.itemId === itemId)?.rate ?? 0
  const importText = !solved ? '' : importOn ? (unsatisfied > EPS ? rate(unsatisfied) : 'none') : (unsatisfied > EPS ? `Missing ${rate(unsatisfied)}` : '')

  /** Make more here goes above (Make it here) or below (Receive it first) the block lines. */
  const placeMakeMore = (side: Side) => setMakeHere(itemId, side === 'below' ? 'after-blocks' : undefined)
  const toggleMakeMore = () => {
    refocus.current = 'sources-make-here-switch'
    setMakeHere(itemId, off ? undefined : 'off')
  }
  /** Move Make more here by button: the focus goes to the other button, since the pressed one is at the end of the group now. */
  const moveMakeMore = (side: Side) => {
    refocus.current = side === 'below' ? 'sources-move-up' : 'sources-move-down'
    placeMakeMore(side)
  }

  function endDrag() {
    draggingRef.current = false
    setDragging(false)
    setDrop(null)
  }

  const makeHereDrag: LineProps['frame'] = off
    ? {}
    : {
        draggable: true,
        onDragStart: e => {
          if (e.target !== e.currentTarget) return
          e.dataTransfer.setData(DRAG_TYPE, 'make-here')
          e.dataTransfer.effectAllowed = 'move'
          draggingRef.current = true
          // The faded line is painted after the browser has captured the drag image.
          window.setTimeout(() => { if (draggingRef.current) setDragging(true) }, 0)
        },
        onDragEnd: endDrag,
      }

  // The block lines take the drop: before them, or after them, by the half of the placeholder the pointer is over.
  const blockFrame: LineProps['frame'] = {
    onDragOver: e => {
      if (!draggingRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      const side = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      // Dropping where it already is moves nothing: no line.
      const same = (side === 'before') === (drawnSide === 'above')
      setDrop(drawnSide !== undefined && same ? null : side)
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null) },
    onDrop: e => {
      if (!draggingRef.current) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      placeMakeMore(e.clientY < r.top + r.height / 2 ? 'above' : 'below')
      endDrag()
    },
  }

  const focusProps = (line: LineKey) => ({
    focused: focusedLine === line,
    // The help line takes room under the line: it opens on keyboard focus only, since a press that focuses a control would
    // shift the lines below it between the press and the release and lose the click.
    onFocusLine: (e: React.FocusEvent<HTMLLIElement>) => { if (keyboardFocus(e.target)) setFocusedLine(line) },
    onBlurLine: (e: React.FocusEvent<HTMLLIElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedLine(l => (l === line ? null : l))
    },
  })

  const draw = (line: LineKey): React.ReactNode => {
    const helpId = `${listId}-${line}-help`
    switch (line) {
      case 'made-here':
        return <Line key={line} line={line} helpId={helpId} name={SOURCES_LINES['made-here'].label} help={SOURCES_LINES['made-here'].title} reading={madeText} {...focusProps(line)} />
      case 'make-here': {
        return (
          <Line
            key={line}
            line={line}
            helpId={helpId}
            name={SOURCES_LINES['make-here'].label}
            help={SOURCES_LINES['make-here'].title}
            reading={makeText}
            off={off}
            frame={{ ...makeHereDrag, ...(dragging ? { style: { opacity: 0.4 } } : {}) }}
            controls={
              <span className="flex shrink-0 items-center gap-1">
                {/* Moving is across the whole group of block lines; a line switched off has no place to move to. */}
                <button
                  type="button" data-testid="sources-move-up" aria-label="Move up" aria-describedby={helpId}
                  aria-disabled={off || drawnSide === 'above'} onClick={() => { if (!off && drawnSide === 'below') moveMakeMore('above') }}
                  className={MINI_BUTTON_CLASS}
                >
                  <span aria-hidden="true">▲</span>
                </button>
                <button
                  type="button" data-testid="sources-move-down" aria-label="Move down" aria-describedby={helpId}
                  aria-disabled={off || drawnSide === 'below'} onClick={() => { if (!off && drawnSide === 'above') moveMakeMore('below') }}
                  className={MINI_BUTTON_CLASS}
                >
                  <span aria-hidden="true">▼</span>
                </button>
                <Switch on={!off} label={SOURCES_LINES['make-here'].label} testId="sources-make-here-switch" describedBy={helpId} onToggle={toggleMakeMore} />
              </span>
            }
            {...focusProps(line)}
          />
        )
      }
      case 'other-areas':
        return <Line key={line} line={line} helpId={helpId} name={SOURCES_LINES['other-areas'].label} help={SOURCES_LINES['other-areas'].title} {...focusProps(line)} />
      case 'block':
        return <BlockLines key={line} helpId={helpId} reading={blockText} frame={blockFrame} drop={drop} {...focusProps(line)} />
      case 'import': {
        return (
          <Line
            key={line}
            line={line}
            helpId={helpId}
            name={SOURCES_LINES.import.label}
            help={SOURCES_LINES.import.title}
            reading={importText}
            off={!importOn}
            controls={
              <span className="flex shrink-0 items-center">
                <Switch on={importOn} label={SOURCES_LINES.import.label} testId="sources-import-switch" describedBy={helpId} onToggle={() => toggleImportOff(itemId)} />
              </span>
            }
            {...focusProps(line)}
          />
        )
      }
    }
  }

  return (
    <ul ref={listRef} id={id} role="list" aria-label={`Sources of ${name}`} data-testid="sources-list" className="flex flex-col rounded border border-gray-700/70 bg-gray-950/40 py-0.5">
      {sourcesLineOrder(makeHere, hasAreas, lastSide).map(draw)}
    </ul>
  )
}

/**
 * The block lines: one line per connection of the item, in connection order, and the Receive from… line. This ticket draws one
 * read-only placeholder in their place; it is the drop target of *Make more here* (the drop sits before or after the group).
 */
function BlockLines({ helpId, reading, frame, drop, ...focus }: {
  helpId: string
  reading: string
  frame: LineProps['frame']
  drop: 'before' | 'after' | null
  focused: boolean
  onFocusLine: (e: React.FocusEvent<HTMLLIElement>) => void
  onBlurLine: (e: React.FocusEvent<HTMLLIElement>) => void
}) {
  return <Line line="block" helpId={helpId} help={SOURCES_LINES['other-blocks'].title} reading={reading} frame={frame} dropSide={drop} {...focus} />
}
