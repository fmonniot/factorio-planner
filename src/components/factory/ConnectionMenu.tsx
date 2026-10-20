import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { sourceCandidates, isGoalItem } from '../../store/connections'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import type { BlockConnection, ConnectionFlow, Item } from '../../data/types'

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
      if (e.key === 'Escape') onCloseRef.current()
    }
    // A fixed menu would float away from its tile, so close on scroll.
    function handleScroll() {
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
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

// ---------------------------------------------------------------------------
// ConnectionChip — an item this block receives from another block
// ---------------------------------------------------------------------------

interface ConnectionChipProps {
  connection: BlockConnection
  /** Delivery computed by the last solve; undefined until the first solve lands. */
  flow: ConnectionFlow | undefined
  item: Item | undefined
  /** Name of the source block; undefined when that block no longer exists. */
  sourceName: string | undefined
  /** items/min the block needs of this item in total (delivered plus still imported). */
  neededPerMin: number
  onSelectSource: () => void
  onContextMenu: React.MouseEventHandler<HTMLSpanElement>
  /** Show the item icon (or name); false when the row's lead tile already shows it. Default true. */
  showIcon?: boolean
}

export function ConnectionChip({
  connection,
  flow,
  item,
  sourceName,
  neededPerMin,
  onSelectSource,
  onContextMenu,
  showIcon = true,
}: ConnectionChipProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)

  const status = flow?.status ?? (sourceName === undefined ? 'missing-source' : undefined)
  const rate = flow?.rate ?? 0
  const itemName = item?.name ?? connection.itemId

  let label = `← ${sourceName ?? ''}`
  let title = `${itemName} from ${sourceName ?? '?'}`
  let tone = 'bg-green-950 text-green-300 border-green-600'
  if (status === 'limited') {
    tone = 'bg-green-950 text-green-300 border-amber-500'
    title = `Limited: ${sourceName} only offers ${fmt(flow?.available ?? 0)}${unit}`
  } else if (status === 'unused') {
    tone = 'bg-green-950/40 text-green-300/50 border-green-900'
    title = 'Not used: this block makes or needs none from outside'
  } else if (status === 'missing-source') {
    label = '(deleted block)'
    tone = 'bg-gray-800 text-gray-500 border-gray-700'
    title = `${itemName} — the source block was deleted; right-click to remove this connection`
  } else if (status === 'cycle') {
    label = `← ${sourceName ?? ''} (cycle, ignored)`
    tone = 'bg-gray-800 text-gray-500 border-gray-700'
    title = `${itemName} — ignored because the connection forms a cycle`
  }
  if (status !== 'missing-source') title += ' — right-click to remove'
  const sourceGone = status === 'missing-source'

  return (
    <span
      data-testid="connection-chip"
      title={title}
      onContextMenu={onContextMenu}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${tone}`}
    >
      {showIcon && (item?.iconPath ? (
        <Icon iconPath={item.iconPath} alt={itemName} className="w-5 h-5 object-contain shrink-0" />
      ) : (
        <span className="text-[10px] truncate max-w-[4rem]">{itemName}</span>
      ))}
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {fmt(rate)}/{fmt(neededPerMin)}
        <span className="opacity-60">{unit}</span>
      </span>
      {sourceGone ? (
        <span tabIndex={0} className="text-[10px] rounded focus:outline focus:outline-1 focus:outline-gray-400">{label}</span>
      ) : (
        <button
          type="button"
          onClick={onSelectSource}
          title={`Go to ${sourceName}`}
          className="text-[10px] hover:underline"
        >
          {label}
        </button>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ExportChip — what this block sends to another block
// ---------------------------------------------------------------------------

interface ExportChipProps {
  flow: ConnectionFlow
  item: Item | undefined
  consumerName: string
  onSelectConsumer: () => void
  /** Show the item icon; false when the row's lead tile already shows it. Default true. */
  showIcon?: boolean
}

export function ExportChip({ flow, item, consumerName, onSelectConsumer, showIcon = true }: ExportChipProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const unit = rateUnit === 'min' ? '/m' : '/s'

  return (
    <button
      type="button"
      data-testid="export-chip"
      onClick={onSelectConsumer}
      title={`Sends ${item?.name ?? flow.itemId} to ${consumerName} — click to open`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-500"
    >
      <span className="text-[10px]">→</span>
      {showIcon && item?.iconPath && (
        <Icon iconPath={item.iconPath} alt={item.name} className="w-4 h-4 object-contain shrink-0" />
      )}
      <span className="text-[10px] truncate max-w-[8rem]">{consumerName}</span>
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {fmtRate(flow.rate / 60, rateUnit)}
        <span className="opacity-60">{unit}</span>
      </span>
    </button>
  )
}
