import { useState } from 'react'
import { RowActionsMenu } from '../RowActionsMenu'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { SidePanel } from './SidePanel'
import { useBlockStore, makeEmptyBlock } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import { useSolverStore } from '../../../store/solverStore'
import type { Block, GameData, GameRecipeNode, SolverResult, SubPlan } from '../../../data/types'

/** Fresh each call: iron plate (from ore) and plastic, one furnace. */
function makeGameData(): GameData {
  const item = (id: string, name: string) => ({ id, name, type: 'item' as const, iconPath: '', hidden: false })
  const recipe = (id: string, name: string, ingredient: string | undefined, product: string) => ({
    id, name, category: 'smelting', craftingTime: 1,
    ingredients: ingredient ? [{ itemId: ingredient, type: 'item' as const, amount: 1 }] : [],
    products: [{ itemId: product, type: 'item' as const, amount: 1 }],
    madeIn: [], allowProductivity: false, hidden: false, mainProduct: product,
  })
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: { ore: item('ore', 'Iron Ore'), plate: item('plate', 'Iron Plate'), gear: item('gear', 'Gear') },
    recipes: {
      'r-plate': recipe('r-plate', 'Iron Plate', 'ore', 'plate'),
      'r-gear': recipe('r-gear', 'Gear', 'plate', 'gear'),
    },
    machines: {
      furnace: {
        id: 'furnace', name: 'Furnace', type: 'furnace', craftingSpeed: 1, energyUsageKw: 90, energyType: 'electric', drainKw: 0,
        moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['smelting'], iconPath: '', hidden: false,
      },
    },
    modules: {}, beacons: {}, defaultMachines: { smelting: 'furnace' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

const row = (id: string, recipeId: string): GameRecipeNode =>
  ({ kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} })

const sub = (id: string, name: string, nodes: SubPlan['nodes'], extra: Partial<SubPlan> = {}): SubPlan =>
  ({ id, name, nodes, subPlans: [], createdAt: '', updatedAt: '', ...extra }) as SubPlan

const solvedRow = (id: string, machines: number, powerKw: number, inputs: Record<string, number> = {}) => ({
  recipeNodeId: id, inputRates: inputs, outputRates: {}, throughput: 1, machineCountExact: machines, machineCountCeil: machines, powerKw,
})

let block: Block
const gd = makeGameData()

function setPlan(rootNodes: SubPlan['nodes'], subPlans: SubPlan[] = []) {
  const b = makeEmptyBlock('Test')
  block = { ...b, rootPlan: { ...b.rootPlan, nodes: rootNodes, subPlans } }
  useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {}, horizonTechnologyIds: [] })
}

function renderPanel(result?: SolverResult, over: Partial<{ blockId: string | undefined }> = {}) {
  return render(<SidePanel blockId={'blockId' in over ? over.blockId : block.id} rootPlan={block.rootPlan} result={result} gameData={gd} />)
}

const select = (nodeId: string, blockId = block.id) => useUiStore.setState({ selectedRow: { blockId, nodeId } })
const selected = () => useUiStore.getState().selectedRow

beforeEach(() => {
  useUiStore.setState({ selectedRow: null, panelHighlight: null, rateUnit: 'min' })
  useSolverStore.setState({ lastResults: {}, flows: [] })
})

