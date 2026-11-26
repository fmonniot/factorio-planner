import { describe, it, expect } from 'vitest'
import { makeEmptyBlock, makeEmptySubPlan } from '../../store/blockStore'
import {
  barPercent, buildPowerOverview, flattenPowerRows, gaugeGeometry, initialExpanded, sharePercentText,
} from './powerOverview'
import type { PowerBlock, PowerEntry } from './powerOverview'
import type { Block, GameData, RecipeNode, SolvedNode, SolverResult, SolverWarning, SubPlan } from '../../data/types'

const gameData = {
  items: { x: { id: 'x', name: 'X', type: 'item', iconPath: 'x.png', hidden: false } },
  recipes: Object.fromEntries(
    ['plate', 'gear', 'stick', 'bolt', 'acid', 'engine', 'a', 'b', 'c'].map(id => [
      id, { id, name: id, products: [{ itemId: 'x', amount: 1 }], ingredients: [], time: 1, category: 'c' },
    ]),
  ),
} as unknown as Pick<GameData, 'items' | 'recipes'>

/** A recipe node whose id is `n-<recipeId>`. */
const rec = (recipeId: string): RecipeNode => ({
  kind: 'game-recipe', id: `n-${recipeId}`, recipeId, modules: [], byproductPolicy: {},
})

function plan(name: string, recipes: string[], subs: { plan: SubPlan; nodeId: string }[] = []): SubPlan {
  const p = makeEmptySubPlan(name)
  p.nodes = [...recipes.map(rec), ...subs.map(s => ({ kind: 'subplan' as const, id: s.nodeId, subPlanId: s.plan.id }))]
  p.subPlans = subs.map(s => s.plan)
  return p
}

function block(name: string, rootPlan: SubPlan, id = name): Block {
  return { ...makeEmptyBlock(name), id, rootPlan }
}

const solved = (recipeId: string, powerKw: number, machines: number, electricity = 0): SolvedNode => ({
  recipeNodeId: `n-${recipeId}`, powerKw, machineCountCeil: machines, machineCountExact: machines, throughput: 1,
  inputRates: {}, outputRates: electricity ? { 'power:electricity': electricity } : {}, beaconPowerKw: 0,
} as SolvedNode)

const result = (nodes: SolvedNode[], warnings: SolverWarning[] = []): SolverResult => ({ nodes, unsatisfied: [], warnings })

function fixtureA() {
  const deep = plan('Deep', ['bolt'])
  const iron = plan('Iron', ['gear', 'stick'], [{ plan: deep, nodeId: 'g-deep' }])
  const metals = block('Metals', plan('Main', ['plate'], [{ plan: iron, nodeId: 'g-iron' }]))
  const chem = block('Chem', plan('Main', ['acid']))
  const power = block('Power', plan('Main', ['engine']))
  const fresh = block('New', plan('Main', []))
  const broken = block('Broken', plan('Main', []))
  const results = {
    Metals: result([solved('plate', 300, 2), solved('gear', 500, 3), solved('stick', 100, 1), solved('bolt', 50, 1)]),
    Chem: result([solved('acid', 250, 4)]),
    Power: result([solved('engine', 0, 2, 600)]),
  }
  // Blocks in plan order: Power, Metals, New, Chem, Broken
  return { blocks: [power, metals, fresh, chem, broken], results, errors: { Broken: 'boom' } }
}

const build = (f = fixtureA()) => buildPowerOverview(f.blocks, f.results, f.errors, gameData)
const names = (es: readonly PowerEntry[]) => es.map(e => `${e.kind}:${e.name}:${e.powerKw}`)

