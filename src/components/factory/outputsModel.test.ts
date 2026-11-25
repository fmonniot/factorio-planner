import { describe, it, expect } from 'vitest'
import {
  buildOutputModel, outputEmptyState, outputLineTip, sharedTagTip, outputReading, itemConsumers, itemReceivers, itemLeftover, otherMakers, tagReaches,
  type OutputModelInput, type OutputModel,
} from './outputsModel'
import { exportedByKey, leftoverByKey } from './summaryRows'
import { netBalance, grossFlow } from '../../solver/index'
import { indexRecipeAreas } from './recipeAreas'
import { makeEmptyBlock } from '../../store/blockStore'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import type { Block, ConnectionFlow, GameData, GameRecipeNode, SolvedNode, SolverResult, SubPlan } from '../../data/types'

const fmt = (p: number) => `${p}/m`

const base = (over: Partial<OutputModelInput> = {}): OutputModelInput => ({
  itemId: 'plate', itemName: 'Iron Plate', solved: true, rate: 120, discarded: false, product: false,
  consumers: [], receivers: [], leftover: 0, otherMakers: 0, othersRate: 0, ...over,
})
const consumer = (over: Partial<OutputModelInput['consumers'][number]> = {}) => ({ nodeId: 'n2', recipeName: 'Gear', rate: 120, absorber: false, ...over })
const receiver = (over: Partial<OutputModelInput['receivers'][number]> = {}) => ({ blockId: 'b2', blockName: 'Circuits', color: '#a78bfa', rate: 30, requested: false, ...over })
const kinds = (m: OutputModel) => m.lines.map(l => l.kind)

describe('buildOutputModel', () => {
  it('has no lines before there is a solve', () => {
    expect(buildOutputModel(base({ solved: false }))).toMatchObject({ solved: false, discarded: false, notProduced: false, lines: [] })
  })

  it('has no lines for a discarded output, whatever uses the item', () => {
    const m = buildOutputModel(base({ discarded: true, consumers: [consumer()], receivers: [receiver()] }))
    expect(m).toMatchObject({ solved: true, discarded: true, notProduced: false, lines: [] })
  })

  it('is not produced for a rate that shows as none', () => {
    expect(buildOutputModel(base({ rate: 0 })).notProduced).toBe(true)
    expect(buildOutputModel(base({ rate: 0.0001 })).notProduced).toBe(true)
    expect(buildOutputModel(base({ rate: 0.0001, discarded: true })).notProduced).toBe(false)
  })

  it('makes a row line of a consumer', () => {
    expect(buildOutputModel(base({ consumers: [consumer()] })).lines).toEqual([
      { key: 'row:n2', kind: 'row', label: 'Gear', rate: 120, look: { kind: 'made' }, absorber: false, requested: false },
    ])
  })

  it('copies the absorber flag and the area name', () => {
    const [line] = buildOutputModel(base({ consumers: [consumer({ absorber: true, areaName: 'Other' })] })).lines
    expect(line).toMatchObject({ absorber: true, areaName: 'Other' })
  })

  it('makes a block line of a receiver, with its colour and request', () => {
    const [line] = buildOutputModel(base({ receivers: [receiver({ requested: true })] })).lines
    expect(line).toEqual({ key: 'block:b2', kind: 'block', label: 'Circuits', rate: 30, look: { kind: 'block', color: '#a78bfa' }, absorber: false, requested: true })
  })

  it('orders rows, blocks, then the block product', () => {
    const m = buildOutputModel(base({ rate: 48, product: true, consumers: [consumer({ rate: 12 })], receivers: [receiver()] }))
    expect(kinds(m)).toEqual(['row', 'block', 'product'])
    expect(m.lines[2]).toMatchObject({ key: 'product', label: 'Block product', rate: 6, look: { kind: 'product' } })
  })

  it('orders rows then the leftover', () => {
    const m = buildOutputModel(base({ consumers: [consumer()], leftover: 20 }))
    expect(m.lines.map(l => l.key)).toEqual(['row:n2', 'left'])
    expect(m.lines[1]).toMatchObject({ kind: 'left', label: 'Left over', rate: 20, look: { kind: 'left' } })
  })

  it('has only the leftover when nothing takes the item', () => {
    expect(buildOutputModel(base({ leftover: 20 })).lines).toHaveLength(1)
    expect(buildOutputModel(base({ leftover: 20 })).lines[0]).toMatchObject({ kind: 'left', rate: 20 })
  })

  it('gives a product with no takers the whole rate as block product', () => {
    expect(buildOutputModel(base({ rate: 48, product: true })).lines).toMatchObject([{ kind: 'product', rate: 48 }])
  })

  it('never lets the block product go below zero or show as 0.00/min', () => {
    const over = buildOutputModel(base({ rate: 40, product: true, consumers: [consumer({ rate: 50 })] }))
    expect(kinds(over)).toEqual(['row'])
    expect(over.lines.every(l => l.rate > 0)).toBe(true)
    expect(kinds(buildOutputModel(base({ rate: 100, product: true, consumers: [consumer({ rate: 99.999 })] })))).toEqual(['row'])
  })

  it('has no block product for an item that is not a product', () => {
    expect(buildOutputModel(base({ rate: 48, product: false })).lines).toEqual([])
  })

  it("reads the block's total made when other rows make the item", () => {
    const m = buildOutputModel(base({ rate: 40, product: true, otherMakers: 2, othersRate: 30, consumers: [consumer({ rate: 60 })] }))
    expect(m.lines.find(l => l.kind === 'product')?.rate).toBe(10)
    expect(m.otherMakers).toBe(2)
  })

  it('has no lines and the unused state for an item nothing uses', () => {
    const m = buildOutputModel(base())
    expect(m.lines).toEqual([])
    expect(outputEmptyState(m)).toBe('unused')
  })
})

