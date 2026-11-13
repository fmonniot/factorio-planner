import { describe, expect, it } from 'vitest'
import type { ServedConsumer, ServedList } from '../../data/types'
import { hasServedOrder, servedLines } from './servedOrder'

const c = (blockId: string, kind: 'request' | 'take', share: number, got: number): ServedConsumer =>
  ({ blockId, connectionId: `c-${blockId}`, kind, share, got })

describe('hasServedOrder', () => {
  it('needs two consumers, or one consumer and the extra', () => {
    expect(hasServedOrder(undefined)).toBe(false)
    expect(hasServedOrder({ consumers: [] })).toBe(false)
    expect(hasServedOrder({ consumers: [c('b', 'request', 1, 1)] })).toBe(false)
    expect(hasServedOrder({ consumers: [c('b', 'request', 1, 1)], extra: { place: 1, asked: 1, got: 1 } })).toBe(true)
    expect(hasServedOrder({ consumers: [c('b', 'request', 1, 1), c('c', 'take', 0, 0)] })).toBe(true)
  })
})

describe('servedLines', () => {
  const list = (): ServedList => ({
    consumers: [c('b', 'request', 30, 30), c('c', 'request', 20, 15), c('d', 'take', 5, 5)],
    extra: { place: 2, asked: 10, got: 0 },
  })

  it('puts the extra at its place and ranks from 1', () => {
    const lines = servedLines(list(), 'plate', 'min')
    expect(lines.map(l => [l.rank, l.kind, l.blockId])).toEqual([
      [1, 'request', 'b'], [2, 'request', 'c'], [3, 'extra', undefined], [4, 'take', 'd'],
    ])
  })

  it('marks a short only when it survives rounding, and gives a take no ask', () => {
    const lines = servedLines(list(), 'plate', 'min')
    expect(lines[0].short).toBeUndefined()
    expect(lines[1].short).toBeCloseTo(5, 6)
    expect(lines[2]).toMatchObject({ asked: 10, got: 0 })
    expect(lines[2].short).toBeCloseTo(10, 6)
    expect(lines[3].asked).toBeUndefined()
    expect(lines[3].short).toBeUndefined()
    const rounded = servedLines({ consumers: [c('b', 'request', 30, 29.999)] }, 'plate', 'min')
    expect(rounded[0].short).toBeUndefined()
  })
})
