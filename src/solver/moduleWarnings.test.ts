import { describe, it, expect } from 'vitest'
import { moduleNotAllowedWarning } from './moduleWarnings'
import type { BeaconConfig, Block, GameData, GameRecipeNode, RecipeNode, SubPlan } from '../data/types'

// Fresh each call.
function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {
      wire: {
        id: 'wire', name: 'Tinned wire', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [],
        allowProductivity: true, mainProduct: undefined, hidden: false, subgroup: '', order: '',
      },
    },
    machines: {
      'assembling-machine-2': {
        id: 'assembling-machine-2', name: 'Assembling machine 2', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1,
        energyType: 'electric', drainKw: 0, moduleSlots: 2, allowedEffects: ['speed', 'productivity'],
        allowedModuleCategories: ['speed', 'productivity'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
      },
    },
    modules: {
      agri: { id: 'agri', name: 'Agriculture', category: 'angels-bio-yield', tier: 1, effects: { productivity: 0.1 }, limitation: [], limitationBlacklist: [], iconPath: '' },
      speed: { id: 'speed', name: 'Speed', category: 'speed', tier: 1, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '' },
      quality: { id: 'quality', name: 'Quality', category: 'quality', tier: 1, effects: { quality: 0.1 }, limitation: [], limitationBlacklist: [], iconPath: '' },
    },
    beacons: {
      beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed'] },
    },
    defaultMachines: { crafting: 'assembling-machine-2' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
  }
}

function row(id: string, over: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId: 'wire', machineId: 'assembling-machine-2', modules: [], byproductPolicy: {}, ...over }
}

function plan(id: string, nodes: RecipeNode[], subPlans: SubPlan[] = []): SubPlan {
  return { id, name: id, nodes, subPlans, createdAt: '', updatedAt: '' }
}

function block(rootPlan: SubPlan): Block {
  return { id: 'b', name: 'B', color: '#60a5fa', products: [], sourceRules: {}, inputConnections: [], rootPlan }
}

const beaconConfig = (moduleId: string, over: Partial<BeaconConfig> = {}): BeaconConfig =>
  ({ beaconId: 'beacon', modules: [{ moduleId, count: 2 }], beaconCount: 1, modulesPerBeacon: 2, distributionEfficiency: 1.5, ...over })

describe('moduleNotAllowedWarning', () => {
  it('reports a module whose category the machine does not list', () => {
    const w = moduleNotAllowedWarning(block(plan('r', [row('n', { modules: [{ moduleId: 'agri', count: 2 }] })])), makeGameData())
    expect(w).toEqual({
      type: 'module-not-allowed',
      misfits: [{ recipeId: 'wire', moduleId: 'agri', kind: 'machine', entityId: 'assembling-machine-2', reason: 'category' }],
    })
  })

  it('reports an effect the machine does not allow', () => {
    const w = moduleNotAllowedWarning(block(plan('r', [row('n', { modules: [{ moduleId: 'quality', count: 1 }] })])), makeGameData())
    expect(w?.misfits).toEqual([{ recipeId: 'wire', moduleId: 'quality', kind: 'machine', entityId: 'assembling-machine-2', reason: 'effect' }])
  })

  it('reports a beacon module the beacon rejects by effect', () => {
    const w = moduleNotAllowedWarning(block(plan('r', [row('n', { beaconConfigs: [beaconConfig('agri')] })])), makeGameData())
    expect(w?.misfits).toEqual([{ recipeId: 'wire', moduleId: 'agri', kind: 'beacon', entityId: 'beacon', reason: 'effect' }])
  })

  it('is undefined when every module fits, and for a legacy machine without the field and an accepted effect', () => {
    const gd = makeGameData()
    expect(moduleNotAllowedWarning(block(plan('r', [row('n', { modules: [{ moduleId: 'speed', count: 2 }] })])), gd)).toBeUndefined()
    delete gd.machines['assembling-machine-2'].allowedModuleCategories
    expect(moduleNotAllowedWarning(block(plan('r', [row('n', { modules: [{ moduleId: 'agri', count: 2 }] })])), gd)).toBeUndefined()
  })

  it('still reports an effect misfit on a legacy machine', () => {
    const gd = makeGameData()
    delete gd.machines['assembling-machine-2'].allowedModuleCategories
    const w = moduleNotAllowedWarning(block(plan('r', [row('n', { modules: [{ moduleId: 'quality', count: 1 }] })])), gd)
    expect(w?.misfits.map(m => m.reason)).toEqual(['effect'])
  })

  it('skips an unknown machine, module and beacon', () => {
    const rows = [
      row('a', { machineId: 'nope', modules: [{ moduleId: 'agri', count: 1 }] }),
      row('b', { modules: [{ moduleId: 'ghost', count: 1 }] }),
      row('c', { beaconConfigs: [beaconConfig('agri', { beaconId: 'nope' }), beaconConfig('ghost')] }),
    ]
    expect(moduleNotAllowedWarning(block(plan('r', rows)), makeGameData())).toBeUndefined()
  })

  it('lists identical misfits of duplicate rows once', () => {
    const rows = [row('a', { modules: [{ moduleId: 'agri', count: 1 }] }), row('b', { modules: [{ moduleId: 'agri', count: 2 }] })]
    expect(moduleNotAllowedWarning(block(plan('r', rows)), makeGameData())?.misfits).toHaveLength(1)
  })

  it('lists rows in plan order: the plan nodes, then the sub-plans', () => {
    const gd = makeGameData()
    gd.recipes.other = { ...gd.recipes.wire, id: 'other', name: 'Other' }
    gd.recipes.third = { ...gd.recipes.wire, id: 'third', name: 'Third' }
    const sub = plan('s', [row('c', { recipeId: 'third', modules: [{ moduleId: 'agri', count: 1 }] })])
    const root = plan('r', [row('a', { modules: [{ moduleId: 'agri', count: 1 }] }), row('b', { recipeId: 'other', modules: [{ moduleId: 'agri', count: 1 }] })], [sub])
    expect(moduleNotAllowedWarning(block(root), gd)?.misfits.map(m => m.recipeId)).toEqual(['wire', 'other', 'third'])
  })
})
