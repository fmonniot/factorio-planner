import { describe, it, expect } from 'vitest'
import {
  categoryLabel, availableMachinesFor, defaultMachineCategories, defaultMachineRowCounts,
} from './defaultMachines'
import type { Horizon } from './horizon'
import type { Block, GameData, Machine } from './types'

function machine(id: string, categories: string[], hidden = false): Machine {
  return {
    id, name: id, craftingSpeed: 1, craftingCategories: categories, moduleSlots: 0,
    energyUsageKw: 0, allowedEffects: [], hidden, iconPath: '',
  } as unknown as Machine
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {
      r1: { id: 'r1', category: 'crafting' },
      r2: { id: 'r2', category: 'crafting' },
      r3: { id: 'r3', category: 'smelting' },
      r4: { id: 'r4', category: 'mining:basic-solid' },
    } as unknown as GameData['recipes'],
    machines: {
      zeta: machine('zeta', ['crafting']),
      alpha: machine('alpha', ['crafting']),
      ghost: machine('ghost', ['crafting'], true),
      furnace: machine('furnace', ['smelting']),
      far: machine('far', ['smelting']),
      'mine-a': machine('mine-a', ['mining:basic-solid']),
      'mine-b': machine('mine-b', ['mining:basic-solid']),
    },
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

function horizon(machineIds: string[] | null): Horizon {
  return {
    recipeIds: null, itemIds: null, machineIds: machineIds && new Set(machineIds),
    beaconIds: null, moduleIds: null, defaultMachines: {},
  }
}

describe('categoryLabel', () => {
  it('turns separators into spaces and capitalises', () => {
    expect(categoryLabel('mining:basic-solid')).toBe('Mining basic solid')
    expect(categoryLabel('angels-ore-sorting-2')).toBe('Angels ore sorting 2')
  })

  it('prefers the data set\'s category name and falls back to the id', () => {
    const data = { categoryNames: { 'crafting-with-fluid': 'Crafting with fluid' } }
    expect(categoryLabel('crafting-with-fluid', data)).toBe('Crafting with fluid')
    expect(categoryLabel('mining:basic-solid', data)).toBe('Mining basic solid')
  })
})

describe('availableMachinesFor', () => {
  it('drops hidden, wrong-category and out-of-horizon machines and sorts by name', () => {
    const d = makeGameData()
    expect(availableMachinesFor(d, horizon(null), 'crafting').map(m => m.id)).toEqual(['alpha', 'zeta'])
    expect(availableMachinesFor(d, horizon(['zeta', 'ghost']), 'crafting').map(m => m.id)).toEqual(['zeta'])
  })
})

describe('availableMachinesFor additional categories', () => {
  function withElec(hidden = false): GameData {
    const d = makeGameData()
    d.machines.elec = machine('elec', ['electronics'], hidden)
    d.machines.both = machine('both', ['crafting', 'electronics'])
    return d
  }
  it('adds the machines of the additional categories, each machine once', () => {
    const ids = availableMachinesFor(withElec(), horizon(null), 'crafting', ['electronics']).map(m => m.id)
    expect(ids).toEqual(['alpha', 'both', 'elec', 'zeta'])
  })
  it('leaves them out without the argument', () => {
    expect(availableMachinesFor(withElec(), horizon(null), 'crafting').map(m => m.id)).not.toContain('elec')
  })
  it('drops hidden and out-of-horizon machines', () => {
    expect(availableMachinesFor(withElec(true), horizon(null), 'crafting', ['electronics']).map(m => m.id)).not.toContain('elec')
    expect(availableMachinesFor(withElec(), horizon(['alpha']), 'crafting', ['electronics']).map(m => m.id)).toEqual(['alpha'])
  })
})

describe('defaultMachineCategories', () => {
  it('lists categories with at least two available machines, sorted by label', () => {
    const d = makeGameData()
    expect(defaultMachineCategories(d, horizon(null))).toEqual(['crafting', 'mining:basic-solid', 'smelting'])
  })
  it('leaves out a category no recipe has as its primary category', () => {
    const d = makeGameData()
    d.machines.e1 = machine('e1', ['electronics'])
    d.machines.e2 = machine('e2', ['electronics'])
    expect(defaultMachineCategories(d, horizon(null))).toEqual(['crafting', 'mining:basic-solid', 'smelting'])
  })
  it('keeps a category that is primary for one recipe and additional for another, and hides one that is only additional', () => {
    const d = makeGameData()
    d.machines.e1 = machine('e1', ['electronics'])
    d.machines.e2 = machine('e2', ['electronics'])
    d.machines.p1 = machine('p1', ['assembling'])
    d.machines.p2 = machine('p2', ['assembling'])
    d.recipes.r5 = { id: 'r5', category: 'crafting', additionalCategories: ['electronics', 'assembling'] } as unknown as GameData['recipes'][string]
    d.recipes.r6 = { id: 'r6', category: 'assembling' } as unknown as GameData['recipes'][string]
    expect(defaultMachineCategories(d, horizon(null))).toEqual(['assembling', 'crafting', 'mining:basic-solid', 'smelting'])
  })
  it('leaves out a category whose second machine is outside the horizon', () => {
    const d = makeGameData()
    const ids = Object.keys(d.machines).filter(id => id !== 'far')
    expect(defaultMachineCategories(d, horizon(ids))).toEqual(['crafting', 'mining:basic-solid'])
  })
})

describe('defaultMachineRowCounts', () => {
  const now = '2026-01-01T00:00:00.000Z'
  function node(id: string, recipeId: string, machineId?: string): Block['rootPlan']['nodes'][number] {
    return { kind: 'game-recipe', id, recipeId, machineId, modules: [], byproductPolicy: {} }
  }
  function block(id: string, nodes: Block['rootPlan']['nodes'], nested: Block['rootPlan']['nodes'] = []): Block {
    return {
      id, name: id, color: '#000000', products: [], sourceRules: {}, inputConnections: [],
      rootPlan: {
        id: `${id}-root`, name: 'Main', nodes, createdAt: now, updatedAt: now,
        subPlans: [{ id: `${id}-sub`, name: 'Sub', nodes: nested, subPlans: [], createdAt: now, updatedAt: now }],
      },
    }
  }

  it('counts default-machine rows across blocks and sub-plans, skipping explicit machines and unknown recipes', () => {
    const d = makeGameData()
    const blocks = [
      block('a', [node('n1', 'r1'), node('n2', 'r2', 'alpha'), node('n3', 'unknown')], [node('n4', 'r1'), node('n5', 'r3')]),
      block('b', [node('n6', 'r1')]),
    ]
    const counts = defaultMachineRowCounts(blocks, d)
    expect(counts.get('crafting')).toBe(3)
    expect(counts.get('smelting')).toBe(1)
    expect(counts.size).toBe(2)
  })
})

describe('categoryLabel with inherited keys', () => {
  it('ignores Object.prototype members', () => {
    expect(categoryLabel('constructor', { categoryNames: {} })).toBe('Constructor')
  })
})
