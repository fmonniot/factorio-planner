import { useState } from 'react'
import { useBlockStore, selectActiveBlock, selectActiveSubPlan } from '../../store/blockStore'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { RecipeRow } from './RecipeRow'
import { ItemPicker } from '../ItemPicker'
import type { RecipeNode, SubPlan, SubPlanNode } from '../../data/types'

// ---------------------------------------------------------------------------
// ProductionTable
// ---------------------------------------------------------------------------

export function ProductionTable() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const activeSubPlan = useBlockStore(selectActiveSubPlan)
  const solverResult = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const addNode = useBlockStore(s => s.addNode)

  const [showRecipePicker, setShowRecipePicker] = useState(false)
  // Set of SubPlanNode ids whose children are currently expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpand(nodeId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const rootPlan = activeBlock?.rootPlan
  const nodes = activeSubPlan?.nodes ?? []
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

  if (!gameData) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-gray-900 items-center justify-center gap-2 text-gray-600">
        <span className="text-sm">Load game data to begin</span>
        <span className="text-xs text-gray-700">Use the selector in the top bar</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-900">
      {/* Table header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 shrink-0">
        <span className="text-gray-400 text-xs font-medium">⚙ Production</span>
      </div>

      {/* Scrollable table body */}
      <div className="flex-1 overflow-auto">
        {nodes.length === 0 ? (
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
              {rootPlan && renderNodes(
                nodes,
                0,
                rootPlan,
                solvedMap,
                gameData,
                expanded,
                toggleExpand,
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add recipe footer */}
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

// ---------------------------------------------------------------------------
// Recursive node rendering
// ---------------------------------------------------------------------------

function renderNodes(
  nodes: (RecipeNode | SubPlanNode)[],
  depth: number,
  rootPlan: SubPlan,
  solvedMap: Map<string, import('../../data/types').SolvedNode>,
  gameData: import('../../data/types').GameData,
  expanded: Set<string>,
  toggleExpand: (id: string) => void,
): React.ReactNode[] {
  const rows: React.ReactNode[] = []

  nodes.forEach((planNode, idx) => {
    rows.push(
      <RecipeRow
        key={planNode.id}
        solvedNode={solvedMap.get(planNode.id)}
        planNode={planNode}
        isFirst={idx === 0}
        isLast={idx === nodes.length - 1}
        depth={depth}
        isExpanded={planNode.kind === 'subplan' ? expanded.has(planNode.id) : undefined}
        onToggleExpand={planNode.kind === 'subplan' ? () => toggleExpand(planNode.id) : undefined}
        gameData={gameData}
        rootPlan={rootPlan}
      />
    )

    // If this is an expanded SubPlanNode, render its children indented.
    if (planNode.kind === 'subplan' && expanded.has(planNode.id)) {
      const childPlan = findSubPlanAnywhere(rootPlan, planNode.subPlanId)
      if (childPlan) {
        rows.push(
          ...renderNodes(
            childPlan.nodes,
            depth + 1,
            rootPlan,
            solvedMap,
            gameData,
            expanded,
            toggleExpand,
          )
        )
      }
    }
  })

  return rows
}

function findSubPlanAnywhere(plan: SubPlan, id: string): SubPlan | undefined {
  if (plan.id === id) return plan
  for (const sp of plan.subPlans) {
    const found = findSubPlanAnywhere(sp, id)
    if (found) return found
  }
  return undefined
}
