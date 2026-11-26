import { describe, it, expect } from 'vitest'
import { listNavTarget } from './listNav'

describe('listNavTarget', () => {
  it('has nowhere to go in an empty list', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const) {
      expect(listNavTarget(0, -1, key, true), key).toBeNull()
    }
  })

  it('steps by one and stops at both ends without wrapping', () => {
    expect(listNavTarget(3, 0, 'ArrowDown', false)).toBe(1)
    expect(listNavTarget(3, 1, 'ArrowUp', false)).toBe(0)
    expect(listNavTarget(3, 2, 'ArrowDown', false), 'last item').toBeNull()
    expect(listNavTarget(3, 0, 'ArrowUp', false), 'first item').toBeNull()
  })

  it('wraps at both ends', () => {
    expect(listNavTarget(3, 2, 'ArrowDown', true)).toBe(0)
    expect(listNavTarget(3, 0, 'ArrowUp', true)).toBe(2)
  })

  it('enters the list from outside: Down and Home at the first item, Up and End at the last', () => {
    expect(listNavTarget(4, -1, 'ArrowDown', false)).toBe(0)
    expect(listNavTarget(4, -1, 'Home', false)).toBe(0)
    expect(listNavTarget(4, -1, 'ArrowUp', false)).toBe(3)
    expect(listNavTarget(4, -1, 'End', false)).toBe(3)
  })

  it('jumps to the ends with Home and End', () => {
    expect(listNavTarget(4, 2, 'Home', false)).toBe(0)
    expect(listNavTarget(4, 1, 'End', false)).toBe(3)
  })

  it('stays on a one-item list when wrapping', () => {
    expect(listNavTarget(1, 0, 'ArrowDown', true)).toBe(0)
    expect(listNavTarget(1, 0, 'ArrowUp', true)).toBe(0)
  })
})
