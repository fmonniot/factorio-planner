import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, act } from '@testing-library/react'
import { BlockTabs, AddBlockButton } from './BlockTabs'
import { useBlockStore, makeEmptyBlock } from '../store/blockStore'
import { useGameDataStore } from '../store/gameDataStore'
import type { GameData } from '../data/types'
import { BLOCK_PALETTE } from '../data/blockColors'

/** A tab's button, by block name (the accessible name; an inactive tab shows no text). */
const tabBtn = (name: string) => document.querySelector<HTMLElement>(`[data-testid="block-tab"] button[aria-label="${name}"]`)!

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
    render(<><BlockTabs /><AddBlockButton /></>)
    expect(screen.getByRole('button', { name: 'Add block' }), 'add button').toBeDisabled()
    expect(screen.getByRole('button', { name: 'All blocks' }), 'block list').toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test' }), 'block tab').toBeDisabled()
    expect(screen.getByTestId('block-tab'), 'not draggable').not.toHaveAttribute('draggable', 'true')
  })

  it('is enabled once game data is loaded', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<><BlockTabs /><AddBlockButton /></>)
    expect(screen.getByRole('button', { name: 'Add block' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'All blocks' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled()
    expect(screen.getByTestId('block-tab'), 'draggable').toHaveAttribute('draggable', 'true')
  })
})

describe('BlockTabs context menu', () => {
  it('duplicates a block from the right-click menu', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('Test'))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(tabBtn('Test')).toBeInTheDocument()
    expect(tabBtn('Test (copy)')).toBeInTheDocument()
  })

  it('sets the block colour from a swatch and closes the menu', () => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('Gears', '#f472b6')
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: gears.id, history: {} })
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('Gears'))
    expect(screen.getByLabelText('Colour #f472b6')).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('[data-testid="block-color-swatch"][aria-checked="true"]')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Colour #a3e635'))
    const [first, second] = useBlockStore.getState().blocks
    expect(second.color).toBe('#a3e635')
    expect(first.color).toBe('#60a5fa')
    expect(screen.queryByRole('menu')).toBeNull()
    const stripe = tabBtn('Gears').querySelector('[data-testid="block-tab-stripe"]') as HTMLElement
    expect(stripe.style.background).toBe('#a3e635')
  })

  it('Default colour gives the block the colour of its first product\'s icon, after a swatch was picked', () => {
    // #a3e635 is a palette colour and the only one within the hue window of itself.
    const items = { gear: { id: 'gear', name: 'Gear', iconPath: 'gear.png', iconColor: '#a3e635' } }
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items } as unknown as GameData, sourceId: 'test' },
    })
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = { ...makeEmptyBlock('Gears', '#f472b6'), products: [{ id: 'p1', itemId: 'gear' }] }
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: gears.id, history: {} })
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('Gears'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Default colour' }))
    const [first, second] = useBlockStore.getState().blocks
    expect(second.color).toBe('#a3e635')
    expect(first.color).toBe('#60a5fa')
    expect(screen.queryByRole('menu')).toBeNull()

    // The block follows its first product now: the menu checks Default colour and rings no swatch.
    fireEvent.contextMenu(tabBtn('Gears'))
    expect(screen.getByRole('menuitemradio', { name: 'Default colour' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('[data-testid="block-color-swatch"][aria-checked="true"]')).toHaveLength(0)

    // Picking a swatch ends it.
    fireEvent.click(screen.getByLabelText('Colour #f472b6'))
    fireEvent.contextMenu(tabBtn('Gears'))
    expect(screen.getByRole('menuitemradio', { name: 'Default colour' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('Colour #f472b6')).toHaveAttribute('aria-checked', 'true')

    // Both choices are undoable: pick #f472b6, Default colour, and back.
    act(() => useBlockStore.getState().undo())
    expect(useBlockStore.getState().blocks[1].colorAuto).toBe(true)
    expect(useBlockStore.getState().blocks[1].color).toBe('#a3e635')
    act(() => useBlockStore.getState().undo())
    expect(useBlockStore.getState().blocks[1].colorAuto).toBeFalsy()
    expect(useBlockStore.getState().blocks[1].color).toBe('#f472b6')
  })

  it('draws the Default colour swatch as the first product\'s icon on its own colour, and as an empty cell with no product', () => {
    const items = { gear: { id: 'gear', name: 'Gear', iconPath: 'gear.png', iconColor: '#12ab9c' } }
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items } as unknown as GameData, sourceId: 'test' },
    })
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = { ...makeEmptyBlock('Gears', '#f472b6'), products: [{ id: 'p1', itemId: 'gear' }] }
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: gears.id, history: {} })
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('Gears'))
    const swatch = screen.getByTestId('block-color-default')
    expect(swatch.style.background).toBe('#12ab9c')
    expect(swatch.querySelector('img')).not.toBeNull()
    expect(document.querySelectorAll('[data-testid="block-color-swatch"]')).toHaveLength(BLOCK_PALETTE.length)
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.contextMenu(tabBtn('Plates'))
    expect(screen.getByTestId('block-color-default').querySelector('img')).toBeNull()
  })
})

