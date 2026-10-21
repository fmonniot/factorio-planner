import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModulePopover, ModuleCell, isModuleAllowedInMachine, isModuleAllowedForRecipe, isModuleAllowedByProductivity } from './ModulePopover'
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

describe('isModuleAllowedByProductivity', () => {
  it('allows a productivity module when the recipe allows productivity', () => {
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0.1, speed: -0.15 } }, true)).toBe(true)
  })

  it('blocks a productivity module when the recipe disallows productivity', () => {
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0.1, speed: -0.15 } }, false)).toBe(false)
  })

  it('allows a module without a positive productivity effect whatever the recipe', () => {
    expect(isModuleAllowedByProductivity({ effects: { speed: 0.5 } }, false)).toBe(true)
    expect(isModuleAllowedByProductivity({ effects: { productivity: 0, speed: 0.5 } }, false)).toBe(true)
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
  recipes: {},
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

describe('ModuleCell', () => {
  const makeData = () => ({
    items: {}, recipes: {}, machines: {}, beacons: {}, defaultMachines: {}, technologies: {},
    startingRecipes: [], modules: { 'speed-3': speedModule },
  } as unknown as GameData)

  it('renders the slot text with zero slots when a module is configured', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(screen.getByText('1/0')).toBeInTheDocument()
  })

  it('renders nothing with zero slots and no modules', () => {
    const { container } = render(<ModuleCell modules={[]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  const cell = () => screen.getByRole('button')
  const noop = () => {}

  it('does not claim a missing machine on a real machine with zero slots', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Edit modules (this machine has no module slots)')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
  })

  it('flags modules without a machine when the row has no machine', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} noMachine gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Modules without a machine')
    expect(cell()).toHaveAttribute('data-beyond-horizon', 'true')
    expect(cell()).not.toHaveAttribute('data-over-slots')
  })

  it('flags more modules than slots', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 4 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
    expect(cell()).toHaveAttribute('title', 'Edit modules (more modules than slots)')
    expect(cell()).toHaveClass('ring-amber-500')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
  })

  it('is not flagged when the modules fit', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 2 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Edit modules')
    expect(cell()).not.toHaveAttribute('data-over-slots')
    expect(cell()).not.toHaveClass('ring-amber-500')
  })
})

describe('ModulePopover — productivity modules', () => {
  const prodModule = {
    ...speedModule,
    id: 'prod-3',
    name: 'Prod 3',
    effects: { productivity: 0.1, speed: -0.15 },
  }

  function renderPopover(allowProductivity: boolean) {
    const gameData = {
      modules: { 'speed-3': speedModule, 'prod-3': prodModule },
      recipes: { 'iron-plate': { id: 'iron-plate', allowProductivity } },
    } as unknown as GameData
    render(
      <ModulePopover
        nodeId="n1"
        modules={[]}
        machineSlots={4}
        allowedMachineEffects={['speed', 'consumption', 'productivity']}
        recipeId="iron-plate"
        gameData={gameData}
        onClose={() => {}}
      />
    )
  }

  it('hides productivity modules from the add dropdown when the recipe disallows productivity', () => {
    renderPopover(false)
    expect(screen.getByRole('option', { name: 'Speed 3' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Prod 3' })).not.toBeInTheDocument()
  })

  it('offers productivity modules when the recipe allows productivity', () => {
    renderPopover(true)
    expect(screen.getByRole('option', { name: 'Prod 3' })).toBeInTheDocument()
  })
})
