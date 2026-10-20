import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { Popover } from './Popover'

describe('Popover', () => {
  it('closes on Escape and prevents the default', () => {
    const onClose = vi.fn()
    render(<Popover onClose={onClose}>content</Popover>)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented, 'Escape must not reach the panes').toBe(true)
  })

  it('closes on a pointerdown outside, not inside', () => {
    const onClose = vi.fn()
    render(<Popover onClose={onClose}><button>inside</button></Popover>)
    fireEvent.pointerDown(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a pointerdown inside ignoreRef', () => {
    const onClose = vi.fn()
    const ignoreRef = createRef<HTMLDivElement>()
    render(
      <div ref={ignoreRef}>
        <button>trigger</button>
        <Popover onClose={onClose} ignoreRef={ignoreRef}>content</Popover>
      </div>,
    )
    fireEvent.pointerDown(screen.getByText('trigger'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
