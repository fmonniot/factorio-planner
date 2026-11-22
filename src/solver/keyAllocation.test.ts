import { describe, it, expect } from 'vitest'
import { allocateKeys, maxFit, type AllocKey, type AllocMember } from './keyAllocation'
import { waterFill } from './servedRank'

const key = (tag: AllocKey['tag'], offer: number, versatility: number): AllocKey => ({ key: `steam${'at' in tag ? `@${tag.at}` : '[?]'}`, tag, offer, versatility })
const at500 = (offer: number) => key({ at: 500 }, offer, 2)
const at165 = (offer: number) => key({ at: 165 }, offer, 1)
const any: AllocMember['needs'][number]['range'] = {}
const ge465 = { min: 465 }
const grant = (a: ReturnType<typeof allocateKeys>, member: string, k: string) => Math.round((a.grants.get(member)?.get(k) ?? 0) * 1e6) / 1e6

describe('allocateKeys', () => {
  it('one key and no range constraint gives what waterFill gives (weights)', () => {
    const a = allocateKeys('steam', [key({ at: 500 }, 45, 1)], [[
      { id: 'a', needs: [{ range: any, rate: 30 }], weight: 1 },
      { id: 'b', needs: [{ range: any, rate: 20 }], weight: 1 },
      { id: 'c', needs: [{ range: any, rate: 10 }], weight: 2 },
    ]])
    const expected = waterFill(45, [30, 20, 10], [1, 1, 2])
    for (const [i, id] of ['a', 'b', 'c'].entries()) expect(grant(a, id, 'steam@500')).toBeCloseTo(expected[i], 5)
  })

  it('one key, no weights (room 100, shares 10, 50, 50)', () => {
    const a = allocateKeys('steam', [key({ at: 500 }, 100, 1)], [[
      { id: 'a', needs: [{ range: any, rate: 10 }], weight: 1 },
      { id: 'b', needs: [{ range: any, rate: 50 }], weight: 1 },
      { id: 'c', needs: [{ range: any, rate: 50 }], weight: 1 },
    ]])
    const expected = waterFill(100, [10, 50, 50])
    for (const [i, id] of ['a', 'b', 'c'].entries()) expect(grant(a, id, 'steam@500')).toBeCloseTo(expected[i], 5)
  })

  it('27 a: C1 (any) ranked first leaves the 500 steam to C2 (>= 465)', () => {
    const a = allocateKeys('steam', [at500(1800), at165(1800)], [
      [{ id: 'C1', needs: [{ range: any, rate: 1800 }], weight: 1 }],
      [{ id: 'C2', needs: [{ range: ge465, rate: 1800 }], weight: 1 }],
    ])
    expect(grant(a, 'C1', 'steam@165')).toBeCloseTo(1800, 4)
    expect(grant(a, 'C1', 'steam@500')).toBeCloseTo(0, 4)
    expect(grant(a, 'C2', 'steam@500')).toBeCloseTo(1800, 4)
    expect(a.held.get('steam@500')).toBeCloseTo(1800, 4)
    expect(a.covered.get('C2')?.get('steam[465,]')).toBeCloseTo(1800, 4)
  })

  it('27 b: 900 at 165: C1 takes 900 of each, C2 the other 900 at 500', () => {
    const a = allocateKeys('steam', [at500(1800), at165(900)], [
      [{ id: 'C1', needs: [{ range: any, rate: 1800 }], weight: 1 }],
      [{ id: 'C2', needs: [{ range: ge465, rate: 1800 }], weight: 1 }],
    ])
    expect(grant(a, 'C1', 'steam@165')).toBeCloseTo(900, 4)
    expect(grant(a, 'C1', 'steam@500')).toBeCloseTo(900, 4)
    expect(grant(a, 'C2', 'steam@500')).toBeCloseTo(900, 4)
  })

  it('27 d: tied 50/50, 1350 each', () => {
    const a = allocateKeys('steam', [at500(1800), at165(900)], [[
      { id: 'C1', needs: [{ range: any, rate: 1800 }], weight: 1 },
      { id: 'C2', needs: [{ range: ge465, rate: 1800 }], weight: 1 },
    ]])
    expect(grant(a, 'C1', 'steam@165')).toBeCloseTo(900, 4)
    expect(grant(a, 'C1', 'steam@500')).toBeCloseTo(450, 4)
    expect(grant(a, 'C2', 'steam@500')).toBeCloseTo(1350, 4)
  })

  it('the extra is a member on any temperature', () => {
    const a = allocateKeys('steam', [at165(100)], [
      [{ id: 'extra', needs: [{ range: any, rate: 60 }], weight: 1 }],
      [{ id: 'C1', needs: [{ range: any, rate: 100 }], weight: 1 }],
    ])
    expect(grant(a, 'extra', 'steam@165')).toBeCloseTo(60, 4)
    expect(grant(a, 'C1', 'steam@165')).toBeCloseTo(40, 4)
  })

  it('a cap binds', () => {
    const a = allocateKeys('steam', [at500(1000)], [[{ id: 'C1', needs: [{ range: any, rate: 800 }], cap: 300, weight: 1 }]])
    expect(grant(a, 'C1', 'steam@500')).toBeCloseTo(300, 4)
  })

  it('an empty group and zero offers allocate nothing', () => {
    expect(allocateKeys('steam', [at500(100)], []).held.size).toBe(0)
    const a = allocateKeys('steam', [at500(0)], [[{ id: 'C1', needs: [{ range: any, rate: 5 }], weight: 1 }]])
    expect(grant(a, 'C1', 'steam@500')).toBe(0)
    const b = allocateKeys('steam', [at500(10)], [[{ id: 'C1', needs: [], weight: 1 }]])
    expect(grant(b, 'C1', 'steam@500')).toBe(0)
  })
})

