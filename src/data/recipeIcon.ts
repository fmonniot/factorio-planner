import type { GameData, Item, Recipe } from './types'

/** The item whose icon stands for a recipe: the first of mainProduct, then products, that has an icon. */
export function recipeIconItem(gameData: GameData, recipe: Recipe): Item | undefined {
  const candidates = [recipe.mainProduct, ...recipe.products.map(p => p.itemId)]
    .filter((id): id is string => !!id)
  return candidates
    .map(id => gameData.items[id])
    .find(it => it?.iconPath)
}
