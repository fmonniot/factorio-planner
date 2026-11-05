import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MachineSection } from './MachineSection'
import { useBlockStore, makeEmptyBlock } from '../../../store/blockStore'
import { useGameDataStore } from '../../../store/gameDataStore'
import { useUiStore } from '../../../store/uiStore'
import type { GameData, GameRecipeNode, ModuleConfig } from '../../../data/types'

/** The old modal's props, as the section's node: keeps the scenarios below readable. */
interface SectionProps {
  nodeId?: string
  recipeId?: string
  recipeCategory?: string
  machineId?: string
  machineCountCeil?: number
  modules?: ModuleConfig[]
  neighbourCount?: number
  fuelItemId?: string
  gameData: GameData
  onClose?: () => void
}

function SectionHarness({ nodeId = 'n1', recipeId = 'plate', machineId, machineCountCeil = 1, modules = [], neighbourCount, fuelItemId, gameData }: SectionProps) {
  const node: GameRecipeNode = {
    kind: 'game-recipe', id: nodeId, recipeId, modules, byproductPolicy: {},
    ...(machineId !== undefined && { machineId }),
    ...(neighbourCount !== undefined && { neighbourCount }),
    ...(fuelItemId !== undefined && { fuelItemId }),
  }
  const solved = { recipeNodeId: nodeId, inputRates: {}, outputRates: {}, throughput: 1, machineCountExact: machineCountCeil, machineCountCeil, powerKw: 0 }
  return <MachineSection node={node} solved={solved} gameData={gameData} />
}

function recipe(id: string, name: string): GameData['recipes'][string] {
  return {
    id, name, category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    madeIn: ['assembler'], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '',
  }
}

function item(id: string, placeResult?: string): GameData['items'][string] {
  return { id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', placeResult }
}

function producer(id: string, product: string): GameData['recipes'][string] {
  return { ...recipe(id, id), products: [{ itemId: product, type: 'item', amount: 1 }] }
}

function machine(id: string, name: string, craftingSpeed: number): GameData['machines'][string] {
  return {
    id, name, type: 'assembling-machine', craftingSpeed, energyUsageKw: 75,
    energyType: 'electric', drainKw: 0, moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'],
    iconPath: '', hidden: false,
  }
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      assembler: item('assembler', 'assembler'),
      'assembler-2': item('assembler-2', 'assembler-2'),
      speed: item('speed'),
    },
    recipes: {
      plate: recipe('plate', 'Plate'),
      'plate-alt': recipe('plate-alt', 'Plate (alternate)'),
      'r-asm1': producer('r-asm1', 'assembler'),
      'r-asm2': producer('r-asm2', 'assembler-2'),
      'r-speed': producer('r-speed', 'speed'),
    },
    machines: {
      assembler: machine('assembler', 'Assembler', 1),
      'assembler-2': machine('assembler-2', 'Assembler 2', 2),
    },
    modules: {
      speed: { id: 'speed', name: 'Speed', category: 'speed', tier: 1, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '' },
    },
    beacons: {},
    defaultMachines: { crafting: 'assembler-2' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['plate'], iconPath: '' },
      asm: { id: 'asm', name: 'Asm', prerequisites: [], unlockedRecipes: ['r-asm1'], iconPath: '' },
      alt: { id: 'alt', name: 'Alt', prerequisites: [], unlockedRecipes: ['plate-alt', 'r-asm2', 'r-speed'], iconPath: '' },
    },
    startingRecipes: [],
  }
}

function renderModal(
  gameData: GameData,
  props: Partial<SectionProps> = {},
) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
  render(
    <SectionHarness
      nodeId="n1"
      recipeId="plate"
      recipeCategory="crafting"
      machineId={undefined}
      machineCountCeil={1}
      modules={[]}
      gameData={gameData}
      onClose={() => {}}
      {...props}
    />,
  )
  openMachinePicker()
}

const openMachinePicker = () => fireEvent.click(screen.getByTestId('machine-picker-button'))

const openSlot = (i: number) => fireEvent.click(screen.getAllByTestId('module-slot')[i])
const moduleOptionIds = () => screen.queryAllByTestId('module-option').map(e => e.getAttribute('data-module-id'))
const optionIds = () => screen.queryAllByTestId('machine-option').map(e => e.getAttribute('data-machine-id'))

beforeEach(() => {
  useBlockStore.setState({ horizonTechnologyIds: [], defaultMachineOverrides: {} })
  useUiStore.setState({ defaultMachinesRequest: null })
})

describe('MachineSection — alternate recipes and the research horizon', () => {
  it('omits an alternate recipe outside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderModal(makeGameData())
    expect(screen.queryByText('Plate (alternate)')).not.toBeInTheDocument()
  })

  it('lists the alternate recipe when it is inside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'alt'] })
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })

  it('lists the alternate recipe without targets', () => {
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })
})

