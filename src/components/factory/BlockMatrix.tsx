import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useUiStore } from '../../store/uiStore'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { Segmented, Segment } from '../SegmentedControl'
import { EdgeChips } from './BlockGraphDetail'
import { buildBlockMatrix, cellTintPercent, matrixOrderOf } from './matrixCells'
import type { MatrixCell, MatrixPair } from './matrixCells'
import { connectionStatus, edgeSummaryTitle } from './graphConnection'
import type { Block, ConnectionFlow, GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Block matrix — the second view of the Block graph modal: rows supply, columns receive.
// ---------------------------------------------------------------------------

/** Width of the row-header column; the grid's own columns share the rest, between COL_MIN and COL_MAX px each. */
const ROW_HEAD = '11rem'
const COL_MIN = 28
const COL_MAX = 56

/** The row and the column the pointer or the focus is on; either may be absent (a header has only one). */
interface Cross { row?: number; col?: number }

const HATCH_BACK = 'repeating-linear-gradient(135deg, rgba(0,0,0,0.38) 0 3px, transparent 3px 6px)'
const HATCH_DIAGONAL = 'repeating-linear-gradient(45deg, rgba(156,163,175,0.25) 0 3px, transparent 3px 6px)'
const CROSS_TINT = 'linear-gradient(rgba(94,234,212,0.1), rgba(94,234,212,0.1))'

interface SlotProps {
  row: number
  col: number
  cell: MatrixCell | undefined
  /** The cell's row or column is the one under the cross-hair. */
  crossed: boolean
  selected: boolean
  color: string
  label: string
  tip: string
  onEnter: (row: number, col: number) => void
  onLeave: () => void
  onFocusCell: (row: number, col: number) => void
  onBlurCell: () => void
  onToggle: (key: string, ev: MouseEvent<HTMLButtonElement>) => void
}

const MatrixSlot = memo(function MatrixSlot({
  row, col, cell, crossed, selected, color, label, tip, onEnter, onLeave, onFocusCell, onBlurCell, onToggle,
}: SlotProps) {
  const cross = crossed ? 'bg-teal-300/10' : ''
  const common = {
    'data-crosshair': crossed ? 'true' : undefined,
    onMouseEnter: () => onEnter(row, col),
    onMouseLeave: onLeave,
  }
  if (row === col) {
    return <td {...common} style={{ backgroundImage: HATCH_DIAGONAL }} className={`border-b border-r border-gray-800 ${cross}`} />
  }
  if (!cell) return <td {...common} className={`border-b border-r border-gray-800 ${cross}`} />

  const ring = cell.limited > 0
    ? 'border-2 border-amber-500'
    : cell.allUnused
      ? 'border border-dashed border-gray-400'
      : 'border'
  return (
    <td {...common} className={`border-b border-r border-gray-800 p-0.5 ${cross}`}>
      <button
        type="button"
        data-testid="matrix-cell"
        data-from={cell.from}
        data-to={cell.to}
        data-count={cell.count}
        data-connection-ids={cell.connectionIds.join(' ')}
        data-status={cell.status}
        data-loop={cell.loop ? 'true' : undefined}
        data-back={cell.back ? 'true' : undefined}
        data-all-unused={cell.allUnused ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        aria-pressed={selected}
        aria-label={label}
        data-tip={tip}
        onClick={ev => onToggle(cell.key, ev)}
        onFocus={() => onFocusCell(row, col)}
        onBlur={onBlurCell}
        style={{
          backgroundColor: cell.status === 'pending'
            ? 'rgba(75,85,99,0.35)'
            : `color-mix(in srgb, ${color} ${cellTintPercent(cell.count)}%, transparent)`,
          backgroundImage: cell.back ? HATCH_BACK : undefined,
          borderColor: cell.limited > 0 || cell.allUnused ? undefined : cell.status === 'pending' ? '#4b5563' : color,
        }}
        className={`w-full h-6 flex items-center justify-center gap-0.5 rounded-sm text-[11px] font-mono tabular-nums text-gray-100 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-teal-300 ${ring} ${selected ? 'ring-2 ring-white' : ''}`}
      >
        {cell.loop && <span aria-hidden className="text-[10px] leading-none">↻</span>}
        {cell.count}
      </button>
    </td>
  )
})

interface BlockMatrixProps {
  blocks: Block[]
  /** The layout's dependency order (block ids). */
  dependencyOrder: string[]
  edges: MatrixPair[]
  flowsById: Map<string, ConnectionFlow>
  gameData: GameData
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function BlockMatrix({ blocks, dependencyOrder, edges, flowsById, gameData, onRemove, onSetLimit }: BlockMatrixProps) {
  const orderKind = useUiStore(s => s.blockMatrixOrder)
  const setOrderKind = useUiStore(s => s.setBlockMatrixOrder)

  const byId = useMemo(() => new Map(blocks.map(b => [b.id, b])), [blocks])
  const model = useMemo(
    () => buildBlockMatrix(matrixOrderOf(orderKind, blocks, dependencyOrder), edges, id => connectionStatus(flowsById.get(id))),
    [orderKind, blocks, dependencyOrder, edges, flowsById],
  )
  const n = model.order.length

  // Per cell: what its button says, so that a hover re-render does not rebuild them.
  const texts = useMemo(() => new Map(model.cells.map(c => {
    const from = byId.get(c.from)?.name ?? c.from
    const to = byId.get(c.to)?.name ?? c.to
    const statuses = c.connectionIds.map(id => connectionStatus(flowsById.get(id)))
    return [c.key, {
      label: `${plural(c.count, 'item', 'items')} from ${from} to ${to}${c.loop ? ', loop' : ''}${c.limited > 0 ? `, ${c.limited} limited` : ''}${c.unused > 0 ? `, ${c.unused} not used` : ''}${c.back ? ', runs against the order' : ''}`,
      tip: edgeSummaryTitle(c.count, from, to, statuses, c.loop),
    }]
  })), [model, byId, flowsById])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoverCross, setHoverCross] = useState<Cross | null>(null)
  const [focusCross, setFocusCross] = useState<Cross | null>(null)
  const cross = hoverCross ?? focusCross

  const selected = selectedKey !== null ? model.cells.find(c => c.key === selectedKey) : undefined
  // A selection on a cell that is gone (its last connection was removed) is dropped.
  if (selectedKey !== null && !selected) setSelectedKey(null)

  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Enter on a cell hands the focus to the panel, whose first control is the cell's first connection.
  const focusPanel = useRef(false)
  const selectedKeyRef = useRef<string | null>(null)
  useEffect(() => { selectedKeyRef.current = selectedKey }, [selectedKey])
  useEffect(() => {
    if (!focusPanel.current || selectedKey === null) return
    focusPanel.current = false
    panelRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
  }, [selectedKey])

  // Escape deselects first and closes the modal only when nothing is selected. A limit being typed handles its own Escape.
  useEffect(() => {
    if (selectedKey === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.tagName === 'INPUT')) return
      e.stopPropagation()
      if (panelRef.current?.contains(document.activeElement)) {
        const [from, to] = [selected?.from, selected?.to]
        scrollRef.current?.querySelector<HTMLElement>(`[data-testid="matrix-cell"][data-from="${CSS.escape(from ?? '')}"][data-to="${CSS.escape(to ?? '')}"]`)?.focus()
      }
      setSelectedKey(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [selectedKey, selected])

  const onEnter = useCallback((row: number, col: number) => setHoverCross({ row, col }), [])
  const onLeave = useCallback(() => setHoverCross(null), [])
  const onFocusCell = useCallback((row: number, col: number) => setFocusCross({ row, col }), [])
  const onBlurCell = useCallback(() => setFocusCross(null), [])
  const onToggle = useCallback((key: string, ev: MouseEvent<HTMLButtonElement>) => {
    const closing = selectedKeyRef.current === key
    if (!closing && ev.detail === 0) focusPanel.current = true
    setSelectedKey(closing ? null : key)
  }, [])

  const colorOf = (id: string) => byId.get(id)?.color ?? MISSING_BLOCK_COLOR
  const headTone = (on: boolean) => (on ? 'text-teal-300 font-bold' : 'text-gray-300')
  const crossStyle = (on: boolean) => (on ? { backgroundImage: CROSS_TINT } : undefined)
  const orderName = orderKind === 'dependency' ? 'dependency' : 'plan'

  const sourceName = selected ? byId.get(selected.from)?.name ?? selected.from : ''
  const targetName = selected ? byId.get(selected.to)?.name ?? selected.to : ''

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented label="Order" size="sm">
            <Segment pressed={orderKind === 'dependency'} onClick={() => setOrderKind('dependency')} data-tip="Suppliers first: connections run above the diagonal where they can">Dependency order</Segment>
            <Segment pressed={orderKind === 'plan'} onClick={() => setOrderKind('plan')} data-tip="The order of the block tabs">Plan order</Segment>
          </Segmented>
          <span data-testid="matrix-summary" className="text-xs text-gray-400">
            {n < 2
              ? 'No connections between blocks yet.'
              : `${n} × ${n} blocks, ${model.filled} filled, ${model.backCount} below the diagonal, in ${orderName} order`}
          </span>
        </div>
        <div ref={scrollRef} data-testid="matrix-scroll" className="flex-1 min-h-0 overflow-auto px-3 pb-3">
          {n >= 2 && (
            <table
              className="table-fixed border-separate border-spacing-0 text-xs"
              style={{ width: '100%', minWidth: `calc(${ROW_HEAD} + ${n * COL_MIN}px)`, maxWidth: `calc(${ROW_HEAD} + ${n * COL_MAX}px)` }}
            >
              <colgroup>
                <col style={{ width: ROW_HEAD }} />
                {model.order.map(id => <col key={id} />)}
              </colgroup>
              <thead className="sticky top-0 z-20 bg-gray-900">
                <tr>
                  <th className="sticky left-0 z-30 bg-gray-900" />
                  {model.order.map((id, col) => {
                    const name = byId.get(id)?.name ?? id
                    const on = cross?.col === col
                    return (
                      <th
                        key={id}
                        scope="col"
                        data-testid="matrix-col-head"
                        data-block-id={id}
                        data-crosshair={on ? 'true' : undefined}
                        data-tip={`${name} receives from ${plural(model.receives[col], 'block', 'blocks')}`}
                        style={crossStyle(on)}
                        onMouseEnter={() => setHoverCross({ col })}
                        onMouseLeave={onLeave}
                        className={`h-24 bg-gray-900 border-b border-gray-700 align-bottom pb-1 font-normal ${headTone(on)}`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className="[writing-mode:vertical-rl] rotate-180 max-h-[4.5rem] truncate">{name}</span>
                          <span className="text-[10px] font-mono text-gray-500">· {model.receives[col]}</span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {model.order.map((rowId, row) => {
                  const name = byId.get(rowId)?.name ?? rowId
                  const on = cross?.row === row
                  return (
                    <tr key={rowId} className="h-7">
                      <th
                        scope="row"
                        data-testid="matrix-row-head"
                        data-block-id={rowId}
                        data-crosshair={on ? 'true' : undefined}
                        data-tip={`${name} supplies ${plural(model.supplies[row], 'block', 'blocks')}`}
                        style={crossStyle(on)}
                        onMouseEnter={() => setHoverCross({ row })}
                        onMouseLeave={onLeave}
                        className={`sticky left-0 z-10 bg-gray-900 border-b border-r border-gray-700 px-2 text-left font-normal ${headTone(on)}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: colorOf(rowId) }} />
                          <span className="truncate">{name}</span>
                          <span className="ml-auto font-mono tabular-nums text-gray-500">{model.supplies[row]}</span>
                        </div>
                      </th>
                      {model.order.map((colId, col) => {
                        const cell = model.cellAt(row, col)
                        const text = cell ? texts.get(cell.key) : undefined
                        return (
                          <MatrixSlot
                            key={colId}
                            row={row}
                            col={col}
                            cell={cell}
                            crossed={cross !== null && (cross.row === row || cross.col === col)}
                            selected={cell !== undefined && cell.key === selectedKey}
                            color={colorOf(rowId)}
                            label={text?.label ?? ''}
                            tip={text?.tip ?? ''}
                            onEnter={onEnter}
                            onLeave={onLeave}
                            onFocusCell={onFocusCell}
                            onBlurCell={onBlurCell}
                            onToggle={onToggle}
                          />
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside ref={panelRef} data-testid="matrix-panel" className="w-[22rem] shrink-0 border-l border-gray-700 overflow-y-auto p-3">
        {selected ? (
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
              <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf(selected.from) }} />
              <span className="truncate">{sourceName} → {targetName}</span>
            </div>
            <div data-testid="matrix-panel-summary" className="text-xs text-gray-400 mt-1 mb-3">
              {[
                plural(selected.count, 'connection', 'connections'),
                selected.limited > 0 ? `${selected.limited} limited` : null,
                selected.unused > 0 ? `${selected.unused} not used` : null,
                selected.loop ? 'part of a loop' : null,
                selected.back ? 'runs against this order' : null,
              ].filter(Boolean).join(' · ')}
            </div>
            <EdgeChips
              key={selected.key}
              edge={selected}
              blocks={blocks}
              flowsById={flowsById}
              items={gameData.items}
              gameData={gameData}
              arrange="column"
              onRemove={onRemove}
              onSetLimit={onSetLimit}
            />
          </div>
        ) : (
          <Legend />
        )}
      </aside>
    </div>
  )
}

function Legend() {
  const row = 'flex items-center gap-2 text-xs text-gray-300'
  const swatch = 'w-6 h-4 rounded-sm shrink-0 flex items-center justify-center text-[10px] font-mono text-gray-100'
  return (
    <div data-testid="matrix-legend" className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">Reading the matrix</div>
      <div className={row}><span className={`${swatch} border border-gray-500`} style={{ background: 'color-mix(in srgb, #9ca3af 30%, transparent)' }}>3</span>Items from the row's block to the column's; the tint grows with the count</div>
      <div className={row}><span className={`${swatch} border-2 border-amber-500`} />A connection is limited</div>
      <div className={row}><span className={`${swatch} border border-dashed border-gray-400`} />Every connection is unused</div>
      <div className={row}><span className={swatch}>↻</span>Part of a loop</div>
      <div className={row}><span className={`${swatch} border border-gray-500`} style={{ backgroundImage: HATCH_BACK }} />Runs against this order (below the diagonal)</div>
      <div className={row}><span className={swatch} style={{ backgroundImage: HATCH_DIAGONAL }} />The diagonal: a block with itself</div>
      <div className={row}><span className={`${swatch} w-auto px-1 text-gray-400`}>Name · 3</span>Blocks supplied (rows) or received from (columns)</div>
    </div>
  )
}
