import type { GameData } from '../../data/types'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { Icon } from '../Icon'

// ---------------------------------------------------------------------------
// Shows the machine and its count; opens the edit modal on click
// ---------------------------------------------------------------------------

interface MachineCellProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  machineCountCeil: number
  gameData: GameData
  onOpenEdit: () => void
}

export function MachineCell({
  recipeCategory,
  machineId,
  machineCountCeil,
  gameData,
  onOpenEdit,
}: MachineCellProps) {
  const horizon = useHorizon(gameData)
  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)
  const { machine } = row
  const flagged = row.beyondHorizon || row.noMachineInHorizon
  const title = row.noMachineInHorizon
    ? 'No machine within research horizon'
    : row.beyondHorizon
      ? `${machine?.name} (beyond research horizon)`
      : (machine?.name ?? 'Edit machine')

  return (
    <button
      type="button"
      onClick={onOpenEdit}
      className={`relative w-8 h-8 shrink-0 hover:ring-1 hover:ring-gray-500 rounded ${flagged ? 'ring-1 ring-amber-500' : ''}`}
      title={title}
      data-beyond-horizon={flagged ? 'true' : undefined}
      data-no-machine={row.noMachineInHorizon ? 'true' : undefined}
    >
      {machine?.iconPath ? (
        <Icon
          iconPath={machine.iconPath}
          alt={machine.name}
          className="w-full h-full object-contain"
        />
      ) : (
        <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">
          ?
        </span>
      )}
      <span data-testid="machine-count" className="absolute bottom-0 right-0 text-[9px] text-white leading-none px-px"
        style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}>
        {machineCountCeil}
      </span>
    </button>
  )
}
