import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { hasTechnologies } from '../data/horizon'
import { layoutTechTree, techStates, CARD_W, CARD_H } from '../data/techTree'
import type { TechState } from '../data/techTree'
import {
  zoomAt, panBy, fitTransform, centerOn, transformCss, wheelZoomFactor, ZOOM_STEP,
} from '../utils/viewTransform'
import type { ViewTransform } from '../utils/viewTransform'
import { Modal } from './Modal'
import { TechCost } from './TechCost'
import { TechIcon } from './TechIcon'
import type { GameData, Technology } from '../data/types'

// ---------------------------------------------------------------------------
// Technology tree — pannable, zoomable graph of the technologies. Clicking a
// card toggles it as a research-horizon target, like the Horizon picker.
// ---------------------------------------------------------------------------

const CARD_CLASS: Record<TechState, string> = {
  researched: 'border-green-600 bg-green-900/40',
  available: 'border-amber-500 bg-amber-900/30',
  locked: 'border-gray-700 bg-gray-800 opacity-70',
}

const EDGE_COLOR: Record<TechState, string> = {
  researched: '#16a34a',
  available: '#f59e0b',
  locked: '#4b5563',
}

const CURVE = 32
const DRAG_THRESHOLD = 4

interface TechCardProps {
  tech: Technology
  x: number
  y: number
  state: TechState
  isTarget: boolean
  items: GameData['items']
  movedRef: MutableRefObject<boolean>
  onToggle: (id: string) => void
}

const TechCard = memo(function TechCard({ tech, x, y, state, isTarget, items, movedRef, onToggle }: TechCardProps) {
  return (
    <button
      type="button"
      data-testid="tech-card"
      data-tech-id={tech.id}
      data-state={state}
      data-target={isTarget ? 'true' : 'false'}
      aria-pressed={isTarget}
      title={tech.name}
      onClick={e => {
        // A drag that ended on this card suppresses its click; the flag is
        // consumed here so later (keyboard) activations are not ignored.
        // Keyboard activation (detail 0) is never a drag.
        const wasDrag = movedRef.current && e.detail !== 0
        movedRef.current = false
        if (!wasDrag) onToggle(tech.id)
      }}
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
      className={`absolute flex items-center gap-2 px-2 rounded border text-left text-gray-100 ${CARD_CLASS[state]} ${isTarget ? 'ring-2 ring-amber-300' : ''}`}
    >
      <TechIcon tech={tech} className="w-10 h-10 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{tech.name}</span>
        <TechCost cost={tech.cost} items={items} />
      </span>
    </button>
  )
})

function TechTreeModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const setTargets = useBlockStore(s => s.setHorizonTechnologyIds)

  const layout = useMemo(() => layoutTechTree(gameData.technologies), [gameData.technologies])
  const states = useMemo(() => techStates(gameData, targets), [gameData, targets])
  const validTargets = targets.filter(id => gameData.technologies[id])

  const [view, setView] = useState<ViewTransform>({ x: 24, y: 24, scale: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const movedRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number; captured: boolean; pointerId: number } | null>(null)

  // Open centred on the furthest target.
  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    let furthest: (typeof layout.nodes)[string] | undefined
    for (const id of validTargets) {
      const n = layout.nodes[id]
      if (n && (!furthest || n.column > furthest.column)) furthest = n
    }
    if (!furthest) return
    setView(centerOn(furthest.x + CARD_W / 2, furthest.y + CARD_H / 2, vp.clientWidth, vp.clientHeight, 1))
    // Initial view only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Native non-passive listener: React's onWheel is passive and cannot preventDefault.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = vp!.getBoundingClientRect()
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode)
      setView(t => zoomAt(t, factor, e.clientX - rect.left, e.clientY - rect.top))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || dragRef.current) return
    movedRef.current = false
    dragRef.current = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, captured: false, pointerId: e.pointerId }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    // Button released outside the viewport before capture started.
    if (e.buttons === 0 && e.pointerType === 'mouse') { endDrag(e); return }
    if (!movedRef.current && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) {
      movedRef.current = true
      // Capture only once dragging, so a plain click still reaches the card.
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.captured = true
    }
    if (!movedRef.current) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.x = e.clientX
    drag.y = e.clientY
    setView(t => panBy(t, dx, dy))
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current && e.pointerId !== dragRef.current.pointerId) return
    if (dragRef.current?.captured) e.currentTarget.releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    // The click that follows a drag's pointerup fires before this timer; after that the flag is stale.
    setTimeout(() => { movedRef.current = false }, 0)
  }

  function zoomBy(factor: number) {
    const vp = viewportRef.current
    const cx = vp ? vp.clientWidth / 2 : 0
    const cy = vp ? vp.clientHeight / 2 : 0
    setView(t => zoomAt(t, factor, cx, cy))
  }

  function fit() {
    const vp = viewportRef.current
    if (!vp) return
    setView(fitTransform(layout.width, layout.height, vp.clientWidth, vp.clientHeight))
  }

  // Reads the store at call time so the callback keeps one identity and TechCard's memo holds.
  const onToggle = useCallback((id: string) => {
    const { horizonTechnologyIds: current, setHorizonTechnologyIds } = useBlockStore.getState()
    setHorizonTechnologyIds(current.includes(id) ? current.filter(t => t !== id) : [...current, id])
  }, [])

  // Keyed so that panning (which only changes `view`) does not re-render the cards.
  const content = useMemo(() => (
    <>
      <svg width={layout.width} height={layout.height} className="absolute left-0 top-0 pointer-events-none" style={{ overflow: 'visible' }}>
        {layout.edges.map(e => (
          <path
            key={`${e.from}>${e.to}`}
            d={`M ${e.x1} ${e.y1} C ${e.x1 + CURVE} ${e.y1}, ${e.x2 - CURVE} ${e.y2}, ${e.x2} ${e.y2}`}
            fill="none"
            stroke={EDGE_COLOR[states[e.to]]}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      {Object.values(layout.nodes).map(n => (
        <TechCard
          key={n.id}
          tech={gameData.technologies[n.id]}
          x={n.x}
          y={n.y}
          state={states[n.id]}
          isTarget={targets.includes(n.id)}
          items={gameData.items}
          movedRef={movedRef}
          onToggle={onToggle}
        />
      ))}
    </>
  ), [layout, states, targets, gameData, onToggle])

  const btn = 'text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1'

  return (
    <Modal onClose={onClose} className="w-[96vw] h-[92vh] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-amber-200">Technology tree</h2>
        <span data-testid="tech-tree-horizon" className="text-xs text-gray-400">
          {validTargets.length === 0
            ? 'No horizon: every recipe is offered. Click a technology to research up to it.'
            : `Horizon: ${validTargets.length} ${validTargets.length === 1 ? 'target' : 'targets'}`}
        </span>
        <button
          type="button"
          disabled={targets.length === 0}
          onClick={() => setTargets([])}
          className="text-xs text-gray-400 hover:text-gray-100 disabled:opacity-40 disabled:hover:text-gray-400"
        >Clear horizon</button>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-green-600 bg-green-900/40" />Researched</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-amber-500 bg-amber-900/30" />Available</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-gray-700 bg-gray-800" />Locked</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} className={btn}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} className={btn}>+</button>
          <button type="button" aria-label="Fit to view" onClick={fit} className={btn}>Fit</button>
          <button type="button" onClick={onClose} className={`${btn} ml-2`}>Close</button>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-testid="tech-tree-viewport"
        className="relative flex-1 overflow-hidden cursor-grab touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Focusing an off-screen card scrolls this overflow-hidden box natively; that
        // offset is outside `view`, so undo it.
        onScroll={e => { e.currentTarget.scrollLeft = 0; e.currentTarget.scrollTop = 0 }}
      >
        <div
          data-testid="tech-tree-canvas"
          data-scale={String(view.scale)}
          style={{ transform: transformCss(view), transformOrigin: '0 0', width: layout.width, height: layout.height }}
          className="absolute left-0 top-0"
        >
          {content}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// TechTreeButton — top-bar entry point
// ---------------------------------------------------------------------------

export function TechTreeButton() {
  const gameData = useGameDataStore(selectGameData)
  const [open, setOpen] = useState(false)

  if (!gameData || !hasTechnologies(gameData)) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1"
        title="Show the technology tree"
      >
        Tech tree
      </button>
      {open && <TechTreeModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
