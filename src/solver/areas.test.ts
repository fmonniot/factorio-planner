import { describe, it, expect, vi } from 'vitest'
import solver from 'javascript-lp-solver'
import { sourceRulesOf } from '../test/sourceRulesOf'
import { solve, solveAll, solveBlock, flattenBlock, surplusTolerance } from './index'
import { subPlanAreaIds, areaRecipeIds, subPlanCopyBlocker, areaRuleOf, areaLPItems } from './areas'
import { outsideLegParts } from './areaRoutes'
import { canonicalAreas, createSolveCache, exactKey, planKey, sourcingKey } from './solveCache'
import { coproductDrivenWarning } from './blockResult'
import { parseAppState } from '../data/loader'
import type { AreaRoute, AreaSourceRule, Block, GameData, GameRecipeNode, Product, RecipeNode, SolvedArea, SolverResult, SubPlan } from '../data/types'

// Areas: a sub-factory with `area: true` is solved as its own area. Every recipe takes 1 s in a
// speed-1 machine, so machineCountExact = throughput / 60. Fixtures are built fresh by each call.

// Delegates to the real function; lets a test read the set of items the warning is told cannot be imported.
vi.mock('./blockResult', async importOriginal => {
  const actual = await importOriginal<typeof import('./blockResult')>()
  return { ...actual, coproductDrivenWarning: vi.fn(actual.coproductDrivenWarning) }
})

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
    // The absorber chain: eat-x takes x (r-main's byproduct) and f, make-f makes f.
    recipe('eat-x', [['x', 1], ['f', 1]], [['v', 1]]),
    recipe('make-f', [['ore', 1]], [['f', 1]]),
    recipe('use-f', [['f', 1]], [['g', 1]]),
    // An absorbing row that takes pgear (use-plate's product) and x.
    recipe('eat-pgear', [['pgear', 1], ['x', 1]], [['pwaste', 1]]),
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
    // Area rules (case 21's plate recipes)
    recipe('make-plate', [['pore', 1]], [['plate', 1]]),
    recipe('use-plate', [['plate', 1]], [['pgear', 1]]),
    // Area rules, a connection replaces an import (phase 6, T3)
    recipe('smelt', [['ore', 1]], [['ingot', 1]]),
    recipe('plate-12', [['ingot', 1]], [['plate', 2]]),
    recipe('plate-11', [['ingot', 1]], [['plate', 1]]),
    recipe('make-rod', [['ore2', 1]], [['rod', 1]]),
    recipe('make-widget', [['rod', 1]], [['widget', 1]]),
    // A marked feeder's connected supply in the fallback: q-make (marked) makes q from a roll, eat-q (flagged) absorbs q, use-q (ordinary) uses it.
    recipe('q-make', [['roll', 1]], [['q', 4]]),
    recipe('eat-q', [['q', 1]], [['qw', 1]]),
    recipe('use-q', [['q', 1]], [['qg', 1]]),
    recipe('mine-roll', [['rock', 1]], [['roll', 1]]),
    recipe('burn-roll', [['roll', 1]], [['ash', 1]]),
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

  it('marks the feeder of an absorbing row in its own area, not the same recipe in an area without an absorber', () => {
    // S absorbs r-main's x with eat-x (flagged); make-f there runs only to supply the f it takes. T holds the same recipe, pinned, so it is no feeder.
    const b = blk(
      root([row('r-main', 'root')], [
        sub('S', [row('eat-x', 's', { byproductConsumer: true }), row('make-f', 's')], [], true),
        sub('T', [pin('make-f', 't', 1)], [], true),
      ]),
      [['y', 10]],
    )
    const { result } = solveBlock(flattenBlock(b), gd(), new Map())
    expect(node(result, 'make-f@s').throughput, 'the feeder runs').toBeGreaterThan(0)
    expect(node(result, 'make-f@t').throughput, 'the pinned row runs').toBeCloseTo(1, 6)
    expect(node(result, 'make-f@s').feedsAbsorber, 'feeder in S').toBe(true)
    expect(node(result, 'make-f@t').feedsAbsorber, 'same recipe in T').toBeUndefined()
    expect(node(result, 'eat-x@s').feedsAbsorber, 'the absorber itself').toBeUndefined()
  })

  it('a row marked to feed absorbing rows runs for them and for an ordinary row in another area', () => {
    // r-main makes 10 x for y 10; eat-x (flagged, in S) takes x and f. use-f (ordinary, in the root) also takes f, for g 3.
    const plan = (feeder: Partial<GameRecipeNode>): Block => blk(
      root([row('r-main', 'root'), row('use-f', 'root')], [
        sub('S', [row('eat-x', 's', { byproductConsumer: true }), row('make-f', 's', feeder)], [], true),
      ]),
      [['y', 10], ['g', 3]],
    )
    const marked = solveBlock(flattenBlock(plan({ absorberFeeder: true })), gd(), new Map()).result
    expect(node(marked, 'eat-x@s').throughput, 'eat-x').toBeCloseTo(10, 6)
    expect(node(marked, 'make-f@s').throughput, 'make-f').toBeCloseTo(13, 6)
    expect(node(marked, 'use-f@root').throughput, 'use-f').toBeCloseTo(3, 6)
    expect(node(marked, 'make-f@s').feedsAbsorber, 'marked row feeds the absorber').toBe(true)
    const plain = solveBlock(flattenBlock(plan({})), gd(), new Map()).result
    expect(node(plain, 'eat-x@s').throughput, 'eat-x unmarked').toBeCloseTo(0, 6)
    expect(node(plain, 'make-f@s').throughput, 'make-f unmarked').toBeCloseTo(3, 6)
    expect(node(plain, 'make-f@s').feedsAbsorber, 'unmarked row is no feeder').toBeUndefined()
  })

  it('a marked feeder keeps the supply for an ordinary row in a third area (fallback)', () => {
    // q-make (marked, in P) feeds eat-q (flagged, in K) and use-q (ordinary, in U); mine-roll and burn-roll (root) make and burn the roll.
    // The supply of roll would anchor q-make, so the fallback holds; the share of q-make still counts for use-q's 4 q (1 run, 1 roll).
    const b: Block = {
      ...blk(
        root([row('mine-roll', 'root'), row('burn-roll', 'root')], [
          sub('P', [row('q-make', 'P', { absorberFeeder: true })], [], true),
          sub('K', [row('eat-q', 'K', { byproductConsumer: true })], [], true),
          sub('U', [row('use-q', 'U')], [], true),
        ]),
        [['qg', 4]],
      ),
      sourceRules: { roll: { makeHere: 'after-blocks' } },
    }
    for (const cap of [100, Infinity]) {
      const { result: r, received } = solveBlock(flattenBlock(b), gd(), new Map([['roll', cap]]))
      expect(received.get('roll'), 'roll received').toBeCloseTo(1, 6)
      expect(node(r, 'q-make@P').throughput, 'q-make').toBeCloseTo(1, 6)
      expect(node(r, 'mine-roll@root').throughput, 'mine-roll').toBeCloseTo(0, 6)
      expect(node(r, 'eat-q@K').throughput, 'eat-q').toBeCloseTo(0, 6)
      expect(r.unsatisfied.filter(u => u.itemId === 'roll'), 'no missing roll').toEqual([])
    }
  })

  describe("the pair don't make more here + Import off (area LP)", () => {
    const pair = { makeHere: 'off' as const, importOff: true as const }
    // The area S uses 30 x through a byproduct consumer; the root's r-main makes 10 x on the side, both producers are pinned.
    const consumerPlan = (extra: Partial<Block> = {}): Block => ({
      ...blk(
        root([row('r-main', 'root')], [sub('S', [row('use-x', 's', { byproductConsumer: true }), row('x-make', 's')], [], true)]),
        [['y', 10], ['z', 30]],
      ),
      ...extra,
    })
    const pinnedPlan = (rule: Block['sourceRules'][string]): Block => ({
      ...blk(
        root([row('r-main', 'root', { pinnedRate: 10 })], [sub('S', [row('use-x', 's'), row('x-make', 's', { pinnedRate: 0 })], [], true)]),
        [['y', 10], ['z', 30]],
      ),
      sourceRules: { x: rule },
    })
    const run = (b: Block, caps: Map<string, number> = new Map()) => solveBlock(flattenBlock(b), gd(), caps)

    it("keeps a byproduct consumer's ingredient locked, with and without a connection that partly covers it", () => {
      for (const caps of [new Map<string, number>(), new Map([['x', 5]])]) {
        expect(run(consumerPlan({ sourceRules: { x: pair } }), caps)).toEqual(run(consumerPlan(), caps))
      }
    })

    it('leaves the item unlocked: a pin that cannot cover it leaves it missing, with no infeasible-pins', () => {
      const { result } = run(pinnedPlan(pair))
      expect(result.warnings.map(w => w.type)).not.toContain('infeasible-pins')
      expect(result.unsatisfied.find(u => u.itemId === 'x')?.rate).toBeCloseTo(20, 6)
    })

    it.each([
      ['Import off alone', { importOff: true as const }],
      ['Receive it first + Import off', { makeHere: 'after-blocks' as const, importOff: true as const }],
    ])('keeps the hard row for %s: the same pin makes the LP infeasible', (_name, rule) => {
      expect(run(pinnedPlan(rule)).result.warnings.map(w => w.type)).toContain('infeasible-pins')
    })

    it("tells the coproduct-driven check every Import-off item and the byproduct consumers' ingredients", () => {
      const b = consumerPlan({ sourceRules: { y: pair, w: { importOff: true }, z: { makeHere: 'off' } } })
      run(b)
      const told = vi.mocked(coproductDrivenWarning).mock.calls.at(-1)![0].noImportItems
      expect([...told].sort()).toEqual(['w', 'x', 'y'])
    })
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

// ---------------------------------------------------------------------------
// Area rules (phase 5, T4): each area's own rule for an item (`SubPlan.sourceRules`) in the area LP.
// ---------------------------------------------------------------------------

const withRules = (p: SubPlan, rules: Record<string, AreaSourceRule> | undefined): SubPlan => (rules ? { ...p, sourceRules: rules } : p)
const first: AreaSourceRule = { makeHere: 'after-blocks' }
const off: AreaSourceRule = { makeHere: 'off' }
type AreaRules = Record<string, Record<string, AreaSourceRule>>

/** Areas `order` (table order) with the given rows, each carrying its rules; the root has no rows. */
function plateBlock(order: string[], rows: Record<string, RecipeNode[]>, rules: AreaRules = {}, blockRules: Block['sourceRules'] = {}, products: [string, number][] = [['pgear', 20]]): Block {
  const b = blk(root([], order.map(id => withRules(sub(id, rows[id], [], true), rules[id]))), products)
  return { ...b, sourceRules: blockRules }
}
const pin = (recipeId: string, where: string, rate: number) => row(recipeId, where, { pinnedRate: rate })
/** L uses 12 plate and B uses 8 (both pinned), and each has a plate row of its own. */
const plateRowsA = (): Record<string, RecipeNode[]> => ({
  L: [pin('use-plate', 'L', 12), row('make-plate', 'L')],
  B: [pin('use-plate', 'B', 8), row('make-plate', 'B')],
})
/** The same, with the plate rows pinned at 0: plate is an intermediate with a residual in both areas. */
const plateRowsZero = (): Record<string, RecipeNode[]> => ({
  L: [pin('use-plate', 'L', 12), pin('make-plate', 'L', 0)],
  B: [pin('use-plate', 'B', 8), pin('make-plate', 'B', 0)],
})
const solvePlate = (b: Block, offer?: number) =>
  solveBlock(flattenBlock(b), gd(), new Map(offer === undefined ? [] : [['plate', offer]]))
const legsFor = (r: SolverResult, itemId: string): AreaRoute[] => (r.areaRoutes ?? []).filter(x => x.itemId === itemId)
const unsat = (r: SolverResult, itemId: string) => r.unsatisfied.find(u => u.itemId === itemId)?.rate ?? 0
/** A leg as [from, to, rate, supplied]; `supplied` absent where the table has a dash. */
type Leg = [from: string | undefined, to: string | undefined, rate: number, supplied?: number]
function expectLegs(r: SolverResult, itemId: string, want: Leg[]) {
  const got = legsFor(r, itemId)
  expect(got.map(l => [l.from, l.to]), `${itemId} legs`).toEqual(want.map(l => [l[0], l[1]]))
  got.forEach((l, i) => {
    expect(l.rate, `leg ${l.from}>${l.to} rate`).toBeCloseTo(want[i][2], 6)
    if (want[i][3] === undefined) expect(l, `leg ${l.from}>${l.to} supplied`).not.toHaveProperty('supplied')
    else expect(l.supplied, `leg ${l.from}>${l.to} supplied`).toBeCloseTo(want[i][3]!, 6)
  })
}
/** The parts of the outside leg into `areaId`, under that area's rule. */
function partsOf(b: Block, r: SolverResult, itemId: string, areaId: string) {
  const leg = legsFor(r, itemId).find(l => l.from === undefined && l.to === areaId)
  if (!leg) throw new Error(`no outside leg into ${areaId}`)
  const a = flattenBlock(b).areas!.find(x => x.id === areaId)!
  return outsideLegParts(leg, areaRuleOf(a, b.sourceRules, itemId))
}
const expectParts = (b: Block, r: SolverResult, areaId: string, [received, imported, missing]: [number, number, number]) => {
  const p = partsOf(b, r, 'plate', areaId)
  expect(p.received, `${areaId} received`).toBeCloseTo(received, 6)
  expect(p.imported, `${areaId} imported`).toBeCloseTo(imported, 6)
  expect(p.missing, `${areaId} missing`).toBeCloseTo(missing, 6)
}

describe('area rules: the plan carries them', () => {
  const ruled = (): Block => ({
    ...blk(
      { ...root([], [withRules(sub('L', plateRowsA().L, [], true), { plate: {} }), sub('B', plateRowsA().B, [], true)]), sourceRules: { plate: { makeHere: 'off' } } },
      [['pgear', 20]],
    ),
  })

  it('flattenBlock puts the rules of each area on its entry, only when it has some', () => {
    const b = ruled()
    const areas = flattenBlock(b).areas!
    expect(areas.map(a => a.id)).toEqual(['root', 'L', 'B'])
    expect(areas[0].rules).toBe(b.rootPlan.sourceRules)
    expect(areas[1].rules).toBe(b.rootPlan.subPlans[0].sourceRules)
    expect(areas[1].rules, 'a keyless rule is a rule').toEqual({ plate: {} })
    expect(areas[2]).not.toHaveProperty('rules')
  })

  it('carries nothing for an in-memory empty record, and keeps the plain areas of a plan with no rule', () => {
    const b = plateBlock(['L', 'B'], plateRowsA())
    const withEmpty: Block = { ...b, rootPlan: { ...b.rootPlan, sourceRules: {}, subPlans: b.rootPlan.subPlans.map(p => ({ ...p, sourceRules: {} })) } }
    expect(flattenBlock(withEmpty)).toStrictEqual(flattenBlock(b))
    for (const a of flattenBlock(b).areas!) expect(Object.keys(a).sort()).toEqual(['id', 'nodeIds'])
  })

  it('a block without areas gets none, and keys as without the root rules', () => {
    const plain = blk(sub('root', [row('electrolysis', 'root')]), [['hydrogen', 60]])
    const ruledRoot: Block = { ...plain, rootPlan: { ...plain.rootPlan, sourceRules: { hydrogen: { makeHere: 'off' } } } }
    expect(flattenBlock(ruledRoot)).not.toHaveProperty('areas')
    expect(planKey(flattenBlock(ruledRoot))).toBe(planKey(flattenBlock(plain)))
  })

  it('planKey: with no rule it is the goals, the nodes, the sourcing and the areas {id, nodeIds}', () => {
    const plan = flattenBlock(plateBlock(['L', 'B'], plateRowsA()))
    expect(planKey(plan)).toBe(exactKey([plan.goals, plan.nodes, sourcingKey(plan.sourceRules), plan.areas]))
    expect(plan.areas).toEqual([
      { id: 'root', nodeIds: [] },
      { id: 'L', nodeIds: ['use-plate@L', 'make-plate@L'] },
      { id: 'B', nodeIds: ['use-plate@B', 'make-plate@B'] },
    ])
  })

  it('planKey changes with an added or changed rule and is equal for equal rules', () => {
    const key = (rules: AreaRules) => planKey(flattenBlock(plateBlock(['L', 'B'], plateRowsA(), rules)))
    const none = key({})
    const variants: AreaRules[] = [
      { L: { plate: {} } },
      { L: { plate: off } },
      { L: { plate: first } },
      { L: { plate: { importOff: true } } },
      { L: { plate: { areasOff: ['B'] } } },
    ]
    const keys = variants.map(key)
    expect(new Set([none, ...keys]).size, 'every variant has its own key').toBe(variants.length + 1)
    expect(key({ L: { plate: off } })).toBe(keys[1])
  })

  it('planKey does not depend on the order of the ids in areasOff', () => {
    const key = (areasOff: string[]) => planKey(flattenBlock(plateBlock(['L', 'M1', 'M2'], { L: [], M1: [], M2: [] }, { L: { plate: { areasOff } } })))
    expect(key(['M1', 'M2'])).toBe(key(['M2', 'M1']))
    expect(key(['M1'])).not.toBe(key(['M1', 'M2']))
  })

  it('planKey and the request-cycle key do not depend on the order the rules were built in', () => {
    const a = flattenBlock(plateBlock(['L', 'B'], plateRowsA(), { L: { plate: { makeHere: 'off', importOff: true }, gear: first } }))
    const b = flattenBlock(plateBlock(['L', 'B'], plateRowsA(), { L: { gear: first, plate: { importOff: true, makeHere: 'off' } } }))
    expect(planKey(a)).toBe(planKey(b))
    expect(exactKey(canonicalAreas(a.areas!))).toBe(exactKey(canonicalAreas(b.areas!)))
  })

  it('a request cycle is solved again when an area rule is added or changed in a member', () => {
    const data = gd()
    const cache = createSolveCache()
    const pair = (rule: AreaSourceRule): Block[] => {
      const g = withRules(sub('G', [row('fx', 'g')], [], true), { y: rule })
      const a = blk(root([], [g]), [['x', 60]], 'A')
      a.inputConnections = [{ id: 'ca', itemId: 'y', fromBlockId: 'B' }]
      const b = blk(sub('rootB', [row('fy', 'b')]), [['y', 0]], 'B')
      b.products = [{ id: 'p-y', itemId: 'y' }]
      b.inputConnections = [{ id: 'cb', itemId: 'x', fromBlockId: 'A' }]
      return [a, b]
    }
    solveAll(pair({}), data, cache)
    const lookup = vi.spyOn(cache, 'getRequestLoop')
    const hit = (rule: AreaSourceRule) => {
      solveAll(pair(rule), data, cache)
      return lookup.mock.results.at(-1)!.value !== undefined
    }
    expect(hit({}), 'same rule').toBe(true)
    expect(hit({ makeHere: 'off' }), 'makeHere added').toBe(false)
    expect(hit({ makeHere: 'off' }), 'same again').toBe(true)
    expect(hit({ makeHere: 'off', importOff: true }), 'importOff added').toBe(false)
  })
})

describe('area rules: LP calls and what is read', () => {
  const calls = (b: Block, offer?: number) => {
    const spy = vi.spyOn(solver, 'Solve')
    try {
      solvePlate(b, offer)
      return spy.mock.calls.length
    } finally {
      spy.mockRestore()
    }
  }
  it('an area rule costs as many LP calls as the block-wide rule: 2 with no offer, 4 with an offer', () => {
    const area = plateBlock(['L', 'B'], plateRowsA(), { L: { plate: off } })
    const wide = plateBlock(['L', 'B'], plateRowsA(), {}, { plate: off })
    expect(calls(area)).toBe(2)
    expect(calls(wide)).toBe(2)
    expect(calls(area, 100)).toBe(4)
    expect(calls(wide, 100)).toBe(4)
  })

  it('step 6 with Import off on the area: a short offer leaves the rest missing', () => {
    const b = plateBlock(['L', 'B'], plateRowsA(), { L: { plate: { makeHere: 'off', importOff: true } } })
    const { result, received } = solvePlate(b, 5)
    checkRoutes(result)
    expect(received.get('plate')).toBeCloseTo(5, 6)
    expect(unsat(result, 'plate')).toBeCloseTo(7, 6)
    expectLegs(result, 'plate', [[undefined, 'L', 12, 5]])
    expectParts(b, result, 'L', [5, 0, 7])
  })

  it('step 6 with Import off on C1: the byproduct goes to C2 and what C1 lacks is missing', () => {
    const t = sub('T', [row('r-main', 'T')], [], true)
    const c1 = withRules(sub('C1', [pin('use-x', 'C1', 40)], [], true), { x: { makeHere: 'off', importOff: true } })
    const c2 = sub('C2', [pin('use-x', 'C2', 50), row('x-make', 'C2')], [], true)
    const b = blk(root([], [t, c1, c2]), [['y', 30], ['z', 90]])
    const { result } = solveBlock(flattenBlock(b), gd())
    checkRoutes(result)
    expect(node(result, 'x-make@C2').throughput, 'R').toBeCloseTo(10, 6)
    expect(unsat(result, 'x')).toBeCloseTo(40, 6)
    expectLegs(result, 'x', [['T', 'C2', 30], [undefined, 'C1', 40]])
    const leg = legsFor(result, 'x').find(l => l.to === 'C1')!
    const parts = outsideLegParts(leg, areaRuleOf(flattenBlock(b).areas![2], b.sourceRules, 'x'))
    expect([parts.received, parts.imported, parts.missing].map(n => Math.round(n * 1e6) / 1e6)).toEqual([0, 0, 40])
  })

  it('Import off is read per area at the LP level: a locked area that nobody can supply is infeasible', () => {
    // L uses 12 plate, B uses 8 and makes none (its plate row is pinned at 0), no offer.
    const rows = (): Record<string, RecipeNode[]> => ({ L: [pin('use-plate', 'L', 12)], B: [pin('use-plate', 'B', 8), pin('make-plate', 'B', 0)] })
    const locked = solvePlate(plateBlock(['L', 'B'], rows(), { L: { plate: { importOff: true } } })).result
    expect(locked.warnings).toContainEqual(expect.objectContaining({ type: 'infeasible-pins', conflict: true }))
    const free = solvePlate(plateBlock(['L', 'B'], rows())).result
    checkRoutes(free)
    expect(unsat(free, 'plate')).toBeCloseTo(20, 6)
    expectLegs(free, 'plate', [[undefined, 'L', 12], [undefined, 'B', 8]])
  })
})

describe('area rules: supplier switches', () => {
  const rounded = (r: SolverResult, itemId: string) => legsFor(r, itemId).map(l => ({ ...l, rate: Math.round(l.rate * 1e6) / 1e6 }))
  const freeRows = (): Record<string, RecipeNode[]> => ({
    L: [pin('use-plate', 'L', 12)], M1: [row('make-plate', 'M1')], M2: [row('make-plate', 'M2')],
  })
  const three = (rules: AreaRules, rows = freeRows(), offer?: number) => {
    const b = plateBlock(Object.keys(rows), rows, rules, {}, [['pgear', 12]])
    return { b, ...solvePlate(b, offer) }
  }

  it('case B shape: areasOff [M1] sends the plate from M2, and the legs decompose the nets', () => {
    const { result } = three({ L: { plate: { areasOff: ['M1'] } } })
    checkRoutes(result)
    expect(node(result, 'make-plate@M1').throughput).toBeCloseTo(0, 6)
    expect(node(result, 'make-plate@M2').throughput).toBeCloseTo(12, 6)
    expectLegs(result, 'plate', [['M2', 'L', 12]])
  })

  describe('stage 1 and stage 2 with flows per pair', () => {
    // L has its own plate row pinned at 4, so what it takes from M1's and M2's rows is penalised.
    const short = (rules: AreaRules) => {
      const rows = { ...freeRows(), L: [pin('use-plate', 'L', 12), pin('make-plate', 'L', 4)] }
      const b = plateBlock(['L', 'M1', 'M2'], rows, rules, {}, [['pgear', 12]])
      return solvePlate(b).result
    }
    const shortfall = (r: SolverResult) => {
      const w = r.warnings.find(x => x.type === 'area-shortfall')
      return w?.type === 'area-shortfall' ? w.shortfalls.map(x => ({ ...x, rate: Math.round(x.rate * 1e6) / 1e6 })) : []
    }
    it('no switch: M1 makes 8 and L reports the shortfall', () => {
      const r = short({})
      expect(node(r, 'make-plate@M1').throughput).toBeCloseTo(8, 6)
      expect(shortfall(r)).toEqual([{ areaId: 'L', itemId: 'plate', rate: 8 }])
    })
    it('areasOff [M1]: the bound holds on the pair flows, M2 makes 8, same shortfall', () => {
      const r = short({ L: { plate: { areasOff: ['M1'] } } })
      expect(node(r, 'make-plate@M1').throughput).toBeCloseTo(0, 6)
      expect(node(r, 'make-plate@M2').throughput).toBeCloseTo(8, 6)
      expect(shortfall(r)).toEqual([{ areaId: 'L', itemId: 'plate', rate: 8 }])
      checkRoutes(r)
      expectLegs(r, 'plate', [['M2', 'L', 8]])
    })
    it('areasOff [M1, M2]: no pair is left, plate is imported and there is no area-shortfall', () => {
      const r = short({ L: { plate: { areasOff: ['M1', 'M2'] } } })
      expect(node(r, 'make-plate@M1').throughput + node(r, 'make-plate@M2').throughput).toBeCloseTo(0, 6)
      expect(unsat(r, 'plate')).toBeCloseTo(8, 6)
      expect(shortfall(r)).toEqual([])
    })
  })

  describe('a switched-off supplier that is pinned', () => {
    const rows = (): Record<string, RecipeNode[]> => ({ L: [pin('use-plate', 'L', 12)], M1: [pin('make-plate', 'M1', 12)], M2: [row('make-plate', 'M2')] })
    it('its output shows as a surplus, not as a route to L', () => {
      const { result } = three({ L: { plate: { areasOff: ['M1'] } } }, rows())
      checkRoutes(result)
      expect(node(result, 'make-plate@M2').throughput).toBeCloseTo(12, 6)
      expect(node(result, 'make-plate@M1').throughput).toBeCloseTo(12, 6)
      expectLegs(result, 'plate', [['M1', undefined, 12], ['M2', 'L', 12]])
      expect(flow(area(result, 'M1').sends, 'plate')?.rate).toBeCloseTo(12, 6)
      const w = result.warnings.find(x => x.type === 'overconstrained')
      expect(w, 'overconstrained').toBeDefined()
      expect(JSON.stringify(w)).toContain('plate')
    })
    it('control, no switch: M1 supplies L and M2 makes nothing', () => {
      const { result } = three({}, rows())
      checkRoutes(result)
      expect(node(result, 'make-plate@M2').throughput).toBeCloseTo(0, 6)
      expectLegs(result, 'plate', [['M1', 'L', 12]])
    })
  })

  it('a switch in one area and a rule in another: the offer passes through B to L', () => {
    const rows = {
      L: [pin('use-plate', 'L', 12)], B: [pin('use-plate', 'B', 8), row('make-plate', 'B')], M: [row('make-plate', 'M')],
    }
    const b = plateBlock(['L', 'B', 'M'], rows, { L: { plate: { areasOff: ['M'] } }, B: { plate: first } })
    const { result, received } = solvePlate(b, 100)
    checkRoutes(result)
    expect(node(result, 'make-plate@B').throughput).toBeCloseTo(12, 6)
    expect(node(result, 'make-plate@M').throughput).toBeCloseTo(0, 6)
    expect(received.get('plate') ?? 0).toBeCloseTo(8, 6)
    expect(unsat(result, 'plate')).toBeCloseTo(0, 6)
    expectLegs(result, 'plate', [['B', 'L', 4], [undefined, 'L', 8, 8]])
  })

  describe('an inert switch changes nothing', () => {
    const plain = () => three({}).result
    it('naming an area that does not touch the item', () => {
      const rows = { ...freeRows(), N: [row('copper', 'N')] }
      const b = plateBlock(['L', 'M1', 'M2', 'N'], rows, { L: { plate: { areasOff: ['N'] } } }, {}, [['pgear', 12]])
      const base = plateBlock(['L', 'M1', 'M2', 'N'], rows, {}, {}, [['pgear', 12]])
      expect(solvePlate(b).result).toEqual(solvePlate(base).result)
    })
    it('naming the area itself', () => {
      expect(three({ L: { plate: { areasOff: ['L'] } } }).result).toEqual(plain())
    })
  })

  describe('equivalence with an inert switch: a switch that removes no flow pairs as the pools do', () => {
    // Senders make plate (pinned), receivers use it (pinned); the senders' sum exceeds the receivers'.
    function blockSurplus(senders: number[], receivers: number[], perSender: number, perReceiver: number, rules: AreaRules = {}): Block {
      const ss = senders.map(i => sub(`S${i}`, [pin('make-plate', `S${i}`, perSender)], [], true))
      const rs = receivers.map(i => withRules(sub(`R${i}`, [pin('use-plate', `R${i}`, perReceiver)], [], true), rules[`R${i}`]))
      return blk(root([], [...ss, ...rs]), [['pgear', perReceiver * receivers.length]])
    }
    const run = (b: Block) => rounded(solveBlock(flattenBlock(b), gd()).result, 'plate')
    const scenarios: Array<[string, number[], number[]]> = [
      ['2 senders, 2 receivers', [0, 1], [0, 1]],
      ['3 senders, 3 receivers', [0, 1, 2], [0, 1, 2]],
      ['5 senders, 5 receivers', [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]],
      ['3 senders, 2 receivers', [0, 1, 2], [0, 1]],
    ]
    for (const [name, ss, rs] of scenarios) {
      it(`${name}: the routes equal the pooled ones`, () => {
        const switched: AreaRules = { R0: { plate: { areasOff: ['R1'] } } }
        expect(run(blockSurplus(ss, rs, 10, 7, switched))).toEqual(run(blockSurplus(ss, rs, 10, 7)))
      })
    }
    it('2 senders, 2 receivers: S0>R0 7, S0>R1 3, S1>R1 4, S1>outside 6', () => {
      const r = run(blockSurplus([0, 1], [0, 1], 10, 7, { R0: { plate: { areasOff: ['R1'] } } }))
      expect(r.map(l => [l.from, l.to, l.rate])).toEqual([['S0', 'R0', 7], ['S0', 'R1', 3], ['S1', 'R1', 4], ['S1', undefined, 6]])
    })
  })

  it('a relay stays visible as two legs (characterisation; the legs do not decompose the nets, so no checkRoutes)', () => {
    // c makes 12, a makes 12 and uses 12, b uses 12 and takes nothing from c: c sends to a, a sends on to b.
    // The nets say c sends 12 and b receives 12; the legs say c to a and a to b.
    const rows = {
      c: [pin('make-plate', 'c', 12)],
      a: [pin('make-plate', 'a', 12), pin('use-plate', 'a', 12)],
      b: [pin('use-plate', 'b', 12)],
    }
    const b = plateBlock(['c', 'a', 'b'], rows, { b: { plate: { areasOff: ['c'] } } }, {}, [['pgear', 24]])
    const { result } = solvePlate(b)
    expectLegs(result, 'plate', [['c', 'a', 12], ['a', 'b', 12]])
  })

  it('a goal touched by two areas where one switches the other off takes the pair path with valid routes', () => {
    const rows = { L: [pin('use-plate', 'L', 12)], M: [row('use-plate', 'M'), row('make-plate', 'M')] }
    const b = plateBlock(['L', 'M'], rows, { L: { pgear: { areasOff: ['M'] } } }, {}, [['pgear', 20]])
    const { result } = solvePlate(b)
    checkRoutes(result)
    expect(result.nodes).toHaveLength(3)
    expect(node(result, 'use-plate@L').throughput).toBeCloseTo(12, 6)
    expect(node(result, 'use-plate@M').throughput).toBeCloseTo(8, 6)
    expect(node(result, 'make-plate@M').throughput).toBeCloseTo(20, 6)
    expect(unsat(result, 'pgear')).toBeCloseTo(0, 6)
    expectLegs(result, 'plate', [['M', 'L', 12]])
  })

  describe('the area-cut-off warning', () => {
    const cutRules = (extra: AreaSourceRule = {}): AreaRules => ({ L: { plate: { importOff: true, areasOff: ['M1', 'M2'], ...extra } } })
    const freeL = (): Record<string, RecipeNode[]> => ({ L: [row('use-plate', 'L')], M1: [row('make-plate', 'M1')], M2: [row('make-plate', 'M2')] })
    it('names the area and the item, and the goal is left short', () => {
      const { result } = three(cutRules(), freeL())
      expect(result.unsatisfied).toEqual([{ itemId: 'pgear', rate: 12 }])
      expect(result.warnings).toEqual([{ type: 'area-cut-off', cutOffs: [{ areaId: 'L', itemId: 'plate' }] }])
      for (const id of ['use-plate@L', 'make-plate@M1', 'make-plate@M2']) expect(node(result, id).throughput).toBeCloseTo(0, 6)
    })
    it('a pinned consumer is infeasible-pins with a conflict, not a cut-off', () => {
      const { result } = three(cutRules())
      expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'infeasible-pins', conflict: true }))
      expect(result.warnings.some(w => w.type === 'area-cut-off')).toBe(false)
    })
    const silent = (name: string, rules: AreaRules, rows = freeL(), offer?: number) => it(`silent: ${name}`, () => {
      const { result } = three(rules, rows, offer)
      expect(result.warnings.some(w => w.type === 'area-cut-off')).toBe(false)
    })
    silent('Import on', { L: { plate: { areasOff: ['M1', 'M2'] } } })
    silent('an offer', cutRules(), freeL(), 100)
    silent('one supplier left', cutRules({ areasOff: ['M1'] }))
    silent('L has its own plate row', cutRules(), { ...freeL(), L: [row('use-plate', 'L'), row('make-plate', 'L')] })
    silent('a second consumer meets the goal', cutRules(), { ...freeL(), K: [row('use-plate', 'K')] })
    it('names an area cut off for an item that a row marked to feed absorbing rows takes', () => {
      // use-plate (marked) is the only maker of pgear for eat-pgear (flagged, anchored by x, which x-make makes for a goal).
      const rows = {
        ...freeL(),
        L: [row('use-plate', 'L', { absorberFeeder: true }), row('eat-pgear', 'L', { byproductConsumer: true })],
        N: [row('x-make', 'N')],
      }
      const b = plateBlock(Object.keys(rows), rows, cutRules(), {}, [['pgear', 12], ['x', 1]])
      const { result } = solvePlate(b)
      expect(result.unsatisfied).toContainEqual({ itemId: 'pgear', rate: 12 })
      expect(result.warnings.filter(w => w.type === 'area-cut-off')).toEqual([{ type: 'area-cut-off', cutOffs: [{ areaId: 'L', itemId: 'plate' }] }])
    })
    it('blames only an area whose rows serve a short goal, not one that is cut off for nothing', () => {
      // L is cut off for plate but no goal needs pgear; K is cut off for x and z is short.
      const rows = { ...freeL(), K: [row('use-x', 'K')], N: [row('x-make', 'N')] }
      const rules: AreaRules = { ...cutRules(), K: { x: { importOff: true, areasOff: ['N'] } } }
      const b = plateBlock(Object.keys(rows), rows, rules, {}, [['z', 12]])
      const { result } = solvePlate(b)
      expect(result.unsatisfied).toEqual([{ itemId: 'z', rate: 12 }])
      expect(result.warnings.filter(w => w.type === 'area-cut-off')).toEqual([{ type: 'area-cut-off', cutOffs: [{ areaId: 'K', itemId: 'x' }] }])
    })
  })
})

