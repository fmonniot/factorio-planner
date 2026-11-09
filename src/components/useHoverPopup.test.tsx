import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { useHoverPopup } from './useHoverPopup'

function Probe({ mode, placement = 'below' }: { mode: 'click' | 'hover'; placement?: 'below' | 'right' }) {
  const { open, hide, triggerProps, popupProps } = useHoverPopup<HTMLButtonElement>({ mode, placement })
  return (
    <>
      <button type="button" data-testid="trigger" {...triggerProps}>trigger</button>
      <button type="button" data-testid="other">other</button>
      {open && createPortal(
        <div {...popupProps} data-testid="popup">
          <button type="button" onClick={hide}>Close</button>
        </div>,
        document.body,
      )}
    </>
  )
}

/** happy-dom has no layout: give the trigger and the popup the boxes the placement works from. */
function layout(trigger: { top: number; bottom: number }, popupHeight: number, viewportHeight: number) {
  vi.stubGlobal('innerHeight', viewportHeight)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = this.dataset.testid === 'popup'
      ? { left: 0, top: 0, right: 100, bottom: popupHeight, width: 100, height: popupHeight }
      : { left: 50, top: trigger.top, right: 82, bottom: trigger.bottom, width: 32, height: trigger.bottom - trigger.top }
    return { ...box, x: box.left, y: box.top, toJSON: () => box } as DOMRect
  })
}

describe('useHoverPopup in click mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('limits the height of a popup that fits neither below nor above its trigger, and only then', () => {
    layout({ top: 100, bottom: 132 }, 700, 300) // 163px below the trigger, 88px above: 700px fits neither
    render(<Probe mode="click" />)
    fireEvent.click(screen.getByTestId('trigger'))
    const popup = screen.getByTestId('popup')
    expect(popup.style.top).toBe('136px')
    expect(popup.style.maxHeight).toBe(`${300 - 8 - 136}px`)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    vi.restoreAllMocks()
    layout({ top: 100, bottom: 132 }, 100, 300) // fits below
    fireEvent.click(screen.getByTestId('trigger'))
    expect(screen.getByTestId('popup').style.maxHeight).toBe('')
  })

  it('does not limit the height of a hover popup', () => {
    layout({ top: 100, bottom: 132 }, 700, 300)
    render(<Probe mode="hover" placement="right" />)
    fireEvent.focus(screen.getByTestId('trigger'))
    expect(screen.getByTestId('popup').style.maxHeight).toBe('')
  })

  it('leaves a hover popup as it was: a tooltip that takes no focus and has no tab stop', () => {
    render(<Probe mode="hover" placement="right" />)
    fireEvent.focus(screen.getByTestId('trigger'))
    const popup = screen.getByTestId('popup')
    expect(popup).toHaveAttribute('role', 'tooltip')
    expect(popup).not.toHaveAttribute('tabindex')
    expect(popup).not.toHaveFocus()
    expect(screen.getByTestId('trigger')).not.toHaveAttribute('aria-controls')
  })

  it('closes on a press outside', () => {
    render(<Probe mode="click" />)
    const trigger = screen.getByTestId('trigger')
    fireEvent.click(trigger)
    expect(screen.getByTestId('popup')).toHaveFocus()
    // The press hands focus to the trigger first; the browser then moves it to what was pressed.
    const other = screen.getByTestId('other')
    fireEvent.pointerDown(other)
    expect(screen.queryByTestId('popup')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})
