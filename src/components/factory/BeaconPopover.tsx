import { useState } from 'react'
import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine, withinHorizon } from '../../data/horizon'
import { Icon } from '../Icon'
import { BeaconModal } from './BeaconModal'

// ---------------------------------------------------------------------------
// BeaconCell — icon+badge trigger (or + placeholder), opens BeaconModal
// ---------------------------------------------------------------------------

interface BeaconCellProps {
  nodeId: string
  beacon: BeaconConfig | undefined
  gameData: GameData
  // RecipeRow needs to pass these for the effects panels in the modal.
  recipeId: string
  machineId: string | undefined
  recipeCategory: string
}

export function BeaconCell({ nodeId, beacon, gameData, recipeId, machineId, recipeCategory }: BeaconCellProps) {
  const [open, setOpen] = useState(false)
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)
  const horizon = useHorizon(gameData)
  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)

  const nonHiddenBeacons = Object.values(gameData.beacons).filter(b => !b.hidden)

  function enable() {
    // Pick the first beacon type within the horizon, or fall back to legacy defaults.
    const firstBeacon = nonHiddenBeacons
      .filter(b => withinHorizon(horizon.beaconIds, b.id))
      .sort((a, b) => a.name.localeCompare(b.name))[0]

    const firstModule = Object.values(gameData.modules)
      .filter(m => withinHorizon(horizon.moduleIds, m.id))
      .sort((a, b) => a.name.localeCompare(b.name))[0]

    if (!firstModule) return

    const config: BeaconConfig = firstBeacon
      ? {
          beaconId: firstBeacon.id,
          moduleId: firstModule.id,
          beaconCount: 4,
          modulesPerBeacon: firstBeacon.moduleSlots,
          distributionEfficiency: firstBeacon.distributionEfficiency,
        }
      : {
          moduleId: firstModule.id,
          beaconCount: 4,
          modulesPerBeacon: 2,
          distributionEfficiency: 0.5,
        }

    updateNodeBeacon(nodeId, config)
    setOpen(true)
  }

  if (!beacon) {
    const noBeacon =
      nonHiddenBeacons.length > 0 && !nonHiddenBeacons.some(b => withinHorizon(horizon.beaconIds, b.id))
    const noModule = !Object.keys(gameData.modules).some(id => withinHorizon(horizon.moduleIds, id))
    const disabledTitle = row.noMachineInHorizon
      ? 'No machine within research horizon'
      : noBeacon
        ? 'No beacon within the research horizon'
        : noModule
          ? 'No module within the research horizon'
          : undefined
    return (
      <button
        type="button"
        onClick={enable}
        disabled={disabledTitle !== undefined}
        className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 text-gray-500 hover:text-gray-200 hover:bg-gray-700 text-xs leading-none disabled:opacity-40 disabled:hover:bg-gray-800 disabled:hover:text-gray-500"
        title={disabledTitle ?? 'Add beacon'}
        aria-label="Add beacon"
      >
        +
      </button>
    )
  }

  // Determine the icon: prefer the beacon-type icon, fall back to module icon.
  const beaconEntity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const moduleData = gameData.modules[beacon.moduleId]
  const displayIcon = beaconEntity?.iconPath ?? moduleData?.iconPath
  const beyondHorizon =
    (beacon.beaconId !== undefined && !withinHorizon(horizon.beaconIds, beacon.beaconId)) ||
    !withinHorizon(horizon.moduleIds, beacon.moduleId)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`relative w-7 h-7 shrink-0 hover:ring-1 hover:ring-gray-500 rounded ${beyondHorizon ? 'ring-1 ring-amber-500' : ''}`}
        title={beyondHorizon ? 'Edit beacon (beyond research horizon)' : 'Edit beacon'}
        aria-label="Edit beacon"
        data-beyond-horizon={beyondHorizon ? 'true' : undefined}
      >
        {displayIcon ? (
          <Icon
            iconPath={displayIcon}
            alt={beaconEntity?.name ?? moduleData?.name ?? 'beacon'}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">
            🔆
          </span>
        )}
        <span
          className="absolute bottom-0 right-0 text-[9px] text-white leading-none px-px"
          style={{ textShadow: '0 0 2px #000, 0 0 2px #000' }}
        >
          {beacon.beaconCount}×
        </span>
      </button>

      {open && (
        <BeaconModal
          nodeId={nodeId}
          beacon={beacon}
          recipeId={recipeId}
          machineId={machineId}
          recipeCategory={recipeCategory}
          gameData={gameData}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
