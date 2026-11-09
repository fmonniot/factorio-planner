import { describe, it, expect } from 'vitest'
import { chipsOnOneLine, chipsPerLine } from './oneLineChips'

describe('chipsPerLine', () => {
  it('counts 38px slots, the last without its gap: n chips need 38n - 6px', () => {
    expect(chipsPerLine(32)).toBe(1)
    expect(chipsPerLine(69)).toBe(1)
    expect(chipsPerLine(70)).toBe(2)
    expect(chipsPerLine(146)).toBe(4)
    expect(chipsPerLine(145)).toBe(3)
  })

  it('holds at least one chip, and says nothing about a box without width', () => {
    expect(chipsPerLine(10)).toBe(1)
    expect(chipsPerLine(0)).toBeNull()
    expect(chipsPerLine(Number.NaN)).toBeNull()
  })
})

describe('chipsOnOneLine', () => {
  it('shows every chip when they all fit, with no "+N"', () => {
    expect(chipsOnOneLine(5, 5, 8)).toBe(5)
    expect(chipsOnOneLine(3, 9, 8)).toBe(3)
    expect(chipsOnOneLine(0, 4, 8)).toBe(0)
  })

  it('shows one fewer than fits when some do not, the "+N" taking the last slot', () => {
    expect(chipsOnOneLine(6, 5, 8)).toBe(4)
    expect(chipsOnOneLine(20, 11, 16)).toBe(10)
  })

  it('can show only the "+N" on a line that holds one chip', () => {
    expect(chipsOnOneLine(3, 1, 8)).toBe(0)
  })

  it('counts the "+N" of the cap as a slot: chips past the cap are behind it too', () => {
    expect(chipsOnOneLine(9, 8, 8)).toBe(7)
    expect(chipsOnOneLine(9, 9, 8)).toBe(8)
    expect(chipsOnOneLine(9, 30, 8)).toBe(8)
  })

  it('draws the capped chips when the line is not measured', () => {
    expect(chipsOnOneLine(5, null, 8)).toBe(5)
    expect(chipsOnOneLine(20, null, 16)).toBe(16)
  })
})
