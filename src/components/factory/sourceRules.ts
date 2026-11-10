import type { Block, GameData } from '../../data/types'
import { hasProduct, receivesItem } from '../../solver/blockGraph'
import { blockMakesItem } from '../../solver/index'

// ---------------------------------------------------------------------------
// Which of a block's source rules have an effect. A rule is one non-default stored setting of one item:
// a preset in `itemSourcing` or an item in `noImportItems`. Pure functions of the block and the game
// data; no solve result is read, so a rule is judged by what the block is, not by what the solver did.
// ---------------------------------------------------------------------------

export type SourceRuleKind = 'connections-first' | 'byproducts-first' | 'import-off'
export type NoEffectReason = 'product' | 'not-made' | 'locked' | 'no-connection'

export interface SourceRule {
  itemId: string
  kind: SourceRuleKind
  /** Why the solver ignores the rule; absent when it has an effect. */
  noEffect?: NoEffectReason
}

/**
 * Every rule of the block: `itemSourcing` entries in key order, then `noImportItems` in order.
 * `blockIds` holds the ids of all existing blocks of the plan: a connection whose source is gone, or is
 * the block itself, does not count (the solver's own test, `receivesItem`).
 */
export function sourceRules(block: Block, gameData: GameData, blockIds: ReadonlySet<string>): SourceRule[] {
  const rules: SourceRule[] = []
  for (const [itemId, kind] of Object.entries(block.itemSourcing)) {
    rules.push(withEffect(block, gameData, blockIds, { itemId, kind }))
  }
  // The schema does not dedupe `noImportItems`; one lock is one rule.
  for (const itemId of new Set(block.noImportItems)) {
    rules.push(withEffect(block, gameData, blockIds, { itemId, kind: 'import-off' }))
  }
  return rules
}

/** `rule` with `noEffect` set to the first reason that applies, in the order of the table in phase-1.md. */
function withEffect(block: Block, gameData: GameData, blockIds: ReadonlySet<string>, rule: SourceRule): SourceRule {
  const reason = noEffectReason(block, gameData, blockIds, rule)
  return reason ? { ...rule, noEffect: reason } : rule
}

function noEffectReason(
  block: Block,
  gameData: GameData,
  blockIds: ReadonlySet<string>,
  { itemId, kind }: SourceRule,
): NoEffectReason | undefined {
  if (hasProduct(block, itemId)) return 'product'
  if (!blockMakesItem(block, gameData, itemId)) return 'not-made'
  if (kind === 'byproducts-first' && block.noImportItems.includes(itemId)) return 'locked'
  if (kind === 'connections-first' && !receivesItem(block, itemId, blockIds)) return 'no-connection'
  return undefined
}

/** The text shown beside a rule that has no effect. */
export function noEffectText(reason: NoEffectReason, itemName: string): string {
  switch (reason) {
    case 'product': return `${itemName} is a product of this block, so the block always makes it.`
    case 'not-made': return `No row in this block makes ${itemName}.`
    case 'locked': return `Import is off for ${itemName}, so the block has to make it.`
    case 'no-connection': return `No connection for ${itemName}.`
  }
}
