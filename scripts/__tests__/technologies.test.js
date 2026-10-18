import { describe, it, expect } from 'vitest'
import { luaList, exportTechnologies } from '../technologies.js'

// ---------------------------------------------------------------------------
// Helpers — each call returns a fresh dump
// ---------------------------------------------------------------------------

function makeRaw() {
  return {
    recipe: {
      'iron-plate': {},
      'gear': { enabled: true },
      'circuit': { enabled: false },
      'rocket': { enabled: false },
      'outside': {},
    },
    technology: {
      electronics: {
        name: 'electronics',
        effects: [{ type: 'unlock-recipe', recipe: 'circuit' }],
      },
      military: { name: 'military', effects: {} },
      radar: {
        name: 'radar',
        prerequisites: ['military'],
        effects: [{ type: 'unlock-recipe', recipe: 'rocket' }],
      },
    },
  }
}

const ids = new Set(['iron-plate', 'gear', 'circuit', 'rocket'])
const resolveName = p => `Name of ${p.name}`

describe('luaList', () => {
  it('passes arrays through', () => {
    expect(luaList(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('turns {} and undefined into []', () => {
    expect(luaList({})).toEqual([])
    expect(luaList(undefined)).toEqual([])
  })
  it('returns the values of a non-empty object', () => {
    expect(luaList({ 1: 'a', 2: 'b' })).toEqual(['a', 'b'])
  })
})

describe('exportTechnologies — technologies', () => {
  it('drops disabled technologies and references to them', () => {
    const raw = makeRaw()
    raw.technology.secret = { name: 'secret', enabled: false, effects: [{ type: 'unlock-recipe', recipe: 'gear' }] }
    raw.technology.radar.prerequisites = ['secret']
    const { technologies } = exportTechnologies(raw, ids, resolveName)
    expect(technologies.secret).toBeUndefined()
    expect(technologies.radar).toBeUndefined()
    expect(Object.values(technologies).flatMap(t => t.unlockedRecipes)).not.toContain('gear')
  })

  it('drops technologies with a disabled prerequisite, directly and transitively', () => {
    const raw = makeRaw()
    raw.technology.secret = { name: 'secret', enabled: false, effects: [] }
    raw.technology.electronics.prerequisites = ['secret']
    raw.technology.radar.prerequisites = ['electronics']
    raw.technology.other = { name: 'other', effects: [{ type: 'unlock-recipe', recipe: 'gear' }] }
    const { technologies } = exportTechnologies(raw, ids, resolveName)
    expect(technologies.electronics).toBeUndefined()
    expect(technologies.radar).toBeUndefined()
    expect(Object.values(technologies).flatMap(t => t.unlockedRecipes)).toEqual(['gear'])
    for (const t of Object.values(technologies)) {
      expect(t.prerequisites).not.toContain('electronics')
      expect(t.prerequisites).not.toContain('radar')
    }
  })

  it('terminates on prerequisite cycles', () => {
    const raw = makeRaw()
    raw.technology.electronics.prerequisites = ['radar']
    raw.technology.radar.prerequisites = ['electronics']
    expect(() => exportTechnologies(raw, ids, resolveName)).not.toThrow()
  })

  it('keeps a non-unlocking prerequisite of an unlocking technology but drops a non-unlocking leaf', () => {
    const raw = makeRaw()
    raw.technology.bonus = { name: 'bonus', effects: [{ type: 'laboratory-speed', modifier: 0.2 }] }
    const { technologies } = exportTechnologies(raw, ids, resolveName)
    expect(technologies.military).toEqual({ id: 'military', name: 'Name of military', prerequisites: [], unlockedRecipes: [] })
    expect(technologies.bonus).toBeUndefined()
  })

  it('filters unknown recipes and other effects, and de-duplicates unlocks', () => {
    const raw = makeRaw()
    raw.technology.electronics.effects = [
      { type: 'unlock-recipe', recipe: 'circuit' },
      { type: 'unlock-recipe', recipe: 'circuit' },
      { type: 'unlock-recipe', recipe: 'outside' },
      { type: 'give-item', item: 'gear' },
    ]
    const { technologies } = exportTechnologies(raw, ids, resolveName)
    expect(technologies.electronics.unlockedRecipes).toEqual(['circuit'])
  })

  it('treats {} effects and prerequisites as empty lists', () => {
    const raw = makeRaw()
    raw.technology.electronics.prerequisites = {}
    raw.technology.radar.prerequisites = {}
    const { technologies } = exportTechnologies(raw, ids, resolveName)
    expect(technologies.electronics.prerequisites).toEqual([])
    expect(technologies.radar.prerequisites).toEqual([])
    expect(technologies.military).toBeUndefined()
  })

  it('names a technology with the resolver result', () => {
    const { technologies } = exportTechnologies(makeRaw(), ids, resolveName)
    expect(technologies.electronics.name).toBe('Name of electronics')
  })
})

describe('exportTechnologies — startingRecipes', () => {
  it('counts a missing enabled flag as starting, excludes enabled:false and unknown ids, and sorts', () => {
    const { startingRecipes } = exportTechnologies(makeRaw(), ids, resolveName)
    expect(startingRecipes).toEqual(['gear', 'iron-plate'])
  })

  it('does not count a bundle recipe that is absent from the dump', () => {
    const raw = makeRaw()
    const { startingRecipes } = exportTechnologies(raw, new Set([...ids, 'ghost']), resolveName)
    expect(startingRecipes).not.toContain('ghost')
  })
})