describe('MachineSection — machines, modules and the research horizon', () => {
  it('lists only machines within the horizon and shows the horizon default', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData())
    expect(optionIds()).toEqual(['assembler'])
    expect(screen.getByText('Assembler', { selector: 'span' })).toBeInTheDocument()
  })

  it('lists a later machine once its technology is in the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm', 'alt'] })
    renderModal(makeGameData())
    expect(optionIds()).toContain('assembler-2')
  })

  it('keeps an explicit machine beyond the horizon, flagged and not selectable', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData(), { machineId: 'assembler-2' })
    expect(screen.getByText(/Assembler 2/)).toBeInTheDocument()
    expect(screen.getByTestId('beyond-horizon')).toBeInTheDocument()
    expect(optionIds()).not.toContain('assembler-2')
  })

  it('reports no machine within the horizon and an empty picker, keeping alternate recipes', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['plate', 'plate-alt']
    renderModal(gd)
    expect(screen.getByTestId('no-machine-in-horizon')).toBeVisible()
    expect(screen.getByTestId('machine-picker-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('machine-option')).not.toBeInTheDocument()
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })

  it('lets configured modules be removed but not added without a machine', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{
        ...block,
        rootPlan: {
          ...block.rootPlan,
          nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules: [{ moduleId: 'speed', count: 1 }], byproductPolicy: {} }],
        },
      }],
      activeBlockId: block.id,
      history: {},
    })
    renderModal(makeGameData(), { modules: [{ moduleId: 'speed', count: 1 }] })
    expect(screen.getByTestId('beyond-horizon')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('module-slot'))
    expect(screen.queryAllByTestId('module-option'), 'nothing can be added without a machine').toHaveLength(0)
    fireEvent.click(screen.getByTestId('module-option-empty'))
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.modules).toEqual([])
  })

  it('offers a module only once it is inside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData())
    openSlot(0)
    expect(moduleOptionIds(), 'no speed option before its technology').toEqual([])
  })

  it('offers the module in a slot picker within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm', 'alt'] })
    renderModal(makeGameData())
    openSlot(0)
    expect(moduleOptionIds()).toEqual(['speed'])
  })
})

describe('MachineSection — productivity modules', () => {
  function gameDataWithProdModule(allowProductivity: boolean): GameData {
    const gd = makeGameData()
    gd.modules.prod = {
      id: 'prod', name: 'Prod', category: 'productivity', tier: 1,
      effects: { productivity: 0.1, speed: -0.15 }, limitation: [], limitationBlacklist: [], iconPath: '',
    }
    gd.machines['assembler-2'].allowedEffects = ['speed', 'productivity']
    gd.recipes.plate.allowProductivity = allowProductivity
    return gd
  }

  it('hides productivity modules from the slot picker when the recipe disallows productivity', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    renderModal(gameDataWithProdModule(false))
    openSlot(0)
    expect(moduleOptionIds()).toEqual(['speed'])
  })

  it('offers productivity modules when the recipe allows productivity', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    renderModal(gameDataWithProdModule(true))
    openSlot(0)
    expect(moduleOptionIds()).toEqual(['prod', 'speed'])
  })
})

describe('MachineSection — default machine per category', () => {
  const nodeWith = (id: string, machineId?: string) => ({
    kind: 'game-recipe' as const, id, recipeId: 'plate', machineId, modules: [], byproductPolicy: {},
  })
  function setNodes(...nodes: ReturnType<typeof nodeWith>[]) {
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes } }],
      activeBlockId: block.id,
      history: {},
    })
  }
  const optionRow = (id: string) => screen.getAllByTestId('machine-option').find(e => e.getAttribute('data-machine-id') === id)!.parentElement!

  it('badges the horizon default machine and offers "Make default" on the others', () => {
    renderModal(makeGameData())
    expect(within(optionRow('assembler-2')).getByTestId('default-machine-badge')).toBeInTheDocument()
    expect(within(optionRow('assembler')).queryByTestId('default-machine-badge')).not.toBeInTheDocument()
    expect(within(optionRow('assembler')).getByRole('button', { name: 'Make Assembler the Crafting default' })).toBeInTheDocument()
  })

  it('labels the Default option with the effective machine', () => {
    renderModal(makeGameData())
    expect(screen.getByRole('button', { name: 'Default (Assembler 2)' })).toBeInTheDocument()
  })

  it('"Make default" sets the override, resets the row to Default and moves the badge', () => {
    setNodes(nodeWith('n1', 'assembler-2'))
    renderModal(makeGameData(), { machineId: 'assembler-2' })
    fireEvent.click(screen.getByRole('button', { name: 'Make Assembler the Crafting default' }))
    expect(useBlockStore.getState().defaultMachineOverrides).toEqual({ crafting: 'assembler' })
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.machineId).toBeUndefined()
    openMachinePicker()
    expect(within(optionRow('assembler')).getByTestId('default-machine-badge')).toBeInTheDocument()
    expect(within(optionRow('assembler-2')).queryByTestId('default-machine-badge')).not.toBeInTheDocument()
  })

  it('reports how many rows follow the category default', () => {
    setNodes(nodeWith('n1'), nodeWith('n2'), nodeWith('n3', 'assembler'))
    renderModal(makeGameData())
    expect(screen.getByTestId('default-machine-usage')).toHaveTextContent('Crafting default is used by 2 rows')
  })

  it('"All defaults…" requests the default machines menu', () => {
    renderModal(makeGameData())
    fireEvent.click(screen.getByRole('button', { name: 'All defaults…' }))
    expect(useUiStore.getState().defaultMachinesRequest).toEqual({ seq: 1, category: 'crafting' })
  })
})

