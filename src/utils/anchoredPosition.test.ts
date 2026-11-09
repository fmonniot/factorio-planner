import { describe, it, expect } from 'vitest'
import { anchoredBelow, anchoredPosition } from './anchoredPosition'

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

describe('anchoredBelow', () => {
  it('goes under the anchor, 16px to the left of it', () => {
    expect(anchoredBelow(anchor, size, viewport)).toEqual({ left: 184, top: 144 })
  })
  it('flips above the anchor when it does not fit below', () => {
    const a = { left: 200, top: 560, right: 232, bottom: 592 }
    expect(anchoredBelow(a, size, viewport)).toEqual({ left: 184, top: 560 - 4 - 50 })
  })
  it('takes the side with more room and a height limit when it fits neither above nor below, never covering the anchor', () => {
    // Little room above (8px), 536px below: under the anchor, limited to the room.
    const a = { left: 200, top: 20, right: 232, bottom: 52 }
    expect(anchoredBelow(a, { width: 100, height: 570 }, viewport)).toEqual({ left: 184, top: 52 + 4, maxHeight: 600 - 8 - (52 + 4) })
    // A short landscape screen, the anchor low: more room above than below, so the popup sits above, from the margin down.
    const short = { width: 800, height: 300 }
    const low = { left: 200, top: 200, right: 232, bottom: 232 }
    const placed = anchoredBelow(low, { width: 100, height: 400 }, short)
    expect(placed).toEqual({ left: 184, top: 8, maxHeight: 200 - 4 - 8 })
    expect(placed.top + placed.maxHeight!).toBeLessThanOrEqual(low.top)
    // More room below: under the anchor.
    const high = { left: 200, top: 20, right: 232, bottom: 52 }
    const below = anchoredBelow(high, { width: 100, height: 400 }, short)
    expect(below.top).toBeGreaterThanOrEqual(high.bottom)
    expect(below.top + below.maxHeight!).toBeLessThanOrEqual(short.height - 8)
  })
  it('sets no height limit when it fits', () => {
    expect(anchoredBelow(anchor, size, viewport).maxHeight).toBeUndefined()
    expect(anchoredBelow({ left: 200, top: 560, right: 232, bottom: 592 }, size, viewport).maxHeight).toBeUndefined()
  })
  it('stays inside the viewport horizontally', () => {
    expect(anchoredBelow({ left: 5, top: 100, right: 37, bottom: 132 }, size, viewport).left).toBe(8)
    expect(anchoredBelow({ left: 990, top: 100, right: 1022, bottom: 132 }, size, viewport).left).toBe(1000 - 100 - 8)
  })
})
