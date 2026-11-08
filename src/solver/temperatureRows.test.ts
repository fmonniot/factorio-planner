import { describe, it, expect } from 'vitest'
import { solve } from './index'
import { buildClassifiedSystem, discardProduct } from './build'
import { temperatureRows } from './temperatureRows'
import type { GameData, GameRecipeNode } from '../data/types'
import type { SolverPlan } from './blockResult'

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

  it('cools the fluid before a consumer that takes several temperatures', () => {
    // `wide` takes up to 250°: the 200° and 25° outputs, not the 300° coolant. Without the rows the
    // LP would feed it straight from `hot` and leave cool300 idle.
    const wide = recipe('wide', [fluid('used', 100, { maximumTemperature: 250 })], [{ itemId: 'other', type: 'item', amount: 1 }])
    const r = solve(plan(['hot', 'cool300', 'cool200', 'wide'], 'other', 30), gameData([hot, cool300, cool200, wide]))
    expect(rate(r, 'wide')).toBeCloseTo(30)
    expect(rate(r, 'hot')).toBeCloseTo(30)
    expect(rate(r, 'cool300'), 'the 300° coolant is cooled first').toBeCloseTo(30)
    expect(rate(r, 'cool200'), 'one step is enough').toBeCloseTo(0)
    expect(r.unsatisfied).toEqual([])
  })

  it('leaves a fluid nobody bounds to the plain balance', () => {
    const plain = recipe('plain', [fluid('used', 100)], [{ itemId: 'clean', type: 'item', amount: 1 }])
    const r = solve(plan(['hot', 'plain'], 'clean', 60), gameData([hot, plain]))
    expect(rate(r, 'hot')).toBeCloseTo(60)
  })
})

describe('temperatureRows', () => {
  const gd = gameData([hot, cool300, cool200, filter])
  const rows = (g: GameData, ids: string[]) =>
    buildClassifiedSystem(g, ids, new Map()).fluidTemperatures?.get('used')

  it('has no row when the one consumer class accepts every temperature made', () => {
    const any = recipe('any', [fluid('used', 1, { minimumTemperature: 100 })], [])
    expect(temperatureRows(rows(gameData([hot, any]), ['hot', 'any'])!)).toEqual([])
  })

  it('asks for the acceptable temperatures to cover a class', () => {
    // Nothing made at 50° or below: the filter's 100 per run has nothing to be covered by but imports.
    expect(temperatureRows(rows(gd, ['hot', 'filter'])!)).toEqual([new Map([['filter', -100]])])
  })

  it('has one row per distinct set of accepted temperatures, not per set of classes', () => {
    const f = rows(gd, ['hot', 'cool300', 'cool200', 'filter'])!
    // temperatures made: 300, 200, 25; classes accept {300}, {200}, {25}: 7 unions, 1 of them everything.
    expect(temperatureRows(f)).toHaveLength(6)
  })

  it('enumerates every union of 10 single-temperature classes', () => {
    const temps = Array.from({ length: 10 }, (_, i) => (i + 1) * 10)
    const makers = temps.map(t => recipe(`make${t}`, [], [fluid('used', 1, { temperature: t })]))
    const takers = temps.map(t => recipe(`take${t}`, [fluid('used', 1, { minimumTemperature: t, maximumTemperature: t })], []))
    const f = rows(gameData([...makers, ...takers]), [...makers, ...takers].map(r => r.id))!
    const all = temperatureRows(f)
    expect(all, '2^10 - 1 unions, the whole one skipped').toHaveLength(1022)
    expect(all.some(r => r.size === 4 && r.get('take10') === -1 && r.get('take20') === -1 && r.get('make10') === 1 && r.get('make20') === 1), 'the pair').toBe(true)
  })

  it('falls back to single classes beyond MAX_ROWS unions', () => {
    // 13 single-temperature classes have 2^13 - 1 = 8191 unions: only the 13 classes are checked.
    const temps = Array.from({ length: 13 }, (_, i) => (i + 1) * 10)
    const makers = temps.map(t => recipe(`make${t}`, [], [fluid('used', 1, { temperature: t })]))
    const takers = temps.map(t => recipe(`take${t}`, [fluid('used', 1, { minimumTemperature: t, maximumTemperature: t })], []))
    const f = rows(gameData([...makers, ...takers]), [...makers, ...takers].map(r => r.id))!
    expect(temperatureRows(f)).toHaveLength(13)
  })

  it('ignores a fluid nothing makes', () => {
    expect(rows(gd, ['filter'])).toBeUndefined()
  })

  it('treats reactor heat as an unknown temperature', () => {
    const reactor = recipe('reactor', [], [{ itemId: 'power:heat', type: 'fluid', amount: 1, temperature: 750 }])
    const exch = recipe('exch', [{ itemId: 'power:heat', type: 'fluid', amount: 1, minimumTemperature: 765 }], [])
    const f = buildClassifiedSystem(gameData([reactor, exch]), ['reactor', 'exch'], new Map()).fluidTemperatures
    expect(f && temperatureRows(f.get('power:heat')!)).toEqual([])
  })
})

describe('goals and discarded products', () => {
  const gd = gameData([hot, filter])

  it('gives a goal fluid no rows rather than making the LP infeasible', () => {
    // The goal takes 100 of the 300° coolant, the pinned filter wants 100 that cannot be at ≤ 50°.
    const goalPlan = plan(['hot', 'filter'], 'used', 100) as unknown as { nodes: Record<string, unknown>[] }
    goalPlan.nodes[1].pinnedRate = 1
    const r = solve(goalPlan as unknown as SolverPlan, gd)
    expect(rate(r, 'hot'), 'the balance is still met').toBeCloseTo(2)
    expect(rate(r, 'filter')).toBeCloseTo(1)
  })

  it('keeps a discarded product out of the rows', () => {
    const c = buildClassifiedSystem(gd, ['hot', 'filter'], new Map())
    discardProduct(c, 'used', 'hot')
    expect(c.fluidTemperatures?.has('used'), 'nothing makes it any more').toBe(false)
    // A net producer that also takes the fluid within bounds drops out of both sides, as in `S`.
    const loop = recipe('loop', [fluid('used', 50, { maximumTemperature: 50 })], [fluid('used', 100)])
    const l = buildClassifiedSystem(gameData([hot, loop, filter]), ['hot', 'loop', 'filter'], new Map())
    discardProduct(l, 'used', 'loop')
    const f = l.fluidTemperatures!.get('used')!
    expect(f.producers.map(p => p.colId)).toEqual(['hot'])
    expect(f.consumers.map(c => c.colId)).toEqual(['filter'])
    const net = recipe('net', [fluid('used', 5)], [fluid('used', 1)])
    const d = buildClassifiedSystem(gameData([net, filter]), ['net', 'filter'], new Map())
    discardProduct(d, 'used', 'net')
    expect(d.fluidTemperatures?.get('used')?.producers, 'net consumer: nothing to discard').toHaveLength(1)
  })
})
