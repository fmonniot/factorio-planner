import { useState, useRef, useEffect } from 'react'
import { useBlockStore, selectActiveBlock } from '../store/blockStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'

// ---------------------------------------------------------------------------
// Icon URL helper
// ---------------------------------------------------------------------------

import { Icon } from './Icon'

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  blockId: string
  onClose: () => void
}

function BlockContextMenu({ blockId, onClose }: ContextMenuProps) {
  const blocks = useBlockStore(s => s.blocks)
  const renameBlock = useBlockStore(s => s.renameBlock)
  const removeBlock = useBlockStore(s => s.removeBlock)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  function handleRename() {
    const block = blocks.find(b => b.id === blockId)
    const name = window.prompt('Block name:', block?.name ?? '')
    if (name !== null && name.trim()) renameBlock(blockId, name.trim())
    onClose()
  }

  function handleDelete() {
    if (blocks.length <= 1) { onClose(); return }
    removeBlock(blockId)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-28"
    >
      <button
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        onClick={handleRename}
      >
        Rename
      </button>
      <button
        className="w-full text-left px-3 py-1 text-xs text-red-400 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleDelete}
        disabled={blocks.length <= 1}
      >
        Delete
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single tab
// ---------------------------------------------------------------------------

interface BlockTabProps {
  blockId: string
  isActive: boolean
  onClick: () => void
}

function BlockTab({ blockId, isActive, onClick }: BlockTabProps) {
  const block = useBlockStore(s => s.blocks.find(b => b.id === blockId))
  const gameData = useGameDataStore(selectGameData)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!block) return null

  const firstGoal = block.goals[0]
  const firstItem = firstGoal ? gameData?.items[firstGoal.itemId] : undefined

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenuOpen(true)
  }

  return (
    <div className="relative">
      <button
        title={block.name}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={`
          w-9 h-9 rounded flex items-center justify-center text-sm font-bold
          transition-colors select-none
          ${isActive
            ? 'bg-gray-700 ring-2 ring-blue-500 text-gray-100'
            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
          }
        `}
      >
        {firstItem ? (
          <Icon
            iconPath={firstItem.iconPath}
            alt={firstItem.name}
            className="w-6 h-6 object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <span className="text-gray-500">?</span>
        )}
      </button>

      {menuOpen && (
        <BlockContextMenu blockId={blockId} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Block tabs bar
// ---------------------------------------------------------------------------

export function BlockTabs() {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const addBlock = useBlockStore(s => s.addBlock)
  const activeBlock = useBlockStore(selectActiveBlock)

  return (
    <div className="h-10 bg-gray-900 border-b border-gray-700 flex items-center gap-1 px-3 shrink-0">
      {blocks.map(block => (
        <BlockTab
          key={block.id}
          blockId={block.id}
          isActive={block.id === activeBlockId}
          onClick={() => setActiveBlock(block.id)}
        />
      ))}

      {/* Add block button */}
      <button
        title="Add block"
        onClick={addBlock}
        className="w-9 h-9 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors text-lg leading-none"
      >
        +
      </button>

      {/* Active block name label */}
      {activeBlock && (
        <span className="ml-2 text-xs text-gray-500 truncate max-w-32">
          {activeBlock.name}
        </span>
      )}
    </div>
  )
}
