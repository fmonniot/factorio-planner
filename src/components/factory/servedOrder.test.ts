import { describe, expect, it } from 'vitest'
import type { ServedConsumer, ServedEntry, ServedList } from '../../data/types'
import { blockLines, hasServedOrder, insertionIndex, lineKey, moveTarget, placement, servedLines, splitServed, unrankedCount } from './servedOrder'

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

describe('servedLines of takes', () => {
  const take = (blockId: string, over: Partial<ServedConsumer>): ServedConsumer => ({ ...c(blockId, 'take', 0, 0), ...over })

  it('carries need and notCredited, and never a short on a take', () => {
    const list: ServedList = { consumers: [take('b', { need: 8, got: 3, notCredited: true }), take('c', { need: 8, got: 3 }), take('d', {})] }
    const lines = servedLines(list, 'plate', 'min')
    expect(lines[0]).toMatchObject({ need: 8, notCredited: true })
    expect(lines[1].need).toBe(8)
    expect(lines.map(l => l.short)).toEqual([undefined, undefined, undefined])
    expect(lines[2].need).toBeUndefined()
    expect(lines[2].notCredited).toBeUndefined()
  })
})

describe('lineKey', () => {
  it('names the extra, a block and a block area', () => {
    expect(lineKey({ kind: 'extra' })).toBe('extra')
    expect(lineKey({ kind: 'block', blockId: 'b' })).toBe('block:b')
    expect(lineKey({ kind: 'block', blockId: 'b', areaId: 'x' })).toBe('block:b:area:x')
  })
})

describe('splitServed', () => {
  const list = (): ServedList => ({
    consumers: [c('b', 'request', 1, 1), c('c', 'request', 1, 1), c('d', 'request', 1, 1)],
    extra: { place: 1, asked: 1, got: 1 },
  })
  const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
  const ids = (lines: { kind: string; blockId?: string }[]) => lines.map(l => l.blockId ?? l.kind)

  it('ranks everything in solver order without a stored list', () => {
    const s = splitServed(servedLines(list(), 'plate', 'min'), undefined)
    expect(s.hasList).toBe(false)
    expect(ids(s.ranked)).toEqual(['b', 'extra', 'c', 'd'])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 2, 3, 4])
    expect(s.unranked).toEqual([])
  })

  it('orders ranked lines by the stored list, the rest in solver order with the extra last', () => {
    const s = splitServed(servedLines(list(), 'plate', 'min'), [blk('d'), blk('c')])
    expect(s.hasList).toBe(true)
    expect(ids(s.ranked)).toEqual(['d', 'c'])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 2])
    expect(ids(s.unranked)).toEqual(['b', 'extra'])
    expect(s.unranked.map(l => l.rank)).toEqual([0, 0])
  })

  it('keeps the extra among the ranked lines when the list names it', () => {
    const s = splitServed(servedLines(list(), 'plate', 'min'), [blk('c'), { kind: 'extra' }])
    expect(ids(s.ranked)).toEqual(['c', 'extra'])
    expect(ids(s.unranked)).toEqual(['b', 'd'])
  })

  it('skips a stale entry, and a list that matches nothing ranks nothing', () => {
    expect(ids(splitServed(servedLines(list(), 'plate', 'min'), [blk('x'), blk('b')]).ranked)).toEqual(['b'])
    const none = splitServed(servedLines(list(), 'plate', 'min'), [blk('x')])
    expect(none.ranked).toEqual([])
    expect(ids(none.unranked)).toEqual(['b', 'c', 'd', 'extra'])
  })

  it('leaves an area entry unmatched and ranks flagged plain entries as before', () => {
    const s = splitServed(servedLines(list(), 'plate', 'min'), [{ kind: 'block', blockId: 'b', areaId: 'x' }, { kind: 'block', blockId: 'c', tied: true }, { kind: 'block', blockId: 'd', share: 4 }])
    expect(ids(s.ranked)).toEqual(['c', 'd'])
    expect(ids(s.unranked)).toEqual(['b', 'extra'])
  })

  it('counts a consumer named only by an area entry as unranked', () => {
    expect(unrankedCount(list(), [{ kind: 'block', blockId: 'b', areaId: 'x' }, blk('c'), blk('d'), { kind: 'extra' }])).toBe(1)
  })

  it('counts what the stored list does not rank', () => {
    expect(unrankedCount(list(), undefined)).toBe(0)
    expect(unrankedCount(list(), [blk('b'), blk('c'), blk('d')])).toBe(1)
    expect(unrankedCount(list(), [blk('b'), { kind: 'extra' }])).toBe(2)
    expect(unrankedCount({ consumers: list().consumers }, [blk('b')])).toBe(2)
  })
})

