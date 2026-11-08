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
 * Research cost of a technology: the science packs per unit, the unit count and
 * the seconds per unit. Null when the technology has no `unit` (it is completed
 * by a research trigger, not in a lab). `count` is null for a `count_formula`.
 * @returns {{ingredients:{itemId:string,amount:number}[], count:number|null, time:number} | null}
 */
export function technologyCost(proto) {
  const unit = proto.unit
  if (!unit || typeof unit !== 'object') return null
  const ingredients = luaList(unit.ingredients)
    .map(i => (Array.isArray(i) ? { itemId: i[0], amount: i[1] } : { itemId: i.name, amount: i.amount }))
    .filter(i => typeof i.itemId === 'string' && typeof i.amount === 'number' && i.amount > 0)
  return {
    ingredients,
    count: typeof unit.count === 'number' && unit.count > 0 ? unit.count : null,
    time: typeof unit.time === 'number' && unit.time >= 0 ? unit.time : 0,
  }
}

/** An id given as a string or as an object with a string `name` (e.g. `{name, quality}`); else undefined. */
function idOf(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof v.name === 'string') return v.name
  return undefined
}

/**
 * Research trigger of a technology (`research_trigger`): the in-game condition that completes it.
 * `count` comes from `count` (any type but craft-fluid) or, for craft-fluid only, `amount`; a zero or negative value is dropped. Only defined keys are
 * set; quality fields are dropped. Null when there is no trigger object with a string `type`.
 * @returns {{type:string, item?:string, entity?:string, fluid?:string, count?:number} | null}
 */
export function researchTrigger(proto) {
  const r = proto.research_trigger
  if (!r || typeof r !== 'object' || typeof r.type !== 'string') return null
  const out = { type: r.type }
  const item = idOf(r.item)
  if (item !== undefined) out.item = item
  const entity = idOf(r.entity)
  if (entity !== undefined) out.entity = entity
  const fluid = idOf(r.fluid)
  if (fluid !== undefined) out.fluid = fluid
  const n = r.type === 'craft-fluid' ? r.amount : r.count
  if (typeof n === 'number' && n > 0) out.count = n
  return out
}

/**
 * Add the `iconPath` of each technology, resolved from its prototype. Returns a
 * new record; the input is not modified.
 * @param technologies  the `technologies` record of exportTechnologies
 * @param raw           data.raw
 * @param resolveIcon   async (proto, id) => public URL, or '' when there is no icon
 */
export async function attachTechnologyIcons(technologies, raw, resolveIcon) {
  const out = {}
  for (const [id, t] of Object.entries(technologies)) {
    const proto = raw.technology?.[id]
    out[id] = { ...t, iconPath: proto ? await resolveIcon(proto, id) : '' }
  }
  return out
}

/**
 * @param raw          data.raw
 * @param recipeIds    Set<string> of the recipe ids in the bundle
 * @param resolveName  (proto) => string  display name of a technology
 * @returns {{ technologies: Record<string,{id:string,name:string,prerequisites:string[],unlockedRecipes:string[],
 *               cost:ReturnType<typeof technologyCost>, trigger?:ReturnType<typeof researchTrigger>}>,
 *             startingRecipes: string[] }}
 */
export function exportTechnologies(raw, recipeIds, resolveName) {
  // 1. Researchable technologies only. A technology is not researchable if it is
  // disabled or has a prerequisite that is not researchable (transitively); those
  // are dropped completely.
  const protos = raw.technology ?? {}
  const state = new Map() // id -> true (researchable) | false | 'visiting'
  function isResearchable(id) {
    const known = state.get(id)
    if (known === true || known === false) return known
    if (known === 'visiting') return true // cycle: decided by the other prerequisites
    const proto = protos[id]
    if (!proto) return true // unknown prerequisite: ignored, as before
    if (proto.enabled === false) {
      state.set(id, false)
      return false
    }
    state.set(id, 'visiting')
    const ok = luaList(proto.prerequisites).every(isResearchable)
    state.set(id, ok)
    return ok
  }
  const researchable = {}
  for (const [id, proto] of Object.entries(protos)) {
    if (isResearchable(id)) researchable[id] = proto
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
    const cost = technologyCost(proto)
    all[id] = {
      id,
      name: resolveName(proto),
      prerequisites: luaList(proto.prerequisites).filter(p => p in researchable),
      unlockedRecipes: unlocked,
      cost,
    }
    // The trigger condition is only exported for technologies that have no lab cost.
    const trigger = cost === null ? researchTrigger(proto) : null
    if (trigger) all[id].trigger = trigger
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
    .filter(id => raw.recipe?.[id] && raw.recipe[id].enabled !== false)
    .sort()

  return { technologies, startingRecipes }
}
