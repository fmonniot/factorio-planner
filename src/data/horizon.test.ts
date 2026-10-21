import { describe, it, expect } from 'vitest'
import {
  hasTechnologies, technologyClosure, availableRecipeIds, availableItemIds,
  withinHorizon, placingItemIds, availableMachineIds, availableBeaconIds, availableModuleIds,
  horizonDefaultMachines, applyDefaultMachineOverrides, resolveRowMachine, computeHorizon, recipeUnlock, technologyUnlocks,
} from './horizon'
import type { GameData } from './types'

function tech(id: string, prerequisites: string[] = [], unlockedRecipes: string[] = []) {
  return { id, name: id, prerequisites, unlockedRecipes, iconPath: '' }
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {
      a: tech('a', [], ['r-a']),
      b: tech('b', ['a'], ['r-b']),
      c: tech('c', ['b'], ['r-c']),
      left: tech('left', ['a']),
      right: tech('right', ['a']),
      top: tech('top', ['left', 'right'], ['r-top']),
      x: tech('x', ['y'], ['r-shared']),
      y: tech('y', ['x']),
      other: tech('other', [], ['r-shared', 'r-other']),
    },
    startingRecipes: ['r-start'],
  }
}

describe('hasTechnologies', () => {
  it('is false for an empty technology map and true otherwise', () => {
    const empty = makeGameData()
    empty.technologies = {}
    expect(hasTechnologies(empty)).toBe(false)
    expect(hasTechnologies(makeGameData())).toBe(true)
  })
})

describe('technologyClosure', () => {
  it('follows a chain of prerequisites', () => {
    expect(technologyClosure(makeGameData(), ['c'])).toEqual(new Set(['a', 'b', 'c']))
  })
  it('handles a diamond', () => {
    expect(technologyClosure(makeGameData(), ['top'])).toEqual(new Set(['a', 'left', 'right', 'top']))
  })
  it('ignores unknown ids', () => {
    expect(technologyClosure(makeGameData(), ['nope', 'a'])).toEqual(new Set(['a']))
  })
  it('terminates on a cycle and contains both members', () => {
    expect(technologyClosure(makeGameData(), ['x'])).toEqual(new Set(['x', 'y']))
  })
})

describe('availableRecipeIds', () => {
  it('is null without technology data even when targets are set', () => {
    const gd = makeGameData()
    gd.technologies = {}
    expect(availableRecipeIds(gd, ['a'])).toBeNull()
  })
  it('is null without targets', () => {
    expect(availableRecipeIds(makeGameData(), [])).toBeNull()
  })
  it('is null when every target is unknown', () => {
    expect(availableRecipeIds(makeGameData(), ['nope'])).toBeNull()
  })
  it('includes starting recipes and those unlocked by prerequisites', () => {
    const available = availableRecipeIds(makeGameData(), ['b'])!
    expect(available).toEqual(new Set(['r-start', 'r-a', 'r-b']))
  })
  it('excludes recipes unlocked by unrelated technologies', () => {
    expect(availableRecipeIds(makeGameData(), ['a'])!.has('r-other')).toBe(false)
  })
  it('includes a recipe unlocked by two technologies when either is in the horizon', () => {
    expect(availableRecipeIds(makeGameData(), ['other'])!.has('r-shared')).toBe(true)
    expect(availableRecipeIds(makeGameData(), ['x'])!.has('r-shared')).toBe(true)
  })
  it('excludes an orphan recipe', () => {
    const gd = makeGameData()
    gd.recipes['orphan'] = {} as never
    expect(availableRecipeIds(gd, ['c'])!.has('orphan')).toBe(false)
  })
})

