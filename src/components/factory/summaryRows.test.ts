import { describe, it, expect } from 'vitest'
import type { BlockConnection } from '../../data/types'
import { ingredientRows, byproductRows, isLeftover } from './summaryRows'

function conn(overrides: Partial<BlockConnection> = {}): BlockConnection {
  return { id: 'c1', itemId: 'iron-ore', fromBlockId: 'b1', ...overrides } as BlockConnection
}
function unsat(itemId: string, rate: number) {
  return { itemId, rate }
}

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
    expect(rows).toEqual([{ itemId: 'iron-ore', connections: [], importPerMin: undefined, locked: true }])
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
    expect(byproductRows([], ['slag'])).toEqual([{ itemId: 'slag', leftPerMin: undefined, exported: true }])
  })

  it('gives an item both left over and exported one row with both set', () => {
    const rows = byproductRows([{ itemId: 'slag', ratePerMin: 4 }], ['slag'])
    expect(rows).toEqual([{ itemId: 'slag', leftPerMin: 4, exported: true }])
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