describe('SidePanel — selection', () => {
  it('renders nothing while no row is selected', () => {
    setPlan([row('n1', 'r-plate')])
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the sections of a recipe row, in order, without the empty Effects table', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    renderPanel()
    const panel = screen.getByTestId('side-panel')
    expect(within(panel).getByTestId('panel-title')).toHaveTextContent('Iron Plate')
    expect(within(panel).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Rate', 'Machine', 'Beacons', 'Where inputs come from',
    ])
  })

  it('brings Effects on this row back once a module is set', () => {
    setPlan([{ ...row('n1', 'r-plate'), modules: [{ moduleId: 'speed-1', count: 1 }] }])
    select('n1')
    renderPanel()
    expect(within(screen.getByTestId('side-panel')).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Rate', 'Machine', 'Beacons', 'Effects on this row', 'Where inputs come from',
    ])
  })

  it('brings Effects on this row back once a beacon configuration is set', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    const { rerender } = renderPanel()
    expect(screen.queryByTestId('panel-effects')).not.toBeInTheDocument()
    act(() => {
      useBlockStore.getState().updateNodeBeacons('n1', [{ beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 1.5 }])
    })
    const b = useBlockStore.getState().blocks[0]
    rerender(<SidePanel blockId={b.id} rootPlan={b.rootPlan} result={undefined} gameData={gd} />)
    expect(screen.getByTestId('panel-effects')).toBeInTheDocument()
  })

  it('clears the selection with the close button', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    const { rerender } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(selected()).toBeNull()
    rerender(<SidePanel blockId={block.id} rootPlan={block.rootPlan} result={undefined} gameData={gd} />)
    expect(screen.queryByTestId('side-panel')).not.toBeInTheDocument()
  })

  it('ignores and clears a selection of a node that no longer exists', () => {
    setPlan([row('n1', 'r-plate')])
    select('gone')
    renderPanel()
    expect(screen.queryByTestId('side-panel')).not.toBeInTheDocument()
    expect(selected()).toBeNull()
  })

  it('ignores and clears a selection that belongs to another block', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1', 'other-block')
    renderPanel()
    expect(screen.queryByTestId('side-panel')).not.toBeInTheDocument()
    expect(selected()).toBeNull()
  })

  it('keeps the selection while the plan or block is momentarily undefined', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    const { rerender } = renderPanel()
    rerender(<SidePanel blockId={undefined} rootPlan={undefined} result={undefined} gameData={gd} />)
    expect(selected()).toEqual({ blockId: block.id, nodeId: 'n1' })
    rerender(<SidePanel blockId={block.id} rootPlan={block.rootPlan} result={undefined} gameData={gd} />)
    expect(screen.getByTestId('side-panel')).toBeInTheDocument()
  })

  it('swaps to another row when the selection changes', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    select('n1')
    const { rerender } = renderPanel()
    expect(screen.getByTestId('panel-title')).toHaveTextContent('Iron Plate')
    select('n2')
    rerender(<SidePanel blockId={block.id} rootPlan={block.rootPlan} result={undefined} gameData={gd} />)
    expect(screen.getByTestId('panel-title')).toHaveTextContent('Gear')
  })
})

describe('SidePanel — section highlight', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('highlights the requested section for a moment, then clears it', () => {
    setPlan([row('n1', 'r-plate')])
    useUiStore.getState().selectRowSection(block.id, 'n1', 'machine')
    renderPanel()
    expect(screen.getByTestId('panel-machine')).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId('panel-beacons')).not.toHaveAttribute('data-highlighted')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByTestId('panel-machine')).not.toHaveAttribute('data-highlighted')
    expect(useUiStore.getState().panelHighlight).toBeNull()
  })

  it('does not highlight a section for a different row than the one that asked', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    useUiStore.getState().selectRowSection(block.id, 'n1', 'machine')
    useUiStore.getState().selectRow(block.id, 'n2')
    renderPanel()
    expect(screen.getByTestId('panel-machine')).not.toHaveAttribute('data-highlighted')
    // Even if a stale highlight of the first row were still stored.
    useUiStore.setState({ panelHighlight: { seq: 99, blockId: block.id, nodeId: 'n1', section: 'machine' } })
    expect(screen.getByTestId('panel-machine')).not.toHaveAttribute('data-highlighted')
  })

  it('highlights the Beacons section', () => {
    setPlan([row('n1', 'r-plate')])
    useUiStore.getState().selectRowSection(block.id, 'n1', 'beacons')
    renderPanel()
    expect(screen.getByTestId('panel-beacons')).toHaveAttribute('data-highlighted', 'true')
  })
})

