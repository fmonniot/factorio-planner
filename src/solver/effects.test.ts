import { describe, it, expect } from 'vitest'
import { computeNodeEffects, computeMachineMetrics } from './effects'
import { rowProductAmount } from './build'
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
    technologies: {},
    startingRecipes: [],
  }
}

function recipe(allowProductivity: boolean): GameData['recipes'][string] {
  return {
    id: 'r1',
    name: 'r1',
    category: 'crafting',
    craftingTime: 1,
    ingredients: [],
    products: [],
    madeIn: [],
    allowProductivity,
    mainProduct: undefined,
    hidden: false,
    subgroup: '',
    order: '',
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
    const gd = makeGameData({ r1: recipe(true) }, { 'productivity-module-3': PROD3_MODULE })
    const n = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBeCloseTo(0.4)
    expect(fx.consumptionBonus).toBeCloseTo(3.2)
    expect(fx.speedBonus).toBeCloseTo(-0.6)
  })

  it('drops productivity but keeps speed and consumption when the recipe disallows it', () => {
    const gd = makeGameData({ r1: recipe(false) }, { 'productivity-module-3': PROD3_MODULE })
    const n = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.consumptionBonus).toBeCloseTo(3.2)
    expect(fx.speedBonus).toBeCloseTo(-0.6)
  })

  it('drops productivity when the recipe is unknown', () => {
    const gd = makeGameData({}, { 'productivity-module-3': PROD3_MODULE })
    const n = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    expect(computeNodeEffects(n, gd).productivityBonus).toBe(0)
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
  it('a beacon configuration without a module contributes nothing', () => {
    const gd = makeGameData({}, { 'speed-module-3': SPEED3_MODULE })
    const n = node('n1', 'r1', [], {
      beaconCount: 8,
      modulesPerBeacon: 2,
      distributionEfficiency: 0.5,
    })
    const fx = computeNodeEffects(n, gd)
    expect(fx.speedBonus).toBe(0)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.consumptionBonus).toBe(0)
  })

  it('a module-less beacon leaves machine module effects unchanged', () => {
    const gd = makeGameData({}, { 'speed-module-3': SPEED3_MODULE })
    const withBeacon = node('n1', 'r1', [{ moduleId: 'speed-module-3', count: 2 }], {
      beaconCount: 8, modulesPerBeacon: 2, distributionEfficiency: 0.5,
    })
    const without = node('n1', 'r1', [{ moduleId: 'speed-module-3', count: 2 }])
    expect(computeNodeEffects(withBeacon, gd)).toEqual(computeNodeEffects(without, gd))
  })

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
      { r1: recipe(true) },
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

  it('drops beacon productivity when the recipe disallows it', () => {
    const gd = makeGameData({ r1: recipe(false) }, { 'productivity-module-3': PROD3_MODULE })
    const n = node('n1', 'r1', [], {
      moduleId: 'productivity-module-3',
      beaconCount: 1,
      modulesPerBeacon: 2,
      distributionEfficiency: 0.5,
    })
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.speedBonus).toBeCloseTo(-0.15)
  })
})

