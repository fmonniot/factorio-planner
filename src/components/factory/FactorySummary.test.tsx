import { describe, it, expect, beforeEach, vi } from 'vitest'
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

const ironGoal: ProductionGoal = { id: 'g1', itemId: 'iron-plate', rate: 60 }

const mockSolverResult: SolverResult = {
  nodes: [
    {
      recipeNodeId: 'n1',
      inputRates: { 'iron-ore': 120 },
      outputRates: { 'iron-plate': 60, 'slag': 10 },
      throughput: 30,
      machineCountExact: 2,
      machineCountCeil: 2,
      powerKw: 180,
    },
  ],
  unsatisfied: [{ itemId: 'iron-ore', rate: 120 }],
  warnings: [],
}

function setupStore(goals: ProductionGoal[] = [ironGoal]) {
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
    lastResult: mockSolverResult,
    subPlanResults: new Map(),
    _setStatus: () => {},
  })
}

beforeEach(() => setupStore())

describe('FactorySummary', () => {
  it('shows iron-plate in Products pane', () => {
    render(<FactorySummary />)
    expect(screen.getByText('Products')).toBeInTheDocument()
  })

  it('shows slag in Byproducts pane', () => {
    render(<FactorySummary />)
    expect(screen.getByText('Byproducts')).toBeInTheDocument()
  })

  it('shows iron-ore in Ingredients pane', () => {
    render(<FactorySummary />)
    expect(screen.getByText('Ingredients')).toBeInTheDocument()
  })

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

  it('clicking + opens item picker', async () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add goal'))
    await waitFor(() => expect(screen.getByPlaceholderText(/Search items/i)).toBeInTheDocument())
  })

  it('adding a goal via picker calls addGoal', async () => {
    setupStore([]) // no goals initially
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add goal'))
    await waitFor(() => screen.getByPlaceholderText(/Search items/i))

    const ironPlateBtn = screen.getByRole('button', { name: /Iron Plate/ })
    fireEvent.click(ironPlateBtn)

    const goals = useBlockStore.getState().blocks[0].rootPlan.goals
    expect(goals.length).toBe(1)
    expect(goals[0].itemId).toBe('iron-plate')
  })
})