describe('MachineSection — module counts and slots', () => {
  function gameDataWithSlots(slots: number): GameData {
    const gd = makeGameData()
    gd.machines['assembler-2'].moduleSlots = slots
    return gd
  }
  function setModules(modules: { moduleId: string; count: number }[]) {
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{
        ...block,
        rootPlan: {
          ...block.rootPlan,
          nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules, byproductPolicy: {} }],
        },
      }],
      activeBlockId: block.id,
      history: {},
    })
  }
  const storedModules = () => {
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    return node.kind === 'game-recipe' ? node.modules : undefined
  }

  it('shows one button per slot, filled in list order, and the slot usage', () => {
    setModules([{ moduleId: 'speed', count: 2 }])
    renderModal(gameDataWithSlots(4), { modules: [{ moduleId: 'speed', count: 2 }] })
    const slots = screen.getAllByTestId('module-slot')
    expect(slots).toHaveLength(4)
    expect(slots.map(e => e.getAttribute('aria-label'))).toEqual([
      'Machine module slot 1: Speed', 'Machine module slot 2: Speed', 'Machine module slot 3: empty', 'Machine module slot 4: empty',
    ])
    expect(screen.getByText('2 / 4 slots used')).toBeInTheDocument()
  })

  it('fills an empty slot from its picker', () => {
    setModules([{ moduleId: 'speed', count: 1 }])
    renderModal(gameDataWithSlots(4), { modules: [{ moduleId: 'speed', count: 1 }] })
    openSlot(1)
    fireEvent.click(screen.getByTestId('module-option'))
    expect(storedModules()).toEqual([{ moduleId: 'speed', count: 2 }])
  })

  it('empties a slot', () => {
    setModules([{ moduleId: 'speed', count: 2 }])
    renderModal(gameDataWithSlots(4), { modules: [{ moduleId: 'speed', count: 2 }] })
    openSlot(0)
    fireEvent.click(screen.getByTestId('module-option-empty'))
    expect(storedModules()).toEqual([{ moduleId: 'speed', count: 1 }])
  })

  it('closes the slot picker on Esc and on a click away', () => {
    setModules([])
    renderModal(gameDataWithSlots(2))
    openSlot(0)
    expect(screen.getByTestId('module-option-empty')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('module-option-empty')).not.toBeInTheDocument()
    openSlot(0)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('module-option-empty')).not.toBeInTheDocument()
  })

  it('draws modules beyond the machine slots as amber overflow slots', () => {
    setModules([{ moduleId: 'speed', count: 3 }])
    renderModal(gameDataWithSlots(2), { modules: [{ moduleId: 'speed', count: 3 }] })
    const slots = screen.getAllByTestId('module-slot')
    expect(slots).toHaveLength(3)
    expect(slots[2]).toHaveAttribute('data-overflow', 'true')
    expect(slots[2]).toHaveClass('ring-amber-500')
    expect(slots[1]).not.toHaveAttribute('data-overflow')
    expect(screen.getByText('3 / 2 slots used')).toHaveClass('text-amber-400')
  })

  it('shows the machines needed and how busy they are', () => {
    setModules([])
    useGameDataStore.setState({ status: { type: 'loaded', gameData: makeGameData(), sourceId: 'test' } })
    const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules: [], byproductPolicy: {} }
    render(
      <MachineSection
        node={node}
        solved={{ recipeNodeId: 'n1', inputRates: {}, outputRates: {}, throughput: 1, machineCountExact: 2.37, machineCountCeil: 3, powerKw: 0 }}
        gameData={makeGameData()}
      />,
    )
    expect(screen.getByTestId('machine-needed')).toHaveTextContent('3 needed')
    expect(screen.getByTestId('machine-utilisation')).toHaveTextContent('2.37 exact · 79% busy')
  })
})

