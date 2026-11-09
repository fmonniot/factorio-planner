// Name search shared by the pickers and the production table's filter. Pure; no React or store imports.

import type { Item, Recipe } from './types'

/** Case-insensitive substring match on a name or an id. An empty query matches everything. */
export function matchesName(query: string, id: string, name?: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (name?.toLowerCase().includes(q) ?? false) || id.toLowerCase().includes(q)
}

export function matchesItem(query: string, item: Item): boolean {
  return matchesName(query, item.id, item.name)
}

export function matchesRecipe(query: string, recipe: Recipe): boolean {
  return matchesName(query, recipe.id, recipe.name)
}
