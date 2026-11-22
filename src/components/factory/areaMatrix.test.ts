import { describe, it, expect } from 'vitest'
import {
  areaContents, blockMatrix, rowDisplayName, cancels, groupTotal, totalRows, flowOrder, focusArea, groupRows, itemGroupOf, matchQuery,
  MACHINES_GROUP, OTHER_GROUP, OUTSIDE, type BlockMatrix, type ItemGroupInfo, type MatrixRow, type PairFlow,
} from './areaMatrix'
import { makeEmptyBlock } from '../../store/blockStore'
import type { Block, FluidTag, GameData, SolvedArea, SolverResult, SubPlan } from '../../data/types'

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      steam: { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '', hidden: false, subgroup: 'fluids', order: '' },
      h2: { id: 'h2', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false, subgroup: 'fluids', order: '' },
      plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false, subgroup: 'orphan', order: '' },
      drill: { id: 'drill', name: 'Drill', type: 'item', iconPath: '', hidden: false, subgroup: 'fluids', order: '', placeResult: 'drill-entity' },
    },
    recipes: {
      r1: { id: 'r1', name: 'Recipe One' },
      r2: { id: 'r2', name: 'Recipe Two' },
    },
    machines: { 'drill-entity': { id: 'drill-entity' } },
    beacons: {},
    modules: {},
    defaultMachines: {},
    technologies: {},
    startingRecipes: [],
    itemGroups: { logistics: { id: 'logistics', name: 'Logistics', order: 'b', iconPath: '' } },
    itemSubgroups: { fluids: { id: 'fluids', group: 'logistics', order: '' } },
  } as unknown as GameData
}

function plan(id: string, name: string, nodes: SubPlan['nodes'] = [], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  return { id, name, nodes, subPlans, ...(area ? { area } : {}), createdAt: '', updatedAt: '' }
}
const rec = (id: string, recipeId = 'r1') => ({ kind: 'game-recipe' as const, id, recipeId, modules: [], byproductPolicy: {} })
const handle = (id: string, subPlanId: string) => ({ kind: 'subplan' as const, id, subPlanId })

function makeBlock(): Block {
  const b = makeEmptyBlock('Alpha')
  return {
    ...b,
    id: 'blk',
    color: '#123456',
    rootPlan: plan('root', 'Main', [rec('n1'), handle('hA', 'A')], [plan('A', 'Aa', [rec('n2')], [], true), plan('B', 'Bb', [], [], true)]),
  }
}

const f = (itemId: string, rate: number) => ({ itemId, rate, boundary: false })
function result(areas: SolvedArea[]): SolverResult {
  return { nodes: [], unsatisfied: [], warnings: [], areas }
}
const machines = new Set<string>()

