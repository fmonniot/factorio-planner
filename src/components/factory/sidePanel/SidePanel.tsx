import { useEffect } from 'react'
import type { GameData, SolverResult, SubPlan } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { RecipePanel } from './RecipePanel'
import { GroupPanel } from './GroupPanel'
import { findPlanNode } from './findPlanNode'

/**
 * The side panel: exactly one of a recipe row, an organising sub-factory or a separate area, and nothing while no row is
 * selected (the table then has the full width). The selection is the ui store's `selectedRow`; one of another block or of a
 * node missing from the loaded plan counts as none and is cleared; while the plan is not loaded the selection is kept.
 */
export function SidePanel({ blockId, rootPlan, result, gameData }: {
  blockId: string | undefined
  rootPlan: SubPlan | undefined
  result: SolverResult | undefined
  gameData: GameData
}) {
  const selected = useUiStore(s => s.selectedRow)
  const selectRow = useUiStore(s => s.selectRow)
  const clear = useUiStore(s => s.clearSelectedRow)

  const node = selected && selected.blockId === blockId && rootPlan ? findPlanNode(rootPlan, selected.nodeId) : undefined
  // Stale only when judged against a loaded plan: a block or plan that is momentarily undefined keeps the selection.
  const stale = selected !== null && node === undefined && blockId !== undefined && rootPlan !== undefined
  useEffect(() => {
    if (stale) clear()
  }, [stale, clear])

  if (!node || !rootPlan || !blockId) return null
  const solvedMap = new Map(result?.nodes.map(n => [n.recipeNodeId, n]) ?? [])

  return (
    <aside
      data-testid="side-panel"
      aria-label="Row details"
      className="w-[380px] shrink-0 border-l border-gray-700 bg-gray-900 overflow-y-auto"
    >
      {node.kind === 'subplan' ? (
        <GroupPanel
          key={node.id}
          node={node}
          rootPlan={rootPlan}
          solvedMap={solvedMap}
          solvedAreas={result?.areas}
          areaRoutes={result?.areaRoutes}
          gameData={gameData}
          onSelect={id => selectRow(blockId, id)}
          onClose={clear}
        />
      ) : (
        <RecipePanel key={node.id} node={node} solved={solvedMap.get(node.id)} gameData={gameData} onClose={clear} />
      )}
    </aside>
  )
}
