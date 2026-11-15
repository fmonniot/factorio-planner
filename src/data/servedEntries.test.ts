import { describe, it, expect } from 'vitest'
import {
  canonicalServedList, dropServedEntries, equalServedEntry, groupPercents, isCanonicalServedList,
  isServedConsumer, remapServedOrder, sameServedEntry, sameServedList, servedEntryKey, servedGroups, servedListOf, takesFrom,
  withoutServedAreas, withoutServedConsumer, withServedEntryInserted, withServedEntryPlaced, withServedList, withServedShare, withServedTied,
} from './servedEntries'
import type { Block, ServedEntry } from './types'

const blk = (id: string): ServedEntry => ({ kind: 'block', blockId: id })
const extra: ServedEntry = { kind: 'extra' }

function block(id: string, extraFields: Partial<Block> = {}): Block {
  return {
    id, name: id, color: '#60a5fa', products: [], sourceRules: {}, inputConnections: [],
    rootPlan: { id: `root-${id}`, name: 'root', nodes: [], subPlans: [] },
    ...extraFields,
  } as unknown as Block
}
const taking = (id: string, from: string, itemId = 'plate') => block(id, { inputConnections: [{ id: `c-${id}`, itemId, fromBlockId: from }] })

describe('sameServedEntry', () => {
  it('compares kind and block id', () => {
    expect(sameServedEntry(blk('a'), blk('a'))).toBe(true)
    expect(sameServedEntry(blk('a'), blk('b'))).toBe(false)
    expect(sameServedEntry(extra, { kind: 'extra' })).toBe(true)
    expect(sameServedEntry(extra, blk('a'))).toBe(false)
  })
})

describe('servedListOf', () => {
  it('reads own keys only', () => {
    const b = block('s', { servedOrder: { plate: [blk('a')] } })
    expect(servedListOf(b, 'plate')).toEqual([blk('a')])
    expect(servedListOf(b, 'constructor')).toBeUndefined()
    expect(servedListOf(block('s'), 'plate')).toBeUndefined()
  })
})

describe('withServedEntryPlaced', () => {
  const list = [blk('a'), blk('b'), blk('c'), extra]
  it('moves an entry up', () => {
    expect(withServedEntryPlaced(list, blk('c'), blk('a'))).toEqual([blk('c'), blk('a'), blk('b'), extra])
  })
  it('moves an entry to the end with null', () => {
    expect(withServedEntryPlaced(list, blk('a'), null)).toEqual([blk('b'), blk('c'), extra, blk('a')])
  })
  it('inserts an entry that is not in the list', () => {
    expect(withServedEntryPlaced([blk('a')], blk('b'), blk('a'))).toEqual([blk('b'), blk('a')])
  })
  it('falls back to the end when the anchor is gone', () => {
    expect(withServedEntryPlaced(list, blk('a'), blk('ghost'))).toEqual([blk('b'), blk('c'), extra, blk('a')])
  })
  it('gives undefined for no change', () => {
    expect(withServedEntryPlaced(list, blk('b'), blk('c'))).toBeUndefined()
    expect(withServedEntryPlaced(list, extra, null)).toBeUndefined()
  })
})

describe('withServedList', () => {
  it('sets a list and leaves other items alone', () => {
    const b = block('s', { servedOrder: { gear: [blk('a')] } })
    expect(withServedList(b, 'plate', [blk('b')]).servedOrder).toEqual({ gear: [blk('a')], plate: [blk('b')] })
  })
  it('removes an emptied item key and then servedOrder, never writing undefined', () => {
    const b = block('s', { servedOrder: { gear: [blk('a')], plate: [blk('b')] } })
    const one = withServedList(b, 'plate', undefined)
    expect(one.servedOrder).toEqual({ gear: [blk('a')] })
    const none = withServedList(one, 'gear', [])
    expect('servedOrder' in none).toBe(false)
  })
  it('returns the same block when nothing changes', () => {
    const b = block('s', { servedOrder: { plate: [blk('a')] } })
    expect(withServedList(b, 'plate', [blk('a')])).toBe(b)
    expect(withServedList(b, 'gear', undefined)).toBe(b)
  })
})

