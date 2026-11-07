import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine, withinHorizon } from '../../data/horizon'
import { IconChip, MoreBadge } from './IconChip'
import { PickerTrigger } from './PickerTrigger'
import { ModuleFillPicker } from './ModuleFillPicker'
import { availableBeacons, defaultBeaconConfig, DEFAULT_BEACON_COUNT } from './sidePanel/beaconDefaults'
import { beaconModuleOptions } from './sidePanel/moduleOptions'

// ---------------------------------------------------------------------------
// BeaconCell — beacon and module chips. Filled chips open the side panel on the Beacons section; the dashed + chips
// open a picker that creates the beacon or fills its modules.
// ---------------------------------------------------------------------------

interface BeaconCellProps {
  nodeId: string
  /**
   * The row's beacon configurations, shown as the first one plus a `+N` badge for the rest. The
   * single-configuration data model reaches this through `beaconConfig ? [beaconConfig] : []`.
   */
  beacons: BeaconConfig[]
  gameData: GameData
  recipeId: string
  machineId: string | undefined
  recipeCategory: string
  /** Select the row and highlight the Beacons section of the side panel. */
  onOpenEdit: () => void
}

export function BeaconCell({ nodeId, beacons, gameData, recipeId, machineId, recipeCategory, onOpenEdit }: BeaconCellProps) {
  const beacon: BeaconConfig | undefined = beacons[0]
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)
  const horizon = useHorizon(gameData)
  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)

  const nonHiddenBeacons = Object.values(gameData.beacons).filter(b => !b.hidden)

  /** One store command: the default beacon type and count with the chosen module in its slots. */
  function createWith(moduleId: string) {
    const config = defaultBeaconConfig(gameData, horizon, recipeId, moduleId)
    if (config) updateNodeBeacon(nodeId, config)
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
    // The picker lists what the default beacon type (the first within the horizon) accepts.
    const newBeacon = availableBeacons(gameData, horizon)[0]
    return (
      <PickerTrigger
        trigger={({ open, toggle }) => (
          <IconChip
            onClick={toggle}
            aria-expanded={open}
            size="entity"
            empty
            alt="Add beacon"
            disabled={disabledTitle !== undefined}
            title={disabledTitle ?? 'Add beacon'}
            aria-label="Add beacon"
            className={disabledTitle !== undefined ? 'opacity-40' : ''}
          />
        )}
      >
        {close => (
          <ModuleFillPicker
            heading={`Add ${DEFAULT_BEACON_COUNT} × Beacon, fill its slots with`}
            options={beaconModuleOptions(gameData, horizon, newBeacon, recipeId)}
            onPick={createWith}
            onClose={close}
          />
        )}
      </PickerTrigger>
    )
  }

  const beaconEntity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const moduleData = beacon.moduleId ? gameData.modules[beacon.moduleId] : undefined
  // A module id the loaded data set does not know (after switching data sets): the solver still counts it.
  const unknownModuleId = beacon.moduleId && !moduleData ? beacon.moduleId : undefined
  const beyondHorizon =
    (beacon.beaconId !== undefined && !withinHorizon(horizon.beaconIds, beacon.beaconId)) ||
    (beacon.moduleId !== undefined && !withinHorizon(horizon.moduleIds, beacon.moduleId))

  // The dashed module chip is the fill-all shortcut; one holding a module opens the panel.
  const fillBeacon = !moduleData && !unknownModuleId
  const slots = beaconEntity?.moduleSlots ?? beacon.modulesPerBeacon
  const more = beacons.length - 1
  const describe = (b: BeaconConfig) => {
    const name = (b.beaconId && gameData.beacons[b.beaconId]?.name) || 'Beacon'
    const mod = b.moduleId ? gameData.modules[b.moduleId]?.name ?? b.moduleId : 'no module'
    return `${b.beaconCount} × ${name}, ${b.modulesPerBeacon} × ${mod}`
  }
  const chipTitle = beacons.map(describe).join('; ')
  const editTitle = beyondHorizon ? 'Edit beacon (beyond research horizon)' : 'Edit beacon'

  const moduleChip = (toggle?: () => void, open?: boolean) => (
    <IconChip
      onClick={toggle ?? onOpenEdit}
      aria-expanded={toggle ? open : undefined}
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
  )

  return (
    <>
      <div className="flex items-center gap-1.5">
        <IconChip
          onClick={onOpenEdit}
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
        {fillBeacon ? (
          <PickerTrigger trigger={({ open, toggle }) => moduleChip(toggle, open)}>
            {close => (
              <ModuleFillPicker
                heading="Fill its slots with"
                options={beaconModuleOptions(gameData, horizon, beaconEntity, recipeId)}
                onPick={moduleId => updateNodeBeacon(nodeId, { ...beacon, moduleId })}
                onClose={close}
              />
            )}
          </PickerTrigger>
        ) : moduleChip()}
      </div>
    </>
  )
}
