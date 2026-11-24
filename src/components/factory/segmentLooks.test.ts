import { describe, expect, it } from 'vitest'
import { lookOfLine, madeLook, segmentLook } from './segmentLooks'

describe('segmentLook', () => {
  it('draws an import share with diagonal stripes in the detail bar and the micro-bar', () => {
    const look = segmentLook('import', undefined)
    expect(look.bg).toContain('repeating-linear-gradient')
    expect(look.mini).toBe(look.bg)
    expect(look.bg).not.toBe(segmentLook('locked', undefined).bg)
  })
})

describe('madeLook', () => {
  it('is teal: a translucent fill, a stronger border and a solid mini colour', () => {
    const look = madeLook()
    expect(look.mini).toBe('#14b8a6')
    expect(look.bg).toContain('20, 184, 166')
    expect(look.borderStyle).toBe('solid')
    expect(look.border).not.toBe(look.bg)
  })
})

describe('lookOfLine', () => {
  it('draws a block line in its source colour, amber when limited', () => {
    expect(lookOfLine({ kind: 'block', color: '#112233', limited: false })).toEqual(segmentLook('source', '#112233', false))
    expect(lookOfLine({ kind: 'block', color: '#112233', limited: true }).border).toBe(segmentLook('source', '#112233', true).border)
  })
  it('maps the other kinds to made, import and short', () => {
    expect(lookOfLine({ kind: 'made' })).toEqual(madeLook())
    expect(lookOfLine({ kind: 'import' })).toEqual(segmentLook('import', undefined))
    expect(lookOfLine({ kind: 'missing' })).toEqual(segmentLook('short', undefined))
  })
})
