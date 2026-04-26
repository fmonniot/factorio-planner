import { describe, it, expect } from 'vitest'
import { buildStoichiometryMatrix } from './build'
import { reduceSystem } from './reduce'
import type { GameData } from '../../data/types'

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

// ---------------------------------------------------------------------------
// Case 1 — linear chain
// Goal: 60 nullius-iron-plate / min
// Expected: iron-ore=raw, gravel=byproduct, ingot=intermediate, plate=goal
// Reduced: 2 rows × 2 cols
// ---------------------------------------------------------------------------

describe('reduceSystem — Case 1 (linear chain)', () => {
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

  const recipeIds = ['nullius-iron-ingot-1', 'nullius-iron-plate-1']
  const matrix = buildStoichiometryMatrix(gd, recipeIds)
  const goals = new Map([['nullius-iron-plate', 60]])
  const system = reduceSystem(matrix, goals)

  it('classifies iron-ore as raw', () => {
    expect(system.itemClasses.get('iron-ore')).toBe('raw')
  })

  it('classifies nullius-gravel as byproduct', () => {
    expect(system.itemClasses.get('nullius-gravel')).toBe('byproduct')
  })

  it('classifies nullius-iron-ingot as intermediate', () => {
    expect(system.itemClasses.get('nullius-iron-ingot')).toBe('intermediate')
  })

  it('classifies nullius-iron-plate as goal', () => {
    expect(system.itemClasses.get('nullius-iron-plate')).toBe('goal')
  })

  it('reduced system has 2 rows and 2 cols', () => {
    expect(system.reducedItems).toHaveLength(2)
    expect(system.S).toHaveLength(2)
    expect(system.S[0]).toHaveLength(2)
  })

  it('demand vector: ingot row = 0, plate row = 60', () => {
    const ingotRow = system.reducedItems.indexOf('nullius-iron-ingot')
    const plateRow = system.reducedItems.indexOf('nullius-iron-plate')
    expect(system.d[ingotRow]).toBe(0)
    expect(system.d[plateRow]).toBe(60)
  })

  it('rawItems contains iron-ore', () => {
    expect(system.rawItems).toContain('iron-ore')
  })

  it('byproductItems contains nullius-gravel', () => {
    expect(system.byproductItems).toContain('nullius-gravel')
  })
})

// ---------------------------------------------------------------------------
// Case 2 — shared intermediate
// Goal: 30 nullius-iron-gear / min
// Expected: iron-ore=raw, gravel=byproduct, ingot/plate/rod=intermediate, gear=goal
// Reduced: 4 rows × 4 cols
// ---------------------------------------------------------------------------

describe('reduceSystem — Case 2 (shared intermediate)', () => {
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
  const matrix = buildStoichiometryMatrix(gd, recipeIds)
  const goals = new Map([['nullius-iron-gear', 30]])
  const system = reduceSystem(matrix, goals)

  it('reduced system has 4 rows (3 intermediates + 1 goal)', () => {
    expect(system.reducedItems).toHaveLength(4)
    expect(system.S).toHaveLength(4)
  })

  it('reduced system has 4 cols (one per recipe)', () => {
    expect(system.S[0]).toHaveLength(4)
  })

  it('rawItems contains iron-ore only', () => {
    expect(system.rawItems).toEqual(['iron-ore'])
  })

  it('byproductItems contains nullius-gravel only', () => {
    expect(system.byproductItems).toEqual(['nullius-gravel'])
  })

  it('demand vector: gear row = 30, all intermediate rows = 0', () => {
    for (let i = 0; i < system.reducedItems.length; i++) {
      const expected = system.reducedItems[i] === 'nullius-iron-gear' ? 30 : 0
      expect(system.d[i]).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// Case 3 — multi-output recipe
// Goal: 660 nullius-nitrogen / min
// Expected: nullius-air=raw, residual-gas/co2=byproduct, nitrogen=goal
// Reduced: 1 row × 1 col
// ---------------------------------------------------------------------------

describe('reduceSystem — Case 3 (multi-output)', () => {
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

  const matrix = buildStoichiometryMatrix(gd, ['nullius-air-separation-2'])
  const goals = new Map([['nullius-nitrogen', 660]])
  const system = reduceSystem(matrix, goals)

  it('reduced system is 1×1', () => {
    expect(system.reducedItems).toHaveLength(1)
    expect(system.S).toHaveLength(1)
    expect(system.S[0]).toHaveLength(1)
  })

  it('only nullius-nitrogen is in the reduced system', () => {
    expect(system.reducedItems).toEqual(['nullius-nitrogen'])
  })

  it('demand is 660', () => {
    expect(system.d[0]).toBe(660)
  })

  it('nullius-air is raw', () => {
    expect(system.itemClasses.get('nullius-air')).toBe('raw')
  })

  it('residual-gas and co2 are byproducts', () => {
    expect(system.itemClasses.get('nullius-residual-gas')).toBe('byproduct')
    expect(system.itemClasses.get('nullius-carbon-dioxide')).toBe('byproduct')
  })
})

// ---------------------------------------------------------------------------
// Case 4 — Kovarex cycle
// Goal: 5 uranium-235 / min
// U-235 net=+1, U-238 net=-3 → U-238 is raw (net negative, never net-produced)
// Reduced: 1 row × 1 col
// ---------------------------------------------------------------------------

describe('reduceSystem — Case 4 (Kovarex cycle)', () => {
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

  const matrix = buildStoichiometryMatrix(gd, ['kovarex-enrichment-process'])
  const goals = new Map([['uranium-235', 5]])
  const system = reduceSystem(matrix, goals)

  it('reduced system is 1×1 (only U-235 goal row)', () => {
    expect(system.reducedItems).toHaveLength(1)
    expect(system.reducedItems[0]).toBe('uranium-235')
  })

  it('U-238 is classified as raw (net stoichiometry is negative)', () => {
    expect(system.itemClasses.get('uranium-238')).toBe('raw')
  })

  it('demand is 5', () => {
    expect(system.d[0]).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Case 3b — two simultaneous goals
// Goals: 660 nullius-nitrogen/min + 300 nullius-carbon-dioxide/min
// Both are goals; co2 is no longer a byproduct
// ---------------------------------------------------------------------------

describe('reduceSystem — Case 3b (two simultaneous goals)', () => {
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

  const matrix = buildStoichiometryMatrix(gd, ['nullius-air-separation-2'])
  const goals = new Map([
    ['nullius-nitrogen', 660],
    ['nullius-carbon-dioxide', 300],
  ])
  const system = reduceSystem(matrix, goals)

  it('both goal items are in the reduced system', () => {
    expect(system.reducedItems).toContain('nullius-nitrogen')
    expect(system.reducedItems).toContain('nullius-carbon-dioxide')
  })

  it('nullius-carbon-dioxide is classified as goal, not byproduct', () => {
    expect(system.itemClasses.get('nullius-carbon-dioxide')).toBe('goal')
  })

  it('demand for nitrogen is 660 and for co2 is 300', () => {
    const nRow = system.reducedItems.indexOf('nullius-nitrogen')
    const cRow = system.reducedItems.indexOf('nullius-carbon-dioxide')
    expect(system.d[nRow]).toBe(660)
    expect(system.d[cRow]).toBe(300)
  })
})
