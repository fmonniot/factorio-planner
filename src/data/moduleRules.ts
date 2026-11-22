/** A machine or beacon entity, as far as module insertion goes. */
export interface ModuleEntity {
  allowedEffects: readonly string[]
  /** Absent = every module category; `[]` = none. */
  allowedModuleCategories?: readonly string[]
}

export type ModuleMisfit = 'effect' | 'category'

interface ModuleLike {
  effects: Record<string, number | undefined>
  category: string
}

const categoryAllowed = (module: ModuleLike, entity: ModuleEntity) =>
  entity.allowedModuleCategories === undefined || entity.allowedModuleCategories.includes(module.category)

/**
 * Why a module cannot sit in a machine, or undefined when it can. Effects first: every effect the module carries (a zero
 * value counts) must be in the machine's `allowedEffects`; then its category must be in `allowedModuleCategories`.
 */
export function moduleMisfitInMachine(module: ModuleLike, machine: ModuleEntity): ModuleMisfit | undefined {
  if (!Object.keys(module.effects).every(e => machine.allowedEffects.includes(e))) return 'effect'
  return categoryAllowed(module, machine) ? undefined : 'category'
}

/**
 * Why a module cannot sit in a beacon, or undefined when it can. Like the machine rule, except that an effect with a zero
 * value counts as absent.
 */
export function moduleMisfitInBeacon(module: ModuleLike, beacon: ModuleEntity): ModuleMisfit | undefined {
  const effectsFit = Object.entries(module.effects).every(
    ([effect, value]) => !value || beacon.allowedEffects.includes(effect),
  )
  if (!effectsFit) return 'effect'
  return categoryAllowed(module, beacon) ? undefined : 'category'
}

export const isModuleAllowedInMachine = (module: ModuleLike, machine: ModuleEntity): boolean =>
  moduleMisfitInMachine(module, machine) === undefined

export const isModuleAllowedInBeacon = (module: ModuleLike, beacon: ModuleEntity): boolean =>
  moduleMisfitInBeacon(module, beacon) === undefined

// Whether a module can sit in a beacon serving a recipe: the beacon's allowed
// effects and module categories (skipped when there is no beacon entity, i.e.
// legacy data), the module's recipe limitation lists and the recipe's
// productivity flag.
export function isModuleAllowedForBeaconRow(
  module: {
    effects: Record<string, number | undefined>
    category: string
    limitation: string[]
    limitationBlacklist: string[]
  },
  beacon: ModuleEntity | undefined,
  recipeId: string,
  allowProductivity: boolean,
): boolean {
  return (
    (!beacon || isModuleAllowedInBeacon(module, beacon)) &&
    isModuleAllowedForRecipe(module, recipeId) &&
    isModuleAllowedByProductivity(module, allowProductivity)
  )
}

export function isModuleAllowedForRecipe(
  module: { limitation: string[]; limitationBlacklist: string[] },
  recipeId: string,
): boolean {
  if (module.limitation.length > 0 && !module.limitation.includes(recipeId)) return false
  if (module.limitationBlacklist.includes(recipeId)) return false
  return true
}

// A module with a positive productivity effect is only insertable in a recipe
// that allows productivity.
export function isModuleAllowedByProductivity(
  module: { effects: Record<string, number | undefined> },
  allowProductivity: boolean,
): boolean {
  return allowProductivity || (module.effects.productivity ?? 0) <= 0
}
