import type { GameData, Recipe } from './types'

/** Does the recipe list `itemId` among its products? (The recipe picker's item filter.) */
export function recipeMakes(recipe: Recipe, itemId: string): boolean {
  return recipe.products.some(p => p.itemId === itemId)
}

/** Does any recipe in the game data make `itemId`? Raw resources have none. */
export function isMadeByAnyRecipe(gameData: GameData, itemId: string): boolean {
  return Object.values(gameData.recipes).some(r => recipeMakes(r, itemId))
}