describe('SidePanel — sub-factories', () => {
  const nested = () => {
    const inner = sub('sp-inner', 'Inner', [row('n3', 'r-gear')])
    const outer = sub('sp-outer', 'Plates', [row('n1', 'r-plate'), row('n2', 'r-plate'), { kind: 'subplan', id: 'h-inner', subPlanId: 'sp-inner' }], { subPlans: [inner] })
    setPlan([{ kind: 'subplan', id: 'h-outer', subPlanId: 'sp-outer' }], [outer])
  }
  const result = (): SolverResult => ({
    nodes: [solvedRow('n1', 2, 180), solvedRow('n2', 1, 90), solvedRow('n3', 3, 270)],
    unsatisfied: [], warnings: [],
  })

  it('shows an organising sub-factory read only: level, totals and the rows inside it', () => {
    nested()
    select('h-outer')
    renderPanel(result())
    expect(screen.getByTestId('panel-title')).toHaveTextContent('Plates')
    expect(screen.getByText('Sub-factory · level 1 of 4')).toBeInTheDocument()
    expect(screen.getByTestId('group-recipes')).toHaveTextContent('3')
    expect(screen.getByTestId('group-machines')).toHaveTextContent('6')
    expect(screen.getByTestId('group-power-total')).toHaveTextContent('540.0 kW')
    expect(screen.getAllByTestId('group-child')).toHaveLength(3)
    expect(screen.queryByTestId('panel-area-receives')).not.toBeInTheDocument()
    expect(screen.getByText(/only organises rows/)).toBeInTheDocument()
  })

  it('selects a row or group below it from its button', () => {
    nested()
    select('h-outer')
    renderPanel(result())
    fireEvent.click(screen.getAllByTestId('group-child')[2])
    expect(selected()).toEqual({ blockId: block.id, nodeId: 'h-inner' })
  })

  it('shows a nested group at its level', () => {
    nested()
    select('h-inner')
    renderPanel(result())
    expect(screen.getByText('Sub-factory · level 2 of 4')).toBeInTheDocument()
  })

  it('shows a separate area with its subtitle and what it receives and sends', () => {
    const area = sub('sp-area', 'Oil', [row('n1', 'r-plate')], { area: true })
    setPlan([{ kind: 'subplan', id: 'h-area', subPlanId: 'sp-area' }, row('n2', 'r-gear')], [area])
    select('h-area')
    const res: SolverResult = {
      nodes: [solvedRow('n1', 1, 90), solvedRow('n2', 1, 90)], unsatisfied: [], warnings: [],
      areas: [
        { areaId: block.rootPlan.id, receives: [], sends: [] },
        { areaId: 'sp-area', receives: [{ itemId: 'ore', rate: 60, boundary: true }], sends: [{ itemId: 'plate', rate: 30, boundary: false }] },
      ],
      areaRoutes: [
        { itemId: 'ore', to: 'sp-area', rate: 60 },
        { itemId: 'plate', from: 'sp-area', to: block.rootPlan.id, rate: 30 },
      ],
    }
    renderPanel(res)
    expect(screen.getByText('Separate area · level 1 of 4')).toBeInTheDocument()
    const receives = screen.getByTestId('area-receives')
    expect(receives).toHaveTextContent('Iron Ore')
    expect(receives).toHaveTextContent('from outside the block')
    const sends = screen.getByTestId('area-sends')
    expect(sends).toHaveTextContent('Iron Plate')
    expect(sends).toHaveTextContent('to the rest of the block')
  })

  it('shows at most six entries of Receives and Sends and expands them on "Show all N"', () => {
    const area = sub('sp-area', 'Oil', [row('n1', 'r-plate')], { area: true })
    setPlan([{ kind: 'subplan', id: 'h-area', subPlanId: 'sp-area' }], [area])
    select('h-area')
    const ids = Array.from({ length: 9 }, (_, i) => `item-${i}`)
    const res: SolverResult = {
      nodes: [solvedRow('n1', 1, 90)], unsatisfied: [], warnings: [],
      areas: [
        { areaId: block.rootPlan.id, receives: [], sends: [] },
        { areaId: 'sp-area', receives: ids.map(itemId => ({ itemId, rate: 60, boundary: true })), sends: ids.slice(0, 6).map(itemId => ({ itemId, rate: 30, boundary: true })) },
      ],
      areaRoutes: [],
    }
    renderPanel(res)
    const receives = screen.getByTestId('area-receives')
    expect(within(receives).getAllByRole('listitem')).toHaveLength(6)
    // Exactly six entries need no button.
    expect(within(screen.getByTestId('area-sends')).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByTestId('area-sends-toggle')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all 9' }))
    expect(within(receives).getAllByRole('listitem')).toHaveLength(9)
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(within(receives).getAllByRole('listitem')).toHaveLength(6)
  })

  it('says so when an area has nothing to send or receive', () => {
    const area = sub('sp-area', 'Oil', [row('n1', 'r-plate')], { area: true })
    setPlan([{ kind: 'subplan', id: 'h-area', subPlanId: 'sp-area' }], [area])
    select('h-area')
    renderPanel({ nodes: [], unsatisfied: [], warnings: [], areas: [{ areaId: 'sp-area', receives: [], sends: [] }], areaRoutes: [] })
    expect(screen.getByTestId('area-receives-empty')).toBeInTheDocument()
    expect(screen.getByTestId('area-sends-empty')).toBeInTheDocument()
  })
})

describe('SidePanel — where inputs come from', () => {
  const result = (): SolverResult => ({
    nodes: [{ ...solvedRow('n2', 1, 90, { plate: 120 }), outputRates: { gear: 120 } }, { ...solvedRow('n1', 2, 180, { ore: 120 }), outputRates: { plate: 120 } }],
    unsatisfied: [], warnings: [],
  })
  /** The sentences read the block's latest solve from the solver store, as the app does. */
  const renderWithSolve = () => {
    useSolverStore.setState({ lastResults: { [block.id]: result() } })
    renderPanel(result())
  }
  const entry = (itemId: string) => screen.getAllByTestId('sourcing-entry').find(e => e.getAttribute('data-item-id') === itemId)!

  it('lists an entry per ingredient with the rate, the mode choice and a sentence built from the solve', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    select('n2')
    renderWithSolve()
    const e = entry('plate')
    expect(e).toHaveTextContent('Iron Plate')
    expect(e).toHaveTextContent('120/m')
    expect(within(e).getAllByRole('radio').map(r => r.textContent)).toEqual(['Make it here', "Only what's already made", 'Receive it first'])
    expect(within(e).getByRole('radio', { name: 'Make it here' })).toHaveAttribute('aria-checked', 'true')
    expect(within(e).getByTestId('sourcing-sentence')).toHaveTextContent('Made here by Iron Plate (2 × Furnace).')
  })

  it('sets the mode for the whole block and rewrites the sentence', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    select('n2')
    renderWithSolve()
    fireEvent.click(within(entry('plate')).getByRole('radio', { name: "Only what's already made" }))
    expect(useBlockStore.getState().blocks[0].itemSourcing.plate).toBe('byproducts-first')
    expect(within(entry('plate')).getByTestId('sourcing-sentence')).toHaveTextContent('No row here already makes Iron Plate, so Iron Plate covers it.')
  })

  it('disables the other choices for an item that is a product of the block, keeping Make it here', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, products: [{ id: 'p1', itemId: 'plate', extraRate: 10 }] })) }))
    select('n2')
    renderWithSolve()
    const e = entry('plate')
    expect(within(e).getByRole('radio', { name: "Only what's already made" })).toBeDisabled()
    expect(within(e).getByRole('radio', { name: 'Receive it first' })).toBeDisabled()
    expect(within(e).getByRole('radio', { name: "Only what's already made" })).toHaveAttribute('title', 'Iron Plate is a product of this block, so the block always makes it')
    expect(within(e).getByRole('radio', { name: 'Make it here' })).toBeEnabled()
  })

  it('toggles Forbid imports, disabled for an item no row makes', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    select('n2')
    renderWithSolve()
    fireEvent.click(within(entry('plate')).getByTestId('forbid-imports'))
    expect(useBlockStore.getState().blocks[0].noImportItems).toEqual(['plate'])
  })

  it('disables Forbid imports for a raw item with the reason', () => {
    setPlan([row('n1', 'r-plate'), row('n2', 'r-gear')])
    select('n1')
    renderWithSolve()
    const box = within(entry('ore')).getByTestId('forbid-imports')
    expect(box).toBeDisabled()
    expect(box.closest('label')).toHaveAttribute('title', expect.stringContaining('No recipe in this block makes Iron Ore'))
  })
})

