import { describe, expect, it } from 'vitest'
import type { Block, ServedConsumer, ServedEntry, ServedList } from '../../data/types'
import { makeEmptyBlock, makeEmptySubPlan } from '../../store/blockStore'
import { dropPlace, dropZone, entryOf, fmtPercent, hasServedOrder, insertionIndex, isTiedLine, lineKey, lineName, moveTarget, placement, servedLines, splitServed, underIn, unrankedCount, areaExistsIn } from './servedOrder'

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

  it('skips an area entry no line carries and ranks flagged plain entries as before', () => {
    const s = splitServed(servedLines(list(), 'plate', 'min'), [{ kind: 'block', blockId: 'b', areaId: 'x' }, { kind: 'block', blockId: 'c', tied: true }, { kind: 'block', blockId: 'd', share: 4 }])
    expect(ids(s.ranked)).toEqual(['c', 'd'])
    expect(ids(s.unranked)).toEqual(['b', 'extra'])
  })

  it('keeps an area entry the solver keeps (the area exists, it needs nothing) as an unseen member of its group', () => {
    const entries: ServedEntry[] = [{ kind: 'block', blockId: 'b', areaId: 'z', share: 20 }, { kind: 'block', blockId: 'c', tied: true, share: 30 }, { kind: 'block', blockId: 'd', tied: true, share: 50 }]
    const s = splitServed(servedLines(list(), 'plate', 'min'), entries, (blockId, areaId) => blockId === 'b' && areaId === 'z')
    expect(ids(s.ranked)).toEqual(['c', 'd'])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 1])
    expect(s.ranked.map(l => l.group)).toEqual([{ size: 2, index: 0, percent: 30, listOrder: false }, { size: 2, index: 1, percent: 50, listOrder: false }])
    // an area that does not exist is stale: the follower is promoted
    const stale = splitServed(servedLines(list(), 'plate', 'min'), entries, () => false)
    expect(stale.ranked.map(l => l.group?.percent)).toEqual([37.5, 62.5])
    expect(splitServed(servedLines(list(), 'plate', 'min'), [entries[0], { ...entries[0], tied: true }, blk('c')], () => true).ranked.map(l => l.rank)).toEqual([1])
  })

  it('counts a consumer named only by an area entry as unranked', () => {
    expect(unrankedCount(servedLines(list(), 'plate', 'min'), [{ kind: 'block', blockId: 'b', areaId: 'x' }, blk('c'), blk('d'), { kind: 'extra' }])).toBe(1)
  })

  it('ranks and counts with the same predicate the popover uses, so the summary and the graph agree with it', () => {
    const entries: ServedEntry[] = [{ kind: 'block', blockId: 'b', areaId: 'z' }, { kind: 'block', blockId: 'c', tied: true }, blk('d')]
    const lines = servedLines(list(), 'plate', 'min')
    const has = (blockId: string, areaId: string) => blockId === 'b' && areaId === 'z'
    // with the area existing, c and d keep the places the popover shows (c shares b's place, d is second)
    expect(splitServed(lines, entries, has).ranked.map(l => [l.blockId, l.rank])).toEqual([['c', 1], ['d', 2]])
    expect(unrankedCount(lines, entries, has)).toBe(splitServed(lines, entries, has).unranked.length)
    expect(areaExistsIn([])('b', 'z')).toBe(false)
  })

  it('counts what the stored list does not rank', () => {
    expect(unrankedCount(servedLines(list(), 'plate', 'min'), undefined)).toBe(0)
    expect(unrankedCount(servedLines(list(), 'plate', 'min'), [blk('b'), blk('c'), blk('d')])).toBe(1)
    expect(unrankedCount(servedLines(list(), 'plate', 'min'), [blk('b'), { kind: 'extra' }])).toBe(2)
    expect(unrankedCount(servedLines({ consumers: list().consumers }, 'plate', 'min'), [blk('b')])).toBe(2)
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

describe('dropZone', () => {
  it('reads the top and bottom 30 percent as edges and the rest as the middle', () => {
    expect(dropZone(0, 40)).toBe('top')
    expect(dropZone(11, 40)).toBe('top')
    expect(dropZone(13, 40)).toBe('middle')
    expect(dropZone(27, 40)).toBe('middle')
    expect(dropZone(29, 40)).toBe('bottom')
    expect(dropZone(39, 40)).toBe('bottom')
    expect(dropZone(5, 0)).toBe('middle')
  })
})

describe('fmtPercent', () => {
  it('shows at most one decimal', () => {
    expect(fmtPercent(50)).toBe('50')
    expect(fmtPercent(33.333)).toBe('33.3')
    expect(fmtPercent(66.666)).toBe('66.7')
    expect(fmtPercent(13.33)).toBe('13.3')
  })
})

describe('groups in splitServed and dropPlace', () => {
  const list = (): ServedList => ({
    consumers: [c('b', 'request', 1, 1), c('c', 'request', 1, 1), c('d', 'request', 1, 1)],
    extra: { place: 3, asked: 1, got: 1 },
  })
  const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
  const tied = (blockId: string, share?: number): ServedEntry => ({ kind: 'block', blockId, tied: true, ...(share !== undefined ? { share } : {}) })
  const lines = () => servedLines(list(), 'plate', 'min')
  const ids = (ls: { kind: string; blockId?: string }[]) => ls.map(l => l.blockId ?? l.kind)

  it('dropPlace gives an edge a rank of its own and the middle a join', () => {
    const ranked = splitServed(lines(), [blk('b'), blk('c'), blk('d')]).ranked
    expect(dropPlace(ranked, 1, 'top')).toEqual({ kind: 'rank', before: blk('c') })
    expect(dropPlace(ranked, 1, 'bottom')).toEqual({ kind: 'rank', before: blk('d') })
    expect(dropPlace(ranked, 2, 'bottom')).toEqual({ kind: 'rank', before: null })
    expect(dropPlace(ranked, 0, 'top')).toEqual({ kind: 'rank', before: blk('b') })
    expect(dropPlace(ranked, 1, 'middle')).toEqual({ kind: 'join', target: blk('c') })
    expect(dropPlace(ranked, 3, 'top')).toEqual({ kind: 'rank', before: null })
    expect(dropPlace(ranked, 3, 'middle')).toEqual({ kind: 'rank', before: null })
    expect(entryOf(ranked[1])).toEqual(blk('c'))
  })

  it('numbers a group once and reads its percentages', () => {
    const s = splitServed(lines(), [{ ...blk('b'), share: 50 }, tied('c', 30), tied('d', 20), { kind: 'extra' }])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 1, 1, 2])
    expect(s.ranked.slice(0, 3).map(l => l.group)).toEqual([
      { size: 3, index: 0, percent: 50, listOrder: false },
      { size: 3, index: 1, percent: 30, listOrder: false },
      { size: 3, index: 2, percent: 20, listOrder: false },
    ])
    expect(s.ranked[3].group).toBeUndefined()
  })

  it('promotes the follower of a stale head, as the solver does', () => {
    const s = splitServed(lines(), [blk('b'), blk('ghost'), tied('c'), tied('d')])
    expect(ids(s.ranked)).toEqual(['b', 'c', 'd'])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 2, 2])
    expect(s.ranked[1].group).toMatchObject({ size: 2, index: 0 })
    expect(s.ranked[0].group).toBeUndefined()
  })

  it('keeps a group whose stale member is not the head', () => {
    const s = splitServed(lines(), [blk('b'), tied('ghost'), tied('c')])
    expect(s.ranked.map(l => l.rank)).toEqual([1, 1])
    expect(s.ranked[0].group).toMatchObject({ size: 2, index: 0 })
  })

  it('reads an unedited group as an even split and no list as no groups', () => {
    const s = splitServed(lines(), [blk('b'), blk('c'), tied('d')])
    expect(s.ranked.map(l => l.group?.percent)).toEqual([undefined, 50, 50])
    expect(splitServed(lines(), undefined).ranked.every(l => l.group === undefined)).toBe(true)
  })

  it('carries groupInListOrder to servedLines and to the whole group', () => {
    const l: ServedList = {
      consumers: [c('b', 'request', 1, 1), { ...c('c', 'take', 0, 1), groupInListOrder: true }, c('d', 'take', 0, 1)],
    }
    const ls = servedLines(l, 'plate', 'min')
    expect(ls.map(x => x.groupInListOrder)).toEqual([undefined, true, undefined])
    const s = splitServed(ls, [blk('b'), blk('c'), tied('d')])
    expect(s.ranked.map(x => x.group?.listOrder)).toEqual([undefined, true, true])
  })
})

