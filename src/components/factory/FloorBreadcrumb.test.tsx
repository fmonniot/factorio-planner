import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloorBreadcrumb } from './FloorBreadcrumb'
import { useUiStore } from '../../store/uiStore'
import { useBlockStore, makeEmptyBlock, makeEmptySubPlan } from '../../store/blockStore'

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    activeSubPlanId: block.rootPlan.id,
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min', activeFloorPath: [] })
})

describe('FloorBreadcrumb', () => {
  it('renders nothing at the top level (empty floor path)', () => {
    const { container } = render(<FloorBreadcrumb />)
    expect(container.firstChild).toBeNull()
  })

  it('shows Level 2 when one floor is pushed', () => {
    const child = makeEmptySubPlan('Ingredients floor')
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = { ...block.rootPlan, subPlans: [child] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    useUiStore.setState({ activeFloorPath: [child.id] })
    render(<FloorBreadcrumb />)
    expect(screen.getByText('Level 2')).toBeInTheDocument()
    expect(screen.getByText('Ingredients floor')).toBeInTheDocument()
  })

  it('clicking Up calls popFloor', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1'] })
    render(<FloorBreadcrumb />)
    fireEvent.click(screen.getByTitle('Go up one level'))
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })

  it('clicking Top calls resetFloor', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1', 'sp-2'] })
    render(<FloorBreadcrumb />)
    fireEvent.click(screen.getByTitle('Jump to top level'))
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })
})
