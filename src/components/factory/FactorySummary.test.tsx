import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pane = (name: string) => screen.getByRole('region', { name })
const slot = (paneName: string, item: string) =>
  within(pane(paneName)).getByRole('button', { name: new RegExp('^' + item + ', ') })
const strip = (paneName: string) => within(pane(paneName)).getByTestId('summary-detail')
const select = (paneName: string, item: string) => fireEvent.click(slot(paneName, item))
const segments = (paneName: string, kind?: string) =>
  within(strip(paneName)).queryAllByTestId('summary-segment').filter(el => !kind || el.dataset.kind === kind)
const keyEntries = (paneName: string, kind?: string) =>
  within(strip(paneName)).queryAllByTestId('summary-key-entry').filter(el => !kind || el.dataset.kind === kind)
const overviewRow = (paneName: string, key: string) =>
  within(strip(paneName)).getAllByTestId('summary-overview-row').find(r => r.dataset.key === key)!

describe('FactorySummary — panes', () => {
  it('renders Products, Byproducts and Ingredients regions', () => {
    render(<FactorySummary />)
    expect(pane('Products')).toBeInTheDocument()
    expect(pane('Byproducts')).toBeInTheDocument()
    expect(pane('Ingredients')).toBeInTheDocument()
    expect(pane('Products').textContent).toContain('· 1')
  })

  it('names a slot after its item and rate, with the item name as tooltip', () => {
    render(<FactorySummary />)
    const iron = screen.getByRole('button', { name: 'Iron Plate, 58.0 per minute, short' })
    expect(iron).toHaveAttribute('title', 'Iron Plate')
  })

  it('words the slot name per second in /sec', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<FactorySummary />)
    expect(screen.getByRole('button', { name: 'Iron Plate, 0.97 per second, short' })).toBeInTheDocument()
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

describe('FactorySummary — detail strip states', () => {
  it('shows the overview by default, with a kept and a short row for a short goal', () => {
    render(<FactorySummary />)
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
    expect(overviewRow('Products', 'kept')).toBeInTheDocument()
    expect(overviewRow('Products', 'short').textContent).toContain('2.00')
  })

  it('says so when a pane has nothing to show', () => {
    setupStore([], false)
    render(<FactorySummary />)
    expect(strip('Products').textContent).toContain('Nothing here yet')
  })

  it('previews a hovered slot and returns to the overview on leave', () => {
    render(<FactorySummary />)
    fireEvent.mouseEnter(slot('Products', 'Iron Plate'))
    expect(strip('Products')).toHaveAttribute('data-state', 'preview')
    expect(strip('Products').textContent).toContain('preview')
    fireEvent.mouseLeave(slot('Products', 'Iron Plate'))
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
  })

  it('previews another slot while one is selected, then returns to the selection', () => {
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', rate: 10 }])
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
    fireEvent.mouseEnter(slot('Products', 'Iron Ore'))
    expect(strip('Products')).toHaveAttribute('data-state', 'preview')
    expect(strip('Products').textContent).toContain('Iron Ore')
    fireEvent.mouseLeave(slot('Products', 'Iron Ore'))
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
  })

  it('keeps showing the selection while its own slot is hovered', () => {
    render(<FactorySummary />)
    fireEvent.mouseEnter(slot('Products', 'Iron Plate'))
    select('Products', 'Iron Plate')
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
  })

  it('selects on click and offers the goal actions', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'true')
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
    expect(within(strip('Products')).getByRole('button', { name: 'Find recipe' })).toBeInTheDocument()
    expect(within(strip('Products')).getByRole('button', { name: 'Remove goal' })).toBeInTheDocument()
  })

  it('clears the selection on a second click, on × and on Escape', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    select('Products', 'Iron Plate')
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')

    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Back to overview' }))
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'false')

    select('Products', 'Iron Plate')
    fireEvent.keyDown(slot('Products', 'Iron Plate'), { key: 'Escape' })
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
  })

  it('Escape pressed anywhere (focus on the body) clears the selection', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a double-click on a non-editable slot leaves it selected', () => {
    render(<FactorySummary />)
    const slag = slot('Byproducts', 'Slag')
    fireEvent.click(slag)
    fireEvent.click(slag)
    fireEvent.doubleClick(slag)
    expect(slag).toHaveAttribute('aria-pressed', 'true')
  })

  it('appends the status to the accessible name of a short slot', () => {
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Plate')).toHaveAccessibleName('Iron Plate, 58.0 per minute, short')
  })

  it('resets the selection when the active block changes', () => {
    const other = { ...makeEmptyBlock('Other'), id: 'other' }
    useBlockStore.setState(s => ({ blocks: [...s.blocks, other] }))
    const firstId = useBlockStore.getState().blocks[0].id
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    act(() => useBlockStore.getState().setActiveBlock('other'))
    act(() => useBlockStore.getState().setActiveBlock(firstId))
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('FactorySummary — goal target and actual', () => {
  it('shows target rate with title containing "Target" once the slot is selected', () => {
    render(<FactorySummary />)
    expect(screen.queryByTitle(/Target:/)).not.toBeInTheDocument()
    select('Products', 'Iron Plate')
    const targetBtn = screen.getByTitle(/Target:/)
    expect(targetBtn.textContent).toMatch(/60/)
  })

  it('shows actual rate with title containing "Actual" when solver has run', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(screen.getByTitle(/Actual:/).textContent).toMatch(/58/)
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('does not show actual or → when solver has not run', () => {
    setupStore([ironGoal], false)
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(screen.getByTitle(/Target:/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Actual:/)).not.toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })

  it('shows the actual output when the LP returns more than the requested rate', () => {
    const overResult: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 850 },
        throughput: 850, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [],
      warnings: [],
    }
    useSolverStore.setState({ lastResult: overResult })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(screen.getByTitle(/Actual:/).textContent).toMatch(/850/)
  })
})

describe('FactorySummary — goal target editing', () => {
  const goalRate = () => useBlockStore.getState().blocks[0].goals[0].rate

  function startEdit() {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(screen.getByTitle(/Target:/))
    return screen.getByLabelText('Goal target rate')
  }

  it('clicking the target in the strip shows an editable input', () => {
    startEdit()
    expect(strip('Products')).toHaveAttribute('data-state', 'editing')
  })

  it('pressing Enter commits the edit in items/min', () => {
    const input = startEdit()
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(goalRate()).toBeCloseTo(90)
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
  })

  it('converts a /sec value to items/min before storing', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    const input = startEdit()
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(goalRate()).toBeCloseTo(120)
  })

  it('Escape cancels without saving and keeps the selection', () => {
    const input = startEdit()
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(goalRate()).toBe(60)
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'true')
  })

  it('blur commits the edit', () => {
    const input = startEdit()
    fireEvent.change(input, { target: { value: '120' } })
    fireEvent.blur(input)
    expect(goalRate()).toBeCloseTo(120)
  })

  it('double-clicking a slot selects it and edits its target with the input focused', () => {
    render(<FactorySummary />)
    fireEvent.doubleClick(slot('Products', 'Iron Plate'))
    expect(strip('Products')).toHaveAttribute('data-state', 'editing')
    expect(screen.getByLabelText('Goal target rate')).toHaveFocus()
  })

  it('hovering another slot does not change the strip while editing', () => {
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', rate: 10 }])
    render(<FactorySummary />)
    fireEvent.doubleClick(slot('Products', 'Iron Plate'))
    fireEvent.mouseEnter(slot('Products', 'Iron Ore'))
    expect(strip('Products')).toHaveAttribute('data-state', 'editing')
  })

  it('right-clicking the rate input keeps the native menu (no Remove goal menu)', () => {
    const input = startEdit()
    const notPrevented = fireEvent.contextMenu(input)
    expect(notPrevented).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — remove goal', () => {
  it('right-click then "Remove goal" removes the goal', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove goal' }))
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(0)
  })

  it('the strip action removes the goal too', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove goal' }))
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(0)
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
  })

  it('Escape closes the goal menu and keeps the goal', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(1)
  })
})

