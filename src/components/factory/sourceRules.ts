import type { Block, GameData } from '../../data/types'
import { presetOf } from '../../data/sourceRules'
import { blockAreas, type SolverArea } from '../../solver/areas'
import { hasProduct, receivesItem } from '../../solver/blockGraph'
import { findSubPlan, storedAreaRule } from '../../data/subPlanTree'
import type { SubPlan } from '../../data/types'
import { blockMakesItem } from '../../solver/index'

// ---------------------------------------------------------------------------
// Which of a block's source rules have an effect. A rule is one non-default stored setting of one item:
// a part of an item's stored rule (`Block.sourceRules`): its `makeHere` preset or its Import-off switch. Pure functions of the block and the game
// data; no solve result is read, so a rule is judged by what the block is, not by what the solver did. An area's own
// rule (`SubPlan.sourceRules`) is listed part by part after the block's; its effect is judged by its own rows.
// ---------------------------------------------------------------------------

/**
 * `make-here` is an area's rule with no preset that overrides a block rule that has one (the area makes it here, whatever
 * the block says); `import-on` is an area's rule with Import on that overrides a block rule that has it off; `takes-nothing` is
 * one area switched off as a supplier of the item (`areasOff`), named by `otherAreaId`.
 */
export type SourceRuleKind = 'connections-first' | 'byproducts-first' | 'import-off' | 'make-here' | 'import-on' | 'takes-nothing'
export type NoEffectReason = 'product' | 'not-made' | 'no-connection'

export interface SourceRulePart {
  itemId: string
  kind: SourceRuleKind
  /** The area whose rule this part is; absent for a rule of the block. */
  areaId?: string
  /** A `takes-nothing` part: the area that supplies nothing. */
  otherAreaId?: string
  /** Why the solver ignores the rule; absent when it has an effect. */
  noEffect?: NoEffectReason
}

/**
 * Every part of every rule of the block, in map order, the `makeHere` part before `import-off`; then the parts of the
 * rules of its areas, areas in table order, each rule's parts in the same order (and a `make-here` part last when the
 * area's rule has no preset where the block's has one, then an `import-on` part when it has Import on where the block's is off,
 * then one `takes-nothing` part per area in its `areasOff`, in stored order).
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
  for (const area of blockAreas(block.rootPlan) ?? []) {
    const stored = findSubPlan(block.rootPlan, area.id)?.sourceRules
    if (!stored) continue
    for (const [itemId, rule] of Object.entries(stored)) {
      const kind = presetOf(rule)
      const part = (k: SourceRuleKind) => withEffect(block, gameData, blockIds, { itemId, kind: k, areaId: area.id })
      if (kind) rules.push(part(kind))
      if (rule.importOff) rules.push(part('import-off'))
      const blockRule = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : undefined
      if (!kind && presetOf(blockRule)) rules.push(part('make-here'))
      if (!rule.importOff && blockRule?.importOff) rules.push(part('import-on'))
      for (const otherAreaId of rule.areasOff ?? []) rules.push(withEffect(block, gameData, blockIds, { itemId, kind: 'takes-nothing', areaId: area.id, otherAreaId }))
    }
  }
  return rules
}

/** Whether the block, or any plan of its tree, has a stored rule. */
function hasAnyRule(block: Block): boolean {
  const walk = (plan: SubPlan): boolean => (plan.sourceRules !== undefined && Object.keys(plan.sourceRules).length > 0) || plan.subPlans.some(walk)
  return Object.keys(block.sourceRules).length > 0 || walk(block.rootPlan)
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
  { itemId, kind, areaId, otherAreaId }: SourceRulePart,
): NoEffectReason | undefined {
  // A switch is about the other area's rows, whatever the block does with the item: it only does nothing when that area makes none.
  if (kind === 'takes-nothing') {
    const other = new Set(blockAreas(block.rootPlan)?.find(a => a.id === otherAreaId)?.nodeIds)
    return blockMakesItem(block, gameData, itemId, other) ? undefined : 'not-made'
  }
  if (hasProduct(block, itemId)) return 'product'
  // An area's rule is about the rows of that area: with none making the item it changes nothing there.
  const rows = areaId === undefined ? undefined : new Set(blockAreas(block.rootPlan)?.find(a => a.id === areaId)?.nodeIds)
  if (!blockMakesItem(block, gameData, itemId, rows)) return 'not-made'
  if (kind === 'connections-first' && !receivesItem(block, itemId, blockIds)) return 'no-connection'
  return undefined
}

/** The ids of the items that have at least one rule with an effect: the items that carry the marker. */
export function itemsWithEffect(rules: readonly SourceRulePart[]): ReadonlySet<string> {
  return new Set(rules.filter(r => r.noEffect === undefined).map(r => r.itemId))
}

