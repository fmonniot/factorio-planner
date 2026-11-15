import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { flattenBlock, solveAll, solveBlock } from './index'
import { areaSpike, type AreaSourceRule } from './areas'
import { exactKey } from './solveCache'
import { loadGameDataFromJson, parseAppState } from '../data/loader'
import type { Block, GameData, GameRecipeNode, Machine, RecipeNode, SolverResult, SourceRule, SubPlan } from '../data/types'
import type { SolverPlan } from './blockResult'

// Spike T2 of initiatives/sourcing-priority/phase-5.md: area rules passed on the solver plan's `areas`
// entries (no stored field yet). The expected values are case 21's, derived by hand in phase-5.md;
// they were written before the prototype and are never edited to match it.

type GameRecipe = GameData['recipes'][string]

function recipe(id: string, ingredients: [string, number][], products: [string, number][]): GameRecipe {
  return {
    id, name: id, category: 'smelting', craftingTime: 1,
    ingredients: ingredients.map(([itemId, amount]) => ({ itemId, type: 'item', amount })),
    products: products.map(([itemId, amount]) => ({ itemId, type: 'item', amount })),
    madeIn: [], allowProductivity: true, mainProduct: undefined, hidden: false, subgroup: '', order: '',
  }
}

function makeGameData(): GameData {
  const rs = [
    // Case 13's recipes: 1 ore makes 1 plate, 1 plate makes 1 gear.
    recipe('case13-make-plate', [['case13-ore', 1]], [['case13-plate', 1]]),
    recipe('case13-use-plate', [['case13-plate', 1]], [['case13-gear', 1]]),
    // Case 11's recipes: A makes the goal with X on the side, U uses X, R makes 2 X.
    recipe('case11-make-goal', [['case11-ore', 1]], [['case11-goal', 1], ['case11-x', 1]]),
    recipe('case11-use-x', [['case11-x', 1]], [['case11-other', 1]]),
    recipe('case11-make-x', [['case11-feed', 1]], [['case11-x', 2]]),
  ]
  const machine: Machine = {
    id: 'm', name: 'm', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 100, energyType: 'electric',
    drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['smelting'], iconPath: '', hidden: false,
  }
  return {
    factorioVersion: '2.0.0', modSet: {},
    recipes: Object.fromEntries(rs.map(r => [r.id, r])),
    items: {}, machines: { m: machine }, modules: {}, beacons: {},
    defaultMachines: { smelting: 'm' },
    itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  }
}

function row(recipeId: string, where: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id: `${recipeId}@${where}`, recipeId, modules: [], byproductPolicy: {}, ...extra }
}

function subPlan(id: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  const now = '2026-11-15T00:00:00.000Z'
  return { id, name: id, nodes, subPlans, ...(area ? { area } : {}), createdAt: now, updatedAt: now }
}

function block(rootPlan: SubPlan, products: [string, number][], sourceRules: Record<string, SourceRule>, connected: string[]): Block {
  return {
    id: 'H', name: 'H', color: '#60a5fa',
    products: products.map(([itemId, extraRate], i) => ({ id: `p${i}`, itemId, extraRate })),
    sourceRules,
    inputConnections: connected.map((itemId, i) => ({ id: `c${i}`, itemId, fromBlockId: 'up' })),
    rootPlan,
  }
}

/** The plan of `b` with `rules` (area id → item → rule) on its `areas` entries. */
function withRules(b: Block, rules: Record<string, Record<string, AreaSourceRule>>): SolverPlan {
  const plan = flattenBlock(b)
  return { ...plan, areas: plan.areas!.map(a => (rules[a.id] ? { ...a, rules: rules[a.id] } : a)) }
}

function rate(result: SolverResult, nodeId: string): number {
  const n = result.nodes.find(x => x.recipeNodeId === nodeId)
  if (!n) throw new Error(`no solved node ${nodeId}`)
  return n.throughput
}

const unsatisfied = (result: SolverResult, itemId: string) => result.unsatisfied.find(u => u.itemId === itemId)?.rate ?? 0
const routesOf = (result: SolverResult, itemId: string) =>
  (result.areaRoutes ?? []).filter(r => r.itemId === itemId).map(r => ({ from: r.from, to: r.to, rate: r.rate }))

