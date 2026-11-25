import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react'
import { BlockGraphButton } from './BlockGraph'
import { useBlockStore, makeEmptyBlock, makeEmptySubPlan, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, ConnectionFlow, ConnectionPart, GameData, Product, SolverResult } from '../../data/types'

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
  available: 30, capped: false, rate: 30, status: 'ok', kind: 'take', ...over,
})

function setup(opts: {
  connected?: boolean
  maxRate?: number
  /** Products of Miner; iron ore among them makes the connection a request. */
  minerProducts?: Product[]
  flow?: Partial<ConnectionFlow>
  /** Miner also receives iron plate from Consumer, so the two supply each other. */
  loop?: { converged: boolean; rounds?: number }
  /** Connections from Miner after c1, each of its own item (`item-${i}`, "Item ${i}"), without a flow. */
  extra?: number
} = {}) {
  const consumer: Block = {
    ...makeEmptyBlock('Consumer'), id: 'consumer',
    products: [{ id: 'g1', itemId: 'iron-plate', extraRate: 60 }],
    inputConnections: opts.connected
      ? [
          { id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner', ...(opts.maxRate === undefined ? {} : { maxRate: opts.maxRate }) },
          ...Array.from({ length: opts.extra ?? 0 }, (_, i) => ({ id: `x${i}`, itemId: `item-${i}`, fromBlockId: 'miner' })),
        ]
      : [],
  }
  const miner: Block = {
    ...makeEmptyBlock('Miner'), id: 'miner',
    products: opts.minerProducts ?? [],
    inputConnections: opts.loop ? [{ id: 'c2', itemId: 'iron-plate', fromBlockId: 'consumer' }] : [],
  }
  useBlockStore.setState({ blocks: [miner, consumer], activeBlockId: 'consumer', history: {} })
  useUiStore.setState({ rateUnit: 'min', blockGraphView: 'graph' })
  const mine = {
    id: 'mine', name: 'mine', category: 'crafting', craftingTime: 1, ingredients: [],
    products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }], madeIn: [],
  }
  useGameDataStore.setState({
    status: {
      type: 'loaded',
      gameData: {
        ...mockGameData,
        items: {
          ...mockGameData.items,
          ...Object.fromEntries(Array.from({ length: opts.extra ?? 0 }, (_, i) => [
            `item-${i}`, { id: `item-${i}`, name: `Item ${i}`, type: 'item', iconPath: '', hidden: false },
          ])),
        },
        recipes: { ...mockGameData.recipes, mine },
      } as unknown as GameData,
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
    requestLoops: [],
    _setStatus: () => {},
  })
}

