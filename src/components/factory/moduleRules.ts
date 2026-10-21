export function isModuleAllowedInMachine(
  module: { effects: Record<string, number> },
  machine: { allowedEffects: string[] },
): boolean {
  return Object.keys(module.effects).every(e => machine.allowedEffects.includes(e))
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
