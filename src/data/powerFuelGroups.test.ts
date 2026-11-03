import { describe, it, expect } from 'vitest'
import { groupPowerRecipes, powerInputItemId } from './powerFuelGroups'
import type { Recipe } from './types'

function recipe(id: string, madeIn: string[], opts: { power?: boolean; ingredients?: string[] } = {}): Recipe {
  return {
    id, name: id, category: 'c', craftingTime: 1,
    ingredients: (opts.ingredients ?? []).map(itemId => ({ itemId, type: 'item' as const, amount: 1 })),
    products: [{ itemId: 'steam', type: 'fluid' as const, amount: 1 }],
    madeIn, allowProductivity: false, hidden: false, mainProduct: null,
    subgroup: 's', order: '', ...(opts.power ? { power: true } : {}),
  }
}

const power = (id: string, machine: string, fuel = 'coal') => recipe(id, [machine], { power: true, ingredients: ['water', fuel] })

describe('groupPowerRecipes', () => {
  it('collapses the recipes of one machine into a group, in input order', () => {
    const rs = [power('a', 'boiler', 'coal'), power('b', 'boiler', 'wood'), power('c', 'boiler', 'oil')]
    const out = groupPowerRecipes(rs)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ kind: 'fuel-group', machineId: 'boiler', recipes: rs })
  })

  it('keeps a single power recipe plain', () => {
    const r = power('a', 'boiler')
    expect(groupPowerRecipes([r])).toEqual([{ kind: 'recipe', recipe: r }])
  })

  it('places a group at its first member and keeps other entries in order', () => {
    const boilerCoal = power('boiler-coal', 'boiler')
    const iron = recipe('iron', ['furnace'])
    const boilerWood = power('boiler-wood', 'boiler', 'wood')
    const engine = power('engine', 'steam-engine', 'steam')
    const boiler2Coal = power('boiler2-coal', 'boiler-2')
    const boiler2Wood = power('boiler2-wood', 'boiler-2', 'wood')
    const out = groupPowerRecipes([boilerCoal, iron, boilerWood, engine, boiler2Coal, boiler2Wood])
    expect(out).toEqual([
      { kind: 'fuel-group', machineId: 'boiler', recipes: [boilerCoal, boilerWood] },
      { kind: 'recipe', recipe: iron },
      { kind: 'recipe', recipe: engine },
      { kind: 'fuel-group', machineId: 'boiler-2', recipes: [boiler2Coal, boiler2Wood] },
    ])
  })

  it('does not group non-power recipes sharing a machine', () => {
    const out = groupPowerRecipes([recipe('a', ['furnace']), recipe('b', ['furnace'])])
    expect(out.map(e => e.kind)).toEqual(['recipe', 'recipe'])
  })

  it('keeps a power recipe without a machine plain', () => {
    const out = groupPowerRecipes([recipe('a', [], { power: true }), recipe('b', [], { power: true })])
    expect(out.map(e => e.kind)).toEqual(['recipe', 'recipe'])
  })

  it('returns an empty list for an empty input', () => {
    expect(groupPowerRecipes([])).toEqual([])
  })

  it('does not mutate the input and keeps recipe references', () => {
    const rs = [power('a', 'boiler'), power('b', 'boiler', 'wood')]
    const copy = [...rs]
    const out = groupPowerRecipes(rs)
    expect(rs).toEqual(copy)
    const group = out[0]
    if (group.kind !== 'fuel-group') throw new Error('expected a group')
    expect(group.recipes[0]).toBe(rs[0])
    expect(group.recipes[1]).toBe(rs[1])
  })
})

describe('powerInputItemId', () => {
  it('is the last ingredient of a power recipe', () => {
    expect(powerInputItemId(power('a', 'boiler', 'wood'))).toBe('wood')
    expect(powerInputItemId(power('h', 'heat-exchanger', 'power:heat'))).toBe('power:heat')
  })

  it('is undefined without an ingredient or for a non-power recipe', () => {
    expect(powerInputItemId(recipe('solar', ['solar-panel'], { power: true }))).toBeUndefined()
    expect(powerInputItemId(recipe('iron', ['furnace'], { ingredients: ['ore'] }))).toBeUndefined()
  })
})
