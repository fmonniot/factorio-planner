import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { RecipeCard, fmtRate } from './RecipeCard'
import { deriveSyntheticRecipe } from '../solver/subplan'
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

  for (const goal of subPlan.goals) {
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
// SubPlan card — collapsed summary shown in parent plan's tree view
// (for child subplans that are NOT wired as solver nodes)
// ---------------------------------------------------------------------------

interface FlowItem {
  itemId: string
  amount: number
}

interface SubPlanCardProps {
  subPlanName: string
  outputs: FlowItem[]
  inputs: FlowItem[]
  gameData: GameData
}

function SubPlanCard({ subPlanName, outputs, inputs, gameData }: SubPlanCardProps) {
  const hasFlows = outputs.length > 0 || inputs.length > 0
  return (
    <div className="bg-gray-800 border border-blue-800 rounded-lg p-3 w-72">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-blue-400 text-sm font-bold leading-none shrink-0">⊞</span>
        <span className="text-sm text-blue-200 truncate flex-1" title={subPlanName}>{subPlanName}</span>
        <span className="text-xs text-gray-500 shrink-0">sub-plan</span>
      </div>

      {!hasFlows && (
        <div className="text-xs text-gray-600 italic">No goals yet</div>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <section className="mb-2">
          <div className="text-xs font-medium text-gray-500 mb-0.5">Outputs</div>
          {outputs.map(({ itemId, amount }) => (
            <div key={itemId} className="flex justify-between text-xs text-gray-300 gap-2">
              <span className="truncate">{gameData.items[itemId]?.name ?? itemId}</span>
              <span className="text-gray-400 shrink-0">{fmtRate(amount)}/min</span>
            </div>
          ))}
        </section>
      )}

      {/* Inputs */}
      {inputs.length > 0 && (
        <section>
          <div className="text-xs font-medium text-gray-500 mb-0.5">Inputs</div>
          {inputs.map(({ itemId, amount }) => (
            <div key={itemId} className="flex justify-between text-xs text-gray-300 gap-2">
              <span className="truncate">{gameData.items[itemId]?.name ?? itemId}</span>
              <span className="text-gray-400 shrink-0">{fmtRate(amount)}/min</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubPlanSolvedCard — shown in tree view for subplan nodes wired into the solver
// ---------------------------------------------------------------------------

interface SubPlanSolvedCardProps {
  node: SolvedNode
  planNode: SubPlanNode
  subPlanName: string
  gameData: GameData
}

function SubPlanSolvedCard({ node, planNode, subPlanName, gameData }: SubPlanSolvedCardProps) {
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const isPinned = planNode.pinnedRate !== undefined
  const inputEntries = Object.entries(node.inputRates)
  const outputEntries = Object.entries(node.outputRates)

  return (
    <div className="bg-gray-800 border border-blue-800 rounded-lg p-3 w-72">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-blue-400 text-sm font-bold leading-none shrink-0">⊞</span>
        <span className="font-medium text-sm text-blue-200 truncate flex-1" title={subPlanName}>
          {subPlanName}
        </span>
      </div>

      {/* Scale factor (throughput = dimensionless multiplier, 1.0 = 100% capacity) */}
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
  const subPlanResults = useSolverStore(s => s.subPlanResults)
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

  // Child subplans that appear in the solver result (have SolvedNodes via implicit wiring)
  const solvedSubPlanIds = new Set(
    result?.nodes
      .filter(sn => subPlan?.subPlans.some(sp => sp.id === sn.recipeNodeId))
      .map(sn => sn.recipeNodeId) ?? [],
  )
  // Child subplans without solve results (no goals yet) get a standalone collapsed card
  const unsolvedSubPlans = subPlan?.subPlans.filter(sp => !solvedSubPlanIds.has(sp.id)) ?? []

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
          subPlanName={childSubPlan.name}
          gameData={gd}
        />
      )
    }

    return <RecipeCard key={nodeId} node={sn} plan={subPlan!} gameData={gd} />
  }

  return (
    <div className="flex gap-6 min-h-full overflow-x-auto pb-4">
      {/* Child subplans without goals yet — shown as collapsed cards in a leading column */}
      {unsolvedSubPlans.length > 0 && (
        <div className="flex flex-col gap-3 shrink-0">
          {unsolvedSubPlans.map(sp => {
            const spResult = subPlanResults.get(sp.id)
            const synthetic = spResult ? deriveSyntheticRecipe(sp, spResult) : null
            return (
              <SubPlanCard
                key={sp.id}
                subPlanName={sp.name}
                outputs={synthetic?.products ?? []}
                inputs={synthetic?.ingredients ?? []}
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
