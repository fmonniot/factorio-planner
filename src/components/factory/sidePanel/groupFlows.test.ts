import { describe, it, expect } from 'vitest'
import { flowLines } from './groupFlows'

const names: Record<string, string> = { oil: 'Oil', root: 'the rest of the block' }
const nameOf = (id: string | undefined) => (id === undefined ? 'outside the block' : (names[id] ?? id))

describe('flowLines', () => {
  const routes = [
    { itemId: 'gas', from: 'oil', to: 'a', rate: 30 },
    { itemId: 'gas', from: 'root', to: 'a', rate: 10 },
    { itemId: 'plastic', from: 'a', to: 'root', rate: 20 },
    { itemId: 'plastic', from: 'a', to: undefined, rate: 5 },
  ]

  it('names where a received item comes from', () => {
    const lines = flowLines([{ itemId: 'gas', rate: 40, boundary: false }], routes, 'a', 'receives', nameOf)
    expect(lines).toEqual([{ itemId: 'gas', rate: 40, otherEnd: 'from Oil, the rest of the block' }])
  })

  it('names where a sent item goes, outside the block included', () => {
    const lines = flowLines([{ itemId: 'plastic', rate: 25, boundary: true }], routes, 'a', 'sends', nameOf)
    expect(lines[0].otherEnd).toBe('to the rest of the block, outside the block')
  })

  it('leaves the other end empty without a route', () => {
    expect(flowLines([{ itemId: 'x', rate: 1, boundary: false }], routes, 'a', 'sends', nameOf)[0].otherEnd).toBe('')
  })
})