describe('FactorySummary — v2 surplus renders as byproduct', () => {
  it('a surplus intermediate (net positive balance, not a goal) appears in the Byproducts pane', () => {
    const surplusResult: SolverResult = {
      nodes: [
        {
          recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 65, 'steam': 20 },
          throughput: 65, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        },
        {
          recipeNodeId: 'n2', inputRates: { steam: 5 }, outputRates: {},
          throughput: 5, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        },
      ],
      unsatisfied: [],
      warnings: [{ type: 'overconstrained', surplusItems: [{ itemId: 'steam', rate: 15 }] }],
    }
    setupStore([ironGoal])
    const gdWithSteam = { ...mockGameData, items: { ...mockGameData.items, steam: { id: 'steam', name: 'Steam', type: 'fluid' as const, iconPath: '', hidden: false } } }
    useGameDataStore.setState({ status: { type: 'loaded', gameData: gdWithSteam as unknown as GameData, sourceId: 'test' } })
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: surplusResult, _setStatus: () => {} })
    render(<FactorySummary />)
    // steam has net 15 (20 produced - 5 consumed)
    expect(within(pane('Byproducts')).getByRole('button', { name: 'Steam, 15.0 per minute' })).toBeInTheDocument()
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

  describe('ingredient segments', () => {
    it('shows the source as a segment and a key entry with the delivered rate', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAccessibleName('Iron Ore, 30.0 per minute')
      select('Ingredients', 'Iron Ore')
      expect(segments('Ingredients', 'source')).toHaveLength(1)
      const [entry] = keyEntries('Ingredients', 'source')
      expect(entry.textContent).toContain('← Miner')
      expect(entry.textContent).toContain('30.0')
    })

    it('titles a limited source with "Limited" and flags the slot', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'limited', available: 30 })] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-status', 'limited')
      select('Ingredients', 'Iron Ore')
      expect(segments('Ingredients', 'source')[0].getAttribute('title')).toMatch(/^Limited/)
    })

    it('titles an unused connection with "Not used" and dims the slot', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'unused', rate: 0 })] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-dimmed', 'true')
      select('Ingredients', 'Iron Ore')
      expect(keyEntries('Ingredients', 'unused')[0].getAttribute('title')).toMatch(/^Not used/)
    })

    it('labels a deleted source and lets the user remove the connection via right-click', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'missing-source', rate: 0, available: 0 })] })
      useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== 'miner') }))
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const [entry] = keyEntries('Ingredients', 'missing-source')
      expect(entry.textContent).toContain('(deleted block)')
      fireEvent.contextMenu(entry.firstElementChild!)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
    })

    it('shows a connection that forms a cycle as ignored', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'cycle', rate: 0 })] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(keyEntries('Ingredients', 'cycle')[0].textContent).toContain('cycle, ignored')
    })

    it('right-clicking a source segment offers "Remove connection"', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.contextMenu(segments('Ingredients', 'source')[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
    })

    it('clicking a source segment opens the source block', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.click(segments('Ingredients', 'source')[0])
      expect(useBlockStore.getState().activeBlockId).toBe('miner')
    })
  })

  describe('connection menu', () => {
    it('right-clicking an ingredient slot offers the blocks that produce it', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.getByText('Receive Iron Ore from')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('menuitem', { name: /Miner/ }))
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([
        { id: expect.any(String), itemId: 'iron-ore', fromBlockId: 'miner' },
      ])
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('Escape closes the menu but keeps the selection', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const receive = within(strip('Ingredients')).getByRole('button', { name: 'Receive from…' })
      fireEvent.click(receive)
      expect(screen.getByRole('menu')).toBeInTheDocument()
      fireEvent.keyDown(receive, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.keyDown(receive, { key: 'Escape' })
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'false')
    })

    it('names the status on a limited slot and marks its overview row', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'limited', available: 30 })] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAccessibleName('Iron Ore, 30.0 per minute, limited')
      expect(overviewRow('Ingredients', 'from:miner')).toHaveAttribute('data-limited', 'true')
    })

    it('ignores a trace whose key disappeared', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      render(<FactorySummary />)
      fireEvent.click(overviewRow('Ingredients', 'from:miner'))
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-traced', 'in')
      act(() => useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'consumer' ? { ...b, inputConnections: [] } : b)),
      })))
      expect(slot('Ingredients', 'Iron Ore')).not.toHaveAttribute('data-traced')
    })

    it('the strip "Receive from…" action opens the same menu', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.click(within(strip('Ingredients')).getByRole('button', { name: 'Receive from…' }))
      expect(screen.getByText('Receive Iron Ore from')).toBeInTheDocument()
    })

    it('does not offer a connection for a goal shortfall', () => {
      // ironGoal's item is also a goal of the consumer, so its shortfall cannot be fed.
      const goalShortfall: SolverResult = { nodes: [], unsatisfied: [{ itemId: ironGoal.itemId, rate: 5 }], warnings: [] }
      setupBlocks({ activeId: 'consumer', connected: false, result: goalShortfall })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Plate'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      select('Ingredients', 'Iron Plate')
      expect(within(strip('Ingredients')).queryByRole('button', { name: 'Receive from…' })).not.toBeInTheDocument()
    })

    it('lists a source with what is left after its other consumers, and hides it when nothing is left', () => {
      setupBlocks({
        activeId: 'consumer', connected: false, result: mockSolverResult,
        flows: [flow({ connectionId: 'other', toBlockId: 'third', rate: 150 })],
      })
      const { unmount } = render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      // 200 offered - 150 already delivered = 50/min.
      expect(screen.getByRole('menuitem', { name: /Miner/ }).textContent).toContain('50.0')
      unmount()

      setupBlocks({
        activeId: 'consumer', connected: false, result: mockSolverResult,
        flows: [flow({ connectionId: 'other', toBlockId: 'third', rate: 200 })],
      })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.queryByRole('menuitem', { name: /Miner/ })).not.toBeInTheDocument()
      expect(screen.getByText('No other block produces this item')).toBeInTheDocument()
    })

    it('says so when no other block produces the item', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult, minerOffers: false })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.getByText('No other block produces this item')).toBeInTheDocument()
    })
  })

  describe('exports', () => {
    const makerResult = (): SolverResult => ({
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 58, slag: 10 },
        throughput: 30, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [],
      warnings: [],
    })

    it("shows a goal's exports as segments that open the consumer, and subtracts them from the byproduct rate", () => {
      setupBlocks({
        activeId: 'miner', connected: false, result: makerResult(),
        flows: [
          flow({ connectionId: 'e1', itemId: 'iron-plate', fromBlockId: 'miner', toBlockId: 'consumer', rate: 20 }),
          flow({ connectionId: 'e2', itemId: 'slag', fromBlockId: 'miner', toBlockId: 'consumer', rate: 4 }),
        ],
      })
      render(<FactorySummary />)
      select('Products', 'Iron Plate')
      const exports = segments('Products', 'export')
      expect(exports).toHaveLength(1)
      expect(exports[0].getAttribute('title')).toMatch(/^Sends Iron Plate to Consumer/)
      expect(keyEntries('Products', 'export')[0].textContent).toContain('20.0')
      fireEvent.click(exports[0])
      expect(useBlockStore.getState().activeBlockId).toBe('consumer')
    })

    it('subtracts exports from the byproduct rate', () => {
      setupBlocks({
        activeId: 'miner', connected: false, result: makerResult(),
        flows: [flow({ connectionId: 'e2', itemId: 'slag', fromBlockId: 'miner', toBlockId: 'consumer', rate: 4 })],
      })
      render(<FactorySummary />)
      // slag: 10 produced - 4 exported = 6 left
      expect(slot('Byproducts', 'Slag')).toHaveAccessibleName('Slag, 6.00 per minute')
    })

    it('shows a byproduct that is only exported with rate 0 and an export segment', () => {
      const result: SolverResult = {
        nodes: [{
          recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 60, slag: 4 },
          throughput: 30, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        }],
        unsatisfied: [],
        warnings: [],
      }
      setupBlocks({
        activeId: 'miner', connected: false, result,
        flows: [flow({ connectionId: 'e1', itemId: 'slag', fromBlockId: 'miner', toBlockId: 'consumer', rate: 4 })],
      })
      render(<FactorySummary />)
      expect(slot('Byproducts', 'Slag')).toHaveAccessibleName('Slag, 0.00 per minute')
      select('Byproducts', 'Slag')
      expect(segments('Byproducts', 'export')).toHaveLength(1)
    })

    it('traces an overview row: slots carrying the key stay, the others fade', () => {
      const result: SolverResult = {
        nodes: [{
          recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 60, 'iron-ore': 10 },
          throughput: 30, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        }],
        unsatisfied: [],
        warnings: [],
      }
      setupBlocks({
        activeId: 'miner', connected: false, result,
        flows: [flow({ connectionId: 'e1', itemId: 'iron-plate', fromBlockId: 'miner', toBlockId: 'consumer', rate: 20 })],
      })
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'miner' ? { ...b, goals: [ironGoal, { id: 'g2', itemId: 'iron-ore', rate: 10 }] } : b)),
      }))
      render(<FactorySummary />)
      const row = overviewRow('Products', 'to:consumer')
      fireEvent.click(row)
      expect(overviewRow('Products', 'to:consumer')).toHaveAttribute('aria-pressed', 'true')
      expect(slot('Products', 'Iron Plate')).toHaveAttribute('data-traced', 'in')
      expect(slot('Products', 'Iron Ore')).toHaveAttribute('data-traced', 'out')

      fireEvent.click(overviewRow('Products', 'to:consumer'))
      expect(slot('Products', 'Iron Plate')).not.toHaveAttribute('data-traced')

      fireEvent.click(overviewRow('Products', 'to:consumer'))
      fireEvent.keyDown(overviewRow('Products', 'to:consumer'), { key: 'Escape' })
      expect(slot('Products', 'Iron Ore')).not.toHaveAttribute('data-traced')
    })
  })
})

