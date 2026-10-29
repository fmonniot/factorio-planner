import { describe, it, expect } from 'vitest'
import { parseEnergyKj, parsePowerKw } from '../energy.js'

describe('parseEnergyKj', () => {
  it('reads joule strings with SI prefixes', () => {
    expect(parseEnergyKj('4MJ')).toBe(4000)
    expect(parseEnergyKj('0.2kJ')).toBeCloseTo(0.2, 12)
    expect(parseEnergyKj('1.4641GJ')).toBeCloseTo(1464100, 6)
    expect(parseEnergyKj('500J')).toBe(0.5)
    expect(parseEnergyKj('1000YJ')).toBeCloseTo(1e24, -10)
  })

  it('reads a number as joules', () => {
    expect(parseEnergyKj(2000)).toBe(2)
  })

  it('returns 0 for watts and missing values', () => {
    expect(parseEnergyKj('60kW')).toBe(0)
    expect(parseEnergyKj(undefined)).toBe(0)
    expect(parseEnergyKj('')).toBe(0)
  })
})

describe('parsePowerKw', () => {
  it('reads watt strings', () => {
    expect(parsePowerKw('1.8MW')).toBe(1800)
    expect(parsePowerKw('60kW')).toBe(60)
  })

  it('reads joule strings as energy per tick', () => {
    expect(parsePowerKw('0.066666666666667MJ')).toBeCloseTo(4000, 6)
    expect(parsePowerKw('0.016666666666667MJ')).toBeCloseTo(1000, 6)
  })

  it('returns 0 for missing values', () => {
    expect(parsePowerKw(undefined)).toBe(0)
  })
})