describe('MachineSection — apply to every row of the recipe', () => {
  const plateRow = (id: string, extra: Partial<GameRecipeNode> = {}): GameRecipeNode =>
    ({ kind: 'game-recipe', id, recipeId: 'plate', modules: [], byproductPolicy: {}, ...extra })

  function renderWithRows(rows: GameRecipeNode[]) {
    const gameData = makeGameData()
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: rows } }],
      activeBlockId: block.id,
      history: {},
    })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    render(
      <SectionHarness
        nodeId="n1"
        recipeId="plate"
        recipeCategory="crafting"
        machineId="assembler"
        machineCountCeil={1}
        modules={[{ moduleId: 'speed', count: 1 }]}
        gameData={gameData}
        onClose={() => {}}
      />,
    )
  }
  const rows = () => useBlockStore.getState().blocks[0].rootPlan.nodes as GameRecipeNode[]

  it('copies machine and modules to the other rows of the recipe and stays open', () => {
    renderWithRows([
      plateRow('n1', { machineId: 'assembler', modules: [{ moduleId: 'speed', count: 1 }] }),
      plateRow('n2'),
      plateRow('n3'),
      { ...plateRow('n4'), recipeId: 'plate-alt' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Apply to every row of this recipe (3)' }))
    for (const id of ['n2', 'n3']) {
      const n = rows().find(r => r.id === id)!
      expect(n.machineId).toBe('assembler')
      expect(n.modules).toEqual([{ moduleId: 'speed', count: 1 }])
    }
    expect(rows().find(r => r.id === 'n4')!.machineId, 'another recipe is untouched').toBeUndefined()
    expect(screen.getByRole('button', { name: /Apply to every row/ }), 'the modal stays open').toBeInTheDocument()
  })

  it('has no such button when the recipe has a single row', () => {
    renderWithRows([plateRow('n1', { machineId: 'assembler' })])
    expect(screen.queryByRole('button', { name: /Apply to every row/ })).not.toBeInTheDocument()
  })
})

describe('MachineSection — neighbours', () => {
  function reactorData(neighbourBonus = 1): GameData {
    const gd = makeGameData()
    gd.machines.reactor = {
      id: 'reactor', name: 'Reactor', type: 'reactor', craftingSpeed: 1, energyUsageKw: 0, energyType: 'electric',
      drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['power:reactor'],
      neighbourBonus, iconPath: '', hidden: false,
    }
    gd.recipes['power:reactor:fuel'] = {
      ...recipe('power:reactor:fuel', 'Reactor fuel'),
      category: 'power:reactor',
      products: [{ itemId: 'power:heat', type: 'fluid', amount: 10 }],
      madeIn: ['reactor'],
    }
    gd.defaultMachines['power:reactor'] = 'reactor'
    return gd
  }

  function renderReactor(count?: number, bonus = 1, recipeId = 'power:reactor:fuel') {
    const gameData = reactorData(bonus)
    const block = makeEmptyBlock('Test')
    const row: GameRecipeNode = {
      kind: 'game-recipe', id: 'n1', recipeId, modules: [], byproductPolicy: {},
      ...(count !== undefined && { neighbourCount: count }),
    }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [row] } }],
      activeBlockId: block.id,
      history: {},
    })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    render(
      <SectionHarness
        nodeId="n1"
        recipeId={recipeId}
        recipeCategory={recipeId === 'plate' ? 'crafting' : 'power:reactor'}
        machineId={undefined}
        machineCountCeil={1}
        modules={[]}
        neighbourCount={count}
        gameData={gameData}
        onClose={() => {}}
      />,
    )
  }
  const input = () => screen.getByLabelText('Neighbouring reactors') as HTMLInputElement
  const colsInput = () => screen.getByTestId('neighbour-cols') as HTMLInputElement
  const rowsInput = () => screen.getByTestId('neighbour-rows') as HTMLInputElement
  const stored = () => (useBlockStore.getState().blocks[0].rootPlan.nodes[0] as GameRecipeNode).neighbourCount
  const multiplier = () => screen.getByTestId('neighbour-multiplier').textContent
  const grid = () => screen.getByTestId('neighbour-grid')
  const tiles = () => grid().querySelectorAll('[data-neighbours]')
  const setSize = (cols: string, rows: string) => {
    fireEvent.change(colsInput(), { target: { value: cols } })
    fireEvent.change(rowsInput(), { target: { value: rows } })
  }

  it('starts at 1 × 1 with an average of 0 and a x1 multiplier, without saving', () => {
    renderReactor()
    expect(colsInput().value).toBe('1')
    expect(rowsInput().value).toBe('1')
    expect(input().value).toBe('0')
    expect(multiplier()).toBe('×1')
    expect(screen.getByText('1 reactors in this cluster')).toBeInTheDocument()
    expect(stored()).toBeUndefined()
  })

  it('saves the average when the Wide stepper is used', () => {
    renderReactor()
    fireEvent.click(screen.getByRole('button', { name: 'More columns' }))
    expect(colsInput().value).toBe('2')
    expect(stored()).toBe(1)
    expect(input().value).toBe('1')
    expect(multiplier()).toBe('×2')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer columns' }))
    expect(stored()).toBeUndefined()
  })

  it('disables the steppers at the ends of the range', () => {
    renderReactor()
    expect(screen.getByRole('button', { name: 'Fewer columns' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fewer rows' })).toBeDisabled()
    setSize('30', '30')
    expect(screen.getByRole('button', { name: 'More columns' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More rows' })).toBeDisabled()
  })

  it('applies typed sizes at once and clamps them to 1–30', () => {
    renderReactor()
    setSize('2', '4')
    expect(stored()).toBeCloseTo(2.5, 10)
    expect(input().value).toBe('2.5')
    fireEvent.change(colsInput(), { target: { value: '99' } })
    expect(colsInput().value).toBe('30')
    expect(screen.getByText('120 reactors in this cluster')).toBeInTheDocument()
  })

  it('keeps non-integer size text until blur, then resets it', () => {
    renderReactor()
    setSize('2', '4')
    fireEvent.change(colsInput(), { target: { value: '2.5' } })
    expect(colsInput().value).toBe('2.5')
    expect(stored()).toBeCloseTo(2.5, 10)
    fireEvent.blur(colsInput())
    expect(colsInput().value).toBe('2')
  })

  it('numbers every tile with its neighbour count', () => {
    renderReactor()
    setSize('3', '3')
    const counts = [...tiles()].map(t => Number(t.getAttribute('data-neighbours')))
    expect(counts).toEqual([2, 3, 2, 3, 4, 3, 2, 3, 2])
    expect(grid()).toHaveAccessibleName('3 by 3 cluster, 2.67 neighbours on average')
  })

  it('folds a long axis but still saves the full average', () => {
    renderReactor()
    setSize('6', '6')
    expect(tiles()).toHaveLength(16)
    expect(grid().textContent).toContain('⋯')
    expect(grid().textContent).toContain('⋮')
    expect(grid().textContent).toContain('⋱')
    expect(stored()).toBeCloseTo((2 * (6 * 5 + 6 * 5)) / 36, 10)
    expect(screen.getByText('36 reactors in this cluster')).toBeInTheDocument()
  })

  it('saves an own average, dims the grid and goes back with Use the drawing', () => {
    renderReactor()
    setSize('2', '2')
    fireEvent.change(input(), { target: { value: '3' } })
    expect(stored()).toBe(3)
    expect(multiplier()).toBe('×4')
    expect(grid()).toHaveClass('opacity-30')
    expect(screen.getByText('Not used: you typed your own average below.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use the drawing' }))
    expect(stored()).toBe(2)
    expect(grid()).not.toHaveClass('opacity-30')
    expect(input().value).toBe('2')
  })

  it('leaves own mode when a size changes', () => {
    renderReactor()
    fireEvent.change(input(), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'More rows' }))
    expect(stored()).toBe(1)
    expect(grid()).not.toHaveClass('opacity-30')
  })

  it('clears the stored count when set to 0', () => {
    renderReactor(3)
    fireEvent.change(input(), { target: { value: '0' } })
    expect(stored()).toBeUndefined()
  })

  it('does not save an empty, negative or too large value and reverts on blur', () => {
    renderReactor(2)
    for (const bad of ['', '-1', '5']) {
      fireEvent.change(input(), { target: { value: bad } })
      expect(stored(), bad).toBe(2)
      fireEvent.blur(input())
      expect(input().value, bad).toBe('2')
      expect(grid(), bad).not.toHaveClass('opacity-30')
    }
  })

  it('explains that a reactor has four sides for a value above 4', () => {
    renderReactor(2)
    fireEvent.change(input(), { target: { value: '5' } })
    expect(screen.getByText('A reactor has four sides, so use a number from 0 to 4.')).toBeInTheDocument()
    expect(stored()).toBe(2)
    expect(multiplier()).toBe('×3')
  })

  it('reopens a stored 2.5 as a 2 × 4 drawing', () => {
    renderReactor(2.5)
    expect(colsInput().value).toBe('2')
    expect(rowsInput().value).toBe('4')
    expect(input().value).toBe('2.5')
    expect(multiplier()).toBe('×3.5')
    expect(grid()).not.toHaveClass('opacity-30')
  })

  it('reopens a stored value that no rectangle gives in own mode', () => {
    renderReactor(0.3)
    expect(input().value).toBe('0.3')
    expect(grid()).toHaveClass('opacity-30')
    expect(stored()).toBe(0.3)
  })

  it('keeps and flags a stored value above 4 without rewriting it', () => {
    renderReactor(6)
    expect(input().value).toBe('6')
    expect(screen.getByText('A reactor has four sides, so use a number from 0 to 4.')).toBeInTheDocument()
    expect(stored()).toBe(6)
  })

  it('shows the bonus per neighbour and scales the multiplier by it', () => {
    renderReactor(2, 0.5)
    expect(screen.getByText('+50 %')).toBeInTheDocument()
    expect(multiplier()).toBe('×2')
  })

  it('re-syncs the section when the stored count changes under the modal', () => {
    const gameData = reactorData()
    const props = {
      nodeId: 'n1', recipeId: 'power:reactor:fuel', recipeCategory: 'power:reactor', machineId: undefined,
      machineCountCeil: 1, modules: [], gameData, onClose: () => {},
    }
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'power:reactor:fuel', modules: [], byproductPolicy: {}, neighbourCount: 3 }] } }],
      activeBlockId: block.id,
      history: {},
    })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    const { rerender } = render(<SectionHarness {...props} neighbourCount={3} />)
    expect(colsInput().value).toBe('4')
    expect(rowsInput().value).toBe('4')
    expect(input().value).toBe('3')
    expect(multiplier()).toBe('×4')
    rerender(<SectionHarness {...props} neighbourCount={undefined} />)
    expect(colsInput().value).toBe('1')
    expect(input().value).toBe('0')
    expect(multiplier()).toBe('×1')
  })

  it('does not clobber in-progress text that matches the stored count', () => {
    renderReactor()
    fireEvent.change(input(), { target: { value: '2.' } })
    expect(stored()).toBe(2)
    expect(input().value).toBe('2.')
  })

  it('is absent for a machine without a neighbour bonus', () => {
    renderReactor(undefined, 1, 'plate')
    expect(screen.queryByTestId('neighbour-section')).toBeNull()
  })
})

