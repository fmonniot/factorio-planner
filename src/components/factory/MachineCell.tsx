import { useState } from 'react'
import type { GameData } from '../../data/types'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { IconChip } from './IconChip'
import { MachinePicker } from './sidePanel/MachinePicker'

// ---------------------------------------------------------------------------
// Shows the machine and its count; a click opens the machine picker under the chip
// ---------------------------------------------------------------------------

interface MachineCellProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  machineCountCeil: number
  gameData: GameData
}

export function MachineCell({
  nodeId,
  recipeId,
  recipeCategory,
  machineId,
  machineCountCeil,
  gameData,
}: MachineCellProps) {
  const [open, setOpen] = useState(false)
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
    <span className="relative inline-flex">
    <IconChip
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      data-testid="machine-chip"
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
    {open && (
      <MachinePicker
        nodeId={nodeId}
        recipeId={recipeId}
        recipeCategory={recipeCategory}
        machineId={machineId}
        gameData={gameData}
        onDone={() => setOpen(false)}
      />
    )}
    </span>
  )
}
