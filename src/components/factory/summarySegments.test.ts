import { describe, it, expect } from 'vitest'
import {
  productSlot,
  byproductSlot,
  ingredientSlot,
  overviewRows,
  slotHasKey,
  segmentLabel,
  segmentTitle,
  keyEntryText,
  isShortfall,
  differsFromTarget,
} from './summarySegments'
import type { Segment, Overlay } from './summarySegments'
import type { BlockConnection, ConnectionFlow, Product } from '../../data/types'
import type { IngredientRow } from './summaryRows'

const goal = (rate = 60): Product => ({ id: 'g1', itemId: 'iron-plate', extraRate: rate })
const noExtra = (): Product => ({ id: 'g1', itemId: 'iron-plate' })

const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
  connectionId: 'c1',
  fromBlockId: 'A',
  toBlockId: 'B',
  itemId: 'iron-plate',
  available: 100,
  capped: false,
  rate: 30,
  status: 'ok',
  kind: 'take',
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
    expect(slot.product).toMatchObject({ actual: undefined, short: false, tickAt: null })
  })

  it('keeps everything when the goal is met and nothing is exported', () => {
    const slot = productSlot(goal(), 60, [], 'min')
    expect(shape(slot.segments)).toEqual([['kept', 60]])
    expect(slot.scale).toBe(60)
    expect(slot.product!.tickAt).toBeNull()
  })

  it('adds a short segment and a tick at the end of the bar when short', () => {
    const slot = productSlot(goal(), 58, [], 'min')
    expect(shape(slot.segments)).toEqual([['kept', 58], ['short', 2]])
    expect(slot).toMatchObject({ status: 'short', rate: 58 })
    expect(slot.product).toMatchObject({ short: true, tickAt: 1 })
  })

  it('puts the tick inside the bar when over-producing', () => {
    const slot = productSlot(goal(), 90, [flow({ rate: 30 })], 'min')
    expect(shape(slot.segments)).toEqual([['to:B', 30], ['kept', 60]])
    expect(slot.scale).toBe(90)
    expect(slot.product!.tickAt).toBeCloseTo(60 / 90)
  })

  it('does not count a shortfall that rounds to zero', () => {
    const slot = productSlot(goal(), 59.9999, [], 'min')
    expect(slot.status).toBeNull()
    expect(slot.product!.short).toBe(false)
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

  it('rounds electricity in power units, whatever the rate unit', () => {
    const el = 'power:electricity'
    // 10 MW = 600/min. A 0.003 MW (3 kW) gap is 0.18/min: visible as power, so short on both units.
    expect(isShortfall(600, 599.82, 'sec', el)).toBe(true)
    expect(isShortfall(600, 599.82, 'min', el)).toBe(true)
    expect(differsFromTarget(600, 599.82, 'sec', el)).toBe(true)
    // Under 1 W it rounds away on both.
    expect(isShortfall(600, 600 - 1e-6, 'sec', el)).toBe(false)
    expect(isShortfall(600, 600 - 1e-6, 'min', el)).toBe(false)
    // The same gap of an ordinary item rounds away on /s.
    expect(isShortfall(600, 599.82, 'sec')).toBe(false)
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

  it('carries the connection limit on a capped source', () => {
    const row = ingredientRow({ connections: [{ ...conn('c1', 'A'), maxRate: 30 }] })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 30, status: 'limited', capped: true })]]), blocks)
    expect(slot.segments[0]).toMatchObject({ limited: true, capped: true, maxRate: 30 })
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

  it('turns a self-connection into an overlay', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const slot = ingredientSlot(row, new Map([['c1', flow({ rate: 0, status: 'self' })]]), blocks)
    expect(slot.overlays).toMatchObject([{ kind: 'self' }])
  })

  it('carries the loop mark of a flow onto its segment', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const slot = ingredientSlot(row, new Map([['c1', flow({ loop: true })]]), blocks)
    expect(slot.segments[0].loop).toBe(true)
    const plain = ingredientSlot(row, new Map([['c1', flow()]]), blocks)
    expect('loop' in plain.segments[0]).toBe(false)
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

  it('carries the loop mark onto the overview row', () => {
    const slot = ingredientSlot(
      ingredientRow({ connections: [conn('c1', 'A')] }),
      new Map([['c1', flow({ loop: true })]]),
      new Set(['A']),
    )
    expect(overviewRows([slot])[0].loop).toBe(true)
    const exported = productSlot(goal(), 90, [flow({ rate: 30, loop: true })], 'min')
    expect(exported.segments[0].loop).toBe(true)
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
    expect(segmentLabel(seg('kept'), undefined)).toBe('Left')
    expect(segmentLabel(seg('left'), undefined)).toBe('Left')
    expect(segmentLabel(seg('import'), undefined)).toBe('Imported')
    expect(segmentLabel(seg('short'), undefined)).toBe('Short')
    expect(segmentLabel(ov('unused'), 'Miner')).toBe('← Miner · unused')
    expect(segmentLabel(ov('self'), 'Miner')).toBe('← Miner · self, ignored')
    expect(segmentLabel(ov('missing-source'), undefined)).toBe('(deleted block)')
    expect(segmentLabel(ov('locked'), undefined)).toBe('Imports forbidden')
  })

  it('marks loop segments in labels and titles', () => {
    expect(segmentLabel(seg('source', { loop: true }), 'Ores')).toBe('← Ores ↻')
    expect(segmentLabel(seg('export', { loop: true }), 'Ores')).toBe('→ Ores ↻')
    expect(segmentTitle(seg('export', { loop: true }), ctx)).toMatch(/— part of a loop — click to open/)
    expect(segmentTitle(seg('source', { loop: true }), ctx)).toMatch(/— part of a loop — click to open/)
    expect(segmentTitle(seg('source', { loop: true, limited: true }), ctx)).toMatch(/— part of a loop — click to open/)
    expect(segmentTitle(seg('source', { loop: true, limited: true, capped: true, maxRate: 8 }), ctx))
      .toMatch(/— part of a loop — click to open/)
  })

  it('titles every kind', () => {
    expect(segmentTitle(seg('export'), ctx)).toBe('Sends Iron Plate to Miner — click to open')
    expect(segmentTitle(seg('source'), ctx)).toBe('Iron Plate from Miner — click to open, right-click to remove')
    expect(segmentTitle(seg('source', { limited: true }), ctx)).toBe(
      'Limited: Miner only offers 12.0/m — click to open, right-click to remove',
    )
    expect(segmentTitle(seg('source', { limited: true, capped: true, maxRate: 8 }), ctx)).toBe(
      "Limited by this connection's limit of 8.0/m — click to open, right-click to remove",
    )
    expect(segmentTitle(ov('unused'), ctx)).toMatch(/^Not used: /)
    expect(segmentTitle(ov('missing-source'), ctx)).toMatch(/source block was deleted/)
    expect(segmentTitle(ov('self'), ctx)).toMatch(/cannot supply itself/)
    expect(segmentTitle(seg('kept'), ctx)).toBe('Left')
    expect(segmentTitle(ov('locked'), ctx)).toBe('Imports forbidden')
  })
})

