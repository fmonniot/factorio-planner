// Nesting limit of the production table. The data model has no limit; the app adds one, read by
// both the UI (disabled actions) and the store commands (refused moves). Pure; no React or store imports.

import type { SubPlan } from './schema'
import { findSubPlan } from './subPlanTree'

/** A row or group may sit inside at most this many ancestor groups. */
export const MAX_NESTING_DEPTH = 4

/** The title of an action disabled by the limit. */
export const NESTING_LIMIT_TITLE = `Cannot nest deeper than ${MAX_NESTING_DEPTH} levels`

/** Number of groups above plan `planId` (0 for the root, and for an unknown id). */
export function planDepth(root: SubPlan, planId: string): number {
  const walk = (plan: SubPlan, depth: number): number | undefined => {
    if (plan.id === planId) return depth
    for (const sp of plan.subPlans) {
      const found = walk(sp, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return walk(root, 0) ?? 0
}

/** Levels a plan's content adds below it: 0 for a plan holding only rows, 1 + the deepest group's height otherwise. */
function contentHeight(root: SubPlan, plan: SubPlan, seen: Set<string>): number {
  let height = 0
  for (const n of plan.nodes) {
    if (n.kind !== 'subplan' || seen.has(n.subPlanId)) continue
    const child = findSubPlan(root, n.subPlanId)
    if (!child) continue
    seen.add(n.subPlanId)
    height = Math.max(height, 1 + contentHeight(root, child, seen))
    seen.delete(n.subPlanId)
  }
  return height
}

/**
 * Height of node `nodeId` as a thing to place: 0 for a recipe row, 1 for a group without groups
 * in it (its rows sit one level below it), plus one per level of nested groups. Unknown: 0.
 */
export function nodeHeight(root: SubPlan, nodeId: string): number {
  const find = (plan: SubPlan): number | undefined => {
    const node = plan.nodes.find(n => n.id === nodeId)
    if (node) {
      if (node.kind !== 'subplan') return 0
      const child = findSubPlan(root, node.subPlanId)
      return 1 + (child ? contentHeight(root, child, new Set([child.id])) : 0)
    }
    for (const sp of plan.subPlans) {
      const found = find(sp)
      if (found !== undefined) return found
    }
    return undefined
  }
  return find(root) ?? 0
}

/** Whether something of `height` fits in plan `targetPlanId`: its deepest part must stay within the limit. */
export function fitsInPlan(root: SubPlan, targetPlanId: string, height: number): boolean {
  return planDepth(root, targetPlanId) + height <= MAX_NESTING_DEPTH
}

/** Whether node `nodeId` (with everything under it, when it is a group) may move into plan `targetPlanId`. */
export function canMoveNodeInto(root: SubPlan, nodeId: string, targetPlanId: string): boolean {
  return fitsInPlan(root, targetPlanId, nodeHeight(root, nodeId))
}

/** Whether a new group (or a group wrapped around a row) may be created in plan `planId`: its row still has to fit. */
export function canAddGroupIn(root: SubPlan, planId: string): boolean {
  return fitsInPlan(root, planId, 1)
}

/** Whether a copy of sub-factory `subPlanId` may go into plan `targetPlanId`. */
export function canCopyGroupInto(root: SubPlan, subPlanId: string, targetPlanId: string): boolean {
  const source = findSubPlan(root, subPlanId)
  if (!source) return true
  return fitsInPlan(root, targetPlanId, 1 + contentHeight(root, source, new Set([source.id])))
}
