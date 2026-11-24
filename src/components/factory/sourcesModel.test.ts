import { describe, it, expect } from 'vitest'
import { makeEmptyBlock, makeEmptySubPlan, makeRecipeNode } from '../../store/blockStore'
import type { Block, ConnectionFlow, SolvedNode, SolverResult } from '../../data/types'
import { altMoveTarget, buildSourcesModel, consumedOf } from './sourcesModel'
import type { SourcesModelInput } from './sourcesModel'
import type { BlockRow } from './sourcesRows'
import type { ItemMaker } from './sourcingText'
import { sourcesLineOrder } from './itemSourcing'

const node = (id: string, ore: number): SolvedNode => ({ recipeNodeId: id, inputRates: { ore }, outputRates: {} } as unknown as SolvedNode)
const solve = (nodes: SolvedNode[]): SolverResult => ({ nodes, unsatisfied: [] } as unknown as SolverResult)

const flow = (id: string, rate: number, status: ConnectionFlow['status'] = 'ok'): ConnectionFlow =>
  ({ connectionId: id, rate, available: rate, status, capped: false, kind: 'take' } as unknown as ConnectionFlow)

const row = (id: string, name: string, rate: number | undefined, over: Partial<BlockRow> = {}): BlockRow => ({
  connection: { id, fromBlockId: `src-${id}`, itemId: 'ore' } as unknown as BlockRow['connection'],
  source: { id: `src-${id}`, name, color: '#ff0000' } as unknown as Block,
  flow: rate === undefined ? undefined : flow(id, rate),
  greyed: false, canMakeProduct: false, status: '', ...over,
})

const maker = (rate: number, byproduct: boolean): ItemMaker => ({ recipeName: 'R', machineName: 'M', machineCount: 1, rate, byproduct })

function input(over: Partial<SourcesModelInput> = {}): SourcesModelInput {
  const block = makeEmptyBlock('B')
  block.rootPlan = { ...block.rootPlan, nodes: [makeRecipeNode('r1')] }
  return {
    block, result: solve([{ ...node('n', 100) }]), itemId: 'ore', area: undefined, rule: undefined, makers: [], suppliers: [], supply: undefined,
    unsatisfied: 0, rows: [], order: sourcesLineOrder(undefined, false, 'above'), ...over,
  }
}
const rates = (m: ReturnType<typeof buildSourcesModel>) => Object.fromEntries(m.lines.map(l => [l.key, l.rate]))

describe('consumedOf', () => {
  it('sums the consumption of every solved row, or of the given rows', () => {
    const result = solve([node('a', 30), node('b', 12)])
    expect(consumedOf(result, 'ore')).toBe(42)
    expect(consumedOf(result, 'ore', new Set(['b']))).toBe(12)
    expect(consumedOf(result, 'plate')).toBe(0)
  })
  it('is undefined before a solve', () => {
    expect(consumedOf(undefined, 'ore')).toBeUndefined()
  })
})

