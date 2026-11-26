import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { useMenuKeyboard } from './useMenuKeyboard'

const COLS = 3

function Menu({ onClose, withGrid = false, disabled = [] }: { onClose: () => void; withGrid?: boolean; disabled?: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useMenuKeyboard(ref, onClose, withGrid ? { grid: '[data-cell]' } : undefined)
  const item = (name: string) => <button type="button" role="menuitem" disabled={disabled.includes(name)}>{name}</button>
  return (
    <div ref={ref} role="menu">
      {item('Rename')}
      {item('Duplicate')}
      {item('Delete')}
      {withGrid && (
        <div role="group">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <button key={i} type="button" role="menuitemradio" data-cell="" aria-checked={i === 4} aria-label={`cell ${i}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function Page({ open, ...props }: { open: boolean } & Parameters<typeof Menu>[0]) {
  return <div><button type="button">origin</button><button type="button">elsewhere</button>{open && <Menu {...props} />}</div>
}

const item = (name: string) => screen.getByRole('menuitem', { name })
const cell = (i: number) => screen.getByRole('menuitemradio', { name: `cell ${i}` })

/** Fires the key on the focused element (or the body) and returns whether the event was cancelled (handled). */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(document.activeElement ?? document.body, { key, bubbles: true, cancelable: true, ...init })
}

/** Happy-dom has no layout: lay the cells out in a COLS-column grid by their index. */
function stubGrid() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-cell')) return new DOMRect(0, 0, 0, 0)
    const i = Array.from(document.querySelectorAll('[data-cell]')).indexOf(this)
    return new DOMRect((i % COLS) * 20, Math.floor(i / COLS) * 20, 16, 16)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('useMenuKeyboard, a plain list', () => {
  it('enters at the first item on ArrowDown and at the last on ArrowUp', () => {
    const { unmount } = render(<Menu onClose={() => {}} />)
    expect(press('ArrowDown'), 'handled').toBe(true)
    expect(item('Rename')).toHaveFocus()
    unmount()
    render(<Menu onClose={() => {}} />)
    press('ArrowUp')
    expect(item('Delete')).toHaveFocus()
  })

  it('wraps, and Home and End jump to the ends', () => {
    render(<Menu onClose={() => {}} />)
    press('ArrowDown')
    press('ArrowUp')
    expect(item('Delete')).toHaveFocus()
    press('ArrowDown')
    expect(item('Rename')).toHaveFocus()
    press('End')
    expect(item('Delete')).toHaveFocus()
    press('Home')
    expect(item('Rename')).toHaveFocus()
  })

  it('skips a disabled item', () => {
    render(<Menu onClose={() => {}} disabled={['Duplicate']} />)
    press('ArrowDown')
    press('ArrowDown')
    expect(item('Delete')).toHaveFocus()
  })

  it('ignores a key with a modifier and other keys', () => {
    render(<Menu onClose={() => {}} />)
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(press('ArrowDown', { [mod]: true }), mod).toBe(false)
    }
    expect(press('ArrowLeft')).toBe(false)
    expect(document.body).toHaveFocus()
  })

  it('closes on Tab once, without cancelling it', () => {
    const onClose = vi.fn()
    render(<Menu onClose={onClose} />)
    press('ArrowDown')
    expect(press('Tab'), 'the browser carries on').toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives focus back to where it was when the menu closes from inside it', () => {
    const { rerender } = render(<Page open={false} onClose={() => {}} />)
    screen.getByText('origin').focus()
    rerender(<Page open onClose={() => {}} />)
    press('ArrowDown')
    expect(item('Rename')).toHaveFocus()
    rerender(<Page open={false} onClose={() => {}} />)
    expect(screen.getByText('origin')).toHaveFocus()
  })

  it('leaves focus where a press elsewhere put it', () => {
    const { rerender } = render(<Page open={false} onClose={() => {}} />)
    screen.getByText('origin').focus()
    rerender(<Page open onClose={() => {}} />)
    press('ArrowDown')
    screen.getByText('elsewhere').focus()
    rerender(<Page open={false} onClose={() => {}} />)
    expect(screen.getByText('elsewhere')).toHaveFocus()
  })

  it('stops listening once the menu is gone', () => {
    const { rerender } = render(<Page open onClose={() => {}} />)
    rerender(<Page open={false} onClose={() => {}} />)
    expect(press('ArrowDown')).toBe(false)
  })
})

describe('useMenuKeyboard, a list followed by a grid', () => {
  const open = (props: Partial<Parameters<typeof Menu>[0]> = {}) => {
    stubGrid()
    return render(<Menu onClose={() => {}} withGrid {...props} />)
  }

  it('enters the list at the first item on ArrowDown, the grid at its last cell on ArrowUp', () => {
    const { unmount } = open()
    press('ArrowDown')
    expect(item('Rename')).toHaveFocus()
    unmount()
    open()
    press('ArrowUp')
    expect(cell(5)).toHaveFocus()
  })

  it('goes from the last list item into the grid at the checked cell, else the first', () => {
    const { unmount } = open()
    item('Delete').focus()
    press('ArrowDown')
    expect(cell(4)).toHaveFocus()
    unmount()
    stubGrid()
    render(<Menu onClose={() => {}} withGrid />)
    cell(4).setAttribute('aria-checked', 'false')
    item('Delete').focus()
    press('ArrowDown')
    expect(cell(0)).toHaveFocus()
  })

  it('walks Left and Right in reading order and stops at the ends', () => {
    open()
    cell(0).focus()
    expect(press('ArrowLeft'), 'handled even at the start').toBe(true)
    expect(cell(0)).toHaveFocus()
    press('ArrowRight')
    press('ArrowRight')
    press('ArrowRight')
    expect(cell(3), 'continues on the next row').toHaveFocus()
    cell(5).focus()
    press('ArrowRight')
    expect(cell(5)).toHaveFocus()
    press('ArrowLeft')
    expect(cell(4)).toHaveFocus()
  })

  it('moves Down to the same column of the next row, and Up back', () => {
    open()
    cell(1).focus()
    press('ArrowDown')
    expect(cell(4)).toHaveFocus()
    press('ArrowUp')
    expect(cell(1)).toHaveFocus()
  })

  it('wraps Down from the last row to the first list item', () => {
    open()
    cell(4).focus()
    press('ArrowDown')
    expect(item('Rename')).toHaveFocus()
  })

  it('goes Up from the first row to the last enabled list item', () => {
    open({ disabled: ['Delete'] })
    cell(1).focus()
    press('ArrowUp')
    expect(item('Duplicate')).toHaveFocus()
  })

  it('jumps with Home to the first list item and End to the last cell', () => {
    open()
    cell(2).focus()
    press('Home')
    expect(item('Rename')).toHaveFocus()
    press('End')
    expect(cell(5)).toHaveFocus()
  })

  it('Left and Right do nothing on a list item', () => {
    open()
    item('Rename').focus()
    expect(press('ArrowRight')).toBe(false)
    expect(item('Rename')).toHaveFocus()
  })
})