describe('blockMatrix', () => {
  it('signs the cells, derives the outside residual and balances every row', () => {
    const gd = makeGameData()
    const m = blockMatrix(makeBlock(), result([
      { areaId: 'root', receives: [f('plate', 5)], sends: [f('h2', 30)] },
      { areaId: 'A', receives: [f('h2', 10)], sends: [f('plate', 2)] },
      { areaId: 'B', receives: [f('h2', 12)], sends: [] },
    ]), gd, machines)!
    const h2 = m.rows.find(r => r.itemId === 'h2')!
    expect(h2.cells).toEqual({ root: 30, A: -10, B: -12 })
    expect(h2.toOutside).toBeCloseTo(8)
    expect(h2.fromOutside).toBe(0)
    expect(h2.total).toBeCloseTo(30)
    const plate = m.rows.find(r => r.itemId === 'plate')!
    expect(plate.fromOutside).toBeCloseTo(3)
    expect(plate.total).toBeCloseTo(5)
    for (const r of m.rows) {
      const sum = Object.values(r.cells).reduce((a, b) => a + b, 0)
      expect(sum + r.fromOutside - r.toOutside).toBeCloseTo(0)
    }
    expect(m.rows.map(r => r.itemId)).toEqual(['h2', 'plate'])
  })

  it('gives no outside value for a residual within tolerance', () => {
    const m = blockMatrix(makeBlock(), result([
      { areaId: 'root', receives: [], sends: [f('h2', 10 + 1e-9)] },
      { areaId: 'A', receives: [f('h2', 10)], sends: [] },
    ]), makeGameData(), machines)!
    expect(m.rows[0].fromOutside).toBe(0)
    expect(m.rows[0].toOutside).toBe(0)
  })

  it('names an unknown item by its id', () => {
    const m = blockMatrix(makeBlock(), result([{ areaId: 'root', receives: [], sends: [f('mystery', 1)] }]), makeGameData(), machines)!
    expect(m.rows[0].name).toBe('mystery')
    expect(m.rows[0].groupId).toBe(OTHER_GROUP)
  })

  it('lists the areas in result order with names, handles and contents', () => {
    const m = blockMatrix(makeBlock(), result([
      { areaId: 'root', receives: [], sends: [] },
      { areaId: 'B', receives: [], sends: [] },
      { areaId: 'A', receives: [], sends: [] },
    ]), makeGameData(), machines)!
    expect(m.areas.map(a => a.name)).toEqual(['Top level', 'Bb', 'Aa'])
    expect(m.areas.map(a => a.handleNodeId)).toEqual([undefined, undefined, 'hA'])
    expect(m.areas.map(a => a.isRoot)).toEqual([true, false, false])
    expect(m.areas[2].contents.rowCount).toBe(1)
  })

  it('takes the pairs of each row from the solver routes, the outside for an absent end', () => {
    const r: SolverResult = {
      ...result([
        { areaId: 'root', receives: [], sends: [f('h2', 30)] },
        { areaId: 'A', receives: [f('h2', 10)], sends: [] },
      ]),
      areaRoutes: [
        { itemId: 'h2', from: 'root', to: 'A', rate: 10 },
        { itemId: 'h2', from: 'root', rate: 20 },
      ],
    }
    const m = blockMatrix(makeBlock(), r, makeGameData(), machines)!
    expect(m.rows[0].pairs).toEqual([pf('root', 'A', 10), pf('root', OUTSIDE, 20)])
    const none = blockMatrix(makeBlock(), result(r.areas!), makeGameData(), machines)!
    expect(none.rows[0].pairs).toEqual([])
  })

  it('returns undefined without areas', () => {
    expect(blockMatrix(makeBlock(), { nodes: [], unsatisfied: [], warnings: [] }, makeGameData(), machines)).toBeUndefined()
  })
})

const row = (cells: Record<string, number>, fromOutside = 0, toOutside = 0, pairs: PairFlow[] = []): MatrixRow => ({
  key: 'x', itemId: 'x', name: 'X', groupId: 'g', cells, fromOutside, toOutside,
  total: Object.values(cells).filter(v => v > 0).reduce((a, b) => a + b, 0) + fromOutside,
  pairs,
})
const pf = (from: string, to: string, rate: number): PairFlow => ({ from, to, rate })

function matrixOf(areaIds: string[], rows: MatrixRow[]): BlockMatrix {
  return {
    blockId: 'b', blockName: 'B', color: '#000',
    areas: areaIds.map(id => ({
      areaId: id, name: id, isRoot: false, handleNodeId: undefined,
      contents: { rowCount: 0, recipeNames: [], subFactories: [], nestedAreas: [] },
    })),
    rows,
  }
}

describe('blockMatrix of a split fluid', () => {
  const steam = (rate: number, temp?: FluidTag) => ({ itemId: 'steam', rate, boundary: false, ...(temp ? { temp } : {}) })
  const r: SolverResult = {
    ...result([
      { areaId: 'root', receives: [], sends: [steam(30, { at: 165 })] },
      { areaId: 'A', receives: [steam(10, { min: 465 }), steam(5, { at: 165 })], sends: [] },
    ]),
    areaRoutes: [
      { itemId: 'steam', temp: { at: 165 }, from: 'root', to: 'A', rate: 5 },
      { itemId: 'steam', temp: { min: 465 }, to: 'A', rate: 10 },
    ],
  }
  const m = blockMatrix(makeBlock(), r, makeGameData(), machines)!

  it('makes one row per key, in total order, with the tag', () => {
    expect(m.rows.map(x => [x.key, x.itemId, x.temp])).toEqual([
      ['steam@165', 'steam', { at: 165 }],
      ['steam[465,]', 'steam', { min: 465 }],
    ])
    expect(m.rows[0].cells).toEqual({ root: 30, A: -5 })
    expect(m.rows[1].cells).toEqual({ A: -10 })
    expect(m.rows[1].fromOutside).toBeCloseTo(10)
  })

  it('keeps the pairs of each key apart', () => {
    expect(m.rows[0].pairs).toEqual([pf('root', 'A', 5)])
    expect(m.rows[1].pairs).toEqual([pf(OUTSIDE, 'A', 10)])
  })

  it('keys the counterparts of a focus by flow key', () => {
    const v = focusArea(m, 'A')
    expect(v.counterpart['steam@165'].root).toBeCloseTo(5)
    expect(v.counterpart['steam[465,]'][OUTSIDE]).toBeCloseTo(10)
    expect(v.counterpart.steam).toBeUndefined()
  })

  it('keeps a plain item key equal to its id', () => {
    const plain = blockMatrix(makeBlock(), result([{ areaId: 'root', receives: [], sends: [f('h2', 3)] }]), makeGameData(), machines)!
    expect(plain.rows[0]).toMatchObject({ key: 'h2', itemId: 'h2' })
    expect(plain.rows[0].temp).toBeUndefined()
  })

  it('names a keyed row with its label', () => {
    expect(rowDisplayName(m.rows[1])).toBe('Steam ≥465°C')
    expect(rowDisplayName({ name: 'Plate' })).toBe('Plate')
  })
})