describe('buildSourcesModel', () => {
  it('has no rates and no bar before the first solve', () => {
    const m = buildSourcesModel(input({ result: undefined }))
    expect(m.need).toBeUndefined()
    expect(m.bar).toEqual([])
    expect(m.lines.every(l => l.rate === undefined && !l.supplies)).toBe(true)
  })

  it('reads a block line from its flow at block scope even before a solve of this block', () => {
    const m = buildSourcesModel(input({ result: undefined, rows: [row('c1', 'Cheap', 10)] }))
    expect(rates(m)['block:c1']).toBe(10)
  })

  it('gives what the rows use that no connection or import covers to Already made here first, then Make more here', () => {
    const m = buildSourcesModel(input({ makers: [maker(30, true), maker(100, false)], rows: [row('c1', 'Cheap', 20)] }))
    expect(rates(m)).toMatchObject({ 'made-here': 30, 'make-here': 50, 'block:c1': 20, import: 0 })
    expect(m.total).toBe(100)
    expect(m.need).toBe(100)
  })

  it('puts everything inside into Already made here under Make more here off', () => {
    const m = buildSourcesModel(input({ rule: { makeHere: 'off' }, makers: [maker(10, false)], rows: [row('c1', 'Cheap', 20)] }))
    expect(rates(m)).toMatchObject({ 'made-here': 80, 'make-here': undefined })
    const make = m.lines.find(l => l.key === 'make-here')!
    expect(make.off).toBe(true)
    expect(make.dim).toBe(true)
    expect(make.mark).toBeUndefined()
  })

  it('never lets the inside share go negative', () => {
    const m = buildSourcesModel(input({ result: solve([node('n', 10)]), makers: [maker(50, true)], rows: [row('c1', 'Cheap', 40)] }))
    expect(rates(m)).toMatchObject({ 'made-here': 0, 'make-here': 0, 'block:c1': 40 })
  })

  it('reads zero need as zero shares', () => {
    const m = buildSourcesModel(input({ result: solve([node('n', 0)]), rows: [row('c1', 'Cheap', 0)] }))
    expect(m.need).toBe(0)
    expect(m.bar).toEqual([])
    expect(rates(m)).toMatchObject({ 'made-here': 0, 'make-here': 0, 'block:c1': 0, import: 0 })
  })

  it('reads Import on as the imported rate', () => {
    const m = buildSourcesModel(input({ unsatisfied: 25 }))
    const imp = m.lines.find(l => l.key === 'import')!
    expect(imp.rate).toBe(25)
    expect(imp.look).toEqual({ kind: 'import' })
    expect(imp.mark).toBeUndefined()
    expect(m.missing).toBe(0)
    expect(m.bar.find(p => p.key === 'import')?.label).toBe('Import')
  })

  it('reads Import off with something unmet as missing, not dimmed', () => {
    const m = buildSourcesModel(input({ rule: { importOff: true }, unsatisfied: 25 }))
    const imp = m.lines.find(l => l.key === 'import')!
    expect(imp).toMatchObject({ rate: 25, off: true, dim: false, mark: 'missing', look: { kind: 'missing' } })
    expect(m.missing).toBe(25)
    expect(m.bar.find(p => p.key === 'import')?.label).toBe('Missing')
    expect(m.total).toBe(100)
  })

  it('dims Import off with nothing missing', () => {
    const m = buildSourcesModel(input({ rule: { importOff: true } }))
    expect(m.lines.find(l => l.key === 'import')).toMatchObject({ off: true, dim: true, mark: undefined })
  })

  it('leaves a greyed block line without a rate and a flowless one too', () => {
    const m = buildSourcesModel(input({ rows: [row('c1', 'Gone', undefined, { greyed: true, source: undefined }), row('c2', 'Fresh', undefined)] }))
    expect(rates(m)['block:c1']).toBeUndefined()
    expect(rates(m)['block:c2']).toBeUndefined()
    const gone = m.lines.find(l => l.key === 'block:c1')!
    expect(gone).toMatchObject({ off: true, label: '(deleted block)' })
  })

  it('marks a limited block line', () => {
    const limited = row('c1', 'Cheap', 20, { flow: flow('c1', 20, 'limited') })
    const m = buildSourcesModel(input({ rows: [limited] }))
    expect(m.lines.find(l => l.key === 'block:c1')).toMatchObject({ mark: 'limited', look: { kind: 'block', color: '#ff0000', limited: true } })
  })

  it('lists the bar parts in list order with their looks', () => {
    const m = buildSourcesModel(input({ makers: [maker(30, true)], rows: [row('c1', 'Cheap', 20)], unsatisfied: 10 }))
    expect(m.bar.map(p => [p.key, p.rate])).toEqual([['made-here', 30], ['make-here', 40], ['block:c1', 20], ['import', 10]])
    expect(m.bar.find(p => p.key === 'block:c1')).toMatchObject({ label: 'Cheap', look: { kind: 'block' } })
    expect(m.bar.find(p => p.key === 'made-here')?.look).toEqual({ kind: 'made' })
  })

  it('marks a line that nothing makes as idle', () => {
    const m = buildSourcesModel(input({ result: solve([node('n', 0)]) }))
    expect(m.lines.find(l => l.key === 'made-here')?.mark).toBe('idle')
    expect(m.lines.find(l => l.key === 'make-here')?.mark).toBe('idle')
    const dedicated = buildSourcesModel(input({ makers: [maker(0, false)] }))
    expect(dedicated.lines.find(l => l.key === 'make-here')?.mark).toBeUndefined()
  })

  describe('at area scope', () => {
    const block = makeEmptyBlock('B')
    block.rootPlan = { ...makeEmptySubPlan('Main'), nodes: [makeRecipeNode('smelt')], subPlans: [{ ...makeEmptySubPlan('M1'), area: true, nodes: [makeRecipeNode('smelt')] }] }
    const areaId = block.rootPlan.subPlans[0].id
    const areaNode = block.rootPlan.subPlans[0].nodes[0].id
    const result = solve([node(block.rootPlan.nodes[0].id, 500), node(areaNode, 60)])
    const supply = { imported: 0, missing: 0, reaches: 30 }
    const order = sourcesLineOrder(undefined, true, 'above', ['other'])

    it('reads the need of the area rows and shares what reaches the area between the block lines', () => {
      const rows = [row('c1', 'Cheap', 60), row('c2', 'Dear', 20)]
      const m = buildSourcesModel({
        ...input({ block, result, area: areaId, rows, supply, order }),
        suppliers: [{ areaId: 'other', name: 'Line O', routed: 12, off: false }],
      })
      expect(m.need).toBe(60)
      expect(rates(m)).toMatchObject({ 'block:c1': 22.5, 'block:c2': 7.5, 'area:other': 12, import: 0 })
      expect(rates(m)['made-here']! + rates(m)['make-here']!).toBeCloseTo(18)
    })

    it('shows zero for block lines when nothing reaches, and nothing for an off area line', () => {
      const m = buildSourcesModel({
        ...input({ block, result, area: areaId, rows: [row('c1', 'Cheap', 0)], supply: { imported: 0, missing: 0, reaches: 0 }, order }),
        suppliers: [{ areaId: 'other', name: 'Line O', routed: 0, off: true }],
      })
      expect(rates(m)['block:c1']).toBe(0)
      expect(m.lines.find(l => l.key === 'area:other')).toMatchObject({ rate: undefined, off: true, dim: true, mark: undefined })
    })

    it('marks an area that is on but sends nothing as idle', () => {
      const m = buildSourcesModel({
        ...input({ block, result, area: areaId, supply, order }),
        suppliers: [{ areaId: 'other', name: 'Line O', routed: 0, off: false }],
      })
      expect(m.lines.find(l => l.key === 'area:other')?.mark).toBe('idle')
    })

    it('reads the area own import figures', () => {
      const m = buildSourcesModel(input({ block, result, area: areaId, supply: { imported: 5, missing: 0, reaches: 0 }, order: sourcesLineOrder(undefined, true, 'above') }))
      expect(rates(m).import).toBe(5)
    })
  })
})

