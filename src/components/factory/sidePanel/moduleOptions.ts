import type { GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import type { Horizon } from '../../../data/horizon'
import { type ModuleEntity, type ModuleMisfitReason, isModuleAllowedForBeaconRow, isModuleAllowedForMachineRow } from '../../../data/moduleRules'

type Module = GameData['modules'][string]

const byName = (a: Module, b: Module) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/**
 * The modules a slot of a machine takes, by name: the machine's allowed effects, the recipe's limits and productivity flag, and the
 * research horizon. Empty without a machine.
 */
export function machineModuleOptions(
  gameData: GameData,
  horizon: Horizon,
  machine: ModuleEntity | undefined,
  recipeId: string,
): Module[] {
  if (!machine) return []
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
  return Object.values(gameData.modules)
    .filter(m =>
      isModuleAllowedForMachineRow(m, machine, recipeId, allowProductivity) && withinHorizon(horizon.moduleIds, m.id))
    .sort(byName)
}

/** The modules a beacon (the entity, or undefined for legacy data) accepts for a recipe, within the research horizon, by name. */
export function beaconModuleOptions(
  gameData: GameData,
  horizon: Horizon,
  beacon: ModuleEntity | undefined,
  recipeId: string,
): Module[] {
  const allowProductivity = gameData.recipes[recipeId]?.allowProductivity ?? false
  return Object.values(gameData.modules)
    .filter(m => withinHorizon(horizon.moduleIds, m.id) && isModuleAllowedForBeaconRow(m, beacon, recipeId, allowProductivity))
    .sort(byName)
}

/** The tooltip wording for a module that does not fit: the entity's rules or the recipe's. */
export function describeMisfit(reason: ModuleMisfitReason, moduleName: string, entityName: string, recipeName: string): string {
  return reason === 'recipe' ? `${moduleName} cannot be used for ${recipeName}` : `${moduleName} cannot be inserted in ${entityName}`
}

