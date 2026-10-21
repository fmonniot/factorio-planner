import { withinHorizon, type Horizon } from './horizon'
import type { Block, GameData, Machine, SubPlan } from './types'

/** Readable label for a crafting category id: "mining:basic-solid" -> "Mining basic solid". */
export function categoryLabel(category: string): string {
  const spaced = category.replace(/[:_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Non-hidden machines inside the horizon that craft `category`, sorted by name. */
export function availableMachinesFor(gameData: GameData, horizon: Horizon, category: string): Machine[] {
  return Object.values(gameData.machines)
    .filter(m => !m.hidden && m.craftingCategories.includes(category) && withinHorizon(horizon.machineIds, m.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Crafting categories with at least two available machines (a real choice), sorted by label. */
export function defaultMachineCategories(gameData: GameData, horizon: Horizon): string[] {
  const counts = new Map<string, number>()
  for (const m of Object.values(gameData.machines)) {
    if (m.hidden || !withinHorizon(horizon.machineIds, m.id)) continue
    for (const category of m.craftingCategories) counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, n]) => n >= 2)
    .map(([category]) => category)
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
}

/** Category -> number of recipe rows (all blocks, nested sub-plans included) that follow the default machine. */
export function defaultMachineRowCounts(blocks: readonly Block[], gameData: GameData): Map<string, number> {
  const counts = new Map<string, number>()
  function visit(plan: SubPlan) {
    for (const node of plan.nodes) {
      if (node.kind !== 'game-recipe' || node.machineId !== undefined) continue
      const recipe = gameData.recipes[node.recipeId]
      if (!recipe) continue
      counts.set(recipe.category, (counts.get(recipe.category) ?? 0) + 1)
    }
    plan.subPlans.forEach(visit)
  }
  for (const block of blocks) visit(block.rootPlan)
  return counts
}
