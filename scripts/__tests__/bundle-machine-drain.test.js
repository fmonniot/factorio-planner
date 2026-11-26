import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MACHINE_PROTO_TYPES } from '../fuel.js'

// Regression guard for the exported machine drain: the invariants are asserted for every bundle and the exact values
// for kompetenz-seablock, which was patched with `--patch-machine-drain`. The Nullius bundle is not patched yet.
const DATA_DIR = join(import.meta.dirname, '../../public/data')
const load = dir => JSON.parse(readFileSync(join(DATA_DIR, dir, 'game-data.json'), 'utf8'))

describe('bundled machine drain', () => {
  const bundles = readdirSync(DATA_DIR).filter(d => existsSync(join(DATA_DIR, d, 'game-data.json')))

  for (const dir of bundles) {
    it(`${dir} machines carry a non-negative drain, and 0 unless electric`, () => {
      for (const m of Object.values(load(dir).machines)) {
        expect(typeof m.drainKw, m.id).toBe('number')
        expect(m.drainKw, m.id).toBeGreaterThanOrEqual(0)
        if (m.energyType !== 'electric') expect(m.drainKw, m.id).toBe(0)
      }
    })
  }

  it('kompetenz-seablock drains energy_usage / 30 on every electric machine but the explicit ones', () => {
    const { machines } = load('kompetenz-seablock')
    const explicit = /^angels-electric-boiler/
    let checked = 0
    for (const m of Object.values(machines)) {
      if (!MACHINE_PROTO_TYPES.includes(m.type) && !explicit.test(m.id)) continue
      if (m.energyType !== 'electric' || !(m.energyUsageKw > 0)) continue
      checked++
      expect(m.drainKw, m.id).toBeGreaterThan(0)
      if (!explicit.test(m.id)) expect(m.drainKw, m.id).toBeCloseTo(m.energyUsageKw / 30, 9)
    }
    expect(checked).toBeGreaterThan(100)
    const boilers = Object.values(machines).filter(m => explicit.test(m.id))
    expect(boilers.length).toBe(3)
    expect(boilers.find(m => m.energyUsageKw === 2420)?.drainKw).toBe(80)
  })

  it('kompetenz-seablock pins the assembling machines and a burner furnace', () => {
    const { machines } = load('kompetenz-seablock')
    expect(machines['assembling-machine-2'].drainKw).toBeCloseTo(4.5, 9)
    expect(machines['assembling-machine-1'].drainKw).toBeCloseTo(100 / 30, 9)
    const burner = Object.values(machines).find(m => m.type === 'furnace' && m.energyType === 'burner')
    expect(burner?.drainKw).toBe(0)
  })
})