describe('FactorySummary — short goal', () => {
  it('marks a short goal with an amber ▼ and the shortfall in the title', () => {
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('data-status', 'short')
    select('Products', 'Iron Plate')
    const actual = screen.getByTitle(/Actual:/)
    expect(actual.getAttribute('title')).toContain('short by 2.00')
    expect(actual).toHaveClass('text-amber-400')
    expect(actual.textContent).toContain('▼')
  })

  it('shows no marker when the goal is met or exceeded', () => {
    const met: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 60 },
        throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [],
      warnings: [],
    }
    useSolverStore.setState({ lastResult: met })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    const actual = screen.getByTitle(/Actual:/)
    expect(actual.getAttribute('title')).not.toContain('short by')
    expect(actual.textContent).not.toContain('▼')
    expect(actual).toHaveClass('text-teal-400')
  })

  it('words the shortfall in /sec when that is the unit', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    // goal 60/min, actual 58/min: 1.00/s -> 0.97/s, short by 0.03/s
    const actual = screen.getByTitle(/Actual:/)
    expect(actual.getAttribute('title')).toContain('short by 0.03/s')
    expect(actual).toHaveClass('text-amber-400')
  })

  it('marks a goal as short when no node produces its item at all', () => {
    useSolverStore.setState({ lastResult: { nodes: [], unsatisfied: [], warnings: [] } })
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('data-status', 'short')
    select('Products', 'Iron Plate')
    const actual = screen.getByTitle(/Actual:/)
    expect(actual.getAttribute('title')).toContain('short by 60.0')
    expect(actual.textContent).toContain('▼')
  })

  it('shows no marker when the shortfall rounds to zero in the displayed precision', () => {
    const almost: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 59.9999 },
        throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [],
      warnings: [],
    }
    useSolverStore.setState({ lastResult: almost })
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Plate')).not.toHaveAttribute('data-status')
    select('Products', 'Iron Plate')
    const actual = screen.getByTitle(/Actual:/)
    expect(actual.getAttribute('title')).not.toContain('short by')
    expect(actual.textContent).not.toContain('▼')
    expect(actual).toHaveClass('text-teal-400')
  })
})

