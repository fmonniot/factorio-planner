import { describe, it, expect } from 'vitest'
import {
  isServedConsumer, remapServedOrder, sameServedEntry, servedListOf, takesFrom,
  withoutServedConsumer, withServedEntryPlaced, withServedList,
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
  it('gives undefined for a missing anchor and for no change', () => {
    expect(withServedEntryPlaced(list, blk('a'), blk('ghost'))).toBeUndefined()
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
    expect(remapServedOrder({ plate: [blk('a'), blk('ghost'), extra], gear: [blk('ghost')] }, ids)).toEqual({ plate: [blk('a2'), extra] })
  })
  it('gives undefined when nothing is left', () => {
    expect(remapServedOrder({ plate: [blk('ghost')] }, ids)).toBeUndefined()
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
