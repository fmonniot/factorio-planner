import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { ModuleCell } from './ModuleCell'
import { mostUsedModule } from '../../data/mostUsedModule'
import type { GameData, GameRecipeNode } from '../../data/types'

const makeSpeedModule = () => ({
  id: 'speed-3',
  name: 'Speed 3',
  category: 'speed',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  hidden: false,
  tier: 3,
  qualityId: undefined,
})

describe('ModuleCell', () => {
  const makeData = () => ({
    items: {}, recipes: {}, machines: {}, beacons: {}, defaultMachines: {}, technologies: {},
    startingRecipes: [], modules: { 'speed-3': makeSpeedModule() },
  } as unknown as GameData)

  it('renders the slot text with zero slots when a module is configured', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(screen.getByText('1/0')).toBeInTheDocument()
  })

  it('renders nothing with zero slots and no modules', () => {
    const { container } = render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  const cell = () => screen.getByRole('button')

  it('offers to fill every slot on the dashed chip, with no native title', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[]} machineSlots={2} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(screen.getByTestId('module-chip')).toHaveAttribute('aria-label', 'Fill all 2 slots with a module')
    expect(screen.getByTestId('module-chip')).not.toHaveAttribute('title')
  })
  const noop = () => {}

  it('does not claim a missing machine on a real machine with zero slots', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('aria-label', 'Edit modules (this machine has no module slots)')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
  })

  it('flags modules without a machine when the row has no machine', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} noMachine gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('aria-label', 'Modules without a machine')
    expect(cell()).toHaveAttribute('data-beyond-horizon', 'true')
    expect(cell()).not.toHaveAttribute('data-over-slots')
  })

  it('flags more modules than slots', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 4 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
    expect(cell()).toHaveAttribute('aria-label', 'Edit modules (more modules than slots)')
    expect(cell()).toHaveClass('ring-amber-500')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
  })

  it('flags a stored module whose category the machine does not list, and not without a list', () => {
    const gd = makeData()
    gd.modules['agri'] = { ...makeSpeedModule(), id: 'agri', name: 'Agriculture module', category: 'angels-bio-yield', iconPath: '', effects: { speed: 0.1 } }
    const props = { nodeId: 'n1', recipeId: 'r', modules: [{ moduleId: 'agri', count: 1 }], machineSlots: 2, gameData: gd, onOpenEdit: noop }
    const { rerender } = render(<ModuleCell {...props} machine={{ allowedEffects: ['speed'], allowedModuleCategories: ['speed'] }} />)
    expect(cell()).toHaveAttribute('data-incompatible', 'true')
    expect(cell()).toHaveAttribute('aria-label', 'Edit modules (a module does not fit this machine)')
    expect(cell()).toHaveClass('ring-amber-500')
    rerender(<ModuleCell {...props} machine={{ allowedEffects: ['speed'] }} />)
    expect(cell()).not.toHaveAttribute('data-incompatible')
    expect(cell()).toHaveAttribute('aria-label', 'Edit modules')
  })

  it('is not flagged when the modules fit', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 2 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('aria-label', 'Edit modules')
    expect(cell()).not.toHaveAttribute('data-over-slots')
    expect(cell()).not.toHaveClass('ring-amber-500')
  })
})

describe('ModuleCell chip', () => {
  const gd = () => ({
    items: {}, recipes: {}, machines: {}, beacons: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
    modules: { 'speed-3': makeSpeedModule(), 'eff-1': { ...makeSpeedModule(), id: 'eff-1', name: 'Efficiency 1', iconPath: '/e.png' } },
  } as unknown as GameData)

  it('shows an empty machine as a dashed plus reading 0/N', () => {
    const { container } = render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[]} machineSlots={4} gameData={gd()} onOpenEdit={() => {}} />)
    expect(screen.getByText('0/4')).toBeInTheDocument()
    expect(container.querySelector('.border-dashed')).not.toBeNull()
  })

  it('shows the most used module type, the first by id on a tie', () => {
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 3 }])).toBe('eff-1')
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 2 }, { moduleId: 'eff-1', count: 2 }])).toBe('eff-1')
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'speed-3', count: 2 }, { moduleId: 'eff-1', count: 2 }])).toBe('speed-3')
    expect(mostUsedModule([])).toBeUndefined()
  })

  it('draws used/slots in the bottom-right corner', () => {
    render(<ModuleCell nodeId="n1" recipeId="r" machine={undefined} modules={[{ moduleId: 'speed-3', count: 2 }]} machineSlots={4} gameData={gd()} onOpenEdit={() => {}} />)
    expect(screen.getByText('2/4')).toHaveClass('right-0', 'bottom-0')
  })
})