describe('outputEmptyState', () => {
  it('names each state', () => {
    expect(outputEmptyState(buildOutputModel(base({ solved: false })))).toBe('unsolved')
    expect(outputEmptyState(buildOutputModel(base({ discarded: true })))).toBe('discarded')
    expect(outputEmptyState(buildOutputModel(base({ rate: 0 })))).toBe('notProduced')
    expect(outputEmptyState(buildOutputModel(base()))).toBe('unused')
    expect(outputEmptyState(buildOutputModel(base({ consumers: [consumer()] })))).toBeUndefined()
  })
})

describe('outputLineTip', () => {
  const line = (over: Partial<OutputModelInput> = {}, i = 0) => buildOutputModel(base(over)).lines[i]
  it('reads a row', () => {
    expect(outputLineTip(line({ consumers: [consumer()] }), fmt)).toBe('Gear takes 120/m')
  })
  it('adds the absorber sentence on a second line', () => {
    expect(outputLineTip(line({ consumers: [consumer({ absorber: true })] }), fmt)).toBe('Gear takes 120/m\nabsorber: runs only on surplus')
  })
  it('names the area of a row in another area', () => {
    expect(outputLineTip(line({ consumers: [consumer({ areaName: 'Other' })] }), fmt)).toBe('Gear in Other takes 120/m')
  })
  it('reads a block, requested or not', () => {
    expect(outputLineTip(line({ receivers: [receiver()] }), fmt)).toBe('Sent to Circuits: 30/m')
    expect(outputLineTip(line({ receivers: [receiver({ requested: true })] }), fmt)).toBe('Sent to Circuits: 30/m (requested)')
  })
  it('reads the block product and the leftover', () => {
    expect(outputLineTip(line({ product: true, rate: 48 }), fmt)).toBe('A product of this block: 48/m left for its goal')
    expect(outputLineTip(line({ leftover: 20 }), fmt)).toBe('20/m left over in this block')
  })
})

describe('sharedTagTip', () => {
  it('counts the other rows', () => {
    expect(sharedTagTip(buildOutputModel(base({ otherMakers: 1 })))).toBe("These are the block's rates:\n1 other row also makes Iron Plate")
    expect(sharedTagTip(buildOutputModel(base({ otherMakers: 2 })))).toBe("These are the block's rates:\n2 other rows also make Iron Plate")
  })
})

