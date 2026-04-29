import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBlockStore,
  makeEmptyBlock,
  makeEmptySubPlan,
  findSubPlan,
} from './blockStore'
import type { BlockStoreState } from './blockStore'
import type { RecipeNode } from '../data/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): BlockStoreState {
  return useBlockStore.getState()
}

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
    activeSubPlanId: block.rootPlan.id,
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
      activeSubPlanId: rootPlan.id,
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
      activeSubPlanId: rootPlan.id,
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
      activeSubPlanId: rootPlan.id,
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
      activeSubPlanId: rootPlan.id,
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
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    const before = useBlockStore.getState().blocks[0].rootPlan
    useBlockStore.getState().wrapNodeInSubPlan('sp-node', 'Foo')
    expect(useBlockStore.getState().blocks[0].rootPlan).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// toggleNoImportItem
// ---------------------------------------------------------------------------

describe('toggleNoImportItem', () => {
  it('adds an item to noImportItems on first call', () => {
    useBlockStore.getState().toggleNoImportItem('benzene')
    const subPlanId = useBlockStore.getState().activeSubPlanId
    const block = useBlockStore.getState().blocks[0]
    const sub = findSubPlan(block.rootPlan, subPlanId)!
    expect(sub.noImportItems).toEqual(['benzene'])
  })

  it('removes the item on a second call (toggle)', () => {
    const t = useBlockStore.getState().toggleNoImportItem
    t('benzene')
    t('benzene')
    const subPlanId = useBlockStore.getState().activeSubPlanId
    const sub = findSubPlan(useBlockStore.getState().blocks[0].rootPlan, subPlanId)!
    expect(sub.noImportItems).toEqual([])
  })

  it('keeps existing items when adding a new one', () => {
    const t = useBlockStore.getState().toggleNoImportItem
    t('benzene')
    t('oxygen')
    const subPlanId = useBlockStore.getState().activeSubPlanId
    const sub = findSubPlan(useBlockStore.getState().blocks[0].rootPlan, subPlanId)!
    expect(sub.noImportItems.sort()).toEqual(['benzene', 'oxygen'])
  })

  it('undo restores previous noImportItems list', () => {
    const s = useBlockStore.getState()
    s.toggleNoImportItem('benzene')
    s.undo()
    const subPlanId = useBlockStore.getState().activeSubPlanId
    const sub = findSubPlan(useBlockStore.getState().blocks[0].rootPlan, subPlanId)!
    expect(sub.noImportItems).toEqual([])
  })
})
