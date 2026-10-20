import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FactorySummary } from './FactorySummary'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, ConnectionFlow, GameData, SolverResult, ProductionGoal } from '../../data/types'

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
    'iron-ore': { id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: '', hidden: false },
    'slag': { id: 'slag', name: 'Slag', type: 'item', iconPath: '', hidden: false },
  },
  recipes: {},
  machines: {},
  beacons: {},
  modules: {},
  defaultMachines: {},
  technologies: {},
  startingRecipes: [],
} as unknown as GameData

// goal.rate is items/min; solver outputs are also items/min
const ironGoal: ProductionGoal = { id: 'g1', itemId: 'iron-plate', rate: 60 }

const mockSolverResult: SolverResult = {
  nodes: [
    {
      recipeNodeId: 'n1',
      inputRates: { 'iron-ore': 120 },
      outputRates: { 'iron-plate': 58, 'slag': 10 }, // actual ≠ target (58 vs 60)
      throughput: 30,
      machineCountExact: 2,
      machineCountCeil: 2,
      powerKw: 180,
    },
  ],
  unsatisfied: [{ itemId: 'iron-ore', rate: 120 }],
  warnings: [],
}

function setupStore(goals: ProductionGoal[] = [ironGoal], withSolver = true) {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [{ ...block, goals }],
    activeBlockId: block.id,
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
  useSolverStore.setState({
    status: { type: 'idle' },
    lastResult: withSolver ? mockSolverResult : undefined,
    lastResults: {},
    flows: [],
    _setStatus: () => {},
  })
}

beforeEach(() => setupStore())

describe('FactorySummary — pane labels', () => {
  it('renders Products, Byproducts and Ingredients section headings', () => {
    render(<FactorySummary />)
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getByText('Byproducts')).toBeInTheDocument()
    expect(screen.getByText('Ingredients')).toBeInTheDocument()
  })
})

describe('FactorySummary — without loaded game data', () => {
  it.each([
    ['empty', { type: 'empty' as const }],
    ['loading', { type: 'loading' as const }],
    ['error', { type: 'error' as const, message: 'boom' }],
  ])('renders nothing editable while %s', (_name, status) => {
    useGameDataStore.setState({ status })
    render(<FactorySummary />)
    expect(screen.queryByText('Products'), 'summary must be hidden').not.toBeInTheDocument()
    expect(screen.queryByTitle('Add goal')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — rate unit toggle', () => {
  it('toggling /sec changes rateUnit in uiStore', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByText('/sec'))
    expect(useUiStore.getState().rateUnit).toBe('sec')
  })

  it('toggling /min changes rateUnit in uiStore', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<FactorySummary />)
    fireEvent.click(screen.getByText('/min'))
    expect(useUiStore.getState().rateUnit).toBe('min')
  })
})

describe('FactorySummary — GoalTile target and actual', () => {
  it('shows target rate with title containing "Target"', () => {
    render(<FactorySummary />)
    // Target is 60/min → button with title "Target: 60.0/m — click to edit"
    const targetBtn = screen.getByTitle(/Target:/)
    expect(targetBtn).toBeInTheDocument()
    expect(targetBtn.textContent).toMatch(/60/)
  })

  it('shows actual rate with title containing "Actual" when solver has run', () => {
    render(<FactorySummary />)
    // Actual is 58/min from mockSolverResult
    const actualSpan = screen.getByTitle(/Actual:/)
    expect(actualSpan).toBeInTheDocument()
    expect(actualSpan.textContent).toMatch(/58/)
  })

  it('shows → separator between target and actual', () => {
    render(<FactorySummary />)
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('does not show actual or → when solver has not run', () => {
    setupStore([ironGoal], false)
    render(<FactorySummary />)
    expect(screen.queryByTitle(/Actual:/)).not.toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — GoalTile editing', () => {
  it('clicking the target rate button shows an editable input', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    expect(screen.getByLabelText('Goal target rate')).toBeInTheDocument()
  })

  it('committing an edit calls updateGoalRate with rate in items/min', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '120' } })
    fireEvent.blur(input)
    const goals = useBlockStore.getState().blocks[0].goals
    expect(goals[0].rate).toBeCloseTo(120) // stored in items/min
  })

  it('committing a /sec value converts to items/min before storing', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '2' } }) // 2/sec = 120/min
    fireEvent.blur(input)
    const goals = useBlockStore.getState().blocks[0].goals
    expect(goals[0].rate).toBeCloseTo(120)
  })

  it('pressing Enter commits the edit', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useBlockStore.getState().blocks[0].goals[0].rate).toBeCloseTo(90)
  })

  it('pressing Escape cancels without saving', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useBlockStore.getState().blocks[0].goals[0].rate).toBe(60) // unchanged
  })
})

