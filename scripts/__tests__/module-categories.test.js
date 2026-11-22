import { describe, it, expect } from 'vitest'
import { allowedModuleCategories, moduleCategoriesField, attachModuleCategories, patchedBundle } from '../module-categories.js'

// Each call returns fresh objects.
const makeMachines = () => ({
  'assembling-machine-2': { id: 'assembling-machine-2', moduleSlots: 2 },
  'stone-furnace': { id: 'stone-furnace', moduleSlots: 0 },
  'electric-drill': { id: 'electric-drill', moduleSlots: 3 },
  'offshore-pump': { id: 'offshore-pump', moduleSlots: 0 },
})
const makeBeacons = () => ({ beacon: { id: 'beacon', moduleSlots: 2 } })
const makeRaw = () => ({
  'assembling-machine': { 'assembling-machine-2': { allowed_module_categories: ['speed', 'productivity'] } },
  furnace: { 'stone-furnace': { allowed_module_categories: ['speed'] } },
  'mining-drill': { 'electric-drill': {} },
  beacon: { beacon: { allowed_module_categories: ['speed'] } },
})

describe('allowedModuleCategories', () => {
  it('is undefined without a list', () => {
    expect(allowedModuleCategories({})).toBeUndefined()
    expect(allowedModuleCategories(undefined)).toBeUndefined()
    expect(allowedModuleCategories({ allowed_module_categories: null })).toBeUndefined()
  })

  it('sorts and dedupes', () => {
    expect(allowedModuleCategories({ allowed_module_categories: ['speed', 'efficiency', 'speed'] })).toEqual(['efficiency', 'speed'])
  })

  it('reads an empty Lua table as an empty list', () => {
    expect(allowedModuleCategories({ allowed_module_categories: {} })).toEqual([])
  })

  it('reads a Lua table object', () => {
    expect(allowedModuleCategories({ allowed_module_categories: { 1: 'speed', 2: 'efficiency' } })).toEqual(['efficiency', 'speed'])
  })
})

describe('moduleCategoriesField', () => {
  it('is empty for an entity without slots or without a list', () => {
    expect(moduleCategoriesField({ allowed_module_categories: ['speed'] }, 0)).toEqual({})
    expect(moduleCategoriesField({}, 2)).toEqual({})
  })

  it('carries the list for an entity with slots, `[]` included', () => {
    expect(moduleCategoriesField({ allowed_module_categories: ['speed'] }, 2)).toEqual({ allowedModuleCategories: ['speed'] })
    expect(moduleCategoriesField({ allowed_module_categories: {} }, 1)).toEqual({ allowedModuleCategories: [] })
  })
})

describe('attachModuleCategories', () => {
  it('adds the field to slotted machines and beacons, skips zero-slot machines', () => {
    const r = attachModuleCategories(makeMachines(), makeBeacons(), makeRaw())
    expect(r.machines['assembling-machine-2'].allowedModuleCategories).toEqual(['productivity', 'speed'])
    expect(r.machines['stone-furnace']).not.toHaveProperty('allowedModuleCategories')
    expect(r.machines['offshore-pump']).not.toHaveProperty('allowedModuleCategories')
    expect(r.machines['electric-drill']).not.toHaveProperty('allowedModuleCategories')
    expect(r.beacons.beacon.allowedModuleCategories).toEqual(['speed'])
    expect(r.counts).toEqual({ machines: 1, beacons: 1 })
    expect(r.slotted).toBe(3)
    expect(r.missing).toEqual([])
  })

  it('removes a stale field when the prototype has no list', () => {
    const machines = makeMachines()
    machines['electric-drill'].allowedModuleCategories = ['speed']
    const r = attachModuleCategories(machines, makeBeacons(), makeRaw())
    expect(r.machines['electric-drill']).not.toHaveProperty('allowedModuleCategories')
  })

  it('strips a leftover field from zero-slot machines and beacons, keeping references when there is none', () => {
    const machines = makeMachines()
    machines['stone-furnace'].allowedModuleCategories = ['speed']
    const beacons = { beacon: { id: 'beacon', moduleSlots: 0, allowedModuleCategories: ['speed'] } }
    const original = makeMachines()
    const r = attachModuleCategories(machines, beacons, makeRaw())
    expect(r.machines['stone-furnace']).not.toHaveProperty('allowedModuleCategories')
    expect(r.beacons.beacon).not.toHaveProperty('allowedModuleCategories')
    expect(r.machines['offshore-pump']).toBe(machines['offshore-pump'])
    expect(original['offshore-pump']).toEqual(r.machines['offshore-pump'])
  })

  it('lists a missing prototype and keeps its entry', () => {
    const raw = makeRaw()
    delete raw.beacon.beacon
    const machines = makeMachines()
    const beacons = makeBeacons()
    const r = attachModuleCategories(machines, beacons, raw)
    expect(r.missing).toEqual(['beacon'])
    expect(r.beacons.beacon).toBe(beacons.beacon)
  })

  it('is idempotent and keeps references when nothing changes', () => {
    const first = attachModuleCategories(makeMachines(), makeBeacons(), makeRaw())
    const second = attachModuleCategories(first.machines, first.beacons, makeRaw())
    for (const id of Object.keys(first.machines)) expect(second.machines[id], id).toBe(first.machines[id])
    expect(second.beacons.beacon).toBe(first.beacons.beacon)
  })

  it('accepts a bundle without beacons', () => {
    expect(attachModuleCategories(makeMachines(), undefined, makeRaw()).beacons).toEqual({})
  })
})

describe('patchedBundle', () => {
  it('adds no beacons key to a bundle that had none, and replaces it when present', () => {
    const attached = attachModuleCategories(makeMachines(), makeBeacons(), makeRaw())
    expect(patchedBundle({ machines: makeMachines() }, attached)).not.toHaveProperty('beacons')
    expect(patchedBundle({ machines: makeMachines(), beacons: makeBeacons() }, attached).beacons).toBe(attached.beacons)
  })
})
