import { describe, it, expect } from 'vitest'
import { outputText, itemConsumers, itemReceivers, itemLeftover, type OutputTextInput } from './outputsText'
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

  it('adds the other rows that make the item', () => {
    expect(outputText(base({ otherMakers: 1 }))).toBe('Not used by any row or block. Also made by 1 other row.')
    expect(outputText(base({ otherMakers: 2, leftover: 20 }))).toBe('Left over: no row or block uses it (20.0/m). Also made by 2 other rows.')
    expect(outputText(base({ otherMakers: 2, rate: 0 }))).not.toContain('Also made by')
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
      const out = itemConsumers(block, gameData(), solve(), 'x', 'n1', indexRecipeAreas(block.rootPlan), undefined)
      expect(out).toEqual([{ recipeName: 'B', rate: 30, absorber: true }])
      expect(itemConsumers(block, gameData(), solve(), 'x', 'n2', indexRecipeAreas(block.rootPlan), undefined)).toEqual([])
      expect(itemConsumers(block, gameData(), undefined, 'x', 'n1', indexRecipeAreas(block.rootPlan), undefined)).toEqual([])
    })

    it('names the area of a row only when it differs from the one shown', () => {
      const block = makeEmptyBlock('B')
      block.rootPlan.subPlans = [sub('L', 'Line', [row('n1', 'a'), row('n2', 'b')]), sub('M', 'Other', [row('n3', 'b')])]
      const index = indexRecipeAreas(block.rootPlan)
      const r = result([solvedNode('n1', {}, { x: 60 }), solvedNode('n2', { x: 30 }, {}), solvedNode('n3', { x: 20 }, {})])
      const out = itemConsumers(block, gameData(), r, 'x', 'n1', index, 'L')
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
    const r = () => result([solvedNode('n1', {}, { x: 100 }), solvedNode('n2', { x: 30 }, {})])

    it('is the net surplus of the item minus what other blocks take', () => {
      expect(itemLeftover(r(), [], 'b1', 'x')).toBeCloseTo(70)
      expect(itemLeftover(r(), [flow({ rate: 20 })], 'b1', 'x')).toBeCloseTo(50)
      // A flow of another block's does not count.
      expect(itemLeftover(r(), [flow({ fromBlockId: 'other', rate: 20 })], 'b1', 'x')).toBeCloseTo(70)
    })

    it('is 0 without a solve, with nothing left, or below the tolerance', () => {
      expect(itemLeftover(undefined, [], 'b1', 'x')).toBe(0)
      expect(itemLeftover(r(), [flow({ rate: 70 })], 'b1', 'x')).toBe(0)
      expect(itemLeftover(result([solvedNode('n1', {}, { x: 100 }), solvedNode('n2', { x: 100 }, {})]), [], 'b1', 'x')).toBe(0)
      expect(itemLeftover(r(), [], 'b1', 'y')).toBe(0)
    })
  })
})
