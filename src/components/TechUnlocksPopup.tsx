import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { technologyUnlocks } from '../data/horizon'
import { recipeIconItem } from '../data/recipeIcon'
import { anchoredPosition } from '../utils/anchoredPosition'
import type { Box } from '../utils/anchoredPosition'
import { Icon } from './Icon'
import { TechCost } from './TechCost'
import { TechIcon } from './TechIcon'
import type { GameData, Technology } from '../data/types'

// ---------------------------------------------------------------------------
// TechUnlocksPopup — what a technology unlocks, shown while its tech tree card
// is hovered or focused. Rendered in a portal: the scaled canvas and the modal
// clip their contents.
// ---------------------------------------------------------------------------

export const PREVIEW_LIMIT = 8

interface TechUnlocksPopupProps {
  tech: Technology
  /** The card's bounding rect when the popup was requested. */
  anchor: Box
  gameData: GameData
  placers: ReadonlyMap<string, string[]>
}

function IconSlot({ iconPath }: { iconPath: string | undefined }) {
  return iconPath
    ? <Icon iconPath={iconPath} alt="" draggable={false} className="w-6 h-6 object-contain shrink-0" />
    : <span className="w-6 h-6 shrink-0" />
}

export function TechUnlocksPopup({ tech, anchor, gameData, placers }: TechUnlocksPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top })

  // Measure, then flip or clamp into the viewport before paint.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos(anchoredPosition(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchor])

  const { recipes, machines } = useMemo(
    () => technologyUnlocks(gameData, tech.id, placers),
    [gameData, tech.id, placers],
  )

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      data-testid="tech-unlocks-popup"
      data-tech-id={tech.id}
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
      className="pointer-events-none z-[60] flex flex-col w-72 max-h-[80vh] overflow-hidden bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-sm"
    >
      <div className="shrink-0 px-3 py-2 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
        <TechIcon tech={tech} className="w-8 h-8 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-gray-100">{tech.name}</span>
          <TechCost cost={tech.cost} items={gameData.items} />
        </span>
      </div>

      <div data-testid="tech-unlocks-recipes" className="flex-1 min-h-0 overflow-hidden px-3 py-2">
        {recipes.length === 0 ? (
          <div className="text-gray-500">Unlocks no recipes</div>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-1">Recipes:</div>
            {recipes.slice(0, PREVIEW_LIMIT).map(r => (
              <div key={r.id} data-testid="tech-unlocks-recipe" data-recipe-id={r.id} className="flex items-center gap-2">
                <IconSlot iconPath={recipeIconItem(gameData, r)?.iconPath} />
                <span className="truncate text-gray-200">{r.name}</span>
              </div>
            ))}
            {recipes.length > PREVIEW_LIMIT && (
              <div data-testid="tech-unlocks-more" className="text-xs text-gray-400">+{recipes.length - PREVIEW_LIMIT} more</div>
            )}
          </>
        )}
      </div>

      {machines.length > 0 && (
        <div data-testid="tech-unlocks-machines" className="shrink-0 px-3 py-2 border-t border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Machines:</div>
          {machines.slice(0, PREVIEW_LIMIT).map(m => (
            <div key={m.id} data-testid="tech-unlocks-machine" data-machine-id={m.id} className="flex items-center gap-2">
              <IconSlot iconPath={m.iconPath} />
              <span className="truncate text-gray-200">{m.name}</span>
            </div>
          ))}
          {machines.length > PREVIEW_LIMIT && (
            <div data-testid="tech-unlocks-more" className="text-xs text-gray-400">+{machines.length - PREVIEW_LIMIT} more</div>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
