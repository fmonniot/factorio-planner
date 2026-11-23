import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildBlockMatrix, cellTintPercent, matrixOrderOf } from './matrixCells'
import type { MatrixPair } from './matrixCells'
import { layoutBlockGraph } from '../../utils/blockGraphLayout'
import { makeEmptyBlock } from '../../store/blockStore'
import type { EdgeStatus } from './graphConnection'
import type { Block } from '../../data/types'

const pair = (from: string, to: string, ids: string[], loop = false): MatrixPair => ({ from, to, connectionIds: ids, loop })
const ok = () => 'ok' as EdgeStatus

describe('buildBlockMatrix', () => {
  const pairs = [pair('A', 'B', ['1', '2']), pair('B', 'C', ['3']), pair('A', 'C', ['4'])]

  it('places a cell per pair, rows supplying and columns receiving', () => {
    const m = buildBlockMatrix(['A', 'B', 'C'], pairs, ok)
    expect(m.cells.map(c => [c.row, c.col, c.count])).toEqual([[0, 1, 2], [0, 2, 1], [1, 2, 1]])
    expect(m.cellAt(0, 1)?.key).toBe('A>B')
    expect(m.cellAt(1, 0)).toBeUndefined()
    expect(m.supplies).toEqual([2, 1, 0])
    expect(m.receives).toEqual([0, 1, 2])
    expect(m.backCount).toBe(0)
    expect(m.filled).toBe(3)
  })

  it('marks every cell below the diagonal in the reverse order, without calling them loops', () => {
    const m = buildBlockMatrix(['C', 'B', 'A'], pairs, ok)
    expect(m.cells.every(c => c.back && !c.loop)).toBe(true)
    expect(m.backCount).toBe(3)
  })

  it('keeps the solver loop apart from the below-the-diagonal hatching', () => {
    const m = buildBlockMatrix(['A', 'B'], [pair('A', 'B', ['1'], true), pair('B', 'A', ['2'], true)], ok)
    expect(m.cellAt(1, 0)).toMatchObject({ back: true, loop: true })
    expect(m.cellAt(0, 1)).toMatchObject({ back: false, loop: true })
    expect(m.loopCount).toBe(2)
  })

  it('derives the status of a cell from its connections', () => {
    const status = (map: Record<string, EdgeStatus>) => (id: string) => map[id] ?? 'pending'
    const one = (ids: string[], map: Record<string, EdgeStatus>) =>
      buildBlockMatrix(['A', 'B'], [pair('A', 'B', ids)], status(map)).cells[0]
    expect(one(['1', '2'], { 1: 'ok', 2: 'limited' })).toMatchObject({ status: 'limited', limited: 1 })
    expect(one(['1', '2'], { 1: 'unused', 2: 'unused' })).toMatchObject({ allUnused: true, unused: 2 })
    expect(one(['1', '2'], { 1: 'unused', 2: 'ok' })).toMatchObject({ status: 'ok', allUnused: false })
    expect(one(['1'], {})).toMatchObject({ status: 'pending', allUnused: false })
  })

  it('skips a pair with an unknown block and a self pair', () => {
    const m = buildBlockMatrix(['A', 'B'], [pair('A', 'X', ['1']), pair('A', 'A', ['2']), pair('A', 'B', ['3'])], ok)
    expect(m.cells.map(c => c.key)).toEqual(['A>B'])
  })

  it('counts nothing for an isolated block', () => {
    const m = buildBlockMatrix(['A', 'B', 'Z'], [pair('A', 'B', ['1'])], ok)
    expect(m.supplies[2]).toBe(0)
    expect(m.receives[2]).toBe(0)
    expect(m.cells.some(c => c.row === 2 || c.col === 2)).toBe(false)
  })
})

describe('matrixOrderOf', () => {
  const blocks = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]

  it('plan order is the tabs', () => {
    expect(matrixOrderOf('plan', blocks, ['C', 'B', 'A'])).toEqual(['A', 'B', 'C'])
  })

  it('dependency order is the layout order, dropping unknown ids and appending missing blocks', () => {
    expect(matrixOrderOf('dependency', blocks, ['C', 'X', 'A'])).toEqual(['C', 'A', 'B'])
  })
})

describe('cellTintPercent', () => {
  it('is at least 15, grows with the count and stops at 14 items', () => {
    expect(cellTintPercent(1)).toBeGreaterThanOrEqual(15)
    expect(cellTintPercent(2)).toBeGreaterThan(cellTintPercent(1))
    expect(cellTintPercent(14)).toBe(45)
    expect(cellTintPercent(15)).toBe(cellTintPercent(14))
  })
})

describe('the 15-block real plan', () => {
  const FIXTURE = 'initiatives/archive/block-graph-scale/real-plan.layout.json'
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    blocks: { id: string; name: string; connections: { id: string; itemId: string; fromBlockId: string }[] }[]
  }
  const blocks: Block[] = fixture.blocks.map(b => ({
    ...makeEmptyBlock(b.name),
    id: b.id,
    inputConnections: b.connections.map(c => ({ ...c })),
  }))
  const layout = layoutBlockGraph(blocks)
  const order = matrixOrderOf('dependency', blocks, layout.order)
  const m = buildBlockMatrix(order, layout.edges, ok)

  it('fills 46 cells of 15 x 15 carrying the 140 connections', () => {
    expect(order).toHaveLength(15)
    expect(m.cells).toHaveLength(46)
    expect(m.cells.length).toBe(layout.edges.length)
    expect(m.cells.reduce((n, c) => n + c.count, 0)).toBe(140)
    expect(m.supplies.reduce((a, b) => a + b, 0)).toBe(46)
    expect(m.receives.reduce((a, b) => a + b, 0)).toBe(46)
  })

  it('has at most 6 cells below the diagonal in dependency order, each a loop cell', () => {
    expect(m.backCount).toBeLessThanOrEqual(6)
    const pos = new Map(order.map((id, i) => [id, i]))
    for (const c of m.cells.filter(c => c.back)) {
      expect(pos.get(c.from)!).toBeGreaterThan(pos.get(c.to)!)
      expect(c.loop, `${c.key} is a loop`).toBe(true)
    }
  })
})
