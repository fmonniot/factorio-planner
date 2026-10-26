import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  parseGameData,
  loadGameDataFromJson,
  parseAppState,
  parsePlanIndex,
  parsePlanDataSetStamp,
  AppStateLoadError,
  GameDataLoadError,
} from './loader'
import { SubPlanSchema } from './schema'
import { BLOCK_PALETTE } from './blockColors'
import { ZodError } from 'zod'
import type { GameData, SubPlan, GameRecipeNode } from './types'

// ---------------------------------------------------------------------------
// Local helpers that mirror the old parsePlan / loadPlanFromJson API
// ---------------------------------------------------------------------------

function parsePlan(raw: unknown): SubPlan {
  const result = SubPlanSchema.safeParse(raw)
  if (!result.success) throw result.error
  return result.data
}

function loadPlanFromJson(json: string): SubPlan {
  return parsePlan(JSON.parse(json))
}

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
  // The literal omits fields with Zod-applied defaults (subgroup, order, hidden,
  // beacons, itemGroups, itemSubgroups). Cast through unknown — the parser tests
  // here exercise loadGameDataFromJson, which fills those defaults at runtime.
  return structuredClone({
    factorioVersion: '2.0.28',
    modSet: { base: '2.0.28', nullius: '1.8.6' },
    items: { 'iron-plate': minimalItem, water: minimalFluid },
    recipes: { 'iron-plate-recipe': minimalRecipe },
    machines: { 'electric-furnace': minimalMachine },
    modules: { 'productivity-module-3': minimalModule },
    defaultMachines: { smelting: 'electric-furnace' },
  }) as unknown as GameData
}

// minimalPlan is a SubPlan as returned by the schema after migration:
// no goals, no noImportItems — those live on the Block now.
function minimalPlan(): SubPlan {
  return structuredClone({
    id: 'plan-1',
    name: 'Test Plan',
    nodes: [
      {
        kind: 'game-recipe' as const,
        id: 'node-1',
        recipeId: 'iron-plate-recipe',
        modules: [{ moduleId: 'productivity-module-3', count: 2 }],
        byproductPolicy: {},
      },
    ],
    subPlans: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }) as SubPlan
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
      hidden: false,
      subgroup: '',
      order: '',
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
      hidden: false,
      subgroup: '',
      order: '',
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
      hidden: false,
      subgroup: '',
      order: '',
    }
    const data = parseGameData(gd)
    expect(data.recipes['oil-processing'].mainProduct).toBeNull()
  })

  it('normalises mainProduct="" (explicit multi-output sentinel) to null', () => {
    // build-game-data.js emits "" when main_product is explicitly empty (multi-output).
    const gd = minimalGameData()
    ;(gd.recipes['iron-plate-recipe'] as Record<string, unknown>).mainProduct = ''
    const data = parseGameData(gd)
    expect(data.recipes['iron-plate-recipe'].mainProduct).toBeNull()
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

describe('parseGameData — technologies', () => {
  it('defaults a bundle without technology data to empty collections', () => {
    const data = parseGameData(minimalGameData())
    expect(data.technologies).toEqual({})
    expect(data.startingRecipes).toEqual([])
  })

  it('normalises {} prerequisites to an empty list', () => {
    const gd = minimalGameData() as unknown as Record<string, unknown>
    gd.technologies = { electronics: { id: 'electronics', name: 'Electronics', prerequisites: {}, unlockedRecipes: {} } }
    const data = parseGameData(gd)
    expect(data.technologies.electronics.prerequisites).toEqual([])
    expect(data.technologies.electronics.unlockedRecipes).toEqual([])
  })

  it('strips unknown keys from a technology', () => {
    const gd = minimalGameData() as unknown as Record<string, unknown>
    gd.technologies = { electronics: { id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: [], bogus: 10 } }
    const data = parseGameData(gd)
    expect(data.technologies.electronics).not.toHaveProperty('bogus')
  })
})

describe('parseGameData — technology cost and icon', () => {
  it('defaults iconPath and leaves cost undefined for an older bundle', () => {
    const gd = minimalGameData() as unknown as Record<string, unknown>
    gd.technologies = { electronics: { id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: [] } }
    const t = parseGameData(gd).technologies.electronics
    expect(t.iconPath).toBe('')
    expect(t.cost).toBeUndefined()
  })

  it('keeps a cost, a null cost and a null count', () => {
    const gd = minimalGameData() as unknown as Record<string, unknown>
    const base = { prerequisites: [], unlockedRecipes: [] }
    gd.technologies = {
      a: { id: 'a', name: 'A', ...base, cost: { ingredients: [{ itemId: 'p', amount: 1 }], count: 10, time: 5 } },
      b: { id: 'b', name: 'B', ...base, cost: null },
      c: { id: 'c', name: 'C', ...base, cost: { ingredients: {}, count: null, time: 0 } },
    }
    const t = parseGameData(gd).technologies
    expect(t.a.cost?.count).toBe(10)
    expect(t.b.cost).toBeNull()
    expect(t.c.cost).toEqual({ ingredients: [], count: null, time: 0 })
  })
})

describe('parseGameData — extraction', () => {
  it('keeps a mining drill machine and the extraction flag of a recipe', () => {
    const gd = minimalGameData() as unknown as Record<string, Record<string, unknown>>
    gd.machines['electric-mining-drill'] = {
      ...minimalMachine, id: 'electric-mining-drill', type: 'mining-drill', craftingCategories: ['mining:basic-solid'],
    }
    gd.recipes['mining:iron-ore'] = {
      ...minimalRecipe, id: 'mining:iron-ore', category: 'mining:basic-solid', ingredients: [],
      products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }], madeIn: ['electric-mining-drill'], extraction: true,
    }
    const data = parseGameData(gd)
    expect(data.machines['electric-mining-drill'].type).toBe('mining-drill')
    expect(data.recipes['mining:iron-ore'].extraction).toBe(true)
  })

  it('leaves extraction undefined on a recipe without the flag', () => {
    const data = parseGameData(minimalGameData())
    expect(data.recipes['iron-plate-recipe'].extraction).toBeUndefined()
  })
})

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
// Plan (SubPlan) — happy path
// ---------------------------------------------------------------------------