describe('buildPowerOverview', () => {
  it('lists blocks by power and builds the tree', () => {
    const m = build()
    expect(m.blocks.map(b => `${b.name}:${b.powerKw}`)).toEqual(['Metals:950', 'Chem:250', 'Power:0'])
    const metals = m.blocks[0]
    expect(metals.machines).toBe(7)
    expect(names(metals.children)).toEqual(['group:Iron:650', 'recipe:plate:300'])
    const iron = metals.children[0]
    expect(iron.kind === 'group' && names(iron.children)).toEqual(['group:Deep:50', 'recipe:gear:500', 'recipe:stick:100'])
    expect(iron.machines).toBe(5)
    expect(iron.powerKw).toBe(650)
  })

  it('skips blocks without a result and blocks that failed', () => {
    expect(build().skipped).toEqual([
      { id: 'New', name: 'New', reason: 'none' },
      { id: 'Broken', name: 'Broken', reason: 'error' },
    ])
  })

  it('sums demand and generation and sets the status', () => {
    const m = build()
    expect(m.demandKw).toBe(1200)
    expect(m.generationKw).toBeCloseTo(10000)
    expect(m.balanceKw).toBeCloseTo(8800)
    expect(m.status).toBe('spare')
    expect(m.blocks[2].generationKw).toBeCloseTo(10000)
  })

  it('lists the recipes that draw power, biggest first', () => {
    const m = build()
    expect(m.lines.map(l => `${l.name}:${l.powerKw}`)).toEqual(['gear:500', 'plate:300', 'acid:250', 'stick:100', 'bolt:50'])
    expect(m.lines[0]).toMatchObject({ blockId: 'Metals', blockName: 'Metals', machines: 3 })
  })

  it('breaks ties by name then plan order, zero power last, groups before loose recipes', () => {
    const b = block('B', plan('Main', ['b', 'a', 'c', 'plate'], [{ plan: plan('G', ['gear']), nodeId: 'g' }]))
    const m = buildPowerOverview([b], {
      B: result([solved('a', 10, 1), solved('b', 10, 1), solved('c', 0, 1), solved('plate', 10, 1), solved('gear', 1, 1)]),
    }, {}, gameData)
    expect(names(m.blocks[0].children)).toEqual(['group:G:1', 'recipe:a:10', 'recipe:b:10', 'recipe:plate:10', 'recipe:c:0'])
    const same = [block('Z', plan('Main', [])), block('A', plan('Main', []))]
    const eq = buildPowerOverview(same, { Z: result([]), A: result([]) }, {}, gameData)
    expect(eq.blocks.map(x => x.name)).toEqual(['Z', 'A'])
  })

  it('skips a missing sub-plan, survives a shared one and treats an area as a group', () => {
    const shared = plan('Shared', ['a'])
    const root = plan('Main', [], [{ plan: shared, nodeId: 'g1' }, { plan: { ...plan('Area', ['b']), area: true }, nodeId: 'g2' }])
    root.nodes.push({ kind: 'subplan', id: 'g-missing', subPlanId: 'nope' })
    shared.subPlans = [shared]
    shared.nodes.push({ kind: 'subplan', id: 'loop', subPlanId: shared.id })
    const m = buildPowerOverview([block('B', root)], { B: result([solved('a', 5, 1), solved('b', 7, 1)]) }, {}, gameData)
    expect(names(m.blocks[0].children)).toEqual(['group:Area:7', 'group:Shared:5'])
  })

  it('flags a block whose solve is arbitrary', () => {
    const flag = (w: SolverWarning) =>
      buildPowerOverview([block('B', plan('Main', []))], { B: result([], [w]) }, {}, gameData).blocks[0].unreliable
    expect(flag({ type: 'infeasible-pins', recipeIds: [], conflict: true })).toBe(true)
    expect(flag({ type: 'infeasible-pins', recipeIds: [] })).toBe(false)
    expect(flag({ type: 'unbounded-absorber', recipeIds: [] })).toBe(true)
    expect(flag({ type: 'unbounded-source', blockIds: [] })).toBe(true)
  })

  it('reads balanced inside the 50 W tolerance', () => {
    const status = (gen: number, demand: number) => {
      const b = block('B', plan('Main', ['plate', 'engine']))
      // gen kW as units/min: kW * 60 / 1000
      return buildPowerOverview([b], { B: result([solved('plate', demand, 1), solved('engine', 0, 1, gen * 60 / 1000)]) }, {}, gameData).status
    }
    expect(status(100.04, 100)).toBe('balanced')
    expect(status(99.96, 100)).toBe('balanced')
    expect(status(100.06, 100)).toBe('spare')
    expect(status(99.94, 100)).toBe('short')
  })

  it('counts a row the tree does not reach, like the table toolbar does', () => {
    const b = block('B', plan('Main', ['plate']))
    const m = buildPowerOverview([b], { B: result([solved('plate', 10, 1), solved('gear', 5, 2)]) }, {}, gameData)
    expect(m.blocks[0].powerKw).toBe(15)
    expect(m.blocks[0].machines).toBe(3)
    expect(m.blocks[0].children[0].powerKw).toBe(10)
  })
})