describe('flowOrder', () => {
  it('puts senders before receivers', () => {
    const m = matrixOf(['A', 'B', 'C'], [
      row({ C: 10, B: -10 }, 0, 0, [pf('C', 'B', 10)]),
      row({ B: 10, A: -10 }, 0, 0, [pf('B', 'A', 10)]),
    ])
    expect(flowOrder(m)).toEqual(['C', 'B', 'A'])
  })

  it('breaks a cycle on the greatest out minus in', () => {
    const m = matrixOf(['B', 'A'], [
      row({ A: 10, B: -10 }, 0, 0, [pf('A', 'B', 10)]),
      row({ B: 1, A: -1 }, 0, 0, [pf('B', 'A', 1)]),
    ])
    expect(flowOrder(m)).toEqual(['A', 'B'])
  })

  it('follows the routes, not the nets: an area that feeds nobody does not move', () => {
    const m = matrixOf(['A', 'B', 'C'], [row({ A: 10, B: 10, C: -10 }, 0, 10, [pf('B', 'C', 10), pf('A', OUTSIDE, 10)])])
    expect(flowOrder(m)).toEqual(['A', 'B', 'C'])
  })

  it('keeps table order on ties', () => {
    expect(flowOrder(matrixOf(['X', 'Y', 'Z'], []))).toEqual(['X', 'Y', 'Z'])
  })
})

describe('itemGroupOf', () => {
  it('uses the item group, Machines for a machine and Other when unknown', () => {
    const gd = makeGameData()
    const ms = new Set(['drill'])
    expect(itemGroupOf('h2', gd, ms).name).toBe('Logistics')
    expect(itemGroupOf('drill', gd, ms).id).toBe(MACHINES_GROUP)
    expect(itemGroupOf('plate', gd, ms).id).toBe(OTHER_GROUP)
  })
})

