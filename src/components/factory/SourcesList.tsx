import { useId, useLayoutEffect, useRef, useState } from 'react'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { areaName as areaNameOf } from '../../data/subPlanTree'
import type { Product } from '../../data/types'
import { hasProduct } from '../../solver/blockGraph'
import { useBlockStore } from '../../store/blockStore'
import { productChangeEffects } from '../../store/connections'
import type { ProductChangeEffect } from '../../store/connections'
import { useUiStore } from '../../store/uiStore'
import { fmtRate, inputRateUnit } from './ItemTile'
import { describedTip } from '../tipProps'
import { ProductChangeDialog } from './ProductChangeDialog'
import { RateInput } from './RateInput'
import { AREA_LINE_HELP, MAKE_MORE_PLACE_HELP, MAKE_MORE_PLACES, SOURCES_DETAIL, SOURCES_LINES } from './itemSourcing'
import type { Side } from './itemSourcing'
import { EPS, lineOpens, lineTip, reachReading } from './sourcesLineText'
import { altMoveTarget } from './sourcesModel'
import type { SourceLine } from './sourcesModel'
import { DashedSquareIcon, DetailStatus, SourcesLine } from './SourcesLine'
import type { SourcesView } from './useSourcesModel'
import { StripIcon } from './StripIcon'
import { MINI_BUTTON_CLASS, Switch } from './Switch'
import { Cluster } from './StripToolbar'
import type { StripAction } from './StripToolbar'

// ---------------------------------------------------------------------------
// SourcesList — the Sources list of one item of the active block (phase 2 of sourcing priority): every place the item may
// come from, top to bottom in the order it is tried, as rows on a rail. Each row reads what the block consumes from it (its share
// of the item's need); its name's tooltip is its help, and the lines that have controls or a status (Make more here, the block
// lines, Import while something is missing) open a detail with them. It is a second view of the item's stored rule, beside the
// three presets: moving *Make more here* below the block lines is Receive it first, switching it off is Don't make more here, and
// the Import line holds the same switch as the Comes from control. Between *Make more here* and the end of the block lines it draws
// one line per connection of the item, in connection order, then the Receive from… line (`add-block`). A foot under the lines
// adds them up.
// With an area (`view.area`) it is the list of one area (D6 and D12 of phase 5): the same lines read and written through the area's
// own rule. *Other areas* is one line per area that supplies the item, with a switch and the rate routed from it; the block lines are
// read-only (their order, limits and removal belong to the block) and show their share of what reaches the area; only the Receive
// from… line stays, because it adds a connection to the block (no order, no limit) and the area's "No connection for X." notice
// offers it. At block scope *Other areas* stays one read-only line. The model of the lines (`sourcesModel.ts`) comes in `view`.
// ---------------------------------------------------------------------------


/** The drag type of the *Make more here* line. */
const DRAG_TYPE = 'application/x-sources-line'

/** The three drop handlers of a row. */
type DropHandlers = Required<Pick<React.HTMLAttributes<HTMLLIElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>>

type Frame = (React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean }) | undefined

const DRAG_BLOCK = 'application/x-sources-block-line'

/** The data-line value of a model line. */
const dataLineOf = (l: SourceLine) => l.kind

const PRESSED_CLASS = 'aria-pressed:border-teal-600 aria-pressed:bg-teal-900/60 aria-pressed:text-teal-200'

/** The switch of a line, with the help text that describes it for a screen reader (the tooltip says the state). */
function LineSwitch({ testId, on, label, helpId, help, onToggle }: { testId: string; on: boolean; label: string; helpId: string; help: string; onToggle: () => void }) {
  return (
    <>
      <Switch on={on} label={label} testId={testId} describedBy={helpId} compact tip={`${label} ${on ? 'on' : 'off'}`} onToggle={onToggle} />
      <span id={helpId} className="sr-only">{help}</span>
    </>
  )
}

