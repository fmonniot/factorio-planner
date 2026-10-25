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

function setup(opts: {
  connected?: boolean
  maxRate?: number
  /** The connection pulls. */
  pull?: boolean
  /** With `loop`: Miner pulls iron plate from Consumer (instead of a push). */
  minerPulls?: boolean
  /** Miner has a recipe that makes iron ore, so a pull from it can apply. */
  minerMakes?: boolean
  flow?: Partial<ConnectionFlow>
  /** Miner also receives iron plate from Consumer, so the two supply each other. */
  loop?: { converged: boolean; rounds?: number }
} = {}) {
  const consumer: Block = {
    ...makeEmptyBlock('Consumer'), id: 'consumer',
    goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }],
    inputConnections: opts.connected
      ? [{ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner', ...(opts.maxRate === undefined ? {} : { maxRate: opts.maxRate }), ...(opts.pull ? { pull: true as const } : {}) }]
      : [],
  }
  const miner: Block = {
    ...makeEmptyBlock('Miner'), id: 'miner',
    inputConnections: opts.loop ? [{ id: 'c2', itemId: 'iron-plate', fromBlockId: 'consumer', ...(opts.minerPulls ? { pull: true as const } : {}) }] : [],
    ...(opts.minerMakes
      ? {
        rootPlan: {
          ...makeEmptyBlock('Miner').rootPlan,
          nodes: [{ kind: 'game-recipe' as const, id: 'n', recipeId: 'mine', modules: [], byproductPolicy: {} }],
        },
      }
      : {}),
  }
  useBlockStore.setState({ blocks: [miner, consumer], activeBlockId: 'consumer', history: {} })
  useUiStore.setState({ rateUnit: 'min' })
  const mine = {
    id: 'mine', name: 'mine', category: 'crafting', craftingTime: 1, ingredients: [],
    products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }], madeIn: [],
  }
  useGameDataStore.setState({
    status: {
      type: 'loaded',
      gameData: { ...mockGameData, recipes: { ...mockGameData.recipes, mine } } as unknown as GameData,
      sourceId: 'test',
    },
  })
  useSolverStore.setState({
    lastResults: { miner: minerResult(), consumer: consumerResult() },
    flows: opts.loop
      ? [
          flow({ loop: true, ...opts.flow }),
          flow({ connectionId: 'c2', fromBlockId: 'consumer', toBlockId: 'miner', itemId: 'iron-plate', loop: true }),
        ]
      : opts.connected ? [flow(opts.flow)] : [],
    loops: opts.loop
      ? [{
          blockIds: ['miner', 'consumer'],
          connectionIds: ['c1', 'c2'],
          backConnectionIds: ['c2'],
          rounds: opts.loop.rounds ?? 2,
          converged: opts.loop.converged,
        }]
      : [],
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

  describe('block colours', () => {
    const colour = (id: string) => useBlockStore.getState().blocks.find(b => b.id === id)!.color

    it('stripes each node in its block colour', () => {
      setup()
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => ({ ...b, color: b.id === 'miner' ? '#60a5fa' : '#a3e635' })),
      }))
      render(<BlockGraphButton />)
      open()
      for (const id of ['miner', 'consumer']) {
        const stripe = within(node(id)).getByTestId('graph-node-stripe')
        expect(stripe.getAttribute('data-color')).toBe(colour(id))
        expect((stripe as HTMLElement).style.background).not.toBe('')
        expect(stripe.className).toContain('z-10')
      }
      expect(colour('miner')).not.toBe(colour('consumer'))
    })

    it('strokes an ok edge and borders its chip in the source block colour', () => {
      setup({ connected: true })
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'miner' ? { ...b, color: '#60a5fa' } : b)) }))
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-edge').getAttribute('stroke')).toBe('#60a5fa')
      expect((screen.getByTestId('graph-edge-label') as HTMLElement).style.borderColor).toBe('#60a5fa')
    })

    it('keeps the status colour for a limited edge and chip', () => {
      setup({ connected: true, maxRate: 20, flow: { status: 'limited', capped: true, available: 20, rate: 20 } })
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'miner' ? { ...b, color: '#60a5fa' } : b)) }))
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-edge').getAttribute('stroke')).toBe('#f59e0b')
      const chip = screen.getByTestId('graph-edge-label') as HTMLElement
      expect(chip.style.borderColor).toBe('')
      expect(chip.className).toContain('border-amber-500')
    })
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

  it('highlights a target that closes a loop', () => {
    setup({ connected: true })
    useSolverStore.setState({
      lastResults: {
        miner: { ...minerResult(), unsatisfied: [{ itemId: 'iron-plate', rate: 10 }] },
        consumer: {
          ...consumerResult(),
          nodes: [{
            recipeNodeId: 'c', inputRates: {}, outputRates: { 'iron-plate': 60 },
            throughput: 60, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
          }],
        },
      },
    })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('consumer')).getByTestId('graph-connect-handle'))
    expect(node('miner').getAttribute('data-connect')).toBe('target')
    expect(node('miner').getAttribute('data-closes-loop')).toBe('true')
    expect(node('miner').getAttribute('title')).toMatch(/Closes a loop/)

    fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
    expect(screen.getByTestId('graph-closes-loop')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Iron Plate/ }))
    const miner = useBlockStore.getState().blocks.find(b => b.id === 'miner')!
    expect(miner.inputConnections).toEqual([
      { id: expect.any(String), itemId: 'iron-plate', fromBlockId: 'consumer' },
    ])
  })

  it('blocks a target with nothing left to send', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('consumer')).getByTestId('graph-connect-handle'))
    expect(node('miner').getAttribute('data-connect')).toBe('blocked')
    expect(node('miner').getAttribute('title')).toMatch(/Nothing to send/)
  })

  describe('loops', () => {
    it('marks the edges, the back edge and the chips of a loop', () => {
      setup({ connected: true, loop: { converged: true } })
      render(<BlockGraphButton />)
      open()
      const edges = screen.getAllByTestId('graph-edge')
      expect(edges).toHaveLength(2)
      for (const e of edges) expect(e.getAttribute('data-loop')).toBe('true')
      const back = edges.filter(e => e.getAttribute('data-back') === 'true')
      expect(back).toHaveLength(1)
      expect(back[0].getAttribute('data-from')).toBe('consumer')
      expect(back[0].getAttribute('data-to')).toBe('miner')
      const chip = screen.getAllByTestId('graph-edge-label').find(l => l.getAttribute('data-connection-id') === 'c2')!
      expect(chip.getAttribute('data-loop')).toBe('true')
      expect(chip.getAttribute('title')).toMatch(/part of a loop/)
      expect(screen.getByTestId('graph-legend-loop')).toBeTruthy()
    })

    it('counts the loops in the header', () => {
      setup({ connected: true, loop: { converged: true } })
      render(<BlockGraphButton />)
      open()
      const status = screen.getByTestId('graph-loop-status')
      expect(status.textContent).toBe('↻ 1 loop')
      expect(status.getAttribute('title')).toBe('Miner → Consumer → Miner')
    })

    it('says in red when a loop did not settle', () => {
      setup({ connected: true, loop: { converged: false, rounds: 8 } })
      render(<BlockGraphButton />)
      open()
      const status = screen.getByTestId('graph-loop-status')
      expect(status.getAttribute('data-converged')).toBe('false')
      expect(status.textContent).toMatch(/did not settle after 8 rounds/)
    })

    it('shows no loop status without a loop', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      expect(screen.queryByTestId('graph-loop-status')).toBeNull()
    })
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

    it('keeps the exact limit when the editor is opened and left untouched', () => {
      setup({ connected: true, maxRate: 19.98 })
      useUiStore.setState({ rateUnit: 'sec' })
      render(<BlockGraphButton />)
      open()
      startEdit()
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      expect((input as HTMLInputElement).value).toBe('0.33')
      const undoDepth = () => useBlockStore.getState().history.consumer?.undoStack.length ?? 0
      const before = undoDepth()
      fireEvent.blur(input)
      expect(limitOf()).toBe(19.98)
      expect(undoDepth()).toBe(before)
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).toBeNull()
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

  describe('pull', () => {
    const chip = () => screen.getByTestId('graph-edge-label')
    const toggle = () => screen.getByTestId('graph-edge-pull')

    it('marks no pull on a push chip and toggles it on and off through the store', () => {
      setup({ connected: true, minerMakes: true })
      render(<BlockGraphButton />)
      open()
      expect(chip().getAttribute('data-pull')).toBeNull()
      expect(toggle().getAttribute('aria-label')).toBe('Pull Iron Ore from Miner to Consumer')
      fireEvent.click(toggle())
      expect(consumerIn().inputConnections[0].pull).toBe(true)
      expect(chip().getAttribute('data-pull')).toBe('applied')
      expect(toggle().getAttribute('aria-label')).toBe('Stop pulling Iron Ore from Miner to Consumer')
      fireEvent.click(toggle())
      expect('pull' in consumerIn().inputConnections[0]).toBe(false)
    })

    it('titles an applied pull with what the source makes', () => {
      setup({ connected: true, pull: true, flow: { demand: 30 } })
      render(<BlockGraphButton />)
      open()
      expect(chip().getAttribute('data-pull')).toBe('applied')
      expect(chip().getAttribute('title')).toBe('Iron Ore: Miner → Consumer — pulled: Miner makes 30.0/m for Consumer')
    })

    it('marks an ignored pull and says why', () => {
      setup({ connected: true, pull: true, flow: { pullIgnored: 'no-producer' } })
      render(<BlockGraphButton />)
      open()
      expect(chip().getAttribute('data-pull')).toBe('ignored')
      expect(chip().getAttribute('title')).toMatch(/pull ignored: the source has no recipe/)
    })

    it('marks a repeated pull as ignored and says why', () => {
      setup({ connected: true, pull: true, flow: { status: 'unused', pullIgnored: 'duplicate' } })
      render(<BlockGraphButton />)
      open()
      expect(chip().getAttribute('data-pull')).toBe('ignored')
      expect(chip().getAttribute('title')).toMatch(/pull ignored: an earlier connection/)
    })

    it('disables the toggle, with the reason, when the source cannot make the item', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      expect(toggle()).toBeDisabled()
      expect(toggle().getAttribute('title')).toBe('Miner has no recipe that makes Iron Ore')
      fireEvent.click(toggle())
      expect('pull' in consumerIn().inputConnections[0]).toBe(false)
    })

    it('disables the toggle when pulling would close a cycle of pulls', () => {
      setup({ connected: true, loop: { converged: true }, minerPulls: true, minerMakes: true })
      render(<BlockGraphButton />)
      open()
      const c1 = within(screen.getAllByTestId('graph-edge-label').find(l => l.dataset.connectionId === 'c1')!).getByTestId('graph-edge-pull')
      expect(c1).toBeDisabled()
      expect(c1.getAttribute('title')).toMatch(/already pulls from/)
      fireEvent.click(c1)
      expect('pull' in consumerIn().inputConnections[0]).toBe(false)
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
