import { describe, it, expect, beforeEach, vi } from 'vitest'
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
import type { AppState, BeaconConfig, Block, GameRecipeNode, RecipeNode, SubPlan, SubPlanNode } from '../data/types'
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

describe('removeSubPlan', () => {
  function recipe(id: string): RecipeNode {
    return { ...ironNode, id }
  }
  function handleFor(id: string, subPlanId: string): SubPlanNode {
    return { kind: 'subplan', id, subPlanId }
  }

  /** Root holds [r-before, handle(a), handle(target), r-after] with sub-plans [a, target];
   *  target holds a recipe and a nested sub-plan. */
  function setup() {
    const nested = makeEmptySubPlan('Nested')
    const target = { ...makeEmptySubPlan('Target'), nodes: [recipe('t-node'), handleFor('h-nested', nested.id)], subPlans: [nested] }
    const sibling = makeEmptySubPlan('Sibling')
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = {
      ...block.rootPlan,
      nodes: [recipe('r-before'), handleFor('h-sibling', sibling.id), handleFor('h-target', target.id), recipe('r-after')],
      subPlans: [sibling, target],
    }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    return { nested, target, sibling, blockId: block.id }
  }
  const root = () => useBlockStore.getState().blocks[0].rootPlan
  const stripTimes = (p: import('../data/types').SubPlan): unknown => ({
    ...p,
    updatedAt: undefined,
    subPlans: p.subPlans.map(stripTimes),
  })

  it('removes the sub-plan and its handle from the parent', () => {
    const { target } = setup()
    useBlockStore.getState().removeSubPlan(target.id)
    expect(root().subPlans.map(sp => sp.name)).toEqual(['Sibling'])
    expect(root().nodes.map(n => n.id)).toEqual(['r-before', 'h-sibling', 'r-after'])
  })

  it('undo restores the same objects at their original positions', () => {
    const { target, sibling } = setup()
    const handle = root().nodes[2]
    const before = structuredClone(target)
    useBlockStore.getState().removeSubPlan(target.id)
    useBlockStore.getState().undo()
    expect(root().subPlans[0]).toEqual(sibling)
    expect(root().subPlans[1]).toBe(target)
    expect(root().nodes[2]).toBe(handle)
    expect(root().nodes.map(n => n.id)).toEqual(['r-before', 'h-sibling', 'h-target', 'r-after'])
    expect(root().subPlans[1]).toEqual(before)
  })

  it('redo removes it again, and a new command clears the redo stack', () => {
    const { target, blockId } = setup()
    useBlockStore.getState().removeSubPlan(target.id)
    useBlockStore.getState().undo()
    useBlockStore.getState().redo()
    expect(root().subPlans.map(sp => sp.id)).not.toContain(target.id)
    expect(root().nodes.map(n => n.id)).toEqual(['r-before', 'h-sibling', 'r-after'])

    useBlockStore.getState().undo()
    expect(useBlockStore.getState().history[blockId].redoStack).toHaveLength(1)
    useBlockStore.getState().addNode(recipe('new'))
    expect(useBlockStore.getState().history[blockId].redoStack).toHaveLength(0)
  })

  it('is a no-op for the root plan id or an unknown id', () => {
    setup()
    const before = structuredClone(root())
    useBlockStore.getState().removeSubPlan(root().id)
    useBlockStore.getState().removeSubPlan('missing')
    expect(root()).toEqual(before)
    expect(useBlockStore.getState().history).toEqual({})
  })

  it('drops the command on undo when a sub-plan with the same id was added back', () => {
    const { target, blockId } = setup()
    useBlockStore.getState().removeSubPlan(target.id)
    const impostor = { ...makeEmptySubPlan('Impostor'), id: target.id }
    const rp = root()
    useBlockStore.setState({
      blocks: [{ ...useBlockStore.getState().blocks[0], rootPlan: { ...rp, subPlans: [...rp.subPlans, impostor] } }],
    })
    const before = structuredClone(root())
    useBlockStore.getState().undo()
    expect(root()).toEqual(before)
    expect(useBlockStore.getState().history[blockId].undoStack).toHaveLength(0)
    expect(useBlockStore.getState().history[blockId].redoStack).toHaveLength(0)
  })

  it('undo after redo restores edits made to the subtree while the removal was undone', () => {
    const { target } = setup()
    useBlockStore.getState().removeSubPlan(target.id)
    useBlockStore.getState().undo()
    useBlockStore.getState().renameSubPlan(target.id, 'Renamed')
    useBlockStore.getState().addSubPlan(target.id, 'Added')
    useBlockStore.getState().redo()
    expect(root().subPlans.map(sp => sp.id)).not.toContain(target.id)
    useBlockStore.getState().undo()
    const restored = findSubPlan(root(), target.id)!
    expect(restored.name).toBe('Renamed')
    expect(restored.subPlans.map(sp => sp.name)).toEqual(['Nested', 'Added'])
    expect(restored.nodes).toHaveLength(3)
  })

  it('undoes nested removals in order (inner then outer)', () => {
    const { nested, target } = setup()
    const original = stripTimes(structuredClone(root()))
    useBlockStore.getState().removeSubPlan(nested.id)
    useBlockStore.getState().removeSubPlan(target.id)
    useBlockStore.getState().undo()
    useBlockStore.getState().undo()
    expect(stripTimes(root())).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// moveNodeUp / moveNodeDown
// ---------------------------------------------------------------------------

describe('setSubPlanArea', () => {
  function setup() {
    const target = makeEmptySubPlan('Target')
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = {
      ...block.rootPlan,
      nodes: [{ kind: 'subplan' as const, id: 'h-target', subPlanId: target.id }],
      subPlans: [target],
    }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    return { target, blockId: block.id }
  }
  const plan = (id: string) => findSubPlan(useBlockStore.getState().blocks[0].rootPlan, id)!
  const stack = (blockId: string) => useBlockStore.getState().history[blockId]

  it('on sets area: true and touches updatedAt', () => {
    const { target } = setup()
    const before = plan(target.id).updatedAt
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'))
    try {
      useBlockStore.getState().setSubPlanArea(target.id, true)
    } finally {
      vi.useRealTimers()
    }
    expect(plan(target.id).area).toBe(true)
    expect(plan(target.id).updatedAt).not.toBe(before)
  })

  it('off removes the key', () => {
    const { target } = setup()
    useBlockStore.getState().setSubPlanArea(target.id, true)
    useBlockStore.getState().setSubPlanArea(target.id, false)
    expect('area' in plan(target.id)).toBe(false)
  })

  it('undo restores the absent key and redo sets it again', () => {
    const { target } = setup()
    useBlockStore.getState().setSubPlanArea(target.id, true)
    useBlockStore.getState().undo()
    expect('area' in plan(target.id)).toBe(false)
    useBlockStore.getState().redo()
    expect(plan(target.id).area).toBe(true)
  })

  it('a new command clears the redo stack', () => {
    const { target, blockId } = setup()
    useBlockStore.getState().setSubPlanArea(target.id, true)
    useBlockStore.getState().undo()
    expect(stack(blockId).redoStack).toHaveLength(1)
    useBlockStore.getState().setSubPlanArea(target.id, true)
    expect(stack(blockId).redoStack).toHaveLength(0)
  })

  it('a no-op leaves the undo stack alone', () => {
    const { target, blockId } = setup()
    useBlockStore.getState().setSubPlanArea(target.id, false)
    expect(stack(blockId)).toBeUndefined()
    useBlockStore.getState().setSubPlanArea(target.id, true)
    useBlockStore.getState().setSubPlanArea(target.id, true)
    expect(stack(blockId).undoStack).toHaveLength(1)
  })

  it('ignores the root plan and unknown ids', () => {
    setup()
    const rootId = useBlockStore.getState().blocks[0].rootPlan.id
    useBlockStore.getState().setSubPlanArea(rootId, true)
    useBlockStore.getState().setSubPlanArea('missing', true)
    expect('area' in useBlockStore.getState().blocks[0].rootPlan).toBe(false)
    expect(useBlockStore.getState().history).toEqual({})
  })

  it('drops the command on undo when the sub-plan was removed meanwhile', () => {
    const { target, blockId } = setup()
    useBlockStore.getState().setSubPlanArea(target.id, true)
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [], subPlans: [] } }] })
    const before = structuredClone(useBlockStore.getState().blocks)
    useBlockStore.getState().undo()
    expect(useBlockStore.getState().blocks).toEqual(before)
    expect(stack(blockId).undoStack).toHaveLength(0)
  })
})

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