describe('area rules: a short offer between two areas with residuals (offer 5 below 12 + 8)', () => {
  type Want = { legs: Leg[]; parts: Array<[string, [number, number, number]]> }
  const run = (order: string[], rules: AreaRules) => {
    const b = plateBlock(order, plateRowsZero(), rules)
    const { result } = solvePlate(b, 5)
    checkRoutes(result)
    return { b, result }
  }
  const check = (order: string[], rules: AreaRules, want: Want) => {
    const { b, result } = run(order, rules)
    expectLegs(result, 'plate', want.legs)
    for (const [id, parts] of want.parts) expectParts(b, result, id, parts)
  }

  describe('(i) L: Import off', () => {
    const rules = { L: { plate: { importOff: true as const } } }
    it('L above B: L takes the offer and misses the rest', () => {
      check(['L', 'B'], rules, { legs: [[undefined, 'L', 12, 5], [undefined, 'B', 8]], parts: [['L', [5, 0, 7]]] })
    })
    it('B above L: B takes the offer and L misses all 12', () => {
      check(['B', 'L'], rules, { legs: [[undefined, 'B', 8, 5], [undefined, 'L', 12]], parts: [['L', [0, 0, 12]]] })
    })
  })

  describe('(ii) L: Receive it first, B: Receive it first with Import off', () => {
    const rules = { L: { plate: first }, B: { plate: { makeHere: 'after-blocks' as const, importOff: true as const } } }
    it('L above B', () => {
      check(['L', 'B'], rules, { legs: [[undefined, 'L', 12, 5], [undefined, 'B', 8]], parts: [['B', [0, 0, 8]]] })
    })
    it('B above L', () => {
      check(['B', 'L'], rules, { legs: [[undefined, 'B', 8, 5], [undefined, 'L', 12]], parts: [['B', [5, 0, 3]], ['L', [0, 12, 0]]] })
    })
  })

  describe('(iii) characterisation: L Receive it first alone, the pass-2 offer goes by table order', () => {
    const rules = { L: { plate: first } }
    it('L above B', () => {
      check(['L', 'B'], rules, { legs: [[undefined, 'L', 12, 5], [undefined, 'B', 8]], parts: [] })
    })
    it('B above L', () => {
      check(['B', 'L'], rules, { legs: [[undefined, 'B', 8, 5], [undefined, 'L', 12]], parts: [] })
    })
  })
})

