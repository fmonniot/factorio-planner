import { describe, it, expect, vi } from 'vitest'
import { sourceRulesOf } from '../test/sourceRulesOf'
import { solve, solveAll, solveBlock, flattenBlock, surplusTolerance } from './index'
import { subPlanAreaIds, areaRecipeIds, subPlanCopyBlocker } from './areas'
import { createSolveCache, exactKey, planKey } from './solveCache'
import { parseAppState } from '../data/loader'
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
    // Reactor neighbours: a reactor makes 10 heat per run on 1 fuel; two consumers of heat.
    recipe('reactor-run', [['fuel', 1]], [['power:heat', 10]], { category: 'rc' }),
    recipe('heat-use-a', [['power:heat', 10]], [['ha', 1]]),
    recipe('heat-use-b', [['power:heat', 10]], [['hb', 1]]),
    // Co-product driven: co-maker makes cp and 40 cw per run; co-user needs 100 cw per cgadget.
    recipe('co-maker', [], [['cp', 1], ['cw', 40]], { mainProduct: 'cp' }),
    recipe('co-user', [['cp', 1], ['cw', 100]], [['cgadget', 1]]),
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
      rx: {
        id: 'rx',
        name: 'rx',
        type: 'reactor',
        craftingSpeed: 1,
        energyUsageKw: 0,
        energyType: 'electric',
        drainKw: 0,
        moduleSlots: 0,
        allowedEffects: [],
        craftingCategories: ['rc'],
        neighbourBonus: 1,
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
    defaultMachines: { c: 'm', rc: 'rx' },
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
    sourceRules: {},
    inputConnections: [],
    rootPlan,
  }
}

/** Plan: nodes of `rootNodes` plus the given sub-factories, each with its own handle. */
function root(rootNodes: RecipeNode[], subs: SubPlan[]): SubPlan {
  return sub('root', [...rootNodes, ...subs.map(handle)], subs)
}

