import type { GameData, ModuleConfig } from '../../data/types'
import { useHorizon } from '../../store/horizon'
import { withinHorizon } from '../../data/horizon'
import { IconChip } from './IconChip'

interface ModuleCellProps {
  modules: ModuleConfig[]
  machineSlots: number
  gameData: GameData
  /** The row has no machine at all (the research horizon removed its default). */
  noMachine?: boolean
  onOpenEdit: () => void
}

export function ModuleCell({ modules, machineSlots, gameData, noMachine = false, onOpenEdit }: ModuleCellProps) {
  const horizon = useHorizon(gameData)
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

  return (
    <IconChip
      onClick={onOpenEdit}
      size="entity"
      empty={modules.length === 0}
      iconPath={shownModule?.iconPath || undefined}
      alt={shownModule?.name ?? 'module'}
      fallback="+"
      quantity={`${usedSlots}/${machineSlots}`}
      warn={beyondHorizon || overSlots}
      title={title}
      data-beyond-horizon={beyondHorizon ? 'true' : undefined}
      data-over-slots={overSlots ? 'true' : undefined}
    />
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