describe('FactorySummary — GoalTile remove', () => {
  const goalIcon = () => screen.getByTitle(/Iron Plate — click to add a producer recipe/)

  it('right-click then "Remove goal" removes the goal', () => {
    render(<FactorySummary />)
    expect(screen.queryByTitle('Remove goal')).not.toBeInTheDocument()
    fireEvent.contextMenu(goalIcon())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove goal' }))
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(0)
  })

  it('Escape closes the goal menu and keeps the goal', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(goalIcon())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Task 9: v2 surplus and goal tile actual throughput
// ---------------------------------------------------------------------------

describe('FactorySummary — v2 surplus renders as byproduct', () => {
  it('a surplus intermediate (net positive balance, not a goal) appears in Byproducts pane', () => {
    // v2 result: iron-plate is the goal, steam has positive net balance (surplus intermediate)
    const surplusResult: SolverResult = {
      nodes: [
        {
          recipeNodeId: 'n1',
          inputRates: {},
          outputRates: { 'iron-plate': 65, 'steam': 20 }, // steam surplus
          throughput: 65,
          machineCountExact: 1,
          machineCountCeil: 1,
          powerKw: 0,
        },
        {
          recipeNodeId: 'n2',
          inputRates: { steam: 5 }, // some consumed, but net is 15
          outputRates: {},
          throughput: 5,
          machineCountExact: 1,
          machineCountCeil: 1,
          powerKw: 0,
        },
      ],
      unsatisfied: [],
      warnings: [{ type: 'overconstrained', surplusItems: [{ itemId: 'steam', rate: 15 }] }],
    }
    setupStore([ironGoal])
    // Extend game data to include steam so the tile shows the name
    const gdWithSteam = { ...mockGameData, items: { ...mockGameData.items, steam: { id: 'steam', name: 'Steam', type: 'fluid' as const, iconPath: '', hidden: false } } }
    useGameDataStore.setState({ status: { type: 'loaded', gameData: gdWithSteam as unknown as GameData, sourceId: 'test' } })
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: surplusResult, _setStatus: () => {} })
    render(<FactorySummary />)
    // steam has net 15 (20 produced - 5 consumed), should appear in Byproducts
    const steamTiles = screen.getAllByTitle(/Steam/i)
    expect(steamTiles.length).toBeGreaterThan(0)
  })
})

describe('FactorySummary — goal tile shows actual throughput when LP returns more', () => {
  it('goal tile actual reflects LP output when it exceeds the requested rate', () => {
    // v2 LP returns 850 iron-plate even though goal is 60 (overconstrained)
    const overResult: SolverResult = {
      nodes: [
        {
          recipeNodeId: 'n1',
          inputRates: {},
          outputRates: { 'iron-plate': 850 },
          throughput: 850,
          machineCountExact: 1,
          machineCountCeil: 1,
          powerKw: 0,
        },
      ],
      unsatisfied: [],
      warnings: [],
    }
    setupStore([{ id: 'g1', itemId: 'iron-plate', rate: 60 }])
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: overResult, _setStatus: () => {} })
    render(<FactorySummary />)
    // Actual tile should show 850, not 60
    const actualSpan = screen.getByTitle(/Actual:/)
    expect(actualSpan.textContent).toMatch(/850/)
  })
})

