import { useMemo } from 'react'
import type { GameData } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import { useAvailableRecipeIds, useHorizon } from '../../../store/horizon'
import { availableMachinesFor, categoryLabel, defaultMachineRowCounts } from '../../../data/defaultMachines'
import { groupPowerRecipes } from '../../../data/powerFuelGroups'
import { Icon } from '../../Icon'
import { AlternateRecipeList } from './AlternateRecipeList'

/**
 * The open list of the machine picker: Default, the machines within the research horizon (icon, name, speed),
 * how many rows follow the category default, and the alternate recipes of the row's primary product.
 */
export function MachinePicker({ nodeId, recipeId, recipeCategory, machineId, gameData, onDone }: {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  gameData: GameData
  onDone: () => void
}) {
  const updateNodeMachine = useBlockStore(s => s.updateNodeMachine)
  const updateNodeRecipe = useBlockStore(s => s.updateNodeRecipe)
  const setDefaultMachine = useBlockStore(s => s.setDefaultMachine)
  const blocks = useBlockStore(s => s.blocks)
  const requestDefaultMachines = useUiStore(s => s.requestDefaultMachines)
  const available = useAvailableRecipeIds()
  const horizon = useHorizon(gameData)

  const availableMachines = availableMachinesFor(gameData, horizon, recipeCategory)
  const defaultMachineId = horizon.defaultMachines[recipeCategory]
  const defaultMachineName = defaultMachineId ? gameData.machines[defaultMachineId]?.name : undefined
  const defaultRowCounts = useMemo(() => defaultMachineRowCounts(blocks, gameData), [blocks, gameData])
  const defaultRowCount = defaultRowCounts.get(recipeCategory) ?? 0

  const recipe = gameData.recipes[recipeId]
  const primaryItemId = recipe?.mainProduct ?? recipe?.products[0]?.itemId
  const altRecipes = useMemo(
    () => primaryItemId
      ? Object.values(gameData.recipes).filter(
          r => !r.hidden && r.id !== recipeId && r.products.some(p => p.itemId === primaryItemId) &&
            (available === null || r.power || available.has(r.id)),
        )
      : [],
    [gameData, primaryItemId, recipeId, available],
  )
  // A machine's per-fuel power recipes collapse into one expandable entry.
  const altEntries = useMemo(() => groupPowerRecipes(altRecipes), [altRecipes])

  function selectMachine(id: string | undefined) {
    updateNodeMachine(nodeId, id)
    onDone()
  }

  function makeDefault(id: string) {
    setDefaultMachine(recipeCategory, id)
    if (machineId !== undefined) updateNodeMachine(nodeId, undefined)
    onDone()
  }

  return (
    <div className="mt-1.5 bg-gray-800 border border-gray-700 rounded p-1.5 space-y-1 max-h-64 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 mb-1">Select machine</div>
      <button
        type="button"
        onClick={() => selectMachine(undefined)}
        className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 ${!machineId ? 'text-teal-400' : 'text-gray-300'}`}
      >
        {defaultMachineName ? `Default (${defaultMachineName})` : 'Default'}
      </button>
      {availableMachines.length === 0 && (
        <div data-testid="machine-picker-empty" className="px-2 py-1 text-xs text-gray-500 italic">
          No machine for this recipe within the research horizon. Widen the horizon to choose one.
        </div>
      )}
      {availableMachines.map(m => (
        <div key={m.id} className="group flex items-center">
          <button
            type="button"
            data-testid="machine-option"
            data-machine-id={m.id}
            onClick={() => selectMachine(m.id)}
            className={`flex-1 min-w-0 text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${m.id === machineId ? 'text-teal-400' : 'text-gray-300'}`}
          >
            {m.iconPath && <Icon iconPath={m.iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />}
            <span className="flex-1 min-w-0 truncate">{m.name}</span>
            <span className="text-gray-500 tabular-nums">speed {+m.craftingSpeed.toFixed(2)}</span>
          </button>
          {m.id === defaultMachineId ? (
            <span data-testid="default-machine-badge" className="px-1.5 text-[10px] text-gray-500">default</span>
          ) : (
            <button
              type="button"
              aria-label={`Make ${m.name} the ${categoryLabel(recipeCategory)} default`}
              onClick={() => makeDefault(m.id)}
              className="px-1.5 py-0.5 rounded text-[10px] text-teal-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              Make default
            </button>
          )}
        </div>
      ))}
      <div
        data-testid="default-machine-usage"
        className="flex items-center justify-between gap-2 px-2 pt-1 border-t border-gray-700 mt-1 text-[10px] text-gray-500"
      >
        <span>
          {categoryLabel(recipeCategory)} default is used by {defaultRowCount} {defaultRowCount === 1 ? 'row' : 'rows'}
        </span>
        <button type="button" onClick={() => requestDefaultMachines(recipeCategory)} className="text-teal-400 hover:underline">
          All defaults…
        </button>
      </div>
      {altRecipes.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-1 border-t border-gray-700 mt-1">Alternate recipe</div>
          <AlternateRecipeList
            entries={altEntries}
            gameData={gameData}
            available={available}
            onSelect={id => { updateNodeRecipe(nodeId, id); onDone() }}
          />
        </>
      )}
    </div>
  )
}
