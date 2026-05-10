import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBlockStore,
  makeEmptyBlock,
  makeEmptySubPlan,
  findSubPlan,
  isSubPlanDescendant,
} from './blockStore'
import type { RecipeNode, SubPlanNode } from '../data/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


const ironNode: RecipeNode = {
  kind: 'game-recipe',
  id: 'node-iron',
  recipeId: 'iron-plate',
  modules: [],
  byproductPolicy: {},
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  const block = makeEmptyBlock('Test Block')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    history: {},
  })
})

// ---------------------------------------------------------------------------
// findSubPlan
// ---------------------------------------------------------------------------

describe('findSubPlan', () => {
  it('finds the root plan by id', () => {
    const block = makeEmptyBlock('B')
    expect(findSubPlan(block.rootPlan, block.rootPlan.id)!.id).toBe(block.rootPlan.id)
  })

  it('finds a nested subplan by id', () => {
    const child = makeEmptySubPlan('Child')
    const root = { ...makeEmptySubPlan('Root'), subPlans: [child] }
    expect(findSubPlan(root, child.id)!.id).toBe(child.id)
  })

  it('returns undefined for a missing id', () => {
    const root = makeEmptySubPlan('Root')
    expect(findSubPlan(root, 'nope')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe('addNode', () => {
  it('appends to rootPlan by default', () => {
    useBlockStore.getState().addNode(ironNode)
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('node-iron')
  })

  it('appends to a specific subplan when targetSubPlanId is provided', () => {
    const child = makeEmptySubPlan('Sub')
    const block = useBlockStore.getState().blocks[0]
    const spNode: import('../data/types').SubPlanNode = { kind: 'subplan', id: 'sp-node', subPlanId: child.id }
    const rootPlan = { ...block.rootPlan, nodes: [spNode], subPlans: [child] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().addNode(ironNode, child.id)

    const updated = useBlockStore.getState().blocks[0].rootPlan
    expect(updated.nodes).toHaveLength(1) // still just the spNode at root
    expect(updated.subPlans[0].nodes).toHaveLength(1)
    expect(updated.subPlans[0].nodes[0].id).toBe('node-iron')
  })
})

// ---------------------------------------------------------------------------
// moveNodeUp / moveNodeDown
// ---------------------------------------------------------------------------

describe('moveNodeUp', () => {
  it('moves a node up one position', () => {
    const block = makeEmptyBlock('B')
    const node2: RecipeNode = { ...ironNode, id: 'node-2' }
    const rootPlan = { ...block.rootPlan, nodes: [ironNode, node2] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    useBlockStore.getState().moveNodeUp('node-2')
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes[0].id).toBe('node-2')
    expect(nodes[1].id).toBe('node-iron')
  })

  it('is a no-op when already first', () => {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [ironNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    useBlockStore.getState().moveNodeUp('node-iron')
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes[0].id).toBe('node-iron')
  })
})

describe('moveNodeDown', () => {
  it('moves a node down one position', () => {
    const block = makeEmptyBlock('B')
    const node2: RecipeNode = { ...ironNode, id: 'node-2' }
    const rootPlan = { ...block.rootPlan, nodes: [ironNode, node2] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    useBlockStore.getState().moveNodeDown('node-iron')
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes[0].id).toBe('node-2')
    expect(nodes[1].id).toBe('node-iron')
  })
})

// ---------------------------------------------------------------------------
// wrapNodeInSubPlan
// ---------------------------------------------------------------------------

describe('wrapNodeInSubPlan', () => {
  function setupWithNode() {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [ironNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
  }

  it('replaces the original node with a SubPlanNode', () => {
    setupWithNode()
    useBlockStore.getState().wrapNodeInSubPlan('node-iron', 'Iron Smelting')
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('subplan')
  })

  it('creates a new child SubPlan containing the original node', () => {
    setupWithNode()
    useBlockStore.getState().wrapNodeInSubPlan('node-iron', 'Iron Smelting')
    const rootPlan = useBlockStore.getState().blocks[0].rootPlan
    expect(rootPlan.subPlans).toHaveLength(1)
    expect(rootPlan.subPlans[0].name).toBe('Iron Smelting')
    expect(rootPlan.subPlans[0].nodes[0].id).toBe('node-iron')
  })

  it('the SubPlanNode references the new child SubPlan', () => {
    setupWithNode()
    useBlockStore.getState().wrapNodeInSubPlan('node-iron', 'Iron Smelting')
    const rootPlan = useBlockStore.getState().blocks[0].rootPlan
    const spNode = rootPlan.nodes[0]
    if (spNode.kind === 'subplan') {
      expect(spNode.subPlanId).toBe(rootPlan.subPlans[0].id)
    } else {
      throw new Error('Expected subplan node')
    }
  })

  it('is a no-op for a non-existent nodeId', () => {
    setupWithNode()
    const before = useBlockStore.getState().blocks[0].rootPlan
    useBlockStore.getState().wrapNodeInSubPlan('nonexistent', 'Foo')
    const after = useBlockStore.getState().blocks[0].rootPlan
    expect(after).toBe(before)
  })

  it('is a no-op for a subplan-kind node', () => {
    const block = makeEmptyBlock('B')
    const spNode = { kind: 'subplan' as const, id: 'sp-node', subPlanId: 'sp-1' }
    const rootPlan = { ...block.rootPlan, nodes: [spNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    const before = useBlockStore.getState().blocks[0].rootPlan
    useBlockStore.getState().wrapNodeInSubPlan('sp-node', 'Foo')
    expect(useBlockStore.getState().blocks[0].rootPlan).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// isSubPlanDescendant
// ---------------------------------------------------------------------------

describe('isSubPlanDescendant', () => {
  it('returns true when candidate equals ancestor', () => {
    const root = makeEmptySubPlan('Root')
    expect(isSubPlanDescendant(root, root.id, root.id)).toBe(true)
  })

  it('returns true for a direct child', () => {
    const child = makeEmptySubPlan('Child')
    const root = { ...makeEmptySubPlan('Root'), subPlans: [child] }
    expect(isSubPlanDescendant(root, root.id, child.id)).toBe(true)
  })

  it('returns false for an unrelated subplan', () => {
    const child = makeEmptySubPlan('Child')
    const other = makeEmptySubPlan('Other')
    const root = { ...makeEmptySubPlan('Root'), subPlans: [child, other] }
    expect(isSubPlanDescendant(root, child.id, other.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// moveNode
// ---------------------------------------------------------------------------

describe('moveNode', () => {
  const nodeA: RecipeNode = { kind: 'game-recipe', id: 'node-a', recipeId: 'iron-plate', modules: [], byproductPolicy: {} }
  const nodeB: RecipeNode = { kind: 'game-recipe', id: 'node-b', recipeId: 'copper-plate', modules: [], byproductPolicy: {} }
  const nodeC: RecipeNode = { kind: 'game-recipe', id: 'node-c', recipeId: 'steel-plate', modules: [], byproductPolicy: {} }

  it('reorders forward within the same subplan', () => {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, nodeB, nodeC] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-a', rootPlan.id, 2)
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes.map(n => n.id)).toEqual(['node-b', 'node-a', 'node-c'])
  })

  it('reorders backward within the same subplan', () => {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, nodeB, nodeC] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-c', rootPlan.id, 0)
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes.map(n => n.id)).toEqual(['node-c', 'node-a', 'node-b'])
  })

  it('moves a recipe from root into a subgroup', () => {
    const child = { ...makeEmptySubPlan('Sub'), nodes: [nodeB] }
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node', subPlanId: child.id }
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, spNode], subPlans: [child] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-a', child.id, 1)

    const state = useBlockStore.getState().blocks[0].rootPlan
    expect(state.nodes.map(n => n.id)).toEqual(['sp-node'])
    const childState = state.subPlans[0]
    expect(childState.nodes.map(n => n.id)).toEqual(['node-b', 'node-a'])
  })

  it('moves a recipe from a subgroup back to root', () => {
    const child = { ...makeEmptySubPlan('Sub'), nodes: [nodeB] }
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node', subPlanId: child.id }
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, spNode], subPlans: [child] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-b', rootPlan.id, 0)

    const state = useBlockStore.getState().blocks[0].rootPlan
    expect(state.nodes.map(n => n.id)).toEqual(['node-b', 'node-a', 'sp-node'])
    expect(state.subPlans[0].nodes).toHaveLength(0)
  })

  it('undo/redo round-trip restores prior order', () => {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, nodeB, nodeC] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-a', rootPlan.id, 2)
    useBlockStore.getState().undo()
    const afterUndo = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(afterUndo.map(n => n.id)).toEqual(['node-a', 'node-b', 'node-c'])

    useBlockStore.getState().redo()
    const afterRedo = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(afterRedo.map(n => n.id)).toEqual(['node-b', 'node-a', 'node-c'])
  })

  it('cycle guard: moving a subplan into its own subtree is a no-op', () => {
    const child = { ...makeEmptySubPlan('Child') }
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node', subPlanId: child.id }
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, spNode], subPlans: [child] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    const before = useBlockStore.getState().blocks[0].rootPlan
    useBlockStore.getState().moveNode('sp-node', child.id, 0)
    expect(useBlockStore.getState().blocks[0].rootPlan).toBe(before)
  })

  it('trivial no-op does not push to history', () => {
    const block = makeEmptyBlock('B')
    const rootPlan = { ...block.rootPlan, nodes: [nodeA, nodeB] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })

    useBlockStore.getState().moveNode('node-a', rootPlan.id, 0)
    const hist = useBlockStore.getState().history[block.id]
    expect(hist?.undoStack ?? []).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// toggleNoImportItem
// ---------------------------------------------------------------------------

describe('toggleNoImportItem', () => {
  it('adds an item to block-level noImportItems on first call', () => {
    useBlockStore.getState().toggleNoImportItem('benzene')
    expect(useBlockStore.getState().blocks[0].noImportItems).toEqual(['benzene'])
  })

  it('removes the item on a second call (toggle)', () => {
    const t = useBlockStore.getState().toggleNoImportItem
    t('benzene')
    t('benzene')
    expect(useBlockStore.getState().blocks[0].noImportItems).toEqual([])
  })

  it('keeps existing items when adding a new one', () => {
    const t = useBlockStore.getState().toggleNoImportItem
    t('benzene')
    t('oxygen')
    expect(useBlockStore.getState().blocks[0].noImportItems.slice().sort())
      .toEqual(['benzene', 'oxygen'])
  })

  it('undo restores previous noImportItems list', () => {
    const s = useBlockStore.getState()
    s.toggleNoImportItem('benzene')
    s.undo()
    expect(useBlockStore.getState().blocks[0].noImportItems).toEqual([])
  })
})
