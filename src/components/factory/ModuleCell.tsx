import type { GameData, ModuleConfig } from '../../data/types'
import { useHorizon } from '../../store/horizon'
import { withinHorizon } from '../../data/horizon'
import { Icon } from '../Icon'

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
  const firstModule = modules[0] ? gameData.modules[modules[0].moduleId] : undefined

  return (
    <button
      type="button"
      onClick={onOpenEdit}
      className={`relative w-8 h-8 shrink-0 hover:ring-1 hover:ring-gray-500 rounded ${beyondHorizon || overSlots ? 'ring-1 ring-amber-500' : ''}`}
      title={title}
      data-beyond-horizon={beyondHorizon ? 'true' : undefined}
      data-over-slots={overSlots ? 'true' : undefined}
    >
      {firstModule?.iconPath ? (
        <Icon
          iconPath={firstModule.iconPath}
          alt={firstModule.name}
          className="w-full h-full object-contain"
        />
      ) : (
        <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">
          +
        </span>
      )}
      <span
        className="absolute bottom-0 right-0 text-[9px] text-white leading-none px-px"
        style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}
      >
        {usedSlots}/{machineSlots}
      </span>
    </button>
  )
}
