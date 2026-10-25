import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { takeCandidates, requestCandidates, requestBlockerTitle } from '../../store/connections'
import { hasProduct } from '../../solver/blockGraph'
import { fmtRate } from './ItemTile'

// ---------------------------------------------------------------------------
// ConnectionMenu — pick the block that supplies an item to the active block
// (not for its own products): Request from a block that has the item as a product
// (it makes what this block needs), or Take existing output from a block that has
// some to spare. Also forbids or allows imports of the item.
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
  // A product shortfall cannot be fed by a connection (products never receive supply).
  const connectable = activeBlock ? !hasProduct(activeBlock, itemId) : false

  const requests = connectable ? requestCandidates(blocks, activeBlockId, itemId) : []
  const takes = connectable ? takeCandidates(blocks, activeBlockId, itemId, results, flows) : []

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed mt-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-40"
    >
      {requests.length > 0 && (
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
          Request {itemName} from
        </div>
      )}
      {requests.map(({ block, closesLoop, blocker }) => (
        <button
          key={block.id}
          type="button"
          role="menuitem"
          data-kind="request"
          data-closes-loop={closesLoop ? 'true' : undefined}
          disabled={!!blocker}
          title={blocker
            ? requestBlockerTitle(blocker, block.name, itemName)
            : closesLoop
              ? `Closes a loop: ${block.name} already receives from this block, directly or through other blocks`
              : `${block.name} makes what this block needs`}
          className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => {
            addInputConnection(itemId, block.id)
            onClose()
          }}
        >
          {block.name}
          {closesLoop && <span aria-hidden> ↻</span>}
        </button>
      ))}
      {connectable && requests.length > 0 && takes.length > 0 && <div className="border-t border-gray-700 my-1" />}
      {connectable && (takes.length > 0 || requests.length === 0) && (
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
          Take existing {itemName} from
        </div>
      )}
      {connectable && requests.length === 0 && takes.length === 0 && (
        <div className="px-3 py-1 text-xs text-gray-500 cursor-default">
          No other block has this item to spare
        </div>
      )}
      {takes.map(({ block, offered, closesLoop }) => (
        <button
          key={block.id}
          type="button"
          role="menuitem"
          data-kind="take"
          data-closes-loop={closesLoop ? 'true' : undefined}
          title={closesLoop
            ? `Closes a loop: ${block.name} already receives from this block, directly or through other blocks`
            : undefined}
          className="w-full flex items-center justify-between gap-3 text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
          onClick={() => {
            addInputConnection(itemId, block.id)
            onClose()
          }}
        >
          <span>
            {block.name}
            {closesLoop && <span aria-hidden> ↻</span>}
          </span>
          <span className="font-mono tabular-nums text-gray-500">
            {fmtRate(offered / 60, rateUnit)}{unit}
          </span>
        </button>
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
