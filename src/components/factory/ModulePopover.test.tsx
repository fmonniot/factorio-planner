import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModulePopover, isModuleAllowedInMachine, isModuleAllowedForRecipe } from './ModulePopover'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, GameRecipeNode, RecipeNode } from '../../data/types'

// ---------------------------------------------------------------------------
// Pure logic helpers
// ---------------------------------------------------------------------------

describe('isModuleAllowedInMachine', () => {
  it('allows module when all its effects are permitted', () => {
    const module = { effects: { speed: 0.5, consumption: 0.15 } }
    const machine = { allowedEffects: ['speed', 'consumption', 'productivity'] }
    expect(isModuleAllowedInMachine(module, machine)).toBe(true)
  })

  it('blocks module when an effect is not permitted', () => {
    const module = { effects: { productivity: 0.1 } }
    const machine = { allowedEffects: ['speed', 'consumption'] }
    expect(isModuleAllowedInMachine(module, machine)).toBe(false)
  })
})

describe('isModuleAllowedForRecipe', () => {
  it('allows when limitation list is empty', () => {
    expect(isModuleAllowedForRecipe({ limitation: [], limitationBlacklist: [] }, 'iron-plate')).toBe(true)
  })

  it('allows when recipeId is in limitation list', () => {
    expect(isModuleAllowedForRecipe({ limitation: ['iron-plate'], limitationBlacklist: [] }, 'iron-plate')).toBe(true)
  })

  it('blocks when recipeId is NOT in non-empty limitation list', () => {
    expect(isModuleAllowedForRecipe({ limitation: ['copper-plate'], limitationBlacklist: [] }, 'iron-plate')).toBe(false)
  })

  it('blocks when recipeId is in blacklist', () => {
    expect(isModuleAllowedForRecipe({ limitation: [], limitationBlacklist: ['iron-plate'] }, 'iron-plate')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ModulePopover — mutation flow
// ---------------------------------------------------------------------------

const speedModule = {
  id: 'speed-3',
  name: 'Speed 3',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  hidden: false,
  tier: 3,
  qualityId: undefined,
}

const mockGameData = {
  modules: { 'speed-3': speedModule },
} as unknown as GameData

const existingModule: GameRecipeNode['modules'][0] = { moduleId: 'speed-3', count: 2 }

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    history: {},
  })
})

describe('ModulePopover', () => {
  it('shows slot usage', () => {
    render(
      <ModulePopover
        nodeId="n1"
        modules={[existingModule]}
        machineSlots={4}
        allowedMachineEffects={['speed', 'consumption']}
        recipeId="iron-plate"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('2/4')).toBeInTheDocument()
  })

  it('calls updateNodeModules when decrement button is clicked', () => {
    const node: RecipeNode = {
      kind: 'game-recipe',
      id: 'n1',
      recipeId: 'iron-plate',
      modules: [existingModule],
      byproductPolicy: {},
    }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [node] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })

    render(
      <ModulePopover
        nodeId="n1"
        modules={[existingModule]}
        machineSlots={4}
        allowedMachineEffects={['speed', 'consumption']}
        recipeId="iron-plate"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )

    const decrementBtn = screen.getByLabelText('Remove one')
    fireEvent.click(decrementBtn)

    // count 2 → 1
    const updatedNode = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updatedNode.kind === 'game-recipe') {
      expect(updatedNode.modules[0].count).toBe(1)
    }
  })
})
