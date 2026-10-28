import { useMemo } from 'react'
import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { FLOW_TOLERANCE } from '../../solver/index'
import { Icon } from '../Icon'
import { groupRows, itemGroupMap, matchQuery, type RowMode } from './areaMatrix'
import { primaryAreas, type PlanMatrixBlock, type PlanMatrixRow } from './planAreaMatrix'
import { fmtAmount, fmtSigned, unitSuffix } from './matrixFormat'

// ---------------------------------------------------------------------------
// Every block as a column: what each block takes or leaves across its boundary, per item, next to
// what the connections actually carry.
// ---------------------------------------------------------------------------

export interface AllBlocksMatrixProps {
  model: { blocks: PlanMatrixBlock[]; rows: PlanMatrixRow[] }
  gameData: GameData
  rateUnit: RateUnit
  rowMode: RowMode
  query: string
  crossingOnly: boolean
  onCrossingOnly: (v: boolean) => void
  expandedBlocks: Set<string>
  onToggleBlock: (blockId: string) => void
  selectedItemId: string | null
  onSelectItem: (itemId: string) => void
  groupOverrides: Map<string, boolean>
  onToggleGroup: (groupId: string, open: boolean) => void
  openTails: Set<string>
  onToggleTail: (groupId: string) => void
}

const SEND = 'bg-sky-400/15 text-sky-300'
const RECEIVE = 'bg-orange-400/15 text-orange-300'
const BLOCK_EDGE = 'border-l border-gray-700'
const MANY_ROWS = 40

