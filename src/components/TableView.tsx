import { useState } from 'react'
import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { RecipeCard } from './RecipeCard'
import type { SolvedNode } from '../data/types'

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = 'recipe' | 'throughput' | 'machines' | 'power'
type SortDir = 'asc' | 'desc'

function sortNodes(nodes: SolvedNode[], key: SortKey, dir: SortDir, recipeNames: Map<string, string>): SolvedNode[] {
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'recipe':
        cmp = (recipeNames.get(a.recipeNodeId) ?? '').localeCompare(recipeNames.get(b.recipeNodeId) ?? '')
        break
      case 'throughput':
        cmp = a.throughput - b.throughput
        break
      case 'machines':
        cmp = a.machineCountCeil - b.machineCountCeil
        break
      case 'power':
        cmp = a.powerKw - b.powerKw
        break
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function fmtRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0)
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

function fmtPower(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(2)} MW`
  return `${kw.toFixed(0)} kW`
}

export function TableView() {
  const subPlan = useBlockStore(selectActiveSubPlan)
  const status = useSolverStore(s => s.status)
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const [sortKey, setSortKey] = useState<SortKey>('recipe')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  if (!subPlan) return null

  // Build a recipe-name lookup for sorting.
  const recipeNames = new Map<string, string>()
  for (const sn of result.nodes) {
    const subPlanNode = subPlan.nodes.find(n => n.id === sn.recipeNodeId)
    const recipe = subPlanNode ? gameData.recipes[subPlanNode.recipeId] : undefined
    recipeNames.set(sn.recipeNodeId, recipe?.name ?? sn.recipeNodeId)
  }

  const sorted = sortNodes(result.nodes, sortKey, sortDir, recipeNames)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortHeader({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col
    return (
      <th
        className={`px-3 py-2 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap ${
          active ? 'text-blue-300' : 'text-gray-400 hover:text-gray-200'
        }`}
        onClick={() => toggleSort(col)}
      >
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
          <tr>
            <SortHeader col="recipe" label="Recipe" />
            <SortHeader col="throughput" label="Rate" />
            <SortHeader col="machines" label="Machines" />
            <SortHeader col="power" label="Power" />
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Machine</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(sn => {
            const subPlanNode = subPlan.nodes.find(n => n.id === sn.recipeNodeId)
            const recipe = subPlanNode ? gameData.recipes[subPlanNode.recipeId] : undefined
            const machineId = subPlanNode?.machineId ?? (recipe ? gameData.defaultMachines[recipe.category] : undefined)
            const machine = machineId ? gameData.machines[machineId] : undefined
            const isExpanded = expandedId === sn.recipeNodeId

            return [
              // Summary row
              <tr
                key={sn.recipeNodeId}
                className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : sn.recipeNodeId)}
              >
                <td className="px-3 py-2 text-gray-200">
                  {recipe?.name ?? sn.recipeNodeId}
                </td>
                <td className="px-3 py-2 text-gray-400 tabular-nums">
                  {fmtRate(sn.throughput)}/min
                  {subPlanNode?.pinnedRate !== undefined && (
                    <span className="ml-1 text-yellow-400 text-xs">📌</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-400 tabular-nums">
                  {sn.machineCountCeil}
                </td>
                <td className="px-3 py-2 text-gray-400 tabular-nums">
                  {sn.powerKw > 0 ? fmtPower(sn.powerKw) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">
                  {machine?.name ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">
                  {isExpanded ? '▲' : '▼'}
                </td>
              </tr>,

              // Expanded detail row with full RecipeCard
              isExpanded && (
                <tr key={`${sn.recipeNodeId}-detail`} className="bg-gray-900/50">
                  <td colSpan={6} className="px-3 py-3">
                    <RecipeCard node={sn} plan={subPlan} gameData={gameData} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
