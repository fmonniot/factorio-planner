import { describe, it, expect } from 'vitest'
import { solve } from './index'
import type { GameData, SubPlan, GameRecipeNode } from '../../data/types'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeGameData(
  overrides: Partial<GameData> = {},
): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    defaultMachines: {},
    ...overrides,
  }
}

function makePlan(
  goals: SubPlan['goals'],
  nodes: SubPlan['nodes'],
): Pick<SubPlan, 'goals' | 'nodes'> {
  return { goals, nodes }
}

function item(itemId: string, amount: number) {
  return { itemId, type: 'item' as const, amount }
}

function fluid(itemId: string, amount: number) {
  return { itemId, type: 'fluid' as const, amount }
}

function product(
  itemId: string,
  amount: number,
  opts: { probability?: number; ignoredByProductivity?: number } = {},
) {
  return { itemId, type: 'item' as const, amount, ...opts }
}

function recipe(
  id: string,
  craftingTime: number,
  ingredients: GameData['recipes'][string]['ingredients'],
  products: GameData['recipes'][string]['products'],
  opts: { allowProductivity?: boolean; category?: string } = {},
): GameData['recipes'][string] {
  return {
    id,
    name: id,
    category: opts.category ?? 'crafting',
    craftingTime,
    ingredients,
    products,
    madeIn: [],
    allowProductivity: opts.allowProductivity ?? false,
    mainProduct: undefined,
  }
}

function planNode(
  id: string,
  recipeId: string,
  opts: {
    machineId?: string
    modules?: GameRecipeNode['modules']
    pinnedRate?: number
  } = {},
): GameRecipeNode {
  return {
    kind: 'game-recipe',
    id,
    recipeId,
    byproductPolicy: {},
    modules: opts.modules ?? [],
    ...(opts.machineId ? { machineId: opts.machineId } : {}),
    ...(opts.pinnedRate !== undefined ? { pinnedRate: opts.pinnedRate } : {}),
  }
}

function machinePrototype(
  id: string,
  craftingSpeed = 1,
): GameData['machines'][string] {
  return {
    id,
    name: id,
    type: 'assembling-machine',
    craftingSpeed,
    energyUsageKw: 150,
    energyType: 'electric',
    drainKw: 5,
    moduleSlots: 4,
    allowedEffects: ['speed', 'productivity', 'consumption', 'pollution', 'quality'],
    craftingCategories: ['crafting', 'dry-smelting', 'machine-casting', 'small-crafting', 'centrifuging'],
    iconPath: '',
  }
}

// ---------------------------------------------------------------------------
// Case 1 — linear chain
// Goal: 60 nullius-iron-plate / min
// Expected: plate=20, ingot=40 exec/min; raw iron-ore=200/min
// ---------------------------------------------------------------------------

