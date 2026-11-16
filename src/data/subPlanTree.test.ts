import { describe, it, expect } from 'vitest'
import { areaIdsOf, cleanAreaRules, remapAreaRules, reparentSubPlans } from './subPlanTree'
import { blockAreas } from '../solver/areas'
import type { AreaSourceRule, RecipeNode, SubPlan } from './types'

const NOW = '2026-01-01T00:00:00.000Z'

function plan(id: string, nodes: RecipeNode[] = [], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  return { id, name: id, nodes, subPlans, ...(area ? { area } : {}), createdAt: NOW, updatedAt: NOW }
}
const recipe = (id: string): RecipeNode => ({ kind: 'game-recipe', id, recipeId: id, modules: [], byproductPolicy: {} })
const handle = (subPlanId: string): RecipeNode => ({ kind: 'subplan', id: `h-${subPlanId}`, subPlanId })
const childIds = (p: SubPlan) => p.subPlans.map(sp => sp.id)
const find = (p: SubPlan, id: string): SubPlan | undefined =>
  p.id === id ? p : p.subPlans.map(sp => find(sp, id)).find(x => x !== undefined)

describe('reparentSubPlans', () => {
  it('returns a well-formed tree as the same object', () => {
    const root = plan('root', [handle('b'), handle('a'), recipe('r')], [plan('a', [handle('c')], [plan('c')]), plan('b')])
    expect(reparentSubPlans(root)).toBe(root)
  })

  it('stores a sub-plan under the plan that holds its handle', () => {
    // "Bottom" shows "Group" through a handle, but Group is stored under the root.
    const group = plan('group', [recipe('r1'), recipe('r2')])
    const root = plan('root', [handle('top'), handle('bottom')], [group, plan('top', [], [], true), plan('bottom', [handle('group')], [], true)])

    const fixed = reparentSubPlans(root)

    expect(childIds(fixed)).toEqual(['top', 'bottom'])
    expect(childIds(find(fixed, 'bottom')!)).toEqual(['group'])
    expect(find(fixed, 'group')).toBe(group)
  })

  it('moves a whole subtree and keeps flags and timestamps', () => {
    const inner = plan('inner', [recipe('r')])
    const outer = plan('outer', [handle('inner')], [inner], true)
    const root = plan('root', [handle('dest')], [outer, plan('dest', [handle('outer')], [], true)])

    const fixed = reparentSubPlans(root)

    expect(childIds(fixed)).toEqual(['dest'])
    expect(childIds(find(fixed, 'dest')!)).toEqual(['outer'])
    expect(find(fixed, 'outer')).toMatchObject({ area: true, updatedAt: NOW })
    expect(childIds(find(fixed, 'outer')!)).toEqual(['inner'])
  })

  it('resolves a handle in a plan that is itself moved', () => {
    // Prep (stored under Top) holds a handle to X, which is stored under the root.
    const root = plan('root', [handle('top')], [plan('x'), plan('prep', [handle('x')]), plan('top', [handle('prep')])])
    const fixed = reparentSubPlans(root)
    expect(childIds(fixed)).toEqual(['top'])
    expect(childIds(find(fixed, 'top')!)).toEqual(['prep'])
    expect(childIds(find(fixed, 'prep')!)).toEqual(['x'])
  })

  it('keeps the order of sub-plans that stay and appends adopted ones in handle order', () => {
    const dest = plan('dest', [handle('c'), handle('a')], [plan('z'), plan('y')])
    const root = plan('root', [handle('d'), handle('b'), handle('dest')], [plan('a'), plan('b'), plan('c'), plan('d'), dest])
    const fixed = reparentSubPlans(root)
    expect(childIds(fixed)).toEqual(['b', 'd', 'dest'])
    expect(childIds(find(fixed, 'dest')!)).toEqual(['z', 'y', 'c', 'a'])
  })

  it('uses the first handle in tree order when a sub-plan has several', () => {
    const root = plan('root', [handle('a')], [plan('x'), plan('a', [handle('x')]), plan('b', [handle('x')])])
    const fixed = reparentSubPlans(root)
    expect(childIds(fixed)).toEqual(['a', 'b'])
    expect(childIds(find(fixed, 'a')!)).toEqual(['x'])
  })

  it('leaves a sub-plan without a handle, and a handle without a sub-plan, alone', () => {
    const root = plan('root', [handle('ghost'), handle('b')], [plan('orphan'), plan('b', [handle('missing')])])
    expect(reparentSubPlans(root)).toBe(root)
  })

  it('ignores a handle to the plan that holds it', () => {
    const root = plan('root', [handle('a')], [plan('a', [handle('a')])])
    expect(reparentSubPlans(root)).toBe(root)
  })

  it('returns the tree unchanged when the handles form a cycle', () => {
    // a holds a handle to b and b holds a handle to a, neither reachable from the root by handles.
    const root = plan('root', [], [plan('a', [handle('b')], [plan('b', [handle('a')])])])
    expect(reparentSubPlans(root)).toBe(root)
  })

  it('still applies the other moves when some sub-plans form a cycle', () => {
    // x is shown under bottom but stored under the root; p and q hold handles to each other.
    const root = plan('root', [handle('bottom')], [
      plan('x'), plan('bottom', [handle('x')]), plan('p', [handle('q')], [plan('q', [handle('p')])]),
    ])
    const fixed = reparentSubPlans(root)
    expect(childIds(find(fixed, 'bottom')!)).toEqual(['x'])
    expect(childIds(fixed)).toEqual(['bottom', 'p'])
    expect(childIds(find(fixed, 'p')!)).toEqual(['q'])
  })

  it('does not mutate its input', () => {
    const group = plan('group')
    const root = plan('root', [handle('bottom')], [group, plan('bottom', [handle('group')])])
    const before = structuredClone(root)
    reparentSubPlans(root)
    expect(root).toEqual(before)
  })
})