describe('area rules: where the LP is indifferent', () => {
  it('characterisation (case 21 C b): the byproduct goes to C1 and the imports to the lower receivers', () => {
    // The block does not make X more than it has; T makes 30, C1 uses 40, C2 uses 50, 60 are imported. Which receiver takes the byproduct is
    // not decided by the LP. Before area rules the pairing gave T>C2 30, out>C1 40, out>C2 20; the nets and the total import are the same.
    const t = sub('T', [row('r-main', 'T')], [], true)
    const c1 = sub('C1', [pin('use-x', 'C1', 40)], [], true)
    const c2 = sub('C2', [pin('use-x', 'C2', 50), row('x-make', 'C2')], [], true)
    const b = { ...blk(root([], [t, c1, c2]), [['y', 30], ['z', 90]]), sourceRules: { x: off } }
    const { result } = solveBlock(flattenBlock(b), gd())
    checkRoutes(result)
    expect(node(result, 'x-make@C2').throughput).toBeCloseTo(0, 6)
    expect(unsat(result, 'x')).toBeCloseTo(60, 6)
    expectLegs(result, 'x', [['T', 'C1', 30], [undefined, 'C1', 10], [undefined, 'C2', 50]])
  })
})

describe('area rules: the supply rank and the net sender', () => {
  it('a late area is supplied rather than taking another area\'s surplus', () => {
    // Z (index 1) makes 12 plate that nothing uses; L, 12 areas further down, uses 12 and Receives it first: the tie-break on the supply stays
    // below taking Z's surplus, whatever L's rank.
    const fillers = Array.from({ length: 11 }, (_, i) => sub(`F${i}`, [pin('use-plate', `F${i}`, 0)], [], true))
    const z = sub('Z', [pin('make-plate', 'Z', 12)], [], true)
    const l = withRules(sub('L', [pin('use-plate', 'L', 12), row('make-plate', 'L')], [], true), { plate: first })
    const b = blk(root([], [z, ...fillers, l]), [['pgear', 12]])
    const { result } = solveBlock(flattenBlock(b), gd(), new Map([['plate', 100]]))
    const into = legsFor(result, 'plate').filter(r => r.to === 'L')
    expect(into.map(r => r.from), 'L takes the offer, not Z').toEqual([undefined])
    expect(into[0].supplied).toBeCloseTo(12, 6)
  })

  it('a net sender with a rule: Receive it first on L, which makes 10 and uses 4, leaves no unbalanced outside leg', () => {
    const l = withRules(sub('L', [pin('use-plate', 'L', 4), pin('make-plate', 'L', 10)], [], true), { plate: first })
    const m = sub('M', [pin('use-plate', 'M', 3)], [], true)
    const b = blk(root([], [l, m]), [['pgear', 7]])
    const { result } = solveBlock(flattenBlock(b), gd(), new Map([['plate', 100]]))
    checkRoutes(result)
    const legs = legsFor(result, 'plate')
    const into = (to: string | undefined) => legs.filter(r => r.to === to).reduce((x, r) => x + r.rate, 0)
    const out = (from: string | undefined) => legs.filter(r => r.from === from).reduce((x, r) => x + r.rate, 0)
    // L's net is a send of 6, M takes 3, the surplus 3 leaves the block
    expect(out('L') - into('L')).toBeCloseTo(6, 6)
    expect(into('M') - out('M')).toBeCloseTo(3, 6)
  })

  it('a supply that passes through: L uses and makes 10 and takes the offer, B takes the plate from the outside', () => {
    // L's net is 0 but its supply is 10 (bounded by its use): the routes keep agreeing with the nets, so B's receive is served from the outside.
    const l = withRules(sub('L', [pin('use-plate', 'L', 10), pin('make-plate', 'L', 10)], [], true), { plate: first })
    const m = sub('B', [pin('use-plate', 'B', 10)], [], true)
    const b = blk(root([], [l, m]), [['pgear', 20]])
    const { result } = solveBlock(flattenBlock(b), gd(), new Map([['plate', 100]]))
    checkRoutes(result)
    expectLegs(result, 'plate', [[undefined, 'B', 10, 10]])
  })
})

