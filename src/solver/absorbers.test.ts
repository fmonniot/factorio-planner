import { describe, it, expect } from 'vitest'
import { absorberRoles } from './absorbers'
import type { ClassifiedSystem } from './build'

// Rows are written as [id, ingredients, products] with item amounts; the net coefficient S is products minus ingredients.
type Row = [id: string, ingredients: Record<string, number>, products: Record<string, number>]

/** A classified system as `buildClassifiedSystem` would classify it: made and used = intermediate, used only = raw, made only = byproduct. */
function systemOf(rows: Row[], goals: Record<string, number> = {}): ClassifiedSystem {
  const S = new Map<string, Map<string, number>>()
  const add = (itemId: string, id: string, delta: number) => {
    if (!S.has(itemId)) S.set(itemId, new Map())
    S.get(itemId)!.set(id, (S.get(itemId)!.get(id) ?? 0) + delta)
  }
  for (const [id, ingredients, products] of rows) {
    for (const [itemId, n] of Object.entries(ingredients)) add(itemId, id, -n)
    for (const [itemId, n] of Object.entries(products)) add(itemId, id, n)
  }
  const goalItems = new Set(Object.keys(goals))
  const intermediates = new Set<string>()
  const raw = new Set<string>()
  const byproducts = new Set<string>()
  for (const [itemId, row] of S) {
    if (goalItems.has(itemId)) continue
    const values = [...row.values()]
    const made = values.some(c => c > 0)
    const used = values.some(c => c < 0)
    if (made && used) intermediates.add(itemId)
    else if (used) raw.add(itemId)
    else byproducts.add(itemId)
  }
  return {
    S,
    recipes: rows.map(r => r[0]),
    classification: { goals: new Map(Object.entries(goals)), intermediates, raw, byproducts },
  }
}

// Case 23's chain: G grows the goal and trees, A saws a tree (saw net -0.1), K makes a saw from a plate, H makes plates from a roll.
const grow: Row = ['G', { seed: 1 }, { goal: 1, tree: 2 }]
const saw: Row = ['A', { tree: 1, saw: 1 }, { wood: 8, saw: 0.9 }]
const makeSaw: Row = ['K', { plate: 1 }, { saw: 1 }]
const makePlate: Row = ['H', { roll: 1 }, { plate: 4 }]
const usePlate: Row = ['U', { plate: 1 }, { gadget: 1 }]

const ids = (s: ReadonlySet<string>) => [...s].sort()
const none = new Map<string, number>()

describe('absorberRoles', () => {
  it('1: the flagged saw and saw maker; the plate row feeds them', () => {
    const roles = absorberRoles(systemOf([grow, saw, makeSaw, makePlate], { goal: 10 }), new Set(['A', 'K']), none)
    expect(ids(roles.chain), 'chain').toEqual(['A', 'H', 'K'])
    expect(ids(roles.rewarded), 'rewarded').toEqual(['A'])
  })

  it('2: only the saw is flagged; the saw maker feeds it', () => {
    const roles = absorberRoles(systemOf([grow, saw, makeSaw, makePlate], { goal: 10 }), new Set(['A']), none)
    expect(ids(roles.chain), 'chain').toEqual(['A', 'H', 'K'])
    expect(ids(roles.rewarded), 'rewarded').toEqual(['A'])
  })

  it('3: an ordinary row also uses the plate: the plate row is not a feeder, the saw maker is anchored', () => {
    const roles = absorberRoles(systemOf([grow, saw, makeSaw, makePlate, usePlate], { goal: 10, gadget: 4 }), new Set(['A', 'K']), none)
    expect(ids(roles.chain), 'chain').toEqual(['A', 'K'])
    expect(ids(roles.rewarded), 'rewarded').toEqual(['A', 'K'])
  })

  it('4: a row whose product is a goal is not a feeder', () => {
    const maker: Row = ['K', { plate: 1 }, { saw: 1, gizmo: 1 }]
    const roles = absorberRoles(systemOf([grow, saw, maker, makePlate], { goal: 10, gizmo: 1 }), new Set(['A']), none)
    expect(ids(roles.chain), 'chain').toEqual(['A'])
    expect(ids(roles.rewarded), 'rewarded').toEqual(['A'])
  })

  it('5: a pinned row is never a feeder and its products are bounded', () => {
    const roles = absorberRoles(systemOf([grow, saw, makeSaw, makePlate], { goal: 10 }), new Set(['A']), new Map([['H', 0.5]]))
    expect(ids(roles.chain), 'chain').toEqual(['A', 'K'])
    // K takes the plate of a pinned row, so it is anchored; it is not flagged, so it keeps cost 0.
    expect(ids(roles.rewarded), 'rewarded').toEqual(['A'])
  })

  it('6: two flagged rows in a line are both rewarded when the first takes an ordinary row\'s product', () => {
    const rows: Row[] = [
      ['O', { ore: 1 }, { goal: 1, t: 1 }],
      ['R1', { t: 1 }, { x: 1 }],
      ['R2', { x: 1 }, { void: 1 }],
    ]
    const roles = absorberRoles(systemOf(rows, { goal: 1 }), new Set(['R1', 'R2']), none)
    expect(ids(roles.chain), 'chain').toEqual(['R1', 'R2'])
    expect(ids(roles.rewarded), 'rewarded').toEqual(['R1', 'R2'])
  })

  it('7: an item an ordinary row and a raw-fed feeder both make does not anchor its flagged consumer', () => {
    const rows: Row[] = [
      ['O', { ore: 1 }, { goal: 1, x: 1 }],
      ['U', { roll: 1 }, { x: 4 }],
      ['R', { x: 1 }, { waste: 1 }],
    ]
    const roles = absorberRoles(systemOf(rows, { goal: 1 }), new Set(['R']), none)
    expect(ids(roles.chain), 'chain').toEqual(['R', 'U'])
    expect(ids(roles.rewarded), 'rewarded').toEqual([])
  })

  it('8: a flagged row that takes only raw items is not rewarded', () => {
    const rows: Row[] = [grow, ['B', { roll: 1 }, { ash: 1 }]]
    const roles = absorberRoles(systemOf(rows, { goal: 10 }), new Set(['B']), none)
    expect(ids(roles.chain), 'chain').toEqual(['B'])
    expect(ids(roles.rewarded), 'rewarded').toEqual([])
  })

  it('ignores a flagged id that is not a column', () => {
    const roles = absorberRoles(systemOf([grow, saw], { goal: 10 }), new Set(['A', 'ghost']), none)
    expect(ids(roles.chain), 'chain').toEqual(['A'])
  })
})
