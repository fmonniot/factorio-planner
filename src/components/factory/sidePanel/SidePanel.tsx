import { useEffect } from 'react'
import type { GameData, SolverResult, SubPlan } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { RecipePanel } from './RecipePanel'
import { GroupPanel } from './GroupPanel'
import { findPlanNode } from './findPlanNode'
import { pressStartedOverCloseableOverlay } from './useDismiss'

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
    <>
    {/* Below xl the panel is a drawer over the table; the backdrop dismisses it, unless that press closed a picker or popover that was open over the drawer. */}
    <div data-testid="side-panel-backdrop" className="fixed inset-0 z-30 bg-black/50 xl:hidden" 
      // A pointer click (detail > 0) whose press began over an open menu, popover or picker only dismissed that overlay;
      // keyboard and programmatic clicks (detail 0) always close the drawer.
      onClick={e => { if (e.detail === 0 || !pressStartedOverCloseableOverlay()) clear() }} />
    <aside
      data-testid="side-panel"
      aria-label="Row details"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[380px] shadow-2xl xl:static xl:z-auto xl:shadow-none shrink-0 border-l border-gray-700 bg-gray-900 overflow-y-auto"
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
    </>
  )
}