describe('area rules: the second pass trigger', () => {
  it('compares the item\'s total residual with the noise floor, not each area\'s: two residuals of 0.006 at a flow of 1e6 are filled', () => {
    // The tolerance at this flow is 0.01. Each area's residual is below it, their sum is not.
    const l = sub('L', [pin('use-plate', 'L', 500000.006), pin('make-plate', 'L', 500000)], [], true)
    const m = sub('B', [pin('use-plate', 'B', 500000.006), pin('make-plate', 'B', 500000)], [], true)
    const b = blk(root([], [l, m]), [['pgear', 1000000.012]])
    const { result, received } = solveBlock(flattenBlock(b), gd(), new Map([['plate', 100]]))
    expect(received.get('plate') ?? 0).toBeCloseTo(0.012, 6)
    expect(unsat(result, 'plate')).toBeCloseTo(0, 6)
  })
})

describe('area rules: a connection replaces an import (phase 6, T3)', () => {
  type Offers = Array<[string, number]>
  const solveWith = (b: Block, offers: Offers) => solveBlock(flattenBlock(b), gd(), new Map(offers))
  /** The models handed to the LP solver by `fn`, in call order. */
  type Model = { optimize: string; constraints: Record<string, { max?: number }>; variables: Record<string, Record<string, number>> }
  const modelsOf = (fn: () => void) => {
    const spy = vi.spyOn(solver, 'Solve')
    try {
      fn()
      return spy.mock.calls.map(c => c[0] as unknown as Model)
    } finally {
      spy.mockRestore()
    }
  }
  const callsOf = (b: Block, offers: Offers) => modelsOf(() => solveWith(b, offers)).length
  const outsideInto = (r: SolverResult, itemId: string, to: string) => legsFor(r, itemId).find(l => l.from === undefined && l.to === to)

  // Case 22 C a in the areas fixtures: L uses the plate, M turns 10 ingots into 20 plate.
  const baseRows = (): Record<string, RecipeNode[]> => ({
    L: [row('use-plate', 'L')],
    M: [row('plate-12', 'M'), pin('smelt', 'M', 10)],
  })
  const base = (rules: AreaRules = {}, blockRules: Block['sourceRules'] = {}) => plateBlock(['L', 'M'], baseRows(), rules, blockRules, [['pgear', 50]])
  const BASE_OFFERS: Offers = [['plate', 100]]

  // Rod is made and used in L (plain item), or made in M too (area item).
  const rodRows = (inM: boolean): Record<string, RecipeNode[]> => ({
    L: [row('use-plate', 'L'), row('make-widget', 'L'), ...(inM ? [] : [row('make-rod', 'L')])],
    M: [row('plate-12', 'M'), pin('smelt', 'M', 10), ...(inM ? [row('make-rod', 'M')] : [])],
  })
  const rodBlock = (inM: boolean, rules: AreaRules, blockRules: Block['sourceRules'] = {}) =>
    plateBlock(['L', 'M'], rodRows(inM), rules, blockRules, [['pgear', 50], ['widget', 5]])
  const ROD_OFFERS: Offers = [['plate', 100], ['rod', 3]]

  const expectRodOff = (r: SolverResult, received: Map<string, number>, rodRun: string, digits = 6) => {
    checkRoutes(r)
    expect(received.get('plate') ?? 0, 'plate received').toBeCloseTo(30, digits)
    expect(received.get('rod') ?? 0, 'rod received').toBeCloseTo(3, digits)
    expect(unsat(r, 'rod'), 'rod imported').toBeCloseTo(2, digits)
    expect(unsat(r, 'ingot'), 'ingot imported').toBeCloseTo(0, digits)
    expect(unsat(r, 'plate'), 'plate imported').toBeCloseTo(0, digits)
    expect(node(r, 'plate-12@M').throughput, 'P').toBeCloseTo(10, digits)
    expect(node(r, rodRun).throughput, 'R').toBeCloseTo(0, digits)
    const leg = outsideInto(r, 'plate', 'L')
    expect(leg?.rate, 'plate leg into L').toBeCloseTo(30, digits)
    expect(leg?.supplied, 'plate leg supplied').toBeCloseTo(30, digits)
  }

  it('1a: Don\'t make more here on a plain item (block rule) keeps its connection beside a touched plate', () => {
    const b = rodBlock(false, {}, { rod: off })
    const { result, received } = solveWith(b, ROD_OFFERS)
    expectRodOff(result, received, 'make-rod@L')
  })

  it('1b: Don\'t make more here on a plain item (rule of the only area touching it)', () => {
    const b = rodBlock(false, { L: { rod: off } })
    const { result, received } = solveWith(b, ROD_OFFERS)
    expectRodOff(result, received, 'make-rod@L')
  })

  it('2: Don\'t make more here on an area item keeps its connection beside a touched plate', () => {
    const b = rodBlock(true, { L: { rod: off } })
    const { result, received } = solveWith(b, ROD_OFFERS)
    expectRodOff(result, received, 'make-rod@M')
    expectLegs(result, 'rod', [[undefined, 'L', 5, 3]])
    const leg = legsFor(result, 'rod')[0]
    const parts = outsideLegParts(leg, areaRuleOf(flattenBlock(b).areas![0], b.sourceRules, 'rod'))
    expect([parts.received, parts.imported, parts.missing].map(n => Math.round(n * 1e6) / 1e6)).toEqual([3, 2, 0])
  })

  it('3: characterisation, Receive it first on rod beside a touched plate', () => {
    const b = rodBlock(true, { L: { rod: first } })
    const { result, received } = solveWith(b, ROD_OFFERS)
    checkRoutes(result)
    expect(received.get('plate') ?? 0, 'plate received').toBeCloseTo(30, 6)
    expect(received.get('rod') ?? 0, 'rod received').toBeCloseTo(3, 6)
    expect(node(result, 'plate-12@M').throughput, 'P').toBeCloseTo(10, 6)
    expect(node(result, 'make-rod@M').throughput, 'R').toBeCloseTo(2, 6)
    expect(unsat(result, 'rod'), 'rod imported').toBeCloseTo(0, 6)
    expect(unsat(result, 'ingot'), 'ingot imported').toBeCloseTo(0, 6)
  })

  it('4: characterisation, a shared offer with one area on Receive it first and one on the default', () => {
    // Not a discriminating test of the `received: false` flag on first areas: the totals coincide either way.
    const rows = {
      L1: [pin('use-plate', 'L1', 20)],
      L2: [pin('use-plate', 'L2', 30)],
      M: [row('plate-12', 'M'), pin('smelt', 'M', 10)],
    }
    const b = plateBlock(['L1', 'L2', 'M'], rows, { L1: { plate: first } }, {}, [['pgear', 50]])
    const { result, received } = solveWith(b, [['plate', 100]])
    checkRoutes(result)
    expect(received.get('plate') ?? 0, 'plate received').toBeCloseTo(30, 6)
    expect(node(result, 'plate-12@M').throughput, 'P').toBeCloseTo(10, 6)
    expect(unsat(result, 'ingot'), 'ingot imported').toBeCloseTo(0, 6)
    expectLegs(result, 'plate', [['M', 'L2', 20], [undefined, 'L1', 20, 20], [undefined, 'L2', 10, 10]])
  })

  describe('a locked connected item with no step-3 slack is locked again in the fill (structural)', () => {
    // No fixture was found where dropping the relock changes a visible value (tried: the case 22 C b and the area variants,
    // alone and with a second offer, a block rule): a locked item's slack matters only in an exact tie of units with another
    // import, and the vertex step 3 picks is not derivable by hand. So these read the models handed to the solver, by their
    // rows and not by variable names or call positions: the fill is the model with the received bound, the import slacks of a
    // model are the variables its import-sum row (`__imp` objective in step 2, `__impcap` in the fill) runs over.
    const importVars = (m: Model, key: string) => Object.keys(m.variables).filter(v => key in m.variables[v])
    const dropped = (models: Model[]) => {
      const step2 = models.filter(m => m.optimize === '__imp')
      const fills = models.filter(m => m.constraints.__reccap !== undefined)
      expect(step2, 'one least-import step').toHaveLength(1)
      expect(fills.length, 'the fill ran').toBeGreaterThan(0)
      const before = importVars(step2[0], '__imp')
      return fills.map(f => before.filter(v => !importVars(f, '__impcap').includes(v)))
    }

    it('plain item: the ingot is Import off with an offer (case 22 C b)', () => {
      const rows = baseRows()
      rows.M = [row('plate-11', 'M'), pin('smelt', 'M', 10)]
      const b = plateBlock(['L', 'M'], rows, {}, { ingot: { importOff: true } }, [['pgear', 50]])
      for (const d of dropped(modelsOf(() => solveWith(b, [['ingot', 100]])))) expect(d, 'the fill drops the ingot slack, and only it').toHaveLength(1)
    })

    it('area item: plate is Import off in L', () => {
      const b = base({ L: { plate: { importOff: true } } })
      for (const d of dropped(modelsOf(() => solveWith(b, BASE_OFFERS)))) expect(d, 'the fill drops the slack of L, and only it').toHaveLength(1)
    })

    it('an item that is not locked keeps its slack in the fill', () => {
      for (const d of dropped(modelsOf(() => solveWith(base(), BASE_OFFERS)))) expect(d, 'nothing dropped').toHaveLength(0)
    })
  })

  describe('the gate sums an area item\'s slacks and compares them with the item\'s floor', () => {
    const noisy = (extra: number) => {
      const rows = {
        L: [pin('use-plate', 'L', 500000 + extra), pin('make-plate', 'L', 500000), row('make-widget', 'L'), row('make-rod', 'L')],
        B: [pin('use-plate', 'B', 500000 + extra), pin('make-plate', 'B', 500000)],
      }
      return plateBlock(['L', 'B'], rows, {}, {}, [['pgear', 1000000 + 2 * extra], ['widget', 5]])
    }
    it('two slacks of 0.006 add up to 0.012, above the floor of 0.01: the order is tried (3 calls)', () => {
      expect(callsOf(noisy(0.006), [['rod', 100]])).toBe(3)
    })
    it('two slacks of 0.004 add up to 0.008, below the floor: the gate stays closed (2 calls)', () => {
      expect(callsOf(noisy(0.004), [['rod', 100]])).toBe(2)
    })
  })

  describe('a byproduct consumer\'s ingredient on Don\'t make more here is a default item for the gate', () => {
    // make-widget is a byproduct consumer, so rod (its ingredient) cannot be imported and, as `bfArea` says, is not on the
    // cheap slack even on Don't make more here: both areas touching it count as defaults, as pass 2 does. Ingot is the only
    // import (15, nothing offers it). By hand: pass 1 is 2 calls; rod is an area item with an offer of 3 and a spare
    // supply (the pass-1 supply is 0), so the gate is open; step 2 finds the same 15 ingots, no gain: 3 calls. Were the
    // area on the rule counted as Don't make more here, no default would be left to try and the gate would stay at 2.
    // The supply the item gets in steps 2 to 4 is not visible here (there is no import it could replace).
    const rows = (): Record<string, RecipeNode[]> => ({
      L: [row('use-plate', 'L'), row('make-widget', 'L', { byproductConsumer: true })],
      M: [row('plate-12', 'M'), pin('smelt', 'M', 10), row('make-rod', 'M')],
    })
    const block = () => plateBlock(['L', 'M'], rows(), {}, { rod: off }, [['pgear', 50], ['widget', 5]])
    it('the gate is open and the order finds no gain (3 calls, today\'s result stands)', () => {
      expect(callsOf(block(), [['rod', 3]])).toBe(3)
    })
    it('the result is the one of the two passes', () => {
      const { result, received } = solveWith(block(), [['rod', 3]])
      checkRoutes(result)
      expect(received.get('rod') ?? 0, 'rod received').toBeCloseTo(0, 6)
      expect(node(result, 'plate-12@M').throughput, 'P').toBeCloseTo(25, 6)
      expect(unsat(result, 'ingot'), 'ingot imported').toBeCloseTo(15, 6)
      expect(node(result, 'make-rod@M').throughput, 'R').toBeCloseTo(5, 6)
    })
  })

  describe('LP counts', () => {
    it('the base block: pass 1 (2), least import (1), least received (1), the fill (2)', () => {
      expect(callsOf(base(), BASE_OFFERS)).toBe(6)
    })
    it('a Don\'t make more here item: pass 1, pass 2, the three steps, and a refill (10)', () => {
      expect(callsOf(rodBlock(false, {}, { rod: off }), ROD_OFFERS)).toBe(10)
      expect(callsOf(rodBlock(true, { L: { rod: off } }), ROD_OFFERS)).toBe(10)
    })
  })

  describe('the retry of a bounded step, through a solve', () => {
    // The failing call is chosen by the model's content: the bound rows (`__impcap`, `__reccap`) tell steps and fills apart.
    // `fill` is the 1-based fill whose tight attempt fails (the second is the refill). Every call of that attempt with the
    // tight bound fails (stage 2 may re-run); the retry carries a larger bound and is let through.
    type Entry = { optimize: string; imp?: number; rec?: number; failed: boolean }
    const run = (b: Block, offers: Offers, optimize: string, fill?: number) => {
      const real = solver.Solve.bind(solver)
      const log: Entry[] = []
      let fills = 0
      let failedImp: number | undefined
      const spy = vi.spyOn(solver, 'Solve').mockImplementation((model: Parameters<typeof real>[0]) => {
        const m = model as unknown as Model
        const imp = m.constraints.__impcap?.max
        const rec = m.constraints.__reccap?.max
        if (rec !== undefined && m.optimize === '__s1') fills++
        let failed = false
        if (m.optimize === optimize && imp !== undefined && (fill === undefined ? rec === undefined : rec !== undefined)) {
          if (failedImp === undefined) {
            if (fill === undefined || fills === fill) { failed = true; failedImp = imp }
          } else if (imp <= failedImp) failed = true
        }
        log.push({ optimize: m.optimize, imp, rec, failed })
        return failed ? { feasible: false, bounded: true, result: NaN } : real(model)
      })
      try {
        return { ...solveWith(b, offers), log }
      } finally {
        spy.mockRestore()
      }
    }
    const expectLooserRetry = (log: Entry[]) => {
      const i = log.findIndex(e => e.failed)
      expect(i, 'a call failed').toBeGreaterThanOrEqual(0)
      const failed = log[i]
      const retry = log.slice(i + 1).find(e => e.optimize === failed.optimize && !e.failed)
      expect(retry, 'the retry ran').toBeDefined()
      expect(retry!.imp!, 'the import bound is looser').toBeGreaterThan(failed.imp!)
      if (failed.rec !== undefined) expect(retry!.rec!, 'the received bound is looser').toBeGreaterThan(failed.rec)
    }
    const expectBase = (r: SolverResult, received: Map<string, number>) => {
      expect(received.get('plate') ?? 0, 'plate received').toBeCloseTo(30, 4)
      expect(node(r, 'plate-12@M').throughput, 'P').toBeCloseTo(10, 4)
      expect(unsat(r, 'ingot'), 'ingot imported').toBeCloseTo(0, 4)
      expect(unsat(r, 'plate'), 'plate imported').toBeCloseTo(0, 4)
    }

    it('step 3 (least received) infeasible once: one more call, a looser bound, same result', () => {
      const { result, received, log } = run(base(), BASE_OFFERS, '__rec')
      expect(log.length, 'LP calls').toBe(7)
      expectLooserRetry(log)
      expectBase(result, received)
    })
    it('the fill\'s stage 1 infeasible once: one more call, looser bounds, same result', () => {
      const { result, received, log } = run(base(), BASE_OFFERS, '__s1', 1)
      expect(log.length, 'LP calls').toBe(7)
      expectLooserRetry(log)
      expectBase(result, received)
    })
    it('the fill\'s stage 2 infeasible: the whole fill runs again with looser bounds, same result', () => {
      const { result, received, log } = run(base(), BASE_OFFERS, '__s2', 1)
      expect(log.length, 'LP calls').toBeGreaterThan(6)
      expectLooserRetry(log)
      expectBase(result, received)
    })
    it('the refill\'s stage 1 infeasible once: one more call, looser bounds, same result', () => {
      const { result, received, log } = run(rodBlock(false, {}, { rod: off }), ROD_OFFERS, '__s1', 2)
      expect(log.length, 'LP calls').toBe(11)
      expectLooserRetry(log)
      expectRodOff(result, received, 'make-rod@L', 4)
    })
    it('the refill\'s stage 2 infeasible: the refill runs again with looser bounds, same result', () => {
      const { result, received, log } = run(rodBlock(false, {}, { rod: off }), ROD_OFFERS, '__s2', 2)
      expect(log.length, 'LP calls').toBeGreaterThan(10)
      expectLooserRetry(log)
      expectRodOff(result, received, 'make-rod@L', 4)
    })
  })
})

