import { describe, it, expect } from 'vitest'
import { cutAreaRules, restoreAreaRules } from './areaRuleCuts'
import type { AreaSourceRule, SubPlan } from '../data/types'

const NOW = '2026-01-01T00:00:00.000Z'
function plan(id: string, subPlans: SubPlan[] = [], area?: boolean, sourceRules?: Record<string, AreaSourceRule>): SubPlan {
  return { id, name: id, nodes: [], subPlans, ...(area ? { area } : {}), ...(sourceRules ? { sourceRules } : {}), createdAt: NOW, updatedAt: NOW }
}
const find = (p: SubPlan, id: string): SubPlan | undefined =>
  p.id === id ? p : p.subPlans.map(sp => find(sp, id)).find(x => x !== undefined)

describe('cutAreaRules', () => {
  it('returns the same root and no cuts for a valid tree', () => {
    const root = plan('root', [plan('a', [], true, { plate: { areasOff: ['root'] } }), plan('b', [], true)])
    const r = cutAreaRules(root)
    expect(r.root).toBe(root)
    expect(r.cuts).toEqual([])
  })

  it('cuts the rules of a switched-off area, trims the others, and restores both', () => {
    const root = plan('root', [
      plan('a', [], false, { plate: {}, gear: { importOff: true } }),
      plan('b', [], true, { plate: { areasOff: ['a', 'c'] } }),
      plan('c', [], true),
    ])
    const r = cutAreaRules(root)
    expect(find(r.root, 'a')!.sourceRules).toBeUndefined()
    expect(find(r.root, 'b')!.sourceRules).toStrictEqual({ plate: { areasOff: ['c'] } })
    expect(restoreAreaRules(r.root, r.cuts)).toStrictEqual(root)
  })

  it('cuts the root rules when the last area goes, and restores them', () => {
    const root = plan('root', [plan('a')], false, { plate: { makeHere: 'off' } })
    const r = cutAreaRules(root)
    expect('sourceRules' in r.root).toBe(false)
    expect(restoreAreaRules(r.root, r.cuts)).toStrictEqual(root)
  })

  it('restore skips a plan that is gone', () => {
    const root = plan('root', [plan('a', [], false, { plate: {} }), plan('b', [], true)])
    const r = cutAreaRules(root)
    const without = plan('root', [plan('b', [], true)])
    expect(restoreAreaRules(without, r.cuts)).toBe(without)
  })
})
