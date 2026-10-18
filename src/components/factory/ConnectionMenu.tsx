import { useEffect, useRef } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { sourceCandidates } from '../../store/connections'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import type { BlockConnection, ConnectionFlow, Item } from '../../data/types'

// ---------------------------------------------------------------------------
// ConnectionMenu — pick the block that supplies an item to the active block
// ---------------------------------------------------------------------------

interface ConnectionMenuProps {
  itemId: string
  onClose: () => void
}

export function ConnectionMenu({ itemId, onClose }: ConnectionMenuProps) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const addInputConnection = useBlockStore(s => s.addInputConnection)
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
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const itemName = gameData?.items[itemId]?.name ?? itemId
  const unit = rateUnit === 'min' ? '/m' : '/s'

  const candidates = sourceCandidates(blocks, activeBlockId, itemId, results, flows)

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-40"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
        Receive {itemName} from
      </div>
      {candidates.length === 0 ? (
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
      )}
    </div>
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
  onRemove: () => void
}

export function ConnectionChip({
  connection,
  flow,
  item,
  sourceName,
  neededPerMin,
  onSelectSource,
  onRemove,
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
    title = `${itemName} — the source block was deleted; remove this connection`
  } else if (status === 'cycle') {
    label = `← ${sourceName ?? ''} (cycle, ignored)`
    tone = 'bg-gray-800 text-gray-500 border-gray-700'
    title = `${itemName} — ignored because the connection forms a cycle`
  }
  const sourceGone = status === 'missing-source'

  return (
    <span
      data-testid="connection-chip"
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${tone}`}
    >
      {item?.iconPath ? (
        <Icon iconPath={item.iconPath} alt={itemName} className="w-5 h-5 object-contain shrink-0" />
      ) : (
        <span className="text-[10px] truncate max-w-[4rem]">{itemName}</span>
      )}
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {fmt(rate)}/{fmt(neededPerMin)}
        <span className="opacity-60">{unit}</span>
      </span>
      {sourceGone ? (
        <span className="text-[10px]">{label}</span>
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
      <button
        type="button"
        onClick={onRemove}
        title="Remove connection"
        className="text-xs leading-none opacity-60 hover:opacity-100 hover:text-red-400"
      >
        ×
      </button>
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
}

export function ExportChip({ flow, item, consumerName, onSelectConsumer }: ExportChipProps) {
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
      {item?.iconPath && (
        <Icon iconPath={item.iconPath} alt={item.name} className="w-4 h-4 object-contain shrink-0" />
      )}
      <span className="text-[10px]">{consumerName}</span>
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {fmtRate(flow.rate / 60, rateUnit)}
        <span className="opacity-60">{unit}</span>
      </span>
    </button>
  )
}
