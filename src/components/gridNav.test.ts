import { describe, it, expect } from 'vitest'
import { gridNavTarget, type Box } from './gridNav'

/** `count` 36x36 boxes in `cols` columns. */
function layout(cols: number, count: number, pitch = 40, rowGap = 0): Box[] {
  return Array.from({ length: count }, (_, i) => ({
    left: (i % cols) * pitch,
    top: Math.floor(i / cols) * (36 + rowGap + 4),
    width: 36,
    height: 36,
  }))
}

describe('gridNavTarget', () => {
  it('moves Left and Right in reading order, wrapping over rows, and stops at the ends', () => {
    const boxes = layout(3, 8)
    expect(gridNavTarget(boxes, 0, 'ArrowRight')).toBe(1)
    expect(gridNavTarget(boxes, 2, 'ArrowRight')).toBe(3)
    expect(gridNavTarget(boxes, 7, 'ArrowRight')).toBeNull()
    expect(gridNavTarget(boxes, 3, 'ArrowLeft')).toBe(2)
    expect(gridNavTarget(boxes, 0, 'ArrowLeft')).toBeNull()
  })

  it('moves Up and Down to the nearest slot of the adjacent row, including a short last row', () => {
    const boxes = layout(3, 8)
    expect(gridNavTarget(boxes, 1, 'ArrowDown')).toBe(4)
    expect(gridNavTarget(boxes, 2, 'ArrowDown')).toBe(5)
    expect(gridNavTarget(boxes, 4, 'ArrowDown')).toBe(7)
    expect(gridNavTarget(boxes, 5, 'ArrowDown')).toBe(7)
    expect(gridNavTarget(boxes, 7, 'ArrowUp')).toBe(4)
    expect(gridNavTarget(boxes, 4, 'ArrowUp')).toBe(1)
  })

  it('has no target above the first row or below the last', () => {
    const boxes = layout(3, 8)
    expect(gridNavTarget(boxes, 1, 'ArrowUp')).toBeNull()
    expect(gridNavTarget(boxes, 7, 'ArrowDown')).toBeNull()
  })

  it('still reaches the adjacent row across a larger gap, as between subgroups', () => {
    const boxes = layout(3, 6, 40, 20)
    expect(gridNavTarget(boxes, 1, 'ArrowDown')).toBe(4)
    expect(gridNavTarget(boxes, 4, 'ArrowUp')).toBe(1)
  })

  it('treats a 1px jitter in top as the same row', () => {
    const boxes = layout(3, 6)
    boxes[1] = { ...boxes[1], top: boxes[1].top + 1 }
    expect(gridNavTarget(boxes, 0, 'ArrowDown')).toBe(3)
    expect(gridNavTarget(boxes, 3, 'ArrowUp')).toBe(0)
  })

  it('has no target in an empty or single-slot list', () => {
    expect(gridNavTarget([], 0, 'ArrowDown')).toBeNull()
    const one = layout(1, 1)
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const) {
      expect(gridNavTarget(one, 0, key)).toBeNull()
    }
  })

  it('has no Up or Down target when boxes have no size', () => {
    const boxes: Box[] = Array.from({ length: 4 }, () => ({ left: 0, top: 0, width: 0, height: 0 }))
    expect(gridNavTarget(boxes, 0, 'ArrowDown')).toBeNull()
    expect(gridNavTarget(boxes, 3, 'ArrowUp')).toBeNull()
  })
})
