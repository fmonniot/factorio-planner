import { describe, it, expect } from 'vitest'
import { sourcingText, itemMakers, itemConnections, type SourcingTextInput, type ItemMaker } from './sourcingText'
import { makeEmptyBlock } from '../../store/blockStore'
import type { GameData, SolverResult, GameRecipeNode } from '../../data/types'

const maker = (over: Partial<ItemMaker> = {}): ItemMaker => ({
  recipeName: 'Plastic bar', machineName: 'Chemical plant', machineCount: 1, rate: 60, byproduct: false, ...over,
})

const input = (over: Partial<SourcingTextInput> = {}): SourcingTextInput => ({
  itemName: 'Plastic bar', itemId: 'plastic', rule: undefined, makers: [], connections: [], unit: 'min', ...over,
})

const OFF = { importOff: true } as const

describe('sourcingText — Make it here', () => {
  it('names the rows that make the item with their machines', () => {
    expect(sourcingText(input({ makers: [maker({ machineCount: 2 })] }))).toBe('Made here by Plastic bar (2 × Chemical plant).')
  })

  it('lists several rows', () => {
    const makers = [maker(), maker({ recipeName: 'Plastic from coal', machineName: 'Assembler', machineCount: 3 })]
    expect(sourcingText(input({ makers }))).toBe(
      'Made here by Plastic bar (1 × Chemical plant) and Plastic from coal (3 × Assembler).',
    )
  })

  it('says the item is imported when no row makes it', () => {
    expect(sourcingText(input())).toBe('No row here makes Plastic bar; it is imported.')
  })

  it('appends that Import is off', () => {
    expect(sourcingText(input({ rule: OFF }))).toBe('No row here makes Plastic bar; it is imported. Import is off.')
    expect(sourcingText(input({ rule: OFF, makers: [maker()] }))).toBe(
      'Made here by Plastic bar (1 × Chemical plant). Import is off.',
    )
  })
})

describe("sourcingText — Don't make more here", () => {
  const rule = { makeHere: 'off' } as const
  const ruleOff = { makeHere: 'off', importOff: true } as const
  const used = [maker({ recipeName: 'Coal liquefaction', byproduct: true, rate: 30 })]
  const conn = { blockName: 'Plastics block', offered: 120, taken: 100 }
  const conns = [conn, { blockName: 'Oil', offered: 30, taken: 0 }]

  it('rows make it, no connection, Import on', () => {
    expect(sourcingText(input({ rule, makers: used }))).toBe(
      'Uses what this block already makes (Coal liquefaction 30.0/m). The rest is imported.',
    )
  })

  it('rows make it, a connection, Import on', () => {
    expect(sourcingText(input({ rule, makers: used, connections: conns }))).toBe(
      'Uses what this block already makes (Coal liquefaction 30.0/m), then takes from Plastics block and Oil. The rest is imported.',
    )
  })

  it('no row makes it, no connection, Import on', () => {
    expect(sourcingText(input({ rule }))).toBe('No row here already makes Plastic bar; it is imported.')
  })

  it('no row makes it, a connection, Import on', () => {
    expect(sourcingText(input({ rule, connections: [conn] }))).toBe(
      'No row here already makes Plastic bar; it is taken from Plastics block, and the rest is imported.',
    )
  })

  it('Import off: the last clause says the rest is missing', () => {
    expect(sourcingText(input({ rule: ruleOff, makers: used }))).toBe(
      'Uses what this block already makes (Coal liquefaction 30.0/m). The rest is missing: Import is off.',
    )
    expect(sourcingText(input({ rule: ruleOff, makers: used, connections: conns }))).toBe(
      'Uses what this block already makes (Coal liquefaction 30.0/m), then takes from Plastics block and Oil. The rest is missing: Import is off.',
    )
    expect(sourcingText(input({ rule: ruleOff }))).toBe('No row here already makes Plastic bar; it is missing: Import is off.')
    expect(sourcingText(input({ rule: ruleOff, connections: [conn] }))).toBe(
      'No row here already makes Plastic bar; it is taken from Plastics block, and the rest is missing: Import is off.',
    )
  })

  it('lists every row that makes the item at a rate above 0, whatever its product, and skips idle rows', () => {
    const makers = [maker({ rate: 12 }), used[0], maker({ recipeName: 'Idle', rate: 0 })]
    expect(sourcingText(input({ rule, makers }))).toBe(
      'Uses what this block already makes (Plastic bar 12.0/m, Coal liquefaction 30.0/m). The rest is imported.',
    )
    expect(sourcingText(input({ rule, makers: [maker({ rate: 0 })] }))).toBe('No row here already makes Plastic bar; it is imported.')
  })

  it('names the byproduct rows without a rate when there is no solve', () => {
    expect(sourcingText(input({ rule, makers: [maker(), used[0]], solved: false }))).toBe(
      'Uses what this block already makes (Coal liquefaction). The rest is imported.',
    )
  })

  it('formats the rates in the rate unit', () => {
    expect(sourcingText(input({ rule, makers: used, unit: 'sec' }))).toContain('Coal liquefaction 0.50/s')
  })
})

