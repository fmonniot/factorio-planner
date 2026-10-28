import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlanAreasButton, PlanAreasModal } from './PlanAreas'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, SolverResult, SubPlan } from '../../data/types'

const gameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    h2: { id: 'h2', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false, subgroup: 'fluids', order: '' },
    o2: { id: 'o2', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false, subgroup: 'fluids', order: '' },
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [
      `p${i}`, { id: `p${i}`, name: `Part ${i}`, type: 'item', iconPath: '', hidden: false, subgroup: 'parts', order: '' },
    ])),
  },
  recipes: {},
  machines: {},
  beacons: {},
  modules: {},
  defaultMachines: {},
  technologies: {},
  startingRecipes: [],
  itemGroups: {
    logistics: { id: 'logistics', name: 'Logistics', order: 'a', iconPath: '' },
    intermediates: { id: 'intermediates', name: 'Intermediates', order: 'b', iconPath: '' },
  },
  itemSubgroups: {
    fluids: { id: 'fluids', group: 'logistics', order: '' },
    parts: { id: 'parts', group: 'intermediates', order: '' },
  },
} as unknown as GameData

function plan(id: string, nodes: SubPlan['nodes'] = [], subPlans: SubPlan[] = []): SubPlan {
  return { id, name: id, nodes, subPlans, createdAt: '', updatedAt: '' }
}
function areaBlock(id: string, name: string, areaName: string, handleId: string): Block {
  const sub = { ...plan(`${id}-p`), name: areaName, area: true }
  return {
    ...makeEmptyBlock(name), id, color: '#abcdef',
    rootPlan: plan(`${id}-root`, [{ kind: 'subplan', id: handleId, subPlanId: sub.id }], [sub]),
  }
}
const flow = (itemId: string, rate = 60) => ({ itemId, rate, boundary: false })
const areasResult = (id: string, extra: string[] = []): SolverResult => ({
  nodes: [], unsatisfied: [], warnings: [],
  areas: [
    { areaId: `${id}-root`, receives: [], sends: [flow('h2'), ...extra.map(e => flow(e, 5))] },
    { areaId: `${id}-p`, receives: [flow('h2'), ...extra.map(e => flow(e, 5))], sends: [] },
  ],
})