const NO_ITEMS: ReadonlySet<string> = new Set()
const NO_AREA_ITEMS: ReadonlyMap<string, ReadonlySet<string>> = new Map()
interface RuleItems {
  /** `rowRuleItems` per area, filled as asked. */
  rows: Map<string, ReadonlySet<string>>
  gameData: GameData
  blocks: readonly Block[]
  /** The items whose rule of the block has an effect. */
  items: ReadonlySet<string>
  /** Per area that has a rule with an effect, the items it changes. */
  areas: ReadonlyMap<string, ReadonlySet<string>>
}
const ruleItemsCache = new WeakMap<Block, RuleItems>()

function ruleItemsOf(block: Block, gameData: GameData, blocks: readonly Block[]): RuleItems {
  const cached = ruleItemsCache.get(block)
  if (cached && cached.gameData === gameData && cached.blocks === blocks) return cached
  // A block without a rule, the usual case, needs no walk and shares one empty set.
  let items = NO_ITEMS
  let areas = NO_AREA_ITEMS
  if (hasAnyRule(block)) {
    const parts = sourceRules(block, gameData, new Set(blocks.map(b => b.id))).filter(r => r.noEffect === undefined)
    items = new Set(parts.filter(r => r.areaId === undefined).map(r => r.itemId))
    const byArea = new Map<string, Set<string>>()
    for (const r of parts) if (r.areaId !== undefined) (byArea.get(r.areaId) ?? byArea.set(r.areaId, new Set()).get(r.areaId)!).add(r.itemId)
    areas = byArea
  }
  const entry = { rows: new Map<string, ReadonlySet<string>>(), gameData, blocks, items, areas }
  ruleItemsCache.set(block, entry)
  return entry
}

/**
 * `itemsWithEffect` for the rules of one block of the plan (not of its areas), where `blocks` is every block of the plan
 * (the block store's array). The answer is kept per block object, so asking once per chip costs one `sourceRules` call per
 * block and per change of the plan. It relies on the store replacing a block, the array and the game data when they change,
 * never mutating them.
 */
export function sourceRuleItems(block: Block, gameData: GameData, blocks: readonly Block[]): ReadonlySet<string> {
  return ruleItemsOf(block, gameData, blocks).items
}

/** Per area of the block, the items whose rule on that area has an effect (areas without one are absent). Kept like `sourceRuleItems`. */
export function areaRuleItems(block: Block, gameData: GameData, blocks: readonly Block[]): ReadonlyMap<string, ReadonlySet<string>> {
  return ruleItemsOf(block, gameData, blocks).areas
}

/**
 * The items of `block` whose rule shows on the rows of the area `areaId`: the block's items, except those the area has a
 * rule of its own for (its rule replaces the block's, whole), plus the items its own rules change. Without an area it is
 * `sourceRuleItems`.
 */
export function rowRuleItems(block: Block, gameData: GameData, blocks: readonly Block[], areaId: string | undefined): ReadonlySet<string> {
  const entry = ruleItemsOf(block, gameData, blocks)
  const base = entry.items
  if (areaId === undefined) return base
  const own = findSubPlan(block.rootPlan, areaId)?.sourceRules
  const changed = entry.areas.get(areaId)
  if (!own && !changed) return base
  // Kept per area beside the rest of the entry: RecipeRow asks on every render of every row.
  const cached = entry.rows.get(areaId)
  if (cached) return cached
  const items = new Set([...base].filter(id => !own || !Object.hasOwn(own, id)))
  for (const id of changed ?? []) items.add(id)
  entry.rows.set(areaId, items)
  return items
}

/**
 * The areas the scope control of the Comes from control offers for an item: the one it was opened for (`areaId`), the one it
 * is on (`area`) and those with a rule of their own for the item, in table order. None: no scope control.
 */
export function scopeAreasOf(block: Block, itemId: string, areaId: string | undefined, area: string | undefined): SolverArea[] {
  return (blockAreas(block.rootPlan) ?? []).filter(a => a.id === areaId || a.id === area || storedAreaRule(block.rootPlan, a.id, itemId) !== undefined)
}

/** The text shown beside a rule that has no effect. */
export function noEffectText(reason: NoEffectReason, itemName: string, inArea = false, otherAreaName?: string): string {
  switch (reason) {
    case 'product': return `${itemName} is a product of this block, so the block always makes it.`
    case 'not-made': return otherAreaName !== undefined ? `No row in ${otherAreaName} makes ${itemName}.` : `No row in this ${inArea ? 'area' : 'block'} makes ${itemName}.`
    case 'no-connection': return `No connection for ${itemName}.`
  }
}