// ---------------------------------------------------------------------------
// A. A central block and an area with its own row.
// ---------------------------------------------------------------------------

const PLATE = 'case13-plate'

function blockA(blockRule: SourceRule | undefined, connected: boolean): Block {
  const l = subPlan('L', [row('case13-use-plate', 'L', { pinnedRate: 12 }), row('case13-make-plate', 'L')], [], true)
  const b = subPlan('B', [row('case13-use-plate', 'B', { pinnedRate: 8 }), row('case13-make-plate', 'B')], [], true)
  return block(subPlan('root', [], [l, b]), [['case13-gear', 20]], blockRule ? { [PLATE]: blockRule } : {}, connected ? [PLATE] : [])
}

describe('case 21 A: a central block and an area with its own row', () => {
  // offer: undefined = no connection, Infinity = the request probe.
  const cases: Array<[string, SourceRule | undefined, Record<string, Record<string, AreaSourceRule>>, number | undefined, number, number, number, number]> = [
    // name, block rule, area rules, offer, received, L's plate row, B's plate row, plate imported or missing
    ['a: none (measured)', undefined, {}, 100, 0, 12, 8, 0],
    ['b: block Receive it first (measured)', { makeHere: 'after-blocks' }, {}, 100, 20, 0, 0, 0],
    ['c: L Receive it first', undefined, { L: { [PLATE]: { makeHere: 'after-blocks' } } }, 100, 12, 0, 8, 0],
    ['d: block Receive it first; B {}', { makeHere: 'after-blocks' }, { B: { [PLATE]: {} } }, 100, 12, 0, 8, 0],
    ['e: L Receive it first, offer 5', undefined, { L: { [PLATE]: { makeHere: 'after-blocks' } } }, 5, 5, 7, 8, 0],
    ['f: L Receive it first, unlimited offer (the probe)', undefined, { L: { [PLATE]: { makeHere: 'after-blocks' } } }, Infinity, 12, 0, 8, 0],
    ["g: L Don't make more here, no offer", undefined, { L: { [PLATE]: { makeHere: 'off' } } }, undefined, 0, 0, 8, 12],
    ["h: L Don't make more here, offer 100", undefined, { L: { [PLATE]: { makeHere: 'off' } } }, 100, 12, 0, 8, 0],
    ["i: L Don't make more here, offer 5", undefined, { L: { [PLATE]: { makeHere: 'off' } } }, 5, 5, 0, 8, 7],
    ["j: L Don't make more here, Import off", undefined, { L: { [PLATE]: { makeHere: 'off', importOff: true } } }, undefined, 0, 0, 8, 12],
    ["k: block Don't make more here; L {}", { makeHere: 'off' }, { L: { [PLATE]: {} } }, undefined, 0, 12, 0, 8],
  ]
  for (const [name, blockRule, rules, offer, received, lRow, bRow, imported] of cases) {
    it(name, () => {
      const supply = new Map(offer === undefined ? [] : [[PLATE, offer]])
      const { result, received: got } = solveBlock(withRules(blockA(blockRule, offer !== undefined), rules), makeGameData(), supply)
      expect(got.get(PLATE) ?? 0, 'received').toBeCloseTo(received, 6)
      expect(rate(result, 'case13-make-plate@L'), "L's plate row").toBeCloseTo(lRow, 6)
      expect(rate(result, 'case13-make-plate@B'), "B's plate row").toBeCloseTo(bRow, 6)
      expect(unsatisfied(result, PLATE), 'plate imported or missing').toBeCloseTo(imported, 6)
      expect(rate(result, 'case13-use-plate@L')).toBeCloseTo(12, 6)
      expect(rate(result, 'case13-use-plate@B')).toBeCloseTo(8, 6)
    })
  }

  it("j: the missing plate is L's outside leg", () => {
    const rules = { L: { [PLATE]: { makeHere: 'off', importOff: true } as AreaSourceRule } }
    const { result } = solveBlock(withRules(blockA(undefined, false), rules), makeGameData())
    expect(routesOf(result, PLATE)).toEqual([{ from: undefined, to: 'L', rate: 12 }])
  })

  it('c: the supplied leg into L names its connected part', () => {
    const rules = { L: { [PLATE]: { makeHere: 'after-blocks' } as AreaSourceRule } }
    const { result } = solveBlock(withRules(blockA(undefined, true), rules), makeGameData(), new Map([[PLATE, 100]]))
    const legs = (result.areaRoutes ?? []).filter(r => r.itemId === PLATE)
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ to: 'L', supplied: 12 })
    expect(legs[0].from).toBeUndefined()
    expect(legs[0].rate).toBeCloseTo(12, 6)
  })
})

