import { describe, expect, it } from 'vitest'
import type { AreaRoute, ServedConsumer } from '../data/types'
import { areaLines, areaNeedsOf, handOut, splitByArea, type AreaNeed, type PairEntries } from './servedAreas'
import type { RankedEntry } from './servedRank'

describe('areaNeedsOf', () => {
  it('keeps the outside legs into an area, per item, in table order', () => {
    const routes: AreaRoute[] = [
      { itemId: 'plate', from: 'P', to: 'Q', rate: 5 },
      { itemId: 'plate', to: 'Q', rate: 7 },
      { itemId: 'plate', to: 'R', rate: 8 },
      { itemId: 'plate', from: 'R', rate: 1 },
      { itemId: 'gear', to: 'Q', rate: 2 },
      { itemId: 'plate', to: 'S', rate: 1e-9 },
    ]
    const needs = areaNeedsOf(routes)!
    expect(needs.get('plate')).toEqual([{ areaId: 'Q', need: 7 }, { areaId: 'R', need: 8 }])
    expect(needs.get('gear')).toEqual([{ areaId: 'Q', need: 2 }])
  })
  it('is undefined for a block with no areas and empty for no routes', () => {
    expect(areaNeedsOf(undefined)).toBeUndefined()
    expect(areaNeedsOf([])!.size).toBe(0)
  })
})

describe('handOut', () => {
  it('hands the total to each target in turn, in index order, up to what the target allows', () => {
    expect(handOut(15, [[0, 0], [12, 8], [12, 8]])).toEqual([12, 3])
    expect(handOut(15, [[8, 7], [8, 12]])).toEqual([8, 7])
    expect(handOut(30, [[5, 5], [10, 10], [20, 20]])).toEqual([20, 10])
  })
  it('gives what no target takes to the last index', () => {
    expect(handOut(50, [[10, 10]])).toEqual([10, 40])
  })
  it('gives nothing from nothing', () => {
    expect(handOut(0, [[3, 3]])).toEqual([0, 0])
    expect(handOut(-5, [[3, 3]])).toEqual([0, 0])
  })
  it('stops at the grant when the share is below it', () => {
    expect(handOut(10, [[10], [4]])).toEqual([10])
  })
})

