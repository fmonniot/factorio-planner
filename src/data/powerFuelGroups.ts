import type { Recipe } from './types'

/** One row of a recipe list: a recipe, or the power recipes of one machine collapsed into a fuel choice. */
export type RecipeEntry =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'fuel-group'; machineId: string; recipes: Recipe[] }

/** The machine a power recipe runs in (boilers, generators and reactors have one recipe per fuel). */
export function powerMachineId(recipe: Recipe): string | undefined {
  return recipe.power && recipe.madeIn.length > 0 ? recipe.madeIn[0] : undefined
}

/** The fuel (or steam, or heat) a power recipe takes: its last ingredient. */
export function powerInputItemId(recipe: Recipe): string | undefined {
  return recipe.power ? recipe.ingredients.at(-1)?.itemId : undefined
}

/**
 * Collapses the power recipes of one machine into a single `fuel-group` entry, at the position of
 * the machine's first recipe. A machine with a single recipe in the list stays a plain recipe.
 * Order is preserved, within groups too; the input is not mutated.
 */
export function groupPowerRecipes(recipes: readonly Recipe[]): RecipeEntry[] {
  const counts = new Map<string, number>()
  for (const r of recipes) {
    const id = powerMachineId(r)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const groups = new Map<string, Extract<RecipeEntry, { kind: 'fuel-group' }>>()
  const entries: RecipeEntry[] = []
  for (const r of recipes) {
    const id = powerMachineId(r)
    if (!id || (counts.get(id) ?? 0) < 2) {
      entries.push({ kind: 'recipe', recipe: r })
      continue
    }
    const group = groups.get(id)
    if (group) {
      group.recipes.push(r)
    } else {
      const created = { kind: 'fuel-group' as const, machineId: id, recipes: [r] }
      groups.set(id, created)
      entries.push(created)
    }
  }
  return entries
}