describe('remapServedOrder', () => {
  const ids = new Map([['a', 'a2'], ['b', 'b2']])
  it('maps block ids and drops unmapped entries and emptied lists', () => {
    expect(remapServedOrder({ plate: [blk('a'), blk('ghost'), extra], gear: [blk('ghost')] }, ids, new Map())).toEqual({ plate: [blk('a2'), extra] })
  })
  it('gives undefined when nothing is left', () => {
    expect(remapServedOrder({ plate: [blk('ghost')] }, ids, new Map())).toBeUndefined()
  })
})

describe('withoutServedConsumer', () => {
  it('removes the block from every list and drops emptied ones', () => {
    const b = block('s', { servedOrder: { plate: [blk('a'), blk('b')], gear: [blk('a')] } })
    expect(withoutServedConsumer(b, 'a').servedOrder).toEqual({ plate: [blk('b')] })
    expect('servedOrder' in withoutServedConsumer(withoutServedConsumer(b, 'a'), 'b')).toBe(false)
  })
  it('returns the same block when it has no entry', () => {
    const b = block('s', { servedOrder: { plate: [blk('a')] } })
    expect(withoutServedConsumer(b, 'z')).toBe(b)
    expect(withoutServedConsumer(block('s'), 'a')).toEqual(block('s'))
  })
})

describe('takesFrom and isServedConsumer', () => {
  const blocks = [block('s'), taking('a', 's'), taking('g', 's', 'gear')]
  it('needs the item and the source', () => {
    expect(takesFrom(blocks[1], 's', 'plate')).toBe(true)
    expect(takesFrom(blocks[1], 's', 'gear')).toBe(false)
    expect(takesFrom(blocks[1], 'x', 'plate')).toBe(false)
  })
  it('is false for the source itself and unknown blocks', () => {
    expect(isServedConsumer(blocks, 's', 'plate', 'a')).toBe(true)
    expect(isServedConsumer(blocks, 's', 'plate', 'g')).toBe(false)
    expect(isServedConsumer(blocks, 's', 'plate', 's')).toBe(false)
    expect(isServedConsumer(blocks, 's', 'plate', 'ghost')).toBe(false)
  })
})

describe('remapServedOrder with a prototype-named item', () => {
  it('keeps the list as an own key', () => {
    const order = JSON.parse('{"__proto__":[{"kind":"block","blockId":"a"}]}') as Record<string, ServedEntry[]>
    const out = remapServedOrder(order, new Map([['a', 'z']]), new Map())!
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')!.value).toEqual([blk('z')])
  })
})

// ── Groups, flags and shape ─────────────────────────────────────────────────

const e = (id: string, flags: { areaId?: string; tied?: true; share?: number } = {}): ServedEntry => ({ kind: 'block', blockId: id, ...flags })
const T = { tied: true } as const
const xt = (flags: { tied?: true; share?: number } = {}): ServedEntry => ({ kind: 'extra', ...flags })

describe('identity with flags', () => {
  it('ignores tied and share, counts the area', () => {
    expect(sameServedEntry(e('a', T), e('a'))).toBe(true)
    expect(sameServedEntry(e('a', { areaId: 'x' }), e('a'))).toBe(false)
    expect(sameServedEntry(e('a', { areaId: 'x' }), e('a', { areaId: 'y' }))).toBe(false)
    expect(sameServedEntry(e('a', { areaId: 'x' }), e('a', { areaId: 'x', share: 3 }))).toBe(true)
  })
  it('equalServedEntry and sameServedList count the flags', () => {
    expect(equalServedEntry(e('a', { share: 1 }), e('a', { share: 2 }))).toBe(false)
    expect(equalServedEntry(e('a', T), e('a'))).toBe(false)
    expect(equalServedEntry(e('a', T), e('a', T))).toBe(true)
    expect(sameServedList([e('a'), e('b', { share: 1 })], [e('a'), e('b', { share: 2 })])).toBe(false)
    expect(sameServedList([e('a'), e('b', T)], [e('a'), e('b', T)])).toBe(true)
  })
  it('servedEntryKey names the place', () => {
    expect(servedEntryKey(xt())).toBe('extra')
    expect(servedEntryKey(e('a'))).toBe('block:a')
    expect(servedEntryKey(e('a', { areaId: 'x' }))).toBe('block:a:area:x')
  })
})

