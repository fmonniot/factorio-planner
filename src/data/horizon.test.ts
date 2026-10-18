import { describe, it, expect } from 'vitest'
import { hasTechnologies, technologyClosure, availableRecipeIds, availableItemIds } from './horizon'
import type { GameData } from './types'

function tech(id: string, prerequisites: string[] = [], unlockedRecipes: string[] = []) {
  return { id, name: id, prerequisites, unlockedRecipes }
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
    data.items = Object.fromEntries(['raw', 'inside', 'outside', 'mixed', 'secret'].map(id => [id, item(id)]))
    data.recipes = Object.fromEntries([
      recipe('r-inside', ['inside']),
      recipe('r-outside', ['outside']),
      recipe('r-mixed-in', ['mixed']),
      recipe('r-mixed-out', ['mixed']),
      recipe('r-secret', ['secret'], true),
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

  it('keeps items produced by a hidden recipe', () => {
    expect(availableItemIds(makeItemsData(), new Set())?.has('secret')).toBe(true)
  })
})
