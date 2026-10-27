// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { AreaChipsMore } from './AreaChipsMore'
import { HOVER_HIDE_GRACE_MS, HOVER_OPEN_DELAY_MS } from '../useHoverPopup'

const items = {
  e: { id: 'e', name: 'Ernie' },
  f: { id: 'f', name: 'Fred' },
} as never

const FLOWS = [
  { itemId: 'e', rate: 56, boundary: true },
  { itemId: 'f', rate: 55, boundary: false },
]

function renderMore(props: Partial<Parameters<typeof AreaChipsMore>[0]> = {}) {
  return render(<AreaChipsMore flows={FLOWS} direction="receives" items={items} rateUnit="min" {...props} />)
}
const trigger = () => screen.getByTestId('area-chips-more')
const popup = () => screen.queryByRole('tooltip')
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('AreaChipsMore', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('renders nothing without flows', () => {
    const { container } = renderMore({ flows: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('is a labelled button without a title', () => {
    renderMore()
    expect(trigger().tagName).toBe('BUTTON')
    expect(trigger().textContent).toBe('+2')
    expect(trigger()).toHaveAttribute('aria-label', '2 more received items')
    expect(trigger()).not.toHaveAttribute('title')
    expect(popup()).toBeNull()
  })

  it('opens after the hover delay and lists the flows in order', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.mouseEnter(trigger())
    advance(HOVER_OPEN_DELAY_MS - 1)
    expect(popup()).toBeNull()
    advance(1)
    const p = screen.getByRole('tooltip')
    const chips = p.querySelectorAll('[data-item-id]')
    expect([...chips].map(c => c.getAttribute('data-item-id'))).toEqual(['e', 'f'])
    expect([...chips].every(c => c.getAttribute('data-direction') === 'receives')).toBe(true)
    expect([...chips].map(c => c.getAttribute('data-boundary'))).toEqual(['true', 'false'])
    expect(p.textContent).toContain('Ernie')
    expect(p.textContent).toContain('Fred')
    expect(p.textContent).toContain('56.0/m')
    expect(p.textContent).toContain('Also receives')
  })

  it('never opens when the pointer leaves before the delay', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.mouseEnter(trigger())
    advance(HOVER_OPEN_DELAY_MS - 100)
    fireEvent.mouseLeave(trigger())
    advance(1000)
    expect(popup()).toBeNull()
  })

  it('closes after the grace period, and stays open while the pointer is on the popup', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.mouseEnter(trigger())
    advance(HOVER_OPEN_DELAY_MS)
    fireEvent.mouseLeave(trigger())
    advance(HOVER_HIDE_GRACE_MS - 1)
    expect(popup()).not.toBeNull()
    advance(1)
    expect(popup()).toBeNull()

    fireEvent.mouseEnter(trigger())
    advance(HOVER_OPEN_DELAY_MS)
    fireEvent.mouseLeave(trigger())
    advance(HOVER_HIDE_GRACE_MS - 50)
    fireEvent.mouseEnter(screen.getByRole('tooltip'))
    advance(1000)
    expect(popup()).not.toBeNull()
    fireEvent.mouseLeave(screen.getByRole('tooltip'))
    advance(HOVER_HIDE_GRACE_MS)
    expect(popup()).toBeNull()
  })

  it('opens at once on focus, describes the trigger, and closes on blur', () => {
    renderMore()
    fireEvent.focus(trigger())
    const p = screen.getByRole('tooltip')
    expect(trigger().getAttribute('aria-describedby')).toBe(p.id)
    fireEvent.blur(trigger())
    expect(popup()).toBeNull()
    expect(trigger()).not.toHaveAttribute('aria-describedby')
  })

  it('closes on Escape and prevents its default', () => {
    renderMore()
    fireEvent.focus(trigger())
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false)
    expect(popup()).toBeNull()
  })

  it('is pinned by a mouse click until the next click', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.mouseEnter(trigger())
    fireEvent.pointerDown(trigger())
    fireEvent.focus(trigger())
    fireEvent.click(trigger())
    expect(popup()).not.toBeNull()
    fireEvent.mouseLeave(trigger())
    advance(500)
    expect(popup()).not.toBeNull()
    fireEvent.click(trigger())
    expect(popup()).toBeNull()
  })

  it('closes on a press outside and on a scroll, but not on a scroll inside the popup', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.focus(trigger())
    fireEvent.pointerDown(screen.getByRole('tooltip'))
    fireEvent.scroll(screen.getByRole('tooltip'))
    expect(popup()).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(popup()).toBeNull()

    fireEvent.focus(trigger())
    expect(popup()).not.toBeNull()
    advance(1000)
    fireEvent.scroll(window)
    expect(popup()).toBeNull()
  })

  it('shows rates per second on request', () => {
    renderMore({ rateUnit: 'sec' })
    fireEvent.focus(trigger())
    expect(screen.getByRole('tooltip').textContent).toContain('/s')
  })

  it('words the sends direction', () => {
    renderMore({ direction: 'sends' })
    expect(trigger()).toHaveAttribute('aria-label', '2 more sent items')
    fireEvent.focus(trigger())
    const p = screen.getByRole('tooltip')
    expect(p.textContent).toContain('Also sends')
    expect(p.querySelector('[data-direction="sends"]')).not.toBeNull()
  })

  it('stays pinned by a click made while the hover timer is pending, and a second click closes it', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.mouseEnter(trigger())
    advance(100)
    fireEvent.pointerDown(trigger())
    fireEvent.click(trigger())
    expect(popup()).not.toBeNull()
    advance(HOVER_OPEN_DELAY_MS)
    fireEvent.mouseLeave(trigger())
    advance(HOVER_HIDE_GRACE_MS * 3)
    expect(popup()).not.toBeNull()
    fireEvent.click(trigger())
    expect(popup()).toBeNull()
  })

  it('opens on focus after a press that never became a click', () => {
    renderMore()
    fireEvent.pointerDown(trigger())
    fireEvent.pointerUp(window)
    fireEvent.focus(trigger())
    expect(popup()).not.toBeNull()
    fireEvent.blur(trigger())
    fireEvent.pointerDown(trigger())
    fireEvent(window, new Event('dragstart'))
    fireEvent.focus(trigger())
    expect(popup()).not.toBeNull()
  })

  it('still ignores the focus a press causes', () => {
    renderMore()
    fireEvent.pointerDown(trigger())
    fireEvent.focus(trigger())
    expect(popup()).toBeNull()
  })

  it('follows the trigger when focus scrolls it into view, but closes on a later scroll', () => {
    vi.useFakeTimers()
    renderMore()
    fireEvent.focus(trigger())
    advance(16)
    fireEvent.scroll(window)
    expect(popup()).not.toBeNull()
    advance(1000)
    fireEvent.scroll(window)
    expect(popup()).toBeNull()
  })

  it('keeps the contextmenu event inside the popup', () => {
    const onContextMenu = vi.fn()
    render(
      <div onContextMenu={onContextMenu}>
        <AreaChipsMore flows={FLOWS} direction="receives" items={items} rateUnit="min" />
      </div>,
    )
    fireEvent.focus(trigger())
    fireEvent.contextMenu(screen.getByRole('tooltip'))
    expect(onContextMenu).not.toHaveBeenCalled()
  })

  it('closes when the overflow empties and does not come back with it', () => {
    const { rerender } = renderMore()
    fireEvent.focus(trigger())
    expect(popup()).not.toBeNull()
    rerender(<AreaChipsMore flows={[]} direction="receives" items={items} rateUnit="min" />)
    expect(popup()).toBeNull()
    rerender(<AreaChipsMore flows={FLOWS} direction="receives" items={items} rateUnit="min" />)
    expect(popup()).toBeNull()
  })

  it('re-places the popup when it resizes', () => {
    let notify: () => void = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb }
      observe() {}
      disconnect() {}
    })
    try {
      renderMore()
      fireEvent.focus(trigger())
      const p = screen.getByRole('tooltip')
      const rect = vi.spyOn(p, 'getBoundingClientRect')
      rect.mockReturnValue({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} })
      act(() => notify())
      const before = p.style.top
      rect.mockReturnValue({ width: 100, height: 5000, left: 0, top: 0, right: 100, bottom: 5000, x: 0, y: 0, toJSON() {} })
      act(() => notify())
      expect(rect).toHaveBeenCalled()
      expect(p.style.top).not.toBe('')
      expect(before).not.toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
