import type { GameData } from '../../data/types'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { IconChip } from './IconChip'

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
    <IconChip
      onClick={onOpenEdit}
      size="entity"
      iconPath={machine?.iconPath || undefined}
      alt={machine?.name ?? '?'}
      fallback="?"
      quantity={machineCountCeil}
      quantityTestId="machine-count"
      warn={flagged}
      title={title}
      data-beyond-horizon={flagged ? 'true' : undefined}
      data-no-machine={row.noMachineInHorizon ? 'true' : undefined}
    />
  )
}
