import type { Block, GameData } from '../../data/types'
import { presetOf } from '../../data/sourceRules'
import { hasProduct, receivesItem } from '../../solver/blockGraph'
import { blockMakesItem } from '../../solver/index'

// ---------------------------------------------------------------------------
// Which of a block's source rules have an effect. A rule is one non-default stored setting of one item:
// a part of an item's stored rule (`Block.sourceRules`): its `makeHere` preset or its Import-off switch. Pure functions of the block and the game
// data; no solve result is read, so a rule is judged by what the block is, not by what the solver did.
// ---------------------------------------------------------------------------

export type SourceRuleKind = 'connections-first' | 'byproducts-first' | 'import-off'
export type NoEffectReason = 'product' | 'not-made' | 'locked' | 'no-connection'

export interface SourceRulePart {
  itemId: string
  kind: SourceRuleKind
  /** Why the solver ignores the rule; absent when it has an effect. */
  noEffect?: NoEffectReason
}

/**
 * Every part of every rule of the block, in map order, the `makeHere` part before `import-off`.
 * `blockIds` holds the ids of all existing blocks of the plan: a connection whose source is gone, or is
 * the block itself, does not count (the solver's own test, `receivesItem`).
 */
export function sourceRules(block: Block, gameData: GameData, blockIds: ReadonlySet<string>): SourceRulePart[] {
  const rules: SourceRulePart[] = []
  for (const [itemId, rule] of Object.entries(block.sourceRules)) {
    const kind = presetOf(rule)
    if (kind) rules.push(withEffect(block, gameData, blockIds, { itemId, kind }))
    if (rule.importOff) rules.push(withEffect(block, gameData, blockIds, { itemId, kind: 'import-off' }))
  }
  return rules
}

/** `rule` with `noEffect` set to the first reason that applies, in the order of the table in phase-1.md. */
function withEffect(block: Block, gameData: GameData, blockIds: ReadonlySet<string>, rule: SourceRulePart): SourceRulePart {
  const reason = noEffectReason(block, gameData, blockIds, rule)
  return reason ? { ...rule, noEffect: reason } : rule
}

function noEffectReason(
  block: Block,
  gameData: GameData,
  blockIds: ReadonlySet<string>,
  { itemId, kind }: SourceRulePart,
): NoEffectReason | undefined {
  if (hasProduct(block, itemId)) return 'product'
  if (!blockMakesItem(block, gameData, itemId)) return 'not-made'
  if (kind === 'byproducts-first' && block.sourceRules[itemId]?.importOff) return 'locked'
  if (kind === 'connections-first' && !receivesItem(block, itemId, blockIds)) return 'no-connection'
  return undefined
}

/** The ids of the items that have at least one rule with an effect: the items that carry the marker. */
export function itemsWithEffect(rules: readonly SourceRulePart[]): ReadonlySet<string> {
  return new Set(rules.filter(r => r.noEffect === undefined).map(r => r.itemId))
}

const NO_ITEMS: ReadonlySet<string> = new Set()
const ruleItemsCache = new WeakMap<Block, { gameData: GameData; blocks: readonly Block[]; items: ReadonlySet<string> }>()

/**
 * `itemsWithEffect` for one block of the plan, where `blocks` is every block of the plan (the block store's array).
 * The answer is kept per block object, so asking once per chip costs one `sourceRules` call per block and per change
 * of the plan. It relies on the store replacing a block, the array and the game data when they change, never
 * mutating them.
 */
export function sourceRuleItems(block: Block, gameData: GameData, blocks: readonly Block[]): ReadonlySet<string> {
  const cached = ruleItemsCache.get(block)
  if (cached && cached.gameData === gameData && cached.blocks === blocks) return cached.items
  // A block without a rule, the usual case, needs no walk and shares one empty set.
  const hasRule = Object.keys(block.sourceRules).length > 0
  const items = hasRule ? itemsWithEffect(sourceRules(block, gameData, new Set(blocks.map(b => b.id)))) : NO_ITEMS
  ruleItemsCache.set(block, { gameData, blocks, items })
  return items
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
