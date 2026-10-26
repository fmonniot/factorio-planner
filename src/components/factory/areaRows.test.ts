import { describe, it, expect } from 'vitest'
import { areaName, areaRows, ROOT_AREA_LABEL } from './areaRows'
import type { SolvedArea, SubPlan } from '../../data/types'

function plan(id: string, name: string, subPlans: SubPlan[] = []): SubPlan {
  return { id, name, nodes: [], subPlans, createdAt: '', updatedAt: '' }
}

const root = plan('root', 'Main', [plan('a', 'Plastics', [plan('b', 'Deep')])])

describe('areaName', () => {
  it('calls the root "Top level", whatever its own name', () => {
    expect(ROOT_AREA_LABEL).toBe('Top level')
    expect(areaName(root, 'root')).toBe('Top level')
  })

  it('uses the sub-factory name, nested ones included', () => {
    expect(areaName(root, 'a')).toBe('Plastics')
    expect(areaName(root, 'b')).toBe('Deep')
  })

  it('falls back to the id for an area that is gone', () => {
    expect(areaName(root, 'gone')).toBe('gone')
  })
})

describe('areaRows', () => {
  const flow = { itemId: 'water', rate: 10, boundary: true }
  const areas: SolvedArea[] = [
    { areaId: 'root', receives: [], sends: [flow] },
    { areaId: 'b', receives: [flow], sends: [] },
    { areaId: 'gone', receives: [], sends: [] },
  ]

  it('keeps the solver order and names every area', () => {
    const rows = areaRows(root, areas)
    expect(rows.map(r => r.areaId)).toEqual(['root', 'b', 'gone'])
    expect(rows.map(r => r.name)).toEqual(['Top level', 'Deep', 'gone'])
    expect(rows.map(r => r.isRoot)).toEqual([true, false, false])
    expect(rows[1].receives).toEqual([flow])
  })
})
