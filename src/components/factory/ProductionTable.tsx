import { useState } from 'react'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { RecipeRow } from './RecipeRow'
import { RecipeDndProvider, useRecipeDnd } from './RecipeDnd'
import { ItemPicker } from '../ItemPicker'
import type { RecipeNode, SubPlan, SubPlanNode } from '../../data/types'

// ---------------------------------------------------------------------------
// ProductionTable
// ---------------------------------------------------------------------------

export function ProductionTable() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const solverResult = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const addNode = useBlockStore(s => s.addNode)

  const [picker, setPicker] = useState<null | { filterByItemId?: string; targetSubPlanId?: string }>(null)
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
  const nodes = rootPlan?.nodes ?? []
  const solvedMap = new Map(solverResult?.nodes.map(n => [n.recipeNodeId, n]) ?? [])

  function handleAddRecipe(recipeId: string) {
    const node: RecipeNode = {
      kind: 'game-recipe',
      id: crypto.randomUUID(),
      recipeId,
      modules: [],
      byproductPolicy: {},
    }
    addNode(node, picker?.targetSubPlanId)
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
      {/* Scrollable table body */}
      <div className="flex-1 overflow-auto">
        {nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
            <span className="text-sm">No recipes yet</span>
            <button
              type="button"
              onClick={() => setPicker({})}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + Add recipe
            </button>
          </div>
        ) : (
          <RecipeDndProvider>
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
                </tr>
              </thead>
              <tbody>
                {rootPlan && renderNodes(
                  nodes,
                  0,
                  rootPlan,
                  rootPlan.id,
                  solvedMap,
                  gameData,
                  expanded,
                  toggleExpand,
                  (itemId, subPlanId) => setPicker({ filterByItemId: itemId, targetSubPlanId: subPlanId }),
                )}
                {rootPlan && <TrailingDropZone subPlanId={rootPlan.id} nodeCount={nodes.length} />}
              </tbody>
            </table>
          </RecipeDndProvider>
        )}
      </div>

      {/* Add recipe footer */}
      {nodes.length > 0 && (
        <div className="shrink-0 border-t border-gray-800 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setPicker({})}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            + Add recipe
          </button>
        </div>
      )}

      {picker && (
        <ItemPicker
          source="recipes"
          filterByItemId={picker.filterByItemId}
          onSelect={handleAddRecipe}
          onClose={() => setPicker(null)}
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
  parentSubPlanId: string,
  solvedMap: Map<string, import('../../data/types').SolvedNode>,
  gameData: import('../../data/types').GameData,
  expanded: Set<string>,
  toggleExpand: (id: string) => void,
  onIngredientClick: (itemId: string, subPlanId: string) => void,
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
        parentSubPlanId={parentSubPlanId}
        nodeIndex={idx}
        onIngredientClick={onIngredientClick}
      />
    )

    // If this is an expanded SubPlanNode, render its children indented.
    if (planNode.kind === 'subplan' && expanded.has(planNode.id)) {
      const childPlan = findSubPlanAnywhere(rootPlan, planNode.subPlanId)
      if (childPlan) {
        if (childPlan.nodes.length === 0) {
          // Empty expanded subgroup — render a drop-target placeholder.
          rows.push(
            <EmptySubPlanDropTarget key={`${planNode.id}-empty`} subPlanId={childPlan.id} depth={depth + 1} />
          )
        } else {
          rows.push(
            ...renderNodes(
              childPlan.nodes,
              depth + 1,
              rootPlan,
              childPlan.id,
              solvedMap,
              gameData,
              expanded,
              toggleExpand,
              onIngredientClick,
            )
          )
        }
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

// ---------------------------------------------------------------------------
// Empty-subgroup drop target
// ---------------------------------------------------------------------------

function EmptySubPlanDropTarget({ subPlanId, depth }: { subPlanId: string; depth: number }) {
  const { dragging, endDrag } = useRecipeDnd()
  const moveNode = useBlockStore(s => s.moveNode)
  const [isOver, setIsOver] = useState(false)

  function handleDragOver(e: React.DragEvent) {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsOver(true)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!dragging) return
    moveNode(dragging.nodeId, subPlanId, 0)
    setIsOver(false)
    endDrag()
  }

  return (
    <tr
      className={`border-b border-gray-800 transition-colors ${isOver ? 'bg-blue-900/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      <td colSpan={8} className="py-2 text-center text-gray-700 text-[10px]" style={{ paddingLeft: `${8 + depth * 16}px` }}>
        Drop here
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Trailing drop zone — append to root plan
// ---------------------------------------------------------------------------

function TrailingDropZone({ subPlanId, nodeCount }: { subPlanId: string; nodeCount: number }) {
  const { dragging, endDrag } = useRecipeDnd()
  const moveNode = useBlockStore(s => s.moveNode)
  const [isOver, setIsOver] = useState(false)

  function handleDragOver(e: React.DragEvent) {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsOver(true)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!dragging) return
    moveNode(dragging.nodeId, subPlanId, nodeCount)
    setIsOver(false)
    endDrag()
  }

  if (!dragging) return null

  return (
    <tr
      className={`border-b border-gray-800 transition-colors ${isOver ? 'bg-blue-900/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      <td colSpan={8} className="py-2 text-center text-gray-700 text-[10px]">
        Drop here to append
      </td>
    </tr>
  )
}
