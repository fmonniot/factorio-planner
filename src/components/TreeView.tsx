import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { RecipeCard, fmtRate } from './RecipeCard'
import type { SolvedNode, SubPlan, SubPlanNode, GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Depth assignment
//
// Goal-producing nodes get depth 0.  Their ingredient producers get depth 1,
// and so on.  We always assign the *maximum* depth seen so far (re-visit if
// a deeper path exists), which pushes raw-material nodes as far right as
// possible — matching the typical production-planner layout.
// ---------------------------------------------------------------------------

function buildColumns(
  nodes: SolvedNode[],
  subPlan: SubPlan,
): string[][] {
  // itemId → recipeNodeId that produces it
  const producerOf = new Map<string, string>()
  for (const sn of nodes) {
    for (const itemId of Object.keys(sn.outputRates)) {
      producerOf.set(itemId, sn.recipeNodeId)
    }
  }

  // Depth map: recipeNodeId → column index (0 = closest to goal)
  const depthOf = new Map<string, number>()

  function descend(nodeId: string, depth: number, visiting: Set<string>) {
    // Break cycles: if this node is already on the current DFS path, skip it.
    // Without this guard, a cycle A→B→A causes depth to grow by 2 each round
    // trip, so the depth-based check never terminates.
    if (visiting.has(nodeId)) return
    // Only proceed if this gives a deeper (further-right) assignment.
    if ((depthOf.get(nodeId) ?? -1) >= depth) return
    depthOf.set(nodeId, depth)
    const sn = nodes.find(n => n.recipeNodeId === nodeId)
    if (!sn) return
    visiting.add(nodeId)
    for (const itemId of Object.keys(sn.inputRates)) {
      const producerId = producerOf.get(itemId)
      if (producerId) descend(producerId, depth + 1, visiting)
    }
    visiting.delete(nodeId)
  }

  for (const goal of subPlan.goals) {
    const pid = producerOf.get(goal.itemId)
    if (pid) descend(pid, 0, new Set())
  }

  // Group by depth into columns.
  const byDepth = new Map<number, string[]>()
  for (const [nodeId, d] of depthOf) {
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(nodeId)
  }

  // Build the column array, filling gaps with empty arrays.
  const maxDepth = byDepth.size > 0 ? Math.max(...byDepth.keys()) : -1
  const columns: string[][] = Array.from(
    { length: maxDepth + 1 },
    (_, i) => byDepth.get(i) ?? [],
  )

  // Nodes unreachable from any goal go in a trailing orphan column.
  const orphans = nodes
    .map(n => n.recipeNodeId)
    .filter(id => !depthOf.has(id))
  if (orphans.length > 0) columns.push(orphans)

  return columns
}

// ---------------------------------------------------------------------------
// SubPlanSolvedCard — shown in tree view for subplan nodes wired into the solver
// ---------------------------------------------------------------------------

interface SubPlanSolvedCardProps {
  node: SolvedNode | undefined
  planNode: SubPlanNode
  childSubPlan: SubPlan
  subPlanName: string
  gameData: GameData
}

function SubPlanSolvedCard({ node, planNode, childSubPlan, subPlanName, gameData }: SubPlanSolvedCardProps) {
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const isPinned = planNode.pinnedRate !== undefined
  const inputEntries = node ? Object.entries(node.inputRates) : []
  const outputEntries = node ? Object.entries(node.outputRates) : []

  const emptyWarning = node === undefined
    ? childSubPlan.goals.length === 0
      ? 'No goals — open this sub-plan to add a production goal'
      : 'No recipe nodes — open this sub-plan to add recipes'
    : undefined

  return (
    <div className="bg-gray-800 border border-blue-800 rounded-lg p-3 w-72">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-blue-400 text-sm font-bold leading-none shrink-0">⊞</span>
        <span className="font-medium text-sm text-blue-200 truncate flex-1" title={subPlanName}>
          {subPlanName}
        </span>
      </div>

      {/* Empty-state warning */}
      {emptyWarning && (
        <p className="text-xs text-yellow-600 italic mb-2">{emptyWarning}</p>
      )}

      {/* Scale factor — only shown when the solver has produced a result */}
      {node !== undefined && (
        <div className="flex items-center gap-2 mb-2 text-xs">
          <span className="text-gray-400">Scale</span>
          {isPinned ? (
            <input
              type="number"
              min="0.001"
              step="any"
              value={planNode.pinnedRate!.toFixed(2)}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (isFinite(v) && v > 0) updateNodePinnedRate(planNode.id, v)
              }}
              className="w-20 bg-gray-700 text-yellow-300 text-xs rounded px-1 py-0.5 border border-yellow-700 outline-none focus:ring-1 focus:ring-yellow-500 text-right"
              aria-label="Pinned scale"
            />
          ) : (
            <span className="text-gray-200 font-mono">{node.throughput.toFixed(2)}×</span>
          )}
          <button
            onClick={() => updateNodePinnedRate(planNode.id, isPinned ? undefined : Math.max(node.throughput, 1))}
            title={isPinned ? 'Unpin scale' : 'Pin scale'}
            className={`text-sm leading-none shrink-0 ${isPinned ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-600 hover:text-gray-400'}`}
          >
            {isPinned ? '📌' : '📍'}
          </button>
        </div>
      )}

      {/* Outputs */}
      {outputEntries.length > 0 && (
        <section className="mb-2">
          <div className="text-xs font-medium text-gray-500 mb-0.5">Outputs</div>
          {outputEntries.map(([itemId, rate]) => (
            <div key={itemId} className="flex justify-between text-xs text-gray-300 gap-2">
              <span className="truncate">{gameData.items[itemId]?.name ?? itemId}</span>
              <span className="text-gray-400 shrink-0">{fmtRate(rate)}/min</span>
            </div>
          ))}
        </section>
      )}

      {/* Inputs */}
      {inputEntries.length > 0 && (
        <section>
          <div className="text-xs font-medium text-gray-500 mb-0.5">Inputs</div>
          {inputEntries.map(([itemId, rate]) => (
            <div key={itemId} className="flex justify-between text-xs text-gray-300 gap-2">
              <span className="truncate">{gameData.items[itemId]?.name ?? itemId}</span>
              <span className="text-gray-400 shrink-0">{fmtRate(rate)}/min</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TreeView() {
  const subPlan = useBlockStore(selectActiveSubPlan)
  const status = useSolverStore(s => s.status)
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)

  // ── Loading / empty states ────────────────────────────────────────────────

  if (!gameData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Load game data to begin
      </div>
    )
  }

  if (status.type === 'pending' && !result) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Solving…
      </div>
    )
  }

  if (status.type === 'error') {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Solver error: {status.message}
      </div>
    )
  }

  const hasSubPlans = (subPlan?.subPlans.length ?? 0) > 0
  const hasNodes = (result?.nodes.length ?? 0) > 0

  if (!hasNodes && !hasSubPlans) {
    const hint =
      !subPlan || subPlan.goals.length === 0
        ? 'Add a goal in the sidebar to start planning'
        : subPlan.nodes.length === 0
          ? 'Add recipe nodes to the plan'
          : 'No nodes to display'
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        {hint}
      </div>
    )
  }

  // ── Tree layout ───────────────────────────────────────────────────────────

  const columns = subPlan && result ? buildColumns(result.nodes, subPlan) : []

  // Wired subplans that produced no SolvedNode (no goals or no recipe nodes yet).
  const solvedSubPlanIds = new Set(result?.nodes.map(n => n.recipeNodeId) ?? [])
  const emptySubPlanNodes = (subPlan?.nodes ?? [])
    .filter((n): n is SubPlanNode => n.kind === 'subplan' && !solvedSubPlanIds.has(n.subPlanId))

  function renderNode(nodeId: string, gd: GameData) {
    const sn = result!.nodes.find(n => n.recipeNodeId === nodeId)
    if (!sn) return null

    // Check if this is an implicit subplan node (recipeNodeId = subPlanId)
    const childSubPlan = subPlan!.subPlans.find(sp => sp.id === nodeId)
    const childSubPlanPlanNode = subPlan!.nodes.find(
      n => n.kind === 'subplan' && n.subPlanId === nodeId,
    ) as SubPlanNode | undefined
    if (childSubPlan && childSubPlanPlanNode) {
      return (
        <SubPlanSolvedCard
          key={nodeId}
          node={sn}
          planNode={childSubPlanPlanNode}
          childSubPlan={childSubPlan}
          subPlanName={childSubPlan.name}
          gameData={gd}
        />
      )
    }

    return <RecipeCard key={nodeId} node={sn} plan={subPlan!} gameData={gd} />
  }

  return (
    <div className="flex gap-6 min-h-full overflow-x-auto pb-4">
      {/* Empty subplan cards — wired but solver produced no result yet */}
      {emptySubPlanNodes.length > 0 && (
        <div className="flex flex-col gap-3 shrink-0">
          {emptySubPlanNodes.map(planNode => {
            const childSubPlan = subPlan!.subPlans.find(sp => sp.id === planNode.subPlanId)!
            return (
              <SubPlanSolvedCard
                key={planNode.id}
                node={undefined}
                planNode={planNode}
                childSubPlan={childSubPlan}
                subPlanName={childSubPlan.name}
                gameData={gameData}
              />
            )
          })}
        </div>
      )}

      {/* Recipe / subplan node columns */}
      {columns.map((nodeIds, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-3 shrink-0">
          {nodeIds.map(nodeId => renderNode(nodeId, gameData))}
        </div>
      ))}
    </div>
  )
}
