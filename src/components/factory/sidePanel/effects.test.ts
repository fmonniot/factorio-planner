import { describe, it, expect } from 'vitest'
import { applyRecipeConstraints, beaconEffects, moduleEffects, rowEffects, fmtEffect } from './effects'
import type { BeaconConfig, GameData, GameRecipeNode } from '../../../data/types'

const totals = () => ({ speed: 1, productivity: 0.4, consumption: -0.2, pollution: 0.1, quality: 0.3 })

describe('applyRecipeConstraints', () => {
  it('drops an effect missing from any known list, as the solver does', () => {
    const fx = applyRecipeConstraints(totals(), [['speed', 'productivity'], ['speed', 'consumption']], true)
    expect(fx).toEqual({ speed: 1, productivity: 0, consumption: 0, pollution: 0, quality: 0 })
  })

  it('treats an unknown entity (undefined list) as filtering nothing', () => {
    expect(applyRecipeConstraints(totals(), [undefined, undefined], true)).toEqual(totals())
  })

  it('treats a known empty list as allowing nothing', () => {
    expect(applyRecipeConstraints(totals(), [[]], true)).toEqual(
      { speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 })
  })

  it('drops productivity when the recipe disallows it', () => {
    expect(applyRecipeConstraints(totals(), [undefined], false).productivity).toBe(0)
  })
})

function gameData(): GameData {
  return {
    factorioVersion: '2.0.0', modSet: {}, items: {},
    recipes: {
      r: {
        id: 'r', name: 'R', category: 'c', craftingTime: 1, ingredients: [], madeIn: [], allowProductivity: true, hidden: false,
        mainProduct: undefined, subgroup: '', order: '', products: [{ itemId: 'x', type: 'item', amount: 1 }],
      },
    },
    machines: {
      m: { id: 'm', name: 'M', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric', drainKw: 0, moduleSlots: 4, allowedEffects: ['speed', 'consumption'], craftingCategories: ['c'], iconPath: '', hidden: false },
    },
    modules: {
      speed: { id: 'speed', name: 'Speed', category: 'speed', tier: 1, effects: { speed: 0.2, consumption: 0.5 }, limitation: [], limitationBlacklist: [], iconPath: '' },
      prod: { id: 'prod', name: 'Prod', category: 'productivity', tier: 1, effects: { productivity: 0.1, speed: -0.1 }, limitation: [], limitationBlacklist: [], iconPath: '' },
    },
    beacons: {},
    defaultMachines: { c: 'm' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  }
}

const beacon = (over: Partial<BeaconConfig> = {}): BeaconConfig =>
  ({ moduleId: 'speed', beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 0.5, ...over })

describe('moduleEffects and beaconEffects', () => {
  it('multiplies a module by its count', () => {
    expect(moduleEffects([{ moduleId: 'speed', count: 2 }], gameData()).speed).toBeCloseTo(0.4)
  })

  it('multiplies a beacon module by efficiency, modules per beacon and beacons', () => {
    expect(beaconEffects(beacon(), gameData()).speed).toBeCloseTo(0.2 * 0.5 * 2 * 4)
  })

  it('contributes nothing without a module', () => {
    expect(beaconEffects(beacon({ moduleId: undefined }), gameData()).speed).toBe(0)
  })
})

describe('rowEffects', () => {
  const node = (over: Partial<GameRecipeNode> = {}): GameRecipeNode =>
    ({ kind: 'game-recipe', id: 'n', recipeId: 'r', modules: [], byproductPolicy: {}, ...over })

  it('totals what the solver counts, per source', () => {
    const n = node({ modules: [{ moduleId: 'speed', count: 2 }], beaconConfig: beacon() })
    const fx = rowEffects(n, [beacon()], gameData())
    expect(fx.machine.applied.speed).toBeCloseTo(0.4)
    expect(fx.beacons[0].applied.speed).toBeCloseTo(0.8)
    expect(fx.total.speed).toBeCloseTo(fx.machine.applied.speed + fx.beacons[0].applied.speed)
    expect(fx.total.consumption).toBeCloseTo(fx.machine.applied.consumption + fx.beacons[0].applied.consumption)
  })

  it('keeps the raw value of an effect the machine does not allow but counts none of it', () => {
    const n = node({ modules: [{ moduleId: 'prod', count: 1 }] })
    const fx = rowEffects(n, [], gameData())
    expect(fx.machine.raw.productivity).toBeCloseTo(0.1)
    expect(fx.machine.applied.productivity).toBe(0)
    expect(fx.total.productivity).toBe(0)
  })
})

describe('fmtEffect', () => {
  it('signs and rounds to a percentage', () => {
    expect(fmtEffect(0.204)).toBe('+20%')
    expect(fmtEffect(-0.15)).toBe('-15%')
    expect(fmtEffect(0)).toBe('+0%')
  })
})
