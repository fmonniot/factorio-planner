import { useState, useRef, useEffect } from 'react'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import type { SolverWarning, GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Warning helpers (same logic as old SummaryBar)
// ---------------------------------------------------------------------------

function warningTitle(w: SolverWarning): string {
  switch (w.type) {
    case 'duplicate-recipe': return 'Duplicate recipe'
    case 'underdetermined': return 'Underdetermined system'
    case 'no-recipe': return 'No producer'
    case 'productivity-not-allowed': return 'Productivity ignored'
    case 'cycle-detected': return 'Recipe cycle'
  }
}

function warningBody(w: SolverWarning, gameData: GameData): string {
  switch (w.type) {
    case 'duplicate-recipe': {
      const name = gameData.recipes[w.recipeId]?.name ?? w.recipeId
      return `"${name}" appears on ${w.count} nodes. The solver merges them into one column.`
    }
    case 'underdetermined':
      return 'The system has more recipe columns than constraints; the minimum-norm solution may not match your intent.'
    case 'no-recipe': {
      const name = gameData.items[w.itemId]?.name ?? w.itemId
      return `No active recipe produces "${name}".`
    }
    case 'productivity-not-allowed': {
      const name = gameData.recipes[w.recipeId]?.name ?? w.recipeId
      return `"${name}" does not allow productivity modules; the bonus was ignored.`
    }
    case 'cycle-detected': {
      const names = w.recipeIds.map(id => gameData.recipes[id]?.name ?? id)
      return `Recipes form a cycle: ${names.join(' → ')}.`
    }
  }
}

function warningHint(w: SolverWarning): string {
  switch (w.type) {
    case 'duplicate-recipe': return 'Remove one of the duplicate nodes in the production table.'
    case 'underdetermined': return 'Add more goals, or pin a recipe rate to constrain the free variables.'
    case 'no-recipe': return 'Add a recipe node that outputs this item.'
    case 'productivity-not-allowed': return 'Remove productivity modules from this node.'
    case 'cycle-detected': return "Pin one recipe's rate to anchor the cycle."
  }
}

function isCritical(w: SolverWarning): boolean {
  return w.type === 'duplicate-recipe' || w.type === 'underdetermined'
}

// ---------------------------------------------------------------------------
// WarningsPopover
// ---------------------------------------------------------------------------

export function WarningsPopover() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const warnings = result?.warnings ?? []

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (warnings.length === 0 || !gameData) return null

  const hasCritical = warnings.some(isCritical)
  const badgeColor = hasCritical ? 'text-red-400 hover:text-red-300' : 'text-yellow-400 hover:text-yellow-300'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-xs ${badgeColor}`}
        title="Show solver warnings"
      >
        <span>⚠</span>
        <span>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
        <span className="text-[10px] opacity-60">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-xs z-50">
          <div className="px-3 py-2 border-b border-gray-700 font-medium text-gray-300">
            Solver warnings
          </div>
          <div className="max-h-96 overflow-y-auto">
            {warnings.map((w, i) => (
              <div
                key={i}
                className={`px-3 py-2 ${i < warnings.length - 1 ? 'border-b border-gray-800' : ''}`}
              >
                <div className={`font-medium mb-0.5 ${isCritical(w) ? 'text-red-400' : 'text-yellow-400'}`}>
                  ⚠ {warningTitle(w)}
                </div>
                <div className="text-gray-300 leading-snug mb-1">
                  {warningBody(w, gameData)}
                </div>
                <div className="text-gray-500 leading-snug">
                  → {warningHint(w)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
