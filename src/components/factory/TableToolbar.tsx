import { useUiStore } from '../../store/uiStore'
import type { RateUnit } from '../../store/uiStore'
import type { SolvedNode, SubPlan } from '../../data/types'
import { fmtPower } from './ItemTile'
import { countSubPlanContents } from './subPlanContents'

// ---------------------------------------------------------------------------
// TableToolbar — the row just above the production table: add a recipe, filter, rate unit and
// the block's totals. Its totals replace the table's former Power header total.
// ---------------------------------------------------------------------------

interface TableToolbarProps {
  rootPlan: SubPlan | undefined
  /** Every solved row of the block, at every depth. */
  solvedNodes: SolvedNode[]
  onAddRecipe: () => void
}

const RATE_UNITS: { unit: RateUnit; label: string }[] = [
  { unit: 'min', label: '/min' },
  { unit: 'sec', label: '/sec' },
]

export function TableToolbar({ rootPlan, solvedNodes, onAddRecipe }: TableToolbarProps) {
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)

  const recipes = rootPlan ? countSubPlanContents(rootPlan).recipes : 0
  const machines = solvedNodes.reduce((sum, n) => sum + n.machineCountCeil, 0)
  const powerKw = solvedNodes.reduce((sum, n) => sum + n.powerKw, 0)
  const power = powerKw > 0 ? fmtPower(powerKw) : null

  return (
    <div data-testid="table-toolbar" className="flex items-center gap-2.5 h-11 px-2.5 shrink-0 border-b border-gray-800 bg-gray-900 text-xs">
      <button
        type="button"
        onClick={onAddRecipe}
        aria-label="Add recipe"
        className="h-[26px] px-2.5 rounded-md bg-teal-500 hover:bg-teal-400 text-teal-950 font-bold"
      >
        + Recipe
      </button>

      {/* Not implemented yet: the filter does not narrow the table. Typing here has no effect. */}
      <label className="relative inline-flex items-center">
        <span className="sr-only">Filter recipes or items</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="absolute left-2 pointer-events-none">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-gray-400" />
          <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.3" className="text-gray-400" />
        </svg>
        <input
          type="search"
          placeholder="Filter recipes or items"
          className="w-[260px] h-[26px] box-border pl-6 pr-2 rounded-md bg-gray-950 border border-gray-700 text-gray-100 placeholder:text-gray-500"
        />
      </label>

      <span role="group" aria-label="Rate unit" className="inline-flex rounded-md border border-gray-700 overflow-hidden text-[11px]">
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

      <span className="ml-auto flex items-center gap-4 text-[11px] text-gray-400">
        <span data-testid="block-recipe-count">
          <span className="font-mono tabular-nums text-gray-100">{recipes}</span> {recipes === 1 ? 'recipe' : 'recipes'}
        </span>
        <span data-testid="block-machine-count">
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
