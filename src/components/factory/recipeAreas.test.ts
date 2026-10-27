import { describe, it, expect } from 'vitest'
import {
  ancestorHandleIds,
  buildAlsoInOptions,
  countRecipeRows,
  goToRowOptions,
  indexRecipeAreas,
  multiAreaSummary,
  multiAreaTitle,
  presentRecipesFor,
  recipeAreaIds,
  recipeGroupRates,
  recipeGroups,
} from './recipeAreas'
import type { GameRecipeNode, RecipeNode, SolvedNode, SubPlan } from '../../data/types'

// Root holds an electrolysis row and the handles of three areas (P, F, C, in table order). P has
// its own electrolysis and an iron row, F an electrolysis, C an organising group G with an iron
// row. Fixtures are built fresh by each call.

function gameRow(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

function plan(id: string, name: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  return { id, name, nodes, subPlans, ...(area === undefined ? {} : { area }), createdAt: '', updatedAt: '' }
}

function handle(id: string, subPlanId: string): RecipeNode {
  return { kind: 'subplan', id, subPlanId }
}

function scenario(areas = true): SubPlan {
  const g = plan('G', 'Group', [gameRow('c-c', 'iron')])
  const c = plan('C', 'Chlorides', [handle('h-G', 'G')], [g], areas || undefined)
  const p = plan('P', 'Plastics', [gameRow('e-p', 'electrolysis'), gameRow('c-p', 'iron')], [], areas || undefined)
  const f = plan('F', 'Rocket fuel', [gameRow('e-f', 'electrolysis')], [], areas || undefined)
  return plan('root', 'Main', [gameRow('e-root', 'electrolysis'), handle('h-P', 'P'), handle('h-F', 'F'), handle('h-C', 'C')], [c, p, f])
}

function solvedNode(id: string, extra: Partial<SolvedNode> = {}): SolvedNode {
  return {
    recipeNodeId: id, inputRates: {}, outputRates: {}, throughput: 0,
    machineCountExact: 0, machineCountCeil: 0, powerKw: 0, ...extra,
  }
}

function solved(): Map<string, SolvedNode> {
  return new Map([
    ['e-root', solvedNode('e-root', { machineCountCeil: 5, machineCountExact: 4.6 })],
    ['e-p', solvedNode('e-p', { machineCountCeil: 5, machineCountExact: 4.2 })],
    ['e-f', solvedNode('e-f', { machineCountCeil: 5, machineCountExact: 4.8 })],
    ['c-c', solvedNode('c-c', { inputRates: { hydrogen: 45 } })],
    ['c-p', solvedNode('c-p', { inputRates: { hydrogen: 30 } })],
  ])
}

describe('indexRecipeAreas', () => {
  it('lists the rows of a recipe in table order, whatever the sub-plans order', () => {
    const idx = indexRecipeAreas(scenario())
    expect(idx.hasAreas).toBe(true)
    expect(idx.rowsByRecipe.get('electrolysis')!.map(r => r.node.id)).toEqual(['e-root', 'e-p', 'e-f'])
    expect(idx.rowById.get('c-c')!.areaId).toBe('C')
  })

  it('puts everything in the root without areas', () => {
    const idx = indexRecipeAreas(scenario(false))
    expect(idx.hasAreas).toBe(false)
    expect([...idx.rowById.values()].every(r => r.areaId === 'root')).toBe(true)
  })
})

describe('recipe counts', () => {
  it('recipeAreaIds lists the distinct areas in table order', () => {
    expect(recipeAreaIds(indexRecipeAreas(scenario()), 'electrolysis')).toEqual(['root', 'P', 'F'])
  })

  it('countRecipeRows counts the rows in any area', () => {
    expect(countRecipeRows(scenario(), 'electrolysis')).toBe(3)
  })
})

describe('multiAreaTitle', () => {
  it('lists the buildings per area, the row\'s own first', () => {
    const root = scenario()
    const idx = indexRecipeAreas(root)
    const here = multiAreaSummary(idx, root, 'electrolysis', 'root', solved())
    expect(multiAreaTitle('Electrolysis', here, 'root'))
      .toBe('Electrolysis: 15 buildings (13.6 exact) in 3 areas: 5 here, 5 Plastics, 5 Rocket fuel')
    const inF = multiAreaSummary(idx, root, 'electrolysis', 'F', solved())
    expect(multiAreaTitle('Electrolysis', inF, 'F')).toMatch(/in 3 areas: 5 here, 5 Top level, 5 Plastics$/)
  })

  it('names every area, in table order, without a row of its own', () => {
    const root = scenario()
    const s = multiAreaSummary(indexRecipeAreas(root), root, 'electrolysis', undefined, solved())
    expect(multiAreaTitle('Electrolysis', s, undefined))
      .toBe('Electrolysis: 15 buildings (13.6 exact) in 3 areas: 5 Top level, 5 Plastics, 5 Rocket fuel')
  })

  it('uses the singular and counts a row without a solve result as 0', () => {
    const root = scenario()
    root.subPlans = root.subPlans.map(sp => (sp.id === 'F' ? { ...sp, nodes: [] } : sp))
    const only = new Map([['e-root', solvedNode('e-root', { machineCountCeil: 1, machineCountExact: 0.3 })]])
    const s = multiAreaSummary(indexRecipeAreas(root), root, 'electrolysis', 'root', only)
    expect(multiAreaTitle('Electrolysis', s, 'root'))
      .toBe('Electrolysis: 1 building (0.3 exact) in 2 areas: 1 here, 0 Plastics')
  })
})

describe('buildAlsoInOptions', () => {
  it('offers the areas that use the item and have no row of the recipe, with their consumption', () => {
    const root = scenario()
    // P has the recipe; C's consumer sits in an organising group. F uses nothing.
    expect(buildAlsoInOptions(indexRecipeAreas(root), root, 'e-root', 'hydrogen', solved()))
      .toEqual([{ areaId: 'C', name: 'Chlorides', rate: 45 }])
  })

  it('offers nothing for a negligible use, no item, or a block without areas', () => {
    const root = scenario()
    const idx = indexRecipeAreas(root)
    const tiny = solved().set('c-c', solvedNode('c-c', { inputRates: { hydrogen: 1e-7 } }))
    expect(buildAlsoInOptions(idx, root, 'e-root', 'hydrogen', tiny)).toEqual([])
    expect(buildAlsoInOptions(idx, root, 'e-root', undefined, solved())).toEqual([])
    const flat = scenario(false)
    expect(buildAlsoInOptions(indexRecipeAreas(flat), flat, 'e-root', 'hydrogen', solved())).toEqual([])
  })
})

describe('goToRowOptions', () => {
  it('lists the recipe\'s rows in the other areas, in table order', () => {
    const root = scenario()
    expect(goToRowOptions(indexRecipeAreas(root), root, 'e-root', solved())).toEqual([
      { nodeId: 'e-p', areaId: 'P', name: 'Plastics', buildings: 5 },
      { nodeId: 'e-f', areaId: 'F', name: 'Rocket fuel', buildings: 5 },
    ])
  })
})

describe('goToRowOptions without a handle', () => {
  it('omits rows in a sub-plan without a handle, which cannot be revealed', () => {
    const root = scenario()
    root.subPlans.push(plan('X', 'Orphan', [gameRow('x-1', 'electrolysis')]))
    const options = goToRowOptions(indexRecipeAreas(root), root, 'e-root', solved())
    expect(options.map(o => o.nodeId)).toEqual(['e-p', 'e-f'])
  })
})

describe('ancestorHandleIds', () => {
  it('lists the handles to expand, outermost first', () => {
    const root = scenario()
    expect(ancestorHandleIds(root, 'e-root')).toEqual([])
    expect(ancestorHandleIds(root, 'c-c')).toEqual(['h-C', 'h-G'])
  })

  it('is undefined for an unknown row and for a sub-plan without a handle', () => {
    const root = scenario()
    expect(ancestorHandleIds(root, 'missing')).toBeUndefined()
    root.subPlans.push(plan('X', 'Orphan', [gameRow('x-1', 'iron')]))
    expect(ancestorHandleIds(root, 'x-1')).toBeUndefined()
  })
})

describe('presentRecipesFor', () => {
  it('names the recipes of the area around the sub-plan', () => {
    expect(presentRecipesFor(scenario(), 'G')).toEqual({ ids: new Set(['iron']), where: 'this area' })
  })

  it('covers the whole block without areas', () => {
    expect(presentRecipesFor(scenario(false), 'root')).toEqual({
      ids: new Set(['electrolysis', 'iron']),
      where: 'this block',
    })
  })
})

describe('recipeGroups', () => {
  const ids = (g: { rows: { node: { id: string } }[] }) => g.rows.map(r => r.node.id)

  it('groups rows by recipe in display order, rows in area order', () => {
    const p = plan('P', 'Plastics', [gameRow('y', 'Y'), gameRow('x2', 'X')], [], true)
    const root = plan('root', 'Main', [gameRow('x1', 'X'), handle('h', 'P'), gameRow('z', 'Z')], [p])
    const groups = recipeGroups(root, indexRecipeAreas(root))
    expect(groups.map(g => g.recipeId)).toEqual(['X', 'Y', 'Z'])
    expect(groups.map(ids)).toEqual([['x1', 'x2'], ['y'], ['z']])
  })

  it('puts the root row first even when the area comes first in the table', () => {
    const p = plan('P', 'Plastics', [gameRow('x2', 'X')], [], true)
    const root = plan('root', 'Main', [handle('h', 'P'), gameRow('x1', 'X')], [p])
    expect(recipeGroups(root, indexRecipeAreas(root)).map(ids)).toEqual([['x1', 'x2']])
  })

  it('leaves out rows of a sub-plan without a handle', () => {
    const p = plan('P', 'Plastics', [gameRow('x2', 'X')], [], true)
    const root = plan('root', 'Main', [gameRow('x1', 'X')], [p])
    expect(recipeGroups(root, indexRecipeAreas(root)).map(ids)).toEqual([['x1']])
  })
})

describe('recipeGroupRates', () => {
  const recipe = { products: [{ itemId: 'h2' }, { itemId: 'o2' }], mainProduct: 'h2' } as unknown as Parameters<typeof recipeGroupRates>[1]
  const ref = (id: string, primaryProduct?: string) => ({
    node: { ...gameRow(id, 'e'), ...(primaryProduct ? { primaryProduct } : {}) },
    areaId: 'root',
    subPlanId: 'root',
  })
  const map = () => new Map([
    ['a', solvedNode('a', { outputRates: { h2: 10, o2: 5 }, inputRates: { water: 7 }, powerKw: 100 })],
    ['b', solvedNode('b', { outputRates: { h2: 6, o2: 3 }, inputRates: { water: 4 }, powerKw: 50 })],
  ])

  it('adds the rows up, the primary product being a product and the rest byproducts', () => {
    const r = recipeGroupRates([ref('a'), ref('b')], recipe, map())
    expect(r.products).toEqual([['h2', 16]])
    expect(r.byproducts).toEqual([['o2', 8]])
    expect(r.inputs).toEqual([['water', 11]])
    expect(r.powerKw).toBe(150)
  })

  it('counts a row without a result as 0', () => {
    const r = recipeGroupRates([ref('a'), ref('missing')], recipe, map())
    expect(r.products).toEqual([['h2', 10]])
    expect(r.powerKw).toBe(100)
  })

  it('shows both items as products when the rows are built for different ones', () => {
    const r = recipeGroupRates([ref('a'), ref('b', 'o2')], recipe, map())
    expect(r.products).toEqual([['h2', 16], ['o2', 8]])
    expect(r.byproducts).toEqual([])
  })
})