describe('servedGroups', () => {
  it('starts a group at every entry without tied', () => {
    expect(servedGroups([e('A'), e('B', T), e('C'), e('D', T), e('E', T)])).toEqual([[e('A'), e('B', T)], [e('C'), e('D', T), e('E', T)]])
  })
  it('ignores tied at index 0', () => {
    expect(servedGroups([e('A', T), e('B')])).toEqual([[e('A', T)], [e('B')]])
  })
  it('groups the extra', () => {
    expect(servedGroups([e('A'), xt(T)])).toEqual([[e('A'), xt(T)]])
  })
})

describe('groupPercents', () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  it('splits evenly without shares', () => {
    expect(groupPercents([e('A'), e('B', T)])).toEqual([50, 50])
    expect(groupPercents([e('A')])).toEqual([100])
  })
  it('normalises stored shares', () => {
    const p = groupPercents([e('A', { share: 60 }), e('B', { ...T, share: 30 })])
    expect(p[0]).toBeCloseTo(66.67, 1)
    expect(p[1]).toBeCloseTo(33.33, 1)
  })
  it('reads a missing share as the mean of the stored ones', () => {
    const p = groupPercents([e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('C', T)])
    expect(p[0]).toBeCloseTo(44.44, 1)
    expect(p[1]).toBeCloseTo(22.22, 1)
    expect(p[2]).toBeCloseTo(33.33, 1)
    expect(sum(p)).toBeCloseTo(100, 9)
  })
})

describe('dropServedEntries', () => {
  it('promotes the first follower when a head leaves', () => {
    expect(dropServedEntries([e('A'), e('B', T), e('C', T)], x => x.kind === 'block' && x.blockId === 'A')).toStrictEqual([e('B'), e('C', T)])
  })
  it('never merges two groups', () => {
    expect(dropServedEntries([e('A'), e('B'), e('C', T)], x => x.kind === 'block' && x.blockId === 'B')).toStrictEqual([e('A'), e('C')])
  })
  it('promotes through several drops', () => {
    expect(dropServedEntries([e('A'), e('B', T), e('C', T), e('D')], x => x.kind === 'block' && (x.blockId === 'A' || x.blockId === 'B'))).toStrictEqual([e('C'), e('D')])
  })
  it('keeps the shares of the stayers', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('C', { ...T, share: 10 })]
    expect(dropServedEntries(list, x => x.kind === 'block' && x.blockId === 'C')).toStrictEqual([e('A', { share: 60 }), e('B', { ...T, share: 30 })])
    expect(dropServedEntries(list, x => x.kind === 'block' && x.blockId === 'B')).toStrictEqual([e('A', { share: 60 }), e('C', { ...T, share: 10 })])
  })
  it('drops the share of a group falling to one member', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('C', { ...T, share: 10 })]
    const out = dropServedEntries(list, x => x.kind === 'block' && x.blockId !== 'A')
    expect(out).toStrictEqual([e('A')])
    expect('share' in out[0]).toBe(false)
    expect(dropServedEntries([e('A', { share: 60 }), e('B', { ...T, share: 40 })], x => x.kind === 'block' && x.blockId === 'B')).toStrictEqual([e('A')])
  })
  it('gives an equal list when nothing is dropped, and passes the index', () => {
    const list = [e('A'), e('B', T)]
    expect(dropServedEntries(list, () => false)).toStrictEqual(list)
    const seen: number[] = []
    dropServedEntries(list, (_x, i) => { seen.push(i); return false })
    expect(seen).toEqual([0, 1])
  })
})

