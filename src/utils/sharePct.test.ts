import { describe, it, expect } from 'vitest'
import { formatSharePct, parseSharePct } from './sharePct'

describe('formatSharePct', () => {
  it.each([[0.4 / 100, '0.4'], [0.3, '30'], [0.997, '99.7'], [0.125, '12.5'], [0.5, '50']])('%s -> %s', (v, s) => {
    expect(formatSharePct(v)).toBe(s)
  })
  it('output is always accepted by the parser', () => {
    for (const v of [0.004, 0.3, 0.997, 0.5]) expect(parseSharePct(formatSharePct(v))).not.toBeNull()
  })
})

describe('parseSharePct', () => {
  it.each([['30', 30], [' 12.5 ', 12.5], ['0.4', 0.4]])('%s accepted', (raw, v) => {
    expect(parseSharePct(raw)).toBe(v)
  })
  it.each(['12,5', '30abc', '', '  ', '0', '100', '150', '-5', 'abc', 'Infinity'])('%j rejected', raw => {
    expect(parseSharePct(raw)).toBeNull()
  })
  it('null (cancel) rejected', () => expect(parseSharePct(null)).toBeNull())
})
