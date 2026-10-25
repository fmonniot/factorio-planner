import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore } from '../store/blockStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'

// ---------------------------------------------------------------------------
// Icon URL helper
// ---------------------------------------------------------------------------

import { Icon } from './Icon'
import { wheelDeltaPx } from '../utils/viewTransform'
import { withAlpha, BLOCK_PALETTE } from '../data/blockColors'
import { MenuButton, ITEM_CLASS } from './MenuButton'

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  blockId: string
  /** Bounding box of the tab the menu belongs to (viewport coordinates). */
  anchor: DOMRect
  onClose: () => void
}

function BlockContextMenu({ blockId, anchor, onClose }: ContextMenuProps) {
  const blocks = useBlockStore(s => s.blocks)
  const renameBlock = useBlockStore(s => s.renameBlock)
  const removeBlock = useBlockStore(s => s.removeBlock)
  const duplicateBlock = useBlockStore(s => s.duplicateBlock)
  const moveBlock = useBlockStore(s => s.moveBlock)
  const setBlockColor = useBlockStore(s => s.setBlockColor)
  const currentColor = useBlockStore(s => s.blocks.find(b => b.id === blockId)?.color)?.toLowerCase()
  const index = blocks.findIndex(b => b.id === blockId)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: anchor.left, y: anchor.bottom + 4 })

  // Keep the latest onClose in a ref so the document listeners bind once.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // The menu is fixed (the tab strip would clip an absolute one); shift it back into the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(anchor.left, window.innerWidth - width)),
      y: Math.max(0, Math.min(anchor.bottom + 4, window.innerHeight - height)),
    })
  }, [anchor])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Mark the key as handled (capture phase) so it does not also reach other Escape handlers.
      e.preventDefault()
      onCloseRef.current()
    }
    // A fixed menu would float away from its tab, so close on scroll and focus loss.
    function handleDismiss() {
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleDismiss)
    window.addEventListener('scroll', handleDismiss, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleDismiss)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [])

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

  function handleMove(toIndex: number) {
    moveBlock(blockId, toIndex)
    onClose()
  }

  function handleDelete() {
    if (blocks.length <= 1) { onClose(); return }
    removeBlock(blockId)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Synthetic events bubble through the portal to the tab; keep them from reaching its handlers.
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-28"
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
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => handleMove(index - 1)}
        disabled={index <= 0}
      >
        Move left
      </button>
      <button
        role="menuitem"
        className="w-full text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => handleMove(index + 2)}
        disabled={index < 0 || index >= blocks.length - 1}
      >
        Move right
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
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Single tab
// ---------------------------------------------------------------------------

const DRAG_TYPE = 'application/x-block-tab'

interface BlockTabProps {
  blockId: string
  index: number
  isActive: boolean
  onClick: () => void
  disabled: boolean
  /** Id of the tab being dragged, or null when no tab drag is in progress. */
  dragging: string | null
  onDragStart: (blockId: string) => void
  onDragEnd: () => void
  /** Insertion index (0..length) the dragged tab was dropped at. */
  onDrop: (toIndex: number) => void
}

