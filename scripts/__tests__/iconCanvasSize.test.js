import { describe, it, expect } from 'vitest'
import { iconCanvasSize } from '../icon-compositor.js'

describe('iconCanvasSize', () => {
  it('uses the prototype icon_size when given', () => {
    expect(iconCanvasSize({ icon_size: 128, icons: [{ icon_size: 256, scale: 1 }] }))
      .toEqual({ outputSize: 128, expectedSize: 128 })
  })

  it('keeps 64 for items whose layers fit', () => {
    expect(iconCanvasSize({ type: 'item', icons: [{ icon_size: 64, scale: 0.5 }, { icon_size: 64 }] }))
      .toEqual({ outputSize: 64, expectedSize: 64 })
  })

  it('grows for an item layer larger than 64 px', () => {
    expect(iconCanvasSize({ type: 'item', icons: [{ icon_size: 128, scale: 1 }] }).outputSize).toBe(128)
  })

  it('does not let unscaled layers shrink or grow the canvas, and expects 256 for technologies', () => {
    // belt-immunity-equipment: 256x- | 128x0.5
    const layers = [{ icon_size: 256 }, { icon_size: 128, scale: 0.5, shift: [50, 50] }]
    expect(iconCanvasSize({ type: 'technology', icons: layers })).toEqual({ outputSize: 256, expectedSize: 256 })
    expect(iconCanvasSize({ type: 'item', icons: layers })).toEqual({ outputSize: 64, expectedSize: 64 })
  })
})