describe('maxFit', () => {
  it('a key only serves a range it fits', () => {
    expect(maxFit([at165(1800)], [{ range: ge465, rate: 1800 }])).toBe(0)
    expect(maxFit([at500(1000), at165(1000)], [{ range: ge465, rate: 1800 }])).toBeCloseTo(1000, 4)
    expect(maxFit([at500(1000), at165(1000)], [{ range: ge465, rate: 1800 }, { range: any, rate: 1500 }])).toBeCloseTo(2000, 4)
  })
})

describe('allocateKeys, review findings', () => {
  it('a short supply covers the narrowest range first, as the consumer\'s own solve does', () => {
    // C needs 900 at any temperature and 900 at 465 or more; A offers 900 at 500 only. Put on `[,]` the 500 steam would leave the
    // `>= 465` need open (C would ask for 465 steam it does not need); C's solve sends it to `>= 465`.
    for (const needs of [[{ range: any, rate: 900 }, { range: ge465, rate: 900 }], [{ range: ge465, rate: 900 }, { range: any, rate: 900 }]]) {
      const a = allocateKeys('steam', [at500(900)], [[{ id: 'C', needs, weight: 1 }]])
      expect(a.covered.get('C')?.get('steam[465,]')).toBeCloseTo(900, 4)
      expect(a.covered.get('C')?.get('steam[,]') ?? 0).toBeCloseTo(0, 4)
    }
  })

  it('a wide fluid (9 keys x 6 ranges, several groups) keeps every level: no group freezes at 0 and the leftover goes by rank', () => {
    const temps = [15, 100, 165, 250, 300, 400, 500, 600, 800]
    const keys: AllocKey[] = temps.map((t, i) => ({ key: `steam@${t}`, tag: { at: t }, offer: 1000 + 37.3 * i, versatility: 1 + (i % 4) }))
    const ranges = [{}, { min: 100 }, { min: 300 }, { min: 465 }, { max: 400 }, { min: 100, max: 500 }]
    const member = (id: string, rate: number): AllocMember => ({ id, needs: ranges.map((range, i) => ({ range, rate: rate * (1 + i / 7) })), weight: 1 })
    const a = allocateKeys('steam', keys, [[member('g1a', 33.3), member('g1b', 41.7)], [member('g2', 123.4567)], [member('g3', 150.1)], [member('g4', 3000.3)]])
    const total = (id: string) => [...(a.grants.get(id)?.values() ?? [])].reduce((t, v) => t + v, 0)
    const offered = keys.reduce((t, k) => t + k.offer, 0)
    // The offers cover the first three groups in full; the last gets what is left, not 0.
    expect(total('g1a') + total('g1b') + total('g2') + total('g3') + total('g4')).toBeCloseTo(offered, 3)
    expect(total('g4')).toBeGreaterThan(0)
    expect(total('g2')).toBeCloseTo(123.4567 * (6 + 15 / 7), 3)
    for (const k of keys) expect(a.held.get(k.key) ?? 0).toBeLessThanOrEqual(k.offer + 1e-9)
  })

  it('the need met never exceeds what a key offers (the clamp scales the need met with the grants)', () => {
    const a = allocateKeys('steam', [at500(100)], [[{ id: 'C', needs: [{ range: ge465, rate: 500 }], weight: 1 }]])
    expect(a.covered.get('C')?.get('steam[465,]')).toBeCloseTo(a.grants.get('C')?.get('steam@500') ?? -1, 9)
    expect(a.covered.get('C')?.get('steam[465,]') ?? 0).toBeLessThanOrEqual(100 + 1e-9)
  })
})
