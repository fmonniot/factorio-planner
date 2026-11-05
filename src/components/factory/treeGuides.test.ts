import { describe, it, expect } from 'vitest'
import { MAX_NESTING_DEPTH } from '../../data/nesting'
import { guideLevels, treeGuideStyle } from './treeGuides'

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

  it('stops growing at the nesting limit', () => {
    expect(guideLevels(MAX_NESTING_DEPTH + 3)).toBe(MAX_NESTING_DEPTH)
    expect(treeGuideStyle(MAX_NESTING_DEPTH + 3)).toEqual(treeGuideStyle(MAX_NESTING_DEPTH))
  })
})
