import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BlockGraphButton } from './BlockGraph'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, ConnectionFlow, GameData, SolverResult } from '../../data/types'

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
    'iron-ore': { id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: '', hidden: false },
  },
  recipes: {},
  machines: {},
  beacons: {},
  modules: {},
  defaultMachines: {},
  technologies: {},
  startingRecipes: [],
} as unknown as GameData

const minerResult = (): SolverResult => ({
  nodes: [{
    recipeNodeId: 'm', inputRates: {}, outputRates: { 'iron-ore': 200 },
    throughput: 200, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
  }],
  unsatisfied: [],
  warnings: [],
})
const consumerResult = (): SolverResult => ({
  nodes: [],
  unsatisfied: [{ itemId: 'iron-ore', rate: 30 }],
  warnings: [],
})
const flow = (): ConnectionFlow => ({
  connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-ore',
  available: 30, rate: 30, status: 'ok',
})

function setup(opts: { connected?: boolean } = {}) {
  const consumer: Block = {
    ...makeEmptyBlock('Consumer'), id: 'consumer',
    goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
    inputConnections: opts.connected ? [{ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner' }] : [],
  }
  const miner: Block = {
    ...makeEmptyBlock('Miner'), id: 'miner',
  }
  useBlockStore.setState({ blocks: [miner, consumer], activeBlockId: 'consumer', history: {} })
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
  useSolverStore.setState({
    lastResults: { miner: minerResult(), consumer: consumerResult() },
    flows: opts.connected ? [flow()] : [],
    _setStatus: () => {},
  })
}

const node = (id: string) => document.querySelector(`[data-testid="graph-node"][data-block-id="${id}"]`) as HTMLElement
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Block graph' }))
const consumerIn = () => useBlockStore.getState().blocks.find(b => b.id === 'consumer')!

describe('BlockGraph', () => {
  beforeEach(() => {
    useGameDataStore.setState({ status: { type: 'empty' } })
  })

  it('renders no button without game data', () => {
    render(<BlockGraphButton />)
    expect(screen.queryByRole('button', { name: 'Block graph' })).toBeNull()
  })

  it('shows the blocks and the connection between them', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    expect(screen.getAllByTestId('graph-node')).toHaveLength(2)
    const edge = screen.getByTestId('graph-edge')
    expect(edge.getAttribute('data-from')).toBe('miner')
    expect(edge.getAttribute('data-to')).toBe('consumer')
    const label = screen.getByTestId('graph-edge-label')
    expect(label.textContent).toContain('30.0')
    expect(label.getAttribute('data-status')).toBe('ok')
  })

  it('opens the block and closes the graph when a node is clicked', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
    expect(useBlockStore.getState().activeBlockId).toBe('miner')
    expect(screen.queryByRole('heading', { name: 'Block graph' })).toBeNull()
  })

  it('connects from the source side: handle, target, item', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByTestId('graph-connect-handle'))
    expect(screen.getByTestId('graph-connect-hint')).toBeTruthy()
    expect(node('consumer').getAttribute('data-connect')).toBe('target')

    fireEvent.click(within(node('consumer')).getByRole('button', { name: 'Consumer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Iron Ore/ }))

    expect(consumerIn().inputConnections).toEqual([
      { id: expect.any(String), itemId: 'iron-ore', fromBlockId: 'miner' },
    ])
    expect(screen.queryByTestId('graph-connect-hint')).toBeNull()
    // Still open, and the active block did not change.
    expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    expect(useBlockStore.getState().activeBlockId).toBe('consumer')
  })

  it('blocks a target that would close a cycle', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('consumer')).getByTestId('graph-connect-handle'))
    expect(node('miner').getAttribute('data-connect')).toBe('blocked')
    expect(node('miner').getAttribute('title')).toMatch(/cycle/i)
  })

  it('cancels connect mode', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByTestId('graph-connect-handle'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('graph-connect-hint')).toBeNull()
    expect(node('consumer').getAttribute('data-connect')).toBeNull()
  })

  it('removes a connection from its edge label', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(screen.getByTestId('graph-edge-remove'))
    expect(consumerIn().inputConnections).toEqual([])
    expect(useBlockStore.getState().activeBlockId).toBe('consumer')
  })

  it('shows a dash for a connection that has not been solved yet', () => {
    setup({ connected: true })
    useSolverStore.setState({ flows: [] })
    render(<BlockGraphButton />)
    open()
    expect(screen.getByTestId('graph-edge-label').textContent).toContain('—')
  })

  it('does not draw a connection whose source was deleted', () => {
    setup({ connected: true })
    useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== 'miner') }))
    render(<BlockGraphButton />)
    open()
    expect(screen.queryByTestId('graph-edge')).toBeNull()
  })
})