describe('area lines', () => {
  const ar = (blockId: string, areaId: string, share: number, got: number, kind: 'request' | 'take' = 'request'): ServedConsumer =>
    ({ ...c(blockId, kind, share, got), areaId })
  const rowA = (): ServedConsumer[] => [c('s', 'request', 30, 30), ar('h', 'L', 12, 12), ar('h', 'B', 8, 3)]
  const hub = (): Block => ({
    ...makeEmptyBlock('Hub'),
    id: 'h',
    rootPlan: {
      ...makeEmptyBlock('x').rootPlan,
      subPlans: [{ ...makeEmptySubPlan('Logistics'), id: 'L', area: true }, { ...makeEmptySubPlan('Building'), id: 'B', area: true }],
    },
  })
  const blk = (blockId: string): ServedEntry => ({ kind: 'block', blockId })
  const s = blk('s')
  const hL: ServedEntry = { kind: 'block', blockId: 'h', areaId: 'L' }
  const hB: ServedEntry = { kind: 'block', blockId: 'h', areaId: 'B' }
  const lines = () => servedLines({ consumers: rowA() }, 'plate', 'min')
  const keys = (ls: Parameters<typeof lineKey>[0][]) => ls.map(lineKey)

  it('servedLines draws one line per consumer, the extra at its place among lines', () => {
    const ls = servedLines({ consumers: rowA(), extra: { place: 2, asked: 4, got: 1 } }, 'plate', 'min')
    expect(ls.map(l => l.kind)).toEqual(['request', 'request', 'extra', 'request'])
    expect(ls.filter(l => l.kind !== 'extra').map(l => [l.blockId, l.areaId])).toEqual([['s', undefined], ['h', 'L'], ['h', 'B']])
    expect(ls[0]).not.toHaveProperty('areaId')
    expect(ls[3].short).toBeCloseTo(5, 6)
    expect(ls[1].short).toBeUndefined()
    expect(ls.map(l => l.rank)).toEqual([1, 2, 3, 4])
  })

  it('hasServedOrder counts lines', () => {
    expect(hasServedOrder({ consumers: [ar('h', 'L', 12, 12), ar('h', 'B', 8, 3)] })).toBe(true)
    expect(hasServedOrder({ consumers: [c('b', 'request', 1, 1)] })).toBe(false)
    expect(hasServedOrder({ consumers: [c('b', 'request', 1, 1)], extra: { place: 1, asked: 1, got: 1 } })).toBe(true)
  })

  it('lineKey and entryOf carry the area', () => {
    const [sLine, lLine] = lines()
    expect(lineKey(lLine)).toBe('block:h:area:L')
    expect(entryOf(lLine)).toStrictEqual({ kind: 'block', blockId: 'h', areaId: 'L' })
    expect(entryOf(sLine)).toStrictEqual({ kind: 'block', blockId: 's' })
    expect(lineKey(entryOf(lLine))).toBe(lineKey(lLine))
  })

  it('lineName reads Block / Area and falls back to ids', () => {
    const [sLine, lLine] = lines()
    expect(lineName(lLine, hub())).toBe('Hub / Logistics')
    const h = hub()
    expect(lineName({ ...lLine, areaId: h.rootPlan.id }, h)).toBe('Hub / Top level')
    expect(lineName({ ...lLine, areaId: 'ghost' }, hub())).toBe('Hub / ghost')
    expect(lineName(lLine, undefined)).toBe('h / L')
    expect(lineName(sLine, { ...hub(), name: 'Science' })).toBe('Science')
    expect(lineName({ kind: 'extra', rank: 1, got: 0 }, undefined)).toBe('Extra output')
  })

  it('splitServed without a list ranks area lines one by one', () => {
    const r = splitServed(lines(), undefined).ranked
    expect(keys(r)).toEqual(['block:s', 'block:h:area:L', 'block:h:area:B'])
    expect(r.map(l => l.rank)).toEqual([1, 2, 3])
    expect(r.every(l => l.group === undefined && l.span === undefined)).toBe(true)
  })

  it('a plain entry for a solo block is one place covering its lines', () => {
    const sec = splitServed(lines(), [s, blk('h')])
    expect(keys(sec.ranked)).toEqual(['block:s', 'block:h:area:L', 'block:h:area:B'])
    expect(sec.ranked.map(l => l.rank)).toEqual([1, 2, 2])
    expect(sec.ranked.map(l => l.span)).toEqual([undefined, { size: 2, index: 0 }, { size: 2, index: 1 }])
    expect(sec.ranked.every(l => l.group === undefined)).toBe(true)
    expect(sec.unranked).toEqual([])
    expect(sec.ranked.map(isTiedLine)).toEqual([false, false, false])
  })

  it('a plain entry in a group shares the entry rank, group and percent', () => {
    const sec = splitServed(lines(), [{ ...s, share: 70 }, { ...blk('h'), tied: true, share: 30 }])
    expect(sec.ranked.map(l => l.rank)).toEqual([1, 1, 1])
    expect(sec.ranked[0].group).toEqual({ size: 2, index: 0, percent: 70, listOrder: false })
    expect(sec.ranked[1].group).toEqual({ size: 2, index: 1, percent: 30, listOrder: false })
    expect(sec.ranked[2].group).toEqual({ size: 2, index: 1, percent: 30, listOrder: false })
    expect(sec.ranked.map(isTiedLine)).toEqual([false, true, true])
  })

  it('area entries rank their own lines, in the list order', () => {
    const grouped = splitServed(lines(), [s, hL, { ...hB, tied: true }]).ranked
    expect(grouped.map(l => l.rank)).toEqual([1, 2, 2])
    expect(grouped[1].group).toEqual({ size: 2, index: 0, percent: 50, listOrder: false })
    expect(grouped[2].group).toEqual({ size: 2, index: 1, percent: 50, listOrder: false })
    expect(grouped.every(l => l.span === undefined)).toBe(true)
    const c3 = splitServed(lines(), [s, hB, hL]).ranked
    expect(keys(c3)).toEqual(['block:s', 'block:h:area:B', 'block:h:area:L'])
    expect(c3.map(l => l.rank)).toEqual([1, 2, 3])
    expect(c3[1].got).toBe(3)
    expect(c3[2].got).toBe(12)
  })

  it('a plain entry stands for the lines no area entry names', () => {
    const sec = splitServed(lines(), [hB, s, blk('h')])
    expect(keys(sec.ranked)).toEqual(['block:h:area:B', 'block:s', 'block:h:area:L'])
    expect(sec.ranked.map(l => l.rank)).toEqual([1, 2, 3])
    expect(sec.ranked.every(l => l.span === undefined)).toBe(true)
    expect(sec.unranked).toEqual([])
  })

  it('skips partial, stale and repeated entries', () => {
    const part = splitServed(lines(), [s, hL])
    expect(keys(part.ranked)).toEqual(['block:s', 'block:h:area:L'])
    expect(keys(part.unranked)).toEqual(['block:h:area:B'])
    expect(part.unranked[0].rank).toBe(0)
    expect(unrankedCount(lines(), [s, hL])).toBe(1)
    const withExtra = [...lines(), { kind: 'extra' as const, rank: 4, got: 0 }]
    expect(unrankedCount(withExtra, [s, hL])).toBe(2)
    expect(unrankedCount(lines(), [s])).toBe(2)
    expect(unrankedCount(lines(), [s, blk('h')])).toBe(0)

    const ghost: ServedEntry = { kind: 'block', blockId: 'h', areaId: 'ghost' }
    const g1 = splitServed(lines(), [s, ghost, blk('h')])
    expect(g1.ranked.map(l => l.rank)).toEqual([1, 2, 2])
    const g2 = splitServed(lines(), [s, ghost, { ...hL, tied: true }, { ...hB, tied: true }]).ranked
    expect(g2.map(l => l.rank)).toEqual([1, 2, 2])
    expect(g2[1].group).toMatchObject({ size: 2, index: 0, percent: 50 })
    expect(g2[2].group).toMatchObject({ size: 2, index: 1, percent: 50 })

    const covered = splitServed(lines(), [hL, hB, blk('h')])
    expect(keys(covered.ranked)).toEqual(['block:h:area:L', 'block:h:area:B'])
    expect(keys(covered.unranked)).toEqual(['block:s'])
    expect(unrankedCount(lines(), [hL, hB, blk('h')])).toBe(1)

    const rep = splitServed(lines(), [hL, hL, s])
    expect(keys(rep.ranked)).toEqual(['block:h:area:L', 'block:s'])
    expect(keys(rep.unranked)).toEqual(['block:h:area:B'])
  })

  it('reads listOrder per group over the lines of its entries', () => {
    const take = (a: string): ServedConsumer => ({ ...ar('h', a, 0, 1, 'take'), groupInListOrder: true })
    const ls = servedLines({ consumers: [take('L'), take('B')] }, 'plate', 'min')
    expect(ls.every(l => l.groupInListOrder === true)).toBe(true)
    const r = splitServed(ls, [blk('x'), hL, { ...hB, tied: true }]).ranked
    expect(r.map(l => l.group?.listOrder)).toEqual([true, true])
  })

  it('placement expands a plain entry before looking for the insertion index', () => {
    const { ranked } = splitServed(lines(), [s, blk('h')])
    const before = moveTarget(ranked, 2, -1)
    const out = placement(ranked, [s, blk('h')], before)
    expect(out.toIndex).toBe(1)
    expect(out.shown).toEqual([s, hL, hB])
  })

  it('dropPlace works on area lines', () => {
    const { ranked } = splitServed(lines(), undefined)
    expect(dropPlace(ranked, 1, 'middle')).toEqual({ kind: 'join', target: hL })
    expect(dropPlace(ranked, 1, 'bottom')).toEqual({ kind: 'rank', before: hB })
  })

  it('underIn counts the lines after one in its rank', () => {
    const { ranked } = splitServed(lines(), [{ ...s, share: 70 }, { ...blk('h'), tied: true, share: 30 }])
    expect(underIn(ranked, ranked[1])).toBe(1)
    expect(underIn(ranked, ranked[2])).toBe(0)
    expect(underIn(ranked, { kind: 'request', rank: 0, blockId: 'zz', got: 0 })).toBe(0)
  })
})
