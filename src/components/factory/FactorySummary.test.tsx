import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, waitFor, within, act } from '@testing-library/react'
import { FactorySummary } from './FactorySummary'
import { lineRate } from './lineChipFit'
import type { SlotModel } from './summarySegments'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import { BLOCK_PALETTE } from '../../data/blockColors'
import type { Block, ConnectionFlow, GameData, SolverResult, Product } from '../../data/types'

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

// goal.extraRate is items/min; solver outputs are also items/min
const ironGoal: Product = { id: 'g1', itemId: 'iron-plate', extraRate: 60 }

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

function setupStore(goals: Product[] = [ironGoal], withSolver = true) {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [{ ...block, products: goals }],
    activeBlockId: block.id,
    history: {},
  })
  // Most tests work with the full panes; the collapsed summary has its own describe.
  useUiStore.setState({ rateUnit: 'min', summaryCollapsed: false })
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
// A segment's tooltip is in the DOM (CSS shows it on hover or focus): its first line reads name, amount, note.
const keyEntries = segments
const entryText = (el: HTMLElement) => el.querySelector('[data-testid="summary-segment-tip"]')!.textContent
/** The tooltip's second line: what a click does, why a source is limited. */
const entryDetail = (el: HTMLElement) => el.querySelector('[data-testid="summary-segment-detail"]')?.textContent ?? ''
const overviewRow = (paneName: string, key: string) =>
  within(strip(paneName)).getAllByTestId('summary-overview-segment').find(r => r.dataset.key === key)!

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
    expect(screen.queryByTitle('Add product')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — header row', () => {
  it('has no header row: no rate toggle, no rename button and no warnings button', () => {
    render(<FactorySummary />)
    expect(screen.queryByText('/sec')).not.toBeInTheDocument()
    expect(screen.queryByText('/min')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Click to rename')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Show solver warnings')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — reorder products', () => {
  // Three products: Iron Plate, Iron Ore, Slag. Slots are 50px wide, side by side from x = 0.
  const three = (): Product[] => [
    { id: 'a', itemId: 'iron-plate', extraRate: 60 },
    { id: 'b', itemId: 'iron-ore', extraRate: 60 },
    { id: 'c', itemId: 'slag', extraRate: 60 },
  ]
  const order = () => useBlockStore.getState().blocks[0].products.map(p => p.id)
  const depth = () => {
    const id = useBlockStore.getState().blocks[0].id
    return useBlockStore.getState().history[id]?.undoStack.length ?? 0
  }
  const products = () => within(pane('Products')).getAllByTestId('summary-slot')
  const lines = () => within(pane('Products')).queryAllByTestId('summary-slot-drop-line')
  const dataTransfer = () => {
    const data: Record<string, string> = {}
    return { setData: (k: string, v: string) => { data[k] = v }, getData: (k: string) => data[k], effectAllowed: '', dropEffect: '' }
  }
  /** Stub the slot's box: 50px wide at x = index * 54. */
  function stubRects() {
    products().forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: i * 54, right: i * 54 + 50, width: 50, top: 0, bottom: 54, height: 54, x: i * 54, y: 0, toJSON: () => ({}) })
    })
  }
  // happy-dom's DragEvent ignores clientX in its init, so set it on the event.
  const dragOver = (el: Element, dt: object, clientX: number) => {
    const ev = createEvent.dragOver(el, { dataTransfer: dt })
    Object.defineProperty(ev, 'clientX', { value: clientX })
    return fireEvent(el, ev)
  }
  const dropOn = (el: Element, dt: object, clientX: number) => {
    const ev = createEvent.drop(el, { dataTransfer: dt })
    Object.defineProperty(ev, 'clientX', { value: clientX })
    return fireEvent(el, ev)
  }
  const rightHalf = (i: number) => i * 54 + 40
  const leftHalf = (i: number) => i * 54 + 5

  beforeEach(() => {
    setupStore(three())
    render(<FactorySummary />)
    stubRects()
  })

  it('makes Products slots draggable and the other panes not', () => {
    for (const el of products()) expect(el).toHaveAttribute('draggable', 'true')
    for (const name of ['Byproducts', 'Ingredients']) {
      for (const el of within(pane(name)).queryAllByTestId('summary-slot')) expect(el).not.toHaveAttribute('draggable')
    }
  })

  it('shows a drop line while dragging and reorders on drop', () => {
    const dt = dataTransfer()
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    dragOver(products()[2], dt, rightHalf(2))
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toHaveAttribute('data-side', 'after')
    // The line sits beside the slot, in its wrapper, so the slot's fade does not dim it.
    expect(products()[2].parentElement).toContainElement(lines()[0])
    expect(products()[2]).not.toContainElement(lines()[0])
    dropOn(products()[2], dt, rightHalf(2))
    expect(order()).toEqual(['b', 'c', 'a'])
    expect(lines()).toHaveLength(0)
  })

  it('shows no line and does not cancel dragover for a drop that would not move anything', () => {
    const dt = dataTransfer()
    fireEvent.dragStart(products()[1], { dataTransfer: dt })
    for (const [i, x] of [[1, leftHalf(1)], [1, rightHalf(1)], [0, rightHalf(0)], [2, leftHalf(2)]] as const) {
      const notPrevented = dragOver(products()[i], dt, x)
      expect(notPrevented, 'dragover not cancelled').toBe(true)
      expect(lines()).toHaveLength(0)
    }
  })

  it('clears the line when the drag ends without a drop', () => {
    const dt = dataTransfer()
    const before = depth()
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    dragOver(products()[2], dt, rightHalf(2))
    expect(lines()).toHaveLength(1)
    fireEvent.dragEnd(products()[0], { dataTransfer: dt })
    expect(lines()).toHaveLength(0)
    expect(products()[0]).not.toHaveAttribute('data-dragging')
    expect(order()).toEqual(['a', 'b', 'c'])
    expect(depth()).toBe(before)
  })

  it('fades the dragged slot after the drag image is taken, not at drag start', async () => {
    const dt = dataTransfer()
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    expect(products()[0]).not.toHaveAttribute('data-dragging')
    await waitFor(() => expect(products()[0]).toHaveAttribute('data-dragging'))
  })

  it('a document-level dragend clears a drag whose slot never got its dragend', async () => {
    const dt = dataTransfer()
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    await waitFor(() => expect(products()[0]).toHaveAttribute('data-dragging'))
    dragOver(products()[2], dt, rightHalf(2))
    expect(lines()).toHaveLength(1)
    fireEvent.dragEnd(document.body)
    expect(lines()).toHaveLength(0)
    expect(products()[0]).not.toHaveAttribute('data-dragging')
  })

  it('Escape still clears the selection after a drag', async () => {
    select('Products', 'Iron Plate')
    const dt = dataTransfer()
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    await waitFor(() => expect(products()[0]).toHaveAttribute('data-dragging'))
    fireEvent.dragEnd(products()[0], { dataTransfer: dt })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the line while the pointer crosses between children of the grid, and clears it on leaving', () => {
    const dt = dataTransfer()
    const grid = within(pane('Products')).getByTestId('summary-slot-grid')
    fireEvent.dragStart(products()[0], { dataTransfer: dt })
    fireEvent.dragEnter(products()[2], { dataTransfer: dt })
    dragOver(products()[2], dt, rightHalf(2))
    // Enter a child, then leave the previous one: the depth stays above zero.
    fireEvent.dragEnter(products()[2].firstElementChild!, { dataTransfer: dt })
    fireEvent.dragLeave(products()[2], { dataTransfer: dt })
    expect(lines()).toHaveLength(1)
    fireEvent.dragLeave(products()[2].firstElementChild!, { dataTransfer: dt })
    expect(lines()).toHaveLength(0)
    expect(grid).toBeInTheDocument()
  })

  it('shows no line for a drag that did not start on a product slot', () => {
    const dt = dataTransfer()
    dragOver(products()[2], dt, rightHalf(2))
    expect(lines()).toHaveLength(0)
  })

  it('keeps the selection and the strip through a reorder', () => {
    select('Products', 'Iron Plate')
    const dt = dataTransfer()
    fireEvent.dragStart(products()[1], { dataTransfer: dt })
    dragOver(products()[0], dt, leftHalf(0))
    dropOn(products()[0], dt, leftHalf(0))
    expect(order()).toEqual(['b', 'a', 'c'])
    expect(slot('Products', 'Iron Plate')).toHaveAttribute('aria-pressed', 'true')
    expect(strip('Products')).toHaveAttribute('data-state', 'selected')
  })

  it('offers Move earlier and Move later in the right-click menu', () => {
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    expect(screen.getByRole('menuitem', { name: 'Move earlier' })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move later' }))
    expect(order()).toEqual(['b', 'a', 'c'])
  })

  it('has no move actions with a single product', () => {
    setupStore([ironGoal])
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    expect(screen.queryByRole('menuitem', { name: 'Move later' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Move earlier' })).not.toBeInTheDocument()
  })

  it('the strip action moves the product and keeps it selected', () => {
    select('Products', 'Iron Ore')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Move later' }))
    expect(order()).toEqual(['a', 'c', 'b'])
    expect(slot('Products', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
    expect(within(strip('Products')).getByRole('button', { name: 'Move later' })).toBeDisabled()
  })
})

describe('FactorySummary — detail strip states', () => {
  it('shows the overview by default, with a kept and a short row for a short goal', () => {
    render(<FactorySummary />)
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
    expect(overviewRow('Products', 'kept')).toBeInTheDocument()
    expect(entryText(overviewRow('Products', 'short'))).toContain('2.00')
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
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', extraRate: 10 }])
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
    expect(within(strip('Products')).getByRole('button', { name: 'Remove product' })).toBeInTheDocument()
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

describe('FactorySummary — electricity', () => {
  const electricity = { id: 'power:electricity', name: 'Electricity', type: 'fluid', iconPath: '', hidden: false }
  const generated: SolverResult = {
    nodes: [{
      recipeNodeId: 'n1', inputRates: { 'iron-ore': 120 }, outputRates: { 'power:electricity': 600 },
      throughput: 666.667, machineCountExact: 11.111, machineCountCeil: 12, powerKw: 0,
    }],
    unsatisfied: [{ itemId: 'iron-ore', rate: 120 }],
    warnings: [],
  }

  beforeEach(() => {
    setupStore([{ id: 'g1', itemId: 'power:electricity', extraRate: 600 }])
    useGameDataStore.setState({
      status: {
        type: 'loaded', sourceId: 'test',
        gameData: { ...mockGameData, items: { ...mockGameData.items, 'power:electricity': electricity } } as unknown as GameData,
      },
    })
    useSolverStore.setState({ lastResult: generated })
  })

  it.each(['min', 'sec'] as const)('names the slot in power units in /%s', unit => {
    useUiStore.setState({ rateUnit: unit })
    render(<FactorySummary />)
    expect(screen.getByRole('button', { name: 'Electricity, 10.0 MW' })).toBeInTheDocument()
  })

  it('shows the extra output and the actual rate in MW', () => {
    render(<FactorySummary />)
    select('Products', 'Electricity')
    expect(screen.getByTitle(/^Extra output:/).textContent).toContain('10.0MW')
    expect(screen.getByTitle(/Actual:/).textContent).toContain('10.0MW')
  })

  it.each(['min', 'sec'] as const)('labels the extra output field in MW in /%s', unit => {
    useUiStore.setState({ rateUnit: unit })
    render(<FactorySummary />)
    select('Products', 'Electricity')
    fireEvent.click(screen.getByTitle(/^Extra output:/))
    expect(screen.getByLabelText('Extra output rate')).toBeInTheDocument()
    expect(screen.getByTestId('extra-input-unit').textContent).toBe('MW')
  })
})

describe('FactorySummary — heat', () => {
  const heat = { id: 'power:heat', name: 'Heat', type: 'fluid', iconPath: '', hidden: false }

  beforeEach(() => {
    setupStore([{ id: 'g1', itemId: 'power:heat', extraRate: 1296 }])
    useGameDataStore.setState({
      status: {
        type: 'loaded', sourceId: 'test',
        gameData: { ...mockGameData, items: { ...mockGameData.items, 'power:heat': heat } } as unknown as GameData,
      },
    })
    useSolverStore.setState({
      lastResult: {
        nodes: [{
          recipeNodeId: 'n1', inputRates: {}, outputRates: { 'power:heat': 1296 },
          throughput: 1, machineCountExact: 2, machineCountCeil: 2, powerKw: 0,
        }],
        unsatisfied: [],
        warnings: [],
      },
    })
  })

  it.each(['min', 'sec'] as const)('names the slot in power units in /%s', unit => {
    useUiStore.setState({ rateUnit: unit })
    render(<FactorySummary />)
    expect(screen.getByRole('button', { name: 'Heat, 21.6 MW' })).toBeInTheDocument()
  })
})

describe('FactorySummary — extra output and actual', () => {
  it('shows the extra output with title "Extra output" once the slot is selected', () => {
    render(<FactorySummary />)
    expect(screen.queryByTitle(/^Extra output:/)).not.toBeInTheDocument()
    select('Products', 'Iron Plate')
    const extraBtn = screen.getByTitle(/^Extra output:/)
    expect(extraBtn.textContent).toMatch(/60/)
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
    expect(screen.getByTitle(/^Extra output:/)).toBeInTheDocument()
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

describe('FactorySummary — extra output editing', () => {
  const goalRate = () => useBlockStore.getState().blocks[0].products[0].extraRate

  function startEdit() {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(screen.getByTitle(/^Extra output:/))
    return screen.getByLabelText('Extra output rate')
  }

  it('clicking the extra output in the strip shows an editable input', () => {
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

  it('double-clicking a slot selects it and edits its extra output with the input focused', () => {
    render(<FactorySummary />)
    fireEvent.doubleClick(slot('Products', 'Iron Plate'))
    expect(strip('Products')).toHaveAttribute('data-state', 'editing')
    expect(screen.getByLabelText('Extra output rate')).toHaveFocus()
  })

  it('hovering another slot does not change the strip while editing', () => {
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', extraRate: 10 }])
    render(<FactorySummary />)
    fireEvent.doubleClick(slot('Products', 'Iron Plate'))
    fireEvent.mouseEnter(slot('Products', 'Iron Ore'))
    expect(strip('Products')).toHaveAttribute('data-state', 'editing')
  })

  it('right-clicking the rate input keeps the native menu (no Remove product menu)', () => {
    const input = startEdit()
    const notPrevented = fireEvent.contextMenu(input)
    expect(notPrevented).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('FactorySummary — remove product', () => {
  it('right-click then "Remove product" removes the product', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove product' }))
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(0)
  })

  it('the strip action removes the product too', () => {
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove product' }))
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(0)
    expect(strip('Products')).toHaveAttribute('data-state', 'overview')
  })

  it('Escape closes the product menu and keeps the product', () => {
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(1)
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

describe('FactorySummary — byproduct noise', () => {
  it('hides a leftover that is only LP rounding noise at a large flow', () => {
    const noisyResult: SolverResult = {
      nodes: [
        {
          recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 65, steam: 20, slag: 2000 },
          throughput: 65, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        },
        {
          recipeNodeId: 'n2', inputRates: { steam: 5, slag: 1999.9999988 }, outputRates: {},
          throughput: 5, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        },
      ],
      unsatisfied: [],
      warnings: [],
    }
    setupStore([ironGoal])
    const gd = { ...mockGameData, items: { ...mockGameData.items, steam: { id: 'steam', name: 'Steam', type: 'fluid' as const, iconPath: '', hidden: false } } }
    useGameDataStore.setState({ status: { type: 'loaded', gameData: gd as unknown as GameData, sourceId: 'test' } })
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: noisyResult, _setStatus: () => {} })
    render(<FactorySummary />)
    expect(within(pane('Byproducts')).getByRole('button', { name: 'Steam, 15.0 per minute' })).toBeInTheDocument()
    expect(within(pane('Byproducts')).queryByRole('button', { name: /^Slag, / })).not.toBeInTheDocument()
  })
})

describe('FactorySummary — byproduct relative tolerance', () => {
  const slagResult = (made: number, used: number): SolverResult => ({
    nodes: [
      {
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 65, slag: made },
        throughput: 65, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      },
      {
        recipeNodeId: 'n2', inputRates: { slag: used }, outputRates: {},
        throughput: 5, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      },
    ],
    unsatisfied: [],
    warnings: [],
  })
  const renderWith = (result: SolverResult) => {
    setupStore([ironGoal])
    useSolverStore.setState({ status: { type: 'idle' }, lastResult: result, _setStatus: () => {} })
    render(<FactorySummary />)
  }

  it('hides a displayable 5/min leftover on a huge gross flow', () => {
    renderWith(slagResult(1e9, 1e9 - 5))
    expect(within(pane('Byproducts')).queryByRole('button', { name: /^Slag, / })).not.toBeInTheDocument()
  })
  it('shows the same 5/min leftover on a small gross flow', () => {
    renderWith(slagResult(100, 95))
    expect(within(pane('Byproducts')).getByRole('button', { name: /^Slag, / })).toBeInTheDocument()
  })
})

describe('FactorySummary — add product', () => {
  it('clicking + opens item picker', async () => {
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add product'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Add product' })).toBeInTheDocument())
  })

  it('adding a product via the picker adds a product', async () => {
    setupStore([])
    render(<FactorySummary />)
    fireEvent.click(screen.getByTitle('Add product'))
    await waitFor(() => screen.getByRole('heading', { name: 'Add product' }))
    const slots = screen.getAllByTestId('item-slot')
    const ironSlot = slots.find(b => b.getAttribute('data-item-id') === 'iron-plate')!
    fireEvent.click(ironSlot)
    const products = useBlockStore.getState().blocks[0].products
    expect(products).toHaveLength(1)
    expect(products[0].itemId).toBe('iron-plate')
    expect(products[0].extraRate).toBe(60)
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
    available: 30, capped: false, rate: 30, status: 'ok', kind: 'take', ...over,
  })

  function setupBlocks(opts: { activeId: 'consumer' | 'miner', connected: boolean, result?: SolverResult, flows?: ConnectionFlow[], minerOffers?: boolean }) {
    const consumer: Block = {
      ...makeEmptyBlock('Consumer'), id: 'consumer', products: [ironGoal],
      inputConnections: opts.connected ? [{ id: 'c1', itemId: 'iron-ore', fromBlockId: 'miner' }] : [],
    }
    const miner: Block = { ...makeEmptyBlock('Miner'), id: 'miner', products: [ironGoal] }
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
      expect(entryText(entry)).toContain('← Miner')
      expect(entryText(entry)).toContain('30.0')
    })

    it('titles a limited source with "Limited" and flags the slot', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'limited', available: 30 })] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-status', 'limited')
      select('Ingredients', 'Iron Ore')
      expect(entryDetail(segments('Ingredients', 'source')[0])).toMatch(/^Limited/)
    })

    it('titles an unused connection with "Not used" and dims the slot', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'unused', rate: 0 })] })
      render(<FactorySummary />)
      expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-dimmed', 'true')
      select('Ingredients', 'Iron Ore')
      expect(entryDetail(keyEntries('Ingredients', 'unused')[0])).toMatch(/^Not used/)
    })

    it('labels a deleted source and lets the user remove the connection via right-click', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'missing-source', rate: 0, available: 0 })] })
      useBlockStore.setState(s => ({ blocks: s.blocks.filter(b => b.id !== 'miner') }))
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const [entry] = keyEntries('Ingredients', 'missing-source')
      expect(entryText(entry)).toContain('(deleted block)')
      fireEvent.contextMenu(entry)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
    })

    it('shows a self-connection as ignored', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ status: 'self', rate: 0 })] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(entryText(keyEntries('Ingredients', 'self')[0])).toContain('self, ignored')
    })

    it('marks a source that is part of a loop', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow({ loop: true })] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const [entry] = keyEntries('Ingredients', 'source')
      expect(entryText(entry)).toContain('↻')
      expect(entryDetail(entry)).toMatch(/part of a loop/)
    })

    it('right-clicking a source segment offers "Remove connection"', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.contextMenu(segments('Ingredients', 'source')[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove connection' }))
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([])
    })

    it('Limit rate… caps the connection and Change limit… edits it', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.contextMenu(segments('Ingredients', 'source')[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Limit rate…' }))
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      fireEvent.change(input, { target: { value: '12' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      const rate = () => useBlockStore.getState().blocks[0].inputConnections?.[0].maxRate
      expect(rate()).toBe(12) // 12 per minute, stored as items/min
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).not.toBeInTheDocument()

      fireEvent.contextMenu(segments('Ingredients', 'source')[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Change limit…' }))
      const again = screen.getByRole('spinbutton', { name: 'Connection limit' })
      fireEvent.change(again, { target: { value: '' } })
      fireEvent.keyDown(again, { key: 'Enter' })
      expect(rate()).toBeUndefined()
    })

    it('Limit rate… converts a per-second entry to items/min', () => {
      useUiStore.setState({ rateUnit: 'sec' })
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.contextMenu(segments('Ingredients', 'source')[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Limit rate…' }))
      const input = screen.getByRole('spinbutton', { name: 'Connection limit' })
      fireEvent.change(input, { target: { value: '12' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(useBlockStore.getState().blocks[0].inputConnections?.[0].maxRate).toBe(720)
    })

    it('the limit editor closes without writing on scroll, and when its connection disappears', () => {
      setupBlocks({ activeId: 'consumer', connected: true, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const open = () => {
        fireEvent.contextMenu(segments('Ingredients', 'source')[0])
        fireEvent.click(screen.getByRole('menuitem', { name: 'Limit rate…' }))
      }
      open()
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Connection limit' }), { target: { value: '12' } })
      fireEvent.scroll(window)
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).not.toBeInTheDocument()
      expect(useBlockStore.getState().blocks[0].inputConnections?.[0].maxRate).toBeUndefined()

      open()
      expect(screen.getByRole('spinbutton', { name: 'Connection limit' })).toBeInTheDocument()
      act(() => useBlockStore.getState().removeInputConnection(useBlockStore.getState().blocks[0].inputConnections![0].id))
      expect(screen.queryByRole('spinbutton', { name: 'Connection limit' })).not.toBeInTheDocument()
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
      expect(screen.getByText('Take existing Iron Ore from')).toBeInTheDocument()
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
      expect(screen.getByText('Take existing Iron Ore from')).toBeInTheDocument()
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
      expect(screen.getByText('No other block has this item to spare')).toBeInTheDocument()
    })

    it('marks a source that would close a loop', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'miner'
          ? { ...b, inputConnections: [{ id: 'cm', itemId: 'iron-plate', fromBlockId: 'consumer' }] }
          : b)),
      }))
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      const item = screen.getByRole('menuitem', { name: /Miner/ })
      expect(item.getAttribute('data-closes-loop')).toBe('true')
      expect(item.getAttribute('title')).toMatch(/Closes a loop/)
    })

    it('says so when no other block has the item to spare', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult, minerOffers: false })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.getByText('No other block has this item to spare')).toBeInTheDocument()
    })
  })

  describe('connection menu — make in a new block and connections first', () => {
    const consumer = () => useBlockStore.getState().blocks.find(b => b.id === 'consumer')!

    /** A recipe that makes Iron Ore, so the item can be made in a new block. */
    function withOreRecipe(oreIconColor?: string) {
      const data = structuredClone(mockGameData)
      if (oreIconColor) data.items['iron-ore'].iconColor = oreIconColor
      data.recipes['ore-synth'] = {
        id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
        ingredients: [], products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
      } as unknown as GameData['recipes'][string]
      useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    }

    it('hides Make in a new block for an item no recipe makes', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.queryByRole('menuitem', { name: 'Make in a new block…' })).not.toBeInTheDocument()
    })

    it('holds neither a sourcing choice nor an import entry: those are in the Comes from control', () => {
      withOreRecipe()
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'consumer'
          ? { ...b, itemSourcing: { 'iron-ore': 'connections-first' as const }, noImportItems: ['iron-ore'] }
          : b)),
      }))
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /imports/i })).not.toBeInTheDocument()
      expect(screen.getAllByRole('menuitem').at(-1)).toHaveTextContent('Make in a new block…')
    })

    it('Make in a new block creates the block, requests the item and opens the recipe picker', async () => {
      withOreRecipe()
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Make in a new block…' }))

      const { blocks, activeBlockId } = useBlockStore.getState()
      expect(blocks).toHaveLength(3)
      const created = blocks[2]
      expect(created.name).toBe('Iron Ore')
      expect(created.products).toEqual([{ id: expect.any(String), itemId: 'iron-ore' }])
      expect(activeBlockId).toBe(created.id)
      expect(consumer().inputConnections).toEqual([
        { id: expect.any(String), itemId: 'iron-ore', fromBlockId: created.id },
      ])
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
      expect(screen.getByText("Choose a recipe to produce 'Iron Ore'")).toBeInTheDocument()
    })

    it('Make in a new block takes the item icon colour as it is', () => {
      withOreRecipe('#ffff00')
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Make in a new block…' }))
      expect(useBlockStore.getState().blocks[2].color).toBe('#ffff00')
    })

    it('Make in a new block without an icon colour still gets a palette colour', () => {
      withOreRecipe()
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Make in a new block…' }))
      expect(BLOCK_PALETTE).toContain(useBlockStore.getState().blocks[2].color as typeof BLOCK_PALETTE[number])
    })
  })

  describe('Comes from', () => {
    const consumer = () => useBlockStore.getState().blocks.find(b => b.id === 'consumer')!
    const group = () => within(strip('Ingredients')).getByTestId('comes-from')
    const choice = (name: RegExp | string) => within(group()).getByRole('radio', { name })
    const importSwitch = () => within(group()).getByRole('switch')
    const patch = (over: Partial<Block>) =>
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'consumer' ? { ...b, ...over } : b)) }))

    /** The consumer gets a row for a recipe that makes Iron Ore, so a rule on the item can have an effect. */
    function withOreRow() {
      const data = structuredClone(mockGameData)
      data.recipes['ore-synth'] = {
        id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
        ingredients: [], products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
      } as unknown as GameData['recipes'][string]
      useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
      patch({ rootPlan: { ...consumer().rootPlan, nodes: [makeRecipeNode('ore-synth')] } })
    }

    it('is in the strip of a selected slot, with the three presets and the Import switch', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      render(<FactorySummary />)
      expect(within(strip('Ingredients')).queryByTestId('comes-from')).not.toBeInTheDocument()
      select('Ingredients', 'Iron Ore')
      expect(group()).toHaveAccessibleName('Comes from')
      expect(within(group()).getAllByRole('radio').map(r => [r.textContent, r.getAttribute('data-sourcing-choice')])).toEqual([
        ['Make it here', 'own'],
        ['Receive it first', 'connections-first'],
        ["Only what's already made", 'byproducts-first'],
      ])
      expect(choice('Make it here')).toBeChecked()
      expect(importSwitch()).toBeChecked()
      expect(importSwitch()).toHaveAttribute('data-testid', 'import-switch')
      expect(within(group()).getByTestId('sourcing-sentence')).toHaveTextContent(/^Made here|^No row here makes Iron Ore/)
    })

    it('is not on the Products strip', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      render(<FactorySummary />)
      select('Products', 'Iron Plate')
      expect(screen.queryByTestId('comes-from')).not.toBeInTheDocument()
      select('Ingredients', 'Iron Ore')
      expect(screen.getAllByTestId('comes-from')).toHaveLength(1)
    })

    it('sets each preset, and Make it here clears it', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      withOreRow()
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.click(choice('Receive it first'))
      expect(consumer().itemSourcing).toEqual({ 'iron-ore': 'connections-first' })
      expect(choice('Receive it first')).toBeChecked()
      fireEvent.click(choice("Only what's already made"))
      expect(consumer().itemSourcing).toEqual({ 'iron-ore': 'byproducts-first' })
      fireEvent.click(choice('Make it here'))
      expect(consumer().itemSourcing).toEqual({})
    })

    it('turns Import off and on', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      withOreRow()
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.click(importSwitch())
      expect(consumer().noImportItems).toEqual(['iron-ore'])
      expect(importSwitch()).not.toBeChecked()
      expect(within(group()).getByTestId('sourcing-sentence')).toHaveTextContent(/ Import is off\.$/)
      fireEvent.click(importSwitch())
      expect(consumer().noImportItems).toEqual([])
    })

    it('is one tab stop, and the arrows move between presets, wrapping and skipping one that is not available', () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      withOreRow()
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(within(group()).getAllByRole('radio').map(r => r.tabIndex)).toEqual([0, -1, -1])

      choice('Make it here').focus()
      fireEvent.keyDown(choice('Make it here'), { key: 'ArrowRight' })
      expect(choice('Receive it first')).toBeChecked()
      expect(choice('Receive it first')).toHaveFocus()
      expect(consumer().itemSourcing).toEqual({ 'iron-ore': 'connections-first' })
      fireEvent.keyDown(choice('Receive it first'), { key: 'ArrowRight' })
      expect(choice("Only what's already made")).toBeChecked()
      fireEvent.keyDown(choice("Only what's already made"), { key: 'ArrowRight' })
      expect(choice('Make it here')).toBeChecked()
      fireEvent.keyDown(choice('Make it here'), { key: 'ArrowLeft' })
      expect(choice("Only what's already made")).toBeChecked()

      // With Import off the third preset is skipped.
      fireEvent.click(choice('Make it here'))
      fireEvent.click(importSwitch())
      choice('Make it here').focus()
      fireEvent.keyDown(choice('Make it here'), { key: 'ArrowLeft' })
      expect(choice('Receive it first')).toBeChecked()
    })

    it('gives each preset and the switch its help text as its description', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(choice('Make it here')).toHaveAccessibleDescription('Made here; connections and imports cover what is missing.')
      expect(choice('Receive it first')).toHaveAccessibleDescription("Taken from this block's connections first; made here for the rest.")
      expect(choice("Only what's already made")).toHaveAccessibleDescription('Uses what this block already makes; the rest is received or imported.')
      expect(importSwitch()).toHaveAccessibleDescription('Bring it in from outside the plan. Off: this block must make or receive all of it.')
    })

    it("disables Only what's already made while Import is off, with the reason, and the switch while it is chosen", () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      withOreRow()
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      fireEvent.click(importSwitch())
      const third = choice("Only what's already made")
      expect(third).toHaveAttribute('aria-disabled', 'true')
      expect(third).toHaveAccessibleDescription('Import is off for Iron Ore, so the block has to make it.')
      fireEvent.click(third)
      expect(consumer().itemSourcing).toEqual({})

      fireEvent.click(importSwitch())
      fireEvent.click(choice("Only what's already made"))
      expect(consumer().itemSourcing).toEqual({ 'iron-ore': 'byproducts-first' })
      expect(importSwitch()).toHaveAttribute('aria-disabled', 'true')
      expect(importSwitch()).toHaveAccessibleDescription("Only what's already made relies on imports for the rest.")
      fireEvent.click(importSwitch())
      expect(consumer().noImportItems).toEqual([])
      // The other presets stay free, and choosing one frees the switch.
      fireEvent.click(choice('Make it here'))
      expect(importSwitch()).not.toHaveAttribute('aria-disabled')
    })

    it("shows a plan saved with both as Only what's already made, reported as locked, and lets it be removed", () => {
      setupBlocks({ activeId: 'consumer', connected: false, result: mockSolverResult })
      withOreRow()
      patch({ itemSourcing: { 'iron-ore': 'byproducts-first' }, noImportItems: ['iron-ore'] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(choice("Only what's already made")).toBeChecked()
      const [line] = within(group()).getAllByTestId('no-effect')
      expect(line).toHaveAttribute('data-no-effect', 'locked')
      expect(line).toHaveTextContent('Import is off for Iron Ore, so the block has to make it.')
      fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
      expect(consumer().itemSourcing).toEqual({})
      expect(consumer().noImportItems).toEqual(['iron-ore'])
    })

    it('says a rule with no effect has none, and removes just that rule', () => {
      // No row of the block makes Iron Ore: it is raw here, so a rule on it does nothing.
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      patch({ itemSourcing: { 'iron-ore': 'connections-first' }, noImportItems: ['iron-ore'] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const lines = within(group()).getAllByTestId('no-effect')
      expect(lines.map(l => [l.dataset.rule, l.dataset.noEffect])).toEqual([
        ['connections-first', 'not-made'],
        ['import-off', 'not-made'],
      ])
      expect(lines[0]).toHaveTextContent('No row in this block makes Iron Ore.')
      // A rule with no effect stays selectable so it can be changed.
      expect(choice('Receive it first')).not.toHaveAttribute('aria-disabled')
      fireEvent.click(within(lines[1]).getByRole('button', { name: 'Remove' }))
      expect(consumer().noImportItems).toEqual([])
      expect(consumer().itemSourcing).toEqual({ 'iron-ore': 'connections-first' })
      fireEvent.click(within(within(group()).getByTestId('no-effect')).getByRole('button', { name: 'Remove' }))
      expect(consumer().itemSourcing).toEqual({})
      expect(within(group()).queryByTestId('no-effect')).not.toBeInTheDocument()
    })

    it('shows nothing grey for a rule that has an effect', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      withOreRow()
      patch({ itemSourcing: { 'iron-ore': 'connections-first' } })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      expect(within(group()).queryByTestId('no-effect')).not.toBeInTheDocument()
    })

    it('keeps Find recipe and Receive from… in the strip, and has no Forbid or Allow imports action', () => {
      setupBlocks({ activeId: 'consumer', connected: true, result: mockSolverResult, flows: [flow()] })
      render(<FactorySummary />)
      select('Ingredients', 'Iron Ore')
      const buttons = within(strip('Ingredients')).getAllByRole('button').map(b => b.textContent)
      expect(buttons).toContain('Find recipe')
      expect(buttons).toContain('Receive from…')
      expect(buttons.join('|')).not.toMatch(/imports/i)
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
          flow({ connectionId: 'e1', itemId: 'iron-plate', fromBlockId: 'miner', toBlockId: 'consumer', rate: 20, kind: 'request', requested: 20 }),
          flow({ connectionId: 'e2', itemId: 'slag', fromBlockId: 'miner', toBlockId: 'consumer', rate: 4, kind: 'take' }),
        ],
      })
      render(<FactorySummary />)
      select('Products', 'Iron Plate')
      const exports = segments('Products', 'export')
      expect(exports).toHaveLength(1)
      expect(entryDetail(exports[0])).toMatch(/^Sends Iron Plate to Consumer/)
      expect(entryText(keyEntries('Products', 'export')[0])).toContain('20.0')
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
        flows: [flow({ connectionId: 'e1', itemId: 'iron-plate', fromBlockId: 'miner', toBlockId: 'consumer', rate: 20, kind: 'request', requested: 20 })],
      })
      useBlockStore.setState(s => ({
        blocks: s.blocks.map(b => (b.id === 'miner' ? { ...b, products: [ironGoal, { id: 'g2', itemId: 'iron-ore', extraRate: 10 }] } : b)),
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

describe('FactorySummary — requests', () => {
  const makerResult = (plate = 90): SolverResult => ({
    nodes: [{
      recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-ore': 30, 'iron-plate': plate },
      throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
    }],
    unsatisfied: [],
    warnings: [],
  })
  const empty = (): SolverResult => ({ nodes: [], unsatisfied: [], warnings: [] })
  const requestFlow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
    connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-plate',
    available: 30, capped: false, rate: 30, status: 'ok', kind: 'request', requested: 30, ...over,
  })
  const ironOreProduct: Product = { id: 'pore', itemId: 'iron-ore' }

  /** Consumer takes `itemId` from Miner over c1; the active block is either of the two. */
  function setupRequest(opts: {
    activeId: 'consumer' | 'miner'
    itemId?: string
    minerProducts?: Product[]
    flows?: ConnectionFlow[]
    result?: SolverResult
  }) {
    const consumer: Block = {
      ...makeEmptyBlock('Consumer'), id: 'consumer', products: [],
      inputConnections: [{ id: 'c1', itemId: opts.itemId ?? 'iron-plate', fromBlockId: 'miner' }],
    }
    const miner: Block = { ...makeEmptyBlock('Miner'), id: 'miner', products: opts.minerProducts ?? [ironGoal] }
    useBlockStore.setState({ blocks: [consumer, miner], activeBlockId: opts.activeId, history: {} })
    useSolverStore.setState({
      lastResult: opts.result ?? makerResult(),
      lastResults: { consumer: empty(), miner: opts.result ?? makerResult() },
      flows: opts.flows ?? [requestFlow()],
      _setStatus: () => {},
    })
  }
  const dialog = () => screen.queryByTestId('product-change-confirm')
  const miner = () => useBlockStore.getState().blocks.find(b => b.id === 'miner')!

  it('puts the requested amount on the product slot, not in Byproducts', () => {
    // Extra 60 plus 30 requested: Miner makes 90, so the slot is not short.
    setupRequest({ activeId: 'miner' })
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Plate')).not.toHaveAttribute('data-status', 'short')
    expect(within(pane('Byproducts')).queryByRole('button', { name: /^Iron Plate, / })).not.toBeInTheDocument()
    select('Products', 'Iron Plate')
    expect(segments('Products', 'export')).toHaveLength(1)
  })

  it('shows a product without extra as nothing requested yet, with a dash and no extra output', () => {
    setupRequest({ activeId: 'miner', itemId: 'iron-ore', minerProducts: [ironOreProduct], result: empty(), flows: [] })
    render(<FactorySummary />)
    const ore = within(pane('Products')).getByRole('button', { name: 'Iron Ore, nothing requested yet' })
    expect(ore.textContent).toContain('—')
    fireEvent.click(ore)
    expect(screen.queryByTitle(/^Extra output:/)).not.toBeInTheDocument()
    expect(within(strip('Products')).getByRole('button', { name: '+ Extra output' })).toBeInTheDocument()
  })

  it('is short when less is made than requested of a product without extra', () => {
    const result: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-ore': 20 },
        throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [], warnings: [],
    }
    setupRequest({
      activeId: 'miner', itemId: 'iron-ore', minerProducts: [ironOreProduct], result,
      flows: [requestFlow({ itemId: 'iron-ore', rate: 20, requested: 30 })],
    })
    render(<FactorySummary />)
    expect(slot('Products', 'Iron Ore')).toHaveAttribute('data-status', 'short')
  })

  it('marks the source segment of a request in the consumer', () => {
    setupRequest({ activeId: 'consumer', itemId: 'iron-ore', flows: [requestFlow({ itemId: 'iron-ore' })], result: empty() })
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    expect(entryDetail(segments('Ingredients', 'source')[0])).toMatch(/— requested/)
  })

  it('offers Limit rate… and Remove connection in the connection chip menu', () => {
    setupRequest({ activeId: 'consumer', itemId: 'iron-ore', flows: [requestFlow({ itemId: 'iron-ore' })], result: empty() })
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    fireEvent.contextMenu(segments('Ingredients', 'source')[0])
    const items = screen.getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual(['Limit rate…', 'Remove connection'])
  })

  describe('connection menu sections', () => {
    function setupMenu() {
      const consumer: Block = { ...makeEmptyBlock('Consumer'), id: 'consumer', products: [ironGoal] }
      const miner: Block = { ...makeEmptyBlock('Miner'), id: 'miner', products: [ironOreProduct] }
      const smelter: Block = { ...makeEmptyBlock('Smelter'), id: 'smelter', products: [] }
      // Loop already requests the consumer's iron plate and makes iron ore itself.
      const loop: Block = {
        ...makeEmptyBlock('Loop'), id: 'loop', products: [ironOreProduct],
        inputConnections: [{ id: 'cl', itemId: 'iron-plate', fromBlockId: 'consumer' }],
      }
      useBlockStore.setState({ blocks: [consumer, miner, smelter, loop], activeBlockId: 'consumer', history: {} })
      const smelterResult: SolverResult = {
        nodes: [{
          recipeNodeId: 's', inputRates: {}, outputRates: { 'iron-ore': 40 },
          throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
        }],
        unsatisfied: [], warnings: [],
      }
      const needsOre: SolverResult = { nodes: [], unsatisfied: [{ itemId: 'iron-ore', rate: 60 }], warnings: [] }
      useSolverStore.setState({
        lastResult: needsOre,
        lastResults: { consumer: needsOre, miner: empty(), smelter: smelterResult, loop: empty() },
        flows: [],
        _setStatus: () => {},
      })
    }

    it('lists requests first and takes second, marking a request that would close a loop', () => {
      setupMenu()
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      expect(screen.getByText('Request Iron Ore from')).toBeInTheDocument()
      expect(screen.getByText('Take existing Iron Ore from')).toBeInTheDocument()
      const requests = screen.getAllByRole('menuitem').filter(i => i.dataset.kind === 'request')
      expect(requests.map(i => i.textContent)).toEqual(['Miner', 'Loop ↻'])
      expect(requests[0]).toBeEnabled()
      expect(requests[1]).toBeEnabled()
      expect(requests[1].getAttribute('title')).toBe('Closes a loop: Loop already receives from this block, directly or through other blocks')
      const takes = screen.getAllByRole('menuitem').filter(i => i.dataset.kind === 'take')
      expect(takes).toHaveLength(1)
      expect(takes[0].textContent).toContain('Smelter')
      expect(takes[0].textContent).toContain('40.0')
    })

    it('clicking a request entry adds a plain connection', () => {
      setupMenu()
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
      fireEvent.click(screen.getAllByRole('menuitem').find(i => i.dataset.kind === 'request')!)
      expect(useBlockStore.getState().blocks[0].inputConnections).toEqual([
        { id: expect.any(String), itemId: 'iron-ore', fromBlockId: 'miner' },
      ])
    })
  })

  describe('removing a requested product', () => {
    const confirmText = 'Consumer requests Iron Plate from this block (30.0/m). It will only take what is left over and no longer drive this block.'

    it('asks first from the strip: Cancel keeps it, Remove product removes it', () => {
      setupRequest({ activeId: 'miner' })
      render(<FactorySummary />)
      select('Products', 'Iron Plate')
      fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove product' }))
      expect(screen.getByRole('heading', { name: "Remove Iron Plate from Miner's products?" })).toBeInTheDocument()
      expect(screen.getByTestId('product-change-effect').textContent).toBe(confirmText)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(dialog()).not.toBeInTheDocument()
      expect(miner().products).toHaveLength(1)
      fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove product' }))
      fireEvent.click(within(dialog()!).getByRole('button', { name: 'Remove product' }))
      expect(miner().products).toEqual([])
    })

    it('asks first from the right-click menu too', () => {
      setupRequest({ activeId: 'miner' })
      render(<FactorySummary />)
      fireEvent.contextMenu(slot('Products', 'Iron Plate'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove product' }))
      expect(screen.getByRole('heading', { name: "Remove Iron Plate from Miner's products?" })).toBeInTheDocument()
      expect(miner().products).toHaveLength(1)
    })

    it('removes at once when no other block uses it', () => {
      setupRequest({ activeId: 'miner', flows: [] })
      useBlockStore.setState(st => ({ blocks: st.blocks.map(b => (b.id === 'consumer' ? { ...b, inputConnections: [] } : b)) }))
      render(<FactorySummary />)
      select('Products', 'Iron Plate')
      fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove product' }))
      expect(dialog()).not.toBeInTheDocument()
      expect(miner().products).toEqual([])
    })
  })

  describe('adding a product', () => {
    const openPicker = async () => {
      fireEvent.click(screen.getByTitle('Add product'))
      await waitFor(() => screen.getByRole('heading', { name: 'Add product' }))
    }
    const pickOre = () =>
      fireEvent.click(screen.getAllByTestId('item-slot').find(b => b.getAttribute('data-item-id') === 'iron-ore')!)

    it('asks first when a consumer takes the item from this block, then adds it', async () => {
      setupRequest({ activeId: 'miner', itemId: 'iron-ore', flows: [requestFlow({ itemId: 'iron-ore', kind: 'take', requested: undefined })] })
      render(<FactorySummary />)
      await openPicker()
      pickOre()
      expect(screen.getByRole('heading', { name: 'Make Iron Ore a product of Miner?' })).toBeInTheDocument()
      expect(miner().products.map(p => p.itemId)).toEqual(['iron-plate'])
      fireEvent.click(within(dialog()!).getByRole('button', { name: 'Make it a product' }))
      expect(miner().products.map(p => p.itemId)).toEqual(['iron-plate', 'iron-ore'])
    })

    it('adds a product without extra when the amount is cleared', async () => {
      setupRequest({ activeId: 'miner', flows: [] })
      render(<FactorySummary />)
      await openPicker()
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '' } })
      pickOre()
      const added = miner().products.find(p => p.itemId === 'iron-ore')!
      expect(added).toBeDefined()
      expect('extraRate' in added).toBe(false)
    })
  })
})

