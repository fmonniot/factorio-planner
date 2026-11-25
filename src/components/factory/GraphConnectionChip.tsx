import { CHIP_TONE, useConnectionDetail } from './graphConnection'
import { Icon } from '../Icon'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { fmtRate } from './ItemTile'
import { RateInput } from './RateInput'
import { BlockSourceRuleMarker } from './SourceRuleMarker'
import type { Block, ConnectionFlow, GameData } from '../../data/types'

// One connection as a chip: item, delivered rate, limit control and remove. Lives in the detail strip of a pinned edge.

export interface ConnectionChipProps {
  connectionId: string
  edge: { from: string; to: string }
  source: Block | undefined
  target: Block | undefined
  flow: ConnectionFlow | undefined
  items: GameData['items']
  gameData: GameData
  /** The items of the target block that have a source rule with an effect. */
  ruleItems: ReadonlySet<string>
  editing: boolean
  /** Spell the item name out after its icon (in the detail strip). */
  showName?: boolean
  onEdit: () => void
  onStopEdit: () => void
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

export function ConnectionChip({
  connectionId: id, edge, source, target, flow, items, gameData, ruleItems, editing, showName,
  onEdit, onStopEdit, onRemove, onSetLimit,
}: ConnectionChipProps) {
  const detail = useConnectionDetail({ connectionId: id, edge, source, target, flow, items })
  if (!detail) return null
  const { connection, item, itemName, status, rank, title, fmt, unitOf, sourceName, targetName } = detail

  return (
    <span
      data-testid="graph-edge-label"
      data-connection-id={id}
      data-status={status}
      data-loop={flow?.loop ? 'true' : undefined}
      data-kind={flow?.kind}
      data-request-ignored={flow?.requestIgnored}
      data-tip={title}
      style={status === 'ok' ? { borderColor: source?.color ?? MISSING_BLOCK_COLOR } : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border whitespace-nowrap ${CHIP_TONE[status]}`}
    >
      {flow?.loop && <span aria-hidden className="text-[10px] leading-none">↻</span>}
      {/* The rule is the target block's: the marker sits on the item, and its sentence is the item's in that block. */}
      <span className="relative inline-flex shrink-0">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt={showName ? '' : itemName} className="w-5 h-5 object-contain shrink-0" />
        ) : (
          <span className={`truncate ${showName ? 'text-[11px] max-w-[10rem]' : 'text-[10px] max-w-[4rem]'}`}>{itemName}</span>
        )}
        {target && ruleItems.has(connection.itemId) && (
          <span className="absolute -top-1 -right-1 flex">
            <BlockSourceRuleMarker
              block={target}
              itemId={connection.itemId}
              gameData={gameData}
            />
          </span>
        )}
      </span>
      {showName && item?.iconPath && <span className="text-[11px] truncate max-w-[10rem]">{itemName}</span>}
      {rank !== undefined && (
        <span data-testid="graph-edge-rank" className="text-[9px] font-mono tabular-nums leading-none opacity-80">
          #{rank}
        </span>
      )}
      {flow?.kind === 'take' && (
        <span data-testid="graph-edge-existing" className="text-[9px] uppercase tracking-wide leading-none opacity-70">
          existing
        </span>
      )}
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {flow ? fmt(flow.rate) : '—'}
      </span>
      {editing ? (
        <RateInput
          key={`${id}-${unitOf}`}
          initial={connection.maxRate !== undefined ? fmtRate(connection.maxRate / 60, unitOf) : ''}
          rateUnit={unitOf}
          ariaLabel="Connection limit"
          allowClear
          onCommit={perMin => onSetLimit(id, edge.to, perMin)}
          onStop={onStopEdit}
        />
      ) : (
        <button
          type="button"
          data-testid="graph-edge-limit"
          aria-label={`${connection.maxRate !== undefined ? 'Change limit of' : 'Limit'} ${itemName} from ${sourceName} to ${targetName}`}
          data-tip={`Connection limit\nMost ${targetName} takes over this connection.`}
          onClick={e => {
            e.stopPropagation()
            onEdit()
          }}
          className={`text-[10px] font-mono tabular-nums leading-none hover:text-yellow-300 ${connection.maxRate !== undefined ? '' : 'opacity-60 hover:opacity-100'}`}
        >
          ≤{connection.maxRate !== undefined && ` ${fmt(connection.maxRate)}`}
        </button>
      )}
      <button
        type="button"
        data-testid="graph-edge-remove"
        aria-label={`Remove ${itemName} from ${sourceName} to ${targetName}`}
        onClick={() => onRemove(id, edge.to)}
        className="text-xs leading-none opacity-60 hover:opacity-100 hover:text-red-400"
      >
        ×
      </button>
    </span>
  )
}