describe('requested flows', () => {
  it('marks the source segment of a request and words its title', () => {
    const row = ingredientRow({ connections: [conn('c1', 'A')] })
    const requested = ingredientSlot(row, new Map([['c1', flow({ kind: 'request', requested: 30 })]]), new Set(['A']))
    expect(requested.segments[0].requested).toBe(true)
    const take = ingredientSlot(row, new Map([['c1', flow()]]), new Set(['A']))
    expect('requested' in take.segments[0]).toBe(false)
    const ctx = { itemName: 'Iron Plate', blockName: 'Miner', fmt: (n: number) => String(n), unit: '/m' }
    expect(segmentTitle(requested.segments[0], ctx)).toBe('Iron Plate from Miner — requested — click to open, right-click to remove')
    expect(segmentTitle(take.segments[0], ctx)).toBe('Iron Plate from Miner — click to open, right-click to remove')
  })
})

describe('productSlot with a requested amount', () => {
  it('is short against the extra plus what is requested', () => {
    // extra 10, 5 requested, 12 made: the solver reports a 3/min shortfall.
    const f = flow({ rate: 5, kind: 'request', requested: 5 })
    const slot = productSlot(goal(10), 12, [f], 'min', [f])
    expect(slot.status).toBe('short')
    expect(slot.product).toMatchObject({ extra: 10, required: 15, short: true })
    expect(shape(slot.segments)).toEqual([['to:B', 5], ['kept', 7], ['short', 3]])
  })

  it('is not short when the output covers extra plus requested', () => {
    const f = flow({ rate: 5, kind: 'request', requested: 5 })
    const slot = productSlot(goal(10), 15, [f], 'min', [f])
    expect(slot.status).toBeNull()
    expect(slot.product).toMatchObject({ required: 15, short: false, tickAt: null })
  })
})