export function AllBlocksMatrix(props: AllBlocksMatrixProps) {
  const {
    model, gameData, rateUnit, rowMode, query, crossingOnly, onCrossingOnly, expandedBlocks, onToggleBlock,
    selectedItemId, onSelectItem, groupOverrides, onToggleGroup, openTails, onToggleTail,
  } = props
  const unit = unitSuffix(rateUnit)
  const groups = useMemo(() => itemGroupMap(gameData), [gameData])
  const blockName = useMemo(() => new Map(model.blocks.map(b => [b.blockId, b.name])), [model.blocks])

  const match = useMemo(
    () => matchQuery(
      query,
      model.rows,
      model.blocks.map(b => ({ id: b.blockId, names: [b.name, ...b.areas.map(a => a.name)] })),
      (r, blockId) => r.net[blockId] !== undefined || r.areaCells[blockId] !== undefined,
    ),
    [query, model],
  )
  const columns = useMemo(
    () => (match?.columnIds ? model.blocks.filter(b => match.columnIds!.has(b.blockId)) : model.blocks),
    [match, model.blocks],
  )
  const rows = useMemo(() => match?.rows ?? [], [match])
  const collapseTail = query.trim() === ''
  const grouped = useMemo(() => groupRows(rows, rowMode, groups, { collapseTail }), [rows, rowMode, groups, collapseTail])
  const grouping = rowMode === 'category'
  const showNotSupplied = rows.some(r => r.notSupplied > FLOW_TOLERANCE)
  const isExpanded = (b: PlanMatrixBlock) => b.areas.length > 0 && expandedBlocks.has(b.blockId)
  const colSpan = 1 + columns.reduce((n, b) => n + (isExpanded(b) ? b.areas.length + 1 : b.areas.length > 0 ? 2 : 1), 0) + 1 + (showNotSupplied ? 1 : 0)

  const selected = rows.find(r => r.itemId === selectedItemId)

  function areaCell(row: PlanMatrixRow, b: PlanMatrixBlock, areaId: string, edge: boolean) {
    const v = row.areaCells[b.blockId]?.[areaId] ?? 0
    return (
      <td
        key={`${b.blockId}:${areaId}`}
        data-col={`${b.blockId}:${areaId}`}
        data-rate={v}
        className={`${edge ? BLOCK_EDGE : ''} px-1 py-0.5 text-center font-mono tabular-nums border-b border-gray-800`}
      >
        {v !== 0 && <span className={`block mx-auto max-w-[5rem] rounded py-0.5 ${v > 0 ? SEND : RECEIVE}`}>{fmtSigned(v, rateUnit)}</span>}
      </td>
    )
  }

  function renderRow(row: PlanMatrixRow) {
    const item = gameData.items[row.itemId]
    const isSel = row.itemId === selectedItemId
    return (
      <tr key={row.itemId} data-item-id={row.itemId} className={isSel ? 'bg-teal-500/10' : 'hover:bg-gray-800/40'}>
        <th scope="row" className="sticky left-0 z-10 bg-gray-900 px-2 py-0.5 text-left font-normal border-b border-gray-800">
          <button
            type="button"
            aria-pressed={isSel}
            onClick={() => onSelectItem(row.itemId)}
            className={`flex items-center gap-2 min-w-0 w-full text-left ${isSel ? 'text-teal-200' : 'text-gray-200 hover:text-white'}`}
          >
            {item?.iconPath ? (
              <Icon iconPath={item.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" />
            ) : (
              <span aria-hidden className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate" title={row.name}>{row.name}</span>
          </button>
        </th>
        {columns.map(b => {
          const net = row.net[b.blockId] ?? 0
          const expanded = isExpanded(b)
          const prim = primaryAreas(row, b)
          const cells = []
          if (b.areas.length > 0 && !expanded) {
            cells.push(
              <td
                key={`${b.blockId}:areas`}
                data-col={`${b.blockId}:areas`}
                title={prim.map(p => `${p.name} ${fmtSigned(p.rate, rateUnit)}${unit}`).join(', ')}
                className={`${BLOCK_EDGE} px-1 py-0.5 text-center text-gray-300 border-b border-gray-800`}
              >
                {prim.length > 0 && (
                  <span className="block truncate max-w-[7rem] mx-auto">
                    {prim[0].name}{prim.length > 1 ? ` +${prim.length - 1}` : ''}
                  </span>
                )}
              </td>,
            )
          } else if (expanded) {
            b.areas.forEach((a, i) => cells.push(areaCell(row, b, a.areaId, i === 0)))
          }
          cells.push(
            <td
              key={`${b.blockId}:net`}
              data-col={`${b.blockId}:net`}
              data-rate={net}
              data-sign={net > 0 ? 'send' : net < 0 ? 'receive' : undefined}
              className={`${b.areas.length === 0 ? BLOCK_EDGE : ''} px-1 py-0.5 text-center font-mono tabular-nums border-b border-gray-800`}
            >
              {net !== 0 && <span className={`block mx-auto max-w-[5rem] rounded py-0.5 ${net > 0 ? SEND : RECEIVE}`}>{fmtSigned(net, rateUnit)}</span>}
            </td>,
          )
          return cells
        })}
        <td data-col="not-taken" data-rate={row.notTaken} className={`${BLOCK_EDGE} px-1 py-0.5 text-center font-mono tabular-nums text-gray-300 border-b border-gray-800`}>
          {row.notTaken > FLOW_TOLERANCE ? fmtAmount(row.notTaken, rateUnit) : ''}
        </td>
        {showNotSupplied && (
          <td data-col="not-supplied" data-rate={row.notSupplied} className="px-1 py-0.5 text-center font-mono tabular-nums text-gray-300 border-b border-gray-800">
            {row.notSupplied > FLOW_TOLERANCE ? fmtAmount(row.notSupplied, rateUnit) : ''}
          </td>
        )}
      </tr>
    )
  }

  const body = grouped.map((g, gi) => {
    const open = !grouping ? true : groupOverrides.get(g.id) ?? (rows.length <= MANY_ROWS || query.trim() !== '' || gi < 2)
    const tailOpen = openTails.has(g.id)
    const shownRows = open ? (tailOpen ? g.rows : g.head) : []
    return (
      <tbody key={g.id} data-group-id={g.id}>
        {grouping && (
          <tr className="bg-gray-800/60 font-semibold">
            <th scope="rowgroup" colSpan={colSpan} className="sticky left-0 z-10 bg-gray-800 px-2 py-1 text-left border-b border-gray-700">
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
  if (match === null) empty = `No block, area or item matches "${q}"`
  else if (model.rows.length === 0) {
    empty = crossingOnly ? 'No item crosses a block boundary.' : 'No item moves in or out of a block.'
  } else if (rows.length === 0) empty = 'Nothing to show for these blocks.'

  const sub = 'px-1 py-1 text-[11px] uppercase tracking-wide text-gray-400 font-normal border-b border-gray-700'

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <label className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300">
        <input type="checkbox" checked={crossingOnly} onChange={e => onCrossingOnly(e.target.checked)} />
        Only items that cross a block boundary
      </label>
      {empty !== null ? (
        <p className="px-3 pb-3 text-sm text-gray-400">{empty}</p>
      ) : (
        <table aria-label="Items across blocks" className="table-fixed border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th rowSpan={2} scope="col" className="sticky left-0 z-30 bg-gray-900 w-56 px-2 py-2 text-left border-b border-gray-700">
                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">
                  {rows.length} {rows.length === 1 ? 'item' : 'items'}
                </span>
              </th>
              {columns.map(b => {
                const expanded = isExpanded(b)
                const span = expanded ? b.areas.length + 1 : b.areas.length > 0 ? 2 : 1
                return (
                  <th key={b.blockId} scope="colgroup" colSpan={span} className={`${BLOCK_EDGE} px-2 py-1.5 text-left border-b border-gray-700`}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                      {b.areas.length > 0 ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => onToggleBlock(b.blockId)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-gray-200 hover:text-white"
                        >
                          {b.name}
                          <span aria-hidden className="text-[10px] text-gray-400">{expanded ? '▾' : '▸'}</span>
                          <span className="font-normal text-gray-400">{b.areas.length} {b.areas.length === 1 ? 'area' : 'areas'}</span>
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-gray-200">
                          {b.name} <span className="font-normal text-gray-400">{'·'} no areas</span>
                        </span>
                      )}
                    </span>
                  </th>
                )
              })}
              <th scope="col" rowSpan={2} className={`${BLOCK_EDGE} w-24 px-1 py-2 border-b border-gray-700`}>
                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">Not taken</span>
              </th>
              {showNotSupplied && (
                <th scope="col" rowSpan={2} className="w-24 px-1 py-2 border-b border-gray-700">
                  <span className="text-[11px] uppercase tracking-wide text-gray-400 font-normal">Not supplied</span>
                </th>
              )}
            </tr>
            <tr>
              {columns.flatMap(b => {
                const expanded = isExpanded(b)
                const heads = []
                if (b.areas.length > 0 && !expanded) {
                  heads.push(<th key={`${b.blockId}:areas`} scope="col" className={`${BLOCK_EDGE} w-28 ${sub}`}>Areas</th>)
                } else if (expanded) {
                  b.areas.forEach((a, i) =>
                    heads.push(
                      <th key={`${b.blockId}:${a.areaId}`} scope="col" className={`${i === 0 ? BLOCK_EDGE : ''} w-[5.5rem] truncate ${sub}`} title={a.name}>
                        {a.name}
                      </th>,
                    ),
                  )
                }
                heads.push(
                  <th key={`${b.blockId}:net`} scope="col" className={`${b.areas.length === 0 ? BLOCK_EDGE : ''} w-20 ${sub}`}>Net</th>,
                )
                return heads
              })}
            </tr>
          </thead>
          {body}
        </table>
      )}
      {selected && (
        <Inspector row={selected} blockName={blockName} blocks={model.blocks} rateUnit={rateUnit} />
      )}
    </div>
  )
}

function Inspector({ row, blockName, blocks, rateUnit }: {
  row: PlanMatrixRow
  blockName: Map<string, string>
  blocks: PlanMatrixBlock[]
  rateUnit: RateUnit
}) {
  const unit = unitSuffix(rateUnit)
  const name = (id: string) => blockName.get(id) ?? id
  return (
    <section aria-label={`${row.name} across blocks`} className="m-3 rounded border border-gray-700 p-3 text-xs text-gray-300 flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-gray-100">{row.name} across blocks</h3>
      {blocks.map(b => {
        const net = row.net[b.blockId] ?? 0
        if (net === 0) return null
        const areas = primaryAreas(row, b).map(p => p.name).join(', ')
        return (
          <p key={b.blockId}>
            {b.name}{areas ? ` · ${areas}` : ''} {fmtSigned(net, rateUnit)}{unit}{' '}
            {net > 0 ? 'leaves the block' : 'enters the block'}
          </p>
        )
      })}
      {row.flows.map(f => (
        <p key={f.connectionId}>
          {name(f.fromBlockId)} {'→'} {name(f.toBlockId)}: {fmtAmount(f.rate, rateUnit)}{unit}{f.status === 'limited' ? ' (limited)' : ''}
        </p>
      ))}
      {row.notTaken > FLOW_TOLERANCE && (
        <p className="text-gray-400">
          {fmtAmount(row.notTaken, rateUnit)}{unit} is not taken by any block (extra output, byproduct or surplus).
        </p>
      )}
      {row.notSupplied > FLOW_TOLERANCE && (
        <p className="text-gray-400">
          {fmtAmount(row.notSupplied, rateUnit)}{unit} is not supplied by any block: it is imported.
        </p>
      )}
    </section>
  )
}
