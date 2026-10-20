import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppMenu } from './AppMenu'
import { useGameDataStore } from '../store/gameDataStore'
import { usePlansStore } from '../store/plansStore'
import { makeEmptyBlock } from '../store/blockStore'
import { activateDataSet } from '../store/persistence'
import type { GameData } from '../data/types'

const KEY = 'factorio-planner:game-data-source'

const importGameDataUrl = vi.fn()

// Minimal IndexedDB stand-in: the mount effect reads the stored upload, and
// there is never one here. Writes complete immediately.
function fakeIndexedDb(opts: { stored?: unknown; getGate?: Promise<void>; failWrites?: boolean } = {}) {
  const request = (result: unknown, gate?: Promise<void>) => {
    const req: { result: unknown; onsuccess?: () => void } = { result }
    void (gate ?? Promise.resolve()).then(() => req.onsuccess?.())
    return req
  }
  const tx = () => {
    const t: { oncomplete?: () => void; onerror?: () => void; error?: unknown; objectStore: () => unknown } = {
      objectStore: () => ({ get: () => request(opts.stored, opts.getGate), put: () => {}, delete: () => {} }),
    }
    queueMicrotask(() => (opts.failWrites ? (t.error = new Error('blocked'), t.onerror?.()) : t.oncomplete?.()))
    return t
  }
  return { open: () => request({ transaction: tx, createObjectStore: () => {} }) }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb())
  localStorage.clear()
  importGameDataUrl.mockReset().mockResolvedValue(undefined)
  useGameDataStore.setState({
    status: { type: 'empty' },
    importGameDataUrl,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const trigger = () => screen.getByRole('button', { name: 'Menu' })
const openMenu = () => userEvent.click(trigger())
/** Keyboard open: focus moves into the panel (a mouse open leaves it on the trigger). */
const openMenuWithKeyboard = async (key = '{Enter}') => {
  trigger().focus()
  await userEvent.keyboard(key)
}
const loaded = () => useGameDataStore.setState({
  status: { type: 'loaded', gameData: {} as unknown as GameData, sourceId: 'nullius' },
})

describe('AppMenu persisted id', () => {
  it('normalises and rewrites a legacy kompetenz-seablock/ value', async () => {
    localStorage.setItem(KEY, 'kompetenz-seablock/')
    render(<AppMenu />)
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: 'Seablock' }), 'Seablock is the checked data set').toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(KEY)).toBe('kompetenz-seablock')
  })

  it('still uses the normalised id when the rewrite throws', async () => {
    localStorage.setItem(KEY, 'kompetenz-seablock/')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => render(<AppMenu />)).not.toThrow()
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: 'Seablock' }), 'Seablock is the checked data set').toHaveAttribute('aria-checked', 'true')
  })
})

