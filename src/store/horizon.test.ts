import { describe, it, expect } from 'vitest'
import { horizonFor } from './horizon'
import type { GameData } from '../data/types'

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
    technologies: {},
    startingRecipes: [],
  }
}

describe('horizonFor', () => {
  it('returns the same object for the same gameData and targets array', () => {
    const d = makeGameData()
    const targets = ['a']
    expect(horizonFor(d, targets)).toBe(horizonFor(d, targets))
  })
  it('recomputes for a new targets array and for a different gameData', () => {
    const d = makeGameData()
    const first = horizonFor(d, ['a'])
    expect(horizonFor(d, ['a'])).not.toBe(first)
    const targets = ['a']
    expect(horizonFor(makeGameData(), targets)).not.toBe(horizonFor(d, targets))
  })
})
