import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { useAvailableRecipeIds } from '../store/horizon'
import { hasTechnologies, placingItemIds } from '../data/horizon'
import { layoutTechTree, techStates, searchTechnologies, CARD_W, CARD_H } from '../data/techTree'
import type { TechState } from '../data/techTree'
import {
  zoomAt, panBy, fitTransform, centerOn, transformCss, wheelZoomFactor, ZOOM_STEP,
} from '../utils/viewTransform'
import type { ViewTransform } from '../utils/viewTransform'
import type { Box } from '../utils/anchoredPosition'
import { Modal } from './Modal'
import { TechCost } from './TechCost'
import { TechIcon } from './TechIcon'
import { TechUnlocksPopup } from './TechUnlocksPopup'
import { IconButton } from './IconButton'
import { FlaskIcon } from './icons'
import type { GameData, Technology } from '../data/types'

// ---------------------------------------------------------------------------
// Technology tree — pannable, zoomable graph of the technologies. Clicking a
// card toggles it as a research-horizon target. It is the one place to edit the
// horizon: the top bar's tech tree button and the horizon flag both open it.
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
const PREVIEW_DELAY_MS = 300
// Leaving a card keeps a shown popup this long, so entering a neighbour switches without the delay.
const HIDE_GRACE_MS = 100
// Choosing a search result centres its card at this scale.
const JUMP_SCALE = 1
const HIGHLIGHT_MS = 1500
const MAX_SEARCH_RESULTS = 50

function rectOf(el: HTMLElement): Box {
  const { left, top, right, bottom } = el.getBoundingClientRect()
  return { left, top, right, bottom }
}

interface TechCardProps {
  tech: Technology
  x: number
  y: number
  state: TechState
  isTarget: boolean
  isHighlight: boolean
  items: GameData['items']
  movedRef: MutableRefObject<boolean>
  onToggle: (id: string) => void
  onPreviewStart: (id: string, el: HTMLElement, immediate: boolean) => void
  onPreviewEnd: (id: string, immediate?: boolean) => void
}

const TechCard = memo(function TechCard({ tech, x, y, state, isTarget, isHighlight, items, movedRef, onToggle, onPreviewStart, onPreviewEnd }: TechCardProps) {
  return (
    <button
      type="button"
      data-testid="tech-card"
      data-tech-id={tech.id}
      data-state={state}
      data-target={isTarget ? 'true' : 'false'}
      data-highlight={isHighlight ? 'true' : 'false'}
      aria-pressed={isTarget}
      onMouseEnter={e => onPreviewStart(tech.id, e.currentTarget, false)}
      onMouseLeave={() => onPreviewEnd(tech.id)}
      onFocus={e => onPreviewStart(tech.id, e.currentTarget, true)}
      onBlur={() => onPreviewEnd(tech.id, true)}
      onClick={e => {
        // Keyboard activation (detail 0) keeps the popup: the card keeps focus.
        if (e.detail > 0) onPreviewEnd(tech.id, true)
        // A drag that ended on this card suppresses its click; the flag is
        // consumed here so later (keyboard) activations are not ignored.
        // Keyboard activation (detail 0) is never a drag.
        const wasDrag = movedRef.current && e.detail !== 0
        movedRef.current = false
        if (!wasDrag) onToggle(tech.id)
      }}
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
      className={`absolute flex items-center gap-2 px-2 rounded border text-left text-gray-100 ${CARD_CLASS[state]} ${isHighlight ? 'ring-4 ring-sky-300 animate-pulse' : isTarget ? 'ring-2 ring-amber-300' : ''}`}
    >
      <TechIcon tech={tech} className="w-10 h-10 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{tech.name}</span>
        <TechCost cost={tech.cost} items={items} />
      </span>
    </button>
  )
})

interface TechSearchProps {
  technologies: GameData['technologies']
  query: string
  onQueryChange: (query: string) => void
  onPick: (id: string) => void
}