function setup(withAreas = true, extra: string[] = []) {
  useBlockStore.setState({
    blocks: [
      areaBlock('A', 'Alpha', 'Plastics', 'h-a'),
      { ...makeEmptyBlock('Bravo'), id: 'B' },
      areaBlock('C', 'Charlie', 'Plastics', 'h-c'),
    ],
    activeBlockId: 'A',
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min', tableView: 'recipe', revealRowRequest: null })
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
  useSolverStore.setState({
    flows: [],
    lastResults: withAreas
      ? { A: areasResult('A', extra), B: { nodes: [], unsatisfied: [], warnings: [] }, C: areasResult('C') }
      : { A: { nodes: [], unsatisfied: [], warnings: [] } },
  })
}

const group = (name: string) => within(screen.getByRole('group', { name: 'Block' })).getByRole('button', { name: new RegExp(`^${name}`) })
const table = (block: string) => screen.getByRole('table', { name: `Areas of ${block}` })
const colNames = () => within(table('Alpha')).getAllByRole('columnheader').map(h => h.textContent)

describe('PlanAreasModal', () => {
  beforeEach(() => setup())

  it('opens on the active block, with a tab per block that has areas plus All blocks', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const tabs = within(screen.getByRole('group', { name: 'Block' })).getAllByRole('button')
    expect(tabs.map(t => t.textContent)).toEqual(['Alpha2', 'Charlie2', 'All blocks'])
    expect(group('Alpha')).toHaveAttribute('aria-pressed', 'true')
    expect(table('Alpha')).toBeInTheDocument()
    expect(screen.getByText('1 block without areas')).toBeInTheDocument()
  })

  it('shows the areas as columns between the two outside columns', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    expect(colNames()).toEqual(['1 item \u00B7 1 group', 'From outside', 'Top level0 rows', 'Plastics0 rows', 'To outside'])
  })

  it('shows a rate in the chosen unit', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const row = table('Alpha').querySelector('tr[data-item-id="h2"]')!
    expect(row.querySelector('td[data-col="A-root"]')).toHaveTextContent('+1.00')
    expect(row.querySelector('td[data-col="A-p"]')).toHaveTextContent('−1.00')
  })

  it('collapses and expands a group', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: /^Logistics/ })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(table('Alpha').querySelector('tr[data-item-id="h2"]')).not.toBeNull()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(table('Alpha').querySelector('tr[data-item-id="h2"]')).toBeNull()
  })

  it('folds small rows into a tail that opens on demand', () => {
    setup(true, Array.from({ length: 9 }, (_, i) => `p${i}`))
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: /^\+ 2 more/ }))
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(9)
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('narrows to the matching area column', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'plastics' } })
    expect(colNames().some(n => n?.startsWith('Plastics'))).toBe(true)
    expect(colNames().some(n => n?.startsWith('Top level'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'zzz' } })
    expect(screen.getByText('No area or item matches "zzz"')).toBeInTheDocument()
  })

  it('treats a query naming the block as matching all of its areas', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'alph' } })
    expect(colNames().some(n => n?.startsWith('Top level'))).toBe(true)
    expect(colNames().some(n => n?.startsWith('Plastics'))).toBe(true)
    expect(table('Alpha').querySelector('tr[data-item-id="h2"]')).not.toBeNull()
  })

  it('words the footer for the view', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    expect(screen.getByText(/Each row balances/)).toBeInTheDocument()
    fireEvent.click(group('All blocks'))
    expect(screen.queryByText(/Each row balances/)).toBeNull()
    expect(screen.getByText(/Not taken and Not supplied/)).toBeInTheDocument()
  })

  it('focuses an area from its header and shows its panel', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const header = within(table('Alpha')).getByRole('button', { name: 'Plastics' })
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.getByRole('complementary', { name: 'Plastics' })
    expect(within(panel).getByText(/Area in Alpha/)).toBeInTheDocument()
    expect(table('Alpha').querySelector('tr[data-item-id="h2"] td[data-col="A-root"]')).toHaveAttribute('data-counterpart', 'true')
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop focusing Plastics' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens an area: switches block, back to the tree, reveals the handle and closes', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(group('Charlie'))
    fireEvent.click(within(table('Charlie')).getByRole('button', { name: 'Plastics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in table' }))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
    expect(useUiStore.getState().tableView).toBe('tree')
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('h-c')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the top level without a reveal request', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(group('Charlie'))
    fireEvent.click(within(table('Charlie')).getByRole('button', { name: 'Top level' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in table' }))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
    expect(useUiStore.getState().revealRowRequest).toBeNull()
    expect(useUiStore.getState().tableView).toBe('recipe')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows every block with the crossing filter on', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(group('All blocks'))
    expect(screen.getByRole('checkbox', { name: 'Only items that cross a block boundary' })).toBeChecked()
    expect(screen.getByText('No item crosses a block boundary.')).toBeInTheDocument()
  })

  it('says why All blocks is empty, by filter and by query', () => {
    const quiet = (id: string): SolverResult => ({
      nodes: [{ recipeNodeId: 'n', inputRates: {}, outputRates: {}, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0 }],
      unsatisfied: [], warnings: [],
      areas: [{ areaId: `${id}-root`, receives: [], sends: [] }, { areaId: `${id}-p`, receives: [], sends: [] }],
    })
    useSolverStore.setState({ lastResults: { A: quiet('A'), C: quiet('C') } })
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(group('All blocks'))
    expect(screen.getByText('No item crosses a block boundary.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only items that cross a block boundary' }))
    expect(screen.queryByText('No item crosses a block boundary.')).toBeNull()
    expect(screen.getByText('No item moves in or out of a block.')).toBeInTheDocument()
  })

  it('shows a message when a query matches a block that has no rows', () => {
    // Alpha moves hydrogen; Charlie has a solve but moves nothing.
    useSolverStore.setState({
      lastResults: {
        ...useSolverStore.getState().lastResults,
        C: {
          nodes: [{ recipeNodeId: 'n', inputRates: {}, outputRates: {}, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0 }],
          unsatisfied: [], warnings: [],
          areas: [{ areaId: 'C-root', receives: [], sends: [] }, { areaId: 'C-p', receives: [], sends: [] }],
        },
        A: {
          ...useSolverStore.getState().lastResults.A,
          nodes: [{ recipeNodeId: 'n', inputRates: {}, outputRates: { h2: 60 }, throughput: 1, machineCountExact: 1, machineCountCeil: 1, powerKw: 0 }],
        },
      },
    })
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(group('All blocks'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only items that cross a block boundary' }))
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'charlie' } })
    expect(screen.getByText('Nothing to show for these blocks.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Items across blocks' })).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PlanAreasButton', () => {
  it('opens the matrix when some block has areas', () => {
    setup()
    render(<PlanAreasButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Areas in every block' }))
    expect(table('Alpha')).toBeInTheDocument()
  })

  it('is not rendered when no block has areas', () => {
    setup(false)
    render(<PlanAreasButton />)
    expect(screen.queryByRole('button', { name: 'Areas in every block' })).toBeNull()
  })
})
