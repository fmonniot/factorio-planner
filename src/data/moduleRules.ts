/** A machine or beacon entity, as far as module insertion goes. */
export interface ModuleEntity {
  allowedEffects: readonly string[]
  /** Absent = every module category; `[]` = none. */
  allowedModuleCategories?: readonly string[]
}

export type ModuleMisfit = 'effect' | 'category'
/** A misfit with the entity or with the recipe it serves. */
export type ModuleMisfitReason = ModuleMisfit | 'recipe'

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

type RowModule = {
  effects: Record<string, number | undefined>
  category: string
  limitation: string[]
  limitationBlacklist: string[]
}

/**
 * Why a module cannot serve a recipe, or undefined when it can: the module's recipe limitation lists leave the recipe out,
 * or it carries productivity and the recipe does not allow productivity.
 */
export function moduleMisfitForRecipe(
  module: RowModule,
  recipeId: string,
  allowProductivity: boolean,
): 'recipe' | undefined {
  return isModuleAllowedForRecipe(module, recipeId) && isModuleAllowedByProductivity(module, allowProductivity)
    ? undefined
    : 'recipe'
}

/** Why a module cannot sit in a row's machine: the machine's rules first (skipped without a machine), then the recipe's. */
export function moduleMisfitInMachineRow(
  module: RowModule,
  machine: ModuleEntity | undefined,
  recipeId: string,
  allowProductivity: boolean,
): ModuleMisfitReason | undefined {
  return (machine && moduleMisfitInMachine(module, machine)) || moduleMisfitForRecipe(module, recipeId, allowProductivity)
}

/** Why a module cannot sit in a beacon serving a row: the beacon's rules first (skipped without an entity, i.e. legacy data), then the recipe's. */
export function moduleMisfitInBeaconRow(
  module: RowModule,
  beacon: ModuleEntity | undefined,
  recipeId: string,
  allowProductivity: boolean,
): ModuleMisfitReason | undefined {
  return (beacon && moduleMisfitInBeacon(module, beacon)) || moduleMisfitForRecipe(module, recipeId, allowProductivity)
}

// Whether a module can sit in a beacon serving a recipe: the beacon's allowed
// effects and module categories (skipped when there is no beacon entity, i.e.
// legacy data), the module's recipe limitation lists and the recipe's
// productivity flag.
export const isModuleAllowedForBeaconRow = (
  module: RowModule,
  beacon: ModuleEntity | undefined,
  recipeId: string,
  allowProductivity: boolean,
): boolean => moduleMisfitInBeaconRow(module, beacon, recipeId, allowProductivity) === undefined

/** Whether a module can sit in a machine running a recipe: the machine's rules, the module's recipe limits and the productivity flag. */
export const isModuleAllowedForMachineRow = (
  module: RowModule,
  machine: ModuleEntity | undefined,
  recipeId: string,
  allowProductivity: boolean,
): boolean => moduleMisfitInMachineRow(module, machine, recipeId, allowProductivity) === undefined

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
