import { describe, it, expect } from 'vitest'
import {
  productSlot,
  byproductSlot,
  ingredientSlot,
  overviewRows,
  slotHasKey,
  segmentLabel,
  segmentTitle,
  isShortfall,
} from './summarySegments'
import type { Segment, Overlay } from './summarySegments'
import type { BlockConnection, ConnectionFlow, ProductionGoal } from '../../data/types'
import type { IngredientRow } from './summaryRows'

const goal = (rate = 60): ProductionGoal => ({ id: 'g1', itemId: 'iron-plate', rate })

const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
  connectionId: 'c1',
  fromBlockId: 'A',
  toBlockId: 'B',
  itemId: 'iron-plate',
  available: 100,
  rate: 30,
  status: 'ok',
  ...over,
})

const conn = (id: string, fromBlockId: string): BlockConnection => ({ id, itemId: 'iron-plate', fromBlockId })

const ingredientRow = (over: Partial<IngredientRow> = {}): IngredientRow => ({
  itemId: 'iron-plate',
  connections: [],
  importPerMin: undefined,
  locked: false,
  ...over,
})

const shape = (segments: Segment[]) => segments.map(s => [s.key, s.amount])

describe('productSlot', () => {
  it('shows the target and no segments before the first solve', () => {
    const slot = productSlot(goal(), undefined, [], 'min')
    expect(slot).toMatchObject({ rate: 60, scale: 60, segments: [], status: null })
    expect(slot.goal).toMatchObject({ actual: undefined, short: false, tickAt: null })
  })

  it('keeps everything when the goal is met and nothing is exported', () => {
    const slot = productSlot(goal(), 60, [], 'min')
    expect(shape(slot.segments)).toEqual([['kept', 60]])
    expect(slot.scale).toBe(60)
    expect(slot.goal!.tickAt).toBeNull()
  })

  it('adds a short segment and a tick at the end of the bar when short', () => {
    const slot = productSlot(goal(), 58, [], 'min')
    expect(shape(slot.segments)).toEqual([['kept', 58], ['short', 2]])
    expect(slot).toMatchObject({ status: 'short', rate: 58 })
    expect(slot.goal).toMatchObject({ short: true, tickAt: 1 })
  })

  it('puts the tick inside the bar when over-producing', () => {
    const slot = productSlot(goal(), 90, [flow({ rate: 30 })], 'min')
    expect(shape(slot.segments)).toEqual([['to:B', 30], ['kept', 60]])
    expect(slot.scale).toBe(90)
    expect(slot.goal!.tickAt).toBeCloseTo(60 / 90)
  })

  it('does not count a shortfall that rounds to zero', () => {
    const slot = productSlot(goal(), 59.9999, [], 'min')
    expect(slot.status).toBeNull()
    expect(slot.goal!.short).toBe(false)
    expect(slot.segments.map(s => s.key)).toEqual(['kept'])
  })

  it('is fully short when no node makes the item', () => {
    const slot = productSlot(goal(), 0, [], 'min')
    expect(shape(slot.segments)).toEqual([['short', 60]])
    expect(slot.status).toBe('short')
  })

  it('uses the display unit for the rounding check', () => {
    // 0.004/min is 0.00 per minute but also 0.00 per second; 0.5/min is 0.01 per second.
    expect(isShortfall(60, 59.5, 'sec')).toBe(true)
    expect(isShortfall(60, 59.5, 'min')).toBe(true)
    expect(isShortfall(60, 59.99, 'sec')).toBe(false)
    expect(isShortfall(60, 59.99, 'min')).toBe(true)
  })
})

describe('byproductSlot', () => {
  it('has a left segment only when nothing is exported', () => {
    const slot = byproductSlot({ itemId: 'slag', leftPerMin: 10, exported: false }, [])
    expect(shape(slot.segments)).toEqual([['left', 10]])
    expect(slot).toMatchObject({ rate: 10, scale: 10 })
  })

  it('has rate 0 and the export total as scale when only exported', () => {
    const slot = byproductSlot({ itemId: 'slag', leftPerMin: undefined, exported: true }, [flow({ rate: 12 })])
    expect(slot).toMatchObject({ rate: 0, scale: 12 })
    expect(shape(slot.segments)).toEqual([['to:B', 12]])
  })

  it('lists the exports in order, then what is left', () => {
    const slot = byproductSlot({ itemId: 'slag', leftPerMin: 5, exported: true }, [
      flow({ toBlockId: 'X', rate: 4 }),
      flow({ connectionId: 'c2', toBlockId: 'Y', rate: 6 }),
    ])
    expect(shape(slot.segments)).toEqual([['to:X', 4], ['to:Y', 6], ['left', 5]])
    expect(slot.scale).toBe(15)
  })
})

