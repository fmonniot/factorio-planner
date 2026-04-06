import { useState } from 'react'
import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { ItemPicker } from './ItemPicker'

export function NodesPanel() {
  const subPlan = useBlockStore(selectActiveSubPlan)
  const addNode = useBlockStore(s => s.addNode)
  const addSubPlanNode = useBlockStore(s => s.addSubPlanNode)
  const removeNode = useBlockStore(s => s.removeNode)
  const setActiveSubPlan = useBlockStore(s => s.setActiveSubPlan)
  const gameData = useGameDataStore(selectGameData)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [subPlanPickerOpen, setSubPlanPickerOpen] = useState(false)

  const nodes = subPlan?.nodes ?? []
  const subPlans = subPlan?.subPlans ?? []

  // Separate game-recipe nodes from subplan nodes for rendering
  const recipeNodes = nodes.filter(n => n.kind === 'game-recipe')
  const subPlanNodes = nodes.filter(n => n.kind === 'subplan')

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
        {subPlans.length > 0 && (
          <button
            className="text-xs bg-blue-900 hover:bg-blue-800 active:bg-blue-950 text-blue-200 px-2 py-1 rounded"
            onClick={() => setSubPlanPickerOpen(o => !o)}
            title="Wire a sub-plan as a solver node"
          >
            + Sub-plan
          </button>
        )}
      </div>

      {/* Inline sub-plan picker */}
      {subPlanPickerOpen && subPlans.length > 0 && (
        <div className="border-b border-gray-700 bg-gray-900 px-4 py-2">
          <div className="text-xs text-gray-400 mb-1">Wire sub-plan as node:</div>
          <ul>
            {subPlans.map(sp => (
              <li key={sp.id}>
                <button
                  className="w-full text-left text-sm text-blue-300 hover:text-blue-100 py-1 flex items-center gap-2"
                  onClick={() => {
                    addSubPlanNode(sp.id)
                    setSubPlanPickerOpen(false)
                  }}
                >
                  <span className="text-blue-400 text-xs font-bold leading-none w-4 text-center">⊞</span>
                  {sp.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Node list */}
      <ul>
        {nodes.length === 0 && subPlans.length === 0 && (
          <li className="px-4 py-3 text-gray-500 text-sm">
            No nodes yet — click <strong>+ Add</strong>
          </li>
        )}

        {/* Child sub-plans as navigation links (not solver nodes) */}
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

        {/* Subplan solver nodes */}
        {subPlanNodes.map(node => {
          const sp = subPlans.find(s => s.id === node.subPlanId)
          const name = sp?.name ?? node.subPlanId
          return (
            <li
              key={node.id}
              className="flex items-center gap-2 px-4 py-2 border-b border-gray-800"
            >
              <span className="shrink-0 text-blue-400 text-xs font-bold leading-none w-4 text-center">⊞</span>
              <span className="flex-1 text-sm text-blue-200 truncate" title={name}>
                {name}
              </span>
              <span className="text-xs text-gray-500 shrink-0">node</span>
              <button
                className="text-gray-600 hover:text-red-400 text-lg leading-none shrink-0"
                onClick={() => removeNode(node.id)}
                aria-label={`Remove ${name} node`}
              >
                ×
              </button>
            </li>
          )
        })}

        {/* Regular recipe nodes */}
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
