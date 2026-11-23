import { create } from 'zustand'
import { canConnect } from './connections'
import { areaIdsOf, effectiveAreaRule as effectiveAreaRuleOf, findSubPlan, repeatsBlockRule, remapAreaRules, storedAreaRule as storedAreaRuleOf } from '../data/subPlanTree'
import { canAddGroupIn, canCopyGroupInto, canMoveNodeInto } from '../data/nesting'
import { hasProduct } from '../solver/blockGraph'
import { areaRecipeIds, blockAreas, subPlanAreaIds, subPlanCopyBlocker } from '../solver/areas'
import { pickBlockColor, defaultBlockColor, HEX_COLOR_RE } from '../data/blockColors'
import { useGameDataStore, selectGameData } from './gameDataStore'
import type { AppState, Block, BlockConnection, SubPlan, SubPlanNode, Product, RecipeNode, GameRecipeNode, ModuleConfig, BeaconConfig, SourceRule, AreaSourceRule, ServedEntry } from '../data/types'
import { insertionTarget } from '../utils/insertionTarget'
import { canonicalServedList, dropServedEntries, expandServedAreas, isServedConsumer, remapServedOrder, sameServedEntry, sameServedList, servedEntryKey, servedListOf, withoutServedConsumer, withServedEntryPlaced, withServedEntryRanked, withServedList, withServedShare, withServedTied } from '../data/servedEntries'
import type { ServedPlace } from '../data/servedEntries'
import { cutAreaRules, restoreAreaRules, type AreaRuleCut } from './areaRuleCuts'
import { cutServedEntries, lostAreaIds, restoreServedCuts, type ServedCut } from './servedCuts'

// ---------------------------------------------------------------------------
// Command pattern — operates on the active Block, with full apply/undo.
// ---------------------------------------------------------------------------

interface Command {
  /** `blocks` is every block of the plan before this change. */
  apply: (block: Block, blocks: readonly Block[]) => Block
  undo: (block: Block, blocks: readonly Block[]) => Block
  /**
   * Optional change to other blocks, run right after apply/undo; `blocks` already holds the changed `block`.
   * Used when the command lives in one block's history but must also keep another block's data in step
   * (a consumer's connection and the source's served list).
   */
  applyOthers?: (blocks: Block[], block: Block) => Block[]
  undoOthers?: (blocks: Block[], block: Block) => Block[]
  /**
   * Optional guards, given every block of the plan: false means running that
   * direction would break a plan-wide rule, so undo/redo drops the command
   * instead of applying it.
   */
  canApply?: (blocks: Block[], block: Block) => boolean
  canUndo?: (blocks: Block[], block: Block) => boolean
}

interface BlockHistory {
  undoStack: Command[]
  redoStack: Command[]
}

// ---------------------------------------------------------------------------
// SubPlan tree helpers
// ---------------------------------------------------------------------------

/** Find the SubPlan whose `subPlans` directly contains the given child id. */
function findParentSubPlan(plan: SubPlan, childId: string): SubPlan | undefined {
  if (plan.subPlans.some(sp => sp.id === childId)) return plan
  for (const sp of plan.subPlans) {
    const found = findParentSubPlan(sp, childId)
    if (found) return found
  }
  return undefined
}

/** Find the SubPlan that directly contains a node with the given nodeId. */
function findSubPlanContainingNode(plan: SubPlan, nodeId: string): SubPlan | undefined {
  if (plan.nodes.some(n => n.id === nodeId)) return plan
  for (const sp of plan.subPlans) {
    const found = findSubPlanContainingNode(sp, nodeId)
    if (found) return found
  }
  return undefined
}

function updateSubPlanInTree(
  plan: SubPlan,
  targetId: string,
  fn: (p: SubPlan) => SubPlan,
): SubPlan {
  if (plan.id === targetId) return fn(plan)
  return {
    ...plan,
    subPlans: plan.subPlans.map(sp => updateSubPlanInTree(sp, targetId, fn)),
  }
}

function removeSubPlanFromTree(plan: SubPlan, targetId: string): SubPlan {
  return {
    ...plan,
    subPlans: plan.subPlans
      .filter(sp => sp.id !== targetId)
      .map(sp => removeSubPlanFromTree(sp, targetId)),
  }
}

// Remove any SubPlanNode referencing removedId from every node list in the tree.
/** Return true when candidateId is a descendant of (or equal to) ancestorId. */
export function isSubPlanDescendant(plan: SubPlan, ancestorId: string, candidateId: string): boolean {
  const ancestor = findSubPlan(plan, ancestorId)
  if (!ancestor) return false
  return findSubPlan(ancestor, candidateId) !== undefined
}

function removeSubPlanNodeReferences(plan: SubPlan, removedId: string): SubPlan {
  return {
    ...plan,
    nodes: plan.nodes.filter(n => !(n.kind === 'subplan' && n.subPlanId === removedId)),
    subPlans: plan.subPlans.map(sp => removeSubPlanNodeReferences(sp, removedId)),
  }
}

function withUpdatedAt(plan: SubPlan): SubPlan {
  return { ...plan, updatedAt: new Date().toISOString() }
}

/** Return a new Block with the active subplan (or its ancestor on the path
 *  to the target subplan) marked as updated. */
function touchSubPlan(block: Block, subPlanId: string): Block {
  return {
    ...block,
    rootPlan: updateSubPlanInTree(block.rootPlan, subPlanId, withUpdatedAt),
  }
}

/**
 * Apply `fn` to every game-recipe row of the tree. Returns the same object when nothing changed;
 * only a sub-plan whose own rows changed is marked as updated.
 */
