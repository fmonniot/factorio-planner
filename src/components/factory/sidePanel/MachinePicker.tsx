import { useMemo } from 'react'
import type { GameData } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import { useAvailableRecipeIds, useHorizon } from '../../../store/horizon'
import { availableMachinesFor, categoryLabel, defaultMachineRowCounts } from '../../../data/defaultMachines'
import { defaultMachineIdOf } from '../../../data/horizon'
import { groupPowerRecipes } from '../../../data/powerFuelGroups'
import { Picker, PickerRow, PickerEmpty } from '../Picker'
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

  const recipe = gameData.recipes[recipeId]
  const availableMachines = availableMachinesFor(gameData, horizon, recipeCategory, recipe?.additionalCategories)
  const defaultMachineId = horizon.defaultMachines[recipeCategory]
  // The "Default (name)" row names what the row really uses, which may be an additional-category fallback;
  // only the category's own default gets the badge below.
  const rowDefaultId = defaultMachineIdOf(horizon.defaultMachines, recipeCategory, recipeId)
  const defaultMachineName = rowDefaultId ? gameData.machines[rowDefaultId]?.name : undefined
  const defaultRowCounts = useMemo(() => defaultMachineRowCounts(blocks, gameData), [blocks, gameData])
  const defaultRowCount = defaultRowCounts.get(recipeCategory) ?? 0

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
    <Picker heading="Select machine" onClose={onDone} className="w-72">
      <PickerRow
        name={defaultMachineName ? `Default (${defaultMachineName})` : 'Default'}
        selected={!machineId}
        data-testid="machine-option-default"
        onClick={() => selectMachine(undefined)}
      />
      {availableMachines.length === 0 && (
        <PickerEmpty data-testid="machine-picker-empty">
          No machine for this recipe within the research horizon. Widen the horizon to choose one.
        </PickerEmpty>
      )}
      {availableMachines.map(m => {
        const row = (
          <PickerRow
            name={m.name}
            iconPath={m.iconPath || undefined}
            detail={`speed ${+m.craftingSpeed.toFixed(2)}`}
            selected={m.id === machineId}
            data-testid="machine-option"
            data-machine-id={m.id}
            onClick={() => selectMachine(m.id)}
            className="flex-1 min-w-0"
          />
        )
        // Defaults are per primary category, so a machine that only crafts an additional category is a per-row choice.
        if (!m.craftingCategories.includes(recipeCategory)) {
          return (
            <div key={m.id} className="flex items-center">
              {row}
              <span
                data-testid="row-only-label"
                title={`Defaults are per primary category (${categoryLabel(recipeCategory, gameData)}). This machine only crafts an additional category of the recipe, so it can only be chosen for this row.`}
                className="px-1.5 text-[10px] text-gray-400"
              >
                row only, no default
              </span>
            </div>
          )
        }
        return (
          <div key={m.id} className="group flex items-center">
            {row}
            {m.id === defaultMachineId ? (
              <span data-testid="default-machine-badge" className="px-1.5 text-[10px] text-gray-400">default</span>
            ) : (
              <button
                type="button"
                aria-label={`Make ${m.name} the ${categoryLabel(recipeCategory, gameData)} default`}
                onClick={() => makeDefault(m.id)}
                className="px-1.5 py-0.5 rounded text-[10px] text-teal-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                Make default
              </button>
            )}
          </div>
        )
      })}
      <div
        data-testid="default-machine-usage"
        className="flex items-center justify-between gap-2 px-2 pt-1 border-t border-gray-700 mt-1 text-[10px] text-gray-400"
      >
        <span>
          {categoryLabel(recipeCategory, gameData)} default is used by {defaultRowCount} {defaultRowCount === 1 ? 'row' : 'rows'}
        </span>
        <button type="button" onClick={() => requestDefaultMachines(recipeCategory)} className="text-teal-400 hover:underline">
          All defaults…
        </button>
      </div>
      {altRecipes.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 px-2 pt-1 border-t border-gray-700 mt-1">Alternate recipe</div>
          <AlternateRecipeList
            entries={altEntries}
            gameData={gameData}
            available={available}
            onSelect={id => { updateNodeRecipe(nodeId, id); onDone() }}
          />
        </>
      )}
    </Picker>
  )
}