describe('MachineSection — fuel', () => {
  function fuelItem(id: string, fuelValueKj: number): GameData['items'][string] {
    return { ...item(id), fuelValueKj, fuelCategory: 'chemical' }
  }

  function burnerData(): GameData {
    const gd = makeGameData()
    gd.items = {
      ...gd.items,
      furnace: item('furnace', 'furnace'),
      wood: fuelItem('wood', 2000),
      coal: fuelItem('coal', 4000),
      'solid-fuel': fuelItem('solid-fuel', 12000),
    }
    gd.machines.furnace = {
      ...machine('furnace', 'Furnace', 1), type: 'furnace', energyType: 'burner', energyUsageKw: 90,
      craftingCategories: ['smelting'], fuelCategories: ['chemical'], moduleSlots: 0,
    }
    gd.recipes.smelt = { ...recipe('smelt', 'Smelt'), category: 'smelting', madeIn: ['furnace'] }
    gd.recipes['r-furnace'] = producer('r-furnace', 'furnace')
    gd.recipes['r-wood'] = producer('r-wood', 'wood')
    gd.recipes['r-coal'] = producer('r-coal', 'coal')
    gd.recipes['r-solid-fuel'] = producer('r-solid-fuel', 'solid-fuel')
    gd.defaultMachines.smelting = 'furnace'
    gd.technologies.fire = {
      id: 'fire', name: 'Fire', prerequisites: [],
      unlockedRecipes: ['smelt', 'r-furnace', 'r-wood', 'r-coal'], iconPath: '',
    }
    gd.technologies.chem = { id: 'chem', name: 'Chem', prerequisites: [], unlockedRecipes: ['r-solid-fuel'], iconPath: '' }
    return gd
  }

  function renderBurner(fuelItemId?: string, gameData = burnerData(), rows: GameRecipeNode[] = []) {
    const block = makeEmptyBlock('Test')
    const row: GameRecipeNode = {
      kind: 'game-recipe', id: 'n1', recipeId: 'smelt', modules: [], byproductPolicy: {},
      ...(fuelItemId !== undefined && { fuelItemId }),
    }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [row, ...rows] } }],
      activeBlockId: block.id,
      history: {},
    })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    render(
      <SectionHarness
        nodeId="n1"
        recipeId="smelt"
        recipeCategory="smelting"
        machineId={undefined}
        machineCountCeil={1}
        modules={[]}
        fuelItemId={fuelItemId}
        gameData={gameData}
        onClose={() => {}}
      />,
    )
  }
  const fuelOptionIds = () => screen.queryAllByTestId('fuel-option').map(e => e.getAttribute('data-item-id'))
  const openFuel = () => fireEvent.click(screen.getByTestId('fuel-button'))
  const storedFuel = () => (useBlockStore.getState().blocks[0].rootPlan.nodes[0] as GameRecipeNode).fuelItemId

  it('has no Fuel section for an electric machine', () => {
    renderModal(makeGameData())
    expect(screen.queryByTestId('fuel-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('no-fuel-data')).not.toBeInTheDocument()
  })

  it('shows the default fuel and its value, and lists every accepted fuel without a horizon', () => {
    renderBurner()
    expect(screen.getByTestId('fuel-button')).toHaveTextContent('wood')
    expect(screen.getByTestId('fuel-button')).toHaveTextContent('2 MJ')
    openFuel()
    expect(fuelOptionIds()).toEqual(['wood', 'coal', 'solid-fuel'])
    expect(screen.getByTestId('fuel-default')).toHaveTextContent('Default (wood)')
  })

  it('lists only fuels within the horizon and flags an effective fuel beyond it', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['fire'] })
    renderBurner('solid-fuel')
    expect(screen.getByTestId('beyond-horizon')).toBeInTheDocument()
    openFuel()
    expect(fuelOptionIds()).toEqual(['wood', 'coal'])
  })

  it('choosing a fuel stores it and "Default" clears it', () => {
    renderBurner()
    openFuel()
    fireEvent.click(screen.getByText('coal', { selector: 'span' }))
    expect(storedFuel()).toBe('coal')
    openFuel()
    fireEvent.click(screen.getByTestId('fuel-default'))
    expect(storedFuel()).toBeUndefined()
  })

  it('says no fuel is usable when the machine has categories but every fuel is filtered out', () => {
    const gd = burnerData()
    for (const id of ['wood', 'coal', 'solid-fuel']) gd.items[id] = { ...gd.items[id], burntResult: 'ash' }
    renderBurner(undefined, gd)
    expect(screen.getByTestId('no-fuel-data')).toHaveTextContent('No usable fuel for this machine')
  })

  it('says so for a burner without fuel data', () => {
    const gd = burnerData()
    delete gd.machines.furnace.fuelCategories
    renderBurner(undefined, gd)
    expect(screen.getByTestId('no-fuel-data')).toHaveTextContent('No fuel data in this data set')
    expect(screen.queryByTestId('fuel-button')).not.toBeInTheDocument()
  })

  function fluidBurnerData(withValues = true): GameData {
    const gd = burnerData()
    gd.machines.furnace = { ...gd.machines.furnace, energyType: 'fluid-burner', fuelCategories: undefined }
    const fluid = (id: string, kj?: number) =>
      ({ ...item(id, id), type: 'fluid' as const, ...(withValues && kj !== undefined ? { fuelValueKj: kj } : {}) })
    gd.items.crude = fluid('crude', 100)
    gd.items['heavy-oil'] = fluid('heavy-oil', 300)
    gd.items.water = fluid('water')
    return gd
  }

  it('a fluid burner shows the lowest-value fluid and lists fluids only', () => {
    renderBurner(undefined, fluidBurnerData())
    expect(screen.getByTestId('fuel-button')).toHaveTextContent('crude')
    openFuel()
    expect(fuelOptionIds()).toEqual(['crude', 'heavy-oil'])
  })

  it('choosing a fluid stores it and "Default" clears it', () => {
    renderBurner(undefined, fluidBurnerData())
    openFuel()
    fireEvent.click(screen.getByText('heavy-oil', { selector: 'span' }))
    expect(storedFuel()).toBe('heavy-oil')
    openFuel()
    fireEvent.click(screen.getByTestId('fuel-default'))
    expect(storedFuel()).toBeUndefined()
  })

  it('a fluid burner in a data set without fluid fuel values says there is no fuel data', () => {
    renderBurner(undefined, fluidBurnerData(false))
    expect(screen.getByTestId('no-fuel-data')).toHaveTextContent('No fuel data in this data set')
  })

  it('a fluid burner whose filter fluid has no value says no fuel is usable', () => {
    const gd = fluidBurnerData()
    gd.machines.furnace = { ...gd.machines.furnace, fuelFluid: 'water' }
    renderBurner(undefined, gd)
    expect(screen.getByTestId('no-fuel-data')).toHaveTextContent('No usable fuel for this machine')
  })

  it('"Apply to every row of this recipe" copies the fuel', () => {
    renderBurner('coal', burnerData(), [
      { kind: 'game-recipe', id: 'n2', recipeId: 'smelt', modules: [], byproductPolicy: {} },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Apply to every row of this recipe/ }))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes as GameRecipeNode[]
    expect(nodes.find(n => n.id === 'n2')!.fuelItemId).toBe('coal')
  })
})

