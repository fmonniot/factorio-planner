import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { applyWhatIf, findBlock, formatReport, inspectPlan, servedReportOf, type InspectReport } from './inspect'
import type { Block, MultiBlockSolve, ServedEntry } from '../data/types'
import { loadAppStateFromJson, loadGameDataFromJson } from '../data/loader'

// Runs on the committed Seablock export and the Extra Sulfur block saved with the
// surplus-aware-objective initiative: the heavy-mud / hydrogen-sulfide route that block solves to.

const gameData = loadGameDataFromJson(
  readFileSync(resolve(import.meta.dirname, '../../public/data/kompetenz-seablock/game-data.json'), 'utf-8'),
)
const planJson = readFileSync(
  resolve(import.meta.dirname, '../../initiatives/surplus-aware-objective/extra-sulfur.plan.json'),
  'utf-8',
)

function plan() {
  return loadAppStateFromJson(planJson)
}

describe('inspectPlan', () => {
  it('reports the rows, the left-over heavy mud and the imports of the block', () => {
    const report = inspectPlan(plan(), gameData, 'Extra Sulfur')
    expect(report.error).toBeUndefined()
    expect(report.rows.filter(r => r.throughput > 1e-6).map(r => r.recipeId).sort()).toEqual([
      'angels-solid-sulfur',
      'angels-water-heavy-mud',
    ])
    const mud = report.items.find(i => i.itemId === 'angels-water-heavy-mud')
    expect(mud?.net, 'heavy mud has no consumer').toBeCloseTo(12_000_000, -2)
    expect(report.items.find(i => i.itemId === 'sulfur')).toMatchObject({ isProduct: true })
    expect(report.unsatisfied.map(u => u.itemId)).toContain('angels-water-viscous-mud')
    expect(report.warnings.map(w => w.type)).toEqual(['overconstrained', 'coproduct-driven'])
    expect(report.totals.executions).toBeCloseTo(62_000, 0)
  })

  it('finds a block by id, name or name ignoring case, and lists the names when it is unknown', () => {
    const state = plan()
    const block = state.blocks[0]
    expect(findBlock(state, block.id)).toBe(block)
    expect(findBlock(state, block.name.toUpperCase())).toBe(block)
    expect(() => findBlock(state, 'nope')).toThrow(`Blocks: ${block.name}`)
  })

  it('drops a recipe and the solver falls back to the lime loop', () => {
    const report = inspectPlan(plan(), gameData, 'Extra Sulfur', { drop: ['angels-solid-sulfur'] })
    expect(report.rows.find(r => r.recipeId === 'angels-yellow-waste-water-purification')?.throughput).toBeCloseTo(6000, 0)
    expect(report.items.find(i => i.itemId === 'angels-water-heavy-mud')?.net ?? 0).toBeLessThan(1)
  })

  it('does not modify the plan it is given', () => {
    const state = plan()
    const before = JSON.stringify(state)
    applyWhatIf(state, state.blocks[0].id, { pins: { 'angels-solid-sulfur': 1 }, drop: ['angels-water-heavy-mud'], noArea: true })
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects an unknown sourcing value instead of guessing', () => {
    const state = plan()
    expect(() => applyWhatIf(state, state.blocks[0].id, { sourcing: { sulfur: 'conections-first' as never } })).toThrow(/expected/)
  })

  it('pins a recipe and sets item sourcing on the block only', () => {
    const state = plan()
    const next = applyWhatIf(state, state.blocks[0].id, { pins: { 'angels-solid-sulfur': 1 }, sourcing: { sulfur: 'byproducts-first' } })
    expect(next.blocks[0].sourceRules).toEqual({ sulfur: { makeHere: 'off' } })
    expect(next.blocks[0].rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'angels-solid-sulfur')).toMatchObject({
      pinnedRate: 1,
    })
  })

  it('formats a report with its sections', () => {
    const text = formatReport(inspectPlan(plan(), gameData, 'Extra Sulfur'))
    expect(text).toContain('Block "Extra Sulfur"')
    expect(text).toContain('angels-water-heavy-mud')
    expect(text).toContain('sulfur [product]')
    expect(text).toContain('Imports')
    expect(text).toContain('coproduct-driven')
  })
})

