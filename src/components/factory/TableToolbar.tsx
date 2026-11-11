import { useState, useRef, useEffect } from 'react'
import { useOverlayOpen } from './sidePanel/useDismiss'
import { useShallow } from 'zustand/react/shallow'
import { useUiStore } from '../../store/uiStore'
import type { RateUnit } from '../../store/uiStore'
import { useSolverStore, selectBlockResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { blockAreas } from '../../solver/areas'
import { areaName } from '../../data/subPlanTree'
import type { SolvedNode, SubPlan, SolverWarning, GameData } from '../../data/types'
import { fmtPower, fmtItemRateText } from './ItemTile'
import { fmtTemperatureWarning } from './temperature'
import { countSubPlanContents } from './subPlanContents'
import { warningTargets } from './warningTargets'

// ---------------------------------------------------------------------------
// TableToolbar — the row just above the production table: add a recipe, filter, rate unit, and on
// the right the block's solver-warnings pill and totals. Its totals replace the table's former
// Power header total.
// ---------------------------------------------------------------------------

interface TableToolbarProps {
  rootPlan: SubPlan | undefined
  /** Every solved row of the block, at every depth. */
  solvedNodes: SolvedNode[]
  onAddRecipe: () => void
  /** The table filter: the query is owned by the table; `hidden` of `total` rows are out while it is non-blank. */
  filter: { query: string; onQueryChange: (query: string) => void; hidden: number; total: number }
}

const RATE_UNITS: { unit: RateUnit; label: string }[] = [
  { unit: 'min', label: '/min' },
  { unit: 'sec', label: '/sec' },
]

export function TableToolbar({ rootPlan, solvedNodes, onAddRecipe, filter }: TableToolbarProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)

  const recipes = rootPlan ? countSubPlanContents(rootPlan).recipes : 0
  const machines = solvedNodes.reduce((sum, n) => sum + n.machineCountCeil, 0)
  const powerKw = solvedNodes.reduce((sum, n) => sum + n.powerKw, 0)
  const power = powerKw > 0 ? fmtPower(powerKw) : null

  return (
    <div data-testid="table-toolbar" className="relative flex items-center gap-1 md:gap-2.5 h-11 px-2.5 shrink-0 border-b border-gray-800 bg-gray-900 text-xs">
      <button
        type="button"
        onClick={onAddRecipe}
        aria-label="Add recipe"
        className="h-[26px] max-md:shrink-0 max-md:whitespace-nowrap px-2.5 rounded-md bg-teal-500 hover:bg-teal-400 text-teal-950 font-bold"
      >
        + Recipe
      </button>

      <label className="relative hidden md:inline-flex items-center">
        <span className="sr-only">Filter recipes or items</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="absolute left-2 pointer-events-none">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-gray-400" />
          <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.3" className="text-gray-400" />
        </svg>
        <input
          type="search"
          placeholder="Filter recipes or items"
          value={filter.query}
          onChange={e => filter.onQueryChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && filter.query !== '') {
              e.preventDefault()
              filter.onQueryChange('')
            }
          }}
          className="w-[260px] h-[26px] box-border pl-6 pr-2 rounded-md bg-gray-950 border border-gray-700 text-gray-100 placeholder:text-gray-400"
        />
      </label>

      {filter.query.trim() !== '' && (
        <span role="status" data-testid="table-filter-status" className="inline-flex items-center gap-1 md:gap-1.5 text-[11px] text-gray-400 whitespace-nowrap shrink-0">
          {/* Below md the words shrink to "N hidden" so the toolbar fits a phone; the full text stays for assistive technology. */}
          <span aria-hidden className="md:hidden">{filter.hidden} hidden</span>
          <span className="max-md:sr-only">{filter.hidden} of {filter.total} rows hidden</span>
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => filter.onQueryChange('')}
            className="text-teal-400 hover:text-teal-300 underline"
          >
            Clear
          </button>
        </span>
      )}

      <span role="group" aria-label="Rate unit" className="inline-flex max-md:shrink-0 max-md:whitespace-nowrap rounded-md border border-gray-700 overflow-hidden text-[11px]">
        {RATE_UNITS.map(({ unit, label }) => (
          <button
            key={unit}
            type="button"
            aria-pressed={rateUnit === unit}
            onClick={() => setRateUnit(unit)}
            className={`px-2.5 py-0.5 ${rateUnit === unit ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </span>

      <span className="ml-auto flex max-md:shrink-0 items-center gap-2 md:gap-4 text-[11px] text-gray-400 max-md:whitespace-nowrap">
        <WarningsPopover />
        {/* While a filter is active the phone-width toolbar is full: the status chip stands in for the recipe count. */}
        <span data-testid="block-recipe-count" className={filter.query.trim() !== '' ? 'max-md:hidden' : undefined}>
          <span className="font-mono tabular-nums text-gray-100">{recipes}</span> {recipes === 1 ? 'recipe' : 'recipes'}
        </span>
        <span data-testid="block-machine-count" className="hidden md:inline">
          <span className="font-mono tabular-nums text-gray-100">{machines}</span> {machines === 1 ? 'machine' : 'machines'}
        </span>
        {power && (
          <span
            data-testid="block-power-total"
            role="img"
            title="Total power draw of the block"
            aria-label={`Total power draw, ${power.value} ${power.unit}`}
            className="font-mono tabular-nums text-cyan-300"
          >
            ⚡ {power.value}<span className="opacity-60">{power.unit}</span>
          </span>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Warning helpers (same logic as old SummaryBar)
// ---------------------------------------------------------------------------

function fmtShare(share: number): string {
  return share < 0.01 ? 'under 1%' : `about ${Math.round(share * 100)}%`
}

function warningTitle(w: SolverWarning): string {
  switch (w.type) {
    case 'no-recipe': return 'No recipe in plan'
    case 'duplicate-recipe': return 'Duplicate recipe'
    case 'infeasible-pins': return 'Pinned rate is impossible'
    case 'overconstrained': return "Recipe network can't fully balance"
    case 'coproduct-driven': return 'Recipe runs for its co-product'
    case 'area-shortfall': return "Area can't cover its own need"
    case 'loop-not-converged': return 'Loop between blocks did not settle'
    case 'request-loop-not-converged': return 'Requests around a loop do not settle'
    case 'temperature-mismatch': return 'Fluid temperature does not fit'
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
    case 'coproduct-driven': {
      return w.drivers
        .map(d => {
          const recipe = gameData.recipes[d.recipeId]?.name ?? d.recipeId
          const items = d.itemIds.map(id => gameData.items[id]?.name ?? id).join(', ')
          return `"${recipe}" runs mainly to make ${items} as a co-product. Its other outputs would only need ${fmtShare(d.needed / d.throughput)} of its current rate, so the rest of them is surplus.`
        })
        .join(' ')
    }
    case 'area-shortfall': {
      return w.shortfalls
        .map(s => {
          const area = rootPlan ? areaName(rootPlan, s.areaId) : s.areaId
          const item = gameData.items[s.itemId]?.name ?? s.itemId
          return `${area} takes ${fmtItemRateText(s.itemId, s.rate / 60, rateUnit)} of ${item} from other areas, though it has its own row for it.`
        })
        .join(' ')
    }
    case 'loop-not-converged': {
      const names = [...w.blockIds, w.blockIds[0]].map(blockName)
      return `The supply around the loop ${names.join(' → ')} still changed after ${w.rounds} rounds. Rates are from the last round and may not add up.`
    }
    case 'temperature-mismatch': return fmtTemperatureWarning(w, gameData, r => fmtItemRateText(w.itemId, r / 60, rateUnit))
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
    case 'area-shortfall': return 'Unpin that row, or turn Import on for its inputs.'
    case 'overconstrained': return 'Two recipes likely share a material loop with incompatible ratios.'
    case 'coproduct-driven': return "Add an extraction or other row that supplies the co-product, set it to Only what's already made (right-click it on a row, then Comes from…), or pin the recipe's rate."
    case 'loop-not-converged': return "Remove one of the loop's connections, or set a limit on one."
    case 'request-loop-not-converged': return "Set a limit on one of the loop's requests, or remove one."
    case 'temperature-mismatch': return 'Use a boiler or recipe whose output is in range, or connect a block that makes it at the right temperature.'
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
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)
  const rateUnit = useUiStore(s => s.rateUnit)
  // Only ids and names are read; a flat array keeps the popover from re-rendering on every plan edit.
  const idNames = useBlockStore(useShallow(s => s.blocks.flatMap(b => [b.id, b.name])))
  const blockName = (id: string) => {
    const i = idNames.indexOf(id)
    return i >= 0 && i % 2 === 0 ? idNames[i + 1] : id
  }
  const [open, setOpen] = useState(false)
  useOverlayOpen(open)
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
    <div ref={ref} className="relative max-md:static shrink-0 mr-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-1 h-7 max-md:whitespace-nowrap px-2.5 max-md:px-2 rounded-full border text-xs ${badgeColor}`}
        title="Show solver warnings"
      >
        <span>⚠</span>
        {/* Below 768px the pill is "⚠ 1": the count shows, the words stay for assistive technology. */}
        <span aria-hidden className="md:hidden">{warnings.length}</span>
        <span className="max-md:sr-only">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
        <span className="text-[10px] opacity-60 max-md:hidden">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div data-testid="warnings-popover" className="whitespace-normal absolute top-full right-0 max-md:right-2 max-md:left-2 max-md:w-auto mt-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-xs z-50">
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
                <div className="text-gray-400 leading-snug">
                  → {warningHint(w)}
                </div>
                {warningTargets(w, block?.rootPlan, gameData, blockName, block?.id).map(t => (
                  <button
                    key={t.kind === 'row' ? t.nodeId : t.blockId}
                    type="button"
                    data-testid="warning-link"
                    onClick={() => {
                      if (t.kind === 'block') setActiveBlock(t.blockId)
                      else requestRevealRow(t.nodeId)
                      setOpen(false)
                    }}
                    className="mt-1.5 mr-3 text-teal-400 hover:text-teal-300 underline"
                  >
                    {t.label}
                  </button>
                ))}
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
