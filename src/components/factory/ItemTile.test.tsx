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

  it('never exceeds five characters', () => {
    for (const v of [0, 0.001, 0.0099, 0.01, 0.995, 1, 9.96, 10, 99.96, 100, 999.5, 999.96, 1000, 9999.6, 10000, 99999.6, 999999]) {
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

  it('keeps electricity and heat in power units', () => {
    expect(fmtChipQuantity('power:electricity', 10, 'min')).toBe('10.0MW')
    expect(fmtChipQuantity('power:heat', 0.042, 'sec')).toBe('42.0kW')
  })
})
