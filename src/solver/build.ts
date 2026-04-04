import type { GameData, Recipe } from '../data/types'

// ---------------------------------------------------------------------------
// Stoichiometry matrix builder
//
// Given a GameData and a set of active recipe ids, this module builds:
//   - S: the stoichiometry matrix (items × recipes), net flow per execution
//   - itemIndex: item id → row index
//   - recipeIndex: recipe id → column index
//
// Convention: S[i][j] > 0 means recipe j *produces* item i net.
//             S[i][j] < 0 means recipe j *consumes* item i net.
//
// Net stoichiometry is used so that cycles (like Kovarex where U-235 is both
// input and output) are handled correctly by the linear solver without special
// casing.
//
// Effective product amount accounts for probability and ignoredByProductivity:
//   effectiveAmount = ignoredByProductivity
//                   + (amount − ignoredByProductivity) × (1 + productivityBonus)
// When productivityBonus = 0 this reduces to just `amount × probability`.
// ---------------------------------------------------------------------------

export interface StoichiometryMatrix {
  /** S[itemRow][recipeCol] = net items produced per recipe execution */
  S: number[][]
  /** item id → row index in S */
  itemIndex: Map<string, number>
  /** recipe id → column index in S */
  recipeIndex: Map<string, number>
  /** ordered item ids (row i ↔ items[i]) */
  items: string[]
  /** ordered recipe ids (col j ↔ recipes[j]) */
  recipes: string[]
}

/**
 * Compute the effective output amount of a product, accounting for probability
 * and the productivity bonus (which only applies to the scalable portion).
 *
 * @param amount         - raw product amount
 * @param probability    - output probability (default 1)
 * @param ignoredByProductivity - units excluded from productivity scaling (default 0)
 * @param productivityBonus     - total productivity bonus, e.g. 0.40 for +40% (default 0)
 */
export function effectiveProductAmount(
  amount: number,
  probability = 1,
  ignoredByProductivity = 0,
  productivityBonus = 0,
): number {
  const fixed = ignoredByProductivity
  const scalable = amount - ignoredByProductivity
  return (fixed + scalable * (1 + productivityBonus)) * probability
}

/**
 * Build the stoichiometry matrix for a set of recipes.
 *
 * @param gameData         - validated game data
 * @param recipeIds        - the recipe ids to include as columns
 * @param productivityMap  - optional map of recipe id → productivity bonus (0 = no bonus)
 */
export function buildStoichiometryMatrix(
  gameData: GameData,
  recipeIds: string[],
  productivityMap: Map<string, number> = new Map(),
): StoichiometryMatrix {
  // Collect all item ids that appear in any active recipe (ingredients or products).
  const itemSet = new Set<string>()
  const activeRecipes: Recipe[] = []

  for (const id of recipeIds) {
    const recipe = gameData.recipes[id]
    if (!recipe) continue
    activeRecipes.push(recipe)
    for (const ing of recipe.ingredients) itemSet.add(ing.itemId)
    for (const prod of recipe.products) itemSet.add(prod.itemId)
  }

  const items = Array.from(itemSet).sort()
  const recipes = recipeIds.filter(id => gameData.recipes[id] != null)

  const itemIndex = new Map(items.map((id, i) => [id, i]))
  const recipeIndex = new Map(recipes.map((id, j) => [id, j]))

  // Initialise S to all zeros.
  const S: number[][] = Array.from({ length: items.length }, () =>
    new Array(recipes.length).fill(0),
  )

  for (let j = 0; j < recipes.length; j++) {
    const recipeId = recipes[j]
    const recipe = gameData.recipes[recipeId]
    const prodBonus = productivityMap.get(recipeId) ?? 0

    // Products: positive contribution (net production)
    for (const prod of recipe.products) {
      const i = itemIndex.get(prod.itemId)!
      const amount = prod.amount ?? 0
      const prob = prod.probability ?? 1
      const ibp = prod.ignoredByProductivity ?? 0
      S[i][j] += effectiveProductAmount(amount, prob, ibp, prodBonus)
    }

    // Ingredients: negative contribution (net consumption)
    for (const ing of recipe.ingredients) {
      const i = itemIndex.get(ing.itemId)!
      S[i][j] -= ing.amount
    }
  }

  return { S, itemIndex, recipeIndex, items, recipes }
}
