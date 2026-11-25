import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { StripToolbar } from './StripToolbar'
import type { StripAction } from './StripToolbar'

const action = (over: Partial<StripAction> & { label: string }): StripAction => ({ icon: 'find', onSelect: () => {}, ...over })

describe('StripToolbar', () => {
  it('draws the left cluster, then the right one, each button named by its label', () => {
    render(<StripToolbar actions={[
      action({ label: 'Remove product', icon: 'trash', danger: true }),
      action({ label: 'Find recipe', side: 'left' }),
      action({ label: 'Served order…', icon: 'served' }),
    ]} />)
    const names = within(screen.getByTestId('strip-toolbar')).getAllByRole('button').map(b => b.getAttribute('aria-label'))
    expect(names).toEqual(['Find recipe', 'Remove product', 'Served order…'])
  })

  it('draws what is trailing after the buttons, inside the toolbar, and nothing without it', () => {
    const { unmount } = render(<StripToolbar actions={[action({ label: 'Find recipe', side: 'left' }), action({ label: 'Served order…', icon: 'served' })]} trailing={<i data-testid="trail" />} />)
    const toolbar = screen.getByTestId('strip-toolbar')
    expect(toolbar.lastElementChild).toBe(screen.getByTestId('trail'))
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Served order…' }))
    unmount()
    render(<StripToolbar actions={[action({ label: 'Find recipe', side: 'left' })]} />)
    expect(screen.queryByTestId('trail')).toBeNull()
  })

  it('names a badged action with its count and shows the same text as tooltip', () => {
    render(<StripToolbar actions={[action({ label: 'Served order…', icon: 'served', badge: { count: 2, noun: 'not ranked' } })]} />)
    const button = screen.getByRole('button', { name: 'Served order… · 2 not ranked' })
    expect(button).toHaveAttribute('data-tip', 'Served order… · 2 not ranked')
    expect(screen.getByTestId('strip-action-badge')).toHaveTextContent('2')
  })

  it('uses the title as tooltip when there is one, and calls onSelect on click', () => {
    const onSelect = vi.fn()
    render(<StripToolbar actions={[action({ label: 'Add extra output', icon: 'extra-add', title: 'Add extra output on top of what is requested', onSelect })]} />)
    const button = screen.getByRole('button', { name: 'Add extra output' })
    expect(button).toHaveAttribute('data-tip', 'Add extra output on top of what is requested')
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('puts the tooltip of a disabled action on a wrapper, as a natively disabled button gets no hover', () => {
    render(<StripToolbar actions={[action({ label: 'Move earlier', icon: 'left', disabled: true, title: 'Already the first product' })]} />)
    const button = screen.getByRole('button', { name: 'Move earlier' })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('data-tip')
    expect(button.parentElement).toHaveAttribute('data-tip', 'Already the first product')
  })

  it('draws joined actions as one group', () => {
    render(<StripToolbar actions={[
      action({ label: 'Move earlier', icon: 'left' }),
      action({ label: 'Move later', icon: 'right', joined: true }),
      action({ label: 'Remove product', icon: 'trash' }),
    ]} />)
    const earlier = screen.getByRole('button', { name: 'Move earlier' })
    expect(earlier.parentElement).toBe(screen.getByRole('button', { name: 'Move later' }).parentElement)
    expect(earlier.parentElement).not.toBe(screen.getByRole('button', { name: 'Remove product' }).parentElement)
  })
})
