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
    h2: { id: 'h2', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false },
    o2: { id: 'o2', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false },
  },
  recipes: {},
  machines: {},
  beacons: {},
  modules: {},
  defaultMachines: {},
  technologies: {},
  startingRecipes: [],
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
const flow = (itemId: string) => ({ itemId, rate: 60, boundary: false })
const areasResult = (id: string): SolverResult => ({
  nodes: [], unsatisfied: [], warnings: [],
  areas: [
    { areaId: `${id}-root`, receives: [], sends: [flow('h2')] },
    { areaId: `${id}-p`, receives: [flow('h2')], sends: [] },
  ],
})

function setup(withAreas = true) {
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
    lastResults: withAreas
      ? { A: areasResult('A'), B: { nodes: [], unsatisfied: [], warnings: [] }, C: areasResult('C') }
      : { A: { nodes: [], unsatisfied: [], warnings: [] } },
  })
}

const section = (name: string) => screen.getByRole('region', { name })

describe('PlanAreasModal', () => {
  beforeEach(setup)

  it('lists the areas of the blocks that have some, with a footer for the others', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    expect(section('Alpha')).toBeInTheDocument()
    expect(section('Charlie')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Bravo' })).toBeNull()
    expect(within(section('Alpha')).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('4 areas in 2 blocks')).toBeInTheDocument()
    expect(screen.getByText('1 block without areas not listed')).toBeInTheDocument()
  })

  it('narrows the list with the filter', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'charlie' } })
    expect(screen.queryByRole('region', { name: 'Alpha' })).toBeNull()
    expect(section('Charlie')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter areas'), { target: { value: 'zzz' } })
    expect(screen.getByText('No area matches "zzz"')).toBeInTheDocument()
  })

  it('opens an area: switches block, back to the tree, reveals the handle and closes', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(within(section('Charlie')).getByTitle('Show Plastics in Charlie'))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
    expect(useUiStore.getState().tableView).toBe('tree')
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('h-c')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the top level without a reveal request', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(within(section('Charlie')).getByTitle('Show Top level in Charlie'))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
    expect(useUiStore.getState().revealRowRequest).toBeNull()
    expect(useUiStore.getState().tableView).toBe('recipe')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens a block from its heading', () => {
    const onClose = vi.fn()
    render(<PlanAreasModal gameData={gameData} onClose={onClose} />)
    fireEvent.click(screen.getByTitle('Open Charlie'))
    expect(useBlockStore.getState().activeBlockId).toBe('C')
    expect(onClose).toHaveBeenCalled()
  })

  it('shares the item selection between blocks', () => {
    render(<PlanAreasModal gameData={gameData} onClose={() => {}} />)
    const chip = (name: string) => within(section(name)).getAllByRole('button').filter(b => b.dataset.itemId === 'h2')
    fireEvent.click(chip('Alpha')[0])
    for (const c of [...chip('Alpha'), ...chip('Charlie')]) expect(c).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('PlanAreasButton', () => {
  it('opens the list when some block has areas', () => {
    setup()
    render(<PlanAreasButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Areas in every block' }))
    expect(section('Alpha')).toBeInTheDocument()
  })

  it('is not rendered when no block has areas', () => {
    setup(false)
    render(<PlanAreasButton />)
    expect(screen.queryByRole('button', { name: 'Areas in every block' })).toBeNull()
  })
})
