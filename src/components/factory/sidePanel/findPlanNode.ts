import type { SubPlan, GameRecipeNode, SubPlanNode } from '../../../data/types'

/** The node of the plan with this id, anywhere in the tree. */
export function findPlanNode(plan: SubPlan, nodeId: string): GameRecipeNode | SubPlanNode | undefined {
  const here = plan.nodes.find(n => n.id === nodeId)
  if (here) return here
  for (const sp of plan.subPlans) {
    const found = findPlanNode(sp, nodeId)
    if (found) return found
  }
  return undefined
}
