import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  useBlockStore,
  makeEmptyBlock,
  cloneBlock,
  clonePlan,
  makeEmptySubPlan,
  isSubPlanDescendant,
  selectAppState,
} from './blockStore'
import { findSubPlan } from '../data/subPlanTree'
import type { AppState, BeaconConfig, Block, GameData, GameRecipeNode, RecipeNode, ServedEntry, SubPlan, SubPlanNode } from '../data/types'
import { BLOCK_PALETTE } from '../data/blockColors'
import { useGameDataStore } from './gameDataStore'
import { areaRecipeIds, blockAreas } from '../solver/areas'

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

/** Load game data whose items have these icon colours. Yellow gives #a3e635, the one palette colour near it; grey gives a random one. */
function loadIconColors(colors: Record<string, string | undefined>) {
  const items = Object.fromEntries(Object.entries(colors).map(([id, iconColor]) => [id, { id, name: id, iconPath: '', iconColor }]))
  useGameDataStore.setState({ status: { type: 'loaded', gameData: { items } as unknown as GameData, sourceId: 'test' } })
}

afterEach(() => {
  useGameDataStore.setState({ status: { type: 'empty' } })
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

  it('undo restores the old name and redo reapplies the new one', () => {
    const { inner } = setupNested()
    useBlockStore.getState().renameSubPlan(inner.id, 'Renamed')
    useBlockStore.getState().undo()
    expect(findSubPlan(useBlockStore.getState().blocks[0].rootPlan, inner.id)!.name).toBe('Inner')
    useBlockStore.getState().redo()
    expect(findSubPlan(useBlockStore.getState().blocks[0].rootPlan, inner.id)!.name).toBe('Renamed')
  })

  it('pushes no history entry when the name is unchanged', () => {
    const { inner } = setupNested()
    useBlockStore.getState().renameSubPlan(inner.id, 'Inner')
    expect(useBlockStore.getState().history).toEqual({})
  })
})

