/**
 * technologies.js
 *
 * Pure helpers that turn the `technology` and `recipe` prototypes of a
 * `factorio --dump-data` dump into the technology data of a game-data bundle.
 * Kept free of side effects so unit tests can import it (build-game-data.js
 * runs its main code at the top level).
 */

/** Normalise a Lua table that may be an array, an empty object `{}` or missing. */
export function luaList(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return Object.values(v)
  return []
}

/**
 * @param raw          data.raw
 * @param recipeIds    Set<string> of the recipe ids in the bundle
 * @param resolveName  (proto) => string  display name of a technology
 * @returns {{ technologies: Record<string,{id:string,name:string,prerequisites:string[],unlockedRecipes:string[]}>,
 *             startingRecipes: string[] }}
 */
export function exportTechnologies(raw, recipeIds, resolveName) {
  // 1. Researchable technologies only; disabled ones are dropped completely.
  const researchable = {}
  for (const [id, proto] of Object.entries(raw.technology ?? {})) {
    if (proto.enabled !== false) researchable[id] = proto
  }

  // 2. Per technology: the bundle recipes it unlocks and its researchable prerequisites.
  const all = {}
  for (const [id, proto] of Object.entries(researchable)) {
    const unlocked = []
    for (const effect of luaList(proto.effects)) {
      if (effect.type !== 'unlock-recipe') continue
      if (!recipeIds.has(effect.recipe) || unlocked.includes(effect.recipe)) continue
      unlocked.push(effect.recipe)
    }
    all[id] = {
      id,
      name: resolveName(proto),
      prerequisites: luaList(proto.prerequisites).filter(p => p in researchable),
      unlockedRecipes: unlocked,
    }
  }

  // 3. Keep technologies that unlock a recipe, plus all their prerequisites (transitively).
  const keep = new Set()
  const stack = Object.values(all).filter(t => t.unlockedRecipes.length > 0).map(t => t.id)
  while (stack.length > 0) {
    const id = stack.pop()
    if (keep.has(id)) continue
    keep.add(id)
    stack.push(...all[id].prerequisites)
  }
  const technologies = {}
  for (const id of Object.keys(all)) {
    if (keep.has(id)) technologies[id] = all[id]
  }

  // 4. Recipes available at game start.
  const startingRecipes = [...recipeIds]
    .filter(id => raw.recipe?.[id]?.enabled !== false)
    .sort()

  return { technologies, startingRecipes }
}
