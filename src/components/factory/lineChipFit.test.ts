import { describe, it, expect } from 'vitest'
import { lineChipFit, LINE_CHIP_SLOT } from './lineChipFit'

describe('lineChipFit', () => {
  it('shows every chip when they all fit, with no room kept for +N', () => {
    expect(lineChipFit(114, 3)).toBe(3)
    expect(lineChipFit(300, 0)).toBe(0)
  })

  it('keeps 34px for the +N button when some do not fit', () => {
    // 3 slots fit in 120px, 4 chips do not: (120 - 34) / 38 = 2 chips beside the button.
    expect(lineChipFit(120, 4)).toBe(2)
    expect(lineChipFit(300, 22)).toBe(7)
  })

  it('shows none when the button alone does not leave room for a chip', () => {
    expect(lineChipFit(60, 5)).toBe(0)
    expect(lineChipFit(0, 5)).toBe(0)
    expect(lineChipFit(-4, 5)).toBe(0)
  })

  it('uses the table\'s 38px slot (a 32px chip and 6px of margin)', () => {
    expect(LINE_CHIP_SLOT).toBe(32 + 6)
  })
})
