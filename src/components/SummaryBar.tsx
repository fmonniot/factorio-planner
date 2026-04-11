import { useState, useEffect, useRef } from 'react'
import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { iconUrl } from '../utils/iconUrl'
import type { SolverWarning, GameData } from '../data/types'

function fmtPower(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(2)} MW`
  return `${kw.toFixed(0)} kW`
}

function fmtRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0)
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

// ---------------------------------------------------------------------------
// FlowRow — outputs (main products + byproducts) → raw inputs
// ---------------------------------------------------------------------------

export function FlowRow() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const subPlan = useBlockStore(selectActiveSubPlan)

  if (!result || result.nodes.length === 0 || !gameData) return null

  // Compute net balance per item across all solved nodes.
  const netBalance = new Map<string, number>()
  for (const node of result.nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      netBalance.set(id, (netBalance.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      netBalance.set(id, (netBalance.get(id) ?? 0) - rate)
  }

  const goalIds = new Set((subPlan?.goals ?? []).map(g => g.itemId))

  const mainProducts = [...netBalance]
    .filter(([id, net]) => net > 0 && goalIds.has(id))
    .map(([id, net]) => ({ id, rate: net }))

  const byproducts = [...netBalance]
    .filter(([id, net]) => net > 0 && !goalIds.has(id))
    .map(([id, net]) => ({ id, rate: net }))

  const rawInputs = result.unsatisfied.filter(u => u.rate > 0)

  if (mainProducts.length === 0 && byproducts.length === 0 && rawInputs.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs min-w-0">
      {/* Main products — teal */}
      {mainProducts.map(({ id, rate }) => {
        const item = gameData.items[id]
        return (
          <span key={id} className="flex items-center gap-1 bg-teal-950 text-teal-300 px-1.5 py-0.5 rounded shrink-0">
            {item?.iconPath
              ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain" />
              : <span title={item?.name ?? id}>{item?.name ?? id}</span>
            }
            <span className="text-teal-400">{fmtRate(rate)}/min</span>
          </span>
        )
      })}

      {/* Byproducts — dimmer with marker */}
      {byproducts.map(({ id, rate }) => {
        const item = gameData.items[id]
        return (
          <span key={id} className="flex items-center gap-1 bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded shrink-0">
            <span className="text-gray-600 text-[10px]">↩</span>
            {item?.iconPath
              ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain opacity-60" />
              : <span title={item?.name ?? id}>{item?.name ?? id}</span>
            }
            <span className="text-gray-500">{fmtRate(rate)}/min</span>
          </span>
        )
      })}

      {/* Divider */}
      {rawInputs.length > 0 && (
        <>
          <span className="text-gray-600 mx-1 shrink-0">→</span>

          {/* Raw inputs — amber, pushed right */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {rawInputs.map(({ itemId, rate }) => {
              const item = gameData.items[itemId]
              return (
                <span key={itemId} className="flex items-center gap-1 bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded shrink-0">
                  {item?.iconPath
                    ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain" />
                    : <span title={item?.name ?? itemId}>{item?.name ?? itemId}</span>
                  }
                  <span className="text-amber-400">{fmtRate(rate)}/min</span>
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WarningsPopover — clickable badge that opens a details panel upward
// ---------------------------------------------------------------------------

function warningTitle(w: SolverWarning): string {
  switch (w.type) {
    case 'duplicate-recipe':    return 'Duplicate recipe'
    case 'underdetermined':     return 'Underdetermined system'
    case 'no-recipe':           return 'No producer'
    case 'productivity-not-allowed': return 'Productivity ignored'
    case 'cycle-detected':      return 'Recipe cycle'
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
    case 'duplicate-recipe':
      return 'Remove one of the duplicate nodes in the Nodes panel.'
    case 'underdetermined':
      return 'Add more goals, or pin a recipe rate (📍) to constrain the free variables.'
    case 'no-recipe':
      return 'Add a recipe node that outputs this item.'
    case 'productivity-not-allowed':
      return 'Remove productivity modules from this node.'
    case 'cycle-detected':
      return 'Pin one recipe\'s rate to anchor the cycle.'
  }
}

/** True for warning types that indicate a likely-wrong solver result. */
function isCritical(w: SolverWarning): boolean {
  return w.type === 'duplicate-recipe' || w.type === 'underdetermined'
}

function WarningsPopover({ warnings, gameData }: { warnings: SolverWarning[]; gameData: GameData }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hasCritical = warnings.some(isCritical)

  // Close on outside click or Escape.
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

  const badgeColor = hasCritical
    ? 'text-red-400 hover:text-red-300'
    : 'text-yellow-400 hover:text-yellow-300'

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
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

// ---------------------------------------------------------------------------
// SummaryBar — aggregate machine + power stats and warnings
// ---------------------------------------------------------------------------

export function SummaryBar() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)

  if (!result || result.nodes.length === 0) {
    return (
      <div className="h-14 flex items-center px-4 text-gray-600 text-sm">
        No active plan
      </div>
    )
  }

  const totalMachines = result.nodes.reduce((sum, n) => sum + n.machineCountCeil, 0)
  const totalPower = result.nodes.reduce((sum, n) => sum + n.powerKw, 0)

  return (
    <div className="h-auto min-h-14 flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm">
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Machines:</span>
        <span className="font-medium text-gray-100">{totalMachines}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Power:</span>
        <span className="font-medium text-gray-100">{fmtPower(totalPower)}</span>
      </div>

      {result.warnings.length > 0 && gameData && (
        <WarningsPopover warnings={result.warnings} gameData={gameData} />
      )}
    </div>
  )
}