describe('addSubPlan', () => {
  const root = () => useBlockStore.getState().blocks[0].rootPlan
  const blockId = () => useBlockStore.getState().blocks[0].id

  function setupRoot() {
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [], subPlans: [] } }], activeBlockId: block.id, history: {} })
  }

  it('ignores an unknown parent without touching history', () => {
    setupRoot()
    useBlockStore.getState().addSubPlan('missing', 'Added')
    expect(root().subPlans).toHaveLength(0)
    expect(useBlockStore.getState().history[blockId()]).toBeUndefined()
  })

  it('undo removes the sub-plan and its handle, redo restores both with the same ids', () => {
    setupRoot()
    useBlockStore.getState().addSubPlan(root().id, 'Added')
    const added = root().subPlans[0]
    const handle = root().nodes[0]
    expect(useBlockStore.getState().history[blockId()].undoStack).toHaveLength(1)
    useBlockStore.getState().undo()
    expect(root().subPlans).toEqual([])
    expect(root().nodes).toEqual([])
    useBlockStore.getState().redo()
    expect(root().subPlans.map(sp => sp.id)).toEqual([added.id])
    expect(root().nodes).toEqual([handle])
  })

  it('redo keeps a rename made after the add', () => {
    setupRoot()
    useBlockStore.getState().addSubPlan(root().id, 'Added')
    const id = root().subPlans[0].id
    useBlockStore.getState().renameSubPlan(id, 'Renamed')
    useBlockStore.getState().undo()
    expect(findSubPlan(root(), id)!.name).toBe('Added')
    useBlockStore.getState().undo()
    expect(findSubPlan(root(), id)).toBeUndefined()
    useBlockStore.getState().redo()
    useBlockStore.getState().redo()
    expect(findSubPlan(root(), id)!.name).toBe('Renamed')
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
    // Edits that bypass history (like an import or a future non-undoable action), so the redo stack survives.
    const edited = { ...target, name: 'Renamed', subPlans: [...target.subPlans, makeEmptySubPlan('Added')], nodes: [...target.nodes, recipe('t-added')] }
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...root(), subPlans: root().subPlans.map(sp => (sp.id === target.id ? edited : sp)) } }],
    })
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

  it('undo restores the original node at its index and drops the sub-plan; redo wraps again', () => {
    const block = makeEmptyBlock('B')
    const before: RecipeNode = { ...ironNode, id: 'node-before' }
    const rootPlan = { ...block.rootPlan, nodes: [before, ironNode] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    useBlockStore.getState().wrapNodeInSubPlan('node-iron', 'Iron Smelting')
    const wrapped = useBlockStore.getState().blocks[0].rootPlan
    const subPlanId = wrapped.subPlans[0].id
    const handle = wrapped.nodes[1]
    useBlockStore.getState().undo()
    const restored = useBlockStore.getState().blocks[0].rootPlan
    expect(restored.nodes.map(n => n.id)).toEqual(['node-before', 'node-iron'])
    expect(restored.subPlans).toEqual([])
    useBlockStore.getState().redo()
    const again = useBlockStore.getState().blocks[0].rootPlan
    expect(again.nodes[1]).toEqual(handle)
    expect(again.subPlans.map(sp => sp.id)).toEqual([subPlanId])
    expect(again.subPlans[0].nodes.map(n => n.id)).toEqual(['node-iron'])
  })

  it('drops the undo when a node was added into the wrapper', () => {
    setupWithNode()
    useBlockStore.getState().wrapNodeInSubPlan('node-iron', 'Iron Smelting')
    const rootPlan = useBlockStore.getState().blocks[0].rootPlan
    const wrapper = rootPlan.subPlans[0]
    const extended = { ...wrapper, nodes: [...wrapper.nodes, { ...ironNode, id: 'node-extra' }] }
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...rootPlan, subPlans: [extended] } }] })
    const beforeUndo = structuredClone(useBlockStore.getState().blocks[0].rootPlan)
    useBlockStore.getState().undo()
    expect(useBlockStore.getState().blocks[0].rootPlan).toEqual(beforeUndo)
    expect(useBlockStore.getState().history[block.id].undoStack).toHaveLength(0)
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

  describe('moving a sub-factory handle', () => {
    // root: [handle(Top), handle(Bottom), node-a]; Top holds a handle to Group, which is stored under Top.
    function setup() {
      const group = { ...makeEmptySubPlan('Group'), nodes: [nodeB] }
      const top = { ...makeEmptySubPlan('Top'), nodes: [{ kind: 'subplan', id: 'h-group', subPlanId: group.id } as SubPlanNode], subPlans: [group], area: true }
      const bottom = { ...makeEmptySubPlan('Bottom'), area: true }
      const block = makeEmptyBlock('B')
      const rootPlan = {
        ...block.rootPlan,
        nodes: [
          { kind: 'subplan', id: 'h-top', subPlanId: top.id } as SubPlanNode,
          { kind: 'subplan', id: 'h-bottom', subPlanId: bottom.id } as SubPlanNode,
          nodeA,
        ],
        subPlans: [top, bottom],
      }
      useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
      return { group, top, bottom, rootPlan }
    }
    const rootOf = () => useBlockStore.getState().blocks[0].rootPlan
    const idsOf = (p: SubPlan) => p.subPlans.map(sp => sp.id)

    it('moves the sub-plan with its handle, so its rows belong to the new plan', () => {
      const { group, top, bottom } = setup()
      useBlockStore.getState().moveNode('h-group', bottom.id, 0)

      expect(idsOf(findSubPlan(rootOf(), top.id)!)).toEqual([])
      expect(findSubPlan(rootOf(), top.id)!.nodes).toEqual([])
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([group.id])
      expect(findSubPlan(rootOf(), bottom.id)!.nodes.map(n => n.id)).toEqual(['h-group'])
      expect(findSubPlan(rootOf(), group.id)!.nodes.map(n => n.id)).toEqual(['node-b'])
    })

    it('moves a sub-plan together with its own sub-plans', () => {
      const { group, top, bottom } = setup()
      useBlockStore.getState().moveNode('h-top', bottom.id, 0)

      expect(idsOf(rootOf())).toEqual([bottom.id])
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([top.id])
      expect(idsOf(findSubPlan(rootOf(), top.id)!)).toEqual([group.id])
    })

    it('puts the sub-plan back where it was on undo, and again on redo', () => {
      const { group, top, bottom, rootPlan } = setup()
      useBlockStore.getState().moveNode('h-group', bottom.id, 0)
      // An edit made to the sub-plan while it sits in its new place survives undo and redo.
      // Written straight to the state, so the move stays the last history entry.
      const renameInTree = (p: SubPlan): SubPlan => ({
        ...p,
        name: p.id === group.id ? 'Renamed' : p.name,
        subPlans: p.subPlans.map(renameInTree),
      })
      const current = useBlockStore.getState().blocks[0]
      useBlockStore.setState({ blocks: [{ ...current, rootPlan: renameInTree(current.rootPlan) }] })

      useBlockStore.getState().undo()
      expect(idsOf(findSubPlan(rootOf(), top.id)!)).toEqual([group.id])
      expect(findSubPlan(rootOf(), top.id)!.nodes.map(n => n.id)).toEqual(['h-group'])
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([])
      expect(findSubPlan(rootOf(), group.id)!.name).toBe('Renamed')
      expect(idsOf(rootOf())).toEqual(idsOf(rootPlan))

      useBlockStore.getState().redo()
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([group.id])
      expect(idsOf(findSubPlan(rootOf(), top.id)!)).toEqual([])
      expect(findSubPlan(rootOf(), group.id)!.name).toBe('Renamed')
    })

    it('does not store a sub-plan twice when the plan the handle moves into already stores it', () => {
      // Not a shape the loader leaves behind; a store built by hand can still have it: the handle is
      // in Top, the sub-plan is stored under Bottom.
      const { group, top, bottom } = setup()
      const block = useBlockStore.getState().blocks[0]
      const rootPlan = { ...block.rootPlan, subPlans: [{ ...top, subPlans: [] }, { ...bottom, subPlans: [group] }] }
      useBlockStore.setState({ blocks: [{ ...block, rootPlan }], history: {} })

      useBlockStore.getState().moveNode('h-group', bottom.id, 0)
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([group.id])
      expect(findSubPlan(rootOf(), bottom.id)!.nodes.map(n => n.id)).toEqual(['h-group'])
      expect(findSubPlan(rootOf(), top.id)!.nodes).toEqual([])

      useBlockStore.getState().undo()
      expect(idsOf(findSubPlan(rootOf(), bottom.id)!)).toEqual([group.id])
      expect(findSubPlan(rootOf(), top.id)!.nodes.map(n => n.id)).toEqual(['h-group'])
    })

    it('keeps the sub-plan in place when its handle only moves within its plan', () => {
      const { top, bottom } = setup()
      useBlockStore.getState().moveNode('h-top', rootOf().id, 3)
      expect(rootOf().nodes.map(n => n.id)).toEqual(['h-bottom', 'node-a', 'h-top'])
      expect(idsOf(rootOf())).toEqual([top.id, bottom.id])
    })

    it('keeps areas right: the moved sub-plan\'s rows join the area it was moved into', () => {
      const { bottom } = setup()
      useBlockStore.getState().moveNode('h-group', bottom.id, 0)
      const areas = blockAreas(rootOf())!
      expect(areas.map(a => [a.id === bottom.id ? 'bottom' : a.id === rootOf().id ? 'root' : 'top', a.nodeIds])).toEqual([
        ['root', ['node-a']],
        ['top', []],
        ['bottom', ['node-b']],
      ])
    })
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
// toggleImportOff
// ---------------------------------------------------------------------------

describe('toggleImportOff', () => {
  it('adds an item to block-level noImportItems on first call', () => {
    useBlockStore.getState().toggleImportOff('benzene')
    expect(useBlockStore.getState().blocks[0].sourceRules).toEqual({ 'benzene': { importOff: true } })
  })

  it('removes the item on a second call (toggle)', () => {
    const t = useBlockStore.getState().toggleImportOff
    t('benzene')
    t('benzene')
    expect(useBlockStore.getState().blocks[0].sourceRules).toEqual({})
  })

  it('keeps existing items when adding a new one', () => {
    const t = useBlockStore.getState().toggleImportOff
    t('benzene')
    t('oxygen')
    expect(Object.keys(useBlockStore.getState().blocks[0].sourceRules).sort())
      .toEqual(['benzene', 'oxygen'])
  })

  it('undo of a removal puts the rule back at its place in the map', () => {
    const t = useBlockStore.getState().toggleImportOff
    t('a'); t('b'); t('c')
    t('b') // Import back on: the entry goes
    expect(Object.keys(useBlockStore.getState().blocks[0].sourceRules)).toEqual(['a', 'c'])
    useBlockStore.getState().undo()
    expect(Object.keys(useBlockStore.getState().blocks[0].sourceRules)).toEqual(['a', 'b', 'c'])
  })

  it('treats names of Object.prototype as ordinary items', () => {
    useBlockStore.getState().toggleImportOff('toString')
    expect(useBlockStore.getState().blocks[0].sourceRules).toEqual({ toString: { importOff: true } })
  })

  it('undo restores the previous rules', () => {
    const s = useBlockStore.getState()
    s.toggleImportOff('benzene')
    s.undo()
    expect(useBlockStore.getState().blocks[0].sourceRules).toEqual({})
  })
})

describe('setItemSourcing', () => {
  const store = () => useBlockStore.getState()
  const sourcing = (i = 0) => Object.fromEntries(Object.entries(store().blocks[i].sourceRules).map(([id, r]) => [id, r.makeHere === 'after-blocks' ? 'connections-first' : 'byproducts-first']))

  it('sets, switches and clears a mode', () => {
    store().setMakeHere('plate', 'off')
    expect(sourcing()).toEqual({ plate: 'byproducts-first' })
    store().setMakeHere('plate', 'after-blocks')
    expect(sourcing()).toEqual({ plate: 'connections-first' })
    store().setMakeHere('plate', undefined)
    expect(Object.keys(sourcing())).toEqual([])
  })

  it('undoes and redoes', () => {
    store().setMakeHere('plate', 'off')
    store().setMakeHere('plate', 'after-blocks')
    store().undo()
    expect(sourcing()).toEqual({ plate: 'byproducts-first' })
    store().undo()
    expect(Object.keys(sourcing())).toEqual([])
    store().redo()
    store().redo()
    expect(sourcing()).toEqual({ plate: 'connections-first' })
  })

  it('is a no-op when the mode does not change', () => {
    store().setMakeHere('plate', 'off')
    const before = store()
    store().setMakeHere('plate', 'off')
    store().setMakeHere('gear', undefined)
    expect(store().history[before.activeBlockId].undoStack).toHaveLength(before.history[before.activeBlockId].undoStack.length)
    expect(store().blocks).toBe(before.blocks)
  })

  it('changes only the active block', () => {
    const other = makeEmptyBlock('Other')
    useBlockStore.setState({ blocks: [...store().blocks, other] })
    store().setMakeHere('plate', 'off')
    expect(sourcing(0)).toEqual({ plate: 'byproducts-first' })
    expect(sourcing(1)).toEqual({})
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

  describe('moveProduct', () => {
    // A fresh object per call: the store keeps what it is given.
    const three = () => [
      { id: 'a', itemId: 'iron-plate', extraRate: 60 },
      { id: 'b', itemId: 'gear' },
      { id: 'c', itemId: 'copper-plate' },
    ]
    const ids = () => products().map(p => p.id)
    const depth = () => store().history[store().blocks[0].id]?.undoStack.length ?? 0
    beforeEach(() => {
      for (const p of three()) store().addProduct(p)
    })

    it('moves a product later and earlier, by insertion index', () => {
      store().moveProduct('a', 2)
      expect(ids()).toEqual(['b', 'a', 'c'])
      store().moveProduct('c', 0)
      expect(ids()).toEqual(['c', 'b', 'a'])
    })

    it('moveProductBy resolves the index at call time and no-ops at the ends', () => {
      store().moveProductBy('a', 1)
      expect(ids()).toEqual(['b', 'a', 'c'])
      // The order changed since: "later" is relative to the current position.
      store().moveProductBy('a', 1)
      expect(ids()).toEqual(['b', 'c', 'a'])
      const before = depth()
      store().moveProductBy('a', 1)
      store().moveProductBy('b', -1)
      store().moveProductBy('missing', -1)
      expect(ids()).toEqual(['b', 'c', 'a'])
      expect(depth()).toBe(before)
      store().moveProductBy('c', -1)
      expect(ids()).toEqual(['c', 'b', 'a'])
    })

    it('moves to the front', () => {
      store().moveProduct('c', 0)
      expect(ids()).toEqual(['c', 'a', 'b'])
    })

    it('clamps an index past the end', () => {
      store().moveProduct('a', 3)
      expect(ids()).toEqual(['b', 'c', 'a'])
      store().undo()
      store().moveProduct('a', 99)
      expect(ids()).toEqual(['b', 'c', 'a'])
    })

    it.each([['b', 1], ['b', 2], ['nope', 0]])('moveProduct(%s, %i) is a no-op with no history entry', (id, to) => {
      const before = store().blocks
      const d = depth()
      store().moveProduct(id, to)
      expect(store().blocks, 'blocks unchanged').toBe(before)
      expect(depth()).toBe(d)
    })

    it('is a no-op for a single product', () => {
      useBlockStore.setState({ blocks: [{ ...store().blocks[0], products: [three()[0]] }] })
      const before = store().blocks
      store().moveProduct('a', 5)
      store().moveProduct('a', 0)
      expect(store().blocks).toBe(before)
    })

    it('undo and redo restore the order and keep the extra output', () => {
      store().moveProduct('a', 3)
      store().undo()
      expect(ids()).toEqual(['a', 'b', 'c'])
      expect(products()[0].extraRate).toBe(60)
      store().redo()
      expect(ids()).toEqual(['b', 'c', 'a'])
      expect(products()[2].extraRate).toBe(60)
    })

    it('two moves then two undos restore the original order', () => {
      store().moveProduct('a', 3)
      store().moveProduct('c', 0)
      expect(ids()).toEqual(['c', 'b', 'a'])
      store().undo()
      store().undo()
      expect(ids()).toEqual(['a', 'b', 'c'])
    })

    it('leaves the other blocks untouched', () => {
      const other = makeEmptyBlock('Other')
      useBlockStore.setState(st => ({ blocks: [...st.blocks, other] }))
      const before = store().blocks[1]
      store().moveProduct('a', 3)
      expect(store().blocks[1]).toBe(before)
    })

    it('keeps history per block', () => {
      const other = makeEmptyBlock('Other')
      useBlockStore.setState(st => ({ blocks: [...st.blocks, other] }))
      store().moveProduct('a', 3)
      store().setActiveBlock(other.id)
      expect(store().history[other.id]?.undoStack ?? []).toHaveLength(0)
      store().undo()
      expect(ids()).toEqual(['b', 'c', 'a'])
      store().setActiveBlock(store().blocks[0].id)
      store().undo()
      expect(ids()).toEqual(['a', 'b', 'c'])
    })
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

  it('addProduct can target a block that is not active, with the history entry in that block', () => {
    const store = () => useBlockStore.getState()
    const product = { id: 'prod-x', itemId: 'plate' }
    const productsOf = (id: string) => store().blocks.find(b => b.id === id)!.products
    store().addProduct(product, sourceId)
    expect(productsOf(sourceId)).toEqual([product])
    expect(active().products).toEqual([])
    expect(store().activeBlockId).toBe(activeId)
    expect(store().history[sourceId].undoStack).toHaveLength(1)
    expect(store().history[activeId]?.undoStack ?? []).toHaveLength(0)
    store().setActiveBlock(sourceId)
    store().undo()
    expect(productsOf(sourceId)).toEqual([])
    store().addProduct(product, 'no-such-block')
    expect(productsOf(sourceId)).toEqual([])
  })

  describe('moveConnection', () => {
    const store = () => useBlockStore.getState()
    const order = () => active().inputConnections.map(c => c.id)
    let a: string, b: string, c: string, g: string
    // plate from source, plate from third, gear from source (between), plate from fourth: [a, g, b, c] by item p g p p.
    beforeEach(() => {
      const third = makeEmptyBlock('Third')
      const fourth = makeEmptyBlock('Fourth')
      useBlockStore.setState(s => ({ blocks: [...s.blocks, third, fourth] }))
      store().addInputConnection('plate', sourceId)
      store().addInputConnection('gear', sourceId)
      store().addInputConnection('plate', third.id)
      store().addInputConnection('plate', fourth.id)
      ;[a, g, b, c] = order()
    })
    const depth = (id = activeId) => store().history[id].undoStack.length

    it('moves a connection before another of the same item, leaving other items in place', () => {
      store().moveConnection(c, a)
      expect(order()).toEqual([c, g, a, b])
    })

    it('moves to the end of its item with null, after the last connection of the item', () => {
      store().moveConnection(a, null)
      expect(order()).toEqual([b, g, c, a])
      store().moveConnection(a, null)
      expect(order()).toEqual([b, g, c, a])
    })

    it('moveConnectionBy moves one place among the connections of its item', () => {
      store().moveConnectionBy(b, -1)
      expect(order()).toEqual([b, g, a, c])
      store().moveConnectionBy(b, 1)
      expect(order()).toEqual([a, g, b, c])
      store().moveConnectionBy(a, 1)
      expect(order()).toEqual([b, g, a, c])
      store().moveConnectionBy(a, 1)
      expect(order()).toEqual([b, g, c, a])
    })

    it('is a no-op with no history entry at either end, for itself, in place, across items or unknown ids', () => {
      const before = store().blocks
      const d = depth()
      store().moveConnectionBy(a, -1)
      store().moveConnectionBy(c, 1)
      store().moveConnectionBy(g, 1)
      store().moveConnectionBy(g, -1)
      store().moveConnection(a, a)
      store().moveConnection(a, b) // a already precedes b among the plates
      store().moveConnection(c, null)
      store().moveConnection(a, g)
      store().moveConnection(g, a)
      store().moveConnection('ghost', a)
      store().moveConnection(a, 'ghost')
      expect(order()).toEqual([a, g, b, c])
      expect(depth()).toBe(d)
      expect(store().blocks).toBe(before)
    })

    it('undo and redo restore the exact order', () => {
      const d = depth()
      store().moveConnection(c, a)
      store().moveConnection(a, null)
      expect(order()).toEqual([c, g, b, a])
      store().undo()
      expect(order()).toEqual([c, g, a, b])
      store().undo()
      expect(order()).toEqual([a, g, b, c])
      expect(depth()).toBe(d)
      store().redo()
      store().redo()
      expect(order()).toEqual([c, g, b, a])
    })

    it('moves A before B among A, C, B of one item: C, A, B', () => {
      store().moveConnection(c, b) // plates a, b, c -> a, c, b
      store().moveConnection(a, b) // -> c, a, b
      expect(order()).toEqual([c, g, a, b])
    })

    it('moves a connection after another by moving it before the one that follows', () => {
      store().moveConnection(a, c) // a goes after b, just before c
      expect(order()).toEqual([b, g, a, c])
    })

    it('ignores a connection id of another block and leaves other blocks alone', () => {
      store().addInputConnection('plate', sourceId, otherId())
      const theirs = store().blocks.find(x => x.id === otherId())!.inputConnections[0].id
      const before = store().blocks.find(x => x.id === otherId())
      store().moveConnection(a, theirs)
      store().moveConnection(theirs, a)
      expect(order()).toEqual([a, g, b, c])
      store().moveConnection(c, a)
      expect(store().blocks.find(x => x.id === otherId())).toBe(before)
    })

    it('undo and redo move only that connection when other commands ran in between', () => {
      store().moveConnection(c, a) // c, g, a, b
      store().removeInputConnection(b)
      store().setConnectionMaxRate(a, 9)
      store().undo()
      store().undo() // undo the limit and the removal
      store().undo() // the move
      expect(order()).toEqual([a, g, b, c])
      store().redo()
      expect(order()).toEqual([c, g, a, b])
    })

    it('does not lose or duplicate connections when undo meets a changed list', () => {
      store().moveConnection(c, a) // c, g, a, b
      const third = makeEmptyBlock('Fifth')
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(x => x.id === activeId
          ? { ...x, inputConnections: [...x.inputConnections.filter(k => k.id !== a), { id: 'late', itemId: 'plate', fromBlockId: third.id }] }
          : x),
      }))
      store().undo()
      expect([...order()].sort()).toEqual([b, c, g, 'late'].sort())
      store().redo()
      expect([...order()].sort()).toEqual([b, c, g, 'late'].sort())
    })

    it('can target a block that is not active and its undo lives there', () => {
      store().addInputConnection('plate', sourceId, otherId())
      const third = store().blocks.find(x => x.name === 'Third')!
      store().addInputConnection('plate', third.id, otherId())
      const other = () => store().blocks.find(x => x.id === otherId())!.inputConnections.map(x => x.id)
      const [x, y] = other()
      store().moveConnection(y, x, otherId())
      expect(other()).toEqual([y, x])
      expect(order()).toEqual([a, g, b, c])
      expect(depth(otherId())).toBe(3)
      store().setActiveBlock(otherId())
      store().undo()
      expect(other()).toEqual([x, y])
    })
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

    it('takes the default colour, from the item\'s icon colour', () => {
      loadIconColors({ plate: '#ffff00' })
      store().addBlockForItem('plate', 'Iron plate')
      const created = store().blocks[store().blocks.length - 1]
      expect(created.color).toBe('#ffff00')
      expect(created.colorAuto).toBe(true)
    })

    it('picks a palette colour without an icon colour, and the icon colour as it is when grey', () => {
      loadIconColors({ gear: '#7a7a79' })
      store().addBlockForItem('plate', 'Iron plate')
      expect(BLOCK_PALETTE).toContain(store().blocks[store().blocks.length - 1].color as typeof BLOCK_PALETTE[number])
      store().addBlockForItem('gear', 'Gear')
      expect(store().blocks[store().blocks.length - 1].color).toBe('#7a7a79')
    })

    it('keeps the colour when a later product is added and removed', () => {
      loadIconColors({ plate: '#ffff00', gear: '#ffff00' })
      const newId = store().addBlockForItem('plate', 'Iron plate')!
      const color = store().blocks.find(b => b.id === newId)!.color
      store().setActiveBlock(newId)
      store().addProduct({ id: 'extra', itemId: 'gear', extraRate: 5 })
      store().removeProduct('extra')
      expect(store().blocks.find(b => b.id === newId)!.color).toBe(color)
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

describe('served order', () => {
  const blk = (id: string): ServedEntry => ({ kind: 'block', blockId: id })
  const extra: ServedEntry = { kind: 'extra' }
  const store = () => useBlockStore.getState()
  const get = (id: string) => store().blocks.find(b => b.id === id)!
  const listOf = (id: string, itemId = 'plate') => get(id).servedOrder?.[itemId]
  const link = (id: string, from: string, itemId = 'plate') => ({ id: `c-${id}`, itemId, fromBlockId: from })
  let shown: ServedEntry[]

  function seed(consumers = ['A', 'B', 'C'], active = 'S') {
    const source = { ...makeEmptyBlock('S'), id: 'S', products: [{ id: 'p', itemId: 'plate', extraRate: 10 }] }
    const others = consumers.map(id => ({ ...makeEmptyBlock(id), id, inputConnections: [link(id, 'S')] }))
    useBlockStore.setState({ blocks: [source, ...others], activeBlockId: active, history: {} })
    shown = [...consumers.map(blk), extra]
  }
  const depth = (id: string) => store().history[id]?.undoStack.length ?? 0

  beforeEach(() => seed())

  describe('moveServed with no list', () => {
    it('writes the shown order with the entry moved into the source only', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      expect(listOf('S')).toEqual([blk('C'), blk('A'), blk('B'), extra])
      expect(depth('S')).toBe(1)
      for (const id of ['A', 'B', 'C']) expect(depth(id)).toBe(0)
      expect('servedOrder' in get('A')).toBe(false)
    })

    it('does nothing when the entry is dropped in place', () => {
      for (const toIndex of [1, 2]) {
        const before = store().blocks
        store().moveServed('S', 'plate', blk('B'), toIndex, shown)
        expect(store().blocks).toBe(before)
      }
      expect(depth('S')).toBe(0)
      expect('servedOrder' in get('S')).toBe(false)
    })

    it('does nothing for an entry that is not shown', () => {
      const before = store().blocks
      store().moveServed('S', 'plate', extra, 0, [blk('A'), blk('B')])
      expect(store().blocks).toBe(before)
      expect(depth('S')).toBe(0)
    })

    it('drops shown entries that are not consumers', () => {
      store().moveServed('S', 'plate', blk('B'), 0, [blk('A'), blk('B'), blk('ghost'), blk('A'), extra])
      expect(listOf('S')).toEqual([blk('B'), blk('A'), extra])
    })

    it('undoes the first drag to no list and redoes it', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      store().undo()
      expect('servedOrder' in get('S')).toBe(false)
      store().redo()
      expect(listOf('S')).toEqual([blk('C'), blk('A'), blk('B'), extra])
    })
  })

  describe('moveServed with a list', () => {
    beforeEach(() => {
      store().moveServed('S', 'plate', blk('C'), 0, shown) // [C, A, B, extra]
    })

    it('clamps the insertion index', () => {
      store().moveServed('S', 'plate', blk('B'), -5, shown)
      expect(listOf('S')).toEqual([blk('B'), blk('C'), blk('A'), extra])
      store().moveServed('S', 'plate', blk('B'), 99, shown)
      expect(listOf('S')).toEqual([blk('C'), blk('A'), extra, blk('B')])
    })

    it('treats index + 2 as one place down', () => {
      store().moveServed('S', 'plate', blk('C'), 2, shown)
      expect(listOf('S')).toEqual([blk('A'), blk('C'), blk('B'), extra])
    })

    it('ignores shown', () => {
      store().moveServed('S', 'plate', blk('B'), 0, [extra])
      expect(listOf('S')).toEqual([blk('B'), blk('C'), blk('A'), extra])
    })

    it('moves the extra up', () => {
      store().moveServed('S', 'plate', extra, 0, shown)
      expect(listOf('S')).toEqual([extra, blk('C'), blk('A'), blk('B')])
    })

    it('inserts an unranked consumer at the index', () => {
      store().resetServedOrder('S', 'plate')
      seed(['A', 'B', 'C', 'D'])
      store().moveServed('S', 'plate', blk('C'), 0, shown) // [C, A, B, D, extra]
      store().removeInputConnection('c-D', 'D')
      store().addInputConnection('plate', 'S', 'D') // D is a consumer again, not in the list
      expect(listOf('S')).toEqual([blk('C'), blk('A'), blk('B'), extra])
      store().moveServed('S', 'plate', blk('D'), 1, shown)
      expect(listOf('S')).toEqual([blk('C'), blk('D'), blk('A'), blk('B'), extra])
    })

    it.each([
      ['a non-finite index', () => ['S', blk('B'), NaN] as const],
      ['an unknown source', () => ['ghost', blk('B'), 0] as const],
      ['an unknown block entry', () => ['S', blk('ghost'), 0] as const],
      ['the source itself', () => ['S', blk('S'), 0] as const],
    ])('is a no-op for %s', (_name, args) => {
      const before = store().blocks
      const [source, entry, toIndex] = args()
      store().moveServed(source, 'plate', entry, toIndex, shown)
      expect(store().blocks).toBe(before)
      expect(depth('S')).toBe(1)
    })

    it('is a no-op for a block that takes another item', () => {
      const before = store().blocks
      store().moveServed('S', 'gear', blk('B'), 0, shown)
      expect(store().blocks).toBe(before)
    })

    it('undoes through the moves back to no list', () => {
      store().moveServed('S', 'plate', blk('B'), 0, shown)
      store().undo()
      expect(listOf('S')).toEqual([blk('C'), blk('A'), blk('B'), extra])
      store().undo()
      expect('servedOrder' in get('S')).toBe(false)
    })

    it('keeps changes made to the list in between when it undoes', () => {
      store().moveServed('S', 'plate', blk('B'), 0, shown) // [B, C, A, extra]
      store().removeInputConnection('c-A', 'A') // [B, C, extra]
      store().undo()
      expect(listOf('S')).toEqual([blk('C'), blk('B'), extra])
    })
  })

  describe('resetServedOrder', () => {
    it('removes the item key, keeping the other items', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'S' ? { ...b, servedOrder: { ...b.servedOrder, gear: [blk('A')] } } : b)) }))
      store().resetServedOrder('S', 'plate')
      expect(get('S').servedOrder).toEqual({ gear: [blk('A')] })
    })

    it('removes servedOrder when it was the only item', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      store().resetServedOrder('S', 'plate')
      expect('servedOrder' in get('S')).toBe(false)
    })

    it('is a no-op with no history when there is no list', () => {
      const before = store().blocks
      store().resetServedOrder('S', 'plate')
      store().resetServedOrder('ghost', 'plate')
      expect(store().blocks).toBe(before)
      expect(depth('S')).toBe(0)
    })

    it('undoes and redoes', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      store().resetServedOrder('S', 'plate')
      store().undo()
      expect(listOf('S')).toEqual([blk('C'), blk('A'), blk('B'), extra])
      store().redo()
      expect('servedOrder' in get('S')).toBe(false)
    })

    it('does not put back a consumer that has left', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      store().resetServedOrder('S', 'plate')
      store().removeInputConnection('c-A', 'A')
      store().undo()
      expect(listOf('S')).toEqual([blk('C'), blk('B'), extra])
    })
  })

  describe('connection cleanup', () => {
    beforeEach(() => {
      store().moveServed('S', 'plate', blk('A'), 0, shown)
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'S' ? { ...b, servedOrder: { plate: [blk('A'), blk('B'), blk('C')] } } : b)), history: {} }))
    })

    it('removes the entry with the last connection, in the consumer history only, and undo restores it', () => {
      store().setActiveBlock('B')
      store().removeInputConnection('c-B')
      expect(listOf('S')).toEqual([blk('A'), blk('C')])
      expect(depth('B')).toBe(1)
      expect(depth('S')).toBe(0)
      store().undo()
      expect(listOf('S')).toEqual([blk('A'), blk('B'), blk('C')])
      store().redo()
      expect(listOf('S')).toEqual([blk('A'), blk('C')])
    })

    it('restores an entry at the front and at the end', () => {
      store().removeInputConnection('c-A', 'A')
      store().removeInputConnection('c-C', 'C')
      expect(listOf('S')).toEqual([blk('B')])
      store().setActiveBlock('C'); store().undo()
      expect(listOf('S')).toEqual([blk('B'), blk('C')])
      store().setActiveBlock('A'); store().undo()
      expect(listOf('S')).toEqual([blk('A'), blk('B'), blk('C')])
    })

    it('drops the key and servedOrder with the last entry and undo recreates it', () => {
      seed(['B'])
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'S' ? { ...b, servedOrder: { plate: [blk('B')] } } : b)) }))
      store().removeInputConnection('c-B', 'B')
      expect('servedOrder' in get('S')).toBe(false)
      store().setActiveBlock('B'); store().undo()
      expect(listOf('S')).toEqual([blk('B')])
    })

    it('leaves the list absent when it was reset between removal and undo', () => {
      store().removeInputConnection('c-B', 'B')
      store().resetServedOrder('S', 'plate')
      store().setActiveBlock('B'); store().undo()
      expect(get('B').inputConnections).toHaveLength(1)
      expect('servedOrder' in get('S')).toBe(false)
    })

    it('keeps the entry while a duplicate connection remains', () => {
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'B' ? { ...b, inputConnections: [link('B', 'S'), { ...link('B2', 'S') }] } : b)) }))
      store().removeInputConnection('c-B', 'B')
      expect(listOf('S')).toEqual([blk('A'), blk('B'), blk('C')])
    })

    it("does not touch the list for a connection of another item or source", () => {
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'B' ? { ...b, inputConnections: [...b.inputConnections, link('Bg', 'S', 'gear'), link('Bx', 'A')] } : b)) }))
      store().removeInputConnection('c-Bg', 'B')
      store().removeInputConnection('c-Bx', 'B')
      expect(listOf('S')).toEqual([blk('A'), blk('B'), blk('C')])
    })

    it('cleans on undo of an add and restores on redo', () => {
      store().addInputConnection('gear', 'S', 'B')
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'S' ? { ...b, servedOrder: { ...b.servedOrder, gear: [blk('B')] } } : b)) }))
      store().setActiveBlock('B')
      store().undo()
      expect(listOf('S', 'gear')).toBeUndefined()
      store().redo()
      expect(listOf('S', 'gear')).toEqual([blk('B')])
    })

    it('does not add a new connection to the list', () => {
      useBlockStore.setState(s => ({ blocks: [...s.blocks, { ...makeEmptyBlock('D'), id: 'D' }] }))
      store().addInputConnection('plate', 'S', 'D')
      expect(listOf('S')).toEqual([blk('A'), blk('B'), blk('C')])
      expect('servedOrder' in get('D')).toBe(false)
    })
  })

  describe('removeBlock', () => {
    it('removes a consumer from every list, dropping emptied lists', () => {
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'S' ? { ...b, servedOrder: { plate: [blk('A'), blk('B')], gear: [blk('A')] } } : b)),
      }))
      store().removeBlock('A')
      expect(get('S').servedOrder).toEqual({ plate: [blk('B')] })
    })

    it('removes the list of a deleted source and drops the undo of an older command', () => {
      store().removeInputConnection('c-B', 'B')
      store().removeBlock('S')
      expect(store().blocks.some(b => b.id === 'S')).toBe(false)
      store().setActiveBlock('B')
      expect(() => store().undo()).not.toThrow()
      expect(get('B').inputConnections).toEqual([])
    })
  })

  describe('copies', () => {
    it('cloneBlock drops the list', () => {
      store().moveServed('S', 'plate', blk('C'), 0, shown)
      expect('servedOrder' in cloneBlock(get('S'), '#112233')).toBe(false)
    })

    it('makeEmptyBlock has no servedOrder key', () => {
      expect('servedOrder' in makeEmptyBlock('X')).toBe(false)
    })

    it('clonePlan remaps the block ids, drops unmapped entries and leaves its input alone', () => {
      const [s, a, b] = store().blocks.slice(0, 3)
      const plan: AppState = {
        blocks: [{ ...s, servedOrder: { plate: [blk(a.id), blk('ghost'), extra, blk(b.id)] } }, a, b],
        activeBlockId: s.id, horizonTechnologyIds: [], defaultMachineOverrides: {},
      }
      const before = structuredClone(plan)
      const copy = clonePlan(plan)
      expect(copy.blocks[0].servedOrder).toEqual({ plate: [blk(copy.blocks[1].id), extra, blk(copy.blocks[2].id)] })
      expect('servedOrder' in copy.blocks[1]).toBe(false)
      expect(plan).toEqual(before)
    })

    it('clonePlan writes no key when the source had none or nothing maps', () => {
      const [s, a] = store().blocks.slice(0, 2)
      const plain = clonePlan({ blocks: [s, a], activeBlockId: s.id, horizonTechnologyIds: [], defaultMachineOverrides: {} })
      expect('servedOrder' in plain.blocks[0]).toBe(false)
      const dangling = clonePlan({ blocks: [{ ...s, servedOrder: { plate: [blk('ghost')] } }, a], activeBlockId: s.id, horizonTechnologyIds: [], defaultMachineOverrides: {} })
      expect('servedOrder' in dangling.blocks[0]).toBe(false)
    })
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

  it('copies sourceRules', () => {
    useBlockStore.setState({
      blocks: blocks().map(b => (b.id === original.id ? { ...b, sourceRules: { plate: { makeHere: 'off' as const } } } : b)),
    })
    useBlockStore.getState().duplicateBlock(original.id)
    expect(blocks()[1].sourceRules).toEqual({ plate: { makeHere: 'off' } })
    expect(blocks()[1].sourceRules).not.toBe(blocks()[0].sourceRules)
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
    const blocks = BLOCK_PALETTE.slice(0, -1).map((c, i) => makeEmptyBlock(`B${i}`, c))
    useBlockStore.setState({ blocks, activeBlockId: blocks[0].id, history: {} })
    useBlockStore.getState().addBlock()
    const added = useBlockStore.getState().blocks[BLOCK_PALETTE.length - 1]
    expect(added.color).toBe(BLOCK_PALETTE[BLOCK_PALETTE.length - 1])
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

  describe('default colour', () => {
    const store = () => useBlockStore.getState()
    const colorOf = (id: string) => store().blocks.find(b => b.id === id)!.color

    function seed() {
      loadIconColors({ plate: '#ffff00', gear: '#7a7a79' })
      const a = makeEmptyBlock('A', '#60a5fa')
      const b = makeEmptyBlock('B', '#f472b6')
      useBlockStore.setState({ blocks: [a, b], activeBlockId: b.id, history: {} })
      return { a, b }
    }

    it('addBlock makes a block that follows its first product', () => {
      seed()
      store().addBlock()
      const added = store().blocks[2]
      expect(added.colorAuto).toBe(true)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      expect(colorOf(added.id)).toBe('#ffff00')
    })

    it('recolours an auto block when its first product changes, and only then', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'gear' })
      store().addProduct({ id: 'p2', itemId: 'plate' })
      expect(colorOf(b.id)).not.toBe('#ffff00') // the second product does not count
      store().removeProduct('p1')
      expect(colorOf(b.id)).toBe('#ffff00')
    })

    it('recolours an auto block when a move changes its first product, and undo and redo follow', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'gear' })
      store().addProduct({ id: 'p2', itemId: 'plate' })
      expect(colorOf(b.id)).toBe('#7a7a79')
      store().moveProduct('p2', 0)
      expect(colorOf(b.id)).toBe('#ffff00')
      store().undo()
      expect(colorOf(b.id)).toBe('#7a7a79')
      store().redo()
      expect(colorOf(b.id)).toBe('#ffff00')
    })

    it('keeps the colour when a move leaves the first product alone', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      store().addProduct({ id: 'p2', itemId: 'gear' })
      store().addProduct({ id: 'p3', itemId: 'plate' })
      store().moveProduct('p3', 2)
      store().moveProduct('p2', 3)
      expect(colorOf(b.id)).toBe('#ffff00')
    })

    it('does not recolour a picked colour on a move', () => {
      const { b } = seed()
      store().setBlockColor(b.id, '#fda4af')
      store().addProduct({ id: 'p1', itemId: 'gear' })
      store().addProduct({ id: 'p2', itemId: 'plate' })
      store().moveProduct('p2', 0)
      expect(colorOf(b.id)).toBe('#fda4af')
    })

    it('keeps the colour when the last product is removed', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      store().removeProduct('p1')
      expect(colorOf(b.id)).toBe('#ffff00')
    })

    it('gives the same colour every time for the same state', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'gear' })
      const grey = colorOf(b.id)
      store().undo()
      store().redo()
      expect(colorOf(b.id)).toBe(grey)
      store().resetBlockColor(b.id)
      expect(colorOf(b.id)).toBe(grey)
    })

    it('follows the first product through undo and redo', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'gear' })
      store().addProduct({ id: 'p2', itemId: 'plate' })
      store().removeProduct('p1')
      expect(colorOf(b.id)).toBe('#ffff00')
      store().undo() // gear is first again: its own icon colour
      expect(colorOf(b.id)).toBe('#7a7a79')
      store().redo()
      expect(colorOf(b.id)).toBe('#ffff00')
    })

    it('does not recolour a block whose colour was picked', () => {
      const { b } = seed()
      store().setBlockColor(b.id, '#fda4af')
      expect(store().blocks[1].colorAuto).toBe(false)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      expect(colorOf(b.id)).toBe('#fda4af')
    })

    it('picking the colour the block already has still ends the following', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().setBlockColor(b.id, colorOf(b.id))
      expect(store().blocks[1].colorAuto).toBe(false)
    })

    it('resetBlockColor takes the colour of the first product and follows it from then on', () => {
      const { a, b } = seed()
      store().addProduct({ id: 'p1', itemId: 'plate' })
      store().resetBlockColor(b.id)
      expect(colorOf(b.id)).toBe('#ffff00')
      expect(store().blocks[1].colorAuto).toBe(true)
      expect(colorOf(a.id)).toBe('#60a5fa')
      expect(store().blocks[0].colorAuto).toBeFalsy()
    })

    it('resetBlockColor keeps the colour of a block with no product, and ignores an unknown block', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      expect(colorOf(b.id)).toBe('#f472b6')
      expect(store().blocks[1].colorAuto).toBe(true)
      const once = store().blocks
      store().resetBlockColor(b.id)
      expect(store().blocks).toBe(once)
      const before = store().blocks
      store().resetBlockColor('missing')
      expect(store().blocks).toBe(before)
    })

    it('picking a colour and going back to the default are undoable steps', () => {
      const { b } = seed()
      store().addProduct({ id: 'p1', itemId: 'plate' })
      store().resetBlockColor(b.id) // blue -> auto
      expect(colorOf(b.id)).toBe('#ffff00')
      store().setBlockColor(b.id, '#a78bfa') // auto -> purple
      store().setBlockColor(b.id, '#60a5fa') // purple -> blue
      store().undo()
      expect(colorOf(b.id)).toBe('#a78bfa')
      expect(store().blocks[1].colorAuto).toBe(false)
      store().undo()
      expect(colorOf(b.id)).toBe('#ffff00')
      expect(store().blocks[1].colorAuto).toBe(true)
      store().undo() // auto -> the colour it had before
      expect(colorOf(b.id)).toBe('#f472b6')
      expect(store().blocks[1].colorAuto).toBeFalsy()
      store().redo()
      store().redo()
      store().redo()
      expect(colorOf(b.id)).toBe('#60a5fa')
      expect(store().blocks[1].colorAuto).toBe(false)
    })

    it('undoing a pick back to the default recolours for the current first product', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      store().setBlockColor(b.id, '#a78bfa')
      store().removeProduct('p1')
      store().addProduct({ id: 'p2', itemId: 'gear' })
      store().undo() // the product add
      store().undo() // the product removal
      store().undo() // the pick: auto again, on plate
      expect(colorOf(b.id)).toBe('#ffff00')
      expect(store().blocks[1].colorAuto).toBe(true)
    })

    it('a duplicate has its own colour and does not follow its first product', () => {
      const { b } = seed()
      store().resetBlockColor(b.id)
      store().duplicateBlock(b.id)
      const copy = store().blocks[2]
      expect(copy.colorAuto).toBe(false)
      store().addProduct({ id: 'p1', itemId: 'plate' })
      expect(copy.color).not.toBe(colorOf(b.id))
      expect(store().blocks[2].color).toBe(copy.color)
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
      fuelItemId: 'coal',
      modules: [{ moduleId: 'speed', count: 2 }],
      beaconConfigs: [{ ...beacon }],
      pinnedRate: 10,
      neighbourCount: 2,
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
      fuelItemId: 'coal',
      modules: [{ moduleId: 'speed', count: 2 }],
      beaconConfigs: [beacon],
      neighbourCount: 2,
      byproductPolicy: { oxygen: 'discard' },
      primaryProduct: 'hydrogen',
    })
    expect('pinnedRate' in copy, 'pin is not copied').toBe(false)
    expect('byproductConsumer' in copy, 'consumer flag is not copied').toBe(false)
    expect(copy.modules).not.toBe(rowIn('root', 'src').modules)
    expect(copy.beaconConfigs).not.toBe(rowIn('root', 'src').beaconConfigs)
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

