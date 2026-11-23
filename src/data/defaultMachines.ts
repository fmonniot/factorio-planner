import { recipeFallbackKey, withinHorizon, type Horizon } from './horizon'
import type { Block, GameData, Machine, SubPlan } from './types'

/**
 * Readable label for a crafting category: the game's own name when the data set has one (`categoryNames`),
 * else one made from the id: "mining:basic-solid" -> "Mining basic solid".
 */
export function categoryLabel(category: string, gameData?: Pick<GameData, 'categoryNames'>): string {
  const names = gameData?.categoryNames
  if (names && Object.hasOwn(names, category) && names[category]) return names[category]
  const spaced = category.replace(/[:_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Non-hidden machines inside the horizon that craft `category` or one of the recipe's `additionalCategories`,
 * sorted by name.
 */
export function availableMachinesFor(
  gameData: GameData, horizon: Horizon, category: string, additionalCategories: readonly string[] = [],
): Machine[] {
  return Object.values(gameData.machines)
    .filter(m => !m.hidden && withinHorizon(horizon.machineIds, m.id) &&
      (m.craftingCategories.includes(category) || additionalCategories.some(c => m.craftingCategories.includes(c))))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Crafting categories with at least two available machines (a real choice), sorted by label. A category that no
 * recipe has as its primary `category` (only ever an additional one, like Seablock's `electronics`) is left out:
 * a default set for it would change no row.
 */
export function defaultMachineCategories(gameData: GameData, horizon: Horizon): string[] {
  const primary = new Set(Object.values(gameData.recipes).map(r => r.category))
  const counts = new Map<string, number>()
  for (const m of Object.values(gameData.machines)) {
    if (m.hidden || !withinHorizon(horizon.machineIds, m.id)) continue
    for (const category of m.craftingCategories) counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts]
    .filter(([category, n]) => n >= 2 && primary.has(category))
    .map(([category]) => ({ category, label: categoryLabel(category, gameData) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ category }) => category)
}

/**
 * Category -> number of recipe rows (all blocks, nested sub-plans included) that follow the category's default
 * machine. A row whose category has no default in the horizon but which uses its recipe's additional-category
 * fallback (`horizon.defaultMachines`) is left out: changing the category default does not move it.
 */
export function defaultMachineRowCounts(
  blocks: readonly Block[], gameData: GameData, horizon: Pick<Horizon, 'defaultMachines'>,
): Map<string, number> {
  const defaults = horizon.defaultMachines
  const counts = new Map<string, number>()
  function visit(plan: SubPlan) {
    for (const node of plan.nodes) {
      if (node.kind !== 'game-recipe' || node.machineId !== undefined) continue
      const recipe = gameData.recipes[node.recipeId]
      if (!recipe) continue
      if (defaults[recipe.category] === undefined && defaults[recipeFallbackKey(recipe.id)] !== undefined) continue
      counts.set(recipe.category, (counts.get(recipe.category) ?? 0) + 1)
    }
    plan.subPlans.forEach(visit)
  }
  for (const block of blocks) visit(block.rootPlan)
  return counts
}
