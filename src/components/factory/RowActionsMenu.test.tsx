import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RowActionsMenu, type RowAction } from './RowActionsMenu'

function actions(over: Partial<Record<string, Partial<RowAction>>> = {}): RowAction[] {
  return [
    { label: 'Edit', onSelect: vi.fn(), ...over.Edit },
    { label: 'Hidden', onSelect: vi.fn(), disabled: true, ...over.Hidden },
    { label: 'Pin', onSelect: vi.fn(), checked: false, ...over.Pin },
    { label: 'Compact', onSelect: vi.fn(), checked: true, radio: true, separatorBefore: true, ...over.Compact },
    { label: 'Delete', onSelect: vi.fn(), danger: true, ...over.Delete },
  ]
}

const items = () => screen.getAllByRole('menuitem').concat(screen.getAllByRole('menuitemcheckbox'), screen.getAllByRole('menuitemradio'))
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, cancelable: true, ...init })

describe('RowActionsMenu keyboard', () => {
  it('ArrowDown from outside enters the first enabled item, ArrowUp the last', () => {
    const { unmount } = render(<RowActionsMenu x={0} y={0} actions={actions()} onClose={() => {}} />)
    expect(document.body, 'the menu does not take focus when it opens').toHaveFocus()
    press('ArrowDown')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    unmount()
    render(<RowActionsMenu x={0} y={0} actions={actions()} onClose={() => {}} />)
    press('ArrowUp')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })

  it('skips a disabled item and stops on the checkbox and radio items, in order, wrapping at the end', () => {
    render(<RowActionsMenu x={0} y={0} actions={actions()} onClose={() => {}} />)
    const seen: (string | null)[] = []
    for (let i = 0; i < 5; i++) {
      press('ArrowDown')
      seen.push(document.activeElement!.textContent)
    }
    expect(items().length).toBe(5)
    expect(seen).toEqual(['Edit', 'Pin', '•Compact', 'Delete', 'Edit'])
  })

  it('Home and End jump to the ends', () => {
    render(<RowActionsMenu x={0} y={0} actions={actions()} onClose={() => {}} />)
    press('End')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    press('Home')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  })

  it('Enter runs the focused action and closes the menu', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const list = actions()
    render(<RowActionsMenu x={0} y={0} actions={list} onClose={onClose} />)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(list[2].onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Tab once, without cancelling it', () => {
    const onClose = vi.fn()
    render(<RowActionsMenu x={0} y={0} actions={actions()} onClose={onClose} />)
    press('ArrowDown')
    expect(press('Tab'), 'the browser carries on').toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and gives the focus back to where it was', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>row</button>
          {open && <RowActionsMenu x={0} y={0} actions={actions()} onClose={() => setOpen(false)} />}
        </div>
      )
    }
    render(<Host />)
    const row = screen.getByRole('button', { name: 'row' })
    row.focus()
    fireEvent.click(row)
    press('ArrowDown')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    press('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row).toHaveFocus()
  })
})
