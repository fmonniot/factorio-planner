import { describe, it, expect } from 'vitest'
import { insertionTarget } from './insertionTarget'

describe('insertionTarget', () => {
  it('is null when the drop point is just before or just after the item', () => {
    expect(insertionTarget(2, 2, 5)).toBeNull()
    expect(insertionTarget(2, 3, 5)).toBeNull()
  })
  it('moves earlier to the insertion index', () => {
    expect(insertionTarget(3, 0, 5)).toBe(0)
    expect(insertionTarget(3, 2, 5)).toBe(2)
  })
  it('moves later to the index after removal', () => {
    expect(insertionTarget(0, 5, 5)).toBe(4)
    expect(insertionTarget(1, 3, 5)).toBe(2)
  })
  it('clamps the insertion index', () => {
    expect(insertionTarget(0, 99, 3)).toBe(2)
    expect(insertionTarget(2, -4, 3)).toBe(0)
  })
  it('is null for an unknown item', () => {
    expect(insertionTarget(-1, 1, 3)).toBeNull()
    expect(insertionTarget(3, 1, 3)).toBeNull()
  })
})