describe('canonicalServedList', () => {
  it('returns the same array when canonical', () => {
    const list = [e('A'), e('B', { ...T, share: 3 })]
    expect(canonicalServedList(list)).toBe(list)
    expect(isCanonicalServedList(list)).toBe(true)
  })
  it('drops repeats of the same block and area only', () => {
    const out = canonicalServedList([e('b', { areaId: 'x' }), e('b', { areaId: 'y' }), e('b'), e('b', { areaId: 'x' })])
    expect(out).toStrictEqual([e('b', { areaId: 'x' }), e('b', { areaId: 'y' }), e('b')])
  })
  it('drops a second extra and promotes after a repeated head', () => {
    expect(canonicalServedList([xt(), e('a'), xt()])).toStrictEqual([xt(), e('a')])
    expect(canonicalServedList([e('a'), e('b'), e('a'), e('c', T)])).toStrictEqual([e('a'), e('b'), e('c')])
  })
  it('clears tied on the first line', () => {
    expect(canonicalServedList([e('a', T), e('b', T)])).toStrictEqual([e('a'), e('b', T)])
  })
  it('drops non-positive shares and keeps tied', () => {
    expect(canonicalServedList([e('a'), e('b', { ...T, share: 0 }), e('c', { ...T, share: -5 })])).toStrictEqual([e('a'), e('b', T), e('c', T)])
  })
  it('drops a share on a lone line', () => {
    expect(canonicalServedList([e('a', { share: 5 }), e('b')])).toStrictEqual([e('a'), e('b')])
  })
})

describe('withServedEntryPlaced and the shape', () => {
  it('swaps by position', () => {
    expect(withServedEntryPlaced([e('A'), e('B', T), e('C')], e('C'), e('B'))).toStrictEqual([e('A'), e('C', T), e('B')])
  })
  it('drops the shares of a group that falls apart', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 40 }), e('C')]
    expect(withServedEntryPlaced(list, e('A'), null)).toStrictEqual([e('B'), e('C', T), e('A')])
  })
  it('keeps the stored share of the moved entry', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 40 }), e('C')]
    expect(withServedEntryPlaced(list, e('A'), e('C'))).toStrictEqual([e('B', { share: 40 }), e('A', { ...T, share: 60 }), e('C')])
  })
  it('keeps the shares of the stayers when a member leaves', () => {
    const list = [e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('C', { ...T, share: 10 }), e('D')]
    const out = withServedEntryPlaced(list, e('C'), null)!
    expect(out).toStrictEqual([e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('D', T), e('C')])
    const p = groupPercents(out.slice(0, 3))
    expect(p[0]).toBeCloseTo(44.4, 0)
  })
  it('inserts an absent entry bare, tied only inside a group', () => {
    expect(withServedEntryPlaced([e('A'), e('B', T)], e('X', { share: 9 }), e('B'))).toStrictEqual([e('A'), e('X', T), e('B', T)])
    expect(withServedEntryPlaced([e('A'), e('B', T)], e('X'), e('A'))).toStrictEqual([e('X'), e('A'), e('B', T)])
    expect(withServedEntryPlaced([e('A'), e('B', T)], e('X'), null)).toStrictEqual([e('A'), e('B', T), e('X')])
  })
  it('gives undefined for the same position', () => {
    expect(withServedEntryPlaced([e('A'), e('B', T)], e('B'), null)).toBeUndefined()
  })
})

describe('withServedEntryInserted', () => {
  it('is tied only when it lands inside a group', () => {
    expect(withServedEntryInserted([e('A'), e('B', T)], e('X'), 1)).toStrictEqual([e('A'), e('X', T), e('B', T)])
    expect(withServedEntryInserted([e('A'), e('B', T)], e('X'), 0)).toStrictEqual([e('X'), e('A'), e('B', T)])
    expect(withServedEntryInserted([e('A'), e('B', T)], e('X'), 2)).toStrictEqual([e('A'), e('B', T), e('X')])
  })
})

