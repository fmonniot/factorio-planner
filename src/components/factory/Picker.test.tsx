import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Picker, PickerRow } from './Picker'

function Harness({ onPick = () => {} }: { onPick?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <span className="relative inline-flex">
        <button type="button" onClick={() => setOpen(o => !o)}>trigger</button>
        {open && (
          <Picker heading="Pick one" onClose={() => setOpen(false)}>
            <PickerRow name="Alpha" detail="speed 2" iconPath="a.png" onClick={() => onPick('a')} />
            <PickerRow name="Beta" selected onClick={() => onPick('b')} />
          </Picker>
        )}
      </span>
      <button type="button">elsewhere</button>
    </div>
  )
}

describe('Picker', () => {
  it('lists rows with name, trailing detail and heading', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByTestId('picker-heading')).toHaveTextContent('Pick one')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('speed 2')).toBeInTheDocument()
    expect(screen.getByText('Beta').closest('button')).toHaveClass('text-teal-400')
  })

  it('reports the chosen row', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.click(screen.getByText('Beta'))
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('closes on Esc, and the Esc reaches nothing else', () => {
    const elsewhere = vi.fn()
    document.addEventListener('keydown', elsewhere)
    render(<Harness />)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('picker')).toBeNull()
    expect(elsewhere).not.toHaveBeenCalled()
    document.removeEventListener('keydown', elsewhere)
  })

  it('closes on a press outside, but a press on the trigger only toggles', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.mouseDown(screen.getByTestId('picker'))
    expect(screen.getByTestId('picker')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByTestId('picker')).toBeNull()

    fireEvent.click(screen.getByText('trigger'))
    fireEvent.mouseDown(screen.getByText('trigger'))
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.queryByTestId('picker')).toBeNull()
  })

  it('does not let a click inside bubble to the row underneath', () => {
    const rowClick = vi.fn()
    render(<div onClick={rowClick}><Harness /></div>)
    fireEvent.click(screen.getByText('trigger'))
    rowClick.mockClear()
    fireEvent.click(screen.getByTestId('picker-heading'))
    expect(rowClick).not.toHaveBeenCalled()
  })
})