describe('solve — Case 1 (linear chain)', () => {
  const gd = makeGameData({
    recipes: {
      'nullius-iron-ingot-1': recipe(
        'nullius-iron-ingot-1',
        8,
        [item('iron-ore', 5)],
        [product('nullius-iron-ingot', 2), product('nullius-gravel', 1)],
        { category: 'dry-smelting' },
      ),
      'nullius-iron-plate-1': recipe(
        'nullius-iron-plate-1',
        3,
        [item('nullius-iron-ingot', 4)],
        [product('nullius-iron-plate', 3)],
        { category: 'machine-casting' },
      ),
    },
    machines: { assembler: machinePrototype('assembler') },
    defaultMachines: { 'dry-smelting': 'assembler', 'machine-casting': 'assembler' },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'nullius-iron-plate', rate: 60 }],
    [
      planNode('n1', 'nullius-iron-ingot-1', { machineId: 'assembler' }),
      planNode('n2', 'nullius-iron-plate-1', { machineId: 'assembler' }),
    ],
  )

  const result = solve(plan, gd)

  it('returns 2 solved nodes', () => {
    expect(result.nodes).toHaveLength(2)
  })

  it('plate recipe throughput ≈ 20 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n2')!
    expect(n.throughput).toBeCloseTo(20)
  })

  it('ingot recipe throughput ≈ 40 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n1')!
    expect(n.throughput).toBeCloseTo(40)
  })

  it('raw iron-ore consumption ≈ 200/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'iron-ore')!
    expect(u).toBeDefined()
    expect(u.rate).toBeCloseTo(200)
  })

  it('machine count for plate recipe: 20 × (3/60) / 1 = 1', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n2')!
    expect(n.machineCountExact).toBeCloseTo(1)
    expect(n.machineCountCeil).toBe(1)
  })

  it('machine count for ingot recipe: 40 × (8/60) / 1 ≈ 5.333', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n1')!
    expect(n.machineCountExact).toBeCloseTo(5.333, 2)
    expect(n.machineCountCeil).toBe(6)
  })

  it('no warnings for a well-determined system', () => {
    expect(result.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Case 2 — shared intermediate
// Goal: 30 nullius-iron-gear / min
// Expected: gear=15, plate=10, rod=3, ingot=26 exec/min
// ---------------------------------------------------------------------------

describe('solve — Case 2 (shared intermediate)', () => {
  const gd = makeGameData({
    recipes: {
      'nullius-iron-ingot-1': recipe(
        'nullius-iron-ingot-1', 8,
        [item('iron-ore', 5)],
        [product('nullius-iron-ingot', 2), product('nullius-gravel', 1)],
      ),
      'nullius-iron-plate-1': recipe(
        'nullius-iron-plate-1', 3,
        [item('nullius-iron-ingot', 4)],
        [product('nullius-iron-plate', 3)],
      ),
      'nullius-iron-rod-1': recipe(
        'nullius-iron-rod-1', 4,
        [item('nullius-iron-ingot', 4)],
        [product('nullius-iron-rod', 5)],
      ),
      'nullius-iron-gear': recipe(
        'nullius-iron-gear', 4,
        [item('nullius-iron-plate', 2), item('nullius-iron-rod', 1)],
        [product('nullius-iron-gear', 2)],
      ),
    },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'nullius-iron-gear', rate: 30 }],
    [
      planNode('n1', 'nullius-iron-ingot-1'),
      planNode('n2', 'nullius-iron-plate-1'),
      planNode('n3', 'nullius-iron-rod-1'),
      planNode('n4', 'nullius-iron-gear'),
    ],
  )

  const result = solve(plan, gd)

  it('gear throughput ≈ 15 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n4')!
    expect(n.throughput).toBeCloseTo(15)
  })

  it('plate throughput ≈ 10 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n2')!
    expect(n.throughput).toBeCloseTo(10)
  })

  it('rod throughput ≈ 3 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n3')!
    expect(n.throughput).toBeCloseTo(3)
  })

  it('ingot throughput ≈ 26 exec/min', () => {
    const n = result.nodes.find(n => n.recipeNodeId === 'n1')!
    expect(n.throughput).toBeCloseTo(26)
  })

  it('raw iron-ore ≈ 130/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'iron-ore')!
    expect(u.rate).toBeCloseTo(130)
  })
})

// ---------------------------------------------------------------------------
// Case 3 — multi-output recipe
// Goal: 660 nullius-nitrogen / min
// Expected: air-separation ≈ 10 exec/min; nullius-air ≈ 1000/min raw
// ---------------------------------------------------------------------------

describe('solve — Case 3 (multi-output)', () => {
  const gd = makeGameData({
    recipes: {
      'nullius-air-separation-2': recipe(
        'nullius-air-separation-2', 1,
        [fluid('nullius-air', 100)],
        [
          { itemId: 'nullius-nitrogen', type: 'fluid', amount: 66 },
          { itemId: 'nullius-residual-gas', type: 'fluid', amount: 3 },
          { itemId: 'nullius-carbon-dioxide', type: 'fluid', amount: 30 },
        ],
      ),
    },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'nullius-nitrogen', rate: 660 }],
    [planNode('n1', 'nullius-air-separation-2')],
  )

  const result = solve(plan, gd)

  it('air-separation throughput ≈ 10 exec/min', () => {
    expect(result.nodes[0].throughput).toBeCloseTo(10)
  })

  it('nullius-air raw consumption ≈ 1000/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'nullius-air')!
    expect(u.rate).toBeCloseTo(1000)
  })
})

// ---------------------------------------------------------------------------
// Case 4 — Kovarex cycle
// Goal: 5 uranium-235 / min (net)
// Expected: kovarex ≈ 5 exec/min; U-238 ≈ 15/min raw
// ---------------------------------------------------------------------------

describe('solve — Case 4 (Kovarex cycle)', () => {
  const gd = makeGameData({
    recipes: {
      'kovarex-enrichment-process': recipe(
        'kovarex-enrichment-process', 60,
        [item('uranium-235', 40), item('uranium-238', 5)],
        [
          product('uranium-235', 41, { ignoredByProductivity: 40 }),
          product('uranium-238', 2, { ignoredByProductivity: 2 }),
        ],
        { allowProductivity: true },
      ),
    },
    machines: { centrifuge: machinePrototype('centrifuge') },
    defaultMachines: { centrifuging: 'centrifuge' },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'uranium-235', rate: 5 }],
    [planNode('n1', 'kovarex-enrichment-process', { machineId: 'centrifuge' })],
  )

  const result = solve(plan, gd)

  it('kovarex throughput ≈ 5 exec/min', () => {
    expect(result.nodes[0].throughput).toBeCloseTo(5)
  })

  it('uranium-238 raw consumption ≈ 15/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'uranium-238')!
    expect(u.rate).toBeCloseTo(15)
  })

  it('machine count ≈ 5 (5 exec × 60s / 60 / speed=1)', () => {
    expect(result.nodes[0].machineCountExact).toBeCloseTo(5)
  })
})

