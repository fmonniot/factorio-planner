import { describe, it, expect } from 'vitest'
import { MAX_NESTING_DEPTH } from '../../data/nesting'
import { groupRowBackground, groupRowTint, guideLevels, INGREDIENTS_PADDING_LEFT, treeGuideStyle } from './treeGuides'

describe('treeGuides', () => {
  it('draws no guide at the top level', () => {
    expect(treeGuideStyle(0)).toEqual({ paddingLeft: '8px' })
  })

  it('draws one 12px guide per level, each at its own offset', () => {
    const style = treeGuideStyle(2)
    expect(style.paddingLeft).toBe('32px')
    expect(style.backgroundPosition).toBe('8px 0,20px 0')
    expect(style.backgroundSize).toBe('1px 100%,1px 100%')
  })

  it('tightens the indent to 2px a level below 768px, so the machine stack fits under the recipe name', () => {
    const style = treeGuideStyle(2, true)
    expect(style.paddingLeft).toBe('12px')
    expect(style.backgroundPosition).toBe('8px 0,10px 0')
    expect(treeGuideStyle(0, true)).toEqual({ paddingLeft: '8px' })
    // 150px column: 8px + 4 levels of 2px + the 134px stack ends at the cell's right edge.
    expect(parseInt(String(treeGuideStyle(MAX_NESTING_DEPTH, true).paddingLeft)) + 134).toBeLessThanOrEqual(150)
  })

  it('stops growing at the nesting limit', () => {
    expect(guideLevels(MAX_NESTING_DEPTH + 3)).toBe(MAX_NESTING_DEPTH)
    expect(treeGuideStyle(MAX_NESTING_DEPTH + 3)).toEqual(treeGuideStyle(MAX_NESTING_DEPTH))
  })

  it('tints group rows darker with depth, and stops at the nesting limit', () => {
    const tints = Array.from({ length: MAX_NESTING_DEPTH }, (_, d) => groupRowTint(d))
    expect(new Set(tints).size).toBe(MAX_NESTING_DEPTH)
    expect(groupRowTint(MAX_NESTING_DEPTH + 3)).toBe(groupRowTint(MAX_NESTING_DEPTH))
  })

  it('bands an open group in teal whatever its depth, and leaves a collapsed one with its tint', () => {
    for (let d = 0; d <= MAX_NESTING_DEPTH + 1; d++) {
      expect(groupRowBackground(d, true)).toBe('bg-teal-400/5')
      expect(groupRowBackground(d, false)).toBe(groupRowTint(d))
    }
  })

  it('indents the ingredients 28px past the cell padding', () => {
    expect(INGREDIENTS_PADDING_LEFT).toBe('36px')
  })
})