describe('outputReading', () => {
  it('reads each empty state', () => {
    expect(outputReading(buildOutputModel(base({ solved: false })), fmt)).toBe('Not solved yet.')
    expect(outputReading(buildOutputModel(base({ discarded: true })), fmt)).toBe('Discarded: not counted.')
    expect(outputReading(buildOutputModel(base({ rate: 0 })), fmt)).toBe('Not produced at the moment.')
    expect(outputReading(buildOutputModel(base()), fmt)).toBe('Not used by any row or block.')
  })
  it('reads the lines as one sentence', () => {
    const m = buildOutputModel(base({
      rate: 48, product: true,
      consumers: [consumer({ recipeName: 'Zinc wire', rate: 12 })], receivers: [receiver({ blockName: 'Circuits' })],
    }))
    expect(outputReading(m, fmt)).toBe('Zinc wire 12/m, Circuits 30/m, block product 6/m.')
  })
  it('marks an absorber and the leftover', () => {
    const m = buildOutputModel(base({ consumers: [consumer({ recipeName: 'Slag processing', rate: 4, absorber: true })], leftover: 2 }))
    expect(outputReading(m, fmt)).toBe('Slag processing (absorber) 4/m, left over 2/m.')
  })
  it("adds that the rates are the block's when shared", () => {
    const m = buildOutputModel(base({ consumers: [consumer({ recipeName: 'Gear', rate: 4 })], otherMakers: 1 }))
    expect(outputReading(m, fmt)).toBe("Gear 4/m. These are the block's rates; 1 other row also makes it.")
    expect(outputReading(buildOutputModel(base({ consumers: [consumer({ recipeName: 'Gear', rate: 4 })], otherMakers: 2 })), fmt))
      .toBe("Gear 4/m. These are the block's rates; 2 other rows also make it.")
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
      expect(out).toEqual([{ nodeId: 'n2', recipeName: 'B', rate: 30, absorber: true }])
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
        { nodeId: 'n2', recipeName: 'B', rate: 30, absorber: false },
        { nodeId: 'n3', recipeName: 'B', rate: 20, absorber: false, areaName: 'Other' },
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
      expect(itemReceivers(b1.id, [b1, b2], flows, 'x')).toEqual([{ blockId: b2.id, blockName: 'Gears', color: b2.color, rate: 10, requested: false }])
    })

    it('sums two connections to one block and skips a block that is gone', () => {
      const flows = [flow({ ...ids, rate: 10 }), flow({ ...ids, connectionId: 'c2', rate: 5 }), flow({ connectionId: 'c3', fromBlockId: b1.id, toBlockId: 'gone', rate: 7 })]
      expect(itemReceivers(b1.id, [b1, b2], flows, 'x')).toEqual([{ blockId: b2.id, blockName: 'Gears', color: b2.color, rate: 15, requested: false }])
    })
  })

  describe('itemReceivers colour and request', () => {
    const b1 = makeEmptyBlock('Source')
    const b2 = { ...makeEmptyBlock('Gears'), color: '#112233' }
    const ids = { fromBlockId: b1.id, toBlockId: b2.id }

    it('falls back to the missing-block colour when the block has none', () => {
      const bare = { ...b2, color: undefined } as unknown as Block
      expect(itemReceivers(b1.id, [b1, bare], [flow({ ...ids })], 'x')[0].color).toBe(MISSING_BLOCK_COLOR)
    })

    it('carries the block colour', () => {
      expect(itemReceivers(b1.id, [b1, b2], [flow({ ...ids })], 'x')[0]).toMatchObject({ blockId: b2.id, color: '#112233' })
    })

    it('is requested when any flow of the sum is a request', () => {
      expect(itemReceivers(b1.id, [b1, b2], [flow({ ...ids, kind: 'request' })], 'x')[0].requested).toBe(true)
      expect(itemReceivers(b1.id, [b1, b2], [flow({ ...ids, kind: 'take' })], 'x')[0].requested).toBe(false)
      const two = [flow({ ...ids, kind: 'take' }), flow({ ...ids, connectionId: 'c2', kind: 'request' })]
      expect(itemReceivers(b1.id, [b1, b2], two, 'x')[0].requested).toBe(true)
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
      expect(itemConsumers(block, gameData(), result(nodes()), 'x', { at: 165 }, 'n1', index, undefined)).toEqual([{ nodeId: 'n3', recipeName: 'B', rate: 20, absorber: false }])
      expect(itemConsumers(block, gameData(), result(nodes()), 'x', { at: 500 }, 'n1', index, undefined)).toHaveLength(2)
    })

    it('counts only the connection parts that fit', () => {
      const b1 = makeEmptyBlock('Source')
      const b2 = makeEmptyBlock('Turbines')
      const f = flow({
        fromBlockId: b1.id, toBlockId: b2.id, itemId: 'x', rate: 50,
        parts: [{ temp: { at: 165 }, rate: 20, available: 20 }, { temp: { at: 500 }, rate: 30, available: 30 }],
      })
      expect(itemReceivers(b1.id, [b1, b2], [f], 'x', { at: 500 })).toEqual([{ blockId: b2.id, blockName: 'Turbines', color: b2.color, rate: 30, requested: false }])
      expect(itemReceivers(b1.id, [b1, b2], [f], 'x', { at: 165 })).toEqual([{ blockId: b2.id, blockName: 'Turbines', color: b2.color, rate: 20, requested: false }])
    })

    it('matches temperatures to ranges', () => {
      expect(tagReaches({ at: 165 }, { min: 465 })).toBe(false)
      expect(tagReaches({ at: 500 }, { min: 465 })).toBe(true)
      expect(tagReaches({ at: null }, { min: 465 })).toBe(true)
      expect(tagReaches(undefined, { min: 465 })).toBe(true)
      expect(tagReaches({ at: 165 }, { at: 500 })).toBe(false)
    })
  })

  describe('otherMakers', () => {
    const nodes = () => [solvedNode('n1', {}, { x: 60 }), solvedNode('n2', {}, { x: 30 }), solvedNode('n3', {}, { x: 20 }), solvedNode('n4', {}, { x: 0 })]
    const block = () => {
      const b = makeEmptyBlock('B')
      b.rootPlan.nodes = [row('n1', 'a'), row('n2', 'a'), row('n3', 'a', { byproductPolicy: { x: 'discard' } }), row('n4', 'a')]
      return b
    }

    it('counts and sums the rows that make the item, other than the row itself, a discarding row or a row at 0', () => {
      const index = indexRecipeAreas(block().rootPlan)
      expect(otherMakers(result(nodes()), index, 'x', 'n1')).toEqual({ count: 1, rate: 30 })
      expect(otherMakers(result(nodes()), index, 'x', 'n3')).toEqual({ count: 2, rate: 90 })
      expect(otherMakers(undefined, index, 'x', 'n1')).toEqual({ count: 0, rate: 0 })
    })
  })
})
