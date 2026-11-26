import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BlockGraphButton } from './BlockGraph'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import { tipOf } from '../../test/byTip'
import type { Block, ConnectionFlow, GameData } from '../../data/types'

const items = {
  'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: 'iron-plate.png', hidden: false },
  'iron-ore': { id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: 'iron-ore.png', hidden: false },
  'copper-ore': { id: 'copper-ore', name: 'Copper Ore', type: 'item', iconPath: 'copper-ore.png', hidden: false },
}

const flow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
  connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-ore',
  available: 30, capped: false, rate: 30, status: 'ok', kind: 'take', ...over,
})

/** Miner feeds Consumer iron ore (c1) and, with `two`, copper ore (c3); with `loop`, Consumer feeds Miner iron plate (c2). */
function setup(opts: { two?: boolean; loop?: boolean; flows?: ConnectionFlow[]; third?: boolean } = {}) {
  const consumer: Block = {
    ...makeEmptyBlock('Consumer'), id: 'consumer',
    inputConnections: [
      { id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner' },
      ...(opts.two ? [{ id: 'c3', itemId: 'copper-ore', fromBlockId: 'miner' }] : []),
    ],
  }
  const miner: Block = {
    ...makeEmptyBlock('Miner'), id: 'miner',
    inputConnections: opts.loop ? [{ id: 'c2', itemId: 'iron-plate', fromBlockId: 'consumer' }] : [],
  }
  const blocks = [miner, consumer]
  if (opts.third) blocks.push({ ...makeEmptyBlock('Lonely'), id: 'lonely' })
  useBlockStore.setState({ blocks, activeBlockId: 'consumer', history: {} })
  useUiStore.setState({ rateUnit: 'min', blockGraphView: 'graph', blockMatrixOrder: 'dependency' })
  useGameDataStore.setState({
    status: { type: 'loaded', gameData: { factorioVersion: '2.0.0', modSet: {}, items, recipes: {}, machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [] } as unknown as GameData, sourceId: 'test' },
  })
  useSolverStore.setState({
    lastResults: {},
    flows: opts.flows ?? [
      flow({ loop: opts.loop || undefined }),
      ...(opts.two ? [flow({ connectionId: 'c3', itemId: 'copper-ore', loop: opts.loop || undefined })] : []),
      ...(opts.loop ? [flow({ connectionId: 'c2', fromBlockId: 'consumer', toBlockId: 'miner', itemId: 'iron-plate', loop: true })] : []),
    ],
    loops: [],
    requestLoops: [],
    _setStatus: () => {},
  })
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Factory overview' }))
const openMatrix = () => { open(); fireEvent.click(screen.getByRole('button', { name: 'Matrix' })) }
const cells = () => screen.getAllByTestId('matrix-cell')
const cell = (from: string, to: string) =>
  document.querySelector(`[data-testid="matrix-cell"][data-from="${from}"][data-to="${to}"]`) as HTMLElement
const head = (kind: 'row' | 'col', id: string) =>
  document.querySelector(`[data-testid="matrix-${kind}-head"][data-block-id="${id}"]`) as HTMLElement
const consumerIn = () => useBlockStore.getState().blocks.find(b => b.id === 'consumer')!

describe('BlockMatrix', () => {
  beforeEach(() => {
    useGameDataStore.setState({ status: { type: 'empty' } })
  })

  it('has a View switch with the graph pressed by default', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    expect(screen.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Matrix' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByTestId('graph-node')).toHaveLength(2)
    expect(screen.getByTestId('graph-legend-back')).toBeTruthy()
  })

  it('shows the matrix and stores the view when Matrix is clicked', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    expect(useUiStore.getState().blockGraphView).toBe('matrix')
    expect(screen.getByRole('button', { name: 'Matrix' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('table')).toBeTruthy()
    expect(screen.queryByTestId('block-graph-viewport')).toBeNull()
    expect(screen.queryByTestId('graph-legend-back')).toBeNull()
  })

  it('opens in the stored view', () => {
    setup()
    useUiStore.setState({ blockGraphView: 'matrix' })
    render(<BlockGraphButton />)
    open()
    expect(document.querySelector('table')).toBeTruthy()
  })

  it('draws a cell per pair with its count, label and tooltip, and no native title', () => {
    setup({ two: true })
    render(<BlockGraphButton />)
    openMatrix()
    expect(cells()).toHaveLength(1)
    const c = cell('miner', 'consumer')
    expect(c.getAttribute('data-count')).toBe('2')
    expect(c.getAttribute('aria-label')).toBe('2 items from Miner to Consumer')
    expect(tipOf(c)).toBe('2 items from Miner to Consumer')
    expect(document.querySelectorAll('[title]')).toHaveLength(0)
    expect(screen.getByTestId('matrix-summary').textContent).toBe('2 × 2 blocks, 1 filled, 0 below the diagonal, in dependency order')
    expect(document.querySelectorAll('tbody td')).toHaveLength(4)
  })

  it('shows the legend until a cell is selected, then its chips with the icon before the name', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    expect(screen.getByTestId('matrix-legend')).toBeTruthy()
    expect(screen.queryByText(/Click a cell/)).toBeNull()
    fireEvent.click(cell('miner', 'consumer'))
    expect(screen.queryByTestId('matrix-legend')).toBeNull()
    const panel = screen.getByTestId('matrix-panel')
    expect(panel.textContent).toContain('Miner → Consumer')
    const chip = within(panel).getByTestId('graph-edge-label')
    expect(chip.textContent).toContain('Iron Ore')
    const img = chip.querySelector('img')!
    const name = within(chip).getByText('Iron Ore')
    expect(img.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A second click on the selected cell deselects.
    fireEvent.click(cell('miner', 'consumer'), { detail: 1 })
    expect(screen.getByTestId('matrix-legend')).toBeTruthy()
  })

  it('sets a limit from the panel on the consumer\'s connection', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    fireEvent.click(cell('miner', 'consumer'))
    fireEvent.click(screen.getByTestId('graph-edge-limit'))
    const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(consumerIn().inputConnections[0].maxRate).toBe(10)
  })

  it('removes a connection with its x: the cell goes and the selection drops', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    fireEvent.click(cell('miner', 'consumer'))
    fireEvent.click(screen.getByTestId('graph-edge-remove'))
    expect(consumerIn().inputConnections).toEqual([])
    expect(screen.queryAllByTestId('matrix-cell')).toHaveLength(0)
    expect(screen.getByTestId('matrix-legend')).toBeTruthy()
  })

  it('tells a limited cell, and a cell where nothing is used', () => {
    setup({ flows: [flow({ status: 'limited' })] })
    render(<BlockGraphButton />)
    openMatrix()
    expect(cell('miner', 'consumer').getAttribute('data-status')).toBe('limited')
    expect(cell('miner', 'consumer').className).toContain('border-amber-500')
    expect(cell('miner', 'consumer').getAttribute('aria-label')).toBe('1 item from Miner to Consumer, 1 limited')
  })

  it('marks a cell whose connections are all unused', () => {
    setup({ flows: [flow({ status: 'unused' })] })
    render(<BlockGraphButton />)
    openMatrix()
    expect(cell('miner', 'consumer').getAttribute('data-all-unused')).toBe('true')
    expect(cell('miner', 'consumer').getAttribute('aria-label')).toBe('1 item from Miner to Consumer, 1 not used')
    expect(document.querySelector('thead th:first-child')!.className).toContain('sticky left-0')
  })

  it('draws the solver loop with the arrow, and the cell below the diagonal hatched', () => {
    setup({ loop: true })
    render(<BlockGraphButton />)
    openMatrix()
    expect(cells()).toHaveLength(2)
    const below = cells().filter(c => c.getAttribute('data-back') === 'true')
    expect(below).toHaveLength(1)
    expect(below[0].getAttribute('data-loop')).toBe('true')
    expect(below[0].textContent).toContain('↻')
    expect(below[0].getAttribute('aria-label')).toMatch(/, loop, runs against the order$/)
    expect(screen.getByTestId('matrix-summary').textContent).toContain('1 below the diagonal')
  })

  describe('cross-hair', () => {
    it('crosses the row and the column of a hovered cell', () => {
      setup({ third: true })
      render(<BlockGraphButton />)
      openMatrix()
      fireEvent.mouseEnter(cell('miner', 'consumer'))
      const crossed = (el: Element) => el.getAttribute('data-crosshair') === 'true'
      expect(crossed(head('row', 'miner'))).toBe(true)
      expect(crossed(head('col', 'consumer'))).toBe(true)
      expect(crossed(head('row', 'consumer'))).toBe(false)
      expect(crossed(head('col', 'miner'))).toBe(false)
      // The other cells of that row and column are crossed too: 3 + 3 - 1.
      expect(document.querySelectorAll('tbody td[data-crosshair="true"]')).toHaveLength(5)
    })

    it('crosses only the row from a row header', () => {
      setup({ third: true })
      render(<BlockGraphButton />)
      openMatrix()
      fireEvent.mouseEnter(head('row', 'miner'))
      expect(head('row', 'miner').getAttribute('data-crosshair')).toBe('true')
      expect(document.querySelectorAll('[data-testid="matrix-col-head"][data-crosshair="true"]')).toHaveLength(0)
      expect(document.querySelectorAll('tbody td[data-crosshair="true"]')).toHaveLength(3)
      fireEvent.mouseLeave(head('row', 'miner'))
      expect(document.querySelectorAll('[data-crosshair="true"]')).toHaveLength(0)
    })
  })

  it('deselects on Escape and closes the graph on the next one', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    fireEvent.click(cell('miner', 'consumer'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(cell('miner', 'consumer').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('heading', { name: 'Factory overview' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Factory overview' })).toBeNull()
  })

  it('moves the focus into the panel on a keyboard activation, and back to the cell on Escape', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    cell('miner', 'consumer').focus()
    fireEvent.click(cell('miner', 'consumer'), { detail: 0 })
    expect(screen.getByTestId('matrix-panel').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(cell('miner', 'consumer'))
    expect(cell('miner', 'consumer').getAttribute('aria-pressed')).toBe('false')
  })

  it('reorders in plan order and stores the choice', () => {
    setup()
    render(<BlockGraphButton />)
    openMatrix()
    fireEvent.click(screen.getByRole('button', { name: 'Plan order' }))
    expect(useUiStore.getState().blockMatrixOrder).toBe('plan')
    const names = screen.getAllByTestId('matrix-row-head').map(h => h.getAttribute('data-block-id'))
    expect(names).toEqual(['miner', 'consumer'])
    expect(screen.getByTestId('matrix-summary').textContent).toContain('in plan order')
  })
})
