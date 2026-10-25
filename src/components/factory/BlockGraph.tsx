import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows, selectLoops, selectRequestLoops } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { closesLoop } from '../../solver/blockGraph'
import { connectableItems, requestBlockerTitle } from '../../store/connections'
import type { ItemCandidate } from '../../store/connections'
import { BLOCK_PALETTE, MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { layoutBlockGraph, edgePath, NODE_W, NODE_H, MAX_EDGE_CHIPS } from '../../utils/blockGraphLayout'
import type { BlockEdgeLayout } from '../../utils/blockGraphLayout'
import { Modal } from '../Modal'
import { Icon } from '../Icon'
import { IconButton } from '../IconButton'
import { GraphIcon } from '../icons'
import { fmtRate } from './ItemTile'
import { Popover } from './Popover'
import { RateInput } from './RateInput'
import { cappedTitle, cappingLimit } from './summarySegments'
import type { Block, BlockLoop, ConnectionFlow, GameData, Item } from '../../data/types'

// ---------------------------------------------------------------------------
// Block graph — every block and the connections between them. Connections are
// made from the source side: the → handle of a block, then a target, then an item.
// ---------------------------------------------------------------------------

type EdgeStatus = 'limited' | 'ok' | 'unused' | 'pending'

const EDGE_COLOR: Record<EdgeStatus, string> = {
  ok: '#16a34a',
  limited: '#f59e0b',
  unused: '#4b5563',
  pending: '#4b5563',
}

const CHIP_TONE: Record<EdgeStatus, string> = {
  ok: 'bg-green-950 text-green-300', // border set inline, in the source block's colour
  limited: 'bg-green-950 text-green-300 border-amber-500',
  unused: 'bg-green-950/40 text-green-300/50 border-green-900',
  pending: 'bg-gray-800 text-gray-400 border-gray-700',
}

const PAD = 24
const MAX_GOAL_ICONS = 4
/** Item icons on a summary chip; the rest is counted as +N. */
const MAX_SUMMARY_ICONS = MAX_EDGE_CHIPS

/** Status of one connection; `missing-source` and `self` never reach the graph (no edge is drawn). */
function connectionStatus(flow: ConnectionFlow | undefined): EdgeStatus {
  if (!flow) return 'pending'
  return flow.status === 'missing-source' || flow.status === 'self' ? 'pending' : flow.status
}

/** Precedence for the single colour of an edge that carries several connections. */
function pairStatus(statuses: EdgeStatus[]): EdgeStatus {
  for (const s of ['limited', 'ok', 'unused'] as const) {
    if (statuses.includes(s)) return s
  }
  return 'pending'
}

type ConnectRole = 'source' | 'target' | 'blocked'

interface BlockNodeProps {
  block: Block
  x: number
  y: number
  isActive: boolean
  role: ConnectRole | undefined
  blockedReason: string | undefined
  closesLoop: boolean
  items: GameData['items']
  canConnect: boolean
  sourceName: string
  onSelect: () => void
  onStartConnect: () => void
}

function BlockNode({
  block, x, y, isActive, role, blockedReason, closesLoop, sourceName, items, canConnect, onSelect, onStartConnect,
}: BlockNodeProps) {
  const firstItem = block.products[0] ? items[block.products[0].itemId] : undefined
  const shown = block.products.slice(0, MAX_GOAL_ICONS)
  const more = block.products.length - shown.length
  const ring = role === 'source'
    ? 'ring-2 ring-blue-400'
    : role === 'target'
      ? 'ring-2 ring-teal-300'
      : isActive ? 'ring-2 ring-teal-500' : ''

  return (
    <div
      data-testid="graph-node"
      data-block-id={block.id}
      data-active={isActive ? 'true' : 'false'}
      data-connect={role}
      data-closes-loop={closesLoop ? 'true' : undefined}
      title={closesLoop
        ? `Closes a loop: ${sourceName} already receives from ${block.name}, directly or through other blocks`
        : blockedReason}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      className={`absolute rounded border border-gray-600 bg-gray-800 ${ring} ${role === 'blocked' ? 'opacity-40' : ''}`}
    >
      <span
        aria-hidden
        data-testid="graph-node-stripe"
        data-color={block.color}
        style={{ background: block.color }}
        className="pointer-events-none absolute z-10 -left-px -right-px -top-px h-[3px] rounded-t"
      />
      <button
        type="button"
        aria-label={block.name}
        onClick={onSelect}
        className="w-full h-full flex items-center gap-2 pl-2 pr-8 text-left text-gray-100 rounded hover:bg-gray-700/60"
      >
        {firstItem ? (
          <Icon iconPath={firstItem.iconPath} alt="" className="w-8 h-8 object-contain shrink-0" />
        ) : (
          <span className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-500">?</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{block.name}</span>
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            {shown.map(g => {
              const item = items[g.itemId]
              return item?.iconPath ? (
                <Icon key={g.id} iconPath={item.iconPath} alt={item.name} title={item.name} className="w-4 h-4 object-contain" />
              ) : (
                <span key={g.id} title={item?.name ?? g.itemId}>{(item?.name ?? g.itemId).charAt(0)}</span>
              )
            })}
            {more > 0 && <span>+{more}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid="graph-connect-handle"
        aria-label={`Connect from ${block.name}`}
        title="Send an item from this block to another"
        disabled={!canConnect}
        onClick={onStartConnect}
        className="absolute right-0 top-0 h-full w-7 rounded-r border-l border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        →
      </button>
    </div>
  )
}

interface ConnectItemMenuProps {
  targetName: string
  sourceName: string
  closesLoop: boolean
  x: number
  y: number
  candidates: ItemCandidate[]
  items: GameData['items']
  onPick: (itemId: string) => void
}

function ConnectItemMenu({ targetName, sourceName, closesLoop, x, y, candidates, items, onPick }: ConnectItemMenuProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => `${fmtRate(perMin / 60, rateUnit)}${unit}`

  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className="absolute z-10 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-48"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
        Send to {targetName}
      </div>
      {closesLoop && (
        <div data-testid="graph-closes-loop" className="px-3 py-1 text-[10px] text-amber-300">
          ↻ Closes a loop with {sourceName}
        </div>
      )}
      {candidates.map(({ itemId, offered, needed, request, blocker }) => {
        const item = items[itemId]
        return (
          <button
            key={itemId}
            type="button"
            role="menuitem"
            data-kind={request ? 'request' : 'take'}
            disabled={!!blocker}
            title={blocker ? requestBlockerTitle(blocker, sourceName, item?.name ?? itemId) : undefined}
            className="w-full flex items-center gap-2 text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
            onClick={() => {
              if (!blocker) onPick(itemId)
            }}
          >
            {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-5 h-5 object-contain shrink-0" />}
            <span>{item?.name ?? itemId}</span>
            <span className="ml-auto font-mono tabular-nums text-[10px] text-gray-500">
              offers {fmt(offered)} · needs {fmt(needed)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface EdgeLabelsProps {
  edge: BlockEdgeLayout
  /** Combined status of the edge, as drawn on its path. */
  status: EdgeStatus
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

const REQUEST_IGNORED_TITLE = {
  'request-loop': 'the requests around this loop do not settle, so this takes what is left over',
  'source-receives': 'the source receives this item itself, so this takes what is left over',
  duplicate: 'an earlier connection already takes this item from the same source',
} as const

interface ConnectionChipProps {
  connectionId: string
  edge: BlockEdgeLayout
  source: Block | undefined
  target: Block | undefined
  flow: ConnectionFlow | undefined
  items: GameData['items']
  editing: boolean
  /** Spell the item name out after its icon (the summary chip's list). */
  showName?: boolean
  onEdit: () => void
  onStopEdit: () => void
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

function ConnectionChip({
  connectionId: id, edge, source, target, flow, items, editing, showName,
  onEdit, onStopEdit, onRemove, onSetLimit,
}: ConnectionChipProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)
  const sourceName = source?.name ?? edge.from
  const targetName = target?.name ?? edge.to
  const connection = target?.inputConnections.find(c => c.id === id)
  if (!connection) return null
  const status = connectionStatus(flow)
  const item: Item | undefined = items[connection.itemId]
  const itemName = item?.name ?? connection.itemId

  let title = `${itemName}: ${sourceName} → ${targetName}`
  const cap = cappingLimit(status === 'limited', flow?.capped, connection.maxRate)
  if (cap !== undefined) {
    title = cappedTitle(`${fmt(cap)}${unit}`)
  } else if (status === 'limited') title = `Limited: ${sourceName} only offers ${fmt(flow?.available ?? 0)}${unit}`
  else if (status === 'unused') title = `Not used: ${targetName} makes or needs none from outside`
  if (flow?.loop) title += ' — part of a loop'
  if (flow?.kind === 'request') {
    title += ` — requested: ${sourceName} makes ${fmt(flow.requested ?? 0)}${unit} for ${targetName}`
  } else if (flow?.requestIgnored) {
    title += ` — taken as existing: ${REQUEST_IGNORED_TITLE[flow.requestIgnored]}`
  }

  return (
    <span
      data-testid="graph-edge-label"
      data-connection-id={id}
      data-status={status}
      data-loop={flow?.loop ? 'true' : undefined}
      data-kind={flow?.kind}
      data-request-ignored={flow?.requestIgnored}
      title={title}
      style={status === 'ok' ? { borderColor: source?.color ?? MISSING_BLOCK_COLOR } : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border whitespace-nowrap ${CHIP_TONE[status]}`}
    >
      {flow?.loop && <span aria-hidden className="text-[10px] leading-none">↻</span>}
      {item?.iconPath ? (
        <Icon iconPath={item.iconPath} alt={showName ? '' : itemName} className="w-5 h-5 object-contain shrink-0" />
      ) : (
        <span className={`truncate ${showName ? 'text-[11px] max-w-[10rem]' : 'text-[10px] max-w-[4rem]'}`}>{itemName}</span>
      )}
      {showName && item?.iconPath && <span className="text-[11px] truncate max-w-[10rem]">{itemName}</span>}
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {flow ? fmt(flow.rate) : '—'}
        {flow && <span className="opacity-60">{unit}</span>}
      </span>
      {editing ? (
        <RateInput
          key={`${id}-${rateUnit}`}
          initial={connection.maxRate !== undefined ? fmt(connection.maxRate) : ''}
          rateUnit={rateUnit}
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
          title={`Most ${targetName} takes over this connection; click to edit, clear to remove`}
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

/** Tooltip of a summary chip: the count, then what is notable among its connections. */
function edgeSummaryTitle(
  n: number, sourceName: string, targetName: string, statuses: EdgeStatus[], loop: boolean,
): string {
  let title = `${n} items from ${sourceName} to ${targetName}`
  const limited = statuses.filter(s => s === 'limited').length
  const unused = statuses.filter(s => s === 'unused').length
  if (limited > 0) title += `; ${limited} limited`
  if (unused > 0) title += `; ${unused} not used`
  if (loop) title += '; part of a loop'
  return `${title} — click to list them`
}

function EdgeLabels({ edge, status, blocks, flowsById, items, onRemove, onSetLimit }: EdgeLabelsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const source = blocks.find(b => b.id === edge.from)
  const target = blocks.find(b => b.id === edge.to)
  const sourceName = source?.name ?? edge.from
  const targetName = target?.name ?? edge.to
  const listOpen = edge.collapsed && open

  // The edge stopped being summarised: forget the list, so it does not pop open when it is summarised again.
  const [wasCollapsed, setWasCollapsed] = useState(edge.collapsed)
  if (wasCollapsed !== edge.collapsed) {
    setWasCollapsed(edge.collapsed)
    if (!edge.collapsed) {
      setOpen(false)
      setEditingId(null)
    }
  }

  // Modal closes on any Escape that reaches the window and Popover does not stop it: swallow the
  // Escape that closes the list, but not the one that cancels a limit edit (RateInput handles it).
  useEffect(() => {
    if (!listOpen || editingId !== null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') e.stopPropagation() }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [listOpen, editingId])

  const chip = (id: string, showName: boolean) => (
    <ConnectionChip
      key={id}
      connectionId={id}
      edge={edge}
      source={source}
      target={target}
      flow={flowsById.get(id)}
      items={items}
      editing={editingId === id}
      showName={showName}
      onEdit={() => setEditingId(id)}
      onStopEdit={() => setEditingId(null)}
      onRemove={onRemove}
      onSetLimit={onSetLimit}
    />
  )

  if (!edge.collapsed) {
    return (
      <div
        style={{ left: edge.labelX, top: edge.labelY, transform: 'translate(-50%, -50%)' }}
        className="absolute flex flex-col items-center gap-0.5"
      >
        {edge.connectionIds.map(id => chip(id, false))}
      </div>
    )
  }

  const n = edge.connectionIds.length
  const connections = edge.connectionIds
    .map(id => target?.inputConnections.find(c => c.id === id))
    .filter(c => c !== undefined)
  const statuses = edge.connectionIds.map(id => connectionStatus(flowsById.get(id)))
  const shown = connections.slice(0, MAX_SUMMARY_ICONS)

  return (
    // The transform makes a stacking context: lift the whole label while its list is open so nodes do not cover it.
    <div
      style={{ left: edge.labelX, top: edge.labelY, transform: 'translate(-50%, -50%)', zIndex: open ? 30 : undefined }}
      className="absolute flex flex-col items-center"
    >
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          data-testid="graph-edge-summary"
          data-from={edge.from}
          data-to={edge.to}
          data-count={n}
          data-status={status}
          data-loop={edge.loop ? 'true' : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={listId}
          aria-label={`${n} items from ${sourceName} to ${targetName}`}
          title={edgeSummaryTitle(n, sourceName, targetName, statuses, edge.loop)}
          style={status === 'ok' ? { borderColor: source?.color ?? MISSING_BLOCK_COLOR } : undefined}
          onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border whitespace-nowrap hover:brightness-125 ${CHIP_TONE[status]}`}
        >
          {edge.loop && <span aria-hidden className="text-[10px] leading-none">↻</span>}
          {shown.map(c => {
            const item = items[c.itemId]
            return item?.iconPath ? (
              <Icon key={c.id} iconPath={item.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" />
            ) : (
              <span key={c.id} aria-hidden className="text-[10px]">{(item?.name ?? c.itemId).charAt(0)}</span>
            )
          })}
          {n > MAX_SUMMARY_ICONS && <span className="text-[10px] font-mono">+{n - MAX_SUMMARY_ICONS}</span>}
          <span aria-hidden className="text-[10px] leading-none">▾</span>
        </button>
        {open && (
          <Popover
            ignoreRef={triggerRef}
            className="left-1/2 -translate-x-1/2 top-full w-max max-h-80 overflow-y-auto p-1"
            onClose={reason => {
              if (reason === 'escape' && editingId !== null) return
              // Unmounting the input would skip its blur commit: blur it first so the typed limit is saved.
              if (editingId !== null && document.activeElement instanceof HTMLElement) document.activeElement.blur()
              setEditingId(null)
              // Popover hears Escape before the guard above; closing now would re-render and drop the
              // guard before it runs, letting this same Escape reach the Modal. Close once it has passed.
              if (reason === 'escape') setTimeout(() => setOpen(false))
              else setOpen(false)
            }}
          >
            <div id={listId} role="dialog" aria-label={`Connections from ${sourceName} to ${targetName}`} data-testid="graph-edge-list" className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase text-gray-500 px-1">{sourceName} → {targetName} · {n} items</div>
              {edge.connectionIds.map(id => chip(id, true))}
            </div>
          </Popover>
        )}
      </div>
    </div>
  )
}

/** Header summary of the loops: a count, or in red the loops and cycles of requests that did not settle. */
function LoopStatus({ loops, requestLoops, blocks }: { loops: BlockLoop[]; requestLoops: BlockLoop[]; blocks: Block[] }) {
  const name = (id: string) => blocks.find(b => b.id === id)?.name ?? id
  const unsettled = [
    ...loops
      .filter(l => !l.converged)
      .map(l => `Loop through ${l.blockIds.map(name).join(', ')} did not settle after ${l.rounds} rounds; rates are from the last round`),
    ...requestLoops
      .filter(l => !l.converged)
      .map(l => `Requests around ${l.blockIds.map(name).join(', ')} do not settle after ${l.rounds} rounds; the requests that close the loop take what is left over`),
  ]
  if (unsettled.length > 0) {
    return (
      <span data-testid="graph-loop-status" data-converged="false" className="text-xs text-red-400">
        {unsettled.join('. ')}
      </span>
    )
  }
  const title = loops.map(l => [...l.blockIds, l.blockIds[0]].map(name).join(' → ')).join('; ')
  return (
    <span data-testid="graph-loop-status" data-converged="true" title={title} className="text-xs text-gray-400">
      ↻ {loops.length} {loops.length === 1 ? 'loop' : 'loops'}
    </span>
  )
}

function BlockGraphModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const addInputConnection = useBlockStore(s => s.addInputConnection)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const setConnectionMaxRate = useBlockStore(s => s.setConnectionMaxRate)
  const results = useSolverStore(selectBlockResults)
  const flows = useSolverStore(selectFlows)
  const loops = useSolverStore(selectLoops)
  const requestLoops = useSolverStore(selectRequestLoops)

  const layout = useMemo(() => layoutBlockGraph(blocks), [blocks])
  const flowsById = useMemo(() => new Map(flows.map(f => [f.connectionId, f])), [flows])
  const edgeStatuses = useMemo(
    () => new Map(layout.edges.map(e => [e, pairStatus(e.connectionIds.map(id => connectionStatus(flowsById.get(id))))])),
    [layout, flowsById],
  )

  const [connectFrom, setConnectFrom] = useState<string | undefined>()
  const [menuTarget, setMenuTarget] = useState<string | undefined>()

  const source = blocks.find(b => b.id === connectFrom)

  // Connect mode: which blocks can receive something from the source right now.
  const connect = useMemo(() => {
    if (!connectFrom) return undefined
    const roles = new Map<string, { role: ConnectRole; reason?: string; closesLoop?: boolean }>()
    const itemsByTarget = new Map<string, ReturnType<typeof connectableItems>>()
    for (const b of blocks) {
      if (b.id === connectFrom) {
        roles.set(b.id, { role: 'source' })
        continue
      }
      const items = connectableItems(blocks, connectFrom, b.id, results, flows)
      itemsByTarget.set(b.id, items)
      if (items.length > 0) {
        roles.set(b.id, { role: 'target', closesLoop: closesLoop(blocks, connectFrom, b.id) })
      } else {
        let reason: string
        if (!results[b.id]) reason = `${b.name} has not been solved yet`
        else reason = `Nothing to send: ${b.name} imports nothing ${source?.name ?? ''} has left to offer`
        roles.set(b.id, { role: 'blocked', reason })
      }
    }
    return { roles, itemsByTarget }
  }, [connectFrom, source, blocks, results, flows])

  function cancelConnect() {
    setConnectFrom(undefined)
    setMenuTarget(undefined)
  }

  // Only clicks on the canvas or its layer themselves; nodes, chips and the menu are children.
  function onBackgroundClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) cancelConnect()
  }

  function selectNode(id: string) {
    const entry = connect?.roles.get(id)
    if (!entry) {
      setActiveBlock(id)
      onClose()
    } else if (entry.role === 'source') {
      cancelConnect()
    } else if (entry.role === 'target') {
      setMenuTarget(id)
    }
  }

  function pick(itemId: string) {
    if (connectFrom && menuTarget) addInputConnection(itemId, connectFrom, menuTarget)
    cancelConnect()
  }

  const menuNode = menuTarget ? layout.nodes[menuTarget] : undefined
  const menuCandidates = (menuTarget && connect?.itemsByTarget.get(menuTarget)) || []
  const btn = 'text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1'

  return (
    <Modal onClose={onClose} className="w-[96vw] h-[92vh] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-amber-200">Block graph</h2>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1" title="In the source block's colour">
            <span
              className="w-3 h-0.5"
              style={{ background: `linear-gradient(90deg, ${BLOCK_PALETTE[0]}, ${BLOCK_PALETTE[5]}, ${BLOCK_PALETTE[10]})` }}
            />
            OK
          </span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.limited }} />Limited</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.unused }} />Not used</span>
          <span data-testid="graph-legend-loop" className="flex items-center gap-1" title="A connection between blocks that supply each other, directly or through other blocks"><span aria-hidden>↻</span>Loop</span>
        </div>
        {(loops.length > 0 || requestLoops.length > 0) && <LoopStatus loops={loops} requestLoops={requestLoops} blocks={blocks} />}
        {blocks.length < 2 && (
          <span className="text-xs text-gray-400">Add another block to connect blocks.</span>
        )}
        {source && (
          <span data-testid="graph-connect-hint" className="flex items-center gap-2 text-xs text-blue-300">
            Connecting from {source.name}: click a highlighted block to send it an item.
            <button type="button" onClick={cancelConnect} className="text-gray-300 hover:text-white underline">Cancel</button>
          </span>
        )}
        <button type="button" onClick={onClose} className={`${btn} ml-auto`}>Close</button>
      </div>

      <div data-testid="block-graph-viewport" className="relative flex-1 overflow-auto">
        <div
          data-testid="block-graph-canvas"
          style={{ width: layout.width + PAD * 2, height: layout.height + PAD * 2 }}
          className="relative"
          onClick={onBackgroundClick}
        >
          <div
            data-testid="block-graph-layer"
            className="absolute"
            style={{ left: PAD, top: PAD, width: layout.width, height: layout.height }}
            onClick={onBackgroundClick}
          >
            <svg width={layout.width} height={layout.height} className="absolute left-0 top-0 pointer-events-none" style={{ overflow: 'visible' }}>
              {layout.edges.map(e => {
                const status = edgeStatuses.get(e)!
                const source = blocks.find(b => b.id === e.from)
                const stroke = status === 'ok' ? (source?.color ?? MISSING_BLOCK_COLOR) : EDGE_COLOR[status]
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    data-testid="graph-edge"
                    data-from={e.from}
                    data-to={e.to}
                    data-status={status}
                    data-loop={e.loop ? 'true' : undefined}
                    data-back={e.back ? 'true' : undefined}
                    d={edgePath(e)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.5}
                    className="pointer-events-none"
                  />
                )
              })}
            </svg>
            {layout.edges.map(e => (
              <EdgeLabels
                key={`${e.from}>${e.to}`}
                edge={e}
                status={edgeStatuses.get(e)!}
                blocks={blocks}
                flowsById={flowsById}
                items={gameData.items}
                onRemove={(id, to) => removeInputConnection(id, to)}
                onSetLimit={(id, to, max) => setConnectionMaxRate(id, max, to)}
              />
            ))}
            {blocks.map(b => {
              const n = layout.nodes[b.id]
              const entry = connect?.roles.get(b.id)
              return (
                <BlockNode
                  key={b.id}
                  block={b}
                  x={n.x}
                  y={n.y}
                  isActive={b.id === activeBlockId}
                  role={entry?.role}
                  blockedReason={entry?.reason}
                  closesLoop={entry?.closesLoop ?? false}
                  sourceName={source?.name ?? ''}
                  items={gameData.items}
                  canConnect={blocks.length >= 2}
                  onSelect={() => selectNode(b.id)}
                  onStartConnect={() => {
                    setConnectFrom(connectFrom === b.id ? undefined : b.id)
                    setMenuTarget(undefined)
                  }}
                />
              )
            })}
            {menuNode && menuTarget && (
              <ConnectItemMenu
                targetName={blocks.find(b => b.id === menuTarget)?.name ?? ''}
                sourceName={source?.name ?? ''}
                closesLoop={connect?.roles.get(menuTarget)?.closesLoop ?? false}
                x={menuNode.x}
                y={menuNode.y + NODE_H + 4}
                candidates={menuCandidates}
                items={gameData.items}
                onPick={pick}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// BlockGraphButton — top-bar entry point
// ---------------------------------------------------------------------------

export function BlockGraphButton() {
  const gameData = useGameDataStore(selectGameData)
  const [open, setOpen] = useState(false)

  if (!gameData) return null

  return (
    <>
      <IconButton label="Block graph" onClick={() => setOpen(true)}>
        <GraphIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <BlockGraphModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
