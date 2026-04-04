import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore, makeEmptyPlan } from './planStore'
import type { ProductionGoal, RecipeNode } from '../data/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function goal(id: string, itemId: string, rate: number): ProductionGoal {
  return { id, itemId, rate }
}

function node(id: string, recipeId: string): RecipeNode {
  return { id, recipeId, modules: [], byproductPolicy: {} }
}

// Reset the store to a clean state before each test.
beforeEach(() => {
  usePlanStore.setState({
    plan: makeEmptyPlan('test', 'Test Plan', '2.0.0'),
    undoStack: [],
    redoStack: [],
  })
})

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

describe('goals', () => {
  it('adds a goal', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    const { plan } = usePlanStore.getState()
    expect(plan.goals).toHaveLength(1)
    expect(plan.goals[0].itemId).toBe('iron-plate')
  })

  it('removes a goal', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().removeGoal('g1')
    expect(usePlanStore.getState().plan.goals).toHaveLength(0)
  })

  it('updates goal rate', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().updateGoalRate('g1', 120)
    expect(usePlanStore.getState().plan.goals[0].rate).toBe(120)
  })

  it('ignores removeGoal for unknown id', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().removeGoal('unknown')
    expect(usePlanStore.getState().plan.goals).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

describe('nodes', () => {
  it('adds a node', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    expect(usePlanStore.getState().plan.nodes).toHaveLength(1)
  })

  it('removes a node', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().removeNode('n1')
    expect(usePlanStore.getState().plan.nodes).toHaveLength(0)
  })

  it('updates machine', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().updateNodeMachine('n1', 'assembling-machine-3')
    expect(usePlanStore.getState().plan.nodes[0].machineId).toBe('assembling-machine-3')
  })

  it('updates modules', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().updateNodeModules('n1', [{ moduleId: 'speed-module-3', count: 4 }])
    expect(usePlanStore.getState().plan.nodes[0].modules).toHaveLength(1)
  })

  it('updates beacon config', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    const beacon = { moduleId: 'speed-module-3', beaconCount: 8, modulesPerBeacon: 2, distributionEfficiency: 1 }
    usePlanStore.getState().updateNodeBeacon('n1', beacon)
    expect(usePlanStore.getState().plan.nodes[0].beaconConfig).toEqual(beacon)
  })

  it('updates pinned rate', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().updateNodePinnedRate('n1', 30)
    expect(usePlanStore.getState().plan.nodes[0].pinnedRate).toBe(30)
  })

  it('clears pinned rate', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().updateNodePinnedRate('n1', 30)
    usePlanStore.getState().updateNodePinnedRate('n1', undefined)
    expect(usePlanStore.getState().plan.nodes[0].pinnedRate).toBeUndefined()
  })

  it('updates byproduct policy', () => {
    usePlanStore.getState().addNode(node('n1', 'iron-plate'))
    usePlanStore.getState().updateNodeByproductPolicy('n1', { 'heavy-oil': 'discard' })
    expect(usePlanStore.getState().plan.nodes[0].byproductPolicy['heavy-oil']).toBe('discard')
  })
})

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

describe('undo/redo', () => {
  it('undoes addGoal', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().undo()
    expect(usePlanStore.getState().plan.goals).toHaveLength(0)
  })

  it('redoes after undo', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().undo()
    usePlanStore.getState().redo()
    expect(usePlanStore.getState().plan.goals).toHaveLength(1)
  })

  it('clears redo stack on new action', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().undo()
    usePlanStore.getState().addGoal(goal('g2', 'copper-plate', 30))
    usePlanStore.getState().redo() // no-op now
    expect(usePlanStore.getState().plan.goals).toHaveLength(1)
    expect(usePlanStore.getState().plan.goals[0].id).toBe('g2')
  })

  it('undoes multiple steps in order', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().addGoal(goal('g2', 'copper-plate', 30))
    usePlanStore.getState().undo()
    expect(usePlanStore.getState().plan.goals).toHaveLength(1)
    expect(usePlanStore.getState().plan.goals[0].id).toBe('g1')
    usePlanStore.getState().undo()
    expect(usePlanStore.getState().plan.goals).toHaveLength(0)
  })

  it('undoes updateGoalRate and restores old value', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    usePlanStore.getState().updateGoalRate('g1', 120)
    usePlanStore.getState().undo()
    expect(usePlanStore.getState().plan.goals[0].rate).toBe(60)
  })

  it('no-ops undo when stack is empty', () => {
    const before = usePlanStore.getState().plan
    usePlanStore.getState().undo()
    expect(usePlanStore.getState().plan).toBe(before)
  })

  it('no-ops redo when stack is empty', () => {
    const before = usePlanStore.getState().plan
    usePlanStore.getState().redo()
    expect(usePlanStore.getState().plan).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// setPlan
// ---------------------------------------------------------------------------

describe('setPlan', () => {
  it('replaces plan and clears undo/redo stacks', () => {
    usePlanStore.getState().addGoal(goal('g1', 'iron-plate', 60))
    const newPlan = makeEmptyPlan('new', 'New Plan', '2.0.0')
    usePlanStore.getState().setPlan(newPlan)
    expect(usePlanStore.getState().plan.id).toBe('new')
    expect(usePlanStore.getState().undoStack).toHaveLength(0)
    expect(usePlanStore.getState().redoStack).toHaveLength(0)
  })
})
