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
const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
  connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-ore',
  available: 30, capped: false, rate: 30, status: 'ok', ...over,
})

function setup(opts: { connected?: boolean; maxRate?: number; flow?: Partial<ConnectionFlow> } = {}) {
  const consumer: Block = {
    ...makeEmptyBlock('Consumer'), id: 'consumer',
    goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
    inputConnections: opts.connected
      ? [{ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner', ...(opts.maxRate === undefined ? {} : { maxRate: opts.maxRate }) }]
      : [],
  }
  const miner: Block = {
    ...makeEmptyBlock('Miner'), id: 'miner',
  }
  useBlockStore.setState({ blocks: [miner, consumer], activeBlockId: 'consumer', history: {} })
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
  useSolverStore.setState({
    lastResults: { miner: minerResult(), consumer: consumerResult() },
    flows: opts.connected ? [flow(opts.flow)] : [],
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

  it('leaves connect mode on a click anywhere on the background', () => {
    setup()
    render(<BlockGraphButton />)
    for (const testId of ['block-graph-layer', 'block-graph-canvas']) {
      open()
      fireEvent.click(within(node('miner')).getByTestId('graph-connect-handle'))
      expect(screen.getByTestId('graph-connect-hint')).toBeTruthy()
      fireEvent.click(screen.getByTestId(testId))
      expect(screen.queryByTestId('graph-connect-hint'), testId).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    }
  })

  it('stays in connect mode when a node is clicked', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByTestId('graph-connect-handle'))
    fireEvent.click(within(node('consumer')).getByRole('button', { name: 'Consumer' }))
    expect(screen.getByTestId('graph-connect-hint')).toBeTruthy()
  })

  it('says a target has not been solved yet instead of claiming nothing to send', () => {
    setup()
    useSolverStore.setState({ lastResults: { miner: minerResult() } })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByTestId('graph-connect-handle'))
    expect(node('consumer').getAttribute('data-connect')).toBe('blocked')
    expect(node('consumer').getAttribute('title')).toBe('Consumer has not been solved yet')
  })

  it('removes a connection from its edge label', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(screen.getByTestId('graph-edge-remove'))
    expect(consumerIn().inputConnections).toEqual([])
    expect(useBlockStore.getState().activeBlockId).toBe('consumer')
  })

  describe('connection limit', () => {
    const limitOf = () => consumerIn().inputConnections[0].maxRate
    const startEdit = () => fireEvent.click(screen.getByTestId('graph-edge-limit'))
    const type = (value: string) => fireEvent.change(screen.getByRole('spinbutton', { name: 'Connection limit' }), { target: { value } })
    const enter = () => fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Connection limit' }), { key: 'Enter' })

    it('sets a limit from the edge label', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      startEdit()
      type('10')
      enter()
      expect(limitOf()).toBe(10)
      expect(screen.getByTestId('graph-edge-limit').textContent).toContain('≤')
    })

    it('converts the typed value from items/s', () => {
      setup({ connected: true })
      useUiStore.setState({ rateUnit: 'sec' })
      render(<BlockGraphButton />)
      open()
      startEdit()
      type('1')
      enter()
      expect(limitOf()).toBe(60)
    })

    it('shows an existing limit and clears it with an empty input', () => {
      setup({ connected: true, maxRate: 20 })
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-edge-limit').textContent).toContain('≤ 20')
      startEdit()
      type('')
      enter()
      expect(limitOf()).toBeUndefined()
      expect('maxRate' in consumerIn().inputConnections[0]).toBe(false)
    })

    it('cancels with Escape without closing the graph', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      startEdit()
      type('10')
      fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Connection limit' }), { key: 'Escape' })
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).toBeNull()
      expect(limitOf()).toBeUndefined()
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    })

    it('titles a chip held back by its limit', () => {
      setup({ connected: true, maxRate: 20, flow: { status: 'limited', capped: true, available: 20, rate: 20 } })
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-edge-label').getAttribute('title')).toMatch(/^Limited by this connection's limit/)
    })
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
