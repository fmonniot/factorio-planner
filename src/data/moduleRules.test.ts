import { describe, it, expect } from 'vitest'
import {
  isModuleAllowedInMachine, isModuleAllowedForRecipe, isModuleAllowedByProductivity,
  isModuleAllowedInBeacon, isModuleAllowedForBeaconRow, moduleMisfitInMachine, moduleMisfitInBeacon,
  moduleMisfitForRecipe, moduleMisfitInMachineRow, moduleMisfitInBeaconRow,
} from './moduleRules'

describe('isModuleAllowedInMachine', () => {
  it('allows module when all its effects are permitted', () => {
    const module = { effects: { speed: 0.5, consumption: 0.15 }, category: 'speed-module' }
    const machine = { allowedEffects: ['speed', 'consumption', 'productivity'] }
    expect(isModuleAllowedInMachine(module, machine)).toBe(true)
  })

  it('blocks module when an effect is not permitted', () => {
    const module = { effects: { productivity: 0.1 }, category: 'speed-module' }
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
    expect(isModuleAllowedInBeacon({ effects: { speed: 0.5, consumption: 0.7 }, category: 'speed-module' }, beacon)).toBe(true)
  })

  it('rejects a module with a productivity effect the beacon does not allow', () => {
    expect(isModuleAllowedInBeacon({ effects: { productivity: 0.1, speed: -0.15 }, category: 'speed-module' }, beacon)).toBe(false)
  })

  it('ignores zero and undefined effect values', () => {
    expect(isModuleAllowedInBeacon({ effects: { speed: 0.5, productivity: 0, quality: undefined }, category: 'speed-module' }, beacon)).toBe(true)
  })

  it('allows productivity in a beacon that lists it', () => {
    expect(isModuleAllowedInBeacon({ effects: { productivity: 0.1 }, category: 'speed-module' }, { allowedEffects: ['productivity'] })).toBe(true)
  })
})

describe('isModuleAllowedForBeaconRow', () => {
  const unrestricted = { limitation: [], limitationBlacklist: [] }
  const speedBeacon = { allowedEffects: ['speed', 'consumption'] }

  it('checks the beacon, the recipe limitation and productivity together', () => {
    const speed = { effects: { speed: 0.5 }, category: 'speed-module', ...unrestricted }
    const prod = { effects: { productivity: 0.1 }, category: 'speed-module', ...unrestricted }
    const limited = { effects: { speed: 0.5 }, category: 'speed-module', limitation: ['other'], limitationBlacklist: [] }
    expect(isModuleAllowedForBeaconRow(speed, speedBeacon, 'iron-plate', false)).toBe(true)
    expect(isModuleAllowedForBeaconRow(prod, speedBeacon, 'iron-plate', true)).toBe(false)
    expect(isModuleAllowedForBeaconRow(prod, { allowedEffects: ['productivity'] }, 'iron-plate', false)).toBe(false)
    expect(isModuleAllowedForBeaconRow(limited, speedBeacon, 'iron-plate', false)).toBe(false)
  })

  it('skips the beacon check when there is no beacon entity', () => {
    expect(isModuleAllowedForBeaconRow({ effects: { productivity: 0.1 }, category: 'speed-module', ...unrestricted }, undefined, 'iron-plate', true)).toBe(true)
  })
})

