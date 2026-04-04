import type { SolvedNode, Plan, GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Formatting helpers
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecipeCardProps {
  node: SolvedNode
  plan: Plan
  gameData: GameData
}

export function RecipeCard({ node, plan, gameData }: RecipeCardProps) {
  const planNode = plan.nodes.find(n => n.id === node.recipeNodeId)
  const recipe = planNode ? gameData.recipes[planNode.recipeId] : undefined

  if (!recipe) return null

  const machineId =
    planNode?.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = machineId ? gameData.machines[machineId] : undefined

  const inputEntries = Object.entries(node.inputRates)
  const outputEntries = Object.entries(node.outputRates)

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 min-w-52 max-w-72">
      {/* Recipe name */}
      <div className="font-medium text-sm text-gray-100 mb-1 truncate" title={recipe.name}>
        {recipe.name}
      </div>

      {/* Key metrics */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mb-2">
        <span>{fmtRate(node.throughput)}/min</span>
        {machine && (
          <span>× {node.machineCountCeil} {machine.name}</span>
        )}
        {node.powerKw > 0 && (
          <span>{fmtPower(node.powerKw)}</span>
        )}
      </div>

      {/* Outputs */}
      {outputEntries.length > 0 && (
        <section className="mb-1">
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