function TechSearch({ technologies, query, onQueryChange, onPick }: TechSearchProps) {
  const results = useMemo(() => searchTechnologies(technologies, query), [technologies, query])
  const shown = results.slice(0, MAX_SEARCH_RESULTS)
  const hidden = results.length - shown.length
  const active = query.trim() !== ''

  return (
    <div className="relative mr-2">
      <input
        type="text"
        value={query}
        placeholder="Search technologies…"
        aria-label="Search technologies"
        data-testid="tech-tree-search"
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && shown.length > 0) {
            e.preventDefault()
            onPick(shown[0].id)
          }
        }}
        className="w-48 bg-gray-800 text-gray-100 px-3 py-1 rounded text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
      />
      {active && (
        <div
          role="listbox"
          aria-label="Matching technologies"
          data-testid="tech-tree-search-results"
          className="absolute right-0 top-full mt-1 z-10 w-72 max-w-[calc(100vw-2rem)] max-h-64 overflow-y-auto bg-gray-900 border border-gray-600 rounded shadow-lg py-1"
        >
          {shown.map(t => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={false}
              data-testid="tech-tree-search-result"
              data-tech-id={t.id}
              // Keep the input focused: a click on a result must not blur it.
              onMouseDown={e => e.preventDefault()}
              onClick={() => onPick(t.id)}
              className="w-full flex items-center gap-2 px-2 py-1 text-left text-sm text-gray-100 hover:bg-gray-800"
            >
              <TechIcon tech={t} className="w-6 h-6 text-xs" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
            </button>
          ))}
          {hidden > 0 && <div className="px-2 py-1 text-xs text-gray-400">{hidden} more — refine the search</div>}
          {results.length === 0 && (
            <div data-testid="tech-tree-search-empty" className="px-2 py-1 text-sm text-gray-400">No matching technologies</div>
          )}
        </div>
      )}
    </div>
  )
}

