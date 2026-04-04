import { useState } from 'react'
import type { SolvedNode, Plan, GameData, ModuleConfig, BeaconConfig } from '../data/types'
import { usePlanStore } from '../store/planStore'

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
// Alternate recipe selector (5.2)
// ---------------------------------------------------------------------------

interface AlternateRecipeSelectorProps {
  nodeId: string
  currentRecipeId: string
  primaryItemId: string | undefined
  gameData: GameData
}

function AlternateRecipeSelector({ nodeId, currentRecipeId, primaryItemId, gameData }: AlternateRecipeSelectorProps) {
  const updateNodeRecipe = usePlanStore(s => s.updateNodeRecipe)

  if (!primaryItemId) return null

  // All recipes that produce the primary item.
  const candidates = Object.values(gameData.recipes).filter(r =>
    r.products.some(p => p.itemId === primaryItemId)
  )
  if (candidates.length < 2) return null

  return (
    <select
      value={currentRecipeId}
      onChange={e => updateNodeRecipe(nodeId, e.target.value)}
      className="w-full bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-blue-500 mb-1"
      title="Alternate recipe"
    >
      {candidates.map(r => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Machine selector (5.1)
// ---------------------------------------------------------------------------

interface MachineSelectorProps {
  nodeId: string
  recipeCategory: string
  currentMachineId: string | undefined
  gameData: GameData
}

function MachineSelector({ nodeId, recipeCategory, currentMachineId, gameData }: MachineSelectorProps) {
  const updateNodeMachine = usePlanStore(s => s.updateNodeMachine)

  const machines = Object.values(gameData.machines)
    .filter(m => m.craftingCategories.includes(recipeCategory))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <select
      value={currentMachineId ?? ''}
      onChange={e => updateNodeMachine(nodeId, e.target.value || undefined)}
      className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-blue-500 max-w-full"
    >
      <option value="">Default</option>
      {machines.map(m => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  )
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

  if (!recipe || !planNode) return null

  const resolvedMachineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  // Primary item: explicit mainProduct, or the first product's itemId.
  const primaryItemId = recipe.mainProduct ?? recipe.products[0]?.itemId

  const inputEntries = Object.entries(node.inputRates)
  const outputEntries = Object.entries(node.outputRates)

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 w-72">
      {/* Alternate recipe selector (only rendered when ≥2 recipes produce primaryItem) */}
      <AlternateRecipeSelector
        nodeId={node.recipeNodeId}
        currentRecipeId={planNode.recipeId}
        primaryItemId={primaryItemId}
        gameData={gameData}
      />

      {/* Recipe name */}
      <div className="font-medium text-sm text-gray-100 mb-2 truncate" title={recipe.name}>
        {recipe.name}
      </div>

      {/* Throughput */}
      <div className="text-xs text-gray-400 mb-1">
        {fmtRate(node.throughput)}/min
      </div>

      {/* Machine row */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
        {machine && <span className="shrink-0">× {node.machineCountCeil}</span>}
        <MachineSelector
          nodeId={node.recipeNodeId}
          recipeCategory={recipe.category}
          currentMachineId={planNode.machineId}
          gameData={gameData}
        />
        {node.powerKw > 0 && (
          <span className="shrink-0 text-gray-500">{fmtPower(node.powerKw)}</span>
        )}
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