describe('AppMenu import plan item', () => {
  it('is disabled until game data is loaded', async () => {
    render(<AppMenu />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Import plan…' })).toBeDisabled()
  })

  it('is enabled once game data is loaded', async () => {
    loaded()
    render(<AppMenu />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Import plan…' })).toBeEnabled()
  })
})

describe('AppMenu', () => {
  it('exposes a menu button that toggles the panel', async () => {
    render(<AppMenu />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await openMenu()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Plan and game data' })).toBeInTheDocument()
  })

  it('lists the items in order', async () => {
    render(<AppMenu />)
    await openMenu()
    const names = Array.from(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).map(el => el.textContent?.replace('✓', '').trim())
    expect(names).toEqual(['Nullius', 'Seablock', 'Upload file…', 'Export plan', 'Import plan…'])
  })

  it('focuses Nullius on first visit with nothing checked', async () => {
    render(<AppMenu />)
    await openMenuWithKeyboard()
    expect(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(0)
    expect(screen.getByRole('menuitemradio', { name: 'Nullius' })).toHaveFocus()
  })

  it('focuses the checked data set when one is persisted', async () => {
    localStorage.setItem(KEY, 'kompetenz-seablock')
    render(<AppMenu />)
    await openMenuWithKeyboard()
    expect(screen.getByRole('menuitemradio', { name: 'Seablock' })).toHaveFocus()
  })

  it('leaves focus on the trigger after a mouse open', async () => {
    render(<AppMenu />)
    await openMenu()
    expect(trigger()).toHaveFocus()
  })

  it('focuses the last enabled item when opened with ArrowUp', async () => {
    loaded()
    render(<AppMenu />)
    await openMenuWithKeyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Import plan…' })).toHaveFocus()
  })

  it('ignores arrow keys while focus is outside the menu', async () => {
    render(<AppMenu />)
    await openMenu()
    const outside = document.body.appendChild(document.createElement('button'))
    outside.focus()
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    outside.dispatchEvent(event)
    expect(event.defaultPrevented, 'the page keeps its arrow keys').toBe(false)
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('still closes on Escape when focus is outside the menu', async () => {
    render(<AppMenu />)
    await openMenu()
    const outside = document.body.appendChild(document.createElement('button'))
    outside.focus()
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(await screen.findByRole('button', { name: 'Menu' })).toHaveFocus()
    expect(screen.queryByRole('menu')).toBeNull()
    outside.remove()
  })

  it('closes on Escape, returns focus and prevents the default', async () => {
    render(<AppMenu />)
    await openMenuWithKeyboard()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    expect(event.defaultPrevented, 'Escape must not reach the panes').toBe(true)
    expect(await screen.findByRole('button', { name: 'Menu' })).toHaveFocus()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on an outside pointerdown', async () => {
    render(<AppMenu />)
    await openMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('wraps ArrowDown past the disabled Import plan… item', async () => {
    render(<AppMenu />)
    await openMenuWithKeyboard()
    screen.getByRole('menuitem', { name: 'Export plan' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Nullius' })).toHaveFocus()
  })

  it('loads the picked bundled data set and closes', async () => {
    render(<AppMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Seablock' }))
    expect(importGameDataUrl).toHaveBeenCalledWith(
      expect.stringContaining('kompetenz-seablock/game-data.json'),
      'kompetenz-seablock',
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not reload when the checked data set is picked again', async () => {
    localStorage.setItem(KEY, 'nullius')
    render(<AppMenu />)
    expect(importGameDataUrl).toHaveBeenCalledTimes(1)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Nullius' }))
    expect(importGameDataUrl).toHaveBeenCalledTimes(1)
  })

  it('does not let a pending stored-upload read override an early pick', async () => {
    let release!: () => void
    const getGate = new Promise<void>(r => { release = r })
    const importGameData = vi.fn()
    vi.stubGlobal('indexedDB', fakeIndexedDb({ stored: { json: '{}', filename: 'mine.json' }, getGate }))
    useGameDataStore.setState({ importGameData })
    render(<AppMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Nullius' }))
    release()
    await new Promise(r => setTimeout(r, 0))
    expect(importGameData, 'the stored upload is abandoned').not.toHaveBeenCalled()
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: 'Nullius' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTitle('mine.json')).toBeNull()
  })

  it('reports a failed switch and keeps the previous choice checked', async () => {
    localStorage.setItem(KEY, 'nullius')
    vi.stubGlobal('indexedDB', fakeIndexedDb({ failWrites: true }))
    render(<AppMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Seablock' }))
    expect(await screen.findByText('Error loading data')).toHaveAttribute('title', expect.stringContaining('blocked'))
    expect(importGameDataUrl).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBe('nullius')
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: 'Nullius' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Seablock' })).toHaveAttribute('aria-checked', 'false')
  })

  it('reports a failed upload save instead of rejecting', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ failWrites: true }))
    const importGameDataFile = vi.fn()
    useGameDataStore.setState({ importGameDataFile })
    render(<AppMenu />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, new File(['{}'], 'mine.json', { type: 'application/json' }))
    expect(await screen.findByText('Error loading data')).toBeInTheDocument()
    expect(importGameDataFile).not.toHaveBeenCalled()
    await openMenu()
    expect(screen.queryByTitle('mine.json')).toBeNull()
  })

  it('opens the hidden file input from Upload file…', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<AppMenu />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Upload file…' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(click.mock.contexts[0]).toBe(document.querySelector('input[type="file"]'))
  })

  it('keeps the hidden file input mounted while the menu is closed', () => {
    render(<AppMenu />)
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument()
  })

  it('shows Loading… outside the menu', () => {
    useGameDataStore.setState({ status: { type: 'loading' } })
    render(<AppMenu />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows the error label outside the menu', () => {
    useGameDataStore.setState({ status: { type: 'error', message: 'boom' } })
    render(<AppMenu />)
    expect(screen.getByText('Error loading data')).toBeInTheDocument()
  })
})

describe('AppMenu plan import', () => {
  beforeEach(() => {
    usePlansStore.setState({ sourceId: null, index: null })
    useGameDataStore.setState({
      status: { type: 'loaded', gameData: { recipes: {}, items: {} } as unknown as GameData, sourceId: 'nullius' },
    })
    activateDataSet('nullius')
  })

  afterEach(() => { usePlansStore.setState({ sourceId: null, index: null }) })

  const planCount = () => usePlansStore.getState().index?.plans.length
  const planFile = (name: string, goalItem?: string) => {
    const block = makeEmptyBlock('Imported')
    if (goalItem) block.goals = [{ id: 'g', itemId: goalItem, rate: 60 }]
    return new File([JSON.stringify({ blocks: [block], activeBlockId: block.id })], name, { type: 'application/json' })
  }
  async function pick(file: File) {
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Import plan…' }))
    const input = document.querySelector<HTMLInputElement>('[data-plan-import-input]')!
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)
  }

  it('imports a clean file as a new plan without asking', async () => {
    render(<AppMenu />)
    await pick(planFile('clean.json'))
    await waitFor(() => expect(planCount()).toBe(2))
    expect(usePlansStore.getState().index!.plans[1].name).toBe('clean')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('warns about unknown ids and adds nothing on Cancel', async () => {
    render(<AppMenu />)
    await pick(planFile('ghost.json', 'ghost-item'))
    expect(await screen.findByTestId('import-unknown-ids')).toHaveTextContent('ghost-item')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(planCount()).toBe(1)
    expect(screen.queryByTestId('import-unknown-ids')).not.toBeInTheDocument()
  })

  it('adds the plan on Import anyway', async () => {
    render(<AppMenu />)
    await pick(planFile('ghost.json', 'ghost-item'))
    await userEvent.click(await screen.findByRole('button', { name: 'Import anyway' }))
    expect(planCount()).toBe(2)
  })
})
