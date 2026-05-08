import { describe, it, expect } from 'vitest'
import { computeNodeEffects, computeMachineMetrics } from './effects'
import type { GameData, GameRecipeNode, Machine } from '../data/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGameData(
  recipes: GameData['recipes'],
  modules: GameData['modules'] = {},
): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes,
    machines: {},
    modules,
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
  }
}

function node(
  id: string,
  recipeId: string,
  modules: GameRecipeNode['modules'] = [],
  beaconConfig?: GameRecipeNode['beaconConfig'],
): GameRecipeNode {
  return {
    kind: 'game-recipe',
    id,
    recipeId,
    modules,
    byproductPolicy: {},
    ...(beaconConfig ? { beaconConfig } : {}),
  }
}

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: 'assembler',
    name: 'assembler',
    type: 'assembling-machine',
    craftingSpeed: 1,
    energyUsageKw: 100,
    energyType: 'electric',
    drainKw: 5,
    moduleSlots: 4,
    allowedEffects: ['speed', 'productivity', 'consumption', 'pollution', 'quality'],
    craftingCategories: ['crafting'],
    iconPath: '',
    hidden: false,
    ...overrides,
  }
}

const PROD3_MODULE: GameData['modules'][string] = {
  id: 'productivity-module-3',
  name: 'productivity-module-3',
  iconPath: '',
  category: 'productivity',
  tier: 3,
  effects: { productivity: 0.1, consumption: 0.8, speed: -0.15, quality: 0 },
  limitation: [],
  limitationBlacklist: [],
}

const SPEED3_MODULE: GameData['modules'][string] = {
  id: 'speed-module-3',
  name: 'speed-module-3',
  iconPath: '',
  category: 'speed',
  tier: 3,
  effects: { speed: 0.5, consumption: 0.7, productivity: 0, quality: 0 },
  limitation: [],
  limitationBlacklist: [],
}

// ---------------------------------------------------------------------------
// computeNodeEffects tests
// ---------------------------------------------------------------------------

describe('computeNodeEffects — no modules', () => {
  it('all bonuses are zero for a node with no modules', () => {
    const gd = makeGameData({})
    const n = node('n1', 'r1')
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.speedBonus).toBe(0)
    expect(fx.consumptionBonus).toBe(0)
  })
})

describe('computeNodeEffects — machine modules', () => {
  it('4× prod-3 gives +40% productivity, +320% consumption, −60% speed', () => {
    const gd = makeGameData({}, { 'productivity-module-3': PROD3_MODULE })
    const n = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBeCloseTo(0.4)
    expect(fx.consumptionBonus).toBeCloseTo(3.2)
    expect(fx.speedBonus).toBeCloseTo(-0.6)
  })

  it('2× speed-3 gives +100% speed, +140% consumption', () => {
    const gd = makeGameData({}, { 'speed-module-3': SPEED3_MODULE })
    const n = node('n1', 'r1', [{ moduleId: 'speed-module-3', count: 2 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.speedBonus).toBeCloseTo(1.0)
    expect(fx.consumptionBonus).toBeCloseTo(1.4)
    expect(fx.productivityBonus).toBeCloseTo(0)
  })
})

describe('computeNodeEffects — beacon', () => {
  it('1 beacon with 2 speed-3, 50% efficiency → +50% speed', () => {
    const gd = makeGameData({}, { 'speed-module-3': SPEED3_MODULE })
    const n = node('n1', 'r1', [], {
      moduleId: 'speed-module-3',
      beaconCount: 1,
      modulesPerBeacon: 2,
      distributionEfficiency: 0.5,
    })
    const fx = computeNodeEffects(n, gd)
    // 0.5 (speed per module) × 2 (mods per beacon) × 1 (beacon) × 0.5 (efficiency) = 0.5
    expect(fx.speedBonus).toBeCloseTo(0.5)
  })

  it('machine + beacon effects stack additively', () => {
    const gd = makeGameData(
      {},
      { 'speed-module-3': SPEED3_MODULE, 'productivity-module-3': PROD3_MODULE },
    )
    const n = node(
      'n1',
      'r1',
      [{ moduleId: 'productivity-module-3', count: 4 }],
      {
        moduleId: 'speed-module-3',
        beaconCount: 8,
        modulesPerBeacon: 2,
        distributionEfficiency: 0.5,
      },
    )
    const fx = computeNodeEffects(n, gd)
    // Speed: machine=−0.60, beacon=0.5×2×8×0.5=4.0, total=3.40
    expect(fx.speedBonus).toBeCloseTo(3.4)
    // Productivity: machine=0.40, beacon=0 (speed modules have no prod), total=0.40
    expect(fx.productivityBonus).toBeCloseTo(0.4)
  })
})

// ---------------------------------------------------------------------------
// computeMachineMetrics tests
// ---------------------------------------------------------------------------

describe('computeMachineMetrics', () => {
  const m = machine()  // speed=1, energy=100kW, drain=5kW

  it('baseline: 1 exec/min at 60s crafting → exactly 1 machine', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(1)
    expect(metrics.machineCountCeil).toBe(1)
  })

  it('5 exec/min at 60s crafting → 5 machines', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 }
    const metrics = computeMachineMetrics(5, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(5)
  })

  it('+100% speed halves machine count', () => {
    const fx = { productivityBonus: 0, speedBonus: 1.0, consumptionBonus: 0 }
    const metrics = computeMachineMetrics(5, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(2.5)
  })

  it('power = machineCount × (energyUsage × (1+consumption) + drain)', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    // 1 machine × (100 × 1 + 5) = 105 kW
    expect(metrics.powerKw).toBeCloseTo(105)
  })

  it('consumption bonus scales energy usage but not drain', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0.5 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    // 1 machine × (100 × 1.5 + 5) = 155 kW
    expect(metrics.powerKw).toBeCloseTo(155)
  })

  it('machineCountCeil rounds up fractional counts', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 }
    // 2.5 machines needed
    const metrics = computeMachineMetrics(2.5, 60, m, fx)
    expect(metrics.machineCountCeil).toBe(3)
  })
})