function BlockTab({ blockId, index, isActive, onClick, disabled, dragging, onDragStart, onDragEnd, onDrop }: BlockTabProps) {
  const block = useBlockStore(s => s.blocks.find(b => b.id === blockId))
  const gameData = useGameDataStore(selectGameData)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  if (!block) return null

  const firstGoal = block.products[0]
  const firstItem = firstGoal ? gameData?.items[firstGoal.itemId] : undefined

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (!disabled && wrapperRef.current) setMenuAnchor(wrapperRef.current.getBoundingClientRect())
  }

  function handleDragStart(e: React.DragEvent) {
    if (disabled) return
    e.dataTransfer.setData(DRAG_TYPE, blockId)
    e.dataTransfer.effectAllowed = 'move'
    setMenuAnchor(null)
    onDragStart(blockId)
  }

  /** Which half of this tab the pointer is over, or null when a drop here would not move anything. */
  function computeSide(e: React.DragEvent): 'before' | 'after' | null {
    if (disabled || dragging === null) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    const toIndex = side === 'before' ? index : index + 1
    const blocks = useBlockStore.getState().blocks
    const from = blocks.findIndex(b => b.id === dragging)
    if (from < 0 || toIndex === from || toIndex === from + 1) return null
    return side
  }

  function handleDragOver(e: React.DragEvent) {
    const side = computeSide(e)
    if (side) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
    setDropSide(side)
  }

  function handleDragLeave(e: React.DragEvent) {
    // dragleave bubbles from child elements; only clear when the pointer leaves the tab itself.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDropSide(null)
  }

  function handleDrop(e: React.DragEvent) {
    const side = computeSide(e)
    setDropSide(null)
    if (!side) return
    e.preventDefault()
    onDrop(side === 'before' ? index : index + 1)
  }

  const dropLine = dropSide && (
    <span
      aria-hidden="true"
      data-testid="block-tab-drop-line"
      data-side={dropSide}
      className={`absolute top-0 bottom-0 w-0.5 bg-blue-500 pointer-events-none ${dropSide === 'before' ? '-left-1' : '-right-1'}`}
    />
  )

  return (
    <div
      ref={wrapperRef}
      data-testid="block-tab"
      data-block-id={blockId}
      draggable={!disabled}
      onDragStart={handleDragStart}
      onDragEnd={() => { setDropSide(null); onDragEnd() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative min-w-24 shrink-0 flex ${dragging === blockId ? 'opacity-50' : ''}`}
    >
      <button
        title={block.name}
        aria-current={isActive ? 'true' : undefined}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        disabled={disabled}
        className={`
          relative flex items-center gap-1.5 min-w-0 max-w-44 flex-1 h-8 pl-2 pr-3 rounded-t text-xs border border-b-0
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
        {firstItem && (
          <Icon
            iconPath={firstItem.iconPath}
            alt=""
            draggable={false}
            className="w-5 h-5 object-contain shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <span className="truncate">{block.name}</span>
      </button>
      {dropLine}

      {menuAnchor && (
        <BlockContextMenu blockId={blockId} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overflow detection
// ---------------------------------------------------------------------------

/** Whether a horizontally scrolling box holds more than it shows. Attach `ref` to the box. */
function useHorizontalOverflow<T extends HTMLElement>(contentKey: string) {
  const ref = useRef<T>(null)
  const [overflowing, setOverflowing] = useState(false)

  function measure() {
    const el = ref.current
    if (!el) return
    const over = el.scrollWidth > el.clientWidth + 1
    setOverflowing(prev => (prev === over ? prev : over))
  }

  // Tab names and counts change the content without resizing the box, so re-measure when `contentKey` (names and count) changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [contentKey])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, overflowing }
}

// ---------------------------------------------------------------------------
// "All blocks" dropdown (shown while the strip overflows)
// ---------------------------------------------------------------------------

function BlockOverflowMenu({ editable }: { editable: boolean }) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const gameData = useGameDataStore(selectGameData)

  return (
    <MenuButton
      label=""
      ariaLabel="All blocks"
      title="All blocks"
      menuLabel="All blocks"
      align="right"
      disabled={!editable}
      triggerClassName="self-center shrink-0 h-7 px-1.5 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      panelClassName="max-h-[calc(100vh-4rem)] overflow-y-auto"
    >
      {close => blocks.map(b => {
        const goal = b.products[0]
        const firstItem = goal ? gameData?.items[goal.itemId] : undefined
        return (
          <button
            key={b.id}
            type="button"
            role="menuitemradio"
            aria-checked={b.id === activeBlockId}
            className={`${ITEM_CLASS} w-full max-w-64`}
            onClick={() => { setActiveBlock(b.id); close(true) }}
          >
            <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
            {firstItem && <Icon iconPath={firstItem.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" />}
            <span className="truncate">{b.name}</span>
          </button>
        )
      })}
    </MenuButton>
  )
}

// ---------------------------------------------------------------------------
// Block tabs bar
// ---------------------------------------------------------------------------

const EDGE_PX = 24
const EDGE_STEP_PX = 12

export function BlockTabs() {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const addBlock = useBlockStore(s => s.addBlock)
  const moveBlock = useBlockStore(s => s.moveBlock)
  // The plan on screen only belongs to the selected data set once its data has
  // loaded; until then the tabs are read-only so no edit lands in the wrong plan.
  const editable = useGameDataStore(s => s.status.type === 'loaded')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const { ref: scrollerRef, overflowing } = useHorizontalOverflow<HTMLDivElement>(JSON.stringify(blocks.map(b => b.name)))

  // Keep the active tab visible when it changes, tabs are added, or tabs are reordered.
  const order = blocks.map(b => b.id).join(',')
  useEffect(() => {
    const tab = Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])
      .find(el => el.dataset.blockId === activeBlockId)
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeBlockId, order, scrollerRef])

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += wheelDeltaPx(e.deltaY, e.deltaMode)
  }

  // Scroll while a tab is dragged near either edge of the strip.
  function handleStripDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (draggingId === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left < EDGE_PX) e.currentTarget.scrollBy({ left: -EDGE_STEP_PX })
    else if (rect.right - e.clientX < EDGE_PX) e.currentTarget.scrollBy({ left: EDGE_STEP_PX })
  }

  return (
    <div className="self-stretch flex items-end gap-1 min-w-0">
      {/* -mb-px lets the active tab overlap the top bar's border; it sits on the scroller so the strip does not clip it */}
      <div
        ref={scrollerRef}
        data-testid="block-tab-strip"
        onWheel={handleWheel}
        onDragOver={handleStripDragOver}
        className="-mb-px self-stretch flex items-end gap-1 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {blocks.map((block, i) => (
          <BlockTab
            key={block.id}
            blockId={block.id}
            index={i}
            isActive={block.id === activeBlockId}
            onClick={() => setActiveBlock(block.id)}
            disabled={!editable}
            dragging={draggingId}
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
            onDrop={toIndex => {
              if (draggingId !== null) moveBlock(draggingId, toIndex)
              setDraggingId(null)
            }}
          />
        ))}
      </div>

      {overflowing && <BlockOverflowMenu editable={editable} />}

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
