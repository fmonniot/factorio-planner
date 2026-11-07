import { describe, it, expect } from 'vitest'
import { fmtRate, fmtPower, fmtItemRate, fmtItemRateText, inputRateUnit } from './ItemTile'

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