describe('duplicateSubPlanTo', () => {
  // root [r1 iron, h-A, h-B, h-G]; A (area) [a1 electrolysis, h-N]; N (organising) [n1 plastic, h-X];
  // X (area) [x1 iron]; B (area) [b1 copper]; G (organising) [g1 gear]
  function setup(): string {
    const x = planOf('X', [gameRow('x1', 'iron')], [], true)
    const n = planOf('N', [gameRow('n1', 'plastic'), handleOf(x)], [x])
    const a1 = gameRow('a1', 'electrolysis', {
      machineId: 'm2',
      modules: [{ moduleId: 'speed', count: 2 }],
      beaconConfigs: [{ moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }],
      pinnedRate: 10,
      byproductPolicy: { oxygen: 'discard' },
      primaryProduct: 'hydrogen',
      byproductConsumer: true,
    })
    const a = planOf('A', [a1, handleOf(n)], [n], true)
    const b = planOf('B', [gameRow('b1', 'copper')], [], true)
    const g = planOf('G', [gameRow('g1', 'gear')])
    return loadRoot(planOf('root', [gameRow('r1', 'iron'), handleOf(a), handleOf(b), handleOf(g)], [a, b, g]))
  }

  const stripVolatile = (plan: SubPlan) =>
    JSON.parse(JSON.stringify(plan, (k, v) => (k === 'id' || k === 'subPlanId' || k === 'createdAt' || k === 'updatedAt' || k === 'name' ? undefined : v)))
  const allIds = (plan: SubPlan): string[] => [plan.id, ...plan.nodes.map(n => n.id), ...plan.subPlans.flatMap(allIds)]

  it('copies the sub-factory into the area with fresh ids, appended after the area\'s rows', () => {
    setup()
    const original = structuredClone(treePlan('A'))
    const id = useBlockStore.getState().duplicateSubPlanTo('A', 'B')
    expect(id).toBeDefined()
    const b = treePlan('B')
    expect(b.nodes.map(n => n.id)).toEqual(['b1', id])
    const copy = b.subPlans[b.subPlans.length - 1]
    expect((b.nodes[1] as SubPlanNode).subPlanId).toBe(copy.id)
    expect(copy.name).toBe('A (copy)')
    expect(copy.area).toBe(true)
    expect(stripVolatile(copy)).toEqual(stripVolatile(original))
    const originalIds = new Set(allIds(original))
    expect(allIds(copy).some(i => originalIds.has(i)), 'no id is shared').toBe(false)
    const copyN = copy.subPlans[0]
    expect((copy.nodes[1] as SubPlanNode).subPlanId).toBe(copyN.id)
    const originalN = original.subPlans[0]
    expect(copyN.name).toBe(originalN.name)
    expect(copyN.createdAt).toBe(originalN.createdAt)
    expect(copyN.updatedAt).toBe(originalN.updatedAt)
    expect(copy.name).not.toBe(original.name)
    const a1 = original.nodes[0] as GameRecipeNode
    const copyA1 = copy.nodes[0] as GameRecipeNode
    expect(copyA1).toEqual({ ...a1, id: copyA1.id })
    expect(copyA1.modules).not.toBe(a1.modules)
  })

  it('inserts right after the source\'s handle when the target holds it', () => {
    setup()
    const id = useBlockStore.getState().duplicateSubPlanTo('A', 'root')!
    expect(treePlan('root').nodes.map(n => n.id)).toEqual(['r1', 'h-A', id, 'h-B', 'h-G'])
    const copyA = treePlan('root').subPlans.at(-1)!
    const copyX = copyA.subPlans[0].subPlans[0]
    const areas = blockAreas(useBlockStore.getState().blocks[0].rootPlan)!
    expect(areas.map(a => a.id)).toEqual(['root', 'A', 'X', copyA.id, copyX.id, 'B'])
  })

  it('copies an organising group into an area without its recipes', () => {
    setup()
    expect(useBlockStore.getState().duplicateSubPlanTo('G', 'B')).toBeDefined()
    expect(areaRecipeIds(useBlockStore.getState().blocks[0].rootPlan, 'B').has('gear')).toBe(true)
  })

  it('refuses invalid copies without touching the state', () => {
    setup()
    const before = useBlockStore.getState().blocks
    const store = useBlockStore.getState()
    for (const [from, to] of [['G', 'root'], ['A', 'A'], ['A', 'X'], ['N', 'A'], ['A', 'G'], ['root', 'B'], ['missing', 'B']]) {
      expect(store.duplicateSubPlanTo(from, to), `${from} -> ${to}`).toBeUndefined()
    }
    expect(useBlockStore.getState().blocks).toBe(before)
    expect(useBlockStore.getState().history).toEqual({})
  })

  it('undoes in one step, redoes with the same ids and keeps a rename made before the undo', () => {
    const blockId = setup()
    const id = useBlockStore.getState().duplicateSubPlanTo('A', 'B')!
    const copyId = treePlan('B').subPlans[0].id
    expect(useBlockStore.getState().history[blockId].undoStack).toHaveLength(1)
    useBlockStore.getState().renameSubPlan(copyId, 'Second')
    useBlockStore.getState().undo() // the rename
    useBlockStore.getState().undo() // the duplication
    expect(treePlan('B').nodes.map(n => n.id)).toEqual(['b1'])
    expect(treePlan('B').subPlans).toEqual([])
    useBlockStore.getState().redo()
    useBlockStore.getState().redo()
    expect(treePlan('B').nodes.map(n => n.id)).toEqual(['b1', id])
    expect(treePlan(copyId).name).toBe('Second')
  })
})

