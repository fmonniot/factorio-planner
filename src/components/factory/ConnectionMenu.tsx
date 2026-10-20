import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { sourceCandidates, isGoalItem } from '../../store/connections'
import { fmtRate } from './ItemTile'

// ---------------------------------------------------------------------------
// ConnectionMenu — pick the block that supplies an item to the active block
// (non-goal items only), and forbid or allow imports of the item.
// ---------------------------------------------------------------------------

interface ConnectionMenuProps {
  itemId: string
  /** Viewport coordinates of the menu's top-left corner (the bottom-left of the clicked tile). */
  x: number
  y: number
  onClose: () => void
}

export function ConnectionMenu({ itemId, x, y, onClose }: ConnectionMenuProps) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const addInputConnection = useBlockStore(s => s.addInputConnection)
  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const results = useSolverStore(selectBlockResults)
  const flows = useSolverStore(selectFlows)
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const ref = useRef<HTMLDivElement>(null)

  // Keep the latest onClose in a ref so the document listeners bind once.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Mark the key as handled (capture phase, before the pane's listener) so it does not also clear a selection.
      e.preventDefault()
      onCloseRef.current()
    }
    // A fixed menu would float away from its tile, so close on scroll.
    function handleScroll() {
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  const itemName = gameData?.items[itemId]?.name ?? itemId
  const unit = rateUnit === 'min' ? '/m' : '/s'

  const activeBlock = blocks.find(b => b.id === activeBlockId)
  const locked = activeBlock?.noImportItems.includes(itemId) ?? false
  // A goal shortfall cannot be fed by a connection (goals never receive supply).
  const connectable = activeBlock ? !isGoalItem(activeBlock, itemId) : false

  const candidates = sourceCandidates(blocks, activeBlockId, itemId, results, flows)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed mt-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-40"
    >
      {connectable && (
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
          Receive {itemName} from
        </div>
      )}
      {connectable && (candidates.length === 0 ? (
        <div className="px-3 py-1 text-xs text-gray-500 cursor-default">
          No other block produces this item
        </div>
      ) : (
        candidates.map(({ block, offered }) => (
          <button
            key={block.id}
            type="button"
            role="menuitem"
            className="w-full flex items-center justify-between gap-3 text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
            onClick={() => {
              addInputConnection(itemId, block.id)
              onClose()
            }}
          >
            <span>{block.name}</span>
            <span className="font-mono tabular-nums text-gray-500">
              {fmtRate(offered / 60, rateUnit)}{unit}
            </span>
          </button>
        ))
      ))}
      {connectable && <div className="border-t border-gray-700 my-1" />}
      <button
        type="button"
        role="menuitem"
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        onClick={() => {
          toggleNoImportItem(itemId)
          onClose()
        }}
      >
        {locked ? 'Allow imports' : 'Forbid imports'}
      </button>
    </div>,
    document.body,
  )
}