describe('ingredientSlot', () => {
  const blocks = new Set(['A', 'B'])

  it('shows an import only', () => {
    const slot = ingredientSlot(ingredientRow({ importPerMin: 20 }), new Map(), blocks)
    expect(shape(slot.segments)).toEqual([['import', 20]])
    expect(slot).toMatchObject({ rate: 20, scale: 20, status: null, dimmed: false })
  })

  it('sums delivered and imported amounts into the need', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')], importPerMin: 10 })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 30 })]]), blocks)
    expect(shape(slot.segments)).toEqual([['from:A', 30], ['import', 10]])
    expect(slot.scale).toBe(40)
  })

  it('marks a limited source', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')], importPerMin: 10 })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 30, status: 'limited' })]]), blocks)
    expect(slot.status).toBe('limited')
    expect(slot.segments[0].limited).toBe(true)
  })

  it('turns an unused connection into an overlay and dims a slot with nothing else', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 0, status: 'unused' })]]), blocks)
    expect(slot.segments).toEqual([])
    expect(slot.overlays).toEqual([{ key: 'from:A', kind: 'unused', blockId: 'A', connectionId: 'c1' }])
    expect(slot.dimmed).toBe(true)
  })

  it('turns a deleted source into an overlay', () => {
    const row = ingredientRow({ connections: [conn('c1', 'GONE')] })
    const slot = ingredientSlot(row, new Map(), blocks)
    expect(slot.overlays).toMatchObject([{ kind: 'missing-source', key: 'from:GONE' }])
  })

  it('turns a cycle into an overlay', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 0, status: 'cycle' })]]), blocks)
    expect(slot.overlays).toMatchObject([{ kind: 'cycle' }])
  })

  it('draws nothing for a connection whose first solve has not landed', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const slot = ingredientSlot(row, new Map(), blocks)
    expect(slot.segments).toEqual([])
    expect(slot.overlays).toEqual([])
  })

  it('adds a locked overlay and dims the slot', () => {
    const slot = ingredientSlot(ingredientRow({ locked: true }), new Map(), blocks)
    expect(slot.overlays).toEqual([{ key: 'locked', kind: 'locked' }])
    expect(slot).toMatchObject({ status: 'locked', dimmed: true, locked: true })
  })

  it('keeps the import segment of a locked goal shortfall', () => {
    const slot = ingredientSlot(ingredientRow({ locked: true, importPerMin: 5 }), new Map(), blocks)
    expect(shape(slot.segments)).toEqual([['import', 5]])
    expect(slot.overlays.map(o => o.kind)).toEqual(['locked'])
    expect(slot.dimmed).toBe(true)
  })
})

describe('overviewRows', () => {
  it('merges totals and counts across slots and orders by rank', () => {
    const a = productSlot(goal(), 90, [flow({ rate: 30 })], 'min')
    const b = productSlot({ ...goal(50), id: 'g2', itemId: 'copper-plate' }, 40, [flow({ toBlockId: 'B', rate: 10 })], 'min')
    const rows = overviewRows([a, b])
    expect(rows.map(r => r.key)).toEqual(['to:B', 'kept', 'short'])
    expect(rows[0]).toMatchObject({ total: 40, count: 2, kind: 'export', blockId: 'B' })
    expect(rows[1]).toMatchObject({ total: 90, count: 2 })
  })

  it('ranks block keys, then kept/left, then import/short, then locked', () => {
    const slot = ingredientSlot(
      ingredientRow({ connections: [conn('c1', 'A')], importPerMin: 5, locked: true }),
      new Map([['c1', flow({ rate: 30 })]]),
      new Set(['A']),
    )
    expect(overviewRows([slot]).map(r => r.key)).toEqual(['from:A', 'import', 'locked'])
  })

  it('gives an overlay-only block row a zero total', () => {
    const slot = ingredientSlot(
      ingredientRow({ connections: [conn('c1', 'A')] }),
      new Map([['c1', flow({ rate: 0, status: 'unused' })]]),
      new Set(['A']),
    )
    expect(overviewRows([slot])).toEqual([
      { key: 'from:A', kind: 'unused', blockId: 'A', total: 0, count: 1, limited: false },
    ])
  })

  it('takes the segment kind when an earlier slot created the row from an overlay', () => {
    const unusedY = ingredientSlot(
      ingredientRow({ itemId: 'copper-plate', connections: [conn('c1', 'B')] }),
      new Map([['c1', flow({ rate: 0, status: 'unused' })]]),
      new Set(['B']),
    )
    const sourceX = ingredientSlot(
      ingredientRow({ connections: [conn('c2', 'B')] }),
      new Map([['c2', flow({ rate: 30 })]]),
      new Set(['B']),
    )
    const rows = overviewRows([unusedY, sourceX])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'from:B', kind: 'source', total: 30, count: 2 })
  })

  it('flags a key as limited when any of its segments is', () => {
    const slot = ingredientSlot(
      ingredientRow({ connections: [conn('c1', 'A')] }),
      new Map([['c1', flow({ status: 'limited' })]]),
      new Set(['A']),
    )
    expect(overviewRows([slot])[0].limited).toBe(true)
  })
})