describe('BlockTabs tab look', () => {
  it('shows the name on the active tab only, under a stripe in the block colour: full strength when active, 85% otherwise', () => {
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('Gears', '#f472b6')
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: plates.id, history: {} })
    render(<BlockTabs />)
    const stripe = (name: string) =>
      tabBtn(name).querySelector('[data-testid="block-tab-stripe"]') as HTMLElement
    expect(tabBtn('Plates')).toHaveTextContent('Plates')
    expect(tabBtn('Gears'), 'inactive tab shows no name').not.toHaveTextContent('Gears')
    expect(stripe('Plates').style.background, 'active').toBe('#60a5fa')
    expect(stripe('Gears').style.background, 'inactive').toBe('rgba(244, 114, 182, 0.85)')
    expect(stripe('Plates')).toHaveClass('h-[3px]')
    expect(stripe('Gears')).toHaveClass('h-[3px]')
  })

  it('makes an inactive tab 44px wide and gives it the block initial when there is no icon', () => {
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('gears', '#f472b6')
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: plates.id, history: {} })
    render(<BlockTabs />)
    expect(tabBtn('gears').closest('[data-testid="block-tab"]')).toHaveClass('w-11')
    expect(tabBtn('Plates').closest('[data-testid="block-tab"]')).not.toHaveClass('w-11')
    expect(tabBtn('gears')).not.toHaveAttribute('title')
    expect(tabBtn('gears').querySelector('[data-testid="block-tab-initial"]')).toHaveTextContent('g')
  })
})

describe('BlockTabs icon fallback', () => {
  it('falls back to the initial when the icon fails, and tries again once the first product changes', () => {
    const items = { a: { iconPath: 'a.png' }, b: { iconPath: 'b.png' } }
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items } as unknown as GameData, sourceId: 'test' },
    })
    const plates = makeEmptyBlock('Plates', '#60a5fa')
    const gears = makeEmptyBlock('gears', '#f472b6')
    const product = (itemId: string) => ({ id: crypto.randomUUID(), itemId, rate: 1 })
    gears.products = [product('a')] as typeof gears.products
    useBlockStore.setState({ blocks: [plates, gears], activeBlockId: plates.id, history: {} })
    render(<BlockTabs />)
    expect(tabBtn('gears').querySelector('img')).not.toBeNull()
    fireEvent.error(tabBtn('gears').querySelector('img')!)
    expect(tabBtn('gears').querySelector('img'), 'icon dropped').toBeNull()
    expect(tabBtn('gears').querySelector('[data-testid="block-tab-initial"]')).toHaveTextContent('g')
    act(() => {
      useBlockStore.setState({
        blocks: [plates, { ...gears, products: [product('b')] as typeof gears.products }],
      })
    })
    expect(tabBtn('gears').querySelector('img'), 'new icon is tried').not.toBeNull()
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
  const tab = (name: string) => tabBtn(name).closest('[data-testid="block-tab"]') as HTMLElement

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
    fireEvent.contextMenu(tabBtn('B'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }))
    expect(names()).toEqual(['B', 'A', 'C'])
    expect(useBlockStore.getState().activeBlockId, 'active unchanged').toBe(a.id)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables Move left on the first tab and Move right on the last', () => {
    seed()
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('A'))
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.contextMenu(tabBtn('C'))
    expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeEnabled()
  })

  it('closes the menu on Escape and renders it outside the scrolling strip', () => {
    seed()
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('B'))
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

  it('has an All blocks list before the tabs whether or not they fit', () => {
    seed()
    render(<BlockTabs />)
    const list = screen.getByRole('button', { name: 'All blocks' })
    expect(list.compareDocumentPosition(screen.getAllByTestId('block-tab')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list).toHaveClass('w-7', 'h-7')
  })

  it('lists every block in the list, switches to the one picked and closes', () => {
    const { c } = seed()
    render(<BlockTabs />)
    fireEvent.click(screen.getByRole('button', { name: 'All blocks' }))
    expect(screen.getAllByRole('menuitemradio').map(i => i.textContent)).toEqual(['A', 'B', 'C'])
    expect(screen.getByRole('menuitemradio', { name: 'A' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'C' }))
    expect(useBlockStore.getState().activeBlockId).toBe(c.id)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the list on Escape', () => {
    seed()
    render(<BlockTabs />)
    fireEvent.click(screen.getByRole('button', { name: 'All blocks' }))
    expect(screen.getByRole('menu', { name: 'All blocks' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
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
    expect(tabBtn('A')).toHaveClass('flex-1')
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
