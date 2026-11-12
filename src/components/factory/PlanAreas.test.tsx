import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { PlanAreasButton, PlanAreasModal } from './PlanAreas'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
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
    ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [
      `q${i}`, { id: `q${i}`, name: `Widget ${i}`, type: 'item', iconPath: '', hidden: false, subgroup: 'widgets', order: '' },
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
    production: { id: 'production', name: 'Production', order: 'c', iconPath: '' },
  },
  itemSubgroups: {
    widgets: { id: 'widgets', group: 'production', order: '' },
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
  areaRoutes: [
    { itemId: 'h2', from: `${id}-root`, to: `${id}-p`, rate: 60 },
    ...extra.map(e => ({ itemId: e, from: `${id}-root`, to: `${id}-p`, rate: 5 })),
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
  useUiStore.setState({ rateUnit: 'min', revealRowRequest: null })
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

  it('starts every group open, even with many rows', () => {
    setup(true, ['p0', ...Array.from({ length: 45 }, (_, i) => `q${i}`)])
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const groups = ['Logistics', 'Intermediates', 'Production']
    for (const name of groups) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-expanded', 'true')
    }
  })

  it('shows the rows of a tail by default, with no "+ N more" button', () => {
    setup(true, Array.from({ length: 9 }, (_, i) => `p${i}`))
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(9)
    expect(screen.queryByRole('button', { name: /^\+ \d+ more/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('folds the tail on demand and reopens it', () => {
    setup(true, Array.from({ length: 9 }, (_, i) => `p${i}`))
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(7)
    const more = screen.getByRole('button', { name: /^\+ 2 more/ })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Show fewer' })).toBeNull()
    fireEvent.click(more)
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(9)
    expect(screen.queryByRole('button', { name: /^\+ \d+ more/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
  })

  it('folds the tail of one group without touching the others', () => {
    setup(true, [...Array.from({ length: 9 }, (_, i) => `p${i}`), ...Array.from({ length: 10 }, (_, i) => `q${i}`)])
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const fewer = screen.getAllByRole('button', { name: 'Show fewer' })
    expect(fewer).toHaveLength(2)
    fireEvent.click(fewer[0])
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(7)
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="q"]')).toHaveLength(10)
    expect(screen.getAllByRole('button', { name: 'Show fewer' })).toHaveLength(1)
  })

  it('keeps a folded tail folded when the plan is solved again', () => {
    setup(true, Array.from({ length: 9 }, (_, i) => `p${i}`))
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    act(() => {
      useSolverStore.setState({
        lastResults: { ...useSolverStore.getState().lastResults, A: areasResult('A', [...Array.from({ length: 9 }, (_, i) => `p${i}`), 'q0']) },
      })
    })
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(7)
    expect(table('Alpha').querySelector('tr[data-item-id="q0"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /^\+ 2 more/ })).toBeInTheDocument()
  })

  it('shows every matching row while filtering, and restores the tail after', () => {
    setup(true, Array.from({ length: 9 }, (_, i) => `p${i}`))
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'part' } })
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(9)
    expect(screen.queryByRole('button', { name: /more|Show fewer/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: '' } })
    expect(table('Alpha').querySelectorAll('tr[data-item-id^="p"]')).toHaveLength(7)
    expect(screen.getByRole('button', { name: /^\+ 2 more/ })).toBeInTheDocument()
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
    const counterpart = table('Alpha').querySelector('tr[data-item-id="h2"] td[data-col="A-root"]')!
    expect(counterpart).toHaveAttribute('data-counterpart', 'true')
    const tip = counterpart.querySelector('[title]')?.getAttribute('title') ?? counterpart.getAttribute('title') ?? ''
    expect(tip).toContain('Areas higher in the table supply first; an area with its own row for the item is served before the others.')
    expect(tip).not.toContain('allocated')
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop focusing Plastics' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens an area: switches block, reveals the handle and closes', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(group('Charlie'))
    fireEvent.click(within(table('Charlie')).getByRole('button', { name: 'Plastics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in table' }))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
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

describe('PlanAreasModal — source rule marker', () => {
  /** Game data with a recipe that makes Hydrogen, and a row for it in `blockId`, so Import off on Hydrogen has an effect there. */
  const dataWithMaker = (): GameData => ({
    ...gameData,
    recipes: {
      'h2-synth': {
        id: 'h2-synth', name: 'Hydrogen synthesis', category: 'crafting', craftingTime: 1, ingredients: [],
        products: [{ itemId: 'h2', type: 'fluid', amount: 1 }], madeIn: [], allowProductivity: false, hidden: false,
      },
    },
  }) as unknown as GameData
  function lockHydrogen(blockId: string, withRow = true) {
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => b.id !== blockId ? b : {
        ...b,
        sourceRules: { 'h2': { importOff: true as const } },
        rootPlan: withRow ? { ...b.rootPlan, nodes: [...b.rootPlan.nodes, makeRecipeNode('h2-synth')] } : b.rootPlan,
      }),
    }))
  }
  const markers = () => screen.queryAllByTestId('source-rule-marker')
  const row = (block: string, itemId: string) => table(block).querySelector(`tr[data-item-id="${itemId}"]`) as HTMLElement

  beforeEach(() => {
    setup(true, ['o2'])
    useUiStore.setState({ ingredientSlotRequest: null })
  })

  it('is on the row header of the item, in the matrix of the block that holds the rule only', () => {
    const data = dataWithMaker()
    lockHydrogen('A')
    render(<PlanAreasModal gameData={data} onClose={() => {}} />)
    expect(markers()).toHaveLength(1)
    const marker = within(within(row('Alpha', 'h2')).getByRole('rowheader')).getByTestId('source-rule-marker')
    expect(marker).toHaveAttribute('data-item-id', 'h2')
    // The sentence of the item in that block.
    expect(marker).toHaveAccessibleName(/^Made here by Hydrogen synthesis .* Import is off\.$/)
    expect(marker).toHaveAttribute('title', marker.getAttribute('aria-label')!)
    expect(within(row('Alpha', 'o2')).queryByTestId('source-rule-marker')).toBeNull()

    // Charlie moves hydrogen between its areas too and has no rule.
    fireEvent.click(group('Charlie'))
    expect(row('Charlie', 'h2')).not.toBeNull()
    expect(markers()).toHaveLength(0)
    fireEvent.click(group('All blocks'))
    expect(markers()).toHaveLength(0)
  })

  it('only shows the rule, also in the matrix of the active block: a click opens nothing and the matrix stays', () => {
    const onClose = vi.fn()
    lockHydrogen('A')
    render(<PlanAreasModal gameData={dataWithMaker()} onClose={onClose} />)
    const marker = screen.getByTestId('source-rule-marker')
    expect(marker.tagName).toBe('SPAN')
    expect(marker).toHaveAttribute('role', 'img')
    fireEvent.click(marker)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('only shows the rule in the matrix of a block that is not the active one', () => {
    const onClose = vi.fn()
    lockHydrogen('C')
    render(<PlanAreasModal gameData={dataWithMaker()} onClose={onClose} />)
    expect(markers(), 'Alpha, the active block, has no rule').toHaveLength(0)
    fireEvent.click(group('Charlie'))
    const marker = within(row('Charlie', 'h2')).getByTestId('source-rule-marker')
    expect(marker.tagName).toBe('SPAN')
    expect(marker).toHaveAttribute('role', 'img')
    expect(marker).toHaveAccessibleName(/Import is off\.$/)
    fireEvent.click(marker)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is absent for the default and for a rule with no effect', () => {
    render(<PlanAreasModal gameData={dataWithMaker()} onClose={() => {}} />)
    expect(markers()).toHaveLength(0)
    // No row of Alpha makes hydrogen: the lock is stored and has no effect.
    act(() => lockHydrogen('A', false))
    expect(row('Alpha', 'h2')).not.toBeNull()
    expect(markers()).toHaveLength(0)
  })
})
