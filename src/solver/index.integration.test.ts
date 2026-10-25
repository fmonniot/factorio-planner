import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { solve, solveAll, netBalance } from './index'
import { loadGameDataFromJson } from '../data/loader'
import type { Block, BlockConnection, GameRecipeNode, Product, SolverGoal, RecipeNode, SolverResult } from '../data/types'

// Real-data counterpart to synthetic.test.ts: runs the solver on the committed
// Nullius export (public/data/nullius/game-data.json) and asserts invariants (finite,
// non-negative flows, positive machine counts, mass balance, a machine for every category).
// synthetic.test.ts stays on synthetic fixtures so a re-export cannot break it; this file reads the
// real export, so a re-export that renames or re-balances recipes may break it. That is intended.
// A second describe runs multi-block plans (loops of requests) on the bundled Seablock export.

const GAME_DATA_PATH = resolve(import.meta.dirname, '../../public/data/nullius/game-data.json')
const gameData = loadGameDataFromJson(readFileSync(GAME_DATA_PATH, 'utf-8'))

const EPS = 1e-9
const FLOW_EPS = 1e-6
// Matches the solver's own GOAL_SHORTFALL_TOLERANCE: below it a shortfall is not reported.
const GOAL_EPS = 1e-4

function planNode(recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id: recipeId, recipeId, modules: [], byproductPolicy: {} }
}

function makePlan(goals: Array<[string, number]>, recipeIds: string[]) {
  const plan: { goals: SolverGoal[]; nodes: RecipeNode[] } = {
    goals: goals.map(([itemId, rate], i) => ({ id: `g${i}`, itemId, rate })),
    nodes: recipeIds.map(planNode),
  }
  return plan
}

function nodeOf(result: SolverResult, recipeId: string) {
  const n = result.nodes.find(x => x.recipeNodeId === recipeId)
  if (!n) throw new Error(`no solved node for ${recipeId}`)
  return n
}

function unsatisfiedRate(result: SolverResult, itemId: string): number | undefined {
  return result.unsatisfied.find(u => u.itemId === itemId)?.rate
}

function expectNonNegativeFinite(value: number, label: string) {
  expect(Number.isFinite(value), `${label} is finite`).toBe(true)
  expect(value, `${label} is non-negative`).toBeGreaterThanOrEqual(-EPS)
}

/** Invariants that must hold for any solve on the real data. */
function expectSane(result: SolverResult, plan: ReturnType<typeof makePlan>, label = '') {
  const at = label ? ` (${label})` : ''
  expect(result.nodes.length, `solved nodes${at}`).toBeGreaterThan(0)

  for (const goal of plan.goals) {
    // Delivered net of internal consumption, plus whatever the solver reports as a shortfall.
    const delivered = (netBalance(result.nodes).get(goal.itemId) ?? 0) + (unsatisfiedRate(result, goal.itemId) ?? 0)
    expect(delivered, `goal ${goal.itemId} reaches ${goal.rate}/min${at}`).toBeGreaterThanOrEqual(goal.rate - GOAL_EPS)
    expect(
      result.warnings.some(w => w.type === 'no-recipe' && w.itemId === goal.itemId),
      `no no-recipe warning for goal ${goal.itemId}${at}`,
    ).toBe(false)
  }

  for (const node of result.nodes) {
    const id = `${node.recipeNodeId}${at}`
    for (const [item, rate] of Object.entries(node.inputRates)) expectNonNegativeFinite(rate, `${id} input ${item}`)
    for (const [item, rate] of Object.entries(node.outputRates)) expectNonNegativeFinite(rate, `${id} output ${item}`)
    expectNonNegativeFinite(node.throughput, `${id} throughput`)
    expectNonNegativeFinite(node.machineCountExact, `${id} machineCountExact`)
    expectNonNegativeFinite(node.powerKw, `${id} powerKw`)
    expect(node.throughput, `${id} throughput is positive`).toBeGreaterThan(0)
    expect(node.machineCountExact, `${id} machineCountExact is positive`).toBeGreaterThan(0)
    expect(Number.isInteger(node.machineCountCeil), `${id} machineCountCeil is an integer`).toBe(true)
    expect(node.machineCountCeil, `${id} machineCountCeil covers machineCountExact`).toBeGreaterThanOrEqual(
      node.machineCountExact - EPS,
    )
  }

  for (const u of result.unsatisfied) expectNonNegativeFinite(u.rate, `unsatisfied ${u.itemId}${at}`)

  // Mass balance: whatever the nodes consume beyond what they produce is listed as an import.
  const net = netBalance(result.nodes)
  // An item can appear twice in `unsatisfied` (goal shortfall and slack), so sum the entries.
  const imported = new Map<string, number>()
  for (const u of result.unsatisfied) imported.set(u.itemId, (imported.get(u.itemId) ?? 0) + u.rate)
  for (const [item, balance] of net) {
    const covered = balance + (imported.get(item) ?? 0)
    expect(covered, `mass balance of ${item}${at}`).toBeGreaterThanOrEqual(-FLOW_EPS)
    // Imports must not exceed the deficit (surplus items are exempt: they import nothing extra).
    if (balance < 0) expect(covered, `import of ${item} does not exceed its deficit${at}`).toBeLessThanOrEqual(FLOW_EPS)
  }
}