describe('groupRows', () => {
  type R = { itemId: string; name: string; total: number; groupId: string }
  const groups = new Map<string, ItemGroupInfo>([
    ['b-group', { id: 'b-group', name: 'Beta', order: 'b' }],
    ['a-group', { id: 'a-group', name: 'Alpha', order: 'a' }],
  ])
  const mk = (n: number, total = 5, groupId = 'a-group'): R[] =>
    Array.from({ length: n }, (_, i) => ({ itemId: `i${i}`, name: `Item ${String(i).padStart(2, '0')}`, total: total + (n - i) / 100, groupId }))

  it('orders item groups, then Other, then Machines', () => {
    const rows: R[] = [
      { itemId: 'm', name: 'M', total: 1, groupId: MACHINES_GROUP },
      { itemId: 'o', name: 'O', total: 1, groupId: OTHER_GROUP },
      { itemId: 'b', name: 'B', total: 1, groupId: 'b-group' },
      { itemId: 'a', name: 'A', total: 1, groupId: 'a-group' },
    ]
    const g = groupRows(rows, 'category', groups, { collapseTail: true })
    expect(g.map(x => x.id)).toEqual(['a-group', 'b-group', OTHER_GROUP, MACHINES_GROUP])
    expect(g.map(x => x.name)).toEqual(['Alpha', 'Beta', 'Other', 'Machines for buildings'])
  })

  it('has no tail up to 8 rows above the threshold and a 7 + 2 split at 9', () => {
    expect(groupRows(mk(8), 'category', groups, { collapseTail: true })[0].tail).toHaveLength(0)
    const g = groupRows(mk(9), 'category', groups, { collapseTail: true })[0]
    expect(g.head).toHaveLength(7)
    expect(g.tail).toHaveLength(2)
  })

  it('starts the tail at the first row below 1/min', () => {
    const rows = [...mk(3), ...mk(2, 0.1)].map((r, i) => ({ ...r, total: i < 3 ? 5 - i : 0.5 - i / 100 }))
    const g = groupRows(rows, 'category', groups, { collapseTail: true })[0]
    expect(g.head).toHaveLength(3)
    expect(g.tail).toHaveLength(2)
  })

  it('keeps a single small row in the head', () => {
    const g = groupRows([{ itemId: 'a', name: 'A', total: 0.5, groupId: 'a-group' }], 'category', groups, { collapseTail: true })[0]
    expect(g.head).toHaveLength(1)
    expect(g.tail).toHaveLength(0)
  })

  it('does not leave a lone large row in the tail', () => {
    const g = groupRows(mk(8), 'category', groups, { collapseTail: true })[0]
    expect(g.head).toHaveLength(8)
  })

  it('makes one group by rate and one A-Z group without a tail', () => {
    const rows = mk(12)
    const byRate = groupRows(rows, 'rate', groups, { collapseTail: true })
    expect(byRate).toHaveLength(1)
    expect(byRate[0].rows[0].total).toBeGreaterThan(byRate[0].rows[11].total)
    const byName = groupRows([...rows].reverse(), 'name', groups, { collapseTail: true })
    expect(byName).toHaveLength(1)
    expect(byName[0].tail).toHaveLength(0)
    expect(byName[0].rows.map(r => r.name)).toEqual(rows.map(r => r.name).sort())
  })

  it('shows every row when the tail is off', () => {
    const g = groupRows(mk(12), 'category', groups, { collapseTail: false })[0]
    expect(g.tail).toHaveLength(0)
    expect(g.head).toHaveLength(12)
  })
})

const r2b = { ...row({ A: 5, B: -5 }, 0, 0, [pf('A', 'B', 5)]), itemId: 'two', key: 'two' }

describe('focusArea', () => {
  const r1 = { ...row({ A: 30, B: -10, C: -20 }, 0, 0, [pf('A', 'B', 10), pf('A', 'C', 20)]), itemId: 'one', key: 'one' }
  const r2 = { ...row({ B: 5, C: -5 }, 0, 0, [pf('B', 'C', 5)]), itemId: 'two', key: 'two' }
  const r3 = { ...row({ A: 4, C: -4 }, 0, 0, [pf('A', 'C', 4)]), itemId: 'three', key: 'three' }
  const m = matrixOf(['A', 'B', 'C', 'D'], [r1, r2, r3])

  it('keeps the rows of the area and the counterparts', () => {
    const v = focusArea(m, 'B')
    expect(v.rows.map(r => r.itemId)).toEqual(['one', 'two'])
    expect(v.counterpart.one.A).toBeCloseTo(10)
    expect(v.counterpart.two.C).toBeCloseTo(5)
    expect(v.tradingAreaIds).toEqual(['A', 'C'])
  })

  it('follows the routes: C gets 20 from A and nothing from B', () => {
    const two = { ...row({ A: 20, B: 10, C: -20, D: -10 }, 0, 0, [pf('A', 'C', 20), pf('B', 'D', 10)]), itemId: 'x2', key: 'x2' }
    const v = focusArea(matrixOf(['A', 'B', 'C', 'D'], [two]), 'C')
    expect(v.counterpart.x2).toEqual({ A: 20 })
    expect(v.tradingAreaIds).toEqual(['A'])
  })

  it('summarises the trades, the outside last', () => {
    const out = { ...row({ A: 10 }, 0, 10, [pf('A', OUTSIDE, 10)]), itemId: 'out', key: 'out' }
    const v = focusArea(matrixOf(['A', 'B'], [out, r1]), 'A')
    expect(v.trades.at(-1)?.partyId).toBe(OUTSIDE)
    const toB = v.trades.find(t => t.partyId === 'B')!
    expect(toB.outRate).toBeCloseTo(10)
    expect(toB.inRate).toBe(0)
    expect(v.trades.find(t => t.partyId === 'C')?.items).toBe(1)
    const fromA = focusArea(m, 'C').trades.find(t => t.partyId === 'A')!
    expect(fromA.inRate).toBeCloseTo(24)
  })

  it('keeps electricity apart from the item rates of a trade', () => {
    const elec = { ...row({ A: 600, B: -600 }, 0, 0, [pf('A', 'B', 600)]), itemId: 'power:electricity', key: 'power:electricity' }
    const v = focusArea(matrixOf(['A', 'B'], [r2b, elec]), 'A')
    const toB = v.trades.find(t => t.partyId === 'B')!
    expect(toB).toMatchObject({ items: 2, inRate: 0, outRate: 5, inEnergy: 0, outEnergy: 600 })
    const fromA = focusArea(matrixOf(['A', 'B'], [elec]), 'B').trades[0]
    expect(fromA).toMatchObject({ items: 1, inRate: 0, inEnergy: 600 })
  })

  it('orders the trades by item rate, then by energy', () => {
    const elec = { ...row({ A: 600, B: -600, C: 0 }, 0, 0, [pf('A', 'B', 600)]), itemId: 'power:electricity', key: 'power:electricity' }
    const item = { ...row({ A: 5, C: -5 }, 0, 0, [pf('A', 'C', 5)]), itemId: 'it', key: 'it' }
    const v = focusArea(matrixOf(['A', 'B', 'C'], [elec, item]), 'A')
    expect(v.trades.map(t => t.partyId)).toEqual(['C', 'B'])
  })
})

