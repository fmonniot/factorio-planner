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

/**
 * Items a research horizon leaves offered as goals: those no recipe produces
 * (raw resources, whose extraction is not modelled) and those with at least one
 * non-hidden producing recipe inside the horizon. Hidden recipes are ignored
 * entirely: an item only hidden recipes produce counts as having no producer
 * (always offered), and a hidden recipe never rescues an item whose non-hidden
 * producers are all outside the horizon. Returns null (= no limit) when
 * `recipeIds` is null.
 */
export function availableItemIds(gameData: GameData, recipeIds: ReadonlySet<string> | null): Set<string> | null {
  if (!recipeIds) return null
  const produced = new Set<string>()
  const reachable = new Set<string>()
  for (const r of Object.values(gameData.recipes)) {
    if (r.hidden) continue
    const inside = recipeIds.has(r.id)
    for (const p of r.products) {
      produced.add(p.itemId)
      if (inside) reachable.add(p.itemId)
    }
  }
  return new Set(Object.keys(gameData.items).filter(id => !produced.has(id) || reachable.has(id)))
}
