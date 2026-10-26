import { describe, it, expect, vi } from 'vitest'
import { solve, solveAll, flattenBlock } from './index'
import { createSolveCache, exactKey, planKey } from './solveCache'
import type { Block, GameData, GameRecipeNode, Product, RecipeNode, SolvedArea, SolverResult, SubPlan } from '../data/types'

// Areas: a sub-factory with `area: true` is solved as its own area. Every recipe takes 1 s in a
// speed-1 machine, so machineCountExact = throughput / 60. Fixtures are built fresh by each call.

type GameRecipe = GameData['recipes'][string]

function recipe(
  id: string,
  ingredients: [string, number][],
  products: [string, number][],
  extra: Partial<GameRecipe> = {},
): GameRecipe {
  return {
    id,
    name: id,
    category: 'c',
    craftingTime: 1,
    ingredients: ingredients.map(([itemId, amount]) => ({ itemId, type: 'item' as const, amount })),
    products: products.map(([itemId, amount]) => ({ itemId, type: 'item' as const, amount })),
    madeIn: [],
    allowProductivity: false,
    mainProduct: undefined,
    hidden: false,
    subgroup: '',
    order: '',
    ...extra,
  }
}

function gd(): GameData {
  const rs = [
    recipe('electrolysis', [['water', 1]], [['hydrogen', 1], ['oxygen', 1]], { mainProduct: 'hydrogen' }),
    recipe('plastic', [['hydrogen', 1]], [['plastic', 1]]),
    recipe('rocket-fuel', [['hydrogen', 1]], [['rocket-fuel', 1]]),
    recipe('ammonia', [['hydrogen', 1]], [['ammonia', 1]]),
    recipe('pump', [], [['water', 1]]),
    // Scenario 5: r-main makes x as a byproduct of y. x-make makes 2 x per run, so it beats extra
    // r-main runs (which would also tie on run count, as a goal may be overproduced).
    recipe('r-main', [['ore', 1]], [['y', 1], ['x', 1]], { mainProduct: 'y' }),
    recipe('x-make', [['ore', 1]], [['x', 2]]),
    recipe('use-x', [['x', 1]], [['z', 1]]),
    recipe('use-x2', [['x', 1]], [['w', 1]]),
    // Scenario 8
    recipe('gear', [['iron', 2]], [['gear', 1]], { allowProductivity: true }),
    recipe('belt', [['gear', 1]], [['belt', 1]]),
    recipe('sci', [['gear', 1]], [['sci', 1]]),
    recipe('inserter', [['gear', 1]], [['inserter', 1]]),
    // Cycle of requests
    recipe('fx', [['y', 0.5]], [['x', 1]]),
    recipe('fy', [['x', 0.5]], [['y', 1]]),
  ]
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: Object.fromEntries(rs.map(r => [r.id, r])),
    machines: {
      m: {
        id: 'm',
        name: 'm',
        type: 'assembling-machine',
        craftingSpeed: 1,
        energyUsageKw: 100,
        energyType: 'electric',
        drainKw: 0,
        moduleSlots: 4,
        allowedEffects: ['speed', 'productivity', 'consumption', 'pollution', 'quality'],
        craftingCategories: ['c'],
        iconPath: '',
        hidden: false,
      },
    },
    modules: {
      prod: {
        id: 'prod',
        name: 'prod',
        iconPath: '',
        category: 'productivity',
        tier: 3,
        effects: { productivity: 0.1, consumption: 0, speed: 0, quality: 0 },
        limitation: [],
        limitationBlacklist: [],
      },
    },
    beacons: {},
    defaultMachines: { c: 'm' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

/** A row; its node id is `<recipe>@<where>` so the same recipe can appear in several places. */
function row(recipeId: string, where: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id: `${recipeId}@${where}`, recipeId, modules: [], byproductPolicy: {}, ...extra }
}

function handle(sp: SubPlan): RecipeNode {
  return { kind: 'subplan', id: `h-${sp.id}`, subPlanId: sp.id }
}

function sub(id: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  const now = new Date().toISOString()
  return { id, name: id, nodes, subPlans, ...(area === undefined ? {} : { area }), createdAt: now, updatedAt: now }
}

function blk(rootPlan: SubPlan, products: [string, number][], id = 'block-1'): Block {
  return {
    id,
    name: id,
    color: '#60a5fa',
    products: products.map(([itemId, extraRate]): Product => ({ id: `p-${itemId}`, itemId, extraRate })),
    noImportItems: [],
    connectionsFirstItems: [],
    inputConnections: [],
    rootPlan,
  }
}

/** Plan: nodes of `rootNodes` plus the given sub-factories, each with its own handle. */
function root(rootNodes: RecipeNode[], subs: SubPlan[]): SubPlan {
  return sub('root', [...rootNodes, ...subs.map(handle)], subs)
}

const solved = (b: Block) => solve(flattenBlock(b), gd())
const node = (r: SolverResult, id: string) => {
  const n = r.nodes.find(x => x.recipeNodeId === id)
  if (!n) throw new Error(`no node ${id}`)
  return n
}
const area = (r: SolverResult, id: string): SolvedArea => {
  const a = r.areas?.find(x => x.areaId === id)
  if (!a) throw new Error(`no area ${id}`)
  return a
}
const flow = (list: SolvedArea['receives'], itemId: string) => list.find(f => f.itemId === itemId)

/** Root {electrolysis, ammonia}, P {electrolysis, plastic}, F {electrolysis, rocket-fuel}. */
function scenario1(on = true, pExtra: Partial<GameRecipeNode> = {}): Block {
  const p = sub('P', [row('electrolysis', 'P', pExtra), row('plastic', 'P')], [], on ? true : undefined)
  const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')], [], on ? true : undefined)
  return blk(
    root([row('electrolysis', 'root'), row('ammonia', 'root')], [p, f]),
    [['plastic', 252], ['rocket-fuel', 288], ['ammonia', 276]],
  )
}

describe('blockAreas via flattenBlock', () => {
  it('lists areas in table order, with a sub-factory placed by its handle', () => {
    const a = sub('A', [], [], true)
    const b = sub('B', [], [], true)
    // subPlans order is A, B, but the handles put B first.
    const plan = sub('root', [handle(b), handle(a)], [a, b])
    expect(flattenBlock(blk(plan, [])).areas?.map(x => x.id)).toEqual(['root', 'B', 'A'])
  })

  it('puts a sub-factory without a handle after the others', () => {
    const a = sub('A', [], [], true)
    const b = sub('B', [], [], true)
    const plan = sub('root', [handle(b)], [a, b])
    expect(flattenBlock(blk(plan, [])).areas?.map(x => x.id)).toEqual(['root', 'B', 'A'])
  })

  it('gives rows of an organising group to the enclosing area', () => {
    const g = sub('G', [row('electrolysis', 'G')], [], false)
    const a = sub('A', [handle(g), row('plastic', 'A')], [g], true)
    const areas = flattenBlock(blk(root([row('ammonia', 'root')], [a]), [])).areas!
    expect(areas.map(x => x.id)).toEqual(['root', 'A'])
    expect(areas[0].nodeIds).toEqual(['ammonia@root'])
    expect(areas[1].nodeIds).toEqual(['plastic@A', 'electrolysis@G'])
  })

  it('has no areas unless a flag is on', () => {
    const plan = root([row('ammonia', 'root')], [sub('A', [], [], false), sub('B', [])])
    expect('areas' in flattenBlock(blk(plan, []))).toBe(false)
  })
})

describe('areas in the solve', () => {
  it('S1: each area builds its own electrolysis and receives no hydrogen', () => {
    const r = solved(scenario1())
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(276, 6)
    expect(node(r, 'electrolysis@P').throughput).toBeCloseTo(252, 6)
    expect(node(r, 'electrolysis@F').throughput).toBeCloseTo(288, 6)
    expect(node(r, 'electrolysis@root').machineCountExact).toBeCloseTo(4.6, 6)
    expect(node(r, 'electrolysis@P').machineCountExact).toBeCloseTo(4.2, 6)
    expect(node(r, 'electrolysis@F').machineCountExact).toBeCloseTo(4.8, 6)
    const ceils = ['root', 'P', 'F'].map(w => node(r, `electrolysis@${w}`).machineCountCeil)
    expect(ceils).toEqual([5, 5, 5])
    expect(r.warnings).toEqual([])
    expect(r.areas).toHaveLength(3)
    for (const a of r.areas!) {
      expect(flow(a.receives, 'hydrogen')).toBeUndefined()
      expect(flow(a.sends, 'hydrogen')).toBeUndefined()
    }
    const p = area(r, 'P')
    expect(flow(p.receives, 'water')).toMatchObject({ boundary: true })
    expect(flow(p.receives, 'water')!.rate).toBeCloseTo(252, 6)
    expect(flow(p.sends, 'plastic')!.rate).toBeCloseTo(252, 6)
    expect(flow(p.sends, 'plastic')!.boundary).toBe(true)
    expect(flow(p.sends, 'oxygen')!.rate).toBeCloseTo(252, 6)
    expect(flow(p.sends, 'oxygen')!.boundary).toBe(true)
  })

  it.each([0.001, 0.37, 1000, 123456, 5e6])('S1 scaled by %s keeps every area self-sufficient', k => {
    const b = scenario1()
    b.products = b.products.map(p => ({ ...p, extraRate: p.extraRate! * k }))
    const r = solved(b)
    expect(node(r, 'electrolysis@root').throughput / k).toBeCloseTo(276, 4)
    expect(node(r, 'electrolysis@P').throughput / k).toBeCloseTo(252, 4)
    expect(node(r, 'electrolysis@F').throughput / k).toBeCloseTo(288, 4)
    expect(r.warnings).toEqual([])
  })

  it('S1 with the toggles off: one electrolysis row, the rest are duplicates', () => {
    const r = solved(scenario1(false))
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(816, 6)
    expect(node(r, 'electrolysis@root').machineCountExact).toBeCloseTo(13.6, 6)
    expect(node(r, 'electrolysis@root').machineCountCeil).toBe(14)
    expect(node(r, 'electrolysis@P').throughput).toBe(0)
    expect(node(r, 'electrolysis@F').throughput).toBe(0)
    expect(r.warnings).toContainEqual({ type: 'duplicate-recipe', recipeId: 'electrolysis', count: 3 })
    expect('areas' in r).toBe(false)
  })

  it('S1b: an area without its own row takes from the root first', () => {
    const p = sub('P', [row('plastic', 'P')], [], true)
    const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')], [], true)
    const b = blk(
      root([row('electrolysis', 'root'), row('ammonia', 'root')], [p, f]),
      [['plastic', 252], ['rocket-fuel', 288], ['ammonia', 276]],
    )
    const r = solved(b)
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(528, 6)
    expect(node(r, 'electrolysis@F').throughput).toBeCloseTo(288, 6)
    const received = flow(area(r, 'P').receives, 'hydrogen')!
    expect(received.rate).toBeCloseTo(252, 6)
    expect(received.boundary).toBe(false)
    expect(flow(area(r, 'root').sends, 'hydrogen')!.rate).toBeCloseTo(252, 6)
  })

  it('S2: two small areas round up per area', () => {
    const p = sub('P', [row('electrolysis', 'P'), row('plastic', 'P')], [], true)
    const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')], [], true)
    const r = solved(blk(root([], [p, f]), [['plastic', 18], ['rocket-fuel', 18]]))
    expect(node(r, 'electrolysis@P').throughput).toBeCloseTo(18, 6)
    expect(node(r, 'electrolysis@F').throughput).toBeCloseTo(18, 6)
    expect(node(r, 'electrolysis@P').machineCountExact).toBeCloseTo(0.3, 6)
    const total = node(r, 'electrolysis@P').machineCountCeil + node(r, 'electrolysis@F').machineCountCeil
    expect(total).toBe(2)
    const one = solved(scenario2Off())
    expect(one.nodes.find(n => n.recipeNodeId === 'electrolysis@P')!.machineCountExact).toBeCloseTo(0.6, 6)
    expect(one.nodes.find(n => n.recipeNodeId === 'electrolysis@P')!.machineCountCeil).toBe(1)
  })

  it('S4: each area builds its own water pump too', () => {
    const p = sub('P', [row('pump', 'P'), row('electrolysis', 'P'), row('plastic', 'P')], [], true)
    const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')], [], true)
    const b = blk(
      root([row('pump', 'root'), row('electrolysis', 'root'), row('ammonia', 'root')], [p, f]),
      [['plastic', 252], ['rocket-fuel', 288], ['ammonia', 276]],
    )
    const r = solved(b)
    expect(node(r, 'pump@P').throughput).toBeCloseTo(252, 6)
    expect(node(r, 'pump@root').throughput).toBeCloseTo(564, 6)
    const water = flow(area(r, 'F').receives, 'water')!
    expect(water.rate).toBeCloseTo(288, 6)
    expect(water.boundary).toBe(false)
    expect(flow(area(r, 'root').sends, 'water')!.rate).toBeCloseTo(288, 6)
  })

  it('S5a: a byproduct that does not cover the area leaves each area its own x-make', () => {
    const a = sub('A', [row('r-main', 'A'), row('x-make', 'A'), row('use-x', 'A')], [], true)
    const b = blk(root([row('x-make', 'root'), row('use-x2', 'root')], [a]), [['y', 60], ['z', 100], ['w', 30]])
    const r = solved(b)
    expect(node(r, 'r-main@A').throughput).toBeCloseTo(60, 6)
    expect(node(r, 'x-make@A').throughput).toBeCloseTo(20, 6)
    expect(node(r, 'x-make@root').throughput).toBeCloseTo(15, 6)
    for (const ar of r.areas!) {
      expect(flow(ar.receives, 'x')).toBeUndefined()
      expect(flow(ar.sends, 'x')).toBeUndefined()
    }
  })

  it('S5b: a surplus byproduct goes to the area that makes x itself', () => {
    const a = sub('A', [row('r-main', 'A'), row('x-make', 'A'), row('use-x', 'A')], [], true)
    const b = blk(root([row('x-make', 'root'), row('use-x2', 'root')], [a]), [['y', 60], ['z', 40], ['w', 50]])
    const r = solved(b)
    expect(node(r, 'x-make@A').throughput).toBeCloseTo(0, 6)
    expect(node(r, 'x-make@root').throughput).toBeCloseTo(15, 6)
    expect(flow(area(r, 'A').sends, 'x')).toMatchObject({ boundary: false })
    expect(flow(area(r, 'A').sends, 'x')!.rate).toBeCloseTo(20, 6)
    expect(flow(area(r, 'root').receives, 'x')!.rate).toBeCloseTo(20, 6)
    expect(r.warnings.some(w => w.type === 'overconstrained')).toBe(false)
  })

  it('S6: an organising group inside an area belongs to that area', () => {
    const g = sub('G', [row('electrolysis', 'G')])
    const a = sub('A', [handle(g), row('plastic', 'A')], [g], true)
    const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')], [], true)
    const b = blk(
      root([row('electrolysis', 'root'), row('ammonia', 'root')], [a, f]),
      [['plastic', 252], ['rocket-fuel', 288], ['ammonia', 276]],
    )
    const flat = flattenBlock(b)
    expect(flat.areas!.map(x => x.id)).toEqual(['root', 'A', 'F'])
    expect(flat.areas![1].nodeIds).toContain('electrolysis@G')
    const r = solved(b)
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(276, 6)
    expect(node(r, 'electrolysis@G').throughput).toBeCloseTo(252, 6)
    expect(node(r, 'electrolysis@F').throughput).toBeCloseTo(288, 6)
    expect(r.areas!.map(x => x.areaId)).toEqual(['root', 'A', 'F'])
  })

  it('S8: productivity beats root-first when the area has no row of its own', () => {
    const science = sub('Science', [row('gear', 'Science', { modules: [{ moduleId: 'prod', count: 4 }] }), row('sci', 'Science')], [], true)
    const lab = sub('Lab', [row('inserter', 'Lab')], [], true)
    const b = blk(root([row('gear', 'root'), row('belt', 'root')], [science, lab]), [['belt', 60], ['sci', 84], ['inserter', 28]])
    const r = solved(b)
    expect(node(r, 'gear@root').throughput).toBeCloseTo(60, 6)
    expect(node(r, 'gear@Science').throughput).toBeCloseTo(80, 6)
    expect(flow(area(r, 'Lab').receives, 'gear')!.rate).toBeCloseTo(28, 6)
    expect(flow(area(r, 'Lab').receives, 'gear')!.boundary).toBe(false)
    expect(flow(area(r, 'Science').sends, 'gear')!.rate).toBeCloseTo(28, 6)
  })

  it('reports an area that cannot cover its own need (pinned row)', () => {
    const r = solved(scenario1(true, { pinnedRate: 200 }))
    expect(node(r, 'electrolysis@P').throughput).toBeCloseTo(200, 6)
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(328, 6)
    expect(node(r, 'electrolysis@F').throughput).toBeCloseTo(288, 6)
    const warning = r.warnings.find(w => w.type === 'area-shortfall')
    expect(warning).toBeDefined()
    if (warning?.type !== 'area-shortfall') throw new Error('unreachable')
    expect(warning.shortfalls).toHaveLength(1)
    expect(warning.shortfalls[0]).toMatchObject({ areaId: 'P', itemId: 'hydrogen' })
    expect(warning.shortfalls[0].rate).toBeCloseTo(52, 4)
  })

  it('flags duplicates per area, not across areas', () => {
    const p = sub('P', [row('electrolysis', 'P'), row('plastic', 'P')], [], true)
    const b = blk(
      root([row('electrolysis', 'root'), row('electrolysis', 'root2'), row('ammonia', 'root')], [p]),
      [['plastic', 60], ['ammonia', 60]],
    )
    const r = solved(b)
    expect(r.warnings).toContainEqual({ type: 'duplicate-recipe', recipeId: 'electrolysis', count: 2, areaId: 'root' })
    expect(r.warnings.filter(w => w.type === 'duplicate-recipe')).toHaveLength(1)
    expect(node(r, 'electrolysis@root2').throughput).toBe(0)
    expect(node(r, 'electrolysis@root').throughput).toBeCloseTo(60, 6)
    expect(node(r, 'electrolysis@P').throughput).toBeCloseTo(60, 6)
  })

  const equivalence = (areas: SubPlan[], nodes: RecipeNode[], goals: [string, number][]) => {
    const on = solved(blk(root(nodes, areas), goals))
    const off = solved(blk(root(nodes, areas.map(a => ({ ...a, area: undefined }))), goals))
    expect(on.nodes).toHaveLength(off.nodes.length)
    for (const n of on.nodes) {
      const o = node(off, n.recipeNodeId)
      expect(n.throughput).toBeCloseTo(o.throughput, 9)
      expect(n.machineCountExact).toBeCloseTo(o.machineCountExact, 9)
      expect(n.machineCountCeil).toBe(o.machineCountCeil)
    }
    expect(on.unsatisfied).toEqual(off.unsatisfied)
    expect(on.warnings).toEqual(off.warnings)
    return on
  }

  it('equals the plain solve when nothing is built twice', () => {
    const p = sub('P', [row('plastic', 'P')], [], true)
    const f = sub('F', [row('rocket-fuel', 'F')], [], true)
    const on = equivalence([p, f], [row('electrolysis', 'root'), row('ammonia', 'root')], [['plastic', 10], ['rocket-fuel', 20], ['ammonia', 30]])
    expect(flow(area(on, 'P').receives, 'hydrogen')!.rate).toBeCloseTo(10, 6)
    expect(flow(area(on, 'root').sends, 'hydrogen')!.rate).toBeCloseTo(30 + 10 + 20 - 30, 6)
  })

  it('has an entry for a trivial empty area', () => {
    const on = equivalence([sub('E', [], [], true)], [row('electrolysis', 'root'), row('ammonia', 'root')], [['ammonia', 30]])
    expect(on.areas).toHaveLength(2)
    expect(area(on, 'E')).toEqual({ areaId: 'E', receives: [], sends: [] })
  })

  it('conflicting pins in an area block name recipes and raise no shortfall', () => {
    const b = scenario1(true, { pinnedRate: 10 })
    b.noImportItems = ['hydrogen']
    const p = b.rootPlan.subPlans.find(x => x.id === 'P')!
    ;(p.nodes.find(n => n.id === 'plastic@P') as GameRecipeNode).pinnedRate = 500
    ;(b.rootPlan.nodes.find(n => n.id === 'electrolysis@root') as GameRecipeNode).pinnedRate = 5
    const f = b.rootPlan.subPlans.find(x => x.id === 'F')!
    ;(f.nodes.find(n => n.id === 'electrolysis@F') as GameRecipeNode).pinnedRate = 5
    const r = solved(b)
    const pins = r.warnings.find(w => w.type === 'infeasible-pins')
    expect(pins).toBeDefined()
    if (pins?.type === 'infeasible-pins') {
      expect(pins.recipeIds.every(id => id in gd().recipes)).toBe(true)
      expect(new Set(pins.recipeIds).size).toBe(pins.recipeIds.length)
    }
    expect(r.warnings.some(w => w.type === 'area-shortfall')).toBe(false)
  })
})

function scenario2Off(): Block {
  const p = sub('P', [row('electrolysis', 'P'), row('plastic', 'P')])
  const f = sub('F', [row('electrolysis', 'F'), row('rocket-fuel', 'F')])
  return blk(root([], [p, f]), [['plastic', 18], ['rocket-fuel', 18]])
}

describe('areas and R9 (blocks without areas)', () => {
  it('S7: absent and false flags solve like rows in the root and key like it', () => {
    const rowsIn = (flag: boolean | undefined) => {
      const a = sub('A', [row('plastic', 'A')], [], flag)
      return blk(root([row('electrolysis', 'root')], [a]), [['plastic', 60]])
    }
    const flat = blk(sub('root', [row('electrolysis', 'root'), row('plastic', 'A')]), [['plastic', 60]])
    for (const flag of [undefined, false]) {
      const b = rowsIn(flag)
      const plan = flattenBlock(b)
      expect('areas' in plan).toBe(false)
      expect(solve(plan, gd())).toStrictEqual(solve(flattenBlock(flat), gd()))
      expect(planKey(plan)).toBe(exactKey([plan.goals, plan.nodes, [], []]))
    }
    expect(planKey(flattenBlock(rowsIn(false)))).toBe(planKey(flattenBlock(rowsIn(undefined))))
  })

  it('caches a toggle as a different plan and the toggle off as the first one', () => {
    const cache = createSolveCache()
    const data = gd()
    const make = (on: boolean) => {
      const p = sub('P', [row('electrolysis', 'P'), row('plastic', 'P')], [], on ? true : undefined)
      return blk(root([row('electrolysis', 'root'), row('ammonia', 'root')], [p]), [['plastic', 60], ['ammonia', 60]])
    }
    const off1 = solveAll([make(false)], data, cache).results['block-1']
    const on = solveAll([make(true)], data, cache).results['block-1']
    expect(on).not.toBe(off1)
    expect(on.areas).toBeDefined()
    expect(solveAll([make(false)], data, cache).results['block-1']).toBe(off1)
    expect(planKey(flattenBlock(make(true)))).not.toBe(planKey(flattenBlock(make(false))))
  })

  it('a request cycle is solved again after an area is toggled in a member', () => {
    const data = gd()
    const cache = createSolveCache()
    const pair = (on: boolean | undefined): Block[] => {
      const g = sub('G', [row('fx', 'g')], [], on)
      const a = blk(root([], [g]), [['x', 60]], 'A')
      a.inputConnections = [{ id: 'ca', itemId: 'y', fromBlockId: 'B' }]
      const b = blk(sub('rootB', [row('fy', 'b')]), [['y', 0]], 'B')
      b.products = [{ id: 'p-y', itemId: 'y' }]
      b.inputConnections = [{ id: 'cb', itemId: 'x', fromBlockId: 'A' }]
      return [a, b]
    }
    solveAll(pair(undefined), data, cache)
    const lookup = vi.spyOn(cache, 'getRequestLoop')
    solveAll(pair(undefined), data, cache)
    expect(lookup.mock.results[0].value).toBeDefined()
    solveAll(pair(true), data, cache)
    expect(lookup.mock.results[1].value).toBeUndefined()
  })
})
