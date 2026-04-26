import type { GameData, Recipe } from '../../data/types'
import type { SyntheticRecipe } from './subplan'

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
//
// Synthetic recipes (derived from solved subplans) are passed separately and
// looked up by their sentinel id ('__subplan__:<id>'). Their amounts are
// already absolute rates (items/min at 100 % capacity); no productivity bonus
// applies to them.
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
 * @param syntheticRecipes - optional map of synthetic recipe id → SyntheticRecipe
 */
export function buildStoichiometryMatrix(
  gameData: GameData,
  recipeIds: string[],
  productivityMap: Map<string, number> = new Map(),
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): StoichiometryMatrix {
  // Collect all item ids that appear in any active recipe (ingredients or products).
  const itemSet = new Set<string>()
  const validRecipeIds: string[] = []

  for (const id of recipeIds) {
    const gameRecipe = gameData.recipes[id]
    const synthetic = syntheticRecipes.get(id)
    if (gameRecipe) {
      validRecipeIds.push(id)
      for (const ing of gameRecipe.ingredients) itemSet.add(ing.itemId)
      for (const prod of gameRecipe.products) itemSet.add(prod.itemId)
    } else if (synthetic) {
      validRecipeIds.push(id)
      for (const ing of synthetic.ingredients) itemSet.add(ing.itemId)
      for (const prod of synthetic.products) itemSet.add(prod.itemId)
    }
  }

  const items = Array.from(itemSet).sort()
  const recipes = validRecipeIds

  const itemIndex = new Map(items.map((id, i) => [id, i]))
  const recipeIndex = new Map(recipes.map((id, j) => [id, j]))

  // Initialise S to all zeros.
  const S: number[][] = Array.from({ length: items.length }, () =>
    new Array(recipes.length).fill(0),
  )

  for (let j = 0; j < recipes.length; j++) {
    const recipeId = recipes[j]
    const gameRecipe = gameData.recipes[recipeId]

    if (gameRecipe) {
      const prodBonus = productivityMap.get(recipeId) ?? 0

      // Products: positive contribution (net production)
      for (const prod of gameRecipe.products) {
        const i = itemIndex.get(prod.itemId)!
        const amount = prod.amount ?? 0
        const prob = prod.probability ?? 1
        const ibp = prod.ignoredByProductivity ?? 0
        S[i][j] += effectiveProductAmount(amount, prob, ibp, prodBonus)
      }

      // Ingredients: negative contribution (net consumption)
      for (const ing of gameRecipe.ingredients) {
        const i = itemIndex.get(ing.itemId)!
        S[i][j] -= ing.amount
      }
    } else {
      // Synthetic recipe: amounts are already net absolute rates, no productivity.
      const synthetic = syntheticRecipes.get(recipeId)!

      for (const prod of synthetic.products) {
        const i = itemIndex.get(prod.itemId)!
        S[i][j] += prod.amount
      }

      for (const ing of synthetic.ingredients) {
        const i = itemIndex.get(ing.itemId)!
        S[i][j] -= ing.amount
      }
    }
  }

  return { S, itemIndex, recipeIndex, items, recipes }
}