describe('FactorySummary — add goal', () => {
  it('clicking + opens item picker', async () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add goal'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Add product' })).toBeInTheDocument())
  })

  it('adding a goal via picker calls addGoal', async () => {
    setupStore([])
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add goal'))
    await waitFor(() => screen.getByRole('heading', { name: 'Add product' }))
    const slots = screen.getAllByTestId('item-slot')
    const ironSlot = slots.find(b => b.getAttribute('data-item-id') === 'iron-plate')!
    fireEvent.click(ironSlot)
    const goals = useBlockStore.getState().blocks[0].goals
    expect(goals).toHaveLength(1)
    expect(goals[0].itemId).toBe('iron-plate')
    expect(goals[0].rate).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// Connections between blocks
// ---------------------------------------------------------------------------

describe('FactorySummary — connections', () => {
  const emptyResult = (): SolverResult => ({ nodes: [], unsatisfied: [], warnings: [] })
  const minerResult = (): SolverResult => ({
    nodes: [{
      recipeNodeId: 'm', inputRates: {}, outputRates: { 'iron-ore': 200 },
      throughput: 200, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
    }],
    unsatisfied: [],
    warnings: [],
  })
  const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
    connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-ore',
    available: 30, rate: 30, status: 'ok', ...over,
  })

  function setupBlocks(opts: { activeId: 'consumer' | 'miner', connected: boolean, result?: SolverResult, flows?: ConnectionFlow[], minerOffers?: boolean }) {
    const consumer: Block = {
      ...makeEmptyBlock('Consumer'), id: 'consumer', goals: [ironGoal],
      inputConnections: opts.connected ? [{ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner' }] : [],
    }
    const miner: Block = { ...makeEmptyBlock('Miner'), id: 'miner', goals: [ironGoal] }
    useBlockStore.setState({ blocks: [consumer, miner], activeBlockId: opts.activeId, history: {} })
    useSolverStore.setState({
      lastResult: opts.result ?? emptyResult(),
      lastResults: {
        consumer: emptyResult(),
        miner: opts.minerOffers === false ? emptyResult() : minerResult(),
        // The active block's own result is the one passed in.
        [opts.activeId]: opts.result ?? emptyResult(),
      },
      flows: opts.flows ?? [],
      _setStatus: () => {},
    })
  }

  it('shows a chip with the source name and the delivered rate', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
    render(<FactorySummary />)
    const chip = screen.getByTestId('connection-chip')
    expect(chip.textContent).toContain('Miner')
    expect(chip.textContent).toContain('30.0')
  })

  it('titles a limited chip with "Limited"', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'limited', available: 30 })] })
    render(<FactorySummary />)
    expect(screen.getByTestId('connection-chip').getAttribute('title')).toContain('Limited')
  })

  it('titles an unused chip with "Not used"', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'unused', rate: 0 })] })
    render(<FactorySummary />)
    expect(screen.getByTestId('connection-chip').getAttribute('title')).toContain('Not used')
  })

  it('labels a chip whose source block is gone and lets the user remove it via right-click', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'missing-source', rate: 0, available: 0 })] })
    useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== 'miner') }))
    render(<FactorySummary />)
    expect(screen.getByTestId('connection-chip').textContent).toContain('deleted block')
    fireEvent.contextMenu(screen.getByTestId('connection-chip'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
    expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
  })

  it('right-click then "Remove connection" removes the connection', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
    render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTestId('connection-chip'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
    expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
  })

  it('clicking the source name opens the source block', () => {
    setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Go to Miner'))
    expect(useBlockStore.getState().activeBlockId).toBe('miner')
  })

  it('right-clicking an ingredient tile offers the blocks that produce it', () => {
    setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
    render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTitle(/Iron Ore — click to find a producer recipe/))
    expect(screen.getByText('Receive Iron Ore from')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Miner/ }))
    expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([
      { id: expect.any(String), itemId: 'iron-ore', fromBlockId: 'miner' },
    ])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('caps each summary pane height and scrolls its tiles', () => {
    setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
    render(<FactorySummary />)
    const tiles = screen.getByTitle(/Iron Ore — click to find a producer recipe/).closest('.overflow-y-auto')
    expect(tiles).not.toBeNull()
    expect(tiles!.parentElement).toHaveClass('max-h-[25vh]')
  })

  it('does not offer a connection for a goal shortfall tile', () => {
    // ironGoal's item is also a goal of the consumer, so its shortfall cannot be fed.
    const goalShortfall: SolverResult = { nodes: [], unsatisfied: [{ itemId: ironGoal.itemId, rate: 5 }], warnings: [] }
    setupBlocks({ activeId: 'consumer', connected: false, result: goalShortfall })
    render(<FactorySummary />)
    const tile = screen.getAllByTitle(/click to find a producer recipe$/)[0]
    fireEvent.contextMenu(tile)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(tile.getAttribute('title')).not.toContain('right-click')
  })

  it('lists a source with what is left after its other consumers, and hides it when nothing is left', () => {
    setupBlocks({
      activeId: 'consumer', connected: false, result: mockSolverResult,
      flows: [flow({ connectionId: 'other', toBlockId: 'third', rate: 150 })],
    })
    const { unmount } = render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTitle(/Iron Ore — click to find a producer recipe/))
    // 200 offered - 150 already delivered = 50/min.
    expect(screen.getByRole('menuitem', { name: /Miner/ }).textContent).toContain('50.0')
    unmount()

    setupBlocks({
      activeId: 'consumer', connected: false, result: mockSolverResult,
      flows: [flow({ connectionId: 'other', toBlockId: 'third', rate: 200 })],
    })
    render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTitle(/Iron Ore — click to find a producer recipe/))
    expect(screen.queryByRole('menuitem', { name: /Miner/ })).not.toBeInTheDocument()
    expect(screen.getByText('No other block produces this item')).toBeInTheDocument()
  })

  it('says so when no other block produces the item', () => {
    setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult, minerOffers: false })
    render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTitle(/Iron Ore — click to find a producer recipe/))
    expect(screen.getByText('No other block produces this item')).toBeInTheDocument()
  })

  it('shows an export chip after the goal tile and subtracts exports from the byproduct rate', () => {
    const result: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 58, slag: 10 },
        throughput: 30, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [],
      warnings: [],
    }
    setupBlocks({
      activeId: 'miner', connected: false, result,
      flows: [
        flow({ connectionId: 'e1', itemId: 'iron-plate', fromBlockId: 'miner', toBlockId: 'consumer', rate: 20 }),
        flow({ connectionId: 'e2', itemId: 'slag', fromBlockId: 'miner', toBlockId: 'consumer', rate: 4 }),
      ],
    })
    render(<FactorySummary />)
    const chips = screen.getAllByTestId('export-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toContain('Consumer')
    expect(chips[0].textContent).toContain('20.0')
    // The first chip directly follows the goal tile.
    expect(screen.getByTitle(/Target:/).closest('div')!.nextElementSibling).toBe(chips[0])
    // slag: 10 produced - 4 exported = 6 left as a byproduct
    expect(screen.getByTitle('Slag — right-click to add a consumer recipe').textContent).toContain('6.00')
  })
})