describe('parsePlan', () => {
  it('accepts a valid minimal plan', () => {
    const plan = parsePlan(minimalPlan())
    expect(plan.id).toBe('plan-1')
    expect(plan.nodes).toHaveLength(1)
  })

  it('accepts a plan with no nodes', () => {
    const plan = minimalPlan()
    plan.nodes = []
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts a node with optional beacon config', () => {
    const plan = minimalPlan()
    ;(plan.nodes[0] as GameRecipeNode).beaconConfig = {
      moduleId: 'speed-module-3',
      beaconCount: 8,
      modulesPerBeacon: 2,
      distributionEfficiency: 1.0,
    }
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts a node with a pinned rate', () => {
    const plan = minimalPlan()
    ;(plan.nodes[0] as GameRecipeNode).pinnedRate = 10
    expect(() => parsePlan(plan)).not.toThrow()
  })

  it('accepts byproduct policy entries', () => {
    const plan = minimalPlan()
    ;(plan.nodes[0] as GameRecipeNode).byproductPolicy = { 'heavy-oil': 'discard', 'light-oil': 'feed-back' }
    const result = parsePlan(plan)
    expect((result.nodes[0] as GameRecipeNode).byproductPolicy['heavy-oil']).toBe('discard')
  })
})

// ---------------------------------------------------------------------------
// Plan (SubPlan) — validation errors
// ---------------------------------------------------------------------------

