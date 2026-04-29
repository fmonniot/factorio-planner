import type { SubPlan, SolverResult } from '../data/types'

// ---------------------------------------------------------------------------
// Synthetic recipe
//
// A SyntheticRecipe is derived from a solved SubPlan. It represents the
// subplan as an opaque black-box recipe:
//
//   - products  = items with positive net balance across all solver nodes
//                 (goal items + byproducts that leak out)
//   - ingredients = items with negative net balance (raw inputs the subplan
//                   needs from outside — i.e. the unsatisfied items)
//
// Amounts are absolute rates (items/min at 100 % capacity). "1 execution"
// of the synthetic recipe means running the subplan at 100 % of its designed
// throughput; the parent solver's throughput solution gives a scale factor
// (0.5 = 50 %, 2.0 = 200 %, etc.).
//
// No normalization is performed, so:
//   - Multiple goals are all products, treated symmetrically.
//   - Byproducts (positive net balance items that are not goals) are included
//     as products and are visible to sibling plans in the parent.
// ---------------------------------------------------------------------------

export interface SyntheticRecipeItem {
  itemId: string
  amount: number // items/min at 100 % subplan capacity
}

export interface SyntheticRecipe {
  /** Sentinel id used as the column key in the stoichiometry matrix. */
  id: string // '__subplan__:<subPlanId>'
  subPlanId: string
  subPlanName: string
  ingredients: SyntheticRecipeItem[]
  products: SyntheticRecipeItem[]
  craftingTime: 0
  category: 'subplan'
  allowProductivity: false
}

/**
 * Derive a SyntheticRecipe from a solved SubPlan.
 *
 * Returns null when the subplan has no solved nodes (e.g. the subplan has no
 * goals yet, so every throughput is zero and nothing is produced).
 */
export function deriveSyntheticRecipe(
  subPlan: SubPlan,
  result: SolverResult,
): SyntheticRecipe | null {
  if (result.nodes.length === 0) return null

  // Compute net balance per item across all solved nodes.
  // outputRates contribute positively; inputRates contribute negatively.
  const netBalance = new Map<string, number>()
  for (const node of result.nodes) {
    for (const [itemId, rate] of Object.entries(node.outputRates)) {
      netBalance.set(itemId, (netBalance.get(itemId) ?? 0) + rate)
    }
    for (const [itemId, rate] of Object.entries(node.inputRates)) {
      netBalance.set(itemId, (netBalance.get(itemId) ?? 0) - rate)
    }
  }

  const products: SyntheticRecipeItem[] = []
  const ingredients: SyntheticRecipeItem[] = []

  for (const [itemId, net] of netBalance) {
    if (net > 0) products.push({ itemId, amount: net })
    else if (net < 0) ingredients.push({ itemId, amount: -net })
    // net ≈ 0 → internal intermediate, not exposed
  }

  if (products.length === 0) return null

  return {
    id: `__subplan__:${subPlan.id}`,
    subPlanId: subPlan.id,
    subPlanName: subPlan.name,
    ingredients,
    products,
    craftingTime: 0,
    category: 'subplan',
    allowProductivity: false,
  }
}
