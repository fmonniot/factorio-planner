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
})

describe('availableMachinesFor', () => {
  it('drops hidden, wrong-category and out-of-horizon machines and sorts by name', () => {
    const d = makeGameData()
    expect(availableMachinesFor(d, horizon(null), 'crafting').map(m => m.id)).toEqual(['alpha', 'zeta'])
    expect(availableMachinesFor(d, horizon(['zeta', 'ghost']), 'crafting').map(m => m.id)).toEqual(['zeta'])
  })
})

describe('defaultMachineCategories', () => {
  it('lists categories with at least two available machines, sorted by label', () => {
    const d = makeGameData()
    expect(defaultMachineCategories(d, horizon(null))).toEqual(['crafting', 'mining:basic-solid', 'smelting'])
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
      id, name: id, color: '#000000', products: [], noImportItems: [], connectionsFirstItems: [], inputConnections: [],
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
