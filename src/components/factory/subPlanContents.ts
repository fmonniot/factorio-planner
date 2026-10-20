import type { SubPlan } from '../../data/types'

/** Recipes and nested sub-factories inside a sub-plan, counted at every depth. */
export function countSubPlanContents(plan: SubPlan): { recipes: number; subfactories: number } {
  let recipes = 0
  let subfactories = 0
  for (const n of plan.nodes) {
    if (n.kind === 'subplan') {
      subfactories++
      const child = plan.subPlans.find(sp => sp.id === n.subPlanId)
      if (child) {
        const inner = countSubPlanContents(child)
        recipes += inner.recipes
        subfactories += inner.subfactories
      }
    } else {
      recipes++
    }
  }
  return { recipes, subfactories }
}
