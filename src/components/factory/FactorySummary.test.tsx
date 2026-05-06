import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FactorySummary } from './FactorySummary'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { GameData, SolverResult, ProductionGoal } from '../../data/types'

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
  modules: {},
  defaultMachines: {},
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
  const rootPlan = { ...block.rootPlan, goals }
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    activeSubPlanId: rootPlan.id,
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData } })
  useSolverStore.setState({
    status: { type: 'idle' },
    lastResult: withSolver ? mockSolverResult : undefined,
    subPlanResults: new Map(),
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
    const goals = useBlockStore.getState().blocks[0].rootPlan.goals
    expect(goals[0].rate).toBeCloseTo(120) // stored in items/min
  })

  it('committing a /sec value converts to items/min before storing', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '2' } }) // 2/sec = 120/min
    fireEvent.blur(input)
    const goals = useBlockStore.getState().blocks[0].rootPlan.goals
    expect(goals[0].rate).toBeCloseTo(120)
  })

  it('pressing Enter commits the edit', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useBlockStore.getState().blocks[0].rootPlan.goals[0].rate).toBeCloseTo(90)
  })

  it('pressing Escape cancels without saving', () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle(/Target:/))
    const input = screen.getByLabelText('Goal target rate')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useBlockStore.getState().blocks[0].rootPlan.goals[0].rate).toBe(60) // unchanged
  })
})

describe('FactorySummary — GoalTile remove', () => {
  it('× button removes the goal', () => {
    render(<FactorySummary />)
    const removeBtn = screen.getByTitle('Remove goal')
    fireEvent.click(removeBtn)
    expect(useBlockStore.getState().blocks[0].rootPlan.goals).toHaveLength(0)
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
    useGameDataStore.setState({ status: { type: 'loaded', gameData: gdWithSteam as unknown as GameData } })
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: surplusResult, subPlanResults: new Map(), _setStatus: () => {} })
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
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: overResult, subPlanResults: new Map(), _setStatus: () => {} })
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
    const goals = useBlockStore.getState().blocks[0].rootPlan.goals
    expect(goals).toHaveLength(1)
    expect(goals[0].itemId).toBe('iron-plate')
    expect(goals[0].rate).toBe(60)
  })
})
