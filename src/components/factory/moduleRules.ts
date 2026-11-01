export function isModuleAllowedInMachine(
  module: { effects: Record<string, number> },
  machine: { allowedEffects: string[] },
): boolean {
  return Object.keys(module.effects).every(e => machine.allowedEffects.includes(e))
}

// A module is insertable in a beacon only if every effect it carries (a zero
// value counts as absent) is in the beacon's `allowedEffects`.
export function isModuleAllowedInBeacon(
  module: { effects: Record<string, number | undefined> },
  beacon: { allowedEffects: string[] },
): boolean {
  return Object.entries(module.effects).every(
    ([effect, value]) => !value || beacon.allowedEffects.includes(effect),
  )
}

// Whether a module can sit in a beacon serving a recipe: the beacon's allowed
// effects (skipped when there is no beacon entity, i.e. legacy data), the
// module's recipe limitation lists and the recipe's productivity flag.
export function isModuleAllowedForBeaconRow(
  module: {
    effects: Record<string, number | undefined>
    limitation: string[]
    limitationBlacklist: string[]
  },
  beacon: { allowedEffects: string[] } | undefined,
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