describe('FactorySummary — pane layout', () => {
  it('keeps Add goal outside the scrolling grid', () => {
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', rate: 10 }])
    render(<FactorySummary />)
    expect(pane('Products').textContent).toContain('· 2')
    expect(screen.getByTitle('Add goal').closest('.overflow-y-auto')).toBeNull()
  })

  it('caps the slot grid height and gives the strip a fixed height', () => {
    render(<FactorySummary />)
    const grid = within(pane('Products')).getByTestId('summary-slot-grid')
    expect(grid).toHaveClass('max-h-[130px]')
    expect(grid).toHaveClass('overflow-y-auto')
    expect(strip('Products')).toHaveClass('h-[110px]')
  })
})

describe('FactorySummary — scroll fade', () => {
  const proto = HTMLElement.prototype
  const desc = (k: string) => Object.getOwnPropertyDescriptor(proto, k)
  const saved = { scrollHeight: desc('scrollHeight'), clientHeight: desc('clientHeight') }
  let contentHeight = 100

  beforeEach(() => {
    contentHeight = 100
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => contentHeight })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 50 })
  })
  afterEach(() => {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(proto, k, d)
      else delete (proto as unknown as Record<string, unknown>)[k]
    }
  })

  it('re-measures after a re-render even when the capped body itself does not resize', () => {
    contentHeight = 50
    render(<FactorySummary />)
    expect(pane('Products')).not.toHaveAttribute('data-overflow')
    contentHeight = 100
    fireEvent.click(screen.getByText('/sec'))
    expect(pane('Products')).toHaveAttribute('data-overflow', 'true')
    contentHeight = 50
    fireEvent.click(screen.getByText('/min'))
    expect(pane('Products')).not.toHaveAttribute('data-overflow')
  })

  it('fades the overview rows until they are scrolled to the bottom', () => {
    render(<FactorySummary />)
    const rows = within(strip('Products')).getByTestId('summary-overview-rows')
    expect(rows).toHaveAttribute('data-overflow', 'true')
    rows.scrollTop = 50
    fireEvent.scroll(rows)
    expect(rows).not.toHaveAttribute('data-overflow')
  })
})