// ---------------------------------------------------------------------------
// B. Choosing the supplying area.
// ---------------------------------------------------------------------------

function blockB(connected: boolean): Block {
  const l = subPlan('L', [row('case13-use-plate', 'L', { pinnedRate: 12 })], [], true)
  const m1 = subPlan('M1', [row('case13-make-plate', 'M1')], [], true)
  const m2 = subPlan('M2', [row('case13-make-plate', 'M2')], [], true)
  return block(subPlan('root', [], [l, m1, m2]), [['case13-gear', 12]], {}, connected ? [PLATE] : [])
}

describe('case 21 B: choosing the supplying area', () => {
  const cases: Array<[string, AreaSourceRule | undefined, number | undefined, number, number, Array<{ from?: string; to?: string; rate: number }>, number, number]> = [
    // name, L's rule, offer, M1's row, M2's row, routes of plate into L, plate imported, received
    ['a: none (measured)', undefined, undefined, 12, 0, [{ from: 'M1', to: 'L', rate: 12 }], 0, 0],
    ['b: areasOff [M1]', { areasOff: ['M1'] }, undefined, 0, 12, [{ from: 'M2', to: 'L', rate: 12 }], 0, 0],
    ['c: areasOff [M1, M2]', { areasOff: ['M1', 'M2'] }, undefined, 0, 0, [{ from: undefined, to: 'L', rate: 12 }], 12, 0],
    ['d: areasOff [M1, M2], offer 100', { areasOff: ['M1', 'M2'] }, 100, 0, 0, [{ from: undefined, to: 'L', rate: 12 }], 0, 12],
  ]
  for (const [name, rule, offer, m1, m2, routes, imported, received] of cases) {
    it(name, () => {
      const supply = new Map(offer === undefined ? [] : [[PLATE, offer]])
      const rules: Record<string, Record<string, AreaSourceRule>> = rule ? { L: { [PLATE]: rule } } : {}
      const { result, received: got } = solveBlock(withRules(blockB(offer !== undefined), rules), makeGameData(), supply)
      expect(rate(result, 'case13-make-plate@M1'), "M1's row").toBeCloseTo(m1, 6)
      expect(rate(result, 'case13-make-plate@M2'), "M2's row").toBeCloseTo(m2, 6)
      const into = routesOf(result, PLATE).filter(r => r.to === 'L').map(r => ({ ...r, rate: Math.round(r.rate * 1e6) / 1e6 }))
      expect(into, 'routes of plate into L').toEqual(routes)
      expect(unsatisfied(result, PLATE), 'plate imported').toBeCloseTo(imported, 6)
      expect(got.get(PLATE) ?? 0, 'received').toBeCloseTo(received, 6)
    })
  }

  it('d: the leg from outside is all supplied', () => {
    const { result } = solveBlock(withRules(blockB(true), { L: { [PLATE]: { areasOff: ['M1', 'M2'] } } }), makeGameData(), new Map([[PLATE, 100]]))
    const leg = (result.areaRoutes ?? []).find(r => r.itemId === PLATE && r.to === 'L')
    expect(leg?.supplied).toBeCloseTo(12, 6)
  })
})

// ---------------------------------------------------------------------------
// C. One consumer takes the byproduct.
// ---------------------------------------------------------------------------

const X = 'case11-x'

