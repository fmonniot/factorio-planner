import { describe, it, expect } from 'vitest'
import { luaList, exportTechnologies, technologyCost, researchTrigger, attachTechnologyIcons } from '../technologies.js'

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
        unit: { count: 10, time: 15, ingredients: [['automation-science-pack', 1]] },
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
    expect(technologies.military).toEqual({ id: 'military', name: 'Name of military', prerequisites: [], unlockedRecipes: [], cost: null })
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

describe('technologyCost', () => {
  it('reads the pair form', () => {
    expect(technologyCost({ unit: { count: 10, ingredients: [['automation-science-pack', 1]], time: 15 } }))
      .toEqual({ ingredients: [{ itemId: 'automation-science-pack', amount: 1 }], count: 10, time: 15 })
  })
  it('reads the object form', () => {
    expect(technologyCost({ unit: { count: 5, ingredients: [{ type: 'item', name: 'x', amount: 2 }], time: 1 } }).ingredients)
      .toEqual([{ itemId: 'x', amount: 2 }])
  })
  it('turns empty ingredients into []', () => {
    expect(technologyCost({ unit: { count: 1, time: 1, ingredients: {} } }).ingredients).toEqual([])
  })
  it('gives a null count for count_formula and keeps ingredients and time', () => {
    expect(technologyCost({ unit: { count_formula: '2^L', time: 30, ingredients: [['a', 1]] } }))
      .toEqual({ ingredients: [{ itemId: 'a', amount: 1 }], count: null, time: 30 })
  })
  it('returns null without a unit', () => {
    expect(technologyCost({ research_trigger: {} })).toBeNull()
  })
  it('filters out amounts of 0', () => {
    expect(technologyCost({ unit: { count: 1, time: 1, ingredients: [['a', 0], ['b', 1]] } }).ingredients)
      .toEqual([{ itemId: 'b', amount: 1 }])
  })
})

describe('researchTrigger', () => {
  it('reads craft-item with a count', () => {
    const r = researchTrigger({ research_trigger: { type: 'craft-item', item: 'steel-plate', count: 10 } })
    expect(r, 'craft-item with count').toEqual({ type: 'craft-item', item: 'steel-plate', count: 10 })
  })
  it('leaves count out when craft-item has none', () => {
    const r = researchTrigger({ research_trigger: { type: 'craft-item', item: 'wood' } })
    expect(r, 'no count').toEqual({ type: 'craft-item', item: 'wood' })
    expect(r && 'count' in r, 'no count key').toBe(false)
  })
  it('reads mine-entity', () => {
    const r = researchTrigger({ research_trigger: { type: 'mine-entity', entity: 'crude-oil' } })
    expect(r, 'mine-entity').toEqual({ type: 'mine-entity', entity: 'crude-oil' })
  })
  it('reads build-entity with entity and count', () => {
    const r = researchTrigger({ research_trigger: { type: 'build-entity', entity: 'boiler', count: 2 } })
    expect(r, 'build-entity').toEqual({ type: 'build-entity', entity: 'boiler', count: 2 })
  })
  it('turns the amount of craft-fluid into count', () => {
    const r = researchTrigger({ research_trigger: { type: 'craft-fluid', fluid: 'water', amount: 100 } })
    expect(r, 'craft-fluid').toEqual({ type: 'craft-fluid', fluid: 'water', count: 100 })
  })
  it('accepts an id given as an object and drops quality', () => {
    const r = researchTrigger({ research_trigger: { type: 'craft-item', item: { name: 'x', quality: 'normal' } } })
    expect(r, 'object id').toEqual({ type: 'craft-item', item: 'x' })
  })
  it('allows capture-spawner without an entity', () => {
    expect(researchTrigger({ research_trigger: { type: 'capture-spawner' } }), 'bare').toEqual({ type: 'capture-spawner' })
  })
  it('returns null without a usable trigger', () => {
    expect(researchTrigger({}), 'missing').toBeNull()
    expect(researchTrigger({ research_trigger: 'craft-item' }), 'non-object').toBeNull()
    expect(researchTrigger({ research_trigger: { item: 'x' } }), 'typeless').toBeNull()
  })
  it('passes an unknown type through', () => {
    expect(researchTrigger({ research_trigger: { type: 'scripted' } }), 'unknown').toEqual({ type: 'scripted' })
  })
})

describe('exportTechnologies — trigger', () => {
  function rawWithTriggers() {
    const raw = makeRaw()
    raw.technology.electronics.research_trigger = { type: 'craft-item', item: 'iron-plate', count: 5 }
    raw.technology['sct-lab-t1'] = {
      name: 'sct-lab-t1',
      unit: { count: 1, time: 1, ingredients: [['automation-science-pack', 1]] },
      research_trigger: { type: 'craft-item', item: 'iron-plate' },
      effects: [{ type: 'unlock-recipe', recipe: 'gear' }],
    }
    return raw
  }

  it('exports the trigger of a technology without a unit', () => {
    const { technologies } = exportTechnologies(rawWithTriggers(), ids, resolveName)
    expect(technologies.electronics.trigger).toEqual({ type: 'craft-item', item: 'iron-plate', count: 5 })
  })
  it('does not export the trigger when the technology has a unit', () => {
    const { technologies } = exportTechnologies(rawWithTriggers(), ids, resolveName)
    expect(technologies['sct-lab-t1'].cost, 'keeps its cost').not.toBeNull()
    expect('trigger' in technologies['sct-lab-t1'], 'no trigger key').toBe(false)
  })
  it('adds no trigger key to a normal technology', () => {
    const { technologies } = exportTechnologies(rawWithTriggers(), ids, resolveName)
    expect('trigger' in technologies.radar, 'no trigger key').toBe(false)
  })
  it('keeps the trigger when icons are attached', async () => {
    const { technologies } = exportTechnologies(rawWithTriggers(), ids, resolveName)
    const out = await attachTechnologyIcons(technologies, rawWithTriggers(), async () => '/i.png')
    expect(out.electronics.trigger).toEqual({ type: 'craft-item', item: 'iron-plate', count: 5 })
  })
})

describe('exportTechnologies — cost', () => {
  it('exports the cost, null for a trigger technology', () => {
    const { technologies } = exportTechnologies(makeRaw(), ids, resolveName)
    expect(technologies.radar.cost).toEqual({
      ingredients: [{ itemId: 'automation-science-pack', amount: 1 }], count: 10, time: 15,
    })
    expect(technologies.electronics.cost).toBeNull()
  })
})

describe('attachTechnologyIcons', () => {
  const resolve = async (p, id) => '/x/' + id + '.png'
  const techs = () => ({ a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } })

  it('sets iconPath from the resolver', async () => {
    const out = await attachTechnologyIcons(techs(), { technology: { a: {}, b: {} } }, resolve)
    expect(out.a.iconPath).toBe('/x/a.png')
    expect(out.b.iconPath).toBe('/x/b.png')
  })
  it('uses an empty path for an id missing from the dump', async () => {
    const out = await attachTechnologyIcons(techs(), { technology: { a: {} } }, resolve)
    expect(out.b.iconPath).toBe('')
  })
  it('keeps an empty path returned by the resolver', async () => {
    const out = await attachTechnologyIcons(techs(), { technology: { a: {}, b: {} } }, async () => '')
    expect(out.a.iconPath).toBe('')
  })
  it('does not mutate its input', async () => {
    const input = techs()
    const copy = structuredClone(input)
    await attachTechnologyIcons(input, { technology: { a: {}, b: {} } }, resolve)
    expect(input).toEqual(copy)
  })
})