describe('flattenPowerRows and initialExpanded', () => {
  it('lists only the children of expanded rows', () => {
    const m = build()
    const label = (r: ReturnType<typeof flattenPowerRows>[number]) => `${r.depth}:${r.entry.name}:${r.expandable}`
    expect(flattenPowerRows(m.blocks, new Set(['Metals'])).map(label)).toEqual([
      '0:Metals:true', '1:Iron:true', '1:plate:false', '0:Chem:true', '0:Power:true',
    ])
    const ironKey = m.blocks[0].children[0].key
    const rows = flattenPowerRows(m.blocks, new Set(['Metals', ironKey]))
    expect(rows.map(label).slice(0, 6)).toEqual(['0:Metals:true', '1:Iron:true', '2:Deep:true', '2:gear:false', '2:stick:false', '1:plate:false'])
    expect(rows[1].expanded).toBe(true)
  })

  it('marks a childless group as not expandable', () => {
    const b = block('B', plan('Main', [], [{ plan: plan('Empty', []), nodeId: 'g' }]))
    const m = buildPowerOverview([b], { B: result([]) }, {}, gameData)
    const rows = flattenPowerRows(m.blocks, new Set(['B']))
    expect(rows[1].expandable).toBe(false)
  })

  it('opens the first block only when it draws power', () => {
    expect([...initialExpanded(build())]).toEqual(['Metals'])
    const zero = buildPowerOverview([block('B', plan('Main', ['plate']))], { B: result([solved('plate', 0, 1)]) }, {}, gameData)
    expect(initialExpanded(zero).size).toBe(0)
    expect(initialExpanded({ ...zero, blocks: [] as PowerBlock[] }).size).toBe(0)
  })
})

describe('barPercent and sharePercentText', () => {
  it('scales and floors a bar', () => {
    expect(barPercent(0, 100)).toBe(0)
    expect(barPercent(0.1, 100)).toBe(1.5)
    expect(barPercent(50, 100)).toBe(50)
    expect(barPercent(5, 0)).toBe(0)
  })
  it('writes a share', () => {
    expect(sharePercentText(300, 1200)).toBe('25.0%')
    expect(sharePercentText(0, 1200)).toBe('–')
    expect(sharePercentText(5, 0)).toBe('–')
  })
})

describe('gaugeGeometry', () => {
  const model = (demand: number, gen: number) => {
    const b = block('B', plan('Main', ['plate', 'engine']))
    return buildPowerOverview([b], { B: result([solved('plate', demand, 1), solved('engine', 0, 1, gen * 60 / 1000)]) }, {}, gameData)
  }
  it('shows a shortfall above the generation column', () => {
    const g = gaugeGeometry(model(1200, 600))
    expect(g.scaleMax).toBeCloseTo(1272)
    expect(g.demand).toBeCloseTo(0.9434, 4)
    expect(g.short?.bottom).toBeCloseTo(0.4717, 4)
    expect(g.short?.height).toBeCloseTo(0.4717, 4)
    expect(g.spare).toBeUndefined()
  })
  it('shows spare above the demand', () => {
    const g = gaugeGeometry(model(1200, 2400))
    expect(g.scaleMax).toBeCloseTo(2544)
    expect(g.spare?.bottom).toBeCloseTo(0.4717, 4)
    expect(g.spare?.height).toBeCloseTo(0.4717, 4)
    expect(g.short).toBeUndefined()
  })
  it('shows neither when balanced', () => {
    const g = gaugeGeometry(model(1200, 1200))
    expect(g.short).toBeUndefined()
    expect(g.spare).toBeUndefined()
  })
  it('has no NaN with nothing to draw', () => {
    const g = gaugeGeometry(buildPowerOverview([], {}, {}, gameData))
    expect(g).toMatchObject({ scaleMax: 0, demand: 0, generation: 0, generationLabelBottom: 0, segments: [] })
    expect(g.short).toBeUndefined()
  })
  it('stacks the blocks in model order up to the demand', () => {
    const f = fixtureA()
    const g = gaugeGeometry(build(f))
    expect(g.segments.map(s => s.name)).toEqual(['Metals', 'Chem'])
    expect(g.segments.reduce((n, s) => n + s.height, 0)).toBeCloseTo(g.demand)
  })
})