describe('a relay (an area that receives an item and sends it on)', () => {
  // c sends 12 to a, a sends 12 to b: a's net is 0, so it has no cell.
  const relay = { ...row({ c: 12, b: -12 }, 0, 0, [pf('c', 'a', 12), pf('a', 'b', 12)]) }
  const m = matrixOf(['c', 'a', 'b'], [relay])

  it('keeps the row in the focus of the relay area, with both its routes', () => {
    const v = focusArea(m, 'a')
    expect(v.rows).toHaveLength(1)
    expect(v.counterpart.x).toEqual({ c: 12, b: 12 })
    expect(v.trades.find(t => t.partyId === 'c')!.inRate).toBe(12)
    expect(v.trades.find(t => t.partyId === 'b')!.outRate).toBe(12)
  })

  it('counts a relay between the same two areas each way in the counterpart total', () => {
    const both = row({ a: 0, b: 0 }, 0, 0, [pf('a', 'b', 5), pf('b', 'a', 3)])
    const f = focusArea(matrixOf(['a', 'b'], [both]), 'a')
    expect(groupTotal([both], 'b', f)).toEqual({ kind: 'pair', out: 3, in: 5 })
  })
})

describe('focusArea trade lines', () => {
  const item = (itemId: string, name: string, pairs: PairFlow[]) => ({ ...row({}, 0, 0, pairs), itemId, key: itemId, name })

  it('lists what is traded with a partner, with its direction', () => {
    const one = { ...item('one', 'One', [pf('A', 'B', 10)]), cells: { A: 10, B: -10 } }
    const v = focusArea(matrixOf(['A', 'B'], [one]), 'A')
    expect(v.trades.find(t => t.partyId === 'B')!.lines).toEqual([{ key: 'one', itemId: 'one', name: 'One', direction: 'out', rate: 10, energy: false }])
  })

  it('lists the outside in both directions', () => {
    const out = { ...item('out', 'Out', [pf('A', OUTSIDE, 3)]), cells: { A: 3 } }
    const inn = { ...item('inn', 'Inn', [pf(OUTSIDE, 'A', 7)]), cells: { A: -7 } }
    const v = focusArea(matrixOf(['A'], [out, inn]), 'A')
    const lines = v.trades.find(t => t.partyId === OUTSIDE)!.lines
    expect(lines.map(l => [l.itemId, l.direction, l.rate])).toEqual([['inn', 'in', 7], ['out', 'out', 3]])
  })

  it('puts energy after items and sorts by rate', () => {
    const elec = { ...item('power:electricity', 'Electricity', [pf('A', 'B', 600)]), cells: { A: 600, B: -600 } }
    const small = { ...item('s', 'Small', [pf('A', 'B', 1)]), cells: { A: 1, B: -1 } }
    const big = { ...item('b', 'Big', [pf('A', 'B', 9)]), cells: { A: 9, B: -9 } }
    const v = focusArea(matrixOf(['A', 'B'], [elec, small, big]), 'A')
    const lines = v.trades.find(t => t.partyId === 'B')!.lines
    expect(lines.map(l => l.itemId)).toEqual(['b', 's', 'power:electricity'])
    expect(lines[2].energy).toBe(true)
  })
})

