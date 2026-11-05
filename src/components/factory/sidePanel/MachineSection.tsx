import { useState } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useBlockStore, selectActiveBlock } from '../../../store/blockStore'
import { useHorizon } from '../../../store/horizon'
import { resolveRowMachine } from '../../../data/horizon'
import { burnsFuel } from '../../../data/fuel'
import { Icon } from '../../Icon'
import { NeighbourSection } from '../NeighbourSection'
import { countRecipeRows } from '../recipeAreas'
import { PanelSection, BeyondTag, Chevron } from './PanelParts'
import { MachinePicker } from './MachinePicker'
import { FuelPicker } from './FuelPicker'
import { ModuleSlotRow } from './ModuleSlotRow'
import { setSlot, slotsOf } from './moduleSlots'
import { machineModuleOptions } from './moduleOptions'

/** "X exact · Y% busy" of a row's machines. */
function utilisation(solved: SolvedNode | undefined): string | undefined {
  if (!solved || solved.machineCountCeil <= 0) return undefined
  const busy = Math.round((solved.machineCountExact / solved.machineCountCeil) * 100)
  return `${+solved.machineCountExact.toFixed(2)} exact · ${busy}% busy`
}

/**
 * The Machine section: the machine picker and its counts, the burner's fuel, a reactor's neighbours, and one button
 * per module slot. Every change is saved at once through a store action.
 */
export function MachineSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  const applyRowSettingsToRecipe = useBlockStore(s => s.applyRowSettingsToRecipe)
  const recipeRowCount = useBlockStore(s => {
    const b = selectActiveBlock(s)
    return b ? countRecipeRows(b.rootPlan, node.recipeId) : 0
  })
  const horizon = useHorizon(gameData)
  const [pickerOpen, setPickerOpen] = useState(false)

  const recipe = gameData.recipes[node.recipeId]
  const category = recipe?.category ?? ''
  const row = resolveRowMachine(gameData, horizon, category, node.machineId)
  const { machine } = row
  const slotCount = machine?.moduleSlots ?? 0
  const used = node.modules.reduce((sum, m) => sum + m.count, 0)
  const neighbourBonus = machine?.neighbourBonus ?? 0

  // The modules a slot of this machine takes: the machine's allowed effects, the recipe's limits and productivity flag, the research horizon.
  const moduleOptions = machineModuleOptions(gameData, horizon, machine, node.recipeId)
  const slots = slotsOf(node.modules, slotCount)
  const util = utilisation(solved)

  return (
    <PanelSection title="Machine" testId="panel-machine" highlightKey="machine">
      <div>
        <div className="flex items-center gap-3">
          <span className="relative inline-flex">
          <button
            type="button"
            data-testid="machine-picker-button"
            aria-expanded={pickerOpen}
            title={machine?.name ?? 'Select machine'}
            aria-label={`Machine: ${machine?.name ?? 'none'}`}
            onClick={() => setPickerOpen(o => !o)}
            className={`flex items-center gap-1 rounded px-1 py-0.5 bg-gray-800 hover:bg-gray-700 ${row.beyondHorizon || row.noMachineInHorizon ? 'ring-1 ring-amber-500' : ''}`}
          >
            {machine?.iconPath ? (
              <Icon iconPath={machine.iconPath} alt={machine.name} className="w-8 h-8 object-contain shrink-0" />
            ) : (
              <span className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center text-[10px] text-gray-400 shrink-0">?</span>
            )}
            <Chevron />
          </button>
          {pickerOpen && (
            <MachinePicker
              nodeId={node.id}
              recipeId={node.recipeId}
              recipeCategory={category}
              machineId={node.machineId}
              gameData={gameData}
              onDone={() => setPickerOpen(false)}
            />
          )}
          </span>
          <div className="min-w-0 text-xs">
            <div data-testid="machine-needed" className="text-gray-200">{solved?.machineCountCeil ?? 0} needed</div>
            {util && <div data-testid="machine-utilisation" className="text-gray-500">{util}</div>}
          </div>
        </div>
        {row.noMachineInHorizon ? (
          <div data-testid="no-machine-in-horizon" className="mt-1.5 text-xs text-amber-400">
            No machine within research horizon: machine count and power are 0 for this row. Module and beacon productivity still applies to the output rates.
          </div>
        ) : (
          <div className="mt-1 text-xs text-gray-400">
            {machine?.name ?? 'Default'}
            {row.beyondHorizon && <> <BeyondTag /></>}
          </div>
        )}
      </div>

      {burnsFuel(machine) && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Fuel</div>
          <FuelPicker nodeId={node.id} machine={machine} fuelItemId={node.fuelItemId} gameData={gameData} />
        </div>
      )}

      {neighbourBonus > 0 && (
        <div className="mt-3">
          <NeighbourSection nodeId={node.id} neighbourCount={node.neighbourCount} neighbourBonus={neighbourBonus} />
        </div>
      )}

      {(slotCount > 0 || node.modules.length > 0) && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Modules</div>
            <div className={`text-[10px] ${used > slotCount ? 'text-amber-400' : 'text-gray-600'}`}>{used} / {slotCount} slots used</div>
          </div>
          <ModuleSlotRow
            slots={slots}
            slotCount={slotCount}
            options={moduleOptions}
            gameData={gameData}
            moduleIds={horizon.moduleIds}
            onSelect={(i, id) => updateNodeModules(node.id, setSlot(node.modules, slotCount, i, id))}
            label="Machine module slot"
          />
        </div>
      )}

      {recipeRowCount > 1 && (
        <div className="mt-3 pt-2 border-t border-gray-800">
          <button
            type="button"
            data-testid="apply-to-recipe-rows"
            title={`Copy this row's machine, fuel and modules to the other ${recipeRowCount - 1} row${recipeRowCount === 2 ? '' : 's'} of ${recipe?.name}`}
            onClick={() => applyRowSettingsToRecipe(node.id, 'machine')}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            Apply to every row of this recipe ({recipeRowCount})
          </button>
        </div>
      )}
    </PanelSection>
  )
}
