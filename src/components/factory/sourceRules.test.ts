import { describe, it, expect } from 'vitest'
import { noEffectText, sourceRules, type NoEffectReason, type SourceRuleKind } from './sourceRules'
import { makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import type { Block, GameData, ItemSourcingMode } from '../../data/types'

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
  sourcing?: Record<string, ItemSourcingMode>
  locked?: string[]
  connected?: boolean
  product?: string
  row?: boolean
} = {}): Block {
  const b = makeEmptyBlock('B')
  b.id = 'self'
  if (opts.row ?? true) b.rootPlan.nodes = [makeRecipeNode('smelt')]
  b.itemSourcing = opts.sourcing ?? {}
  b.noImportItems = opts.locked ?? []
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

  describe('locked', () => {
    it('is reported for byproducts-first on an item whose import is off', () => {
      const found = rules(block({ sourcing: { plate: 'byproducts-first' }, locked: ['plate'] }))
      expect(found.find(r => r.kind === 'byproducts-first')).toEqual({ itemId: 'plate', kind: 'byproducts-first', noEffect: 'locked' })
    })

    it('does not apply to connections-first or to import-off itself', () => {
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
    // A row makes it, byproducts-first and locked: locked.
    expect(rules(block({ sourcing: { plate: 'byproducts-first' }, locked: ['plate'] }))[0].noEffect).toBe('locked')
  })

  it('lists an item with two rules once per rule, itemSourcing entries first', () => {
    const b = block({ sourcing: { gear: 'byproducts-first', plate: 'byproducts-first' }, locked: ['plate', 'ore'] })
    expect(rules(b).map(r => [r.itemId, r.kind])).toEqual([
      ['gear', 'byproducts-first'],
      ['plate', 'byproducts-first'],
      ['plate', 'import-off'],
      ['ore', 'import-off'],
    ])
    // The two rules of Plate are judged apart: the preset is locked, the lock itself has an effect.
    expect(rules(b).filter(r => r.itemId === 'plate').map(r => r.noEffect)).toEqual(['locked', undefined])
  })

  it('reads the block only: the same block gives the same rules however often it is asked', () => {
    const b = block({ sourcing: { plate: 'byproducts-first' } })
    expect(rules(b)).toEqual(rules(b))
  })
})

describe('noEffectText', () => {
  const reasons: [NoEffectReason, string][] = [
    ['product', 'Plate is a product of this block, so the block always makes it.'],
    ['not-made', 'No row in this block makes Plate.'],
    ['locked', 'Import is off for Plate, so the block has to make it.'],
    ['no-connection', 'No connection for Plate.'],
  ]
  it.each(reasons)('words %s', (reason, text) => {
    expect(noEffectText(reason, 'Plate')).toBe(text)
  })
})