// ---------------------------------------------------------------------------
// Case 5 — probability outputs
// Goal: 1 uranium-235 / min
// Expected: uranium-processing ≈ 142.857 exec/min
// ---------------------------------------------------------------------------

describe('solve — Case 5 (probability outputs)', () => {
  const gd = makeGameData({
    recipes: {
      'uranium-processing': recipe(
        'uranium-processing', 12,
        [item('uranium-ore', 10)],
        [
          product('uranium-235', 1, { probability: 0.007 }),
          product('uranium-238', 1, { probability: 0.993 }),
        ],
      ),
    },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'uranium-235', rate: 1 }],
    [planNode('n1', 'uranium-processing')],
  )

  const result = solve(plan, gd)

  it('uranium-processing throughput ≈ 142.857 exec/min', () => {
    expect(result.nodes[0].throughput).toBeCloseTo(142.857, 2)
  })

  it('uranium-ore raw consumption ≈ 1428.571/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'uranium-ore')!
    expect(u.rate).toBeCloseTo(1428.571, 2)
  })
})

// ---------------------------------------------------------------------------
// Case 6 — Productivity + ignoredByProductivity
// Goal: 5 U-235 / min with 4× prod-3 (+40%)
// Expected: ≈3.571 exec/min (vs 5 without modules)
// ---------------------------------------------------------------------------

describe('solve — Case 6 (productivity modules)', () => {
  const gd = makeGameData({
    recipes: {
      'kovarex-enrichment-process': recipe(
        'kovarex-enrichment-process', 60,
        [item('uranium-235', 40), item('uranium-238', 5)],
        [
          product('uranium-235', 41, { ignoredByProductivity: 40 }),
          product('uranium-238', 2, { ignoredByProductivity: 2 }),
        ],
        { allowProductivity: true },
      ),
    },
    machines: { centrifuge: machinePrototype('centrifuge') },
    defaultMachines: { centrifuging: 'centrifuge' },
    modules: {
      'productivity-module-3': {
        id: 'productivity-module-3',
        name: 'productivity-module-3',
        category: 'productivity',
        tier: 3,
        effects: { productivity: 0.1, consumption: 0.8, speed: -0.15, quality: 0 },
        limitation: [],
        limitationBlacklist: [],
      },
    },
  })

  const plan = makePlan(
    [{ id: 'g1', itemId: 'uranium-235', rate: 5 }],
    [
      planNode('n1', 'kovarex-enrichment-process', {
        machineId: 'centrifuge',
        modules: [{ moduleId: 'productivity-module-3', count: 4 }],
      }),
    ],
  )

  const result = solve(plan, gd)

  it('throughput ≈ 3.571 exec/min (productivity reduces demand)', () => {
    expect(result.nodes[0].throughput).toBeCloseTo(3.571, 2)
  })

  it('U-238 raw consumption ≈ 10.714/min', () => {
    const u = result.unsatisfied.find(u => u.itemId === 'uranium-238')!
    expect(u.rate).toBeCloseTo(10.714, 2)
  })
})

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe('solve — warnings', () => {
  it('emits no-recipe warning when goal item has no active recipe', () => {
    const gd = makeGameData({ recipes: {} })
    const plan = makePlan(
      [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      [],
    )
    const result = solve(plan, gd)
    expect(result.warnings.some(w => w.type === 'no-recipe')).toBe(true)
  })

  it('emits productivity-not-allowed warning when modules used on restricted recipe', () => {
    const gd = makeGameData({
      recipes: {
        'iron-plate': recipe(
          'iron-plate', 1,
          [item('iron-ore', 1)],
          [product('iron-plate', 1)],
          { allowProductivity: false },
        ),
      },
      modules: {
        'prod-3': {
          id: 'prod-3',
          name: 'prod-3',
          category: 'productivity',
          tier: 3,
          effects: { productivity: 0.1, consumption: 0.5, speed: -0.15, quality: 0 },
          limitation: [],
          limitationBlacklist: [],
        },
      },
    })
    const plan = makePlan(
      [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
      [planNode('n1', 'iron-plate', { modules: [{ moduleId: 'prod-3', count: 2 }] })],
    )
    const result = solve(plan, gd)
    expect(
      result.warnings.some(w => w.type === 'productivity-not-allowed'),
    ).toBe(true)
  })
})