const node = (id: string) => document.querySelector(`[data-testid="graph-node"][data-block-id="${id}"]`) as HTMLElement
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Block graph' }))
/** Click the summary chip of an edge (the first one unless `i` says so): the edge is pinned and the strip lists its chips. */
const pinEdge = (i = 0) => fireEvent.click(screen.getAllByTestId('graph-edge-summary')[i])
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
    // Every edge is one summary chip, even with a single connection; the connection's chip is in its list.
    expect(screen.queryByTestId('graph-edge-label')).toBeNull()
    const summary = screen.getByTestId('graph-edge-summary')
    expect(summary.getAttribute('data-count')).toBe('1')
    expect(summary.getAttribute('data-status')).toBe('ok')
    pinEdge()
    const label = within(screen.getByTestId('graph-detail')).getByTestId('graph-edge-label')
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
      pinEdge()
      expect(screen.getByTestId('graph-edge').getAttribute('stroke')).toBe('#60a5fa')
      expect((screen.getByTestId('graph-edge-label') as HTMLElement).style.borderColor).toBe('#60a5fa')
    })

    it('keeps the status colour for a limited edge and chip', () => {
      setup({ connected: true, maxRate: 20, flow: { status: 'limited', capped: true, available: 20, rate: 20 } })
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'miner' ? { ...b, color: '#60a5fa' } : b)) }))
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(screen.getByTestId('graph-edge').getAttribute('stroke')).toBe('#f59e0b')
      const chip = screen.getByTestId('graph-edge-label') as HTMLElement
      expect(chip.style.borderColor).toBe('')
      expect(chip.className).toContain('border-amber-500')
    })
  })

  it('pins the highlight of a block on a click, moves it, and clears it on the background or a second click', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
    // The graph stays open and the active block does not change.
    expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    expect(useBlockStore.getState().activeBlockId).toBe('consumer')
    expect(node('miner')).toHaveAttribute('data-pinned', 'true')
    expect(node('miner')).toHaveAttribute('data-lit', 'true')
    expect(screen.getByTestId('graph-detail').textContent).toContain('Supplies')
    // Hover previews another block, then falls back to the pin.
    fireEvent.mouseEnter(node('consumer'))
    expect(screen.getByTestId('graph-detail').textContent).toContain('Receives from')
    fireEvent.mouseLeave(node('consumer'))
    expect(node('miner')).toHaveAttribute('data-pinned', 'true')
    // Another block moves the pin.
    fireEvent.click(within(node('consumer')).getByRole('button', { name: 'Consumer' }))
    expect(node('consumer')).toHaveAttribute('data-pinned', 'true')
    expect(node('miner')).not.toHaveAttribute('data-pinned')
    // The same block again unpins.
    fireEvent.click(within(node('consumer')).getByRole('button', { name: 'Consumer' }))
    expect(document.querySelectorAll('[data-pinned]')).toHaveLength(0)
    // The background clears a pin.
    fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
    fireEvent.click(screen.getByTestId('block-graph-layer'))
    expect(document.querySelectorAll('[data-pinned], [data-lit]')).toHaveLength(0)
  })

  it('opens a block and closes the graph from its Go to button', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    const goTo = within(node('miner')).getByTestId('graph-node-open')
    expect(goTo).toHaveAccessibleName('Go to Miner')
    expect(goTo.closest('[data-tip]')).toHaveAttribute('data-tip', 'Go to Miner')
    fireEvent.click(goTo)
    expect(useBlockStore.getState().activeBlockId).toBe('miner')
    expect(screen.queryByRole('heading', { name: 'Block graph' })).toBeNull()
  })

  it('offers Go to in the strip for the pinned block', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
    fireEvent.click(within(screen.getByTestId('graph-detail')).getByTestId('graph-detail-open'))
    expect(useBlockStore.getState().activeBlockId).toBe('miner')
    expect(screen.queryByRole('heading', { name: 'Block graph' })).toBeNull()
  })

  it('shows its hints as instant tooltips and leaves no native title in the graph', () => {
    setup({ connected: true, extra: 11, flow: { status: 'limited' } })
    render(<BlockGraphButton />)
    open()
    const goTo = within(node('miner')).getByTestId('graph-node-open')
    expect(goTo.closest('[data-tip]'), 'the Go to button or its wrapper').toHaveAttribute('data-tip', 'Go to Miner')
    expect(goTo).toHaveAttribute('aria-label', 'Go to Miner')
    const summary = screen.getByTestId('graph-edge-summary')
    expect(summary.getAttribute('aria-label'), 'short accessible name').toMatch(/^\d+ items from Miner to Consumer$/)
    expect(summary.getAttribute('data-tip'), 'long tooltip').toContain('click to pin it')
    expect(document.querySelectorAll('[title]'), 'no native title in the graph').toHaveLength(0)
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
      // The chip of the back connection is in the list of its edge (consumer > miner).
      const summaries = screen.getAllByTestId('graph-edge-summary')
      pinEdge(summaries.findIndex(s => s.getAttribute('data-from') === 'consumer'))
      const chip = within(screen.getByTestId('graph-detail')).getAllByTestId('graph-edge-label')
        .find(l => l.getAttribute('data-connection-id') === 'c2')!
      expect(chip.getAttribute('data-loop')).toBe('true')
      expect(chip.getAttribute('data-tip')).toMatch(/part of a loop/)
      expect(screen.getByTestId('graph-legend-loop')).toBeTruthy()
    })

    it('counts the loops in the header', () => {
      setup({ connected: true, loop: { converged: true } })
      render(<BlockGraphButton />)
      open()
      const status = screen.getByTestId('graph-loop-status')
      expect(status.textContent).toBe('↻ 1 loop')
      expect(status.getAttribute('data-tip')).toBe('Miner → Consumer → Miner')
    })

    it('says in red when a loop did not settle', () => {
      setup({ connected: true, loop: { converged: false, rounds: 8 } })
      render(<BlockGraphButton />)
      open()
      const status = screen.getByTestId('graph-loop-status')
      expect(status.getAttribute('data-converged')).toBe('false')
      expect(status.textContent).toMatch(/did not settle after 8 rounds/)
    })

    it('says in red when the requests around a loop did not settle', () => {
      setup({ connected: true, loop: { converged: true } })
      useSolverStore.setState({
        requestLoops: [{
          blockIds: ['miner', 'consumer'], connectionIds: ['c1', 'c2'], backConnectionIds: ['c2'], rounds: 3, converged: false,
        }],
      })
      render(<BlockGraphButton />)
      open()
      const status = screen.getByTestId('graph-loop-status')
      expect(status.getAttribute('data-converged')).toBe('false')
      expect(status.textContent).toBe(
        'Requests around Miner, Consumer do not settle after 3 rounds; the requests that close the loop take what is left over',
      )
    })

    it('joins an unsettled supply loop and an unsettled request loop', () => {
      setup({ connected: true, loop: { converged: false, rounds: 8 } })
      useSolverStore.setState({
        requestLoops: [{
          blockIds: ['miner', 'consumer'], connectionIds: ['c1', 'c2'], backConnectionIds: ['c2'], rounds: 3, converged: false,
        }],
      })
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-loop-status').textContent).toMatch(/last round\. Requests around/)
    })

    it('counts a settled cycle of requests as one loop', () => {
      setup({ connected: true, loop: { converged: true } })
      useSolverStore.setState({
        requestLoops: [{
          blockIds: ['miner', 'consumer'], connectionIds: ['c1', 'c2'], backConnectionIds: ['c2'], rounds: 3, converged: true,
        }],
      })
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-loop-status').textContent).toBe('↻ 1 loop')
    })

    it('shows no loop status without a loop', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      expect(screen.queryByTestId('graph-loop-status')).toBeNull()
    })
  })

  it('removes a connection from its edge label', () => {
    setup({ connected: true })
    render(<BlockGraphButton />)
    open()
    pinEdge()
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
      pinEdge()
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
      pinEdge()
      startEdit()
      type('1')
      enter()
      expect(limitOf()).toBe(60)
    })

    it('shows an existing limit and clears it with an empty input', () => {
      setup({ connected: true, maxRate: 20 })
      render(<BlockGraphButton />)
      open()
      pinEdge()
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
      pinEdge()
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
      pinEdge()
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
      pinEdge()
      expect(screen.getByTestId('graph-edge-label').getAttribute('data-tip')).toMatch(/^Limited by this connection's limit/)
    })
  })

  describe('parts of a split fluid', () => {
    const titleWith = (parts: ConnectionPart[] | undefined) => {
      setup({ connected: true, flow: { rate: 30, available: 50, ...(parts ? { parts } : {}) } })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      return screen.getByTestId('graph-edge-label').getAttribute('data-tip')!
    }
    it('lists the parts of a connection that carries two', () => {
      const title = titleWith([
        { temp: { at: 165 }, rate: 20, available: 30 },
        { temp: { at: 465 }, rate: 10, available: 10 },
      ])
      expect(title).toMatch(/ — carries 20\.0\/m at 165°C \(of 30\.0\/m offered\), 10\.0\/m at 465°C$/)
    })
    it('names a single labelled part', () => {
      expect(titleWith([{ temp: { min: 465 }, rate: 30, available: 30 }])).toMatch(/ — carries 30\.0\/m at ≥465°C$/)
    })
    it('says nothing for one unlabelled part or a plain flow', () => {
      expect(titleWith([{ temp: { at: null }, rate: 30, available: 30 }])).not.toMatch(/carries/)
      cleanup()
      expect(titleWith(undefined)).not.toMatch(/carries/)
    })
  })

  describe('served order', () => {
    const chip = () => screen.getByTestId('graph-edge-label')
    const ironOre: Product = { id: 'po', itemId: 'iron-ore' }
    const consumerEntry = { kind: 'block' as const, blockId: 'consumer' }
    const served = (consumers: string[]) => ({
      miner: { 'iron-ore': { consumers: consumers.map(blockId => ({ blockId, connectionId: `c-${blockId}`, kind: 'take' as const, share: 0, got: 5 })) } },
    })
    const storeList = (order: unknown[] | undefined) => useBlockStore.setState(st => ({
      blocks: st.blocks.map(b => (b.id === 'miner' ? { ...b, servedOrder: order ? { 'iron-ore': order } : undefined } : b)),
    }) as never)

    it('shows the rank of the consumer in the source\'s stored list', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      storeList([{ kind: 'block', blockId: 'other' }, consumerEntry])
      useSolverStore.setState({ served: served(['other', 'consumer']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
      expect(chip().getAttribute('data-tip')).toMatch(/ — served 2nd in Miner's list$/)
    })

    it('shows the rank a group shares and says so in the title', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      storeList([{ kind: 'block', blockId: 'other' }, { ...consumerEntry, tied: true }])
      useSolverStore.setState({ served: served(['other', 'consumer']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#1')
      expect(chip().getAttribute('data-tip')).toMatch(/ — served 1st \(shared\) in Miner's list$/)
    })

    it('shows the place of a group that is not the first', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      storeList([{ kind: 'block', blockId: 'other' }, consumerEntry, { kind: 'block', blockId: 'third', tied: true }])
      useSolverStore.setState({ served: served(['other', 'consumer', 'third']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
      expect(chip().getAttribute('data-tip')).toMatch(/ — served 2nd \(shared\) in Miner's list$/)
    })

    it('counts the extra output line as a place of the list, as the popover does', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      storeList([{ kind: 'extra' }, consumerEntry])
      useSolverStore.setState({ served: { miner: { 'iron-ore': { ...served(['consumer'])['miner']['iron-ore'], extra: { place: 0, asked: 5, got: 5 } } } } } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
    })

    it('puts the served text after a request\'s own title text', () => {
      setup({ connected: true, minerProducts: [ironOre], flow: { kind: 'request', requested: 30 } })
      storeList([consumerEntry, { kind: 'block', blockId: 'other' }])
      useSolverStore.setState({ served: served(['consumer', 'other']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(chip().getAttribute('data-tip')).toBe("Iron Ore: Miner → Consumer — requested: Miner makes 30.0/m for Consumer — served 1st in Miner's list")
    })

    describe('a consumer drawn as areas', () => {
      const areaEntry = (areaId: string, flags: { tied?: true } = {}) => ({ kind: 'block' as const, blockId: 'consumer', areaId, ...flags })
      const areaServed = () => ({
        miner: {
          'iron-ore': {
            consumers: [
              { blockId: 'other', connectionId: 'c-other', kind: 'take' as const, share: 0, got: 5 },
              { blockId: 'consumer', connectionId: 'c1', kind: 'take' as const, share: 0, got: 5, areaId: 'L' },
              { blockId: 'consumer', connectionId: 'c1', kind: 'take' as const, share: 0, got: 5, areaId: 'B' },
            ],
          },
        },
      })
      const areaSetup = (order: unknown[]) => {
        setup({ connected: true, minerProducts: [ironOre] })
        useBlockStore.setState(st => ({
          blocks: st.blocks.map(b => {
            if (b.id === 'consumer') {
              return { ...b, rootPlan: { ...b.rootPlan, subPlans: [{ ...makeEmptySubPlan('Logistics'), id: 'L', area: true }, { ...makeEmptySubPlan('Building'), id: 'B', area: true }] } }
            }
            return b.id === 'miner' ? { ...b, servedOrder: { 'iron-ore': order } } : b
          }),
        }) as never)
        useSolverStore.setState({ served: areaServed() } as never)
        render(<BlockGraphButton />)
        open()
        pinEdge()
      }
      const other = { kind: 'block' as const, blockId: 'other' }

      it('shows the best rank and lists each ranked area', () => {
        areaSetup([other, areaEntry('B'), areaEntry('L')])
        expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
        expect(chip().getAttribute('data-tip')).toMatch(/ — served 2nd \(Consumer \/ Building\), 3rd \(Consumer \/ Logistics\) in Miner's list$/)
      })

      it('marks shared areas', () => {
        areaSetup([other, areaEntry('L'), areaEntry('B', { tied: true })])
        expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
        expect(chip().getAttribute('data-tip')).toMatch(/ — served 2nd shared \(Consumer \/ Logistics\), 2nd shared \(Consumer \/ Building\) in Miner's list$/)
      })

      it('lists only the ranked area', () => {
        areaSetup([other, areaEntry('L')])
        expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
        expect(chip().getAttribute('data-tip')).toMatch(/ — served 2nd \(Consumer \/ Logistics\) in Miner's list$/)
      })

      it('lists both lines of a plain block entry', () => {
        areaSetup([other, { kind: 'block', blockId: 'consumer' }])
        expect(within(chip()).getByTestId('graph-edge-rank').textContent).toBe('#2')
        const title = chip().getAttribute('data-tip')!
        expect(title).toContain('(Consumer / Logistics)')
        expect(title).toContain('(Consumer / Building)')
      })
    })

    it('shows no rank without a stored list', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      useSolverStore.setState({ served: served(['other', 'consumer']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).queryByTestId('graph-edge-rank')).toBeNull()
      expect(chip().getAttribute('data-tip')).not.toContain('served ')
    })

    it('shows no rank for a consumer the stored list does not name', () => {
      setup({ connected: true, minerProducts: [ironOre] })
      storeList([{ kind: 'block', blockId: 'other' }])
      useSolverStore.setState({ served: served(['other', 'consumer']) } as never)
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).queryByTestId('graph-edge-rank')).toBeNull()
    })
  })

  describe('requests', () => {
    const chip = () => screen.getByTestId('graph-edge-label')
    const ironOre: Product = { id: 'po', itemId: 'iron-ore' }

    it('titles a request with what the source makes for the consumer', () => {
      setup({ connected: true, minerProducts: [ironOre], flow: { kind: 'request', requested: 30 } })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(chip().getAttribute('data-kind')).toBe('request')
      expect(chip().getAttribute('data-tip')).toBe('Iron Ore: Miner → Consumer — requested: Miner makes 30.0/m for Consumer')
    })

    it('does not call a take requested', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(chip().getAttribute('data-kind')).toBe('take')
      expect(chip().getAttribute('data-tip')).not.toContain(' — requested')
      expect(chip().getAttribute('data-request-ignored')).toBeNull()
    })

    it('marks an ignored request and says why', () => {
      setup({ connected: true, minerProducts: [ironOre], flow: { requestIgnored: 'request-loop' } })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(chip().getAttribute('data-request-ignored')).toBe('request-loop')
      expect(chip().getAttribute('data-tip')).toContain('taken as existing: the requests around this loop do not settle')
    })

    it('tags a take chip as existing', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).getByTestId('graph-edge-existing').textContent).toBe('existing')
    })

    it('has no existing tag on a request', () => {
      setup({ connected: true, minerProducts: [ironOre], flow: { kind: 'request', requested: 30 } })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).queryByTestId('graph-edge-existing')).toBeNull()
    })

    it('has no existing tag before the first solve', () => {
      setup({ connected: true })
      useSolverStore.setState({ flows: [] })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(within(chip()).queryByTestId('graph-edge-existing')).toBeNull()
    })

    it('has no pull toggle', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      expect(screen.queryByTestId('graph-edge-pull')).toBeNull()
    })

  })

  it('shows a dash for a connection that has not been solved yet', () => {
    setup({ connected: true })
    useSolverStore.setState({ flows: [] })
    render(<BlockGraphButton />)
    open()
    pinEdge()
    expect(screen.getByTestId('graph-edge-label').textContent).toContain('—')
  })

  it('does not draw a connection whose source was deleted', () => {
    setup({ connected: true })
    useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== 'miner') }))
    render(<BlockGraphButton />)
    open()
    expect(screen.queryByTestId('graph-edge')).toBeNull()
  })

  describe('busy edge', () => {
    const summary = () => screen.getByTestId('graph-edge-summary')
    const rows = () => within(screen.getByTestId('graph-detail')).queryAllByTestId('graph-edge-label')
    const escape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

    it('summarises even a single connection: one chip per edge, no chips until it is pinned', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      expect(screen.getAllByTestId('graph-edge-summary')).toHaveLength(1)
      expect(summary().getAttribute('data-count')).toBe('1')
      expect(summary().getAttribute('aria-label')).toBe('1 item from Miner to Consumer')
      expect(summary().getAttribute('data-tip')).toContain('1 item from Miner to Consumer')
      expect(summary()).not.toHaveAttribute('aria-haspopup')
      expect(screen.queryByTestId('graph-edge-label')).toBeNull()
    })

    it('folds more connections into one summary chip', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      expect(screen.getAllByTestId('graph-edge-summary')).toHaveLength(1)
      expect(summary().getAttribute('data-count')).toBe('12')
      expect(summary().getAttribute('aria-pressed')).toBe('false')
      expect(summary().getAttribute('aria-label')).toBe('12 items from Miner to Consumer')
      expect(summary().textContent).toContain('+9')
      expect(screen.queryByTestId('graph-edge-label')).toBeNull()
      expect(summary().getAttribute('data-status')).toBe('ok')
    })

    it('shows the edge status and what is limited on the summary chip', () => {
      setup({ connected: true, extra: 11, flow: { status: 'limited' } })
      render(<BlockGraphButton />)
      open()
      expect(summary().getAttribute('data-status')).toBe('limited')
      expect(summary().getAttribute('data-tip')).toContain('1 limited')
    })

    it('pins the edge when its chip is clicked and lists every connection in the strip, and unpins on a second click', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      expect(summary().getAttribute('aria-pressed')).toBe('true')
      expect(summary()).toHaveAttribute('data-pinned', 'true')
      expect(rows()).toHaveLength(12)
      expect(screen.getByTestId('graph-detail').textContent).toContain('Item 3')
      fireEvent.click(summary())
      expect(rows()).toHaveLength(0)
      expect(summary()).not.toHaveAttribute('data-pinned')
    })

    it('keeps the pinned edge lit and its items in the strip when the pointer leaves it', () => {
      setup({ connected: true, extra: 1 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.mouseEnter(screen.getByTestId('graph-edge-hit'))
      fireEvent.mouseLeave(screen.getByTestId('graph-edge-hit'))
      expect(screen.getByTestId('graph-edge')).toHaveAttribute('data-lit', 'true')
      expect(summary()).toHaveAttribute('data-shown', 'true')
      expect(rows()).toHaveLength(2)
    })

    it('removes a connection from the strip and keeps the edge pinned', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.click(within(screen.getByTestId('graph-detail')).getAllByTestId('graph-edge-remove')[0])
      expect(consumerIn().inputConnections).toHaveLength(11)
      expect(rows()).toHaveLength(11)
    })

    it('removes the edge and clears the pin when its last connection is removed', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      fireEvent.click(within(screen.getByTestId('graph-detail')).getByTestId('graph-edge-remove'))
      expect(screen.queryByTestId('graph-edge-summary')).toBeNull()
      expect(screen.queryByTestId('graph-edge-label')).toBeNull()
      expect(screen.queryByTestId('graph-edge')).toBeNull()
      expect(screen.getByTestId('graph-detail').textContent).toContain('Point at a block')
    })

    it('saves a limit being typed when the pin is cleared by a click on the background', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.click(within(rows()[0]).getByTestId('graph-edge-limit'))
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      input.focus()
      fireEvent.change(input, { target: { value: '5' } })
      // A real press on the background blurs the input before the click unpins and unmounts the strip.
      input.blur()
      fireEvent.click(screen.getByTestId('block-graph-layer'))
      expect(consumerIn().inputConnections[0].maxRate).toBe(5)
      expect(rows()).toHaveLength(0)
    })

    it('keeps the pinned edge in the strip, with the limit being typed, while the pointer previews another block', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.click(within(rows()[0]).getByTestId('graph-edge-limit'))
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      input.focus()
      fireEvent.change(input, { target: { value: '5' } })
      fireEvent.mouseEnter(screen.getAllByTestId('graph-node')[0])
      fireEvent.mouseEnter(screen.getByTestId('graph-edge-hit'))
      expect(screen.getByRole('spinbutton', { name: 'Connection limit' })).toBe(input)
      expect(input).toHaveValue(5)
      expect(rows()).toHaveLength(12)
      input.blur()
      expect(consumerIn().inputConnections[0].maxRate).toBe(5)
    })

    it('lets the pointer in the strip hold the pin over a preview from the graph', () => {
      setup({ connected: true, extra: 1 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.mouseEnter(screen.getByTestId('graph-detail').parentElement!)
      fireEvent.mouseEnter(screen.getAllByTestId('graph-node')[0])
      expect(rows()).toHaveLength(2)
      fireEvent.mouseLeave(screen.getByTestId('graph-detail').parentElement!)
      expect(screen.getByTestId('graph-detail').textContent).not.toContain('Receives from')
    })

    it('shows no pull mark or count on the summary chip', () => {
      setup({ connected: true, extra: 11, minerProducts: [{ id: 'po', itemId: 'iron-ore' }], flow: { kind: 'request', requested: 30 } })
      render(<BlockGraphButton />)
      open()
      expect(summary().getAttribute('data-pull')).toBeNull()
      expect(summary().textContent).not.toContain('⇠')
      expect(summary().getAttribute('data-tip')).not.toContain('pulled')
      expect(summary().getAttribute('data-tip')).not.toContain('requested')
    })

    it('sets a limit from the strip and keeps the edge pinned', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      const row = rows().find(r => r.dataset.connectionId === 'x3')!
      fireEvent.click(within(row).getByTestId('graph-edge-limit'))
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      fireEvent.change(input, { target: { value: '10' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(consumerIn().inputConnections.find(c => c.id === 'x3')!.maxRate).toBe(10)
      expect(rows()).toHaveLength(12)
    })

    it('cancels a limit edit with Escape without unpinning or closing the graph', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      fireEvent.click(within(rows()[0]).getByTestId('graph-edge-limit'))
      fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Connection limit' }), { key: 'Escape' })
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).toBeNull()
      expect(rows()).toHaveLength(12)
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    })

    it('unpins with the first Escape and closes the graph with the second', () => {
      setup({ connected: true, extra: 11 })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summary())
      escape()
      expect(rows()).toHaveLength(0)
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
      escape()
      expect(screen.queryByRole('heading', { name: 'Block graph' })).toBeNull()
    })

    it('pins a block the same way, and Escape unpins it first', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
      expect(node('miner')).toHaveAttribute('data-pinned', 'true')
      escape()
      expect(document.querySelectorAll('[data-pinned]')).toHaveLength(0)
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    })

    it('replaces the pin: a block pin gives way to an edge pin and back', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      fireEvent.click(within(node('miner')).getByRole('button', { name: 'Miner' }))
      fireEvent.click(summary())
      expect(summary()).toHaveAttribute('data-pinned', 'true')
      expect(node('miner')).not.toHaveAttribute('data-pinned')
      fireEvent.click(within(node('consumer')).getByRole('button', { name: 'Consumer' }))
      expect(summary()).not.toHaveAttribute('data-pinned')
      expect(node('consumer')).toHaveAttribute('data-pinned', 'true')
    })
  })

  describe('lighting and the detail strip', () => {
    /** Miner feeds Consumer (c1, iron ore) and Other (c9, iron ore). */
    const withOther = (flowOver: Partial<ConnectionFlow> = {}) => {
      setup({ connected: true, flow: flowOver })
      const other: Block = {
        ...makeEmptyBlock('Other'), id: 'other',
        inputConnections: [{ id: 'c9', itemId: 'iron-ore', fromBlockId: 'miner' }],
      }
      useBlockStore.setState(s => ({ blocks: [...s.blocks, other] }))
      useSolverStore.setState(s => ({ flows: [...s.flows, flow({ connectionId: 'c9', toBlockId: 'other' })] }))
      useGameDataStore.setState(s => {
        if (s.status.type !== 'loaded') return s
        const items = { ...s.status.gameData.items, 'iron-ore': { ...s.status.gameData.items['iron-ore'], iconPath: 'iron-ore.png' } }
        return { status: { ...s.status, gameData: { ...s.status.gameData, items } } }
      })
    }
    const edge = (to: string) => document.querySelector(`[data-testid="graph-edge"][data-to="${to}"]`) as HTMLElement
    const hit = (to: string) => document.querySelector(`[data-testid="graph-edge-hit"][data-to="${to}"]`) as HTMLElement
    const summaryTo = (to: string) => screen.getAllByTestId('graph-edge-summary').find(x => x.getAttribute('data-to') === to)!

    it('says what to do while nothing is pointed at', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-detail').textContent).toContain('Point at a block or a connection')
      expect(document.querySelectorAll('[data-lit], [data-dim]')).toHaveLength(0)
    })

    it('lights a block, its edges and their ends and dims the rest, and lists what it supplies and receives', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(node('consumer'))
      expect(node('consumer')).toHaveAttribute('data-lit', 'true')
      expect(node('miner')).toHaveAttribute('data-lit', 'true')
      expect(node('other')).toHaveAttribute('data-dim', 'true')
      expect(edge('consumer')).toHaveAttribute('data-lit', 'true')
      expect(edge('other')).toHaveAttribute('data-dim', 'true')
      const detail = within(screen.getByTestId('graph-detail'))
      expect(detail.getByText('Receives from')).toBeTruthy()
      expect(detail.getByText('Supplies')).toBeTruthy()
      expect(screen.getByTestId('graph-detail').textContent).toContain('Miner')
      expect(screen.getByTestId('graph-detail').textContent).toContain('1 item')
      fireEvent.mouseLeave(node('consumer'))
      expect(document.querySelectorAll('[data-dim]')).toHaveLength(0)
      expect(screen.getByTestId('graph-detail').textContent).toContain('Point at a block')

      fireEvent.mouseEnter(node('miner'))
      expect(within(screen.getByTestId('graph-detail')).getAllByTestId('graph-detail-block')).toHaveLength(2)
    })

    it('says a block with no edge is not connected', () => {
      withOther()
      useBlockStore.setState(s => ({ blocks: [...s.blocks, makeEmptyBlock('Alone')] }))
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(document.querySelector('[data-testid="graph-node"]:last-of-type') as HTMLElement)
      expect(screen.getByTestId('graph-detail').textContent).toContain('Not connected to any other block.')
    })

    it('lists the items of a pointed edge as chips with their icons and tags', () => {
      withOther({ status: 'limited', capped: true, available: 20, rate: 20, kind: 'take' })
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'consumer'
          ? { ...b, inputConnections: b.inputConnections.map(c => ({ ...c, maxRate: 20 })) }
          : b)),
      }))
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(hit('consumer'))
      expect(edge('consumer')).toHaveAttribute('data-lit', 'true')
      expect(edge('other')).toHaveAttribute('data-dim', 'true')
      const detail = screen.getByTestId('graph-detail')
      expect(detail.textContent).toContain('Items on this edge')
      expect(detail.textContent).toContain('Miner → Consumer')
      expect(detail.textContent).toContain('click the edge to pin it and edit')
      const row = within(detail).getByTestId('graph-edge-label')
      expect(row.querySelector('picture'), 'the icon').not.toBeNull()
      expect(row.textContent).toContain('Iron Ore')
      expect(within(row).getByTestId('graph-edge-existing')).toBeTruthy()
      expect(row.textContent).toContain('20.0')
      expect(row.getAttribute('data-tip')).toMatch(/^Limited by this connection's limit/)
    })
    it('shows the served place in the strip', () => {
      setup({ connected: true, minerProducts: [{ id: 'po', itemId: 'iron-ore' }] })
      useBlockStore.setState(st => ({
        blocks: st.blocks.map(b => (b.id === 'miner'
          ? { ...b, servedOrder: { 'iron-ore': [{ kind: 'block' as const, blockId: 'other' }, { kind: 'block' as const, blockId: 'consumer' }] } }
          : b)),
      }) as never)
      useSolverStore.setState({
        served: {
          miner: { 'iron-ore': { consumers: ['other', 'consumer'].map(blockId => ({ blockId, connectionId: `c-${blockId}`, kind: 'take' as const, share: 0, got: 5 })) } },
        },
      } as never)
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(hit('consumer'))
      expect(within(screen.getByTestId('graph-detail')).getByTestId('graph-edge-rank').textContent).toBe('#2')
    })
    it('shows the chip of the edge that is pointed at, and pins the edge on a click on it', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      expect(summaryTo('consumer').closest('div.absolute')!.className).toContain('opacity-0')
      fireEvent.mouseEnter(hit('consumer'))
      expect(summaryTo('consumer').closest('div.absolute')!.className).toContain('opacity-100')
      expect(summaryTo('other').closest('div.absolute')!.className).toContain('opacity-0')
      fireEvent.click(hit('consumer'))
      expect(summaryTo('consumer')).toHaveAttribute('data-pinned', 'true')
      fireEvent.mouseLeave(hit('consumer'))
      expect(within(screen.getByTestId('graph-detail')).getAllByTestId('graph-edge-label')).toHaveLength(1)
      fireEvent.click(hit('consumer'))
      expect(screen.queryByTestId('graph-edge-label')).toBeNull()
    })
    it('does not show the chips of the edges of a lit block', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(node('miner'))
      for (const to of ['consumer', 'other']) expect(summaryTo(to).closest('div.absolute')!.className).toContain('opacity-0')
    })

    it('lights an edge when its summary chip takes focus, and fills the strip', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      act(() => summaryTo('other').focus())
      expect(summaryTo('other')).toHaveAttribute('data-lit', 'true')
      expect(edge('other')).toHaveAttribute('data-lit', 'true')
      expect(edge('consumer')).toHaveAttribute('data-dim', 'true')
      expect(screen.getByTestId('graph-detail').textContent).toContain('Items on this edge')
      act(() => summaryTo('other').blur())
      expect(document.querySelectorAll('[data-lit], [data-dim]')).toHaveLength(0)
    })

    it('lights a block when it takes focus', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      act(() => within(node('consumer')).getByTestId('graph-node-select').focus())
      expect(node('other')).toHaveAttribute('data-dim', 'true')
      expect(screen.getByTestId('graph-detail').textContent).toContain('Receives from')
    })

    it('keeps one pin at a time across edges', () => {
      withOther()
      render(<BlockGraphButton />)
      open()
      fireEvent.click(summaryTo('consumer'))
      expect(summaryTo('consumer')).toHaveAttribute('data-pinned', 'true')
      fireEvent.click(hit('other'))
      expect(summaryTo('other')).toHaveAttribute('data-pinned', 'true')
      expect(summaryTo('consumer')).not.toHaveAttribute('data-pinned')
      expect(screen.getAllByTestId('graph-edge-label')).toHaveLength(1)
    })
    it('shows the source rule marker on the chip in the strip, as the list did', () => {
      withOther()
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'consumer' ? { ...b, sourceRules: { 'iron-ore': { importOff: true as const } }, rootPlan: { ...b.rootPlan, nodes: [makeRecipeNode('mine')] } } : b)),
      }))
      render(<BlockGraphButton />)
      open()
      fireEvent.mouseEnter(hit('consumer'))
      const detail = within(screen.getByTestId('graph-detail'))
      expect(detail.getAllByTestId('graph-edge-label')).toHaveLength(1)
      expect(detail.getAllByTestId('source-rule-marker')).toHaveLength(1)
    })
    it('draws a back edge dashed and says so in the legend', () => {
      setup({ connected: true, loop: { converged: true } })
      render(<BlockGraphButton />)
      open()
      expect(screen.getByTestId('graph-legend-back')).toBeTruthy()
      const back = screen.getAllByTestId('graph-edge').find(e => e.getAttribute('data-back') === 'true')!
      expect(back.getAttribute('stroke-dasharray')).toBe('6 5')
    })
  })

  describe('source rule marker', () => {
    const markers = () => screen.queryAllByTestId('source-rule-marker')
    const label = (connectionId: string) =>
      document.querySelector(`[data-testid="graph-edge-label"][data-connection-id="${connectionId}"]`) as HTMLElement
    const patch = (id: string, over: (b: Block) => Partial<Block>) =>
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === id ? { ...b, ...over(b) } : b)) }))
    /** Import off on iron ore in `id`; with a row that makes it there (the `mine` recipe) the rule has an effect. */
    const lockOre = (id: string, withRow = true) => patch(id, b => ({
      sourceRules: { 'iron-ore': { importOff: true as const } },
      rootPlan: withRow ? { ...b.rootPlan, nodes: [makeRecipeNode('mine')] } : b.rootPlan,
    }))

    beforeEach(() => useUiStore.setState({ ingredientSlotRequest: null }))

    it('is on the edge chip of a connection of the item into the block that holds the rule', () => {
      setup({ connected: true, extra: 1 })
      lockOre('consumer')
      render(<BlockGraphButton />)
      open()
      // The summary chip shows the marker as a decorative dot; the chip of the connection has the real one.
      expect(markers()).toHaveLength(1)
      expect(within(screen.getByTestId('graph-edge-summary')).getByTestId('source-rule-marker')).toBeTruthy()
      expect(screen.queryByTestId('graph-edge-label')).toBeNull()
      pinEdge()
      expect(markers()).toHaveLength(2)
      const marker = within(label('c1')).getByTestId('source-rule-marker')
      expect(marker).toHaveAttribute('data-item-id', 'iron-ore')
      // The rule of the item in the block that receives it; the model's reading follows once the pointer is over it.
      expect(marker).toHaveAccessibleName('Import off')
      fireEvent.pointerOver(marker)
      expect(marker.getAttribute('aria-label')).toMatch(/^Import off\n/)
      // The other connection into the same block carries another item.
      expect(within(label('x0')).queryByTestId('source-rule-marker')).toBeNull()
    })

    it('is absent for the default and for a rule with no effect', () => {
      setup({ connected: true })
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(markers()).toHaveLength(0)
      // No row of Consumer makes iron ore: the lock has no effect.
      act(() => lockOre('consumer', false))
      expect(label('c1')).not.toBeNull()
      expect(markers()).toHaveLength(0)
    })

    it('is not on a connection of the item out of the block that holds the rule', () => {
      setup({ connected: true })
      lockOre('miner')
      render(<BlockGraphButton />)
      open()
      pinEdge()
      expect(label('c1')).not.toBeNull()
      expect(markers()).toHaveLength(0)
    })

    it('is not on a connection of the same item into another block', () => {
      setup({ connected: true })
      lockOre('consumer')
      const other: Block = {
        ...makeEmptyBlock('Other'), id: 'other',
        inputConnections: [{ id: 'c9', itemId: 'iron-ore', fromBlockId: 'miner' }],
      }
      useBlockStore.setState(s => ({ blocks: [...s.blocks, other] }))
      render(<BlockGraphButton />)
      open()
      const summaryTo = (id: string) => screen.getAllByTestId('graph-edge-summary').find(x => x.getAttribute('data-to') === id)!
      expect(within(summaryTo('other')).queryByTestId('source-rule-marker')).toBeNull()
      fireEvent.click(summaryTo('consumer'))
      expect(within(label('c1')).getAllByTestId('source-rule-marker')).toHaveLength(1)
      // The summary's dot and the chip's marker; nothing on the other edge.
      expect(markers()).toHaveLength(2)
      fireEvent.click(summaryTo('other'))
      expect(within(label('c9')).queryByTestId('source-rule-marker')).toBeNull()
      expect(markers(), 'only the dot on the consumer edge\'s summary is left').toHaveLength(1)
    })

    it('only shows the rule, also when the block is the active one: a click opens nothing and the graph stays', () => {
      setup({ connected: true })
      lockOre('consumer')
      render(<BlockGraphButton />)
      open()
      const marker = markers()[0]
      expect(marker.tagName).toBe('SPAN')
      expect(marker).toHaveAttribute('role', 'img')
      fireEvent.click(marker)
      expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
      expect(useUiStore.getState().comesFromPopover).toBeNull()
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
      expect(useBlockStore.getState().activeBlockId).toBe('consumer')
    })

    it('only shows the rule when the block is not the active one', () => {
      setup({ connected: true })
      lockOre('consumer')
      useBlockStore.setState({ activeBlockId: 'miner' })
      render(<BlockGraphButton />)
      open()
      const marker = markers()[0]
      expect(marker.tagName).toBe('SPAN')
      expect(marker).toHaveAttribute('role', 'img')
      expect(marker).toHaveAccessibleName('Import off')
      fireEvent.click(marker)
      expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
      expect(screen.getByRole('heading', { name: 'Block graph' })).toBeTruthy()
    })

    it('marks the item on a summary chip, counts it in the tooltip, and is on its chip in the list', () => {
      setup({ connected: true, extra: 11 })
      lockOre('consumer')
      render(<BlockGraphButton />)
      open()
      const summary = screen.getByTestId('graph-edge-summary')
      // The chip is a button and keeps its name: the dot inside is out of the accessibility tree.
      expect(summary).toHaveAccessibleName('12 items from Miner to Consumer')
      expect(summary.getAttribute('data-tip')).toContain('; 1 with a source rule in Consumer')
      const dot = within(summary).getByTestId('source-rule-marker')
      expect(dot.tagName).toBe('SPAN')
      expect(dot.closest('[aria-hidden]')).not.toBeNull()
      expect(markers()).toHaveLength(1)

      fireEvent.click(dot)
      const list = screen.getByTestId('graph-detail')
      expect(within(list).getAllByTestId('source-rule-marker')).toHaveLength(1)
      expect(within(label('c1')).getByTestId('source-rule-marker').tagName).toBe('SPAN')
    })
  })
})