describe('area rules: the set the coproduct-driven check is told cannot be imported', () => {
  const plan = (rootRules?: Record<string, AreaSourceRule>, sRules?: Record<string, AreaSourceRule>): Block =>
    blk(
      withRules(root([row('r-main', 'root')], [withRules(sub('S', [row('use-x', 's'), row('x-make', 's')], [], true), sRules)]), rootRules),
      [['y', 10], ['z', 30]],
    )
  const told = (b: Block) => {
    solveBlock(flattenBlock(b), gd())
    return [...vi.mocked(coproductDrivenWarning).mock.calls.at(-1)![0].noImportItems].sort()
  }
  it("an area's Import off does not lock an item another area that touches it may import", () => {
    expect(told(plan(undefined, { x: { makeHere: 'off', importOff: true } }))).not.toContain('x')
  })
  it('every touching area with Import off locks it', () => {
    expect(told(plan({ x: { importOff: true } }, { x: { makeHere: 'off', importOff: true } }))).toContain('x')
  })
})

describe('areaLPItems and outsideLegParts', () => {
  it('names the intermediates two areas or more touch', () => {
    expect([...areaLPItems(flattenBlock(scenario1()), gd())]).toEqual(['hydrogen'])
  })
  it('leaves out an item one area touches', () => {
    const b = blk(root([], [sub('S', [row('use-x', 's'), row('x-make', 's')], [], true)]), [['z', 30]])
    expect(areaLPItems(flattenBlock(b), gd()).size).toBe(0)
  })
  it('is empty for a plan without areas', () => {
    expect(areaLPItems(flattenBlock(blk(sub('root', [row('electrolysis', 'root')]), [['hydrogen', 60]])), gd()).size).toBe(0)
  })
  const leg = (rate: number, supplied?: number): AreaRoute => ({ itemId: 'plate', to: 'L', rate, ...(supplied === undefined ? {} : { supplied }) })
  it('splits a leg into supplied, imported and missing', () => {
    expect(outsideLegParts(leg(12), {})).toEqual({ received: 0, imported: 12, missing: 0 })
    expect(outsideLegParts(leg(12, 5), {})).toEqual({ received: 5, imported: 7, missing: 0 })
    expect(outsideLegParts(leg(12, 5), { importOff: true })).toEqual({ received: 5, imported: 0, missing: 7 })
    expect(outsideLegParts(leg(12), { importOff: true })).toEqual({ received: 0, imported: 0, missing: 12 })
    expect(outsideLegParts(leg(12, 12), { importOff: true })).toEqual({ received: 12, imported: 0, missing: 0 })
  })
})