function blockC(blockRule: SourceRule | undefined): Block {
  const t = subPlan('T', [row('case11-make-goal', 'T')], [], true)
  const c1 = subPlan('C1', [row('case11-use-x', 'C1', { pinnedRate: 40 })], [], true)
  const c2 = subPlan('C2', [row('case11-use-x', 'C2', { pinnedRate: 50 }), row('case11-make-x', 'C2')], [], true)
  return block(subPlan('root', [], [t, c1, c2]), [['case11-goal', 30], ['case11-other', 90]], blockRule ? { [X]: blockRule } : {}, [])
}

describe('case 21 C: one consumer takes the byproduct', () => {
  const cases: Array<[string, SourceRule | undefined, Record<string, Record<string, AreaSourceRule>>, number, number, string | undefined]> = [
    // name, block rule, area rules, R runs, X imported or missing, the byproduct goes to (undefined: either)
    ['a: none', undefined, {}, 30, 0, undefined],
    ["b: block Don't make more here", { makeHere: 'off' }, {}, 0, 60, undefined],
    ["c: C1 Don't make more here", undefined, { C1: { [X]: { makeHere: 'off' } } }, 10, 40, 'C2'],
    ["d: C1 Don't make more here; C2 areasOff [T]", undefined, { C1: { [X]: { makeHere: 'off' } }, C2: { [X]: { areasOff: ['T'] } } }, 25, 10, 'C1'],
    ['e: as d, with Import off on C1', undefined, { C1: { [X]: { makeHere: 'off', importOff: true } }, C2: { [X]: { areasOff: ['T'] } } }, 25, 10, 'C1'],
  ]
  for (const [name, blockRule, rules, rRuns, imported, to] of cases) {
    it(name, () => {
      const { result } = solveBlock(withRules(blockC(blockRule), rules), makeGameData())
      expect(rate(result, 'case11-make-goal@T')).toBeCloseTo(30, 6)
      expect(rate(result, 'case11-use-x@C1')).toBeCloseTo(40, 6)
      expect(rate(result, 'case11-use-x@C2')).toBeCloseTo(50, 6)
      expect(rate(result, 'case11-make-x@C2'), 'R runs').toBeCloseTo(rRuns, 6)
      expect(unsatisfied(result, X), 'X imported or missing').toBeCloseTo(imported, 6)
      if (to !== undefined) {
        const fromT = routesOf(result, X).filter(r => r.from === 'T')
        expect(fromT.map(r => r.to), 'the byproduct goes to').toEqual([to])
        expect(fromT[0].rate).toBeCloseTo(30, 6)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Question 1: the split shape forced on every area item, with no rule set.
// ---------------------------------------------------------------------------

describe('the split shape forced on every area item (no rule set)', () => {
  const ROOT = resolve(import.meta.dirname, '../..')
  const bundled = (dir: string) => loadGameDataFromJson(readFileSync(resolve(ROOT, `public/data/${dir}/game-data.json`), 'utf-8'))
  const fixtures = readdirSync(resolve(ROOT, 'e2e/fixtures'))
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, text: readFileSync(resolve(ROOT, 'e2e/fixtures', f), 'utf-8') }))
    .filter(({ text }) => text.includes('"area": true'))
  const data = { nullius: bundled('nullius'), seablock: bundled('kompetenz-seablock') }
  const solveIn = (mode: typeof areaSpike.split, text: string, file: string, pairTie = true) => {
    const before = { ...areaSpike }
    areaSpike.split = mode
    areaSpike.pairTie = pairTie
    try {
      const state = parseAppState(JSON.parse(text))
      return solveAll(state.blocks, file.includes('seablock') ? data.seablock : data.nullius)
    } finally {
      Object.assign(areaSpike, before)
    }
  }
  // Routes only as nets: what each area takes in and sends out of each item.
  const nets = (all: ReturnType<typeof solveAll>) => Object.fromEntries(Object.entries(all.results).map(([id, r]) => {
    const net = new Map<string, number>()
    for (const route of r.areaRoutes ?? []) {
      for (const [end, sign] of [[route.from, -1], [route.to, 1]] as const) {
        const key = `${route.itemId}\u0000${end ?? 'outside'}`
        net.set(key, (net.get(key) ?? 0) + sign * route.rate)
      }
    }
    return [id, [...net].map(([key, v]) => [key, Math.round(v * 1e6) / 1e6]).sort()]
  }))
  const withoutRoutes = (all: ReturnType<typeof solveAll>) => ({
    ...all,
    results: Object.fromEntries(Object.entries(all.results).map(([id, r]) => [id, { ...r, areaRoutes: undefined }])),
  })

  it('finds the fixtures with areas', () => {
    expect(fixtures.map(x => x.f).sort()).toEqual([
      'area-chips-overflow.json', 'area-matrix.json', 'area-routes.json', 'area-row-conveniences.json', 'stranded-subplan.json',
    ])
  })
  for (const { f, text } of fixtures) {
    it(`${f}: a slack and a supply per area move nothing`, () => {
      expect(exactKey(solveIn('split', text, f))).toBe(exactKey(solveIn('rules', text, f)))
    })
    it(`${f}: flows per pair move nothing`, () => {
      expect(exactKey(solveIn('pairs', text, f))).toBe(exactKey(solveIn('rules', text, f)))
    })
    it(`${f}: without the receiver-rank tie-break, flows per pair move only how routes pair areas`, () => {
      const today = solveIn('rules', text, f)
      const pairs = solveIn('pairs', text, f, false)
      expect(exactKey(withoutRoutes(pairs))).toBe(exactKey(withoutRoutes(today)))
      expect(nets(pairs)).toEqual(nets(today))
      expect(exactKey(pairs) === exactKey(today), 'routes paired as today').toBe(f !== 'area-routes.json')
    })
  }
})

// ---------------------------------------------------------------------------
// Question 3: which area gets a short offer in pass 2.
// ---------------------------------------------------------------------------

describe('a short offer in pass 2 (two areas with residuals, offer 5 below 12 + 8)', () => {
  // L and B use 12 and 8 plate; their plate rows are pinned at 0 so plate is an intermediate with a residual in both.
  function blockTies(order: string[]): Block {
    const mk = (id: string, pin: number) =>
      subPlan(id, [row('case13-use-plate', id, { pinnedRate: pin }), row('case13-make-plate', id, { pinnedRate: 0 })], [], true)
    const areas: Record<string, SubPlan> = { L: mk('L', 12), B: mk('B', 8) }
    return block(subPlan('root', [], order.map(id => areas[id])), [['case13-gear', 20]], {}, [PLATE])
  }
  const solveTies = (order: string[], rules: Record<string, Record<string, AreaSourceRule>>, split: typeof areaSpike.split, supplyRank: boolean) => {
    const before = { ...areaSpike }
    Object.assign(areaSpike, { split, supplyRank })
    try {
      return solveBlock(withRules(blockTies(order), rules), makeGameData(), new Map([[PLATE, 5]]))
    } finally {
      Object.assign(areaSpike, before)
    }
  }
  const variants: Array<[string, Record<string, Record<string, AreaSourceRule>>, typeof areaSpike.split]> = [
    ['no rule, split forced', {}, 'split'],
    ['L: Import off (split by D11)', { L: { [PLATE]: { importOff: true } } }, 'rules'],
    ['L and B Receive it first, B Import off (both in pass 1)', { L: { [PLATE]: { makeHere: 'after-blocks' } }, B: { [PLATE]: { makeHere: 'after-blocks', importOff: true } } }, 'rules'],
  ]
  for (const [name, rules, split] of variants) {
    for (const order of [['L', 'B'], ['B', 'L']]) {
      for (const supplyRank of [true, false]) {
        it(`${name}, ${order.join(' above ')}, rank cost ${supplyRank ? 'on' : 'off'}: the area higher in the table gets it`, () => {
          const { result, received } = solveTies(order, rules, split, supplyRank)
          expect(received.get(PLATE)).toBeCloseTo(5, 6)
          const supplied = (result.areaRoutes ?? []).filter(r => r.itemId === PLATE && (r.supplied ?? 0) > 0)
          expect(supplied.map(r => r.to)).toEqual([order[0]])
          expect(supplied[0].supplied).toBeCloseTo(5, 6)
        })
      }
    }
  }
})

// ---------------------------------------------------------------------------
// Question 4: stage 1's bound on the penalised flows, with flows per pair.
// ---------------------------------------------------------------------------

describe('stage 1 and stage 2 with flows per pair', () => {
  // Case B with a plate row in L pinned at 4: L has its own row, so what it takes from M1's and M2's rows is penalised.
  function blockShort(): Block {
    const l = subPlan('L', [row('case13-use-plate', 'L', { pinnedRate: 12 }), row('case13-make-plate', 'L', { pinnedRate: 4 })], [], true)
    const m1 = subPlan('M1', [row('case13-make-plate', 'M1')], [], true)
    const m2 = subPlan('M2', [row('case13-make-plate', 'M2')], [], true)
    return block(subPlan('root', [], [l, m1, m2]), [['case13-gear', 12]], {}, [])
  }
  const shortfall = (result: SolverResult) => {
    const w = result.warnings.find(x => x.type === 'area-shortfall')
    return w?.type === 'area-shortfall' ? w.shortfalls.map(s => ({ ...s, rate: Math.round(s.rate * 1e6) / 1e6 })) : []
  }
  it('pools (today): L takes 8 from M1 and reports the shortfall', () => {
    const { result } = solveBlock(flattenBlock(blockShort()), makeGameData())
    expect(rate(result, 'case13-make-plate@M1')).toBeCloseTo(8, 6)
    expect(shortfall(result)).toEqual([{ areaId: 'L', itemId: PLATE, rate: 8 }])
  })
  it('areasOff [M1]: the bound holds on the pair flows, L takes 8 from M2, same shortfall', () => {
    const { result } = solveBlock(withRules(blockShort(), { L: { [PLATE]: { areasOff: ['M1'] } } }), makeGameData())
    expect(rate(result, 'case13-make-plate@M1')).toBeCloseTo(0, 6)
    expect(rate(result, 'case13-make-plate@M2')).toBeCloseTo(8, 6)
    expect(shortfall(result)).toEqual([{ areaId: 'L', itemId: PLATE, rate: 8 }])
    expect(routesOf(result, PLATE)).toEqual([{ from: 'M2', to: 'L', rate: 8 }])
  })
  it('areasOff [M1, M2]: no pair is left, L imports 8 and reports no shortfall', () => {
    const { result } = solveBlock(withRules(blockShort(), { L: { [PLATE]: { areasOff: ['M1', 'M2'] } } }), makeGameData())
    expect(rate(result, 'case13-make-plate@M1') + rate(result, 'case13-make-plate@M2')).toBeCloseTo(0, 6)
    expect(unsatisfied(result, PLATE)).toBeCloseTo(8, 6)
    expect(shortfall(result)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Question 6: an area with every supplier and Import off and no row of its own.
// ---------------------------------------------------------------------------

describe('an area that switched off every supplier and Import, with no row of its own', () => {
  const offAll: AreaSourceRule = { importOff: true, areasOff: ['M1', 'M2'] }
  it('pinned consumer: the LP is infeasible even with elastic goals; infeasible-pins with conflict names the pin', () => {
    const { result } = solveBlock(withRules(blockB(false), { L: { [PLATE]: offAll } }), makeGameData())
    expect(result.warnings.find(w => w.type === 'infeasible-pins')).toEqual({ type: 'infeasible-pins', recipeIds: ['case13-use-plate'], conflict: true })
    expect(result.warnings.some(w => w.type === 'area-shortfall')).toBe(false)
  })
  it('free consumer: the elastic solve leaves the goal 12 short; no warning names the cause', () => {
    const free = blockB(false)
    free.rootPlan.subPlans.find(sp => sp.id === 'L')!.nodes = [row('case13-use-plate', 'L')]
    const { result } = solveBlock(withRules(free, { L: { [PLATE]: offAll } }), makeGameData())
    expect(result.unsatisfied).toEqual([{ itemId: 'case13-gear', rate: 12 }])
    expect(result.warnings).toEqual([])
    expect(rate(result, 'case13-use-plate@L')).toBeCloseTo(0, 6)
    expect(rate(result, 'case13-make-plate@M1') + rate(result, 'case13-make-plate@M2')).toBeCloseTo(0, 6)
  })
})
