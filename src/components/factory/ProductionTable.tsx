import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { RecipeRow } from './RecipeRow'
import { SidePanel } from './sidePanel/SidePanel'
import { TableToolbar } from './TableToolbar'
import { useUiStore } from '../../store/uiStore'
import { RecipeDndProvider, useRecipeDnd } from './RecipeDnd'
import { ItemPicker } from '../ItemPicker'
import { treeGuideStyle, INGREDIENTS_PADDING_LEFT } from './treeGuides'
import { canMoveNodeInto } from '../../data/nesting'
import { ancestorHandleIds, indexRecipeAreas, presentRecipesFor, type AreaView } from './recipeAreas'
import type { RecipeNode, SubPlan, SubPlanNode } from '../../data/types'

/** How long a revealed row stays highlighted. */
const REVEAL_HIGHLIGHT_MS = 2000

// Column widths, in column order (reorder, recipe, machine, beacons, products, byproducts, ingredients, power).
// Reorder, machine, beacons, products and power are fixed px, padding included. Products holds at most one chip (the
// primary product; everything else is a byproduct), so it is sized for one chip, the right-aligned header and the pin
// badge. Recipe, byproducts and ingredients share the rest of the width by weight and never get narrower than their
// minimum px (so the table's minimum width is the sum of all the minimums, and it scrolls sideways in its wrapper below
// that). A chip slot is 38px (32px icon + 6px gap), so n chips need 38n - 6px inside the cell's 16px of padding: the
// minimums hold 1 byproduct chip and 2 ingredient chips per line (the ingredients start 28px in from the left padding, see treeGuides.ts). The table is `table-fixed`, so a wide area row cannot move the columns of the recipe rows.
const PRODUCTS_WIDTH = 72
type Column = { fixed: number } | { min: number; weight: number }
const COLUMNS: Column[] = [
  { fixed: 32 },
  { min: 150, weight: 3 }, // recipe
  { fixed: 88 },
  { fixed: 88 },
  { fixed: PRODUCTS_WIDTH },
  { min: 80, weight: 2 }, // byproducts
  { min: 148, weight: 4 }, // ingredients
  { fixed: 72 },
]
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + ('fixed' in c ? c.fixed : c.min), 0)
const TOTAL_WEIGHT = COLUMNS.reduce((sum, c) => sum + ('weight' in c ? c.weight : 0), 0)

/** A shared column's width: its minimum plus its share of whatever the table has beyond TABLE_MIN_WIDTH. `cqw` is the width
 * of the scrolling wrapper (a size container): a percentage in a <col> calc() is ignored by the browser. */
function columnWidth(c: Column): string {
  if ('fixed' in c) return `${c.fixed}px`
  return `calc(${c.min}px + max(0px, 100cqw - ${TABLE_MIN_WIDTH}px) * ${c.weight / TOTAL_WEIGHT})`
}

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
      <div className="flex flex-1 min-h-0 min-w-0 bg-gray-900">
        <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-gray-900 items-center justify-center gap-2 text-gray-600">
          <span className="text-sm">Load game data to begin</span>
          <span className="text-xs text-gray-700">Open the workspace menu at the top right to pick a game data set</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 bg-gray-900">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-gray-900">
        <TableToolbar rootPlan={rootPlan} solvedNodes={solverResult?.nodes ?? []} onAddRecipe={() => setPicker({})} />
        {/* Scrollable table body */}
        {/* container-type also applies layout containment: a position:fixed descendant would be placed against (and clipped by)
            this wrapper. Popups are portalled to body, so none exists; keep it that way or compute widths another way. */}
        <div ref={scrollRef} className="flex-1 overflow-auto overscroll-x-contain [container-type:inline-size]">
          {nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
              <span className="text-sm">No recipes yet</span>
            </div>
          ) : (
            <RecipeDndProvider>
              <table className="w-full border-collapse text-xs table-fixed" style={{ minWidth: TABLE_MIN_WIDTH }}>
                <colgroup>
                  {COLUMNS.map((c, i) => <col key={i} style={{ width: columnWidth(c) }} />)}
                </colgroup>
                <thead>
                  <tr className="text-gray-500 text-left border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
                    <th className="px-1 py-0.5" />
                    <th className="px-2 py-1">
                      <span className="flex items-center gap-2">
                        Recipe
                      </span>
                    </th>
                    <th className="px-2 py-1">Machine</th>
                    <th className="px-2 py-1">Beacons</th>
                    <th className="px-2 py-1">Products</th>
                    <th className="px-2 py-1">Byproducts</th>
                    <th className="px-2 py-1" style={{ paddingLeft: INGREDIENTS_PADDING_LEFT }}>Ingredients</th>
                    <th className="px-2 py-1 text-right whitespace-nowrap">Power</th>
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
      <SidePanel blockId={activeBlock?.id} rootPlan={rootPlan} result={solverResult} gameData={gameData} />
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
  const rootPlan = useBlockStore(s => selectActiveBlock(s)?.rootPlan)
  const [isOver, setIsOver] = useState(false)
  // Nesting limit: refuse a drop the store would refuse.
  const fits = !dragging || !rootPlan || dragging.sourceSubPlanId === subPlanId || canMoveNodeInto(rootPlan, dragging.nodeId, subPlanId)

  function handleDragOver(e: React.DragEvent) {
    if (!dragging || !fits) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsOver(true)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!dragging || !fits) return
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
      <td colSpan={8} className="py-2 text-center text-gray-700 text-[10px]" style={treeGuideStyle(depth)}>
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
  const rootPlan = useBlockStore(s => selectActiveBlock(s)?.rootPlan)
  const [isOver, setIsOver] = useState(false)
  // Nesting limit: refuse a drop the store would refuse.
  const fits = !dragging || !rootPlan || dragging.sourceSubPlanId === subPlanId || canMoveNodeInto(rootPlan, dragging.nodeId, subPlanId)

  function handleDragOver(e: React.DragEvent) {
    if (!dragging || !fits) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsOver(true)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!dragging || !fits) return
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
