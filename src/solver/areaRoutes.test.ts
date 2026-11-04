import { describe, it, expect } from 'vitest'
import { itemRoutes, type RouteReceiver, type RouteSender } from './areaRoutes'
import { surplusTolerance } from './blockResult'

// Areas are indexed by table order. `other` defaults to everything the sender makes.
const snd = (area: number, rate: number, other = rate): RouteSender => ({ area, rate, other, tol: surplusTolerance(rate) })
const rcv = (area: number, rate: number, restricted = false, dedicatedIn = 0): RouteReceiver =>
  ({ area, rate, restricted, dedicatedIn, tol: surplusTolerance(rate) })

describe('itemRoutes', () => {
  it('pairs greedily in table order, not pro rata', () => {
    const s = [snd(0, 30), snd(1, 10)]
    const r = [rcv(2, 20), rcv(3, 20)]
    expect(itemRoutes(s, r)).toEqual([
      { from: 0, to: 2, rate: 20 },
      { from: 0, to: 3, rate: 10 },
      { from: 1, to: 3, rate: 10 },
    ])
  })

  it('keeps a restricted receiver off other areas dedicated output', () => {
    // R (1) has its own row; C (3) makes 40 dedicated; A (2) makes 20 as a byproduct; U (4) is unrestricted.
    const s = [snd(2, 20), snd(3, 40, 0)]
    const r = [rcv(1, 20, true, 0), rcv(4, 30)]
    expect(itemRoutes(s, r)).toEqual([
      { from: 2, to: 1, rate: 20 },
      { from: 3, to: 4, rate: 30 },
      { from: 3, rate: 10 },
    ])
  })

  it('lets a restricted receiver take its allowed shortfall from dedicated output first', () => {
    const s = [snd(0, 30, 0), snd(2, 20)]
    const r = [rcv(1, 15, true, 5)]
    const routes = itemRoutes(s, r)
    const into = (from: number) => routes.find(x => x.from === from && x.to === 1)?.rate
    expect(into(0)).toBeCloseTo(5)
    expect(into(2)).toBeCloseTo(10)
  })

  it('serves a restricted receiver from the outside import after area senders', () => {
    const s = [snd(0, 5)]
    const r = [rcv(1, 12, true, 0), rcv(2, 3)]
    const routes = itemRoutes(s, r)
    expect(routes).toEqual([
      { from: 0, to: 1, rate: 5 },
      { to: 1, rate: 7 },
      { to: 2, rate: 3 },
    ])
  })

  it('falls back to what is left and still balances', () => {
    // The only supply is dedicated and the receiver may take none of it.
    const s = [snd(0, 10, 0), snd(1, 5, 0)]
    const r = [rcv(2, 15, true, 0)]
    const routes = itemRoutes(s, r)
    expect(routes.reduce((n, x) => n + x.rate, 0)).toBeCloseTo(15)
    expect(routes.filter(x => x.from === 0).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(10)
    expect(routes.filter(x => x.from === 1).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(5)
    expect(routes.every(x => x.to === 2)).toBe(true)
  })

  it('gives no outside leg for a residual within tolerance', () => {
    const s = [snd(0, 10 + 1e-9)]
    const r = [rcv(1, 10)]
    const routes = itemRoutes(s, r)
    expect(routes).toEqual([{ from: 0, to: 1, rate: 10 }])
  })

  it('sends a surplus to the outside, last', () => {
    const s = [snd(0, 40)]
    const r = [rcv(1, 10)]
    expect(itemRoutes(s, r)).toEqual([{ from: 0, to: 1, rate: 10 }, { from: 0, rate: 30 }])
  })

  it('is deterministic', () => {
    const s = [snd(0, 33.3, 12), snd(1, 7.1), snd(4, 3, 0)]
    const r = [rcv(2, 11.9, true, 2), rcv(3, 20.2), rcv(5, 8.3)]
    expect(itemRoutes(s, r)).toEqual(itemRoutes(s, r))
  })

  it('keeps a small area whole send when the item totals are huge', () => {
    // block tolerance 1e-8 x 1e6 = 1e-2, the small area's own is 1e-6
    const s = [snd(0, 1e6), snd(1, 0.005)]
    const r = [rcv(2, 1e6), rcv(3, 0.005)]
    const routes = itemRoutes(s, r)
    expect(routes.filter(l => l.from === 1).reduce((n, l) => n + l.rate, 0)).toBeCloseTo(0.005, 9)
  })
})
