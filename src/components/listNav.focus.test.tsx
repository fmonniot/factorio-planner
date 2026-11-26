import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { moveListFocus, stepListFocus, entryItem, giveFocusBack, type ListNavOptions } from './listNav'

function List({ opts, selector = 'button' }: { opts?: ListNavOptions; selector?: string }) {
  return (
    <div data-testid="list" onKeyDown={e => moveListFocus(e, selector, opts)}>
      <button type="button">one</button>
      <button type="button" disabled>two</button>
      <button type="button">three</button>
      <button type="button">four</button>
      <span tabIndex={-1} data-testid="plain">plain</span>
    </div>
  )
}

const btn = (name: string) => screen.getByRole('button', { name })

/** Fires the key on `el` and returns whether the event was cancelled (handled). */
function press(el: Element, key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(el, { key, bubbles: true, cancelable: true, ...init })
}

afterEach(() => cleanup())

describe('moveListFocus', () => {
  it('moves with the arrows and Home / End, skipping a disabled item, and cancels the key', () => {
    render(<List />)
    btn('one').focus()
    expect(press(btn('one'), 'ArrowDown'), 'handled').toBe(true)
    expect(btn('three')).toHaveFocus()
    press(btn('three'), 'ArrowDown')
    expect(btn('four')).toHaveFocus()
    press(btn('four'), 'ArrowUp')
    expect(btn('three')).toHaveFocus()
    press(btn('three'), 'End')
    expect(btn('four')).toHaveFocus()
    press(btn('four'), 'Home')
    expect(btn('one')).toHaveFocus()
  })

  it('stops at the ends unless it wraps', () => {
    const { unmount } = render(<List />)
    btn('four').focus()
    expect(press(btn('four'), 'ArrowDown'), 'still handled, so the page does not scroll').toBe(true)
    expect(btn('four')).toHaveFocus()
    unmount()
    render(<List opts={{ wrap: true }} />)
    btn('four').focus()
    press(btn('four'), 'ArrowDown')
    expect(btn('one')).toHaveFocus()
    press(btn('one'), 'ArrowUp')
    expect(btn('four')).toHaveFocus()
  })

  it('runs the edge callbacks, which beat wrapping', () => {
    const onTopEdge = vi.fn()
    const onBottomEdge = vi.fn()
    render(<List opts={{ wrap: true, onTopEdge, onBottomEdge }} />)
    btn('one').focus()
    press(btn('one'), 'ArrowUp')
    expect(onTopEdge).toHaveBeenCalledTimes(1)
    expect(btn('one'), 'focus stays for the callback to move').toHaveFocus()
    btn('four').focus()
    press(btn('four'), 'ArrowDown')
    expect(onBottomEdge).toHaveBeenCalledTimes(1)
    expect(btn('four')).toHaveFocus()
  })

  it('ignores a key with any modifier, and does not cancel it', () => {
    render(<List />)
    btn('one').focus()
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(press(btn('one'), 'ArrowDown', { [mod]: true }), mod).toBe(false)
    }
    expect(btn('one')).toHaveFocus()
  })

  it('ignores other keys, a target outside an item and an event that was already handled', () => {
    render(<List />)
    btn('one').focus()
    expect(press(btn('one'), 'ArrowRight')).toBe(false)
    expect(press(btn('one'), 'a')).toBe(false)
    expect(press(screen.getByTestId('plain'), 'ArrowDown')).toBe(false)
    expect(btn('one')).toHaveFocus()
    const take = (e: Event) => e.preventDefault()
    const list = screen.getByTestId('list')
    list.addEventListener('keydown', take, true)
    press(btn('one'), 'ArrowDown')
    list.removeEventListener('keydown', take, true)
    expect(btn('one')).toHaveFocus()
  })
})

describe('stepListFocus', () => {
  it('enters from outside the items at the first for Down and the last for Up', () => {
    render(<List />)
    const items = [btn('one'), btn('three'), btn('four')]
    expect(stepListFocus(items, document.body, 'ArrowDown')).toBe(true)
    expect(btn('one')).toHaveFocus()
    expect(stepListFocus(items, document.body, 'ArrowUp')).toBe(true)
    expect(btn('four')).toHaveFocus()
  })

  it('does not handle another key or an empty list', () => {
    render(<List />)
    expect(stepListFocus([btn('one')], null, 'Tab')).toBe(false)
    expect(stepListFocus([], null, 'ArrowDown')).toBe(false)
  })
})

describe('entryItem', () => {
  it('prefers the item that is current or checked, else the first', () => {
    const make = (attrs: Record<string, string>[]) => attrs.map(a => {
      const el = document.createElement('button')
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, v)
      return el
    })
    const current = make([{}, { 'aria-current': 'true' }, {}])
    expect(entryItem(current)).toBe(current[1])
    const checked = make([{}, {}, { 'aria-checked': 'true' }])
    expect(entryItem(checked)).toBe(checked[2])
    const none = make([{ 'aria-checked': 'false' }, {}])
    expect(entryItem(none)).toBe(none[0])
    expect(entryItem([])).toBeUndefined()
  })
})

describe('giveFocusBack', () => {
  function Scene() {
    return (
      <div>
        <button type="button">target</button>
        <div data-testid="panel"><button type="button">inside</button></div>
        <button type="button">other</button>
      </div>
    )
  }

  it('moves focus to the target when it is inside the panel, or nowhere', () => {
    render(<Scene />)
    btn('inside').focus()
    giveFocusBack(screen.getByTestId('panel'), btn('target'))
    expect(btn('target')).toHaveFocus()
    ;(document.activeElement as HTMLElement).blur()
    giveFocusBack(screen.getByTestId('panel'), btn('other'))
    expect(btn('other'), 'focus was on the body').toHaveFocus()
  })

  it('leaves focus alone when it is already somewhere else', () => {
    render(<Scene />)
    btn('other').focus()
    giveFocusBack(screen.getByTestId('panel'), btn('target'))
    expect(btn('other')).toHaveFocus()
  })

  it('does nothing for a target that left the document, or none', () => {
    render(<Scene />)
    const gone = document.createElement('button')
    btn('inside').focus()
    giveFocusBack(screen.getByTestId('panel'), gone)
    giveFocusBack(screen.getByTestId('panel'), null)
    expect(btn('inside')).toHaveFocus()
  })
})
