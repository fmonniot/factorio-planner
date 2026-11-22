import { describe, it, expect } from 'vitest'
import type { BlockConnection, ConnectionFlow, FluidTag } from '../../data/types'
import { ingredientRows, byproductRows, isLeftover, areaMissingPerMin } from './summaryRows'
import type { AreaRoute, AreaSourceRule, SubPlan } from '../../data/types'

function conn(overrides: Partial<BlockConnection> = {}): BlockConnection {
  return { id: 'c1', itemId: 'iron-ore', fromBlockId: 'b1', ...overrides } as BlockConnection
}
function unsat(itemId: string, rate: number) {
  return { itemId, rate }
}

describe('rows of a split fluid', () => {
  const flowWith = (parts: { temp: FluidTag; rate: number }[], status: ConnectionFlow['status'] = 'ok'): ConnectionFlow => ({
    connectionId: 'c1', fromBlockId: 'b1', toBlockId: 'me', itemId: 'steam', available: 99, capped: false,
    rate: parts.reduce((t, p) => t + p.rate, 0), status, kind: 'take',
    parts: parts.map(p => ({ ...p, available: p.rate })),
  })

  it('ingredientRows makes one row per import range, untagged first', () => {
    const rows = ingredientRows([], [{ itemId: 'steam', rate: 60, temp: { min: 465 } }, { itemId: 'steam', rate: 30, temp: {} }], [])
    expect(rows.map(r => r.key)).toEqual(['steam[,]', 'steam[465,]'])
    expect(rows.map(r => r.importPerMin)).toEqual([30, 60])
    expect(rows[1].temp).toEqual({ min: 465 })
  })

  it('adds up imports of the same range and sorts temperatures before ranges', () => {
    const rows = ingredientRows(
      [conn({ id: 'c1', itemId: 'steam' })],
      [{ itemId: 'steam', rate: 5, temp: { min: 465 } }, { itemId: 'steam', rate: 7, temp: { min: 465 } }],
      [],
      undefined,
      new Map([['c1', flowWith([{ temp: { at: 165 }, rate: 10 }])]]),
    )
    expect(rows.map(r => r.key)).toEqual(['steam@165', 'steam[465,]'])
    expect(rows[1].importPerMin).toBe(12)
  })

  it('places a connection on the row of each key its parts carry', () => {
    const c = conn({ id: 'c1', itemId: 'steam' })
    const rows = ingredientRows([c], [], [], undefined, new Map([['c1', flowWith([{ temp: { at: 165 }, rate: 10 }, { temp: { at: 465 }, rate: 20 }])]]))
    expect(rows.map(r => r.key)).toEqual(['steam@165', 'steam@465'])
    expect(rows.every(r => r.connections.includes(c))).toBe(true)
  })

  it('merges a request part into the row of the import range', () => {
    const c = conn({ id: 'c1', itemId: 'steam' })
    const rows = ingredientRows([c], [{ itemId: 'steam', rate: 4, temp: { min: 465 } }], [], undefined, new Map([['c1', flowWith([{ temp: { min: 465 }, rate: 20 }])]]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'steam[465,]', importPerMin: 4 })
    expect(rows[0].connections).toEqual([c])
  })

  it('puts a connection that delivers nothing on the first row of its item', () => {
    const c = conn({ id: 'c1', itemId: 'steam' })
    const unused = new Map([['c1', { ...flowWith([{ temp: { at: 165 }, rate: 0 }], 'unused') }]])
    const rows = ingredientRows([c], [{ itemId: 'steam', rate: 4, temp: { min: 465 } }, { itemId: 'steam', rate: 2, temp: {} }], [], undefined, unused)
    expect(rows.map(r => r.key)).toEqual(['steam[,]', 'steam[465,]'])
    expect(rows[0].connections).toEqual([c])
    expect(rows[1].connections).toEqual([])
    const alone = ingredientRows([c], [], [], undefined, unused)
    expect(alone).toMatchObject([{ key: 'steam', connections: [c] }])
  })

  it('gives a locked split item with no row an untagged one, and locks all its rows otherwise', () => {
    expect(ingredientRows([], [], ['steam'])).toMatchObject([{ key: 'steam', locked: true }])
    const rows = ingredientRows([], [{ itemId: 'steam', rate: 4, temp: { min: 465 } }, { itemId: 'steam', rate: 2, temp: {} }], ['steam'])
    expect(rows.map(r => r.locked)).toEqual([true, true])
  })

  it('asks for the missing amount of a key row with its temperature', () => {
    const asked: unknown[] = []
    ingredientRows([], [{ itemId: 'steam', rate: 4, temp: { min: 465 } }], [], (id, rate, temp) => { asked.push([id, rate, temp]); return undefined })
    expect(asked).toEqual([['steam', 4, { min: 465 }]])
  })

  it('keeps the key of a plain item equal to its id', () => {
    expect(ingredientRows([], [unsat('plate', 3)], [])).toMatchObject([{ key: 'plate', itemId: 'plate' }])
  })

  it('byproductRows lists the keys of an item together, temperatures ascending', () => {
    const rows = byproductRows([
      { itemId: 'steam', key: 'steam@500', temp: { at: 500 }, ratePerMin: 5 },
      { itemId: 'plate', ratePerMin: 2 },
      { itemId: 'steam', key: 'steam@165', temp: { at: 165 }, ratePerMin: 10 },
    ], [])
    expect(rows.map(r => r.key)).toEqual(['steam@165', 'steam@500', 'plate'])
  })

  it('byproductRows marks exports per key and makes export-only rows from a key', () => {
    const rows = byproductRows([{ itemId: 'steam', key: 'steam@500', temp: { at: 500 }, ratePerMin: 5 }], ['steam@165', 'slag'])
    expect(rows.map(r => [r.key, r.exported])).toEqual([['steam@165', true], ['steam@500', false], ['slag', true]])
    expect(rows[0]).toMatchObject({ itemId: 'steam', temp: { at: 165 }, leftPerMin: undefined })
  })
})