describe('SidePanel — backdrop', () => {
  function Harness() {
    const [menu, setMenu] = useState(true)
    return (
      <>
        <SidePanel blockId={block.id} rootPlan={block.rootPlan} result={undefined} gameData={gd} />
        {menu && <RowActionsMenu x={10} y={10} actions={[{ label: 'Do it', onSelect: () => {} }]} onClose={() => setMenu(false)} />}
      </>
    )
  }
  const press = (el: Element, detail = 1) => {
    fireEvent.mouseDown(el)
    fireEvent.click(el, { detail })
  }

  it('closes the drawer when nothing else is open', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    renderPanel()
    press(screen.getByTestId('side-panel-backdrop'))
    expect(selected()).toBeNull()
  })

  it('only closes a row menu (which dismisses itself on mousedown) opened over the drawer, then closes the drawer on the next press', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    render(<Harness />)
    const backdrop = screen.getByTestId('side-panel-backdrop')
    press(backdrop)
    expect(screen.queryByText('Do it')).toBeNull()
    expect(selected()).not.toBeNull()
    press(backdrop)
    expect(selected()).toBeNull()
  })

  it('a keyboard click on the backdrop closes the drawer even after a swallowed press', () => {
    setPlan([row('n1', 'r-plate')])
    select('n1')
    render(<Harness />)
    const backdrop = screen.getByTestId('side-panel-backdrop')
    fireEvent.mouseDown(backdrop) // a press that never completes as a click on the backdrop (a drag ending elsewhere)
    fireEvent.click(backdrop, { detail: 0 })
    expect(selected()).toBeNull()
  })
})

describe('SidePanel — drawer focus', () => {
  const realMatchMedia = window.matchMedia
  function mockDrawer(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      matches, media: query, addEventListener: () => {}, removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
  }
  afterEach(() => { window.matchMedia = realMatchMedia })

  it('is a modal dialog that holds focus while it is a drawer', () => {
    mockDrawer(true)
    setPlan([row('n1', 'r-plate')])
    select('n1')
    renderPanel()
    const panel = screen.getByRole('dialog', { name: 'Row details' })
    expect(panel).toHaveAttribute('aria-modal', 'true')
    expect(panel).toHaveFocus()
  })

  it('is a plain region, not modal and not focused, when docked', () => {
    mockDrawer(false)
    setPlan([row('n1', 'r-plate')])
    select('n1')
    renderPanel()
    const panel = screen.getByTestId('side-panel')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(panel).not.toHaveAttribute('tabindex')
    expect(panel).not.toHaveFocus()
  })

  it('returns focus to the element that had it when the drawer closes', () => {
    mockDrawer(true)
    setPlan([row('n1', 'r-plate')])
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    select('n1')
    renderPanel()
    expect(screen.getByTestId('side-panel')).toHaveFocus()
    act(() => useUiStore.getState().clearSelectedRow())
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
