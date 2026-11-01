import { describe, it, expect } from 'vitest'
import { projectSnapshot, round3 } from './project'
import { SnapshotSchema, SNAPSHOT_VERSION } from './schema'
import { GameDataSchema } from '../data/schema'
import type {
  AppState, Block, ConnectionFlow, GameData, GameRecipeNode, MultiBlockSolve, PlanDataSetStamp, SolvedNode, SolverResult, SubPlan,
} from '../data/types'

// Small synthetic data set: plates are items, `steam` a fluid; `smelting` has a default machine, `crafting` none.
function makeGameData(): GameData {
  const item = (id: string, type: 'item' | 'fluid') => ({ id, name: id, type, iconPath: '' })
  const machine = (id: string, category: string) => ({
    id, name: id, type: 'furnace', craftingSpeed: 1, energyUsageKw: 90, energyType: 'electric', drainKw: 0,
    moduleSlots: 0, allowedEffects: [], craftingCategories: [category], iconPath: '', hidden: false,
  })
  const recipe = (id: string, category: string) => ({
    id, name: id, category, craftingTime: 1, ingredients: [],
    products: [{ itemId: 'plate', type: 'item', amount: 1 }], madeIn: [], allowProductivity: false, hidden: false,
    subgroup: '', order: '',
  })
  return GameDataSchema.parse({
    factorioVersion: '2.0.77',
    modSet: {},
    items: {
      plate: item('plate', 'item'),
      steam: item('steam', 'fluid'),
      'power:electricity': item('power:electricity', 'fluid'),
      'furnace-item': { ...item('furnace-item', 'item'), placeResult: 'furnace' },
      'furnace2-item': { ...item('furnace2-item', 'item'), placeResult: 'furnace2' },
    },
    recipes: {
      smelt: recipe('smelt', 'smelting'),
      craft: recipe('craft', 'crafting'),
      'make-furnace': { ...recipe('make-furnace', 'crafting'), products: [{ itemId: 'furnace-item', type: 'item', amount: 1 }] },
      'make-furnace2': { ...recipe('make-furnace2', 'crafting'), products: [{ itemId: 'furnace2-item', type: 'item', amount: 1 }] },
      'offshore:steam': { ...recipe('offshore:steam', 'offshore:steam'), products: [{ itemId: 'steam', type: 'fluid', amount: 60 }] },
      'power:solar': { ...recipe('power:solar', 'power:solar'), products: [{ itemId: 'power:electricity', type: 'fluid', amount: 0.06 }] },
      'mining:ore': { ...recipe('mining:ore', 'mining:basic'), products: [{ itemId: 'plate', type: 'item', amount: 1 }] },
    },
    machines: { furnace: machine('furnace', 'smelting'), furnace2: machine('furnace2', 'smelting'), asm: machine('asm', 'crafting') },
    modules: {},
    // The static default is the faster furnace, which a limited horizon does not offer.
    defaultMachines: { smelting: 'furnace2' },
    technologies: {
      early: { id: 'early', name: 'early', prerequisites: [], unlockedRecipes: ['make-furnace'], iconPath: '' },
      late: { id: 'late', name: 'late', prerequisites: ['early'], unlockedRecipes: ['make-furnace2'], iconPath: '' },
    },
    startingRecipes: ['smelt', 'craft'],
  })
}

const NOW = '2026-01-01T00:00:00.000Z'
const stamp: PlanDataSetStamp = { id: 'test', name: 'Test', factorioVersion: '2.0.77' }

function plan(id: string, name: string, nodes: SubPlan['nodes'], subPlans: SubPlan[] = [], area?: true): SubPlan {
  return { id, name, nodes, subPlans, ...(area ? { area } : {}), createdAt: NOW, updatedAt: NOW }
}

function rowNode(id: string, recipeId: string, machineId?: string): SubPlan['nodes'][number] {
  return { kind: 'game-recipe', id, recipeId, ...(machineId ? { machineId } : {}), modules: [], byproductPolicy: {} }
}

