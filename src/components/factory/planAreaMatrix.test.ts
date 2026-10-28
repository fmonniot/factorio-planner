import { describe, it, expect } from 'vitest'
import { planMatrix, primaryAreas } from './planAreaMatrix'
import { makeEmptyBlock } from '../../store/blockStore'
import type { Block, ConnectionFlow, GameData, SolvedNode, SolverResult, SubPlan } from '../../data/types'

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: { x: { id: 'x', name: 'X', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '' } },
    recipes: {}, machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
    itemGroups: {}, itemSubgroups: {},
  } as unknown as GameData
}

function plan(id: string, subPlans: SubPlan[] = []): SubPlan {
  return { id, name: id, nodes: [], subPlans, createdAt: '', updatedAt: '' }
}
function block(id: string, name: string, subPlans: SubPlan[] = []): Block {
  return { ...makeEmptyBlock(name), id, color: '#abcdef', rootPlan: plan(`${id}-root`, subPlans) }
}
function node(out: Record<string, number>, inp: Record<string, number> = {}): SolvedNode {
  return { recipeNodeId: 'n', inputRates: inp, outputRates: out, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0 }
}
const f = (itemId: string, rate: number) => ({ itemId, rate, boundary: true })
function flow(over: Partial<ConnectionFlow>): ConnectionFlow {
  return {
    connectionId: 'c', fromBlockId: 'A', toBlockId: 'B', itemId: 'x', available: 30, capped: false, rate: 30,
    status: 'ok', kind: 'take', ...over,
  }
}

function setup() {
  const A = block('A', 'Alpha', [{ ...plan('A-p'), area: true }, { ...plan('A-q'), area: true }])
  const B = block('B', 'Bravo')
  const C = block('C', 'Charlie')
  const results: Record<string, SolverResult> = {
    A: {
      nodes: [node({ x: 50 })], unsatisfied: [], warnings: [],
      areas: [
        { areaId: 'A-root', receives: [], sends: [f('x', 50)] },
        { areaId: 'A-p', receives: [f('x', 20)], sends: [] },
        { areaId: 'A-q', receives: [f('x', 5)], sends: [] },
      ],
    },
    B: { nodes: [node({}, { x: 40 })], unsatisfied: [], warnings: [] },
    C: { nodes: [node({ y: 3 })], unsatisfied: [], warnings: [] },
  }
  return { blocks: [A, B, C], results }
}
const machines = new Set<string>()

describe('planMatrix', () => {
  it('computes not taken and not supplied from the nets and the delivered flow', () => {
    const { blocks, results } = setup()
    const m = planMatrix(blocks, results, [flow({})], makeGameData(), machines, { crossingOnly: false })
    const x = m.rows.find(r => r.itemId === 'x')!
    expect(x.net).toEqual({ A: 50, B: -40 })
    expect(x.delivered).toBe(30)
    expect(x.notTaken).toBe(20)
    expect(x.notSupplied).toBe(10)
    expect(x.total).toBe(50)
    expect(m.blocks.find(b => b.blockId === 'B')!.areas).toEqual([])
    expect(m.blocks.find(b => b.blockId === 'A')!.areas).toHaveLength(3)
  })

  it('keeps only crossing items and blocks with crossingOnly', () => {
    const { blocks, results } = setup()
    const m = planMatrix(blocks, results, [flow({})], makeGameData(), machines, { crossingOnly: true })
    expect(m.blocks.map(b => b.blockId)).toEqual(['A', 'B'])
    expect(m.rows.map(r => r.itemId)).toEqual(['x'])
  })

  it('counts every block in not taken and not supplied, whatever the crossing filter shows', () => {
    const { blocks, results } = setup()
    // C is no end of any flow, so it is hidden under crossingOnly, but its +600 is still not taken.
    results.C = { nodes: [node({ x: 600 })], unsatisfied: [], warnings: [] }
    const flows = [flow({})]
    const shown = planMatrix(blocks, results, flows, makeGameData(), machines, { crossingOnly: true })
    const all = planMatrix(blocks, results, flows, makeGameData(), machines, { crossingOnly: false })
    expect(shown.blocks.map(b => b.blockId)).toEqual(['A', 'B'])
    for (const m of [shown, all]) {
      const x = m.rows.find(r => r.itemId === 'x')!
      expect(x.notTaken).toBe(620)
      expect(x.notSupplied).toBe(10)
      expect(x.total).toBe(650)
    }
    expect(shown.rows.find(r => r.itemId === 'x')!.net).toEqual({ A: 50, B: -40 })
  })

  it('ignores missing-source, self and zero-rate flows', () => {
    const { blocks, results } = setup()
    const flows = [flow({ status: 'missing-source' }), flow({ status: 'self' }), flow({ rate: 0, status: 'unused' })]
    const m = planMatrix(blocks, results, flows, makeGameData(), machines, { crossingOnly: true })
    expect(m.rows).toEqual([])
    expect(m.blocks).toEqual([])
    const all = planMatrix(blocks, results, flows, makeGameData(), machines, { crossingOnly: false })
    expect(all.rows.find(r => r.itemId === 'x')!.delivered).toBe(0)
    expect(all.rows.find(r => r.itemId === 'x')!.notTaken).toBe(50)
  })

  it('shows every block with nodes and every moving item without crossingOnly', () => {
    const { blocks, results } = setup()
    const m = planMatrix(blocks, results, [flow({})], makeGameData(), machines, { crossingOnly: false })
    expect(m.blocks.map(b => b.blockId)).toEqual(['A', 'B', 'C'])
    expect(m.rows.map(r => r.itemId).sort()).toEqual(['x', 'y'])
  })

  it('sorts the primary areas by rate and keeps those that go the way of the net', () => {
    const { blocks, results } = setup()
    const m = planMatrix(blocks, results, [flow({})], makeGameData(), machines, { crossingOnly: false })
    const x = m.rows.find(r => r.itemId === 'x')!
    const a = m.blocks.find(b => b.blockId === 'A')!
    expect(primaryAreas(x, a).map(p => p.name)).toEqual(['Top level'])
    const flipped = { ...x, net: { A: -10 } }
    expect(primaryAreas(flipped, a).map(p => [p.name, p.rate])).toEqual([['A-p', -20], ['A-q', -5]])
  })

  it('can show a net that differs from the area cells when a byproduct is discarded', () => {
    const { blocks, results } = setup()
    // The nodes still produce 50 x, but the areas (after discard) only send 30.
    results.A.areas = [
      { areaId: 'A-root', receives: [], sends: [f('x', 30)] },
      { areaId: 'A-p', receives: [], sends: [] },
      { areaId: 'A-q', receives: [], sends: [] },
    ]
    const m = planMatrix(blocks, results, [], makeGameData(), machines, { crossingOnly: false })
    const x = m.rows.find(r => r.itemId === 'x')!
    expect(x.net.A).toBe(50)
    expect(Object.values(x.areaCells.A).reduce((a, b) => a + b, 0)).toBe(30)
  })
})