describe('solver on the real Nullius data', () => {
  it('solves the iron gear chain with pinned craft rates', () => {
    // Values derive from the recipe amounts in the export, so they may need updating on a re-export.
    const plan = makePlan([['nullius-iron-gear', 60]], [
      'nullius-iron-gear',
      'nullius-iron-plate',
      'nullius-iron-rod',
      'nullius-iron-ingot',
    ])
    const r = solve(plan, gameData)
    expectSane(r, plan)
    expect(nodeOf(r, 'nullius-iron-gear').throughput).toBeCloseTo(30, 3)
    expect(nodeOf(r, 'nullius-iron-plate').throughput).toBeCloseTo(20, 3)
    expect(nodeOf(r, 'nullius-iron-rod').throughput).toBeCloseTo(6, 3)
    expect(nodeOf(r, 'nullius-iron-ingot').throughput).toBeCloseTo(52, 3)
    expect(unsatisfiedRate(r, 'iron-ore')).toBeCloseTo(260, 3)
    expect(r.warnings).toEqual([])
  })

  it('reports slack when a pinned intermediate producer cannot meet demand', () => {
    // Gear needs 20 plates/min for 60 gears/min, but the plate node is pinned to 5 crafts/min.
    const plan = makePlan([['nullius-iron-gear', 60]], [
      'nullius-iron-gear',
      'nullius-iron-plate',
      'nullius-iron-rod',
      'nullius-iron-ingot',
    ])
    const plate = plan.nodes.find(n => n.id === 'nullius-iron-plate')
    if (plate?.kind !== 'game-recipe') throw new Error('plate node missing')
    plate.pinnedRate = 5
    const r = solve(plan, gameData)
    expectSane(r, plan)
    expect(nodeOf(r, 'nullius-iron-plate').throughput).toBeCloseTo(5, 3)
    const slack = unsatisfiedRate(r, 'nullius-iron-plate')
    expect(slack, 'plate slack is reported as an import').toBeGreaterThan(0)
    // Slack comes right after goal shortfalls and before raw consumption.
    const ids = r.unsatisfied.map(u => u.itemId)
    expect(ids.indexOf('nullius-iron-plate')).toBeLessThan(ids.indexOf('iron-ore'))
  })

  it('uses the real crafting speed of the default machine', () => {
    const plan = makePlan([['nullius-iron-gear', 60]], [
      'nullius-iron-gear',
      'nullius-iron-plate',
      'nullius-iron-rod',
      'nullius-iron-ingot',
    ])
    const r = solve(plan, gameData)
    for (const recipeId of ['nullius-iron-plate', 'nullius-iron-ingot']) {
      const recipe = gameData.recipes[recipeId]
      const machine = gameData.machines[gameData.defaultMachines[recipe.category]]
      expect(machine, `default machine for ${recipe.category}`).toBeDefined()
      expect(machine.craftingSpeed, `${machine.id} is faster than speed 1`).toBeGreaterThan(1)
      // Mirrors the solver's formula on purpose: this proves the real default machine is used.
      const node = nodeOf(r, recipeId)
      expect(node.machineCountExact, recipeId).toBeCloseTo(
        (node.throughput * recipe.craftingTime) / 60 / machine.craftingSpeed,
        6,
      )
    }
  })

  it('solves a fluid recipe', () => {
    const recipe = gameData.recipes['nullius-hydrogen-chloride']
    expect(recipe?.hidden).toBe(false)
    const plan = makePlan([['nullius-hydrogen-chloride', 60]], ['nullius-hydrogen-chloride'])
    const r = solve(plan, gameData)
    expectSane(r, plan)
    expect(nodeOf(r, 'nullius-hydrogen-chloride').outputRates['nullius-hydrogen-chloride']).toBeCloseTo(60, 3)
  })

  // Categories whose non-hidden recipes have no machine in the export. Their recipes cannot be
  // built by a machine, so the sweep skips them. The test below keeps this list exact.
  const CATEGORIES_WITHOUT_MACHINE = new Set<string>([
    'ee-testing-tool',
    'hand-crafting',
  ])

  const visibleRecipes = Object.values(gameData.recipes).filter(r => !r.hidden)

  // Recipes excluded from the sweep for a legitimate data reason: recipe id -> reason. The
  // Nullius "dump" recipes (outfalls and chimneys) have a single probability-0 placeholder
  // product, so no goal item can be produced by them. Only these two categories may be skipped.
  const NULL_PRODUCT_CATEGORIES = ['nullius-gas-void', 'nullius-liquid-void']
  const SKIPPED_RECIPES = new Map<string, string>(
    visibleRecipes
      .filter(r => r.products.every(p => (p.probability ?? 1) === 0))
      .map(r => [r.id, 'every product has probability 0']),
  )
  const machinedCategories = new Set(Object.values(gameData.machines).flatMap(m => m.craftingCategories))

  it('lists exactly the categories without a machine', () => {
    const unmachined = new Set(visibleRecipes.map(r => r.category).filter(c => !machinedCategories.has(c)))
    expect([...unmachined].sort()).toEqual([...CATEGORIES_WITHOUT_MACHINE].sort())
  })

  it('only skips the void recipes in the sweep', () => {
    // Pinning the count closes the circularity of computing the skip list from the data it guards.
    expect(SKIPPED_RECIPES.size, 'skipped void recipes').toBe(41)
    const skippedCategories = new Set([...SKIPPED_RECIPES.keys()].map(id => gameData.recipes[id].category))
    expect([...skippedCategories].sort()).toEqual(NULL_PRODUCT_CATEGORIES)
  })

  it('solves every machined recipe on its own', { timeout: 60_000 }, () => {
    const sweep = visibleRecipes.filter(
      r => machinedCategories.has(r.category) && !SKIPPED_RECIPES.has(r.id) && r.products.length > 0,
    )
    expect(sweep.length, 'recipes swept').toBeGreaterThan(1900)
    // Only products[0] is driven as the goal; other products of multi-output recipes are
    // exercised as byproducts, not as goals (known limitation of the sweep).
    for (const recipe of sweep) {
      const plan = makePlan([[recipe.products[0].itemId, 60]], [recipe.id])
      expectSane(solve(plan, gameData), plan, recipe.id)
    }
  })
})

