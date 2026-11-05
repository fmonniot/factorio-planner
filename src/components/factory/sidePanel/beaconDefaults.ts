import type { BeaconConfig, GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import type { Horizon } from '../../../data/horizon'
import { isModuleAllowedForBeaconRow } from '../moduleRules'

/** Beacons a new configuration starts with. */
export const DEFAULT_BEACON_COUNT = 4

/** The beacon types a row may use: visible and within the research horizon, by name. */
export function availableBeacons(gameData: GameData, horizon: Horizon) {
  return Object.values(gameData.beacons)
    .filter(b => !b.hidden && withinHorizon(horizon.beaconIds, b.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The configuration "add a beacon" creates: the first beacon type within the horizon (by name; legacy defaults
 * when the data has none) with the first module it accepts for the recipe, and 4 beacons. Undefined when no module fits.
 */
export function defaultBeaconConfig(gameData: GameData, horizon: Horizon, recipeId: string): BeaconConfig | undefined {
  const firstBeacon = availableBeacons(gameData, horizon)[0]
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
  const firstModule = Object.values(gameData.modules)
    .filter(m => withinHorizon(horizon.moduleIds, m.id) && isModuleAllowedForBeaconRow(m, firstBeacon, recipeId, allowProductivity))
    .sort((a, b) => a.name.localeCompare(b.name))[0]
  if (!firstModule) return undefined
  return firstBeacon
    ? {
        beaconId: firstBeacon.id,
        moduleId: firstModule.id,
        beaconCount: DEFAULT_BEACON_COUNT,
        modulesPerBeacon: firstBeacon.moduleSlots,
        distributionEfficiency: firstBeacon.distributionEfficiency,
      }
    : { moduleId: firstModule.id, beaconCount: DEFAULT_BEACON_COUNT, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
}