describe('module categories', () => {
  const agri = { effects: { productivity: 0.1 }, category: 'angels-bio-yield' }
  const machine = { allowedEffects: ['speed', 'productivity'] }

  it('rejects a category the machine does not list, even when its effects fit', () => {
    const listed = { ...machine, allowedModuleCategories: ['speed'] }
    expect(moduleMisfitInMachine(agri, listed)).toBe('category')
    expect(isModuleAllowedInMachine(agri, listed)).toBe(false)
  })

  it('accepts every category when the list is absent', () => {
    expect(moduleMisfitInMachine(agri, machine)).toBeUndefined()
    expect(isModuleAllowedInMachine(agri, machine)).toBe(true)
  })

  it('accepts nothing when the list is empty', () => {
    expect(moduleMisfitInMachine(agri, { ...machine, allowedModuleCategories: [] })).toBe('category')
  })

  it('reports the effect when both the effect and the category fail', () => {
    expect(moduleMisfitInMachine(agri, { allowedEffects: ['speed'], allowedModuleCategories: ['speed'] })).toBe('effect')
  })

  it('keeps the machine strict on zero-valued effects and the beacon tolerant', () => {
    const zero = { effects: { speed: 0.5, productivity: 0 }, category: 'speed' }
    const entity = { allowedEffects: ['speed'] }
    expect(moduleMisfitInMachine(zero, entity)).toBe('effect')
    expect(moduleMisfitInBeacon(zero, entity)).toBeUndefined()
  })

  it('rejects a beacon category misfit', () => {
    expect(moduleMisfitInBeacon(agri, { ...machine, allowedModuleCategories: ['speed'] })).toBe('category')
  })

  it('isModuleAllowedForBeaconRow rejects by category and skips the check without a beacon', () => {
    const module = { ...agri, limitation: [], limitationBlacklist: [] }
    expect(isModuleAllowedForBeaconRow(module, { ...machine, allowedModuleCategories: ['speed'] }, 'r', true)).toBe(false)
    expect(isModuleAllowedForBeaconRow(module, undefined, 'r', true)).toBe(true)
  })
})

describe('moduleMisfitForRecipe', () => {
  const mod = (over: Partial<{ effects: Record<string, number>; limitation: string[]; limitationBlacklist: string[] }> = {}) =>
    ({ effects: {}, category: 'speed', limitation: [], limitationBlacklist: [], ...over })

  it('rejects a recipe the limitation list leaves out, accepts one it names', () => {
    expect(moduleMisfitForRecipe(mod({ limitation: ['a'] }), 'b', true)).toBe('recipe')
    expect(moduleMisfitForRecipe(mod({ limitation: ['b'] }), 'b', true)).toBeUndefined()
  })

  it('rejects a recipe the blacklist names', () => {
    expect(moduleMisfitForRecipe(mod({ limitationBlacklist: ['b'] }), 'b', true)).toBe('recipe')
  })

  it('rejects positive productivity on a recipe that disallows it, not zero or negative', () => {
    expect(moduleMisfitForRecipe(mod({ effects: { productivity: 0.1 } }), 'b', false)).toBe('recipe')
    expect(moduleMisfitForRecipe(mod({ effects: { productivity: 0 } }), 'b', false)).toBeUndefined()
    expect(moduleMisfitForRecipe(mod({ effects: { productivity: -0.1 } }), 'b', false)).toBeUndefined()
  })
})

describe('moduleMisfitInMachineRow / moduleMisfitInBeaconRow', () => {
  const prod = { effects: { productivity: 0.1 }, category: 'productivity', limitation: [], limitationBlacklist: [] }

  it('lets the entity win over the recipe', () => {
    expect(moduleMisfitInMachineRow(prod, { allowedEffects: ['speed'] }, 'r', false)).toBe('effect')
    expect(moduleMisfitInBeaconRow(prod, { allowedEffects: ['speed'] }, 'r', false)).toBe('effect')
    expect(moduleMisfitInMachineRow(prod, { allowedEffects: ['productivity'], allowedModuleCategories: ['speed'] }, 'r', false)).toBe('category')
  })

  it('judges the recipe alone without an entity', () => {
    expect(moduleMisfitInMachineRow(prod, undefined, 'r', false)).toBe('recipe')
    expect(moduleMisfitInBeaconRow(prod, undefined, 'r', false)).toBe('recipe')
    expect(moduleMisfitInBeaconRow(prod, undefined, 'r', true)).toBeUndefined()
  })

  it('reports the recipe when the entity accepts the module', () => {
    expect(moduleMisfitInMachineRow(prod, { allowedEffects: ['productivity'] }, 'r', false)).toBe('recipe')
    expect(isModuleAllowedForBeaconRow(prod, { allowedEffects: ['productivity'] }, 'r', true)).toBe(true)
    expect(isModuleAllowedForBeaconRow(prod, { allowedEffects: ['productivity'] }, 'r', false)).toBe(false)
  })
})
