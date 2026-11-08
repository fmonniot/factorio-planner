import type { BeaconConfig, GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import type { Horizon } from '../../../data/horizon'
import { beaconModuleOptions } from './moduleOptions'

/** Beacons a new configuration starts with. */
export const DEFAULT_BEACON_COUNT = 4

/** The beacon types a row may use: visible and within the research horizon, by name. */
export function availableBeacons(gameData: GameData, horizon: Horizon) {
  return Object.values(gameData.beacons)
    .filter(b => !b.hidden && withinHorizon(horizon.beaconIds, b.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Why adding a beacon to a row is not possible, or undefined when it is. The table's `+` chip and the side
 * panel's add button share it, so they always agree.
 */
export function beaconAddBlockedReason(gameData: GameData, horizon: Horizon, noMachineInHorizon: boolean): string | undefined {
  if (noMachineInHorizon) return 'No machine within research horizon'
  const nonHidden = Object.values(gameData.beacons).filter(b => !b.hidden)
  if (nonHidden.length > 0 && !nonHidden.some(b => withinHorizon(horizon.beaconIds, b.id))) {
    return 'No beacon within the research horizon'
  }
  if (horizon.moduleIds !== null && !Object.keys(gameData.modules).some(id => withinHorizon(horizon.moduleIds, id))) {
    return 'No module within the research horizon'
  }
  return undefined
}

/**
 * The configuration "add a beacon" creates: the first beacon type within the horizon (by name; legacy defaults
 * when the data has none) and 4 beacons, with `moduleId` in its slots, or the first module the beacon accepts for the recipe
 * when none is given. Undefined when no module fits.
 */
export function defaultBeaconConfig(gameData: GameData, horizon: Horizon, recipeId: string, moduleId?: string): BeaconConfig | undefined {
  const firstBeacon = availableBeacons(gameData, horizon)[0]
  const chosen = moduleId ?? beaconModuleOptions(gameData, horizon, firstBeacon, recipeId)[0]?.id
  if (!chosen) return undefined
  return firstBeacon
    ? {
        beaconId: firstBeacon.id,
        moduleId: chosen,
        beaconCount: DEFAULT_BEACON_COUNT,
        modulesPerBeacon: firstBeacon.moduleSlots,
        distributionEfficiency: firstBeacon.distributionEfficiency,
      }
    : { moduleId: chosen, beaconCount: DEFAULT_BEACON_COUNT, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
}
