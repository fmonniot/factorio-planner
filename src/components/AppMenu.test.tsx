import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppMenu } from './AppMenu'
import { useGameDataStore } from '../store/gameDataStore'
import type { GameData } from '../data/types'

const KEY = 'factorio-planner:game-data-source'

const importGameDataUrl = vi.fn()

// Minimal IndexedDB stand-in: the mount effect reads the stored upload, and
// there is never one here. Writes complete immediately.
function fakeIndexedDb() {
  const request = (result: unknown) => {
    const req: { result: unknown; onsuccess?: () => void } = { result }
    queueMicrotask(() => req.onsuccess?.())
    return req
  }
  const tx = () => {
    const t: { oncomplete?: () => void; objectStore: () => unknown } = {
      objectStore: () => ({ get: () => request(undefined), put: () => {}, delete: () => {} }),
    }
    queueMicrotask(() => t.oncomplete?.())
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
    expect(screen.getByRole('menuitem', { name: 'Import plan' })).toBeDisabled()
  })

  it('is enabled once game data is loaded', async () => {
    loaded()
    render(<AppMenu />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Import plan' })).toBeEnabled()
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
    expect(names).toEqual(['Nullius', 'Seablock', 'Upload file…', 'Export plan', 'Import plan'])
  })

  it('focuses Nullius on first visit with nothing checked', async () => {
    render(<AppMenu />)
    await openMenu()
    expect(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(0)
    expect(screen.getByRole('menuitemradio', { name: 'Nullius' })).toHaveFocus()
  })

  it('focuses the checked data set when one is persisted', async () => {
    localStorage.setItem(KEY, 'kompetenz-seablock')
    render(<AppMenu />)
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: 'Seablock' })).toHaveFocus()
  })

  it('closes on Escape, returns focus and prevents the default', async () => {
    render(<AppMenu />)
    await openMenu()
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

  it('wraps ArrowDown past the disabled Import plan item', async () => {
    render(<AppMenu />)
    await openMenu()
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
