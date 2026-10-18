import { describe, it, expect } from 'vitest'
import { hasTechnologies, technologyClosure, availableRecipeIds } from './horizon'
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