describe('computeNodeEffects — allowed effects', () => {
  const beaconCfg = (beaconId?: string): NonNullable<GameRecipeNode['beaconConfig']> => ({
    ...(beaconId ? { beaconId } : {}),
    moduleId: 'productivity-module-3',
    beaconCount: 1,
    modulesPerBeacon: 2,
    distributionEfficiency: 0.5,
  })
  const withEntities = (
    machineEffects: Machine['allowedEffects'] | null,
    beaconEffects: Machine['allowedEffects'] | null,
  ): GameData => {
    const gd = makeGameData(
      { r1: recipe(true) },
      { 'productivity-module-3': PROD3_MODULE, 'speed-module-3': SPEED3_MODULE },
    )
    if (machineEffects) {
      gd.machines = { assembler: machine({ allowedEffects: machineEffects }) }
      gd.defaultMachines = { crafting: 'assembler' }
    }
    if (beaconEffects) {
      gd.beacons = {
        beacon: {
          id: 'beacon', name: 'beacon', iconPath: '', hidden: false, moduleSlots: 2,
          distributionEfficiency: 0.5, allowedEffects: beaconEffects,
        },
      }
    }
    return gd
  }

  it('drops productivity but keeps speed when the machine does not allow productivity', () => {
    const gd = withEntities(['speed', 'consumption'], null)
    const n = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.speedBonus).toBeCloseTo(-0.6)
    expect(fx.consumptionBonus).toBeCloseTo(3.2)
  })

  it('drops speed when the machine does not allow speed', () => {
    const gd = withEntities(['productivity', 'consumption'], null)
    const n = node('n1', 'r1', [{ moduleId: 'speed-module-3', count: 2 }])
    const fx = computeNodeEffects(n, gd)
    expect(fx.speedBonus).toBe(0)
    expect(fx.consumptionBonus).toBeCloseTo(1.4)
  })

  it('drops beacon productivity when the beacon entity does not allow it, keeping speed', () => {
    const gd = withEntities(null, ['speed', 'consumption'])
    const n = node('n1', 'r1', [], beaconCfg('beacon'))
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.speedBonus).toBeCloseTo(-0.15)
  })

  it('drops a beacon effect the machine does not allow even if the beacon does', () => {
    const gd = withEntities(['speed', 'consumption'], ['speed', 'consumption', 'productivity'])
    const n = node('n1', 'r1', [], beaconCfg('beacon'))
    const fx = computeNodeEffects(n, gd)
    expect(fx.productivityBonus).toBe(0)
    expect(fx.speedBonus).toBeCloseTo(-0.15)
  })

  it('treats a known machine with an empty allowedEffects as allowing nothing', () => {
    const gd = withEntities([], ['speed', 'consumption', 'productivity'])
    const machineMods = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    expect(computeNodeEffects(machineMods, gd)).toMatchObject({ productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 })
    expect(computeNodeEffects(node('n1', 'r1', [], beaconCfg('beacon')), gd))
      .toMatchObject({ productivityBonus: 0, speedBonus: 0, consumptionBonus: 0 })
  })

  it('filters nothing without a beaconId, with an unknown beaconId or with an unknown machine', () => {
    const gd = withEntities(null, ['speed'])
    expect(computeNodeEffects(node('n1', 'r1', [], beaconCfg()), gd).productivityBonus).toBeCloseTo(0.1)
    expect(computeNodeEffects(node('n1', 'r1', [], beaconCfg('missing')), gd).productivityBonus).toBeCloseTo(0.1)
    const m = node('n1', 'r1', [{ moduleId: 'productivity-module-3', count: 4 }])
    expect(computeNodeEffects(m, gd).productivityBonus).toBeCloseTo(0.4)
  })
})

// ---------------------------------------------------------------------------
// computeMachineMetrics tests
// ---------------------------------------------------------------------------