function mapGameRecipeNodes(plan: SubPlan, fn: (n: GameRecipeNode) => GameRecipeNode): SubPlan {
  let changed = false
  const nodes = plan.nodes.map(n => {
    if (n.kind !== 'game-recipe') return n
    const next = fn(n)
    if (next !== n) changed = true
    return next
  })
  const subPlans = plan.subPlans.map(sp => mapGameRecipeNodes(sp, fn))
  const subChanged = subPlans.some((sp, i) => sp !== plan.subPlans[i])
  if (!changed && !subChanged) return plan
  const next = { ...plan, nodes: changed ? nodes : plan.nodes, subPlans: subChanged ? subPlans : plan.subPlans }
  return changed ? withUpdatedAt(next) : next
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function makeEmptySubPlan(name: string): SubPlan {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    nodes: [],
    subPlans: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** A fresh, unconfigured recipe node for `recipeId`. */
export function makeRecipeNode(recipeId: string): RecipeNode {
  return {
    kind: 'game-recipe',
    id: crypto.randomUUID(),
    recipeId,
    modules: [],
    byproductPolicy: {},
  }
}

export function makeEmptyBlock(name: string, color: string = pickBlockColor([]), colorAuto = false): Block {
  return {
    id: crypto.randomUUID(),
    name,
    color,
    colorAuto,
    products: [],
    sourceRules: {},
    inputConnections: [],
    rootPlan: makeEmptySubPlan('Main'),
  }
}

/**
 * Deep copy of a sub-plan tree with a fresh id on every sub-plan and node. `subplan` nodes are
 * remapped to the cloned child sub-plans; names, timestamps and `area` flags are kept. Area rules are kept with
 * their `areasOff` ids carried to the copies; an id with no copy (an area outside the copied tree) is dropped.
 */
export function cloneSubPlanTree(plan: SubPlan): SubPlan {
  return cloneSubPlanTreeWithIds(plan).plan
}

/** `cloneSubPlanTree` and the map from each source sub-plan id to its copy's id. */
function cloneSubPlanTreeWithIds(plan: SubPlan): { plan: SubPlan; ids: Map<string, string> } {
  const subPlanIds = new Map<string, string>()

  function cloneSubPlan(source: SubPlan): SubPlan {
    const id = crypto.randomUUID()
    subPlanIds.set(source.id, id)
    return { ...structuredClone(source), id, nodes: [], subPlans: source.subPlans.map(cloneSubPlan) }
  }

  const rootPlan = cloneSubPlan(plan)

  function cloneNodes(source: SubPlan, target: SubPlan) {
    target.nodes = source.nodes.map((node): RecipeNode | SubPlanNode => {
      const copy = structuredClone(node)
      copy.id = crypto.randomUUID()
      if (copy.kind === 'subplan') copy.subPlanId = subPlanIds.get(copy.subPlanId) ?? copy.subPlanId
      return copy
    })
    const rules = remapAreaRules(source.sourceRules, subPlanIds)
    if (rules) target.sourceRules = rules
    else delete target.sourceRules
    source.subPlans.forEach((child, i) => cloneNodes(child, target.subPlans[i]))
  }
  cloneNodes(plan, rootPlan)

  return { plan: rootPlan, ids: subPlanIds }
}

/**
 * Deep copy of a block with a fresh id on the block, its products, input
 * connections, sub-plans and nodes (see `cloneSubPlanTree`). Connections from
 * other blocks reading this one are not part of the block, so they are not copied.
 */
export function cloneBlock(block: Block, color: string): Block {
  return cloneBlockWithIds(block, color).block
}

/** `cloneBlock` and the map from each source sub-plan id to its copy's id. */
function cloneBlockWithIds(block: Block, color: string): { block: Block; subPlanIds: Map<string, string> } {
  const tree = cloneSubPlanTreeWithIds(block.rootPlan)
  const copy: Block = {
    ...structuredClone(block),
    id: crypto.randomUUID(),
    name: `${block.name} (copy)`,
    color,
    // A copy keeps its own colour (never its source's), so it does not follow its first product.
    colorAuto: false,
    products: block.products.map(p => ({ ...structuredClone(p), id: crypto.randomUUID() })),
    inputConnections: block.inputConnections.map(c => ({ ...c, id: crypto.randomUUID() })),
    rootPlan: tree.plan,
  }
  // The consumers a served list ranks are not copied, so the copy starts without one.
  delete copy.servedOrder
  return { block: copy, subPlanIds: tree.ids }
}

/**
 * Deep copy of a whole plan with fresh ids on every block (and below), so two
 * plans never share ids that the solver results and undo history are keyed by.
 * Names and colours are kept; connections and the active block are remapped
 * to the copies. The input is not mutated.
 */
export function clonePlan(appState: AppState): AppState {
  const cloned = appState.blocks.map(b => cloneBlockWithIds(b, b.color))
  const copies = cloned.map((c, i) => ({ ...c.block, name: appState.blocks[i].name }))
  const ids = new Map(appState.blocks.map((b, i) => [b.id, copies[i].id]))
  // Area ids are sub-plan ids: every copy's sub-plans got fresh ones. This cross-block map is for the served lists only; area rules name areas of their own block, remapped per block.
  const areaIds = new Map(cloned.flatMap(c => [...c.subPlanIds]))
  return {
    blocks: copies.map((b, i) => {
      const out: Block = {
        ...b,
        inputConnections: b.inputConnections.map(c => ({ ...c, fromBlockId: ids.get(c.fromBlockId) ?? c.fromBlockId })),
      }
      // The served lists name blocks: point them at the copies (never write an undefined key).
      const served = appState.blocks[i].servedOrder
      const remapped = served === undefined ? undefined : remapServedOrder(served, ids, areaIds)
      if (remapped !== undefined) out.servedOrder = remapped
      return out
    }),
    activeBlockId: ids.get(appState.activeBlockId) ?? appState.activeBlockId,
    horizonTechnologyIds: [...appState.horizonTechnologyIds],
    defaultMachineOverrides: { ...appState.defaultMachineOverrides },
  }
}

/**
 * The block with itemId's rule replaced, or its entry removed when the rule has no key (the default rule).
 * An item that has an entry keeps its place in the map; a new entry goes at `at` (default: the end).
 */
function withSourceRule(block: Block, itemId: string, rule: SourceRule, at?: number): Block {
  // An absent key is never written: spell the rule out from the keys it has.
  const clean: SourceRule = {
    ...(rule.makeHere !== undefined && { makeHere: rule.makeHere }),
    ...(rule.importOff !== undefined && { importOff: rule.importOff }),
    ...(rule.leftoverOff !== undefined && { leftoverOff: rule.leftoverOff }),
  }
  const empty = clean.makeHere === undefined && clean.importOff === undefined && clean.leftoverOff === undefined
  const entries = Object.entries(block.sourceRules)
  if (Object.hasOwn(block.sourceRules, itemId))
    return { ...block, sourceRules: Object.fromEntries(empty ? entries.filter(([id]) => id !== itemId) : entries.map(([id, r]) => [id, id === itemId ? clean : r])) }
  if (empty) return block
  entries.splice(at ?? entries.length, 0, [itemId, clean])
  return { ...block, sourceRules: Object.fromEntries(entries) }
}

/** Command setting `itemId`'s rule from `before` to `after`; undo puts a removed entry back at its old place in the map. */
function sourceRuleCommand(block: Block, itemId: string, before: SourceRule, after: SourceRule): Command {
  const index = Object.keys(block.sourceRules).indexOf(itemId)
  return {
    apply: b => withSourceRule(b, itemId, after),
    undo: b => withSourceRule(b, itemId, before, index < 0 ? undefined : index),
  }
}

/** `rule` with the keys it has only; `areasOff` only when non-empty (a copy). */
function cleanAreaRule(rule: AreaSourceRule): AreaSourceRule {
  return {
    ...(rule.makeHere !== undefined && { makeHere: rule.makeHere }),
    ...(rule.importOff !== undefined && { importOff: rule.importOff }),
    ...(rule.areasOff !== undefined && rule.areasOff.length > 0 && { areasOff: [...rule.areasOff] }),
  }
}

/** The rule stored on the area for an item, or undefined. */
function storedAreaRule(block: Block, areaId: string, itemId: string): AreaSourceRule | undefined {
  return storedAreaRuleOf(block.rootPlan, areaId, itemId)
}

/** The area's own rule for an item when it has one, else the block's (`effectiveAreaRule` of `subPlanTree.ts`). */
function effectiveAreaRule(block: Block, areaId: string, itemId: string): AreaSourceRule {
  return effectiveAreaRuleOf(block.rootPlan, block.sourceRules, areaId, itemId)
}

/**
 * The block with the area's rule for an item replaced, or removed when `rule` is undefined. A rule with no key is
 * kept (it is a real rule). An existing entry keeps its place in the map; a new entry goes at `at` (default: the end);
 * an emptied map removes the `sourceRules` key.
 */
function withAreaRule(block: Block, areaId: string, itemId: string, rule: AreaSourceRule | undefined, at?: number): Block {
  const update = (p: SubPlan): SubPlan => {
    const { sourceRules, ...rest } = p
    const entries = Object.entries(sourceRules ?? {})
    const has = Object.hasOwn(sourceRules ?? {}, itemId)
    let next: [string, AreaSourceRule][]
    if (rule === undefined) next = entries.filter(([id]) => id !== itemId)
    else if (has) next = entries.map(([id, r]) => [id, id === itemId ? cleanAreaRule(rule) : r])
    else {
      next = [...entries]
      next.splice(at ?? next.length, 0, [itemId, cleanAreaRule(rule)])
    }
    return next.length === 0 ? rest : { ...rest, sourceRules: Object.fromEntries(next) }
  }
  return touchSubPlan({ ...block, rootPlan: updateSubPlanInTree(block.rootPlan, areaId, update) }, areaId)
}

/** Command setting an area's rule for an item from `before` to `after` (undefined: no entry); undo puts a removed entry back at its old place in the map. */
function areaRuleCommand(block: Block, areaId: string, itemId: string, before: AreaSourceRule | undefined, after: AreaSourceRule | undefined): Command {
  const index = Object.keys(findSubPlan(block.rootPlan, areaId)?.sourceRules ?? {}).indexOf(itemId)
  const valid = (b: Block, rule: AreaSourceRule | undefined): boolean => {
    const areas = areaIdsOf(b.rootPlan)
    return areas.has(areaId) && (rule?.areasOff ?? []).every(id => areas.has(id))
  }
  return {
    apply: b => withAreaRule(b, areaId, itemId, after),
    undo: b => withAreaRule(b, areaId, itemId, before, index < 0 ? undefined : index),
    canApply: (_blocks, b) => valid(b, after),
    canUndo: (_blocks, b) => valid(b, before),
  }
}

/**
 * The two halves of keeping the source's served list in step with a consumer's connection. `leave` runs once the
 * consumer has lost its last connection for the item: it removes every entry of the consumer (plain and area) from
 * the source's list and remembers what it removed. `restore` puts them back (see `restoreServedCuts`), at most once.
 */
function servedCleanup(connection: BlockConnection): {
  leave: (blocks: Block[], consumer: Block) => Block[]
  restore: (blocks: Block[], consumer: Block) => Block[]
} {
  const { itemId, fromBlockId } = connection
  let cuts: ServedCut[] = []
  return {
    leave: (blocks, consumer) => {
      cuts = []
      // A hand-edited duplicate connection keeps the entry.
      if (consumer.inputConnections.some(c => c.itemId === itemId && c.fromBlockId === fromBlockId)) return blocks
      const r = cutServedEntries(blocks, (s, item, e) => s.id === fromBlockId && item === itemId && e.kind === 'block' && e.blockId === consumer.id)
      cuts = r.cuts
      return r.blocks
    },
    restore: blocks => {
      // What `leave` removed is put back at most once.
      const gone = cuts
      cuts = []
      return gone.length === 0 ? blocks : restoreServedCuts(blocks, gone)
    },
  }
}

/**
 * `applyOthers` of a command that can take areas away from a consumer: the entries naming a lost area are cut from the
 * sources' lists (the consumer is the block the command runs on) and handed to `keep` for the undo.
 */
function servedAreaCuts(lost: () => ReadonlySet<string>, keep: (cuts: ServedCut[]) => void): (blocks: Block[], consumer: Block) => Block[] {
  return (blocks, consumer) => {
    const gone = lost()
    const r = cutServedEntries(blocks, (_s, _i, e) => e.kind === 'block' && e.blockId === consumer.id && e.areaId !== undefined && gone.has(e.areaId))
    keep(r.cuts)
    return r.blocks
  }
}

/** Whether the consumer `blockId` has the area `areaId` in `blocks`. */
function hasAreaIn(blocks: readonly Block[], blockId: string, areaId: string): boolean {
  const consumer = blocks.find(b => b.id === blockId)
  return consumer !== undefined && (blockAreas(consumer.rootPlan)?.some(a => a.id === areaId) ?? false)
}

/**
 * Where a served-list command starts from, and how it starts again when it is applied (redo) later: whether an entry may
 * be in the list, the stored list, the base to edit, and `start`, which gives the list to edit in `b` (undefined: the
 * list was reset meanwhile and this command did not start it). A plain block entry of a stored list is expanded into the
 * area entries `shown` draws; with no stored list the shown order is the list (a stale entry never writes an invalid
 * one). An area entry of `shown` whose area existed when the command was made but is gone when it is applied is left
 * out, so a redo never brings back an entry for an area the block no longer has.
 */
function servedBaseOf(blocks: readonly Block[], source: Block, itemId: string, shown: readonly ServedEntry[]) {
  const consumer = (e: ServedEntry) => e.kind === 'extra' || isServedConsumer(blocks, source.id, itemId, e.blockId)
  const list = servedListOf(source, itemId)
  const existed = new Set(shown.filter(e => e.kind === 'block' && e.areaId !== undefined && hasAreaIn(blocks, e.blockId, e.areaId)).map(servedEntryKey))
  const startFrom = (now: readonly Block[], stored: ServedEntry[] | undefined): ServedEntry[] => {
    const live = shown.filter(e => !(existed.has(servedEntryKey(e)) && e.kind === 'block' && !hasAreaIn(now, e.blockId, e.areaId!)))
    return stored !== undefined
      ? expandServedAreas(stored, live)
      : canonicalServedList(live.filter((e, i) => (e.kind === 'extra' || isServedConsumer(now, source.id, itemId, e.blockId)) && live.findIndex(o => sameServedEntry(o, e)) === i))
  }
  const base = startFrom(blocks, list)
  const created = list === undefined
  const start = (b: Block, now: readonly Block[]): ServedEntry[] | undefined => {
    const stored = servedListOf(b, itemId)
    return stored === undefined && !created ? undefined : startFrom(now, stored)
  }
  return { consumer, list, base, start }
}

/**
 * State after an edit of one item's served list: `edit` maps the list to its next version (undefined: nothing changes,
 * no history entry). The command records what it overwrote, so its undo restores it exactly while the list is still as
 * written; `inverse` (optional) is the fallback after other changes to the list.
 */
function servedEditState(
  state: BlockStoreState,
  sourceBlockId: string,
  itemId: string,
  entry: ServedEntry,
  shown: readonly ServedEntry[],
  edit: (list: ServedEntry[]) => ServedEntry[] | undefined,
  inverse?: (list: ServedEntry[]) => ServedEntry[] | undefined,
): Partial<BlockStoreState> {
  const source = state.blocks.find(b => b.id === sourceBlockId)
  if (!source || itemId === '') return state
  const { consumer, list, base, start } = servedBaseOf(state.blocks, source, itemId, shown)
  if (!consumer(entry)) return state
  if (list === undefined && !base.some(e => sameServedEntry(e, entry))) return state
  if (edit(base) === undefined) return state
  let prior: ServedEntry[] | undefined
  let written: ServedEntry[] | undefined
  const cmd: Command = {
    apply: (b, blocks) => {
      prior = servedListOf(b, itemId)
      written = undefined
      // The list was reset meanwhile: only the first write may start one again.
      const current = start(b, blocks)
      if (current === undefined) return b
      // As in moveServed: a block entry whose consumer left is not written to.
      if (entry.kind === 'block' && !isServedConsumer(blocks, b.id, itemId, entry.blockId)) return b
      const next = edit(current)
      if (next === undefined) return b
      written = next
      return withServedList(b, itemId, next)
    },
    undo: b => {
      const current = servedListOf(b, itemId)
      if (written !== undefined && current !== undefined && sameServedList(current, written)) return withServedList(b, itemId, prior)
      // Only a command whose apply wrote something has a flag of its own to undo.
      const back = written !== undefined && current ? inverse?.(current) : undefined
      return back ? withServedList(b, itemId, back) : b
    },
  }
  return applyCommand(state, cmd, sourceBlockId)
}

/** Command adding a connection for `itemId` from `fromBlockId`; undo removes it, redo is checked against the then-current blocks. */
function addConnectionCommand(itemId: string, fromBlockId: string): Command {
  // The id is fixed here so redo restores the same connection.
  const connection: BlockConnection = { id: crypto.randomUUID(), itemId, fromBlockId }
  const cleanup = servedCleanup(connection)
  return {
    apply: b => ({ ...b, inputConnections: [...b.inputConnections, connection] }),
    undo: b => ({ ...b, inputConnections: b.inputConnections.filter(c => c.id !== connection.id) }),
    // Undoing the add can remove the consumer's last connection for the item: its served entry goes too, and redo
    // puts it back. A first apply restores nothing (a new connection never joins a list).
    applyOthers: cleanup.restore,
    undoOthers: cleanup.leave,
    // Redo after other blocks changed may no longer be legal.
    canApply: (blocks, b) => canConnect(blocks, b, itemId, fromBlockId),
  }
}

/**
 * `connections` with `id` placed just before `beforeId` among the connections of its item (after the item's last
 * one when null), or undefined when nothing would move or the two differ in item. The item's connections are
 * rearranged within the slots they already occupy, so every other item's connections stay exactly where they are.
 */
function withConnectionMoved(connections: BlockConnection[], id: string, beforeId: string | null): BlockConnection[] | undefined {
  const moving = connections.find(c => c.id === id)
  if (!moving || beforeId === id) return undefined
  const slots = connections.flatMap((c, i) => (c.itemId === moving.itemId ? [i] : []))
  const rest = slots.map(i => connections[i]).filter(c => c.id !== id)
  const at = beforeId === null ? rest.length : rest.findIndex(c => c.id === beforeId)
  if (at < 0) return undefined
  const arranged = [...rest.slice(0, at), moving, ...rest.slice(at)]
  const next = [...connections]
  slots.forEach((slot, k) => { next[slot] = arranged[k] })
  return next.every((c, i) => c === connections[i]) ? undefined : next
}

/** The connection after `id` among those of its item, or null when it is the item's last. */
function nextOfItem(connections: BlockConnection[], id: string): string | null {
  const own = connections.find(c => c.id === id)
  const siblings = connections.filter(c => c.itemId === own?.itemId)
  return siblings[siblings.findIndex(c => c.id === id) + 1]?.id ?? null
}

/**
 * The move as one undoable command in block `targetId`. `pickBefore` gets the block's connections and returns the
 * id to move before (null: the end; undefined: nothing to do). The command records only the moved connection and
 * its two anchors and re-applies the move on the current list, so connections added, removed or moved in between
 * are never lost, and a missing anchor leaves the list as it is.
 */
function moveConnectionState(
  state: BlockStoreState,
  connectionId: string,
  pickBefore: (connections: BlockConnection[]) => string | null | undefined,
  targetId: string,
) {
  const block = state.blocks.find(b => b.id === targetId)
  if (!block) return state
  const before = pickBefore(block.inputConnections)
  if (before === undefined || !withConnectionMoved(block.inputConnections, connectionId, before)) return state
  const oldBefore = nextOfItem(block.inputConnections, connectionId)
  const reapply = (b: Block, anchor: string | null): Block => {
    const next = withConnectionMoved(b.inputConnections, connectionId, anchor)
    return next ? { ...b, inputConnections: next } : b
  }
  const cmd: Command = { apply: b => reapply(b, before), undo: b => reapply(b, oldBefore) }
  return applyCommand(state, cmd, targetId)
}

/** Set or clear a connection's limit; clearing deletes the key so undo restores equality. */
function withMaxRate(block: Block, connectionId: string, maxRate: number | undefined): Block {
  return {
    ...block,
    inputConnections: block.inputConnections.map(c => {
      if (c.id !== connectionId) return c
      if (maxRate !== undefined) return { ...c, maxRate }
      const rest = { ...c }
      delete rest.maxRate
      return rest
    }),
  }
}

/** `block.products` with the product `id` moved to index `to` of the resulting array. */
function moveProductTo(products: readonly Product[], id: string, to: number): Product[] {
  const from = products.findIndex(p => p.id === id)
  if (from < 0) return [...products]
  const next = [...products]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Set or clear a product's extra output; clearing deletes the key so undo restores equality. */
function withExtra(block: Block, productId: string, extraRate: number | undefined): Block {
  return {
    ...block,
    products: block.products.map(p => {
      if (p.id !== productId) return p
      if (extraRate !== undefined) return { ...p, extraRate }
      const rest = { ...p }
      delete rest.extraRate
      return rest
    }),
  }
}

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

export interface BlockStoreState {
  blocks: Block[]
  activeBlockId: string
  /** Technologies the plan targets (see AppState.horizonTechnologyIds). */
  horizonTechnologyIds: string[]
  /** Default machine per category chosen by the user (see AppState.defaultMachineOverrides). */
  defaultMachineOverrides: Record<string, string>
  history: Record<string, BlockHistory>

  // Block management
  addBlock: () => void
  removeBlock: (blockId: string) => void
  duplicateBlock: (blockId: string) => void
  /** Move a block to an insertion index (0..length, counted before removal, as `moveNode`). Not undoable. */
  moveBlock: (blockId: string, toIndex: number) => void
  renameBlock: (blockId: string, name: string) => void
  /** Pick a colour (ends the default colour). Undoable, in the history of `blockId`. */
  setBlockColor: (blockId: string, color: string) => void
  /**
   * Back to the default colour: the block follows the icon of its first product again (see
   * `Block.colorAuto`) and takes the colour that gives now; a block with no product keeps its
   * colour until it has one. Not undoable.
   */
  resetBlockColor: (blockId: string) => void
  setActiveBlock: (blockId: string) => void
  // SubPlan management
  addSubPlan: (parentSubPlanId: string, name: string) => void
  removeSubPlan: (subPlanId: string) => void
  /**
   * Copy a sub-factory (handle and sub-plan, fresh ids, named "<name> (copy)") into area `areaId` of the
   * active block as one undoable command; returns the new handle's node id. Refused (undefined, no history
   * entry) when `subPlanCopyBlocker` reports a reason.
   */
  duplicateSubPlanTo: (subPlanId: string, areaId: string) => string | undefined
  /** Make a sub-factory a separate area in the solve (or an organising group again). Undoable. */
  setSubPlanArea: (subPlanId: string, area: boolean) => void
  renameSubPlan: (subPlanId: string, name: string) => void

  // Products (block-level)
  /** Add a product to the active block, or to block `toBlockId` (the history entry goes to that block, as the connection commands do). */
  addProduct: (product: Product, toBlockId?: string) => void
  removeProduct: (productId: string) => void
  /** Move a product of the active block so it lands before index `toIndex` (counted in the current order, as moveBlock). Undoable; no-op when it would not move. */
  moveProduct: (productId: string, toIndex: number) => void
  /** Move a product of the active block one place earlier (-1) or later (1), resolved against the current order. Undoable; no-op at either end. */
  moveProductBy: (productId: string, delta: -1 | 1) => void
  updateProductExtra: (productId: string, extraRate: number | undefined) => void

  /** Set where "Make more here" sits in the active block's rule for an item (undefined = before the block lines, the default). The item's Import switch stays. Undoable; no-op when unchanged. */
  setMakeHere: (itemId: string, makeHere: 'after-blocks' | 'off' | undefined) => void
  /** Turn Import off for an item in the active block, or back on. Undoable. */
  toggleImportOff: (itemId: string) => void
  /** Turn Leftover off for an item in the active block (the solver then uses the item up where it can), or back on. Block rule only; the item's other keys stay. Undoable. */
  toggleLeftoverOff: (itemId: string) => void
  /**
   * Set where "Make more here" sits in an area's rule for an item (undefined = before the block lines). An area with no
   * rule of its own starts from the block's. Active block only; undoable; no-op when `areaId` is not an area of the block
   * (the root counts only when the block has areas) or when the effective rule already has that value.
   */
  setAreaMakeHere: (areaId: string, itemId: string, makeHere: 'after-blocks' | 'off' | undefined) => void
  /** Turn Import off in an area's rule for an item, or back on. Active block only; undoable; no-op when `areaId` is not an area. */
  toggleAreaImportOff: (areaId: string, itemId: string) => void
  /**
   * Switch off, or back on, taking an item from the area `otherAreaId` in the rule of area `areaId`. Active block
   * only; undoable; no-op unless both are areas of the block and they differ. Switching the last one back on removes the `areasOff` key; the rule stays.
   */
  toggleAreaSupplier: (areaId: string, itemId: string, otherAreaId: string) => void
  /** Remove an area's own rule for an item (it follows the block's rule again). Active block only; undoable; no-op without one. */
  clearAreaRule: (areaId: string, itemId: string) => void
  /**
   * Append a block that makes `itemId` (named `name`), make it active, and request the item
   * from it on `consumerId` (default: the active block). The block has the default colour (from the
   * item's icon). Returns the new block's id, or undefined, with no change, when the consumer is
   * missing or cannot connect.
   */
  addBlockForItem: (itemId: string, name: string, consumerId?: string) => string | undefined

  // Inbound connections (block-level; the target block (default: active) receives itemId from fromBlockId)
  /** Connect; a request when `itemId` is a product of the source (a cycle of requests is allowed and solved in rounds), otherwise it takes existing output. */
  addInputConnection: (itemId: string, fromBlockId: string, toBlockId?: string) => void
  removeInputConnection: (connectionId: string, toBlockId?: string) => void
  /** Cap what the consumer takes over a connection (items/min); undefined removes the cap. */
  setConnectionMaxRate: (connectionId: string, maxRate: number | undefined, toBlockId?: string) => void

  /** Reorder a block's connections (the order is the order they are tried): put `connectionId` just before `beforeConnectionId`, or after the last connection of its item when null. Both must be connections of the same block and item; otherwise, or when nothing would move, a no-op with no history entry. Undoable in the target block. */
  moveConnection: (connectionId: string, beforeConnectionId: string | null, toBlockId?: string) => void
  /** Move a connection one place among the connections of its item (others are skipped over); a no-op at either end. */
  moveConnectionBy: (connectionId: string, delta: -1 | 1, toBlockId?: string) => void

  // Served order (the source block's list of who is served first)
  /**
   * Rank `entry` in the served list of `itemId` on block `sourceBlockId`: put it at the insertion index `toIndex` of the
   * current list (counted before the entry is removed, clamped to [0, length]; `index + 2` moves it down one place).
   * `shown` is the order the UI displays; it becomes the list when none is stored. With a stored list (the truth) it is
   * only read to tell which area lines a plain block entry stands for: the entry is replaced by those area entries in
   * the same history step (`expandServedAreas`), and undo puts the plain list back. A no-op with no history entry when the source is unknown, `entry` is a block that does not
   * take the item from the source, `toIndex` is not finite, or nothing would move (a first drag dropped in place stores no
   * list). The history entry goes to the source block, so it is undone from there.
   */
  moveServed: (sourceBlockId: string, itemId: string, entry: ServedEntry, toIndex: number, shown: ServedEntry[]) => void
  /** Ties the entry to the line above it, or unties it (`shown`: see `moveServed`; a stored list is only expanded by it). */
  setServedTied: (sourceBlockId: string, itemId: string, entry: ServedEntry, tied: boolean, shown: ServedEntry[]) => void
  /** Sets the entry's percentage of its group; the others scale to fill the rest. */
  setServedShare: (sourceBlockId: string, itemId: string, entry: ServedEntry, percent: number, shown: ServedEntry[]) => void
  /**
   * Puts the entry at a place given by entry, not by index: `{ kind: 'rank', before }` gives it a rank of its own before
   * `before` (last when null), `{ kind: 'join', target }` ties it right after `target`, joining its group (`shown`: see
   * `moveServed`). Atomic: one history entry in the source block, so an edge drop inside a group splits it in the same
   * step. No-op with no history entry when the source is unknown, `entry` is not a consumer or the extra, or nothing would change.
   */
  placeServed: (sourceBlockId: string, itemId: string, entry: ServedEntry, place: ServedPlace, shown: ServedEntry[]) => void
  /** Remove the stored list; the item is served in today's order again. No-op with no history entry when there is none. */
  resetServedOrder: (sourceBlockId: string, itemId: string) => void

  // Node actions (resolved against whichever subplan contains the node)
  addNode: (node: RecipeNode, targetSubPlanId?: string) => void
  /** Copy row `nodeId` into area `areaId` (a separate area's sub-plan id, or the root plan id), appended to that sub-plan's own rows: recipe, machine, fuel, modules, beacon, neighbour count, byproduct policy, primary product; not the pin nor the byproduct-consumer flag. Undoable. Returns the new row id, or undefined (no change) when the row is missing, `areaId` is not an area, or that area already has a row of the recipe. */
  buildRowAlsoIn: (nodeId: string, areaId: string) => string | undefined
  /** Copy row `nodeId`'s machine, fuel and modules ('machine') or its beacon ('beacon') to every other row of the same recipe in the active block, as one undoable command. No-op when no other row differs. */
  applyRowSettingsToRecipe: (nodeId: string, what: 'machine' | 'beacon') => void
  removeNode: (nodeId: string) => void
  moveNodeUp: (nodeId: string) => void
  moveNodeDown: (nodeId: string) => void
  moveNode: (nodeId: string, targetSubPlanId: string, targetIndex: number) => void
  updateNodeMachine: (nodeId: string, machineId: string | undefined) => void
  /** Set a burner row's fuel item; undefined restores the default (lowest-value accepted fuel). Undoable; no-op when unchanged. */
  updateNodeFuel: (nodeId: string, fuelItemId: string | undefined) => void
  updateNodeModules: (nodeId: string, modules: ModuleConfig[]) => void
  /** Replace a row's beacon configurations; [] removes the key. One undo step; no-op when unchanged. */
  updateNodeBeacons: (nodeId: string, beacons: BeaconConfig[]) => void
  updateNodePinnedRate: (nodeId: string, rate: number | undefined) => void
  /** Set a reactor row's average neighbour count; 0 or undefined removes it. Undoable; no-op when unchanged. */
  updateNodeNeighbourCount: (nodeId: string, count: number | undefined) => void
  updateNodeByproductPolicy: (nodeId: string, policy: Record<string, 'discard' | 'feed-back'>) => void
  updateNodeByproductConsumer: (nodeId: string, value: boolean) => void
  updateNodeAbsorberFeeder: (nodeId: string, value: boolean) => void
  updateNodePrimaryProduct: (nodeId: string, itemId: string | undefined) => void
  updateNodeRecipe: (nodeId: string, recipeId: string) => void
  wrapNodeInSubPlan: (nodeId: string, name: string) => void

  // Research horizon (plan-wide; not undoable)
  setHorizonTechnologyIds: (ids: string[]) => void

  // Default machines (not undoable, like the horizon)
  setDefaultMachine: (category: string, machineId: string) => void
  clearDefaultMachine: (category: string) => void
  resetDefaultMachines: () => void

  // Undo/redo (per active block)
  undo: () => void
  redo: () => void

  // Full state replacement (persistence)
  setAppState: (state: AppState) => void
}

// ---------------------------------------------------------------------------
// applyCommand — applies a command to a block (default: the active one) and
// pushes to that block's history
// ---------------------------------------------------------------------------

/** The colour of the icon of `itemId` in the loaded game data, when there is one. */
function iconColorOf(itemId: string | undefined): string | undefined {
  if (itemId === undefined) return undefined
  return selectGameData(useGameDataStore.getState())?.items[itemId]?.iconColor
}

/**
 * The colour the default colour gives a block whose first product is `itemId`, next to the `others`:
 * the icon's own colour (the least-used palette colour, the first on a tie, when the icon has none),
 * so the same state always gives the same colour: undo and redo do not re-roll it.
 */
function defaultColorFor(itemId: string | undefined, others: readonly Block[]): string {
  return defaultBlockColor(iconColorOf(itemId), others.map(b => b.color))
}

/**
 * `next` (the block `prev` after a change) with its colour re-picked when it has the default colour
 * and either its first product is now another item or it has just got the default colour (the undo
 * of a colour pick, whose stored colour may be stale). A block left without a product keeps its colour.
 */
function followFirstProduct(prev: Block, next: Block, all: readonly Block[]): Block {
  const first = next.products[0]?.itemId
  if (!next.colorAuto || first === undefined) return next
  if (prev.colorAuto && first === prev.products[0]?.itemId) return next
  const color = defaultColorFor(first, all.filter(b => b.id !== next.id))
  return color === next.color ? next : { ...next, color }
}

/** An undoable colour change: `before` and `after` are the colour and the `colorAuto` flag. */
function colorCommand(
  before: { color: string; auto: boolean },
  after: { color: string; auto: boolean },
): Command {
  return {
    apply: b => ({ ...b, color: after.color, colorAuto: after.auto }),
    undo: b => ({ ...b, color: before.color, colorAuto: before.auto }),
  }
}

/** `blocks` after running `cmd` in one direction on `block`, then its changes to other blocks. */
function runCommand(blocks: Block[], block: Block, cmd: Command, dir: 'apply' | 'undo'): Block[] {
  const changed = followFirstProduct(block, cmd[dir](block, blocks), blocks)
  const next = blocks.map(b => (b.id === block.id ? changed : b))
  const others = dir === 'apply' ? cmd.applyOthers : cmd.undoOthers
  return others ? others(next, changed) : next
}

function applyCommand(
  state: BlockStoreState,
  cmd: Command,
  blockId: string = state.activeBlockId,
): Partial<BlockStoreState> {
  const block = state.blocks.find(b => b.id === blockId)
  if (!block) return {}

  const hist = state.history[block.id] ?? { undoStack: [], redoStack: [] }

  return {
    blocks: runCommand(state.blocks, block, cmd, 'apply'),
    history: {
      ...state.history,
      [block.id]: {
        undoStack: [...hist.undoStack, cmd],
        redoStack: [],
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers for building node-scoped commands. The containing subplan is
// resolved at command-creation time and captured in the closure so apply/undo
// always touch the same subplan even after subsequent mutations.
// ---------------------------------------------------------------------------

function nodeCommand(
  block: Block,
  nodeId: string,
  applyNode: (node: RecipeNode) => RecipeNode,
  undoNode: (node: RecipeNode) => RecipeNode,
): Command | undefined {
  const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
  if (!subPlan) return undefined
  const subPlanId = subPlan.id
  return {
    apply: b => touchSubPlan({
      ...b,
      rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
        ...p,
        nodes: p.nodes.map(n => (n.id === nodeId ? applyNode(n) : n)),
      })),
    }, subPlanId),
    undo: b => touchSubPlan({
      ...b,
      rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
        ...p,
        nodes: p.nodes.map(n => (n.id === nodeId ? undoNode(n) : n)),
      })),
    }, subPlanId),
  }
}

function addNodeCommand(node: RecipeNode, subPlanId: string): Command {
  return {
    apply: b => touchSubPlan({
      ...b,
      rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
        ...p,
        nodes: [...p.nodes, node],
      })),
    }, subPlanId),
    undo: b => touchSubPlan({
      ...b,
      rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
        ...p,
        nodes: p.nodes.filter(n => n.id !== node.id),
      })),
    }, subPlanId),
  }
}