describe('slotHasKey', () => {
  it('finds segment and overlay keys', () => {
    const slot = ingredientSlot(
      ingredientRow({ connections: [conn('c1', 'A'), conn('c2', 'B')], locked: true }),
      new Map([['c1', flow({ rate: 30 })], ['c2', flow({ connectionId: 'c2', fromBlockId: 'B', rate: 0, status: 'unused' })]]),
      new Set(['A', 'B']),
    )
    expect(slotHasKey(slot, 'from:A')).toBe(true)
    expect(slotHasKey(slot, 'from:B')).toBe(true)
    expect(slotHasKey(slot, 'locked')).toBe(true)
    expect(slotHasKey(slot, 'import')).toBe(false)
  })
})

describe('segmentLabel / segmentTitle', () => {
  const seg = (kind: Segment['kind'], extra: Partial<Segment> = {}): Segment => ({ key: kind, kind, amount: 1, ...extra })
  const ov = (kind: Overlay['kind']): Overlay => ({ key: kind, kind })
  const ctx = { itemName: 'Iron Plate', blockName: 'Miner', fmt: (n: number) => n.toFixed(1), unit: '/m', available: 12 }

  it('labels every kind', () => {
    expect(segmentLabel(seg('export'), 'Miner')).toBe('→ Miner')
    expect(segmentLabel(seg('source'), 'Miner')).toBe('← Miner')
    expect(segmentLabel(seg('source'), undefined)).toBe('← (deleted block)')
    expect(segmentLabel(seg('kept'), undefined)).toBe('Kept')
    expect(segmentLabel(seg('left'), undefined)).toBe('Left')
    expect(segmentLabel(seg('import'), undefined)).toBe('Imported')
    expect(segmentLabel(seg('short'), undefined)).toBe('Short')
    expect(segmentLabel(ov('unused'), 'Miner')).toBe('← Miner · unused')
    expect(segmentLabel(ov('cycle'), 'Miner')).toBe('← Miner · cycle, ignored')
    expect(segmentLabel(ov('missing-source'), undefined)).toBe('(deleted block)')
    expect(segmentLabel(ov('locked'), undefined)).toBe('Imports forbidden')
  })

  it('titles every kind', () => {
    expect(segmentTitle(seg('export'), ctx)).toBe('Sends Iron Plate to Miner — click to open')
    expect(segmentTitle(seg('source'), ctx)).toBe('Iron Plate from Miner — click to open, right-click to remove')
    expect(segmentTitle(seg('source', { limited: true }), ctx)).toBe(
      'Limited: Miner only offers 12.0/m — click to open, right-click to remove',
    )
    expect(segmentTitle(ov('unused'), ctx)).toMatch(/^Not used: /)
    expect(segmentTitle(ov('missing-source'), ctx)).toMatch(/source block was deleted/)
    expect(segmentTitle(ov('cycle'), ctx)).toMatch(/forms a cycle/)
    expect(segmentTitle(seg('kept'), ctx)).toBe('Kept')
    expect(segmentTitle(ov('locked'), ctx)).toBe('Imports forbidden')
  })
})
