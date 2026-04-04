import { useState } from 'react'
import { usePlanStore } from '../store/planStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { ItemPicker } from './ItemPicker'

export function GoalsPanel() {
  const goals = usePlanStore(s => s.plan.goals)
  const addGoal = usePlanStore(s => s.addGoal)
  const removeGoal = usePlanStore(s => s.removeGoal)
  const updateGoalRate = usePlanStore(s => s.updateGoalRate)
  const gameData = useGameDataStore(selectGameData)
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleSelectItem(itemId: string) {
    addGoal({
      id: crypto.randomUUID(),
      itemId,
      rate: 60,
    })
  }

  function handleRateChange(goalId: string, raw: string) {
    const rate = parseFloat(raw)
    if (isFinite(rate) && rate > 0) updateGoalRate(goalId, rate)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center shrink-0">
        <span className="text-sm font-medium text-gray-300">Goals</span>
        <button
          className="ml-auto text-xs bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white px-2 py-1 rounded"
          onClick={() => setPickerOpen(true)}
        >
          + Add
        </button>
      </div>

      {/* Goal list */}
      <ul className="flex-1 overflow-y-auto">
        {goals.length === 0 && (
          <li className="px-4 py-3 text-gray-500 text-sm">
            No goals yet — click <strong>+ Add</strong>
          </li>
        )}
        {goals.map(goal => {
          const name = gameData?.items[goal.itemId]?.name ?? goal.itemId
          return (
            <li
              key={goal.id}
              className="flex items-center gap-2 px-4 py-2 border-b border-gray-800"
            >
              <span className="flex-1 text-sm text-gray-200 truncate" title={name}>
                {name}
              </span>
              <input
                type="number"
                min="0.001"
                step="any"
                value={goal.rate}
                onChange={e => handleRateChange(goal.id, e.target.value)}
                className="w-20 bg-gray-800 text-gray-100 text-sm px-2 py-1 rounded text-right outline-none focus:ring-1 focus:ring-blue-500"
                aria-label={`Rate for ${name}`}
              />
              <span className="text-xs text-gray-500 shrink-0">/min</span>
              <button
                className="text-gray-600 hover:text-red-400 text-lg leading-none shrink-0"
                onClick={() => removeGoal(goal.id)}
                aria-label={`Remove ${name}`}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>

      {pickerOpen && (
        <ItemPicker
          onSelect={handleSelectItem}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