describe('computeMachineMetrics', () => {
  const m = machine()  // speed=1, energy=100kW, drain=5kW

  it('baseline: 1 exec/min at 60s crafting → exactly 1 machine', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0, heatBonus: 0 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(1)
    expect(metrics.machineCountCeil).toBe(1)
  })

  it('5 exec/min at 60s crafting → 5 machines', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0, heatBonus: 0 }
    const metrics = computeMachineMetrics(5, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(5)
  })

  it('+100% speed halves machine count', () => {
    const fx = { productivityBonus: 0, speedBonus: 1.0, consumptionBonus: 0, heatBonus: 0 }
    const metrics = computeMachineMetrics(5, 60, m, fx)
    expect(metrics.machineCountExact).toBeCloseTo(2.5)
  })

  it('power = machineCount × (energyUsage × (1+consumption) + drain)', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0, heatBonus: 0 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    // 1 machine × (100 × 1 + 5) = 105 kW
    expect(metrics.powerKw).toBeCloseTo(105)
  })

  it('consumption bonus scales energy usage but not drain', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0.5, heatBonus: 0 }
    const metrics = computeMachineMetrics(1, 60, m, fx)
    // 1 machine × (100 × 1.5 + 5) = 155 kW
    expect(metrics.powerKw).toBeCloseTo(155)
  })

  it('consumption bonus is clamped at -80 %', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: -1.5, heatBonus: 0 }
    // 1 machine × (100 × 0.2 + 5) = 25 kW
    expect(computeMachineMetrics(1, 60, m, fx).powerKw).toBeCloseTo(25)
  })

  it('machineCountCeil rounds up fractional counts', () => {
    const fx = { productivityBonus: 0, speedBonus: 0, consumptionBonus: 0, heatBonus: 0 }
    // 2.5 machines needed
    const metrics = computeMachineMetrics(2.5, 60, m, fx)
    expect(metrics.machineCountCeil).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Reactor neighbours
// ---------------------------------------------------------------------------

describe('computeNodeEffects — reactor neighbours', () => {
  function reactorData(neighbourBonus?: number): GameData {
    const gd = makeGameData({ r1: { ...recipe(false), category: 'power:reactor' } })
    gd.machines = {
      reactor: machine({ id: 'reactor', type: 'reactor', neighbourBonus }),
      assembler: machine(),
    }
    gd.defaultMachines = { 'power:reactor': 'reactor' }
    return gd
  }
  const withCount = (count?: number, machineId?: string): GameRecipeNode => ({
    ...node('n1', 'r1'),
    ...(count !== undefined && { neighbourCount: count }),
    ...(machineId !== undefined && { machineId }),
  })

  it('bonus 1 × count 3 → 3', () => {
    expect(computeNodeEffects(withCount(3), reactorData(1)).heatBonus).toBe(3)
  })

  it('bonus 0.25 × count 2.5 → 0.625', () => {
    expect(computeNodeEffects(withCount(2.5), reactorData(0.25)).heatBonus).toBeCloseTo(0.625)
  })

  it('is 0 for a machine without a bonus or a row without a count', () => {
    expect(computeNodeEffects(withCount(3), reactorData()).heatBonus).toBe(0)
    expect(computeNodeEffects(withCount(), reactorData(1)).heatBonus).toBe(0)
  })

  it('is 0 for an explicit non-reactor machine', () => {
    expect(computeNodeEffects(withCount(3, 'assembler'), reactorData(1)).heatBonus).toBe(0)
  })
})

describe('rowProductAmount', () => {
  const heat = { itemId: 'power:heat', type: 'fluid' as const, amount: 10.8 }

  it('multiplies the heat product by 1 + heatBonus', () => {
    expect(rowProductAmount(heat, 0, 3)).toBeCloseTo(43.2)
  })

  it('leaves other products alone', () => {
    expect(rowProductAmount({ itemId: 'spent', type: 'item', amount: 0.0054 }, 0, 3)).toBeCloseTo(0.0054)
  })

  it('combines with productivity', () => {
    expect(rowProductAmount({ ...heat, amount: 2 }, 0.5, 1)).toBeCloseTo(6)
  })
})

// ---------------------------------------------------------------------------
// Burner fuel
// ---------------------------------------------------------------------------

describe('computeNodeEffects — burner fuel', () => {
  const FUEL_MODULE: GameData['modules'][string] = {
    id: 'fuel-module',
    name: 'fuel-module',
    iconPath: '',
    category: 'speed',
    tier: 1,
    effects: { speed: 0.2, consumption: 0.5, productivity: 0, quality: 0 },
    limitation: [],
    limitationBlacklist: [],
  }

  function burnerGameData(machineOverrides: Partial<Machine> = {}): GameData {
    const smelt = { ...recipe(false), id: 'smelt', category: 'smelting', craftingTime: 3.2 }
    const gd = makeGameData({ smelt }, { 'fuel-module': FUEL_MODULE })
    const item = (id: string, extra = {}) => ({ id, name: id, type: 'item' as const, iconPath: '', hidden: false, subgroup: '', order: '', ...extra })
    gd.items = {
      coal: item('coal', { fuelValueKj: 4000, fuelCategory: 'chemical' }),
      'solid-fuel': item('solid-fuel', { fuelValueKj: 12000, fuelCategory: 'chemical' }),
    }
    gd.machines = {
      'stone-furnace': machine({
        id: 'stone-furnace', type: 'furnace', energyUsageKw: 90, energyType: 'burner', drainKw: 0,
        craftingCategories: ['smelting'], fuelCategories: ['chemical'], ...machineOverrides,
      }),
    }
    gd.defaultMachines = { smelting: 'stone-furnace' }
    return gd
  }

  const smeltNode = (extra: Partial<GameRecipeNode> = {}): GameRecipeNode => ({ ...node('n1', 'smelt'), ...extra })

  it('burns power x crafting time / fuel energy per execution', () => {
    // 90 kW x 3.2 s / 4000 kJ
    const fx = computeNodeEffects(smeltNode(), burnerGameData())
    expect(fx.fuel).toEqual({ itemId: 'coal', type: 'item', amount: 0.072 })
  })

  it('burns the default fuel of the defaultFuels overlay, but an explicit choice still wins', () => {
    const gd = burnerGameData()
    gd.defaultFuels = { 'stone-furnace': 'solid-fuel' }
    // 90 kW x 3.2 s / 12000 kJ
    expect(computeNodeEffects(smeltNode(), gd).fuel).toEqual({ itemId: 'solid-fuel', type: 'item', amount: 0.024 })
    expect(computeNodeEffects(smeltNode({ fuelItemId: 'coal' }), gd).fuel?.amount).toBeCloseTo(0.072)
  })

  it('falls back to the lowest-value fuel for a stale overlay entry', () => {
    const gd = burnerGameData()
    gd.defaultFuels = { 'stone-furnace': 'ghost' }
    expect(computeNodeEffects(smeltNode(), gd).fuel).toEqual({ itemId: 'coal', type: 'item', amount: 0.072 })
  })

  it('scales with speed and consumption bonuses', () => {
    // 90 x 1.5 x 3.2 / 1.2 / 4000
    const fx = computeNodeEffects(smeltNode({ modules: [{ moduleId: 'fuel-module', count: 1 }] }), burnerGameData())
    expect(fx.fuel?.amount).toBeCloseTo(0.09)
  })

  it('keeps burning 20 % of the fuel when consumption modules go below -80 %', () => {
    const gd = burnerGameData()
    gd.modules['fuel-module'] = { ...gd.modules['fuel-module'], effects: { consumption: -0.5 } }
    const fx = computeNodeEffects(smeltNode({ modules: [{ moduleId: 'fuel-module', count: 2 }] }), gd)
    // 90 x 0.2 x 3.2 / 4000
    expect(fx.fuel?.amount).toBeCloseTo(0.0144)
  })

  it('divides by the effectivity', () => {
    const fx = computeNodeEffects(smeltNode(), burnerGameData({ effectivity: 0.5 }))
    expect(fx.fuel?.amount).toBeCloseTo(0.144)
  })

  it('uses the crafting speed of the machine', () => {
    const fx = computeNodeEffects(smeltNode(), burnerGameData({ craftingSpeed: 2 }))
    expect(fx.fuel?.amount).toBeCloseTo(0.036)
  })

  it('burns the chosen fuel, and the default when the choice is not accepted', () => {
    const gd = burnerGameData()
    expect(computeNodeEffects(smeltNode({ fuelItemId: 'solid-fuel' }), gd).fuel)
      .toEqual({ itemId: 'solid-fuel', type: 'item', amount: 0.024 })
    expect(computeNodeEffects(smeltNode({ fuelItemId: 'plate' }), gd).fuel?.itemId).toBe('coal')
  })

  it('uses the machine chosen on the row', () => {
    const gd = burnerGameData()
    gd.machines['steel-furnace'] = { ...gd.machines['stone-furnace'], id: 'steel-furnace', craftingSpeed: 2 }
    expect(computeNodeEffects(smeltNode({ machineId: 'steel-furnace' }), gd).fuel?.amount).toBeCloseTo(0.036)
  })

  it('is undefined for an electric machine, a burner without fuel data and an unknown recipe', () => {
    expect(computeNodeEffects(smeltNode(), burnerGameData({ energyType: 'electric' })).fuel).toBeUndefined()
    expect(computeNodeEffects(smeltNode(), burnerGameData({ fuelCategories: undefined })).fuel).toBeUndefined()
    expect(computeNodeEffects(smeltNode({ recipeId: 'missing' }), burnerGameData()).fuel).toBeUndefined()
    const noItems = burnerGameData()
    noItems.items = {}
    expect(computeNodeEffects(smeltNode(), noItems).fuel).toBeUndefined()
  })
  describe('fluid burners', () => {
    function fluidGameData(machineOverrides: Partial<Machine> = {}): GameData {
      const gd = burnerGameData({ energyType: 'fluid-burner', fuelCategories: undefined, ...machineOverrides })
      gd.items = {
        ...gd.items,
        crude: { id: 'crude', name: 'crude', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '', fuelValueKj: 300 },
      }
      return gd
    }

    it('burns a fluid fuel per unit', () => {
      // 90 kW x 3.2 s / 300 kJ per unit
      expect(computeNodeEffects(smeltNode(), fluidGameData()).fuel)
        .toEqual({ itemId: 'crude', type: 'fluid', amount: 0.96 })
    })

    it('divides by the effectivity', () => {
      expect(computeNodeEffects(smeltNode(), fluidGameData({ effectivity: 0.5 })).fuel?.amount).toBeCloseTo(1.92)
    })

    it('keeps burning 20 % of the fuel at the consumption floor', () => {
      const gd = fluidGameData()
      gd.modules['fuel-module'] = { ...gd.modules['fuel-module'], effects: { consumption: -0.5 } }
      const fx = computeNodeEffects(smeltNode({ modules: [{ moduleId: 'fuel-module', count: 2 }] }), gd)
      expect(fx.fuel?.amount).toBeCloseTo(90 * 0.2 * 3.2 / 300)
    })

    it('scales with speed and consumption modules', () => {
      const fx = computeNodeEffects(smeltNode({ modules: [{ moduleId: 'fuel-module', count: 1 }] }), fluidGameData())
      expect(fx.fuel?.amount).toBeCloseTo(90 * 1.5 * 3.2 / 1.2 / 300)
    })

    it('is undefined without an accepted fluid or for a void machine', () => {
      expect(computeNodeEffects(smeltNode(), fluidGameData({ fuelFluid: 'water' })).fuel).toBeUndefined()
      expect(computeNodeEffects(smeltNode(), fluidGameData({ energyType: 'void' })).fuel).toBeUndefined()
    })
  })
})
