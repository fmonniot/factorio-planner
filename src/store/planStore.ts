import { create } from 'zustand'
import type { Plan, ProductionGoal, RecipeNode, ModuleConfig, BeaconConfig } from '../data/types'

// ---------------------------------------------------------------------------
// Command pattern for undo/redo
// ---------------------------------------------------------------------------

interface Command {
  apply: (plan: Plan) => Plan
  undo: (plan: Plan) => Plan
}

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

export interface PlanStoreState {
  plan: Plan
  undoStack: Command[]
  redoStack: Command[]

  // Goal actions
  addGoal: (goal: ProductionGoal) => void
  removeGoal: (goalId: string) => void
  updateGoalRate: (goalId: string, rate: number) => void

  // Node actions
  addNode: (node: RecipeNode) => void
  removeNode: (nodeId: string) => void
  updateNodeMachine: (nodeId: string, machineId: string | undefined) => void
  updateNodeModules: (nodeId: string, modules: ModuleConfig[]) => void
  updateNodeBeacon: (nodeId: string, beacon: BeaconConfig | undefined) => void
  updateNodePinnedRate: (nodeId: string, rate: number | undefined) => void
  updateNodeByproductPolicy: (nodeId: string, policy: Record<string, 'discard' | 'feed-back'>) => void
  /**
   * Swap the recipe on a node. Resets machine, modules, beacon, pinnedRate,
   * and byproductPolicy since they are all recipe-specific. Fully undoable.
   */
  updateNodeRecipe: (nodeId: string, recipeId: string) => void

  // Undo/redo
  undo: () => void
  redo: () => void

  // Replace the entire plan (used by persistence / import)
  setPlan: (plan: Plan) => void
}

// ---------------------------------------------------------------------------
// Helper — apply a command and push it onto the undo stack
// ---------------------------------------------------------------------------

function applyCommand(
  state: Pick<PlanStoreState, 'plan' | 'undoStack'>,
  cmd: Command,
): Pick<PlanStoreState, 'plan' | 'undoStack' | 'redoStack'> {
  const newPlan = cmd.apply(state.plan)
  return {
    plan: withUpdatedAt(newPlan),
    undoStack: [...state.undoStack, cmd],
    redoStack: [],
  }
}

function withUpdatedAt(plan: Plan): Plan {
  return { ...plan, updatedAt: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Default empty plan
// ---------------------------------------------------------------------------

export function makeEmptyPlan(id: string, name: string, gameDataVersion: string): Plan {
  const now = new Date().toISOString()
  return {
    id,
    name,
    gameDataVersion,
    goals: [],
    nodes: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePlanStore = create<PlanStoreState>((set) => ({
  plan: makeEmptyPlan('default', 'My Plan', ''),
  undoStack: [],
  redoStack: [],

  // ── Goals ────────────────────────────────────────────────────────────────

  addGoal: (goal) =>
    set((state) => {
      const cmd: Command = {
        apply: (p) => ({ ...p, goals: [...p.goals, goal] }),
        undo:  (p) => ({ ...p, goals: p.goals.filter(g => g.id !== goal.id) }),
      }
      return applyCommand(state, cmd)
    }),

  removeGoal: (goalId) =>
    set((state) => {
      const target = state.plan.goals.find(g => g.id === goalId)
      if (!target) return state
      const cmd: Command = {
        apply: (p) => ({ ...p, goals: p.goals.filter(g => g.id !== goalId) }),
        undo:  (p) => ({ ...p, goals: [...p.goals, target] }),
      }
      return applyCommand(state, cmd)
    }),

  updateGoalRate: (goalId, rate) =>
    set((state) => {
      const oldGoal = state.plan.goals.find(g => g.id === goalId)
      if (!oldGoal) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          goals: p.goals.map(g => g.id === goalId ? { ...g, rate } : g),
        }),
        undo: (p) => ({
          ...p,
          goals: p.goals.map(g => g.id === goalId ? { ...g, rate: oldGoal.rate } : g),
        }),
      }
      return applyCommand(state, cmd)
    }),

  // ── Nodes ────────────────────────────────────────────────────────────────

  addNode: (node) =>
    set((state) => {
      const cmd: Command = {
        apply: (p) => ({ ...p, nodes: [...p.nodes, node] }),
        undo:  (p) => ({ ...p, nodes: p.nodes.filter(n => n.id !== node.id) }),
      }
      return applyCommand(state, cmd)
    }),

  removeNode: (nodeId) =>
    set((state) => {
      const target = state.plan.nodes.find(n => n.id === nodeId)
      if (!target) return state
      const cmd: Command = {
        apply: (p) => ({ ...p, nodes: p.nodes.filter(n => n.id !== nodeId) }),
        undo:  (p) => ({ ...p, nodes: [...p.nodes, target] }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeMachine: (nodeId, machineId) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, machineId } : n),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, machineId: old.machineId } : n),
        }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeModules: (nodeId, modules) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, modules } : n),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, modules: old.modules } : n),
        }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeBeacon: (nodeId, beaconConfig) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, beaconConfig } : n),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n =>
            n.id === nodeId ? { ...n, beaconConfig: old.beaconConfig } : n,
          ),
        }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodePinnedRate: (nodeId, pinnedRate) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, pinnedRate } : n),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n =>
            n.id === nodeId ? { ...n, pinnedRate: old.pinnedRate } : n,
          ),
        }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeByproductPolicy: (nodeId, byproductPolicy) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? { ...n, byproductPolicy } : n),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n =>
            n.id === nodeId ? { ...n, byproductPolicy: old.byproductPolicy } : n,
          ),
        }),
      }
      return applyCommand(state, cmd)
    }),

  updateNodeRecipe: (nodeId, recipeId) =>
    set((state) => {
      const old = state.plan.nodes.find(n => n.id === nodeId)
      if (!old) return state
      const cmd: Command = {
        apply: (p) => ({
          ...p,
          nodes: p.nodes.map(n =>
            n.id === nodeId
              ? { ...n, recipeId, machineId: undefined, modules: [], beaconConfig: undefined, pinnedRate: undefined, byproductPolicy: {} }
              : n,
          ),
        }),
        undo: (p) => ({
          ...p,
          nodes: p.nodes.map(n => n.id === nodeId ? old : n),
        }),
      }
      return applyCommand(state, cmd)
    }),

  // ── Undo / Redo ──────────────────────────────────────────────────────────

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state
      const stack = [...state.undoStack]
      const cmd = stack.pop()!
      return {
        plan: withUpdatedAt(cmd.undo(state.plan)),
        undoStack: stack,
        redoStack: [...state.redoStack, cmd],
      }
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state
      const stack = [...state.redoStack]
      const cmd = stack.pop()!
      return {
        plan: withUpdatedAt(cmd.apply(state.plan)),
        undoStack: [...state.undoStack, cmd],
        redoStack: stack,
      }
    }),

  // ── Full replace (import / persistence restore) ──────────────────────────

  setPlan: (plan) =>
    set({ plan, undoStack: [], redoStack: [] }),
}))
