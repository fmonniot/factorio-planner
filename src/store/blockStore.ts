import { create } from 'zustand'
import type { AppState, Block, SubPlan, SubPlanNode, ProductionGoal, RecipeNode, ModuleConfig, BeaconConfig } from '../data/types'

// ---------------------------------------------------------------------------
// Command pattern — operates on the active Block, with full apply/undo.
// ---------------------------------------------------------------------------

interface Command {
  apply: (block: Block) => Block
  undo: (block: Block) => Block
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

export function makeEmptyBlock(name: string): Block {
  return {
    id: crypto.randomUUID(),
    name,
    gameDataVersion: '',
    goals: [],
    noImportItems: [],
    rootPlan: makeEmptySubPlan('Main'),
  }
}

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

export interface BlockStoreState {
  blocks: Block[]
  activeBlockId: string
  history: Record<string, BlockHistory>

  // Block management
  addBlock: () => void
  removeBlock: (blockId: string) => void
  renameBlock: (blockId: string, name: string) => void
  setActiveBlock: (blockId: string) => void
  // SubPlan management
  addSubPlan: (parentSubPlanId: string, name: string) => void
  removeSubPlan: (subPlanId: string) => void
  renameSubPlan: (subPlanId: string, name: string) => void

  // Goal actions (block-level)
  addGoal: (goal: ProductionGoal) => void
  removeGoal: (goalId: string) => void
  updateGoalRate: (goalId: string, rate: number) => void

  // No-import items (block-level; LP cannot import these as raw inputs)
  toggleNoImportItem: (itemId: string) => void

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

  // Undo/redo (per active block)
  undo: () => void
  redo: () => void

  // Full state replacement (persistence)
  setAppState: (state: AppState) => void
}

// ---------------------------------------------------------------------------
// applyCommand — applies a command to the active block and pushes to history
// ---------------------------------------------------------------------------

function applyCommand(
  state: BlockStoreState,
  cmd: Command,
): Partial<BlockStoreState> {
  const block = state.blocks.find(b => b.id === state.activeBlockId)
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
  history: {},

  // ── Block management ──────────────────────────────────────────────────────

  addBlock: () =>
    set(state => {
      const block = makeEmptyBlock(`Block ${state.blocks.length + 1}`)
      return {
        blocks: [...state.blocks, block],
        activeBlockId: block.id,
      }
    }),

  removeBlock: (blockId) =>
    set(state => {
      if (state.blocks.length <= 1) return state
      const remaining = state.blocks.filter(b => b.id !== blockId)
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

  renameBlock: (blockId, name) =>
    set(state => ({
      blocks: state.blocks.map(b => (b.id === blockId ? { ...b, name } : b)),
    })),

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
      let newRootPlan = removeSubPlanFromTree(block.rootPlan, subPlanId)
      newRootPlan = removeSubPlanNodeReferences(newRootPlan, subPlanId)
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
      }
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

  // ── Goals (block-level) ───────────────────────────────────────────────────

  addGoal: (goal) =>
    set(state => {
      const cmd: Command = {
        apply: b => ({ ...b, goals: [...b.goals, goal] }),
        undo: b => ({ ...b, goals: b.goals.filter(g => g.id !== goal.id) }),
      }
      return applyCommand(state, cmd)
    }),

  removeGoal: (goalId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const target = block?.goals.find(g => g.id === goalId)
      if (!target) return state
      const cmd: Command = {
        apply: b => ({ ...b, goals: b.goals.filter(g => g.id !== goalId) }),
        undo: b => ({ ...b, goals: [...b.goals, target] }),
      }
      return applyCommand(state, cmd)
    }),

  updateGoalRate: (goalId, rate) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const oldGoal = block?.goals.find(g => g.id === goalId)
      if (!oldGoal) return state
      const cmd: Command = {
        apply: b => ({ ...b, goals: b.goals.map(g => g.id === goalId ? { ...g, rate } : g) }),
        undo: b => ({ ...b, goals: b.goals.map(g => g.id === goalId ? { ...g, rate: oldGoal.rate } : g) }),
      }
      return applyCommand(state, cmd)
    }),

  toggleNoImportItem: (itemId) =>
    set(state => {
      const cmd: Command = {
        apply: b => {
          const has = b.noImportItems.includes(itemId)
          return {
            ...b,
            noImportItems: has
              ? b.noImportItems.filter(i => i !== itemId)
              : [...b.noImportItems, itemId],
          }
        },
        undo: b => {
          const has = b.noImportItems.includes(itemId)
          return {
            ...b,
            noImportItems: has
              ? b.noImportItems.filter(i => i !== itemId)
              : [...b.noImportItems, itemId],
          }
        },
      }
      return applyCommand(state, cmd)
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

  // ── Full replace (persistence) ────────────────────────────────────────────

  setAppState: (appState) =>
    set({
      blocks: appState.blocks,
      activeBlockId: appState.activeBlockId,
      history: {},
    }),
}))

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

export function selectActiveBlock(state: BlockStoreState): Block | undefined {
  return state.blocks.find(b => b.id === state.activeBlockId)
}
