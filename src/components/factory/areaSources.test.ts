import { describe, it, expect } from 'vitest'
import { areaSupply, routedFrom, supplierLines } from './areaSources'
import { makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import type { AreaRoute, Block, GameData, SolverResult } from '../../data/types'

const out = (to: string, rate: number, supplied?: number): AreaRoute => ({ itemId: 'ore', to, rate, ...(supplied !== undefined ? { supplied } : {}) })
const between = (from: string, to: string, rate: number): AreaRoute => ({ itemId: 'ore', from, to, rate })

describe('areaSupply', () => {
  it('reads a split item from the supplied part of the outside leg', () => {
    expect(areaSupply([out('L', 12, 12)], 'ore', 'L', {}, 0, true)).toEqual({ imported: 0, missing: 0, reaches: 12 })
    expect(areaSupply([out('L', 12, 5)], 'ore', 'L', {}, 0, true)).toEqual({ imported: 7, missing: 0, reaches: 5 })
    expect(areaSupply([out('L', 12, 5)], 'ore', 'L', { importOff: true }, 0, true)).toEqual({ imported: 0, missing: 7, reaches: 5 })
  })

  it('reads an item one area touches from the block\'s unsatisfied rate', () => {
    expect(areaSupply([out('L', 20)], 'ore', 'L', {}, 8, false)).toEqual({ imported: 8, missing: 0, reaches: 12 })
    expect(areaSupply([out('L', 20)], 'ore', 'L', { importOff: true }, 8, false)).toEqual({ imported: 0, missing: 8, reaches: 12 })
    expect(areaSupply([out('L', 20)], 'ore', 'L', {}, 50, false)).toEqual({ imported: 20, missing: 0, reaches: 0 })
  })

  it('reads a split item whose legs carry no supplied part as split (none connected: all imported, or missing)', () => {
    expect(areaSupply([out('L', 12), out('M', 5, 5)], 'ore', 'L', {}, 3, true)).toEqual({ imported: 12, missing: 0, reaches: 0 })
    expect(areaSupply([out('L', 12), out('M', 5, 5)], 'ore', 'L', { importOff: true }, 3, true)).toEqual({ imported: 0, missing: 12, reaches: 0 })
  })

  it('is zero without a leg into the area', () => {
    const none = { imported: 0, missing: 0, reaches: 0 }
    expect(areaSupply(undefined, 'ore', 'L', {}, 5, false)).toEqual(none)
    expect(areaSupply([out('M', 12, 12), between('M', 'L', 3)], 'ore', 'L', {}, 5, false)).toEqual(none)
    expect(areaSupply([{ ...out('L', 9), itemId: 'other' }], 'ore', 'L', {}, 5, false)).toEqual(none)
  })
})

describe('routedFrom', () => {
  it('sums the legs from one area to another only', () => {
    const routes = [between('M1', 'L', 5), between('M1', 'L', 2), between('M2', 'L', 4), between('M1', 'M2', 9), out('L', 3)]
    expect(routedFrom(routes, 'ore', 'M1', 'L')).toBe(7)
    expect(routedFrom(routes, 'ore', 'L', 'M1')).toBe(0)
    expect(routedFrom(undefined, 'ore', 'M1', 'L')).toBe(0)
  })
})

describe('supplierLines', () => {
  const gameData = {
    items: { ore: { id: 'ore', name: 'Ore' } },
    recipes: {
      synth: { id: 'synth', name: 'Synth', category: 'crafting', craftingTime: 1, ingredients: [], products: [{ itemId: 'ore', type: 'item', amount: 1 }], madeIn: [], mainProduct: 'ore' },
      other: { id: 'other', name: 'Other', category: 'crafting', craftingTime: 1, ingredients: [], products: [{ itemId: 'x', type: 'item', amount: 1 }], madeIn: [], mainProduct: 'x' },
    },
    machines: {}, defaultMachines: {},
  } as unknown as GameData
  const sub = (id: string, recipe?: string) => ({
    id, name: `Line ${id}`, nodes: recipe ? [makeRecipeNode(recipe)] : [], subPlans: [], area: true as const, createdAt: '', updatedAt: '',
  })
  function block(): Block {
    const b = makeEmptyBlock('B')
    b.rootPlan.subPlans = [sub('L', 'other'), sub('M1', 'synth'), sub('M2', 'other'), sub('M3', 'other'), sub('M4', 'synth')]
    return b
  }
  const solved = (areaRoutes: AreaRoute[]) => ({ areaRoutes }) as unknown as SolverResult

  it('lists the other areas that make the item, in table order, and not the area itself', () => {
    expect(supplierLines(block(), gameData, undefined, 'ore', 'L', {}).map(l => [l.areaId, l.name, l.routed, l.off])).toEqual([
      ['M1', 'Line M1', 0, false],
      ['M4', 'Line M4', 0, false],
    ])
    expect(supplierLines(block(), gameData, undefined, 'ore', 'M1', {}).map(l => l.areaId)).toEqual(['M4'])
  })

  it('keeps an area switched off in the list, and one that only relays', () => {
    const lines = supplierLines(block(), gameData, solved([between('M2', 'L', 6), between('M1', 'L', 4)]), 'ore', 'L', { areasOff: ['M3'] })
    expect(lines.map(l => [l.areaId, l.routed, l.off])).toEqual([['M1', 4, false], ['M2', 6, false], ['M3', 0, true], ['M4', 0, false]])
  })
})
