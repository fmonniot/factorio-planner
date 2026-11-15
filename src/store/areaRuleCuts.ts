import type { AreaSourceRule, SubPlan } from '../data/types'
import { cleanAreaRules } from '../data/subPlanTree'

/** The rules one plan had before a cleanup took some away, and what it has now (undefined: the key is gone). */
export interface AreaRuleCut {
  planId: string
  before: Record<string, AreaSourceRule>
  after: Record<string, AreaSourceRule> | undefined
}

/**
 * `root` with the area rules that no longer hold removed (see `cleanAreaRules`), and what was cut per plan. The same
 * `root` and no cuts when nothing changed.
 */
export function cutAreaRules(root: SubPlan): { root: SubPlan; cuts: AreaRuleCut[] } {
  const cleaned = cleanAreaRules(root)
  if (cleaned === root) return { root, cuts: [] }
  const cuts: AreaRuleCut[] = []
  const walk = (before: SubPlan, after: SubPlan): void => {
    if (before.sourceRules !== after.sourceRules && before.sourceRules !== undefined) {
      cuts.push({ planId: before.id, before: before.sourceRules, after: after.sourceRules })
    }
    before.subPlans.forEach((sp, i) => walk(sp, after.subPlans[i]))
  }
  walk(root, cleaned)
  return { root: cleaned, cuts }
}

/** `root` with each cut's plan set back to the rules it had before; a plan that is gone is skipped. `updatedAt` is not touched. */
export function restoreAreaRules(root: SubPlan, cuts: readonly AreaRuleCut[]): SubPlan {
  if (cuts.length === 0) return root
  const byPlan = new Map(cuts.map(c => [c.planId, c.before]))
  const walk = (plan: SubPlan): SubPlan => {
    const subPlans = plan.subPlans.map(walk)
    const before = byPlan.get(plan.id)
    const same = subPlans.every((sp, i) => sp === plan.subPlans[i])
    if (before === undefined && same) return plan
    return { ...plan, ...(same ? {} : { subPlans }), ...(before === undefined ? {} : { sourceRules: before }) }
  }
  return walk(root)
}
