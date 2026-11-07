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

/** Machines (rounded up per row) and power (kW) of every row in a sub-plan, at every depth. */
export function sumSubPlanSolved(
  plan: SubPlan,
  solvedMap: ReadonlyMap<string, { machineCountCeil: number; powerKw: number }>,
): { machines: number; powerKw: number } {
  let machines = 0
  let powerKw = 0
  for (const n of plan.nodes) {
    if (n.kind === 'subplan') {
      const child = plan.subPlans.find(sp => sp.id === n.subPlanId)
      if (!child) continue
      const inner = sumSubPlanSolved(child, solvedMap)
      machines += inner.machines
      powerKw += inner.powerKw
    } else {
      const solved = solvedMap.get(n.id)
      machines += solved?.machineCountCeil ?? 0
      powerKw += solved?.powerKw ?? 0
    }
  }
  return { machines, powerKw }
}
