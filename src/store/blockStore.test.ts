import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBlockStore,
  makeEmptyBlock,
  makeEmptySubPlan,
  getActiveSubPlanFromFloor,
  findSubPlan,
} from './blockStore'
import { useUiStore } from './uiStore'
import type { BlockStoreState } from './blockStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): BlockStoreState {
  return useBlockStore.getState()
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
  useUiStore.setState({ rateUnit: 'min', activeFloorPath: [] })
})

// ---------------------------------------------------------------------------
// getActiveSubPlanFromFloor
// ---------------------------------------------------------------------------

describe('getActiveSubPlanFromFloor', () => {
  it('returns the root subplan when floorPath is empty', () => {
    const state = freshState()
    const result = getActiveSubPlanFromFloor(state, [])
    const block = state.blocks.find(b => b.id === state.activeBlockId)!
    expect(result).toBeDefined()
    expect(result!.id).toBe(block.rootPlan.id)
  })

  it('falls back to activeSubPlanId when floorPath is empty', () => {
    const block = makeEmptyBlock('Block 2')
    const child = makeEmptySubPlan('Child')
    const blockWithChild = {
      ...block,
      rootPlan: {
        ...block.rootPlan,
        subPlans: [child],
      },
    }
    useBlockStore.setState({
      blocks: [blockWithChild],
      activeBlockId: blockWithChild.id,
      activeSubPlanId: child.id,
      history: {},
    })
    const state = useBlockStore.getState()
    const result = getActiveSubPlanFromFloor(state, [])
    expect(result!.id).toBe(child.id)
  })

  it('resolves the last id in a single-element floorPath', () => {
    const block = makeEmptyBlock('Block')
    const child = makeEmptySubPlan('Child')
    const blockWithChild = {
      ...block,
      rootPlan: { ...block.rootPlan, subPlans: [child] },
    }
    useBlockStore.setState({
      blocks: [blockWithChild],
      activeBlockId: blockWithChild.id,
      activeSubPlanId: blockWithChild.rootPlan.id,
      history: {},
    })
    const state = useBlockStore.getState()
    const result = getActiveSubPlanFromFloor(state, [child.id])
    expect(result!.id).toBe(child.id)
  })

  it('resolves the last id in a deep floorPath', () => {
    const block = makeEmptyBlock('Block')
    const grandchild = makeEmptySubPlan('Grandchild')
    const child = { ...makeEmptySubPlan('Child'), subPlans: [grandchild] }
    const blockWithTree = {
      ...block,
      rootPlan: { ...block.rootPlan, subPlans: [child] },
    }
    useBlockStore.setState({
      blocks: [blockWithTree],
      activeBlockId: blockWithTree.id,
      activeSubPlanId: blockWithTree.rootPlan.id,
      history: {},
    })
    const state = useBlockStore.getState()
    const result = getActiveSubPlanFromFloor(state, [child.id, grandchild.id])
    expect(result!.id).toBe(grandchild.id)
  })

  it('returns undefined when the id in floorPath does not exist', () => {
    const state = freshState()
    const result = getActiveSubPlanFromFloor(state, ['nonexistent-id'])
    expect(result).toBeUndefined()
  })

  it('returns undefined when there is no active block', () => {
    useBlockStore.setState({
      blocks: [],
      activeBlockId: 'gone',
      activeSubPlanId: 'gone',
      history: {},
    })
    const state = useBlockStore.getState()
    const result = getActiveSubPlanFromFloor(state, [])
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// findSubPlan (sanity check — used internally and by selectors)
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
