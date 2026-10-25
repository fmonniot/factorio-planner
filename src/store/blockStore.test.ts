import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBlockStore,
  makeEmptyBlock,
  cloneBlock,
  clonePlan,
  makeEmptySubPlan,
  findSubPlan,
  isSubPlanDescendant,
  selectAppState,
} from './blockStore'
import type { AppState, Block, RecipeNode, SubPlanNode } from '../data/types'
import { BLOCK_PALETTE } from '../data/blockColors'

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
    horizonTechnologyIds: [],
    defaultMachineOverrides: {},
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

describe('renameSubPlan', () => {
  function setupNested() {
    const inner = makeEmptySubPlan('Inner')
    const outer = { ...makeEmptySubPlan('Outer'), subPlans: [inner] }
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = { ...block.rootPlan, subPlans: [outer] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    return { inner, outer }
  }

  it('renames a nested subplan in the active block', () => {
    const { inner } = setupNested()
    useBlockStore.getState().renameSubPlan(inner.id, 'Renamed')
    const outer = useBlockStore.getState().blocks[0].rootPlan.subPlans[0]
    expect(outer.name).toBe('Outer')
    expect(outer.subPlans[0].name).toBe('Renamed')
  })

  it('is a no-op for an unknown id', () => {
    setupNested()
    const before = structuredClone(useBlockStore.getState().blocks[0].rootPlan)
    useBlockStore.getState().renameSubPlan('missing', 'X')
    expect(useBlockStore.getState().blocks[0].rootPlan).toEqual(before)
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

// ---------------------------------------------------------------------------
// Input connections
// ---------------------------------------------------------------------------

describe('input connections', () => {
  let sourceId: string
  let activeId: string
  let thirdId: string
  const otherId = () => thirdId

  beforeEach(() => {
    const active = makeEmptyBlock('Consumer')
    const source = makeEmptyBlock('Source')
    const third = makeEmptyBlock('Other')
    sourceId = source.id
    activeId = active.id
    thirdId = third.id
    useBlockStore.setState({ blocks: [active, source, third], activeBlockId: active.id, history: {} })
  })

  const active = () => useBlockStore.getState().blocks.find(b => b.id === activeId)!

  it('makeEmptyBlock starts without connections', () => {
    expect(makeEmptyBlock('B').inputConnections).toEqual([])
  })

  it('addInputConnection appends a connection to the active block', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId)
    expect(active().inputConnections).toEqual([
      { id: expect.any(String), itemId: 'plate', fromBlockId: sourceId },
    ])
  })

  it.each([
    ['a duplicate', 'plate', () => sourceId, true],
    ['a self-connection', 'plate', () => activeId, false],
    ['an unknown source', 'plate', () => 'ghost', false],
  ])('ignores %s', (_name, itemId, from, connectFirst) => {
    if (connectFirst) useBlockStore.getState().addInputConnection('plate', sourceId)
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().addInputConnection(itemId, from())
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('accepts a connection that closes a loop', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId)
    useBlockStore.getState().setActiveBlock(sourceId)
    useBlockStore.getState().addInputConnection('gear', activeId)
    const source = useBlockStore.getState().blocks.find(b => b.id === sourceId)!
    expect(source.inputConnections).toEqual([{ id: expect.any(String), itemId: 'gear', fromBlockId: activeId }])
  })

  it('undo removes the connection and redo re-adds it with the same id', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId)
    const id = active().inputConnections[0].id
    useBlockStore.getState().undo()
    expect(active().inputConnections).toEqual([])
    useBlockStore.getState().redo()
    expect(active().inputConnections.map(c => c.id)).toEqual([id])
  })

  it('removeInputConnection removes it and undo restores it at its index', () => {
    const third = makeEmptyBlock('Third')
    useBlockStore.setState(s => ({ blocks: [...s.blocks, third] }))
    const s = useBlockStore.getState()
    s.addInputConnection('plate', sourceId)
    s.addInputConnection('plate', third.id)
    s.addInputConnection('gear', sourceId)
    const [first, second, last] = active().inputConnections

    useBlockStore.getState().removeInputConnection(second.id)
    expect(active().inputConnections.map(c => c.id)).toEqual([first.id, last.id])
    useBlockStore.getState().undo()
    expect(active().inputConnections.map(c => c.id)).toEqual([first.id, second.id, last.id])
  })

  it('undo of a removal still applies when the source now receives from the block', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId)
    store().removeInputConnection(active().inputConnections[0].id)
    store().setActiveBlock(sourceId)
    store().addInputConnection('gear', activeId)
    store().setActiveBlock(activeId)

    store().undo()
    expect(active().inputConnections.map(c => c.fromBlockId)).toEqual([sourceId])
    expect(store().history[activeId].undoStack).toHaveLength(1)
    expect(store().history[activeId].redoStack).toHaveLength(1)
  })

  it('redo of an add still applies when the source now receives from the block', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId)
    store().undo()
    store().setActiveBlock(sourceId)
    store().addInputConnection('gear', activeId)
    store().setActiveBlock(activeId)

    store().redo()
    expect(active().inputConnections.map(c => c.fromBlockId)).toEqual([sourceId])
    expect(store().history[activeId].redoStack).toHaveLength(0)
  })

  it('redo of an add is dropped when the source was deleted', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId)
    store().undo()
    useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== sourceId) }))
    store().redo()
    expect(active().inputConnections).toEqual([])
  })

  it('addInputConnection can target a block that is not active', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId, otherId())
    const other = useBlockStore.getState().blocks.find(b => b.id === otherId())!
    expect(other.inputConnections).toEqual([{ id: expect.any(String), itemId: 'plate', fromBlockId: sourceId }])
    expect(active().inputConnections).toEqual([])
    expect(useBlockStore.getState().activeBlockId).toBe(activeId)
    expect(useBlockStore.getState().history[otherId()].undoStack).toHaveLength(1)
  })

  describe('setConnectionMaxRate', () => {
    const store = () => useBlockStore.getState()
    const connect = () => {
      store().addInputConnection('plate', sourceId)
      return active().inputConnections[0].id
    }

    it('sets a limit, undo removes the key and redo restores it', () => {
      const id = connect()
      store().setConnectionMaxRate(id, 20)
      expect(active().inputConnections[0].maxRate).toBe(20)
      store().undo()
      expect(active().inputConnections[0]).toEqual({ id, itemId: 'plate', fromBlockId: sourceId })
      expect('maxRate' in active().inputConnections[0]).toBe(false)
      store().redo()
      expect(active().inputConnections[0].maxRate).toBe(20)
    })

    it('clearing a limit drops the key and undo restores the old value', () => {
      const id = connect()
      store().setConnectionMaxRate(id, 20)
      store().setConnectionMaxRate(id, undefined)
      expect('maxRate' in active().inputConnections[0]).toBe(false)
      store().undo()
      expect(active().inputConnections[0].maxRate).toBe(20)
    })

    it.each([0, -5, NaN, Infinity])('ignores %s', value => {
      const id = connect()
      const depth = store().history[activeId].undoStack.length
      store().setConnectionMaxRate(id, value)
      expect('maxRate' in active().inputConnections[0]).toBe(false)
      expect(store().history[activeId].undoStack).toHaveLength(depth)
    })

    it('is a no-op for the same value or an unknown connection', () => {
      const id = connect()
      store().setConnectionMaxRate(id, 20)
      const before = store().blocks
      store().setConnectionMaxRate(id, 20)
      store().setConnectionMaxRate('ghost', 5)
      expect(store().blocks).toBe(before)
    })

    it('can target a block that is not active and its undo lives there', () => {
      store().addInputConnection('plate', sourceId, otherId())
      const other = () => store().blocks.find(b => b.id === otherId())!
      const id = other().inputConnections[0].id
      store().setConnectionMaxRate(id, 15, otherId())
      expect(other().inputConnections[0].maxRate).toBe(15)
      expect(store().history[otherId()].undoStack).toHaveLength(2)
      store().undo()
      expect(other().inputConnections[0].maxRate).toBe(15)
      store().setActiveBlock(otherId())
      store().undo()
      expect(other().inputConnections[0].maxRate).toBeUndefined()
    })
  })

  describe('pull connections', () => {
    const store = () => useBlockStore.getState()
    const other = () => store().blocks.find(b => b.id === otherId())!

    it('addInputConnection with pull stores the flag and undo/redo restore it', () => {
      store().addInputConnection('plate', sourceId, undefined, true)
      expect(active().inputConnections).toEqual([{ id: expect.any(String), itemId: 'plate', fromBlockId: sourceId, pull: true }])
      store().undo()
      expect(active().inputConnections).toEqual([])
      store().redo()
      expect(active().inputConnections[0].pull).toBe(true)
    })

    it('setConnectionPull turns pulling on and off; undo and redo restore the key', () => {
      store().addInputConnection('plate', sourceId)
      const id = active().inputConnections[0].id
      store().setConnectionPull(id, true)
      expect(active().inputConnections[0].pull).toBe(true)
      store().undo()
      expect('pull' in active().inputConnections[0]).toBe(false)
      store().redo()
      store().setConnectionPull(id, false)
      expect('pull' in active().inputConnections[0]).toBe(false)
      store().undo()
      expect(active().inputConnections[0].pull).toBe(true)
    })

    it('setConnectionPull is a no-op when unchanged or for an unknown connection', () => {
      store().addInputConnection('plate', sourceId)
      const id = active().inputConnections[0].id
      const before = store().blocks
      store().setConnectionPull(id, false)
      store().setConnectionPull('ghost', true)
      expect(store().blocks).toBe(before)
    })

    it('rejects a pull that would close a cycle of pulls', () => {
      store().addInputConnection('gear', activeId, sourceId, true)
      const before = store().blocks
      store().addInputConnection('plate', sourceId, undefined, true)
      expect(store().blocks).toBe(before)
      // A push in the other direction is fine, but cannot be switched to pull.
      store().addInputConnection('plate', sourceId)
      const id = active().inputConnections[0].id
      store().setConnectionPull(id, true)
      expect('pull' in active().inputConnections[0]).toBe(false)
    })

    it('drops an undo that would turn a pull back on after it became a cycle', () => {
      store().addInputConnection('plate', sourceId, undefined, true)
      const id = active().inputConnections[0].id
      store().setConnectionPull(id, false)
      // Meanwhile the source starts pulling from the consumer.
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b =>
          b.id === sourceId ? { ...b, inputConnections: [{ id: 'back', itemId: 'gear', fromBlockId: activeId, pull: true as const }] } : b),
      }))
      store().undo()
      expect('pull' in active().inputConnections[0]).toBe(false)
      expect(store().history[activeId].redoStack).toHaveLength(0)
    })

    it('can target a block that is not active', () => {
      store().addInputConnection('plate', sourceId, otherId())
      store().setConnectionPull(other().inputConnections[0].id, true, otherId())
      expect(other().inputConnections[0].pull).toBe(true)
      expect(store().history[otherId()].undoStack).toHaveLength(2)
    })
  })

  it('addInputConnection ignores an unknown target block', () => {
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().addInputConnection('plate', sourceId, 'ghost')
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('removeInputConnection can target a block that is not active and its undo lives there', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId, otherId())
    const other = () => useBlockStore.getState().blocks.find(b => b.id === otherId())!
    useBlockStore.getState().removeInputConnection(other().inputConnections[0].id, otherId())
    expect(other().inputConnections).toEqual([])
    useBlockStore.getState().setActiveBlock(otherId())
    useBlockStore.getState().undo()
    expect(other().inputConnections).toHaveLength(1)
  })

  it('ignores a connection for a goal item of the target', () => {
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'plate', rate: 60 })
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().addInputConnection('plate', sourceId)
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('redo of an add is dropped when the item has since become a goal of the target', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId)
    store().undo()
    store().addGoal({ id: 'g1', itemId: 'plate', rate: 60 })
    store().undo()
    store().redo()
    expect(active().inputConnections).toEqual([])
  })

  it('undo of a removal is dropped when the item is a goal of the target', () => {
    const store = () => useBlockStore.getState()
    // A goal and a connection for the same item can coexist (addGoal does not drop the connection).
    store().addInputConnection('plate', sourceId)
    store().addGoal({ id: 'g1', itemId: 'plate', rate: 60 })
    store().removeInputConnection(active().inputConnections[0].id)
    expect(active().inputConnections).toEqual([])
    store().undo() // would re-add a connection for a goal item: dropped
    expect(active().inputConnections).toEqual([])
    expect(store().history[activeId].undoStack).toHaveLength(2)
    expect(store().history[activeId].redoStack).toHaveLength(0)
  })

  it('a connection edited on a non-active block is recorded in that block\'s history only', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId, otherId())
    expect(store().history[otherId()].undoStack).toHaveLength(1)
    expect(store().history[activeId]?.undoStack ?? []).toHaveLength(0)
    store().undo() // the active block has nothing to undo
    expect(store().blocks.find(b => b.id === otherId())!.inputConnections).toHaveLength(1)
  })

  it('removeInputConnection ignores an unknown id', () => {
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().removeInputConnection('nope')
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('removeBlock strips connections that read from the deleted block', () => {
    useBlockStore.getState().addInputConnection('plate', sourceId)
    useBlockStore.getState().removeBlock(sourceId)
    expect(active().inputConnections).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Research horizon
// ---------------------------------------------------------------------------

describe('setHorizonTechnologyIds', () => {
  it('de-duplicates and leaves blocks and history untouched', () => {
    const { blocks, history } = useBlockStore.getState()
    useBlockStore.getState().setHorizonTechnologyIds(['a', 'a', 'b'])
    const state = useBlockStore.getState()
    expect(state.horizonTechnologyIds).toEqual(['a', 'b'])
    expect(state.blocks).toBe(blocks)
    expect(state.history).toBe(history)
  })

  it('setAppState replaces the horizon', () => {
    const block = makeEmptyBlock('Other')
    useBlockStore.getState().setHorizonTechnologyIds(['a'])
    useBlockStore.getState().setAppState({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: ['b'], defaultMachineOverrides: {} })
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['b'])
  })

  it('selectAppState returns blocks, activeBlockId and the horizon', () => {
    useBlockStore.getState().setHorizonTechnologyIds(['a'])
    const state = useBlockStore.getState()
    expect(selectAppState(state)).toEqual({
      blocks: state.blocks,
      activeBlockId: state.activeBlockId,
      horizonTechnologyIds: ['a'],
      defaultMachineOverrides: {},
    })
  })
})

// ---------------------------------------------------------------------------
// duplicateBlock
// ---------------------------------------------------------------------------

describe('default machine overrides', () => {
  it('setDefaultMachine keeps the same state when the category already maps to that machine', () => {
    useBlockStore.getState().setDefaultMachine('crafting', 'asm-1')
    const before = useBlockStore.getState()
    useBlockStore.getState().setDefaultMachine('crafting', 'asm-1')
    expect(useBlockStore.getState()).toBe(before)
    expect(useBlockStore.getState().defaultMachineOverrides).toBe(before.defaultMachineOverrides)
  })

  it('setDefaultMachine stores a new object and leaves blocks and history alone', () => {
    const { blocks, history, defaultMachineOverrides: before } = useBlockStore.getState()
    useBlockStore.getState().setDefaultMachine('crafting', 'asm-1')
    useBlockStore.getState().setDefaultMachine('smelting', 'furnace-2')
    const state = useBlockStore.getState()
    expect(state.defaultMachineOverrides).toEqual({ crafting: 'asm-1', smelting: 'furnace-2' })
    expect(state.defaultMachineOverrides).not.toBe(before)
    expect(before).toEqual({})
    expect(state.blocks).toBe(blocks)
    expect(state.history).toBe(history)
  })

  it('resetDefaultMachines clears the overrides and is a no-op when there are none', () => {
    const empty = useBlockStore.getState().defaultMachineOverrides
    useBlockStore.getState().resetDefaultMachines()
    expect(useBlockStore.getState().defaultMachineOverrides, 'unchanged when empty').toBe(empty)
    useBlockStore.getState().setDefaultMachine('crafting', 'asm-1')
    useBlockStore.getState().resetDefaultMachines()
    expect(useBlockStore.getState().defaultMachineOverrides).toEqual({})
  })

  it('setAppState and selectAppState round-trip the overrides', () => {
    const block = makeEmptyBlock('Other')
    useBlockStore.getState().setAppState({
      blocks: [block],
      activeBlockId: block.id,
      horizonTechnologyIds: [],
      defaultMachineOverrides: { crafting: 'asm-2' },
    })
    expect(useBlockStore.getState().defaultMachineOverrides).toEqual({ crafting: 'asm-2' })
    expect(selectAppState(useBlockStore.getState()).defaultMachineOverrides).toEqual({ crafting: 'asm-2' })
  })
})

describe('clonePlan', () => {
  function makePlan(): AppState {
    const a = makeEmptyBlock('A', '#112233')
    a.goals = [{ id: 'goal-a', itemId: 'iron-plate', rate: 30 }]
    a.rootPlan.nodes = [{ ...ironNode, id: 'node-a' }]
    const b = makeEmptyBlock('B', '#445566')
    b.inputConnections = [{ id: 'conn-b', itemId: 'iron-plate', fromBlockId: a.id }]
    return { blocks: [a, b], activeBlockId: b.id, horizonTechnologyIds: ['tech-x'], defaultMachineOverrides: { crafting: 'asm' } }
  }

  function collectIds(plan: AppState): string[] {
    const ids: string[] = []
    const walk = (p: Block['rootPlan']) => {
      ids.push(p.id, ...p.nodes.map(n => n.id))
      p.subPlans.forEach(walk)
    }
    for (const b of plan.blocks) {
      ids.push(b.id, ...b.goals.map(g => g.id), ...b.inputConnections.map(c => c.id))
      walk(b.rootPlan)
    }
    return ids
  }

  it('gives every id a fresh, unique value', () => {
    const plan = makePlan()
    const copy = clonePlan(plan)
    const original = new Set(collectIds(plan))
    const fresh = collectIds(copy)
    expect(fresh.some(id => original.has(id))).toBe(false)
    expect(new Set(fresh).size).toBe(fresh.length)
  })

  it('copies a connection limit', () => {
    const plan = makePlan()
    plan.blocks[1].inputConnections[0].maxRate = 25
    expect(clonePlan(plan).blocks[1].inputConnections[0].maxRate).toBe(25)
  })

  it('remaps connections and the active block to the copies', () => {
    const copy = clonePlan(makePlan())
    expect(copy.blocks[1].inputConnections[0].fromBlockId).toBe(copy.blocks[0].id)
    expect(copy.activeBlockId).toBe(copy.blocks[1].id)
  })

  it('keeps names, colours and the horizon', () => {
    const copy = clonePlan(makePlan())
    expect(copy.blocks.map(b => b.name)).toEqual(['A', 'B'])
    expect(copy.blocks.map(b => b.color)).toEqual(['#112233', '#445566'])
    expect(copy.horizonTechnologyIds).toEqual(['tech-x'])
  })

  it('copies the default machine overrides into a new object', () => {
    const plan = makePlan()
    const copy = clonePlan(plan)
    expect(copy.defaultMachineOverrides).toEqual({ crafting: 'asm' })
    expect(copy.defaultMachineOverrides).not.toBe(plan.defaultMachineOverrides)
  })

  it('does not mutate its input', () => {
    const plan = makePlan()
    const before = structuredClone(plan)
    clonePlan(plan)
    expect(plan).toEqual(before)
  })
})

describe('moveBlock', () => {
  function seed() {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => makeEmptyBlock(n))
    const history = { [b.id]: { undoStack: [], redoStack: [] } }
    useBlockStore.setState({ blocks: [a, b, c, d], activeBlockId: b.id, history })
    return { a, b, c, d, history }
  }
  const names = () => useBlockStore.getState().blocks.map(b => b.name)

  it('moves a block forward, counting the index before removal', () => {
    const { a } = seed()
    useBlockStore.getState().moveBlock(a.id, 3)
    expect(names(), 'insert before D').toEqual(['B', 'C', 'A', 'D'])
  })

  it('moves a block to the end with index = length', () => {
    const { a } = seed()
    useBlockStore.getState().moveBlock(a.id, 4)
    expect(names()).toEqual(['B', 'C', 'D', 'A'])
  })

  it('moves a block backward', () => {
    const { d } = seed()
    useBlockStore.getState().moveBlock(d.id, 0)
    expect(names()).toEqual(['D', 'A', 'B', 'C'])
  })

  it('leaves the blocks array untouched for no-op moves and unknown ids', () => {
    const { b } = seed()
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().moveBlock(b.id, 1)
    expect(useBlockStore.getState().blocks, 'own index').toBe(before)
    useBlockStore.getState().moveBlock(b.id, 2)
    expect(useBlockStore.getState().blocks, 'just after itself').toBe(before)
    useBlockStore.getState().moveBlock('missing', 0)
    expect(useBlockStore.getState().blocks, 'unknown id').toBe(before)
  })

  it('clamps out-of-range indices', () => {
    const { a, d } = seed()
    useBlockStore.getState().moveBlock(a.id, 99)
    expect(names(), 'high').toEqual(['B', 'C', 'D', 'A'])
    useBlockStore.getState().moveBlock(d.id, -5)
    expect(names(), 'low').toEqual(['D', 'B', 'C', 'A'])
  })

  it('keeps the active block, the history and the block objects', () => {
    const { a, b, c, d, history } = seed()
    useBlockStore.getState().moveBlock(a.id, 3)
    const state = useBlockStore.getState()
    expect(state.activeBlockId).toBe(b.id)
    expect(state.history, 'history reference').toBe(history)
    expect(state.blocks[2], 'moved block').toBe(a)
    expect(state.blocks[0]).toBe(b)
    expect(state.blocks[1]).toBe(c)
    expect(state.blocks[3]).toBe(d)
  })
})

describe('duplicateBlock', () => {
  function makeRichBlock(): Block {
    const block = makeEmptyBlock('Source')
    const child = makeEmptySubPlan('Child')
    child.nodes = [{ ...ironNode, id: 'child-node' }]
    block.rootPlan.subPlans = [child]
    block.rootPlan.nodes = [
      { ...ironNode, id: 'root-node' },
      { kind: 'subplan', id: 'root-subplan-node', subPlanId: child.id },
    ]
    block.goals = [{ id: 'goal-1', itemId: 'iron-plate', rate: 30 }]
    return block
  }

  function collectIds(block: Block): string[] {
    const ids = [block.id, ...block.goals.map(g => g.id), ...block.inputConnections.map(c => c.id)]
    const walk = (p: Block['rootPlan']) => {
      ids.push(p.id, ...p.nodes.map(n => n.id))
      p.subPlans.forEach(walk)
    }
    walk(block.rootPlan)
    return ids
  }

  let original: Block
  let other: Block

  beforeEach(() => {
    original = makeRichBlock()
    other = makeEmptyBlock('Other')
    const trailing = makeEmptyBlock('Trailing')
    original.inputConnections = [{ id: 'conn-1', itemId: 'iron-plate', fromBlockId: other.id }]
    other.inputConnections = [{ id: 'conn-2', itemId: 'copper-plate', fromBlockId: original.id }]
    useBlockStore.setState({
      blocks: [original, other, trailing],
      activeBlockId: other.id,
      history: {},
    })
  })

  const blocks = () => useBlockStore.getState().blocks

  it('inserts the copy right after the original, activates it and names it', () => {
    const snapshot = structuredClone(original)
    useBlockStore.getState().duplicateBlock(original.id)
    const { activeBlockId } = useBlockStore.getState()
    expect(blocks().map(b => b.name)).toEqual(['Source', 'Source (copy)', 'Other', 'Trailing'])
    expect(activeBlockId).toBe(blocks()[1].id)
    expect(blocks()[0]).toEqual(snapshot)
  })

  it('keeps the structure but gives every entity a fresh id', () => {
    useBlockStore.getState().duplicateBlock(original.id)
    const copy = blocks()[1]
    const strip = (b: Block) => JSON.stringify(b, (k, v) => (k === 'id' || k === 'subPlanId' ? undefined : v))
    expect(strip({ ...copy, name: original.name, color: original.color })).toBe(strip(original))
    const originalIds = collectIds(original)
    const copyIds = collectIds(copy)
    expect(new Set([...originalIds, ...copyIds]).size).toBe(originalIds.length + copyIds.length)
  })

  it('points subplan nodes at the copied child sub-plan', () => {
    useBlockStore.getState().duplicateBlock(original.id)
    const copy = blocks()[1]
    const node = copy.rootPlan.nodes.find(n => n.kind === 'subplan')
    expect(node?.kind === 'subplan' && node.subPlanId).toBe(copy.rootPlan.subPlans[0].id)
    expect(copy.rootPlan.subPlans[0].id).not.toBe(original.rootPlan.subPlans[0].id)
  })

  it('copies a connection limit', () => {
    original.inputConnections[0].maxRate = 25
    useBlockStore.getState().duplicateBlock(original.id)
    expect(blocks()[1].inputConnections[0]).toMatchObject({ itemId: 'iron-plate', maxRate: 25 })
  })

  it('copies input connections but not connections reading from the original', () => {
    useBlockStore.getState().duplicateBlock(original.id)
    const copy = blocks()[1]
    expect(copy.inputConnections).toHaveLength(1)
    expect(copy.inputConnections[0]).toMatchObject({ itemId: 'iron-plate', fromBlockId: other.id })
    expect(copy.inputConnections[0].id).not.toBe('conn-1')
    expect(blocks().filter(b => b.inputConnections.some(c => c.fromBlockId === copy.id))).toHaveLength(0)
    expect(blocks()[2].inputConnections).toHaveLength(1)
  })

  it('does not share state with the original', () => {
    useBlockStore.getState().duplicateBlock(original.id)
    useBlockStore.getState().addGoal({ id: 'extra', itemId: 'copper-plate', rate: 5 })
    expect(blocks()[1].goals).toHaveLength(2)
    expect(blocks()[0].goals).toHaveLength(1)
  })

  it('is a no-op for an unknown block id', () => {
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().duplicateBlock('missing')
    expect(useBlockStore.getState().blocks).toBe(before)
    expect(useBlockStore.getState().activeBlockId).toBe(other.id)
  })
})

// ---------------------------------------------------------------------------
// block colours
// ---------------------------------------------------------------------------

describe('block colours', () => {
  const palette: readonly string[] = BLOCK_PALETTE

  it('gives an empty block a palette colour', () => {
    expect(palette).toContain(makeEmptyBlock('B').color)
  })

  it('addBlock takes the only unused palette colour', () => {
    const blocks = BLOCK_PALETTE.slice(0, 15).map((c, i) => makeEmptyBlock(`B${i}`, c))
    useBlockStore.setState({ blocks, activeBlockId: blocks[0].id, history: {} })
    useBlockStore.getState().addBlock()
    const added = useBlockStore.getState().blocks[15]
    expect(added.color).toBe(BLOCK_PALETTE[15])
  })

  it('duplicateBlock gives the copy a different colour from its source', () => {
    const only = makeEmptyBlock('Only')
    useBlockStore.setState({ blocks: [only], activeBlockId: only.id, history: {} })
    useBlockStore.getState().duplicateBlock(only.id)
    const [src, copy] = useBlockStore.getState().blocks
    expect(copy.color).not.toBe(src.color)
    expect(palette).toContain(copy.color)
  })

  it('duplicateBlock still differs from its source when every palette colour is used', () => {
    const blocks = BLOCK_PALETTE.map((c, i) => makeEmptyBlock(`B${i}`, c))
    useBlockStore.setState({ blocks, activeBlockId: blocks[0].id, history: {} })
    useBlockStore.getState().duplicateBlock(blocks[0].id)
    expect(useBlockStore.getState().blocks[1].color).not.toBe(blocks[0].color)
  })

  it('cloneBlock sets the colour it is given', () => {
    expect(cloneBlock(makeEmptyBlock('B'), '#123456').color).toBe('#123456')
  })

  describe('setBlockColor', () => {
    function seed() {
      const a = makeEmptyBlock('A', '#60a5fa')
      const b = makeEmptyBlock('B', '#f472b6')
      useBlockStore.setState({ blocks: [a, b], activeBlockId: a.id, history: {} })
      return { a, b }
    }

    it('sets the colour of the target block only', () => {
      const { a, b } = seed()
      useBlockStore.getState().setBlockColor(b.id, '#a3e635')
      const [first, second] = useBlockStore.getState().blocks
      expect(first.color).toBe(a.color)
      expect(second.color).toBe('#a3e635')
    })

    it('lower-cases its input', () => {
      const { b } = seed()
      useBlockStore.getState().setBlockColor(b.id, '#ABCDEF')
      expect(useBlockStore.getState().blocks[1].color).toBe('#abcdef')
    })

    it('keeps the blocks array untouched when the colour is unchanged', () => {
      const { b } = seed()
      const before = useBlockStore.getState().blocks
      useBlockStore.getState().setBlockColor(b.id, '#F472B6')
      expect(useBlockStore.getState().blocks).toBe(before)
    })

    it('ignores an invalid colour or an unknown block', () => {
      const { a, b } = seed()
      const before = useBlockStore.getState().blocks
      useBlockStore.getState().setBlockColor(b.id, 'red')
      useBlockStore.getState().setBlockColor(b.id, '#12345')
      useBlockStore.getState().setBlockColor('missing', '#a3e635')
      expect(useBlockStore.getState().blocks.map(x => x.color)).toEqual(before.map(x => x.color))
      expect(useBlockStore.getState().blocks[0].id).toBe(a.id)
    })
  })
})
