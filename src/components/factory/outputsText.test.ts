import { describe, it, expect } from 'vitest'
import { outputText, itemConsumers, itemReceivers, itemLeftover, countOtherMakers, tagReaches, type OutputTextInput } from './outputsText'
import { exportedByKey, leftoverByKey } from './summaryRows'
import { netBalance, grossFlow } from '../../solver/index'
import { indexRecipeAreas } from './recipeAreas'
import { makeEmptyBlock } from '../../store/blockStore'
import type { Block, ConnectionFlow, GameData, GameRecipeNode, SolvedNode, SolverResult, SubPlan } from '../../data/types'

const base = (over: Partial<OutputTextInput> = {}): OutputTextInput => ({
  itemId: 'plate', itemName: 'Iron Plate', unit: 'min', solved: true, rate: 120, discarded: false, product: false,
  consumers: [], receivers: [], leftover: 0, otherMakers: 0, ...over,
})

describe('outputText', () => {
  it('says there is no solve yet', () => {
    expect(outputText(base({ solved: false }))).toBe('Not solved yet.')
  })

  it('says a discarded output is not counted, whatever uses the item', () => {
    const text = outputText(base({ discarded: true, consumers: [{ recipeName: 'Gear', rate: 10, absorber: false }] }))
    expect(text).toBe("Discarded: this row's Iron Plate is not counted, so no row or block takes it from here.")
  })

  it('says a row that makes none does not produce it', () => {
    expect(outputText(base({ rate: 0 }))).toBe('Not produced: this row makes no Iron Plate at the moment.')
  })

  it('names the row that uses the item with its rate', () => {
    expect(outputText(base({ consumers: [{ recipeName: 'Gear', rate: 120, absorber: false }] }))).toBe('Used here by Gear (takes 120/m).')
  })

  it('joins several rows with "and"', () => {
    const consumers = [{ recipeName: 'Gear', rate: 120, absorber: false }, { recipeName: 'Pipe', rate: 30, absorber: false }]
    expect(outputText(base({ consumers }))).toBe('Used here by Gear (takes 120/m) and Pipe (takes 30.0/m).')
  })

  it('marks a row that absorbs a byproduct', () => {
    expect(outputText(base({ consumers: [{ recipeName: 'Gear', rate: 120, absorber: true }] }))).toContain('Gear (absorber, takes 120/m)')
  })

  it('names the area of a row in another area', () => {
    expect(outputText(base({ consumers: [{ recipeName: 'Gear', rate: 120, absorber: false, areaName: 'Other' }] }))).toBe('Used here by Gear in Other (takes 120/m).')
  })

  it('names the blocks the item is sent to', () => {
    expect(outputText(base({ receivers: [{ blockName: 'Gears', rate: 30 }] }))).toBe('Sent to Gears (30.0/m).')
  })

  it('puts the rows, the blocks and the leftover in one sentence', () => {
    const text = outputText(base({
      consumers: [{ recipeName: 'A', rate: 10, absorber: false }], receivers: [{ blockName: 'B', rate: 5 }], leftover: 3,
    }))
    expect(text).toBe('Used here by A (takes 10.0/m); Sent to B (5.00/m); 3.00/m left over.')
  })

  it('starts with the product mark', () => {
    expect(outputText(base({ product: true, receivers: [{ blockName: 'Gears', rate: 30 }] }))).toBe('A product of this block; Sent to Gears (30.0/m).')
  })

  it('says nothing uses the item', () => {
    expect(outputText(base())).toBe('Not used by any row or block.')
    expect(outputText(base({ product: true }))).toBe('A product of this block.')
  })

  it('says what is left over when nothing uses the item', () => {
    expect(outputText(base({ leftover: 20 }))).toBe('Left over: no row or block uses it (20.0/m).')
  })

  it('says the rates are the block\'s when other rows also make the item', () => {
    expect(outputText(base({ otherMakers: 1 }))).toBe("Not used by any row or block. These are the block's rates: 1 other row also makes it.")
    expect(outputText(base({ otherMakers: 2, leftover: 20 }))).toBe("Left over: no row or block uses it (20.0/m). These are the block's rates: 2 other rows also make it.")
    expect(outputText(base({ otherMakers: 2, rate: 0 }))).not.toContain('other rows')
    expect(outputText(base({
      otherMakers: 1, consumers: [{ recipeName: 'Gear', rate: 120, absorber: false }], receivers: [{ blockName: 'B', rate: 5 }], leftover: 3,
    }))).toBe("Used in this block by Gear (takes 120/m); Sent from this block to B (5.00/m); 3.00/m left over in this block. These are the block's rates: 1 other row also makes it.")
  })

  it('treats a rate that shows as 0.00/min as none', () => {
    expect(outputText(base({ rate: 0.0001 }))).toContain('Not produced')
  })
})

