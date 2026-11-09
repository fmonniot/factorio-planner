import { describe, it, expect } from 'vitest'
import { lineChipFit } from './lineChipFit'

describe('lineChipFit', () => {
  it('shows every chip when they all fit, with no room kept for +N', () => {
    expect(lineChipFit(90, 3)).toBe(3)
    expect(lineChipFit(300, 0)).toBe(0)
  })

  it('keeps 34px for the +N button when some do not fit', () => {
    // 3 slots fit in 100px, 4 chips do not: (100 - 34) / 30 = 2 chips beside the button.
    expect(lineChipFit(100, 4)).toBe(2)
    expect(lineChipFit(300, 22)).toBe(8)
  })

  it('shows none when the button alone does not leave room for a chip', () => {
    expect(lineChipFit(50, 5)).toBe(0)
    expect(lineChipFit(0, 5)).toBe(0)
    expect(lineChipFit(-4, 5)).toBe(0)
  })
})
