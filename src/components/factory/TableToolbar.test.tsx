import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TableToolbar } from './TableToolbar'
import { useUiStore } from '../../store/uiStore'
import { makeEmptySubPlan, makeRecipeNode } from '../../store/blockStore'
import type { SolvedNode, SubPlan } from '../../data/types'

function solved(id: string, machines: number, powerKw: number): SolvedNode {
  return {
    recipeNodeId: id,
    inputRates: {},
    outputRates: {},
    throughput: 1,
    machineCountExact: machines,
    machineCountCeil: machines,
    powerKw,
  }
}

function planWithRecipes(count: number): SubPlan {
  const plan = makeEmptySubPlan('Main')
  return { ...plan, nodes: Array.from({ length: count }, () => makeRecipeNode('iron-plate')) }
}

function filterProps(over: Partial<{ query: string; onQueryChange: (q: string) => void; hidden: number; total: number }> = {}) {
  return { query: '', onQueryChange: vi.fn(), hidden: 0, total: 0, ...over }
}

describe('TableToolbar', () => {
  beforeEach(() => {
    useUiStore.setState({ rateUnit: 'min' })
  })

  it('shows the recipe, machine and power totals of the block', () => {
    render(
      <TableToolbar
        rootPlan={planWithRecipes(2)}
        solvedNodes={[solved('a', 3, 1500), solved('b', 1, 500)]}
        onAddRecipe={() => {}}
        filter={filterProps()}
      />,
    )
    expect(screen.getByTestId('block-recipe-count')).toHaveTextContent('2 recipes')
    expect(screen.getByTestId('block-machine-count')).toHaveTextContent('4 machines')
    const power = screen.getByTestId('block-power-total')
    expect(power).toHaveAccessibleName('Total power draw, 2.0 MW')
  })

  it('uses singular labels for one recipe and one machine', () => {
    render(<TableToolbar rootPlan={planWithRecipes(1)} solvedNodes={[solved('a', 1, 0)]} onAddRecipe={() => {}} filter={filterProps()} />)
    expect(screen.getByTestId('block-recipe-count')).toHaveTextContent('1 recipe')
    expect(screen.getByTestId('block-machine-count')).toHaveTextContent('1 machine')
  })

  it('shows no power total when nothing draws power', () => {
    render(<TableToolbar rootPlan={planWithRecipes(1)} solvedNodes={[solved('a', 1, 0)]} onAddRecipe={() => {}} filter={filterProps()} />)
    expect(screen.queryByTestId('block-power-total')).toBeNull()
  })

  it('calls onAddRecipe from the + Recipe button', () => {
    const onAddRecipe = vi.fn()
    render(<TableToolbar rootPlan={undefined} solvedNodes={[]} onAddRecipe={onAddRecipe} filter={filterProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recipe' }))
    expect(onAddRecipe).toHaveBeenCalledTimes(1)
  })

  it('shows the rate unit as a pressed segment and switches the store', () => {
    render(<TableToolbar rootPlan={undefined} solvedNodes={[]} onAddRecipe={() => {}} filter={filterProps()} />)
    const group = screen.getByRole('group', { name: 'Rate unit' })
    expect(within(group).getByRole('button', { name: '/min' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: '/sec' }))
    expect(useUiStore.getState().rateUnit).toBe('sec')
    expect(within(group).getByRole('button', { name: '/sec' })).toHaveAttribute('aria-pressed', 'true')
  })

  describe('filter', () => {
    const field = () => screen.getByRole('searchbox', { name: 'Filter recipes or items' })
    const renderWith = (filter: ReturnType<typeof filterProps>) =>
      render(<TableToolbar rootPlan={undefined} solvedNodes={[]} onAddRecipe={() => {}} filter={filter} />)

    it('reports typing through onQueryChange', () => {
      const filter = filterProps()
      renderWith(filter)
      fireEvent.change(field(), { target: { value: 'gear' } })
      expect(filter.onQueryChange).toHaveBeenCalledWith('gear')
    })

    it('shows the query it is given', () => {
      renderWith(filterProps({ query: 'iron' }))
      expect(field()).toHaveValue('iron')
    })

    it('reports the hidden rows while a query is set, and nothing without one', () => {
      const { unmount } = renderWith(filterProps({ query: 'x', hidden: 3, total: 10 }))
      expect(screen.getByTestId('table-filter-status')).toHaveTextContent('3 of 10 rows hidden')
      unmount()
      renderWith(filterProps({ query: '', hidden: 3, total: 10 }))
      expect(screen.queryByTestId('table-filter-status')).toBeNull()
    })

    it('clears the query from the Clear button', () => {
      const filter = filterProps({ query: 'x', hidden: 1, total: 2 })
      renderWith(filter)
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
      expect(filter.onQueryChange).toHaveBeenCalledWith('')
    })

    it('clears a non-empty query on Escape and ignores Escape on an empty one', () => {
      const filled = filterProps({ query: 'x' })
      const { unmount } = renderWith(filled)
      fireEvent.keyDown(field(), { key: 'Escape' })
      expect(filled.onQueryChange).toHaveBeenCalledWith('')
      unmount()
      const empty = filterProps()
      renderWith(empty)
      fireEvent.keyDown(field(), { key: 'Escape' })
      expect(empty.onQueryChange).not.toHaveBeenCalled()
    })
  })
})
