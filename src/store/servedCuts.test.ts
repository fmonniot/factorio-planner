import { describe, expect, it } from 'vitest'
import type { Block, ServedEntry, SubPlan } from '../data/types'
import { cutServedEntries, lostAreaIds, restoreServedCuts } from './servedCuts'

const e = (id: string, flags: { areaId?: string; tied?: true; share?: number } = {}): ServedEntry => ({ kind: 'block', blockId: id, ...flags })
const T = { tied: true } as const

function source(servedOrder?: Record<string, ServedEntry[]>): Block {
  return {
    id: 's', name: 's', color: '#60a5fa', products: [], sourceRules: {}, inputConnections: [],
    ...(servedOrder ? { servedOrder } : {}),
    rootPlan: { id: 'root-s', name: 'root', nodes: [], subPlans: [] },
  } as unknown as Block
}
const dropB = (_s: Block, _i: string, x: ServedEntry) => x.kind === 'block' && x.blockId === 'B'

describe('cutServedEntries', () => {
  it('gives the same blocks and no cuts when nothing matches', () => {
    const blocks = [source({ plate: [e('A')] })]
    const r = cutServedEntries(blocks, dropB)
    expect(r.blocks).toBe(blocks)
    expect(r.cuts).toEqual([])
  })

  it('cuts and restores exactly, flags and shares included', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 40 }), e('C')]
    const blocks = [source({ plate: list })]
    const { blocks: cut, cuts } = cutServedEntries(blocks, dropB)
    expect(cut[0].servedOrder).toStrictEqual({ plate: [e('A'), e('C')] })
    expect(restoreServedCuts(cut, cuts)[0].servedOrder).toStrictEqual({ plate: list })
  })

  it('recreates an emptied key', () => {
    const { blocks: cut, cuts } = cutServedEntries([source({ plate: [e('B')] })], dropB)
    expect('servedOrder' in cut[0]).toBe(false)
    expect(restoreServedCuts(cut, cuts)[0].servedOrder).toStrictEqual({ plate: [e('B')] })
  })

  it('reinserts bare at the old place after an intermediate change', () => {
    const { blocks: cut, cuts } = cutServedEntries([source({ plate: [e('A'), e('B', { areaId: 'x' }), e('C')] })], (_s, _i, x) => x.kind === 'block' && x.blockId === 'B')
    const changed = cut.map(b => ({ ...b, servedOrder: { plate: [e('C'), e('A')] } }))
    expect(restoreServedCuts(changed, cuts)[0].servedOrder).toStrictEqual({ plate: [e('C'), e('B', { areaId: 'x' }), e('A')] })
  })

  it('skips a source that is gone and a list reset in between', () => {
    const { blocks: cut, cuts } = cutServedEntries([source({ plate: [e('A'), e('B')] })], dropB)
    expect(restoreServedCuts([], cuts)).toEqual([])
    const reset = [source()]
    expect(restoreServedCuts(reset, cuts)).toBe(reset)
    expect(cut[0].servedOrder).toBeDefined()
  })
})

describe('lostAreaIds', () => {
  const plan = (subPlans: Partial<SubPlan>[]): SubPlan =>
    ({ id: 'root', name: 'r', nodes: [], subPlans: subPlans.map(sp => ({ name: sp.id, nodes: [], subPlans: [], ...sp })) }) as unknown as SubPlan
  it('names the areas that went, the root included when the last one goes', () => {
    const before = plan([{ id: 'x', area: true }, { id: 'y', area: true }])
    expect(lostAreaIds(before, plan([{ id: 'x', area: true }]))).toEqual(new Set(['y']))
    expect(lostAreaIds(plan([{ id: 'x', area: true }]), plan([{ id: 'x' }]))).toEqual(new Set(['x', 'root']))
    expect(lostAreaIds(before, before)).toEqual(new Set())
    expect(lostAreaIds(plan([{ id: 'x' }]), plan([]))).toEqual(new Set())
  })
})
