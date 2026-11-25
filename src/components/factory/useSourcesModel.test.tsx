import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBlockSourcesModel, useSourcesModel } from './useSourcesModel'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, SolverResult, SubPlan } from '../../data/types'

// Two blocks, each with a Smelt row making Plate from Ore (the other also in two areas, L and B); their solves differ in the ore they take.
function gameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false },
      ore: { id: 'ore', name: 'Ore', type: 'item', iconPath: '', hidden: false },
    },
    recipes: {
      smelt: {
        id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
        ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
        products: [{ itemId: 'plate', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'plate',
      },
    },
    machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

const NOW = '2026-01-01T00:00:00.000Z'
const area = (id: string): SubPlan => ({ id, name: `Line ${id}`, nodes: [makeRecipeNode('smelt')], subPlans: [], area: true, createdAt: NOW, updatedAt: NOW })

const result = (nodeId: string, plate: number): SolverResult =>
  ({ nodes: [{ recipeNodeId: nodeId, inputRates: { plate }, outputRates: {} }], unsatisfied: [] } as unknown as SolverResult)

function setup() {
  const mainNode = makeRecipeNode('smelt')
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', sourceRules: {} }
  main.rootPlan = { ...main.rootPlan, nodes: [mainNode] }
  const other: Block = { ...makeEmptyBlock('Other'), id: 'other', sourceRules: {} }
  other.rootPlan = { ...other.rootPlan, nodes: [], subPlans: [area('L'), area('B')] }
  useBlockStore.setState({ blocks: [main, other], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min', sourcesSides: {} })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({
    status: { type: 'idle' }, lastResult: undefined, flows: [], _setStatus: () => {},
    lastResults: { main: result(mainNode.id, 30), other: result(other.rootPlan.subPlans[0].nodes[0].id, 90) },
  })
  return { main, other }
}

const activate = (id: string) => act(() => useBlockStore.setState({ activeBlockId: id }))
/** The model's data, without the rate formatter (a new function every render). */
const data = (v: ReturnType<typeof useBlockSourcesModel>) => {
  return { ...v!, rate: undefined }
}

describe('useBlockSourcesModel', () => {
  let other: Block
  beforeEach(() => { other = setup().other })

  it('reads the model of any block, the same as the active hook does once that block is active', () => {
    const generic = renderHook(() => useBlockSourcesModel(other, 'plate', undefined))
    const before = generic.result.current!
    activate('other')
    const active = renderHook(() => useSourcesModel('plate', undefined))
    const a = active.result.current!
    expect(data(generic.result.current)).toEqual(data(a))
    expect(before.model).toEqual(a.model)
    for (const k of ['makers', 'rows', 'suppliers', 'order', 'lastSide', 'unsatisfied', 'supply'] as const) expect(before[k], k).toEqual(a[k])
  })

  it('reads that block, not the active one', () => {
    const generic = renderHook(() => useBlockSourcesModel(other, 'plate', undefined))
    const active = renderHook(() => useSourcesModel('plate', undefined))
    expect(generic.result.current!.model.need).toBe(90)
    expect(active.result.current!.model.need).toBe(30)
  })

  it('lists the other areas at area scope, as the active hook does', () => {
    const generic = renderHook(() => useBlockSourcesModel(other, 'plate', 'L'))
    expect(generic.result.current!.suppliers.map(s => s.areaId)).toEqual(['B'])
    activate('other')
    const active = renderHook(() => useSourcesModel('plate', 'L'))
    expect(generic.result.current!.suppliers).toEqual(active.result.current!.suppliers)
  })

  it('falls back to the block when the area flag went off', () => {
    const v = renderHook(() => useBlockSourcesModel(other, 'plate', 'gone')).result.current!
    expect(v.area).toBeUndefined()
  })

  it('does not remember the side unless asked to', () => {
    renderHook(() => useBlockSourcesModel(other, 'plate', undefined))
    expect(useUiStore.getState().sourcesSides).toEqual({})
  })

  it('has no model without a block', () => {
    expect(renderHook(() => useBlockSourcesModel(undefined, 'plate', undefined)).result.current).toBeUndefined()
  })
})

describe('useSourcesModel', () => {
  beforeEach(() => { setup() })

  it('reads the active block and remembers where Make more here is drawn', () => {
    const v = renderHook(() => useSourcesModel('plate', undefined)).result.current!
    expect(v.block.id).toBe('main')
    expect(v.model.need).toBe(30)
    expect(useUiStore.getState().sourcesSides['main:plate']).toBe('above')
  })

  it('returns nothing when disabled, and still remembers the side', () => {
    const v = renderHook(() => useSourcesModel('plate', undefined, false)).result.current
    expect(v).toBeUndefined()
    expect(useUiStore.getState().sourcesSides['main:plate']).toBe('above')
  })
})
