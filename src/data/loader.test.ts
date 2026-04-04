import { describe, it, expect } from 'vitest'
import {
  parseGameData,
  loadGameDataFromJson,
  parsePlan,
  loadPlanFromJson,
  GameDataLoadError,
  PlanLoadError,
} from './loader'
import type { GameData, Plan } from './types'

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const minimalItem = {
  id: 'iron-plate',
  name: 'Iron Plate',
  type: 'item' as const,
  iconPath: 'icons/iron-plate.png',
}

const minimalFluid = {
  id: 'water',
  name: 'Water',
  type: 'fluid' as const,
  iconPath: 'icons/water.png',
}

const minimalRecipe = {
  id: 'iron-plate-recipe',
  name: 'Iron Plate',
  category: 'smelting',
  craftingTime: 3.2,
  ingredients: [{ itemId: 'iron-ore', type: 'item' as const, amount: 1 }],
  products: [{ itemId: 'iron-plate', type: 'item' as const, amount: 1 }],
  madeIn: ['electric-furnace'],
  allowProductivity: true,
}

const minimalMachine = {
  id: 'electric-furnace',
  name: 'Electric Furnace',
  type: 'furnace' as const,
  craftingSpeed: 2,
  energyUsageKw: 180,
  energyType: 'electric' as const,
  drainKw: 6,
  moduleSlots: 2,
  allowedEffects: ['speed' as const, 'productivity' as const, 'consumption' as const],
  craftingCategories: ['smelting'],
  iconPath: 'icons/electric-furnace.png',
}

const minimalModule = {
  id: 'productivity-module-3',
  name: 'Productivity Module 3',
  category: 'productivity',
  tier: 3,
  effects: { productivity: 0.1, speed: -0.15, consumption: 0.8 },
  limitation: [],
  limitationBlacklist: [],
}

function minimalGameData(): GameData {
  // Use structuredClone so mutation in one test doesn't bleed into another
  return structuredClone({
    factorioVersion: '2.0.28',
    modSet: { base: '2.0.28', nullius: '1.8.6' },
    items: { 'iron-plate': minimalItem, water: minimalFluid },
    recipes: { 'iron-plate-recipe': minimalRecipe },
    machines: { 'electric-furnace': minimalMachine },
    modules: { 'productivity-module-3': minimalModule },
    defaultMachines: { smelting: 'electric-furnace' },
  }) as GameData
}

