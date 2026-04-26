import { useState } from 'react'
import { useBlockStore, selectActiveSubPlan, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { fmtRate } from './ItemTile'
import { iconUrl } from '../../utils/iconUrl'
import { ItemTile } from './ItemTile'
import { ItemPicker } from '../ItemPicker'
import type { ProductionGoal, Item, GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'

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
// GoalTile — shows target → actual with inline edit for target
// ---------------------------------------------------------------------------

interface GoalTileProps {
  goal: ProductionGoal
  /** Solver's actual output for this item in items/min. Undefined before solver runs. */
  actualPerMin: number | undefined
  item: Item | undefined
  rateUnit: RateUnit
  onUpdateRate: (rate: number) => void
  onRemove: () => void
}

function GoalTile({ goal, actualPerMin, item, rateUnit, onUpdateRate, onRemove }: GoalTileProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // goal.rate is stored in items/min internally
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const targetDisplay = fmtRate(goal.rate / 60, rateUnit)
  const actualDisplay = actualPerMin !== undefined ? fmtRate(actualPerMin / 60, rateUnit) : null

  function startEdit() {
    setDraft(fmtRate(goal.rate / 60, rateUnit))
    setEditing(true)
  }

  function commitEdit() {
    const v = parseFloat(draft)
    if (isFinite(v) && v > 0) {
      // Convert from display unit back to items/min for storage
      const perMin = rateUnit === 'min' ? v : v * 60
      onUpdateRate(perMin)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs group/goal">
      {/* Icon */}
      {item?.iconPath ? (
        <img
          src={iconUrl(item.iconPath)}
          alt={item.name}
          title={item.name}
          className="w-4 h-4 object-contain shrink-0"
        />
      ) : (
        <span className="text-gray-400 text-[10px] shrink-0" title={item?.name ?? goal.itemId}>
          {item?.name ?? goal.itemId}
        </span>
      )}

      {/* Target rate — editable */}
      {editing ? (
        <input
          type="number"
          min="0.001"
          step="any"
          autoFocus
          aria-label="Goal target rate"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="w-14 bg-gray-700 text-yellow-300 rounded px-1 py-0 border border-yellow-600 outline-none text-right tabular-nums text-[11px]"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title={`Target: ${targetDisplay}${unitLabel} — click to edit`}
          className="text-gray-300 hover:text-yellow-300 tabular-nums font-mono text-[11px] leading-none"
        >
          {targetDisplay}
        </button>
      )}

      {/* Separator + actual (only when solver has run) */}
      {actualDisplay !== null && (
        <>
          <span className="text-gray-600 text-[10px]">→</span>
          <span
            title={`Actual: ${actualDisplay}${unitLabel} — solver output`}
            className="text-teal-400 tabular-nums font-mono text-[11px] leading-none"
          >
            {actualDisplay}
          </span>
        </>
      )}

      <span className="text-gray-600 text-[10px]">{unitLabel}</span>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        title="Remove goal"
        className="text-gray-700 hover:text-red-400 leading-none text-xs ml-0.5 opacity-0 group-hover/goal:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FactorySummary
// ---------------------------------------------------------------------------

export function FactorySummary() {
  const subPlan = useBlockStore(selectActiveSubPlan)
  const activeBlock = useBlockStore(selectActiveBlock)
  const renameBlock = useBlockStore(s => s.renameBlock)
  const solverResult = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)
  const addGoal = useBlockStore(s => s.addGoal)
  const removeGoal = useBlockStore(s => s.removeGoal)
  const updateGoalRate = useBlockStore(s => s.updateGoalRate)
  const [showGoalPicker, setShowGoalPicker] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const updateBlockSolverVersion = useBlockStore(s => s.updateBlockSolverVersion)
  const solverVersion = activeBlock?.solverVersion ?? 1

  const goals: ProductionGoal[] = subPlan?.goals ?? []
  const goalIds = new Set(goals.map(g => g.itemId))

  const netBalance = solverResult ? computeNetBalance(solverResult.nodes) : new Map<string, number>()

  // Byproducts: net positive balance not in goals
  const byproductItems = [...netBalance]
    .filter(([id, net]) => net > 0 && !goalIds.has(id))
    .map(([id, net]) => ({ itemId: id, ratePerMin: net }))

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)

  function handleAddGoal(itemId: string) {
    addGoal({ id: crypto.randomUUID(), itemId, rate: 60 })
  }

  function startNameEdit() {
    setNameDraft(activeBlock?.name ?? '')
    setEditingName(true)
  }

  function commitNameEdit() {
    const trimmed = nameDraft.trim()
    if (trimmed && activeBlock) renameBlock(activeBlock.id, trimmed)
    setEditingName(false)
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitNameEdit()
    if (e.key === 'Escape') setEditingName(false)
  }

  return (
    <div className="border-b border-gray-700 bg-gray-900 shrink-0">
      {/* Block name + rate unit toggle */}
      <div className="flex items-center justify-between px-3 pt-1.5 gap-2 text-xs text-gray-500">
        {editingName ? (
          <input
            type="text"
            aria-label="Block name"
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={handleNameKeyDown}
            className="bg-gray-800 text-gray-100 text-xs font-semibold rounded px-1.5 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-teal-500 w-32"
          />
        ) : (
          <button
            type="button"
            onClick={startNameEdit}
            title="Click to rename"
            className="font-semibold text-gray-300 hover:text-gray-100 text-xs"
          >
            {activeBlock?.name ?? 'Factory'}
          </button>
        )}
        <div className="flex items-center gap-2">
          {activeBlock && (
            <>
              <button
                type="button"
                onClick={() => updateBlockSolverVersion(activeBlock.id, 1)}
                title="Use v1 solver"
                aria-label="Solver v1"
                className={`hover:text-gray-200 text-[10px] px-1 rounded border ${solverVersion === 1 ? 'text-teal-400 border-teal-700' : 'border-gray-700'}`}
              >
                v1
              </button>
              <button
                type="button"
                onClick={() => updateBlockSolverVersion(activeBlock.id, 2)}
                title="Use v2 solver (LP)"
                aria-label="Solver v2"
                className={`hover:text-gray-200 text-[10px] px-1 rounded border ${solverVersion === 2 ? 'text-teal-400 border-teal-700' : 'border-gray-700'}`}
              >
                v2
              </button>
              <span className="text-gray-700">·</span>
            </>
          )}
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
      </div>

      {/* Three-pane summary */}
      <div className="grid grid-cols-3 gap-2 px-3 pb-2 pt-1">
        {/* Products — one GoalTile per goal */}
        <SummaryPane label="Products">
          {goals.map(goal => (
            <GoalTile
              key={goal.id}
              goal={goal}
              actualPerMin={netBalance.get(goal.itemId)}
              item={gameData?.items[goal.itemId]}
              rateUnit={rateUnit}
              onUpdateRate={rate => updateGoalRate(goal.id, rate)}
              onRemove={() => removeGoal(goal.id)}
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
// SummaryPane
// ---------------------------------------------------------------------------

function SummaryPane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-700 rounded bg-gray-900/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1 items-center min-h-[1.75rem]">
        {children}
      </div>
    </div>
  )
}
