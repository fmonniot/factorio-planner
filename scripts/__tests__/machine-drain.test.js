import { describe, it, expect } from 'vitest'
import { attachMachineDrain } from '../machine-drain.js'

const machine = (id, type, energyType, energyUsageKw, drainKw = 0) => ({
  id, name: id, type, craftingSpeed: 1, energyUsageKw, energyType, drainKw, moduleSlots: 0,
})
const machines = () => ({
  am: machine('am', 'assembling-machine', 'electric', 90),
  ex: machine('ex', 'assembling-machine', 'electric', 90, 5),
  zero: machine('zero', 'assembling-machine', 'electric', 90),
  stone: machine('stone', 'furnace', 'burner', 90),
  boiler: machine('boiler', 'boiler', 'void', 0),
})
const raw = () => ({
  'assembling-machine': {
    am: { energy_usage: '90kW', energy_source: { type: 'electric' } },
    ex: { energy_usage: '90kW', energy_source: { type: 'electric', drain: '5kW' } },
    zero: { energy_usage: '90kW', energy_source: { type: 'electric', drain: '0kW' } },
  },
  furnace: { stone: { energy_usage: '90kW', energy_source: { type: 'burner' } } },
})

describe('attachMachineDrain', () => {
  it('writes usage / 30 on an electric machine without drain, keeping the key order', () => {
    const r = attachMachineDrain(machines(), raw())
    expect(r.machines.am.drainKw).toBeCloseTo(3, 12)
    expect(Object.keys(r.machines.am)).toEqual(Object.keys(machines().am))
    expect(r.counts).toEqual({ electric: 3, changed: 1 })
    expect(r.total).toBe(4)
  })

  it('keeps an explicit drain, an explicit 0kW included, and leaves a burner at 0', () => {
    const r = attachMachineDrain(machines(), raw())
    expect(r.machines.ex.drainKw).toBe(5)
    expect(r.machines.zero.drainKw).toBe(0)
    expect(r.machines.stone.drainKw).toBe(0)
  })

  it('leaves a generation machine untouched and does not count it missing', () => {
    const input = machines()
    const r = attachMachineDrain(input, raw())
    expect(r.machines.boiler).toBe(input.boiler)
    expect(r.missing).toEqual([])
  })

  it('lists a machine absent from the dump and keeps its entry', () => {
    const input = machines()
    const dump = raw()
    delete dump['assembling-machine'].am
    const r = attachMachineDrain(input, dump)
    expect(r.missing).toEqual(['am'])
    expect(r.machines.am).toBe(input.am)
  })

  it('lists a machine whose energy_usage differs and keeps its entry', () => {
    const input = machines()
    const dump = raw()
    dump['assembling-machine'].am.energy_usage = '150kW'
    const r = attachMachineDrain(input, dump)
    expect(r.mismatched).toEqual(['am'])
    expect(r.machines.am).toBe(input.am)
  })

  it('lists a machine whose energy type differs, either way, and keeps its entry', () => {
    const input = machines()
    const dump = raw()
    dump['assembling-machine'].am.energy_source = { type: 'burner' }
    dump.furnace.stone.energy_source = { type: 'electric' }
    const r = attachMachineDrain(input, dump)
    expect(r.mismatched).toEqual(['am', 'stone'])
    expect(r.machines.am).toBe(input.am)
    expect(r.machines.stone).toBe(input.stone)
  })

  it('tolerates float noise in energy_usage but not a real difference', () => {
    const input = machines()
    input.am.energyUsageKw = 90.00000000001
    const dump = raw()
    expect(attachMachineDrain(input, dump).mismatched).toEqual([])
    dump['assembling-machine'].am.energy_usage = '90.01kW'
    expect(attachMachineDrain(input, dump).mismatched).toEqual(['am'])
  })

  it('returns the same references on a second run', () => {
    const first = attachMachineDrain(machines(), raw())
    const second = attachMachineDrain(first.machines, raw())
    expect(second.machines).toBe(first.machines)
    expect(second.machines.am).toBe(first.machines.am)
    expect(second.counts.changed).toBe(0)
  })
})