/** Invariants of `areaRoutes`: they decompose the per-area nets exactly (see spec/solver.md, "Areas"). */
function checkRoutes(r: SolverResult) {
  if (!r.areas) {
    expect(r.areaRoutes).toBeUndefined()
    return
  }
  const routes = r.areaRoutes!
  expect(routes).toBeDefined()
  const items = new Set([...r.areas.flatMap(a => [...a.sends, ...a.receives].map(f => f.itemId)), ...routes.map(x => x.itemId)])
  for (const itemId of items) {
    const mine = routes.filter(x => x.itemId === itemId)
    let pos = 0
    let neg = 0
    for (const a of r.areas) {
      const send = flow(a.sends, itemId)?.rate ?? 0
      const recv = flow(a.receives, itemId)?.rate ?? 0
      expect(send > 0 && recv > 0, `${a.areaId} both sends and receives ${itemId}`).toBe(false)
      pos += send
      neg += recv
      expect(mine.filter(x => x.from === a.areaId).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(send, 5)
      expect(mine.filter(x => x.to === a.areaId).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(recv, 5)
    }
    const tol = surplusTolerance(Math.max(pos, neg))
    const s = pos - neg
    expect(mine.filter(x => x.from === undefined).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(s < -tol ? -s : 0, 5)
    expect(mine.filter(x => x.to === undefined).reduce((n, x) => n + x.rate, 0)).toBeCloseTo(s > tol ? s : 0, 5)
    for (const x of mine) {
      expect(x.from === undefined && x.to === undefined).toBe(false)
      expect(x.from === x.to).toBe(false)
      expect(x.rate).toBeGreaterThan(0)
    }
  }
}

const solved = (b: Block) => {
  const r = solve(flattenBlock(b), gd())
  checkRoutes(r)
  return r
}
const routeOf = (r: SolverResult, itemId: string, from: string | undefined, to: string | undefined) =>
  r.areaRoutes!.find(x => x.itemId === itemId && x.from === from && x.to === to)?.rate
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

  it('gives a loaded plan\'s sub-factory to the area that holds its handle, whichever plan stored it', () => {
    // Saved when dragging a handle into another plan left the sub-plan where it was: the table
    // shows G under A, the tree stores G under the root.
    const g = sub('G', [row('electrolysis', 'G')])
    const a = sub('A', [handle(g), row('plastic', 'A')], [], true)
    const stranded = sub('root', [row('ammonia', 'root'), handle(a)], [a, g])
    const block = blk(stranded, [['plastic', 60], ['ammonia', 60]])

    const raw = flattenBlock(block).areas!
    expect(raw[0].nodeIds).toEqual(['ammonia@root', 'electrolysis@G'])

    const loaded = parseAppState({ blocks: [block], activeBlockId: block.id }).blocks[0]
    const areas = flattenBlock(loaded).areas!
    expect(areas.map(x => [x.id, x.nodeIds])).toEqual([
      ['root', ['ammonia@root']],
      ['A', ['plastic@A', 'electrolysis@G']],
    ])
    // A makes its own hydrogen and sends the root what the root's ammonia needs: it has only the one electrolysis row.
    const r = solved(loaded)
    expect(node(r, 'electrolysis@G').throughput).toBeCloseTo(120, 6)
    expect(flow(area(r, 'A').receives, 'hydrogen')).toBeUndefined()
    expect(flow(area(r, 'root').receives, 'hydrogen')!.rate).toBeCloseTo(60, 6)
  })

  it('has no areas unless a flag is on', () => {
    const plan = root([row('ammonia', 'root')], [sub('A', [], [], false), sub('B', [])])
    expect('areas' in flattenBlock(blk(plan, []))).toBe(false)
  })
})

describe('subPlanAreaIds', () => {
  it('maps a sub-plan to its own id when it is an area, else to the enclosing area', () => {
    const a2 = sub('A2', [], [], true)
    const a1 = sub('A1', [handle(a2)], [a2])
    const a = sub('A', [handle(a1)], [a1], true)
    const o = sub('O', [])
    const plan = root([], [a, o])
    expect(Object.fromEntries(subPlanAreaIds(plan))).toEqual({
      root: 'root', A: 'A', A1: 'A', A2: 'A2', O: 'root',
    })
  })

  it('maps everything to the root when no flag is on', () => {
    const plan = root([], [sub('A', [], [sub('B', [])]), sub('C', [])])
    expect(new Set(subPlanAreaIds(plan).values())).toEqual(new Set(['root']))
  })
})

describe('areaRecipeIds', () => {
  function layout(): SubPlan {
    const a2 = sub('A2', [], [], true)
    const a1 = sub('A1', [row('plate', 'A1')], [a2], false)
    const a = sub('A', [handle(a1), row('gear', 'A')], [a1], true)
    const o = sub('O', [row('copper', 'O')])
    return root([row('iron', 'root')], [a, o])
  }

  it('collects the recipes of the whole area around a sub-plan', () => {
    expect(areaRecipeIds(layout(), 'O')).toEqual(new Set(['iron', 'copper']))
    expect(areaRecipeIds(layout(), 'A1')).toEqual(new Set(['gear', 'plate']))
  })

  it('is empty for an area without rows and for an unknown sub-plan', () => {
    expect(areaRecipeIds(layout(), 'A2')).toEqual(new Set())
    expect(areaRecipeIds(layout(), 'missing')).toEqual(new Set())
  })
})

describe('subPlanCopyBlocker', () => {
  // root [iron, A, O]; A (area) [A1, gear]; A1 (organising) [plate, A2]; A2 (area) [iron]; O (organising) [copper]
  function layout(): SubPlan {
    const a2 = sub('A2', [row('iron', 'A2')], [], true)
    const a1 = sub('A1', [row('plate', 'A1'), handle(a2)], [a2], false)
    const a = sub('A', [handle(a1), row('gear', 'A')], [a1], true)
    const o = sub('O', [row('copper', 'O')])
    return root([row('iron', 'root')], [a, o])
  }

  it('allows a copy into an area without conflicting rows', () => {
    expect(subPlanCopyBlocker(layout(), 'O', 'A')).toBeUndefined()
  })

  it('reports the recipes the target area already builds', () => {
    expect(subPlanCopyBlocker(layout(), 'O', 'root')).toEqual({ reason: 'recipes', recipeIds: ['copper'] })
    expect(subPlanCopyBlocker(layout(), 'A1', 'A')).toEqual({ reason: 'recipes', recipeIds: ['plate'] })
  })

  it('leaves out rows of nested areas', () => {
    expect(subPlanCopyBlocker(layout(), 'A1', 'root')).toBeUndefined()
  })

  it('never conflicts for an area source', () => {
    expect(subPlanCopyBlocker(layout(), 'A', 'root')).toBeUndefined()
  })

  it('refuses a target inside the source', () => {
    expect(subPlanCopyBlocker(layout(), 'A', 'A')).toEqual({ reason: 'inside' })
    expect(subPlanCopyBlocker(layout(), 'A', 'A2')).toEqual({ reason: 'inside' })
  })

  it('refuses invalid sources and targets', () => {
    expect(subPlanCopyBlocker(layout(), 'A', 'O')).toEqual({ reason: 'invalid' })
    expect(subPlanCopyBlocker(layout(), 'root', 'A')).toEqual({ reason: 'invalid' })
    expect(subPlanCopyBlocker(layout(), 'missing', 'A')).toEqual({ reason: 'invalid' })
    expect(subPlanCopyBlocker(layout(), 'A', 'missing')).toEqual({ reason: 'invalid' })
  })
})

describe('areas in the solve', () => {
  it('each area column uses its own row neighbour count for the heat product', () => {
    const a = sub('A', [row('reactor-run', 'A'), row('heat-use-a', 'A')], [], true)
    const b = sub('B', [row('reactor-run', 'B', { neighbourCount: 1 }), row('heat-use-b', 'B')], [], true)
    const r = solved(blk(root([], [a, b]), [['ha', 60], ['hb', 60]]))
    const ra = node(r, 'reactor-run@A')
    const rb = node(r, 'reactor-run@B')
    expect(ra.outputRates['power:heat'] / ra.throughput).toBeCloseTo(10, 6)
    expect(rb.outputRates['power:heat'] / rb.throughput).toBeCloseTo(20, 6)
    expect(ra.throughput).toBeCloseTo(60, 4)
    expect(rb.throughput).toBeCloseTo(30, 4)
  })

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
    expect(r.areaRoutes!.filter(x => x.itemId === 'hydrogen')).toEqual([{ itemId: 'hydrogen', from: 'root', to: 'P', rate: expect.closeTo(252, 6) }])
  })

  it('routes the allowed shortfall of a pinned area from the root, and F stays self-sufficient', () => {
    const r = solved(scenario1(true, { pinnedRate: 200 }))
    expect(routeOf(r, 'hydrogen', 'root', 'P')).toBeCloseTo(52, 4)
    expect(r.areaRoutes!.some(x => x.itemId === 'hydrogen' && (x.to === 'F' || x.from === 'F'))).toBe(false)
  })

  it('keeps a restricted area off another area dedicated output', () => {
    // C makes x on purpose (pinned 20); R has its own x-make and must not be handed C's x.
    const a = sub('A', [row('r-main', 'A')], [], true)
    const c = sub('C', [row('x-make', 'C', { pinnedRate: 20 })], [], true)
    const rr = sub('R', [row('use-x', 'R'), row('x-make', 'R')], [], true)
    const r = solved(blk(root([row('use-x2', 'root')], [a, c, rr]), [['y', 20], ['z', 20], ['w', 30]]))
    expect(node(r, 'x-make@R').throughput).toBeCloseTo(0, 6)
    expect(routeOf(r, 'x', 'A', 'R')).toBeCloseTo(20, 4)
    expect(routeOf(r, 'x', 'C', 'root')).toBeCloseTo(30, 4)
    expect(routeOf(r, 'x', 'C', undefined)).toBeCloseTo(10, 4)
  })

  it('pairs two senders with two receivers in table order', () => {
    const b = sub('B', [row('electrolysis', 'B')], [], true)
    const p = sub('P', [row('plastic', 'P')], [], true)
    const f = sub('F', [row('rocket-fuel', 'F')], [], true)
    const r = solved(blk(
      root([row('electrolysis', 'root', { pinnedRate: 100 })], [b, p, f]),
      [['plastic', 80], ['rocket-fuel', 80]],
    ))
    expect(routeOf(r, 'hydrogen', 'root', 'P')).toBeCloseTo(80, 4)
    expect(routeOf(r, 'hydrogen', 'root', 'F')).toBeCloseTo(20, 4)
    expect(routeOf(r, 'hydrogen', 'B', 'F')).toBeCloseTo(60, 4)
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

  describe('byproducts first', () => {
    // The root's r-main makes 10 x on the side; S (an area) uses 30 x and has its own x-make.
    const s5 = (extra: Partial<Block> = {}): Block => ({
      ...blk(
        root([row('r-main', 'root')], [sub('S', [row('use-x', 's'), row('x-make', 's')], [], true)]),
        [['y', 10], ['z', 30]],
      ),
      ...extra,
    })

    it('runs the area\'s x-make without the mode', () => {
      const r = solved(s5())
      expect(node(r, 'x-make@s').throughput).toBeCloseTo(10, 6)
    })

    it('uses the other area\'s byproduct and imports the rest instead of running x-make', () => {
      const r = solved(s5({ sourceRules: { x: { makeHere: 'off' as const } } }))
      expect(node(r, 'x-make@s').throughput).toBeCloseTo(0, 6)
      expect(node(r, 'r-main@root').throughput).toBeCloseTo(10, 6)
      expect(r.unsatisfied.find(u => u.itemId === 'x')?.rate).toBeCloseTo(20, 6)
      expect(flow(area(r, 'root').sends, 'x')!.rate).toBeCloseTo(10, 6)
      expect(flow(area(r, 'S').receives, 'x')).toMatchObject({ boundary: true })
      expect(flow(area(r, 'S').receives, 'x')!.rate).toBeCloseTo(30, 6)
      expect(r.warnings.map(w => w.type)).not.toContain('overconstrained')
      expect(r.warnings.map(w => w.type)).not.toContain('area-shortfall')
    })
  })

  it('solves Import off like Import on under byproducts first, on an item a connection partly covers (area LP)', () => {
    const base = blk(
      root([row('r-main', 'root')], [sub('S', [row('use-x', 's'), row('x-make', 's')], [], true)]),
      [['y', 10], ['z', 30]],
    )
    const withSourcing = (sourcing: Record<string, 'byproducts-first' | 'connections-first'>, locked: string[]): Block => ({ ...base, sourceRules: sourceRulesOf(sourcing, locked) })
    const caps = () => new Map([['x', 5]])
    const run = (b: Block) => solveBlock(flattenBlock(b), gd(), caps())
    const pair = run(withSourcing({ x: 'byproducts-first' }, ['x']))
    expect(pair).toEqual(run(withSourcing({ x: 'byproducts-first' }, [])))
    expect(pair.result.nodes.find(n => n.recipeNodeId === 'x-make@s')!.throughput).toBeCloseTo(0, 6)
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
    b.sourceRules = { hydrogen: { importOff: true } }
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
      expect(planKey(plan)).toBe(exactKey([plan.goals, plan.nodes, []]))
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

describe('areas: coproduct-driven warning', () => {
  it('names the recipe, not the row column, of a recipe run for its co-product', () => {
    const b = blk(root([row('co-maker', 'root')], [sub('S', [row('co-user', 'S')], [], true)]), [['cgadget', 60]])
    const r = solved(b)
    expect(node(r, 'co-maker@root').throughput).toBeCloseTo(150, 3)
    const w = r.warnings.find(w => w.type === 'coproduct-driven')
    if (w?.type !== 'coproduct-driven') throw new Error('missing warning')
    expect(w.drivers).toHaveLength(1)
    expect(w.drivers[0].recipeId).toBe('co-maker')
    expect(w.drivers[0].itemIds).toEqual(['cw'])
    expect(w.drivers[0].needed).toBeCloseTo(60, 3)
  })
})