describe('withServedTied', () => {
  it('ties and unties', () => {
    const list = [e('A'), e('B')]
    const tied = withServedTied(list, e('B'), true)!
    expect(tied).toStrictEqual([e('A'), e('B', T)])
    expect(withServedTied(tied, e('B'), false)).toStrictEqual(list)
  })
  it('is a no-op for the first line, an absent entry and the same state', () => {
    expect(withServedTied([e('A'), e('B')], e('A'), true)).toBeUndefined()
    expect(withServedTied([e('A'), e('B')], e('Z'), true)).toBeUndefined()
    expect(withServedTied([e('A'), e('B')], e('B'), false)).toBeUndefined()
  })
  it('merges a whole group into the one above', () => {
    const out = withServedTied([e('A'), e('B', { share: 70 }), e('C', { ...T, share: 30 })], e('B'), true)!
    expect(out).toStrictEqual([e('A'), e('B', { ...T, share: 70 }), e('C', { ...T, share: 30 })])
    const p = groupPercents(out)
    expect(p[0]).toBeCloseTo(33.3, 0)
    expect(p[1]).toBeCloseTo(46.7, 0)
    expect(p[2]).toBeCloseTo(20, 0)
  })
  it('splits at a middle member', () => {
    const out = withServedTied([e('A', { share: 50 }), e('B', { ...T, share: 30 }), e('C', { ...T, share: 20 })], e('B'), false)!
    expect(out).toStrictEqual([e('A'), e('B', { share: 30 }), e('C', { ...T, share: 20 })])
    expect(groupPercents(out.slice(1))).toEqual([60, 40])
  })
  it('drops the share of a member left alone', () => {
    const out = withServedTied([e('A', { share: 50 }), e('B', { ...T, share: 30 }), e('C', { ...T, share: 20 })], e('C'), false)!
    expect(out).toStrictEqual([e('A', { share: 50 }), e('B', { ...T, share: 30 }), e('C')])
  })
})

describe('withServedShare', () => {
  const sum = (xs: ServedEntry[]) => xs.reduce((a, x) => a + (x.share ?? 0), 0)
  it('sets one percent and scales the others', () => {
    const out = withServedShare([e('A'), e('B', T)], e('A'), 70)!
    expect(groupPercents(out)[0]).toBeCloseTo(70, 5)
    expect(groupPercents(out)[1]).toBeCloseTo(30, 5)
    expect(sum(out)).toBeCloseTo(100, 5)
  })
  it('scales three members', () => {
    const out = withServedShare([e('A'), e('B', T), e('C', T)], e('A'), 50)!
    const p = groupPercents(out)
    expect(p[0]).toBeCloseTo(50, 5)
    expect(p[1]).toBeCloseTo(25, 5)
    expect(p[2]).toBeCloseTo(25, 5)
  })
  it('starts from the read percents when a member has no share', () => {
    const out = withServedShare([e('A', { share: 60 }), e('B', { ...T, share: 30 }), e('C', T)], e('C'), 50)!
    const p = groupPercents(out)
    expect(p[0]).toBeCloseTo(33.3, 0)
    expect(p[1]).toBeCloseTo(16.7, 0)
    expect(p[2]).toBeCloseTo(50, 5)
  })
  it('is a no-op for an unedited group, a lone line and bad percents', () => {
    const pair = [e('A'), e('B', T)]
    expect(withServedShare(pair, e('A'), 50)).toBeUndefined()
    expect(withServedShare([e('A'), e('B')], e('A'), 30)).toBeUndefined()
    for (const bad of [0, 100, -1, NaN]) expect(withServedShare(pair, e('A'), bad)).toBeUndefined()
    expect(withServedShare(pair, e('Z'), 30)).toBeUndefined()
  })
  it('works on an extra member', () => {
    const out = withServedShare([e('A'), xt(T)], xt(), 25)!
    expect(groupPercents(out)[1]).toBeCloseTo(25, 5)
  })
})