export function SourcesList({ view, id, onScope }: {
  view: SourcesView
  id?: string
  /** Switches the control's scope (an area's block lines point to the whole block). */
  onScope: (area: string | undefined) => void
}) {
  const { block, blocks, flows, itemId, name, unit, rate, area, makeHere, drawnSide, rows, model } = view
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const setAreaMakeHere = useBlockStore(s => s.setAreaMakeHere)
  const toggleAreaImportOff = useBlockStore(s => s.toggleAreaImportOff)
  const toggleAreaSupplier = useBlockStore(s => s.toggleAreaSupplier)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const setConnectionMaxRate = useBlockStore(s => s.setConnectionMaxRate)
  const moveConnection = useBlockStore(s => s.moveConnection)
  const moveConnectionBy = useBlockStore(s => s.moveConnectionBy)
  const addProduct = useBlockStore(s => s.addProduct)
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  // A move reorders the keyed lines and the browser drops the focus of the one that moved: put it back (a selector, on `refocus`).
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const selector = refocus.current
    refocus.current = null
    if (selector) listRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  // The line whose detail is open (one at a time), by its stable key: it stays open while the line moves.
  const [openLineKey, setOpenLine] = useState<string | null>(null)
  const openKey = model.lines.some(l => l.key === openLineKey && lineOpens(l)) ? openLineKey : null
  // A line that stops being openable (Import with nothing missing) forgets it was open, so it does not reopen by itself later.
  if (openLineKey !== null && openKey === null) setOpenLine(null)
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
  const [pending, setPending] = useState<{ sourceId: string; product: Product; effects: ProductChangeEffect[]; connectionId: string } | null>(null)

  const blockById = new Map(blocks.map(b => [b.id, b]))
  const connections = block.inputConnections.filter(c => c.itemId === itemId)
  const off = makeHere === 'off'

  /** Make more here goes above (Make it here) or below (Receive it first) the block lines. */
  const writeMakeHere = (value: 'after-blocks' | 'off' | undefined) => area !== undefined ? setAreaMakeHere(area, itemId, value) : setMakeHere(itemId, value)
  const placeMakeMore = (side: Side) => writeMakeHere(side === 'below' ? 'after-blocks' : undefined)
  const toggleMakeMore = () => {
    refocus.current = '[data-testid="sources-make-here-switch"]'
    writeMakeHere(off ? undefined : 'off')
  }
  /** Move Make more here by button: the focus stays on the button of its new side. */
  const moveMakeMore = (side: Side) => {
    refocus.current = `[data-line="make-here"] [data-testid="${side === 'above' ? 'sources-make-before' : 'sources-make-after'}"]`
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
  function requestSourceProduct(sourceId: string, connectionId: string) {
    const source = blockById.get(sourceId)
    if (!source || hasProduct(source, itemId)) return
    const product: Product = { id: crypto.randomUUID(), itemId }
    const effects = productChangeEffects(blocks, sourceId, itemId, 'add', flows)
    // The button goes with the product: the focus goes to the line's toggle (after the dialog, when it asks).
    if (effects.length === 0) {
      refocus.current = `[data-connection-id="${connectionId}"] [data-testid="sources-line-toggle"]`
      addProduct(product, sourceId)
    } else setPending({ sourceId, product, effects, connectionId })
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

  const makeHereDrag: Frame = off
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
        refocus.current = '[data-line="make-here"] [data-testid="sources-line-toggle"]'
        placeMakeMore(sideOf(e) === 'before' ? 'above' : 'below')
        endDrag()
      },
    }
  }

  /** The connection id of the block line being dragged, if one is. */
  const draggedRow = () => (dragRef.current?.startsWith('block:') ? dragRef.current.slice('block:'.length) : null)

  // A block line takes the drop of another block line: before it or before the next one, by the half it is over. A drop of
  // Make more here goes to the group's handlers.
  const rowFrame = (index: number, connectionId: string, movable: boolean): Frame => {
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
          refocus.current = `[data-connection-id="${dragId}"] [data-testid="sources-line-toggle"]`
          moveConnection(dragId, t.beforeId)
        }
        endDrag()
      },
    }
  }

  // The Receive from… line is the end of the block group: a block line dropped on it goes last.
  const receiveFrame = (): Frame => {
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
        refocus.current = `[data-connection-id="${dragId}"] [data-testid="sources-line-toggle"]`
        moveConnection(dragId, null)
        endDrag()
      },
    }
  }

  const last = rows.length // the index of the Receive from… line
  const edge = (index: number): 'before' | 'after' | null => {
    const line = lineDrop && lineDrop.id === (rows[index]?.connection.id ?? 'add-block') ? lineDrop.side : null
    if (line) return line
    if (drop === 'before' && index === 0) return 'before'
    if (drop === 'after' && index === last) return 'after'
    return null
  }

  /** Alt+ArrowUp / Alt+ArrowDown on a line's name moves the line; the plain arrows are left alone. */
  const nameKeyDown = (line: SourceLine) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    // The block lines are the block's: an area's list cannot reorder them.
    if (area !== undefined && line.kind === 'block') return
    const move = altMoveTarget(line.key, e.key === 'ArrowUp' ? -1 : 1, { connectionIds: connections.map(c => c.id), makeHere, greyed: new Set(rows.filter(r => r.greyed).map(r => r.connection.id)) })
    if (!move) return
    e.preventDefault()
    if (move.type === 'connection') {
      refocus.current = `[data-connection-id="${move.connectionId}"] [data-testid="sources-line-toggle"]`
      moveConnectionBy(move.connectionId, move.delta)
    } else {
      refocus.current = '[data-line="make-here"] [data-testid="sources-line-toggle"]'
      placeMakeMore(move.side)
    }
  }

  const rateText = (l: SourceLine) => l.rate === undefined || (l.kind !== 'block' && l.rate <= EPS) ? '—' : rate(l.rate)

  function drawBlockLine(line: SourceLine, index: number) {
    const row = rows[index]
    const c = row.connection
    const detailId = `${listId}-${line.key}-detail`
    const sourceName = line.label
    const limit = c.maxRate !== undefined ? rate(c.maxRate) : undefined
    const first = index === 0
    const end = index === rows.length - 1
    const movable = area === undefined && !row.greyed && editingLimit !== c.id
    const limited = row.flow?.status === 'limited'
    const help = lineTip(line, { itemName: name, atArea: area !== undefined, greyed: row.greyed })
    const reach = area !== undefined && !row.greyed ? reachReading(row.flow, line.rate, rate) : undefined
    return (
      <SourcesLine
        key={line.key}
        line={line}
        dataLine="block"
        open={openKey === line.key}
        openable
        onToggle={() => setOpenLine(k => (k === line.key ? null : line.key))}
        detailId={detailId}
        nameTip={help}
        nameDescription={[help, row.tagTitle, reach].filter(Boolean).join(' ') || undefined}
        rateTip={reach}
        icon={<span aria-hidden="true" data-testid="sources-block-color" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: row.source?.color ?? MISSING_BLOCK_COLOR }} />}
        tag={row.tag && (
          <span data-testid="sources-block-tag" data-tag={row.tag} data-tip={row.tagTitle} className={`shrink-0 rounded border px-1 text-[10px] font-normal leading-4 ${row.tag === 'requested' ? 'border-teal-700 text-teal-300' : 'border-gray-600 text-gray-300'}`}>
            {row.tag}
          </span>
        )}
        rateText={rateText(line)}
        rateTestId="sources-block-rate"
        frame={rowFrame(index, c.id, movable)}
        dropSide={edge(index)}
        draggable={movable}
        onNameKeyDown={nameKeyDown(line)}
        detail={
          <>
            {row.status && <DetailStatus tone={limited ? 'amber' : 'grey'} testId="sources-block-status" status={row.flow?.status}>{row.status}</DetailStatus>}
            {area !== undefined ? (
              <>
                <div className="flex">
                  <button type="button" data-testid="sources-whole-block" {...describedTip(SOURCES_DETAIL.blockAtArea)} onClick={() => onScope(undefined)} className={MINI_BUTTON_CLASS}>Whole block</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1">
                  {!row.greyed && editingLimit !== c.id && (
                    <button
                      type="button" data-testid="sources-limit" aria-label={`Limit of ${sourceName}`}
                      data-tip={limit ? 'Change or clear the limit' : 'Set a limit on what is received over this connection'}
                      onClick={() => setEditingLimit(c.id)}
                      className={MINI_BUTTON_CLASS}
                    >
                      {limit ? `Limit ${limit}` : 'No limit'}
                    </button>
                  )}
                  {!row.greyed && editingLimit === c.id && (
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
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <Cluster
                      actions={[
                        ...(row.canMakeProduct
                          ? [{
                              label: 'Make it a product', icon: 'make-product', testId: 'sources-make-product', describedBy: detailId,
                              ariaDisabled: row.productBlocked !== undefined, title: row.productBlocked,
                              onSelect: () => requestSourceProduct(c.fromBlockId, c.id),
                            } satisfies StripAction]
                          : []),
                        ...(!row.greyed
                          ? [
                              { label: 'Move up', icon: 'up', testId: 'sources-block-move-up', describedBy: detailId, ariaDisabled: first, onSelect: () => moveRow(c.id, -1) } satisfies StripAction,
                              { label: 'Move down', icon: 'down', testId: 'sources-block-move-down', describedBy: detailId, ariaDisabled: end, joined: true, onSelect: () => moveRow(c.id, 1) } satisfies StripAction,
                            ]
                          : []),
                        { label: `Remove ${sourceName}`, icon: 'x', testId: 'sources-block-remove', describedBy: detailId, danger: true, onSelect: () => removeRow(c.id) } satisfies StripAction,
                      ]}
                    />
                  </span>
                </div>
              </>
            )}
          </>
        }
      />
    )
  }

  function drawLine(line: SourceLine, blockIndex: number) {
    if (line.kind === 'block') return drawBlockLine(line, blockIndex)
    const detailId = `${listId}-${line.key}-detail`
    const helpId = `${listId}-${line.key}-help`
    const common = {
      line,
      dataLine: dataLineOf(line),
      open: openKey === line.key,
      openable: lineOpens(line),
      onToggle: () => setOpenLine(k => (k === line.key ? null : line.key)),
      detailId,
      nameTip: lineTip(line, { itemName: name, atArea: area !== undefined }),
      rateText: rateText(line),
      rateTestId: 'sources-rate' as const,
      onNameKeyDown: lineOpens(line) ? nameKeyDown(line) : undefined,
      draggable: false,
    }
    switch (line.kind) {
      case 'made-here':
        return (
          <SourcesLine
            key={line.key}
            {...common}
            icon={<StripIcon name="make" />}
          />
        )
      case 'make-here':
        return (
          <SourcesLine
            key={line.key}
            {...common}
            icon={<StripIcon name="make-more" />}
            frame={{ ...makeHereDrag, ...(dragging === 'make-here' ? { style: { opacity: 0.4 } } : {}) }}
            draggable={!off}
            switchNode={<LineSwitch testId="sources-make-here-switch" on={!off} label={SOURCES_LINES['make-here'].label} helpId={helpId} help={SOURCES_LINES['make-here'].title} onToggle={toggleMakeMore} />}
            detail={
              <>
                {/* Moving is across the whole group of block lines; a line switched off has no place to move to. */}
                <div role="group" aria-label="Where Make more here is tried" className="flex flex-wrap items-center gap-1">
                  {(['above', 'below'] as const).map(side => (
                    <button
                      key={side}
                      type="button"
                      data-testid={side === 'above' ? 'sources-make-before' : 'sources-make-after'}
                      aria-pressed={!off && drawnSide === side}
                      aria-disabled={off || undefined}
                      data-tip={MAKE_MORE_PLACE_HELP[side]}
                      onClick={() => { if (!off && drawnSide !== side) moveMakeMore(side) }}
                      className={`${MINI_BUTTON_CLASS} ${PRESSED_CLASS}`}
                    >
                      {MAKE_MORE_PLACES[side].label}
                    </button>
                  ))}
                </div>
              </>
            }
          />
        )
      case 'other-areas':
        return (
          <SourcesLine
            key={line.key}
            {...common}
            icon={<DashedSquareIcon />}
          />
        )
      case 'other-area': {
        return (
          <SourcesLine
            key={line.key}
            {...common}
            icon={<DashedSquareIcon />}
            switchNode={<LineSwitch
                testId="sources-area-switch" on={!line.off} label={`Take from ${line.label}`} helpId={helpId} help={AREA_LINE_HELP}
                onToggle={() => {
                  refocus.current = `[data-area-id="${line.areaId}"] [data-testid="sources-area-switch"]`
                  if (area !== undefined) toggleAreaSupplier(area, itemId, line.areaId!)
                }}
              />}
          />
        )
      }
      case 'import': {
        const importOn = view.importOn
        return (
          <SourcesLine
            key={line.key}
            {...common}
            icon={<StripIcon name="import" />}
            switchNode={<LineSwitch testId="sources-import-switch" on={importOn} label={SOURCES_LINES.import.label} helpId={helpId} help={SOURCES_LINES.import.title} onToggle={() => area !== undefined ? toggleAreaImportOff(area, itemId) : toggleImportOff(itemId)} />}
            detail={<DetailStatus tone="amber">{SOURCES_DETAIL.importMissing}</DetailStatus>}
          />
        )
      }
    }
  }

  function drawReceiveFrom() {
    return (
      <li
        key="add-block"
        data-testid="sources-line"
        data-line="add-block"
        {...receiveFrame()}
        className="relative rounded text-gray-200"
      >
        {edge(last) && (
          <span
            aria-hidden="true"
            data-testid="sources-drop-line"
            data-side={edge(last)}
            className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${edge(last) === 'before' ? '-top-px' : '-bottom-px'}`}
          />
        )}
        <div className="flex h-[26px] items-center">
          <span aria-hidden="true" className="relative z-10 flex w-4 shrink-0 items-center justify-center text-[13px] font-bold leading-none text-teal-300">+</span>
          <button
            type="button"
            data-testid="sources-receive-from"
            aria-haspopup="menu"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              openConnectionMenu(itemId, r.left, r.bottom)
            }}
            className="ml-[20px] rounded text-[11px] font-medium text-teal-300 outline-none hover:text-teal-200 focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            Receive from…
          </button>
          {rows.length === 0 && <span className="ml-2 min-w-0 truncate text-[11px] text-gray-500">No connection for {name}.</span>}
        </div>
      </li>
    )
  }

  // The lines in the order the rule makes them; the Receive from… line ends the group of block lines.
  const lineByKey = new Map(model.lines.map(l => [l.key, l]))
  const drawOrdered = (key: string): React.ReactNode[] => {
    if (key === 'block') {
      return [
        ...rows.map((r, i) => drawBlockLine(lineByKey.get(`block:${r.connection.id}`)!, i)),
        drawReceiveFrom(),
      ]
    }
    const line = lineByKey.get(key)
    return line ? [drawLine(line, 0)] : []
  }

  const scopeName = area !== undefined ? areaNameOf(block.rootPlan, area) : undefined
  const foot = (
    <li data-testid="sources-foot" data-total={model.total} data-missing={model.missing} className="relative flex h-[26px] items-center text-[11px] text-gray-400">
      <span aria-hidden="true" className="relative z-10 flex w-4 shrink-0 items-center justify-center text-gray-500">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5l3 3 3-3" /></svg>
      </span>
      <span className="ml-1.5 min-w-0 flex-1 truncate">{scopeName !== undefined ? `Reaches ${scopeName}` : 'Reaches the rows'}</span>
      {model.missing > EPS && <span data-testid="sources-foot-missing" className="mr-1.5 shrink-0 text-amber-300">{rate(model.missing)} missing</span>}
      <span data-testid="sources-foot-total" className="w-11 shrink-0 text-right font-mono tabular-nums text-gray-200">{model.need === undefined ? '—' : rate(model.total)}</span>
      <span aria-hidden="true" className="w-[30px] shrink-0" />
    </li>
  )

  return (
    <>
      <ul ref={listRef} id={id} role="list" aria-label={`Sources of ${name}`} data-testid="sources-list" className="relative flex flex-col py-0.5">
        <span aria-hidden="true" className="absolute left-[7px] top-1 bottom-3 w-0.5 bg-gray-700" />
        {view.order.flatMap(drawOrdered)}
        {foot}
      </ul>
      {pending && (
        <ProductChangeDialog
          change="add"
          itemId={itemId}
          itemName={name}
          blockName={blockById.get(pending.sourceId)?.name ?? ''}
          effects={pending.effects}
          rateUnit={unit}
          onCancel={() => {
            refocus.current = `[data-connection-id="${pending.connectionId}"] [data-testid="sources-line-toggle"]`
            setPending(null)
          }}
          onConfirm={() => {
            // The store refuses a second product of the item, so a source that gained it meanwhile makes this a no-op.
            refocus.current = `[data-connection-id="${pending.connectionId}"] [data-testid="sources-line-toggle"]`
            addProduct(pending.product, pending.sourceId)
            setPending(null)
          }}
        />
      )}
    </>
  )
}