// ---------------------------------------------------------------------------
// Seablock: a loop of blocks with requests
// ---------------------------------------------------------------------------

describe('multi-block loops on the real Seablock data', () => {
  const seablock = loadGameDataFromJson(
    readFileSync(resolve(import.meta.dirname, '../../public/data/kompetenz-seablock/game-data.json'), 'utf-8'),
  )
  const WASTE = 'sct-waste-ironcopper'

  const prod = (itemId: string, extraRate?: number): Product => ({
    id: `p-${itemId}`,
    itemId,
    ...(extraRate !== undefined ? { extraRate } : {}),
  })
  const link = (id: string, itemId: string, fromBlockId: string, maxRate?: number): BlockConnection => ({
    id,
    itemId,
    fromBlockId,
    ...(maxRate !== undefined ? { maxRate } : {}),
  })
  function block(id: string, products: Product[], recipeIds: string[], inputConnections: BlockConnection[]): Block {
    const now = '2020-01-01T00:00:00.000Z'
    return {
      id,
      name: id,
      color: '#60a5fa',
      products,
      noImportItems: [],
      inputConnections,
      rootPlan: { id: `root-${id}`, name: id, nodes: recipeIds.map(planNode), subPlans: [], createdAt: now, updatedAt: now },
    }
  }

  /** Metals make invar and brass, Sciences use them for sub-plating (and leave waste), Ores recycle the waste. */
  function plan(opts: { wasteIsProduct: boolean; wasteLimit?: number }): Block[] {
    const metals = block(
      'Metals',
      [prod('bob-invar-alloy'), prod('bob-brass-alloy')],
      [
        'angels-plate-invar', 'angels-liquid-molten-invar', 'angels-ingot-steel', 'angels-ingot-iron',
        'angels-plate-brass', 'angels-liquid-molten-brass', 'angels-ingot-copper',
      ],
      [link('c_om_fe', 'iron-ore', 'Ores'), link('c_om_cu', 'copper-ore', 'Ores')],
    )
    const sciences = block(
      'Sciences',
      [prod('sct-mil-subplating', 10), ...(opts.wasteIsProduct ? [prod(WASTE)] : [])],
      ['sct-mil-subplating'],
      [link('c_ms_inv', 'bob-invar-alloy', 'Metals'), link('c_ms_br', 'bob-brass-alloy', 'Metals')],
    )
    const ores = block(
      'Ores',
      [prod('iron-ore'), prod('copper-ore')],
      ['sct-waste-processing-mixed'],
      [link('c_so', WASTE, 'Sciences', opts.wasteLimit)],
    )
    return [metals, sciences, ores]
  }

  const flowOf = (all: ReturnType<typeof solveAll>, id: string) => all.flows.find(f => f.connectionId === id)!

  function expectSaneAll(all: ReturnType<typeof solveAll>) {
    for (const [id, result] of Object.entries(all.results)) {
      for (const n of result.nodes) expectNonNegativeFinite(n.throughput, `${id} ${n.recipeNodeId} throughput`)
    }
    for (const f of all.flows) expectNonNegativeFinite(f.rate, `flow ${f.connectionId}`)
  }

  it('drives the loop when the waste is a take', () => {
    const all = solveAll(plan({ wasteIsProduct: false }), seablock)
    expect(all.loops).toEqual([
      {
        blockIds: ['Metals', 'Sciences', 'Ores'],
        connectionIds: expect.any(Array),
        backConnectionIds: ['c_om_fe', 'c_om_cu'],
        rounds: 2,
        converged: true,
      },
    ])
    expect(all.requestLoops).toEqual([])
    expect(flowOf(all, 'c_ms_inv').requested).toBeCloseTo(30, 4)
    expect(flowOf(all, 'c_ms_br').requested).toBeCloseTo(10, 4)
    expect(flowOf(all, 'c_om_fe').requested).toBeCloseTo(80, 4)
    expect(flowOf(all, 'c_om_cu').requested).toBeCloseTo(7.5, 4)
    expect(flowOf(all, 'c_so')).toMatchObject({ kind: 'take', status: 'limited', loop: true })
    expect(flowOf(all, 'c_so').rate).toBeCloseTo(10, 4)
    expect(all.results.Ores.unsatisfied.find(u => u.itemId === WASTE)?.rate).toBeCloseTo(150, 4)
    expectSaneAll(all)

    // Per (source, item), the consumers together never take more than the source leaves over.
    const taken = new Map<string, number>()
    for (const f of all.flows) taken.set(`${f.fromBlockId}\0${f.itemId}`, (taken.get(`${f.fromBlockId}\0${f.itemId}`) ?? 0) + f.rate)
    for (const [key, total] of taken) {
      const [source, itemId] = key.split('\0')
      const net = netBalance(all.results[source].nodes).get(itemId) ?? 0
      expect(total, `${source} ${itemId} taken`).toBeLessThanOrEqual(net + FLOW_EPS)
    }
  })

  it('keeps the first round and warns when the waste is a product that feeds itself', () => {
    const all = solveAll(plan({ wasteIsProduct: true }), seablock)
    expect(all.requestLoops).toEqual([
      expect.objectContaining({
        blockIds: ['Metals', 'Ores', 'Sciences'],
        backConnectionIds: ['c_ms_inv', 'c_ms_br'],
        rounds: 3,
        converged: false,
      }),
    ])
    for (const id of ['c_ms_inv', 'c_ms_br']) {
      expect(flowOf(all, id)).toMatchObject({ kind: 'take', requestIgnored: 'request-loop' })
    }
    for (const id of ['c_om_fe', 'c_om_cu', 'c_so']) expect(flowOf(all, id).requested).toBeCloseTo(0, 6)
    expect(all.results.Metals.nodes).toEqual([])
    expect(all.results.Sciences.unsatisfied.find(u => u.itemId === 'bob-invar-alloy')?.rate).toBeCloseTo(30, 4)
    expect(all.results.Sciences.unsatisfied.find(u => u.itemId === 'bob-brass-alloy')?.rate).toBeCloseTo(10, 4)
    for (const id of ['Metals', 'Ores', 'Sciences']) {
      expect(all.results[id].warnings).toContainEqual({
        type: 'request-loop-not-converged', blockIds: ['Metals', 'Ores', 'Sciences'], rounds: 3,
      })
    }
    expectSaneAll(all)
  })

  it('settles the same loop once the waste request has a limit', () => {
    const all = solveAll(plan({ wasteIsProduct: true, wasteLimit: 10 }), seablock)
    expect(all.requestLoops[0]).toMatchObject({ rounds: 2, converged: true })
    expect(flowOf(all, 'c_so')).toMatchObject({ kind: 'request', capped: true, status: 'limited' })
    expect(flowOf(all, 'c_so').requested).toBeCloseTo(10, 4)
    expect(flowOf(all, 'c_ms_inv').requested).toBeCloseTo(30, 4)
    expect(flowOf(all, 'c_ms_br').requested).toBeCloseTo(10, 4)
    expect(flowOf(all, 'c_om_fe').requested).toBeCloseTo(80, 4)
    expectSaneAll(all)
  })
})
