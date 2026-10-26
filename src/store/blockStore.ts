import { create } from 'zustand'
import { canConnect } from './connections'
import { pickBlockColor, HEX_COLOR_RE } from '../data/blockColors'
import type { AppState, Block, BlockConnection, SubPlan, SubPlanNode, Product, RecipeNode, ModuleConfig, BeaconConfig } from '../data/types'

// ---------------------------------------------------------------------------
// Command pattern — operates on the active Block, with full apply/undo.
// ---------------------------------------------------------------------------

interface Command {
  apply: (block: Block) => Block
  undo: (block: Block) => Block
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

export function findSubPlan(plan: SubPlan, id: string): SubPlan | undefined {
  if (plan.id === id) return plan
  for (const sp of plan.subPlans) {
    const found = findSubPlan(sp, id)
    if (found) return found
  }
  return undefined
}

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

export function makeEmptyBlock(name: string, color: string = pickBlockColor([])): Block {
  return {
    id: crypto.randomUUID(),
    name,
    color,
    products: [],
    noImportItems: [],
    connectionsFirstItems: [],
    inputConnections: [],
    rootPlan: makeEmptySubPlan('Main'),
  }
}

/**
 * Deep copy of a block with a fresh id on the block, its products, input
 * connections, sub-plans and nodes. `subplan` nodes are remapped to the cloned
 * child sub-plans. Connections from other blocks reading this one are not part
 * of the block, so they are not copied.
 */
export function cloneBlock(block: Block, color: string): Block {
  const subPlanIds = new Map<string, string>()

  function cloneSubPlan(plan: SubPlan): SubPlan {
    const id = crypto.randomUUID()
    subPlanIds.set(plan.id, id)
    return { ...structuredClone(plan), id, nodes: [], subPlans: plan.subPlans.map(cloneSubPlan) }
  }

  const rootPlan = cloneSubPlan(block.rootPlan)

  function cloneNodes(source: SubPlan, target: SubPlan) {
    target.nodes = source.nodes.map((node): RecipeNode | SubPlanNode => {
      const copy = structuredClone(node)
      copy.id = crypto.randomUUID()
      if (copy.kind === 'subplan') copy.subPlanId = subPlanIds.get(copy.subPlanId) ?? copy.subPlanId
      return copy
    })
    source.subPlans.forEach((child, i) => cloneNodes(child, target.subPlans[i]))
  }
  cloneNodes(block.rootPlan, rootPlan)

  return {
    ...structuredClone(block),
    id: crypto.randomUUID(),
    name: `${block.name} (copy)`,
    color,
    products: block.products.map(p => ({ ...structuredClone(p), id: crypto.randomUUID() })),
    inputConnections: block.inputConnections.map(c => ({ ...c, id: crypto.randomUUID() })),
    rootPlan,
  }
}

/**
 * Deep copy of a whole plan with fresh ids on every block (and below), so two
 * plans never share ids that the solver results and undo history are keyed by.
 * Names and colours are kept; connections and the active block are remapped
 * to the copies. The input is not mutated.
 */
export function clonePlan(appState: AppState): AppState {
  const copies = appState.blocks.map(b => ({ ...cloneBlock(b, b.color), name: b.name }))
  const ids = new Map(appState.blocks.map((b, i) => [b.id, copies[i].id]))
  return {
    blocks: copies.map(b => ({
      ...b,
      inputConnections: b.inputConnections.map(c => ({ ...c, fromBlockId: ids.get(c.fromBlockId) ?? c.fromBlockId })),
    })),
    activeBlockId: ids.get(appState.activeBlockId) ?? appState.activeBlockId,
    horizonTechnologyIds: [...appState.horizonTechnologyIds],
    defaultMachineOverrides: { ...appState.defaultMachineOverrides },
  }
}

/** `list` without `itemId` if it has it, with it appended otherwise. */
function toggled(list: string[], itemId: string): string[] {
  return list.includes(itemId) ? list.filter(i => i !== itemId) : [...list, itemId]
}

/** Toggle `itemId` in one of the block's item lists; the toggle is its own inverse. */
function toggleItemCommand(field: 'noImportItems' | 'connectionsFirstItems', itemId: string): Command {
  const toggle = (b: Block): Block => ({ ...b, [field]: toggled(b[field], itemId) })
  return { apply: toggle, undo: toggle }
}

/** Command adding a connection for `itemId` from `fromBlockId`; undo removes it, redo is checked against the then-current blocks. */
function addConnectionCommand(itemId: string, fromBlockId: string): Command {
  // The id is fixed here so redo restores the same connection.
  const connection: BlockConnection = { id: crypto.randomUUID(), itemId, fromBlockId }
  return {
    apply: b => ({ ...b, inputConnections: [...b.inputConnections, connection] }),
    undo: b => ({ ...b, inputConnections: b.inputConnections.filter(c => c.id !== connection.id) }),
    // Redo after other blocks changed may no longer be legal.
    canApply: (blocks, b) => canConnect(blocks, b, itemId, fromBlockId),
  }
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
  setBlockColor: (blockId: string, color: string) => void
  setActiveBlock: (blockId: string) => void
  // SubPlan management
  addSubPlan: (parentSubPlanId: string, name: string) => void
  removeSubPlan: (subPlanId: string) => void
  renameSubPlan: (subPlanId: string, name: string) => void

  // Products (block-level)
  addProduct: (product: Product) => void
  removeProduct: (productId: string) => void
  updateProductExtra: (productId: string, extraRate: number | undefined) => void

  // No-import items (block-level; LP cannot import these as raw inputs)
  toggleNoImportItem: (itemId: string) => void
  toggleConnectionsFirstItem: (itemId: string) => void
  /**
   * Append a block that makes `itemId` (named `name`), make it active, and request the item
   * from it on `consumerId` (default: the active block). Returns the new block's id, or
   * undefined, with no change, when the consumer is missing or cannot connect.
   */
  addBlockForItem: (itemId: string, name: string, consumerId?: string) => string | undefined

  // Inbound connections (block-level; the target block (default: active) receives itemId from fromBlockId)
  /** Connect; a request when `itemId` is a product of the source (a cycle of requests is allowed and solved in rounds), otherwise it takes existing output. */
  addInputConnection: (itemId: string, fromBlockId: string, toBlockId?: string) => void
  removeInputConnection: (connectionId: string, toBlockId?: string) => void
  /** Cap what the consumer takes over a connection (items/min); undefined removes the cap. */
  setConnectionMaxRate: (connectionId: string, maxRate: number | undefined, toBlockId?: string) => void

  // Node actions (resolved against whichever subplan contains the node)
  addNode: (node: RecipeNode, targetSubPlanId?: string) => void
  removeNode: (nodeId: string) => void
  moveNodeUp: (nodeId: string) => void
  moveNodeDown: (nodeId: string) => void
  moveNode: (nodeId: string, targetSubPlanId: string, targetIndex: number) => void
  updateNodeMachine: (nodeId: string, machineId: string | undefined) => void
  updateNodeModules: (nodeId: string, modules: ModuleConfig[]) => void
  updateNodeBeacon: (nodeId: string, beacon: BeaconConfig | undefined) => void
  updateNodePinnedRate: (nodeId: string, rate: number | undefined) => void
  updateNodeByproductPolicy: (nodeId: string, policy: Record<string, 'discard' | 'feed-back'>) => void
  updateNodeByproductConsumer: (nodeId: string, value: boolean) => void
  updateNodePrimaryProduct: (nodeId: string, itemId: string | undefined) => void
  updateNodeRecipe: (nodeId: string, recipeId: string) => void
  wrapNodeInSubPlan: (nodeId: string, name: string) => void

  // Research horizon (plan-wide; not undoable)
  setHorizonTechnologyIds: (ids: string[]) => void

  // Default machines (not undoable, like the horizon)
  setDefaultMachine: (category: string, machineId: string) => void
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

function applyCommand(
  state: BlockStoreState,
  cmd: Command,
  blockId: string = state.activeBlockId,
): Partial<BlockStoreState> {
  const block = state.blocks.find(b => b.id === blockId)
  if (!block) return {}

  const newBlock = cmd.apply(block)
  const hist = state.history[block.id] ?? { undoStack: [], redoStack: [] }

  return {
    blocks: state.blocks.map(b => (b.id === block.id ? newBlock : b)),
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

// ---------------------------------------------------------------------------
// Default initial state
// ---------------------------------------------------------------------------

const initialBlock = makeEmptyBlock('Factory')

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBlockStore = create<BlockStoreState>((set) => ({
  blocks: [initialBlock],
  activeBlockId: initialBlock.id,
  horizonTechnologyIds: [],
  defaultMachineOverrides: {},
  history: {},

  // ── Block management ──────────────────────────────────────────────────────

  addBlock: () =>
    set(state => {
      const block = makeEmptyBlock(`Block ${state.blocks.length + 1}`, pickBlockColor(state.blocks.map(b => b.color)))
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
        .map(b => b.inputConnections.some(c => c.fromBlockId === blockId)
          ? { ...b, inputConnections: b.inputConnections.filter(c => c.fromBlockId !== blockId) }
          : b)
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

  setBlockColor: (blockId, color) =>
    set(state => {
      const hex = color.toLowerCase()
      if (!HEX_COLOR_RE.test(hex)) return state
      if (state.blocks.find(b => b.id === blockId)?.color === hex) return state
      return { blocks: state.blocks.map(b => (b.id === blockId ? { ...b, color: hex } : b)) }
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
      if (!block) return state
      const newSubPlan = makeEmptySubPlan(name)
      const newSubPlanNode: SubPlanNode = {
        kind: 'subplan',
        id: crypto.randomUUID(),
        subPlanId: newSubPlan.id,
      }
      const newRootPlan = updateSubPlanInTree(block.rootPlan, parentSubPlanId, p => ({
        ...p,
        subPlans: [...p.subPlans, newSubPlan],
        nodes: [...p.nodes, newSubPlanNode],
      }))
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
      }
    }),

  removeSubPlan: (subPlanId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const parent = findParentSubPlan(block.rootPlan, subPlanId)
      if (!parent) return state
      // Snapshot the removed sub-plan and its handle so undo reinserts the same
      // objects at their original positions.
      const parentId = parent.id
      const subPlanIndex = parent.subPlans.findIndex(sp => sp.id === subPlanId)
      const removed = parent.subPlans[subPlanIndex]
      const handleIndex = parent.nodes.findIndex(n => n.kind === 'subplan' && n.subPlanId === subPlanId)
      const handle = handleIndex >= 0 ? parent.nodes[handleIndex] : undefined
      const cmd: Command = {
        apply: b => touchSubPlan({
          ...b,
          rootPlan: removeSubPlanNodeReferences(removeSubPlanFromTree(b.rootPlan, subPlanId), subPlanId),
        }, parentId),
        undo: b => touchSubPlan({
          ...b,
          rootPlan: updateSubPlanInTree(b.rootPlan, parentId, p => {
            const subPlans = [...p.subPlans]
            subPlans.splice(subPlanIndex, 0, removed)
            const nodes = [...p.nodes]
            if (handle) nodes.splice(handleIndex, 0, handle)
            return { ...p, subPlans, nodes }
          }),
        }, parentId),
        // Drop the command rather than orphan the sub-plan or duplicate its id when
        // the tree changed through an action that is not undoable.
        canUndo: (_blocks, b) =>
          findSubPlan(b.rootPlan, parentId) !== undefined && findSubPlan(b.rootPlan, removed.id) === undefined,
      }
      return applyCommand(state, cmd)
    }),

  renameSubPlan: (subPlanId, name) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const newRootPlan = updateSubPlanInTree(block.rootPlan, subPlanId, p => ({
        ...p,
        name,
      }))
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
      }
    }),

  // ── Products (block-level) ────────────────────────────────────────────────

  addProduct: (product) =>
    set(state => {
      const cmd: Command = {
        apply: b => ({ ...b, products: [...b.products, product] }),
        undo: b => ({ ...b, products: b.products.filter(p => p.id !== product.id) }),
      }
      return applyCommand(state, cmd)
    }),

  removeProduct: (productId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const index = block?.products.findIndex(p => p.id === productId) ?? -1
      const target = block?.products[index]
      if (!target) return state
      const cmd: Command = {
        apply: b => ({ ...b, products: b.products.filter(p => p.id !== productId) }),
        // Back at its old index: the first product of an item receives the requested amount.
        undo: b => {
          const products = [...b.products]
          products.splice(index, 0, target)
          return { ...b, products }
        },
      }
      return applyCommand(state, cmd)
    }),

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

  toggleNoImportItem: (itemId) =>
    set(state => {
      return applyCommand(state, toggleItemCommand('noImportItems', itemId))
    }),

  toggleConnectionsFirstItem: (itemId) =>
    set(state => {
      return applyCommand(state, toggleItemCommand('connectionsFirstItems', itemId))
    }),

  addBlockForItem: (itemId, name, consumerId) => {
    let newId: string | undefined
    set(state => {
      const targetId = consumerId ?? state.activeBlockId
      const consumer = state.blocks.find(b => b.id === targetId)
      if (!consumer) return state
      const block: Block = {
        ...makeEmptyBlock(name, pickBlockColor(state.blocks.map(b => b.color))),
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
      const cmd: Command = {
        apply: b => ({ ...b, inputConnections: b.inputConnections.filter(c => c.id !== connectionId) }),
        undo: b => {
          const connections = [...b.inputConnections]
          connections.splice(index, 0, target)
          return { ...b, inputConnections: connections }
        },
        // Undoing a removal re-adds the edge, which may no longer be legal (source deleted, duplicate).
        canUndo: (blocks, b) => canConnect(blocks, b, target.itemId, target.fromBlockId),
      }
      return applyCommand(state, cmd, targetId)
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

  // ── Nodes ─────────────────────────────────────────────────────────────────
  //
  // Newly added nodes go into the rootPlan. Existing-node mutations resolve
  // the containing subplan by walking the tree at command-creation time.

  addNode: (node, targetSubPlanId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlanId = targetSubPlanId ?? block.rootPlan.id
      const cmd: Command = {
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

      const cmd: Command = {
        apply: b => {
          let root = b.rootPlan
          // Remove from source.
          root = updateSubPlanInTree(root, sourceSubPlanId, p => ({
            ...p, nodes: p.nodes.filter(n => n.id !== nodeId),
          }))
          // Insert into target.
          root = updateSubPlanInTree(root, targetSubPlanId, p => {
            const nodes = [...p.nodes]
            nodes.splice(normIndex, 0, node)
            return { ...p, nodes }
          })
          return touchSubPlan(touchSubPlan({ ...b, rootPlan: root }, sourceSubPlanId), targetSubPlanId)
        },
        undo: b => {
          let root = b.rootPlan
          // Remove from target.
          root = updateSubPlanInTree(root, targetSubPlanId, p => ({
            ...p, nodes: p.nodes.filter(n => n.id !== nodeId),
          }))
          // Restore at source.
          root = updateSubPlanInTree(root, sourceSubPlanId, p => {
            const nodes = [...p.nodes]
            nodes.splice(sourceIndex, 0, node)
            return { ...p, nodes }
          })
          return touchSubPlan(touchSubPlan({ ...b, rootPlan: root }, sourceSubPlanId), targetSubPlanId)
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

  updateNodeBeacon: (nodeId, beaconConfig) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlanContainingNode(block.rootPlan, nodeId)
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old || old.kind !== 'game-recipe') return state
      const oldBeacon = old.beaconConfig
      const cmd = nodeCommand(block, nodeId,
        n => n.kind === 'game-recipe' ? { ...n, beaconConfig } : n,
        n => n.kind === 'game-recipe' ? { ...n, beaconConfig: oldBeacon } : n,
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
      const node = containing.nodes.find(n => n.id === nodeId)
      if (!node || node.kind !== 'game-recipe') return state

      const now = new Date().toISOString()
      const newSubPlan: SubPlan = {
        id: crypto.randomUUID(),
        name,
        nodes: [node],
        subPlans: [],
        createdAt: now,
        updatedAt: now,
      }
      const newSubPlanNode: SubPlanNode = {
        kind: 'subplan',
        id: crypto.randomUUID(),
        subPlanId: newSubPlan.id,
      }
      const newRootPlan = updateSubPlanInTree(block.rootPlan, containing.id, p => ({
        ...p,
        nodes: p.nodes.map(n => (n.id === nodeId ? newSubPlanNode : n)),
        subPlans: [...p.subPlans, newSubPlan],
        updatedAt: now,
      }))
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
      }
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
      const newBlock = cmd.undo(block)
      return {
        blocks: state.blocks.map(b => (b.id === block.id ? newBlock : b)),
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
      const newBlock = cmd.apply(block)
      return {
        blocks: state.blocks.map(b => (b.id === block.id ? newBlock : b)),
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
