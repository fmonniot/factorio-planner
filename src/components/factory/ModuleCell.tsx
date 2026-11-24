import type { GameData, ModuleConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useHorizon } from '../../store/horizon'
import { withinHorizon } from '../../data/horizon'
import { IconChip } from './IconChip'
import { PickerTrigger } from './PickerTrigger'
import { ModuleFillPicker } from './ModuleFillPicker'
import { mostUsedModule } from '../../data/mostUsedModule'
import { moduleMisfitInMachineRow } from '../../data/moduleRules'
import type { ModuleEntity } from '../../data/moduleRules'
import { machineModuleOptions } from './sidePanel/moduleOptions'

interface ModuleCellProps {
  nodeId: string
  recipeId: string
  /** The row's resolved machine; the empty chip's picker lists the modules it takes. */
  machine: ModuleEntity | undefined
  modules: ModuleConfig[]
  machineSlots: number
  gameData: GameData
  /** The row has no machine at all (the research horizon removed its default). */
  noMachine?: boolean
  /** Select the row and highlight the panel's Machine section (the chip holds modules). */
  onOpenEdit: () => void
}

export function ModuleCell({ nodeId, recipeId, machine, modules, machineSlots, gameData, noMachine = false, onOpenEdit }: ModuleCellProps) {
  const horizon = useHorizon(gameData)
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  if (machineSlots === 0 && modules.length === 0) return null

  const usedSlots = modules.reduce((sum, m) => sum + m.count, 0)
  const beyondHorizon = noMachine || modules.some(m => !withinHorizon(horizon.moduleIds, m.moduleId))
  const overSlots = !noMachine && usedSlots > machineSlots
  // A stored module the game would refuse (the machine's rules, then the recipe's): the planner still counts it.
  // Like the solver: not for a machine without slots, and no recipe-level verdict for an unknown recipe.
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity
  const incompatible = !noMachine && machine !== undefined && machineSlots > 0 && modules.some(m => {
    const mod = gameData.modules[m.moduleId]
    return mod !== undefined && moduleMisfitInMachineRow(mod, machine, recipeId, allowProductivity) !== undefined
  })

  const title = noMachine
    ? 'Modules without a machine'
    : beyondHorizon
      ? 'Edit modules (beyond research horizon)'
      : overSlots
        ? machineSlots === 0
          ? 'Edit modules (this machine has no module slots)'
          : 'Edit modules (more modules than slots)'
        : incompatible
          ? 'Edit modules (a module does not fit this machine or recipe)'
          : 'Edit modules'
  const shown = mostUsedModule(modules)
  const shownModule = shown ? gameData.modules[shown] : undefined

  // An empty chip is the fill-all shortcut; one with modules opens the panel (slots can hold mixed modules).
  const fillAll = modules.length === 0 && machineSlots > 0 && !noMachine

  const chip = (toggle?: () => void, open?: boolean) => (
    <IconChip
      onClick={toggle ?? onOpenEdit}
      aria-expanded={toggle ? open : undefined}
      data-testid="module-chip"
      size="entity"
      empty={modules.length === 0}
      quiet
      iconPath={shownModule?.iconPath || undefined}
      alt={shownModule?.name ?? 'module'}
      fallback="+"
      quantity={`${usedSlots}/${machineSlots}`}
      warn={beyondHorizon || overSlots || incompatible}
      tip={fillAll ? `Fill all ${machineSlots} slots with a module` : title}
      data-beyond-horizon={beyondHorizon ? 'true' : undefined}
      data-over-slots={overSlots ? 'true' : undefined}
      data-incompatible={incompatible ? 'true' : undefined}
    />
  )
  if (!fillAll) return chip()
  return (
    <PickerTrigger trigger={({ open, toggle }) => chip(toggle, open)}>
      {close => (
        <ModuleFillPicker
          heading={`Fill all ${machineSlots} ${machineSlots === 1 ? 'slot' : 'slots'} with`}
          options={machineModuleOptions(gameData, horizon, machine, recipeId)}
          onPick={moduleId => updateNodeModules(nodeId, [{ moduleId, count: machineSlots }])}
          onClose={close}
        />
      )}
    </PickerTrigger>
  )
}
