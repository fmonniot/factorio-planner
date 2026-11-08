import { describe, it, expect } from 'vitest'
import { solve } from './index'
import { collectFluidTemperatures, temperatureRows } from './temperatureRows'
import type { GameData, GameRecipeNode, SolverPlan } from '../data/types'

type GameRecipe = GameData['recipes'][string]

function recipe(id: string, ingredients: GameRecipe['ingredients'], products: GameRecipe['products']): GameRecipe {
  return {
    id, name: id, category: 'crafting', craftingTime: 1, ingredients, products, madeIn: [],
    allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  }
}

function gameData(recipes: GameRecipe[]): GameData {
  return {
    factorioVersion: '2.0.0', modSet: {}, items: { used: { id: 'used', name: 'Used', defaultTemperature: 300 } as GameData['items'][string] },
    recipes: Object.fromEntries(recipes.map(r => [r.id, r])), machines: {}, modules: {}, beacons: {},
    defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  }
}

const node = (id: string, recipeId: string): GameRecipeNode => ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} })
const fluid = (itemId: string, amount: number, extra: object = {}) => ({ itemId, type: 'fluid' as const, amount, ...extra })

/** hot (makes used at 300) → cool-300 (250..350 → 200) → cool-200 (150..250 → 100) → filter (≤ 50 → goal). */
const hot = recipe('hot', [], [fluid('used', 100)])
const cool300 = recipe('cool300', [fluid('used', 100, { minimumTemperature: 250, maximumTemperature: 350 })], [fluid('used', 100, { temperature: 200 })])
const cool200 = recipe('cool200', [fluid('used', 100, { minimumTemperature: 150, maximumTemperature: 250 })], [fluid('used', 100, { temperature: 25 })])
const filter = recipe('filter', [fluid('used', 100, { maximumTemperature: 50 })], [{ itemId: 'clean', type: 'item', amount: 1 }])

function plan(recipeIds: string[], goal: string, rate: number): SolverPlan {
  return {
    nodes: recipeIds.map(id => node(`n-${id}`, id)),
    goals: [{ id: 'g', itemId: goal, rate }],
    noImportItems: [],
  } as unknown as SolverPlan
}

const rate = (r: ReturnType<typeof solve>, id: string) => r.nodes.find(n => n.recipeNodeId === `n-${id}`)!.throughput

describe('fluid temperatures in the LP', () => {
  const gd = gameData([hot, cool300, cool200, filter])

  it('runs every step of a cooling chain', () => {
    const r = solve(plan(['hot', 'cool300', 'cool200', 'filter'], 'clean', 60), gd)
    for (const id of ['hot', 'cool300', 'cool200', 'filter']) expect(rate(r, id), id).toBeCloseTo(60)
    expect(r.unsatisfied, 'nothing imported').toEqual([])
  })

  it('imports the fluid when the chain is missing a step', () => {
    const r = solve(plan(['hot', 'cool300', 'filter'], 'clean', 60), gd)
    expect(rate(r, 'filter'), 'the filter still runs').toBeCloseTo(60)
    expect(r.unsatisfied.find(u => u.itemId === 'used')?.rate, 'the 200° coolant cannot feed it').toBeCloseTo(6000)
    expect(rate(r, 'hot'), 'the hot step is not run for nothing').toBeCloseTo(0)
  })

  it('shares a temperature between consumers that accept it', () => {
    // both coolers accept 200..250? no: cool200 takes 150..250, filter-b takes up to 250 as well
    const wide = recipe('wide', [fluid('used', 100, { maximumTemperature: 250 })], [{ itemId: 'other', type: 'item', amount: 1 }])
    const both = gameData([hot, cool300, cool200, wide])
    const r = solve({
      nodes: ['hot', 'cool300', 'cool200', 'wide'].map(id => node(`n-${id}`, id)),
      goals: [{ id: 'g', itemId: 'other', rate: 30 }],
      noImportItems: [],
    } as unknown as SolverPlan, both)
    expect(rate(r, 'wide')).toBeCloseTo(30)
    // `wide` takes the 200° (or 25°) output, never the 300° coolant.
    expect(rate(r, 'cool300') + rate(r, 'cool200')).toBeGreaterThan(29)
    expect(rate(r, 'hot')).toBeCloseTo(30)
  })

  it('leaves a fluid nobody bounds to the plain balance', () => {
    const plain = recipe('plain', [fluid('used', 100)], [{ itemId: 'clean', type: 'item', amount: 1 }])
    const r = solve(plan(['hot', 'plain'], 'clean', 60), gameData([hot, plain]))
    expect(rate(r, 'hot')).toBeCloseTo(60)
  })
})

describe('temperatureRows', () => {
  const effects = { productivityBonus: 0, heatBonus: 0 }
  const cols = (...rs: [string, GameRecipe][]) => rs.map(([id, recipe]) => ({ id, recipe, effects }))
  const gd = gameData([hot, cool300, cool200, filter])

  it('has no row when the one consumer class accepts every temperature made', () => {
    const any = recipe('any', [fluid('used', 1, { minimumTemperature: 100 })], [])
    const f = collectFluidTemperatures(gd, cols(['hot', hot], ['any', any]))
    expect(temperatureRows(f!.get('used')!)).toEqual([])
  })

  it('asks for the acceptable temperatures to cover a class', () => {
    const f = collectFluidTemperatures(gd, cols(['hot', hot], ['filter', filter]))
    // Nothing made at 50° or below: the filter's 100 per run has nothing to be covered by but imports.
    expect(temperatureRows(f!.get('used')!)).toEqual([new Map([['filter', -100]])])
  })

  it('checks every set of classes', () => {
    const f = collectFluidTemperatures(gd, cols(['hot', hot], ['cool300', cool300], ['cool200', cool200], ['filter', filter]))
    expect(temperatureRows(f!.get('used')!), '3 classes, 7 sets, some implied').not.toHaveLength(0)
  })

  it('ignores a fluid nothing makes', () => {
    expect(collectFluidTemperatures(gd, cols(['filter', filter]))).toBeUndefined()
  })
})