describe('FactorySummary — products pane', () => {
  const makerResult = (plate: number): SolverResult => ({
    nodes: [{
      recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-ore': 30, 'iron-plate': plate },
      throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
    }],
    unsatisfied: [],
    warnings: [],
  })
  const empty = (): SolverResult => ({ nodes: [], unsatisfied: [], warnings: [] })
  const requestFlow = (over: Partial<ConnectionFlow> = {}): ConnectionFlow => ({
    connectionId: 'c1', fromBlockId: 'miner', toBlockId: 'consumer', itemId: 'iron-plate',
    available: 30, capped: false, rate: 30, status: 'ok', kind: 'request', requested: 30, ...over,
  })

  function setupRequest(opts: {
    itemId?: string
    minerProducts?: Product[]
    flows?: ConnectionFlow[]
    result?: SolverResult
  }) {
    const consumer: Block = {
      ...makeEmptyBlock('Consumer'), id: 'consumer', products: [],
      inputConnections: [{ id: 'c1', itemId: opts.itemId ?? 'iron-plate', fromBlockId: 'miner' }],
    }
    const miner: Block = { ...makeEmptyBlock('Miner'), id: 'miner', products: opts.minerProducts ?? [ironGoal] }
    useBlockStore.setState({ blocks: [consumer, miner], activeBlockId: 'miner', history: {} })
    const result = opts.result ?? makerResult(90)
    useSolverStore.setState({
      lastResult: result,
      lastResults: { consumer: empty(), miner: result },
      flows: opts.flows ?? [requestFlow()],
      _setStatus: () => {},
    })
  }
  const miner = () => useBlockStore.getState().blocks.find(b => b.id === 'miner')!
  const keyTexts = (kind?: string) => keyEntries('Products', kind).map(entryText)
  const stripText = () => strip('Products').textContent!

  it('shows the extra and the request in the header, and says who asked for what', () => {
    setupRequest({})
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    const extra = within(strip('Products')).getByRole('button', { name: /^extra 60\.0$/ })
    expect(extra).toHaveAttribute('title', 'Extra output: 60.0/m — click to edit')
    expect(stripText()).toContain('+ requested 30.0')
    expect(stripText()).not.toContain('makes')
    expect(keyTexts()).toEqual(['Consumer requests 30.0', 'Extra: 60.0 of 60.0'])
  })

  it('shows the request alone when there is no extra, and adds an extra from the key', () => {
    setupRequest({ minerProducts: [{ id: 'pp', itemId: 'iron-plate' }], result: makerResult(30) })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(screen.queryByTitle(/^Extra output:/)).not.toBeInTheDocument()
    expect(stripText()).toContain('requested 30.0')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: '+ Extra output' }))
    const input = screen.getByLabelText('Extra output rate')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(miner().products[0].extraRate).toBe(15)
  })

  it('removes the extra from the strip and from the context menu', () => {
    setupRequest({})
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove extra' }))
    expect(miner().products[0].extraRate).toBeUndefined()

    act(() => useBlockStore.setState(st => ({
      blocks: st.blocks.map(b => (b.id === 'miner' ? { ...b, products: [ironGoal] } : b)),
    })))
    fireEvent.contextMenu(slot('Products', 'Iron Plate'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove extra' }))
    expect(miner().products[0].extraRate).toBeUndefined()
  })

  it('removes the extra when the input is cleared', () => {
    setupRequest({})
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    fireEvent.click(screen.getByTitle(/^Extra output:/))
    const input = screen.getByLabelText('Extra output rate')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(miner().products[0].extraRate).toBeUndefined()
  })

  it('takes a shortfall out of the extra', () => {
    setupRequest({ result: makerResult(75) })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(entryText(keyEntries('Products', 'export')[0])).toBe('Consumer requests 30.0')
    expect(entryText(keyEntries('Products', 'short')[0])).toBe('Short 15.0 — comes out of the extra')
    expect(entryText(keyEntries('Products', 'kept')[0])).toBe('Extra: 45.0 of 60.0')
  })

  it('takes a shortfall out of the extra and the request', () => {
    setupRequest({
      minerProducts: [{ id: 'g1', itemId: 'iron-plate', extraRate: 10 }],
      result: makerResult(20),
      flows: [requestFlow({ rate: 20, requested: 30, status: 'limited' })],
    })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(entryText(keyEntries('Products', 'short')[0])).toBe("Short 20.0 — comes out of the extra and Consumer's request")
    expect(entryText(keyEntries('Products', 'export')[0])).toBe('Consumer: 20.0 of 30.0 requested')
  })

  it('does not blame a request that drew less because it took the item elsewhere first', () => {
    setupRequest({
      minerProducts: [{ id: 'g1', itemId: 'iron-plate', extraRate: 10 }],
      result: makerResult(20),
      flows: [requestFlow({ rate: 20, requested: 30, status: 'ok' })],
    })
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    expect(entryText(keyEntries('Products', 'short')[0])).toBe('Short 20.0 — comes out of the extra')
  })

  it('draws an empty slot dimmed with a dashed border and says nothing is requested', () => {
    setupRequest({ itemId: 'iron-ore', minerProducts: [{ id: 'pore', itemId: 'iron-ore' }], result: empty(), flows: [] })
    render(<FactorySummary />)
    const ore = within(pane('Products')).getByRole('button', { name: 'Iron Ore, nothing requested yet' })
    expect(ore).toHaveAttribute('data-dimmed', 'true')
    expect(ore.className).toContain('border-dashed')
    expect(ore).toHaveAttribute('title', 'Iron Ore — nothing requested yet')
    fireEvent.click(ore)
    expect(stripText()).toContain('nothing requested yet')
  })

  describe('byproducts', () => {
    const slagResult: SolverResult = {
      nodes: [{
        recipeNodeId: 'n1', inputRates: {}, outputRates: { 'iron-plate': 60, 'slag': 10 },
        throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0,
      }],
      unsatisfied: [], warnings: [],
    }

    it('turns a byproduct into a product without extra, from the strip and from the menu', () => {
      setupRequest({ result: slagResult, flows: [] })
      render(<FactorySummary />)
      select('Byproducts', 'Slag')
      expect(within(strip('Byproducts')).getAllByRole('button').map(b => b.textContent))
        .toEqual(expect.arrayContaining(['Add consumer recipe…', 'Make it a product']))
      fireEvent.click(within(strip('Byproducts')).getByRole('button', { name: 'Make it a product' }))
      expect(miner().products.map(p => p.itemId)).toEqual(['iron-plate', 'slag'])
      expect('extraRate' in miner().products[1]).toBe(false)
      expect(dialog()).not.toBeInTheDocument()

      act(() => useBlockStore.setState(st => ({
        blocks: st.blocks.map(b => (b.id === 'miner' ? { ...b, products: [ironGoal] } : b)),
      })))
      fireEvent.contextMenu(slot('Byproducts', 'Slag'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Make it a product' }))
      expect(miner().products.map(p => p.itemId)).toEqual(['iron-plate', 'slag'])
    })

    it('asks first when another block takes the byproduct', () => {
      setupRequest({
        itemId: 'iron-ore',
        flows: [requestFlow({ itemId: 'iron-ore', kind: 'take', requested: undefined })],
      })
      render(<FactorySummary />)
      select('Byproducts', 'Iron Ore')
      fireEvent.click(within(strip('Byproducts')).getByRole('button', { name: 'Make it a product' }))
      expect(screen.getByRole('heading', { name: 'Make Iron Ore a product of Miner?' })).toBeInTheDocument()
      fireEvent.click(within(dialog()!).getByRole('button', { name: 'Make it a product' }))
      expect(miner().products.map(p => p.itemId)).toEqual(['iron-plate', 'iron-ore'])
      expect('extraRate' in miner().products[1]).toBe(false)
    })
  })

  const dialog = () => screen.queryByTestId('product-change-confirm')
})

describe('FactorySummary — short product', () => {
  it('marks a short product with an amber ▼ and the shortfall in the title', () => {
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
  it('keeps Add product outside the scrolling grid', () => {
    setupStore([ironGoal, { id: 'g2', itemId: 'iron-ore', extraRate: 10 }])
    render(<FactorySummary />)
    expect(pane('Products').textContent).toContain('· 2')
    expect(screen.getByTitle('Add product').closest('.overflow-y-auto')).toBeNull()
  })

  it('caps the slot grid height and gives the strip a fixed height', () => {
    render(<FactorySummary />)
    const grid = within(pane('Products')).getByTestId('summary-slot-grid')
    expect(grid).toHaveClass('max-h-[97px]')
    expect(grid).toHaveClass('overflow-y-auto')
    expect(strip('Products')).toHaveClass('h-[72px]')
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
    act(() => useUiStore.getState().setRateUnit('sec'))
    expect(pane('Products')).toHaveAttribute('data-overflow', 'true')
    contentHeight = 50
    act(() => useUiStore.getState().setRateUnit('min'))
    expect(pane('Products')).not.toHaveAttribute('data-overflow')
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

  /** The block gets a row for a recipe that makes Iron Ore, so the item has an LP row and can be locked. */
  function addOreRow() {
    const data = structuredClone(mockGameData)
    data.recipes['ore-synth'] = {
      id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
      ingredients: [], products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => ({ ...b, rootPlan: { ...b.rootPlan, nodes: [makeRecipeNode('ore-synth')] } })),
    }))
  }

  it('the Import switch locks and dims the slot, and lifts the lock', () => {
    addOreRow()
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    fireEvent.click(within(strip('Ingredients')).getByRole('switch'))
    expect(noImport()).toEqual(['iron-ore'])
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-status', 'locked')
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('data-dimmed', 'true')
    fireEvent.click(within(strip('Ingredients')).getByRole('switch'))
    expect(noImport()).toEqual([])
  })

  it('lets Import be turned off on an item no row makes (raw), saying it has no effect', () => {
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    const switchEl = within(strip('Ingredients')).getByRole('switch')
    expect(switchEl).not.toHaveAttribute('aria-disabled')
    fireEvent.click(switchEl)
    expect(noImport()).toEqual(['iron-ore'])
    const line = within(strip('Ingredients')).getByTestId('no-effect')
    expect(line).toHaveTextContent('No row in this block makes Iron Ore.')
    fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
    expect(noImport()).toEqual([])
  })

  it('has no Forbid imports or Allow imports in the right-click menu', () => {
    addOreRow()
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
    expect(screen.getByText('Take existing Iron Ore from')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /imports/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('left click on a locked slot only selects it', () => {
    lock('iron-ore')
    render(<FactorySummary />)
    select('Ingredients', 'Iron Ore')
    expect(noImport()).toEqual(['iron-ore'])
    expect(strip('Ingredients')).toHaveAttribute('data-state', 'selected')
    expect(screen.queryByRole('heading', { name: 'Add recipe' })).not.toBeInTheDocument()
  })

  it('right-click on a locked slot still opens the connection menu', () => {
    lock('iron-ore')
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Ore'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /imports/i })).not.toBeInTheDocument()
  })

  it('a lock left on a goal item has no menu, and is removed in the strip', () => {
    lock('iron-plate')
    render(<FactorySummary />)
    fireEvent.contextMenu(slot('Ingredients', 'Iron Plate'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    select('Ingredients', 'Iron Plate')
    const line = within(strip('Ingredients')).getByTestId('no-effect')
    expect(line).toHaveTextContent('Iron Plate is a product of this block, so the block always makes it.')
    fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
    expect(noImport()).toEqual([])
  })
})

describe('FactorySummary — two goals for the same item', () => {
  const second: Product = { id: 'g2', itemId: 'iron-plate', extraRate: 30 }
  const slots = () => within(pane('Products')).getAllByTestId('summary-slot')

  beforeEach(() => setupStore([ironGoal, second]))

  it('selects only the clicked slot', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    expect(slots()[0]).toHaveAttribute('aria-pressed', 'false')
    expect(slots()[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes the second product, not the first', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    fireEvent.click(within(strip('Products')).getByRole('button', { name: 'Remove product' }))
    expect(useBlockStore.getState().blocks[0].products.map(p => p.id)).toEqual(['g1'])
  })

  it('edits the extra output of the second product', () => {
    render(<FactorySummary />)
    fireEvent.click(slots()[1])
    fireEvent.click(screen.getByTitle(/^Extra output:/))
    const input = screen.getByLabelText('Extra output rate')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useBlockStore.getState().blocks[0].products.map(p => p.extraRate)).toEqual([60, 45])
  })
})

describe('FactorySummary — bars', () => {
  const proto = HTMLElement.prototype
  const savedWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  afterEach(() => {
    if (savedWidth) Object.defineProperty(proto, 'clientWidth', savedWidth)
    else delete (proto as unknown as Record<string, unknown>).clientWidth
  })
  /** The bar's own width; happy-dom has no layout. */
  const withBarWidth = (px: number) => Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => px })
  /** What a segment writes in the bar: everything but its tooltip. */
  const written = (el: HTMLElement) =>
    [...el.children].filter(c => c.getAttribute('aria-hidden') !== 'true').map(c => c.textContent).join(' ')

  it('draws the overview as one bar of segments, one per row, with the amount and the item count in the wide one', () => {
    withBarWidth(300)
    render(<FactorySummary />)
    const kept = overviewRow('Products', 'kept')
    expect(within(strip('Products')).getAllByTestId('summary-overview-segment')).toHaveLength(2)
    expect(written(kept)).toBe('Left 58.0 · 1')
    // The short segment is about 3% of the bar: too thin for any text, so the tooltip and the name carry it.
    expect(written(overviewRow('Products', 'short'))).toBe('')
    expect(overviewRow('Products', 'short')).toHaveAccessibleName('Short · 2.00 · 1 item')
  })

  it('writes no text before the bar has a width, and still names every segment', () => {
    render(<FactorySummary />)
    const kept = overviewRow('Products', 'kept')
    expect(written(kept)).toBe('')
    expect(kept).toHaveAccessibleName('Left · 58.0 · 1 item')
  })

  it('shows the full information in the tooltip: name, amount and note', () => {
    render(<FactorySummary />)
    expect(entryText(overviewRow('Products', 'kept'))).toBe('Left 58.0 1 item')
  })

  it('traces from a segment: pressed, and the other segments fade', () => {
    render(<FactorySummary />)
    fireEvent.click(overviewRow('Products', 'short'))
    expect(overviewRow('Products', 'short')).toHaveAttribute('aria-pressed', 'true')
    expect(overviewRow('Products', 'kept')).toHaveAttribute('aria-pressed', 'false')
    expect(within(overviewRow('Products', 'kept')).getByTestId('summary-segment-fill').style.opacity).toBe('0.5')
    expect(overviewRow('Products', 'kept').style.opacity).toBe('')
    expect(within(strip('Products')).getByText('click again to clear')).toBeInTheDocument()
    fireEvent.click(overviewRow('Products', 'short'))
    expect(within(strip('Products')).getByText('click a segment to trace it')).toBeInTheDocument()
  })

  it('gives a selected item a 16 px bar, no key line, and an accessible name on every segment', () => {
    withBarWidth(300)
    render(<FactorySummary />)
    select('Products', 'Iron Plate')
    const segs = segments('Products')
    expect(segs.length).toBeGreaterThan(0)
    for (const seg of segs) expect(seg).toHaveAccessibleName(/\S/)
    expect(within(strip('Products')).queryAllByTestId('summary-key-entry')).toHaveLength(0)
    expect(segs[0].parentElement).toHaveClass('h-4')
    expect(written(segs[0])).toContain('Extra')
    // The actions keep their line.
    expect(within(strip('Products')).getByRole('button', { name: 'Find recipe' })).toBeInTheDocument()
    expect(within(strip('Products')).getByRole('button', { name: 'Remove product' })).toBeInTheDocument()
  })

  it('keeps the 72 px strip in every state', () => {
    render(<FactorySummary />)
    expect(strip('Products')).toHaveClass('h-[72px]')
    select('Products', 'Iron Plate')
    expect(strip('Products')).toHaveClass('h-[72px]')
    fireEvent.mouseEnter(slot('Products', 'Iron Plate'))
    expect(strip('Products')).toHaveClass('h-[72px]')
  })
})

describe('FactorySummary — collapsed summary', () => {
  const proto = HTMLElement.prototype
  const savedWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  afterEach(() => {
    if (savedWidth) Object.defineProperty(proto, 'clientWidth', savedWidth)
    else delete (proto as unknown as Record<string, unknown>).clientWidth
  })
  /** The room of a line pane; happy-dom has no layout, so without this every pane has none. */
  const withRoom = (px: number) => Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => px })
  const collapse = () => useUiStore.setState({ summaryCollapsed: true })
  // Both the Expand button and the handle row expand: CSS shows one of them (happy-dom applies no CSS).
  const expandButtons = () => screen.getAllByRole('button', { name: 'Expand summary' })

  it('is the default: one line per pane with its count, and no slots', () => {
    useUiStore.setState({ summaryCollapsed: useUiStore.getInitialState().summaryCollapsed })
    render(<FactorySummary />)
    expect(screen.getAllByTestId('summary-line-pane').map(p => p.dataset.pane)).toEqual(['products', 'byproducts', 'ingredients'])
    expect(within(pane('Products')).getByTestId('summary-line-count')).toHaveTextContent('1')
    expect(within(pane('Byproducts')).getByTestId('summary-line-count')).toHaveTextContent('1')
    expect(screen.queryAllByTestId('summary-slot')).toHaveLength(0)
    expect(screen.queryByTestId('summary-detail')).toBeNull()
    expect(screen.queryByTitle('Add product')).toBeNull()
  })

  it('draws as many chips as fit, each with its quantity, the goal in the title, and no +N when they all fit', () => {
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chips = within(pane('Products')).getAllByTestId('summary-line-chip')
    expect(chips.map(c => c.dataset.itemId)).toEqual(['iron-plate'])
    expect(chips[0]).toHaveAttribute('title', 'Iron Plate — goal 60.0/m, making 58.0/m, short by 2.00/m')
    expect(within(chips[0]).getByTestId('summary-line-quantity')).toHaveTextContent('60.0')
    expect(chips[0]).toHaveAttribute('data-status', 'short')
    expect(chips[0]).toHaveClass('ring-amber-500')
    // Not by colour alone: a name that carries the title's text and a ▼ cue.
    expect(within(pane('Products')).getByRole('img', { name: 'Iron Plate — goal 60.0/m, making 58.0/m, short by 2.00/m' })).toBe(chips[0])
    expect(chips[0]).toHaveTextContent('▼')
    expect(within(pane('Products')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByTestId('summary-line-more')).toHaveLength(0)
  })

  it('shows the rate of a byproduct and of an ingredient, in their tones', () => {
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const by = within(pane('Byproducts')).getByTestId('summary-line-chip')
    expect(by).toHaveAttribute('title', 'Slag — 10.0/m')
    expect(by).not.toHaveAttribute('data-status')
    expect(within(by).getByTestId('summary-line-quantity')).toHaveTextContent('10.0')
    expect(within(by).getByTestId('summary-line-quantity')).toHaveClass('text-red-300')
    const ing = within(pane('Ingredients')).getByTestId('summary-line-chip')
    expect(within(ing).getByTestId('summary-line-quantity')).toHaveTextContent('120')
    expect(within(ing).getByTestId('summary-line-quantity')).toHaveClass('text-green-300')
  })

  it('shows the goal alone when the output meets it', () => {
    setupStore([{ ...ironGoal, extraRate: 58 }])
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('58.0')
    expect(chip).toHaveAttribute('title', 'Iron Plate — goal 58.0/m')
    expect(chip).not.toHaveAttribute('data-status')
    expect(chip).not.toHaveClass('ring-amber-500')
  })

  it('shows the goal and the surplus actual, not short, when the output exceeds it', () => {
    setupStore([{ ...ironGoal, extraRate: 50 }])
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('50.0')
    expect(chip).toHaveAttribute('title', 'Iron Plate — goal 50.0/m, making 58.0/m')
    expect(chip).not.toHaveAttribute('data-status')
  })

  it('shows the goal before any solve', () => {
    setupStore([ironGoal], false)
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('60.0')
    expect(chip).toHaveAttribute('title', 'Iron Plate — goal 60.0/m')
  })

  it('shows the actual rate of a product without a goal', () => {
    setupStore([{ id: 'g1', itemId: 'iron-plate', extraRate: 0 }])
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('58.0')
    expect(chip).toHaveAttribute('title', 'Iron Plate — 58.0/m')
  })

  it('draws an empty product as a dimmed dash', () => {
    setupStore([{ id: 'g1', itemId: 'iron-plate', extraRate: 0 }], false)
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('—')
    expect(chip).toHaveAttribute('title', 'Iron Plate — nothing requested yet')
    expect(chip).toHaveClass('opacity-55')
  })

  it('words the quantity and the title per second in /sec', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    collapse()
    withRoom(300)
    render(<FactorySummary />)
    const chip = within(pane('Products')).getByTestId('summary-line-chip')
    expect(within(chip).getByTestId('summary-line-quantity')).toHaveTextContent('1.0')
    expect(chip.getAttribute('title')).toMatch(/\/s$/)
  })

  it('shows a +N for what has no room, and it lists every item with its rate', () => {
    collapse()
    withRoom(0)
    render(<FactorySummary />)
    expect(within(pane('Products')).queryAllByTestId('summary-line-chip')).toHaveLength(0)
    const more = within(pane('Products')).getByRole('button', { name: 'Show all 1 products' })
    expect(more).toHaveTextContent('+1')
    expect(screen.getByRole('button', { name: 'Show all 1 byproducts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all 1 ingredients' })).toBeInTheDocument()
    fireEvent.click(more)
    const list = screen.getByTestId('summary-line-popup')
    expect(list).toHaveAttribute('aria-label', 'All 1 products')
    expect(list).toHaveTextContent('Iron Plate')
    expect(list).toHaveTextContent('60.0/m')
    expect(list).toHaveTextContent('→')
    expect(list).toHaveTextContent('▼ 58.0/m')
    expect(within(list).getByTestId('summary-line-popup-actual')).toHaveClass('text-amber-400')
    // Informational: the items are not buttons.
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('summary-line-popup')).toBeNull()
  })

  it('lists a met goal without an arrow, and a surplus in teal', () => {
    setupStore([{ ...ironGoal, extraRate: 58 }])
    collapse()
    withRoom(0)
    const { unmount } = render(<FactorySummary />)
    fireEvent.click(within(pane('Products')).getByRole('button', { name: 'Show all 1 products' }))
    expect(screen.getByTestId('summary-line-popup')).not.toHaveTextContent('→')
    unmount()

    setupStore([{ ...ironGoal, extraRate: 50 }])
    collapse()
    render(<FactorySummary />)
    fireEvent.click(within(pane('Products')).getByRole('button', { name: 'Show all 1 products' }))
    expect(screen.getByTestId('summary-line-popup-actual')).toHaveClass('text-teal-400')
    expect(screen.getByTestId('summary-line-popup-actual')).not.toHaveTextContent('▼')
  })

  it('expands to the full panes and collapses back; the choice is the store\'s, so it spans block switches', () => {
    collapse()
    render(<FactorySummary />)
    expect(expandButtons()).toHaveLength(2)
    // The names are the visible texts (the button's own says "Expand"), so no aria-expanded repeats them.
    expect(expandButtons().map(b => b.hasAttribute('aria-expanded'))).toEqual([false, false])
    fireEvent.click(expandButtons()[0])
    expect(useUiStore.getState().summaryCollapsed).toBe(false)
    expect(screen.queryByTestId('summary-line')).toBeNull()
    expect(slot('Products', 'Iron Plate')).toBeInTheDocument()

    // The handle row is the only toggle now.
    const handle = screen.getByRole('button', { name: 'Collapse summary' })
    expect(handle).not.toHaveAttribute('aria-expanded')
    expect(handle).toHaveTextContent('Collapse summary')

    const other = makeEmptyBlock('Other')
    act(() => useBlockStore.setState(state => ({ blocks: [...state.blocks, other], activeBlockId: other.id })))
    expect(screen.getByRole('button', { name: 'Collapse summary' })).toBeInTheDocument()
    expect(within(pane('Products')).getByTestId('summary-slot-grid')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse summary' }))
    expect(screen.getAllByTestId('summary-line-pane')).toHaveLength(3)
    act(() => useBlockStore.setState(state => ({ activeBlockId: state.blocks[0].id })))
    expect(screen.getAllByTestId('summary-line-pane')).toHaveLength(3)
  })

  it('moves focus to the counterpart control when the summary toggles, so the keyboard is not dropped', () => {
    collapse()
    render(<FactorySummary />)
    const line = screen.getByTestId('summary-line')
    const lineExpand = within(line).getByRole('button', { name: 'Expand summary' })
    lineExpand.focus()
    fireEvent.click(lineExpand)
    // The line (and its button) is gone: the handle row, the only toggle now, has the focus.
    expect(screen.queryByTestId('summary-line')).toBeNull()
    const handle = screen.getByRole('button', { name: 'Collapse summary' })
    expect(handle).toHaveFocus()

    fireEvent.click(handle)
    // From md the handle is not drawn once collapsed: the line's Expand button takes the focus.
    expect(within(screen.getByTestId('summary-line')).getByRole('button', { name: 'Expand summary' })).toHaveFocus()
  })

  it('does not take the focus when the collapsed state changes without a toggle', () => {
    render(<FactorySummary />)
    expect(document.body).toHaveFocus()
    act(() => useUiStore.setState({ summaryCollapsed: true }))
    expect(document.body).toHaveFocus()
  })

  it('sizes the strip: a 58 px row of three lines with a 68 px Expand button, a 123 px stack below md', () => {
    collapse()
    render(<FactorySummary />)
    const line = screen.getByTestId('summary-line')
    expect(line).toHaveClass('md:h-[58px]', 'max-md:h-[123px]')
    expect(screen.getAllByTestId('summary-line-pane')[0]).toHaveClass('md:h-10', 'h-[38px]')
    expect(within(line).getByRole('button', { name: 'Expand summary' })).toHaveClass('w-[68px]', 'max-md:hidden')
    // The handle row (18 px) expands below md, where the button is gone, and is not drawn from md.
    const handle = expandButtons().find(b => !line.contains(b))!
    expect(handle).toHaveClass('h-[18px]', 'md:hidden')
  })
})

describe('lineRate', () => {
  const base: SlotModel = { id: 's', itemId: 'iron-plate', rate: 58, scale: 60, segments: [], overlays: [], status: 'short', dimmed: false }
  const product = (over: Partial<NonNullable<SlotModel['product']>>): SlotModel => ({
    ...base,
    product: { id: 'g1', extra: 60, required: 60, actual: 58, short: true, requested: 0, differs: true, tickAt: 0.9, ...over },
  })

  it('shows the goal and the actual of a product that differs from it', () => {
    expect(lineRate('products', product({}))).toEqual({ shown: 60, actual: 58, short: true, hasGoal: true })
  })

  it('never shows a negative actual', () => {
    expect(lineRate('products', product({ actual: -5 }))).toMatchObject({ shown: 60, actual: 0, short: true })
  })

  it('decides "differs" from the flag, not from the bar tick', () => {
    expect(lineRate('products', product({ tickAt: null, differs: true })).actual).toBe(58)
    expect(lineRate('products', product({ tickAt: 0.9, differs: false })).actual).toBeUndefined()
  })

  it('has no actual when it matches the goal or before a solve', () => {
    expect(lineRate('products', product({ actual: 60, short: false, differs: false, tickAt: null }))).toEqual({ shown: 60, actual: undefined, short: false, hasGoal: true })
    expect(lineRate('products', product({ actual: undefined, short: false, differs: false }))).toEqual({ shown: 60, actual: undefined, short: false, hasGoal: true })
  })

  it('shows the slot rate for a product without a goal, an empty one and the other panes', () => {
    expect(lineRate('products', product({ required: 0, extra: undefined }))).toEqual({ shown: 58, short: false, hasGoal: false })
    expect(lineRate('products', { ...product({}), empty: true })).toEqual({ shown: 58, short: false, hasGoal: false })
    expect(lineRate('byproducts', product({}))).toEqual({ shown: 58, short: false, hasGoal: false })
    expect(lineRate('ingredients', base)).toEqual({ shown: 58, short: false, hasGoal: false })
  })
})

describe('FactorySummary — opening an Ingredients slot on request', () => {
  const open = (itemId: string) => act(() => useUiStore.getState().openIngredientSlot(itemId))
  const ingredientIds = () =>
    within(pane('Ingredients')).queryAllByTestId('summary-slot').map(s => s.getAttribute('data-item-id'))
  const comesFrom = () => within(strip('Ingredients')).getByTestId('comes-from')
  /** Slag is made and used inside the block: it is not imported, connected or locked, so it has no Ingredients slot. */
  const withSlagRule = () =>
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, itemSourcing: { slag: 'byproducts-first' as const } })) }))

  beforeEach(() => useUiStore.setState({ ingredientSlotRequest: null, selectedRow: null }))
  afterEach(() => vi.unstubAllGlobals())

  it('selects the slot, focuses the chosen preset of its Comes from control, and consumes the request', () => {
    render(<FactorySummary />)
    open('iron-ore')
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
    expect(strip('Ingredients')).toHaveAttribute('data-state', 'selected')
    expect(comesFrom()).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(within(comesFrom()).getByRole('radio', { name: 'Make it here' }))
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
  })

  it('focuses the preset that is chosen, the one tab stop of the group', () => {
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, itemSourcing: { 'iron-ore': 'connections-first' as const } })) }))
    render(<FactorySummary />)
    open('iron-ore')
    expect(document.activeElement).toBe(within(comesFrom()).getByRole('radio', { name: 'Receive it first' }))
  })

  it('expands a collapsed summary first', () => {
    useUiStore.setState({ summaryCollapsed: true })
    render(<FactorySummary />)
    expect(screen.queryByTestId('summary-pane')).not.toBeInTheDocument()
    open('iron-ore')
    expect(useUiStore.getState().summaryCollapsed).toBe(false)
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
    expect(comesFrom()).toContainElement(document.activeElement as HTMLElement)
  })

  it('opens the same slot again after it was deselected', () => {
    render(<FactorySummary />)
    open('iron-ore')
    select('Ingredients', 'Iron Ore')
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'false')
    open('iron-ore')
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
    expect(comesFrom()).toContainElement(document.activeElement as HTMLElement)
  })

  it('gives an item that has a rule but is only an intermediate no slot, until it is asked for, and none again once deselected', () => {
    withSlagRule()
    render(<FactorySummary />)
    expect(ingredientIds()).toEqual(['iron-ore'])
    expect(pane('Ingredients').textContent).toContain('· 1')

    open('slag')
    expect(ingredientIds()).toEqual(['iron-ore', 'slag'])
    expect(slot('Ingredients', 'Slag')).toHaveAttribute('aria-pressed', 'true')
    expect(within(comesFrom()).getByRole('radio', { name: "Only what's already made" })).toBeChecked()
    expect(comesFrom()).toContainElement(document.activeElement as HTMLElement)

    // Changing the rule keeps the slot: it is still selected.
    fireEvent.click(within(comesFrom()).getByRole('radio', { name: 'Receive it first' }))
    expect(ingredientIds()).toEqual(['iron-ore', 'slag'])

    select('Ingredients', 'Slag')
    expect(ingredientIds()).toEqual(['iron-ore'])
    expect(useBlockStore.getState().blocks[0].itemSourcing).toEqual({ slag: 'connections-first' })
  })

  it('drops the temporary slot on Escape, when another slot is selected, and when the summary collapses', () => {
    render(<FactorySummary />)
    open('slag')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(ingredientIds()).toEqual(['iron-ore'])

    open('slag')
    select('Ingredients', 'Iron Ore')
    expect(ingredientIds()).toEqual(['iron-ore'])
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')

    open('slag')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse summary' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand summary' })[0])
    expect(ingredientIds()).toEqual(['iron-ore'])
  })

  it('keeps at most one temporary slot: a request for another item replaces it', () => {
    render(<FactorySummary />)
    open('slag')
    open('iron-plate')
    expect(ingredientIds()).toEqual(['iron-ore', 'iron-plate'])
    expect(slot('Ingredients', 'Iron Plate')).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops the temporary slot when the block changes', () => {
    const other = makeEmptyBlock('Other')
    useBlockStore.setState(s => ({ blocks: [...s.blocks, other] }))
    const first = useBlockStore.getState().activeBlockId
    render(<FactorySummary />)
    open('slag')
    act(() => useBlockStore.setState({ activeBlockId: other.id }))
    expect(ingredientIds()).not.toContain('slag')
    act(() => useBlockStore.setState({ activeBlockId: first }))
    expect(ingredientIds()).toEqual(['iron-ore'])
  })

  it('ignores a request left over from before it mounted', () => {
    useUiStore.getState().openIngredientSlot('slag')
    useUiStore.setState({ summaryCollapsed: true })
    render(<FactorySummary />)
    expect(useUiStore.getState().summaryCollapsed).toBe(true)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
  })

  it('closes a side panel that is a drawer, and leaves a docked one open', () => {
    const media = (matches: boolean) => () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })
    useUiStore.setState({ selectedRow: { blockId: 'b', nodeId: 'n' } })
    vi.stubGlobal('matchMedia', media(false))
    const { unmount } = render(<FactorySummary />)
    open('iron-ore')
    expect(useUiStore.getState().selectedRow, 'docked').toEqual({ blockId: 'b', nodeId: 'n' })
    unmount()

    vi.stubGlobal('matchMedia', media(true))
    render(<FactorySummary />)
    open('iron-ore')
    expect(useUiStore.getState().selectedRow, 'drawer').toBeNull()
    expect(comesFrom()).toContainElement(document.activeElement as HTMLElement)
  })
})