describe('availableItemIds', () => {
  function item(id: string) {
    return { id, name: id, type: 'item' as const, iconPath: '', hidden: false, subgroup: 'sg', order: 'a' }
  }
  function recipe(id: string, products: string[], hidden = false) {
    return {
      id, name: id, category: 'crafting', craftingTime: 1,
      ingredients: [],
      products: products.map(itemId => ({ itemId, type: 'item' as const, amount: 1 })),
      madeIn: [], allowProductivity: false, hidden,
      mainProduct: null, subgroup: 'sg', order: 'a',
    }
  }
  function makeItemsData(): GameData {
    const data = makeGameData()
    data.items = Object.fromEntries(['raw', 'inside', 'outside', 'mixed', 'secret', 'shadowed'].map(id => [id, item(id)]))
    data.recipes = Object.fromEntries([
      recipe('r-inside', ['inside']),
      recipe('r-outside', ['outside']),
      recipe('r-mixed-in', ['mixed']),
      recipe('r-mixed-out', ['mixed']),
      recipe('r-secret', ['secret'], true),
      recipe('r-shadowed-out', ['shadowed']),
      recipe('r-shadowed-hidden', ['shadowed'], true),
    ].map(r => [r.id, r]))
    return data
  }

  it('returns null when there is no recipe limit', () => {
    expect(availableItemIds(makeItemsData(), null)).toBeNull()
  })

  it('keeps raw items that no recipe produces', () => {
    expect(availableItemIds(makeItemsData(), new Set())?.has('raw')).toBe(true)
  })

  it('drops items whose only producers are outside the horizon', () => {
    const ids = availableItemIds(makeItemsData(), new Set(['r-inside', 'r-mixed-in']))!
    expect(ids.has('inside')).toBe(true)
    expect(ids.has('outside')).toBe(false)
  })

  it('keeps items with at least one producer inside the horizon', () => {
    expect(availableItemIds(makeItemsData(), new Set(['r-mixed-in']))?.has('mixed')).toBe(true)
  })

  it('keeps items only hidden recipes produce, as they have no visible producer', () => {
    expect(availableItemIds(makeItemsData(), new Set())?.has('secret')).toBe(true)
  })

  it('drops items whose non-hidden producers are outside the horizon even if a hidden recipe produces them', () => {
    expect(availableItemIds(makeItemsData(), new Set())?.has('shadowed')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Machines, beacons, modules
// ---------------------------------------------------------------------------

function item(id: string, placeResult?: string): GameData['items'][string] {
  return { id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', placeResult }
}

function makeRecipe(id: string, product: string): GameData['recipes'][string] {
  return {
    id, name: id, category: 'crafting', craftingTime: 1, ingredients: [],
    products: [{ itemId: product, type: 'item', amount: 1 }],
    madeIn: [], allowProductivity: false, hidden: false, mainProduct: undefined, subgroup: '', order: '',
  }
}

function machine(id: string, category: string, craftingSpeed: number, hidden = false): GameData['machines'][string] {
  return {
    id, name: id, type: 'assembling-machine', craftingSpeed, energyUsageKw: 1, energyType: 'electric',
    drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: [category], iconPath: '', hidden,
  }
}

function makeEquipmentData(): GameData {
  const d = makeGameData()
  d.technologies = {
    a: tech('a', [], ['r-am2']),
    b: tech('b', ['a'], ['r-speed', 'r-beacon']),
    c: tech('c', ['b'], ['r-adv']),
    x: tech('x', [], []),
  }
  d.startingRecipes = ['r-start', 'r-am1']
  d.items = {
    am1: item('am1', 'am1'),
    am2: item('am2', 'am2'),
    furnace: item('furnace', 'furnace'),
    'adv-furnace': item('adv-furnace', 'adv-furnace'),
    'speed-1': item('speed-1'),
    'beacon-item': item('beacon-item', 'beacon'),
  }
  d.recipes = {
    'r-am1': makeRecipe('r-am1', 'am1'),
    'r-am2': makeRecipe('r-am2', 'am2'),
    'r-adv': makeRecipe('r-adv', 'adv-furnace'),
    'r-speed': makeRecipe('r-speed', 'speed-1'),
    'r-beacon': makeRecipe('r-beacon', 'beacon-item'),
  }
  d.machines = {
    am1: machine('am1', 'crafting', 0.5),
    am2: machine('am2', 'crafting', 0.75),
    furnace: machine('furnace', 'smelting', 1),
    'adv-furnace': machine('adv-furnace', 'adv-smelting', 2),
    'hidden-fast': machine('hidden-fast', 'crafting', 9, true),
    orphan: machine('orphan', 'crafting', 0.1),
  }
  d.beacons = {
    beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed'] },
  }
  d.modules = {
    'speed-1': { id: 'speed-1', name: 'Speed 1', category: 'speed', tier: 1, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '' },
  }
  d.defaultMachines = { crafting: 'am2', smelting: 'furnace', 'adv-smelting': 'adv-furnace' }
  return d
}

describe('withinHorizon', () => {
  it('is true without a limit or without an id, and false for an id outside the set', () => {
    expect(withinHorizon(null, 'x')).toBe(true)
    expect(withinHorizon(new Set(['a']), undefined)).toBe(true)
    expect(withinHorizon(new Set(['a']), 'b')).toBe(false)
    expect(withinHorizon(new Set(['a']), 'a')).toBe(true)
  })
})

describe('placingItemIds', () => {
  it('maps entities to their placing items', () => {
    const m = placingItemIds(makeEquipmentData())
    expect(m.get('am1')).toEqual(['am1'])
    expect(m.get('beacon')).toEqual(['beacon-item'])
    expect(m.has('orphan')).toBe(false)
  })
  it('falls back to the item with the same id when no item has placeResult', () => {
    const d = makeEquipmentData()
    for (const i of Object.values(d.items)) delete i.placeResult
    const m = placingItemIds(d)
    expect(m.get('am2')).toEqual(['am2'])
    expect(m.has('beacon')).toBe(false)
  })
  it('lists every item that places the same entity', () => {
    const d = makeEquipmentData()
    d.items['am1-alt'] = item('am1-alt', 'am1')
    expect(placingItemIds(d).get('am1')).toEqual(['am1', 'am1-alt'])
  })
})

describe('availableMachineIds', () => {
  it('is null without a limit', () => {
    expect(availableMachineIds(makeEquipmentData(), null)).toBeNull()
  })
  it('keeps machines whose item is obtainable and machines with no placing item', () => {
    const d = makeEquipmentData()
    const early = availableMachineIds(d, computeHorizon(d, ['x']).itemIds)!
    expect(early.has('am1')).toBe(true)
    expect(early.has('furnace')).toBe(true)
    expect(early.has('orphan')).toBe(true)
    expect(early.has('am2')).toBe(false)
    expect(early.has('adv-furnace')).toBe(false)
    const later = availableMachineIds(d, computeHorizon(d, ['a']).itemIds)!
    expect(later.has('am2')).toBe(true)
  })
})

describe('availableBeaconIds / availableModuleIds', () => {
  it('gate on the item and never gate a module that is not an item', () => {
    const d = makeEquipmentData()
    const a = computeHorizon(d, ['a']).itemIds
    const b = computeHorizon(d, ['b']).itemIds
    expect(availableBeaconIds(d, a)!.has('beacon')).toBe(false)
    expect(availableModuleIds(d, a)!.has('speed-1')).toBe(false)
    expect(availableBeaconIds(d, b)!.has('beacon')).toBe(true)
    expect(availableModuleIds(d, b)!.has('speed-1')).toBe(true)
    expect(availableBeaconIds(d, null)).toBeNull()
    expect(availableModuleIds(d, null)).toBeNull()
    delete d.items['speed-1']
    expect(availableModuleIds(d, a)!.has('speed-1')).toBe(true)
  })
})

describe('hidden never-craftable items', () => {
  function withHidden(): GameData {
    const d = makeEquipmentData()
    d.items['hidden-am'] = { ...item('hidden-am', 'hidden-am'), hidden: true }
    d.items['hidden-craftable-am'] = { ...item('hidden-craftable-am', 'hidden-craftable-am'), hidden: true }
    d.items['hidden-mod'] = { ...item('hidden-mod'), hidden: true }
    d.recipes['r-hidden-craftable'] = makeRecipe('r-hidden-craftable', 'hidden-craftable-am')
    d.startingRecipes.push('r-hidden-craftable')
    d.machines['hidden-am'] = machine('hidden-am', 'crafting', 5, true)
    d.machines['hidden-craftable-am'] = machine('hidden-craftable-am', 'crafting', 0.4, true)
    d.modules['hidden-mod'] = {
      id: 'hidden-mod', name: 'Hidden', category: 'speed', tier: 1, effects: { speed: 0.2 },
      limitation: [], limitationBlacklist: [], iconPath: '',
    }
    return d
  }

  it('makes a machine whose hidden placing item no non-hidden recipe crafts unavailable', () => {
    const d = withHidden()
    const ids = computeHorizon(d, ['x']).machineIds!
    expect(ids.has('hidden-am')).toBe(false)
    expect(ids.has('hidden-craftable-am')).toBe(true)
    expect(ids.has('orphan'), 'an entity with no placing item is never gated').toBe(true)
  })
  it('makes a hidden never-craftable module unavailable', () => {
    const d = withHidden()
    const ids = computeHorizon(d, ['x']).moduleIds!
    expect(ids.has('hidden-mod')).toBe(false)
    expect(availableModuleIds(d, null)).toBeNull()
  })
  it('makes a hidden never-craftable beacon unavailable', () => {
    const d = withHidden()
    d.items['hidden-beacon-item'] = { ...item('hidden-beacon-item', 'hidden-beacon'), hidden: true }
    d.beacons['hidden-beacon'] = { ...d.beacons.beacon, id: 'hidden-beacon' }
    expect(computeHorizon(d, ['x']).beaconIds!.has('hidden-beacon')).toBe(false)
  })
  it('does not change which items are offered as goals', () => {
    const d = withHidden()
    expect(computeHorizon(d, ['x']).itemIds!.has('hidden-am')).toBe(true)
  })
  it('replaces a hidden static default with the fastest available visible machine', () => {
    const d = withHidden()
    d.machines['hidden-am'].hidden = true
    d.defaultMachines.crafting = 'hidden-am'
    d.items['hidden-am'].hidden = false
    // the item is visible and offered (so the machine is "available") but the machine itself is hidden
    const h = computeHorizon(d, ['x'])
    expect(h.machineIds!.has('hidden-am')).toBe(true)
    expect(h.defaultMachines.crafting).toBe('am1')
    expect(horizonDefaultMachines(d, null)).toBe(d.defaultMachines)
  })
  it('never keeps an unavailable hidden static default either', () => {
    const d = withHidden()
    d.defaultMachines.crafting = 'hidden-am'
    expect(computeHorizon(d, ['x']).defaultMachines.crafting).toBe('am1')
  })
})

describe('horizonDefaultMachines', () => {
  it('returns the static map itself without a limit', () => {
    const d = makeEquipmentData()
    const r = horizonDefaultMachines(d, null)
    expect(r, 'no limit keeps the static map').toBe(d.defaultMachines)
  })
  it('falls back to the fastest available visible machine, else drops the key', () => {
    const d = makeEquipmentData()
    const r = horizonDefaultMachines(d, computeHorizon(d, ['x']).machineIds)
    expect(r.crafting).toBe('am1')
    expect(r.smelting).toBe('furnace')
    expect('adv-smelting' in r, 'category with no machine in the horizon has no key').toBe(false)
  })
  it('keeps the static default when it is available', () => {
    const d = makeEquipmentData()
    const r = horizonDefaultMachines(d, computeHorizon(d, ['c']).machineIds)
    expect(r['adv-smelting']).toBe('adv-furnace')
    expect(r.crafting).toBe('am2')
  })
})

describe('applyDefaultMachineOverrides', () => {
  const all = null
  it('returns the defaults themselves when there are no overrides', () => {
    const d = makeEquipmentData()
    expect(applyDefaultMachineOverrides(d, all, d.defaultMachines, {})).toBe(d.defaultMachines)
  })
  it('replaces the default of the category with a valid override without mutating its inputs', () => {
    const d = makeEquipmentData()
    const defaults = { ...d.defaultMachines }
    const overrides = { crafting: 'am1' }
    const r = applyDefaultMachineOverrides(d, all, defaults, overrides)
    expect(r.crafting).toBe('am1')
    expect(r.smelting).toBe('furnace')
    expect(defaults.crafting, 'input defaults untouched').toBe('am2')
    expect(overrides).toEqual({ crafting: 'am1' })
  })
  it('ignores an override outside the horizon', () => {
    const d = makeEquipmentData()
    const ids = computeHorizon(d, ['x']).machineIds
    const defaults = horizonDefaultMachines(d, ids)
    expect(applyDefaultMachineOverrides(d, ids, defaults, { crafting: 'am2' })).toBe(defaults)
  })
  it('ignores hidden, unknown and wrong-category machines', () => {
    const d = makeEquipmentData()
    expect(applyDefaultMachineOverrides(d, all, d.defaultMachines, { crafting: 'hidden-fast' })).toBe(d.defaultMachines)
    expect(applyDefaultMachineOverrides(d, all, d.defaultMachines, { crafting: 'nope' })).toBe(d.defaultMachines)
    expect(applyDefaultMachineOverrides(d, all, d.defaultMachines, { crafting: 'furnace' })).toBe(d.defaultMachines)
  })
  it('applies without a limit (null machine ids)', () => {
    const d = makeEquipmentData()
    expect(applyDefaultMachineOverrides(d, null, d.defaultMachines, { 'adv-smelting': 'adv-furnace', crafting: 'orphan' }).crafting).toBe('orphan')
  })
})

describe('resolveRowMachine', () => {
  it('flags a category with no machine in the horizon', () => {
    const d = makeEquipmentData()
    const h = computeHorizon(d, ['x'])
    expect(resolveRowMachine(d, h, 'adv-smelting', undefined)).toEqual({
      machineId: undefined, machine: undefined, beyondHorizon: false, noMachineInHorizon: true,
    })
  })
  it('flags an explicit machine outside the horizon as beyond', () => {
    const d = makeEquipmentData()
    const r = resolveRowMachine(d, computeHorizon(d, ['x']), 'adv-smelting', 'adv-furnace')
    expect(r.machine?.id).toBe('adv-furnace')
    expect(r.beyondHorizon).toBe(true)
    expect(r.noMachineInHorizon).toBe(false)
  })
  it('uses the horizon default when no machine is explicit', () => {
    const d = makeEquipmentData()
    const r = resolveRowMachine(d, computeHorizon(d, ['x']), 'crafting', undefined)
    expect(r.machine?.id).toBe('am1')
    expect(r.beyondHorizon).toBe(false)
    expect(r.noMachineInHorizon).toBe(false)
  })
  it('does not flag a category the data has no default for', () => {
    const d = makeEquipmentData()
    const r = resolveRowMachine(d, computeHorizon(d, ['x']), 'unknown', undefined)
    expect(r.machine).toBeUndefined()
    expect(r.beyondHorizon).toBe(false)
    expect(r.noMachineInHorizon).toBe(false)
  })
  it('resolves the static default without a horizon', () => {
    const d = makeEquipmentData()
    const r = resolveRowMachine(d, computeHorizon(d, []), 'adv-smelting', undefined)
    expect(r.machine?.id).toBe('adv-furnace')
    expect(r.beyondHorizon).toBe(false)
    expect(r.noMachineInHorizon).toBe(false)
  })
})

describe('computeHorizon', () => {
  it('has no limit without targets', () => {
    const d = makeEquipmentData()
    const h = computeHorizon(d, [])
    expect([h.recipeIds, h.itemIds, h.machineIds, h.beaconIds, h.moduleIds]).toEqual([null, null, null, null, null])
    expect(h.defaultMachines).toBe(d.defaultMachines)
  })
  it('has no limit without technology data', () => {
    const d = makeEquipmentData()
    d.technologies = {}
    const h = computeHorizon(d, ['a'])
    expect([h.recipeIds, h.itemIds, h.machineIds, h.beaconIds, h.moduleIds]).toEqual([null, null, null, null, null])
  })
})

// ---------------------------------------------------------------------------
// Extraction recipes
// ---------------------------------------------------------------------------

describe('extraction recipes', () => {
  function makeExtractionData(): GameData {
    const d = makeEquipmentData()
    d.items['iron-ore'] = item('iron-ore')
    d.items['drill-item'] = item('drill-item', 'drill')
    d.recipes['r-drill'] = makeRecipe('r-drill', 'drill-item')
    d.technologies.b.unlockedRecipes.push('r-drill')
    d.recipes['mining:iron-ore'] = { ...makeRecipe('mining:iron-ore', 'iron-ore'), category: 'mining:basic-solid', extraction: true }
    d.machines.drill = { ...machine('drill', 'mining:basic-solid', 0.5), type: 'mining-drill' }
    d.defaultMachines['mining:basic-solid'] = 'drill'
    return d
  }

  it('availableRecipeIds includes an extraction recipe no technology unlocks', () => {
    const d = makeExtractionData()
    expect(availableRecipeIds(d, ['x'])!.has('mining:iron-ore')).toBe(true)
  })
  it('availableRecipeIds stays null without technology data', () => {
    const d = makeExtractionData()
    d.technologies = {}
    expect(availableRecipeIds(d, ['x'])).toBeNull()
  })
  it('availableItemIds keeps an ore only an extraction recipe produces', () => {
    const d = makeExtractionData()
    expect(computeHorizon(d, ['x']).itemIds!.has('iron-ore')).toBe(true)
  })
  it('availableMachineIds gates a drill through its placing item', () => {
    const d = makeExtractionData()
    expect(availableMachineIds(d, computeHorizon(d, ['a']).itemIds)!.has('drill')).toBe(false)
    expect(availableMachineIds(d, computeHorizon(d, ['b']).itemIds)!.has('drill')).toBe(true)
  })
  it('resolveRowMachine reports noMachineInHorizon while the drill item is outside the horizon', () => {
    const d = makeExtractionData()
    const early = computeHorizon(d, ['a'])
    expect(resolveRowMachine(d, early, 'mining:basic-solid', undefined).noMachineInHorizon).toBe(true)
    const later = computeHorizon(d, ['b'])
    const row = resolveRowMachine(d, later, 'mining:basic-solid', undefined)
    expect(row.noMachineInHorizon).toBe(false)
    expect(row.machineId).toBe('drill')
  })
})

describe('recipeUnlock', () => {
  const ids = (u: ReturnType<typeof recipeUnlock>) =>
    u && u.kind === 'technologies' ? u.technologies.map(t => t.id) : null
  const cost = (n: number) => ({
    ingredients: Array.from({ length: n }, (_, i) => ({ itemId: `p${i}`, amount: 1 })),
    count: 1,
    time: 1,
  })

  it('is null without technology data', () => {
    const gd = makeGameData()
    gd.technologies = {}
    expect(recipeUnlock(gd, 'r-a')).toBeNull()
  })
  it('reports a starting recipe as start, even when a technology also unlocks it', () => {
    const gd = makeGameData()
    expect(recipeUnlock(gd, 'r-start')).toEqual({ kind: 'start' })
    gd.technologies.a.unlockedRecipes.push('r-start')
    expect(recipeUnlock(gd, 'r-start')).toEqual({ kind: 'start' })
  })
  it('reports an extraction recipe as start', () => {
    const gd = makeGameData()
    gd.recipes['mining:iron-ore'] = { ...makeRecipe('mining:iron-ore', 'iron-ore'), extraction: true }
    expect(recipeUnlock(gd, 'mining:iron-ore')).toEqual({ kind: 'start' })
  })
  it('lists the unlocking technology', () => {
    expect(ids(recipeUnlock(makeGameData(), 'r-b'))).toEqual(['b'])
  })
  it('sorts equal technologies by name', () => {
    expect(ids(recipeUnlock(makeGameData(), 'r-shared'))).toEqual(['other', 'x'])
  })
  it('sorts by number of science-pack types first', () => {
    const gd = makeGameData()
    gd.technologies.x.cost = cost(1)
    gd.technologies.other.cost = cost(2)
    expect(ids(recipeUnlock(gd, 'r-shared'))).toEqual(['x', 'other'])
    gd.technologies.x.cost = cost(2)
    gd.technologies.other.cost = cost(1)
    expect(ids(recipeUnlock(gd, 'r-shared'))).toEqual(['other', 'x'])
  })
  it('sorts a trigger technology last', () => {
    const gd = makeGameData()
    gd.technologies.x.cost = null
    gd.technologies.other.cost = cost(3)
    expect(ids(recipeUnlock(gd, 'r-shared'))).toEqual(['other', 'x'])
  })
  it('reports none for a recipe nothing unlocks, even without a recipe entry', () => {
    expect(recipeUnlock(makeGameData(), 'orphan')).toEqual({ kind: 'none' })
  })
})

describe('technologyUnlocks', () => {
  const ids = (xs: { id: string }[]) => xs.map(x => x.id)

  it('lists the recipes and the machines and beacons they produce items for', () => {
    const d = makeEquipmentData()
    const a = technologyUnlocks(d, 'a')
    expect(ids(a.recipes)).toEqual(['r-am2'])
    expect(ids(a.machines)).toEqual(['am2'])
    // The beacon is included, the module is not.
    const b = technologyUnlocks(d, 'b')
    expect(ids(b.recipes)).toEqual(['r-speed', 'r-beacon'])
    expect(ids(b.machines)).toEqual(['beacon'])
  })

  it('is empty for a technology without recipes and for an unknown id', () => {
    const d = makeEquipmentData()
    expect(technologyUnlocks(d, 'x')).toEqual({ recipes: [], machines: [] })
    expect(technologyUnlocks(d, 'nope')).toEqual({ recipes: [], machines: [] })
  })

  it('leaves out hidden recipes, also for the machine lookup', () => {
    const d = makeEquipmentData()
    d.recipes['r-am2'].hidden = true
    expect(technologyUnlocks(d, 'a')).toEqual({ recipes: [], machines: [] })
  })

  it('leaves out hidden machines', () => {
    const d = makeEquipmentData()
    d.machines.am2.hidden = true
    const a = technologyUnlocks(d, 'a')
    expect(ids(a.recipes)).toEqual(['r-am2'])
    expect(a.machines).toEqual([])
  })

  it('skips recipe ids missing from the bundle', () => {
    const d = makeEquipmentData()
    d.technologies.a.unlockedRecipes = ['gone', 'r-am2']
    expect(ids(technologyUnlocks(d, 'a').recipes)).toEqual(['r-am2'])
  })

  it('falls back to the item with the same id when no item has placeResult', () => {
    const d = makeEquipmentData()
    for (const i of Object.values(d.items)) delete i.placeResult
    expect(ids(technologyUnlocks(d, 'a').machines)).toEqual(['am2'])
  })

  it('lists a machine once when several recipes produce it', () => {
    const d = makeEquipmentData()
    d.recipes['r-am2b'] = makeRecipe('r-am2b', 'am2')
    d.technologies.a.unlockedRecipes = ['r-am2', 'r-am2b']
    expect(ids(technologyUnlocks(d, 'a').machines)).toEqual(['am2'])
  })

  it('keeps the order of unlockedRecipes', () => {
    const d = makeEquipmentData()
    d.technologies.b.unlockedRecipes = ['r-beacon', 'r-speed']
    expect(ids(technologyUnlocks(d, 'b').recipes)).toEqual(['r-beacon', 'r-speed'])
  })
})
