import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TooltipLayer, tipText } from './TooltipLayer'

function over(el: Element, pointerType = 'mouse') {
  const e = new Event('pointerover', { bubbles: true })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  fireEvent(el, e)
}

function setup(props: Record<string, string> = { 'aria-label': 'Iron Plate — 3/s', 'data-tip': '' }) {
  render(<><button data-testid="chip" {...props}>x</button><div data-testid="away">y</div><TooltipLayer /></>)
  return screen.getByTestId('chip')
}

describe('TooltipLayer', () => {
  it('shows the aria-label on pointer over, instantly, and hides the tooltip from assistive technology', () => {
    over(setup())
    const tip = screen.getByTestId('tooltip')
    expect(tip).toHaveTextContent('Iron Plate — 3/s')
    expect(tip).toHaveAttribute('aria-hidden', 'true')
    expect(tip.parentElement).toBe(document.body)
  })

  it('ignores touch pointers', () => {
    over(setup(), 'touch')
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('closes when the pointer moves onto something without a tip', () => {
    const chip = setup()
    over(chip)
    over(screen.getByTestId('away'))
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('lets data-tip override the aria-label', () => {
    const chip = setup({ 'aria-label': 'Slot, 3 per minute', 'data-tip': 'Iron Plate' })
    expect(tipText(chip)).toBe('Iron Plate')
    over(chip)
    expect(screen.getByTestId('tooltip')).toHaveTextContent('Iron Plate')
  })

  it('follows the aria-label while open', async () => {
    const chip = setup()
    over(chip)
    await act(async () => { chip.setAttribute('aria-label', 'Iron Plate — 4/s'); await Promise.resolve() })
    expect(await screen.findByText('Iron Plate — 4/s')).toBeInTheDocument()
  })

  it('closes when the anchor is removed', async () => {
    setup()
    const chip = document.createElement('button')
    chip.setAttribute('data-tip', 'Plain')
    document.body.appendChild(chip)
    over(chip)
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    await act(async () => { chip.remove(); await Promise.resolve() })
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('closes on Escape and on press', () => {
    const chip = setup()
    over(chip)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('tooltip')).toBeNull()
    over(chip)
    fireEvent.pointerDown(chip)
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })
})
