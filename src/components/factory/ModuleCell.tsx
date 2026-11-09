import type { GameData, ModuleConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useHorizon } from '../../store/horizon'
import { withinHorizon } from '../../data/horizon'
import { IconChip } from './IconChip'
import { PickerTrigger } from './PickerTrigger'
import { ModuleFillPicker } from './ModuleFillPicker'
import { machineModuleOptions } from './sidePanel/moduleOptions'

interface ModuleCellProps {
  nodeId: string
  recipeId: string
  /** The row's resolved machine; the empty chip's picker lists the modules it takes. */
  machine: { allowedEffects: string[] } | undefined
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

  const title = noMachine
    ? 'Modules without a machine'
    : beyondHorizon
      ? 'Edit modules (beyond research horizon)'
      : overSlots
        ? machineSlots === 0
          ? 'Edit modules (this machine has no module slots)'
          : 'Edit modules (more modules than slots)'
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
      warn={beyondHorizon || overSlots}
      title={fillAll ? `Fill all ${machineSlots} slots with a module` : title}
      data-beyond-horizon={beyondHorizon ? 'true' : undefined}
      data-over-slots={overSlots ? 'true' : undefined}
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

/** The module type with the most modules; on a tie the first by module id. */
// eslint-disable-next-line react-refresh/only-export-components
export function mostUsedModule(modules: ModuleConfig[]): string | undefined {
  const counts = new Map<string, number>()
  for (const m of modules) counts.set(m.moduleId, (counts.get(m.moduleId) ?? 0) + m.count)
  let best: string | undefined
  for (const [id, n] of counts) {
    const bestN = best === undefined ? -1 : counts.get(best)!
    if (n > bestN || (n === bestN && id < best!)) best = id
  }
  return best
}
