import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { applyWhatIf, findBlock, formatReport, inspectPlan } from './inspect'
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
