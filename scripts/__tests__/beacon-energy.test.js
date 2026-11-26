import { describe, it, expect } from 'vitest'
import { beaconEnergyField, attachBeaconEnergy, patchedBundle } from '../beacon-energy.js'

const electric = (usage, drain) => ({
  energy_usage: usage,
  energy_source: { type: 'electric', ...(drain ? { drain } : {}) },
})
const base = id => ({
  id, name: id, iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed'],
})

describe('beaconEnergyField', () => {
  it('reads the usage and drain of an electric beacon', () => {
    expect(beaconEnergyField(electric('480kW'))).toEqual({ energyUsageKw: 480, drainKw: 0 })
    expect(beaconEnergyField(electric('1.5MW'))).toEqual({ energyUsageKw: 1500, drainKw: 0 })
    expect(beaconEnergyField(electric('480kW', '16kW'))).toEqual({ energyUsageKw: 480, drainKw: 16 })
  })

  it('is empty for a void or burner beacon', () => {
    expect(beaconEnergyField({ energy_usage: '480kW', energy_source: { type: 'void' } })).toEqual({})
    expect(beaconEnergyField({ energy_usage: '480kW', energy_source: { type: 'burner' } })).toEqual({})
  })

  it('reads a missing energy_usage as 0', () => {
    expect(beaconEnergyField({ energy_source: { type: 'electric' } })).toEqual({ energyUsageKw: 0, drainKw: 0 })
  })
})

describe('attachBeaconEnergy', () => {
  const raw = () => ({ beacon: { b: electric('480kW'), v: { energy_usage: '1MW', energy_source: { type: 'void' } } } })

  it('adds the fields, leaves a void beacon without, and counts both', () => {
    const r = attachBeaconEnergy({ b: base('b'), v: base('v') }, raw())
    expect(r.beacons.b).toEqual({ ...base('b'), energyUsageKw: 480, drainKw: 0 })
    expect(Object.keys(r.beacons.b).slice(-2)).toEqual(['energyUsageKw', 'drainKw'])
    expect(r.beacons.v).toEqual(base('v'))
    expect(r.counts).toEqual({ electric: 1, void: 1 })
    expect(r.total).toBe(2)
    expect(r.missing).toEqual([])
  })

  it('strips stale fields from a beacon that is now void', () => {
    const r = attachBeaconEnergy({ v: { ...base('v'), energyUsageKw: 9, drainKw: 1 } }, raw())
    expect(r.beacons.v).toEqual(base('v'))
  })

  it('lists a beacon missing from the dump and keeps its entry', () => {
    const gone = { ...base('gone'), energyUsageKw: 5, drainKw: 0 }
    const r = attachBeaconEnergy({ gone }, raw())
    expect(r.missing).toEqual(['gone'])
    expect(r.beacons.gone).toBe(gone)
  })

  it('returns the same references on a second run', () => {
    const first = attachBeaconEnergy({ b: base('b'), v: base('v') }, raw())
    const second = attachBeaconEnergy(first.beacons, raw())
    expect(second.beacons).toBe(first.beacons)
    expect(second.beacons.b).toBe(first.beacons.b)
  })
})

describe('patchedBundle', () => {
  const strip = beacons => Object.fromEntries(Object.entries(beacons).map(([id, b]) => {
    const { energyUsageKw: _u, drainKw: _d, ...rest } = b
    return [id, rest]
  }))

  it('touches only beacons, keeping the key order', () => {
    const existing = { factorioVersion: '2.0', machines: { m: 1 }, beacons: { b: base('b') }, items: {} }
    const out = patchedBundle(existing, attachBeaconEnergy(existing.beacons, { beacon: { b: electric('480kW') } }))
    expect(Object.keys(out)).toEqual(Object.keys(existing))
    expect(out.machines).toBe(existing.machines)
    expect(strip(out.beacons)).toEqual(existing.beacons)
    expect(JSON.stringify({ ...out, beacons: strip(out.beacons) })).toBe(JSON.stringify(existing))
  })

  it('leaves a bundle without beacons without', () => {
    const existing = { machines: {} }
    expect(patchedBundle(existing, attachBeaconEnergy(undefined, {}))).toEqual(existing)
    expect('beacons' in patchedBundle(existing, attachBeaconEnergy(undefined, {}))).toBe(false)
  })
})