type RowSettings = Pick<GameRecipeNode, 'machineId' | 'fuelItemId' | 'modules' | 'beaconConfigs'>

/** The settings a row shares with the others of its recipe: machine and modules, or the beacon configurations (cloned; none is `undefined`). */
function pickSettings(n: GameRecipeNode, what: 'machine' | 'beacon'): Partial<RowSettings> {
  return what === 'machine'
    ? { machineId: n.machineId, fuelItemId: n.fuelItemId, modules: structuredClone(n.modules) }
    : { beaconConfigs: n.beaconConfigs?.length ? n.beaconConfigs : undefined }
}

/** `n` with `settings` set; a key whose value is undefined is removed. */
function withSettings(n: GameRecipeNode, settings: Partial<RowSettings>): GameRecipeNode {
  const next: GameRecipeNode = { ...n }
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) delete (next as Record<string, unknown>)[key]
    else (next as Record<string, unknown>)[key] = structuredClone(value)
  }
  return next
}

function sameSettings(a: GameRecipeNode, b: GameRecipeNode, what: 'machine' | 'beacon'): boolean {
  return what === 'machine'
    ? a.machineId === b.machineId && a.fuelItemId === b.fuelItemId && deepEqual(a.modules, b.modules)
    : deepEqual(a.beaconConfigs ?? [], b.beaconConfigs ?? [])
}

