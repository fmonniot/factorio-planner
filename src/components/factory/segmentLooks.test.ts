import { describe, expect, it } from 'vitest'
import { segmentLook } from './segmentLooks'

describe('segmentLook', () => {
  it('draws an import share with diagonal stripes in the detail bar and the micro-bar', () => {
    const look = segmentLook('import', undefined)
    expect(look.bg).toContain('repeating-linear-gradient')
    expect(look.mini).toBe(look.bg)
  })
})
