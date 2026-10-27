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
 * - A sub-plan whose move would cut it off from the root (the handles form a cycle) stays where it
 *   is, together with the others in that cycle, rather than being lost; the other moves still apply.
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
  for (const [id, stored] of storedUnder) {
    const holder = handleHolder.get(id)
    home.set(id, holder !== undefined && holder !== id && byId.has(holder) ? holder : stored)
  }

  // Each sub-plan hangs from exactly one plan, so a sub-plan is cut off from the root only through
  // a cycle of moves. Send those back to where they are stored and build again; each round ends
  // with fewer moves, and with none the stored tree itself is built.
  for (;;) {
    const moves = [...home].filter(([id, target]) => target !== storedUnder.get(id))
    if (moves.length === 0) return root

    const placed = new Set<string>([root.id])
    const build = (plan: SubPlan): SubPlan => {
      const stay = plan.subPlans.filter(sp => home.get(sp.id) === plan.id)
      const seen = new Set(stay.map(sp => sp.id))
      const adopted: SubPlan[] = []
      for (const n of plan.nodes) {
        if (n.kind !== 'subplan' || home.get(n.subPlanId) !== plan.id || seen.has(n.subPlanId)) continue
        seen.add(n.subPlanId)
        adopted.push(byId.get(n.subPlanId)!)
      }
      const children = [...stay, ...adopted].map(sp => {
        placed.add(sp.id)
        return build(sp)
      })
      const unchanged = children.length === plan.subPlans.length && children.every((c, i) => c === plan.subPlans[i])
      return unchanged ? plan : { ...plan, subPlans: children }
    }
    const rebuilt = build(root)
    if (placed.size === byId.size) return rebuilt
    for (const id of byId.keys()) if (!placed.has(id)) home.set(id, storedUnder.get(id)!)
  }
}
