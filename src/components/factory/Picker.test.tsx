import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Picker, PickerRow } from './Picker'
import { PickerTrigger } from './PickerTrigger'

function Harness({ onPick = () => {}, label = 'trigger', heading = 'Pick one' }: { onPick?: (id: string) => void; label?: string; heading?: string }) {
  return (
    <PickerTrigger trigger={({ toggle }) => <button type="button" onClick={toggle}>{label}</button>}>
      {close => (
        <Picker heading={heading} onClose={close}>
          <PickerRow name="Alpha" detail="speed 2" iconPath="a.png" onClick={() => onPick('a')} />
          <PickerRow name="Beta" selected onClick={() => onPick('b')} />
        </Picker>
      )}
    </PickerTrigger>
  )
}

function Page(props: Parameters<typeof Harness>[0] = {}) {
  return <div><Harness {...props} /><button type="button">elsewhere</button></div>
}

describe('Picker', () => {
  it('lists rows with name, trailing detail and heading', () => {
    render(<Page />)
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByTestId('picker-heading')).toHaveTextContent('Pick one')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('speed 2')).toBeInTheDocument()
    expect(screen.getByText('Beta').closest('button')).toHaveClass('text-teal-400')
  })

  it('reports the chosen row', () => {
    const onPick = vi.fn()
    render(<Page onPick={onPick} />)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.click(screen.getByText('Beta'))
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('closes on Esc, and the Esc reaches nothing else', () => {
    const elsewhere = vi.fn()
    document.addEventListener('keydown', elsewhere)
    render(<Page />)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('picker')).toBeNull()
    expect(elsewhere).not.toHaveBeenCalled()
    document.removeEventListener('keydown', elsewhere)
  })

  it('closes on a press outside, but a press on the trigger only toggles', () => {
    render(<Page />)
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
    render(<div onClick={rowClick}><Page /></div>)
    fireEvent.click(screen.getByText('trigger'))
    rowClick.mockClear()
    fireEvent.click(screen.getByTestId('picker-heading'))
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('renders in a portal on document.body, outside the trigger wrapper', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByText('trigger'))
    expect(container.querySelector('[data-testid="picker"]')).toBeNull()
    expect(document.body.querySelector(':scope > [data-testid="picker"]')).not.toBeNull()
  })

  it('Esc closes only the topmost picker', () => {
    render(<div><Harness label="first" heading="One" /><Harness label="second" heading="Two" /></div>)
    fireEvent.click(screen.getByText('first'))
    fireEvent.click(screen.getByText('second'))
    expect(screen.getAllByTestId('picker')).toHaveLength(2)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getAllByTestId('picker-heading').map(h => h.textContent)).toEqual(['One'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('picker')).toBeNull()
  })

  describe('placement', () => {
    const rect = (r: Partial<DOMRect>) => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect
    afterEach(() => { vi.restoreAllMocks() })

    function openAt(trigger: DOMRect, size: { width: number; height: number }, viewport = { w: 1000, h: 600 }) {
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(viewport.w)
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(viewport.h)
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(size.width)
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(size.height)
      vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(trigger)
      render(<Page />)
      fireEvent.click(screen.getByText('trigger'))
      return screen.getByTestId('picker')
    }

    it('opens under the trigger when there is room', () => {
      const p = openAt(rect({ left: 100, top: 100, bottom: 130 }), { width: 240, height: 150 })
      expect(p.style.top).toBe('134px')
      expect(p.style.left).toBe('100px')
    })

    it('flips up near the bottom edge and clamps to the right edge', () => {
      const p = openAt(rect({ left: 950, top: 560, bottom: 590 }), { width: 240, height: 300 })
      expect(p.style.top).toBe('')
      expect(p.style.bottom).toBe(`${600 - 560 + 4}px`)
      expect(p.style.left).toBe(`${1000 - 240 - 8}px`)
    })
  })
})
