import { describe, it, expect } from 'vitest'
import { absorberRoles, isFeeder } from './absorbers'
import { buildClassifiedSystem, type ClassifiedSystem } from './build'
import type { GameData } from '../data/types'

// Rows are written as [id, ingredients, products] with item amounts; the net coefficient S is products minus ingredients.
type Row = [id: string, ingredients: Record<string, number>, products: Record<string, number>]

/** The system `buildClassifiedSystem` builds for these rows, as in a block solve. */
function systemOf(rows: Row[], goals: Record<string, number> = {}): ClassifiedSystem {
  const recipes: GameData['recipes'] = {}
  for (const [id, ingredients, products] of rows) {
    recipes[id] = {
      id, name: id, category: 'crafting', craftingTime: 1,
      ingredients: Object.entries(ingredients).map(([itemId, amount]) => ({ itemId, type: 'item' as const, amount })),
      products: Object.entries(products).map(([itemId, amount]) => ({ itemId, type: 'item' as const, amount })),
      madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false, subgroup: '', order: '',
    }
  }
  const gameData: GameData = {
    factorioVersion: '2.0.0', modSet: {}, items: {}, recipes, machines: {}, modules: {}, beacons: {}, defaultMachines: {},
    itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  }
  return buildClassifiedSystem(gameData, rows.map(r => r[0]), new Map(Object.entries(goals)))
}

// Case 23's chain: G grows the goal and trees, A saws a tree (saw net -0.1), K makes a saw from a plate, H makes plates from a roll.
const grow: Row = ['G', { seed: 1 }, { goal: 1, tree: 2 }]
const saw: Row = ['A', { tree: 1, saw: 1 }, { wood: 8, saw: 0.9 }]
const makeSaw: Row = ['K', { plate: 1 }, { saw: 1 }]
const makePlate: Row = ['H', { roll: 1 }, { plate: 4 }]
const usePlate: Row = ['U', { plate: 1 }, { gadget: 1 }]

const ids = (s: ReadonlySet<string>) => [...s].sort()
const none = new Map<string, number>()

describe('isFeeder', () => {
  it('is true for a live feeder, false for a flagged row and for a row outside the chain', () => {
    const flagged = new Set(['A'])
    const roles = absorberRoles(systemOf([grow, saw, makeSaw, makePlate, usePlate], { goal: 10, gadget: 4 }), flagged, none)
    // Case 3 without K flagged: the plate row is used by an ordinary row, so only A is in the chain.
    expect(isFeeder(roles, flagged, 'A'), 'flagged').toBe(false)
    expect(isFeeder(roles, flagged, 'U'), 'unrelated').toBe(false)
    const feeding = absorberRoles(systemOf([grow, saw, makeSaw, makePlate], { goal: 10 }), flagged, none)
    expect(isFeeder(feeding, flagged, 'K'), 'live feeder').toBe(true)
    expect(isFeeder(feeding, flagged, 'H'), 'live feeder, one more step back').toBe(true)
    expect(isFeeder(feeding, flagged, 'A'), 'flagged').toBe(false)
    expect(isFeeder(feeding, flagged, 'G'), 'unrelated').toBe(false)
  })
})

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
    // R is not anchored, so nothing feeds a live row: U stays an ordinary row.
    expect(ids(roles.chain), 'chain').toEqual(['R'])
    expect(ids(roles.rewarded), 'rewarded').toEqual([])
    expect(ids(roles.live), 'live').toEqual([])
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

  it('9: a flagged row that makes what an ordinary row uses and feeds nothing live is not live, nor its feeder', () => {
    const rows: Row[] = [
      ['p', { ore: 1 }, { plate: 1 }],
      ['u', { plate: 1 }, { gadget: 1 }],
      ['rr', { x: 2 }, { plate: 1 }],
      ['f', { roll: 1 }, { x: 1 }],
    ]
    const roles = absorberRoles(systemOf(rows, { gadget: 10 }), new Set(['rr']), none)
    expect(ids(roles.chain), 'chain').toEqual(['rr'])
    expect(ids(roles.live), 'live').toEqual([])
  })

  it('10: an item with a cheap import is not bounded, so the row taking it is not rewarded', () => {
    const rows: Row[] = [
      ['G', { seed: 1 }, { goal: 1, plate: 1 }],
      ['K', { plate: 1 }, { saw: 1 }],
      ['R', { saw: 1, log: 1 }, { wood: 8, saw: 0.9 }],
    ]
    const system = systemOf(rows, { goal: 10 })
    expect(ids(absorberRoles(system, new Set(['R']), none).rewarded), 'plate imported at full price').toEqual(['R'])
    const roles = absorberRoles(system, new Set(['R']), none, new Set(['plate']))
    expect(ids(roles.rewarded), 'plate imported cheaply').toEqual([])
    expect(ids(roles.live), 'live').toEqual([])
  })

  it('11: of two feeders of an item the one that takes fewer items per run costs less, whatever the row order', () => {
    const a: Row = ['A2', { roll: 1 }, { saw: 1 }]
    const b: Row = ['B2', { ore: 100 }, { saw: 1 }]
    for (const rows of [[grow, saw, a, b], [grow, saw, b, a]]) {
      const roles = absorberRoles(systemOf(rows, { goal: 10 }), new Set(['A']), none)
      expect(roles.feederCost.get('A2')!, 'cheaper').toBeLessThan(roles.feederCost.get('B2')!)
      expect(roles.feederCost.get('B2')!, 'tiny').toBeLessThan(1e-3)
    }
  })
})