describe('altMoveTarget', () => {
  const ctx = { connectionIds: ['a', 'b', 'c'], makeHere: undefined } as const
  it('moves a block line within its group', () => {
    expect(altMoveTarget('block:b', -1, ctx)).toEqual({ type: 'connection', connectionId: 'b', delta: -1 })
    expect(altMoveTarget('block:b', 1, ctx)).toEqual({ type: 'connection', connectionId: 'b', delta: 1 })
  })
  it('stops at the first and last connection', () => {
    expect(altMoveTarget('block:a', -1, ctx)).toBeNull()
    expect(altMoveTarget('block:c', 1, ctx)).toBeNull()
  })
  it('moves Make more here to the other side', () => {
    expect(altMoveTarget('make-here', 1, ctx)).toEqual({ type: 'make-more', side: 'below' })
    expect(altMoveTarget('make-here', -1, ctx)).toBeNull()
    expect(altMoveTarget('make-here', -1, { ...ctx, makeHere: 'after-blocks' })).toEqual({ type: 'make-more', side: 'above' })
    expect(altMoveTarget('make-here', 1, { ...ctx, makeHere: 'after-blocks' })).toBeNull()
  })
  it('does not move Make more here while it is off, nor any other line', () => {
    expect(altMoveTarget('make-here', 1, { ...ctx, makeHere: 'off' })).toBeNull()
    expect(altMoveTarget('import', 1, ctx)).toBeNull()
    expect(altMoveTarget('made-here', -1, ctx)).toBeNull()
  })
})
