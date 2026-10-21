import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MenuButton, SubmenuItem, ITEM_CLASS } from './MenuButton'

function Harness({ openSignal, defaultOpen }: { openSignal?: number; defaultOpen?: boolean }) {
  return (
    <MenuButton label="Menu" title="Menu" menuLabel="Main" align="left" openSignal={openSignal}>
      {() => (
        <>
          <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS}>A</button>
          <SubmenuItem
            label="More"
            menuLabel="More options"
            defaultOpen={defaultOpen}
            initialFocus={defaultOpen ? flyout => flyout.querySelector<HTMLElement>('[data-id="b2"]') : undefined}
          >
            <button type="button" role="menuitemradio" aria-checked={false} tabIndex={-1} className={ITEM_CLASS}>X</button>
            <button type="button" role="menuitemradio" aria-checked={true} tabIndex={-1} className={ITEM_CLASS}>Y</button>
            <button type="button" role="menuitemradio" aria-checked={false} data-id="b2" tabIndex={-1} className={ITEM_CLASS}>Z</button>
          </SubmenuItem>
          <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS}>B</button>
        </>
      )}
    </MenuButton>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Menu' })
const more = () => screen.getByRole('menuitem', { name: 'More' })
const item = (name: string) => screen.getByRole('menuitem', { name })
const radio = (name: string) => screen.getByRole('menuitemradio', { name })

async function openWithKeyboard() {
  trigger().focus()
  await userEvent.keyboard('{ArrowDown}')
}

describe('MenuButton with a submenu', () => {
  it('moves through the top-level items only, wrapping', async () => {
    render(<Harness />)
    await openWithKeyboard()
    expect(item('A')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(more()).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('B')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('A')).toHaveFocus()
  })

  it('opens the flyout with ArrowRight and focuses its checked item', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}')
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(radio('Y')).toHaveFocus()
  })

  it('opens the flyout with Enter', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(radio('Y')).toHaveFocus()
  })

  it('cycles within the flyout', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}')
    await userEvent.keyboard('{ArrowDown}')
    expect(radio('Z')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(radio('X')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(radio('Z')).toHaveFocus()
  })

  it('closes only the flyout on Escape, then the menu', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}{Escape}')
    expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Main' })).toBeInTheDocument()
    expect(more()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('closes the flyout on ArrowLeft like Escape, and ignores ArrowLeft at the top level', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('menu', { name: 'Main' })).toBeInTheDocument()
    expect(item('A')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}{ArrowLeft}')
    expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument()
    expect(more()).toHaveFocus()
  })

  it('closes everything on Tab', async () => {
    render(<Harness />)
    await openWithKeyboard()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the menu open when a flyout item is clicked', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    await userEvent.click(more())
    await userEvent.click(radio('X'))
    expect(screen.getByRole('menu', { name: 'More options' })).toBeInTheDocument()
  })

  it('focuses the initialFocus target of a defaultOpen flyout', async () => {
    render(<Harness defaultOpen openSignal={0} />)
    await userEvent.click(trigger())
    expect(radio('Z')).toHaveFocus()
  })

  it('opens on openSignal without moving focus', () => {
    const { rerender } = render(<Harness openSignal={0} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    rerender(<Harness openSignal={1} />)
    expect(screen.getByRole('menu', { name: 'Main' })).toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  describe('with the mouse', () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
    afterEach(() => { vi.useRealTimers() })

    it('opens on hover without taking focus and closes shortly after the pointer leaves', async () => {
      render(<Harness />)
      await userEvent.click(trigger())
      const wrapper = more().parentElement!
      fireEvent.mouseEnter(wrapper)
      expect(screen.getByRole('menu', { name: 'More options' })).toBeInTheDocument()
      expect(trigger()).toHaveFocus()
      fireEvent.mouseLeave(wrapper)
      expect(screen.getByRole('menu', { name: 'More options' }), 'still open before the delay').toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(200) })
      expect(screen.queryByRole('menu', { name: 'More options' })).not.toBeInTheDocument()
    })

    it('stays open after the pointer leaves while focus is inside the flyout', async () => {
      render(<Harness />)
      await userEvent.click(trigger())
      const wrapper = more().parentElement!
      fireEvent.mouseEnter(wrapper)
      radio('X').focus()
      fireEvent.mouseLeave(wrapper)
      act(() => { vi.advanceTimersByTime(200) })
      expect(screen.getByRole('menu', { name: 'More options' })).toBeInTheDocument()
    })
  })
})
