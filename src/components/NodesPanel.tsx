import { useState } from 'react'
import { usePlanStore } from '../store/planStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { ItemPicker } from './ItemPicker'

export function NodesPanel() {
  const nodes = usePlanStore(s => s.plan.nodes)
  const addNode = usePlanStore(s => s.addNode)
  const removeNode = usePlanStore(s => s.removeNode)
  const gameData = useGameDataStore(selectGameData)
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleSelectRecipe(recipeId: string) {
    addNode({
      id: crypto.randomUUID(),
      recipeId,
      modules: [],
      byproductPolicy: {},
    })
  }

  return (
    <div className="flex flex-col">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center shrink-0">
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
        {nodes.length === 0 && (
          <li className="px-4 py-3 text-gray-500 text-sm">
            No nodes yet — click <strong>+ Add</strong>
          </li>
        )}
        {nodes.map(node => {
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
