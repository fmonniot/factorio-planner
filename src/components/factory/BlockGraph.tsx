import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectFlows, selectLoops, selectRequestLoops, selectBlockResults, selectBlockErrors } from '../../store/solverStore'
import { BLOCK_PALETTE, MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { layoutBlockGraph, edgePath, fitScale, NODE_W, NODE_H, GRAPH_PAD } from '../../utils/blockGraphLayout'
import type { BlockEdgeLayout, BlockGraphLayout } from '../../utils/blockGraphLayout'
import { Modal } from '../Modal'
import { TipWrap } from '../TipWrap'
import { Icon } from '../Icon'
import { IconButton } from '../IconButton'
import { Segmented, Segment } from '../SegmentedControl'
import { GraphIcon } from '../icons'
import type { Block, BlockLoop, ConnectionFlow, GameData } from '../../data/types'
import { BlockSourceRuleMarker } from './SourceRuleMarker'
import { useSourceRuleItems } from './useSourceRuleItems'
import { CHIP_TONE, connectionStatus, edgeKey, edgeSummaryTitle, pairStatus } from './graphConnection'
import type { EdgeStatus } from './graphConnection'
import { BlockGraphDetail } from './BlockGraphDetail'
import { BlockMatrix, MatrixHelp } from './BlockMatrix'
import { BlockPower, PowerFigures } from './BlockPower'
import { buildPowerOverview } from './powerOverview'
import { PlanAreasView } from './PlanAreas'
import { blocksWithAreas, defaultAreasTab, useAreasUi } from './areasUi'
import { ViewToolbar } from './ViewToolbar'
import type { GraphLit } from './BlockGraphDetail'

// ---------------------------------------------------------------------------
// Block graph — every block and the connections between them.
// ---------------------------------------------------------------------------

const EDGE_COLOR: Record<EdgeStatus, string> = {
  ok: '#16a34a',
  limited: '#f59e0b',
  unused: '#4b5563',
  pending: '#4b5563',
}

const PAD = GRAPH_PAD
const MAX_GOAL_ICONS = 4
/** Item icons on a summary chip; the rest is counted as +N. */
const MAX_SUMMARY_ICONS = 3

interface BlockNodeProps {
  block: Block
  x: number
  y: number
  isActive: boolean
  items: GameData['items']
  /** Pointed at, or an end of the pointed edge, or a neighbour of the pointed block. */
  lit: boolean
  /** Something else is pointed at. */
  dim: boolean
  onSelect: () => void
  /** The block's highlight is pinned: it stays lit, and the detail strip keeps showing it. */
  pinned: boolean
  onGoTo: () => void
  onHover: (on: boolean) => void
  onFocusChange: (on: boolean) => void
}

function BlockNode({
  block, x, y, isActive, items, lit, dim, pinned, onSelect, onGoTo, onHover, onFocusChange,
}: BlockNodeProps) {
  const firstItem = block.products[0] ? items[block.products[0].itemId] : undefined
  const shown = block.products.slice(0, MAX_GOAL_ICONS)
  const more = block.products.length - shown.length
  const ring = pinned ? 'ring-2 ring-blue-400' : isActive ? 'ring-2 ring-teal-500' : ''

  return (
    <div
      data-testid="graph-node"
      data-block-id={block.id}
      data-active={isActive ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : undefined}
      data-lit={lit ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      className={`absolute rounded border border-gray-600 bg-gray-800 ${ring} ${dim ? 'opacity-30' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false)
      }}
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
        data-testid="graph-node-select"
        aria-pressed={pinned}
        data-tip=""
        onClick={onSelect}
        className="w-full h-full flex items-center gap-2 pl-2 pr-8 text-left text-gray-100 rounded hover:bg-gray-700/60"
      >
        {firstItem ? (
          <Icon iconPath={firstItem.iconPath} alt="" className="w-8 h-8 object-contain shrink-0" />
        ) : (
          <span className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-400">?</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block line-clamp-2 break-words text-xs font-medium leading-tight">{block.name}</span>
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            {shown.map(g => {
              const item = items[g.itemId]
              return item?.iconPath ? (
                <Icon key={g.id} iconPath={item.iconPath} alt={item.name} data-tip={item.name} className="w-4 h-4 object-contain" />
              ) : (
                <span key={g.id} data-tip={item?.name ?? g.itemId}>{(item?.name ?? g.itemId).charAt(0)}</span>
              )
            })}
            {more > 0 && <span>+{more}</span>}
          </span>
        </span>
      </button>
      <TipWrap tip={`Go to ${block.name}`} className="absolute right-0 top-0 h-full w-7">
        <button
          type="button"
          data-testid="graph-node-open"
          aria-label={`Go to ${block.name}`}
          onClick={onGoTo}
          className="w-full h-full rounded-r border-l border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          ↗
        </button>
      </TipWrap>
    </div>
  )
}

interface EdgeSummaryProps {
  edge: BlockEdgeLayout
  /** Combined status of the edge, as drawn on its path. */
  status: EdgeStatus
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  items: GameData['items']
  gameData: GameData
  /** Centre of the chip, in the overlay's pixels. */
  x: number
  y: number
  /** The edge is pointed at, focused or pinned: the chip shows. */
  lit: boolean
  pinned: boolean
  /** Widest the chip may be on screen (px): the gap it sits in, so that it never covers a block. */
  maxWidth: number
  onTogglePin: (e: MouseEvent<HTMLButtonElement>) => void
  onHover: (on: boolean) => void
  onFocusChange: (on: boolean) => void
}

/** How many connection icons a chip can show within `maxWidth` px (the chip's padding, loop mark, icons and "+N" label). */
function chipIconCount(n: number, loop: boolean, maxWidth: number): number {
  const base = 14 + (loop ? 14 : 0)
  for (let k = Math.min(n, MAX_SUMMARY_ICONS); k > 0; k--) {
    const label = n > k ? 4 + 7 * `+${n - k}`.length : 0
    if (base + k * 20 - 4 + label <= maxWidth) return k
  }
  return 0
}

/**
 * The summary chip of one edge, always in the DOM but shown only while the edge is pointed at, focused or pinned. It is
 * the count badge of the edge and its keyboard stop: a click, or Enter, pins the edge (the detail strip then edits it).
 */
function EdgeSummary({ edge, status, blocks, flowsById, items, gameData, x, y, lit, pinned, maxWidth, onTogglePin, onHover, onFocusChange }: EdgeSummaryProps) {
  const source = blocks.find(b => b.id === edge.from)
  const target = blocks.find(b => b.id === edge.to)
  const sourceName = source?.name ?? edge.from
  const targetName = target?.name ?? edge.to
  const ruleItems = useSourceRuleItems(target, gameData)
  const n = edge.connectionIds.length
  const connections = edge.connectionIds
    .map(id => target?.inputConnections.find(c => c.id === id))
    .filter(c => c !== undefined)
  const statuses = edge.connectionIds.map(id => connectionStatus(flowsById.get(id)))
  const iconCount = chipIconCount(n, edge.loop, maxWidth)
  const shown = connections.slice(0, iconCount)
  const visible = lit || pinned

  return (
    <div
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      className={`absolute flex flex-col items-center ${visible
        ? 'opacity-100 pointer-events-auto'
        : 'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto'}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false)
      }}
    >
      <button
        type="button"
        data-testid="graph-edge-summary"
        data-from={edge.from}
        data-to={edge.to}
        data-count={n}
        data-connection-ids={edge.connectionIds.join(' ')}
        data-status={status}
        data-loop={edge.loop ? 'true' : undefined}
        data-lit={lit ? 'true' : undefined}
        data-pinned={pinned ? 'true' : undefined}
        data-shown={visible ? 'true' : undefined}
        data-icons={iconCount}
        aria-pressed={pinned}
        aria-label={`${n} ${n === 1 ? 'item' : 'items'} from ${sourceName} to ${targetName}`}
        data-tip={edgeSummaryTitle(n, sourceName, targetName, statuses, edge.loop, connections.filter(c => ruleItems.has(c.itemId)).length)}
        style={status === 'ok' ? { borderColor: source?.color ?? MISSING_BLOCK_COLOR } : undefined}
        onClick={onTogglePin}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border whitespace-nowrap hover:brightness-125 ${CHIP_TONE[status]}`}
      >
        {edge.loop && <span aria-hidden className="text-[10px] leading-none">↻</span>}
        {shown.map(c => {
          const item = items[c.itemId]
          const icon = item?.iconPath ? (
            <Icon key={c.id} iconPath={item.iconPath} alt="" className="w-4 h-4 object-contain shrink-0" />
          ) : (
            <span key={c.id} aria-hidden className="text-[10px]">{(item?.name ?? c.itemId).charAt(0)}</span>
          )
          if (!target || !ruleItems.has(c.itemId)) return icon
          // The summary chip is a button: the marker only shows the rule here, and the chip's tooltip counts it.
          return (
            <span key={c.id} aria-hidden className="relative inline-flex shrink-0">
              {icon}
              <span className="absolute -top-1 -right-1 flex">
                <BlockSourceRuleMarker block={target} itemId={c.itemId} gameData={gameData} />
              </span>
            </span>
          )
        })}
        {n > iconCount && <span className="text-[10px] font-mono">{iconCount === 0 ? n : `+${n - iconCount}`}</span>}
      </button>
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
    <span data-testid="graph-loop-status" data-converged="true" data-tip={title} className="text-xs text-gray-400">
      ↻ {loops.length} {loops.length === 1 ? 'loop' : 'loops'}
    </span>
  )
}

interface GraphViewProps {
  layout: BlockGraphLayout
  blocks: Block[]
  flowsById: Map<string, ConnectionFlow>
  edgeStatuses: Map<BlockEdgeLayout, EdgeStatus>
  gameData: GameData
  activeBlockId: string | null
  goTo: (id: string) => void
  /** The blocks that have areas, and the way to open one's areas; the strip offers the link for those blocks. */
  areaBlockIds: ReadonlySet<string>
  onOpenAreas: (id: string) => void
  onRemove: (connectionId: string, toBlockId: string) => void
  onSetLimit: (connectionId: string, toBlockId: string, maxRate: number | undefined) => void
}

/** The graph view of the modal: the canvas fitted to its viewport, and the detail strip under it. */
function GraphView({ layout, blocks, flowsById, edgeStatuses, gameData, activeBlockId, goTo, areaBlockIds, onOpenAreas, onRemove, onSetLimit }: GraphViewProps) {
  // What the pointer, the keyboard focus and the pin (a click on a block or an edge, or Enter on an edge's chip) are on, in
  // that order of precedence: the pointer previews over the pin and the highlight falls back to the pin when it leaves.
  // Lights its edges and blocks, dims the rest. One pin at a time.
  const [hover, setHover] = useState<GraphLit>(null)
  const [focus, setFocus] = useState<GraphLit>(null)
  const [pin, setPin] = useState<GraphLit>(null)
  const exists = (w: GraphLit) => w !== null && (w.kind === 'block' ? !!layout.nodes[w.key] : layout.edges.some(e => edgeKey(e) === w.key))
  // A pin on something that is gone (the last connection of a pinned edge was removed) is dropped.
  if (pin !== null && !exists(pin)) setPin(null)
  const isPin = (kind: 'block' | 'edge', key: string) => pin?.kind === kind && pin.key === key
  // A click leaves its element focused; the pin it sets or clears is what should hold the highlight, not that stale focus.
  const togglePin = (kind: 'block' | 'edge', key: string) => {
    setFocus(null)
    setPin(p => (p?.kind === kind && p.key === key ? null : { kind, key }))
  }
  // While the pointer or the focus is in the detail strip it keeps showing the pin: a preview from the graph would replace
  // it under a limit being typed.
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripHover, setStripHover] = useState(false)
  const [stripFocus, setStripFocus] = useState(false)
  const sticky = pin !== null && exists(pin) && (stripHover || stripFocus)
  const lit = (sticky ? pin : [hover, focus, pin].find(exists)) ?? null
  // Focus on an element the strip removed (a connection taken off the edge) does not blur.
  useEffect(() => {
    if (stripFocus && !stripRef.current?.contains(document.activeElement)) setStripFocus(false)
  }, [stripFocus, blocks])
  // Enter on a chip hands the focus to the strip, whose first control is the edge's first connection.
  const focusStrip = useRef(false)
  useEffect(() => {
    if (!focusStrip.current || pin === null) return
    focusStrip.current = false
    stripRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
  }, [pin])
  const { litBlocks, litEdges } = useMemo(() => {
    const litBlocks = new Set<string>()
    const litEdges = new Set<string>()
    if (lit?.kind === 'block') {
      litBlocks.add(lit.key)
      for (const e of layout.edges) {
        if (e.from !== lit.key && e.to !== lit.key) continue
        litEdges.add(edgeKey(e))
        litBlocks.add(e.from)
        litBlocks.add(e.to)
      }
    } else if (lit?.kind === 'edge') {
      litEdges.add(lit.key)
      const e = layout.edges.find(e => edgeKey(e) === lit.key)
      if (e) {
        litBlocks.add(e.from)
        litBlocks.add(e.to)
      }
    }
    return { litBlocks, litEdges }
  }, [lit, layout])

  // Fit the graph to the viewport: no pan, no zoom.
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setView(v => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const contentW = layout.width + PAD * 2
  const contentH = layout.height + PAD * 2
  const scale = Math.floor(fitScale(view.w, view.h, contentW, contentH) * 1000) / 1000

  // Escape unpins first and closes the graph only when nothing is pinned. A limit being typed handles its own Escape.
  // From the strip, focus goes back to the pinned block or chip, so the keyboard does not fall to the page.
  useEffect(() => {
    if (pin === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.tagName === 'INPUT')) return
      e.stopPropagation()
      if (stripRef.current?.contains(document.activeElement)) {
        const edge = pin.kind === 'edge' ? layout.edges.find(x => edgeKey(x) === pin.key) : undefined
        const origin = pin.kind === 'block'
          ? viewportRef.current?.querySelector<HTMLElement>(`[data-block-id="${pin.key}"] [data-testid="graph-node-select"]`)
          : edge && viewportRef.current?.querySelector<HTMLElement>(`[data-testid="graph-edge-summary"][data-from="${edge.from}"][data-to="${edge.to}"]`)
        origin?.focus()
      }
      setFocus(null)
      setPin(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pin, layout])

  // A click on the background unpins; nodes and chips are children.
  function onBackgroundClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) setPin(null)
  }

  return (
    <>
      <div ref={viewportRef} data-testid="block-graph-viewport" className="relative flex-1 min-h-0 overflow-hidden">
        <div
          data-testid="block-graph-canvas"
          style={{ width: contentW * scale, height: contentH * scale }}
          className="relative mx-auto"
          onClick={onBackgroundClick}
        >
          <div
            className="absolute left-0 top-0"
            style={{ width: contentW, height: contentH, transform: `scale(${scale})`, transformOrigin: '0 0' }}
            onClick={onBackgroundClick}
          >
            <div
              data-testid="block-graph-layer"
              className="absolute"
              style={{ left: PAD, top: PAD, width: layout.width, height: layout.height }}
              onClick={onBackgroundClick}
            >
              <svg aria-hidden width={layout.width} height={layout.height} className="absolute left-0 top-0 pointer-events-none" style={{ overflow: 'visible' }}>
                {layout.edges.map(e => {
                  const key = edgeKey(e)
                  const status = edgeStatuses.get(e)!
                  const source = blocks.find(b => b.id === e.from)
                  const stroke = status === 'ok' ? (source?.color ?? MISSING_BLOCK_COLOR) : EDGE_COLOR[status]
                  const isLit = litEdges.has(key)
                  const dim = lit !== null && !isLit
                  const d = edgePath(e)
                  return (
                    <g key={key}>
                      <path
                        data-testid="graph-edge"
                        data-from={e.from}
                        data-to={e.to}
                        data-status={status}
                        data-loop={e.loop ? 'true' : undefined}
                        data-back={e.back ? 'true' : undefined}
                        data-lit={isLit ? 'true' : undefined}
                        data-dim={dim ? 'true' : undefined}
                        d={d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={1 + Math.min(e.connectionIds.length, 14) / 4 + (isLit ? 1 : 0)}
                        strokeOpacity={isLit ? 1 : dim ? 0.07 : 0.55}
                        strokeDasharray={e.back ? '6 5' : undefined}
                        className="pointer-events-none"
                      />
                      <path
                        data-testid="graph-edge-hit"
                        data-from={e.from}
                        data-to={e.to}
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={Math.max(10, 12 / scale)}
                        style={{ pointerEvents: 'stroke' }}
                        className="cursor-pointer"
                        onMouseEnter={() => setHover({ kind: 'edge', key })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => togglePin('edge', key)}
                      />
                    </g>
                  )
                })}
              </svg>
              {blocks.map(b => {
                const n = layout.nodes[b.id]
                return (
                  <BlockNode
                    key={b.id}
                    block={b}
                    x={n.x}
                    y={n.y}
                    isActive={b.id === activeBlockId}
                    items={gameData.items}
                    lit={litBlocks.has(b.id)}
                    dim={lit !== null && !litBlocks.has(b.id)}
                    pinned={isPin('block', b.id)}
                    onSelect={() => togglePin('block', b.id)}
                    onGoTo={() => goTo(b.id)}
                    onHover={on => setHover(on ? { kind: 'block', key: b.id } : null)}
                    onFocusChange={on => setFocus(on ? { kind: 'block', key: b.id } : null)}
                  />
                )
              })}
            </div>
          </div>
          {/* Chips are not scaled: they stay readable at any fit. */}
          <div data-testid="block-graph-overlay" className="absolute inset-0 pointer-events-none">
            {layout.edges.map(e => {
              const key = edgeKey(e)
              return (
                <EdgeSummary
                  key={key}
                  edge={e}
                  status={edgeStatuses.get(e)!}
                  blocks={blocks}
                  flowsById={flowsById}
                  items={gameData.items}
                  gameData={gameData}
                  x={(PAD + e.chip.x) * scale}
                  y={(PAD + e.chip.y) * scale}
                  lit={lit?.kind === 'edge' && lit.key === key}
                  pinned={isPin('edge', key)}
                  maxWidth={e.back ? Infinity : (e.points[e.points.length - 1].x - e.points[e.points.length - 2].x) * scale - 2}
                  onTogglePin={ev => {
                    if (ev.detail === 0 && !isPin('edge', key)) focusStrip.current = true
                    togglePin('edge', key)
                  }}
                  onHover={on => setHover(on ? { kind: 'edge', key } : null)}
                  onFocusChange={on => setFocus(on ? { kind: 'edge', key } : null)}
                />
              )
            })}
          </div>
        </div>
      </div>

      <div
        ref={stripRef}
        className="shrink-0 h-40 border-t border-gray-700 overflow-y-auto"
        onMouseEnter={() => setStripHover(true)}
        onMouseLeave={() => setStripHover(false)}
        onFocus={() => setStripFocus(true)}
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStripFocus(false)
        }}
      >
        <BlockGraphDetail
          lit={lit}
          pinned={lit !== null && isPin(lit.kind, lit.key)}
          onGoTo={goTo}
          areaBlockIds={areaBlockIds}
          onOpenAreas={onOpenAreas}
          edges={layout.edges}
          blocks={blocks}
          flowsById={flowsById}
          items={gameData.items}
          gameData={gameData}
          onRemove={onRemove}
          onSetLimit={onSetLimit}
        />
      </div>
    </>
  )
}

function BlockGraphModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const activeBlockId = useBlockStore(s => s.activeBlockId)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const setConnectionMaxRate = useBlockStore(s => s.setConnectionMaxRate)
  const flows = useSolverStore(selectFlows)
  const loops = useSolverStore(selectLoops)
  const requestLoops = useSolverStore(selectRequestLoops)
  const results = useSolverStore(selectBlockResults)
  const errors = useSolverStore(selectBlockErrors)
  const storedView = useUiStore(s => s.blockGraphView)
  // The Power list's open rows live here, not in the view: they survive a switch between views and start collapsed each time the modal opens.
  const [powerExpanded, setPowerExpanded] = useState<Set<string>>(() => new Set())
  const setBlockGraphView = useUiStore(s => s.setBlockGraphView)

  // Areas is a view only while some block has areas; a stored choice of it falls back to the graph without them.
  const withAreas = useMemo(() => blocksWithAreas(blocks, results), [blocks, results])
  const areasBlockIds = useMemo(() => new Set(withAreas.map(b => b.id)), [withAreas])
  const view = storedView === 'areas' && withAreas.length === 0 ? 'graph' : storedView
  // The Areas view's state lives here, so it survives a switch to another view; closing the modal resets it.
  const areasUi = useAreasUi(defaultAreasTab(withAreas, activeBlockId), activeBlockId)
  const { selectTab: selectAreasTab } = areasUi

  const power = useMemo(
    () => (view === 'power' ? buildPowerOverview(blocks, results, errors, gameData) : undefined),
    [view, blocks, results, errors, gameData],
  )
  const layout = useMemo(() => layoutBlockGraph(blocks), [blocks])
  const flowsById = useMemo(() => new Map(flows.map(f => [f.connectionId, f])), [flows])
  const edgeStatuses = useMemo(
    () => new Map(layout.edges.map(e => [e, pairStatus(e.connectionIds.map(id => connectionStatus(flowsById.get(id))))])),
    [layout, flowsById],
  )

  function goTo(id: string) {
    setActiveBlock(id)
    onClose()
  }
  // The graph's strip and the Power list link a block to its areas.
  function openAreasOf(id: string) {
    selectAreasTab(id)
    setBlockGraphView('areas')
  }

  const btn = 'text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1'
  const onRemove = (id: string, to: string) => removeInputConnection(id, to)
  const onSetLimit = (id: string, to: string, max: number | undefined) => setConnectionMaxRate(id, max, to)

  return (
    <Modal onClose={onClose} className="w-[96vw] h-[92vh] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-amber-200">Factory overview</h2>
        <Segmented label="View" size="sm">
          <Segment pressed={view === 'graph'} onClick={() => setBlockGraphView('graph')} data-tip="The blocks and their connections as a graph">Graph</Segment>
          <Segment pressed={view === 'matrix'} onClick={() => setBlockGraphView('matrix')} data-tip="Who supplies whom, as a grid">Matrix</Segment>
          {withAreas.length > 0 && (
            <Segment pressed={view === 'areas'} onClick={() => setBlockGraphView('areas')} data-tip="What each area of a block sends and receives, item by item">Areas</Segment>
          )}
          <Segment pressed={view === 'power'} onClick={() => setBlockGraphView('power')} data-tip="Electric power by block, against what the power plant makes">Power</Segment>
        </Segmented>
        {power && <PowerFigures model={power} />}
        {view === 'matrix' && <MatrixHelp className="ml-auto" />}
        <button type="button" onClick={onClose} className={`${btn} ${view !== 'power' && view !== 'matrix' ? 'ml-auto' : ''}`}>Close</button>
      </div>

      {view === 'graph' && (
        <ViewToolbar testId="graph-toolbar">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1" data-tip="In the source block's colour">
              <span
                className="w-3 h-0.5"
                style={{ background: `linear-gradient(90deg, ${BLOCK_PALETTE[0]}, ${BLOCK_PALETTE[5]}, ${BLOCK_PALETTE[10]})` }}
              />
              OK
            </span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.limited }} />Limited</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: EDGE_COLOR.unused }} />Not used</span>
            <span data-testid="graph-legend-back" className="flex items-center gap-1" data-tip="Drawn right to left, along the bottom">
              <svg aria-hidden width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" /></svg>
              Right to left
            </span>
            <span data-testid="graph-legend-loop" className="flex items-center gap-1" data-tip="A connection between blocks that supply each other, directly or through other blocks"><span aria-hidden>↻</span>Loop</span>
          </div>
          {(loops.length > 0 || requestLoops.length > 0) && <LoopStatus loops={loops} requestLoops={requestLoops} blocks={blocks} />}
        </ViewToolbar>
      )}

      {view === 'graph' ? (
        <GraphView
          layout={layout}
          blocks={blocks}
          flowsById={flowsById}
          edgeStatuses={edgeStatuses}
          gameData={gameData}
          activeBlockId={activeBlockId}
          goTo={goTo}
          areaBlockIds={areasBlockIds}
          onOpenAreas={openAreasOf}
          onRemove={onRemove}
          onSetLimit={onSetLimit}
        />
      ) : view === 'matrix' ? (
        <BlockMatrix
          blocks={blocks}
          dependencyOrder={layout.order}
          edges={layout.edges}
          flowsById={flowsById}
          gameData={gameData}
          onRemove={onRemove}
          onSetLimit={onSetLimit}
        />
      ) : view === 'areas' ? (
        <PlanAreasView ui={areasUi} gameData={gameData} onClose={onClose} />
      ) : (
        power && (
          <BlockPower
            model={power}
            expanded={powerExpanded}
            onExpandedChange={setPowerExpanded}
            areaBlockIds={areasBlockIds}
            onOpenAreas={openAreasOf}
          />
        )
      )}
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
      <IconButton label="Factory overview" onClick={() => setOpen(true)}>
        <GraphIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <BlockGraphModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
