import type { GameData } from './types'

/**
 * The item a recipe row is "about": the row's chosen primary product, else the
 * recipe's main product, else its first product. Shared by the solver (share
 * limits) and the UI (row display) so both always agree.
 */
export function primaryItemId(
  node: { primaryProduct?: string },
  recipe: GameData['recipes'][string] | undefined,
): string | undefined {
  return node.primaryProduct ?? recipe?.mainProduct ?? recipe?.products[0]?.itemId
}