describe('toggleConnectionsFirstItem', () => {
  const store = () => useBlockStore.getState()
  const first = (i = 0) => store().blocks[i].connectionsFirstItems

  it('adds, then removes, an item', () => {
    store().toggleConnectionsFirstItem('plate')
    expect(first()).toEqual(['plate'])
    store().toggleConnectionsFirstItem('plate')
    expect(first()).toEqual([])
  })

  it('undoes and redoes', () => {
    store().toggleConnectionsFirstItem('plate')
    store().undo()
    expect(first()).toEqual([])
    store().redo()
    expect(first()).toEqual(['plate'])
  })

  it('changes only the active block', () => {
    const other = makeEmptyBlock('Other')
    useBlockStore.setState({ blocks: [...store().blocks, other] })
    store().toggleConnectionsFirstItem('plate')
    expect(first(0)).toEqual(['plate'])
    expect(first(1)).toEqual([])
  })
})

describe('products', () => {
  const store = () => useBlockStore.getState()
  const products = () => store().blocks[0].products
  const plate = { id: 'p1', itemId: 'iron-plate', extraRate: 60 }

  it('addProduct appends, undo removes, redo re-adds', () => {
    store().addProduct(plate)
    expect(products()).toEqual([plate])
    store().undo()
    expect(products()).toEqual([])
    store().redo()
    expect(products()).toEqual([plate])
  })

  it('removeProduct removes and undo restores the old index', () => {
    store().addProduct(plate)
    store().addProduct({ id: 'p2', itemId: 'gear', extraRate: 5 })
    store().removeProduct('p1')
    expect(products().map(p => p.id)).toEqual(['p2'])
    store().undo()
    expect(products().map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('removing then undoing a product that another block requests leaves that block identical', () => {
    const consumer = { ...makeEmptyBlock('T'), inputConnections: [{ id: 'c', itemId: 'iron-plate', fromBlockId: store().blocks[0].id }] }
    useBlockStore.setState(st => ({ blocks: [...st.blocks, consumer] }))
    store().addProduct(plate)
    const before = store().blocks[1]
    store().removeProduct('p1')
    store().undo()
    expect(store().blocks[1]).toBe(before)
  })

  it('updateProductExtra sets extraRate and undo restores the old value', () => {
    store().addProduct(plate)
    store().updateProductExtra('p1', 20)
    expect(products()[0].extraRate).toBe(20)
    store().undo()
    expect(products()[0].extraRate).toBe(60)
  })

  it('updateProductExtra(undefined) clears the key; undo restores it and redo clears it again', () => {
    store().addProduct(plate)
    store().updateProductExtra('p1', undefined)
    expect('extraRate' in products()[0]).toBe(false)
    store().undo()
    expect(products()[0].extraRate).toBe(60)
    store().redo()
    expect('extraRate' in products()[0]).toBe(false)
  })

  it('sets an extra on a product added without one, and undo removes the key again', () => {
    store().addProduct({ id: 'p1', itemId: 'iron-plate' })
    store().updateProductExtra('p1', 20)
    expect(products()[0].extraRate).toBe(20)
    store().undo()
    expect('extraRate' in products()[0]).toBe(false)
  })

  it.each([0, -1, NaN, Infinity])('updateProductExtra ignores %s with no history entry', value => {
    store().addProduct(plate)
    const before = store().blocks
    const depth = store().history[before[0].id].undoStack.length
    store().updateProductExtra('p1', value)
    expect(store().blocks, 'blocks unchanged').toBe(before)
    expect(store().history[before[0].id].undoStack).toHaveLength(depth)
  })

  it('updateProductExtra ignores an unchanged value with no history entry', () => {
    store().addProduct(plate)
    const before = store().blocks
    const depth = store().history[before[0].id].undoStack.length
    store().updateProductExtra('p1', 60)
    expect(store().blocks).toBe(before)
    expect(store().history[before[0].id].undoStack).toHaveLength(depth)
  })

  it('updateProductExtra ignores an unknown id', () => {
    store().addProduct(plate)
    const before = store().blocks
    store().updateProductExtra('nope', 20)
    expect(store().blocks, 'blocks unchanged').toBe(before)
  })

  it('duplicateBlock copies products with fresh ids and the same extraRate', () => {
    store().addProduct(plate)
    store().duplicateBlock(store().blocks[0].id)
    const [original, copy] = store().blocks
    expect(copy.products).toHaveLength(1)
    expect(copy.products[0].extraRate).toBe(60)
    expect(copy.products[0].itemId).toBe('iron-plate')
    expect(copy.products[0].id).not.toBe(original.products[0].id)
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

  describe('requests', () => {
    const store = () => useBlockStore.getState()
    /** Give a block a product of `itemId` (no extra output). */
    const giveProduct = (blockId: string, itemId: string) =>
      useBlockStore.setState(st => ({
        blocks: st.blocks.map(b => (b.id === blockId ? { ...b, products: [...b.products, { id: `p-${itemId}`, itemId }] } : b)),
      }))

    beforeEach(() => {
      giveProduct(activeId, 'gear')
      giveProduct(sourceId, 'plate')
    })

    it('accepts a request that closes a cycle of requests', () => {
      // Source requests gear from the consumer; the consumer then requests plate from the source.
      store().addInputConnection('gear', activeId, sourceId)
      store().addInputConnection('plate', sourceId)
      expect(active().inputConnections).toEqual([{ id: expect.any(String), itemId: 'plate', fromBlockId: sourceId }])
    })

    it('redo re-applies a request that closes a cycle', () => {
      store().addInputConnection('gear', activeId, sourceId)
      store().addInputConnection('plate', sourceId)
      store().undo()
      expect(active().inputConnections).toEqual([])
      store().redo()
      expect(active().inputConnections).toEqual([{ id: expect.any(String), itemId: 'plate', fromBlockId: sourceId }])
    })

    it('undo of a removal re-adds a request that closes a cycle', () => {
      store().addInputConnection('gear', activeId, sourceId)
      store().addInputConnection('plate', sourceId)
      store().removeInputConnection(active().inputConnections[0].id)
      store().undo()
      expect(active().inputConnections).toEqual([{ id: expect.any(String), itemId: 'plate', fromBlockId: sourceId }])
    })
  })

  describe('addBlockForItem', () => {
    const store = () => useBlockStore.getState()

    it('appends a block named after the item, makes it active and requests the item from it', () => {
      const newId = store().addBlockForItem('plate', 'Iron plate')!
      const created = store().blocks[store().blocks.length - 1]
      expect(created.id).toBe(newId)
      expect(created.name).toBe('Iron plate')
      expect(created.products).toEqual([{ id: expect.any(String), itemId: 'plate' }])
      expect('extraRate' in created.products[0]).toBe(false)
      expect(created.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(store().activeBlockId).toBe(newId)
      expect(store().blocks.find(b => b.id === activeId)!.inputConnections).toEqual([
        { id: expect.any(String), itemId: 'plate', fromBlockId: newId },
      ])
    })

    it('does nothing when the consumer has the item as a product, or does not exist', () => {
      store().addProduct({ id: 'g1', itemId: 'plate', extraRate: 60 })
      const before = store().blocks
      expect(store().addBlockForItem('plate', 'Iron plate')).toBeUndefined()
      expect(store().blocks).toBe(before)
      expect(store().addBlockForItem('gear', 'Gear', 'ghost')).toBeUndefined()
      expect(store().blocks).toBe(before)
    })

    it('records the request in the consumer\'s history, not the new block\'s', () => {
      const newId = store().addBlockForItem('plate', 'Iron plate')!
      store().undo() // the new block is active and has nothing to undo
      expect(store().blocks.find(b => b.id === activeId)!.inputConnections).toHaveLength(1)
      store().setActiveBlock(activeId)
      const connectionId = active().inputConnections[0].id
      store().undo()
      expect(active().inputConnections).toEqual([])
      expect(store().blocks.some(b => b.id === newId)).toBe(true)
      store().redo()
      expect(active().inputConnections).toEqual([{ id: connectionId, itemId: 'plate', fromBlockId: newId }])
    })

    it('drops the redo once the new block is gone', () => {
      const newId = store().addBlockForItem('plate', 'Iron plate')!
      store().setActiveBlock(activeId)
      store().undo()
      store().removeBlock(newId)
      store().redo()
      expect(active().inputConnections).toEqual([])
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
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'plate', extraRate: 60 })
    const before = useBlockStore.getState().blocks
    useBlockStore.getState().addInputConnection('plate', sourceId)
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('redo of an add is dropped when the item has since become a goal of the target', () => {
    const store = () => useBlockStore.getState()
    store().addInputConnection('plate', sourceId)
    store().undo()
    store().addProduct({ id: 'g1', itemId: 'plate', extraRate: 60 })
    store().undo()
    store().redo()
    expect(active().inputConnections).toEqual([])
  })

  it('undo of a removal is dropped when the item is a goal of the target', () => {
    const store = () => useBlockStore.getState()
    // A goal and a connection for the same item can coexist (addProduct does not drop the connection).
    store().addInputConnection('plate', sourceId)
    store().addProduct({ id: 'g1', itemId: 'plate', extraRate: 60 })
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
    a.products = [{ id: 'goal-a', itemId: 'iron-plate', extraRate: 30 }]
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
      ids.push(b.id, ...b.products.map(p => p.id), ...b.inputConnections.map(c => c.id))
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
    block.products = [{ id: 'goal-1', itemId: 'iron-plate', extraRate: 30 }]
    return block
  }

  function collectIds(block: Block): string[] {
    const ids = [block.id, ...block.products.map(p => p.id), ...block.inputConnections.map(c => c.id)]
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

  it('copies connectionsFirstItems', () => {
    useBlockStore.setState({
      blocks: blocks().map(b => (b.id === original.id ? { ...b, connectionsFirstItems: ['plate'] } : b)),
    })
    useBlockStore.getState().duplicateBlock(original.id)
    expect(blocks()[1].connectionsFirstItems).toEqual(['plate'])
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
    useBlockStore.getState().addProduct({ id: 'extra', itemId: 'copper-plate', extraRate: 5 })
    expect(blocks()[1].products).toHaveLength(2)
    expect(blocks()[0].products).toHaveLength(1)
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

// ---------------------------------------------------------------------------
// Row conveniences across areas
// ---------------------------------------------------------------------------

function gameRow(id: string, recipeId: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {}, ...extra }
}

function planOf(id: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  return { ...makeEmptySubPlan(id), id, nodes, subPlans, ...(area === undefined ? {} : { area }) }
}

function handleOf(sp: SubPlan): SubPlanNode {
  return { kind: 'subplan', id: `h-${sp.id}`, subPlanId: sp.id }
}

/** Puts `rootPlan` (id 'root') into the store as the only, active block. */
function loadRoot(rootPlan: SubPlan): string {
  const block = makeEmptyBlock('Test Block')
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    history: {},
  })
  return block.id
}

const treePlan = (id: string) => findSubPlan(useBlockStore.getState().blocks[0].rootPlan, id)!
const rowIn = (planId: string, nodeId: string) => treePlan(planId).nodes.find(n => n.id === nodeId) as GameRecipeNode

describe('buildRowAlsoIn', () => {
  const beacon: BeaconConfig = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
  function setup(): string {
    const src = gameRow('src', 'electrolysis', {
      machineId: 'm2',
      modules: [{ moduleId: 'speed', count: 2 }],
      beaconConfig: { ...beacon },
      pinnedRate: 10,
      byproductPolicy: { oxygen: 'discard' },
      primaryProduct: 'hydrogen',
      byproductConsumer: true,
    })
    const g = planOf('G', [gameRow('g1', 'iron-plate')])
    const a = planOf('A', [handleOf(g)], [g], true)
    const b = planOf('B', [])
    return loadRoot(planOf('root', [src, handleOf(a), handleOf(b)], [a, b]))
  }

  it('appends a copy without the pin nor the byproduct-consumer flag', () => {
    setup()
    const id = useBlockStore.getState().buildRowAlsoIn('src', 'A')
    expect(id).toBeDefined()
    const a = treePlan('A')
    const copy = a.nodes[a.nodes.length - 1] as GameRecipeNode
    expect(copy).toEqual({
      kind: 'game-recipe',
      id,
      recipeId: 'electrolysis',
      machineId: 'm2',
      modules: [{ moduleId: 'speed', count: 2 }],
      beaconConfig: beacon,
      byproductPolicy: { oxygen: 'discard' },
      primaryProduct: 'hydrogen',
    })
    expect('pinnedRate' in copy, 'pin is not copied').toBe(false)
    expect('byproductConsumer' in copy, 'consumer flag is not copied').toBe(false)
    expect(copy.modules).not.toBe(rowIn('root', 'src').modules)
  })

  it('undoes and redoes with the same id', () => {
    const blockId = setup()
    const id = useBlockStore.getState().buildRowAlsoIn('src', 'A')!
    useBlockStore.getState().undo()
    expect(treePlan('A').nodes.some(n => n.id === id)).toBe(false)
    useBlockStore.getState().redo()
    expect(treePlan('A').nodes.some(n => n.id === id)).toBe(true)
    expect(useBlockStore.getState().history[blockId].undoStack).toHaveLength(1)
  })

  it('changes nothing for a non-area, a duplicate, the row\'s own area or an unknown row', () => {
    setup()
    const store = useBlockStore.getState()
    expect(store.buildRowAlsoIn('src', 'B')).toBeUndefined()
    expect(store.buildRowAlsoIn('src', 'root')).toBeUndefined()
    expect(store.buildRowAlsoIn('nope', 'A')).toBeUndefined()
    // A's organising group G gets a row of the recipe: A already has it.
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => ({
        ...b,
        rootPlan: {
          ...b.rootPlan,
          subPlans: b.rootPlan.subPlans.map(sp => sp.id !== 'A' ? sp : {
            ...sp,
            subPlans: sp.subPlans.map(g => ({ ...g, nodes: [...g.nodes, gameRow('dup', 'electrolysis')] })),
          }),
        },
      })),
    }))
    expect(useBlockStore.getState().buildRowAlsoIn('src', 'A')).toBeUndefined()
    expect(Object.keys(useBlockStore.getState().history)).toEqual([])
  })

  it('accepts the root as the target', () => {
    const a = planOf('A', [gameRow('a1', 'electrolysis')], [], true)
    loadRoot(planOf('root', [handleOf(a)], [a]))
    const id = useBlockStore.getState().buildRowAlsoIn('a1', 'root')
    expect(id).toBeDefined()
    expect(rowIn('root', id!).recipeId).toBe('electrolysis')
  })
})

describe('applyRowSettingsToRecipe', () => {
  function setup(): string {
    const r1 = gameRow('r1', 'plate', {
      machineId: 'm2',
      modules: [{ moduleId: 'speed', count: 1 }],
    })
    const x1 = gameRow('x1', 'plate-alt')
    const g = planOf('G', [gameRow('r3', 'plate')])
    const a = planOf('A', [gameRow('r2', 'plate', { machineId: 'm1' }), handleOf(g)], [g], true)
    const untouched = planOf('U', [gameRow('u1', 'other')])
    return loadRoot(planOf('root', [r1, x1, handleOf(a), handleOf(untouched)], [a, untouched]))
  }

  it('copies machine and modules to the other rows of the recipe, as one command', () => {
    const blockId = setup()
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    for (const [plan, id] of [['A', 'r2'], ['G', 'r3']]) {
      expect(rowIn(plan, id).machineId).toBe('m2')
      expect(rowIn(plan, id).modules).toEqual([{ moduleId: 'speed', count: 1 }])
    }
    expect(rowIn('root', 'x1').machineId, 'another recipe is untouched').toBeUndefined()
    expect(useBlockStore.getState().history[blockId].undoStack).toHaveLength(1)
  })

  it('undoes to each row\'s own settings and redoes', () => {
    setup()
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    useBlockStore.getState().undo()
    expect(rowIn('A', 'r2').machineId).toBe('m1')
    expect(rowIn('A', 'r2').modules).toEqual([])
    expect('machineId' in rowIn('G', 'r3')).toBe(false)
    useBlockStore.getState().redo()
    expect(rowIn('G', 'r3').machineId).toBe('m2')
  })

  it('removes the machine key when the source uses the default', () => {
    setup()
    useBlockStore.getState().applyRowSettingsToRecipe('r3', 'machine')
    expect('machineId' in rowIn('root', 'r1')).toBe(false)
    expect('machineId' in rowIn('A', 'r2')).toBe(false)
    expect(rowIn('root', 'r1').modules).toEqual([])
  })

  it('copies the beacon to rows without one, and undo removes it again', () => {
    setup()
    const beacon: BeaconConfig = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => ({
        ...b,
        rootPlan: { ...b.rootPlan, nodes: b.rootPlan.nodes.map(n => n.id === 'r1' ? { ...n, beaconConfig: beacon } as GameRecipeNode : n) },
      })),
    }))
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    expect(rowIn('A', 'r2').beaconConfig).toEqual(beacon)
    expect(rowIn('A', 'r2').machineId, 'machine is untouched').toBe('m1')
    useBlockStore.getState().undo()
    expect('beaconConfig' in rowIn('A', 'r2')).toBe(false)
  })

  it('does nothing when no other row exists or every row already matches', () => {
    const blockId = setup()
    useBlockStore.getState().applyRowSettingsToRecipe('x1', 'machine')
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    expect(useBlockStore.getState().history[blockId]).toBeUndefined()
  })

  it('treats beacon configs and modules with the same values in another key order as matching', () => {
    const blockId = setup()
    const beaconA = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    const beaconB = { distributionEfficiency: 0.5, modulesPerBeacon: 2, beaconCount: 2, moduleId: 'speed' }
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => ({
        ...b,
        rootPlan: {
          ...b.rootPlan,
          nodes: b.rootPlan.nodes.map(n => n.id === 'r1'
            ? { ...n, beaconConfig: beaconA, modules: [{ moduleId: 'speed', count: 1 }] } as GameRecipeNode
            : n),
          subPlans: b.rootPlan.subPlans.map(sp => sp.id !== 'A' ? sp : {
            ...sp,
            nodes: sp.nodes.map(n => n.id === 'r2'
              ? { ...n, machineId: 'm2', beaconConfig: beaconB, modules: [{ count: 1, moduleId: 'speed' }] } as GameRecipeNode
              : n),
            subPlans: sp.subPlans.map(g => ({
              ...g,
              nodes: g.nodes.map(n => ({ ...n, machineId: 'm2', beaconConfig: beaconB, modules: [{ count: 1, moduleId: 'speed' }] }) as GameRecipeNode),
            })),
          }),
        },
      })),
    }))
    const before = treePlan('A').updatedAt
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    expect(useBlockStore.getState().history[blockId]).toBeUndefined()
    expect(treePlan('A').updatedAt).toBe(before)
  })

  it('marks only the sub-plans whose rows changed as updated', () => {
    setup()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'))
    try {
      useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    } finally {
      vi.useRealTimers()
    }
    expect(treePlan('A').updatedAt).toBe('2099-01-01T00:00:00.000Z')
    expect(treePlan('G').updatedAt).toBe('2099-01-01T00:00:00.000Z')
    expect(treePlan('U').updatedAt).not.toBe('2099-01-01T00:00:00.000Z')
  })
})
