import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconChip, MoreBadge, PinBadge, SourcingBadge } from './IconChip'

describe('IconChip', () => {
  it('draws the quantity in the bottom-right corner and the badges in the top-right corner', () => {
    render(<IconChip alt="Gear" quantity="12.5" badges={<PinBadge />} />)
    expect(screen.getByText('12.5')).toHaveClass('right-0', 'bottom-0')
    expect(screen.getByTestId('chip-pin').parentElement).toHaveClass('-top-1', '-right-1')
  })

  it('is a span without onClick and a button with it', () => {
    const { rerender } = render(<IconChip alt="Gear" title="Gear" />)
    expect(screen.queryByRole('button')).toBeNull()
    const onClick = vi.fn()
    rerender(<IconChip alt="Gear" title="Gear" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sizes items 28px and entities 32px', () => {
    const { rerender, container } = render(<IconChip alt="Gear" />)
    expect(container.querySelector('.w-7')).not.toBeNull()
    rerender(<IconChip alt="Gear" size="entity" />)
    expect(container.querySelector('.w-8')).not.toBeNull()
  })

  it('draws an empty slot as a dashed plus with its quantity', () => {
    const { container } = render(<IconChip alt="Add" empty quantity="0/4" />)
    expect(container.querySelector('.border-dashed')).toHaveTextContent('+')
    expect(screen.getByText('0/4')).toBeInTheDocument()
  })

  it('never clips its badges (no overflow-hidden on the chip itself)', () => {
    render(<IconChip alt="Gear" badges={<MoreBadge count={2} />} data-testid="chip" />)
    expect(screen.getByTestId('chip')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  it('badges: sourcing letters', () => {
    render(<SourcingBadge letter="B" mode="byproducts-first" />)
    expect(screen.getByTestId('item-tile-sourcing')).toHaveTextContent('B')
  })
})
