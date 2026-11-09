import { describe, it, expect } from 'vitest'
import { fmtRate, fmtPower, fmtItemRate, fmtItemRateText, inputRateUnit, chipFmt, fmtChipQuantity } from './ItemTile'

// ---------------------------------------------------------------------------
// fmtRate
// ---------------------------------------------------------------------------

describe('fmtPower', () => {
  it('formats sub-kW values in W', () => {
    expect(fmtPower(0.5)).toEqual({ value: '500', unit: 'W' })
  })

  it('formats kW range', () => {
    expect(fmtPower(1)).toEqual({ value: '1.0', unit: 'kW' })
    expect(fmtPower(180)).toEqual({ value: '180.0', unit: 'kW' })
    expect(fmtPower(999)).toEqual({ value: '999.0', unit: 'kW' })
  })

  it('formats MW range', () => {
    expect(fmtPower(1000)).toEqual({ value: '1.0', unit: 'MW' })
    expect(fmtPower(2500)).toEqual({ value: '2.5', unit: 'MW' })
  })

  it('promotes the unit when rounding reaches 1000', () => {
    expect(fmtPower(0.9996)).toEqual({ value: '1.0', unit: 'kW' })
    expect(fmtPower(999.96)).toEqual({ value: '1.0', unit: 'MW' })
    expect(fmtPower(999_960)).toEqual({ value: '1.0', unit: 'GW' })
    expect(fmtPower(999.9)).toEqual({ value: '999.9', unit: 'kW' })
  })

  it('formats GW range', () => {
    expect(fmtPower(1_000_000)).toEqual({ value: '1.0', unit: 'GW' })
  })
})

describe('fmtRate', () => {
  it('keeps two significant digits for tiny non-zero rates', () => {
    expect(fmtRate(0.00082, 'sec')).toBe('0.00082')
    expect(fmtRate(0.0049, 'sec')).toBe('0.0049')
    expect(fmtRate(0.005, 'sec')).toBe('0.01')
    expect(fmtRate(0, 'sec')).toBe('0.00')
  })

  it('formats per-sec rates in /sec mode', () => {
    expect(fmtRate(1, 'sec')).toBe('1.00')
    expect(fmtRate(10, 'sec')).toBe('10.0')
    expect(fmtRate(100, 'sec')).toBe('100')
  })

  it('converts per-sec to per-min when unit is min', () => {
    expect(fmtRate(1, 'min')).toBe('60.0')
    expect(fmtRate(1 / 60, 'min')).toBe('1.00')
    expect(fmtRate(2, 'min')).toBe('120')
  })
})

describe('electricity rates', () => {
  it('formats electricity in power units, 1 unit/s being 1 MW', () => {
    expect(fmtItemRate('power:electricity', 10, 'min')).toEqual({ value: '10.0', unit: 'MW' })
    expect(fmtItemRate('power:electricity', 0.042, 'sec')).toEqual({ value: '42.0', unit: 'kW' })
    expect(fmtItemRateText('power:electricity', 10, 'sec')).toBe('10.0MW')
  })

  it('formats other items by the rate unit', () => {
    expect(fmtItemRate('iron-plate', 1, 'min')).toEqual({ value: '60.0', unit: '/m' })
    expect(fmtItemRate('iron-plate', 1, 'sec')).toEqual({ value: '1.00', unit: '/s' })
  })

  it('types electricity in MW (rate unit sec) and everything else in the current unit', () => {
    expect(inputRateUnit('power:electricity', 'min')).toBe('sec')
    expect(inputRateUnit('iron-plate', 'min')).toBe('min')
  })

  it('formats and types heat like electricity', () => {
    expect(fmtItemRate('power:heat', 21.6, 'min')).toEqual({ value: '21.6', unit: 'MW' })
    expect(inputRateUnit('power:heat', 'min')).toBe('sec')
  })
})

