import { useMemo } from 'react'
import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import {
  OUTSIDE, flowOrder, focusArea, groupRows, groupTotal, type GroupTotal, itemGroupMap, matchQuery,
  type BlockMatrix, type ColumnMode,  type MatrixArea, type MatrixRow, type RowMode,
} from './areaMatrix'
import { fmtAmount, fmtSigned, unitSuffix } from './matrixFormat'

// ---------------------------------------------------------------------------
// One block's areas as a balance matrix (items x areas), with an optional focus on one area.
// ---------------------------------------------------------------------------

export interface BlockAreaMatrixProps {
  matrix: BlockMatrix
  gameData: GameData
  rateUnit: RateUnit
  rowMode: RowMode
  columnMode: ColumnMode
  query: string
  focusedAreaId: string | null
  onFocus: (areaId: string | null) => void
  showAllAreas: boolean
  onShowAll: (show: boolean) => void
  groupOverrides: Map<string, boolean>
  onToggleGroup: (groupId: string, open: boolean) => void
  openTails: Set<string>
  onToggleTail: (groupId: string) => void
  onOpenArea: (area: MatrixArea) => void
}

const SEND = 'bg-sky-400/15 text-sky-300'
const RECEIVE = 'bg-orange-400/15 text-orange-300'
const OUTSIDE_COL = 'border-x border-dashed border-gray-600'
const FOCUS_COL = 'ring-1 ring-inset ring-teal-400 bg-teal-500/10'
const COUNTERPART = 'ring-1 ring-inset ring-teal-400/60'
const MANY_ROWS = 40

function groupText(t: GroupTotal, unit: RateUnit): string {
  if (t.kind === 'net') return t.t === 0 ? '' : fmtSigned(t.t, unit)
  const parts = []
  if (t.out > 0) parts.push(`${fmtAmount(t.out, unit)} →`)
  if (t.in > 0) parts.push(`→ ${fmtAmount(t.in, unit)}`)
  return parts.join(' · ')
}

function groupColor(t: GroupTotal): string {
  if (t.kind === 'net') return t.t === 0 ? '' : t.t > 0 ? 'text-sky-300' : 'text-orange-300'
  if (t.out > 0 && t.in > 0) return 'text-gray-300'
  return t.out > 0 ? 'text-sky-300' : t.in > 0 ? 'text-orange-300' : ''
}

function headerNote(inRate: number, outRate: number, items: number): string {
  const n = `${items} ${items === 1 ? 'item' : 'items'}`
  if (inRate > 0 && outRate > 0) return `trades ${n}`
  return inRate > 0 ? `sends it ${n}` : `takes ${n}`
}

