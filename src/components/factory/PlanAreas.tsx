import { useMemo, useState } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { Modal } from '../Modal'
import { IconButton } from '../IconButton'
import { AreasIcon } from '../icons'
import { BlockAreaMatrix } from './BlockAreaMatrix'
import { AllBlocksMatrix } from './AllBlocksMatrix'
import { blockMatrix, machineItemIds, type ColumnMode, type MatrixArea, type RowMode } from './areaMatrix'
import { planMatrix } from './planAreaMatrix'
import type { GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Areas as a balance matrix: items as rows, areas as columns, the outside at both ends. One block
// at a time, or every block side by side. Read-only: it jumps to an area's row in its block's table.
// ---------------------------------------------------------------------------

const ALL = 'all'

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded border ${
        pressed ? 'border-teal-400 bg-teal-500/20 text-teal-200' : 'border-gray-600 text-gray-400 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  )
}

export function PlanAreasModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const results = useSolverStore(selectBlockResults)
  const flows = useSolverStore(selectFlows)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setTableView = useUiStore(s => s.setTableView)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)

  const withAreas = useMemo(() => blocks.filter(b => results[b.id]?.areas !== undefined), [blocks, results])
  const withoutAreas = blocks.length - withAreas.length

  const [tab, setTab] = useState<string>(() => {
    if (withAreas.some(b => b.id === activeBlockId)) return activeBlockId
    return withAreas[0]?.id ?? ALL
  })
  const [rowMode, setRowMode] = useState<RowMode>('category')
  const [columnMode, setColumnMode] = useState<ColumnMode>('flow')
  const [query, setQuery] = useState('')
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null)
  const [showAllAreas, setShowAllAreas] = useState(false)
  const [groupOverrides, setGroupOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [openTails, setOpenTails] = useState<Set<string>>(() => new Set())
  const [crossingOnly, setCrossingOnly] = useState(true)
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(() => new Set([activeBlockId]))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const machines = useMemo(() => machineItemIds(gameData), [gameData])
  const block = tab === ALL ? undefined : withAreas.find(b => b.id === tab)
  const matrix = useMemo(
    () => (block ? blockMatrix(block, results[block.id], gameData, machines) : undefined),
    [block, results, gameData, machines],
  )
  const plan = useMemo(
    () => (tab === ALL ? planMatrix(blocks, results, flows, gameData, machines, { crossingOnly }) : undefined),
    [tab, blocks, results, flows, gameData, machines, crossingOnly],
  )

  function selectTab(next: string) {
    setTab(next)
    setFocusedAreaId(null)
    setShowAllAreas(false)
    setSelectedItemId(null)
    setGroupOverrides(new Map())
    setOpenTails(new Set())
  }
  function focusArea(id: string | null) {
    setFocusedAreaId(id)
    setShowAllAreas(false)
  }
  const toggleGroup = (id: string, open: boolean) => setGroupOverrides(m => new Map(m).set(id, open))
  const toggleTail = (id: string) => setOpenTails(s => {
    const next = new Set(s)
    if (!next.delete(id)) next.add(id)
    return next
  })

  // The block switch comes first: the reveal request is resolved against the active block's plan.
  function openArea(area: MatrixArea) {
    if (!block) return
    setActiveBlock(block.id)
    if (area.handleNodeId !== undefined) {
      setTableView('tree')
      requestRevealRow(area.handleNodeId)
    }
    onClose()
  }

  const btn = 'text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1'

  return (
    <Modal onClose={onClose} className="w-[min(96rem,98vw)] h-[90vh] flex flex-col">
      <div className="p-3 border-b border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-amber-200">Areas</h2>
        <div role="group" aria-label="Block" className="flex flex-wrap items-center gap-1">
          {withAreas.map(b => (
            <button
              key={b.id}
              type="button"
              aria-pressed={tab === b.id}
              onClick={() => selectTab(b.id)}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${
                tab === b.id ? 'border-teal-400 bg-teal-500/20 text-teal-200' : 'border-gray-600 text-gray-300 hover:border-gray-400'
              }`}
            >
              <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
              {b.name}
              <span className="text-gray-400 font-mono">{results[b.id].areas!.length}</span>
            </button>
          ))}
          <Toggle pressed={tab === ALL} onClick={() => selectTab(ALL)}>All blocks</Toggle>
        </div>
        {withoutAreas > 0 && (
          <span className="text-xs text-gray-500">
            {withoutAreas} {withoutAreas === 1 ? 'block' : 'blocks'} without areas
          </span>
        )}
        <div role="group" aria-label="Rows" className="flex items-center gap-1">
          <Toggle pressed={rowMode === 'category'} onClick={() => setRowMode('category')}>By category</Toggle>
          <Toggle pressed={rowMode === 'rate'} onClick={() => setRowMode('rate')}>By rate</Toggle>
          <Toggle pressed={rowMode === 'name'} onClick={() => setRowMode('name')}>{'A\u2013Z'}</Toggle>
        </div>
        {tab !== ALL && (
          <div role="group" aria-label="Columns" className="flex items-center gap-1">
            <Toggle pressed={columnMode === 'flow'} onClick={() => setColumnMode('flow')}>Flow order</Toggle>
            <Toggle pressed={columnMode === 'table'} onClick={() => setColumnMode('table')}>Table order</Toggle>
          </div>
        )}
        <input
          type="text"
          aria-label="Filter areas"
          placeholder="Filter by area, block or item"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 min-w-[10rem] text-sm bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1"
        />
        <button type="button" onClick={onClose} className={btn}>Close</button>
      </div>

      {matrix && (
        <BlockAreaMatrix
          matrix={matrix}
          gameData={gameData}
          rateUnit={rateUnit}
          rowMode={rowMode}
          columnMode={columnMode}
          query={query}
          focusedAreaId={focusedAreaId}
          onFocus={focusArea}
          showAllAreas={showAllAreas}
          onShowAll={setShowAllAreas}
          groupOverrides={groupOverrides}
          onToggleGroup={toggleGroup}
          openTails={openTails}
          onToggleTail={toggleTail}
          onOpenArea={openArea}
        />
      )}
      {plan && (
        <AllBlocksMatrix
          model={plan}
          gameData={gameData}
          rateUnit={rateUnit}
          rowMode={rowMode}
          query={query}
          crossingOnly={crossingOnly}
          onCrossingOnly={setCrossingOnly}
          expandedBlocks={expandedBlocks}
          onToggleBlock={id => setExpandedBlocks(s => {
            const next = new Set(s)
            if (!next.delete(id)) next.add(id)
            return next
          })}
          selectedItemId={selectedItemId}
          onSelectItem={id => setSelectedItemId(cur => (cur === id ? null : id))}
          groupOverrides={groupOverrides}
          onToggleGroup={toggleGroup}
          openTails={openTails}
          onToggleTail={toggleTail}
        />
      )}
      {!matrix && !plan && <p className="p-4 text-sm text-gray-400">This block has no areas.</p>}

      <div className="px-3 py-2 border-t border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><i aria-hidden className="w-5 h-3 rounded-sm bg-sky-400/30 inline-block" />+ sends</span>
        <span className="flex items-center gap-1.5"><i aria-hidden className="w-5 h-3 rounded-sm bg-orange-400/30 inline-block" />{'\u2212'} receives</span>
        <span>
          Rates per {rateUnit === 'min' ? 'minute' : 'second'}.{' '}
          {tab === ALL
            ? 'Each block column is what the block takes or leaves across its boundary; Not taken and Not supplied are what the connections between blocks leave over.'
            : 'Each row balances: what areas send, plus what comes from outside, equals what areas receive plus what goes outside.'}
        </span>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// PlanAreasButton — top-bar entry point, only when some block has areas
// ---------------------------------------------------------------------------

export function PlanAreasButton() {
  const gameData = useGameDataStore(selectGameData)
  const anyAreas = useSolverStore(s => Object.values(s.lastResults).some(r => r.areas !== undefined))
  const [open, setOpen] = useState(false)

  if (!gameData || !anyAreas) return null

  return (
    <>
      <IconButton label="Areas in every block" onClick={() => setOpen(true)}>
        <AreasIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <PlanAreasModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
