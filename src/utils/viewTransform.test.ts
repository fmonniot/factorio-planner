import { describe, it, expect } from 'vitest'
import { zoomAt, panBy, fitTransform, transformCss, MAX_SCALE, MIN_SCALE, FIT_MIN_SCALE, wheelZoomFactor, wheelDeltaPx } from './viewTransform'

describe('zoomAt', () => {
  it('keeps the content point under the cursor fixed', () => {
    const t = { x: 30, y: -20, scale: 1 }
    const z = zoomAt(t, 1.5, 200, 100)
    expect((200 - z.x) / z.scale).toBeCloseTo((200 - t.x) / t.scale)
    expect((100 - z.y) / z.scale).toBeCloseTo((100 - t.y) / t.scale)
  })

  it('clamps to the maximum scale with the cursor point fixed', () => {
    const t = { x: 10, y: 10, scale: 1 }
    const z = zoomAt(t, 100, 50, 60)
    expect(z.scale).toBe(MAX_SCALE)
    expect((50 - z.x) / z.scale).toBeCloseTo((50 - t.x) / t.scale)
    expect((60 - z.y) / z.scale).toBeCloseTo((60 - t.y) / t.scale)
  })

  it('clamps to the minimum scale', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0.0001, 0, 0).scale).toBe(MIN_SCALE)
  })
})

describe('fitTransform', () => {
  it('scales down and centres', () => {
    expect(fitTransform(1000, 500, 524, 524, 12)).toEqual({ x: 12, y: 137, scale: 0.5 })
  })

  it('goes below MIN_SCALE so a very wide tree still fits', () => {
    const t = fitTransform(14816, 1000, 1280, 800)
    expect(t.scale).toBeLessThan(MIN_SCALE)
    expect(t.scale).toBeGreaterThanOrEqual(FIT_MIN_SCALE)
    expect(t.x).toBeGreaterThanOrEqual(0)
  })

  it('never scales above 1', () => {
    expect(fitTransform(100, 100, 1000, 1000).scale).toBe(1)
  })
})

describe('panBy and transformCss', () => {
  it('adds the offsets', () => {
    expect(panBy({ x: 1, y: 2, scale: 0.5 }, 10, -4)).toEqual({ x: 11, y: -2, scale: 0.5 })
  })

  it('formats the CSS transform', () => {
    expect(transformCss({ x: 5, y: -6, scale: 1.25 })).toBe('translate(5px, -6px) scale(1.25)')
  })
})

describe('wheelZoomFactor', () => {
  it('treats a line-mode notch like a larger pixel delta', () => {
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0))
    expect(wheelZoomFactor(3, 1)).toBeLessThan(wheelZoomFactor(3, 0))
  })

  it('zooms out for positive deltas and in for negative', () => {
    expect(wheelZoomFactor(100)).toBeLessThan(1)
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('clamps huge deltas per event', () => {
    expect(wheelZoomFactor(100000, 0)).toBe(wheelZoomFactor(200, 0))
    expect(wheelZoomFactor(-5, 2)).toBe(wheelZoomFactor(-200, 0))
  })
})

describe('wheelDeltaPx', () => {
  it('converts lines and pages to pixels and leaves pixels alone', () => {
    expect(wheelDeltaPx(3, 0)).toBe(3)
    expect(wheelDeltaPx(3)).toBe(3)
    expect(wheelDeltaPx(3, 1)).toBe(48)
    expect(wheelDeltaPx(-1, 2)).toBe(-400)
  })
})