export function BlockAreaMatrix(props: BlockAreaMatrixProps) {
  const {
    matrix, gameData, rateUnit, rowMode, columnMode, query, focusedAreaId, onFocus, showAllAreas, onShowAll,
    groupOverrides, onToggleGroup, openTails, onToggleTail, onOpenArea,
  } = props
  const unit = unitSuffix(rateUnit)
  const groups = useMemo(() => itemGroupMap(gameData), [gameData])
  const areaById = useMemo(() => new Map(matrix.areas.map(a => [a.areaId, a])), [matrix])
  const order = useMemo(() => (columnMode === 'flow' ? flowOrder(matrix) : matrix.areas.map(a => a.areaId)), [matrix, columnMode])
  const focus = useMemo(
    () => (focusedAreaId !== null && areaById.has(focusedAreaId) ? focusArea(matrix, focusedAreaId) : null),
    [matrix, focusedAreaId, areaById],
  )
  const focusedArea = focus ? areaById.get(focus.areaId)! : null
  const counterpartMode = focus !== null && !showAllAreas

  const match = useMemo(
    () => matchQuery(
      query,
      matrix.rows,
      matrix.areas.map(a => ({ id: a.areaId, names: [a.name] })),
      (r, colId) => (r.cells[colId] ?? 0) !== 0,
      [matrix.blockName],
    ),
    [query, matrix],
  )

  const columns = useMemo(() => {
    let ids = order
    if (counterpartMode && focus) ids = ids.filter(id => id === focus.areaId || focus.tradingAreaIds.includes(id))
    if (match?.columnIds) ids = ids.filter(id => match.columnIds!.has(id) || id === focus?.areaId)
    return ids.map(id => areaById.get(id)!)
  }, [order, counterpartMode, focus, match, areaById])

  const rows = useMemo(() => {
    let list = match?.rows ?? []
    if (counterpartMode && focus) {
      const keep = new Set(focus.rows.map(r => r.itemId))
      list = list.filter(r => keep.has(r.itemId))
    }
    return list
  }, [match, counterpartMode, focus])

  const collapseTail = query.trim() === ''
  const grouped = useMemo(() => groupRows(rows, rowMode, groups, { collapseTail }), [rows, rowMode, groups, collapseTail])
  const grouping = rowMode === 'category'

  const hiddenCount = focus ? matrix.areas.length - 1 - focus.tradingAreaIds.length : 0
  const items = gameData.items

  /** What a cell shows: the area's signed net, or in counterpart mode the allocated part with the focus. */
  function cellValue(row: MatrixRow, areaId: string): { text: string; kind: 'send' | 'receive'; counterpart: boolean; title?: string } | null {
    const v = row.cells[areaId] ?? 0
    if (counterpartMode && focus && areaId !== focus.areaId) {
      const c = focus.counterpart[row.itemId]?.[areaId] ?? 0
      if (c <= 0) return null
      const sends = v > 0
      const n = fmtAmount(c, rateUnit)
      const area = areaById.get(areaId)!.name
      const item = row.name
      const per = `${fmtAmount(c, rateUnit)}${unit}`
      return {
        text: sends ? `${n} →` : `→ ${n}`,
        kind: sends ? 'send' : 'receive',
        counterpart: true,
        title: sends
          ? `${area} sends ${per} of ${item} to ${focusedArea!.name} (allocated in proportion to what each area sends)`
          : `${focusedArea!.name} sends ${per} of ${item} to ${area} (allocated in proportion to what each area takes)`,
      }
    }
    if (v === 0) return null
    return { text: fmtSigned(v, rateUnit), kind: v > 0 ? 'send' : 'receive', counterpart: false }
  }

  /** The outside columns: unsigned amounts; in counterpart mode only the part that meets the focus. */
  function outsideValue(row: MatrixRow, side: 'from' | 'to'): number {
    const raw = side === 'from' ? row.fromOutside : row.toOutside
    if (!counterpartMode || !focus || raw === 0) return raw
    const sends = (row.cells[focus.areaId] ?? 0) > 0
    if ((side === 'to') !== sends) return 0
    return focus.counterpart[row.itemId]?.[OUTSIDE] ?? 0
  }

  const groupCell = (list: MatrixRow[], areaId: string) =>
    groupTotal(list, areaId, counterpartMode && focus !== null && areaId !== focus.areaId ? focus : null)

  const cellClass = (areaId: string, extra = '') =>
    `${areaId === focusedAreaId ? FOCUS_COL : ''} ${extra}`

  function renderRow(row: MatrixRow) {
    const fromV = outsideValue(row, 'from')
    const toV = outsideValue(row, 'to')
    const item = items[row.itemId]
    return (
      <tr key={row.itemId} data-item-id={row.itemId} className="hover:bg-gray-800/40">
        <th scope="row" className="sticky left-0 z-10 bg-gray-900 px-2 py-0.5 text-left font-normal text-gray-200 border-b border-gray-800">
          <span className="flex items-center gap-2 min-w-0">
            {item?.iconPath ? (
              <Icon iconPath={item.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" />
            ) : (
              <span aria-hidden className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate" title={row.name}>{row.name}</span>
          </span>
        </th>
        <td data-col="from-outside" data-rate={fromV} className={`${OUTSIDE_COL} px-1 py-0.5 text-center font-mono tabular-nums text-gray-300 border-b border-gray-800`}>
          {fromV > 0 ? fmtAmount(fromV, rateUnit) : ''}
        </td>
        {columns.map(a => {
          const c = cellValue(row, a.areaId)
          const raw = row.cells[a.areaId] ?? 0
          return (
            <td
              key={a.areaId}
              data-col={a.areaId}
              data-rate={raw}
              data-sign={raw > 0 ? 'send' : raw < 0 ? 'receive' : undefined}
              data-counterpart={c?.counterpart ? 'true' : undefined}
              title={c?.title}
              className={cellClass(a.areaId, 'px-1 py-0.5 text-center font-mono tabular-nums border-b border-gray-800')}
            >
              {c && (
                <span className={`block mx-auto max-w-[5rem] rounded py-0.5 ${c.kind === 'send' ? SEND : RECEIVE} ${c.counterpart ? COUNTERPART : ''}`}>
                  {c.text}
                </span>
              )}
            </td>
          )
        })}
        <td data-col="to-outside" data-rate={toV} className={`${OUTSIDE_COL} px-1 py-0.5 text-center font-mono tabular-nums text-gray-300 border-b border-gray-800`}>
          {toV > 0 ? fmtAmount(toV, rateUnit) : ''}
        </td>
      </tr>
    )
  }

  const colSpan = columns.length + 3
  const totalItems = rows.length
  const body = grouped.length === 0 ? null : grouped.map((g, gi) => {
    const open = !grouping
      ? true
      : groupOverrides.get(g.id) ?? (totalItems <= MANY_ROWS || query.trim() !== '' || gi < 2)
    const tailOpen = openTails.has(g.id)
    const shownRows = open ? (tailOpen ? g.rows : g.head) : []
    const fromTotal = g.rows.reduce((n, r) => n + outsideValue(r, 'from'), 0)
    const toTotal = g.rows.reduce((n, r) => n + outsideValue(r, 'to'), 0)
    return (
      <tbody key={g.id} data-group-id={g.id}>
        {grouping && (
          <tr className="bg-gray-800/60 font-semibold">
            <th scope="rowgroup" className="sticky left-0 z-10 bg-gray-800 px-2 py-1 text-left border-b border-gray-700">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggleGroup(g.id, !open)}
                className="flex items-center gap-2 text-gray-100 hover:text-white"
              >
                <span aria-hidden className="w-2.5 text-[10px] text-gray-400">{open ? '▾' : '▸'}</span>
                {g.name}
                <span className="text-[11px] font-normal text-gray-400">
                  {g.rows.length} {g.rows.length === 1 ? 'item' : 'items'}
                </span>
              </button>
            </th>
            <td className={`${OUTSIDE_COL} px-1 text-center font-mono tabular-nums text-gray-300 border-b border-gray-700`}>
              {fromTotal > 0 ? fmtAmount(fromTotal, rateUnit) : ''}
            </td>
            {columns.map(a => {
              const t = groupCell(g.rows, a.areaId)
              const text = groupText(t, rateUnit)
              return (
                <td
                  key={a.areaId}
                  title={t.kind === 'pair' && t.out > 0 && t.in > 0 ? 'Sends to the focus, then receives from it' : undefined}
                  className={cellClass(a.areaId, `px-1 text-center font-mono tabular-nums border-b border-gray-700 ${groupColor(t)}`)}
                >
                  {text}
                </td>
              )
            })}
            <td className={`${OUTSIDE_COL} px-1 text-center font-mono tabular-nums text-gray-300 border-b border-gray-700`}>
              {toTotal > 0 ? fmtAmount(toTotal, rateUnit) : ''}
            </td>
          </tr>
        )}
        {shownRows.map(renderRow)}
        {open && g.tail.length > 0 && (
          <tr>
            <td colSpan={colSpan} className="px-2 py-1 text-[11px] text-gray-400 border-b border-gray-800">
              <button
                type="button"
                aria-expanded={tailOpen}
                onClick={() => onToggleTail(g.id)}
                className="hover:text-gray-200 hover:underline text-left"
              >
                {tailOpen
                  ? 'Show fewer'
                  : `+ ${g.tail.length} more, ${fmtAmount(g.tail[0].total, rateUnit)}${unit} and below: ${g.tail.slice(0, 4).map(r => r.name).join(', ')}${g.tail.length > 4 ? '…' : ''}`}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    )
  })

  const q = query.trim()
  let empty: string | null = null
  if (match === null) empty = `No area or item matches "${q}"`
  else if (matrix.rows.length === 0) empty = `No item moves between the areas of ${matrix.blockName}.`

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 overflow-auto">
        {empty !== null ? (
          <p className="p-4 text-sm text-gray-400">{empty}</p>
        ) : (
          <>
            {focus && focusedArea && (
              <div className="m-3 mb-0 flex flex-wrap items-center gap-3 rounded border border-dashed border-gray-600 px-3 py-1.5 text-xs text-gray-400">
                {showAllAreas ? (
                  <button type="button" onClick={() => onShowAll(false)} className="text-teal-300 hover:underline">
                    Hide areas that do not trade with {focusedArea.name}
                  </button>
                ) : hiddenCount > 0 ? (
                  <>
                    <span>
                      {hiddenCount} {hiddenCount === 1 ? 'area is' : 'areas are'} hidden because {hiddenCount === 1 ? 'it does' : 'they do'} not trade with {focusedArea.name}.
                    </span>
                    <button type="button" onClick={() => onShowAll(true)} className="text-teal-300 hover:underline">
                      Show all {matrix.areas.length} areas
                    </button>
                  </>
                ) : (
                  <span>Every area of the block trades with {focusedArea.name}.</span>
                )}
              </div>
            )}
            <table aria-label={`Areas of ${matrix.blockName}`} className="table-fixed border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20 bg-gray-900">
                <tr>
                  <th scope="col" className="sticky left-0 z-30 bg-gray-900 w-56 px-2 py-2 text-left border-b border-gray-700">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">
                      {counterpartMode
                        ? `${rows.length} ${rows.length === 1 ? 'item' : 'items'} it trades`
                        : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}${grouping ? ` · ${grouped.length} ${grouped.length === 1 ? 'group' : 'groups'}` : ''}`}
                    </span>
                  </th>
                  <th scope="col" className={`${OUTSIDE_COL} w-24 px-1 py-2 border-b border-gray-700`}>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">From outside</span>
                  </th>
                  {columns.map(a => {
                    const focused = a.areaId === focusedAreaId
                    const trade = counterpartMode && !focused ? focus?.trades.find(t => t.partyId === a.areaId) : undefined
                    return (
                      <th
                        key={a.areaId}
                        scope="col"
                        data-area-id={a.areaId}
                        className={cellClass(a.areaId, 'w-[5.5rem] px-1 py-2 text-center font-medium border-b border-gray-700')}
                      >
                        <button
                          type="button"
                          aria-pressed={focused}
                          title={`Focus ${a.name}`}
                          onClick={() => onFocus(focused ? null : a.areaId)}
                          className={`block mx-auto max-w-full truncate text-xs font-semibold hover:text-white ${focused ? 'text-teal-200' : 'text-gray-200'}`}
                        >
                          {a.name}
                        </button>
                        <small className="block text-[11px] font-normal text-gray-400">
                          {trade
                            ? headerNote(trade.inRate, trade.outRate, trade.items)
                            : `${a.contents.rowCount} ${a.contents.rowCount === 1 ? 'row' : 'rows'}`}
                        </small>
                      </th>
                    )
                  })}
                  <th scope="col" className={`${OUTSIDE_COL} w-24 px-1 py-2 border-b border-gray-700`}>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">To outside</span>
                  </th>
                </tr>
              </thead>
              {body}
            </table>
            {rows.length === 0 && <p className="p-4 text-sm text-gray-400">Nothing to show for these areas.</p>}
          </>
        )}
      </div>
      {focus && focusedArea && (
        <AreaPanel
          matrix={matrix}
          area={focusedArea}
          trades={focus.trades}
          areaById={areaById}
          rateUnit={rateUnit}
          onFocus={onFocus}
          onOpenArea={onOpenArea}
        />
      )}
    </div>
  )
}

function AreaPanel({ matrix, area, trades, areaById, rateUnit, onFocus, onOpenArea }: {
  matrix: BlockMatrix
  area: MatrixArea
  trades: { partyId: string; items: number; inRate: number; outRate: number }[]
  areaById: Map<string, MatrixArea>
  rateUnit: RateUnit
  onFocus: (areaId: string | null) => void
  onOpenArea: (area: MatrixArea) => void
}) {
  const c = area.contents
  const unit = unitSuffix(rateUnit)
  const names = c.recipeNames
  const rowsText =
    names.length === 0 ? 'No rows.'
      : names.length <= 4 ? `Rows: ${names.join(', ')}.`
        : `Rows include ${names.slice(0, 4).join(', ')} and ${names.length - 4} more.`
  return (
    <aside aria-label={area.name} className="w-[340px] shrink-0 border-l border-gray-700 overflow-y-auto p-3 flex flex-col gap-3 text-xs text-gray-300">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-100 truncate">{area.name}</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Area in {matrix.blockName} {'·'} {c.rowCount} {c.rowCount === 1 ? 'row' : 'rows'}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Stop focusing ${area.name}`}
          onClick={() => onFocus(null)}
          className="text-gray-400 hover:text-white px-1 leading-none text-base"
        >
          {'×'}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onOpenArea(area)}
        className="self-start text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1"
      >
        Show in table
      </button>

      <section className="flex flex-col gap-1">
        <h4 className="text-[11px] uppercase tracking-wide text-gray-400">Contents</h4>
        <p>{c.subFactories.length === 0 ? 'No sub-factories.' : `Sub-factories: ${c.subFactories.join(', ')}.`}</p>
        {c.nestedAreas.length > 0 && <p>Areas inside: {c.nestedAreas.join(', ')}.</p>}
        <p>{rowsText}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="text-[11px] uppercase tracking-wide text-gray-400">Trades with</h4>
        {trades.length === 0 ? (
          <p className="text-gray-500">No trades.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {trades.map(t => {
              const parts = [
                `${t.items} ${t.items === 1 ? 'item' : 'items'}`,
                t.inRate > 0 ? `${fmtAmount(t.inRate, rateUnit)}${unit} in` : '',
                t.outRate > 0 ? `${fmtAmount(t.outRate, rateUnit)} out` : '',
              ].filter(Boolean)
              const detail = parts.join(` ${'·'} `)
              if (t.partyId === OUTSIDE) {
                return (
                  <li key={t.partyId} className="rounded border border-gray-700 px-2 py-1">
                    <div className="text-gray-200">Outside the block</div>
                    <div className="text-[11px] text-gray-400">{detail}</div>
                  </li>
                )
              }
              const other = areaById.get(t.partyId)
              return (
                <li key={t.partyId}>
                  <button
                    type="button"
                    onClick={() => onFocus(t.partyId)}
                    className="w-full text-left rounded border border-gray-700 hover:border-gray-400 px-2 py-1"
                  >
                    <div className="text-gray-200">{other?.name ?? t.partyId}</div>
                    <div className="text-[11px] text-gray-400">{detail}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-gray-500">
        Counterpart cells read {'“'}13.8 {'→'}{'”'}: the part of that area{'’'}s output allocated to the focused area.
      </p>
    </aside>
  )
}
