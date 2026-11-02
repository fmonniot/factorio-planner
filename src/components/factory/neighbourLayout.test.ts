import { describe, it, expect } from 'vitest'
import {
  rectangleAverage, tileNeighbours, foldAxis, findRectangle, formatAverage, MAX_SIDE,
} from './neighbourLayout'

describe('rectangleAverage', () => {
  it.each([
    [1, 1, 0],
    [1, 2, 1],
    [2, 2, 2],
    [2, 4, 2.5],
    [3, 3, 8 / 3],
    [5, 8, 3.35],
  ])('%i × %i gives %f', (cols, rows, expected) => {
    expect(rectangleAverage(cols, rows)).toBeCloseTo(expected, 10)
  })

  it('approaches 4 for a large grid', () => {
    const avg = rectangleAverage(MAX_SIDE, MAX_SIDE)
    expect(avg).toBeGreaterThan(3.8)
    expect(avg).toBeLessThan(4)
  })

  it('is symmetric', () => {
    expect(rectangleAverage(3, 7)).toBeCloseTo(rectangleAverage(7, 3), 12)
  })
})

describe('tileNeighbours', () => {
  it('counts 2 in a corner, 3 on an edge and 4 in the middle', () => {
    expect(tileNeighbours(0, 0, 3, 3)).toBe(2)
    expect(tileNeighbours(2, 2, 3, 3)).toBe(2)
    expect(tileNeighbours(1, 0, 3, 3)).toBe(3)
    expect(tileNeighbours(0, 1, 3, 3)).toBe(3)
    expect(tileNeighbours(1, 1, 3, 3)).toBe(4)
  })

  it('handles a 1-wide cluster', () => {
    expect(tileNeighbours(0, 0, 1, 4)).toBe(1)
    expect(tileNeighbours(0, 1, 1, 4)).toBe(2)
    expect(tileNeighbours(0, 3, 1, 4)).toBe(1)
    expect(tileNeighbours(0, 0, 1, 1)).toBe(0)
  })
})

describe('foldAxis', () => {
  it('renders short axes in full', () => {
    expect(foldAxis(1)).toEqual([0])
    expect(foldAxis(5)).toEqual([0, 1, 2, 3, 4])
  })

  it('folds longer axes into five tracks with a gap', () => {
    expect(foldAxis(6)).toEqual([0, 1, -1, 4, 5])
    expect(foldAxis(30)).toEqual([0, 1, -1, 28, 29])
  })
})

describe('findRectangle', () => {
  it('matches 0 to a lone reactor', () => {
    expect(findRectangle(0)).toEqual({ cols: 1, rows: 1 })
  })

  it('prefers cols ≤ rows', () => {
    expect(findRectangle(2.5)).toEqual({ cols: 2, rows: 4 })
    expect(findRectangle(3.35)).toEqual({ cols: 5, rows: 8 })
  })

  it('returns null when no rectangle gives the value', () => {
    expect(findRectangle(0.3)).toBeNull()
    expect(findRectangle(4)).toBeNull()
  })

  it('prefers the smallest area, then the most square', () => {
    // 3 = 3 × 6 (area 18) or 4 × 4 (area 16)
    expect(findRectangle(3)).toEqual({ cols: 4, rows: 4 })
    // 2 = 2 × 2 (area 4); 1 = 1 × 2
    expect(findRectangle(2)).toEqual({ cols: 2, rows: 2 })
    expect(findRectangle(1)).toEqual({ cols: 1, rows: 2 })
  })

  it('breaks an equal-area tie towards the squarer rectangle', () => {
    // 1 × n averages 2(n−1)/n; any value reachable by two same-area shapes would hit the
    // tie-break, so check the invariant over every rectangle instead.
    for (let cols = 1; cols <= 8; cols++) {
      for (let rows = cols; rows <= 8; rows++) {
        const found = findRectangle(rectangleAverage(cols, rows))!
        expect(found.cols * found.rows, `${cols} × ${rows}`).toBeLessThanOrEqual(cols * rows)
        expect(found.cols).toBeLessThanOrEqual(found.rows)
      }
    }
  })
})

describe('formatAverage', () => {
  it('trims to 2 decimals without trailing zeros', () => {
    expect(formatAverage(0)).toBe('0')
    expect(formatAverage(2.5)).toBe('2.5')
    expect(formatAverage(8 / 3)).toBe('2.67')
    expect(formatAverage(3.35)).toBe('3.35')
  })
})
