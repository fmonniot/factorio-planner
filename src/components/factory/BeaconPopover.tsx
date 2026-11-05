import { useState } from 'react'
import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine, withinHorizon } from '../../data/horizon'
import { IconChip, MoreBadge } from './IconChip'
import { BeaconModal } from './BeaconModal'
import { isModuleAllowedForBeaconRow } from './moduleRules'

// ---------------------------------------------------------------------------
// BeaconCell — icon+badge trigger (or + placeholder), opens BeaconModal
// ---------------------------------------------------------------------------

interface BeaconCellProps {
  nodeId: string
  /**
   * The row's beacon configurations, shown as the first one plus a `+N` badge for the rest. The
   * single-configuration data model reaches this through `beaconConfig ? [beaconConfig] : []`.
   */
  beacons: BeaconConfig[]
  gameData: GameData
  // RecipeRow needs to pass these for the effects panels in the modal.
  recipeId: string
  machineId: string | undefined
  recipeCategory: string
}

export function BeaconCell({ nodeId, beacons, gameData, recipeId, machineId, recipeCategory }: BeaconCellProps) {
  const [open, setOpen] = useState(false)
  const beacon: BeaconConfig | undefined = beacons[0]
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)
  const horizon = useHorizon(gameData)
  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)

  const nonHiddenBeacons = Object.values(gameData.beacons).filter(b => !b.hidden)

  function enable() {
    // Pick the first beacon type within the horizon, or fall back to legacy defaults.
    const firstBeacon = nonHiddenBeacons
      .filter(b => withinHorizon(horizon.beaconIds, b.id))
      .sort((a, b) => a.name.localeCompare(b.name))[0]

    const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
    const firstModule = Object.values(gameData.modules)
      .filter(m =>
        withinHorizon(horizon.moduleIds, m.id) &&
        isModuleAllowedForBeaconRow(m, firstBeacon, recipeId, allowProductivity),
      )
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
    const noModule =
      horizon.moduleIds !== null && !Object.keys(gameData.modules).some(id => withinHorizon(horizon.moduleIds, id))
    const disabledTitle = row.noMachineInHorizon
      ? 'No machine within research horizon'
      : noBeacon
        ? 'No beacon within the research horizon'
        : noModule
          ? 'No module within the research horizon'
          : undefined
    return (
      <IconChip
        onClick={enable}
        size="entity"
        empty
        alt="Add beacon"
        disabled={disabledTitle !== undefined}
        title={disabledTitle ?? 'Add beacon'}
        aria-label="Add beacon"
        className={disabledTitle !== undefined ? 'opacity-40' : ''}
      />
    )
  }

  const beaconEntity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const moduleData = beacon.moduleId ? gameData.modules[beacon.moduleId] : undefined
  // A module id the loaded data set does not know (after switching data sets): the solver still counts it.
  const unknownModuleId = beacon.moduleId && !moduleData ? beacon.moduleId : undefined
  const beyondHorizon =
    (beacon.beaconId !== undefined && !withinHorizon(horizon.beaconIds, beacon.beaconId)) ||
    (beacon.moduleId !== undefined && !withinHorizon(horizon.moduleIds, beacon.moduleId))

  const slots = beaconEntity?.moduleSlots ?? beacon.modulesPerBeacon
  const more = beacons.length - 1
  const describe = (b: BeaconConfig) => {
    const name = (b.beaconId && gameData.beacons[b.beaconId]?.name) || 'Beacon'
    const mod = b.moduleId ? gameData.modules[b.moduleId]?.name ?? b.moduleId : 'no module'
    return `${b.beaconCount} × ${name}, ${b.modulesPerBeacon} × ${mod}`
  }
  const chipTitle = beacons.map(describe).join('; ')
  const editTitle = beyondHorizon ? 'Edit beacon (beyond research horizon)' : 'Edit beacon'

  return (
    <>
      <div className="flex items-center gap-1.5">
        <IconChip
          onClick={() => setOpen(o => !o)}
          size="entity"
          iconPath={(beaconEntity?.iconPath || moduleData?.iconPath) || undefined}
          alt={beaconEntity?.name ?? moduleData?.name ?? 'beacon'}
          fallback="B"
          quantity={beacon.beaconCount}
          quantityTestId="beacon-count"
          badges={more > 0 ? <MoreBadge count={more} /> : undefined}
          warn={beyondHorizon}
          title={more > 0 ? `${editTitle}: ${chipTitle}` : editTitle}
          aria-label="Edit beacon"
          data-beyond-horizon={beyondHorizon ? 'true' : undefined}
        />
        <IconChip
          onClick={() => setOpen(o => !o)}
          size="entity"
          empty={!moduleData && !unknownModuleId}
          warn={unknownModuleId !== undefined}
          iconPath={moduleData?.iconPath || undefined}
          alt={moduleData?.name ?? unknownModuleId ?? 'module'}
          fallback={unknownModuleId !== undefined ? '?' : '+'}
          quantity={`${moduleData || unknownModuleId ? beacon.modulesPerBeacon : 0}/${slots}`}
          title={
            moduleData ? `${moduleData.name} × ${beacon.modulesPerBeacon} per beacon`
            : unknownModuleId ? `Unknown module "${unknownModuleId}" × ${beacon.modulesPerBeacon} per beacon (not in the loaded game data)`
            : 'Beacon without a module'
          }
          aria-label="Edit beacon modules"
          data-testid="beacon-module-chip"
        />
      </div>

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
