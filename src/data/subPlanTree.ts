// Sub-plan tree invariant: a sub-plan is stored in the `subPlans` of the plan that holds its
// handle (a `SubPlanNode`). Pure; no React or store imports.

import type { SubPlan } from './schema'

/**
 * Plans saved before the invariant was kept (dragging a sub-factory's handle into another plan
 * moved only the handle) show a sub-factory under one plan while its `SubPlan` object is stored
 * under another. The table follows the handles and the solver's areas follow the objects, so rows
 * landed in the wrong area. This stores every sub-plan under the plan that holds its handle.
 *
 * - A sub-plan referenced by several handles goes under the first one in tree order (a plan's own
 *   nodes, then its sub-plans, depth first).
 * - A sub-plan without a handle, or with a handle that is nowhere in the tree, stays where it is.
 * - Within a plan, the sub-plans that stay keep their order and the adopted ones follow in handle
 *   order, so a well-formed tree comes back as the same object and rows keep their solve order.
 * - If the handles would form a cycle (the moved sub-plans would no longer hang from the root),
 *   the tree is returned unchanged rather than losing any of it.
 */
export function reparentSubPlans(root: SubPlan): SubPlan {
  const byId = new Map<string, SubPlan>()
  const storedUnder = new Map<string, string>()
  const handleHolder = new Map<string, string>()
  const collect = (plan: SubPlan): void => {
    byId.set(plan.id, plan)
    for (const n of plan.nodes) {
      if (n.kind === 'subplan' && !handleHolder.has(n.subPlanId)) handleHolder.set(n.subPlanId, plan.id)
    }
    for (const sp of plan.subPlans) {
      storedUnder.set(sp.id, plan.id)
      collect(sp)
    }
  }
  collect(root)

  // Where each sub-plan belongs; the root has no parent.
  const home = new Map<string, string>()
  let moved = false
  for (const [id, stored] of storedUnder) {
    const holder = handleHolder.get(id)
    const target = holder !== undefined && holder !== id && byId.has(holder) ? holder : stored
    home.set(id, target)
    if (target !== stored) moved = true
  }
  if (!moved) return root

  const placed = new Set<string>([root.id])
  const build = (plan: SubPlan): SubPlan => {
    const stay = plan.subPlans.filter(sp => home.get(sp.id) === plan.id)
    const adopted: SubPlan[] = []
    for (const n of plan.nodes) {
      if (n.kind !== 'subplan' || home.get(n.subPlanId) !== plan.id) continue
      const sp = byId.get(n.subPlanId)!
      if (!stay.includes(sp) && !adopted.includes(sp)) adopted.push(sp)
    }
    const children = [...stay, ...adopted].map(sp => {
      placed.add(sp.id)
      return build(sp)
    })
    const unchanged = children.length === plan.subPlans.length && children.every((c, i) => c === plan.subPlans[i])
    return unchanged ? plan : { ...plan, subPlans: children }
  }
  const rebuilt = build(root)
  return placed.size === byId.size ? rebuilt : root
}
