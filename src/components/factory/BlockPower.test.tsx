import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BlockGraphButton } from './BlockGraph'
import { BlockGraphModal } from '../lazyModals'
import { useBlockStore, makeEmptyBlock, makeEmptySubPlan } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, RecipeNode, SolvedNode, SolverResult, SubPlan } from '../../data/types'

// The modal's code is a chunk of its own; fetch it once so each test renders it synchronously.
beforeAll(() => BlockGraphModal.preload())

const recipeIds = ['gear', 'stick', 'plate', 'acid', 'engine']
const gameData = {
  factorioVersion: '2.0.0', modSet: {},
  items: { x: { id: 'x', name: 'X', type: 'item', iconPath: 'x.png', hidden: false }, 'power:electricity': { id: 'power:electricity', name: 'Electricity', type: 'item', hidden: false } },
  recipes: Object.fromEntries(recipeIds.map(id => [id, { id, name: `R-${id}`, products: [{ itemId: 'x', amount: 1 }], ingredients: [], time: 1, category: 'c' }])),
  machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [], itemGroups: {}, itemSubgroups: {},
} as unknown as GameData

const rec = (recipeId: string): RecipeNode => ({ kind: 'game-recipe', id: `n-${recipeId}`, recipeId, modules: [], byproductPolicy: {} })

function plan(name: string, recipes: string[], subs: SubPlan[] = []): SubPlan {
  const p = makeEmptySubPlan(name)
  p.nodes = [...recipes.map(rec), ...subs.map(s => ({ kind: 'subplan' as const, id: `g-${s.id}`, subPlanId: s.id }))]
  p.subPlans = subs
  return p
}

const solved = (recipeId: string, powerKw: number, machines: number, electricityKw = 0): SolvedNode => ({
  recipeNodeId: `n-${recipeId}`, powerKw, machineCountCeil: machines, machineCountExact: machines, throughput: 1,
  inputRates: {}, outputRates: electricityKw ? { 'power:electricity': electricityKw * 60 / 1000 } : {}, beaconPowerKw: 0,
} as SolvedNode)

/**
 * Gears 6400 kW: group Iron 5400 (gear 5000 with 4 machines, stick 400) and loose plate 1000. Chem 1200 kW (acid).
 * Plant draws nothing and makes `generationKw`. Demand is 7600 kW.
 */
