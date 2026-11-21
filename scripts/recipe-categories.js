/**
 * Additional crafting categories of recipes (Factorio 2.0 `additional_categories`), shared by the full export
 * and `--patch-additional-categories` so the two paths cannot disagree. A machine that crafts any of a recipe's
 * categories can make it, so `madeIn` is the union over the primary and the additional categories.
 * Kept free of side effects so unit tests can import it.
 */

/**
 * Additional categories of a recipe prototype: sorted, deduped, without the primary category.
 * @param {any} proto recipe prototype
 * @returns {string[] | undefined} undefined when there are none
 */
export function additionalCategories(proto) {
  const raw = proto?.additional_categories
  if (!raw || typeof raw !== 'object') return undefined
  const primary = proto.category ?? 'crafting'
  const list = [...new Set(Object.values(raw).filter(c => typeof c === 'string' && c !== primary))].sort()
  return list.length > 0 ? list : undefined
}

/**
 * Sorted, deduped machine ids that craft `category` or any of `additional`.
 * @param {Record<string, string[]>} categoryMap crafting category -> machine ids
 * @param {string} category primary category
 * @param {readonly string[]} [additional]
 * @returns {string[]}
 */
export function recipeMadeIn(categoryMap, category, additional = []) {
  const ids = new Set()
  for (const c of [category, ...additional]) {
    for (const id of categoryMap[c] ?? []) ids.add(id)
  }
  return [...ids].sort()
}

/**
 * Write `additionalCategories` and the matching `madeIn` into the bundle's recipes. Extraction and power recipes
 * are returned as they are. A recipe missing from the dump is listed in `missing` and left unchanged. Safe to re-run.
 * @param {Record<string, any>} recipes bundle recipes
 * @param {Record<string, any>} rawRecipes dump recipe table
 * @param {Record<string, string[]>} categoryMap crafting category -> machine ids
 */
export function attachAdditionalCategories(recipes, rawRecipes, categoryMap) {
  const out = {}
  const missing = []
  let count = 0
  let checked = 0
  for (const [id, recipe] of Object.entries(recipes)) {
    if (recipe.extraction || recipe.power) {
      out[id] = recipe
      continue
    }
    checked++
    const proto = Object.hasOwn(rawRecipes, id) ? rawRecipes[id] : undefined
    if (!proto) {
      missing.push(id)
      out[id] = recipe
      continue
    }
    const additional = additionalCategories(proto)
    const madeIn = recipeMadeIn(categoryMap, recipe.category, additional)
    const { additionalCategories: stale, ...rest } = recipe
    const same = madeIn.length === recipe.madeIn.length && madeIn.every((m, i) => m === recipe.madeIn[i]) &&
      JSON.stringify(stale) === JSON.stringify(additional)
    if (additional) count++
    out[id] = same ? recipe : { ...rest, madeIn, ...(additional ? { additionalCategories: additional } : {}) }
  }
  return { recipes: out, count, checked, missing }
}