// Mirrors the replica's fmtCompact (artifact check "3 chipFmt").
describe('chipFmt', () => {
  it('rounds to whole thousands from 10 000', () => {
    expect(chipFmt(12360)).toBe('12k')
    expect(chipFmt(14100)).toBe('14k')
    expect(chipFmt(10000)).toBe('10k')
    expect(chipFmt(250000)).toBe('250k')
  })

  it('keeps one decimal from 1 000 and drops a trailing .0', () => {
    expect(chipFmt(1000)).toBe('1k')
    expect(chipFmt(1100)).toBe('1.1k')
    expect(chipFmt(9949)).toBe('9.9k')
    expect(chipFmt(9999.6)).toBe('10k')
  })

  it('has no decimals from 100, one decimal from 1', () => {
    expect(chipFmt(999)).toBe('999')
    expect(chipFmt(100)).toBe('100')
    expect(chipFmt(99.96)).toBe('100')
    expect(chipFmt(12.34)).toBe('12.3')
    expect(chipFmt(10)).toBe('10.0')
    expect(chipFmt(1)).toBe('1.0')
    expect(chipFmt(1.26)).toBe('1.3')
  })

  it('writes two decimals without the leading zero from 0.01, and <.01 below', () => {
    expect(chipFmt(0.5)).toBe('.50')
    expect(chipFmt(0.05)).toBe('.05')
    expect(chipFmt(0.01)).toBe('.01')
    expect(chipFmt(0.0099)).toBe('<.01')
    expect(chipFmt(0.0000016)).toBe('<.01')
  })

  it('writes an exact zero as 0', () => {
    expect(chipFmt(0)).toBe('0')
  })

  it('carries a rounding across a threshold into the next format', () => {
    expect(chipFmt(0.994)).toBe('.99')
    expect(chipFmt(0.996)).toBe('1.0')
    expect(chipFmt(0.9999)).toBe('1.0')
    expect(chipFmt(999.4)).toBe('999')
    expect(chipFmt(999.5)).toBe('1k')
    expect(chipFmt(999.99)).toBe('1k')
    expect(chipFmt(9.96)).toBe('10.0')
    expect(chipFmt(99999.6)).toBe('100k')
    expect(chipFmt(999499)).toBe('999k')
    expect(chipFmt(999500)).toBe('1M')
  })

  it('continues with M and G for huge values and caps at >999G', () => {
    expect(chipFmt(1e6)).toBe('1M')
    expect(chipFmt(1.26e6)).toBe('1.3M')
    expect(chipFmt(12.4e6)).toBe('12M')
    expect(chipFmt(999.4e6)).toBe('999M')
    expect(chipFmt(1e9)).toBe('1G')
    expect(chipFmt(45e9)).toBe('45G')
    expect(chipFmt(999.4e9)).toBe('999G')
    expect(chipFmt(999.5e9)).toBe('>999G')
    expect(chipFmt(1e15)).toBe('>999G')
    expect(chipFmt(Infinity)).toBe('>999G')
  })

  it('writes NaN and negative values as ? and not as a tiny rate', () => {
    expect(chipFmt(NaN)).toBe('?')
    expect(chipFmt(-3)).toBe('?')
    expect(chipFmt(-1e-12)).toBe('?')
    expect(chipFmt(-Infinity)).toBe('?')
  })

  it('never exceeds five characters', () => {
    for (const v of [0, 0.001, 0.0099, 0.01, 0.995, 0.9999, 1, 9.96, 10, 99.96, 100, 999.5, 999.96, 1000, 9999.6, 10000, 99999.6, 999999, 1e7, 1e9, 5e11, 1e13, 1e300, Infinity, NaN, -5]) {
      expect(chipFmt(v).length, String(v)).toBeLessThanOrEqual(5)
    }
  })
})

describe('fmtChipQuantity', () => {
  it('formats items in the rate unit through chipFmt, and leaves fmtRate alone', () => {
    expect(fmtChipQuantity('iron-plate', 1, 'min')).toBe('60.0')
    expect(fmtChipQuantity('iron-plate', 1, 'sec')).toBe('1.0')
    expect(fmtChipQuantity('iron-plate', 200, 'min')).toBe('12k')
    expect(fmtRate(200, 'min')).toBe('12000')
  })

  it('keeps electricity and heat in power units, without a decimal from 10 up', () => {
    expect(fmtChipQuantity('power:electricity', 10, 'min')).toBe('10MW')
    expect(fmtChipQuantity('power:electricity', 1.5, 'sec')).toBe('1.5MW')
    expect(fmtChipQuantity('power:heat', 0.042, 'sec')).toBe('42kW')
    expect(fmtChipQuantity('power:heat', 0.0042, 'sec')).toBe('4.2kW')
    expect(fmtChipQuantity('power:electricity', 0.1, 'sec')).toBe('100kW')
    expect(fmtChipQuantity('power:electricity', 0.0005, 'sec')).toBe('500W')
    expect(fmtChipQuantity('power:electricity', 0, 'sec')).toBe('0W')
    // The tooltip keeps the exact value.
    expect(fmtItemRateText('power:electricity', 10, 'min')).toBe('10.0MW')
  })

  it('carries a rounding across a power unit', () => {
    expect(fmtChipQuantity('power:electricity', 0.00099996, 'sec')).toBe('1.0kW')
    expect(fmtChipQuantity('power:electricity', 0.9996, 'sec')).toBe('1.0MW')
    expect(fmtChipQuantity('power:electricity', 999.96, 'sec')).toBe('1.0GW')
  })

  it('never exceeds five characters for electricity and heat', () => {
    for (const v of [0, 1e-9, 0.0004, 0.000999, 0.00099996, 0.0099, 0.00999, 0.0999, 0.1, 0.9996, 0.99996, 1, 9.96, 10, 99.96, 100, 999.5, 999.96, 1000, 1e4, 5e5, 1e12, Infinity, NaN, -1]) {
      expect(fmtChipQuantity('power:electricity', v, 'sec').length, String(v)).toBeLessThanOrEqual(5)
    }
  })
})