describe('parsePlan — validation errors', () => {
  it('throws ZodError for non-object input', () => {
    expect(() => parsePlan(null)).toThrow(ZodError)
  })

  it('throws ZodError when createdAt is not an ISO datetime', () => {
    const plan = minimalPlan() as Record<string, unknown>
    plan.createdAt = '2024-01-01'
    expect(() => parsePlan(plan)).toThrow(ZodError)
  })

  it('throws ZodError when byproductPolicy value is invalid', () => {
    const plan = minimalPlan()
    ;((plan.nodes[0] as GameRecipeNode).byproductPolicy as Record<string, unknown>)['iron-plate'] = 'ignore'
    expect(() => parsePlan(plan)).toThrow(ZodError)
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

  it('throws ZodError for valid JSON that fails schema', () => {
    expect(() => loadPlanFromJson('[]')).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// AppState — block connections
// ---------------------------------------------------------------------------

describe('parseAppState — inputConnections', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const rootPlan = () => ({ id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now })
  const blockJson = (extra: Record<string, unknown> = {}) => ({
    id: 'b1', name: 'Block', products: [], noImportItems: [], rootPlan: rootPlan(), ...extra,
  })

  it('defaults a block saved without inputConnections to an empty list', () => {
    const state = parseAppState({ blocks: [blockJson()], activeBlockId: 'b1' })
    expect(state.blocks[0].inputConnections).toEqual([])
  })

  it('defaults connectionsFirstItems to an empty list and round-trips a value', () => {
    expect(parseAppState({ blocks: [blockJson()], activeBlockId: 'b1' }).blocks[0].connectionsFirstItems).toEqual([])
    const state = parseAppState({ blocks: [blockJson({ connectionsFirstItems: ['x'] })], activeBlockId: 'b1' })
    expect(state.blocks[0].connectionsFirstItems).toEqual(['x'])
    expect(parseAppState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('gives a legacy block with sub-plan goals an empty connectionsFirstItems', () => {
    const legacy = blockJson({ products: undefined, rootPlan: { ...rootPlan(), goals: [{ id: 'g', itemId: 'iron-plate', rate: 60 }] } })
    expect(parseAppState({ blocks: [legacy], activeBlockId: 'b1' }).blocks[0].connectionsFirstItems).toEqual([])
  })

  it('hoists legacy per-subplan goals into products', () => {
    const legacy = blockJson({ products: undefined, rootPlan: { ...rootPlan(), goals: [{ id: 'g', itemId: 'iron-plate', rate: 60 }] } })
    const state = parseAppState({ blocks: [legacy], activeBlockId: 'b1' })
    expect(state.blocks[0].products).toEqual([{ id: 'g', itemId: 'iron-plate', extraRate: 60 }])
    expect(state.blocks[0].inputConnections).toEqual([])
  })

  it('round-trips connections through JSON unchanged', () => {
    const connections = [{ id: 'c1', itemId: 'iron-plate', fromBlockId: 'b0' }]
    const state = parseAppState({
      blocks: [blockJson({ id: 'b0' }), blockJson({ inputConnections: connections })],
      activeBlockId: 'b1',
    })
    expect(parseAppState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(state.blocks[1].inputConnections).toEqual(connections)
  })

  describe('maxRate', () => {
    const parseWith = (maxRate?: number) => parseAppState({
      blocks: [
        blockJson({ id: 'b0' }),
        blockJson({ inputConnections: [{ id: 'c1', itemId: 'iron-plate', fromBlockId: 'b0', ...(maxRate === undefined ? {} : { maxRate }) }] }),
      ],
      activeBlockId: 'b1',
    })

    it('round-trips a limit through JSON', () => {
      const state = parseWith(25)
      expect(state.blocks[1].inputConnections[0].maxRate).toBe(25)
      expect(parseAppState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    })

    it('loads a connection without a limit with no key', () => {
      expect('maxRate' in parseWith().blocks[1].inputConnections[0]).toBe(false)
    })

    it('reads a limit of 0 as no limit', () => {
      const c = parseWith(0).blocks[1].inputConnections[0]
      expect(c.maxRate).toBeUndefined()
      expect('maxRate' in c).toBe(false)
    })

    it('rejects a negative limit', () => {
      expect(() => parseWith(-1)).toThrow(AppStateLoadError)
    })
  })
})

describe('parseAppState — legacy pull connections', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const rootPlan = (extra: Record<string, unknown> = {}) => ({ id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now, ...extra })
  const blockJson = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, products: [], noImportItems: [], rootPlan: rootPlan(), ...extra,
  })
  const conn = (id: string, fromBlockId: string, extra: Record<string, unknown> = {}) => ({ id, itemId: 'iron-plate', fromBlockId, ...extra })
  const load = (blocks: Record<string, unknown>[]) => parseAppState({ blocks, activeBlockId: blocks[0].id })
  const byId = (state: ReturnType<typeof load>, id: string) => state.blocks.find(b => b.id === id)!
  const noPull = (state: ReturnType<typeof load>) =>
    expect(state.blocks.flatMap(b => b.inputConnections).every(c => !('pull' in c))).toBe(true)

  it('leaves the products alone when the source already has one for the item', () => {
    const products = [{ id: 'p', itemId: 'iron-plate', extraRate: 60 }]
    const state = load([blockJson('s', { products }), blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] })])
    expect(byId(state, 's').products).toEqual(products)
    noPull(state)
  })

  it('gives the source a product without extra when it had no goal for the item', () => {
    const state = load([blockJson('s'), blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] })])
    expect(byId(state, 's').products).toEqual([{ id: expect.any(String), itemId: 'iron-plate' }])
    expect('extraRate' in byId(state, 's').products[0]).toBe(false)
    noPull(state)
  })

  it('sees a goal that is only on the source root plan (hoisted first)', () => {
    const source = blockJson('s', { products: undefined, rootPlan: rootPlan({ goals: [{ id: 'g', itemId: 'iron-plate', rate: 30 }] }) })
    const state = load([source, blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] })])
    expect(byId(state, 's').products).toEqual([{ id: 'g', itemId: 'iron-plate', extraRate: 30 }])
    noPull(state)
  })

  it('adds nothing when the source receives the item from another block', () => {
    const state = load([
      blockJson('s', { inputConnections: [conn('cz', 'z')] }),
      blockJson('z'),
      blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] }),
    ])
    expect(byId(state, 's').products).toEqual([])
    noPull(state)
  })

  it('still adds the product when the source only "receives" the item from a missing block', () => {
    const state = load([
      blockJson('s', { inputConnections: [conn('cz', 'ghost')] }),
      blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] }),
    ])
    expect(byId(state, 's').products).toHaveLength(1)
    noPull(state)
  })

  it('ignores a pull that repeats an earlier push of the same (source, item)', () => {
    const state = load([
      blockJson('s'),
      blockJson('t', { inputConnections: [conn('c1', 's'), conn('c2', 's', { pull: true })] }),
    ])
    expect(byId(state, 's').products).toEqual([])
    noPull(state)
  })

  it('adds one product when two consumers pull the same item', () => {
    const state = load([
      blockJson('s'),
      blockJson('t', { inputConnections: [conn('c1', 's', { pull: true })] }),
      blockJson('u', { inputConnections: [conn('c2', 's', { pull: true })] }),
    ])
    expect(byId(state, 's').products).toHaveLength(1)
    noPull(state)
  })

  it('adds nothing for a pull from itself or from a missing block, and does not throw', () => {
    const state = load([
      blockJson('t', { inputConnections: [conn('c1', 't', { pull: true }), conn('c2', 'ghost', { pull: true })] }),
    ])
    expect(byId(state, 't').products).toEqual([])
    noPull(state)
  })

  it('drops pull: false and adds nothing', () => {
    const state = load([blockJson('s'), blockJson('t', { inputConnections: [conn('c', 's', { pull: false })] })])
    expect(byId(state, 's').products).toEqual([])
    noPull(state)
  })

  it('leaves a push to a goal item unchanged', () => {
    const products = [{ id: 'p', itemId: 'iron-plate', extraRate: 60 }]
    const state = load([blockJson('s', { products }), blockJson('t', { inputConnections: [conn('c', 's')] })])
    expect(byId(state, 's').products).toEqual(products)
    expect(byId(state, 't').inputConnections).toEqual([conn('c', 's')])
  })

  it('does not mutate the raw input', () => {
    const raw = {
      blocks: [blockJson('s'), blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] })],
      activeBlockId: 's',
    }
    const before = structuredClone(raw)
    parseAppState(raw)
    expect(raw).toEqual(before)
  })

  it('is idempotent', () => {
    const once = load([blockJson('s'), blockJson('t', { inputConnections: [conn('c', 's', { pull: true })] })])
    expect(parseAppState(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('parses the connection fixture saved before pull existed', () => {
    const raw = JSON.parse(readFileSync('e2e/fixtures/block-connection.json', 'utf8'))
    const state = parseAppState(raw.appState ?? raw)
    noPull(state)
    expect(state.blocks.every(b => b.products.length > 0)).toBe(true)
    expect(state.blocks.every(b => !('goals' in b))).toBe(true)
  })
})

describe('parseAppState — products migration', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const plan = (extra: Record<string, unknown> = {}) => ({
    id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now, ...extra,
  })
  const blockJson = (extra: Record<string, unknown> = {}) => ({
    id: 'b1', name: 'Block', noImportItems: [], rootPlan: plan(), ...extra,
  })
  const load = (block: Record<string, unknown>) => parseAppState({ blocks: [block], activeBlockId: 'b1' })

  it('loads block-level legacy goals as products', () => {
    const block = load(blockJson({ goals: [{ id: 'g', itemId: 'iron-plate', rate: 60 }] })).blocks[0]
    expect(block.products).toEqual([{ id: 'g', itemId: 'iron-plate', extraRate: 60 }])
    expect('goals' in block).toBe(false)
  })

  it('hoists sub-plan goals into one summed product and drops non-positive rates', () => {
    const rootPlan = plan({
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 20 }],
      subPlans: [plan({ id: 'child', goals: [{ id: 'g2', itemId: 'iron-plate', rate: 40 }, { id: 'g3', itemId: 'gear', rate: 0 }] })],
    })
    const block = load(blockJson({ rootPlan })).blocks[0]
    expect(block.products).toHaveLength(1)
    expect(block.products[0]).toMatchObject({ itemId: 'iron-plate', extraRate: 60 })
    expect('goals' in block.rootPlan).toBe(false)
    expect(block.rootPlan.subPlans.some(sp => 'goals' in sp)).toBe(false)
  })

  it('prefers block-level goals over sub-plan goals', () => {
    const rootPlan = plan({ goals: [{ id: 'g2', itemId: 'gear', rate: 5 }] })
    const block = load(blockJson({ rootPlan, goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }] })).blocks[0]
    expect(block.products).toEqual([{ id: 'g1', itemId: 'iron-plate', extraRate: 60 }])
  })

  it('falls through an empty legacy goals list to the hoisted sub-plan goals', () => {
    const rootPlan = plan({
      goals: [{ id: 'g', itemId: 'iron-plate', rate: 20 }],
      subPlans: [plan({ id: 'child', goals: [{ id: 'g2', itemId: 'iron-plate', rate: 40 }] })],
    })
    const block = load(blockJson({ rootPlan, goals: [] })).blocks[0]
    expect(block.products, 'one summed product from the sub-plan goals').toHaveLength(1)
    expect(block.products[0]).toMatchObject({ itemId: 'iron-plate', extraRate: 60 })
    expect('goals' in block, 'legacy goals key is dropped').toBe(false)
  })

  it('prefers non-empty products over legacy goals', () => {
    const block = load(blockJson({
      products: [{ id: 'p', itemId: 'gear', extraRate: 7 }],
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
    })).blocks[0]
    expect(block.products).toEqual([{ id: 'p', itemId: 'gear', extraRate: 7 }])
    expect('goals' in block).toBe(false)
  })

  it('passes already-migrated products through unchanged', () => {
    const products = [{ id: 'p', itemId: 'iron-plate', extraRate: 30 }]
    expect(load(blockJson({ products })).blocks[0].products).toEqual(products)
  })

  it('is idempotent', () => {
    const legacy = blockJson({
      goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      rootPlan: plan({ goals: [{ id: 'g2', itemId: 'gear', rate: 5 }] }),
    })
    const once = load(legacy)
    expect(parseAppState(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('loads a legacy goal with rate 0 as a product without extraRate', () => {
    const block = load(blockJson({ goals: [{ id: 'g', itemId: 'iron-plate', rate: 0 }] })).blocks[0]
    expect(block.products).toEqual([{ id: 'g', itemId: 'iron-plate' }])
    expect('extraRate' in block.products[0]).toBe(false)
  })

  it('loads a product with extraRate 0 as an absent key', () => {
    const block = load(blockJson({ products: [{ id: 'p', itemId: 'iron-plate', extraRate: 0 }] })).blocks[0]
    expect(block.products).toEqual([{ id: 'p', itemId: 'iron-plate' }])
    expect('extraRate' in block.products[0]).toBe(false)
  })

  it('round-trips a product without extraRate without the key', () => {
    const once = load(blockJson({ products: [{ id: 'p', itemId: 'iron-plate' }] }))
    expect('extraRate' in once.blocks[0].products[0]).toBe(false)
    expect(parseAppState(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it.each([
    ['a legacy goal with a negative rate', { goals: [{ id: 'g', itemId: 'iron-plate', rate: -5, extraRate: -1 }] }],
    ['a product with a negative extraRate', { products: [{ id: 'p', itemId: 'iron-plate', extraRate: -1 }] }],
  ])('rejects %s', (_name, extra) => {
    expect(() => load(blockJson(extra))).toThrow(AppStateLoadError)
  })
})

describe('parseAppState — sub-factory areas', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const plan = (extra: Record<string, unknown> = {}) => ({
    id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now, ...extra,
  })
  const load = (subPlans: unknown[]) =>
    parseAppState({
      blocks: [{ id: 'b1', name: 'Block', noImportItems: [], products: [], rootPlan: plan({ subPlans }) }],
      activeBlockId: 'b1',
    }).blocks[0].rootPlan.subPlans

  it('keeps area: true and adds no key when it is absent', () => {
    const [on, absent] = load([plan({ id: 'a', area: true }), plan({ id: 'b' })])
    expect(on.area).toBe(true)
    expect('area' in absent).toBe(false)
  })
})

describe('parsePlanDataSetStamp', () => {
  it('returns a full stamp whole', () => {
    const dataSet = { id: 'nullius', name: 'Nullius', factorioVersion: '2.0.9' }
    expect(parsePlanDataSetStamp({ dataSet })).toEqual(dataSet)
  })

  it('accepts a stamp with only an id', () => {
    expect(parsePlanDataSetStamp({ dataSet: { id: 'x' } })).toEqual({ id: 'x' })
  })

  it.each([
    ['no dataSet key', {}],
    ['a non-object stamp', { dataSet: 5 }],
    ['an empty id', { dataSet: { id: '' } }],
    ['a missing id', { dataSet: { name: 'N' } }],
    ['null', null],
    ['an array', []],
  ])('returns null for %s', (_label, raw) => {
    expect(parsePlanDataSetStamp(raw)).toBeNull()
  })

  it('is stripped by parseAppState', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const block = {
      id: 'b1', name: 'Block', products: [], noImportItems: [],
      rootPlan: { id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now },
    }
    const state = parseAppState({ blocks: [block], activeBlockId: 'b1', dataSet: { id: 'nullius' } })
    expect(state, 'stamp is stripped').not.toHaveProperty('dataSet')
  })
})

describe('parseAppState — block colours', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const blockJson = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, products: [], noImportItems: [],
    rootPlan: { id: `${id}-root`, name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now },
    ...extra,
  })

  it('gives a legacy block without a colour a palette colour', () => {
    const state = parseAppState({ blocks: [blockJson('a'), blockJson('b')], activeBlockId: 'a' })
    expect(state.blocks.map(b => b.color)).toEqual([BLOCK_PALETTE[0], BLOCK_PALETTE[1]])
  })

  it('gives the same colours when the same JSON is parsed twice', () => {
    const raw = { blocks: [blockJson('a'), blockJson('b'), blockJson('c')], activeBlockId: 'a' }
    expect(parseAppState(raw).blocks.map(b => b.color)).toEqual(parseAppState(raw).blocks.map(b => b.color))
  })

  it('keeps the colours a plan already has', () => {
    const state = parseAppState({
      blocks: [blockJson('a'), blockJson('b', { color: '#60a5fa' })],
      activeBlockId: 'a',
    })
    expect(state.blocks.map(b => b.color)).toEqual([BLOCK_PALETTE[1], '#60a5fa'])
  })
})

describe('parseAppState — legacy gameDataVersion', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const rootPlan = () => ({ id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now })
  const blockJson = (extra: Record<string, unknown> = {}) => ({
    id: 'b1', name: 'Block', products: [], noImportItems: [], rootPlan: rootPlan(), ...extra,
  })

  it('accepts a block with an empty legacy gameDataVersion and strips it', () => {
    const state = parseAppState({ blocks: [blockJson({ gameDataVersion: '' })], activeBlockId: 'b1' })
    expect(state.blocks[0], 'legacy key is stripped').not.toHaveProperty('gameDataVersion')
  })

  it('accepts a non-empty legacy gameDataVersion', () => {
    const state = parseAppState({ blocks: [blockJson({ gameDataVersion: '2.0.76' })], activeBlockId: 'b1' })
    expect(state.blocks[0].name).toBe('Block')
  })

  it('accepts a block without the key', () => {
    const state = parseAppState({ blocks: [blockJson()], activeBlockId: 'b1' })
    expect(state.blocks[0].name).toBe('Block')
  })

  it('does not re-export the legacy key', () => {
    const legacy = { blocks: [blockJson({ gameDataVersion: '2.0.76' })], activeBlockId: 'b1' }
    expect(JSON.stringify(parseAppState(legacy)), 'export drops the key').not.toContain('gameDataVersion')
  })
})

