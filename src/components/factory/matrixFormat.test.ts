import { describe, it, expect } from 'vitest'
import { fmtAmount, fmtAmountUnit, fmtSigned, fmtSignedUnit, tradeRateText } from './matrixFormat'

describe('matrixFormat items', () => {
  it('formats an amount, with "<0.01" for what rounds to zero', () => {
    expect(fmtAmount(60, 'min', false)).toBe('60.0')
    expect(fmtAmount(60, 'sec', false)).toBe('1.00')
    expect(fmtAmount(1e-9, 'min', false)).toBe('<0.01')
  })

  it('signs: plus for what is sent, a minus sign for what is received', () => {
    expect(fmtSigned(60, 'min', false)).toBe('+60.0')
    expect(fmtSigned(-60, 'min', false)).toBe('−60.0')
  })

  it('adds the unit suffix only in the unit variants', () => {
    expect(fmtAmountUnit(60, 'min', false)).toBe('60.0/m')
    expect(fmtAmountUnit(60, 'sec', false)).toBe('1.00/s')
    expect(fmtSignedUnit(-60, 'min', false)).toBe('−60.0/m')
  })
})

describe('matrixFormat energy', () => {
  it('shows power units whatever the rate unit', () => {
    expect(fmtAmount(600, 'min', true)).toBe('10.0MW')
    expect(fmtAmount(600, 'sec', true)).toBe('10.0MW')
  })

  it('signs a power value', () => {
    expect(fmtSigned(-2.52, 'min', true)).toBe('−42.0kW')
    expect(fmtSigned(600, 'sec', true)).toBe('+10.0MW')
  })

  it('reads "<1W" for what rounds to zero', () => {
    expect(fmtAmount(1e-6, 'min', true)).toBe('<1W')
  })

  it('does not add a suffix to the unit variants', () => {
    expect(fmtAmountUnit(600, 'min', true)).toBe('10.0MW')
    expect(fmtSignedUnit(600, 'sec', true)).toBe('+10.0MW')
  })
})

describe('tradeRateText', () => {
  it('shows items, energy, or both', () => {
    expect(tradeRateText(12, 0, 'min')).toBe('12.0/m')
    expect(tradeRateText(0, 600, 'min')).toBe('10.0MW')
    expect(tradeRateText(12, 600, 'min')).toBe('12.0/m + 10.0MW')
  })

  it('is empty when nothing moves', () => {
    expect(tradeRateText(0, 0, 'min')).toBe('')
  })
})
