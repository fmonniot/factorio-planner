import { useState } from 'react'
import { useActiveSubPlanFromFloor } from '../../store/blockStore'
import { useBlockStore } from '../../store/blockStore'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { FloorBreadcrumb } from './FloorBreadcrumb'
import { RecipeRow } from './RecipeRow'
import { ItemPicker } from '../ItemPicker'
import type { RecipeNode } from '../../data/types'

export function ProductionTable() {
  const subPlan = useActiveSubPlanFromFloor()
  const solverResult = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const addNode = useBlockStore(s => s.addNode)
  const [showRecipePicker, setShowRecipePicker] = useState(false)

  const nodes = subPlan?.nodes ?? []
  const solvedMap = new Map(solverResult?.nodes.map(n => [n.recipeNodeId, n]) ?? [])

  function handleAddRecipe(recipeId: string) {
    const node: RecipeNode = {
      kind: 'game-recipe',
      id: crypto.randomUUID(),
      recipeId,
      modules: [],
      byproductPolicy: {},
    }
    addNode(node)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-900">
      {/* Floor breadcrumb — hidden at top level */}
      <FloorBreadcrumb />

      {/* Table header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-850 shrink-0">
        <span className="text-gray-400 text-xs font-medium">⚙ Production</span>
      </div>

      {/* Scrollable table body */}
      <div className="flex-1 overflow-auto">
        {nodes.length === 0 && !showRecipePicker ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
            <span className="text-sm">No recipes yet</span>
            <button
              type="button"
              onClick={() => setShowRecipePicker(true)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + Add recipe
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
                <th className="px-1 py-1 w-8" />
                <th className="px-2 py-1 w-6" />
                <th className="px-2 py-1 min-w-[8rem]">Recipe</th>
                <th className="px-2 py-1 min-w-[10rem]">Machine</th>
                <th className="px-2 py-1 min-w-[6rem]">Beacon</th>
                <th className="px-2 py-1">Products</th>
                <th className="px-2 py-1">Byproducts</th>
                <th className="px-2 py-1">Ingredients</th>
                <th className="px-2 py-1 w-16">Power</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((planNode, idx) => (
                <RecipeRow
                  key={planNode.id}
                  solvedNode={solvedMap.get(planNode.id)}
                  planNode={planNode}
                  isFirst={idx === 0}
                  isLast={idx === nodes.length - 1}
                  gameData={gameData!}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add recipe footer row */}
      {nodes.length > 0 && (
        <div className="shrink-0 border-t border-gray-800 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowRecipePicker(true)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            + Add recipe
          </button>
        </div>
      )}

      {showRecipePicker && (
        <ItemPicker
          source="recipes"
          onSelect={handleAddRecipe}
          onClose={() => setShowRecipePicker(false)}
        />
      )}
    </div>
  )
}