describe('servedReportOf', () => {
  const blk = (id: string, opts: { from?: string; list?: ServedEntry[]; extra?: number } = {}): Block =>
    ({
      id, name: `Block ${id}`, color: '#60a5fa',
      products: opts.extra !== undefined ? [{ id: 'p0', itemId: 'plate', extraRate: opts.extra }] : [],
      sourceRules: {},
      inputConnections: opts.from ? [{ id: `c-${id}`, itemId: 'plate', fromBlockId: opts.from }] : [],
      ...(opts.list ? { servedOrder: { plate: opts.list } } : {}),
      rootPlan: { id: `root-${id}`, name: 'root', nodes: [], subPlans: [] },
    }) as unknown as Block
  const consumer = (id: string, share: number, got: number) => ({ blockId: id, connectionId: `c-${id}`, kind: 'request' as const, share, got })
  const served = (consumers: ReturnType<typeof consumer>[], extra?: { place: number; asked: number; got: number }): MultiBlockSolve['served'] => ({
    A: { plate: { consumers, ...(extra ? { extra } : {}) } },
  })

  it('ranks the lines, groups the tied ones and marks what the list does not name', () => {
    const list: ServedEntry[] = [{ kind: 'block', blockId: 'B' }, { kind: 'block', blockId: 'C', share: 80 }, { kind: 'block', blockId: 'D', tied: true, share: 20 }]
    const blocks = [blk('A', { list, extra: 10 }), blk('B', { from: 'A' }), blk('C', { from: 'A' }), blk('D', { from: 'A' }), blk('E', { from: 'A' })]
    const [item] = servedReportOf(blocks, 'A', served(
      [consumer('B', 30, 30), consumer('C', 20, 12), consumer('D', 10, 3), consumer('E', 5, 0)],
      { place: 3, asked: 10, got: 0 },
    ))
    expect(item.ranked).toBe(true)
    expect(item.lines.map(l => [l.name, l.rank, l.listed])).toEqual([
      ['Block B', 1, true], ['Block C', 2, true], ['Block D', 2, true], ['extra output', 3, false], ['Block E', 4, false],
    ])
    expect(item.lines[0].group).toBeUndefined()
    expect(item.lines[1].group).toEqual({ size: 2, percent: 80 })
    expect(item.lines[2].group).toEqual({ size: 2, percent: 20 })
    expect(item.lines[3]).toMatchObject({ kind: 'extra', share: 10, got: 0 })
    expect(item.lines[3]).not.toHaveProperty('blockId')
  })

  it('ranks an item with no list from 1 and says so', () => {
    const blocks = [blk('A'), blk('B', { from: 'A' }), blk('C', { from: 'A' })]
    const [item] = servedReportOf(blocks, 'A', served([consumer('B', 30, 30), consumer('C', 20, 15)]))
    expect(item.ranked).toBe(false)
    expect(item.lines.map(l => [l.rank, l.listed])).toEqual([[1, false], [2, false]])
  })
})

describe('formatReport served lists', () => {
  it('prints groups, lines the list does not name and the unranked header', () => {
    const report: InspectReport = {
      block: { id: 'A', name: 'A' }, rows: [], items: [], unsatisfied: [], warnings: [], flows: [], areaRoutes: [],
      totals: { executions: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 },
      served: [
        { itemId: 'plate', ranked: true, lines: [
          { rank: 1, name: 'B', blockId: 'B', kind: 'request', listed: true, share: 30, got: 30 },
          { rank: 2, name: 'C', blockId: 'C', kind: 'request', group: { size: 2, percent: 80 }, listed: true, share: 20, got: 12 },
          { rank: 3, name: 'E', blockId: 'E', kind: 'request', listed: false, share: 5, got: 0 },
        ] },
        { itemId: 'gear', ranked: false, lines: [{ rank: 1, name: 'B', blockId: 'B', kind: 'take', listed: false, share: 4, got: 4 }] },
      ],
    }
    const text = formatReport(report)
    expect(text).toContain('Served lists')
    expect(text).toContain('[group of 2, 80.00%]')
    expect(text).toContain('(not in the list)')
    expect(text).toContain('(no list: solve order)')
    expect(text).toContain('plate  (list)')
  })
})
