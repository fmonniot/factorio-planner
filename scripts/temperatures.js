/**
 * Fluid and product temperatures, shared by the full export and
 * `--patch-temperatures` so the two paths cannot disagree.
 */

/**
 * Temperature fields of a fluid prototype. `max_temperature` defaults to
 * `default_temperature` (Factorio's rule). Empty when there is no finite
 * `default_temperature`.
 * @param {any} proto fluid prototype
 * @returns {{ defaultTemperature?: number, maxTemperature?: number }}
 */
export function fluidTemperatures(proto) {
  const d = proto?.default_temperature
  if (!Number.isFinite(d)) return {}
  const m = proto.max_temperature
  return { defaultTemperature: d, maxTemperature: Number.isFinite(m) ? m : d }
}

/**
 * Explicit output temperature of a recipe product prototype, or undefined.
 * @param {any} prod product prototype (table form; the array shorthand has none)
 * @returns {number | undefined}
 */
export function productTemperature(prod) {
  if (!prod || Array.isArray(prod) || prod.type !== 'fluid') return undefined
  return Number.isFinite(prod.temperature) ? prod.temperature : undefined
}

/**
 * Set the temperature fields on every bundle fluid that has a prototype; drop
 * stale ones first. Items without a prototype and non-fluids are returned
 * unchanged (same reference).
 * @param {Record<string, any>} items exported items, keyed by id
 * @param {Record<string, any>} rawFluids `raw.fluid` of the dump
 * @returns {{ items: Record<string, any>, count: number }}
 */
export function attachFluidTemperatures(items, rawFluids) {
  const out = {}
  let count = 0
  for (const [id, item] of Object.entries(items)) {
    const proto = rawFluids[id]
    if (item.type !== 'fluid' || !proto) {
      out[id] = item
      continue
    }
    const { defaultTemperature: _d, maxTemperature: _m, ...rest } = item
    const temps = fluidTemperatures(proto)
    if (temps.defaultTemperature !== undefined) count++
    out[id] = { ...rest, ...temps }
  }
  return { items: out, count }
}

/**
 * Set `temperature` on the bundle recipes' fluid products from the dump,
 * pairing products by index (guarded by item id). Generated recipes are copied
 * as they are; recipes missing from the dump or whose products differ are left
 * unchanged and reported.
 * @param {Record<string, any>} recipes bundle recipes, keyed by id
 * @param {Record<string, any>} rawRecipes `raw.recipe` of the dump
 * @returns {{ recipes: Record<string, any>, count: number, checked: number, missing: string[], mismatched: string[] }}
 */
export function attachProductTemperatures(recipes, rawRecipes) {
  const out = {}
  const missing = []
  const mismatched = []
  let count = 0
  let checked = 0
  for (const [id, recipe] of Object.entries(recipes)) {
    if (recipe.extraction || recipe.power) {
      out[id] = recipe
      continue
    }
    checked++
    const proto = rawRecipes[id]
    if (!proto) {
      missing.push(id)
      out[id] = recipe
      continue
    }
    const dump = proto.results ? Object.values(proto.results) : proto.result ? [{ name: proto.result }] : []
    if (dump.length !== recipe.products.length || dump.some((p, i) => p.name !== recipe.products[i].itemId)) {
      mismatched.push(id)
      out[id] = recipe
      continue
    }
    let changed = false
    const products = recipe.products.map((product, i) => {
      const { temperature: stale, ...rest } = product
      const temperature = productTemperature(dump[i])
      if (temperature === stale) return product
      changed = true
      return temperature === undefined ? rest : { ...rest, temperature }
    })
    for (const p of products) if (p.temperature !== undefined) count++
    out[id] = changed ? { ...recipe, products } : recipe
  }
  return { recipes: out, count, checked, missing, mismatched }
}