describe('MachineSection — per-fuel power recipes in the Alternate recipe list', () => {
  function boilerMachine(id: string, name: string): GameData['machines'][string] {
    return {
      id, name, type: 'boiler', craftingSpeed: 1, energyUsageKw: 0, energyType: 'void', drainKw: 0,
      moduleSlots: 0, allowedEffects: [], craftingCategories: ['power:boiler'], iconPath: '', hidden: false,
    }
  }
  function powerRecipe(machineId: string, fuel: string, name: string): GameData['recipes'][string] {
    return {
      id: `power:${machineId}:${fuel}`, name, category: 'power:boiler', craftingTime: 1,
      ingredients: [{ itemId: 'water', type: 'fluid', amount: 60 }, { itemId: fuel, type: 'item', amount: 0.01 }],
      products: [{ itemId: 'steam', type: 'fluid', amount: 60 }],
      madeIn: [machineId], allowProductivity: false, hidden: false, mainProduct: 'steam',
      subgroup: '', order: '', power: true,
    }
  }
  function boilerData(): GameData {
    const gd = makeGameData()
    gd.items.steam = { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '' }
    gd.items.coal = { ...item('coal'), name: 'Coal', fuelValueKj: 4000 }
    gd.items.wood = { ...item('wood'), name: 'Wood', fuelValueKj: 2000 }
    gd.items.oil = { ...item('oil'), name: 'Oil' }
    gd.machines.boiler = boilerMachine('boiler', 'Boiler')
    gd.machines['boiler-2'] = boilerMachine('boiler-2', 'Boiler 2')
    for (const [m, label] of [['boiler', 'Boiler'], ['boiler-2', 'Boiler 2']]) {
      for (const [fuel, fuelName] of [['coal', 'Coal'], ['wood', 'Wood'], ['oil', 'Oil']]) {
        if (m === 'boiler-2' && fuel === 'oil') continue
        gd.recipes[`power:${m}:${fuel}`] = powerRecipe(m, fuel, `${label} (${fuelName})`)
      }
    }
    gd.recipes['steam-vent'] = {
      ...recipe('steam-vent', 'Steam vent'), products: [{ itemId: 'steam', type: 'fluid', amount: 1 }], madeIn: ['assembler'],
    }
    gd.defaultMachines['power:boiler'] = 'boiler'
    return gd
  }

  function renderBoiler(gameData = boilerData(), recipeId = 'power:boiler:coal', onClose = () => {}) {
    const block = makeEmptyBlock('Test')
    const row: GameRecipeNode = {
      kind: 'game-recipe', id: 'n1', recipeId, machineId: 'boiler', modules: [{ moduleId: 'speed', count: 1 }], byproductPolicy: {},
    }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [row] } }],
      activeBlockId: block.id,
      history: {},
    })
    renderModal(gameData, { recipeId, recipeCategory: 'power:boiler', machineId: 'boiler', onClose })
  }
  const groupCount = (machineId: string) =>
    screen.getAllByTestId('alt-recipe-group').find(g => g.getAttribute('data-machine-id') === machineId)
  const node = () => useBlockStore.getState().blocks[0].rootPlan.nodes[0] as GameRecipeNode

  it('shows one group per machine, with the current recipe excluded, and other recipes plain', () => {
    renderBoiler()
    expect(groupCount('boiler')).toHaveAttribute('data-recipe-count', '2')
    expect(groupCount('boiler-2')).toHaveAttribute('data-recipe-count', '2')
    expect(screen.getAllByTestId('alt-recipe').map(e => e.getAttribute('data-recipe-id'))).toEqual(['steam-vent'])
    expect(screen.queryByTestId('alt-recipe-fuel')).not.toBeInTheDocument()
  })

  it('expands a group into its fuels, one group at a time', () => {
    renderBoiler()
    fireEvent.click(groupCount('boiler')!)
    expect(groupCount('boiler')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('alt-recipe-fuel').map(e => e.getAttribute('data-recipe-id')))
      .toEqual(['power:boiler:wood', 'power:boiler:oil'])
    expect(screen.getAllByTestId('alt-recipe-fuel')[0]).toHaveTextContent('2 MJ')
    fireEvent.click(groupCount('boiler-2')!)
    expect(groupCount('boiler')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('alt-recipe-fuel').map(e => e.getAttribute('data-recipe-id')))
      .toEqual(['power:boiler-2:coal', 'power:boiler-2:wood'])
  })

  it('labels a group with a neutral recipe count and scrolls the expanded fuels into view', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderBoiler()
    expect(groupCount('boiler')).toHaveTextContent('(2 recipes)')
    fireEvent.click(groupCount('boiler')!)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('switches the row to the chosen fuel, resets its machine and modules, and closes the popup', () => {
    renderBoiler()
    fireEvent.click(groupCount('boiler')!)
    fireEvent.click(screen.getAllByTestId('alt-recipe-fuel').find(e => e.getAttribute('data-recipe-id') === 'power:boiler:wood')!)
    expect(node().recipeId).toBe('power:boiler:wood')
    expect(node().machineId).toBeUndefined()
    expect(node().modules).toEqual([])
    expect(screen.queryByTestId('alt-recipe-group')).not.toBeInTheDocument()
  })

  it('lists a fuel beyond the horizon, flagged, so a row on another fuel can still pick it', () => {
    const gd = boilerData()
    gd.recipes['r-oil'] = producer('r-oil', 'oil')
    gd.technologies.fuel = { id: 'fuel', name: 'Fuel', prerequisites: [], unlockedRecipes: ['r-oil'], iconPath: '' }
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderBoiler(gd, 'power:boiler:coal')
    fireEvent.click(groupCount('boiler')!)
    const oil = screen.getAllByTestId('alt-recipe-fuel').find(e => e.getAttribute('data-recipe-id') === 'power:boiler:oil')!
    expect(oil).toHaveAttribute('data-beyond-horizon', 'true')
    expect(within(oil).getByTestId('beyond-horizon')).toBeInTheDocument()
  })

  it('shows a single remaining fuel of the machine as a plain alternate recipe', () => {
    const gd = boilerData()
    delete gd.recipes['power:boiler:oil']
    renderBoiler(gd)
    const plain = screen.getAllByTestId('alt-recipe').find(e => e.getAttribute('data-recipe-id') === 'power:boiler:wood')!
    expect(plain).toHaveTextContent('Boiler (Wood)')
    expect(groupCount('boiler')).toBeUndefined()
  })
})
