import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { RecipeRow } from './RecipeRow'
import { useUiStore } from '../../store/uiStore'
import { RecipeDndProvider, useRecipeDnd } from './RecipeDnd'
import { ItemPicker } from '../ItemPicker'
import { ancestorHandleIds, indexRecipeAreas, presentRecipesFor, type AreaView } from './recipeAreas'
import type { RecipeNode, SubPlan, SubPlanNode } from '../../data/types'

/** How long a revealed row stays highlighted. */
const REVEAL_HIGHLIGHT_MS = 2000

// ---------------------------------------------------------------------------
// ProductionTable
// ---------------------------------------------------------------------------

export function ProductionTable() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const solverResult = useSolverStore(selectBlockResult(activeBlock?.id))
  const gameData = useGameDataStore(selectGameData)
  const addNode = useBlockStore(s => s.addNode)

  const [picker, setPicker] = useState<null | { filterByItemId?: string; consumesItemId?: string; targetSubPlanId?: string }>(null)
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
  const scrollRef = useRef<HTMLDivElement>(null)

  const areaIndex = useMemo(() => (rootPlan ? indexRecipeAreas(rootPlan) : undefined), [rootPlan])
  const areaView: AreaView | undefined = areaIndex && { index: areaIndex, solvedMap, solvedAreas: solverResult?.areas }

  // A request to show a row (Build also in…, Go to row in…): expand its sub-factories now, scroll
  // and flash once it is rendered. A request left over from before this table mounted is ignored.
  const revealRequest = useUiStore(s => s.revealRowRequest)
  const [handledRevealSeq, setHandledRevealSeq] = useState(() => useUiStore.getState().revealRowRequest?.seq ?? 0)
  const [highlight, setHighlight] = useState<{ nodeId: string; seq: number } | null>(null)
  if (revealRequest && revealRequest.seq !== handledRevealSeq) {
    setHandledRevealSeq(revealRequest.seq)
    const handles = rootPlan ? ancestorHandleIds(rootPlan, revealRequest.nodeId) : undefined
    if (handles) {
      if (handles.some(h => !expanded.has(h))) setExpanded(new Set([...expanded, ...handles]))
      setHighlight({ nodeId: revealRequest.nodeId, seq: revealRequest.seq })
    }
  }
  useEffect(() => {
    if (!highlight) return
    scrollRef.current
      ?.querySelector(`tr[data-node-id="${highlight.nodeId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = window.setTimeout(() => setHighlight(cur => (cur === highlight ? null : cur)), REVEAL_HIGHLIGHT_MS)
    return () => window.clearTimeout(t)
  }, [highlight])

  function handleAddRecipe(recipeId: string) {
    addNode(makeRecipeNode(recipeId), picker?.targetSubPlanId)
  }

  if (!gameData) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-gray-900 items-center justify-center gap-2 text-gray-600">
        <span className="text-sm">Load game data to begin</span>
        <span className="text-xs text-gray-700">Open the workspace menu at the top right to pick a game data set</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-900">
      {/* Scrollable table body */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
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
                  <th className="px-1 py-0.5 w-8">
                    <button
                      type="button"
                      onClick={() => setPicker({})}
                      title="Add recipe"
                      aria-label="Add recipe"
                      className="w-[22px] h-5 flex mx-auto items-center justify-center text-gray-400 hover:text-gray-200 rounded border border-gray-700 hover:border-gray-500"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  </th>
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
                  (itemId, subPlanId) => setPicker({ consumesItemId: itemId, targetSubPlanId: subPlanId }),
                  areaView,
                  highlight?.nodeId ?? null,
                )}
                {rootPlan && <TrailingDropZone subPlanId={rootPlan.id} nodeCount={nodes.length} />}
              </tbody>
            </table>
          </RecipeDndProvider>
        )}
      </div>

      {picker && (
        <ItemPicker
          source="recipes"
          filterByItemId={picker.filterByItemId}
          consumesItemId={picker.consumesItemId}
          presentRecipes={rootPlan ? presentRecipesFor(rootPlan, picker.targetSubPlanId ?? rootPlan.id) : undefined}
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
  onAddConsumer: (itemId: string, subPlanId: string) => void,
  areaView: AreaView | undefined,
  highlightedNodeId: string | null,
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
        onAddConsumer={onAddConsumer}
        areaView={areaView}
        isHighlighted={planNode.id === highlightedNodeId}
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
              onAddConsumer,
              areaView,
              highlightedNodeId,
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
      <td colSpan={7} className="py-2 text-center text-gray-700 text-[10px]" style={{ paddingLeft: `${8 + depth * 16}px` }}>
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
      <td colSpan={7} className="py-2 text-center text-gray-700 text-[10px]">
        Drop here to append
      </td>
    </tr>
  )
}
