import { describe, it, expect } from 'vitest'
import type { GameData, Recipe, SolverWarning, SubPlan } from '../../data/types'
import { warningTargets } from './warningTargets'

const recipe = (id: string, name: string, min: number): Recipe => ({
  id, name, category: 'power', craftingTime: 1,
  ingredients: [{ itemId: 'steam', type: 'fluid', amount: 1, minimumTemperature: min }],
  products: [], madeIn: [], allowProductivity: false, hidden: false,
} as unknown as Recipe)

const gameData = {
  items: { steam: { id: 'steam', name: 'Steam' } },
  recipes: { turbine: recipe('turbine', 'Steam turbine', 465), engine: recipe('engine', 'Steam engine', 165) },
} as unknown as GameData

const row = (id: string, recipeId: string) => ({ kind: 'game-recipe', id, recipeId })
const plan = (...nodes: ReturnType<typeof row>[]): SubPlan =>
  ({ id: 'root', name: 'root', nodes, subPlans: [], createdAt: '', updatedAt: '' }) as unknown as SubPlan

const warning: SolverWarning = {
  type: 'connection-temperature',
  connections: [{ connectionId: 'c1', itemId: 'steam', offered: [{ temperature: 165, rate: 10 }], needed: [{ min: 465, rate: 10 }] }],
}
const links = [{ id: 'c1', fromBlockId: 'boilers' }]
const name = (id: string) => (id === 'boilers' ? 'Boilers' : id)

describe('warningTargets of a connection-temperature warning', () => {
  it('links the source block, then the rows that need the range', () => {
    const t = warningTargets(warning, plan(row('n1', 'turbine'), row('n2', 'engine')), gameData, name, undefined, links)
    expect(t).toEqual([
      { kind: 'block', label: 'Go to Boilers', blockId: 'boilers' },
      { kind: 'row', label: 'Go to Steam turbine', nodeId: 'n1' },
    ])
  })

  it('gives a recipe of two rows one link', () => {
    const t = warningTargets(warning, plan(row('n1', 'turbine'), row('n2', 'turbine')), gameData, name, undefined, links)
    expect(t.filter(x => x.kind === 'row')).toEqual([{ kind: 'row', label: 'Go to Steam turbine', nodeId: 'n1' }])
  })

  it('links only the source block without a plan', () => {
    expect(warningTargets(warning, undefined, gameData, name, undefined, links)).toEqual([
      { kind: 'block', label: 'Go to Boilers', blockId: 'boilers' },
    ])
  })
})

describe.each(['unbounded-absorber', 'absorber-idle'] as const)('warningTargets of an %s warning', type => {
  it('links each row once', () => {
    const w: SolverWarning = { type, recipeIds: ['turbine', 'turbine', 'engine'] }
    const t = warningTargets(w, plan(row('n1', 'turbine'), row('n2', 'engine')), gameData, name, undefined, links)
    expect(t).toEqual([
      { kind: 'row', label: 'Go to Steam turbine', nodeId: 'n1' },
      { kind: 'row', label: 'Go to Steam engine', nodeId: 'n2' },
    ])
  })
})

describe('warningTargets of an unbounded-source warning', () => {
  it('links each source block, with or without a plan', () => {
    const w: SolverWarning = { type: 'unbounded-source', blockIds: ['boilers'] }
    const expected = [{ kind: 'block', label: 'Go to Boilers', blockId: 'boilers' }]
    expect(warningTargets(w, undefined, gameData, name, undefined, links)).toEqual(expected)
    expect(warningTargets(w, plan(row('n1', 'turbine')), gameData, name, undefined, links)).toEqual(expected)
  })
})
