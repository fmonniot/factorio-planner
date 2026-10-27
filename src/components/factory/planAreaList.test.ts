import { describe, it, expect } from 'vitest'
import { filterPlanAreas, planAreaBlocks } from './planAreaList'
import type { Block, GameData, SolvedArea, SolverResult, SubPlan } from '../../data/types'

function plan(id: string, name: string, nodes: SubPlan['nodes'] = [], subPlans: SubPlan[] = []): SubPlan {
  return { id, name, nodes, subPlans, createdAt: '', updatedAt: '' }
}
const handle = (id: string, subPlanId: string): SubPlan['nodes'][number] => ({ kind: 'subplan', id, subPlanId })

function block(id: string, name: string, rootPlan: SubPlan): Block {
  return {
    id, name, color: '#123456', products: [], noImportItems: [], connectionsFirstItems: [], inputConnections: [], rootPlan,
  }
}
const result = (areas?: SolvedArea[]): SolverResult => ({ nodes: [], unsatisfied: [], warnings: [], ...(areas ? { areas } : {}) })
const flow = (itemId: string) => ({ itemId, rate: 10, boundary: false })

// A: root + "Plastics" (handle h-p); B: no areas; C: root + "Plastics" (handle h-c); D: no result.
const blocks = (): Block[] => [
  block('A', 'Alpha', plan('rA', 'Main', [handle('h-p', 'pA')], [plan('pA', 'Plastics')])),
  block('B', 'Bravo', plan('rB', 'Main')),
  block('C', 'Charlie', plan('rC', 'Main', [handle('h-c', 'pC')], [plan('pC', 'Plastics')])),
  block('D', 'Delta', plan('rD', 'Main')),
]
const results = (): Record<string, SolverResult> => ({
  A: result([{ areaId: 'rA', receives: [], sends: [flow('h2')] }, { areaId: 'pA', receives: [flow('h2')], sends: [] }]),
  B: result(),
  C: result([{ areaId: 'rC', receives: [], sends: [] }, { areaId: 'pC', receives: [flow('o2')], sends: [] }]),
})
const items = { h2: { name: 'Hydrogen' } } as unknown as GameData['items']

describe('planAreaBlocks', () => {
  it('lists the blocks that have areas, in tab order, one row per area and block', () => {
    const list = planAreaBlocks(blocks(), results())
    expect(list.map(b => b.blockId)).toEqual(['A', 'C'])
    expect(list[0].rows.map(r => ({ name: r.name, isRoot: r.isRoot, handleNodeId: r.handleNodeId }))).toEqual([
      { name: 'Top level', isRoot: true, handleNodeId: undefined },
      { name: 'Plastics', isRoot: false, handleNodeId: 'h-p' },
    ])
    expect(list[1].rows[1]).toMatchObject({ name: 'Plastics', blockId: 'C', handleNodeId: 'h-c' })
  })

  it('finds the handle of an area nested in an organising sub-factory', () => {
    const root = plan('r', 'Main', [handle('h-org', 'org')], [plan('org', 'Organising', [handle('h-in', 'in')], [plan('in', 'Inner')])])
    const list = planAreaBlocks([block('X', 'X', root)], {
      X: result([{ areaId: 'r', receives: [], sends: [] }, { areaId: 'in', receives: [], sends: [] }]),
    })
    expect(list[0].rows[1].handleNodeId).toBe('h-in')
  })
})

describe('filterPlanAreas', () => {
  it('returns the list as is for an empty query', () => {
    const list = planAreaBlocks(blocks(), results())
    expect(filterPlanAreas(list, '  ', items)).toBe(list)
  })

  it('matches area names, case-insensitively, per block', () => {
    const out = filterPlanAreas(planAreaBlocks(blocks(), results()), 'PLAST', items)
    expect(out.map(b => b.rows.map(r => r.name))).toEqual([['Plastics'], ['Plastics']])
  })

  it('keeps every row of a block whose name matches', () => {
    const out = filterPlanAreas(planAreaBlocks(blocks(), results()), 'alpha', items)
    expect(out.map(b => b.blockId)).toEqual(['A'])
    expect(out[0].rows).toHaveLength(2)
  })

  it('matches the names of received and sent items', () => {
    const out = filterPlanAreas(planAreaBlocks(blocks(), results()), 'hydro', items)
    expect(out).toHaveLength(1)
    expect(out[0].rows.map(r => r.name)).toEqual(['Top level', 'Plastics'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterPlanAreas(planAreaBlocks(blocks(), results()), 'zzz', items)).toEqual([])
  })
})