/** A game row with extra node keys (modules, beacon config). */
function richNode(id: string, recipeId: string, over: Partial<GameRecipeNode>): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...over }
}

function makeBlock(id: string, over: Partial<Block> = {}): Block {
  return {
    id, name: id, color: '#112233', products: [], noImportItems: [], itemSourcing: {}, inputConnections: [],
    rootPlan: plan(`${id}-root`, 'Main', []), ...over,
  }
}

function stateOf(blocks: Block[]): AppState {
  return { blocks, activeBlockId: blocks[0]?.id ?? '', horizonTechnologyIds: [], defaultMachineOverrides: {} }
}

function solved(recipeNodeId: string, over: Partial<SolvedNode> = {}): SolvedNode {
  return { recipeNodeId, inputRates: {}, outputRates: {}, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 90, ...over }
}

function result(over: Partial<SolverResult> = {}): SolverResult {
  return { nodes: [], unsatisfied: [], warnings: [], ...over }
}

function flow(over: Partial<ConnectionFlow> = {}): ConnectionFlow {
  return {
    connectionId: 'c', fromBlockId: 'a', toBlockId: 'b', itemId: 'plate', available: 10, capped: false, rate: 10,
    status: 'ok', kind: 'take', ...over,
  }
}

function solveOf(over: Partial<MultiBlockSolve> = {}): MultiBlockSolve {
  return { results: {}, flows: [], loops: [], requestLoops: [], errors: {}, ...over }
}

function project(blocks: Block[], solve: MultiBlockSolve) {
  const snapshot = projectSnapshot(stateOf(blocks), solve, makeGameData(), stamp)
  expect(SnapshotSchema.safeParse(snapshot).success, 'projection parses with SnapshotSchema').toBe(true)
  return snapshot
}

describe('round3', () => {
  it('rounds to three decimals and never returns -0', () => {
    expect(round3(1.23456)).toBe(1.235)
    expect(round3(2)).toBe(2)
    expect(Object.is(round3(-0.0001), 0)).toBe(true)
  })

  it('is undefined for a value that is not a finite non-negative number', () => {
    for (const x of [Infinity, -Infinity, NaN, -1, -0.002]) expect(round3(x), String(x)).toBeUndefined()
    // Too large to scale without overflowing.
    expect(round3(Number.MAX_VALUE)).toBeUndefined()
  })
})

