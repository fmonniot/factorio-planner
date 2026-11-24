import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from './Switch'

describe('Switch', () => {
  it('carries its tooltip', () => {
    render(<Switch on label="Leftover" testId="s" tip="Leftover on." onToggle={() => {}} />)
    expect(screen.getByTestId('s')).toHaveAttribute('data-tip', 'Leftover on.')
  })

  it('stays focusable but inert with ariaDisabled', () => {
    const onToggle = vi.fn()
    render(<Switch on label="Leftover" testId="s" ariaDisabled onToggle={onToggle} />)
    const sw = screen.getByTestId('s')
    expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(sw).not.toBeDisabled()
    fireEvent.click(sw)
    expect(onToggle).not.toHaveBeenCalled()
    sw.focus()
    expect(sw).toHaveFocus()
  })

  it('toggles when it is not disabled, and fits a 30px column when compact', () => {
    const onToggle = vi.fn()
    render(<Switch on={false} label="Import" testId="s" compact onToggle={onToggle} />)
    const sw = screen.getByTestId('s')
    expect(sw).not.toHaveAttribute('aria-disabled')
    expect(sw).toHaveClass('w-[30px]')
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
