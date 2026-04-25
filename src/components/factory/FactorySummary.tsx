import { useState } from 'react'
import { useActiveSubPlanFromFloor } from '../../store/blockStore'
import { useBlockStore } from '../../store/blockStore'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { ItemTile } from './ItemTile'
import { ItemPicker } from '../ItemPicker'
import type { ProductionGoal } from '../../data/types'

// ---------------------------------------------------------------------------
// Net balance helper
// ---------------------------------------------------------------------------

function computeNetBalance(
  nodes: { inputRates: Record<string, number>; outputRates: Record<string, number> }[],
): Map<string, number> {
  const net = new Map<string, number>()
  for (const node of nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      net.set(id, (net.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      net.set(id, (net.get(id) ?? 0) - rate)
  }
  return net
}

// ---------------------------------------------------------------------------
// FactorySummary
// ---------------------------------------------------------------------------

export function FactorySummary() {
  const subPlan = useActiveSubPlanFromFloor()
  const solverResult = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)
  const addGoal = useBlockStore(s => s.addGoal)
  const removeGoal = useBlockStore(s => s.removeGoal)
  const [showGoalPicker, setShowGoalPicker] = useState(false)

  const goals: ProductionGoal[] = subPlan?.goals ?? []
  const goalIds = new Set(goals.map(g => g.itemId))

  const netBalance = solverResult ? computeNetBalance(solverResult.nodes) : new Map<string, number>()

  // Products: items with net positive balance that are in goals
  const productItems = [...netBalance]
    .filter(([id, net]) => net > 0 && goalIds.has(id))
    .map(([id, net]) => ({ itemId: id, ratePerMin: net }))

  // Byproducts: items with net positive balance not in goals
  const byproductItems = [...netBalance]
    .filter(([id, net]) => net > 0 && !goalIds.has(id))
    .map(([id, net]) => ({ itemId: id, ratePerMin: net }))

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)

  function handleAddGoal(itemId: string) {
    addGoal({ id: crypto.randomUUID(), itemId, rate: 60 })
  }

  return (
    <div className="border-b border-gray-700 bg-gray-900 shrink-0">
      {/* Rate unit toggle */}
      <div className="flex items-center justify-end px-3 pt-1.5 gap-2 text-xs text-gray-500">
        <button
          type="button"
          onClick={() => setRateUnit('sec')}
          className={`hover:text-gray-200 ${rateUnit === 'sec' ? 'text-teal-400' : ''}`}
        >
          /sec
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => setRateUnit('min')}
          className={`hover:text-gray-200 ${rateUnit === 'min' ? 'text-teal-400' : ''}`}
        >
          /min
        </button>
      </div>

      {/* Three-pane summary */}
      <div className="grid grid-cols-3 divide-x divide-gray-800 px-0 pb-2">
        {/* Products */}
        <SummaryPane label="Products">
          {productItems.map(({ itemId, ratePerMin }) => (
            <ItemTile
              key={itemId}
              item={gameData?.items[itemId]}
              ratePerSec={ratePerMin / 60}
              variant="product"
              onClick={() => removeGoal(goals.find(g => g.itemId === itemId)?.id ?? '')}
              title={`${gameData?.items[itemId]?.name ?? itemId} — click to remove goal`}
            />
          ))}
          {/* Show goals with no solver result yet */}
          {goals
            .filter(g => !productItems.some(p => p.itemId === g.itemId))
            .map(g => (
              <ItemTile
                key={g.itemId}
                item={gameData?.items[g.itemId]}
                ratePerSec={g.rate / 60}
                variant="product"
                onClick={() => removeGoal(g.id)}
                title={`${gameData?.items[g.itemId]?.name ?? g.itemId} — click to remove goal`}
              />
            ))}
          <button
            type="button"
            onClick={() => setShowGoalPicker(true)}
            className="text-gray-600 hover:text-gray-400 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
            title="Add goal"
          >
            +
          </button>
        </SummaryPane>

        {/* Byproducts */}
        <SummaryPane label="Byproducts">
          {byproductItems.map(({ itemId, ratePerMin }) => (
            <ItemTile
              key={itemId}
              item={gameData?.items[itemId]}
              ratePerSec={ratePerMin / 60}
              variant="byproduct"
            />
          ))}
        </SummaryPane>

        {/* Ingredients */}
        <SummaryPane label="Ingredients">
          {ingredientItems.map(({ itemId, rate }) => (
            <ItemTile
              key={itemId}
              item={gameData?.items[itemId]}
              ratePerSec={rate / 60}
              variant="ingredient"
            />
          ))}
        </SummaryPane>
      </div>

      {showGoalPicker && (
        <ItemPicker
          source="items"
          onSelect={handleAddGoal}
          onClose={() => setShowGoalPicker(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryPane — labeled column
// ---------------------------------------------------------------------------

function SummaryPane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1 items-center min-h-[1.75rem]">
        {children}
      </div>
    </div>
  )
}