describe('projectSnapshot', () => {
  it('carries the version, the data-set stamp and the blocks in order', () => {
    const s = project([makeBlock('a'), makeBlock('b')], solveOf())
    expect(s.v).toBe(SNAPSHOT_VERSION)
    expect(s.dataSet).toEqual(stamp)
    expect(s.blocks.map(b => b.name)).toEqual(['a', 'b'])
    expect(s.blocks[0].color).toBe('#112233')
  })

  it('sends products with extra rate plus what other blocks request, typed item or fluid', () => {
    const a = makeBlock('a', {
      products: [{ id: 'p1', itemId: 'plate', extraRate: 5.12345 }, { id: 'p2', itemId: 'plate' }, { id: 'p3', itemId: 'steam' }],
    })
    const s = project([a, makeBlock('b')], solveOf({
      flows: [flow({ fromBlockId: 'a', toBlockId: 'b', kind: 'request', requested: 2 })],
    }))
    // The first product of an item receives the request; the second keeps only its own extra (none).
    expect(s.blocks[0].products).toEqual([
      { id: 'plate', type: 'item', rate: 7.123 },
      { id: 'plate', type: 'item', rate: 0 },
      { id: 'steam', type: 'fluid', rate: 0 },
    ])
  })

  it('sends an id the data set does not know as an item', () => {
    const s = project([makeBlock('a', { products: [{ id: 'p', itemId: 'mystery', extraRate: 1 }] })], solveOf())
    expect(s.blocks[0].products[0]).toEqual({ id: 'mystery', type: 'item', rate: 1 })
  })

  it('projects rows in table order with rounded numbers and the effective machine', () => {
    // The handle comes between the root's own rows, so the sub-factory's row sits between them.
    const root = plan('root', 'Main',
      [rowNode('n1', 'smelt'), { kind: 'subplan', id: 'h', subPlanId: 'sp' }, rowNode('n2', 'craft', 'asm'), rowNode('n3', 'craft')],
      [plan('sp', 'Sub', [rowNode('n4', 'smelt', 'furnace')])])
    const a = makeBlock('a', { rootPlan: root })
    const s = project([a], solveOf({
      results: {
        a: result({
          nodes: [
            solved('n3'), solved('n2'), solved('n4'),
            solved('n1', { machineCountExact: 1.23456, machineCountCeil: 2, throughput: 0.0004, powerKw: 12.3456 }),
          ],
        }),
      },
    }))
    expect(s.blocks[0].rows).toEqual([
      { recipe: 'smelt', machine: 'furnace2', machines: 1.235, machinesCeil: 2, throughput: 0, powerKw: 12.346 },
      { recipe: 'smelt', machine: 'furnace', group: 0, machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
      { recipe: 'craft', machine: 'asm', machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
      // `crafting` has no default machine, so the key is omitted rather than null.
      { recipe: 'craft', machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
    ])
    expect(s.blocks[0].areas).toBeUndefined()
    expect(s.blocks[0].rows.every(r => !('area' in r))).toBe(true)
  })

  it('numbers areas in table order and tags each row with its area', () => {
    const root = plan('root', 'Main',
      [rowNode('n1', 'smelt'), { kind: 'subplan', id: 'h1', subPlanId: 'sp1' }],
      [plan('sp1', 'Furnaces', [rowNode('n2', 'smelt'), { kind: 'subplan', id: 'h2', subPlanId: 'sp2' }], [
        plan('sp2', 'Plain group', [rowNode('n3', 'smelt')]),
      ], true)])
    const s = project([makeBlock('a', { rootPlan: root })], solveOf({
      results: { a: result({ nodes: [solved('n1'), solved('n2'), solved('n3')] }) },
    }))
    expect(s.blocks[0].areas).toEqual(['Top level', 'Furnaces'])
    // A sub-factory that is not an area belongs to the area around it.
    expect(s.blocks[0].rows.map(r => r.area)).toEqual([0, 1, 1])
  })

  it('keeps imports in the solver order', () => {
    const s = project([makeBlock('a')], solveOf({
      results: { a: result({ unsatisfied: [{ itemId: 'steam', rate: 1.0004 }, { itemId: 'plate', rate: 9 }, { itemId: 'ore', rate: 2 }] }) },
    }))
    expect(s.blocks[0].imports).toEqual([
      { id: 'steam', type: 'fluid', rate: 1 },
      { id: 'plate', type: 'item', rate: 9 },
      { id: 'ore', type: 'item', rate: 2 },
    ])
  })

  it('reduces each warning to a code and the ids it names', () => {
    const root = plan('root', 'Main', [], [plan('sp', 'Sub', [], [], true)])
    const a = makeBlock('a', { rootPlan: root })
    const s = project([a, makeBlock('b')], solveOf({
      results: {
        a: result({
          warnings: [
            { type: 'no-recipe', itemId: 'steam' },
            { type: 'duplicate-recipe', recipeId: 'smelt', count: 2, areaId: 'sp' },
            { type: 'duplicate-recipe', recipeId: 'craft', count: 2 },
            { type: 'infeasible-pins', recipeIds: ['smelt', 'craft'] },
            { type: 'overconstrained', surplusItems: [{ itemId: 'plate', rate: 1 }, { itemId: 'steam', rate: 2 }] },
            { type: 'area-shortfall', shortfalls: [{ areaId: 'sp', itemId: 'plate', rate: 1 }, { areaId: 'sp', itemId: 'steam', rate: 1 }] },
            { type: 'loop-not-converged', blockIds: ['b', 'a', 'gone'], rounds: 8 },
            { type: 'request-loop-not-converged', blockIds: ['a'], rounds: 30 },
          ],
        }),
      },
    }))
    expect(s.blocks[0].warnings).toEqual([
      { code: 'no-recipe', items: [{ id: 'steam', type: 'fluid' }] },
      { code: 'duplicate-recipe', recipes: ['smelt'], areas: [1] },
      { code: 'duplicate-recipe', recipes: ['craft'] },
      { code: 'infeasible-pins', recipes: ['smelt', 'craft'] },
      { code: 'overconstrained', items: [{ id: 'plate', type: 'item' }, { id: 'steam', type: 'fluid' }] },
      { code: 'area-shortfall', items: [{ id: 'plate', type: 'item' }, { id: 'steam', type: 'fluid' }], areas: [1] },
      { code: 'loop-not-converged', blocks: [1, 0] },
      { code: 'request-loop-not-converged', blocks: [0] },
    ])
  })

  it('lists a block\'s connections by source block index, without unusable flows', () => {
    const s = project([makeBlock('a'), makeBlock('b'), makeBlock('c')], solveOf({
      flows: [
        flow({ connectionId: '1', fromBlockId: 'a', toBlockId: 'c', available: 3.14159 }),
        flow({ connectionId: '2', fromBlockId: 'b', toBlockId: 'c', itemId: 'steam', available: 0, status: 'unused' }),
        flow({ connectionId: '3', fromBlockId: 'ghost', toBlockId: 'c', available: 0, status: 'missing-source' }),
        flow({ connectionId: '4', fromBlockId: 'c', toBlockId: 'c', available: 0, status: 'self' }),
        flow({ connectionId: '5', fromBlockId: 'c', toBlockId: 'a' }),
      ],
    }))
    expect(s.blocks[2].connections).toEqual([
      { from: 0, id: 'plate', type: 'item', available: 3.142 },
      { from: 1, id: 'steam', type: 'fluid', available: 0 },
    ])
    expect(s.blocks[0].connections).toEqual([{ from: 2, id: 'plate', type: 'item', available: 10 }])
  })

  it('keeps a block whose solve failed, with its message, its rows without solved values, and the result\'s warnings', () => {
    const a = makeBlock('a', {
      name: 'Broken', products: [{ id: 'p', itemId: 'plate', extraRate: 4 }],
      rootPlan: plan('root', 'Main', [rowNode('n1', 'smelt'), rowNode('n2', 'recipe-the-data-set-lacks')]),
    })
    const s = project([a, makeBlock('b')], solveOf({
      // A loop member whose solve threw: the solver gives it an empty result plus, here, the
      // loop's non-convergence, which names it.
      results: { a: result({ warnings: [{ type: 'loop-not-converged', blockIds: ['a', 'b'], rounds: 8 }] }), b: result() },
      errors: { a: 'LP exploded' },
      flows: [flow({ fromBlockId: 'b', toBlockId: 'a' })],
    }))
    expect(s.blocks).toHaveLength(2)
    expect(s.blocks[0]).toEqual({
      name: 'Broken',
      color: '#112233',
      products: [{ id: 'plate', type: 'item', rate: 4 }],
      rows: [{ recipe: 'smelt', machine: 'furnace2' }, { recipe: 'recipe-the-data-set-lacks' }],
      imports: [],
      warnings: [{ code: 'loop-not-converged', blocks: [0, 1] }],
      connections: [{ from: 1, id: 'plate', type: 'item', available: 10 }],
      error: 'LP exploded',
    })
    expect('error' in s.blocks[1]).toBe(false)
  })

  it('keeps a row without a solved node, omitting its values and a machine it cannot know', () => {
    const root = plan('root', 'Main', [rowNode('n1', 'smelt'), rowNode('n2', 'craft'), rowNode('n3', 'unknown', 'asm')])
    const s = project([makeBlock('a', { rootPlan: root })], solveOf({ results: { a: result({ nodes: [solved('n1')] }) } }))
    expect(s.blocks[0].rows).toEqual([
      { recipe: 'smelt', machine: 'furnace2', machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
      // `crafting` has no default machine
      { recipe: 'craft' },
      // an unknown recipe keeps its id and its explicit machine
      { recipe: 'unknown', machine: 'asm' },
    ])
  })

  it('omits a solved value that is not a finite non-negative number, and keeps the others', () => {
    const root = plan('root', 'Main', [rowNode('n1', 'smelt'), rowNode('n2', 'smelt')])
    const s = project([makeBlock('a', { rootPlan: root })], solveOf({
      results: {
        a: result({
          nodes: [
            solved('n1', { machineCountExact: Infinity, machineCountCeil: Infinity, throughput: NaN, powerKw: -5 }),
            solved('n2', { machineCountCeil: 1.5 }),
          ],
          unsatisfied: [{ itemId: 'plate', rate: NaN }, { itemId: 'steam', rate: -3 }],
        }),
      },
      flows: [flow({ fromBlockId: 'a', toBlockId: 'a', status: 'ok', available: Infinity })],
    }))
    expect(s.blocks[0].rows).toEqual([
      { recipe: 'smelt', machine: 'furnace2' },
      { recipe: 'smelt', machine: 'furnace2', machines: 1, throughput: 1, powerKw: 90 },
    ])
    // A required rate falls back to 0 rather than breaking the snapshot.
    expect(s.blocks[0].imports.map(i => i.rate)).toEqual([0, 0])
    expect(s.blocks[0].connections[0].available).toBe(0)
  })

  it('sends the machine the solver uses: the horizon default, then the plan\'s override', () => {
    const rows = (horizonTechnologyIds: string[], defaultMachineOverrides: Record<string, string>) => {
      const root = plan('root', 'Main', [rowNode('n1', 'smelt'), rowNode('n2', 'smelt', 'furnace2')])
      const a = makeBlock('a', { rootPlan: root })
      const state: AppState = { ...stateOf([a]), horizonTechnologyIds, defaultMachineOverrides }
      const solve = solveOf({ results: { a: result({ nodes: [solved('n1'), solved('n2')] }) } })
      return projectSnapshot(state, solve, makeGameData(), stamp).blocks[0].rows.map(r => r.machine)
    }
    expect(rows([], {})).toEqual(['furnace2', 'furnace2'])
    // `late` unlocks the faster furnace; `early` does not, so the default falls back (an explicit machine stays).
    expect(rows(['late'], {})).toEqual(['furnace2', 'furnace2'])
    expect(rows(['early'], {})).toEqual(['furnace', 'furnace2'])
    expect(rows([], { smelting: 'furnace' })).toEqual(['furnace', 'furnace2'])
    // An override outside the horizon is ignored, as the solver does.
    expect(rows(['early'], { smelting: 'furnace2' })).toEqual(['furnace', 'furnace2'])
  })

  it('never sends an exporter-invented id: synthetic rows carry a kind and product, electricity is virtual', () => {
    const root = plan('root', 'Main', [
      rowNode('n1', 'offshore:steam', 'pump'), rowNode('n2', 'power:solar', 'solar-panel'),
      rowNode('n3', 'mining:ore', 'drill'), rowNode('n4', 'power:removed'),
    ])
    const a = makeBlock('a', {
      rootPlan: root,
      products: [{ id: 'p', itemId: 'power:electricity', extraRate: 600 }],
    })
    const s = project([a, makeBlock('b')], solveOf({
      results: {
        a: result({
          nodes: [solved('n1'), solved('n2')],
          unsatisfied: [{ itemId: 'power:electricity', rate: 1 }],
          warnings: [
            { type: 'no-recipe', itemId: 'power:electricity' },
            { type: 'infeasible-pins', recipeIds: ['power:solar', 'smelt', 'mining:ore'] },
            { type: 'duplicate-recipe', recipeId: 'offshore:steam', count: 2 },
          ],
        }),
      },
      flows: [flow({ fromBlockId: 'a', toBlockId: 'b', itemId: 'power:electricity' })],
    }))
    const virtual = { id: 'electricity', type: 'virtual' }
    expect(s.blocks[0].rows).toEqual([
      { kind: 'offshore', product: { id: 'steam', type: 'fluid' }, machine: 'pump', machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
      { kind: 'power', product: virtual, machine: 'solar-panel', machines: 1, machinesCeil: 1, throughput: 1, powerKw: 90 },
      { kind: 'mining', product: { id: 'plate', type: 'item' }, machine: 'drill' },
      // the data set lacks this recipe: its kind is known from the id, its product is not
      { kind: 'power' },
    ])
    expect(s.blocks[0].products).toEqual([{ ...virtual, rate: 600 }])
    expect(s.blocks[0].imports).toEqual([{ ...virtual, rate: 1 }])
    expect(s.blocks[0].warnings).toEqual([
      { code: 'no-recipe', items: [virtual] },
      { code: 'infeasible-pins', recipes: ['smelt'] },
      { code: 'duplicate-recipe' },
    ])
    expect(s.blocks[1].connections).toEqual([{ from: 0, ...virtual, available: 10 }])
    expect(JSON.stringify(s)).not.toMatch(/"(mining|offshore|power):/)
  })

  describe('item rates', () => {
    const rowsOf = (node: SolvedNode | undefined) => {
      const root = plan('root', 'Main', [rowNode('n1', 'smelt')])
      const nodes = node ? [node] : []
      return project([makeBlock('a', { rootPlan: root })], solveOf({ results: { a: result({ nodes }) } })).blocks[0].rows[0]
    }

    it('sends inputs and outputs from the solve, typed and rounded to three decimals, in the solver\'s order', () => {
      const row = rowsOf(solved('n1', { inputRates: { steam: 12.34567, ore: 3 }, outputRates: { plate: 60.0004 } }))
      expect(row.inputs).toEqual([{ id: 'steam', type: 'fluid', rate: 12.346 }, { id: 'ore', type: 'item', rate: 3 }])
      expect(row.outputs).toEqual([{ id: 'plate', type: 'item', rate: 60 }])
    })

    it('omits the keys when there is no rate, when the row is unsolved, and drops zero or unusable rates', () => {
      expect('inputs' in rowsOf(solved('n1'))).toBe(false)
      expect('outputs' in rowsOf(solved('n1'))).toBe(false)
      const unsolved = rowsOf(undefined)
      expect('inputs' in unsolved || 'outputs' in unsolved).toBe(false)
      const row = rowsOf(solved('n1', {
        inputRates: { a: 0, b: NaN, c: -2, d: Infinity, e: 0.0004 },
        outputRates: { plate: 1, zero: 0 },
      }))
      expect('inputs' in row, 'every input rate is unusable or rounds to 0').toBe(false)
      expect(row.outputs).toEqual([{ id: 'plate', type: 'item', rate: 1 }])
    })

    it('leaves electricity out, and omits the key when nothing else is left', () => {
      const root = plan('root', 'Main', [rowNode('n1', 'power:solar'), rowNode('n2', 'craft')])
      const s = project([makeBlock('a', { rootPlan: root })], solveOf({
        results: {
          a: result({
            nodes: [
              solved('n1', { outputRates: { 'power:electricity': 3600 } }),
              solved('n2', { inputRates: { 'power:electricity': 60, plate: 2 }, outputRates: { steam: 1 } }),
            ],
          }),
        },
      }))
      expect('outputs' in s.blocks[0].rows[0]).toBe(false)
      expect(s.blocks[0].rows[1]).toMatchObject({ inputs: [{ id: 'plate', type: 'item', rate: 2 }], outputs: [{ id: 'steam', type: 'fluid', rate: 1 }] })
      // The power row's own `product` is the virtual electricity item; no rate list names it.
      expect(JSON.stringify(s.blocks[0].rows.flatMap(r => [...(r.inputs ?? []), ...(r.outputs ?? [])]))).not.toContain('electricity')
    })
  })

  describe('modules and beacon', () => {
    const rowOf = (node: SubPlan['nodes'][number]) =>
      project([makeBlock('a', { rootPlan: plan('root', 'Main', [node]) })], solveOf()).blocks[0].rows[0]
    const beacon = { beaconId: 'beacon', moduleId: 'speed-module', beaconCount: 8, modulesPerBeacon: 2, distributionEfficiency: 1.5 }

    it('sends the machine\'s modules in order, and nothing when there are none', () => {
      const row = rowOf(richNode('n1', 'smelt', { modules: [{ moduleId: 'speed-module', count: 2 }, { moduleId: 'productivity-module', count: 1 }] }))
      expect(row).toMatchObject({ modules: [{ id: 'speed-module', count: 2 }, { id: 'productivity-module', count: 1 }] })
      expect('modules' in rowOf(rowNode('n1', 'smelt'))).toBe(false)
    })

    it('sends the beacon entity, how many per machine, and the module and how many of it each holds', () => {
      expect(rowOf(richNode('n1', 'smelt', { beaconConfig: beacon }))).toMatchObject({
        beacon: { id: 'beacon', count: 8, module: 'speed-module', modules: 2 },
      })
    })

    it('sends no beacon for a config without a beacon id (made without beacon data)', () => {
      const noId = { moduleId: 'speed-module', beaconCount: 8, modulesPerBeacon: 2, distributionEfficiency: 1.5 }
      expect('beacon' in rowOf(richNode('n1', 'smelt', { beaconConfig: noId }))).toBe(false)
    })

    it('sends no beacon for a count of 0', () => {
      expect('beacon' in rowOf(richNode('n1', 'smelt', { beaconConfig: { ...beacon, beaconCount: 0 } }))).toBe(false)
    })
  })

  describe('groups', () => {
    const project1 = (root: SubPlan, ids: string[] = []) =>
      project([makeBlock('a', { rootPlan: root })], solveOf({ results: { a: result({ nodes: ids.map(id => solved(id)) }) } })).blocks[0]
    const handle = (id: string, subPlanId: string) => ({ kind: 'subplan' as const, id, subPlanId })

    it('has no groups and no row group for a plan without sub-factories', () => {
      const b = project1(plan('root', 'Main', [rowNode('n1', 'smelt'), rowNode('n2', 'craft')]))
      expect('groups' in b).toBe(false)
      expect(b.rows.every(r => !('group' in r))).toBe(true)
    })

    it('leaves a row of the root plan without a group, and numbers a sub-factory in table order', () => {
      const root = plan('root', 'Main', [rowNode('n1', 'smelt'), handle('h', 'sp')], [plan('sp', 'Sub', [rowNode('n2', 'smelt')])])
      const b = project1(root)
      expect(b.groups).toEqual([{ name: 'Sub' }])
      expect(b.rows.map(r => r.group)).toEqual([undefined, 0])
    })

    it('orders nested sub-factories parents first, with parent set from the enclosing sub-factory', () => {
      const inner = plan('in', 'Inner', [rowNode('n3', 'smelt')])
      const mid = plan('mid', 'Middle', [rowNode('n2', 'smelt'), handle('h2', 'in')], [inner])
      const other = plan('other', 'Other', [rowNode('n4', 'smelt')])
      const root = plan('root', 'Main', [handle('h1', 'mid'), handle('h3', 'other')], [mid, other])
      const b = project1(root)
      expect(b.groups).toEqual([{ name: 'Middle' }, { name: 'Inner', parent: 0 }, { name: 'Other' }])
      expect(b.rows.map(r => r.group)).toEqual([0, 1, 2])
    })

    it('puts a row after a nested sub-factory back in the enclosing group (P[a, S, b] gives P, S, P)', () => {
      const s = plan('s', 'S', [rowNode('n2', 'smelt')])
      const p = plan('p', 'P', [rowNode('n1', 'smelt'), handle('h2', 's'), rowNode('n3', 'smelt')], [s])
      const b = project1(plan('root', 'Main', [handle('h1', 'p')], [p]))
      expect(b.groups).toEqual([{ name: 'P' }, { name: 'S', parent: 0 }])
      expect(b.rows.map(r => r.group)).toEqual([0, 1, 0])
    })

    it('gives a group to a sub-factory that holds only nested ones', () => {
      const inner = plan('in', 'Inner', [rowNode('n1', 'smelt')])
      const outer = plan('out', 'Outer', [handle('h2', 'in')], [inner])
      const b = project1(plan('root', 'Main', [handle('h1', 'out')], [outer]))
      expect(b.groups).toEqual([{ name: 'Outer' }, { name: 'Inner', parent: 0 }])
      expect(b.rows.map(r => r.group)).toEqual([1])
    })

    it('does not send a sub-factory with no rows at any depth', () => {
      const empty = plan('e', 'Empty', [], [plan('e2', 'Emptier', [])])
      const full = plan('f', 'Full', [rowNode('n1', 'smelt')])
      const b = project1(plan('root', 'Main', [handle('h1', 'e'), handle('h2', 'f')], [empty, full]))
      expect(b.groups).toEqual([{ name: 'Full' }])
      expect(b.rows.map(r => r.group)).toEqual([0])
      expect('groups' in project1(plan('root', 'Main', [rowNode('n1', 'smelt')], [empty]))).toBe(false)
    })

    it('marks a separate area with area: true, and a plain sub-factory has no area key', () => {
      const plain = plan('plain', 'Plain', [rowNode('n2', 'smelt')])
      const area = plan('ar', 'Furnaces', [rowNode('n1', 'smelt'), handle('h2', 'plain')], [plain], true)
      const b = project1(plan('root', 'Main', [handle('h1', 'ar')], [area]))
      expect(b.groups).toEqual([{ name: 'Furnaces', area: true }, { name: 'Plain', parent: 0 }])
      expect(b.groups?.[1]).not.toHaveProperty('area')
    })

    it('visits a sub-factory without a handle after the plan\'s own rows', () => {
      const loose = plan('loose', 'Loose', [rowNode('n2', 'smelt')])
      const b = project1(plan('root', 'Main', [rowNode('n1', 'smelt')], [loose]))
      expect(b.groups).toEqual([{ name: 'Loose' }])
      expect(b.rows.map(r => r.group)).toEqual([undefined, 0])
    })

    it('keeps the groups of a block whose solve failed', () => {
      const root = plan('root', 'Main', [handle('h', 'sp')], [plan('sp', 'Sub', [rowNode('n1', 'smelt')])])
      const s = project([makeBlock('a', { rootPlan: root })], solveOf({ results: { a: result() }, errors: { a: 'boom' } }))
      expect(s.blocks[0].groups).toEqual([{ name: 'Sub' }])
      expect(s.blocks[0].rows).toEqual([{ recipe: 'smelt', machine: 'furnace2', group: 0 }])
    })
  })

  it('is pure: it does not change its inputs', () => {
    const blocks = [makeBlock('a', { products: [{ id: 'p', itemId: 'plate', extraRate: 1 }] })]
    const state = stateOf(blocks)
    const solve = solveOf({ results: { a: result({ unsatisfied: [{ itemId: 'plate', rate: 1.23456 }] }) } })
    const before = JSON.stringify([state, solve])
    projectSnapshot(state, solve, makeGameData(), stamp)
    expect(JSON.stringify([state, solve])).toBe(before)
  })
})