describe('block-level removal with areas', () => {
  it('withoutServedConsumer removes the plain and the area entries', () => {
    const b = block('s', { servedOrder: { plate: [e('B', { areaId: 'x' }), e('B'), e('C'), xt()] } })
    expect(withoutServedConsumer(b, 'B').servedOrder).toStrictEqual({ plate: [e('C'), xt()] })
  })
  it('withoutServedAreas removes only the named areas', () => {
    const b = block('s', { servedOrder: { plate: [e('B', { areaId: 'x' }), e('B', { areaId: 'y' }), e('B'), e('C')] } })
    expect(withoutServedAreas(b, 'B', new Set(['x'])).servedOrder).toStrictEqual({ plate: [e('B', { areaId: 'y' }), e('B'), e('C')] })
  })
  it('drops an emptied list and returns the same block without a match', () => {
    const b = block('s', { servedOrder: { plate: [e('B', { areaId: 'x' })] } })
    expect('servedOrder' in withoutServedAreas(b, 'B', new Set(['x']))).toBe(false)
    expect(withoutServedAreas(b, 'B', new Set(['q']))).toBe(b)
    expect(withoutServedConsumer(b, 'Z')).toBe(b)
  })
})

describe('remapServedOrder with flags', () => {
  const ids = new Map([['a', 'a2'], ['b', 'b2']])
  const areas = new Map([['x', 'x2']])
  it('keeps tied, share and maps the area', () => {
    const out = remapServedOrder({ plate: [e('a', { areaId: 'x', share: 3 }), e('b', { ...T, share: 2 }), xt({ ...T, share: 1 })] }, ids, areas)
    expect(out).toStrictEqual({ plate: [e('a2', { areaId: 'x2', share: 3 }), e('b2', { ...T, share: 2 }), xt({ ...T, share: 1 })] })
  })
  it('drops an unmapped area or block and promotes', () => {
    expect(remapServedOrder({ plate: [e('a', { areaId: 'zz' }), e('b', T), e('c')] }, ids, areas)).toStrictEqual({ plate: [e('b2')] })
    expect(remapServedOrder({ plate: [e('ghost'), e('b', T)] }, ids, areas)).toStrictEqual({ plate: [e('b2')] })
  })
})

describe('the canonical invariant', () => {
  it('holds after random edits', () => {
    let seed = 12345
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    const names = ['a', 'b', 'c', 'd', 'f']
    const pick = (list: ServedEntry[]) => list[rnd(list.length)]
    let list: ServedEntry[] = canonicalServedList([e('a'), e('b', T), e('c', T), e('d'), xt()])
    for (let i = 0; i < 400; i++) {
      let next: ServedEntry[] | undefined
      const op = rnd(5)
      if (op === 0) next = withServedEntryPlaced(list, list.length > 0 && rnd(2) ? pick(list) : e(names[rnd(5)]), list.length > 0 && rnd(3) ? pick(list) : null)
      else if (op === 1 && list.length > 0) next = withServedTied(list, pick(list), rnd(2) === 0)
      else if (op === 2 && list.length > 0) next = withServedShare(list, pick(list), 1 + rnd(98))
      else if (op === 3 && list.length > 0) { const d = pick(list); next = dropServedEntries(list, x => sameServedEntry(x, d)) }
      else {
        const fresh = e(names[rnd(5)])
        if (!list.some(x => sameServedEntry(x, fresh))) next = withServedEntryInserted(list, fresh, rnd(list.length + 1))
      }
      if (next !== undefined) {
        expect(isCanonicalServedList(next), `step ${i} op ${op}`).toBe(true)
        list = next
      }
    }
  })
})
