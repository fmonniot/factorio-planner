import { describe, it, expect } from 'vitest'
import { flowLines, routeEnds, areaEndName } from './groupFlows'
import type { SubPlan } from '../../../data/types'

const names: Record<string, string> = { oil: 'Oil', root: 'the rest of the block' }
const nameOf = (id: string | undefined) => (id === undefined ? 'outside the block' : (names[id] ?? id))

describe('flowLines', () => {
  it('gives the two lines of a split fluid different keys', () => {
    const flows = [
      { itemId: 'steam', rate: 10, boundary: false, temp: { at: 165 } },
      { itemId: 'steam', rate: 5, boundary: false, temp: { at: 500 } },
      { itemId: 'gas', rate: 1, boundary: false },
    ]
    const keys = flowLines(flows, [], 'a', 'receives', nameOf).map(l => l.key)
    expect(new Set(keys).size).toBe(3)
  })

  const routes = [
    { itemId: 'gas', from: 'oil', to: 'a', rate: 30 },
    { itemId: 'gas', from: 'root', to: 'a', rate: 10 },
    { itemId: 'plastic', from: 'a', to: 'root', rate: 20 },
    { itemId: 'plastic', from: 'a', to: undefined, rate: 5 },
  ]

  it('names where a received item comes from', () => {
    const lines = flowLines([{ itemId: 'gas', rate: 40, boundary: false }], routes, 'a', 'receives', nameOf)
    expect(lines).toMatchObject([{ itemId: 'gas', rate: 40, otherEnd: 'from Oil, the rest of the block' }])
  })

  it('names where a sent item goes, outside the block included', () => {
    const lines = flowLines([{ itemId: 'plastic', rate: 25, boundary: true }], routes, 'a', 'sends', nameOf)
    expect(lines[0].otherEnd).toBe('to the rest of the block, outside the block')
  })

  it('leaves the other end empty without a route', () => {
    expect(flowLines([{ itemId: 'x', rate: 1, boundary: false }], routes, 'a', 'sends', nameOf)[0].otherEnd).toBe('')
  })

  it('lists one end per partner with its own rate', () => {
    const lines = flowLines([{ itemId: 'gas', rate: 40, boundary: false }], routes, 'a', 'receives', nameOf)
    expect(lines[0].ends).toEqual([
      { partnerId: 'oil', otherEnd: 'from Oil', rate: 30 },
      { partnerId: 'root', otherEnd: 'from the rest of the block', rate: 10 },
    ])
  })

  it('merges partners that share a display name, so the lines agree with the title', () => {
    const twins = [
      { itemId: 'gas', from: 'o1', to: 'a', rate: 3 },
      { itemId: 'gas', from: 'o2', to: 'a', rate: 4 },
    ]
    const same = (id: string | undefined) => (id === 'o1' || id === 'o2' ? 'Oil' : String(id))
    const line = flowLines([{ itemId: 'gas', rate: 7, boundary: false }], twins, 'a', 'receives', same)[0]
    expect(line.otherEnd).toBe('from Oil')
    expect(line.ends).toEqual([{ partnerId: 'o1', otherEnd: 'from Oil', rate: 7 }])
  })

  it('has an end for outside the block on a send', () => {
    const lines = flowLines([{ itemId: 'plastic', rate: 25, boundary: true }], routes, 'a', 'sends', nameOf)
    expect(lines[0].ends).toContainEqual({ partnerId: undefined, otherEnd: 'to outside the block', rate: 5 })
  })

  it('has no ends without a route and copies the boundary', () => {
    const line = flowLines([{ itemId: 'x', rate: 1, boundary: true }], routes, 'a', 'sends', nameOf)[0]
    expect(line.ends).toEqual([])
    expect(line.boundary).toBe(true)
  })
})

describe('routeEnds', () => {
  it('merges two routes to the same partner', () => {
    const ends = routeEnds([
      { from: 'p', to: 'a', rate: 3 },
      { from: 'p', to: 'a', rate: 4 },
      { from: 'q', to: 'a', rate: 1 },
      { from: 'a', to: 'q', rate: 9 },
    ], 'a', 'receives')
    expect(ends).toEqual([{ partnerId: 'p', rate: 7 }, { partnerId: 'q', rate: 1 }])
  })

  it('works on pairs that name outside with an opaque id', () => {
    const pairs = [{ from: 'a', to: 'outside', rate: 2 }, { from: 'outside', to: 'a', rate: 5 }]
    expect(routeEnds(pairs, 'a', 'sends')).toEqual([{ partnerId: 'outside', rate: 2 }])
    expect(routeEnds(pairs, 'a', 'receives')).toEqual([{ partnerId: 'outside', rate: 5 }])
  })
})

describe('areaEndName', () => {
  const sub = { id: 'oil', name: 'Oil', nodes: [], subPlans: [] } as unknown as SubPlan
  const root = { id: 'root', name: 'Root', nodes: [], subPlans: [sub] } as unknown as SubPlan
  const name = areaEndName(root)

  it('words the root, outside, a sub-plan and an unknown id', () => {
    expect(name('root')).toBe('the rest of the block')
    expect(name(undefined)).toBe('outside the block')
    expect(name('oil')).toBe('Oil')
    expect(name('ghost')).toBe('ghost')
  })
})