describe('FactorySummary — byproduct consumer recipe', () => {
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

  it('shows what the block makes in the strip', () => {
    render(<FactorySummary />)
    select('Byproducts', 'Slag')
    expect(strip('Byproducts').textContent).toContain('made 10.0')
  })

  it('right-click then "Add consumer recipe…" opens the filtered picker and adds to the root plan', async () => {
    withConsumerRecipe()
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Byproducts', 'Slag'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add consumer recipe…' }))

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe that consumes 'Slag'")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Slag To Plate'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind === 'game-recipe' && nodes[0].recipeId).toBe('slag-to-plate')
  })

  it('the strip action does the same', async () => {
    withConsumerRecipe()
    render(<FactorySummary />)
    select('Byproducts', 'Slag')
    fireEvent.click(within(strip('Byproducts')).getByRole('button', { name: 'Add consumer recipe…' }))
    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    fireEvent.click(screen.getByTitle('Slag To Plate'))
    expect(useBlockStore.getState().blocks[0].rootPlan.nodes).toHaveLength(1)
  })

  it('Escape closes the menu without opening a picker', () => {
    withConsumerRecipe()
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Byproducts', 'Slag'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })
})

describe('FactorySummary — Find recipe', () => {
  function withRecipes() {
    const data = structuredClone(mockGameData)
    data.recipes['smelt-iron'] = {
      id: 'smelt-iron', name: 'Smelt Iron', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-plate',
    } as unknown as GameData['recipes'][string]
    data.recipes['mine-iron'] = {
      id: 'mine-iron', name: 'Mine Iron', category: 'mining', craftingTime: 1,
      ingredients: [],
      products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
  }

  it('on a goal opens the filtered picker and adds the recipe to the root plan', async () => {
    withRecipes()
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Find recipe' }))

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe to produce 'Iron Plate'")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Smelt Iron'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind === 'game-recipe' && nodes[0].recipeId).toBe('smelt-iron')
  })

  it('on an ingredient opens the filtered picker and adds the recipe to the root plan', async () => {
    withRecipes()
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    fireEvent.click(within(strip('Ingredients')).getByRole('button', { name: 'Find recipe' }))

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    expect(screen.getByText("Choose a recipe to produce 'Iron Ore'")).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Mine Iron'))
    expect(useBlockStore.getState().blocks[0].rootPlan.nodes).toHaveLength(1)
  })

  it('Escape closes the picker', async () => {
    withRecipes()
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Find recipe' }))
    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })
})

describe('FactorySummary — import lock', () => {
  const noImport = () => useBlockStore.getState().blocks[0].noImportItems
  const lock = (...ids: string[]) =>
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, noImportItems: ids })) }))

  it('right-click then "Forbid imports" locks and dims the slot, below the connection entries', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
    expect(screen.getByText('Receive Iron Ore from')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forbid imports' }))
    expect(noImport()).toEqual(['iron-ore'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-status', 'locked')
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-dimmed', 'true')
  })

  it('the strip toggles Forbid imports and Allow imports', () => {
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    fireEvent.click(within(strip('Ingredients')).getByRole('button', { name: 'Forbid imports' }))
    expect(noImport()).toEqual(['iron-ore'])
    fireEvent.click(within(strip('Ingredients')).getByRole('button', { name: 'Allow imports' }))
    expect(noImport()).toEqual([])
  })

  it('left click on a locked slot only selects it', () => {
    lock('iron-ore')
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    expect(noImport()).toEqual(['iron-ore'])
    expect(strip('Ingredients')).toHaveAttribute('data-state', 'selected')
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })

  it('right-click on a locked slot offers "Allow imports"', () => {
    lock('iron-ore')
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Allow imports' }))
    expect(noImport()).toEqual([])
  })

  it('right-click on a locked goal item offers only "Allow imports"', () => {
    lock('iron-plate')
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Plate'))
    expect(screen.getAllByRole('menuitem').map(el => el.textContent)).toEqual(['Allow imports'])
    expect(screen.queryByText(/Receive .* from/)).not.toBeInTheDocument()
  })
})

describe('FactorySummary — two goals for the same item', () => {
  const second: ProductionGoal = { id: 'g2', itemId: 'iron-plate', rate: 30 }
  const slots = () => within(pane('Products')).getAllByTestId('summary-slot')

  beforeEach(() => setupStore([ironGoal, second]))

  it('selects only the clicked slot', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    expect(slots()[0]).toHaveAttribute('aria-pressed', 'false')
    expect(slots()[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes the second goal, not the first', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove goal' }))
    expect(useBlockStore.getState().blocks[0].goals.map(g => g.id)).toEqual(['g1'])
  })

  it('edits the target of the second goal', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useBlockStore.getState().blocks[0].goals.map(g => g.rate)).toEqual([60, 45])
  })
})
