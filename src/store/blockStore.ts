import { create } from 'zustand'
import type { AppState, Block, SubPlan, SubPlanNode, ProductionGoal, RecipeNode, ModuleConfig, BeaconConfig } from '../data/types'

// ---------------------------------------------------------------------------
// Command pattern — operates on a SubPlan, tagged with which subplan it affects
// ---------------------------------------------------------------------------

interface Command {
  subPlanId: string
  apply: (plan: SubPlan) => SubPlan
  undo: (plan: SubPlan) => SubPlan
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

function findParentSubPlan(plan: SubPlan, targetId: string): SubPlan | undefined {
  for (const sp of plan.subPlans) {
    if (sp.id === targetId) return plan
    const found = findParentSubPlan(sp, targetId)
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

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function makeEmptySubPlan(name: string): SubPlan {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    goals: [],
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
    solverVersion: 2,
    rootPlan: makeEmptySubPlan('Main'),
  }
}

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

export interface BlockStoreState {
  blocks: Block[]
  activeBlockId: string
  activeSubPlanId: string
  history: Record<string, BlockHistory>

  // Block management
  addBlock: () => void
  removeBlock: (blockId: string) => void
  renameBlock: (blockId: string, name: string) => void
  setActiveBlock: (blockId: string) => void
  updateBlockSolverVersion: (blockId: string, version: 1 | 2) => void

  // SubPlan management
  addSubPlan: (parentSubPlanId: string, name: string) => void
  removeSubPlan: (subPlanId: string) => void
  renameSubPlan: (subPlanId: string, name: string) => void
  setActiveSubPlan: (subPlanId: string) => void

  // Goal actions (on active subplan)
  addGoal: (goal: ProductionGoal) => void
  removeGoal: (goalId: string) => void
  updateGoalRate: (goalId: string, rate: number) => void

  // Node actions (on active subplan)
  addNode: (node: RecipeNode) => void
  removeNode: (nodeId: string) => void
  moveNodeUp: (nodeId: string) => void
  moveNodeDown: (nodeId: string) => void
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
// applyCommand — applies a command to the active subplan and pushes to history
// ---------------------------------------------------------------------------

function applyCommand(
  state: BlockStoreState,
  cmd: Command,
): Partial<BlockStoreState> {
  const block = state.blocks.find(b => b.id === state.activeBlockId)
  if (!block) return {}

  const newRootPlan = updateSubPlanInTree(block.rootPlan, cmd.subPlanId, p =>
    withUpdatedAt(cmd.apply(p)),
  )
  const newBlock = { ...block, rootPlan: newRootPlan }
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
// Default initial state
// ---------------------------------------------------------------------------

const initialBlock = makeEmptyBlock('Factory')

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBlockStore = create<BlockStoreState>((set, get) => ({
  blocks: [initialBlock],
  activeBlockId: initialBlock.id,
  activeSubPlanId: initialBlock.rootPlan.id,
  history: {},

  // ── Block management ──────────────────────────────────────────────────────

  addBlock: () =>
    set(state => {
      const block = makeEmptyBlock(`Block ${state.blocks.length + 1}`)
      return {
        blocks: [...state.blocks, block],
        activeBlockId: block.id,
        activeSubPlanId: block.rootPlan.id,
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
        activeSubPlanId: next.rootPlan.id,
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
      return {
        activeBlockId: blockId,
        activeSubPlanId: block.rootPlan.id,
      }
    }),

  updateBlockSolverVersion: (blockId, version) =>
    set(state => ({
      blocks: state.blocks.map(b => (b.id === blockId ? { ...b, solverVersion: version } : b)),
    })),

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
      // Remove the subplan from the tree, then clean up any node references to it.
      let newRootPlan = removeSubPlanFromTree(block.rootPlan, subPlanId)
      newRootPlan = removeSubPlanNodeReferences(newRootPlan, subPlanId)
      const newBlocks = state.blocks.map(b =>
        b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
      )
      // If the removed subplan was active, switch to its parent (or root).
      if (state.activeSubPlanId !== subPlanId) {
        return { blocks: newBlocks }
      }
      const parent = findParentSubPlan(block.rootPlan, subPlanId)
      return {
        blocks: newBlocks,
        activeSubPlanId: parent?.id ?? block.rootPlan.id,
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

  setActiveSubPlan: (subPlanId) => set({ activeSubPlanId: subPlanId }),

  // ── Goals ─────────────────────────────────────────────────────────────────

  addGoal: (goal) =>
    set(state => {
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, goals: [...p.goals, goal] }),
        undo: p => ({ ...p, goals: p.goals.filter(g => g.id !== goal.id) }),
      }
      return applyCommand(state, cmd)
    }),

  removeGoal: (goalId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const target = subPlan?.goals.find(g => g.id === goalId)
      if (!target) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, goals: p.goals.filter(g => g.id !== goalId) }),
        undo: p => ({ ...p, goals: [...p.goals, target] }),
      }
      return applyCommand(state, cmd)
    }),

  updateGoalRate: (goalId, rate) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const oldGoal = subPlan?.goals.find(g => g.id === goalId)
      if (!oldGoal) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, goals: p.goals.map(g => g.id === goalId ? { ...g, rate } : g) }),
        undo: p => ({ ...p, goals: p.goals.map(g => g.id === goalId ? { ...g, rate: oldGoal.rate } : g) }),
      }
      return applyCommand(state, cmd)
    }),

  // ── Nodes ─────────────────────────────────────────────────────────────────

  addNode: (node) =>
    set(state => {
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: [...p.nodes, node] }),
        undo: p => ({ ...p, nodes: p.nodes.filter(n => n.id !== node.id) }),
      }
      return applyCommand(state, cmd)
    }),

  moveNodeUp: (nodeId) =>
    set(state => {
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => {
          const idx = p.nodes.findIndex(n => n.id === nodeId)
          if (idx <= 0) return p
          const nodes = [...p.nodes]
          ;[nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]]
          return { ...p, nodes }
        },
        undo: p => {
          const idx = p.nodes.findIndex(n => n.id === nodeId)
          if (idx < 0 || idx >= p.nodes.length - 1) return p
          const nodes = [...p.nodes]
          ;[nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]]
          return { ...p, nodes }
        },
      }
      return applyCommand(state, cmd)
    }),

  moveNodeDown: (nodeId) =>
    set(state => {
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => {
          const idx = p.nodes.findIndex(n => n.id === nodeId)
          if (idx < 0 || idx >= p.nodes.length - 1) return p
          const nodes = [...p.nodes]
          ;[nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]]
          return { ...p, nodes }
        },
        undo: p => {
          const idx = p.nodes.findIndex(n => n.id === nodeId)
          if (idx <= 0) return p
          const nodes = [...p.nodes]
          ;[nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]]
          return { ...p, nodes }
        },
      }
      return applyCommand(state, cmd)
    }),

  removeNode: (nodeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const target = subPlan?.nodes.find(n => n.id === nodeId)
      if (!target) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.filter(n => n.id !== nodeId) }),
        undo: p => ({ ...p, nodes: [...p.nodes, target] }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeMachine: (nodeId, machineId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, machineId } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, machineId: old.machineId } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeModules: (nodeId, modules) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, modules } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, modules: old.modules } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeBeacon: (nodeId, beaconConfig) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, beaconConfig } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, beaconConfig: old.beaconConfig } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodePinnedRate: (nodeId, pinnedRate) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, pinnedRate } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, pinnedRate: old.pinnedRate } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeByproductPolicy: (nodeId, byproductPolicy) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, byproductPolicy } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, byproductPolicy: old.byproductPolicy } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeByproductConsumer: (nodeId, value) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const oldValue = old.kind === 'game-recipe' ? old.byproductConsumer : undefined
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, byproductConsumer: value } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, byproductConsumer: oldValue } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodePrimaryProduct: (nodeId, primaryProduct) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, primaryProduct } : n) }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? { ...n, primaryProduct: (old as { primaryProduct?: string }).primaryProduct } : n) }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeRecipe: (nodeId, recipeId) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      const subPlan = block ? findSubPlan(block.rootPlan, state.activeSubPlanId) : undefined
      const old = subPlan?.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        subPlanId: state.activeSubPlanId,
        apply: p => ({
          ...p,
          nodes: p.nodes.map(n =>
            n.id === nodeId
              ? { ...n, recipeId, machineId: undefined, modules: [], beaconConfig: undefined, pinnedRate: undefined, byproductPolicy: {}, byproductConsumer: undefined }
              : n,
          ),
        }),
        undo: p => ({ ...p, nodes: p.nodes.map(n => n.id === nodeId ? old : n) }),
      }
      return applyCommand(state, cmd)
    }),

  wrapNodeInSubPlan: (nodeId, name) =>
    set(state => {
      const block = state.blocks.find(b => b.id === state.activeBlockId)
      if (!block) return state
      const subPlan = findSubPlan(block.rootPlan, state.activeSubPlanId)
      if (!subPlan) return state
      const node = subPlan.nodes.find(n => n.id === nodeId)
      if (!node || node.kind !== 'game-recipe') return state

      const now = new Date().toISOString()
      const newSubPlan: SubPlan = {
        id: crypto.randomUUID(),
        name,
        goals: [],
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
      const newRootPlan = updateSubPlanInTree(block.rootPlan, state.activeSubPlanId, p => ({
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
      const newRootPlan = updateSubPlanInTree(block.rootPlan, cmd.subPlanId, p =>
        withUpdatedAt(cmd.undo(p)),
      )
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
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
      const newRootPlan = updateSubPlanInTree(block.rootPlan, cmd.subPlanId, p =>
        withUpdatedAt(cmd.apply(p)),
      )
      return {
        blocks: state.blocks.map(b =>
          b.id === block.id ? { ...block, rootPlan: newRootPlan } : b,
        ),
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
      activeSubPlanId: appState.blocks.find(b => b.id === appState.activeBlockId)?.rootPlan.id ?? '',
      history: {},
    }),
}))

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

export function selectActiveBlock(state: BlockStoreState): Block | undefined {
  return state.blocks.find(b => b.id === state.activeBlockId)
}

export function selectActiveSubPlan(state: BlockStoreState): SubPlan | undefined {
  const block = selectActiveBlock(state)
  if (!block) return undefined
  return findSubPlan(block.rootPlan, state.activeSubPlanId)
}