describe('itemConsumers, itemReceivers and itemLeftover', () => {
  const recipe = (id: string, name: string) => ({
    id, name, category: 'c', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '',
  })
  const gameData = (): GameData => ({
    factorioVersion: '2.0.0', modSet: {}, items: {}, recipes: { a: recipe('a', 'A'), b: recipe('b', 'B') },
    machines: {}, modules: {}, beacons: {}, defaultMachines: {}, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  })
  const row = (id: string, recipeId: string, over: Partial<GameRecipeNode> = {}): GameRecipeNode =>
    ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...over })
  const solvedNode = (id: string, inputs: Record<string, number>, outputs: Record<string, number>): SolvedNode =>
    ({ recipeNodeId: id, inputRates: inputs, outputRates: outputs, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0 })
  const result = (nodes: SolvedNode[]): SolverResult => ({ nodes, unsatisfied: [], warnings: [] })
  const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
    connectionId: 'c1', fromBlockId: 'b1', toBlockId: 'b2', itemId: 'x', available: 40, capped: false, rate: 10, status: 'ok', kind: 'take', ...over,
  })
  const sub = (id: string, name: string, nodes: SubPlan['nodes']): SubPlan => ({ id, name, nodes, subPlans: [], area: true, createdAt: '', updatedAt: '' }) as SubPlan

  function plain(): Block {
    const b = makeEmptyBlock('B')
    b.rootPlan.nodes = [row('n1', 'a'), row('n2', 'b', { byproductConsumer: true }), row('n3', 'b')]
    return b
  }

  describe('itemConsumers', () => {
    const solve = () => result([solvedNode('n1', {}, { x: 60 }), solvedNode('n2', { x: 30 }, {}), solvedNode('n3', { x: 0 }, {})])

    it('lists the other rows that take the item, not the row itself, nor a row at rate 0', () => {
      const block = plain()
      const out = itemConsumers(block, gameData(), solve(), 'x', undefined, 'n1', indexRecipeAreas(block.rootPlan), undefined)
      expect(out).toEqual([{ recipeName: 'B', rate: 30, absorber: true }])
      expect(itemConsumers(block, gameData(), solve(), 'x', undefined, 'n2', indexRecipeAreas(block.rootPlan), undefined)).toEqual([])
      expect(itemConsumers(block, gameData(), undefined, 'x', undefined, 'n1', indexRecipeAreas(block.rootPlan), undefined)).toEqual([])
    })

    it('names the area of a row only when it differs from the one shown', () => {
      const block = makeEmptyBlock('B')
      block.rootPlan.subPlans = [sub('L', 'Line', [row('n1', 'a'), row('n2', 'b')]), sub('M', 'Other', [row('n3', 'b')])]
      const index = indexRecipeAreas(block.rootPlan)
      const r = result([solvedNode('n1', {}, { x: 60 }), solvedNode('n2', { x: 30 }, {}), solvedNode('n3', { x: 20 }, {})])
      const out = itemConsumers(block, gameData(), r, 'x', undefined, 'n1', index, 'L')
      expect(out).toEqual([
        { recipeName: 'B', rate: 30, absorber: false },
        { recipeName: 'B', rate: 20, absorber: false, areaName: 'Other' },
      ])
    })
  })

  describe('itemReceivers', () => {
    const b1 = makeEmptyBlock('Source')
    const b2 = makeEmptyBlock('Gears')
    const ids = { fromBlockId: b1.id, toBlockId: b2.id }

    it('lists the blocks that receive the item and ignores rate-0 flows, other items and other sources', () => {
      const flows = [
        flow({ ...ids, rate: 10 }),
        flow({ ...ids, connectionId: 'c2', rate: 0 }),
        flow({ ...ids, connectionId: 'c3', itemId: 'y', rate: 5 }),
        flow({ connectionId: 'c4', fromBlockId: b2.id, toBlockId: b1.id, rate: 5 }),
      ]
      expect(itemReceivers(b1.id, [b1, b2], flows, 'x')).toEqual([{ blockName: 'Gears', rate: 10 }])
    })

    it('sums two connections to one block and skips a block that is gone', () => {
      const flows = [flow({ ...ids, rate: 10 }), flow({ ...ids, connectionId: 'c2', rate: 5 }), flow({ connectionId: 'c3', fromBlockId: b1.id, toBlockId: 'gone', rate: 7 })]
      expect(itemReceivers(b1.id, [b1, b2], flows, 'x')).toEqual([{ blockName: 'Gears', rate: 15 }])
    })
  })

  describe('itemLeftover', () => {
    const left = (nodes: SolvedNode[], flows: ConnectionFlow[] = [], blockId = 'b1', conversions: SolverResult['conversions'] = []) => {
      const r = { ...result(nodes), conversions }
      return leftoverByKey(netBalance(r.nodes, r.conversions), grossFlow(r.nodes, r.conversions), exportedByKey(flows, blockId))
    }
    const r = () => [solvedNode('n1', {}, { x: 100 }), solvedNode('n2', { x: 30 }, {})]

    it('is the net surplus of the item minus what other blocks take', () => {
      expect(itemLeftover(left(r()), 'x')).toBeCloseTo(70)
      expect(itemLeftover(left(r(), [flow({ rate: 20 })]), 'x')).toBeCloseTo(50)
      // A flow of another block's does not count.
      expect(itemLeftover(left(r(), [flow({ fromBlockId: 'other', rate: 20 })]), 'x')).toBeCloseTo(70)
    })

    it('is 0 with nothing left, below the tolerance or for another item', () => {
      expect(itemLeftover(left(r(), [flow({ rate: 70 })]), 'x')).toBe(0)
      expect(itemLeftover(left([solvedNode('n1', {}, { x: 100 }), solvedNode('n2', { x: 100 }, {})]), 'x')).toBe(0)
      expect(itemLeftover(left(r()), 'y')).toBe(0)
    })

    it('reads a split fluid at the temperature the row makes it at', () => {
      const nodes: SolvedNode[] = [
        { ...solvedNode('n1', {}, { steam: 60 }), outputTags: { steam: { at: 165 } } },
        { ...solvedNode('n2', {}, { steam: 100 }), outputTags: { steam: { at: 500 } } },
        { ...solvedNode('n3', { steam: 100 }, {}), inputTags: { steam: { min: 465 } } },
      ]
      // The 500 degree steam is converted to the turbine's range, so it nets to zero; the 165 degree steam is the surplus.
      const l = left(nodes, [], 'b1', [{ itemId: 'steam', from: { at: 500 }, to: { min: 465 }, rate: 100 }])
      expect(itemLeftover(l, 'steam', { at: 165 })).toBeCloseTo(60)
      expect(itemLeftover(l, 'steam', { at: 500 })).toBe(0)
      expect(itemLeftover(l, 'steam')).toBeCloseTo(60)
    })
  })

  describe('split fluids', () => {
    const nodes = (): SolvedNode[] => [
      { ...solvedNode('n1', {}, { x: 60 }), outputTags: { x: { at: 165 } } },
      { ...solvedNode('n2', { x: 30 }, {}), inputTags: { x: { min: 465 } } },
      { ...solvedNode('n3', { x: 20 }, {}), inputTags: { x: {} } },
    ]

    it('lists only the rows whose range covers the temperature the row makes', () => {
      const block = makeEmptyBlock('B')
      block.rootPlan.nodes = [row('n1', 'a'), row('n2', 'b'), row('n3', 'b')]
      const index = indexRecipeAreas(block.rootPlan)
      expect(itemConsumers(block, gameData(), result(nodes()), 'x', { at: 165 }, 'n1', index, undefined)).toEqual([{ recipeName: 'B', rate: 20, absorber: false }])
      expect(itemConsumers(block, gameData(), result(nodes()), 'x', { at: 500 }, 'n1', index, undefined)).toHaveLength(2)
    })

    it('counts only the connection parts that fit', () => {
      const b1 = makeEmptyBlock('Source')
      const b2 = makeEmptyBlock('Turbines')
      const f = flow({
        fromBlockId: b1.id, toBlockId: b2.id, itemId: 'x', rate: 50,
        parts: [{ temp: { at: 165 }, rate: 20, available: 20 }, { temp: { at: 500 }, rate: 30, available: 30 }],
      })
      expect(itemReceivers(b1.id, [b1, b2], [f], 'x', { at: 500 })).toEqual([{ blockName: 'Turbines', rate: 30 }])
      expect(itemReceivers(b1.id, [b1, b2], [f], 'x', { at: 165 })).toEqual([{ blockName: 'Turbines', rate: 20 }])
    })

    it('matches temperatures to ranges', () => {
      expect(tagReaches({ at: 165 }, { min: 465 })).toBe(false)
      expect(tagReaches({ at: 500 }, { min: 465 })).toBe(true)
      expect(tagReaches({ at: null }, { min: 465 })).toBe(true)
      expect(tagReaches(undefined, { min: 465 })).toBe(true)
      expect(tagReaches({ at: 165 }, { at: 500 })).toBe(false)
    })
  })

  describe('countOtherMakers', () => {
    const nodes = () => [solvedNode('n1', {}, { x: 60 }), solvedNode('n2', {}, { x: 30 }), solvedNode('n3', {}, { x: 20 }), solvedNode('n4', {}, { x: 0 })]
    const block = () => {
      const b = makeEmptyBlock('B')
      b.rootPlan.nodes = [row('n1', 'a'), row('n2', 'a'), row('n3', 'a', { byproductPolicy: { x: 'discard' } }), row('n4', 'a')]
      return b
    }

    it('counts the rows that make the item, other than the row itself, a discarding row or a row at 0', () => {
      const index = indexRecipeAreas(block().rootPlan)
      expect(countOtherMakers(result(nodes()), index, 'x', 'n1')).toBe(1)
      expect(countOtherMakers(result(nodes()), index, 'x', 'n3')).toBe(2)
      expect(countOtherMakers(undefined, index, 'x', 'n1')).toBe(0)
    })
  })
})
