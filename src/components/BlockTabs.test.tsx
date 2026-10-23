import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, act } from '@testing-library/react'
import { BlockTabs } from './BlockTabs'
import { useBlockStore, makeEmptyBlock } from '../store/blockStore'
import { useGameDataStore } from '../store/gameDataStore'
import type { GameData } from '../data/types'

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
  useGameDataStore.setState({ status: { type: 'empty' } })
})

describe('BlockTabs editability', () => {
  it.each([
    ['empty', { type: 'empty' as const }],
    ['loading', { type: 'loading' as const }],
    ['error', { type: 'error' as const, message: 'boom' }],
  ])('is disabled while game data is %s', (_name, status) => {
    useGameDataStore.setState({ status })
    render(<BlockTabs />)
    expect(screen.getByTitle('Add block'), 'add button').toBeDisabled()
    expect(screen.getByTitle('Test'), 'block tab').toBeDisabled()
    expect(screen.getByTestId('block-tab'), 'not draggable').not.toHaveAttribute('draggable', 'true')
  })

  it('is enabled once game data is loaded', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<BlockTabs />)
    expect(screen.getByTitle('Add block')).toBeEnabled()
    expect(screen.getByTitle('Test')).toBeEnabled()
    expect(screen.getByTestId('block-tab'), 'draggable').toHaveAttribute('draggable', 'true')
  })
})

describe('BlockTabs context menu', () => {
  it('duplicates a block from the right-click menu', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('Test'))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(screen.getByTitle('Test')).toBeInTheDocument()
    expect(screen.getByTitle('Test (copy)')).toBeInTheDocument()
  })

  it('sets the block colour from a swatch and closes the menu', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('Gears', '#f472b6')
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: gears.id, history: {} })
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('Gears'))
    expect(screen.getByLabelText('Colour #f472b6')).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('[data-testid="block-color-swatch"][aria-checked="true"]')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Colour #a3e635'))
    const [first, second] = useBlockStore.getState().blocks
    expect(second.color).toBe('#a3e635')
    expect(first.color).toBe('#60a5fa')
    expect(screen.queryByRole('menu')).toBeNull()
    const stripe = screen.getByTitle('Gears').querySelector('[data-testid="block-tab-stripe"]') as HTMLElement
    expect(stripe.style.background).toBe('#a3e635')
  })
})

describe('BlockTabs tab look', () => {
  it('shows the block name under a stripe in the block colour, full strength when active', () => {
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('Gears', '#f472b6')
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: plates.id, history: {} })
    render(<BlockTabs />)
    const stripe = (name: string) =>
      screen.getByTitle(name).querySelector('[data-testid="block-tab-stripe"]') as HTMLElement
    expect(screen.getByTitle('Plates')).toHaveTextContent('Plates')
    expect(stripe('Plates').style.background, 'active').toBe('#60a5fa')
    expect(stripe('Gears').style.background, 'inactive').toBe('rgba(244, 114, 182, 0.55)')
  })
})

describe('BlockTabs reorder and overflow', () => {
  function seed() {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    const a = makeEmptyBlock('A', '#60a5fa')
    const b = makeEmptyBlock('B', '#f472b6')
    const c = makeEmptyBlock('C', '#a3e635')
    useBlockStore.setState({ blocks: [a, b, c], activeBlockId: a.id, history: {} })
    return { a, b, c }
  }
  const names = () => useBlockStore.getState().blocks.map(b => b.name)
  const tab = (name: string) => screen.getByTitle(name).closest('[data-testid="block-tab"]') as HTMLElement

  /** Give every tab a 100px-wide box at x = 0 so the pointer half is decided by clientX alone. */
  function stubRects() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 100, top: 0, bottom: 32, width: 100, height: 32, x: 0, y: 0, toJSON: () => ({}),
    })
  }

  /** happy-dom's DragEvent ignores `clientX` in its init dict, so set it on the event directly. */
  function dragAt(type: 'dragOver' | 'drop', el: HTMLElement, clientX: number) {
    const event = createEvent[type](el, { dataTransfer: new DataTransfer() })
    Object.defineProperty(event, 'clientX', { value: clientX })
    fireEvent(el, event)
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('moves a block left from the context menu and closes the menu', () => {
    const { a } = seed()
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('B'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }))
    expect(names()).toEqual(['B', 'A', 'C'])
    expect(useBlockStore.getState().activeBlockId, 'active unchanged').toBe(a.id)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables Move left on the first tab and Move right on the last', () => {
    seed()
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('A'))
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTitle('C'))
    expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeEnabled()
  })

  it('closes the menu on Escape and renders it outside the scrolling strip', () => {
    seed()
    render(<BlockTabs />)
    fireEvent.contextMenu(screen.getByTitle('B'))
    expect(screen.getByRole('menu').closest('[data-testid="block-tab-strip"]'), 'outside the strip').toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('reorders by dragging, showing a drop line on the pointer half', () => {
    const { a } = seed()
    stubRects()
    render(<BlockTabs />)
    fireEvent.dragStart(tab('C'), { dataTransfer: new DataTransfer() })
    dragAt('dragOver', tab('A'), 10)
    const line = screen.getByTestId('block-tab-drop-line')
    expect(line).toHaveAttribute('data-side', 'before')
    dragAt('drop', tab('A'), 10)
    fireEvent.dragEnd(tab('C'))
    expect(names()).toEqual(['C', 'A', 'B'])
    expect(useBlockStore.getState().activeBlockId, 'active unchanged').toBe(a.id)
    expect(screen.queryByTestId('block-tab-drop-line')).toBeNull()
  })

  it('shows no drop line where the drop would not move the tab', () => {
    seed()
    stubRects()
    render(<BlockTabs />)
    fireEvent.dragStart(tab('B'), { dataTransfer: new DataTransfer() })
    dragAt('dragOver', tab('A'), 90)
    expect(screen.queryByTestId('block-tab-drop-line')).toBeNull()
  })

  it('shows no "All blocks" menu while the strip does not overflow', () => {
    seed()
    render(<BlockTabs />)
    expect(screen.queryByTitle('All blocks')).toBeNull()
  })

  it('scrolls the strip by line-mode wheel deltas converted to pixels', () => {
    seed()
    render(<BlockTabs />)
    const strip = screen.getByTestId('block-tab-strip')
    strip.scrollLeft = 0
    fireEvent.wheel(strip, { deltaY: 3, deltaMode: 1 })
    expect(strip.scrollLeft).toBe(48)
  })

  it('makes the tab button fill its wrapper', () => {
    seed()
    render(<BlockTabs />)
    expect(screen.getByTitle('A')).toHaveClass('flex-1')
  })

  it('re-reveals the active tab after a reorder', () => {
    const { a } = seed()
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    render(<BlockTabs />)
    spy.mockClear()
    act(() => { useBlockStore.getState().moveBlock(a.id, 2) })
    expect(spy).toHaveBeenCalled()
  })
})