const withRules = (p: SubPlan, sourceRules: Record<string, AreaSourceRule>): SubPlan => ({ ...p, sourceRules })

describe('areaIdsOf', () => {
  it('is empty without an area', () => {
    expect(areaIdsOf(plan('root', [], [plan('g')])).size).toBe(0)
  })

  it('holds the root and a nested area under a non-area group', () => {
    const root = plan('root', [], [plan('g', [], [plan('a', [], [], true)])])
    expect(areaIdsOf(root)).toEqual(new Set(['root', 'a']))
  })

  it('agrees with blockAreas', () => {
    const roots = [
      plan('root'),
      plan('root', [], [plan('a', [], [plan('b', [], [], true)], true), plan('g')]),
      plan('root', [], [plan('g', [], [plan('a', [], [], true)]), plan('c', [], [], true)]),
    ]
    for (const root of roots) expect(areaIdsOf(root)).toEqual(new Set((blockAreas(root) ?? []).map(a => a.id)))
  })
})

describe('cleanAreaRules', () => {
  const tree = (a: Partial<SubPlan> = {}, root: Partial<SubPlan> = {}) =>
    ({ ...plan('root', [], [{ ...plan('a', [], [], true), ...a }, plan('b', [], [], true), plan('g')]), ...root })

  it('returns a valid tree as the same object', () => {
    const root = tree({ sourceRules: { plate: { areasOff: ['b', 'root'] }, gear: {} } }, { sourceRules: { plate: { importOff: true } } })
    expect(cleanAreaRules(root)).toBe(root)
  })

  it('drops the rules of a plan that is not an area, and the emptied key', () => {
    const root = plan('root', [], [withRules(plan('g'), { plate: {} }), plan('a', [], [], true)])
    const cleaned = cleanAreaRules(root)
    expect('sourceRules' in find(cleaned, 'g')!).toBe(false)
  })

  it('drops the root rules without an area and keeps them with one', () => {
    expect('sourceRules' in cleanAreaRules(withRules(plan('root', [], [plan('g')]), { plate: {} }))).toBe(false)
    const kept = tree({}, { sourceRules: { plate: {} } })
    expect(cleanAreaRules(kept)).toBe(kept)
  })

  it('removes areasOff ids that name no area, a non-area plan or the plan itself, but keeps the rule', () => {
    const root = tree({ sourceRules: { plate: { makeHere: 'off', areasOff: ['ghost', 'g', 'a', 'b'] } } })
    expect(find(cleanAreaRules(root), 'a')!.sourceRules).toStrictEqual({ plate: { makeHere: 'off', areasOff: ['b'] } })
  })

  it('removes an emptied areasOff key and keeps the keyless rule', () => {
    const root = tree({ sourceRules: { plate: { areasOff: ['ghost'] }, gear: { areasOff: [] } } })
    expect(find(cleanAreaRules(root), 'a')!.sourceRules).toStrictEqual({ plate: {}, gear: {} })
  })
})

describe('remapAreaRules', () => {
  const ids = new Map([['x', 'x2'], ['y', 'y2']])

  it('maps the ids, drops the unmapped and keeps the order', () => {
    const out = remapAreaRules({ b: { areasOff: ['x', 'z', 'y'] }, a: { importOff: true } }, ids)
    expect(Object.keys(out!)).toEqual(['b', 'a'])
    expect(out).toStrictEqual({ b: { areasOff: ['x2', 'y2'] }, a: { importOff: true } })
  })

  it('removes an emptied key and keeps the rule', () => {
    expect(remapAreaRules({ a: { makeHere: 'off', areasOff: ['z'] } }, ids)).toStrictEqual({ a: { makeHere: 'off' } })
  })

  it('gives undefined for no rules', () => {
    expect(remapAreaRules(undefined, ids)).toBeUndefined()
    expect(remapAreaRules({}, ids)).toBeUndefined()
  })
})