describe('splitByArea', () => {
  const needs: AreaNeed[] = [{ areaId: 'L', need: 12 }, { areaId: 'B', need: 8 }]
  const conn = (id: string) => ({ id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' })
  const entry = (blockId: string, areaId?: string): RankedEntry => ({ kind: 'block', blockId, connection: conn(blockId), ...(areaId ? { areaId } : {}) })
  const needsOf = (table: Record<string, AreaNeed[]>) => (id: string) => table[id] ?? []

  it('splits a block that has two needy areas and no area entry into one entry covering both', () => {
    const out = splitByArea([entry('H')], needsOf({ H: needs }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ areas: needs, total: 20, part: 1 })
  })
  it('gives a block entry the areas no area entry names', () => {
    const out = splitByArea([entry('H', 'B'), entry('H')], needsOf({ H: needs }))
    expect(out[0]).toMatchObject({ areaId: 'B', areas: [{ areaId: 'B', need: 8 }], total: 20 })
    expect(out[0].kind === 'block' && out[0].part).toBeCloseTo(0.4, 12)
    expect(out[1]).toMatchObject({ areas: [{ areaId: 'L', need: 12 }], total: 20 })
    expect(out[1].kind === 'block' && out[1].part).toBeCloseTo(0.6, 12)
  })
  it('leaves a block entry with nothing to cover as an inert zero entry', () => {
    const out = splitByArea([entry('H', 'L'), entry('H', 'B'), entry('H')], needsOf({ H: needs }))
    expect(out[2]).toMatchObject({ areas: [], part: 0 })
  })
  it('leaves a consumer with one needy area and no area entry untouched', () => {
    const out = splitByArea([entry('H')], needsOf({ H: [{ areaId: 'L', need: 20 }] }))
    expect(out[0]).toEqual(entry('H'))
    expect(out[0]).not.toHaveProperty('areas')
    expect(out[0]).not.toHaveProperty('part')
  })
  it('keeps an area entry that no longer needs the item as a zero entry', () => {
    const out = splitByArea([entry('H', 'L')], needsOf({ H: [] }))
    expect(out[0]).toMatchObject({ areaId: 'L', areas: [], part: 0 })
    const stale = splitByArea([entry('H', 'ghost'), entry('H')], needsOf({ H: needs }))
    expect(stale[0]).toMatchObject({ areaId: 'ghost', areas: [], part: 0 })
  })
  it('gives the only area entry the whole need and its block entry nothing', () => {
    const out = splitByArea([entry('H', 'L'), entry('H')], needsOf({ H: [{ areaId: 'L', need: 20 }] }))
    expect(out[0]).toMatchObject({ areas: [{ areaId: 'L', need: 20 }], part: 1 })
    expect(out[1]).toMatchObject({ areas: [], part: 0 })
  })
  it('leaves the extra and the other consumers untouched', () => {
    const extra: RankedEntry = { kind: 'extra' }
    const out = splitByArea([extra, entry('S'), entry('H')], needsOf({ H: needs }))
    expect(out[0]).toBe(extra)
    expect(out[1]).toEqual(entry('S'))
    expect(out[1]).not.toHaveProperty('areas')
  })
})

describe('areaLines', () => {
  const needs: Record<string, AreaNeed[]> = { H: [{ areaId: 'L', need: 12 }, { areaId: 'B', need: 8 }] }
  const needsOf = (id: string) => needs[id] ?? []
  const conn = (id: string) => ({ id: `c-${id}`, itemId: 'plate', fromBlockId: 'A' })
  const base = (blockId: string, share: number, got: number, over: Partial<ServedConsumer> = {}): ServedConsumer =>
    ({ blockId, connectionId: `c-${blockId}`, kind: 'request', share, got, ...over })
  const e = (blockId: string, extra: Partial<Extract<RankedEntry, { kind: 'block' }>> = {}): RankedEntry =>
    ({ kind: 'block', blockId, connection: conn(blockId), ...extra })
  const HB = e('H', { areaId: 'B', areas: [{ areaId: 'B', need: 8 }], total: 20, part: 0.4 })
  const HL = e('H', { areaId: 'L', areas: [{ areaId: 'L', need: 12 }], total: 20, part: 0.6 })
  const Hrest = e('H', { areas: [{ areaId: 'L', need: 12 }], total: 20, part: 0.6 })
  const view = (lines: ServedConsumer[]) => lines.map(l => [l.blockId, l.areaId, l.share, l.got])

  it('gives one line per entry, area lines with their share and part of the rate', () => {
    const ranked: PairEntries = { entries: [e('S'), HB, HL], granted: [30, 8, 7] }
    const out = areaLines('A', 'plate', [base('S', 30, 30), base('H', 20, 15)], ranked, needsOf)!
    expect(view(out.consumers)).toEqual([['S', undefined, 30, 30], ['H', 'B', 8, 8], ['H', 'L', 12, 7]])
    expect(out.extraPlace).toBe(3)
    expect(out.consumers[0]).not.toHaveProperty('areaId')
  })
  it('places the extra among the lines, and labels a block entry covering one area', () => {
    const ranked: PairEntries = { entries: [HB, { kind: 'extra' }, e('S'), Hrest], granted: [8, 0, 30, 7] }
    const out = areaLines('A', 'plate', [base('S', 30, 30), base('H', 20, 15)], ranked, needsOf)!
    expect(out.extraPlace).toBe(1)
    expect(view(out.consumers)).toEqual([['H', 'B', 8, 8], ['S', undefined, 30, 30], ['H', 'L', 12, 7]])
  })
  it('expands a pair with no list into the lines of a consumer with several needy areas', () => {
    const out = areaLines('A', 'plate', [base('S', 30, 30), base('H', 20, 15)], undefined, needsOf)!
    expect(view(out.consumers)).toEqual([['S', undefined, 30, 30], ['H', 'L', 12, 12], ['H', 'B', 8, 3]])
    expect(out.extraPlace).toBe(3)
  })
  it('returns undefined when no consumer is split', () => {
    expect(areaLines('A', 'plate', [base('S', 30, 30)], undefined, needsOf)).toBeUndefined()
    expect(areaLines('A', 'plate', [base('S', 30, 30)], { entries: [e('S')], granted: [30] }, needsOf)).toBeUndefined()
  })
  it('scales the need of a take by area and flags every line', () => {
    const ranked: PairEntries = { entries: [HB, HL], granted: [8, 7] }
    const take = base('H', 5, 15, { kind: 'take', need: 20, notCredited: true })
    const out = areaLines('A', 'plate', [take], ranked, needsOf)!
    expect(out.consumers.map(l => l.need)).toEqual([8, 12])
    expect(out.consumers.every(l => l.notCredited === true && l.kind === 'take')).toBe(true)
  })
  it('gives a rate above every target to the last line', () => {
    const ranked: PairEntries = { entries: [HB, HL], granted: [8, 12] }
    const out = areaLines('A', 'plate', [base('H', 20, 50)], ranked, needsOf)!
    expect(out.consumers.map(l => l.got)).toEqual([8, 42])
  })
})