describe('ModuleCell shortcuts', () => {
  const data = () => ({
    items: {}, recipes: { r: { id: 'r', allowProductivity: false } }, machines: {}, beacons: {}, defaultMachines: {}, technologies: {},
    startingRecipes: [],
    modules: {
      'speed-3': makeSpeedModule(),
      'prod-3': { ...makeSpeedModule(), id: 'prod-3', name: 'Prod 3', effects: { productivity: 0.1, speed: -0.15 } },
    },
  } as unknown as GameData)
  const machine = { allowedEffects: ['speed', 'consumption', 'productivity'] }

  beforeEach(() => {
    const block = makeEmptyBlock('T')
    const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'r', modules: [], byproductPolicy: {} }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [node] } }], activeBlockId: block.id, history: {}, horizonTechnologyIds: [] })
  })

  it('opens a fill-all picker from the empty chip and fills every slot with the choice', () => {
    const onOpenEdit = vi.fn()
    render(<ModuleCell nodeId="n1" recipeId="r" machine={machine} modules={[]} machineSlots={4} gameData={data()} onOpenEdit={onOpenEdit} />)
    fireEvent.click(screen.getByTestId('module-chip'))
    expect(onOpenEdit).not.toHaveBeenCalled()
    expect(screen.getByTestId('picker-heading')).toHaveTextContent('Fill all 4 slots with')
    // The recipe does not allow productivity.
    expect(screen.getAllByTestId('module-fill-option').map(o => o.getAttribute('data-module-id'))).toEqual(['speed-3'])
    fireEvent.click(screen.getByText('Speed 3'))
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.modules).toEqual([{ moduleId: 'speed-3', count: 4 }])
    expect(screen.queryByTestId('picker')).toBeNull()
  })

  it('leaves a module out of the fill-all picker when the machine does not list its category', () => {
    const gd = data()
    gd.modules['agri'] = { ...makeSpeedModule(), id: 'agri', name: 'Agriculture module', category: 'angels-bio-yield', iconPath: '' }
    const listed = { ...machine, allowedModuleCategories: ['speed'] }
    render(<ModuleCell nodeId="n1" recipeId="r" machine={listed} modules={[]} machineSlots={2} gameData={gd} onOpenEdit={() => {}} />)
    fireEvent.click(screen.getByTestId('module-chip'))
    expect(screen.getAllByTestId('module-fill-option').map(o => o.getAttribute('data-module-id'))).toEqual(['speed-3'])
  })

  it('offers productivity modules when the recipe allows productivity', () => {
    const gd = data()
    gd.recipes.r.allowProductivity = true
    render(<ModuleCell nodeId="n1" recipeId="r" machine={machine} modules={[]} machineSlots={2} gameData={gd} onOpenEdit={() => {}} />)
    fireEvent.click(screen.getByTestId('module-chip'))
    expect(screen.getAllByTestId('module-fill-option').map(o => o.getAttribute('data-module-id'))).toEqual(['prod-3', 'speed-3'])
  })

  it('does not reopen the picker when the chip empties again after holding modules', () => {
    const props = { nodeId: 'n1', recipeId: 'r', machine, machineSlots: 4, gameData: data(), onOpenEdit: () => {} }
    const { rerender } = render(<ModuleCell {...props} modules={[]} />)
    fireEvent.click(screen.getByTestId('module-chip'))
    expect(screen.getByTestId('picker')).toBeInTheDocument()
    rerender(<ModuleCell {...props} modules={[{ moduleId: 'speed-3', count: 1 }]} />)
    expect(screen.queryByTestId('picker')).toBeNull()
    rerender(<ModuleCell {...props} modules={[]} />)
    expect(screen.queryByTestId('picker')).toBeNull()
  })

  it('opens the panel instead of a picker when the chip holds modules', () => {
    const onOpenEdit = vi.fn()
    render(<ModuleCell nodeId="n1" recipeId="r" machine={machine} modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={4} gameData={data()} onOpenEdit={onOpenEdit} />)
    fireEvent.click(screen.getByTestId('module-chip'))
    expect(onOpenEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('picker')).toBeNull()
  })
})
