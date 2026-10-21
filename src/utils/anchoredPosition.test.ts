import { describe, it, expect } from 'vitest'
import { anchoredPosition } from './anchoredPosition'

const size = { width: 100, height: 50 }
const viewport = { width: 1000, height: 600 }
const anchor = { left: 200, top: 100, right: 300, bottom: 140 }

describe('anchoredPosition', () => {
  it('goes to the right of the anchor, top-aligned, when it fits', () => {
    expect(anchoredPosition(anchor, size, viewport)).toEqual({ left: 308, top: 100 })
  })
  it('flips to the left when the right side overflows', () => {
    const a = { left: 880, top: 100, right: 980, bottom: 140 }
    expect(anchoredPosition(a, size, viewport)).toEqual({ left: 772, top: 100 })
  })
  it('clamps the top near the bottom edge', () => {
    const a = { left: 200, top: 580, right: 300, bottom: 620 }
    expect(anchoredPosition(a, size, viewport).top).toBe(600 - 50 - 8)
  })
  it('uses the margin as top when taller than the viewport', () => {
    expect(anchoredPosition(anchor, { width: 100, height: 700 }, viewport).top).toBe(8)
  })
  it('keeps left within the margin when neither side fits', () => {
    const a = { left: 20, top: 100, right: 120, bottom: 140 }
    expect(anchoredPosition(a, size, { width: 150, height: 600 }).left).toBeGreaterThanOrEqual(8)
  })
})