describe('ingredientRows', () => {
  it('merges a connection and an import of the same item into one row', () => {
    const rows = ingredientRows([conn()], [unsat('iron-ore', 5)], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].connections.length, 'connections').toBe(1)
    expect(rows[0].importPerMin).toBe(5)
    expect(rows[0].locked).toBe(false)
  })

  it('gives a locked item with no import a row of its own', () => {
    const rows = ingredientRows([], [], ['iron-ore'])
    expect(rows).toEqual([{ key: 'iron-ore', itemId: 'iron-ore', connections: [], importPerMin: undefined, locked: true }])
  })

  it('leaves importPerMin undefined for a fully delivered item', () => {
    const rows = ingredientRows([conn()], [], [])
    expect(rows[0].importPerMin).toBeUndefined()
  })

  it('groups two sources of one item on one row', () => {
    const rows = ingredientRows([conn(), conn({ id: 'c2', fromBlockId: 'b2' })], [], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].connections).toHaveLength(2)
  })

  it('makes no row for an item that is neither connected, imported nor locked', () => {
    expect(ingredientRows([conn()], [], []).map(r => r.itemId)).toEqual(['iron-ore'])
  })

  it('makes no row for an unsatisfied entry with rate 0', () => {
    expect(ingredientRows([], [unsat('iron-ore', 0)], [])).toEqual([])
  })

  it('keeps a goal item that is both short and locked on one row', () => {
    const rows = ingredientRows([], [unsat('iron-plate', 3)], ['iron-plate'])
    expect(rows).toHaveLength(1)
    expect(rows[0].importPerMin).toBe(3)
    expect(rows[0].locked).toBe(true)
  })

  it('orders by first appearance and keeps item ids unique', () => {
    const rows = ingredientRows(
      [conn({ id: 'c1', itemId: 'a' })],
      [unsat('b', 1), unsat('a', 2)],
      ['c', 'b'],
    )
    expect(rows.map(r => r.itemId)).toEqual(['a', 'b', 'c'])
  })
})

describe('byproductRows', () => {
  it('marks an item that is only exported', () => {
    expect(byproductRows([], ['slag'])).toEqual([{ key: 'slag', itemId: 'slag', leftPerMin: undefined, exported: true }])
  })

  it('gives an item both left over and exported one row with both set', () => {
    const rows = byproductRows([{ itemId: 'slag', ratePerMin: 4 }], ['slag'])
    expect(rows).toEqual([{ key: 'slag', itemId: 'slag', leftPerMin: 4, exported: true }])
  })

  it('lists leftovers first', () => {
    const rows = byproductRows([{ itemId: 'b', ratePerMin: 1 }], ['a'])
    expect(rows.map(r => r.itemId)).toEqual(['b', 'a'])
  })
})

