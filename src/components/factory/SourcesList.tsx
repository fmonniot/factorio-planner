import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import type { Block, BlockConnection, ConnectionFlow, Product } from '../../data/types'
import { blockAreas } from '../../solver/areas'
import { hasProduct } from '../../solver/blockGraph'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { productChangeEffects, requestBlockerTitle } from '../../store/connections'
import type { ProductChangeEffect } from '../../store/connections'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { fmtItemRateText, fmtRate, inputRateUnit } from './ItemTile'
import { ProductChangeDialog } from './ProductChangeDialog'
import { RateInput } from './RateInput'
import { cappedTitle, cappingLimit, REQUEST_IGNORED_TITLE } from './summarySegments'
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
// line holds the same switch as the Comes from control. Between *Make more here* and the end of the block lines it draws one
// line per connection of the item, in connection order, then the Receive from… line (`add-block`).
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

/** The `data-line` values: the lines of `sourcesLineOrder`, and the Receive from… line that ends the block lines. */
type RowKey = LineKey | 'add-block'

/** What a line is, for the shared frame: its key, name (a block line has none), help, reading, controls and state. */
interface LineProps {
  line: RowKey
  /** A block line: the connection it stands for. */
  connectionId?: string
  /** The id of the line's tooltip: the line's description, and its controls'. */
  helpId: string
  name?: React.ReactNode
  help: string
  reading?: React.ReactNode
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
function Line({ line, connectionId, helpId, name, help, reading, off, controls, frame, dropSide, focused, onFocusLine, onBlurLine }: LineProps) {
  return (
    <li
      tabIndex={0}
      data-testid="sources-line"
      data-line={line}
      data-connection-id={connectionId}
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-5">
        {name && <span className="flex items-center gap-1.5 text-[11px] font-medium shrink-0">{name}</span>}
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

/** The tag of a block line: what the connection is to its source. */
type Tag = 'requested' | 'existing'

/** One block line's model: its connection, source, flow, tag and what it reads. */
interface BlockRow {
  connection: BlockConnection
  source: Block | undefined
  flow: ConnectionFlow | undefined
  /** Deleted source or self-connection: listed greyed, with Remove only. */
  greyed: boolean
  tag?: Tag
  /** The tag's tooltip. */
  tagTitle?: string
  /** The action *Make it a product* is offered. */
  canMakeProduct: boolean
  /** Why it cannot be used: the source receives the item itself, so the request would be ignored. */
  productBlocked?: string
  status: string
}

/** The three drop handlers of a row. */
type DropHandlers = Required<Pick<React.HTMLAttributes<HTMLLIElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>>

const DRAG_BLOCK = 'application/x-sources-block-line'

export function SourcesList({ itemId, id }: { itemId: string; id?: string }) {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const setConnectionMaxRate = useBlockStore(s => s.setConnectionMaxRate)
  const moveConnection = useBlockStore(s => s.moveConnection)
  const moveConnectionBy = useBlockStore(s => s.moveConnectionBy)
  const addProduct = useBlockStore(s => s.addProduct)
  const gameData = useGameDataStore(selectGameData)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)

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
  // A move reorders the keyed lines and the browser drops the focus of the one that moved: put it back (a selector, on `refocus`).
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const selector = refocus.current
    refocus.current = null
    if (selector) listRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  const [focusedLine, setFocusedLine] = useState<string | null>(null)
  // What is being dragged ('make-here' or 'block:<connection id>'), as state for the faded look and as a ref for the handlers
  // that run before a render.
  const [dragging, setDragging] = useState<string | null>(null)
  const dragRef = useRef<string | null>(null)
  // The drop line of Make more here: before or after the whole group of block lines.
  const [drop, setDrop] = useState<'before' | 'after' | null>(null)
  // The drop line of a block line being reordered: on one line's edge.
  const [lineDrop, setLineDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  // The connection whose limit is being typed.
  const [editingLimit, setEditingLimit] = useState<string | null>(null)
  const [pending, setPending] = useState<{ sourceId: string; product: Product; effects: ProductChangeEffect[] } | null>(null)

  const blockById = useMemo(() => new Map(blocks.map(b => [b.id, b])), [blocks])
  const flowById = useMemo(() => new Map(flows.map(f => [f.connectionId, f])), [flows])
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
  const unsatisfied = result?.unsatisfied.find(u => u.itemId === itemId)?.rate ?? 0
  const importText = !solved ? '' : importOn ? (unsatisfied > EPS ? rate(unsatisfied) : 'none') : (unsatisfied > EPS ? `Missing ${rate(unsatisfied)}` : '')

  // The block lines, in connection order.
  const connections = block.inputConnections.filter(c => c.itemId === itemId)
  const rows: BlockRow[] = connections.map(connection => {
    const source = blockById.get(connection.fromBlockId)
    const flow = flowById.get(connection.id)
    const greyed = source === undefined || connection.fromBlockId === block.id
    if (greyed) {
      return { connection, source, flow, greyed, canMakeProduct: false, status: source === undefined ? 'the source block was deleted' : 'ignored: a block cannot supply itself' }
    }
    const sourceName = source.name
    // Before the first solve the tag follows the source's products; after it, the solver's reading (a request it ignores is a take).
    const requested = flow ? flow.kind === 'request' : hasProduct(source, itemId)
    const tag: Tag = requested ? 'requested' : 'existing'
    const tagTitle = requested
      ? `${sourceName} makes what this block needs of it.`
      : flow?.requestIgnored
        ? `Taken as existing: ${REQUEST_IGNORED_TITLE[flow.requestIgnored]}`
        : `${sourceName} only gives what it has left over.`
    let status = ''
    if (flow?.status === 'unused') status = 'not used: this block makes or needs none from outside'
    else if (flow?.status === 'limited') {
      const cap = cappingLimit(true, flow.capped, connection.maxRate)
      status = cap !== undefined ? cappedTitle(rate(cap)) : `Limited: ${sourceName} only offers ${rate(flow.available)}`
    }
    const canMakeProduct = tag === 'existing' && !hasProduct(source, itemId)
    // As in the connection menu: a source that receives the item itself would ignore the request, so the action is disabled.
    const blocker = canMakeProduct ? productChangeEffects(blocks, source.id, itemId, 'add', flows).find(e => e.blocker)?.blocker : undefined
    return { connection, source, flow, greyed, tag, tagTitle, canMakeProduct, ...(blocker ? { productBlocked: requestBlockerTitle(blocker, sourceName, name) } : {}), status }
  })

  /** Make more here goes above (Make it here) or below (Receive it first) the block lines. */
  const placeMakeMore = (side: Side) => setMakeHere(itemId, side === 'below' ? 'after-blocks' : undefined)
  const toggleMakeMore = () => {
    refocus.current = '[data-testid="sources-make-here-switch"]'
    setMakeHere(itemId, off ? undefined : 'off')
  }
  /** Move Make more here by button: the focus goes to the other button, since the pressed one is at the end of the group now. */
  const moveMakeMore = (side: Side) => {
    refocus.current = side === 'below' ? '[data-testid="sources-move-up"]' : '[data-testid="sources-move-down"]'
    placeMakeMore(side)
  }
  /** Move a block line by button; the focus follows it, on the other button when the pressed one has nowhere left to go. */
  const moveRow = (connectionId: string, delta: -1 | 1) => {
    const from = connections.findIndex(c => c.id === connectionId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= connections.length) return
    const exhausted = delta < 0 ? to === 0 : to === connections.length - 1
    const button = (delta < 0) !== exhausted ? 'sources-block-move-up' : 'sources-block-move-down'
    refocus.current = `[data-connection-id="${connectionId}"] [data-testid="${button}"]`
    moveConnectionBy(connectionId, delta)
  }
  const removeRow = (connectionId: string) => {
    refocus.current = '[data-testid="sources-receive-from"]'
    removeInputConnection(connectionId)
  }

  /** *Make it a product* on the source of a line: asks first when other blocks' connections change meaning. */
  function requestSourceProduct(sourceId: string) {
    const product: Product = { id: crypto.randomUUID(), itemId }
    const effects = productChangeEffects(blocks, sourceId, itemId, 'add', flows)
    if (effects.length === 0) addProduct(product, sourceId)
    else setPending({ sourceId, product, effects })
  }

  function endDrag() {
    dragRef.current = null
    setDragging(null)
    setDrop(null)
    setLineDrop(null)
  }
  function startDrag(e: React.DragEvent, key: string, type: string) {
    if (e.target !== e.currentTarget) return
    e.dataTransfer.setData(type, key)
    e.dataTransfer.effectAllowed = 'move'
    dragRef.current = key
    // The faded line is painted after the browser has captured the drag image.
    window.setTimeout(() => { if (dragRef.current === key) setDragging(key) }, 0)
  }

  const makeHereDrag: LineProps['frame'] = off
    ? {}
    : {
        draggable: true,
        onDragStart: e => startDrag(e, 'make-here', DRAG_TYPE),
        onDragEnd: endDrag,
      }

  // The rows of the block group (the block lines and the Receive from… line) take the drop of Make more here: before the
  // group or after it, by the half of the group the pointer is over (a row's position plus the pointer's place in it).
  const groupRows = rows.length + 1
  const groupDrop = (index: number): DropHandlers => {
    const sideOf = (e: React.DragEvent<HTMLLIElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      return index + (e.clientY - r.top) / r.height < groupRows / 2 ? 'before' : 'after'
    }
    return {
      onDragOver: e => {
        if (dragRef.current !== 'make-here') return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const side = sideOf(e)
        // Dropping where it already is moves nothing: no line.
        const same = (side === 'before') === (drawnSide === 'above')
        setDrop(drawnSide !== undefined && same ? null : side)
      },
      onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null) },
      onDrop: e => {
        if (dragRef.current !== 'make-here') return
        e.preventDefault()
        placeMakeMore(sideOf(e) === 'before' ? 'above' : 'below')
        endDrag()
      },
    }
  }

  /** The connection id of the block line being dragged, if one is. */
  const draggedRow = () => (dragRef.current?.startsWith('block:') ? dragRef.current.slice('block:'.length) : null)

  // A block line takes the drop of another block line: before it or before the next one, by the half it is over. A drop of
  // Make more here goes to the group's handlers.
  const rowFrame = (index: number, connectionId: string, movable: boolean): LineProps['frame'] => {
    const group = groupDrop(index)
    const target = (e: React.DragEvent<HTMLLIElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      const side = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      return { side, beforeId: side === 'before' ? connectionId : (connections[index + 1]?.id ?? null) } as const
    }
    /** Dropping where it already is moves nothing. */
    const moves = (dragId: string, beforeId: string | null) => {
      const from = connections.findIndex(c => c.id === dragId)
      return from >= 0 && beforeId !== dragId && (connections[from + 1]?.id ?? null) !== beforeId
    }
    return {
      ...(movable ? { draggable: true, onDragStart: (e: React.DragEvent<HTMLLIElement>) => startDrag(e, `block:${connectionId}`, DRAG_BLOCK), onDragEnd: endDrag } : {}),
      ...(dragging === `block:${connectionId}` ? { style: { opacity: 0.4 } } : {}),
      onDragOver: e => {
        const dragId = draggedRow()
        if (dragId === null) return group.onDragOver(e)
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const t = target(e)
        setLineDrop(moves(dragId, t.beforeId) ? { id: connectionId, side: t.side } : null)
      },
      onDragLeave: e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDrop(null); setLineDrop(null) }
      },
      onDrop: e => {
        const dragId = draggedRow()
        if (dragId === null) return group.onDrop(e)
        e.preventDefault()
        const t = target(e)
        if (moves(dragId, t.beforeId)) {
          refocus.current = `[data-connection-id="${dragId}"]`
          moveConnection(dragId, t.beforeId)
        }
        endDrag()
      },
    }
  }

  // The Receive from… line is the end of the block group: a block line dropped on it goes last.
  const receiveFrame = (): LineProps['frame'] => {
    const group = groupDrop(rows.length)
    return {
      onDragOver: e => {
        const dragId = draggedRow()
        if (dragId === null) return group.onDragOver(e)
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setLineDrop(connections[connections.length - 1]?.id !== dragId ? { id: 'add-block', side: 'before' } : null)
      },
      onDragLeave: e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDrop(null); setLineDrop(null) }
      },
      onDrop: e => {
        const dragId = draggedRow()
        if (dragId === null) return group.onDrop(e)
        e.preventDefault()
        refocus.current = `[data-connection-id="${dragId}"]`
        moveConnection(dragId, null)
        endDrag()
      },
    }
  }

  const focusProps = (key: string) => ({
    focused: focusedLine === key,
    // The help line takes room under the line: it opens on keyboard focus only, since a press that focuses a control would
    // shift the lines below it between the press and the release and lose the click.
    onFocusLine: (e: React.FocusEvent<HTMLLIElement>) => { if (keyboardFocus(e.target)) setFocusedLine(key) },
    onBlurLine: (e: React.FocusEvent<HTMLLIElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedLine(l => (l === key ? null : l))
    },
  })

  const drawBlockLines = (helpId: string): React.ReactNode => {
    const help = SOURCES_LINES['other-blocks'].title
    const last = rows.length // the index of the Receive from… line
    const edge = (index: number): 'before' | 'after' | null => {
      const line = lineDrop && lineDrop.id === (rows[index]?.connection.id ?? 'add-block') ? lineDrop.side : null
      if (line) return line
      if (drop === 'before' && index === 0) return 'before'
      if (drop === 'after' && index === last) return 'after'
      return null
    }
    return (
      <>
        {rows.map((row, index) => {
          const c = row.connection
          const key = `block:${c.id}`
          const rowHelpId = `${helpId}-${c.id}`
          const sourceName = row.source?.name ?? '(deleted block)'
          const limit = c.maxRate !== undefined ? rate(c.maxRate) : undefined
          const first = index === 0
          const end = index === rows.length - 1
          return (
            <Line
              key={c.id}
              line="block"
              connectionId={c.id}
              helpId={rowHelpId}
              name={
                <>
                  <span
                    aria-hidden="true"
                    data-testid="sources-block-color"
                    className="inline-block size-2.5 shrink-0 rounded-sm"
                    style={{ background: row.source?.color ?? MISSING_BLOCK_COLOR }}
                  />
                  <span data-testid="sources-block-name">{sourceName}</span>
                </>
              }
              help={help}
              off={row.greyed}
              reading={
                <>
                  {row.tag && (
                    <span data-testid="sources-block-tag" data-tag={row.tag} title={row.tagTitle} className={`mr-2 rounded border px-1 ${row.tag === 'requested' ? 'border-teal-700 text-teal-300' : 'border-gray-600 text-gray-300'}`}>
                      {row.tag}
                    </span>
                  )}
                  {!row.greyed && <span data-testid="sources-block-rate" className="mr-2 tabular-nums">{row.flow ? rate(row.flow.rate) : '—'}</span>}
                  {row.status && <span data-testid="sources-block-status" data-status={row.flow?.status}>{row.status}</span>}
                </>
              }
              frame={rowFrame(index, c.id, !row.greyed && editingLimit !== c.id)}
              dropSide={edge(index)}
              controls={
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {row.canMakeProduct && (
                    <button
                      type="button" data-testid="sources-make-product" aria-describedby={rowHelpId}
                      aria-disabled={row.productBlocked !== undefined || undefined} title={row.productBlocked}
                      onClick={() => { if (!row.productBlocked) requestSourceProduct(c.fromBlockId) }}
                      className={MINI_BUTTON_CLASS}
                    >
                      Make it a product
                    </button>
                  )}
                  {!row.greyed && (editingLimit === c.id
                    ? (
                      <RateInput
                        initial={c.maxRate !== undefined ? fmtRate(c.maxRate / 60, inputRateUnit(itemId, unit)) : ''}
                        rateUnit={inputRateUnit(itemId, unit)}
                        ariaLabel={`Limit of ${sourceName}`}
                        allowClear
                        onCommit={perMin => setConnectionMaxRate(c.id, perMin)}
                        onStop={how => {
                          // Enter and Escape give the focus back to the button; a blur means it went elsewhere on purpose.
                          if (how === 'key') refocus.current = `[data-connection-id="${c.id}"] [data-testid="sources-limit"]`
                          setEditingLimit(null)
                        }}
                      />
                    )
                    : (
                      <button
                        type="button" data-testid="sources-limit" aria-label={`Limit of ${sourceName}`} aria-describedby={rowHelpId}
                        title={limit ? 'Change or clear the limit' : 'Set a limit on what is received over this connection'}
                        onClick={() => setEditingLimit(c.id)}
                        className={MINI_BUTTON_CLASS}
                      >
                        {limit ? `Limit ${limit}` : 'No limit'}
                      </button>
                    ))}
                  {!row.greyed && (
                    <>
                      <button
                        type="button" data-testid="sources-block-move-up" aria-label="Move up" aria-describedby={rowHelpId}
                        aria-disabled={first} onClick={() => moveRow(c.id, -1)}
                        className={MINI_BUTTON_CLASS}
                      >
                        <span aria-hidden="true">▲</span>
                      </button>
                      <button
                        type="button" data-testid="sources-block-move-down" aria-label="Move down" aria-describedby={rowHelpId}
                        aria-disabled={end} onClick={() => moveRow(c.id, 1)}
                        className={MINI_BUTTON_CLASS}
                      >
                        <span aria-hidden="true">▼</span>
                      </button>
                    </>
                  )}
                  <button type="button" data-testid="sources-block-remove" aria-label={`Remove ${sourceName}`} aria-describedby={rowHelpId} onClick={() => removeRow(c.id)} className={MINI_BUTTON_CLASS}>
                    Remove
                  </button>
                </span>
              }
              {...focusProps(key)}
            />
          )
        })}
        <Line
          line="add-block"
          helpId={`${helpId}-add`}
          help={help}
          reading={rows.length === 0 ? `No connection for ${name}.` : undefined}
          frame={receiveFrame()}
          dropSide={edge(last)}
          controls={
            <span className="flex shrink-0 items-center">
              <button
                type="button"
                data-testid="sources-receive-from"
                aria-describedby={`${helpId}-add`}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openConnectionMenu(itemId, r.left, r.bottom)
                }}
                className={MINI_BUTTON_CLASS}
              >
                Receive from…
              </button>
            </span>
          }
          {...focusProps('add-block')}
        />
      </>
    )
  }

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
            frame={{ ...makeHereDrag, ...(dragging === 'make-here' ? { style: { opacity: 0.4 } } : {}) }}
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
        return <Fragment key={line}>{drawBlockLines(helpId)}</Fragment>
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
    <>
      <ul ref={listRef} id={id} role="list" aria-label={`Sources of ${name}`} data-testid="sources-list" className="flex flex-col rounded border border-gray-700/70 bg-gray-950/40 py-0.5">
        {sourcesLineOrder(makeHere, hasAreas, lastSide).map(draw)}
      </ul>
      {pending && (
        <ProductChangeDialog
          change="add"
          itemId={itemId}
          itemName={name}
          blockName={blockById.get(pending.sourceId)?.name ?? ''}
          effects={pending.effects}
          rateUnit={unit}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            addProduct(pending.product, pending.sourceId)
            setPending(null)
          }}
        />
      )}
    </>
  )
}