describe('FactorySummary — source rule marker', () => {
  const proto = HTMLElement.prototype
  const savedWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  afterEach(() => {
    if (savedWidth) Object.defineProperty(proto, 'clientWidth', savedWidth)
    else delete (proto as unknown as Record<string, unknown>).clientWidth
  })
  const withRoom = (px: number) => Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => px })
  const patch = (over: Partial<Block>) =>
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, ...over })) }))
  const markers = (el: HTMLElement) => within(el).queryAllByTestId('source-rule-marker')

  /** The block gets a row that makes Iron Ore and Slag, so a rule on either can have an effect. */
  function withMakerRow() {
    const data = structuredClone(mockGameData)
    data.recipes['ore-synth'] = {
      id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
      ingredients: [],
      products: [{ itemId: 'iron-ore', type: 'item', amount: 1 }, { itemId: 'slag', type: 'item', amount: 1 }],
      madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'iron-ore',
    } as unknown as GameData['recipes'][string]
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    patch({ rootPlan: { ...useBlockStore.getState().blocks[0].rootPlan, nodes: [makeRecipeNode('ore-synth')] } })
  }

  beforeEach(() => useUiStore.setState({ ingredientSlotRequest: null, selectedRow: null }))

  it('is on the Ingredients slot of an item with a rule that has an effect, selected or not, and named by the slot', () => {
    withMakerRow()
    patch({ itemSourcing: { 'iron-ore': 'byproducts-first' } })
    render(<FactorySummary />)
    const ore = slot('Ingredients', 'Iron Ore')
    expect(ore).toHaveAccessibleName('Iron Ore, 120 per minute, has a source rule')
    expect(markers(ore)).toHaveLength(1)
    // It shows the rule and takes no click of its own: the slot is the way to the control. Its tooltip is the sentence.
    const marker = markers(ore)[0]
    expect(marker.tagName).toBe('SPAN')
    expect(marker).toHaveAttribute('title', expect.stringContaining('Iron Ore'))
    // The slot's name already says it: the marker is out of the accessibility tree.
    expect(marker.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(within(ore).queryByRole('img')).toBeNull()

    fireEvent.click(marker)
    expect(ore).toHaveAttribute('aria-pressed', 'true')
    expect(markers(ore)).toHaveLength(1)
    expect(within(strip('Ingredients')).getByTestId('sourcing-sentence')).toHaveTextContent(marker.getAttribute('title')!)
  })

  it('follows the status in the slot name, and sits after the status badge of a locked slot', () => {
    withMakerRow()
    patch({ noImportItems: ['iron-ore'] })
    render(<FactorySummary />)
    const ore = slot('Ingredients', 'Iron Ore')
    expect(ore).toHaveAccessibleName('Iron Ore, 120 per minute, locked, has a source rule')
    expect(ore).toHaveAttribute('data-status', 'locked')
    const badge = within(ore).getByText('⊘')
    const marker = markers(ore)[0]
    expect(badge.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING, 'badge first, then marker').toBeTruthy()
    // The badge makes room for the marker in the corner.
    expect(badge).toHaveClass('right-[10px]')
  })

  it('is absent for the default and for a rule with no effect', () => {
    render(<FactorySummary />)
    expect(markers(pane('Ingredients'))).toHaveLength(0)
    expect(slot('Ingredients', 'Iron Ore')).toHaveAccessibleName('Iron Ore, 120 per minute')
    expect(within(slot('Ingredients', 'Iron Ore')).getByText('120')).toBeInTheDocument()

    // No row of the block makes Iron Ore: both rules are stored and neither has an effect.
    act(() => patch({ itemSourcing: { 'iron-ore': 'byproducts-first' }, noImportItems: ['iron-ore'] }))
    expect(markers(pane('Ingredients'))).toHaveLength(0)
    expect(slot('Ingredients', 'Iron Ore')).toHaveAccessibleName('Iron Ore, 120 per minute, locked')
  })

  it('is never on a Byproducts or Products slot, and adds no Ingredients slot', () => {
    withMakerRow()
    patch({ itemSourcing: { slag: 'byproducts-first' } })
    render(<FactorySummary />)
    expect(slot('Byproducts', 'Slag')).toHaveAccessibleName('Slag, 10.0 per minute')
    expect(markers(pane('Byproducts'))).toHaveLength(0)
    expect(markers(pane('Products'))).toHaveLength(0)
    // Slag has a rule with an effect but is not imported, connected or locked: it has no Ingredients slot.
    expect(within(pane('Ingredients')).getAllByTestId('summary-slot').map(s => s.dataset.itemId)).toEqual(['iron-ore'])
    expect(markers(pane('Ingredients'))).toHaveLength(0)

    // The temporary slot it is given on request shows the marker.
    act(() => useUiStore.getState().openIngredientSlot('slag'))
    expect(slot('Ingredients', 'Slag')).toHaveAccessibleName('Slag, 0.00 per minute, has a source rule')
    expect(markers(slot('Ingredients', 'Slag'))).toHaveLength(1)
  })

  it('is on the chip of the collapsed line, beside it, and opens the slot', () => {
    withMakerRow()
    patch({ itemSourcing: { 'iron-ore': 'byproducts-first', slag: 'byproducts-first' } })
    useUiStore.setState({ summaryCollapsed: true })
    withRoom(300)
    render(<FactorySummary />)
    const line = pane('Ingredients')
    const chip = within(line).getByTestId('summary-line-chip')
    expect(markers(line)).toHaveLength(1)
    const marker = markers(line)[0]
    // A button of its own, in the chip's frame and not inside the chip.
    expect(marker.tagName).toBe('BUTTON')
    expect(marker).toHaveAttribute('data-item-id', 'iron-ore')
    expect(chip.contains(marker)).toBe(false)
    expect(chip.parentElement).toHaveAttribute('data-chip-frame')
    expect(chip.parentElement).toContainElement(marker)
    expect(marker).toHaveAccessibleName(/Iron Ore|Ore Synth/)
    // Byproduct and product chips never show one.
    expect(markers(pane('Byproducts'))).toHaveLength(0)
    expect(markers(pane('Products'))).toHaveLength(0)

    fireEvent.click(marker)
    expect(useUiStore.getState().summaryCollapsed).toBe(false)
    expect(slot('Ingredients', 'Iron Ore')).toHaveAttribute('aria-pressed', 'true')
    expect(within(strip('Ingredients')).getByTestId('comes-from')).toContainElement(document.activeElement as HTMLElement)
  })

  it('is absent from the collapsed line for the default and for a rule with no effect', () => {
    patch({ itemSourcing: { 'iron-ore': 'byproducts-first' } })
    useUiStore.setState({ summaryCollapsed: true })
    withRoom(300)
    render(<FactorySummary />)
    expect(within(pane('Ingredients')).getAllByTestId('summary-line-chip')).toHaveLength(1)
    expect(screen.queryAllByTestId('source-rule-marker')).toHaveLength(0)
    expect(document.querySelector('[data-chip-frame]')).toBeNull()
  })

  it('is in the +N list of the collapsed line for an item whose chip does not fit, and only shows the rule there', () => {
    withMakerRow()
    patch({ itemSourcing: { 'iron-ore': 'byproducts-first' } })
    useUiStore.setState({ summaryCollapsed: true })
    withRoom(0)
    render(<FactorySummary />)
    expect(screen.queryAllByTestId('source-rule-marker')).toHaveLength(0)
    fireEvent.click(within(pane('Ingredients')).getByTestId('summary-line-more'))
    const popup = screen.getByTestId('summary-line-popup')
    const marker = within(popup).getByTestId('source-rule-marker')
    expect(marker.tagName).toBe('SPAN')
    expect(marker.closest('li')).toHaveAttribute('data-item-id', 'iron-ore')
  })
})
