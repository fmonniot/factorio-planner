// Sub-plan tree invariant: a sub-plan is stored in the `subPlans` of the plan that holds its
// handle (a `SubPlanNode`). Pure; no React or store imports.

import type { AreaSourceRule, SubPlan } from './schema'

export function findSubPlan(plan: SubPlan, id: string): SubPlan | undefined {
  if (plan.id === id) return plan
  for (const sp of plan.subPlans) {
    const found = findSubPlan(sp, id)
    if (found) return found
  }
  return undefined
}

/** What the block's root area is called in the Areas pane. */
export const ROOT_AREA_LABEL = 'Top level'

/** The display name of an area: the root is "Top level", a sub-factory has its own name (the id when it is gone). */
export function areaName(rootPlan: SubPlan, areaId: string): string {
  if (areaId === rootPlan.id) return ROOT_AREA_LABEL
  return findSubPlan(rootPlan, areaId)?.name ?? areaId
}

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

/**
 * The ids of the areas of a block: every sub-plan with `area: true`, and the root only when one is below it (the
 * data-layer twin of `blockAreas` in the solver, which this folder must not import).
 */
export function areaIdsOf(root: SubPlan): Set<string> {
  const ids = new Set<string>()
  const walk = (plan: SubPlan): void => {
    for (const sp of plan.subPlans) {
      if (sp.area === true) ids.add(sp.id)
      walk(sp)
    }
  }
  walk(root)
  if (ids.size > 0) ids.add(root.id)
  return ids
}

/** The rule stored on the area `areaId` of the block `root` for an item, or undefined (an own key only; a keyless `{}` is kept). */
export function storedAreaRule(root: SubPlan, areaId: string, itemId: string): AreaSourceRule | undefined {
  const rules = findSubPlan(root, areaId)?.sourceRules
  return rules !== undefined && Object.hasOwn(rules, itemId) ? rules[itemId] : undefined
}

/**
 * `root` with its area rules cleaned: rules only on areas (the key goes from any other plan), an `areasOff` id kept
 * only when it names another area of the block (repeats dropped), an emptied `areasOff` key removed while the rule
 * stays (a keyless rule is a real rule), an emptied map removed. The same objects wherever nothing changed.
 */
export function cleanAreaRules(root: SubPlan): SubPlan {
  const areas = areaIdsOf(root)
  const clean = (plan: SubPlan): SubPlan => {
    let out = plan
    const subPlans = plan.subPlans.map(clean)
    if (subPlans.some((sp, i) => sp !== plan.subPlans[i])) out = { ...out, subPlans }
    if (plan.sourceRules !== undefined) {
      let changed = false
      const entries = Object.entries(plan.sourceRules).map(([itemId, rule]): [string, AreaSourceRule] => {
        if (rule.areasOff === undefined) return [itemId, rule]
        const kept = [...new Set(rule.areasOff)].filter(id => areas.has(id) && id !== plan.id)
        if (kept.length === rule.areasOff.length && kept.length > 0) return [itemId, rule]
        changed = true
        const next: AreaSourceRule = { ...rule }
        if (kept.length > 0) next.areasOff = kept
        else delete next.areasOff
        return [itemId, next]
      })
      if (!areas.has(plan.id) || entries.length === 0) {
        out = { ...out }
        delete out.sourceRules
      } else if (changed) out = { ...out, sourceRules: Object.fromEntries(entries) }
    }
    return out
  }
  return clean(root)
}

/**
 * `rules` with every `areasOff` id carried through `ids` (a clone's old id to new id map). An id with no copy is
 * dropped, an emptied key removed; the rules and their order stay. Undefined when there are no rules.
 */
export function remapAreaRules(
  rules: Record<string, AreaSourceRule> | undefined,
  ids: ReadonlyMap<string, string>,
): Record<string, AreaSourceRule> | undefined {
  if (rules === undefined) return undefined
  const entries = Object.entries(rules).map(([itemId, rule]): [string, AreaSourceRule] => {
    if (rule.areasOff === undefined) return [itemId, { ...rule }]
    const { areasOff, ...rest } = rule
    const mapped = areasOff.flatMap(id => {
      const copy = ids.get(id)
      return copy === undefined ? [] : [copy]
    })
    return [itemId, mapped.length > 0 ? { ...rest, areasOff: mapped } : rest]
  })
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}