describe('areaContents', () => {
  const recipes = makeGameData().recipes
  const root = plan('root', 'Main',
    [rec('n1'), handle('h1', 'nested'), handle('h2', 'sub'), rec('n2', 'r1')],
    [
      plan('nested', 'Nested area', [rec('x')], [], true),
      plan('sub', 'Sub factory', [rec('y', 'r2')]),
      plan('stranded', 'Stranded', [rec('z')]),
    ])

  it('does not enter a nested area, enters a sub-factory and ends with the stranded ones', () => {
    const c = areaContents(root, 'root', recipes)
    expect(c.nestedAreas).toEqual(['Nested area'])
    expect(c.subFactories).toEqual(['Sub factory', 'Stranded'])
    expect(c.rowCount).toBe(4)
    expect(c.recipeNames).toEqual(['Recipe One', 'Recipe Two'])
  })

  it('starts at a sub-plan', () => {
    expect(areaContents(root, 'nested', recipes).rowCount).toBe(1)
  })
})

describe('keys of one item', () => {
  type R = { itemId: string; name: string; total: number; groupId: string; temp?: FluidTag }
  const steam = (temp: FluidTag | undefined, total = 5): R => ({ itemId: 'steam', name: 'Steam', total, groupId: 'g', ...(temp ? { temp } : {}) })
  const rows = [steam({ min: 465 }), steam({ at: 500 }), steam(undefined), steam({ at: 165 })]
  const order = ['', '165', '500', '≥465']
  const labels = (rs: R[]) => rs.map(r => (r.temp ? rowDisplayName(r).replace('Steam ', '').replace('°C', '') : ''))

  it('orders untagged first, then temperatures, then ranges, in name mode', () => {
    const g = groupRows(rows, 'name', new Map(), { collapseTail: false })[0]
    expect(labels(g.rows)).toEqual(order)
  })

  it('orders them the same in rate mode at equal totals', () => {
    const g = groupRows([...rows].reverse(), 'rate', new Map(), { collapseTail: false })[0]
    expect(labels(g.rows)).toEqual(order)
  })
})

describe('matchQuery', () => {
  const rows = [
    { itemId: 'h', name: 'Hydrogen' },
    { itemId: 'o', name: 'Oxygen' },
  ]
  const cols = [{ id: 'c1', names: ['Compression', 'Oxide'] }, { id: 'c2', names: ['Chlorides'] }]
  const has = (r: { itemId: string }, c: string) => (c === 'c1' ? r.itemId === 'h' : r.itemId === 'o')

  it('matches the display name with its temperature or range', () => {
    const steam = [
      { itemId: 'steam', name: 'Steam', temp: { min: 465 } as FluidTag },
      { itemId: 'steam', name: 'Steam', temp: { at: 165 } as FluidTag },
    ]
    expect(matchQuery('≥465', steam, [], () => false)!.rows).toEqual([steam[0]])
    expect(matchQuery('steam 165', steam, [], () => false)!.rows).toEqual([steam[1]])
  })

  it('returns everything for an empty query', () => {
    expect(matchQuery('  ', rows, cols, has)).toEqual({ rows, columnIds: null })
  })
  it('matches items', () => {
    expect(matchQuery('oxy', rows, cols, has)).toEqual({ rows: [rows[1]], columnIds: null })
  })
  it('matches columns and keeps the rows with a cell there', () => {
    const r = matchQuery('CHLOR', rows, cols, has)!
    expect(r.rows).toEqual([rows[1]])
    expect([...r.columnIds!]).toEqual(['c2'])
  })
  it('matches both', () => {
    const r = matchQuery('ox', rows, cols, has)!
    // Oxygen matches by name, c1 ("Oxide") by name and holds Hydrogen; c2 holds Oxygen.
    expect(r.rows.map(x => x.itemId)).toEqual(['h', 'o'])
    expect([...r.columnIds!].sort()).toEqual(['c1', 'c2'])
  })
  it('keeps the area that trades a matching item even when another area matches by name', () => {
    const items = [{ itemId: 'ingot', name: 'Gold ingot' }, { itemId: 'ore', name: 'Gold ore' }]
    const areas = [{ id: 'a1', names: ['Gold ingot'] }, { id: 'a2', names: ['Gold'] }]
    const cell = (r: { itemId: string }, c: string) => r.itemId === 'ingot' || c === 'a2'
    const r = matchQuery('ingot', items, areas, cell)!
    expect([...r.columnIds!].sort()).toEqual(['a1', 'a2'])
    expect(r.rows.map(x => x.itemId)).toEqual(['ingot'])
  })
  it('keeps everything when the query names the scope', () => {
    expect(matchQuery('hydro', rows, cols, has, ['Hydrogen Block'])).toEqual({ rows, columnIds: null })
    expect(matchQuery('zzz', rows, cols, has, ['Hydrogen Block'])).toBeNull()
  })
  it('returns null when nothing matches', () => {
    expect(matchQuery('zzz', rows, cols, has)).toBeNull()
  })
})