describe('FactorySummary — byproduct consumer recipe', () => {
  const slagTile = () => screen.getByTitle('Slag — right-click to add a consumer recipe')

  function withConsumerRecipe() {
    const data = structuredClone(mockGameData)
    data.recipes['slag-to-plate'] = {
      id: 'slag-to-plate', name: 'Slag To Plate', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'slag', type: 'item', amount: 2 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-plate',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
  }

  it('right-click then "Add consumer recipe…" opens the filtered picker and adds to the root plan', async () => {
    withConsumerRecipe()
    render(<FactorySummary />)
    fireEvent.contextMenu(slagTile())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add consumer recipe…' }))

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe that consumes 'Slag'")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Slag To Plate'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind === 'game-recipe' && nodes[0].recipeId).toBe('slag-to-plate')
  })

  it('Escape closes the menu without opening a picker', () => {
    withConsumerRecipe()
    render(<FactorySummary />)
    fireEvent.contextMenu(slagTile())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })
})

describe('FactorySummary — goal tile producer picker', () => {
  const producerTitle = 'Iron Plate — click to add a producer recipe, right-click to remove'

  function withProducerRecipe() {
    const data = structuredClone(mockGameData)
    data.recipes['smelt-iron'] = {
      id: 'smelt-iron', name: 'Smelt Iron', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-plate',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
  }

  it('clicking the goal icon opens the filtered picker and adds the recipe to the root plan', async () => {
    withProducerRecipe()
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(producerTitle))

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe to produce 'Iron Plate'")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Smelt Iron'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind === 'game-recipe' && nodes[0].recipeId).toBe('smelt-iron')
  })

  it('clicking the target rate edits it without opening the picker', () => {
    withProducerRecipe()
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    expect(screen.getByLabelText('Goal target rate')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })

  it('Escape closes the picker', async () => {
    withProducerRecipe()
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(producerTitle))
    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })
})

describe('FactorySummary — ingredient tile click and import lock', () => {
  function withProducerRecipe() {
    const data = structuredClone(mockGameData)
    data.recipes['mine-iron'] = {
      id: 'mine-iron', name: 'Mine Iron', category: 'mining', craftingTime: 1,
      ingredients: [],
      products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
  }
  const oreTile = () => screen.getByTitle(/Iron Ore — click to find a producer recipe/)
  const oreChip = () => screen.getByTitle(/Iron Ore — locked/)
  const noImport = () => useBlockStore.getState().blocks[0].noImportItems

  it('left click on a tile opens the producer picker and adds the recipe to the root plan', async () => {
    withProducerRecipe()
    render(<FactorySummary />)
    fireEvent.click(oreTile())

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe to produce 'Iron Ore'")).toBeInTheDocument()
    expect(noImport()).toEqual([])

    fireEvent.click(screen.getByTitle('Mine Iron'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind === 'game-recipe' && nodes[0].recipeId).toBe('mine-iron')
  })

  it('right-click then "Forbid imports" locks the item, below the connection entries', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(oreTile())
    expect(screen.getByText('Receive Iron Ore from')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forbid imports' }))
    expect(noImport()).toEqual(['iron-ore'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('left click on the locked chip unlocks without opening a picker', () => {
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, noImportItems: ['iron-ore'] })) }))
    render(<FactorySummary />)
    fireEvent.click(oreChip())
    expect(noImport()).toEqual([])
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })

  it('right-click on the locked chip offers "Allow imports"', () => {
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, noImportItems: ['iron-ore'] })) }))
    render(<FactorySummary />)
    fireEvent.contextMenu(oreChip())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Allow imports' }))
    expect(noImport()).toEqual([])
  })

  it('right-click on a locked goal item chip offers only "Allow imports"', () => {
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, noImportItems: ['iron-plate'] })) }))
    render(<FactorySummary />)
    fireEvent.contextMenu(screen.getByTitle(/Iron Plate — locked/))
    expect(screen.getAllByRole('menuitem').map(el => el.textContent)).toEqual(['Allow imports'])
    expect(screen.queryByText(/Receive .* from/)).not.toBeInTheDocument()
  })
})