describe('productSlot without extra', () => {
  it('is short against what is requested when nothing is made of it', () => {
    const f = flow({ rate: 20, kind: 'request', requested: 30 })
    const slot = productSlot(noExtra(), 20, [f], 'min', [f])
    expect(slot.status).toBe('short')
    expect(slot.product).toMatchObject({ extra: undefined, required: 30, short: true })
    expect(shape(slot.segments)).toEqual([['to:B', 20], ['short', 10]])
  })

  it('is empty when nothing is requested, made or exported, even with a negative balance', () => {
    const slot = productSlot(noExtra(), -15, [], 'min')
    expect(slot).toMatchObject({ empty: true, status: null, rate: 0, scale: 0, segments: [], overlays: [], dimmed: true })
    expect(slot.product).toMatchObject({ short: false, tickAt: null })
  })

  it('is empty before the first solve', () => {
    expect(productSlot(noExtra(), undefined, [], 'min').empty).toBe(true)
  })

  it('shows what a coproduct makes without calling it short', () => {
    const slot = productSlot(noExtra(), 15, [], 'min')
    expect(slot.empty).toBeUndefined()
    expect(slot.rate).toBe(15)
    expect(shape(slot.segments)).toEqual([['kept', 15]])
    expect(slot.status).toBeNull()
    expect(slot.product!.tickAt).toBeNull()
    expect(slot.product!.short).toBe(false)
  })
})

describe('productSlot shortfall attribution', () => {
  const request = (to: string, rate: number, requested: number) =>
    flow({ connectionId: `c-${to}`, toBlockId: to, rate, kind: 'request', requested, status: rate < requested ? 'limited' : 'ok' })

  it('reports a shortfall past the extra and the request as exports', () => {
    const r = request('R', 15, 15)
    const slot = productSlot(goal(60), 65, [r], 'min', [r])
    expect(shape(slot.segments)).toEqual([['to:R', 15], ['kept', 50], ['short', 10]])
    expect(slot.product!.shortFrom).toEqual({ extra: 10, requests: 0, blockIds: [] })
    expect(slot.segments[0].requestedRate).toBe(15)
  })

  it('moves the shortfall from the extra to the requester served last', () => {
    const b = request('B', 30, 30)
    const c = request('C', 5, 20)
    const slot = productSlot(goal(10), 35, [b, c], 'min', [b, c])
    expect(shape(slot.segments)).toEqual([['to:B', 30], ['to:C', 5], ['short', 25]])
    expect(slot.product!.shortFrom).toEqual({ extra: 10, requests: 15, blockIds: ['C'] })
  })

  it('does not blame a requester that drew less for another reason', () => {
    // R took the item from another block first, so it drew 20 of the 30 it asked and is not
    // limited. S is the one the short source left wanting.
    const r = flow({ connectionId: 'c-R', toBlockId: 'R', rate: 20, kind: 'request', requested: 30, status: 'ok' })
    const sRequest = request('S', 5, 20)
    const slot = productSlot(goal(10), 25, [r, sRequest], 'min', [r, sRequest])
    expect(slot.product!.shortFrom).toEqual({ extra: 10, requests: 25, blockIds: ['S'] })
  })

  it('names a requester that got nothing', () => {
    const b = request('B', 0, 15)
    const slot = productSlot(noExtra(), 0, [], 'min', [b])
    expect(shape(slot.segments)).toEqual([['short', 15]])
    expect(slot.product!.shortFrom).toEqual({ extra: 0, requests: 15, blockIds: ['B'] })
    expect(slot.product!.requested).toBe(15)
  })
})

