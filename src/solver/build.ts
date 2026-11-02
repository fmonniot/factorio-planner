import type { GameData, GameRecipeNode, Ingredient, Recipe, RecipeProduct } from '../data/types'
import type { NodeEffects } from './effects'
import { HEAT_ITEM_ID } from '../data/electricity'

// ---------------------------------------------------------------------------
// Item classification for the LP solver
//
// Categories:
//   goal        — item appears in the goals map
//   intermediate — produced AND consumed by at least one active recipe
//   raw         — no producer in the active recipe set (external source)
//   byproduct   — no consumer in the active recipe set (excluded from LP)
//
// Net stoichiometry S[i][j]: positive means produced, negative means consumed.
// ---------------------------------------------------------------------------

export interface ItemClassification {
  goals: Map<string, number>       // itemId → required rate
  intermediates: Set<string>       // must balance (≥ 0)
  raw: Set<string>                 // sourced externally
  byproducts: Set<string>          // no consumer — omitted from LP rows
}

export interface ClassifiedSystem {
  /** Net stoichiometry coefficient S[itemId][recipeId] */
  S: Map<string, Map<string, number>>
  /** Ordered recipe ids */
  recipes: string[]
  classification: ItemClassification
}

/**
 * Compute the effective product amount accounting for probability and
 * productivity (only the amount above ignoredByProductivity scales).
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
 * Effective amount of one product per execution of a row: probability and
 * productivity, then the reactor neighbour bonus for the heat product.
 */
export function rowProductAmount(
  prod: RecipeProduct,
  productivityBonus = 0,
  heatBonus = 0,
): number {
  const amount = effectiveProductAmount(
    prod.amount ?? 0,
    prod.probability ?? 1,
    prod.ignoredByProductivity ?? 0,
    productivityBonus,
  )
  return prod.itemId === HEAT_ITEM_ID ? amount * (1 + heatBonus) : amount
}

/** A row's ingredients: the recipe's plus the fuel a burner row burns (per execution). */
export function rowIngredients(recipe: Recipe, effects: { fuel?: Ingredient } | undefined): Ingredient[] {
  return effects?.fuel ? [...recipe.ingredients, effects.fuel] : recipe.ingredients
}

/**
 * The ingredients a byproduct-consumer row locks against import: the recipe's, plus its fuel only when
 * the user picked that fuel (`fuelItemId`). The automatic default fuel stays importable.
 */
export function lockedIngredients(recipe: Recipe, effects: { fuel?: Ingredient } | undefined, node: GameRecipeNode): Ingredient[] {
  const fuel = effects?.fuel
  return fuel && node.fuelItemId === fuel.itemId ? [...recipe.ingredients, fuel] : recipe.ingredients
}

/** What `buildClassifiedSystem` reads of a recipe's row effects; `fuel` may list several (areas: one per column). */
export type RowEffects = Pick<NodeEffects, 'productivityBonus' | 'heatBonus'> & { fuel?: Ingredient | Ingredient[] }

/**
 * Build the net stoichiometry map and classify items for the LP.
 */
export function buildClassifiedSystem(
  gameData: GameData,
  recipeIds: string[],
  goalsMap: Map<string, number>,
  /** Per recipe: its row's productivity, heat bonus and fuel (an ingredient that is not the recipe's own). */
  effectsMap: Map<string, RowEffects> = new Map(),
): ClassifiedSystem {
  const producers = new Map<string, Set<string>>() // itemId → recipeIds that produce it
  const consumers = new Map<string, Set<string>>() // itemId → recipeIds that consume it

  // S[itemId][recipeId] = net items per recipe execution (net = produced - consumed)
  const S = new Map<string, Map<string, number>>()

  function addCoeff(itemId: string, recipeId: string, delta: number) {
    if (!S.has(itemId)) S.set(itemId, new Map())
    S.get(itemId)!.set(recipeId, (S.get(itemId)!.get(recipeId) ?? 0) + delta)
  }

  for (const recipeId of recipeIds) {
    const recipe = gameData.recipes[recipeId]
    if (!recipe) continue
    const rowEffects = effectsMap.get(recipeId)
    const prodBonus = rowEffects?.productivityBonus ?? 0
    const fuel = rowEffects?.fuel

    for (const prod of recipe.products) {
      const amount = rowProductAmount(prod, prodBonus, rowEffects?.heatBonus ?? 0)
      if (amount > 0) {
        addCoeff(prod.itemId, recipeId, amount)
        if (!producers.has(prod.itemId)) producers.set(prod.itemId, new Set())
        producers.get(prod.itemId)!.add(recipeId)
      }
    }

    for (const ing of [...recipe.ingredients, ...(fuel === undefined ? [] : Array.isArray(fuel) ? fuel : [fuel])]) {
      if (ing.amount > 0) {
        addCoeff(ing.itemId, recipeId, -ing.amount)
        if (!consumers.has(ing.itemId)) consumers.set(ing.itemId, new Set())
        consumers.get(ing.itemId)!.add(recipeId)
      }
    }
  }

  // Collect all items mentioned
  const allItems = new Set<string>([...producers.keys(), ...consumers.keys()])

  const goals = new Map(goalsMap)
  const intermediates = new Set<string>()
  const raw = new Set<string>()
  const byproducts = new Set<string>()

  for (const itemId of allItems) {
    if (goals.has(itemId)) continue // goal takes priority
    const hasProducer = (producers.get(itemId)?.size ?? 0) > 0
    const hasConsumer = (consumers.get(itemId)?.size ?? 0) > 0

    if (!hasProducer) {
      raw.add(itemId)
    } else if (!hasConsumer) {
      byproducts.add(itemId)
    } else {
      intermediates.add(itemId)
    }
  }

  return { S, recipes: recipeIds, classification: { goals, intermediates, raw, byproducts } }
}
