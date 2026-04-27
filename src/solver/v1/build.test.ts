import { describe, it, expect } from 'vitest'
import { buildStoichiometryMatrix, effectiveProductAmount } from './build'
import type { GameData } from '../../data/types'

// ---------------------------------------------------------------------------
// Minimal GameData factory — only the fields the builder reads
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
// effectiveProductAmount unit tests
// ---------------------------------------------------------------------------

describe('effectiveProductAmount', () => {
  it('returns amount when no options set', () => {
    expect(effectiveProductAmount(5)).toBe(5)
  })

  it('applies probability', () => {
    expect(effectiveProductAmount(1, 0.007)).toBeCloseTo(0.007)
  })

  it('applies productivity to scalable portion only (Kovarex U-235)', () => {
    // amount=41, ibp=40, bonus=0.40 → 40 + 1×1.40 = 41.40
    expect(effectiveProductAmount(41, 1, 40, 0.4)).toBeCloseTo(41.4)
  })

  it('no effect when all output is fixed (Kovarex U-238)', () => {
    // amount=2, ibp=2 → 2 + 0×1.40 = 2
    expect(effectiveProductAmount(2, 1, 2, 0.4)).toBeCloseTo(2)
  })

  it('zero productivity bonus is a no-op', () => {
    expect(effectiveProductAmount(5, 1, 0, 0)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// buildStoichiometryMatrix — corpus case 1
// Linear chain: iron-ingot-1 and iron-plate-1
// ---------------------------------------------------------------------------

describe('buildStoichiometryMatrix — Case 1 (linear chain)', () => {
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

  it('produces correct dimensions', () => {
    const { S, items, recipes } = buildStoichiometryMatrix(gd, recipeIds)
    expect(items).toHaveLength(4) // iron-ore, nullius-gravel, nullius-iron-ingot, nullius-iron-plate
    expect(recipes).toHaveLength(2)
    expect(S).toHaveLength(4)
    expect(S[0]).toHaveLength(2)
  })

  it('iron-ore row: consumed by ingot recipe, absent in plate recipe', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, recipeIds)
    const row = itemIndex.get('iron-ore')!
    const col0 = recipeIndex.get('nullius-iron-ingot-1')!
    const col1 = recipeIndex.get('nullius-iron-plate-1')!
    expect(S[row][col0]).toBe(-5)
    expect(S[row][col1]).toBe(0)
  })

  it('nullius-iron-ingot row: produced by ingot recipe, consumed by plate recipe', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, recipeIds)
    const row = itemIndex.get('nullius-iron-ingot')!
    const col0 = recipeIndex.get('nullius-iron-ingot-1')!
    const col1 = recipeIndex.get('nullius-iron-plate-1')!
    expect(S[row][col0]).toBe(+2)
    expect(S[row][col1]).toBe(-4)
  })

  it('nullius-iron-plate row: produced by plate recipe only', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, recipeIds)
    const row = itemIndex.get('nullius-iron-plate')!
    const col0 = recipeIndex.get('nullius-iron-ingot-1')!
    const col1 = recipeIndex.get('nullius-iron-plate-1')!
    expect(S[row][col0]).toBe(0)
    expect(S[row][col1]).toBe(+3)
  })

  it('nullius-gravel row: produced by ingot recipe only', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, recipeIds)
    const row = itemIndex.get('nullius-gravel')!
    const col0 = recipeIndex.get('nullius-iron-ingot-1')!
    const col1 = recipeIndex.get('nullius-iron-plate-1')!
    expect(S[row][col0]).toBe(+1)
    expect(S[row][col1]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildStoichiometryMatrix — corpus case 4 (Kovarex cycle)
// U-235 appears as both input and output; net must be +1 per exec
// ---------------------------------------------------------------------------

describe('buildStoichiometryMatrix — Case 4 (Kovarex cycle)', () => {
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

  it('U-235 net stoichiometry is +1 (41 − 40) without productivity', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'kovarex-enrichment-process',
    ])
    const row = itemIndex.get('uranium-235')!
    const col = recipeIndex.get('kovarex-enrichment-process')!
    expect(S[row][col]).toBeCloseTo(1)
  })

  it('U-238 net stoichiometry is −3 (2 − 5) without productivity', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'kovarex-enrichment-process',
    ])
    const row = itemIndex.get('uranium-238')!
    const col = recipeIndex.get('kovarex-enrichment-process')!
    expect(S[row][col]).toBeCloseTo(-3)
  })

  it('U-235 net stoichiometry is +1.40 with +40% productivity bonus', () => {
    // 40 + (1 × 1.40) − 40 = 1.40
    const prodMap = new Map([['kovarex-enrichment-process', 0.4]])
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(
      gd,
      ['kovarex-enrichment-process'],
      prodMap,
    )
    const row = itemIndex.get('uranium-235')!
    const col = recipeIndex.get('kovarex-enrichment-process')!
    expect(S[row][col]).toBeCloseTo(1.4)
  })

  it('U-238 net stoichiometry is still −3 with productivity (all fixed)', () => {
    // ibp=2 covers entire output; productivity has no effect → net still 2−5=−3
    const prodMap = new Map([['kovarex-enrichment-process', 0.4]])
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(
      gd,
      ['kovarex-enrichment-process'],
      prodMap,
    )
    const row = itemIndex.get('uranium-238')!
    const col = recipeIndex.get('kovarex-enrichment-process')!
    expect(S[row][col]).toBeCloseTo(-3)
  })
})