function setup(opts: { generationKw?: number; extra?: Block[]; results?: Record<string, SolverResult>; errors?: Record<string, string>; warn?: boolean } = {}) {
  const gearsPlan = plan('Main', ['plate'], [plan('Iron', ['gear', 'stick'])])
  const gears: Block = { ...makeEmptyBlock('Gears'), id: 'gears', color: '#111111', rootPlan: gearsPlan, products: [{ id: 'p1', itemId: 'x' }] }
  const chem: Block = { ...makeEmptyBlock('Chem'), id: 'chem', color: '#222222', rootPlan: plan('Main', ['acid']) }
  const plant: Block = { ...makeEmptyBlock('Plant'), id: 'plant', color: '#333333', rootPlan: plan('Main', ['engine']) }
  const results: Record<string, SolverResult> = opts.results ?? {
    gears: { nodes: [solved('plate', 1000, 2), solved('gear', 5000, 4), solved('stick', 400, 1)], unsatisfied: [], warnings: opts.warn ? [{ type: 'unbounded-absorber', recipeIds: [] }] : [] },
    chem: { nodes: [solved('acid', 1200, 3)], unsatisfied: [], warnings: [] },
    plant: { nodes: [solved('engine', 0, 2, opts.generationKw ?? 5200)], unsatisfied: [], warnings: [] },
  }
  useBlockStore.setState({ blocks: [plant, gears, chem, ...(opts.extra ?? [])], activeBlockId: 'gears', history: {} })
  useUiStore.setState({ rateUnit: 'min', blockGraphView: 'graph', blockMatrixOrder: 'dependency' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
  useSolverStore.setState({ lastResults: results, lastErrors: opts.errors ?? {}, flows: [], loops: [], requestLoops: [], _setStatus: () => {} })
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Factory overview' }))
const openPower = () => { open(); fireEvent.click(screen.getByRole('button', { name: 'Power' })) }
const rows = () => screen.getAllByTestId('power-row')
const labels = () => rows().map(r => r.getAttribute('data-key') && `${r.getAttribute('data-kind')}:${within(r).queryAllByText(/^(Gears|Chem|Plant|Iron|R-\w+)$/)[0]?.textContent}`)
const row = (kind: string, name: string) =>
  rows().find(r => r.getAttribute('data-kind') === kind && within(r).queryByText(name) !== null)!
const toLines = () => fireEvent.click(screen.getByRole('button', { name: 'By recipe' }))

describe('BlockPower', () => {
  beforeEach(() => {
    useGameDataStore.setState({ status: { type: 'empty' } })
  })

  it('links a block row to its areas, for a block that has some', () => {
    setup()
    const results = useSolverStore.getState().lastResults
    useSolverStore.setState({ lastResults: { ...results, gears: { ...results.gears, areas: [] } } })
    render(<BlockGraphButton />)
    openPower()
    expect(screen.getAllByTestId('power-row-areas')).toHaveLength(1)
    expect(within(row('block', 'Chem')).queryByTestId('power-row-areas')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Areas of Gears' }))
    expect(useUiStore.getState().blockGraphView).toBe('areas')
    expect(screen.getByTestId('areas-view')).toBeTruthy()
    expect(screen.getByTestId('block-picker')).toHaveTextContent('Gears')
  })

  it('adds a Power pill that stores the view and replaces the graph', () => {
    setup()
    render(<BlockGraphButton />)
    open()
    expect(screen.getByRole('button', { name: 'Power' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(useUiStore.getState().blockGraphView).toBe('power')
    expect(screen.getByTestId('power-view')).toBeTruthy()
    expect(screen.queryByTestId('block-graph-viewport')).toBeNull()
    expect(screen.queryByTestId('graph-legend-back')).toBeNull()
  })

  it('opens in the stored view', () => {
    setup()
    useUiStore.setState({ blockGraphView: 'power' })
    render(<BlockGraphButton />)
    open()
    expect(screen.getByTestId('power-view')).toBeTruthy()
  })

  it('shows demand, generation and the three forms of the balance', () => {
    setup()
    const { unmount } = render(<BlockGraphButton />)
    openPower()
    expect(screen.getByTestId('power-demand').textContent).toBe('7.6MW')
    expect(screen.getByTestId('power-generation').textContent).toBe('5.2MW')
    expect(screen.getByTestId('power-balance')).toHaveAttribute('data-status', 'short')
    expect(screen.getByTestId('power-balance').textContent).toBe('2.4MW short')
    unmount()
    setup({ generationKw: 8800 })
    render(<BlockGraphButton />)
    openPower()
    expect(screen.getByTestId('power-balance').textContent).toBe('+1.2MW spare')
    expect(screen.getByTestId('power-balance')).toHaveAttribute('data-status', 'spare')
  })

  it('reads Balanced when demand is met', () => {
    setup({ generationKw: 7600 })
    render(<BlockGraphButton />)
    openPower()
    expect(screen.getByTestId('power-balance').textContent).toBe('Balanced')
    expect(screen.queryByTestId('power-gauge-short')).toBeNull()
    expect(screen.queryByTestId('power-gauge-spare')).toBeNull()
  })

  it('lists blocks by power, every row collapsed', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    expect(labels()).toEqual(['block:Gears', 'block:Chem', 'block:Plant'])
    fireEvent.click(screen.getByRole('button', { name: 'Expand Gears' }))
    expect(labels()).toEqual(['block:Gears', 'group:Iron', 'recipe:R-plate', 'block:Chem', 'block:Plant'])
    expect(row('block', 'Gears').textContent).toContain('84.2%')
    expect(row('block', 'Plant').textContent).toContain('–')
    expect(row('block', 'Plant').className).toContain('opacity-60')
    expect(row('group', 'Iron').textContent).toContain('71.1%')
  })

  it('expands a group to depth 2 and collapses a block', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Gears' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Iron' }))
    expect(labels().slice(0, 5)).toEqual(['block:Gears', 'group:Iron', 'recipe:R-gear', 'recipe:R-stick', 'recipe:R-plate'])
    expect((within(row('recipe', 'R-gear')).getByText('R-gear').parentElement as HTMLElement).style.paddingLeft).toBe('36px')
    expect(row('recipe', 'R-gear')).toHaveAttribute('data-power-kw', '5000')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Gears' }))
    expect(labels()).toEqual(['block:Gears', 'block:Chem', 'block:Plant'])
  })

  it('keeps the open rows across views and starts collapsed again when the modal reopens', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Gears' }))
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(labels()).toEqual(['block:Gears', 'group:Iron', 'recipe:R-plate', 'block:Chem', 'block:Plant'])
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    open()
    expect(labels()).toEqual(['block:Gears', 'block:Chem', 'block:Plant'])
  })

  it('shows the loop status in the Graph header only', () => {
    setup()
    useSolverStore.setState({ loops: [{ blockIds: ['gears', 'chem'], connectionIds: [], backConnectionIds: [], converged: true, rounds: 1 }] })
    render(<BlockGraphButton />)
    open()
    expect(screen.getByTestId('graph-loop-status').textContent).toBe('↻ 1 loop')
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    expect(screen.queryByTestId('graph-loop-status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(screen.queryByTestId('graph-loop-status')).toBeNull()
    expect(screen.getByTestId('power-figures')).toBeTruthy()
  })

  it('sizes the weight bars against the biggest block', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    const fill = (r: HTMLElement) => (r.querySelector('span.rounded > span') as HTMLElement).style.width
    expect(fill(row('block', 'Gears'))).toBe('100%')
    expect(parseFloat(fill(row('block', 'Chem')))).toBeCloseTo(18.75)
  })

  it('lists the recipes that draw power by recipe, with the block chip', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    toLines()
    expect(rows().map(r => within(r).getAllByText(/^R-/)[0].textContent)).toEqual(['R-gear', 'R-acid', 'R-plate', 'R-stick'])
    expect(within(rows()[0]).getByText('Gears')).toBeTruthy()
    expect(screen.queryByText('R-engine')).toBeNull()
  })

  it('filters by recipe or block, and says when nothing matches', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    toLines()
    const input = screen.getByTestId('power-filter')
    fireEvent.change(input, { target: { value: 'ACI' } })
    expect(rows()).toHaveLength(1)
    fireEvent.change(input, { target: { value: 'gears' } })
    expect(rows()).toHaveLength(3)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.queryAllByTestId('power-row')).toHaveLength(0)
    expect(screen.getByText('No recipe or block matches what you typed.')).toBeTruthy()
  })

  it('clears the filter on Escape and closes the modal on the next one', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    toLines()
    const input = screen.getByTestId('power-filter')
    fireEvent.change(input, { target: { value: 'gear' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(screen.getByTestId('power-view')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('power-view')).toBeNull()
  })

  it('says which blocks are not counted and marks an unreliable one', () => {
    setup({ warn: true, extra: [{ ...makeEmptyBlock('Fresh'), id: 'fresh' }, { ...makeEmptyBlock('Bad'), id: 'bad' }], errors: { bad: 'boom' } })
    render(<BlockGraphButton />)
    openPower()
    expect(screen.getByTestId('power-skipped').textContent).toBe('Not counted (no solve result): Fresh, Bad (solve failed)')
    expect(within(row('block', 'Gears')).getByTestId('power-unreliable')).toBeTruthy()
    expect(within(row('block', 'Chem')).queryByTestId('power-unreliable')).toBeNull()
  })

  it('marks an unreliable block on its By recipe rows and its gauge segment', () => {
    setup({ warn: true })
    render(<BlockGraphButton />)
    openPower()
    expect(within(screen.getByTestId('power-gauge')).getAllByTestId('power-gauge-segment')[0].getAttribute('data-tip')).toContain('not reliable')
    expect(within(screen.getByTestId('power-gauge')).getAllByTestId('power-gauge-segment')[1].getAttribute('data-tip')).not.toContain('not reliable')
    toLines()
    const lines = rows()
    expect(lines.filter(r => within(r).queryByTestId('power-unreliable') !== null).map(r => r.getAttribute('data-block-id'))).toEqual(['gears', 'gears', 'gears'])
    expect(lines.filter(r => r.getAttribute('data-block-id') === 'chem')).toHaveLength(1)
  })

  it('gives every cell of a row the cell role', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    expect(within(rows()[0]).getAllByRole('cell')).toHaveLength(5)
  })

  it('draws the gauge: a segment per block that draws power, and the shortfall', () => {
    setup()
    render(<BlockGraphButton />)
    openPower()
    const gauge = screen.getByTestId('power-gauge')
    expect(gauge).toHaveAttribute('aria-label', 'Demand 7.6MW, generation 5.2MW, 2.4MW short')
    expect(within(gauge).getAllByTestId('power-gauge-segment').map(s => s.getAttribute('data-block-id'))).toEqual(['gears', 'chem'])
    expect(screen.getByTestId('power-gauge-short')).toBeTruthy()
    expect(screen.queryByTestId('power-gauge-spare')).toBeNull()
    expect(parseFloat((screen.getByTestId('power-gauge-line') as HTMLElement).style.bottom)).toBeCloseTo((7600 / (7600 * 1.06)) * 100)
  })

  it('draws the spare box when generation exceeds demand', () => {
    setup({ generationKw: 8800 })
    render(<BlockGraphButton />)
    openPower()
    expect(screen.getByTestId('power-gauge-spare')).toBeTruthy()
    expect(screen.queryByTestId('power-gauge-short')).toBeNull()
  })

  it('uses no native title attribute', () => {
    setup({ warn: true })
    render(<BlockGraphButton />)
    openPower()
    expect(document.querySelectorAll('[title]')).toHaveLength(0)
  })
})
