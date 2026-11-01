import { describe, it, expect } from 'vitest'
import {
  isModuleAllowedInMachine, isModuleAllowedForRecipe, isModuleAllowedByProductivity,
  isModuleAllowedInBeacon, isModuleAllowedForBeaconRow,
} from './moduleRules'

describe('isModuleAllowedInMachine', () => {
  it('allows module when all its effects are permitted', () => {
    const module = { effects: { speed: 0.5, consumption: 0.15 } }
    const machine = { allowedEffects: ['speed', 'consumption', 'productivity'] }
    expect(isModuleAllowedInMachine(module, machine)).toBe(true)
  })

  it('blocks module when an effect is not permitted', () => {
    const module = { effects: { productivity: 0.1 } }
    const machine = { allowedEffects: ['speed', 'consumption'] }
    expect(isModuleAllowedInMachine(module, machine)).toBe(false)
  })
})

describe('isModuleAllowedForRecipe', () => {
  it('allows when limitation list is empty', () => {
    expect(isModuleAllowedForRecipe({ limitation: [], limitationBlacklist: [] }, 'iron-plate')).toBe(true)
  })

  it('allows when recipeId is in limitation list', () => {
    expect(isModuleAllowedForRecipe({ limitation: ['iron-plate'], limitationBlacklist: [] }, 'iron-plate')).toBe(true)
  })

  it('blocks when recipeId is NOT in non-empty limitation list', () => {
    expect(isModuleAllowedForRecipe({ limitation: ['copper-plate'], limitationBlacklist: [] }, 'iron-plate')).toBe(false)
  })

  it('blocks when recipeId is in blacklist', () => {
    expect(isModuleAllowedForRecipe({ limitation: [], limitationBlacklist: ['iron-plate'] }, 'iron-plate')).toBe(false)
  })
})

describe('isModuleAllowedByProductivity', () => {
  it('allows a productivity module when the recipe allows productivity', () => {
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0.1, speed: -0.15 } }, true)).toBe(true)
  })

  it('blocks a productivity module when the recipe disallows productivity', () => {
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0.1, speed: -0.15 } }, false)).toBe(false)
  })

  it('allows a module without a positive productivity effect whatever the recipe', () => {
    expect(isModuleAllowedByProductivity({ effects: { speed: 0.5 } }, false)).toBe(true)
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0, speed: 0.5 } }, false)).toBe(true)
  })
})

describe('isModuleAllowedInBeacon', () => {
  const beacon = { allowedEffects: ['speed', 'consumption', 'pollution'] }

  it('allows a module whose effects are all allowed', () => {
    expect(isModuleAllowedInBeacon({ effects: { speed: 0.5, consumption: 0.7 } }, beacon)).toBe(true)
  })

  it('rejects a module with a productivity effect the beacon does not allow', () => {
    expect(isModuleAllowedInBeacon({ effects: { productivity: 0.1, speed: -0.15 } }, beacon)).toBe(false)
  })

  it('ignores zero and undefined effect values', () => {
    expect(isModuleAllowedInBeacon({ effects: { speed: 0.5, productivity: 0, quality: undefined } }, beacon)).toBe(true)
  })

  it('allows productivity in a beacon that lists it', () => {
    expect(isModuleAllowedInBeacon({ effects: { productivity: 0.1 } }, { allowedEffects: ['productivity'] })).toBe(true)
  })
})

describe('isModuleAllowedForBeaconRow', () => {
  const unrestricted = { limitation: [], limitationBlacklist: [] }
  const speedBeacon = { allowedEffects: ['speed', 'consumption'] }

  it('checks the beacon, the recipe limitation and productivity together', () => {
    const speed = { effects: { speed: 0.5 }, ...unrestricted }
    const prod = { effects: { productivity: 0.1 }, ...unrestricted }
    const limited = { effects: { speed: 0.5 }, limitation: ['other'], limitationBlacklist: [] }
    expect(isModuleAllowedForBeaconRow(speed, speedBeacon, 'iron-plate', false)).toBe(true)
    expect(isModuleAllowedForBeaconRow(prod, speedBeacon, 'iron-plate', true)).toBe(false)
    expect(isModuleAllowedForBeaconRow(prod, { allowedEffects: ['productivity'] }, 'iron-plate', false)).toBe(false)
    expect(isModuleAllowedForBeaconRow(limited, speedBeacon, 'iron-plate', false)).toBe(false)
  })

  it('skips the beacon check when there is no beacon entity', () => {
    expect(isModuleAllowedForBeaconRow({ effects: { productivity: 0.1 }, ...unrestricted }, undefined, 'iron-plate', true)).toBe(true)
  })
})
