import { describe, it, expect } from 'vitest'
import type { ConnectionFlow } from '../../data/types'
import { flowShares, flowAtKey } from './flowParts'

function flow(overrides: Partial<ConnectionFlow> = {}): ConnectionFlow {
  return {
    connectionId: 'c1', fromBlockId: 'a', toBlockId: 'b', itemId: 'plate',
    available: 30, capped: false, rate: 20, status: 'ok', kind: 'take', ...overrides,
  }
}
const split = () => flow({
  itemId: 'steam', kind: 'request', requested: 30, loop: true, rate: 30, available: 50,
  parts: [
    { temp: { at: 165 }, rate: 10, available: 20 },
    { temp: { min: 465 }, rate: 20, available: 30, requested: 30 },
  ],
})

describe('flowShares', () => {
  it('is one share keyed by the item for a plain flow', () => {
    expect(flowShares(flow())).toEqual([{ key: 'plate', rate: 20, available: 30 }])
  })
  it('is one share per part, keyed by flow key, for a split flow', () => {
    expect(flowShares(split())).toEqual([
      { key: 'steam@165', rate: 10, available: 20 },
      { key: 'steam[465,]', rate: 20, available: 30, requested: 30 },
    ])
  })
})

describe('flowAtKey', () => {
  it('returns a plain flow itself at its own key and nothing at another', () => {
    const f = flow()
    expect(flowAtKey(f, 'plate')).toBe(f)
    expect(flowAtKey(f, 'steam@165')).toBeUndefined()
  })
  it('returns a copy with the share of a split flow, status and loop kept', () => {
    const at = flowAtKey(split(), 'steam[465,]')!
    expect(at).toMatchObject({ rate: 20, available: 30, requested: 30, status: 'ok', loop: true, connectionId: 'c1' })
    const low = flowAtKey(split(), 'steam@165')!
    expect(low).toMatchObject({ rate: 10, available: 20, loop: true })
    expect(low.requested).toBeUndefined()
  })
  it('is undefined for a key the flow has no part at', () => {
    expect(flowAtKey(split(), 'steam@500')).toBeUndefined()
  })
})
