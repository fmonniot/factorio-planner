import { describe, it, expect } from 'vitest'
import { buildStoichiometryMatrix } from './build'
import { reduceSystem } from './reduce'
import { solveSystem } from './solve'
import type { GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeGameData(recipes: GameData['recipes']): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes,
    machines: {},
    modules: {},
    defaultMachines: {},
  }
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
  ingredients: GameData['recipes'][string]['ingredients'],
  products: GameData['recipes'][string]['products'],
): GameData['recipes'][string] {
  return {
    id,
    name: id,
    category: 'crafting',
    craftingTime: 1,
    ingredients,
    products,
    madeIn: [],
    allowProductivity: false,
    mainProduct: undefined,
  }
}

/** Build + reduce + solve in one step. Returns throughput map: recipeId → exec/min */
function solveFor(
  gd: GameData,
  recipeIds: string[],
  goals: Map<string, number>,
  productivityMap?: Map<string, number>,
): Map<string, number> {
  const matrix = buildStoichiometryMatrix(gd, recipeIds, productivityMap)
  const system = reduceSystem(matrix, goals)
  const result = solveSystem(system.S, system.d, matrix.recipes)
  return new Map(matrix.recipes.map((id, j) => [id, result.throughput[j]]))
}

// ---------------------------------------------------------------------------
// Case 1 — linear chain
// Goal: 60 nullius-iron-plate / min
// Expected: plate=20, ingot=40 exec/min
// ---------------------------------------------------------------------------