describe('placement', () => {
  const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
  const lines = servedLines({ consumers: [c('b', 'request', 1, 1), c('c', 'request', 1, 1)] }, 'plate', 'min')

  it('finds an insertion index, the end when the line is absent or null', () => {
    const order = [blk('b'), blk('c')]
    expect(insertionIndex(order, blk('c'))).toBe(1)
    expect(insertionIndex(order, blk('ghost'))).toBe(2)
    expect(insertionIndex(order, null)).toBe(2)
  })

  it('moves one place up or down against the shown order', () => {
    expect(moveTarget(lines, 1, -1)).toBe(lines[0])
    expect(moveTarget(lines, 0, 1)).toBeNull()
    expect(placement(lines, undefined, moveTarget(lines, 0, 1)).toIndex).toBe(2)
    expect(placement(lines, undefined, moveTarget(lines, 1, -1)).toIndex).toBe(0)
    expect(placement(lines, [blk('x'), blk('b'), blk('c')], lines[0]).toIndex).toBe(1)
  })
})

describe('blockLines', () => {
  const area = (blockId: string, areaId: string, share: number, got: number, need?: number): ServedConsumer =>
    ({ ...c(blockId, 'request', share, got), areaId, ...(need !== undefined ? { need } : {}) })
  const split = (place?: number): ServedList => ({
    consumers: [area('h', 'L', 12, 12), c('s', 'request', 30, 30), area('h', 'B', 8, 3)],
    ...(place !== undefined ? { extra: { place, asked: 4, got: 1 } } : {}),
  })

  it('returns the same array when no consumer has an area', () => {
    const list: ServedList = { consumers: [c('b', 'request', 1, 1)], extra: { place: 1, asked: 1, got: 1 } }
    const out = blockLines(list)
    expect(out.consumers).toBe(list.consumers)
    expect(out.extraPlace).toBe(1)
    expect(blockLines({ consumers: [] }).extraPlace).toBeUndefined()
  })
  it('merges the lines of a block at its first position, summing share and got', () => {
    const out = blockLines(split())
    expect(out.consumers.map(l => [l.blockId, l.share, l.got])).toEqual([['h', 20, 15], ['s', 30, 30]])
    expect(out.consumers[0]).not.toHaveProperty('areaId')
  })
  it('sums the need and keeps notCredited when any line has it', () => {
    const list: ServedList = { consumers: [{ ...area('h', 'L', 0, 0, 12), kind: 'take', notCredited: true }, { ...area('h', 'B', 0, 0, 8), kind: 'take' }] }
    expect(blockLines(list).consumers).toEqual([expect.objectContaining({ need: 20, notCredited: true })])
  })
  it('remaps the place of the extra to a count of blocks', () => {
    expect(blockLines(split(1)).extraPlace).toBe(1)
    expect(blockLines(split(2)).extraPlace).toBe(2)
    expect(blockLines(split(3)).extraPlace).toBe(2)
  })
  it('feeds servedLines, unrankedCount and hasServedOrder one line per block', () => {
    const lines = servedLines(split(), 'plate', 'min')
    expect(lines.map(l => [l.blockId, l.asked, l.got])).toEqual([['h', 20, 15], ['s', 30, 30]])
    expect(lines[0].short).toBeCloseTo(5, 6)
    expect(unrankedCount(split(), [{ kind: 'block', blockId: 's' }])).toBe(1)
    expect(unrankedCount(split(), [])).toBe(2)
    expect(hasServedOrder({ consumers: [area('h', 'L', 12, 12), area('h', 'B', 8, 3)] })).toBe(false)
    expect(hasServedOrder({ consumers: [area('h', 'L', 12, 12), area('h', 'B', 8, 3)], extra: { place: 2, asked: 1, got: 1 } })).toBe(true)
  })
})
