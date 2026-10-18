import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { wouldCreateCycle } from '../../solver/blockGraph'
import { connectableItems } from '../../store/connections'
import { layoutBlockGraph, NODE_W, NODE_H } from '../../utils/blockGraphLayout'
import type { BlockEdgeLayout } from '../../utils/blockGraphLayout'
import { Modal } from '../Modal'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import type { Block, ConnectionFlow, GameData, Item } from '../../data/types'

// ---------------------------------------------------------------------------
// Block graph — every block and the connections between them. Connections are
// made from the source side: the → handle of a block, then a target, then an item.
// ---------------------------------------------------------------------------

type EdgeStatus = 'limited' | 'ok' | 'unused' | 'cycle' | 'pending'

const EDGE_COLOR: Record<EdgeStatus, string> = {
  ok: '#16a34a',
  limited: '#f59e0b',
  unused: '#4b5563',
  cycle: '#6b7280',
  pending: '#4b5563',
}

const CHIP_TONE: Record<EdgeStatus, string> = {
  ok: 'bg-green-950 text-green-300 border-green-600',
  limited: 'bg-green-950 text-green-300 border-amber-500',
  unused: 'bg-green-950/40 text-green-300/50 border-green-900',
  cycle: 'bg-gray-800 text-gray-500 border-gray-700',
  pending: 'bg-gray-800 text-gray-400 border-gray-700',
}

const CURVE = 48
const PAD = 24
const MAX_GOAL_ICONS = 4

/** Status of one connection; `missing-source` never reaches the graph (no edge is drawn). */
function connectionStatus(flow: ConnectionFlow | undefined): EdgeStatus {
  if (!flow) return 'pending'
  return flow.status === 'missing-source' ? 'pending' : flow.status
}