describe('keyEntryText', () => {
  const fmt = (n: number) => n.toFixed(1)
  const names: Record<string, string> = { R: 'R', B: 'B', C: 'C', G: 'Gears' }
  const nameOf = (id: string) => names[id]
  const join = (e: Segment | Overlay, blockName: string | undefined, product = undefined as Parameters<typeof keyEntryText>[1]['product']) => {
    const t = keyEntryText(e, { blockName, product, fmt, nameOf })
    return [t.label, t.amount, t.note].filter(x => x !== undefined).join(' ')
  }
  const productOf = (extra: Product, actual: number, requests: ConnectionFlow[], exports: ConnectionFlow[] = requests) => {
    const slot = productSlot(extra, actual, exports, 'min', requests)
    return { slot, product: slot.product!, seg: (key: string) => slot.segments.find(s => s.key === key)! }
  }
  const request = (to: string, rate: number, requested: number) =>
    flow({ connectionId: `c-${to}`, toBlockId: to, rate, kind: 'request', requested, status: rate < requested ? 'limited' : 'ok' })

  it('reads a request served in full', () => {
    const r = request('R', 15, 15)
    const p = productOf(goal(60), 75, [r])
    expect(join(p.seg('to:R'), 'R', p.product)).toBe('R requests 15.0')
  })

  it('states the ask when a request drew more than it asked', () => {
    const r = request('R', 18, 15)
    const p = productOf(noExtra(), 18, [r])
    expect(join(p.seg('to:R'), 'R', p.product)).toBe('R requests 15.0')
  })

  it('reads a request that got less', () => {
    const c = request('C', 5, 20)
    const p = productOf(noExtra(), 5, [c])
    expect(join(p.seg('to:C'), 'C', p.product)).toBe('C: 5.0 of 20.0 requested')
  })

  it('marks a loop request', () => {
    const r = flow({ toBlockId: 'R', rate: 15, kind: 'request', requested: 15, loop: true })
    const p = productOf(noExtra(), 15, [r])
    expect(join(p.seg('to:R'), 'R', p.product)).toBe('R ↻ requests 15.0')
  })

  it('reads what is left as the extra', () => {
    const r = request('R', 15, 15)
    const withExtra = productOf(goal(60), 65, [r])
    expect(join(withExtra.seg('kept'), undefined, withExtra.product)).toBe('Extra: 50.0 of 60.0')
    // A requester drew less than it asked: more is left than the extra, so it is not "Extra: 20 of 10".
    const light = request('R', 20, 30)
    const over = productOf(goal(10), 40, [light])
    expect(join(over.seg('kept'), undefined, over.product)).toBe('Left 20.0')
    const p = productOf(noExtra(), 12, [])
    expect(join(p.seg('kept'), undefined, p.product)).toBe('Left 12.0')
  })

  it('says where a shortfall comes from', () => {
    const r = request('R', 15, 15)
    const a = productOf(goal(60), 65, [r])
    expect(join(a.seg('short'), undefined, a.product)).toBe('Short 10.0 — comes out of the extra')

    const b = request('B', 30, 30)
    const c = request('C', 5, 20)
    const both = productOf(goal(10), 35, [b, c])
    expect(join(both.seg('short'), undefined, both.product)).toBe("Short 25.0 — comes out of the extra and C's request")

    const g = request('G', 5, 20)
    const gears = productOf(goal(10), 5, [g])
    expect(join(gears.seg('short'), undefined, gears.product)).toBe("Short 25.0 — comes out of the extra and Gears' request")

    const none = productOf(noExtra(), 35, [b, c])
    expect(join(none.seg('short'), undefined, none.product)).toBe("Short 15.0 — comes out of C's request")

    const b2 = request('B', 10, 30)
    const two = productOf(noExtra(), 15, [b2, c])
    expect(join(two.seg('short'), undefined, two.product)).toBe("Short 35.0 — comes out of B's and C's requests")
  })

  it('leaves entries of other panes as label and amount', () => {
    const e = { key: 'from:A', kind: 'source', amount: 12 } as Segment
    expect(join(e, 'Miner')).toBe('← Miner 12.0')
    expect(join({ key: 'locked', kind: 'locked' } as Overlay, undefined)).toBe('Imports forbidden')
    const take = flow({ toBlockId: 'B', rate: 5 })
    const p = productOf(goal(10), 15, [], [take])
    expect(join(p.seg('to:B'), 'B', p.product)).toBe('→ B 5.0')
  })
})
