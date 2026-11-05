import type { GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import type { Horizon } from '../../../data/horizon'
import { isModuleAllowedByProductivity, isModuleAllowedForBeaconRow, isModuleAllowedForRecipe, isModuleAllowedInMachine } from '../moduleRules'

type Module = GameData['modules'][string]

const byName = (a: Module, b: Module) => a.name.localeCompare(b.name)

/**
 * The modules a slot of a machine takes: the machine's allowed effects, the recipe's limits and productivity flag, and the
 * research horizon. Empty without a machine.
 */
export function machineModuleOptions(
  gameData: GameData,
  horizon: Horizon,
  machine: { allowedEffects: string[] } | undefined,
  recipeId: string,
): Module[] {
  if (!machine) return []
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
  return Object.values(gameData.modules)
    .filter(m =>
      isModuleAllowedInMachine(m, machine) &&
      isModuleAllowedForRecipe(m, recipeId) &&
      isModuleAllowedByProductivity(m, allowProductivity) &&
      withinHorizon(horizon.moduleIds, m.id))
}

/** The modules a beacon (the entity, or undefined for legacy data) accepts for a recipe, within the research horizon. */
export function beaconModuleOptions(
  gameData: GameData,
  horizon: Horizon,
  beacon: { allowedEffects: string[] } | undefined,
  recipeId: string,
): Module[] {
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
  return Object.values(gameData.modules)
    .filter(m => withinHorizon(horizon.moduleIds, m.id) && isModuleAllowedForBeaconRow(m, beacon, recipeId, allowProductivity))
    .sort(byName)
}