/** Precedence for the single colour of an edge that carries several connections. */
function pairStatus(statuses: EdgeStatus[]): EdgeStatus {
  for (const s of ['limited', 'ok', 'unused', 'cycle'] as const) {
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
  items: GameData['items']
  canConnect: boolean
  onSelect: () => void
  onStartConnect: () => void
}

function BlockNode({
  block, x, y, isActive, role, blockedReason, items, canConnect, onSelect, onStartConnect,
}: BlockNodeProps) {
  const firstItem = block.goals[0] ? items[block.goals[0].itemId] : undefined
  const shown = block.goals.slice(0, MAX_GOAL_ICONS)
  const more = block.goals.length - shown.length
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
      title={blockedReason}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      className={`absolute rounded border border-gray-600 bg-gray-800 ${ring} ${role === 'blocked' ? 'opacity-40' : ''}`}
    >
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
  x: number
  y: number
  candidates: { itemId: string; offered: number; needed: number }[]
  items: GameData['items']
  onPick: (itemId: string) => void
}

function ConnectItemMenu({ targetName, x, y, candidates, items, onPick }: ConnectItemMenuProps) {
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
      {candidates.map(({ itemId, offered, needed }) => {
        const item = items[itemId]
        return (
          <button
            key={itemId}
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 text-left px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
            onClick={() => onPick(itemId)}
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
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  onRemove: (connectionId: string, toBlockId: string) => void
}

function EdgeLabels({ edge, blocks, flowsById, items, onRemove }: EdgeLabelsProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const unit = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)
  const source = blocks.find(b => b.id === edge.from)
  const target = blocks.find(b => b.id === edge.to)
  const sourceName = source?.name ?? edge.from
  const targetName = target?.name ?? edge.to

  return (
    <div
      style={{ left: edge.labelX, top: edge.labelY, transform: 'translate(-50%, -50%)' }}
      className="absolute flex flex-col items-center gap-0.5"
    >
      {edge.connectionIds.map(id => {
        const connection = target?.inputConnections.find(c => c.id === id)
        if (!connection) return null
        const flow = flowsById.get(id)
        const status = connectionStatus(flow)
        const item: Item | undefined = items[connection.itemId]
        const itemName = item?.name ?? connection.itemId

        let title = `${itemName}: ${sourceName} → ${targetName}`
        if (status === 'limited') title = `Limited: ${sourceName} only offers ${fmt(flow?.available ?? 0)}${unit}`
        else if (status === 'unused') title = `Not used: ${targetName} makes or needs none from outside`
        else if (status === 'cycle') title = 'Ignored: this connection forms a cycle'

        return (
          <span
            key={id}
            data-testid="graph-edge-label"
            data-connection-id={id}
            data-status={status}
            title={title}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border whitespace-nowrap ${CHIP_TONE[status]}`}
          >
            {item?.iconPath ? (
              <Icon iconPath={item.iconPath} alt={itemName} className="w-5 h-5 object-contain shrink-0" />
            ) : (
              <span className="text-[10px] truncate max-w-[4rem]">{itemName}</span>
            )}
            <span className="text-[10px] font-mono tabular-nums leading-none">
              {flow ? fmt(flow.rate) : '—'}
              {flow && <span className="opacity-60">{unit}</span>}
            </span>
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
      })}
    </div>
  )
}

function BlockGraphModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const addInputConnection = useBlockStore(s => s.addInputConnection)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const results = useSolverStore(selectBlockResults)
  const flows = useSolverStore(selectFlows)

  const layout = useMemo(() => layoutBlockGraph(blocks), [blocks])
  const flowsById = useMemo(() => new Map(flows.map(f => [f.connectionId, f])), [flows])

  const [connectFrom, setConnectFrom] = useState<string | undefined>()
  const [menuTarget, setMenuTarget] = useState<string | undefined>()

  const source = blocks.find(b => b.id === connectFrom)

  // Connect mode: which blocks can receive something from the source right now.
  const connect = useMemo(() => {
    if (!connectFrom) return undefined
    const roles = new Map<string, { role: ConnectRole; reason?: string }>()
    const itemsByTarget = new Map<string, ReturnType<typeof connectableItems>>()
    for (const b of blocks) {
      if (b.id === connectFrom) {
        roles.set(b.id, { role: 'source' })
        continue
      }
      const items = connectableItems(blocks, connectFrom, b.id, results, flows)
      itemsByTarget.set(b.id, items)
      if (items.length > 0) {
        roles.set(b.id, { role: 'target' })
      } else {
        let reason: string
        if (wouldCreateCycle(blocks, connectFrom, b.id)) reason = 'Would create a cycle'
        else if (!results[b.id]) reason = `${b.name} has not been solved yet`
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
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.ok }} />OK</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.limited }} />Limited</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.unused }} />Not used</span>
          <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed" style={{ borderColor: EDGE_COLOR.cycle }} />Cycle</span>
        </div>
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
                const status = e.cyclic
                  ? 'cycle'
                  : pairStatus(e.connectionIds.map(id => connectionStatus(flowsById.get(id))))
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    data-testid="graph-edge"
                    data-from={e.from}
                    data-to={e.to}
                    data-status={status}
                    d={`M ${e.x1} ${e.y1} C ${e.x1 + CURVE} ${e.y1}, ${e.x2 - CURVE} ${e.y2}, ${e.x2} ${e.y2}`}
                    fill="none"
                    stroke={EDGE_COLOR[status]}
                    strokeWidth={1.5}
                    strokeDasharray={status === 'cycle' ? '4 4' : undefined}
                    className="pointer-events-none"
                  />
                )
              })}
            </svg>
            {layout.edges.map(e => (
              <EdgeLabels
                key={`${e.from}>${e.to}`}
                edge={e}
                blocks={blocks}
                flowsById={flowsById}
                items={gameData.items}
                onRemove={(id, to) => removeInputConnection(id, to)}
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
      <button
        onClick={() => setOpen(true)}
        className="text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1"
        title="Show the blocks and their connections"
      >
        Block graph
      </button>
      {open && <BlockGraphModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
