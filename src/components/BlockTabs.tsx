import { useState, useRef, useEffect } from 'react'
import { useBlockStore } from '../store/blockStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'

// ---------------------------------------------------------------------------
// Icon URL helper
// ---------------------------------------------------------------------------

import { Icon } from './Icon'
import { withAlpha, BLOCK_PALETTE } from '../data/blockColors'

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
  const duplicateBlock = useBlockStore(s => s.duplicateBlock)
  const setBlockColor = useBlockStore(s => s.setBlockColor)
  const currentColor = blocks.find(b => b.id === blockId)?.color.toLowerCase()
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

  function handleDuplicate() {
    duplicateBlock(blockId)
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
      role="menu"
      className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-28"
    >
      <button
        role="menuitem"
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        onClick={handleRename}
      >
        Rename
      </button>
      <button
        role="menuitem"
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        onClick={handleDuplicate}
      >
        Duplicate
      </button>
      <button
        role="menuitem"
        className="w-full text-left px-3 py-1 text-xs text-red-400 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleDelete}
        disabled={blocks.length <= 1}
      >
        Delete
      </button>
      <div role="separator" className="my-1 border-t border-gray-700" />
      <div className="text-[10px] text-gray-500 px-3 pb-1">Colour</div>
      <div role="group" aria-label="Block colour" className="grid grid-cols-8 gap-1 px-3 pb-1.5">
        {BLOCK_PALETTE.map(c => (
          <button
            key={c}
            role="menuitemradio"
            aria-checked={c === currentColor}
            aria-label={`Colour ${c}`}
            title={c}
            data-testid="block-color-swatch"
            data-color={c}
            className={`w-4 h-4 rounded-sm ${c === currentColor ? 'ring-2 ring-gray-100' : 'hover:ring-1 hover:ring-gray-400'}`}
            style={{ background: c }}
            onClick={() => { setBlockColor(blockId, c); onClose() }}
          />
        ))}
      </div>
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
  disabled: boolean
}

function BlockTab({ blockId, isActive, onClick, disabled }: BlockTabProps) {
  const block = useBlockStore(s => s.blocks.find(b => b.id === blockId))
  const gameData = useGameDataStore(selectGameData)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!block) return null

  const firstGoal = block.goals[0]
  const firstItem = firstGoal ? gameData?.items[firstGoal.itemId] : undefined

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (!disabled) setMenuOpen(true)
  }

  return (
    <div className="relative min-w-0 flex">
      <button
        title={block.name}
        aria-current={isActive ? 'true' : undefined}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        disabled={disabled}
        className={`
          relative flex items-center gap-1.5 min-w-0 max-w-44 h-8 pl-2 pr-3 -mb-px rounded-t text-xs border border-b-0
          transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed
          ${isActive
            ? 'bg-gray-800 border-gray-700 text-gray-100'
            : 'border-transparent text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
          }
        `}
      >
        {/* Block colour as a stripe across the top, kept off the icon so the icon keeps its own colours */}
        <span
          aria-hidden="true"
          data-testid="block-tab-stripe"
          className={`absolute -left-px -right-px -top-px rounded-t ${isActive ? 'h-[3px]' : 'h-0.5'}`}
          style={{ background: isActive ? block.color : withAlpha(block.color, 0.55) }}
        />
        {/* Wrapped so Icon's <picture>/<source> count as one flex item, not an extra gap */}
        {firstItem && (
          <span className="flex shrink-0">
            <Icon
              iconPath={firstItem.iconPath}
              alt=""
              className="w-5 h-5 object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </span>
        )}
        <span className="truncate">{block.name}</span>
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
  // The plan on screen only belongs to the selected data set once its data has
  // loaded; until then the tabs are read-only so no edit lands in the wrong plan.
  const editable = useGameDataStore(s => s.status.type === 'loaded')

  return (
    <div className="self-stretch flex items-end gap-1 min-w-0">
      {blocks.map(block => (
        <BlockTab
          key={block.id}
          blockId={block.id}
          isActive={block.id === activeBlockId}
          onClick={() => setActiveBlock(block.id)}
          disabled={!editable}
        />
      ))}

      {/* Add block button */}
      <button
        title="Add block"
        onClick={addBlock}
        disabled={!editable}
        className="self-center shrink-0 w-7 h-7 ml-1 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors text-lg leading-none disabled:opacity-40 disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  )
}
