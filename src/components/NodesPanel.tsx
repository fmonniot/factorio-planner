import { useState } from 'react'
import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { ItemPicker } from './ItemPicker'

export function NodesPanel() {
  const subPlan = useBlockStore(selectActiveSubPlan)
  const addNode = useBlockStore(s => s.addNode)
  const removeNode = useBlockStore(s => s.removeNode)
  const setActiveSubPlan = useBlockStore(s => s.setActiveSubPlan)
  const gameData = useGameDataStore(selectGameData)
  const [pickerOpen, setPickerOpen] = useState(false)

  const subPlans = subPlan?.subPlans ?? []
  const recipeNodes = (subPlan?.nodes ?? []).filter(n => n.kind === 'game-recipe')

  function handleSelectRecipe(recipeId: string) {
    addNode({
      kind: 'game-recipe',
      id: crypto.randomUUID(),
      recipeId,
      modules: [],
      byproductPolicy: {},
    })
  }

  return (
    <div className="flex flex-col">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium text-gray-300">Nodes</span>
        <button
          className="ml-auto text-xs bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white px-2 py-1 rounded"
          onClick={() => setPickerOpen(true)}
        >
          + Add
        </button>
      </div>

      {/* Node list */}
      <ul>
        {recipeNodes.length === 0 && subPlans.length === 0 && (
          <li className="px-4 py-3 text-gray-500 text-sm">
            No nodes yet — click <strong>+ Add</strong>
          </li>
        )}

        {/* Child sub-plans as navigation links — participate in solver automatically */}
        {subPlans.map(sp => (
          <li
            key={sp.id}
            className="flex items-center gap-2 px-4 py-2 border-b border-gray-800"
          >
            {/* Subplan icon */}
            <span className="shrink-0 text-blue-400 text-xs font-bold leading-none w-4 text-center">⊞</span>
            <button
              className="flex-1 text-sm text-blue-300 hover:text-blue-100 truncate text-left"
              title={`Navigate to sub-plan: ${sp.name}`}
              onClick={() => setActiveSubPlan(sp.id)}
            >
              {sp.name}
            </button>
            <span className="text-xs text-gray-600 shrink-0">sub-plan</span>
          </li>
        ))}

        {/* Recipe nodes */}
        {recipeNodes.map(node => {
          const name = gameData?.recipes[node.recipeId]?.name ?? node.recipeId
          return (
            <li
              key={node.id}
              className="flex items-center gap-2 px-4 py-2 border-b border-gray-800"
            >
              <span className="flex-1 text-sm text-gray-200 truncate" title={name}>
                {name}
              </span>
              <button
                className="text-gray-600 hover:text-red-400 text-lg leading-none shrink-0"
                onClick={() => removeNode(node.id)}
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
          source="recipes"
          onSelect={handleSelectRecipe}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