function minimalPlan(): Plan {
  return structuredClone({
    id: 'plan-1',
    name: 'Test Plan',
    gameDataVersion: '2.0.28',
    goals: [{ id: 'goal-1', itemId: 'iron-plate', rate: 60 }],
    nodes: [
      {
        id: 'node-1',
        recipeId: 'iron-plate-recipe',
        modules: [{ moduleId: 'productivity-module-3', count: 2 }],
        byproductPolicy: {},
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }) as Plan
}

// ---------------------------------------------------------------------------
// GameData — happy path
// ---------------------------------------------------------------------------

describe('parseGameData', () => {
  it('accepts a valid minimal GameData object', () => {
    const data = parseGameData(minimalGameData())
    expect(data.factorioVersion).toBe('2.0.28')
    expect(Object.keys(data.items)).toHaveLength(2)
    expect(Object.keys(data.recipes)).toHaveLength(1)
  })

  it('accepts a fluid item without stackSize', () => {
    const data = parseGameData(minimalGameData())
    expect(data.items.water.stackSize).toBeUndefined()
  })

  it('accepts a product with probability', () => {
    const gd = minimalGameData()
    gd.recipes['uranium-processing'] = {
      id: 'uranium-processing',
      name: 'Uranium Processing',
      category: 'centrifuging',
      craftingTime: 12,
      ingredients: [{ itemId: 'uranium-ore', type: 'item', amount: 10 }],
      products: [
        { itemId: 'uranium-235', type: 'item', amount: 1, probability: 0.007 },
        { itemId: 'uranium-238', type: 'item', amount: 1, probability: 0.993 },
      ],
      madeIn: ['centrifuge'],
      allowProductivity: true,
    }
    const data = parseGameData(gd)
    expect(data.recipes['uranium-processing'].products[0].probability).toBe(0.007)
  })

  it('accepts a product with ignoredByProductivity', () => {
    const gd = minimalGameData()
    gd.recipes['kovarex'] = {
      id: 'kovarex-enrichment-process',
      name: 'Kovarex Enrichment Process',
      category: 'centrifuging',
      craftingTime: 60,
      ingredients: [
        { itemId: 'uranium-235', type: 'item', amount: 40 },
        { itemId: 'uranium-238', type: 'item', amount: 5 },
      ],
      products: [
        { itemId: 'uranium-235', type: 'item', amount: 41, ignoredByProductivity: 40 },
        { itemId: 'uranium-238', type: 'item', amount: 2, ignoredByProductivity: 2 },
      ],
      madeIn: ['centrifuge'],
      allowProductivity: true,
    }
    const data = parseGameData(gd)
    expect(data.recipes['kovarex'].products[0].ignoredByProductivity).toBe(40)
  })

  it('accepts a recipe with mainProduct = null (multi-output)', () => {
    const gd = minimalGameData()
    gd.recipes['oil-processing'] = {
      id: 'oil-processing',
      name: 'Advanced Oil Processing',
      category: 'oil-processing',
      craftingTime: 5,
      ingredients: [
        { itemId: 'crude-oil', type: 'fluid', amount: 100 },
        { itemId: 'water', type: 'fluid', amount: 50 },
      ],
      products: [
        { itemId: 'heavy-oil', type: 'fluid', amount: 25 },
        { itemId: 'light-oil', type: 'fluid', amount: 45 },
        { itemId: 'petroleum-gas', type: 'fluid', amount: 55 },
      ],
      madeIn: ['oil-refinery'],
      allowProductivity: false,
      mainProduct: null,
    }
    const data = parseGameData(gd)
    expect(data.recipes['oil-processing'].mainProduct).toBeNull()
  })

  it('accepts an empty defaultMachines record', () => {
    const gd = minimalGameData()
    gd.defaultMachines = {}
    expect(() => parseGameData(gd)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// GameData — validation errors
// ---------------------------------------------------------------------------

describe('parseGameData — validation errors', () => {
  it('throws GameDataLoadError for non-object input', () => {
    expect(() => parseGameData('not an object')).toThrow(GameDataLoadError)
    expect(() => parseGameData(null)).toThrow(GameDataLoadError)
    expect(() => parseGameData(42)).toThrow(GameDataLoadError)
  })

  it('throws GameDataLoadError when factorioVersion is missing', () => {
    const gd = minimalGameData() as Record<string, unknown>
    delete gd.factorioVersion
    expect(() => parseGameData(gd)).toThrow(GameDataLoadError)
  })

  it('throws GameDataLoadError when item type is invalid', () => {
    const gd = minimalGameData()
    ;(gd.items['iron-plate'] as Record<string, unknown>).type = 'tool'
    expect(() => parseGameData(gd)).toThrow(GameDataLoadError)
  })

  it('throws GameDataLoadError when product amount is negative', () => {
    const gd = minimalGameData()
    gd.recipes['iron-plate-recipe'].products[0].amount = -1
    expect(() => parseGameData(gd)).toThrow(GameDataLoadError)
  })

  it('throws GameDataLoadError when probability is out of range', () => {
    const gd = minimalGameData()
    gd.recipes['iron-plate-recipe'].products[0] = {
      ...gd.recipes['iron-plate-recipe'].products[0],
      probability: 1.5,
    }
    expect(() => parseGameData(gd)).toThrow(GameDataLoadError)
  })

  it('throws GameDataLoadError when machine energyType is invalid', () => {
    const gd = minimalGameData()
    ;(gd.machines['electric-furnace'] as Record<string, unknown>).energyType = 'solar'
    expect(() => parseGameData(gd)).toThrow(GameDataLoadError)
  })

  it('includes readable issue descriptions in error message', () => {
    const gd = minimalGameData() as Record<string, unknown>
    delete gd.factorioVersion
    try {
      parseGameData(gd)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(GameDataLoadError)
      expect((e as GameDataLoadError).message).toContain('factorioVersion')
      expect((e as GameDataLoadError).issues.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// loadGameDataFromJson
// ---------------------------------------------------------------------------

describe('loadGameDataFromJson', () => {
  it('parses a valid JSON string', () => {
    const json = JSON.stringify(minimalGameData())
    const data = loadGameDataFromJson(json)
    expect(data.factorioVersion).toBe('2.0.28')
  })

  it('throws SyntaxError for malformed JSON', () => {
    expect(() => loadGameDataFromJson('{ bad json ')).toThrow(SyntaxError)
  })

  it('throws GameDataLoadError for valid JSON that fails schema', () => {
    expect(() => loadGameDataFromJson('"just a string"')).toThrow(GameDataLoadError)
  })
})

// ---------------------------------------------------------------------------
// Plan — happy path
// ---------------------------------------------------------------------------

describe('parsePlan', () => {
  it('accepts a valid minimal plan', () => {
    const plan = parsePlan(minimalPlan())
    expect(plan.id).toBe('plan-1')
    expect(plan.goals).toHaveLength(1)
    expect(plan.nodes).toHaveLength(1)
  })

  it('accepts a plan with no nodes or goals', () => {
    const plan = minimalPlan()
    plan.goals = []
    plan.nodes = []
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts a node with optional beacon config', () => {
    const plan = minimalPlan()
    plan.nodes[0].beaconConfig = {
      moduleId: 'speed-module-3',
      beaconCount: 8,
      modulesPerBeacon: 2,
      distributionEfficiency: 1.0,
    }
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts a node with a pinned rate', () => {
    const plan = minimalPlan()
    plan.nodes[0].pinnedRate = 10
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts byproduct policy entries', () => {
    const plan = minimalPlan()
    plan.nodes[0].byproductPolicy = { 'heavy-oil': 'discard', 'light-oil': 'feed-back' }
    const result = parsePlan(plan)
    expect(result.nodes[0].byproductPolicy['heavy-oil']).toBe('discard')
  })
})

// ---------------------------------------------------------------------------
// Plan — validation errors
// ---------------------------------------------------------------------------

describe('parsePlan — validation errors', () => {
  it('throws PlanLoadError for non-object input', () => {
    expect(() => parsePlan(null)).toThrow(PlanLoadError)
  })

  it('throws PlanLoadError when goal rate is not positive', () => {
    const plan = minimalPlan()
    plan.goals[0].rate = 0
    expect(() => parsePlan(plan)).toThrow(PlanLoadError)
  })

  it('throws PlanLoadError when createdAt is not an ISO datetime', () => {
    const plan = minimalPlan() as Record<string, unknown>
    plan.createdAt = '2024-01-01'
    expect(() => parsePlan(plan)).toThrow(PlanLoadError)
  })

  it('throws PlanLoadError when byproductPolicy value is invalid', () => {
    const plan = minimalPlan()
    ;(plan.nodes[0].byproductPolicy as Record<string, unknown>)['iron-plate'] = 'ignore'
    expect(() => parsePlan(plan)).toThrow(PlanLoadError)
  })
})

// ---------------------------------------------------------------------------
// loadPlanFromJson
// ---------------------------------------------------------------------------

describe('loadPlanFromJson', () => {
  it('parses a valid plan JSON string', () => {
    const json = JSON.stringify(minimalPlan())
    const plan = loadPlanFromJson(json)
    expect(plan.name).toBe('Test Plan')
  })

  it('throws SyntaxError for malformed JSON', () => {
    expect(() => loadPlanFromJson('{{ invalid')).toThrow(SyntaxError)
  })

  it('throws PlanLoadError for valid JSON that fails schema', () => {
    expect(() => loadPlanFromJson('[]')).toThrow(PlanLoadError)
  })
})
