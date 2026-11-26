import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, createEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const blockName = () => useBlockStore.getState().blocks[0].name
  beforeEach(() => {
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' },
    })
  })

  it('Rename opens a dialog and applies the trimmed name', () => {
    render(<BlockTabs />)
    fireEvent.contextMenu(tabBtn('Test'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Block name' })
    expect(input).toHaveValue('Test')
    fireEvent.change(input, { target: { value: '  Smelting  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(blockName()).toBe('Smelting')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a double-click on a tab opens the rename dialog; Cancel keeps the name', () => {
    render(<BlockTabs />)
    fireEvent.doubleClick(tabBtn('Test'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Block name' }), { target: { value: 'Other' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(blockName()).toBe('Test')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a blank block name cannot be submitted', () => {
    render(<BlockTabs />)
    fireEvent.doubleClick(tabBtn('Test'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Block name' }), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
  })

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

describe('BlockTabs context menu, keyboard', () => {
  const COLS = 9
  const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key: k, cancelable: true, ...init })
  const item = (name: string) => screen.getByRole('menuitem', { name })
  const cells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="block-color-default"], [data-testid="block-color-swatch"]'))
  const swatch = (color: string) => screen.getByLabelText(`Colour ${color}`)

  /** Happy-dom has no layout: lay the colour cells out in the menu's nine columns by their index. */
  function stubGrid() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const all = cells()
      const i = all.indexOf(this as HTMLElement)
      if (i < 0) return new DOMRect(0, 0, 0, 0)
      return new DOMRect((i % COLS) * 20, Math.floor(i / COLS) * 20, 16, 16)
    })
  }

  /** Two or three blocks, the first one active; the menu opens on `name`. */
  function openMenu(name: string, names = ['Plates', 'Gears', 'Wires']) {
    const blocks = names.map((n, i) => makeEmptyBlock(n, BLOCK_PALETTE[i]))
    useBlockStore.setState({ blocks, activeBlockId: blocks[0].id, history: {} })
    useGameDataStore.setState({ status: { type: 'loaded', gameData: { items: {} } as unknown as GameData, sourceId: 'test' } })
    render(<BlockTabs />)
    const tab = tabBtn(name)
    tab.focus()
    fireEvent.contextMenu(tab)
    return tab
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('does not take focus when it opens; ArrowDown enters it at Rename', () => {
    const tab = openMenu('Gears')
    expect(tab, 'focus stays on the tab').toHaveFocus()
    key('ArrowDown')
    expect(item('Rename')).toHaveFocus()
  })

  it('skips Move left on the first tab and Move right on the last', () => {
    openMenu('Plates')
    key('ArrowDown')
    key('ArrowDown')
    expect(item('Duplicate')).toHaveFocus()
    key('ArrowDown')
    expect(item('Move right'), 'Move left is disabled').toHaveFocus()
    cleanupAndReopen('Wires')
    key('ArrowDown')
    key('ArrowDown')
    key('ArrowDown')
    expect(item('Move left')).toHaveFocus()
    key('ArrowDown')
    expect(item('Delete'), 'Move right is disabled').toHaveFocus()
  })

  function cleanupAndReopen(name: string) {
    fireEvent.keyDown(document, { key: 'Escape' })
    tabBtn(name).focus()
    fireEvent.contextMenu(tabBtn(name))
  }

  it('goes from Delete into the colour grid at the checked swatch, and at Default for an automatic colour', () => {
    stubGrid()
    openMenu('Gears')
    key('End')
    key('Home')
    item('Delete').focus()
    key('ArrowDown')
    expect(swatch(BLOCK_PALETTE[1]), 'Gears has the second palette colour').toHaveFocus()
    cleanupAndReopen('Gears')
    useBlockStore.getState().resetBlockColor(useBlockStore.getState().blocks[1].id)
    cleanupAndReopen('Gears')
    item('Delete').focus()
    key('ArrowDown')
    expect(screen.getByTestId('block-color-default')).toHaveFocus()
  })

  it('walks the grid with Left and Right, Down to the same column of the next row, and Up from the first row to Delete', () => {
    stubGrid()
    openMenu('Gears')
    const all = cells()
    all[1].focus()
    key('ArrowRight')
    expect(all[2]).toHaveFocus()
    key('ArrowLeft')
    key('ArrowLeft')
    expect(all[0]).toHaveFocus()
    key('ArrowLeft')
    expect(all[0], 'stops at the start').toHaveFocus()
    key('ArrowDown')
    expect(all[COLS], 'same column, next row').toHaveFocus()
    key('ArrowUp')
    expect(all[0]).toHaveFocus()
    key('ArrowUp')
    expect(item('Delete')).toHaveFocus()
  })

  it('wraps Down from the last grid row to Rename, and ArrowUp from outside enters at the last cell', () => {
    stubGrid()
    openMenu('Gears')
    const all = cells()
    all[COLS].focus()
    key('ArrowDown')
    expect(item('Rename')).toHaveFocus()
    cleanupAndReopen('Gears')
    ;(document.activeElement as HTMLElement).blur()
    key('ArrowUp')
    expect(cells()[cells().length - 1]).toHaveFocus()
  })

  it('goes Up from the first grid row to the last enabled item when Delete is disabled (one block)', () => {
    stubGrid()
    openMenu('Plates', ['Plates'])
    cells()[0].focus()
    key('ArrowUp')
    expect(item('Duplicate'), 'Move left, Move right and Delete are disabled').toHaveFocus()
  })

  it('picks the focused swatch with Enter, which sets the colour, closes the menu and returns focus to the tab', async () => {
    const user = userEvent.setup()
    stubGrid()
    const tab = openMenu('Gears')
    item('Delete').focus()
    await user.keyboard('{End}{ArrowLeft}{Enter}')
    expect(useBlockStore.getState().blocks[1].color?.toLowerCase()).toBe(BLOCK_PALETTE[BLOCK_PALETTE.length - 2].toLowerCase())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(tab).toHaveFocus()
  })

  it('Tab closes the menu and Escape closes it too, each returning focus to the tab', () => {
    const tab = openMenu('Gears')
    key('ArrowDown')
    key('Tab')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(tab).toHaveFocus()
    fireEvent.contextMenu(tab)
    key('ArrowDown')
    key('Escape')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(tab).toHaveFocus()
  })

  it('leaves the focus in the rename dialog, not on the tab, after Rename', async () => {
    const user = userEvent.setup()
    openMenu('Gears')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Block name' })).toHaveFocus()
  })
})