describe('parseAppState — horizonTechnologyIds', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const block = {
    id: 'b1', name: 'Block', products: [], noImportItems: [],
    rootPlan: { id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now },
  }

  it('defaults a plan saved without a horizon to an empty list', () => {
    expect(parseAppState({ blocks: [block], activeBlockId: 'b1' }).horizonTechnologyIds).toEqual([])
  })

  it('round-trips the horizon through JSON unchanged', () => {
    const state = parseAppState({ blocks: [block], activeBlockId: 'b1', horizonTechnologyIds: ['electronics'] })
    expect(parseAppState(JSON.parse(JSON.stringify(state))).horizonTechnologyIds).toEqual(['electronics'])
  })

  it('defaults missing default machine overrides to an empty record and keeps stored ones', () => {
    expect(parseAppState({ blocks: [block], activeBlockId: 'b1' }).defaultMachineOverrides).toEqual({})
    const state = parseAppState({ blocks: [block], activeBlockId: 'b1', defaultMachineOverrides: { crafting: 'asm-2' } })
    expect(state.defaultMachineOverrides).toEqual({ crafting: 'asm-2' })
  })
})

describe('parsePlanIndex', () => {
  it('accepts a valid index', () => {
    const index = { activePlanId: 'a', plans: [{ id: 'a', name: 'Plan 1' }] }
    expect(parsePlanIndex(index)).toEqual(index)
  })

  it('throws AppStateLoadError when plans is missing', () => {
    expect(() => parsePlanIndex({ activePlanId: 'a' })).toThrow(AppStateLoadError)
  })
})