// ---------------------------------------------------------------------------
// buildStoichiometryMatrix — corpus case 5 (probability outputs)
// ---------------------------------------------------------------------------

describe('buildStoichiometryMatrix — Case 5 (probability outputs)', () => {
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

  it('U-235 stoichiometry uses probability as effective yield', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'uranium-processing',
    ])
    const row = itemIndex.get('uranium-235')!
    const col = recipeIndex.get('uranium-processing')!
    expect(S[row][col]).toBeCloseTo(0.007)
  })

  it('U-238 stoichiometry uses probability as effective yield', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'uranium-processing',
    ])
    const row = itemIndex.get('uranium-238')!
    const col = recipeIndex.get('uranium-processing')!
    expect(S[row][col]).toBeCloseTo(0.993)
  })

  it('uranium-ore stoichiometry is −10', () => {
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'uranium-processing',
    ])
    const row = itemIndex.get('uranium-ore')!
    const col = recipeIndex.get('uranium-processing')!
    expect(S[row][col]).toBe(-10)
  })
})

// ---------------------------------------------------------------------------
// buildStoichiometryMatrix — edge cases
// ---------------------------------------------------------------------------

describe('buildStoichiometryMatrix — edge cases', () => {
  it('ignores recipe ids not present in gameData', () => {
    const gd = makeGameData({})
    const { recipes, items, S } = buildStoichiometryMatrix(gd, ['missing'])
    expect(recipes).toHaveLength(0)
    expect(items).toHaveLength(0)
    expect(S).toHaveLength(0)
  })

  it('handles fluid ingredients and products', () => {
    const gd = makeGameData({
      'nullius-air-separation-2': recipe(
        'nullius-air-separation-2',
        [fluid('nullius-air', 100)],
        [
          { itemId: 'nullius-nitrogen', type: 'fluid', amount: 66 },
          { itemId: 'nullius-residual-gas', type: 'fluid', amount: 3 },
          { itemId: 'nullius-carbon-dioxide', type: 'fluid', amount: 30 },
        ],
      ),
    })
    const { S, itemIndex, recipeIndex } = buildStoichiometryMatrix(gd, [
      'nullius-air-separation-2',
    ])
    const col = recipeIndex.get('nullius-air-separation-2')!
    expect(S[itemIndex.get('nullius-air')!][col]).toBe(-100)
    expect(S[itemIndex.get('nullius-nitrogen')!][col]).toBe(66)
    expect(S[itemIndex.get('nullius-residual-gas')!][col]).toBe(3)
    expect(S[itemIndex.get('nullius-carbon-dioxide')!][col]).toBe(30)
  })
})