export function TechTreeModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const setTargets = useBlockStore(s => s.setHorizonTechnologyIds)

  const layout = useMemo(() => layoutTechTree(gameData.technologies), [gameData.technologies])
  const states = useMemo(() => techStates(gameData, targets), [gameData, targets])
  const validTargets = targets.filter(id => gameData.technologies[id])
  const available = useAvailableRecipeIds()

  const { visibleCount, availableCount } = useMemo(() => {
    const visible = Object.values(gameData.recipes).filter(r => !r.hidden)
    return {
      visibleCount: visible.length,
      availableCount: available ? visible.filter(r => available.has(r.id)).length : visible.length,
    }
  }, [gameData, available])

  const [view, setView] = useState<ViewTransform>({ x: 24, y: 24, scale: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const movedRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number; captured: boolean; pointerId: number } | null>(null)

  // The unlocks popup. Only the modal re-renders on a change: the memoized cards never see this state.
  const [preview, setPreview] = useState<{ techId: string; anchor: Box } | null>(null)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointerDownRef = useRef(false) // any button, anywhere in the viewport
  const previewIdRef = useRef<string | null>(null) // pending or shown
  const previewShownRef = useRef(false)
  const placers = useMemo(() => placingItemIds(gameData), [gameData])

  const hidePreview = useCallback(() => {
    clearTimeout(previewTimerRef.current)
    clearTimeout(graceTimerRef.current)
    previewIdRef.current = null
    previewShownRef.current = false
    setPreview(null)
  }, [])

  const onPreviewStart = useCallback((id: string, el: HTMLElement, immediate: boolean) => {
    // A pressed button means a drag, or the focus a mouse click causes.
    if (dragRef.current !== null || pointerDownRef.current) return
    // A card outside the visible canvas would anchor the popup to an edge with no card beside it.
    if (immediate) {
      const vp = viewportRef.current
      if (vp) {
        const c = el.getBoundingClientRect()
        const v = vp.getBoundingClientRect()
        if (c.right <= v.left || c.left >= v.right || c.bottom <= v.top || c.top >= v.bottom) return
      }
    }
    clearTimeout(previewTimerRef.current)
    clearTimeout(graceTimerRef.current)
    previewIdRef.current = id
    const show = () => {
      previewShownRef.current = true
      setPreview({ techId: id, anchor: rectOf(el) })
    }
    if (immediate || previewShownRef.current) show()
    else previewTimerRef.current = setTimeout(show, PREVIEW_DELAY_MS)
  }, [])

  const onPreviewEnd = useCallback((id: string, immediate = false) => {
    if (previewIdRef.current !== id) return
    if (immediate || !previewShownRef.current) { hidePreview(); return }
    // Keep `previewShownRef` through the grace period: the next card's mouseenter shows at once.
    clearTimeout(graceTimerRef.current)
    graceTimerRef.current = setTimeout(hidePreview, HIDE_GRACE_MS)
  }, [hidePreview])

  useEffect(() => () => {
    clearTimeout(previewTimerRef.current)
    clearTimeout(graceTimerRef.current)
  }, [])

  // Any button press suppresses the popup until release, wherever the release happens.
  useEffect(() => {
    const release = () => { pointerDownRef.current = false }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])

  // The anchor goes stale when the window changes.
  useEffect(() => {
    window.addEventListener('blur', hidePreview)
    window.addEventListener('resize', hidePreview)
    return () => {
      window.removeEventListener('blur', hidePreview)
      window.removeEventListener('resize', hidePreview)
    }
  }, [hidePreview])

  // Escape dismisses the popup before it closes the modal: stop it in the capture phase, ahead of Modal's window listener.
  const previewOpen = preview !== null
  useEffect(() => {
    if (!previewOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      hidePreview()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [previewOpen, hidePreview])

  // Search: choosing a result centres its card and pulses it briefly; the horizon is untouched.
  const [query, setQuery] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(highlightTimerRef.current), [])

  // Escape clears the search box before it closes the modal (the popup's own handler, registered earlier, runs first).
  const searching = query !== ''
  useEffect(() => {
    if (!searching || previewOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setQuery('')
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [searching, previewOpen])

  const pickResult = useCallback((id: string) => {
    const node = layout.nodes[id]
    if (!node) return
    hidePreview()
    const vp = viewportRef.current
    if (vp) setView(centerOn(node.x + CARD_W / 2, node.y + CARD_H / 2, vp.clientWidth, vp.clientHeight, JUMP_SCALE))
    setQuery('')
    setHighlightId(id)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
  }, [layout, hidePreview])

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
      hidePreview()
      const rect = vp!.getBoundingClientRect()
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode)
      setView(t => zoomAt(t, factor, e.clientX - rect.left, e.clientY - rect.top))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [hidePreview])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    hidePreview()
    setQuery('')
    pointerDownRef.current = true
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
    hidePreview()
    const vp = viewportRef.current
    const cx = vp ? vp.clientWidth / 2 : 0
    const cy = vp ? vp.clientHeight / 2 : 0
    setView(t => zoomAt(t, factor, cx, cy))
  }

  function fit() {
    hidePreview()
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
          isHighlight={n.id === highlightId}
          items={gameData.items}
          movedRef={movedRef}
          onToggle={onToggle}
          onPreviewStart={onPreviewStart}
          onPreviewEnd={onPreviewEnd}
        />
      ))}
    </>
  ), [layout, states, targets, highlightId, gameData, onToggle, onPreviewStart, onPreviewEnd])

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
        <span data-testid="tech-tree-recipe-count" className="text-xs text-gray-400">
          {availableCount} of {visibleCount} recipes available
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
          <TechSearch technologies={gameData.technologies} query={query} onQueryChange={setQuery} onPick={pickResult} />
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

      {preview && gameData.technologies[preview.techId] && (
        <TechUnlocksPopup tech={gameData.technologies[preview.techId]} anchor={preview.anchor} gameData={gameData} placers={placers} />
      )}
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
      <IconButton label="Tech tree" onClick={() => setOpen(true)}>
        <FlaskIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <TechTreeModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
