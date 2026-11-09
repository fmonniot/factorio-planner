// The production table's filter: which rows stay visible for a query, and which groups open to
// show them. Pure; no React or store imports.

import { findSubPlan } from '../../data/subPlanTree'
import { matchesName } from '../../data/search'
import type { GameData, RecipeNode, SubPlan } from '../../data/types'

export interface TableFilter {
  /** Recipe node ids and group handle ids that stay. */
  visible: ReadonlySet<string>
  /** Group handle ids rendered open: those with a visible descendant. */
  open: ReadonlySet<string>
  /** Every row reachable through group handles, at every depth. */
  total: number
  hidden: number
}

function recipeMatches(query: string, node: RecipeNode, gameData: GameData): boolean {
  if (node.kind !== 'game-recipe') return false
  const recipe = gameData.recipes[node.recipeId]
  if (!recipe) return matchesName(query, node.recipeId)
  if (matchesName(query, recipe.id, recipe.name)) return true
  const itemMatches = (itemId: string) => matchesName(query, itemId, gameData.items[itemId]?.name)
  return recipe.ingredients.some(i => itemMatches(i.itemId)) || recipe.products.some(p => itemMatches(p.itemId))
}

/** The rows that stay for `query`, or undefined for a blank query (no filtering). */
export function filterPlan(rootPlan: SubPlan, gameData: GameData, query: string): TableFilter | undefined {
  const q = query.trim()
  if (q === '') return undefined

  const visible = new Set<string>()
  const open = new Set<string>()
  let total = 0
  const path = new Set<string>()

  // Returns whether anything under `plan` is visible. A name-matching group shows its whole subtree.
  function walk(plan: SubPlan, inheritedMatch: boolean): boolean {
    let any = false
    if (path.has(plan.id)) return false
    path.add(plan.id)
    for (const node of plan.nodes) {
      total++
      if (node.kind === 'game-recipe') {
        if (inheritedMatch || recipeMatches(q, node, gameData)) {
          visible.add(node.id)
          any = true
        }
        continue
      }
      const child = findSubPlan(rootPlan, node.subPlanId)
      const nameMatch = inheritedMatch || (child !== undefined && matchesName(q, '', child.name))
      const childVisible = child ? walk(child, nameMatch) : false
      if (childVisible) open.add(node.id)
      if (childVisible || nameMatch) {
        visible.add(node.id)
        any = true
      }
    }
    path.delete(plan.id)
    return any
  }
  walk(rootPlan, false)

  return { visible, open, total, hidden: total - visible.size }
}
