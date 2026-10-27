import { useMemo, useState } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { Modal } from '../Modal'
import { IconButton } from '../IconButton'
import { AreasIcon } from '../icons'
import { AreaListItem } from './AreaFlow'
import { filterPlanAreas, planAreaBlocks, type PlanAreaRow } from './planAreaList'
import type { GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Areas in every block — the plan-level list. Read-only: it lists what each area receives and
// sends, and jumps to the area's row in its block's table.
// ---------------------------------------------------------------------------

export function PlanAreasModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const results = useSolverStore(selectBlockResults)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setTableView = useUiStore(s => s.setTableView)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)

  const [query, setQuery] = useState('')
  // Shared by every block: selecting hydrogen lights it up everywhere.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const select = (itemId: string) => setSelectedItemId(cur => (cur === itemId ? null : itemId))

  const all = useMemo(() => planAreaBlocks(blocks, results), [blocks, results])
  const shown = useMemo(() => filterPlanAreas(all, query, gameData.items), [all, query, gameData.items])
  const areaCount = all.reduce((n, b) => n + b.rows.length, 0)
  const withoutAreas = blocks.length - all.length

  function openBlock(blockId: string) {
    setActiveBlock(blockId)
    onClose()
  }

  // The block switch comes first: the reveal request is resolved against the active block's plan.
  function openArea(row: PlanAreaRow) {
    setActiveBlock(row.blockId)
    if (row.handleNodeId !== undefined) {
      setTableView('tree')
      requestRevealRow(row.handleNodeId)
    }
    onClose()
  }

  const btn = 'text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1'

  return (
    <Modal onClose={onClose} className="w-[min(60rem,96vw)] max-h-[88vh] flex flex-col">
      <div className="p-3 border-b border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-amber-200">Areas</h2>
        <span className="text-xs text-gray-400">
          {areaCount} {areaCount === 1 ? 'area' : 'areas'} in {all.length} {all.length === 1 ? 'block' : 'blocks'}
        </span>
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

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {shown.length === 0 && query.trim() !== '' && (
          <p className="text-sm text-gray-400">No area matches "{query.trim()}"</p>
        )}
        {shown.map(block => (
          <section key={block.blockId} aria-label={block.blockName} className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-sm">
              <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: block.color }} />
              <button
                type="button"
                title={`Open ${block.blockName}`}
                onClick={() => openBlock(block.blockId)}
                className="font-semibold text-gray-200 hover:text-white hover:underline"
              >
                {block.blockName}
              </button>
            </h3>
            <ul className="flex flex-col gap-1 pl-4">
              {block.rows.map(row => (
                <AreaListItem
                  key={row.areaId}
                  row={row}
                  items={gameData.items}
                  rateUnit={rateUnit}
                  selectedItemId={selectedItemId}
                  onSelect={select}
                  onOpen={() => openArea(row)}
                  openTitle={`Show ${row.name} in ${block.blockName}`}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {withoutAreas > 0 && (
        <p className="px-3 py-2 border-t border-gray-700 text-xs text-gray-500">
          {withoutAreas} {withoutAreas === 1 ? 'block' : 'blocks'} without areas not listed
        </p>
      )}
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