describe('sourcingText — Receive it first', () => {
  const rule = { makeHere: 'after-blocks' } as const
  const conn = { blockName: 'Plastics block', offered: 120, taken: 100 }

  it('names the connection and the rows that make the rest', () => {
    expect(sourcingText(input({ rule, makers: [maker()], connections: [conn] }))).toBe(
      'Taken from Plastics block first (120/m offered), then Plastic bar makes the rest.',
    )
  })

  it('drops the second half when the connection covers everything', () => {
    expect(sourcingText(input({ rule, makers: [maker({ rate: 0 })], connections: [conn] }))).toBe(
      'Taken from Plastics block first (120/m offered).',
    )
    expect(sourcingText(input({ rule, connections: [conn] }))).toBe('Taken from Plastics block first (120/m offered).')
  })

  it('sums the offers of several connections', () => {
    const connections = [conn, { blockName: 'Oil', offered: 30, taken: 0 }]
    expect(sourcingText(input({ rule, connections }))).toBe('Taken from Plastics block and Oil first (150/m offered).')
  })

  it('says so when there is no connection', () => {
    expect(sourcingText(input({ rule, makers: [maker()] }))).toBe('No connection for Plastic bar; Plastic bar covers it.')
    expect(sourcingText(input({ rule }))).toBe('No connection for Plastic bar; it is imported.')
  })
})

describe('sourcingText — Import is off', () => {
  const conn = { blockName: 'Plastics block', offered: 120, taken: 100 }
  const after = { makeHere: 'after-blocks' } as const

  it('is appended to the sentence of Make it here and Receive it first, in every branch', () => {
    const cases: Partial<SourcingTextInput>[] = [
      { rule: undefined }, { rule: undefined, makers: [maker()] },
      { rule: after }, { rule: after, makers: [maker()] },
      { rule: after, connections: [conn] }, { rule: after, makers: [maker()], connections: [conn] },
    ]
    for (const over of cases) {
      const off = { ...over.rule, importOff: true as const }
      expect(sourcingText(input({ ...over, rule: off })), JSON.stringify(over)).toBe(`${sourcingText(input(over))} Import is off.`)
    }
  })
})

describe('itemMakers and itemConnections', () => {
  function gameData(): GameData {
    return {
      factorioVersion: '2.0.0', modSet: {}, items: {},
      recipes: {
        a: {
          id: 'a', name: 'A', category: 'c', craftingTime: 1, ingredients: [], madeIn: [], allowProductivity: false, hidden: false,
          mainProduct: undefined, subgroup: '', order: '',
          products: [{ itemId: 'x', type: 'item', amount: 1 }, { itemId: 'y', type: 'item', amount: 1 }],
        },
      },
      machines: { m: { id: 'm', name: 'Machine', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric', drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['c'], iconPath: '', hidden: false } },
      modules: {}, beacons: {}, defaultMachines: { c: 'm' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
    }
  }
  const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'a', modules: [], byproductPolicy: {} }

  it('marks the co-product of a row as a byproduct and reads the solved rate and machines', () => {
    const block = makeEmptyBlock('B')
    block.rootPlan.nodes = [node]
    const result: SolverResult = {
      nodes: [{ recipeNodeId: 'n1', inputRates: {}, outputRates: { x: 60, y: 30 }, throughput: 60, machineCountExact: 1.5, machineCountCeil: 2, powerKw: 0 }],
      unsatisfied: [], warnings: [],
    }
    expect(itemMakers(block, gameData(), result, 'x')).toEqual([
      { recipeName: 'A', machineName: 'Machine', machineCount: 2, rate: 60, byproduct: false },
    ])
    expect(itemMakers(block, gameData(), result, 'y')[0]).toMatchObject({ byproduct: true, rate: 30 })
    expect(itemMakers(block, gameData(), result, 'z')).toEqual([])
  })

  it('reads the offered and taken rates of the connections that deliver the item', () => {
    const block = makeEmptyBlock('B')
    const source = makeEmptyBlock('Source')
    block.inputConnections = [{ id: 'c1', itemId: 'x', fromBlockId: source.id }, { id: 'c2', itemId: 'q', fromBlockId: source.id }]
    const flows = [{
      connectionId: 'c1', fromBlockId: source.id, toBlockId: block.id, itemId: 'x', available: 40, capped: false, rate: 10, status: 'ok' as const, kind: 'take' as const,
    }]
    expect(itemConnections(block, [block, source], flows, 'x')).toEqual([{ blockName: 'Source', offered: 40, taken: 10 }])
  })
})
