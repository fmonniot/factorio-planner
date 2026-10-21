import { describe, it, expect } from 'vitest'
import { isModuleAllowedInMachine, isModuleAllowedForRecipe, isModuleAllowedByProductivity } from './moduleRules'

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
