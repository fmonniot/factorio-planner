import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { BlockPicker, type BlockPickerOption } from './BlockPicker'

const options: BlockPickerOption[] = [
  { id: 'a', label: 'Alpha', color: '#111111', meta: '2 areas' },
  { id: 'b', label: 'Bravo', color: '#222222', meta: '3 areas' },
  { id: 'c', label: 'Charlie', color: '#333333', meta: '1 area' },
]
const all: BlockPickerOption = { id: 'all', label: 'All blocks', meta: '3 blocks' }

function Harness({ initial = 'a', onChange = () => {} }: { initial?: string; onChange?: (id: string) => void }) {
  const [value, setValue] = useState(initial)
  return <BlockPicker label="Block" options={options} extra={all} value={value} onChange={id => { setValue(id); onChange(id) }} />
}

const trigger = () => screen.getByTestId('block-picker')
const optionNames = () => within(screen.getByRole('listbox', { name: 'Block' })).getAllByRole('option').map(o => o.textContent)

describe('BlockPicker', () => {
  it('shows the chosen block with its meta and lists All blocks first', () => {
    render(<Harness initial="b" />)
    expect(trigger()).toHaveTextContent('Bravo3 areas')
    fireEvent.click(trigger())
    expect(optionNames()).toEqual(['All blocks3 blocks', 'Alpha2 areas', 'Bravo3 areas', 'Charlie1 area'])
    expect(within(screen.getByRole('listbox', { name: 'Block' })).getByRole('option', { name: /^Bravo/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('picks a block from the list and closes it', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Block' })).getByRole('option', { name: /^Charlie/ }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger()).toHaveTextContent('Charlie')
  })

  it('steps through the blocks and wraps, skipping All blocks', () => {
    render(<Harness initial="c" />)
    fireEvent.click(screen.getByRole('button', { name: 'Next block' }))
    expect(trigger()).toHaveTextContent('Alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Previous block' }))
    expect(trigger()).toHaveTextContent('Charlie')
  })

  it('steps from All blocks to the first or the last block', () => {
    const { unmount } = render(<Harness initial="all" />)
    fireEvent.click(screen.getByRole('button', { name: 'Next block' }))
    expect(trigger()).toHaveTextContent('Alpha')
    unmount()
    render(<Harness initial="all" />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous block' }))
    expect(trigger()).toHaveTextContent('Charlie')
  })

  it('narrows the list by what is typed, and Enter picks the first match', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.change(screen.getByLabelText('Find a block'), { target: { value: 'ar' } })
    expect(optionNames()).toEqual(['Charlie1 area'])
    fireEvent.keyDown(screen.getByLabelText('Find a block'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('says so when nothing matches', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.change(screen.getByLabelText('Find a block'), { target: { value: 'zzz' } })
    expect(screen.getByText('No block matches.')).toBeInTheDocument()
  })

  it('closes on Escape, and the window never sees that Escape', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByLabelText('Find a block'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onWindowKey).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindowKey)
  })

  describe('keyboard', () => {
    const search = () => screen.getByLabelText('Find a block')
    const option = (name: RegExp) => within(screen.getByRole('listbox', { name: 'Block' })).getByRole('option', { name })
    const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement!, { key, ...init })

    it('ArrowDown in the search focuses the first option, and ArrowUp on it returns to the search', () => {
      render(<Harness />)
      fireEvent.click(trigger())
      press('ArrowDown')
      expect(option(/^All blocks/)).toHaveFocus()
      press('ArrowUp')
      expect(search()).toHaveFocus()
    })

    it('moves between options without wrapping, and Home and End jump to the ends', () => {
      render(<Harness />)
      fireEvent.click(trigger())
      press('ArrowDown')
      press('ArrowDown')
      expect(option(/^Alpha/)).toHaveFocus()
      press('End')
      expect(option(/^Charlie/)).toHaveFocus()
      press('ArrowDown')
      expect(option(/^Charlie/), 'stops at the last option').toHaveFocus()
      press('ArrowUp')
      expect(option(/^Bravo/)).toHaveFocus()
      press('Home')
      expect(option(/^All blocks/)).toHaveFocus()
    })

    it('walks only the options the search leaves', () => {
      render(<Harness />)
      fireEvent.click(trigger())
      fireEvent.change(search(), { target: { value: 'l' } })
      expect(optionNames()).toEqual(['All blocks3 blocks', 'Alpha2 areas', 'Charlie1 area'])
      press('ArrowDown')
      press('ArrowDown')
      press('ArrowDown')
      expect(document.activeElement).toHaveTextContent('Charlie')
    })

    it('ignores an arrow with a modifier in the search', () => {
      render(<Harness />)
      fireEvent.click(trigger())
      press('ArrowDown', { shiftKey: true })
      expect(search()).toHaveFocus()
    })

    it('Enter on a focused option picks it and the focus goes back to the button', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Harness onChange={onChange} />)
      fireEvent.click(trigger())
      press('ArrowDown')
      press('ArrowDown')
      press('ArrowDown')
      await user.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith('b')
      expect(trigger()).toHaveFocus()
    })
  })
})
