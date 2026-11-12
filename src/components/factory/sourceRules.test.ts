import { describe, it, expect } from 'vitest'
import { itemsWithEffect, noEffectText, sourceRuleItems, sourceRules, type NoEffectReason, type SourceRuleKind } from './sourceRules'
import { makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import type { Block, GameData } from '../../data/types'
import { sourceRulesOf } from '../../test/sourceRulesOf'

const gameData = {
  items: {
    plate: { id: 'plate', name: 'Plate' },
    ore: { id: 'ore', name: 'Ore' },
    gear: { id: 'gear', name: 'Gear' },
  },
  recipes: {
    smelt: {
      id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    },
  },
} as unknown as GameData

const SOURCE_ID = 'source'
const OTHER_BLOCKS = new Set(['source'])

/** A block with a smelting row (it makes Plate), the given settings, and optionally a connection for Plate. */
function block(opts: {
  sourcing?: Record<string, 'byproducts-first' | 'connections-first'>
  locked?: string[]
  connected?: boolean
  product?: string
  row?: boolean
} = {}): Block {
  const b = makeEmptyBlock('B')
  b.id = 'self'
  if (opts.row ?? true) b.rootPlan.nodes = [makeRecipeNode('smelt')]
  b.sourceRules = sourceRulesOf(opts.sourcing, opts.locked)
  if (opts.connected) b.inputConnections = [{ id: 'c', itemId: 'plate', fromBlockId: SOURCE_ID }]
  if (opts.product) b.products = [{ id: 'p', itemId: opts.product }]
  return b
}

const rules = (b: Block, ids: ReadonlySet<string> = OTHER_BLOCKS) => sourceRules(b, gameData, ids)

describe('sourceRules', () => {
  it('lists nothing for a block with only defaults', () => {
    expect(rules(block())).toEqual([])
  })

  describe('a rule with an effect', () => {
    it('byproducts-first on an item a row makes', () => {
      expect(rules(block({ sourcing: { plate: 'byproducts-first' } }))).toEqual([{ itemId: 'plate', kind: 'byproducts-first' }])
    })

    it('connections-first on an item a row makes and a connection supplies', () => {
      expect(rules(block({ sourcing: { plate: 'connections-first' }, connected: true })))
        .toEqual([{ itemId: 'plate', kind: 'connections-first' }])
    })

    it('import-off on an item a row makes', () => {
      expect(rules(block({ locked: ['plate'] }))).toEqual([{ itemId: 'plate', kind: 'import-off' }])
    })
  })

  describe('product', () => {
    const cases: [SourceRuleKind, Partial<Parameters<typeof block>[0]>][] = [
      ['connections-first', { sourcing: { plate: 'connections-first' }, connected: true }],
      ['byproducts-first', { sourcing: { plate: 'byproducts-first' } }],
      ['import-off', { locked: ['plate'] }],
    ]
    it.each(cases)('is reported for %s on a product of the block', (kind, opts) => {
      const [rule] = rules(block({ ...opts, product: 'plate' }))
      expect(rule).toEqual({ itemId: 'plate', kind, noEffect: 'product' })
    })

    it('counts a product with no extra output and no request', () => {
      const [rule] = rules(block({ locked: ['plate'], product: 'plate' }))
      expect(rule.noEffect).toBe('product')
    })
  })

  describe('not-made', () => {
    const cases: [SourceRuleKind, Partial<Parameters<typeof block>[0]>][] = [
      ['connections-first', { sourcing: { ore: 'connections-first' } }],
      ['byproducts-first', { sourcing: { ore: 'byproducts-first' } }],
      ['import-off', { locked: ['ore'] }],
    ]
    it.each(cases)('is reported for %s on an item no row makes', (kind, opts) => {
      const [rule] = rules(block(opts))
      expect(rule).toEqual({ itemId: 'ore', kind, noEffect: 'not-made' })
    })

    it('is reported for a block with no rows at all', () => {
      expect(rules(block({ locked: ['plate'], row: false }))[0].noEffect).toBe('not-made')
    })
  })

  describe("Don't make more here with Import off", () => {
    it('has an effect on both parts', () => {
      const found = rules(block({ sourcing: { plate: 'byproducts-first' }, locked: ['plate'] }))
      expect(found).toEqual([
        { itemId: 'plate', kind: 'byproducts-first' },
        { itemId: 'plate', kind: 'import-off' },
      ])
    })

    it('does not change connections-first or import-off', () => {
      const found = rules(block({ sourcing: { plate: 'connections-first' }, locked: ['plate'], connected: true }))
      expect(found.map(r => r.noEffect)).toEqual([undefined, undefined])
    })
  })

  describe('no-connection', () => {
    it('is reported for connections-first with no connection for the item', () => {
      expect(rules(block({ sourcing: { plate: 'connections-first' } }))[0].noEffect).toBe('no-connection')
    })

    it('ignores a connection for another item', () => {
      const b = block({ sourcing: { plate: 'connections-first' } })
      b.inputConnections = [{ id: 'c', itemId: 'gear', fromBlockId: SOURCE_ID }]
      expect(rules(b)[0].noEffect).toBe('no-connection')
    })

    it('ignores a connection whose source block does not exist', () => {
      const b = block({ sourcing: { plate: 'connections-first' }, connected: true })
      expect(rules(b, new Set())[0].noEffect).toBe('no-connection')
    })

    it('ignores a connection from the block itself', () => {
      const b = block({ sourcing: { plate: 'connections-first' } })
      b.inputConnections = [{ id: 'c', itemId: 'plate', fromBlockId: b.id }]
      expect(rules(b, new Set([b.id]))[0].noEffect).toBe('no-connection')
    })

    it('does not apply to byproducts-first', () => {
      expect(rules(block({ sourcing: { plate: 'byproducts-first' } }))[0].noEffect).toBeUndefined()
    })
  })

  it('reports the first reason that applies', () => {
    // A product that no row makes and that is locked: product wins over not-made.
    const b = block({ sourcing: { ore: 'byproducts-first' }, locked: ['ore'], product: 'ore' })
    expect(rules(b).map(r => r.noEffect)).toEqual(['product', 'product'])
    // Not a product, no row makes it, locked: not-made wins over locked.
    expect(rules(block({ sourcing: { ore: 'byproducts-first' }, locked: ['ore'] })).map(r => r.noEffect))
      .toEqual(['not-made', 'not-made'])
    // A row makes it, byproducts-first and locked: both parts have an effect.
    expect(rules(block({ sourcing: { plate: 'byproducts-first' }, locked: ['plate'] })).map(r => r.noEffect)).toEqual([undefined, undefined])
  })

  it('lists an item with two rules once per rule, itemSourcing entries first', () => {
    const b = block({ sourcing: { gear: 'byproducts-first', plate: 'byproducts-first' }, locked: ['plate', 'ore'] })
    expect(rules(b).map(r => [r.itemId, r.kind])).toEqual([
      ['gear', 'byproducts-first'],
      ['plate', 'byproducts-first'],
      ['plate', 'import-off'],
      ['ore', 'import-off'],
    ])
    // The two rules of Plate are judged apart; both have an effect.
    expect(rules(b).filter(r => r.itemId === 'plate').map(r => r.noEffect)).toEqual([undefined, undefined])
  })

  it('lists a duplicated lock once', () => {
    expect(rules(block({ locked: ['plate', 'plate'] }))).toEqual([{ itemId: 'plate', kind: 'import-off' }])
  })
})

describe('itemsWithEffect', () => {
  it('holds the items with at least one rule that has an effect', () => {
    expect([...itemsWithEffect([
      { itemId: 'a', kind: 'byproducts-first' },
      { itemId: 'b', kind: 'connections-first', noEffect: 'no-connection' },
      // Two rules: the first has no effect, the lock has one.
      { itemId: 'c', kind: 'byproducts-first', noEffect: 'not-made' },
      { itemId: 'c', kind: 'import-off' },
      { itemId: 'd', kind: 'import-off', noEffect: 'not-made' },
    ])]).toEqual(['a', 'c'])
  })

  it('is empty without a rule', () => {
    expect(itemsWithEffect([]).size).toBe(0)
  })
})

describe('sourceRuleItems', () => {
  const source = () => ({ ...makeEmptyBlock('Source'), id: SOURCE_ID })

  it('holds the items of the block whose rule has an effect, and no item for the default', () => {
    expect(sourceRuleItems(block(), gameData, []).size).toBe(0)
    const b = block({ sourcing: { plate: 'byproducts-first', ore: 'byproducts-first' } })
    // Ore is made by no row: its rule has no effect.
    expect([...sourceRuleItems(b, gameData, [b])]).toEqual(['plate'])
  })

  it('reads the other blocks of the plan: a connection counts only while its source exists', () => {
    const b = block({ sourcing: { plate: 'connections-first' }, connected: true })
    expect([...sourceRuleItems(b, gameData, [b, source()])]).toEqual(['plate'])
    expect([...sourceRuleItems(b, gameData, [b])]).toEqual([])
  })

  it('answers from memory for the same block, plan and game data', () => {
    const b = block({ locked: ['plate'] })
    const blocks = [b]
    const first = sourceRuleItems(b, gameData, blocks)
    expect(sourceRuleItems(b, gameData, blocks)).toBe(first)
    // Another plan array, or a replaced block, is answered afresh.
    expect(sourceRuleItems(b, gameData, [b])).not.toBe(first)
    expect([...sourceRuleItems({ ...b, sourceRules: {} }, gameData, blocks)]).toEqual([])
  })
})

describe('noEffectText', () => {
  const reasons: [NoEffectReason, string][] = [
    ['product', 'Plate is a product of this block, so the block always makes it.'],
    ['not-made', 'No row in this block makes Plate.'],
    ['no-connection', 'No connection for Plate.'],
  ]
  it.each(reasons)('words %s', (reason, text) => {
    expect(noEffectText(reason, 'Plate')).toBe(text)
  })
})
