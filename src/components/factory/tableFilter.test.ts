import { describe, it, expect } from 'vitest'
import { filterPlan } from './tableFilter'
import type { GameData, RecipeNode, SubPlan, SubPlanNode } from '../../data/types'

function gameData(): GameData {
  const item = (id: string, name: string) => ({ id, name, type: 'item', iconPath: '', hidden: false })
  const recipe = (id: string, name: string, ing: string, prod: string[]) => ({
    id, name, category: 'smelting', craftingTime: 1, hidden: false, madeIn: [], allowProductivity: false,
    ingredients: [{ itemId: ing, type: 'item', amount: 1 }],
    products: prod.map(p => ({ itemId: p, type: 'item', amount: 1 })),
  })
  return {
    items: {
      'iron-ore': item('iron-ore', 'Iron Ore'),
      'iron-plate': item('iron-plate', 'Iron Plate'),
      'slag': item('slag', 'Slag'),
      'gear': item('gear', 'Gear Wheel'),
    },
    recipes: {
      'iron-plate': recipe('iron-plate', 'Iron plate', 'iron-ore', ['iron-plate', 'slag']),
      'gear': recipe('gear', 'Gear', 'iron-plate', ['gear']),
      'zz-hidden-id': recipe('zz-hidden-id', 'Plain', 'gear', ['gear']),
    },
  } as unknown as GameData
}

const row = (id: string, recipeId: string): RecipeNode => ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} })
const handle = (id: string, subPlanId: string): SubPlanNode => ({ kind: 'subplan', id, subPlanId })
function plan(id: string, name: string, nodes: (RecipeNode | SubPlanNode)[], subPlans: SubPlan[] = []): SubPlan {
  return { id, name, nodes, subPlans, createdAt: '', updatedAt: '' }
}

/** Root: iron plate, gear. */
const flat = () => plan('root', 'Root', [row('r-iron', 'iron-plate'), row('r-gear', 'gear')])

describe('filterPlan', () => {
  it('returns undefined for a blank or whitespace query', () => {
    expect(filterPlan(flat(), gameData(), '')).toBeUndefined()
    expect(filterPlan(flat(), gameData(), '   ')).toBeUndefined()
  })

  it('matches a recipe name case-insensitively', () => {
    const f = filterPlan(flat(), gameData(), ' GEAR ')!
    expect([...f.visible]).toEqual(['r-gear'])
    expect(f.hidden).toBe(1)
    expect(f.total).toBe(2)
  })

  it('matches a recipe by its id alone', () => {
    const p = plan('root', 'Root', [row('r-1', 'zz-hidden-id'), row('r-iron', 'iron-plate')])
    const f = filterPlan(p, gameData(), 'zz-hidden')!
    expect([...f.visible]).toEqual(['r-1'])
  })

  it('matches an ingredient item name', () => {
    const f = filterPlan(flat(), gameData(), 'iron ore')!
    expect([...f.visible]).toEqual(['r-iron'])
  })

  it('matches a product, byproducts included', () => {
    const f = filterPlan(flat(), gameData(), 'slag')!
    expect([...f.visible]).toEqual(['r-iron'])
  })

  it('keeps and opens the group of a match, not the non-matching root row', () => {
    const g = plan('G', 'Group', [row('g-gear', 'gear')])
    const root = plan('root', 'Root', [row('r-iron', 'iron-plate'), handle('h-g', 'G')], [g])
    const f = filterPlan(root, gameData(), 'wheel')!
    expect(f.visible.has('g-gear')).toBe(true)
    expect(f.visible.has('h-g')).toBe(true)
    expect(f.open.has('h-g')).toBe(true)
    expect(f.visible.has('r-iron')).toBe(false)
  })

  it('opens every level of a nested match', () => {
    const inner = plan('I', 'Inner', [row('i-gear', 'gear')])
    const outer = plan('O', 'Outer', [handle('h-i', 'I')], [inner])
    const root = plan('root', 'Root', [handle('h-o', 'O')], [outer])
    const f = filterPlan(root, gameData(), 'wheel')!
    expect([...f.open].sort()).toEqual(['h-i', 'h-o'])
    expect(f.visible.has('h-o')).toBe(true)
  })

  it('shows the whole subtree of a group whose name matches, and not a sibling group', () => {
    const g = plan('G', 'Smelters', [row('g-1', 'iron-plate'), row('g-2', 'gear')])
    const other = plan('H', 'Other', [row('h-1', 'gear')])
    const root = plan('root', 'Root', [handle('h-g', 'G'), handle('h-h', 'H')], [g, other])
    const f = filterPlan(root, gameData(), 'smelt')!
    expect(f.visible.has('g-1') && f.visible.has('g-2') && f.visible.has('h-g')).toBe(true)
    expect(f.open.has('h-g')).toBe(true)
    expect(f.visible.has('h-h')).toBe(false)
  })

  it('shows a matching empty group and opens it, so its drop target renders', () => {
    const g = plan('G', 'Smelters', [])
    const root = plan('root', 'Root', [handle('h-g', 'G')], [g])
    const f = filterPlan(root, gameData(), 'smelt')!
    expect(f.visible.has('h-g')).toBe(true)
    expect(f.open.has('h-g')).toBe(true)
  })

  it('hides everything when nothing matches', () => {
    const f = filterPlan(flat(), gameData(), 'nothing-like-this')!
    expect(f.visible.size).toBe(0)
    expect(f.open.size).toBe(0)
    expect(f.hidden).toBe(f.total)
  })

  it('counts rows at every depth, collapsed or not, and ignores a sub-plan without a handle', () => {
    const inner = plan('I', 'Inner', [row('i-1', 'gear')])
    const outer = plan('O', 'Outer', [row('o-1', 'gear'), handle('h-i', 'I')], [inner])
    const stranded = plan('S', 'Stranded', [row('s-1', 'gear')])
    const root = plan('root', 'Root', [row('r-1', 'gear'), handle('h-o', 'O')], [outer, stranded])
    // r-1, h-o, o-1, h-i, i-1
    expect(filterPlan(root, gameData(), 'zzz')!.total).toBe(5)
  })

  it('falls back to the id for a recipe missing from the game data', () => {
    const p = plan('root', 'Root', [row('r-1', 'mystery-recipe')])
    expect(filterPlan(p, gameData(), 'mystery')!.visible.has('r-1')).toBe(true)
  })
})
