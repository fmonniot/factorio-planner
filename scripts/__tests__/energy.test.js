import { describe, it, expect } from 'vitest'
import { parseEnergyKj, parsePowerKw, inferEnergyType, energyDrainKw } from '../energy.js'

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

describe('inferEnergyType', () => {
  it('maps the energy source types', () => {
    expect(inferEnergyType({ energy_source: { type: 'electric' } })).toBe('electric')
    expect(inferEnergyType({ energy_source: { type: 'burner' } })).toBe('burner')
    expect(inferEnergyType({ energy_source: { type: 'heat' } })).toBe('heat')
  })

  it('tells a fluid source that burns fluid from one that does not', () => {
    expect(inferEnergyType({ energy_source: { type: 'fluid', burns_fluid: true } })).toBe('fluid-burner')
    expect(inferEnergyType({ energy_source: { type: 'fluid', burns_fluid: false } })).toBe('void')
    expect(inferEnergyType({ energy_source: { type: 'fluid' } })).toBe('void')
    expect(inferEnergyType({})).toBe('void')
  })
})

describe('energyDrainKw', () => {
  it('defaults an electric source without drain to energy_usage / 30', () => {
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'electric' } })).toBeCloseTo(3, 12)
    expect(energyDrainKw({ energy_usage: '1.5MW', energy_source: { type: 'electric' } })).toBeCloseTo(50, 12)
  })

  it('keeps an explicit drain, an explicit 0kW included', () => {
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'electric', drain: '0kW' } })).toBe(0)
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'electric', drain: '5kW' } })).toBe(5)
  })

  it('is 0 for an electric source without energy_usage', () => {
    expect(energyDrainKw({ energy_source: { type: 'electric' } })).toBe(0)
  })

  it('is 0 for any other source, whatever the usage', () => {
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'burner' } })).toBe(0)
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'heat' } })).toBe(0)
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'fluid', burns_fluid: true } })).toBe(0)
    expect(energyDrainKw({ energy_usage: '90kW', energy_source: { type: 'void' } })).toBe(0)
    expect(energyDrainKw({ energy_usage: '90kW' })).toBe(0)
  })
})
