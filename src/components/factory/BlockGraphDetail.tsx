import { useState } from 'react'
import { ConnectionChip } from './GraphConnectionChip'
import { useSourceRuleItems } from './useSourceRuleItems'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { edgeKey } from './graphConnection'
import type { BlockEdgeLayout } from '../../utils/blockGraphLayout'
import type { Block, ConnectionFlow, GameData } from '../../data/types'

/** What the block graph points at or has pinned: a block, or an edge by its `edgeKey`. */
export type GraphLit = { kind: 'block' | 'edge'; key: string } | null

interface BlockGraphDetailProps {
  lit: GraphLit
  edges: BlockEdgeLayout[]
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  gameData: GameData
  /** The lit block or edge is the pinned one. */
  pinned?: boolean
  onGoTo?: (blockId: string) => void
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

/** Items flow left to right across the strip's width, then down: a busy edge grows downward only once a row is full. */
const FLOW = 'grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-3 gap-y-1 items-start'
const HEAD = 'text-[10px] uppercase tracking-wide text-gray-400 mb-1'

function BlockRows({ title, rows }: { title: string; rows: { block: Block | undefined; id: string; count: number; loop: boolean }[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className={HEAD}>{title}</div>
      {rows.length === 0 && <div className="text-xs text-gray-500">None</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4">
      {rows.map(r => (
        <div key={r.id} data-testid="graph-detail-block" className="flex items-center gap-2 text-xs text-gray-200 py-px">
          <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: r.block?.color ?? MISSING_BLOCK_COLOR }} />
          <span className="truncate">{r.block?.name ?? r.id}</span>
          {r.loop && <span aria-hidden data-tip="Part of a loop" className="text-[10px] text-gray-400">↻</span>}
          <span className="ml-auto font-mono tabular-nums text-gray-400">{r.count} {r.count === 1 ? 'item' : 'items'}</span>
        </div>
      ))}
      </div>
    </div>
  )
}

interface EdgeChipsProps {
  edge: Pick<BlockEdgeLayout, 'from' | 'to' | 'connectionIds'>
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  gameData: GameData
  /** `grid`: the strip under the graph, items across its width. `column`: the matrix's cell panel, one chip per line. */
  arrange: 'grid' | 'column'
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

/** The connections of one (source, consumer) pair as chips, with the limit control and the remove button. Shared by the strip and the matrix panel. */
export function EdgeChips({ edge, blocks, flowsById, items, gameData, arrange, onRemove, onSetLimit }: EdgeChipsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const source = blocks.find(b => b.id === edge.from)
  const target = blocks.find(b => b.id === edge.to)
  const ruleItems = useSourceRuleItems(target, gameData)
  const column = arrange === 'column'
  return (
    <div data-testid={column ? 'matrix-panel-items' : 'graph-detail-items'} className={column ? 'flex flex-col gap-1' : FLOW}>
      {edge.connectionIds.map(id => (
        <div key={id} className={column ? 'min-w-0 [&>span]:max-w-full' : 'min-w-0'}>
          <ConnectionChip
            connectionId={id}
            edge={edge}
            source={source}
            target={target}
            flow={flowsById.get(id)}
            items={items}
            gameData={gameData}
            ruleItems={ruleItems}
            editing={editingId === id}
            showName
            onEdit={() => setEditingId(id)}
            onStopEdit={() => setEditingId(null)}
            onRemove={onRemove}
            onSetLimit={onSetLimit}
          />
        </div>
      ))}
    </div>
  )
}

function EdgeItems({ edge, blocks, flowsById, items, gameData, pinned, onRemove, onSetLimit }: {
  edge: BlockEdgeLayout
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  gameData: GameData
  pinned: boolean
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}) {
  const source = blocks.find(b => b.id === edge.from)
  const target = blocks.find(b => b.id === edge.to)
  const n = edge.connectionIds.length
  return (
    <div>
      <div className={HEAD}>
        Items on this edge · {source?.name ?? edge.from} → {target?.name ?? edge.to} · {n} {n === 1 ? 'connection' : 'connections'}
        {!pinned && <span className="normal-case"> · click the edge to pin it and edit</span>}
      </div>
      <EdgeChips edge={edge} blocks={blocks} flowsById={flowsById} items={items} gameData={gameData} arrange="grid" onRemove={onRemove} onSetLimit={onSetLimit} />
    </div>
  )
}

/** The strip under the graph: what the lit block receives and supplies, or what the lit edge carries. */
export function BlockGraphDetail({ lit, edges, blocks, flowsById, items, gameData, pinned, onGoTo, onRemove, onSetLimit }: BlockGraphDetailProps) {
  const byId = new Map(blocks.map(b => [b.id, b]))
  const planIndex = new Map(blocks.map((b, i) => [b.id, i]))

  let body
  if (lit?.kind === 'block') {
    const rows = (mine: (e: BlockEdgeLayout) => boolean, other: (e: BlockEdgeLayout) => string) =>
      edges
        .filter(mine)
        .map(e => ({ id: other(e), block: byId.get(other(e)), count: e.connectionIds.length, loop: e.loop }))
        .sort((a, b) => b.count - a.count || planIndex.get(a.id)! - planIndex.get(b.id)!)
    const receives = rows(e => e.to === lit.key, e => e.from)
    const supplies = rows(e => e.from === lit.key, e => e.to)
    const block = byId.get(lit.key)
    body = (
      <div>
        {block && onGoTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-gray-200">
            <span className="font-medium truncate">{block.name}</span>
            {pinned && <span className="text-[10px] text-blue-300">pinned</span>}
            <button
              type="button"
              data-testid="graph-detail-open"
              onClick={() => onGoTo(block.id)}
              className="ml-auto text-xs bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-2 py-0.5"
            >
              Go to {block.name}
            </button>
          </div>
        )}
        {receives.length + supplies.length === 0
          ? <div className="text-xs text-gray-400">Not connected to any other block.</div>
          : (
            <div className="flex gap-6">
              <BlockRows title="Receives from" rows={receives} />
              <BlockRows title="Supplies" rows={supplies} />
            </div>
          )}
      </div>
    )
  } else if (lit?.kind === 'edge') {
    const edge = edges.find(e => edgeKey(e) === lit.key)
    if (edge) {
      body = (
        <EdgeItems
          key={lit.key}
          edge={edge}
          blocks={blocks}
          flowsById={flowsById}
          items={items}
          gameData={gameData}
          pinned={!!pinned}
          onRemove={onRemove}
          onSetLimit={onSetLimit}
        />
      )
    }
  }

  return (
    <div data-testid="graph-detail" className="p-3">
      {body ?? <div className="text-xs text-gray-400">Point at a block or a connection to see what it carries.</div>}
    </div>
  )
}
