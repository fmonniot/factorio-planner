import { useState, useRef, useEffect } from 'react'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import type { SolverWarning, GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Warning helpers (same logic as old SummaryBar)
// ---------------------------------------------------------------------------

function warningTitle(w: SolverWarning): string {
  switch (w.type) {
    case 'no-recipe': return 'No recipe in plan'
    case 'duplicate-recipe': return 'Duplicate recipe'
    case 'infeasible-pins': return 'Pinned rate is impossible'
    case 'overconstrained': return "Recipe network can't fully balance"
  }
}

function warningBody(w: SolverWarning, gameData: GameData): string {
  switch (w.type) {
    case 'no-recipe': {
      const name = gameData.items[w.itemId]?.name ?? w.itemId
      return `No active recipe produces "${name}". It is treated as a raw input.`
    }
    case 'duplicate-recipe': {
      const name = gameData.recipes[w.recipeId]?.name ?? w.recipeId
      return `"${name}" appears on ${w.count} nodes. The solver merges them into one column.`
    }
    case 'infeasible-pins': {
      const names = w.recipeIds.map(id => gameData.recipes[id]?.name ?? id)
      return `The pinned rate on ${names.join(', ')} can't be reached given the other recipes. Goals will not be met.`
    }
    case 'overconstrained': {
      const names = w.surplusItems.map(si => gameData.items[si.itemId]?.name ?? si.itemId)
      return `The internal flows of ${names.join(', ')} can't all balance — the surplus is shown as a byproduct.`
    }
  }
}

function warningHint(w: SolverWarning): string {
  switch (w.type) {
    case 'no-recipe': return 'Add a recipe node that outputs this item.'
    case 'duplicate-recipe': return 'Remove one of the duplicate nodes in the production table.'
    case 'infeasible-pins': return 'Unpin it, or change which recipes are active.'
    case 'overconstrained': return 'Two recipes likely share a material loop with incompatible ratios.'
  }
}

function isCritical(w: SolverWarning): boolean {
  return w.type === 'infeasible-pins'
}

// ---------------------------------------------------------------------------
// WarningsPopover
// ---------------------------------------------------------------------------

export function WarningsPopover() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const block = useBlockStore(selectActiveBlock)
  const removeNode = useBlockStore(s => s.removeNode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const warnings = result?.warnings ?? []

  function fixDuplicateRecipe(recipeId: string) {
    if (!block) return
    const b = block
    let kept = false
    function walk(plan: typeof b.rootPlan) {
      for (const n of plan.nodes) {
        if (n.kind === 'game-recipe' && n.recipeId === recipeId) {
          if (!kept) { kept = true } else { removeNode(n.id) }
        }
      }
      for (const sp of plan.subPlans) walk(sp)
    }
    walk(b.rootPlan)
  }

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
        <div className="absolute top-full right-0 mt-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-xs z-50">
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
                {w.type === 'duplicate-recipe' && (
                  <button
                    type="button"
                    onClick={() => fixDuplicateRecipe(w.recipeId)}
                    className="mt-1.5 text-teal-400 hover:text-teal-300 underline"
                  >
                    Fix: remove duplicates
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
