import { useState } from 'react'
import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { iconUrl } from '../../utils/iconUrl'
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

  function enable() {
    // Pick the first non-hidden beacon type, or fall back to legacy defaults.
    const firstBeacon = Object.values(gameData.beacons)
      .filter(b => !b.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))[0]

    const firstModule = Object.values(gameData.modules)
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
    return (
      <button
        type="button"
        onClick={enable}
        className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 text-gray-500 hover:text-gray-200 hover:bg-gray-700 text-xs leading-none"
        title="Add beacon"
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative w-7 h-7 shrink-0 hover:ring-1 hover:ring-gray-500 rounded"
        title="Edit beacon"
        aria-label="Edit beacon"
      >
        {displayIcon ? (
          <img
            src={iconUrl(displayIcon)}
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