describe('groupTotal', () => {
  const row = (itemId: string, cells: Record<string, number>): MatrixRow =>
    ({ key: itemId, itemId, name: itemId, groupId: 'g', cells, fromOutside: 0, toOutside: 0, total: 1, pairs: [] })
  const focus = (counterpart: Record<string, Record<string, number>>) =>
    ({ areaId: 'B', rows: [], counterpart, tradingAreaIds: [], trades: [] })

  it('sums the nets, and blanks a sum that cancels to rounding noise', () => {
    expect(groupTotal([row('a', { A: 10 }), row('b', { A: -4 })], 'A', null)).toEqual({ kind: 'net', t: 6 })
    expect(groupTotal([row('a', { A: 0.1 + 0.2 }), row('b', { A: -0.3 })], 'A', null)).toEqual({ kind: 'net', t: 0 })
    expect(cancels(1e-12, 1000)).toBe(true)
    expect(cancels(0.5, 1000)).toBe(false)
  })

  it('keeps what an area sends to the focus apart from what it receives from it', () => {
    const f = focus({ a: { A: 10 }, b: { A: 5 } })
    const t = groupTotal([row('a', { A: 10, B: -10 }), row('b', { A: -5, B: 5 })], 'A', f)
    expect(t).toEqual({ kind: 'pair', out: 10, in: 5 })
  })

  it('ignores rows where the area has no counterpart value', () => {
    const f = focus({ a: { A: 10 }, b: {} })
    expect(groupTotal([row('a', { A: 10 }), row('b', { A: -3 })], 'A', f)).toEqual({ kind: 'pair', out: 10, in: 0 })
  })
})

describe('totalRows', () => {
  const ids = (xs: { itemId: string }[]) => xs.map(x => x.itemId)

  it('keeps a group made only of energy items, flagged', () => {
    const rows = [{ itemId: 'power:electricity' }, { itemId: 'power:electricity' }]
    expect(totalRows(rows)).toEqual({ rows, energy: true })
  })

  it('does not sum electricity and heat together', () => {
    expect(totalRows([{ itemId: 'power:electricity' }, { itemId: 'power:heat' }])).toEqual({ rows: [], energy: false })
  })

  it('drops the energy rows of a mixed group', () => {
    const r = totalRows([{ itemId: 'power:electricity' }, { itemId: 'plate' }])
    expect(ids(r.rows)).toEqual(['plate'])
    expect(r.energy).toBe(false)
  })

  it('has no energy flag for an empty group', () => {
    expect(totalRows([])).toEqual({ rows: [], energy: false })
  })
})

describe('groupTotal with energy', () => {
  const row = (itemId: string, cells: Record<string, number>): MatrixRow =>
    ({ key: itemId, itemId, name: itemId, groupId: 'g', cells, fromOutside: 0, toOutside: 0, total: 1, pairs: [] })

  it('sums an electricity-only group in power units', () => {
    expect(groupTotal([row('power:electricity', { A: 600 })], 'A', null)).toEqual({ kind: 'net', t: 600, energy: true })
  })

  it('leaves the energy rows out of a mixed group', () => {
    expect(groupTotal([row('power:electricity', { A: 600 }), row('plate', { A: -4 })], 'A', null)).toEqual({ kind: 'net', t: -4 })
  })

  it('flags pair totals of an energy group', () => {
    const f = { areaId: 'B', rows: [], counterpart: { 'power:electricity': { A: 600 } }, tradingAreaIds: [], trades: [] }
    expect(groupTotal([row('power:electricity', { A: 600, B: -600 })], 'A', f)).toEqual({ kind: 'pair', out: 600, in: 0, energy: true })
  })
})