describe('isLeftover', () => {
  it('rejects LP noise relative to a large gross flow', () => {
    expect(isLeftover(1.2e-6, 2000)).toBe(false)
    expect(isLeftover(1.6e-6, 2000)).toBe(false)
  })
  it('rejects a rate that displays as 0.00/min and keeps one that does not', () => {
    expect(isLeftover(0.004, 0)).toBe(false)
    expect(isLeftover(0.006, 0)).toBe(true)
  })
  it('keeps a real byproduct', () => {
    expect(isLeftover(210.7, 5000)).toBe(true)
  })
  it('scales the tolerance with the gross flow', () => {
    expect(isLeftover(1e-3, 1e9)).toBe(false)
  })
  it('gates on the relative tolerance even when the rate would display', () => {
    expect(isLeftover(5, 1e9)).toBe(false)
    expect(isLeftover(5, 1e6)).toBe(true)
  })
})

describe('ingredientRows with a missing amount', () => {
  it('asks for the missing amount of each imported item and keeps it on the row', () => {
    const rows = ingredientRows([], [unsat('plate', 20)], [], (itemId, imported) => (itemId === 'plate' ? imported - 8 : undefined))
    expect(rows[0]).toMatchObject({ itemId: 'plate', importPerMin: 20, missingPerMin: 12 })
  })

  it('leaves it off when the callback has no answer, and for items with nothing imported', () => {
    const rows = ingredientRows([], [unsat('plate', 20)], ['gear'], () => undefined)
    expect(rows.every(r => !('missingPerMin' in r) || r.missingPerMin === undefined)).toBe(true)
  })
})

describe('areaMissingPerMin', () => {
  const sub = (id: string, rules?: Record<string, AreaSourceRule>): SubPlan => ({
    id, name: id, nodes: [], subPlans: [], area: true, createdAt: '', updatedAt: '', ...(rules ? { sourceRules: rules } : {}),
  })
  const root = (...areas: SubPlan[]): SubPlan => ({ id: 'root', name: 'root', nodes: [], subPlans: areas, createdAt: '', updatedAt: '' })
  const leg = (to: string, rate: number, supplied?: number): AreaRoute => ({ itemId: 'plate', to, rate, ...(supplied ? { supplied } : {}) })
  const inner: AreaRoute = { itemId: 'plate', from: 'L', to: 'B', rate: 5 }

  it('is the outside leg into an area whose rule has Import off', () => {
    const tree = root(sub('L', { plate: { makeHere: 'off', importOff: true } }), sub('B'))
    expect(areaMissingPerMin('plate', 20, {}, tree, [leg('L', 12), leg('B', 8)])).toBe(12)
  })

  it('is 0 for an area with its own rule that keeps Import on', () => {
    const tree = root(sub('L', { plate: { makeHere: 'off' } }), sub('B'))
    expect(areaMissingPerMin('plate', 20, {}, tree, [leg('L', 12), leg('B', 8)])).toBe(0)
  })

  it('counts only the legs of areas with Import off, and not the supplied part of a leg', () => {
    const tree = root(sub('L', { plate: { importOff: true } }), sub('B', { plate: {} }))
    expect(areaMissingPerMin('plate', 30, {}, tree, [leg('L', 12, 5), leg('B', 8), inner])).toBe(7)
  })

  it('reads the block rule for an area with none of its own', () => {
    const tree = root(sub('L', { plate: {} }), sub('B'))
    expect(areaMissingPerMin('plate', 30, { plate: { importOff: true } }, tree, [leg('L', 12), leg('B', 8)])).toBe(8)
  })

  it('is capped at what the block imports', () => {
    const tree = root(sub('L', { plate: { importOff: true } }), sub('B', { plate: { importOff: true } }))
    expect(areaMissingPerMin('plate', 10, {}, tree, [leg('L', 12), leg('B', 8)])).toBe(10)
  })

  it('is undefined when no area has a rule of its own for the item', () => {
    const tree = root(sub('L', { gear: { importOff: true } }), sub('B'))
    expect(areaMissingPerMin('plate', 20, { plate: { importOff: true } }, tree, [leg('L', 12)])).toBeUndefined()
    expect(areaMissingPerMin('plate', 20, {}, root(), [])).toBeUndefined()
  })

  it('counts only the routes of the key asked about', () => {
    const tree = root(sub('L', { steam: { importOff: true } }), sub('B'))
    const routes: AreaRoute[] = [
      { itemId: 'steam', temp: { min: 465 }, to: 'L', rate: 12 },
      { itemId: 'steam', temp: {}, to: 'L', rate: 5 },
    ]
    expect(areaMissingPerMin('steam', 20, {}, tree, routes, { min: 465 })).toBe(12)
    expect(areaMissingPerMin('steam', 20, {}, tree, routes, {})).toBe(5)
  })
})