/** Structural equality of plain JSON values; independent of object key order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function gameRecipeRows(plan: SubPlan): GameRecipeNode[] {
  return [
    ...plan.nodes.filter((n): n is GameRecipeNode => n.kind === 'game-recipe'),
    ...plan.subPlans.flatMap(gameRecipeRows),
  ]
}

// ---------------------------------------------------------------------------
// Default initial state
// ---------------------------------------------------------------------------

const initialBlock = makeEmptyBlock('Factory')

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBlockStore = create<BlockStoreState>((set, get) => ({
  blocks: [initialBlock],
  activeBlockId: initialBlock.id,
  horizonTechnologyIds: [],
  defaultMachineOverrides: {},
  history: {},

  // ── Block management ──────────────────────────────────────────────────────

  addBlock: () =>
    set(state => {
      const block = makeEmptyBlock(`Block ${state.blocks.length + 1}`, pickBlockColor(state.blocks.map(b => b.color)), true)
      return {
        blocks: [...state.blocks, block],
        activeBlockId: block.id,
      }
    }),

  removeBlock: (blockId) =>
    set(state => {
      if (state.blocks.length <= 1) return state
      // Drop connections that read from the deleted block (not undoable, like the delete itself).
      const remaining = state.blocks
        .filter(b => b.id !== blockId)
        // ... and the deleted block's entries from every served list (its own list goes with it).
        .map(b => withoutServedConsumer(
          b.inputConnections.some(c => c.fromBlockId === blockId)
            ? { ...b, inputConnections: b.inputConnections.filter(c => c.fromBlockId !== blockId) }
            : b,
          blockId,
        ))
      const newHistory = { ...state.history }
      delete newHistory[blockId]
      if (state.activeBlockId !== blockId) {
        return { blocks: remaining, history: newHistory }
      }
      const next = remaining[0]
      return {
        blocks: remaining,
        activeBlockId: next.id,
        history: newHistory,
      }
    }),

  duplicateBlock: (blockId) =>
    set(state => {
      const index = state.blocks.findIndex(b => b.id === blockId)
      if (index < 0) return state
      const src = state.blocks[index]
      const copy = cloneBlock(src, pickBlockColor(state.blocks.map(b => b.color), { exclude: src.color }))
      const blocks = [...state.blocks]
      blocks.splice(index + 1, 0, copy)
      return { blocks, activeBlockId: copy.id }
    }),

  moveBlock: (blockId, toIndex) =>
    set(state => {
      const from = state.blocks.findIndex(b => b.id === blockId)
      if (from < 0) return state
      const clamped = Math.max(0, Math.min(toIndex, state.blocks.length))
      const to = from < clamped ? clamped - 1 : clamped
      if (to === from) return state
      const blocks = [...state.blocks]
      const [moved] = blocks.splice(from, 1)
      blocks.splice(to, 0, moved)
      return { blocks }
    }),

  renameBlock: (blockId, name) =>
    set(state => ({
      blocks: state.blocks.map(b => (b.id === blockId ? { ...b, name } : b)),
    })),

  resetBlockColor: (blockId) =>
    set(state => {
      const target = state.blocks.find(b => b.id === blockId)
      if (!target) return state
      const first = target.products[0]?.itemId
      // Without a product there is no icon to follow: keep the colour and start following once there is one.
      const color = first === undefined ? target.color : defaultColorFor(first, state.blocks.filter(b => b.id !== blockId))
      if (color === target.color && target.colorAuto) return state
      return applyCommand(
        state,
        colorCommand({ color: target.color, auto: target.colorAuto === true }, { color, auto: true }),
        blockId,
      )
    }),

  setBlockColor: (blockId, color) =>
    set(state => {
      const hex = color.toLowerCase()
      if (!HEX_COLOR_RE.test(hex)) return state
      const target = state.blocks.find(b => b.id === blockId)
      if (!target || (target.color === hex && !target.colorAuto)) return state
      return applyCommand(
        state,
        colorCommand({ color: target.color, auto: target.colorAuto === true }, { color: hex, auto: false }),
        blockId,
      )
    }),

  setActiveBlock: (blockId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === blockId)
      if (!block) return state
      return { activeBlockId: blockId }
    }),

  // ── SubPlan management ────────────────────────────────────────────────────

  addSubPlan: (parentSubPlanId, name) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || !findSubPlan(block.rootPlan, parentSubPlanId)) return state
      if (!canAddGroupIn(block.rootPlan, parentSubPlanId)) return state
      const newSubPlan = makeEmptySubPlan(name)
      const newSubPlanNode: SubPlanNode = {
        kind: 'subplan',
        id: crypto.randomUUID(),
        subPlanId: newSubPlan.id,
      }
      // Re-read from the tree on every undo, so a rename made in between survives the redo.
      let snapshot = newSubPlan
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, parentSubPlanId, p => ({
            ...p,
            subPlans: [...p.subPlans, snapshot],
            nodes: [...p.nodes, newSubPlanNode],
          })),
        }, parentSubPlanId),
        undo: b => {
          snapshot = findSubPlan(b.rootPlan, newSubPlan.id) ?? snapshot
          return touchSubPlan({
            ...b,
            rootPlan: removeSubPlanNodeReferences(removeSubPlanFromTree(b.rootPlan, newSubPlan.id), newSubPlan.id),
          }, parentSubPlanId)
        },
        canApply: (_blocks, b) =>
          findSubPlan(b.rootPlan, parentSubPlanId) !== undefined && findSubPlan(b.rootPlan, newSubPlan.id) === undefined,
        canUndo: (_blocks, b) => findSubPlan(b.rootPlan, newSubPlan.id) !== undefined,
      }
      return applyCommand(state, cmd)
    }),

  removeSubPlan: (subPlanId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const parent = findParentSubPlan(block.rootPlan, subPlanId)
      if (!parent) return state
      const parentId = parent.id
      // Snapshot taken each time the removal is applied (creation and every redo), so an
      // edit made to the subtree while the command sat on the redo stack (for example one
      // that is not undoable) is not lost when the removal is undone again.
      let snapshot:
        | { removed: SubPlan; subPlanIndex: number; handle: SubPlan['nodes'][number] | undefined; handleIndex: number }
        | undefined
      // The areas this removal takes away, and the served entries cut for them from the sources' lists.
      let lost = new Set<string>()
      let cuts: ServedCut[] = []
      // The area rules cut for them from the areas that stay, recomputed on every apply.
      let ruleCuts: AreaRuleCut[] = []
      const cmd: Command = {
        apply: b => {
          const p = findSubPlan(b.rootPlan, parentId)
          const subPlanIndex = p?.subPlans.findIndex(sp => sp.id === subPlanId) ?? -1
          if (p && subPlanIndex >= 0) {
            const handleIndex = p.nodes.findIndex(n => n.kind === 'subplan' && n.subPlanId === subPlanId)
            snapshot = {
              removed: p.subPlans[subPlanIndex],
              subPlanIndex,
              handle: handleIndex >= 0 ? p.nodes[handleIndex] : undefined,
              handleIndex,
            }
          }
          const next = touchSubPlan({
            ...b,
            rootPlan: removeSubPlanNodeReferences(removeSubPlanFromTree(b.rootPlan, subPlanId), subPlanId),
          }, parentId)
          lost = lostAreaIds(b.rootPlan, next.rootPlan)
          const r = cutAreaRules(next.rootPlan)
          ruleCuts = r.cuts
          return r.cuts.length > 0 ? { ...next, rootPlan: r.root } : next
        },
        applyOthers: servedAreaCuts(() => lost, c => { cuts = c }),
        undoOthers: blocks => {
          const out = restoreServedCuts(blocks, cuts)
          cuts = []
          return out
        },
        undo: b => {
          const snap = snapshot
          if (!snap) return b
          const restored = touchSubPlan({
            ...b,
            rootPlan: updateSubPlanInTree(b.rootPlan, parentId, p => {
              const subPlans = [...p.subPlans]
              subPlans.splice(snap.subPlanIndex, 0, snap.removed)
              const nodes = [...p.nodes]
              if (snap.handle) nodes.splice(snap.handleIndex, 0, snap.handle)
              return { ...p, subPlans, nodes }
            }),
          }, parentId)
          return { ...restored, rootPlan: restoreAreaRules(restored.rootPlan, ruleCuts) }
        },
        // Drop the command rather than orphan the sub-plan or duplicate its id when
        // the tree changed through an action that is not undoable.
        canUndo: (_blocks, b) =>
          snapshot !== undefined &&
          findSubPlan(b.rootPlan, parentId) !== undefined &&
          findSubPlan(b.rootPlan, snapshot.removed.id) === undefined,
      }
      return applyCommand(state, cmd)
    }),

  duplicateSubPlanTo: (subPlanId, areaId) => {
    let newId: string | undefined
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || subPlanCopyBlocker(block.rootPlan, subPlanId, areaId)) return state
      if (!canCopyGroupInto(block.rootPlan, subPlanId, areaId)) return state
      const source = findSubPlan(block.rootPlan, subPlanId)
      const target = findSubPlan(block.rootPlan, areaId)
      if (!source || !target) return state
      const now = new Date().toISOString()
      const copy: SubPlan = { ...cloneSubPlanTree(source), name: `${source.name} (copy)`, createdAt: now, updatedAt: now }
      const handle: SubPlanNode = { kind: 'subplan', id: crypto.randomUUID(), subPlanId: copy.id }
      // Right after the source's handle when the target holds it, else at the end of the target's rows.
      const sourceHandleIndex = target.nodes.findIndex(n => n.kind === 'subplan' && n.subPlanId === subPlanId)
      const insertAt = sourceHandleIndex >= 0 ? sourceHandleIndex + 1 : target.nodes.length
      newId = handle.id
      // Re-read from the tree on every undo, so a rename made in between survives the redo.
      let snapshot = copy
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, areaId, p => {
            const nodes = [...p.nodes]
            nodes.splice(Math.min(insertAt, nodes.length), 0, handle)
            return { ...p, nodes, subPlans: [...p.subPlans, snapshot] }
          }),
        }, areaId),
        undo: b => {
          snapshot = findSubPlan(b.rootPlan, copy.id) ?? snapshot
          return touchSubPlan({
            ...b,
            rootPlan: removeSubPlanNodeReferences(removeSubPlanFromTree(b.rootPlan, copy.id), copy.id),
          }, areaId)
        },
        // Drop the command rather than duplicate the copy's id or orphan it.
        canApply: (_blocks, b) => findSubPlan(b.rootPlan, areaId) !== undefined && findSubPlan(b.rootPlan, copy.id) === undefined,
        canUndo: (_blocks, b) => findSubPlan(b.rootPlan, copy.id) !== undefined,
      }
      return applyCommand(state, cmd)
    })
    return newId
  },

  setSubPlanArea: (subPlanId, area) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || subPlanId === block.rootPlan.id) return state
      const target = findSubPlan(block.rootPlan, subPlanId)
      if (!target || (target.area === true) === area) return state
      const previous = target.area
      // Off removes the key, so a saved plan without areas keeps exactly its old shape.
      const setArea = (value: boolean | undefined) => (p: SubPlan): SubPlan => {
        const next = { ...p }
        delete next.area
        return value === undefined ? next : { ...next, area: value }
      }
      // Turning the area off takes it away from the consumers' served entries, which are cut from the sources' lists.
      let lost = new Set<string>()
      let cuts: ServedCut[] = []
      // Likewise the area rules: the sub-plan's own and the `areasOff` entries naming it, recomputed on every apply.
      let ruleCuts: AreaRuleCut[] = []
      const cmd: Command = {
        apply: b => {
          const next = touchSubPlan({
            ...b,
            rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, setArea(area ? true : undefined)),
          }, subPlanId)
          lost = lostAreaIds(b.rootPlan, next.rootPlan)
          const r = cutAreaRules(next.rootPlan)
          ruleCuts = r.cuts
          return r.cuts.length > 0 ? { ...next, rootPlan: r.root } : next
        },
        applyOthers: servedAreaCuts(() => lost, c => { cuts = c }),
        undoOthers: blocks => {
          const out = restoreServedCuts(blocks, cuts)
          cuts = []
          return out
        },
        undo: b => {
          const reset = touchSubPlan({
            ...b,
            rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, setArea(previous)),
          }, subPlanId)
          return { ...reset, rootPlan: restoreAreaRules(reset.rootPlan, ruleCuts) }
        },
        canApply: (_blocks, b) => findSubPlan(b.rootPlan, subPlanId) !== undefined,
        canUndo: (_blocks, b) => findSubPlan(b.rootPlan, subPlanId) !== undefined,
      }
      return applyCommand(state, cmd)
    }),

  renameSubPlan: (subPlanId, name) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const target = findSubPlan(block.rootPlan, subPlanId)
      if (!target || target.name === name) return state
      const previous = target.name
      const setName = (value: string) => (p: SubPlan): SubPlan => ({ ...p, name: value })
      const cmd: Command = {
        apply: b => touchSubPlan({ ...b, rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, setName(name)) }, subPlanId),
        undo: b => touchSubPlan({ ...b, rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, setName(previous)) }, subPlanId),
        canApply: (_blocks, b) => findSubPlan(b.rootPlan, subPlanId) !== undefined,
        canUndo: (_blocks, b) => findSubPlan(b.rootPlan, subPlanId) !== undefined,
      }
      return applyCommand(state, cmd)
    }),

  // ── Products (block-level) ────────────────────────────────────────────────

  addProduct: (product, toBlockId) =>
    set(state => {
      const targetId = toBlockId ?? state.activeBlockId
      const target = state.blocks.find(b => b.id === targetId)
      if (!target || hasProduct(target, product.itemId)) return state
      const cmd: Command = {
        apply: b => ({ ...b, products: [...b.products, product] }),
        undo: b => ({ ...b, products: b.products.filter(p => p.id !== product.id) }),
      }
      return applyCommand(state, cmd, targetId)
    }),

  removeProduct: (productId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const index = block?.products.findIndex(p => p.id === productId) ?? -1
      const target = block?.products[index]
      if (!target) return state
      const cmd: Command = {
        apply: b => ({ ...b, products: b.products.filter(p => p.id !== productId) }),
        // Back at its old index: the order is the display order and the first product sets an auto colour.
        undo: b => {
          const products = [...b.products]
          products.splice(index, 0, target)
          return { ...b, products }
        },
      }
      return applyCommand(state, cmd)
    }),

  moveProduct: (productId, toIndex) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const from = block.products.findIndex(p => p.id === productId)
      if (from < 0) return state
      const to = insertionTarget(from, toIndex, block.products.length)
      if (to === null) return state
      const cmd: Command = {
        apply: b => ({ ...b, products: moveProductTo(b.products, productId, to) }),
        undo: b => ({ ...b, products: moveProductTo(b.products, productId, from) }),
      }
      return applyCommand(state, cmd)
    }),

  moveProductBy: (productId, delta) => {
    const block = get().blocks.find(b => b.id === get().activeBlockId)
    const from = block?.products.findIndex(p => p.id === productId) ?? -1
    if (from < 0) return
    // An insertion index: before the previous product, or after the next one.
    get().moveProduct(productId, delta < 0 ? from - 1 : from + 2)
  },

  updateProductExtra: (productId, extraRate) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const oldProduct = block?.products.find(p => p.id === productId)
      if (!oldProduct) return state
      if (extraRate !== undefined && !(isFinite(extraRate) && extraRate > 0)) return state
      if (oldProduct.extraRate === extraRate) return state
      const oldExtra = oldProduct.extraRate
      const cmd: Command = {
        apply: b => withExtra(b, productId, extraRate),
        undo: b => withExtra(b, productId, oldExtra),
      }
      return applyCommand(state, cmd)
    }),

  toggleImportOff: (itemId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const before = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : {}
      const after: SourceRule = before.importOff ? { ...before, importOff: undefined } : { ...before, importOff: true }
      return applyCommand(state, sourceRuleCommand(block, itemId, before, after))
    }),

  toggleLeftoverOff: (itemId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const before = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : {}
      const after: SourceRule = before.leftoverOff ? { ...before, leftoverOff: undefined } : { ...before, leftoverOff: true }
      return applyCommand(state, sourceRuleCommand(block, itemId, before, after))
    }),

  setAreaMakeHere: (areaId, itemId, makeHere) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || !areaIdsOf(block.rootPlan).has(areaId)) return state
      const effective = effectiveAreaRule(block, areaId, itemId)
      if (effective.makeHere === makeHere) return state
      return applyCommand(state, areaRuleCommand(block, areaId, itemId, storedAreaRule(block, areaId, itemId), cleanAreaRule({ ...effective, makeHere })))
    }),

  toggleAreaImportOff: (areaId, itemId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || !areaIdsOf(block.rootPlan).has(areaId)) return state
      const effective = effectiveAreaRule(block, areaId, itemId)
      const after = cleanAreaRule({ ...effective, importOff: effective.importOff ? undefined : true })
      return applyCommand(state, areaRuleCommand(block, areaId, itemId, storedAreaRule(block, areaId, itemId), after))
    }),

  toggleAreaSupplier: (areaId, itemId, otherAreaId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const areas = areaIdsOf(block.rootPlan)
      if (!areas.has(areaId) || !areas.has(otherAreaId) || areaId === otherAreaId) return state
      const effective = effectiveAreaRule(block, areaId, itemId)
      const off = effective.areasOff ?? []
      const areasOff = off.includes(otherAreaId) ? off.filter(id => id !== otherAreaId) : [...off, otherAreaId]
      const stored = storedAreaRule(block, areaId, itemId)
      const after = cleanAreaRule({ ...effective, areasOff })
      // The last switch back on leaves a rule that only repeats the block's: the area follows the block again (a rule of its own would not).
      if (repeatsBlockRule(after, block.sourceRules, itemId)) {
        if (stored === undefined) return state
        return applyCommand(state, areaRuleCommand(block, areaId, itemId, stored, undefined))
      }
      return applyCommand(state, areaRuleCommand(block, areaId, itemId, stored, after))
    }),

  clearAreaRule: (areaId, itemId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block || !areaIdsOf(block.rootPlan).has(areaId)) return state
      const stored = storedAreaRule(block, areaId, itemId)
      if (stored === undefined) return state
      return applyCommand(state, areaRuleCommand(block, areaId, itemId, stored, undefined))
    }),

  setMakeHere: (itemId, makeHere) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const before = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : {}
      if (before.makeHere === makeHere) return state
      return applyCommand(state, sourceRuleCommand(block, itemId, before, { ...before, makeHere }))
    }),

  addBlockForItem: (itemId, name, consumerId) => {
    let newId: string | undefined
    set(state => {
      const targetId = consumerId ?? state.activeBlockId
      const consumer = state.blocks.find(b => b.id === targetId)
      if (!consumer) return state
      const block: Block = {
        ...makeEmptyBlock(name, defaultColorFor(itemId, state.blocks), true),
        products: [{ id: crypto.randomUUID(), itemId }],
      }
      const blocks = [...state.blocks, block]
      if (!canConnect(blocks, consumer, itemId, block.id)) return state
      const cmd = addConnectionCommand(itemId, block.id)
      newId = block.id
      // Block creation is not undoable (like addBlock); only the request is in the consumer's history.
      return { ...applyCommand({ ...state, blocks }, cmd, targetId), activeBlockId: block.id }
    })
    return newId
  },

  addInputConnection: (itemId, fromBlockId, toBlockId) =>
    set(state => {
      const targetId = toBlockId ?? state.activeBlockId
      const block = state.blocks.find(b => b.id === targetId)
      if (!block) return state
      if (!canConnect(state.blocks, block, itemId, fromBlockId)) return state
      const cmd = addConnectionCommand(itemId, fromBlockId)
      return applyCommand(state, cmd, targetId)
    }),

  removeInputConnection: (connectionId, toBlockId) =>
    set(state => {
      const targetId = toBlockId ?? state.activeBlockId
      const block = state.blocks.find(b => b.id === targetId)
      const index = block?.inputConnections.findIndex(c => c.id === connectionId) ?? -1
      if (!block || index < 0) return state
      const target = block.inputConnections[index]
      const cleanup = servedCleanup(target)
      const cmd: Command = {
        apply: b => ({ ...b, inputConnections: b.inputConnections.filter(c => c.id !== connectionId) }),
        undo: b => {
          const connections = [...b.inputConnections]
          connections.splice(index, 0, target)
          return { ...b, inputConnections: connections }
        },
        // Undoing a removal re-adds the edge, which may no longer be legal (source deleted, duplicate).
        canUndo: (blocks, b) => canConnect(blocks, b, target.itemId, target.fromBlockId),
        // The consumer's entry in the source's served list goes with its last connection; undo restores it.
        applyOthers: cleanup.leave,
        undoOthers: cleanup.restore,
      }
      return applyCommand(state, cmd, targetId)
    }),

  moveServed: (sourceBlockId, itemId, entry, toIndex, shown) =>
    set(state => {
      const source = state.blocks.find(b => b.id === sourceBlockId)
      if (!source || itemId === '' || !Number.isFinite(toIndex)) return state
      const { consumer, list, base, start } = servedBaseOf(state.blocks, source, itemId, shown)
      if (!consumer(entry)) return state
      const from = base.findIndex(e => sameServedEntry(e, entry))
      const wasPresent = from >= 0
      let next: ServedEntry[]
      if (wasPresent) {
        const to = insertionTarget(from, Math.trunc(toIndex), base.length)
        if (to === null) return state
        next = base.filter((_, i) => i !== from)
        next.splice(to, 0, entry)
      } else {
        // An entry with no place yet joins an existing list; with no list it must already be shown.
        if (!list) return state
        next = [...base]
        next.splice(Math.max(0, Math.min(Math.trunc(toIndex), base.length)), 0, entry)
      }
      // Anchors, as in moveConnectionState: later changes to the list (cleanups from other blocks) are kept.
      const created = list === undefined
      const oldBefore = wasPresent ? (base[from + 1] ?? null) : undefined
      const newBefore = next[next.findIndex(e => sameServedEntry(e, entry)) + 1] ?? null
      // What the last write overwrote and stored: the undo puts the old list back only while the list is still exactly that.
      let prior: ServedEntry[] | undefined
      let written: ServedEntry[] | undefined
      const cmd: Command = {
        apply: (b, blocks) => {
          prior = servedListOf(b, itemId)
          written = undefined
          // The list was reset meanwhile: only the first write may start one again.
          const current = start(b, blocks)
          if (current === undefined) return b
          if (entry.kind === 'block' && !isServedConsumer(blocks, b.id, itemId, entry.blockId)) return b
          const placed = withServedEntryPlaced(current, entry, newBefore)
          if (placed !== undefined) written = placed
          return placed === undefined ? b : withServedList(b, itemId, placed)
        },
        undo: (b, blocks) => {
          const current = servedListOf(b, itemId)
          if (written !== undefined && current !== undefined && sameServedList(current, written)) return withServedList(b, itemId, prior)
          if (created && (current === undefined || (written !== undefined && sameServedList(current, written)))) {
            return withServedList(b, itemId, undefined)
          }
          if (!current) return b
          if (oldBefore === undefined) return withServedList(b, itemId, dropServedEntries(current, e => sameServedEntry(e, entry)))
          // A consumer that has left since is not put back.
          if (entry.kind === 'block' && !isServedConsumer(blocks, b.id, itemId, entry.blockId)) return b
          const placed = withServedEntryPlaced(current, entry, oldBefore)
          return placed === undefined ? b : withServedList(b, itemId, placed)
        },
      }
      return applyCommand(state, cmd, sourceBlockId)
    }),

  setServedTied: (sourceBlockId, itemId, entry, tied, shown) =>
    set(state =>
      servedEditState(state, sourceBlockId, itemId, entry, shown, list => withServedTied(list, entry, tied), list => withServedTied(list, entry, !tied)),
    ),

  setServedShare: (sourceBlockId, itemId, entry, percent, shown) =>
    set(state => servedEditState(state, sourceBlockId, itemId, entry, shown, list => withServedShare(list, entry, percent))),

  placeServed: (sourceBlockId, itemId, entry, place, shown) =>
    set(state => servedEditState(state, sourceBlockId, itemId, entry, shown, list => withServedEntryRanked(list, entry, place))),

  resetServedOrder: (sourceBlockId, itemId) =>
    set(state => {
      const source = state.blocks.find(b => b.id === sourceBlockId)
      const list = source && servedListOf(source, itemId)
      if (!source || !list) return state
      const before = [...list]
      const cmd: Command = {
        apply: b => withServedList(b, itemId, undefined),
        undo: (b, blocks) => {
          if (servedListOf(b, itemId)) return b
          // Consumers that have left since are not put back.
          return withServedList(b, itemId, dropServedEntries(before, e => e.kind === 'block' && !isServedConsumer(blocks, b.id, itemId, e.blockId)))
        },
      }
      return applyCommand(state, cmd, sourceBlockId)
    }),

  setConnectionMaxRate: (connectionId, maxRate, toBlockId) =>
    set(state => {
      const targetId = toBlockId ?? state.activeBlockId
      const block = state.blocks.find(b => b.id === targetId)
      const connection = block?.inputConnections.find(c => c.id === connectionId)
      if (!block || !connection) return state
      if (connection.maxRate === maxRate) return state
      if (maxRate !== undefined && !(isFinite(maxRate) && maxRate > 0)) return state
      const oldMax = connection.maxRate
      const cmd: Command = {
        apply: b => withMaxRate(b, connectionId, maxRate),
        undo: b => withMaxRate(b, connectionId, oldMax),
      }
      return applyCommand(state, cmd, targetId)
    }),

  moveConnection: (connectionId, beforeConnectionId, toBlockId) =>
    set(state => moveConnectionState(state, connectionId, () => beforeConnectionId, toBlockId ?? state.activeBlockId)),

  moveConnectionBy: (connectionId, delta, toBlockId) =>
    set(state => moveConnectionState(state, connectionId, connections => {
      const connection = connections.find(c => c.id === connectionId)
      const siblings = connections.filter(c => c.itemId === connection?.itemId)
      const to = siblings.findIndex(c => c.id === connectionId) + delta
      if (!connection || to < 0 || to >= siblings.length) return undefined
      // Up goes before the previous sibling; down goes before the one after the next (null: the end).
      return delta < 0 ? siblings[to].id : (siblings[to + 1]?.id ?? null)
    }, toBlockId ?? state.activeBlockId)),

  // ── Nodes ─────────────────────────────────────────────────────────────────
  //
  // Newly added nodes go into the rootPlan. Existing-node mutations resolve
  // the containing subplan by walking the tree at command-creation time.

  addNode: (node, targetSubPlanId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlanId = targetSubPlanId ?? block.rootPlan.id
      return applyCommand(state, addNodeCommand(node, subPlanId))
    }),

  buildRowAlsoIn: (nodeId, areaId) => {
    let newId: string | undefined
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const src = findSubPlanContainingNode(block.rootPlan, nodeId)?.nodes.find(n => n.id === nodeId)
      if (!src || src.kind !== 'game-recipe') return state
      if (subPlanAreaIds(block.rootPlan).get(areaId) !== areaId) return state
      if (areaRecipeIds(block.rootPlan, areaId).has(src.recipeId)) return state
      const copy: GameRecipeNode = {
        kind: 'game-recipe',
        id: crypto.randomUUID(),
        recipeId: src.recipeId,
        ...(src.machineId !== undefined && { machineId: src.machineId }),
        ...(src.fuelItemId !== undefined && { fuelItemId: src.fuelItemId }),
        modules: structuredClone(src.modules),
        ...(src.beaconConfigs?.length && { beaconConfigs: structuredClone(src.beaconConfigs) }),
        ...(src.neighbourCount !== undefined && { neighbourCount: src.neighbourCount }),
        byproductPolicy: { ...src.byproductPolicy },
        ...(src.primaryProduct !== undefined && { primaryProduct: src.primaryProduct }),
      }
      newId = copy.id
      return applyCommand(state, addNodeCommand(copy, areaId))
    })
    return newId
  },

  applyRowSettingsToRecipe: (nodeId, what) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const rows = gameRecipeRows(block.rootPlan)
      const source = rows.find(n => n.id === nodeId)
      if (!source) return state
      const targets = rows.filter(
        n => n.id !== nodeId && n.recipeId === source.recipeId && !sameSettings(n, source, what),
      )
      if (targets.length === 0) return state
      const value = pickSettings(source, what)
      const before = new Map(targets.map(n => [n.id, pickSettings(n, what)]))
      const cmd: Command = {
        apply: b => ({
          ...b,
          rootPlan: mapGameRecipeNodes(b.rootPlan, n => (before.has(n.id) ? withSettings(n, value) : n)),
        }),
        undo: b => ({
          ...b,
          rootPlan: mapGameRecipeNodes(b.rootPlan, n => (before.has(n.id) ? withSettings(n, before.get(n.id)!) : n)),
        }),
      }
      return applyCommand(state, cmd)
    }),

  moveNodeUp: (nodeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      if (!subPlan) return state
      const subPlanId = subPlan.id
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => {
            const idx = p.nodes.findIndex(n => n.id === nodeId)
            if (idx <= 0) return p
            const nodes = [...p.nodes]
            ;[nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]]
            return { ...p, nodes }
          }),
        }, subPlanId),
        undo: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => {
            const idx = p.nodes.findIndex(n => n.id === nodeId)
            if (idx < 0 || idx >= p.nodes.length - 1) return p
            const nodes = [...p.nodes]
            ;[nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]]
            return { ...p, nodes }
          }),
        }, subPlanId),
      }
      return applyCommand(state, cmd)
    }),

  moveNodeDown: (nodeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      if (!subPlan) return state
      const subPlanId = subPlan.id
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => {
            const idx = p.nodes.findIndex(n => n.id === nodeId)
            if (idx < 0 || idx >= p.nodes.length - 1) return p
            const nodes = [...p.nodes]
            ;[nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]]
            return { ...p, nodes }
          }),
        }, subPlanId),
        undo: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => {
            const idx = p.nodes.findIndex(n => n.id === nodeId)
            if (idx <= 0) return p
            const nodes = [...p.nodes]
            ;[nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]]
            return { ...p, nodes }
          }),
        }, subPlanId),
      }
      return applyCommand(state, cmd)
    }),

  moveNode: (nodeId, targetSubPlanId, targetIndex) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state

      const sourcePlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      if (!sourcePlan) return state
      const sourceSubPlanId = sourcePlan.id
      const sourceIndex = sourcePlan.nodes.findIndex(n => n.id === nodeId)
      if (sourceIndex === -1) return state

      const node = sourcePlan.nodes[sourceIndex]

      // Nesting limit: only for a move to another plan (reordering is always allowed, even in a plan that is already too deep).
      if (sourceSubPlanId !== targetSubPlanId && !canMoveNodeInto(block.rootPlan, nodeId, targetSubPlanId)) return state

      // Cycle guard: refuse to move a subplan node into its own subtree.
      if (node.kind === 'subplan') {
        if (isSubPlanDescendant(block.rootPlan, node.subPlanId, targetSubPlanId)) return state
      }

      // Normalise index for same-subplan moves.
      const normIndex = sourceSubPlanId === targetSubPlanId && sourceIndex < targetIndex
        ? targetIndex - 1
        : targetIndex

      // No-op guard.
      if (sourceSubPlanId === targetSubPlanId && sourceIndex === normIndex) return state

      // A sub-plan is stored in the `subPlans` of the plan that holds its handle, so moving the
      // handle to another plan moves the sub-plan with it (its rows then belong to the new plan's area).
      const handled = node.kind === 'subplan' && sourceSubPlanId !== targetSubPlanId ? node.subPlanId : undefined
      const storedUnder = handled === undefined ? undefined : findParentSubPlan(block.rootPlan, handled)
      // Nothing to move when the target already stores it.
      const movedSubPlanId = storedUnder && storedUnder.id !== targetSubPlanId ? handled : undefined
      const storedIndex = storedUnder?.subPlans.findIndex(sp => sp.id === movedSubPlanId) ?? -1
      const movedSubPlan = movedSubPlanId === undefined ? undefined : storedUnder?.subPlans[storedIndex]
      const storedUnderId = movedSubPlanId === undefined ? undefined : storedUnder?.id
      const touchAll = (b: Block): Block =>
        [...new Set([sourceSubPlanId, targetSubPlanId, storedUnderId])].reduce<Block>(
          (acc, id) => (id === undefined ? acc : touchSubPlan(acc, id)), b)

      const cmd: Command = {
        apply: b => {
          let root = b.rootPlan
          // Remove from source.
          root = updateSubPlanInTree(root, sourceSubPlanId, p => ({
            ...p, nodes: p.nodes.filter(n => n.id !== nodeId),
          }))
          if (movedSubPlanId !== undefined && storedUnderId !== undefined) {
            root = updateSubPlanInTree(root, storedUnderId, p => ({
              ...p, subPlans: p.subPlans.filter(sp => sp.id !== movedSubPlanId),
            }))
          }
          // Insert into target.
          root = updateSubPlanInTree(root, targetSubPlanId, p => {
            const nodes = [...p.nodes]
            nodes.splice(normIndex, 0, node)
            // Read from the tree at hand, so an edit made to the sub-plan since the move is kept on redo.
            const subPlans = movedSubPlan ? [...p.subPlans, findSubPlan(b.rootPlan, movedSubPlan.id) ?? movedSubPlan] : p.subPlans
            return { ...p, nodes, subPlans }
          })
          return touchAll({ ...b, rootPlan: root })
        },
        undo: b => {
          let root = b.rootPlan
          const current = movedSubPlan ? findSubPlan(b.rootPlan, movedSubPlan.id) ?? movedSubPlan : undefined
          // Remove from target.
          root = updateSubPlanInTree(root, targetSubPlanId, p => ({
            ...p,
            nodes: p.nodes.filter(n => n.id !== nodeId),
            subPlans: movedSubPlanId === undefined ? p.subPlans : p.subPlans.filter(sp => sp.id !== movedSubPlanId),
          }))
          // Restore at source.
          root = updateSubPlanInTree(root, sourceSubPlanId, p => {
            const nodes = [...p.nodes]
            nodes.splice(sourceIndex, 0, node)
            return { ...p, nodes }
          })
          if (current && storedUnderId !== undefined) {
            root = updateSubPlanInTree(root, storedUnderId, p => {
              const subPlans = [...p.subPlans]
              subPlans.splice(storedIndex, 0, current)
              return { ...p, subPlans }
            })
          }
          return touchAll({ ...b, rootPlan: root })
        },
      }
      return applyCommand(state, cmd)
    }),

  removeNode: (nodeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      if (!subPlan) return state
      const target = subPlan.nodes.find(n => n.id === nodeId)
      if (!target) return state
      const subPlanId = subPlan.id
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
            ...p,
            nodes: p.nodes.filter(n => n.id !== nodeId),
          })),
        }, subPlanId),
        undo: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, subPlanId, p => ({
            ...p,
            nodes: [...p.nodes, target],
          })),
        }, subPlanId),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeMachine: (nodeId, machineId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldMachineId = old.machineId
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, machineId } : n,
        n => n.kind === 'game-recipe' ? { ...n, machineId: oldMachineId } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeModules: (nodeId, modules) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldModules = old.modules
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, modules } : n,
        n => n.kind === 'game-recipe' ? { ...n, modules: oldModules } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeBeacons: (nodeId, beacons) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      if (deepEqual(old.beaconConfigs ?? [], beacons)) return state
      // withSettings copies what it stores, so the lists go in as they are.
      const oldBeacons = old.beaconConfigs?.length ? old.beaconConfigs : undefined
      const newBeacons = beacons.length > 0 ? beacons : undefined
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? withSettings(n, { beaconConfigs: newBeacons }) : n,
        n => n.kind === 'game-recipe' ? withSettings(n, { beaconConfigs: oldBeacons }) : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodePinnedRate: (nodeId, pinnedRate) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldPinned = old.pinnedRate
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, pinnedRate } : n,
        n => n.kind === 'game-recipe' ? { ...n, pinnedRate: oldPinned } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeFuel: (nodeId, fuelItemId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldFuel = old.fuelItemId
      if (fuelItemId === oldFuel) return state
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, fuelItemId } : n,
        n => n.kind === 'game-recipe' ? { ...n, fuelItemId: oldFuel } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeNeighbourCount: (nodeId, count) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const next = count !== undefined && Number.isFinite(count) && count > 0 ? count : undefined
      const oldCount = old.neighbourCount
      if (next === oldCount) return state
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, neighbourCount: next } : n,
        n => n.kind === 'game-recipe' ? { ...n, neighbourCount: oldCount } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeByproductPolicy: (nodeId, byproductPolicy) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldPolicy = old.byproductPolicy
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, byproductPolicy } : n,
        n => n.kind === 'game-recipe' ? { ...n, byproductPolicy: oldPolicy } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeByproductConsumer: (nodeId, value) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldValue = old.byproductConsumer
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, byproductConsumer: value } : n,
        n => n.kind === 'game-recipe' ? { ...n, byproductConsumer: oldValue } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeAbsorberFeeder: (nodeId, value) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldValue = old.absorberFeeder
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, absorberFeeder: value } : n,
        n => n.kind === 'game-recipe' ? { ...n, absorberFeeder: oldValue } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodePrimaryProduct: (nodeId, primaryProduct) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldPrimary = old.primaryProduct
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, primaryProduct } : n,
        n => n.kind === 'game-recipe' ? { ...n, primaryProduct: oldPrimary } : n,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  updateNodeRecipe: (nodeId, recipeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const cmd = nodeCommand(block, nodeId,
        () => ({
          kind: 'game-recipe',
          id: nodeId,
          recipeId,
          modules: [],
          byproductPolicy: {},
        }),
        () => old,
      )
      return cmd ? applyCommand(state, cmd) : state
    }),

  wrapNodeInSubPlan: (nodeId, name) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const containing = findSubPlanContainingNode(block.rootPlan, nodeId)
      if (!containing) return state
      const original = containing.nodes.find(n => n.id === nodeId)
      if (!original || original.kind !== 'game-recipe') return state
      const containingId = containing.id
      if (!canAddGroupIn(block.rootPlan, containingId)) return state

      const now = new Date().toISOString()
      const newSubPlan: SubPlan = {
        id: crypto.randomUUID(),
        name,
        nodes: [original],
        subPlans: [],
        createdAt: now,
        updatedAt: now,
      }
      const newSubPlanNode: SubPlanNode = {
        kind: 'subplan',
        id: crypto.randomUUID(),
        subPlanId: newSubPlan.id,
      }
      // Re-read from the tree on every undo, so a rename or an edit of the wrapped row made
      // in between survives the redo.
      let snapshot = newSubPlan
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, containingId, p => ({
            ...p,
            nodes: p.nodes.map(n => (n.id === nodeId ? newSubPlanNode : n)),
            subPlans: [...p.subPlans, snapshot],
          })),
        }, containingId),
        undo: b => {
          snapshot = findSubPlan(b.rootPlan, newSubPlan.id) ?? snapshot
          const wrapped = snapshot.nodes[0]
          return touchSubPlan({
            ...b,
            rootPlan: updateSubPlanInTree(b.rootPlan, containingId, p => ({
              ...p,
              nodes: p.nodes.map(n => (n.id === newSubPlanNode.id ? wrapped : n)),
              subPlans: p.subPlans.filter(sp => sp.id !== newSubPlan.id),
            })),
          }, containingId)
        },
        canApply: (_blocks, b) => {
          const p = findSubPlan(b.rootPlan, containingId)
          return p !== undefined && p.nodes.some(n => n.id === nodeId) && findSubPlan(b.rootPlan, newSubPlan.id) === undefined
        },
        // Drop the command rather than lose rows added to the wrapper since.
        canUndo: (_blocks, b) => {
          const p = findSubPlan(b.rootPlan, containingId)
          const wrapper = findSubPlan(b.rootPlan, newSubPlan.id)
          return (
            p !== undefined &&
            p.nodes.some(n => n.id === newSubPlanNode.id) &&
            p.subPlans.some(sp => sp.id === newSubPlan.id) &&
            wrapper !== undefined &&
            wrapper.nodes.length === 1 &&
            wrapper.nodes[0].id === nodeId &&
            wrapper.subPlans.length === 0
          )
        },
      }
      return applyCommand(state, cmd)
    }),

  // ── Undo / Redo ──────────────────────────────────────────────────────────

  undo: () =>
    set(state => {
      const hist = state.history[state.activeBlockId]
      if (!hist || hist.undoStack.length === 0) return state
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state

      const stack = [...hist.undoStack]
      const cmd = stack.pop()!
      if (cmd.canUndo && !cmd.canUndo(state.blocks, block)) {
        // The command can no longer be reverted: drop it and leave the block as is.
        return { history: { ...state.history, [block.id]: { undoStack: stack, redoStack: hist.redoStack } } }
      }
      return {
        blocks: runCommand(state.blocks, block, cmd, 'undo'),
        history: {
          ...state.history,
          [block.id]: {
            undoStack: stack,
            redoStack: [...hist.redoStack, cmd],
          },
        },
      }
    }),

  redo: () =>
    set(state => {
      const hist = state.history[state.activeBlockId]
      if (!hist || hist.redoStack.length === 0) return state
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state

      const stack = [...hist.redoStack]
      const cmd = stack.pop()!
      if (cmd.canApply && !cmd.canApply(state.blocks, block)) {
        return { history: { ...state.history, [block.id]: { undoStack: hist.undoStack, redoStack: stack } } }
      }
      return {
        blocks: runCommand(state.blocks, block, cmd, 'apply'),
        history: {
          ...state.history,
          [block.id]: {
            undoStack: [...hist.undoStack, cmd],
            redoStack: stack,
          },
        },
      }
    }),

  // ── Research horizon ──────────────────────────────────────────────────────

  setHorizonTechnologyIds: (ids) => set({ horizonTechnologyIds: [...new Set(ids)] }),

  // ── Default machines ──────────────────────────────────────────────────────

  setDefaultMachine: (category, machineId) =>
    set(state =>
      state.defaultMachineOverrides[category] === machineId
        ? state
        : { defaultMachineOverrides: { ...state.defaultMachineOverrides, [category]: machineId } },
    ),

  clearDefaultMachine: (category) =>
    set(state => {
      if (!Object.hasOwn(state.defaultMachineOverrides, category)) return state
      const rest = { ...state.defaultMachineOverrides }
      delete rest[category]
      return { defaultMachineOverrides: rest }
    }),

  resetDefaultMachines: () =>
    set(state => (Object.keys(state.defaultMachineOverrides).length === 0 ? state : { defaultMachineOverrides: {} })),

  // ── Full replace (persistence) ────────────────────────────────────────────

  setAppState: (appState) =>
    set({
      blocks: appState.blocks,
      activeBlockId: appState.activeBlockId,
      horizonTechnologyIds: appState.horizonTechnologyIds,
      defaultMachineOverrides: appState.defaultMachineOverrides,
      history: {},
    }),
}))

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** The persisted/exported part of the store. */
export function selectAppState(s: BlockStoreState): AppState {
  return {
    blocks: s.blocks,
    activeBlockId: s.activeBlockId,
    horizonTechnologyIds: s.horizonTechnologyIds,
    defaultMachineOverrides: s.defaultMachineOverrides,
  }
}

export function selectActiveBlock(state: BlockStoreState): Block | undefined {
  return state.blocks.find(b => b.id === state.activeBlockId)
}