describe('updateNodeBeacons', () => {
  const a: BeaconConfig = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
  const b: BeaconConfig = { moduleId: 'eff', beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
  const setup = () => loadRoot(planOf('root', [gameRow('r1', 'smelt')]))
  const node = () => rowIn('root', 'r1')
  const undoDepth = (blockId: string) => useBlockStore.getState().history[blockId]?.undoStack.length ?? 0

  it('sets one then two configurations, and undoes each step back to an absent key', () => {
    setup()
    useBlockStore.getState().updateNodeBeacons('r1', [a])
    useBlockStore.getState().updateNodeBeacons('r1', [a, b])
    expect(node().beaconConfigs).toEqual([a, b])
    useBlockStore.getState().undo()
    expect(node().beaconConfigs).toEqual([a])
    useBlockStore.getState().undo()
    expect('beaconConfigs' in node()).toBe(false)
    useBlockStore.getState().redo()
    expect(node().beaconConfigs).toEqual([a])
  })

  it('removes the key for an empty list, and undo restores the list', () => {
    setup()
    useBlockStore.getState().updateNodeBeacons('r1', [a])
    useBlockStore.getState().updateNodeBeacons('r1', [])
    expect('beaconConfigs' in node()).toBe(false)
    useBlockStore.getState().undo()
    expect(node().beaconConfigs).toEqual([a])
  })

  it('adds no history entry when the list is unchanged, whatever the form of "none"', () => {
    const blockId = setup()
    useBlockStore.getState().updateNodeBeacons('r1', [])
    expect(undoDepth(blockId)).toBe(0)
    useBlockStore.getState().updateNodeBeacons('r1', [a])
    useBlockStore.getState().updateNodeBeacons('r1', [{ ...a }])
    expect(undoDepth(blockId)).toBe(1)
  })

  it('editing the second configuration leaves the first alone', () => {
    setup()
    useBlockStore.getState().updateNodeBeacons('r1', [a, b])
    useBlockStore.getState().updateNodeBeacons('r1', [a, { ...b, beaconCount: 8 }])
    expect(node().beaconConfigs).toEqual([a, { ...b, beaconCount: 8 }])
  })
})

describe('updateNodeNeighbourCount', () => {
  function setup(extra: Partial<GameRecipeNode> = {}): string {
    return loadRoot(planOf('root', [gameRow('r1', 'reactor', extra), gameRow('r2', 'reactor')]))
  }
  const count = () => rowIn('root', 'r1').neighbourCount
  const undoDepth = (blockId: string) => useBlockStore.getState().history[blockId]?.undoStack.length ?? 0

  it('sets the count, undoes to undefined and redoes', () => {
    setup()
    useBlockStore.getState().updateNodeNeighbourCount('r1', 3)
    expect(count()).toBe(3)
    useBlockStore.getState().undo()
    expect(count()).toBeUndefined()
    useBlockStore.getState().redo()
    expect(count()).toBe(3)
  })

  it('treats 0 as removing the count', () => {
    setup({ neighbourCount: 2 })
    useBlockStore.getState().updateNodeNeighbourCount('r1', 0)
    expect(count()).toBeUndefined()
    useBlockStore.getState().undo()
    expect(count()).toBe(2)
  })

  it('adds no history entry when the value is unchanged', () => {
    const blockId = setup({ neighbourCount: 2 })
    useBlockStore.getState().updateNodeNeighbourCount('r1', 2)
    useBlockStore.getState().updateNodeNeighbourCount('r2', 0)
    expect(undoDepth(blockId)).toBe(0)
  })

  it('is dropped by a recipe change and not copied by "apply to every row"', () => {
    setup({ neighbourCount: 2 })
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    expect(rowIn('root', 'r2').neighbourCount).toBeUndefined()
    useBlockStore.getState().updateNodeRecipe('r1', 'other')
    expect(count()).toBeUndefined()
  })
})

describe('updateNodeFuel', () => {
  function setup(extra: Partial<GameRecipeNode> = {}): string {
    return loadRoot(planOf('root', [gameRow('r1', 'smelt', extra), gameRow('r2', 'smelt')]))
  }
  const fuel = (id = 'r1') => rowIn('root', id).fuelItemId
  const undoDepth = (blockId: string) => useBlockStore.getState().history[blockId]?.undoStack.length ?? 0

  it('sets the fuel, undoes to undefined and redoes', () => {
    setup()
    useBlockStore.getState().updateNodeFuel('r1', 'coal')
    expect(fuel()).toBe('coal')
    expect(fuel('r2')).toBeUndefined()
    useBlockStore.getState().undo()
    expect(fuel()).toBeUndefined()
    useBlockStore.getState().redo()
    expect(fuel()).toBe('coal')
  })

  it('clears the choice with undefined, undoably', () => {
    setup({ fuelItemId: 'coal' })
    useBlockStore.getState().updateNodeFuel('r1', undefined)
    expect(fuel()).toBeUndefined()
    useBlockStore.getState().undo()
    expect(fuel()).toBe('coal')
  })

  it('adds no history entry when the value is unchanged', () => {
    const blockId = setup({ fuelItemId: 'coal' })
    useBlockStore.getState().updateNodeFuel('r1', 'coal')
    useBlockStore.getState().updateNodeFuel('r2', undefined)
    expect(undoDepth(blockId)).toBe(0)
  })

  it('is kept when the machine changes', () => {
    setup({ fuelItemId: 'coal' })
    useBlockStore.getState().updateNodeMachine('r1', 'steel-furnace')
    expect(fuel()).toBe('coal')
  })

  it('is copied by "apply to every row", which then skips rows that already match', () => {
    const blockId = setup({ fuelItemId: 'coal' })
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    expect(fuel('r2')).toBe('coal')
    expect(undoDepth(blockId)).toBe(1)
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    expect(undoDepth(blockId)).toBe(1)
    useBlockStore.getState().undo()
    expect(fuel('r2')).toBeUndefined()
  })

  it('"apply to every row" also clears the fuel of the other rows when the source has none', () => {
    setup()
    useBlockStore.getState().updateNodeFuel('r2', 'wood')
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'machine')
    expect(fuel('r2')).toBeUndefined()
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
        rootPlan: { ...b.rootPlan, nodes: b.rootPlan.nodes.map(n => n.id === 'r1' ? { ...n, beaconConfigs: [beacon] } as GameRecipeNode : n) },
      })),
    }))
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    expect(rowIn('A', 'r2').beaconConfigs).toEqual([beacon])
    expect(rowIn('A', 'r2').machineId, 'machine is untouched').toBe('m1')
    useBlockStore.getState().undo()
    expect('beaconConfigs' in rowIn('A', 'r2')).toBe(false)
  })

  it('copies several beacon configurations in order, and undo restores the targets', () => {
    setup()
    const a: BeaconConfig = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    const b: BeaconConfig = { moduleId: 'eff', beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    useBlockStore.getState().updateNodeBeacons('r1', [a, b])
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    expect(rowIn('A', 'r2').beaconConfigs).toEqual([a, b])
    useBlockStore.getState().undo()
    expect('beaconConfigs' in rowIn('A', 'r2')).toBe(false)
    expect(rowIn('root', 'r1').beaconConfigs).toEqual([a, b])
  })

  it('copies the same configurations in another order', () => {
    setup()
    const a: BeaconConfig = { moduleId: 'speed', beaconCount: 2, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    const b: BeaconConfig = { moduleId: 'eff', beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 0.5 }
    useBlockStore.getState().updateNodeBeacons('r1', [a, b])
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    useBlockStore.getState().updateNodeBeacons('r1', [b, a])
    useBlockStore.getState().applyRowSettingsToRecipe('r1', 'beacon')
    expect(rowIn('A', 'r2').beaconConfigs).toEqual([b, a])
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
            ? { ...n, beaconConfigs: [beaconA], modules: [{ moduleId: 'speed', count: 1 }] } as GameRecipeNode
            : n),
          subPlans: b.rootPlan.subPlans.map(sp => sp.id !== 'A' ? sp : {
            ...sp,
            nodes: sp.nodes.map(n => n.id === 'r2'
              ? { ...n, machineId: 'm2', beaconConfigs: [beaconB], modules: [{ count: 1, moduleId: 'speed' }] } as GameRecipeNode
              : n),
            subPlans: sp.subPlans.map(g => ({
              ...g,
              nodes: g.nodes.map(n => ({ ...n, machineId: 'm2', beaconConfigs: [beaconB], modules: [{ count: 1, moduleId: 'speed' }] }) as GameRecipeNode),
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

// ---------------------------------------------------------------------------
// Nesting limit
// ---------------------------------------------------------------------------

describe('nesting limit', () => {
  /** A chain of groups g1 ⊃ … ⊃ g<levels> under the root; `leaf` rows go in the deepest. */
  function setChain(levels: number, extraRoot: RecipeNode[] = []) {
    let inner: SubPlan = { ...makeEmptySubPlan(`g${levels}`), id: `g${levels}`, nodes: [{ ...ironNode, id: 'leaf' }] }
    for (let i = levels - 1; i >= 1; i--) {
      inner = {
        ...makeEmptySubPlan(`g${i}`), id: `g${i}`,
        nodes: [{ kind: 'subplan', id: `h${i + 1}`, subPlanId: `g${i + 1}` }], subPlans: [inner],
      }
    }
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({
      blocks: [{
        ...block,
        rootPlan: { ...block.rootPlan, nodes: [{ kind: 'subplan', id: 'h1', subPlanId: 'g1' }, ...extraRoot], subPlans: [inner] },
      }],
    })
  }
  const root = () => useBlockStore.getState().blocks[0].rootPlan

  it('refuses to move a row into a plan already four groups deep', () => {
    setChain(5, [{ ...ironNode, id: 'r' }])
    useBlockStore.getState().moveNode('r', 'g5', 0)
    expect(root().nodes.map(n => n.id)).toContain('r')
    useBlockStore.getState().moveNode('r', 'g4', 0)
    expect(findSubPlan(root(), 'g4')!.nodes.map(n => n.id)).toContain('r')
  })

  it('counts the height of a moved group', () => {
    // m1 ⊃ m2 ⊃ row: height 2.
    const m2 = { ...makeEmptySubPlan('m2'), id: 'm2', nodes: [{ ...ironNode, id: 'mleaf' }] }
    const m1 = { ...makeEmptySubPlan('m1'), id: 'm1', nodes: [{ kind: 'subplan' as const, id: 'hm2', subPlanId: 'm2' }], subPlans: [m2] }
    setChain(3, [{ kind: 'subplan', id: 'hm1', subPlanId: 'm1' } as unknown as RecipeNode])
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, subPlans: [...block.rootPlan.subPlans, m1] } }] })
    useBlockStore.getState().moveNode('hm1', 'g3', 0) // 3 + 2 > 4
    expect(root().nodes.map(n => n.id)).toContain('hm1')
    useBlockStore.getState().moveNode('hm1', 'g2', 0) // 2 + 2 = 4
    expect(findSubPlan(root(), 'g2')!.nodes.map(n => n.id)).toContain('hm1')
  })

  it('still reorders inside a plan that is already too deep', () => {
    setChain(6)
    const g6 = findSubPlan(root(), 'g6')!
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => ({
        ...b,
        rootPlan: {
          ...b.rootPlan,
          subPlans: [(function patch(p: SubPlan): SubPlan {
            return p.id === 'g6' ? { ...g6, nodes: [...g6.nodes, { ...ironNode, id: 'second' }] } : { ...p, subPlans: p.subPlans.map(patch) }
          })(b.rootPlan.subPlans[0])],
        },
      })),
    }))
    useBlockStore.getState().moveNode('second', 'g6', 0)
    expect(findSubPlan(root(), 'g6')!.nodes.map(n => n.id)).toEqual(['second', 'leaf'])
  })

  it('refuses to wrap a row or add a sub-factory too deep', () => {
    setChain(4)
    useBlockStore.getState().wrapNodeInSubPlan('leaf', 'Wrapper')
    expect(findSubPlan(root(), 'g4')!.nodes.map(n => n.id)).toEqual(['leaf'])
    useBlockStore.getState().addSubPlan('g4', 'Nope')
    expect(findSubPlan(root(), 'g4')!.subPlans).toHaveLength(0)
    useBlockStore.getState().addSubPlan('g3', 'Fine')
    expect(findSubPlan(root(), 'g3')!.subPlans).toHaveLength(2)
  })
})