describe('solveSystem — Case 1 (linear chain)', () => {
  const gd = makeGameData({
    'nullius-iron-ingot-1': recipe(
      'nullius-iron-ingot-1',
      [item('iron-ore', 5)],
      [product('nullius-iron-ingot', 2), product('nullius-gravel', 1)],
    ),
    'nullius-iron-plate-1': recipe(
      'nullius-iron-plate-1',
      [item('nullius-iron-ingot', 4)],
      [product('nullius-iron-plate', 3)],
    ),
  })

  it('plate recipe runs at 20 exec/min', () => {
    const throughput = solveFor(
      gd,
      ['nullius-iron-ingot-1', 'nullius-iron-plate-1'],
      new Map([['nullius-iron-plate', 60]]),
    )
    expect(throughput.get('nullius-iron-plate-1')).toBeCloseTo(20)
  })

  it('ingot recipe runs at 40 exec/min', () => {
    const throughput = solveFor(
      gd,
      ['nullius-iron-ingot-1', 'nullius-iron-plate-1'],
      new Map([['nullius-iron-plate', 60]]),
    )
    expect(throughput.get('nullius-iron-ingot-1')).toBeCloseTo(40)
  })

  it('produces no warnings for a well-determined system', () => {
    const matrix = buildStoichiometryMatrix(gd, [
      'nullius-iron-ingot-1',
      'nullius-iron-plate-1',
    ])
    const system = reduceSystem(matrix, new Map([['nullius-iron-plate', 60]]))
    const result = solveSystem(system.S, system.d, matrix.recipes)
    expect(result.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Case 2 — shared intermediate
// Goal: 30 nullius-iron-gear / min
// Expected: gear=15, plate=10, rod=3, ingot=26 exec/min
// ---------------------------------------------------------------------------

describe('solveSystem — Case 2 (shared intermediate)', () => {
  const gd = makeGameData({
    'nullius-iron-ingot-1': recipe(
      'nullius-iron-ingot-1',
      [item('iron-ore', 5)],
      [product('nullius-iron-ingot', 2), product('nullius-gravel', 1)],
    ),
    'nullius-iron-plate-1': recipe(
      'nullius-iron-plate-1',
      [item('nullius-iron-ingot', 4)],
      [product('nullius-iron-plate', 3)],
    ),
    'nullius-iron-rod-1': recipe(
      'nullius-iron-rod-1',
      [item('nullius-iron-ingot', 4)],
      [product('nullius-iron-rod', 5)],
    ),
    'nullius-iron-gear': recipe(
      'nullius-iron-gear',
      [item('nullius-iron-plate', 2), item('nullius-iron-rod', 1)],
      [product('nullius-iron-gear', 2)],
    ),
  })

  const recipeIds = [
    'nullius-iron-ingot-1',
    'nullius-iron-plate-1',
    'nullius-iron-rod-1',
    'nullius-iron-gear',
  ]
  const goals = new Map([['nullius-iron-gear', 30]])

  it('gear recipe runs at 15 exec/min', () => {
    const t = solveFor(gd, recipeIds, goals)
    expect(t.get('nullius-iron-gear')).toBeCloseTo(15)
  })

  it('plate recipe runs at 10 exec/min', () => {
    const t = solveFor(gd, recipeIds, goals)
    expect(t.get('nullius-iron-plate-1')).toBeCloseTo(10)
  })

  it('rod recipe runs at 3 exec/min', () => {
    const t = solveFor(gd, recipeIds, goals)
    expect(t.get('nullius-iron-rod-1')).toBeCloseTo(3)
  })

  it('ingot recipe runs at 26 exec/min', () => {
    const t = solveFor(gd, recipeIds, goals)
    expect(t.get('nullius-iron-ingot-1')).toBeCloseTo(26)
  })
})

// ---------------------------------------------------------------------------
// Case 3 — multi-output recipe
// Goal: 660 nullius-nitrogen / min
// Expected: air-separation runs at 10 exec/min
// ---------------------------------------------------------------------------

describe('solveSystem — Case 3 (multi-output)', () => {
  const gd = makeGameData({
    'nullius-air-separation-2': recipe(
      'nullius-air-separation-2',
      [fluid('nullius-air', 100)],
      [
        { itemId: 'nullius-nitrogen', type: 'fluid' as const, amount: 66 },
        { itemId: 'nullius-residual-gas', type: 'fluid' as const, amount: 3 },
        { itemId: 'nullius-carbon-dioxide', type: 'fluid' as const, amount: 30 },
      ],
    ),
  })

  it('air-separation runs at 10 exec/min for 660 nitrogen/min', () => {
    const t = solveFor(
      gd,
      ['nullius-air-separation-2'],
      new Map([['nullius-nitrogen', 660]]),
    )
    expect(t.get('nullius-air-separation-2')).toBeCloseTo(10)
  })

  it('Case 3b: same rate satisfies both nitrogen=660 and co2=300 simultaneously', () => {
    const t = solveFor(
      gd,
      ['nullius-air-separation-2'],
      new Map([
        ['nullius-nitrogen', 660],
        ['nullius-carbon-dioxide', 300],
      ]),
    )
    expect(t.get('nullius-air-separation-2')).toBeCloseTo(10)
  })
})

// ---------------------------------------------------------------------------
// Case 4 — Kovarex cycle
// Goal: 5 uranium-235 / min (net)
// Expected: kovarex runs at 5 exec/min
// ---------------------------------------------------------------------------

describe('solveSystem — Case 4 (Kovarex cycle)', () => {
  const gd = makeGameData({
    'kovarex-enrichment-process': recipe(
      'kovarex-enrichment-process',
      [item('uranium-235', 40), item('uranium-238', 5)],
      [
        product('uranium-235', 41, { ignoredByProductivity: 40 }),
        product('uranium-238', 2, { ignoredByProductivity: 2 }),
      ],
    ),
  })

  it('kovarex runs at 5 exec/min for 5 U-235/min net', () => {
    const t = solveFor(
      gd,
      ['kovarex-enrichment-process'],
      new Map([['uranium-235', 5]]),
    )
    expect(t.get('kovarex-enrichment-process')).toBeCloseTo(5)
  })
})

// ---------------------------------------------------------------------------
// Case 5 — probability outputs
// Goal: 1 uranium-235 / min
// Expected: uranium-processing at ≈142.857 exec/min
// ---------------------------------------------------------------------------

describe('solveSystem — Case 5 (probability outputs)', () => {
  const gd = makeGameData({
    'uranium-processing': recipe(
      'uranium-processing',
      [item('uranium-ore', 10)],
      [
        product('uranium-235', 1, { probability: 0.007 }),
        product('uranium-238', 1, { probability: 0.993 }),
      ],
    ),
  })

  it('uranium-processing runs at ≈142.857 exec/min for 1 U-235/min', () => {
    const t = solveFor(
      gd,
      ['uranium-processing'],
      new Map([['uranium-235', 1]]),
    )
    expect(t.get('uranium-processing')).toBeCloseTo(142.857, 2)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('solveSystem — edge cases', () => {
  it('returns empty throughput for an empty recipe set', () => {
    const result = solveSystem([], [], [])
    expect(result.throughput).toEqual([])
    expect(result.warnings).toHaveLength(0)
  })

  it('emits underdetermined warning for a non-square system', () => {
    // 1 item equation, 2 recipes → under-determined
    const S = [[1, 1]] // 1 row, 2 cols
    const d = [10]
    const result = solveSystem(S, d, ['recipe-a', 'recipe-b'])
    expect(result.warnings.some(w => w.type === 'underdetermined')).toBe(true)
  })
})
