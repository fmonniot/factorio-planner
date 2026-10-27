import { useState, useRef, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSolverStore, selectBlockResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { RateUnit } from '../../store/uiStore'
import { blockAreas } from '../../solver/areas'
import { areaName } from './areaRows'
import { fmtRate } from './ItemTile'
import type { SolverWarning, GameData, SubPlan } from '../../data/types'

// ---------------------------------------------------------------------------
// Warning helpers (same logic as old SummaryBar)
// ---------------------------------------------------------------------------

function warningTitle(w: SolverWarning): string {
  switch (w.type) {
    case 'no-recipe': return 'No recipe in plan'
    case 'duplicate-recipe': return 'Duplicate recipe'
    case 'infeasible-pins': return 'Pinned rate is impossible'
    case 'overconstrained': return "Recipe network can't fully balance"
    case 'area-shortfall': return "Area can't cover its own need"
    case 'loop-not-converged': return 'Loop between blocks did not settle'
    case 'request-loop-not-converged': return 'Requests around a loop do not settle'
  }
}

function warningBody(
  w: SolverWarning,
  gameData: GameData,
  blockName: (id: string) => string,
  rootPlan: SubPlan | undefined,
  rateUnit: RateUnit,
): string {
  switch (w.type) {
    case 'no-recipe': {
      const name = gameData.items[w.itemId]?.name ?? w.itemId
      return `No active recipe produces "${name}". It is treated as a raw input.`
    }
    case 'duplicate-recipe': {
      const name = gameData.recipes[w.recipeId]?.name ?? w.recipeId
      if (w.areaId !== undefined && rootPlan) {
        return `"${name}" appears on ${w.count} rows in ${areaName(rootPlan, w.areaId)}. The solver uses the first one; the others show zero and their pin and modules are ignored.`
      }
      return `"${name}" appears on ${w.count} nodes. The solver uses the first one; the others show zero and their pin and modules are ignored.`
    }
    case 'infeasible-pins': {
      const names = w.recipeIds.map(id => gameData.recipes[id]?.name ?? id)
      return `The pinned rate on ${names.join(', ')} can't be reached given the other recipes. Goals will not be met.`
    }
    case 'overconstrained': {
      const names = w.surplusItems.map(si => gameData.items[si.itemId]?.name ?? si.itemId)
      return `The internal flows of ${names.join(', ')} can't all balance — the surplus is shown as a byproduct.`
    }
    case 'area-shortfall': {
      const unit = rateUnit === 'min' ? '/m' : '/s'
      return w.shortfalls
        .map(s => {
          const area = rootPlan ? areaName(rootPlan, s.areaId) : s.areaId
          const item = gameData.items[s.itemId]?.name ?? s.itemId
          return `${area} takes ${fmtRate(s.rate / 60, rateUnit)}${unit} of ${item} from other areas, though it has its own row for it.`
        })
        .join(' ')
    }
    case 'loop-not-converged': {
      const names = [...w.blockIds, w.blockIds[0]].map(blockName)
      return `The supply around the loop ${names.join(' → ')} still changed after ${w.rounds} rounds. Rates are from the last round and may not add up.`
    }
    case 'request-loop-not-converged': {
      const names = [...w.blockIds, w.blockIds[0]].map(blockName)
      return `The requests around the loop ${names.join(' → ')} did not settle after ${w.rounds} rounds: the blocks need more of each other than the loop can give back. The requests that close the loop only take what is left over.`
    }
  }
}

function warningHint(w: SolverWarning): string {
  switch (w.type) {
    case 'no-recipe': return 'Add a recipe node that outputs this item.'
    case 'duplicate-recipe':
      return w.areaId !== undefined
        ? 'Remove the duplicate rows from that area, or make one of their sub-factories a separate area.'
        : 'Remove the duplicate nodes from the production table.'
    case 'infeasible-pins': return 'Unpin it, or change which recipes are active.'
    case 'area-shortfall': return 'Unpin that row, or allow imports of its inputs.'
    case 'overconstrained': return 'Two recipes likely share a material loop with incompatible ratios.'
    case 'loop-not-converged': return "Remove one of the loop's connections, or set a limit on one."
    case 'request-loop-not-converged': return "Set a limit on one of the loop's requests, or remove one."
  }
}

function isCritical(w: SolverWarning): boolean {
  return w.type === 'infeasible-pins'
}

// ---------------------------------------------------------------------------
// WarningsPopover
// ---------------------------------------------------------------------------

export function WarningsPopover() {
  const gameData = useGameDataStore(selectGameData)
  const block = useBlockStore(selectActiveBlock)
  const result = useSolverStore(selectBlockResult(block?.id))
  const removeNode = useBlockStore(s => s.removeNode)
  const rateUnit = useUiStore(s => s.rateUnit)
  // Only ids and names are read; a flat array keeps the popover from re-rendering on every plan edit.
  const idNames = useBlockStore(useShallow(s => s.blocks.flatMap(b => [b.id, b.name])))
  const blockName = (id: string) => {
    const i = idNames.indexOf(id)
    return i >= 0 && i % 2 === 0 ? idNames[i + 1] : id
  }
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const warnings = result?.warnings ?? []

  function fixDuplicateRecipe(recipeId: string, areaId?: string) {
    if (!block) return
    const b = block
    let kept = false
    if (areaId !== undefined) {
      // The duplicates are those of one area: rows of the same recipe in other areas stay.
      const nodeIds = blockAreas(b.rootPlan)?.find(a => a.id === areaId)?.nodeIds ?? []
      const rows = new Map<string, string>()
      function collect(plan: typeof b.rootPlan) {
        for (const n of plan.nodes) if (n.kind === 'game-recipe') rows.set(n.id, n.recipeId)
        for (const sp of plan.subPlans) collect(sp)
      }
      collect(b.rootPlan)
      for (const id of nodeIds) {
        if (rows.get(id) !== recipeId) continue
        if (!kept) { kept = true } else { removeNode(id) }
      }
      return
    }
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
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false) }
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
  const badgeColor = hasCritical
    ? 'bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20'
    : 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/20'

  return (
    <div ref={ref} className="relative shrink-0 mr-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-1 h-7 px-2.5 rounded-full border text-xs ${badgeColor}`}
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
                  {warningBody(w, gameData, blockName, block?.rootPlan, rateUnit)}
                </div>
                <div className="text-gray-500 leading-snug">
                  → {warningHint(w)}
                </div>
                {w.type === 'duplicate-recipe' && (
                  <button
                    type="button"
                    onClick={() => fixDuplicateRecipe(w.recipeId, w.areaId)}
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
