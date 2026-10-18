import type { GameData } from './types'

export function hasTechnologies(gameData: GameData): boolean {
  return Object.keys(gameData.technologies).length > 0
}

/** The targets plus all their transitive prerequisites. Unknown ids are ignored. */
export function technologyClosure(gameData: GameData, targetIds: readonly string[]): Set<string> {
  const visited = new Set<string>()
  const stack = [...targetIds]
  while (stack.length > 0) {
    const id = stack.pop()!
    const tech = gameData.technologies[id]
    if (!tech || visited.has(id)) continue
    visited.add(id)
    stack.push(...tech.prerequisites)
  }
  return visited
}

/**
 * Recipes offered under a research horizon: those available at game start plus
 * those unlocked by a targeted technology or one of its prerequisites. Returns
 * null (= no limit) when the data set has no technology data or no target is
 * a known technology.
 */
export function availableRecipeIds(gameData: GameData, targetIds: readonly string[]): Set<string> | null {
  if (!hasTechnologies(gameData)) return null
  const closure = technologyClosure(gameData, targetIds)
  if (closure.size === 0) return null
  const available = new Set(gameData.startingRecipes)
  for (const id of closure) {
    for (const recipeId of gameData.technologies[id].unlockedRecipes) available.add(recipeId)
  }
  return available
}
