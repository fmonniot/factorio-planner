import { describe, it, expect } from 'vitest'
import type { RecipeNode, SubPlan } from './types'
import {
  MAX_NESTING_DEPTH, canAddGroupIn, canCopyGroupInto, canMoveNodeInto, fitsInPlan, nodeHeight, planDepth,
} from './nesting'

const row = (id: string): RecipeNode => ({ kind: 'game-recipe', id, recipeId: 'iron-plate', modules: [], byproductPolicy: {} })
const plan = (id: string, nodes: SubPlan['nodes'] = [], subPlans: SubPlan[] = []): SubPlan => ({
  id, name: id, nodes, subPlans, createdAt: '', updatedAt: '',
})
const handle = (id: string, subPlanId: string): SubPlan['nodes'][number] => ({ kind: 'subplan', id, subPlanId })

/** A chain of `levels` groups g1 ⊃ g2 ⊃ …, the deepest holding one row `leaf`. */
function chain(levels: number, prefix = 'g'): SubPlan {
  let inner = plan(`${prefix}${levels}`, [row(`${prefix}-leaf`)])
  for (let i = levels - 1; i >= 1; i--) inner = plan(`${prefix}${i}`, [handle(`h${prefix}${i + 1}`, `${prefix}${i + 1}`)], [inner])
  return inner
}

describe('nesting limit', () => {
  it('is four levels', () => {
    expect(MAX_NESTING_DEPTH).toBe(4)
  })

  it('counts the groups above a plan', () => {
    const root = plan('root', [handle('h1', 'g1')], [chain(3)])
    expect(planDepth(root, 'root')).toBe(0)
    expect(planDepth(root, 'g1')).toBe(1)
    expect(planDepth(root, 'g3')).toBe(3)
    expect(planDepth(root, 'unknown')).toBe(0)
  })

  it('measures the height of a row and of a group', () => {
    const root = plan('root', [row('r'), handle('h1', 'g1')], [chain(3)])
    expect(nodeHeight(root, 'r')).toBe(0)
    expect(nodeHeight(root, 'h1')).toBe(3)
    expect(nodeHeight(root, 'hg3')).toBe(1)
  })

  it('lets a row into a plan with four ancestors, not five', () => {
    const root = plan('root', [row('r'), handle('h1', 'g1')], [chain(5)])
    expect(canMoveNodeInto(root, 'r', 'g4')).toBe(true)
    expect(canMoveNodeInto(root, 'r', 'g5')).toBe(false)
  })

  it('counts the subtree height when a group moves', () => {
    // Moving group "m" (height 2: a group holding a group holding a row) under depth-2 g2 puts the row at depth 5.
    const m = chain(2, 'm')
    const root = plan('root', [handle('hm1', 'm1'), handle('h1', 'g1')], [m, chain(3)])
    expect(nodeHeight(root, 'hm1')).toBe(2)
    expect(canMoveNodeInto(root, 'hm1', 'g1')).toBe(true) // depth 1 + 2 = 3
    expect(canMoveNodeInto(root, 'hm1', 'g2')).toBe(true) // depth 2 + 2 = 4
    expect(canMoveNodeInto(root, 'hm1', 'g3')).toBe(false) // depth 3 + 2 = 5
    expect(canMoveNodeInto(root, 'hm1', 'root')).toBe(true)
  })

  it('refuses a new group or a wrapper where its row would be too deep', () => {
    const root = plan('root', [handle('h1', 'g1')], [chain(4)])
    expect(canAddGroupIn(root, 'g3')).toBe(true)
    expect(canAddGroupIn(root, 'g4')).toBe(false)
    expect(fitsInPlan(root, 'g4', 0)).toBe(true)
  })

  it('refuses a copy that would go past the limit', () => {
    const root = plan('root', [handle('h1', 'g1'), handle('hm1', 'm1')], [chain(3), chain(2, 'm')])
    expect(canCopyGroupInto(root, 'm1', 'g1')).toBe(true)
    expect(canCopyGroupInto(root, 'm1', 'g3')).toBe(false)
  })

  it('does not break on a plan that is already deeper than the limit', () => {
    const root = plan('root', [handle('h1', 'g1')], [chain(6)])
    expect(nodeHeight(root, 'h1')).toBe(6)
    expect(canMoveNodeInto(root, 'h1', 'root')).toBe(false)
    expect(canAddGroupIn(root, 'g6')).toBe(false)
  })
})
