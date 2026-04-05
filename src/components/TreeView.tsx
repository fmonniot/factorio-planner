import { usePlanStore } from '../store/planStore'
import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { RecipeCard } from './RecipeCard'
import type { SolvedNode, Plan, GameData } from '../data/types'

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
  plan: Plan,
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

  function descend(nodeId: string, depth: number) {
    // Only proceed if this gives a deeper (further-right) assignment.
    if ((depthOf.get(nodeId) ?? -1) >= depth) return
    depthOf.set(nodeId, depth)
    const sn = nodes.find(n => n.recipeNodeId === nodeId)
    if (!sn) return
    for (const itemId of Object.keys(sn.inputRates)) {
      const producerId = producerOf.get(itemId)
      if (producerId) descend(producerId, depth + 1)
    }
  }

  for (const goal of plan.goals) {
    const pid = producerOf.get(goal.itemId)
    if (pid) descend(pid, 0)
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
// Component
// ---------------------------------------------------------------------------

export function TreeView() {
  const plan = usePlanStore(s => s.plan)
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

  if (!result || result.nodes.length === 0) {
    const hint =
      plan.goals.length === 0
        ? 'Add a goal in the sidebar to start planning'
        : plan.nodes.length === 0
          ? 'Add recipe nodes to the plan'
          : 'No nodes to display'
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        {hint}
      </div>
    )
  }

  // ── Tree layout ───────────────────────────────────────────────────────────

  const columns = buildColumns(result.nodes, plan)

  function renderNode(nodeId: string, gd: GameData) {
    const sn = result!.nodes.find(n => n.recipeNodeId === nodeId)
    if (!sn) return null
    return <RecipeCard key={nodeId} node={sn} plan={plan} gameData={gd} />
  }

  return (
    <div className="flex gap-6 min-h-full overflow-x-auto pb-4">
      {columns.map((nodeIds, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-3 shrink-0">
          {nodeIds.map(nodeId => renderNode(nodeId, gameData))}
        </div>
      ))}
    </div>
  )
}
